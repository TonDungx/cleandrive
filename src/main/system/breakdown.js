'use strict';

/**
 * Where a system drive's space went -- all of it, including the parts every
 * other screen in the app leaves out on purpose.
 *
 * Scanning `C:\` in Disk usage under-reports the drive, by design: Windows,
 * Program Files and ProgramData are refused, and so are folders whose names
 * start with a dot, and `node_modules`. That is right for a screen about what
 * to delete and wrong for the question "the drive is 443 GB used and the app
 * found 140 -- where is the rest?". This answers that one, and it is built so
 * that what it cannot explain is shown as a number, not hidden:
 *
 *   used = what the walk found  +  what administrator rights add
 *        + what Windows' tools report (hibernation file, restore points, MFT)
 *        + not explained
 *
 * Every byte of the walk lands in exactly one row, decided by `bucketOf` from
 * the folder it is in. What administrator rights add is placed in the row of
 * the folder that was refused. Nothing is estimated: a row either has a
 * measurement behind it or says it needs one.
 *
 * Measured on the machine this was built on (510 GB drive, 443 GB used, not
 * elevated): the walk takes about 135 seconds for 1.1 million files. The 152
 * folders it could not read took 14 seconds more with administrator rights and
 * came to 24.9 GB, most of it `Program Files\WindowsApps` and the recovery
 * environment.
 */

const os = require('node:os');
const path = require('node:path');

const { measureTree } = require('./walk');
const { NOISE_DIR_NAMES } = require('../lib/util');

/** Where the Delivery Optimization cache lives; only readable elevated. */
const DELIVERY_OPTIMIZATION = [
  'Windows', 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization',
];

const UPGRADE_FOLDERS = new Set(['$windows.~bt', '$windows.~ws', '$winreagent', '$sysreset', '$getcurrent']);
const WINDOWS_FOLDERS = new Set(['config.msi', 'perflogs']);

/**
 * The drive, as `C:\`, and this user's profile below it as segments -- or null
 * when the profile lives on another drive.
 */
function driveOf(drive = process.env.SystemDrive || 'C:') {
  const letter = /^[A-Za-z]:/.test(drive) ? drive.slice(0, 2).toUpperCase() : 'C:';
  return `${letter}\\`;
}

function profilePartsOn(drive, home = os.homedir()) {
  const parts = relParts(drive, path.resolve(home));
  return parts && parts.length ? parts.map((s) => s.toLowerCase()) : null;
}

/**
 * A path below the drive root, as segments; null when it is not below it.
 * The root is `C:\` in the app; a harness points it at a folder of its own.
 */
function relParts(drive, p) {
  const rel = path.relative(drive, p);
  if (rel === '') return [];
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(/[\\/]/).filter(Boolean);
}

const hidden = (segment) => segment.startsWith('.') || segment.startsWith('$') || NOISE_DIR_NAMES.has(segment.toLowerCase());

/**
 * Which row a folder belongs to, from its path below the drive root.
 *
 * Keys with a colon (`folder:Vmware`, `skipped:.ollama`, `account:Public`) are
 * kept apart so a row can name its largest parts; they are summed into their
 * row later.
 */
