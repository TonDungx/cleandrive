'use strict';

/**
 * A scan of several folders at once (A4).
 *
 * Each folder is still scanned on its own, the way one always was, and keeps
 * everything that is kept per folder: its point in the history, its snapshot,
 * its comparison with the last scan of the same folder. What is new is only
 * the joining -- one set of totals, one largest list, one set of cleanup
 * groups, one map with a tile per folder -- and what the app may do under
 * each folder, which depends on the drive it is on (lib/volumes.js).
 *
 * Folders inside another folder that was also chosen are scanned with it, not
 * twice, and the reply says which were folded in.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const { evidence } = require('./contract');
const { canonicalPath, pathKey } = require('../lib/util');
const { message: m } = require('../../i18n');
const volumes = require('../lib/volumes');

/** More than this is not a choice anybody makes by hand. */
const MAX_ROOTS = 12;

const VERDICT_ORDER = { safe: 0, review: 1, protected: 2, keep: 3 };

/** Why nothing is offered under a folder, as the rows say it. */
const READ_ONLY = Object.freeze({
  network: m(
    'evidence.readOnly.network',
    'On a network drive, where Windows keeps no Recycle Bin: CleanDrive only reads here'
  ),
  removable: m(
    'evidence.readOnly.removable',
    'On a removable drive: what the Recycle Bin does there has not been measured yet, so CleanDrive only reads here'
  ),
  cdrom: m('evidence.readOnly.cdrom', 'On a disc: nothing on it can be deleted'),
});

