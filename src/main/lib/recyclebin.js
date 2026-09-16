'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { pathKey, IS_WIN } = require('./util');

/**
 * Selective emptying of the Recycle Bin.
 *
 * This is the only code in the app that deletes something permanently, and it
 * exists because of a hole in the original design: an automatic cleanup that
 * moves files to the Recycle Bin frees no disk space at all. The bin is on the
 * same volume. A scheduled task that ran every Sunday and reported "freed 2 GB"
 * would be lying -- nothing is freed until the bin is emptied, and the app has
 * always refused to empty it.
 *
 * Emptying the whole bin is not an acceptable answer: it contains whatever the
 * user deleted in Explorer, for reasons this app knows nothing about. So the
 * purge is narrowed on four independent axes, and an item must clear all four:
 *
 *   1. It must physically live inside a Recycle Bin folder we enumerated.
 *   2. Its metadata must say it came from a path this app recorded trashing.
 *   3. The bin's own deletion timestamp must agree with our record, within
 *      minutes -- so a file the user deleted themselves at a different time is
 *      never mistaken for ours, even at the same path.
 *   4. It must have been there longer than the configured grace period, so
 *      there is a real window in which "restore from Recycle Bin" still works.
 *
 * The ledger alone is never sufficient. It is a claim; the bin's metadata is
 * the evidence. A hand-edited ledger naming C:\Users\me\thesis.docx purges
 * nothing, because no bin item corroborates it.
 *
 * Windows only. On other platforms every function reports "unsupported" and
 * deletes nothing, rather than guessing at a trash layout it has not been
 * tested against.
 */

/* -------------------------------------------------------------------------- */
/* $I metadata                                                                 */
/* -------------------------------------------------------------------------- */

// Windows stores each recycled item as two files in the bin: `$R<id><ext>`
// holds the data, `$I<id><ext>` holds where it came from and when it went.
const META_PREFIX = '$I';
const DATA_PREFIX = '$R';

// FILETIME counts 100-nanosecond ticks from 1601-01-01; Date counts
// milliseconds from 1970-01-01.
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET_MS = 11644473600000n;

const HEADER_BYTES = 24; // version + original size + deletion time
const V2_NAME_LENGTH_BYTES = 4;
const V1_PATH_BYTES = 520; // fixed MAX_PATH * 2, no length field

/**
 * Parse a `$I` metadata file.
 *
 * Two layouts exist. Version 2 (Windows 10 and later) stores the path length
 * explicitly; version 1 uses a fixed 260-character field. Both are read rather
 * than only the current one, because a bin can still hold items recycled by an
 * older build of Windows on the same volume.
 *
 * @returns {{originalPath: string, size: number, deletedAt: number} | null}
 */
function parseMeta(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES) return null;

  const version = buffer.readBigInt64LE(0);
  const size = buffer.readBigInt64LE(8);
  const filetime = buffer.readBigInt64LE(16);

  let raw;
  if (version === 2n) {
    if (buffer.length < HEADER_BYTES + V2_NAME_LENGTH_BYTES) return null;
    const chars = buffer.readUInt32LE(HEADER_BYTES);
    const start = HEADER_BYTES + V2_NAME_LENGTH_BYTES;
    const end = start + chars * 2;
    if (chars === 0 || end > buffer.length) return null;
    raw = buffer.toString('utf16le', start, end);
  } else if (version === 1n) {
    const end = Math.min(HEADER_BYTES + V1_PATH_BYTES, buffer.length);
    if (end <= HEADER_BYTES) return null;
    raw = buffer.toString('utf16le', HEADER_BYTES, end);
  } else {
    return null;
  }

  const originalPath = raw.replace(/\0[\s\S]*$/, '').trim();
  if (originalPath === '') return null;

  const deletedAt = Number(filetime / FILETIME_TICKS_PER_MS - FILETIME_EPOCH_OFFSET_MS);
  if (!Number.isFinite(deletedAt) || deletedAt <= 0) return null;

  return { originalPath, size: Number(size), deletedAt };
}

/** Build a `$I` buffer. Exported so tests can create real bin items. */
function encodeMeta({ originalPath, size = 0, deletedAt = Date.now() }) {
  const pathBytes = Buffer.from(`${originalPath}\0`, 'utf16le');
  const buffer = Buffer.alloc(HEADER_BYTES + V2_NAME_LENGTH_BYTES + pathBytes.length);
  buffer.writeBigInt64LE(2n, 0);
  buffer.writeBigInt64LE(BigInt(Math.max(0, Math.round(size))), 8);
  buffer.writeBigInt64LE(
    (BigInt(Math.round(deletedAt)) + FILETIME_EPOCH_OFFSET_MS) * FILETIME_TICKS_PER_MS,
    16
  );
  buffer.writeUInt32LE(pathBytes.length / 2, HEADER_BYTES);
  pathBytes.copy(buffer, HEADER_BYTES + V2_NAME_LENGTH_BYTES);
  return buffer;
}

/* -------------------------------------------------------------------------- */
/* enumeration                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The per-user folders inside each volume's Recycle Bin.
 *
 * A bin holds one directory per security identifier that has deleted something
 * on that volume. Other users' folders deny access, which is exactly what we
 * want: an unreadable directory is silently skipped rather than reported as an
 * error, because it is not ours to touch in the first place.
 *
 * @param {string[]} volumeRoots e.g. ['C:\\', 'D:\\']
 * @returns {Promise<string[]>} absolute paths of readable SID directories
 */