function makeBucketOf(profileParts) {
  return (parts) => {
    if (parts.length === 0) return 'folder:';
    const lower = parts.map((p) => p.toLowerCase());
    const top = lower[0];

    if (profileParts && lower.length >= profileParts.length && profileParts.every((p, i) => lower[i] === p)) {
      const rest = parts.slice(profileParts.length);
      const at = rest.findIndex(hidden);
      return at === -1 ? 'profile' : `skipped:${rest.slice(0, at + 1).join('\\')}`;
    }
    if (top === 'users') return lower.length >= 2 ? `account:${parts[1]}` : 'account:';
    if (top === 'program files' || top === 'program files (x86)') return 'programs';
    if (top === 'programdata') return 'programData';
    if (top === 'windows') {
      const second = lower[1];
      if (second === 'winsxs') return 'winsxs';
      if (second === 'installer') return 'installer';
      if (second === 'softwaredistribution' && lower[2] === 'download') return 'updateCache';
      if (second === 'system32' && lower[2] === 'driverstore') return 'driverStore';
      if (DELIVERY_OPTIMIZATION.every((s, i) => lower[i] === s.toLowerCase())) return 'deliveryOptimization';
      return 'windows';
    }
    if (top === 'windows.old') return 'windowsOld';
    if (top === '$recycle.bin') return 'recycleBin';
    if (UPGRADE_FOLDERS.has(top)) return 'upgrade';
    if (top === 'recovery') return 'recovery';
    if (top === 'system volume information') return 'systemHidden';
    if (WINDOWS_FOLDERS.has(top)) return 'windows';
    return `folder:${parts[0]}`;
  };
}

/** The row a bucket key is summed into. */
function rowOf(bucket) {
  const colon = bucket.indexOf(':');
  if (colon === -1) return bucket;
  return { folder: 'otherFolders', skipped: 'profileSkipped', account: 'otherAccounts' }[bucket.slice(0, colon)] || bucket;
}

/**
 * Walk the drive, unelevated. The long part: minutes, with progress, stoppable.
 *
 * @returns {Promise<object>} the walk, with the drive and profile it was made for
 */
async function walkDrive({ drive = driveOf(), home = os.homedir(), token, onProgress } = {}) {
  const profileParts = profilePartsOn(drive, home);
  const walk = await measureTree(drive, { bucketOf: makeBucketOf(profileParts), token, onProgress });
  return { ...walk, drive, profileParts, profile: profileParts ? path.resolve(home) : null, at: Date.now() };
}

/** The folders a second, elevated pass should measure: the ones refused, plus named targets inside them. */
function elevatedRequest(walk) {
  const targets = [{ key: 'deliveryOptimization', dir: path.join(walk.drive, ...DELIVERY_OPTIMIZATION) }];
  return { dirs: [...walk.denied, ...targets.map((t) => t.dir)], targets };
}

const isUnder = (child, parent) => {
  const c = child.toLowerCase();
  const p = parent.toLowerCase().replace(/\\+$/, '');
  return c === p || c.startsWith(`${p}\\`);
};

/**
 * Put it all together.
 *
 * @param {object} input
 * @param {object} input.walk            from walkDrive()
 * @param {{totalBytes: number, freeBytes: number, usedBytes: number}} input.volume
 * @param {{hiberfil: number|null, pagefile: number|null, swapfile: number|null}} input.systemFiles
 * @param {number} [input.appInBin]      bytes in the bin the app put there, corroborated
 * @param {object} [input.elevated]      { sums, targets, shadow, ntfs, reserve, dism }, parsed
 */