function inside(child, parent) {
  const c = pathKey(child);
  const p = pathKey(parent);
  return c !== p && c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/**
 * The folders to scan, as the window asked for them, made safe to scan.
 *
 * @param {string|string[]} input
 * @param {object} [deps]
 * @param {Array} [deps.drives]  `volumes.list().drives`
 * @param {Function} [deps.stat]
 * @returns {Promise<{roots: Array, merged: Array<{root: string, into: string}>,
 *   refused: Array<{root: string, reason: string}>}>}
 */
async function prepareRoots(input, { drives = [], stat = fsp.stat } = {}) {
  const asked = (Array.isArray(input) ? input : [input]).filter((s) => typeof s === 'string' && s.trim() !== '');
  if (asked.length === 0) throw Object.assign(new Error('Choose a folder first'), { code: 'EINVAL', quiet: true });
  if (asked.length > MAX_ROOTS) {
    throw Object.assign(new Error(`At most ${MAX_ROOTS} folders at once`), { code: 'EINVAL', quiet: true });
  }

  const refused = [];
  const found = [];
  for (const raw of asked) {
    if (!path.isAbsolute(raw)) {
      refused.push({ root: raw, reason: 'notAbsolute' });
      continue;
    }
    const root = canonicalPath(raw);
    let info;
    try {
      info = await stat(root);
    } catch {
      refused.push({ root, reason: 'missing' });
      continue;
    }
    if (!info.isDirectory()) {
      refused.push({ root, reason: 'notFolder' });
      continue;
    }
    if (!found.some((r) => pathKey(r) === pathKey(root))) found.push(root);
  }

  // Outermost first, so a folder is folded into the widest one that holds it.
  const widest = [...found].sort((a, b) => pathKey(a).length - pathKey(b).length);
  const kept = [];
  const merged = [];
  for (const root of widest) {
    const into = kept.find((k) => inside(root, k));
    if (into) merged.push({ root, into });
    else kept.push(root);
  }
  const roots = found.filter((r) => kept.includes(r)).map((r) => volumes.describe(r, drives));
  return { roots, merged, refused };
}

/** A row under a folder the app only reads: the same verdict, nothing to do. */
function readOnlyCandidate(candidate, reason) {
  const why = READ_ONLY[reason];
  if (!why) return candidate;
  return {
    ...candidate,
    actions: [],
    unattendedEligible: false,
    evidence: [...candidate.evidence, evidence(candidate.evidence.length + 1, why)],
  };
}

/**
 * In use on a drive and not in the scan of all of it: Windows, programs,
 * other people's folders, what could not be read. One tile, pointing at the
 * System screen, which says what it is.
 *
 * `used` is the drive's allocation and the scan counts file sizes, so this is
 * an estimate: compressed files, OneDrive's online-only files and small files'
 * slack all move it. It is not drawn when it comes out at nothing or less.
 *
 * @returns {{volume: string, bytes: number} | null}
 */
async function unscannedOnDrive(info, summary, { statfs = fsp.statfs } = {}) {
  if (!info || info.kind === 'network' || info.root !== info.volume || !summary || summary.cancelled) return null;
  try {
    const s = await statfs(info.volume);
    const used = (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize);
    const bytes = used - (summary.totalSize || 0);
    return Number.isFinite(bytes) && bytes > 0 ? { volume: info.volume, bytes } : null;
  } catch {
    return null;
  }
}

/**
 * One reply for several scans.
 *
 * @param {Array<{info: object, summary: object, candidates: Array}>} parts  in the order chosen
 */
function mergeScans(parts) {
  const sum = (key) => parts.reduce((n, p) => n + (Number(p.summary[key]) || 0), 0);
  const first = parts[0].summary;
  const totalSize = sum('totalSize');

  const byId = new Map();
  for (const part of parts) for (const c of part.candidates) byId.set(c.id, c);
  const bytesOf = (id) => (byId.get(id) ? byId.get(id).bytes : 0);

  const types = new Map();
  for (const part of parts) {
    for (const type of part.summary.byType || []) {
      const had = types.get(type.ext) || { ...type, size: 0, count: 0 };
      had.size += type.size;
      had.count += type.count;
      types.set(type.ext, had);
    }
  }

  const groups = new Map();
  for (const part of parts) {
    for (const group of part.summary.cleanup.groups) {
      const had = groups.get(group.category);
      if (!had) {
        groups.set(group.category, { ...group, ids: [...group.ids] });
        continue;
      }
      had.bytes += group.bytes;
      had.count += group.count;
      had.truncated = Boolean(had.truncated || group.truncated);
      had.ids.push(...group.ids);
    }
  }
  const merged = [...groups.values()];
  for (const group of merged) group.ids.sort((a, b) => bytesOf(b) - bytesOf(a));
  merged.sort((a, b) => (VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9) || b.bytes - a.bytes);

  const clouds = parts.map((p) => p.summary.cloud).filter(Boolean);
  const cloud = clouds.length === 0 ? null : clouds.reduce((a, b) => ({
    ids: [...a.ids, ...b.ids],
    bytes: a.bytes + b.bytes,
    onDisk: a.onDisk + b.onDisk,
    notSynced: { count: a.notSynced.count + b.notSynced.count, bytes: a.notSynced.bytes + b.notSynced.bytes },
    pending: { count: a.pending.count + b.pending.count, bytes: a.pending.bytes + b.pending.bytes },
    onlineOnly: { count: a.onlineOnly.count + b.onlineOnly.count, bytes: a.onlineOnly.bytes + b.onlineOnly.bytes },
    unavailable: a.unavailable || b.unavailable,
    running: a.running || b.running,
  }));

  // A list is "tracked" only if every drive in it keeps access times; one that
  // does not makes every row say "modified", which is true of all of them.
  const untracked = parts.find((p) => !p.summary.accessTimes || p.summary.accessTimes.tracked !== true);

  const errors = parts.flatMap((p) => p.summary.errors || []);
  return {
    ...first,
    root: first.root,
    totalSize,
    totalFiles: sum('totalFiles'),
    totalDirs: sum('totalDirs'),
    topFolders: parts
      .flatMap((p) => p.summary.topFolders || [])
      .map((f) => ({ ...f, percent: totalSize > 0 ? (f.size / totalSize) * 100 : 0 }))
      .sort((a, b) => b.size - a.size),
    byType: [...types.values()].sort((a, b) => b.size - a.size).slice(0, 25),
    largest: parts.flatMap((p) => p.summary.largest || []).sort((a, b) => bytesOf(b) - bytesOf(a)).slice(0, 100),
    cleanup: {
      ...first.cleanup,
      groups: merged,
      safeBytes: merged.filter((g) => g.verdict === 'safe').reduce((n, g) => n + g.bytes, 0),
      reviewBytes: merged.filter((g) => g.verdict === 'review').reduce((n, g) => n + g.bytes, 0),
      protectedPaths: parts.flatMap((p) => p.summary.cleanup.protectedPaths || []),
      appFolders: parts.flatMap((p) => p.summary.cleanup.appFolders || []),
    },
    accessTimes: untracked ? untracked.summary.accessTimes : first.accessTimes,
    scannedAt: Math.min(...parts.map((p) => p.summary.scannedAt || Date.now())),
    errors: errors.slice(0, 200),
    errorCount: sum('errorCount'),
    cancelled: parts.some((p) => p.summary.cancelled),
    durationMs: sum('durationMs'),
    excluded: sum('excluded'),
    ...(cloud ? { cloud } : {}),
    openApps: parts.some((p) => p.summary.openApps === null)
      ? null
      : [...new Set(parts.flatMap((p) => p.summary.openApps || []))],
  };
}

/**
 * Which copy of a duplicate to suggest keeping, by the drive it is on (F1).
 *
 * Returns a ranking function for `lib/duplicate.js` -- lower wins, and the
 * oldest copy still breaks a tie -- or null for the default, which is that
 * the drive does not come into it and the oldest copy is the keeper.
 *
 *   'internal'  keep the copy on this computer's own disk, so the copies on
 *               a drive you carry around are the ones offered up
 *   'backup'    keep the copy on the drive you carry around, so the space
 *               comes back on the disk that is short of it
 *
 * "Away" is external by bus, or read-only for any reason: a USB disk, a card,
 * a share. A file under none of the searched roots ranks last, so nothing
 * outside the search can be chosen as the thing to keep.
 *
 * @param {Array} roots    prepared roots, from `prepareRoots`
 * @param {string} prefer  'oldest' | 'internal' | 'backup'
 */
function keeperRankFor(roots, prefer) {
  if (prefer !== 'internal' && prefer !== 'backup') return null;
  const list = Array.isArray(roots) ? roots : [];
  return (file) => {
    const root = list.find((r) => inside(file.path, r.root));
    if (!root) return 2;
    const away = Boolean(root.external) || root.readOnly !== null;
    return prefer === 'backup' ? (away ? 0 : 1) : (away ? 1 : 0);
  };
}

/**
 * Why a folder cannot be scanned from the volume’s own catalogue (A2),
 * or null when it can.
 *
 * The fast scan is offered for a whole drive and nothing smaller, and the
 * reason is measured rather than tidy: reading `$MFT` costs what the volume
 * costs, not what the folder costs. D: holds 515,940 records; a walk of the
 * same drive lists 191,975, because the walk skips `node_modules`, `.git`
 * and hidden folders and a catalogue cannot skip anything. For one folder on
 * a big drive the fast scan is the slower one, and it would have to raise a
 * UAC prompt to be slower.
 *
 * Every answer but null means the ordinary walk runs and the status line
 * says which of these it was. None of them is an error: a fast scan that
 * cannot happen is a scan, not a failure.
 *
 * @param {object} info  a prepared root, from `prepareRoots`
 * @returns {'network'|'readOnly'|'notWholeDrive'|'notNtfs'|null}
 */
function whyNotFast(info) {
  if (!info || typeof info.root !== 'string') return 'notWholeDrive';
  if (info.readOnly === 'network') return 'network';
  if (info.readOnly) return 'readOnly';
  if (pathKey(info.root) !== pathKey(info.volume)) return 'notWholeDrive';
  // FAT, exFAT and ReFS keep no `$MFT`. The spec asks that these fall back
  // to the ordinary walk and say why, rather than failing.
  if (String(info.fileSystem || '').toUpperCase() !== 'NTFS') return 'notNtfs';
  return null;
}

module.exports = { prepareRoots, mergeScans, readOnlyCandidate, unscannedOnDrive, whyNotFast, keeperRankFor, READ_ONLY, MAX_ROOTS, inside };