async function findUserBins(volumeRoots) {
  const found = [];
  const seen = new Set();

  for (const root of volumeRoots) {
    if (typeof root !== 'string' || root.trim() === '') continue;
    const binRoot = path.join(path.parse(path.resolve(root)).root, '$Recycle.Bin');
    const key = pathKey(binRoot);
    if (seen.has(key)) continue;
    seen.add(key);

    let sids;
    try {
      sids = await fsp.readdir(binRoot, { withFileTypes: true });
    } catch {
      continue; // no bin on this volume, or not readable
    }

    for (const sid of sids) {
      if (!sid.isDirectory()) continue;
      const dir = path.join(binRoot, sid.name);
      try {
        await fsp.access(dir);
        await fsp.readdir(dir);
        found.push(dir);
      } catch {
        // Another account's bin. Not an error.
      }
    }
  }

  return found;
}

/**
 * Every item this user can see in the given bin directories.
 *
 * @param {string[]} binDirs
 * @returns {Promise<Array<{originalPath, size, deletedAt, dataPath, metaPath, binDir}>>}
 */
async function listItems(binDirs) {
  const items = [];

  for (const dir of binDirs) {
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }

    for (const name of names) {
      if (!name.startsWith(META_PREFIX)) continue;
      const metaPath = path.join(dir, name);

      let buffer;
      try {
        buffer = await fsp.readFile(metaPath);
      } catch {
        continue;
      }

      const meta = parseMeta(buffer);
      if (!meta) continue;

      // `$IABC.txt` describes `$RABC.txt`; the suffix after the prefix is shared.
      const dataPath = path.join(dir, DATA_PREFIX + name.slice(META_PREFIX.length));
      items.push({ ...meta, dataPath, metaPath, binDir: dir });
    }
  }

  return items;
}

/* -------------------------------------------------------------------------- */
/* purge                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How far the bin's recorded deletion time may differ from ours before we stop
 * believing they describe the same event. Generous enough to absorb the gap
 * between trashing a file and writing the ledger entry, tight enough that a
 * separate manual delete of the same path never falls inside it.
 */
const TIME_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * A pair is only ever removed from inside a directory we enumerated as a bin.
 * This is the check that makes a corrupted ledger harmless: whatever it claims,
 * the file we are about to unlink has to sit in the Recycle Bin already.
 */
function isInsideAllowedBin(target, allowedDirs) {
  const parent = pathKey(path.dirname(target));
  return allowedDirs.some((dir) => pathKey(dir) === parent);
}

/**
 * Permanently remove the recycled copies of items this app trashed, once they
 * have sat in the bin longer than the grace period.
 *
 * @param {object}   options
 * @param {Array}    options.entries        ledger entries (path, trashedAt)
 * @param {string[]} options.binDirs        directories from findUserBins()
 * @param {number}   [options.afterDays=7]  grace period before an item qualifies
 * @param {number}   [options.now]
 * @param {number}   [options.maxItems]     ceiling on one run
 * @param {boolean}  [options.dryRun=false] match and report, delete nothing
 * @returns {Promise<{purged: Array, freedBytes: number, failed: Array,
 *   examined: number, matched: number, dryRun: boolean, supported: boolean}>}
 */
async function purgeRecorded(options = {}) {
  const {
    entries = [],
    binDirs = [],
    afterDays = 7,
    now = Date.now(),
    maxItems = Infinity,
    dryRun = false,
  } = options;

  const result = {
    purged: [],
    freedBytes: 0,
    failed: [],
    examined: 0,
    matched: 0,
    dryRun,
    supported: IS_WIN || options.force === true,
  };

  if (!result.supported) {
    result.reason = 'Selective Recycle Bin purge is implemented for Windows only';
    return result;
  }
  if (entries.length === 0 || binDirs.length === 0) return result;

  // Index our records by original path. Several entries can share a path when
  // a file was recreated and trashed again; the timestamp check picks the right
  // one, and a bin item matching none of them is left alone.
  const byPath = new Map();
  for (const entry of entries) {
    const key = pathKey(entry.path);
    const bucket = byPath.get(key);
    if (bucket) bucket.push(entry);
    else byPath.set(key, [entry]);
  }

  const graceCutoff = now - Math.max(0, afterDays) * 24 * 60 * 60 * 1000;
  const items = await listItems(binDirs);
  result.examined = items.length;

  for (const item of items) {
    if (result.purged.length >= maxItems) break;

    const candidates = byPath.get(pathKey(item.originalPath));
    if (!candidates) continue;

    const entry = candidates.find(
      (e) => Math.abs(e.trashedAt - item.deletedAt) <= TIME_TOLERANCE_MS
    );
    if (!entry) continue;

    // Still inside the window where the user can simply restore it.
    if (item.deletedAt > graceCutoff) continue;

    // Belt and braces: both halves must be in a directory we enumerated.
    if (!isInsideAllowedBin(item.dataPath, binDirs) || !isInsideAllowedBin(item.metaPath, binDirs)) {
      result.failed.push({ path: item.originalPath, error: 'Refused: not inside an enumerated Recycle Bin folder' });
      continue;
    }

    result.matched += 1;

    if (dryRun) {
      result.purged.push({ ...item, entry, dryRun: true });
      result.freedBytes += item.size;
      continue;
    }

    try {
      // Data first. If this succeeds and the metadata removal then fails, the
      // bin shows a broken entry -- ugly, but recoverable. The reverse order
      // would orphan real data with no way left to identify it.
      await fsp.rm(item.dataPath, { recursive: true, force: true });
      await fsp.rm(item.metaPath, { force: true });
      result.purged.push({ ...item, entry });
      result.freedBytes += item.size;
    } catch (err) {
      result.failed.push({ path: item.originalPath, error: err.message || 'Could not remove recycled copy' });
    }
  }

  return result;
}

module.exports = {
  parseMeta,
  encodeMeta,
  findUserBins,
  listItems,
  purgeRecorded,
  TIME_TOLERANCE_MS,
  META_PREFIX,
  DATA_PREFIX,
};