function build({ walk, volume, systemFiles, appInBin = 0, elevated = null }) {
  const drive = walk.drive;
  const bucketOf = makeBucketOf(walk.profileParts);
  const buckets = new Map();
  const addTo = (key, bytes, files = 0) => {
    const b = buckets.get(key) || { bytes: 0, files: 0, elevatedBytes: 0 };
    b.bytes += bytes;
    b.files += files;
    buckets.set(key, b);
    return b;
  };
  for (const [key, b] of Object.entries(walk.buckets)) addTo(key, b.allocated, b.files);

  // Which rows had folders the walk could not read, before any elevated pass.
  const refusedRows = new Map();
  for (const dir of walk.denied) {
    const row = rowOf(bucketOf(relParts(drive, dir) || []));
    refusedRows.set(row, (refusedRows.get(row) || 0) + 1);
  }
  const refusedBeyondList = walk.deniedCount - walk.denied.length;

  // What administrator rights add, placed in the row of the folder refused.
  const stillRefused = new Map();
  let elevatedBytes = 0;
  if (elevated && Array.isArray(elevated.sums)) {
    const targetDirs = new Set((elevated.targets || []).map((t) => t.dir.toLowerCase()));
    for (const s of elevated.sums) {
      if (targetDirs.has(s.dir.toLowerCase())) continue;
      const key = bucketOf(relParts(drive, s.dir) || []);
      addTo(key, s.allocated, s.files).elevatedBytes += s.allocated;
      elevatedBytes += s.allocated;
      if (s.denied > 0) stillRefused.set(rowOf(key), (stillRefused.get(rowOf(key)) || 0) + s.denied);
    }
    // A named target inside a refused folder is moved out of that folder's
    // row into its own; one the walk could already read was counted there.
    for (const target of elevated.targets || []) {
      const sum = elevated.sums.find((s) => s.dir.toLowerCase() === target.dir.toLowerCase());
      const container = walk.denied.find((d) => isUnder(target.dir, d));
      if (!sum || !container) continue;
      const from = bucketOf(relParts(drive, container) || []);
      if (from === target.key) continue;
      addTo(from, -sum.allocated, -sum.files);
      addTo(target.key, sum.allocated, sum.files).elevatedBytes += sum.allocated;
    }
  }

  const rows = new Map();
  const row = (key) => {
    if (!rows.has(key)) rows.set(key, { key, bytes: 0, files: 0, parts: [], source: 'walk' });
    return rows.get(key);
  };
  for (const [key, b] of buckets) {
    const r = row(rowOf(key));
    r.bytes += b.bytes;
    r.files += b.files;
    if (b.elevatedBytes > 0) r.source = 'elevated';
    if (key.includes(':')) r.parts.push({ name: key.slice(key.indexOf(':') + 1), bytes: b.bytes });
  }
  // A folder that was refused and holds nothing readable is still a row: it
  // is part of the drive the app could not see into.
  for (const key of elevated ? stillRefused.keys() : refusedRows.keys()) row(key);
  for (const r of rows.values()) {
    r.parts.sort((a, b) => b.bytes - a.bytes);
    r.refused = elevated ? stillRefused.get(r.key) || 0 : refusedRows.get(r.key) || 0;
  }

  // Files Windows holds open, sized from a folder listing.
  for (const name of ['hiberfil', 'pagefile', 'swapfile']) {
    const bytes = systemFiles && Number.isFinite(systemFiles[name]) ? systemFiles[name] : null;
    if (bytes !== null) Object.assign(row(name), { bytes, source: 'listing', path: `${drive}${name}.sys` });
  }

  // Recycle Bin: what is the app's, from its own record matched to the bin.
  if (rows.has('recycleBin')) rows.get('recycleBin').appBytes = Math.min(appInBin, rows.get('recycleBin').bytes);

  // What only Windows' own tools can see.
  const tools = { shadow: null, ntfs: null, reserve: null, dism: null };
  if (elevated) {
    tools.shadow = elevated.shadow ? elevated.shadow.state : null;
    tools.ntfs = elevated.ntfs ? elevated.ntfs.state : null;
    tools.reserve = elevated.reserve ? elevated.reserve.state : null;
    tools.dism = elevated.dism ? elevated.dism.state : null;

    const letter = drive.slice(0, 2);
    const onThisDrive = elevated.shadow && elevated.shadow.state === 'ok'
      ? elevated.shadow.associations.filter((a) => a.storageVolume === letter)
      : [];
    if (elevated.shadow && (elevated.shadow.state === 'ok' || elevated.shadow.state === 'none')) {
      Object.assign(row('restorePoints'), {
        // Allocated, not used: allocated is what the drive has given it.
        bytes: onThisDrive.reduce((n, a) => n + a.allocated, 0),
        used: onThisDrive.reduce((n, a) => n + a.used, 0),
        maximum: onThisDrive.reduce((n, a) => n + a.maximum, 0),
        source: 'tool',
      });
      // Restore points live in System Volume Information, which not even an
      // administrator may list; they are that folder's known contents.
      if (rows.has('systemHidden')) rows.get('systemHidden').explainedBy = 'restorePoints';
    }
    if (elevated.ntfs && elevated.ntfs.state === 'ok' && Number.isFinite(elevated.ntfs.mftBytes)) {
      Object.assign(row('ntfsMetadata'), { bytes: elevated.ntfs.mftBytes, source: 'tool' });
    }
    if (elevated.reserve && elevated.reserve.state === 'ok' && elevated.reserve.heldBack > 0) {
      Object.assign(row('reservedStorage'), { bytes: elevated.reserve.heldBack, source: 'tool' });
    }
    if (elevated.dism && elevated.dism.state === 'ok' && rows.has('winsxs')) {
      // The walk counts a file with several names once, wherever it met it
      // first, so its WinSxS figure depends on the order folders were read.
      // DISM's is the one that means something; the difference moves between
      // WinSxS and the rest of Windows, and the total is unchanged.
      const winsxs = rows.get('winsxs');
      const windows = row('windows');
      const shift = elevated.dism.actualSize - winsxs.bytes;
      if (shift > 0 && shift <= windows.bytes) {
        winsxs.bytes += shift;
        windows.bytes -= shift;
      }
      winsxs.dism = elevated.dism;
      winsxs.source = 'tool';
    }
  }

  // What only an administrator can measure is still a row before it is
  // measured: the screen says "needs administrator rights" rather than
  // quietly leaving it out, which would read as "there are none".
  const needs = (key, state) => Object.assign(row(key), { needsAdmin: true, toolState: state || null });
  if (!elevated) {
    needs('restorePoints');
    needs('ntfsMetadata');
    // Its folder belongs to a system account; the walk only reaches it when
    // it happens to be readable, and then it is already a measured row.
    if (!rows.has('deliveryOptimization')) needs('deliveryOptimization');
  } else {
    if (tools.shadow !== 'ok' && tools.shadow !== 'none') needs('restorePoints', tools.shadow);
    if (tools.ntfs !== 'ok') needs('ntfsMetadata', tools.ntfs);
  }
  for (const r of rows.values()) {
    if (!elevated && r.refused > 0 && r.bytes === 0) r.needsAdmin = true;
  }

  const list = [...rows.values()].filter((r) => r.bytes > 0 || r.refused > 0 || r.needsAdmin);
  const explained = list.reduce((n, r) => n + Math.max(0, r.bytes), 0);
  const unexplained = Math.max(0, volume.usedBytes - explained);

  const GROUPS = {
    profile: 'yours', profileSkipped: 'yours', otherFolders: 'yours', otherAccounts: 'yours', recycleBin: 'yours',
    programs: 'programs', programData: 'programs',
  };
  const groups = { yours: 0, programs: 0, windows: 0 };
  for (const r of list) {
    r.group = GROUPS[r.key] || 'windows';
    groups[r.group] += Math.max(0, r.bytes);
  }

  return {
    drive,
    profile: walk.profile || null,
    measuredAt: walk.at,
    volume,
    rows: list,
    groups: { ...groups, free: volume.freeBytes, unexplained },
    explainedBytes: explained,
    unexplainedBytes: unexplained,
    walk: {
      files: walk.files,
      dirs: walk.dirs,
      durationMs: walk.durationMs,
      refused: walk.deniedCount,
      refusedBeyondList,
      links: walk.links,
      hardlinkRepeats: walk.hardlinkRepeats,
      unreadableFiles: walk.unreadableFiles.length,
      cancelled: walk.cancelled,
    },
    elevated: elevated ? { at: elevated.at || Date.now(), addedBytes: elevatedBytes, tools, stillRefused: [...stillRefused.values()].reduce((n, v) => n + v, 0) } : null,
  };
}

module.exports = { walkDrive, build, elevatedRequest, makeBucketOf, rowOf, driveOf, profilePartsOn, relParts, DELIVERY_OPTIMIZATION };
