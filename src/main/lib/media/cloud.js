'use strict';

/**
 * Files that are synchronised somewhere else, and files that are not really
 * here at all.
 *
 * ## Two different problems, and only one of them is obvious
 *
 * The obvious one is **deleting**. A file inside a OneDrive or Dropbox folder
 * exists on every device that syncs it, and moving it to this machine's Recycle
 * Bin tells the service to delete it everywhere. The local Recycle Bin then
 * holds the only copy this machine has, and restoring from it does not put the
 * file back on the phone. Everywhere else in this app "it goes to the Recycle
 * Bin" is the whole safety story; here it is not, and the confirmation has to
 * say so.
 *
 * The less obvious one is **reading**. With Files On-Demand switched on, a file
 * in a cloud folder may be a placeholder: it has a name, a size and a date, and
 * none of its contents. Opening it and reading a single byte makes Windows
 * fetch the whole thing. A scan that reads the first 64 KB of every photo in a
 * synced Pictures folder would therefore download the entire folder -- filling
 * the disk this app exists to keep free, on a metered connection, without
 * anybody asking for it. That is the worst thing this subsystem could do, and
 * it would look exactly like the app working.
 *
 * ## Why the folders are not simply excluded
 *
 * Because on the machine this was written on, that would exclude everything.
 * `Pictures` resolves to `C:\Users\<name>\OneDrive\Hình ảnh` and `Documents` to
 * `C:\Users\<name>\OneDrive\Documents` -- Windows redirects the known folders
 * into OneDrive by default and most people never change it. "Skip cloud
 * folders" reads as caution and delivers an empty screen.
 *
 * So cloud files are scanned, shown, and marked; the danger is handled where it
 * actually lives, in the confirmation before a delete and in the decision not
 * to read a placeholder's bytes.
 *
 * Nothing here requires Electron: it runs in the worker threads too.
 */

const path = require('node:path');
const os = require('node:os');

const IS_WIN = process.platform === 'win32';

/**
 * Folder names that mean "this is a sync root", matched as a whole path
 * segment.
 *
 * Environment variables are consulted first and are far more reliable --
 * OneDrive sets three of them -- but they only cover OneDrive, and only for the
 * account the app is running as. The names below catch the rest, and catch a
 * second OneDrive folder from a different tenant that the variables do not
 * name.
 *
 * `OneDrive - Contoso` is what a work account produces, so the match is by
 * prefix for that one family rather than by equality.
 */
const SYNC_FOLDER_NAMES = [
  { match: /^onedrive$/i, service: 'OneDrive' },
  { match: /^onedrive - /i, service: 'OneDrive' },
  { match: /^dropbox$/i, service: 'Dropbox' },
  { match: /^dropbox \(.+\)$/i, service: 'Dropbox' },
  { match: /^google ?drive$/i, service: 'Google Drive' },
  { match: /^my drive$/i, service: 'Google Drive' },
  { match: /^icloud ?drive$/i, service: 'iCloud' },
  { match: /^icloudphotos$/i, service: 'iCloud' },
  { match: /^box$/i, service: 'Box' },
  { match: /^box sync$/i, service: 'Box' },
  { match: /^pclouddrive$/i, service: 'pCloud' },
  { match: /^mega$/i, service: 'MEGA' },
  { match: /^nextcloud$/i, service: 'Nextcloud' },
  { match: /^owncloud$/i, service: 'ownCloud' },
  { match: /^sync$/i, service: 'Resilio Sync' },
  { match: /^yandexdisk$/i, service: 'Yandex Disk' },
];

/** Environment variables that name a sync root outright. */
const SYNC_ENV_VARS = [
  ['OneDrive', 'OneDrive'],
  ['OneDriveConsumer', 'OneDrive'],
  ['OneDriveCommercial', 'OneDrive'],
];

function normalise(p) {
  const resolved = path.resolve(p);
  return IS_WIN ? resolved.toLowerCase() : resolved;
}

/**
 * Every sync root this machine can be seen to have.
 *
 * Computed once. A folder that appears after the app started is caught by the
 * name test instead, so this is an optimisation rather than the whole answer.
 *
 * @returns {Array<{root: string, key: string, service: string}>}
 */
function syncRoots() {
  const out = [];
  const seen = new Set();

  const add = (root, service) => {
    if (!root) return;
    const key = normalise(root);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ root: path.resolve(root), key, service });
  };

  for (const [variable, service] of SYNC_ENV_VARS) {
    add(process.env[variable], service);
  }

  // The common layout is a sync folder directly inside the profile. Reading the
  // home directory's entries would be a syscall on a hot path, so the names are
  // matched against paths as they arrive instead -- see `serviceForPath`.
  return out;
}

let cachedRoots = null;
function roots() {
  if (!cachedRoots) cachedRoots = syncRoots();
  return cachedRoots;
}

/** Forget the cached roots. Only the tests need this. */
function reset() {
  cachedRoots = null;
}

/**
 * Which sync service, if any, a path belongs to.
 *
 * Every segment is tested rather than only the ones under the home directory:
 * a sync folder can sit anywhere, and on a machine with two profile trees --
 * `C:\Users\x` and `D:\Users\x`, which this one has -- anchoring to `%USERPROFILE%`
 * finds the first and misses the second. The same reasoning as
 * `isRoamingAppData` in `util.js`.
 *
 * @returns {string|null} the service's name, for showing to the user
 */
function serviceForPath(filePath) {
  if (typeof filePath !== 'string' || filePath === '') return null;

  const key = normalise(filePath);
  for (const entry of roots()) {
    if (key === entry.key || key.startsWith(entry.key + path.sep)) return entry.service;
  }

  for (const segment of filePath.split(/[\\/]/)) {
    if (!segment) continue;
    for (const { match, service } of SYNC_FOLDER_NAMES) {
      if (match.test(segment)) return service;
    }
  }

  return null;
}

/** True when this path is inside any sync folder. */
function isSynced(filePath) {
  return serviceForPath(filePath) !== null;
}

/* -------------------------------------------------------------------------- */
/* placeholders                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A file whose bytes are not on this disk.
 *
 * Windows exposes this as a file attribute (`FILE_ATTRIBUTE_RECALL_ON_OPEN` and
 * friends) and Node does not surface file attributes at all, so the test has to
 * be made out of what `fs.Stats` does carry. What it carries is `blocks`, the
 * number of 512-byte units actually allocated -- and a placeholder has a full
 * `size` with nothing allocated behind it.
 *
 * Two things stop that being the whole rule:
 *
 *   - NTFS stores a small file's contents inside its MFT record, so a file
 *     under roughly 700 bytes legitimately reports zero blocks. Verified on
 *     this machine: a 96-byte `desktop.ini` and a 63-byte marker file both
 *     report `blocks: 0`, while a 1,164-byte shortcut reports 8. The size floor
 *     below keeps those out.
 *   - A sparse file reports fewer blocks than its size too. Media files are
 *     essentially never sparse, and the consequence of a false positive here is
 *     only that one file goes unread rather than that anything is deleted.
 *
 * Confirmed against real placeholders rather than reasoned about. A scan of
 * 13,762 media files on the development machine flagged exactly two, both
 * inside OneDrive, and Windows reports their attributes as `0x401620` --
 * `ARCHIVE | SPARSE_FILE | REPARSE_POINT | OFFLINE | RECALL_ON_DATA_ACCESS`.
 * `RECALL_ON_DATA_ACCESS` is the flag that means "reading this fetches it".
 * Every other file in the same tree reported plain `Archive` and a block count
 * matching its size, so there were no false positives in that run.
 *
 * The rule still errs deliberately towards refusing to read: a file wrongly
 * called a placeholder is listed with less detail, while a placeholder wrongly
 * read is a download nobody asked for.
 */
const RESIDENT_LIMIT = 8 * 1024;

function looksDehydrated(stats) {
  if (!IS_WIN || !stats) return false;
  if (!Number.isFinite(stats.size) || stats.size <= RESIDENT_LIMIT) return false;
  // `blocks` is not populated on every filesystem. Undefined means "no
  // evidence", which must not be read as "no bytes".
  if (!Number.isFinite(stats.blocks)) return false;
  return stats.blocks * 512 < stats.size / 4;
}

/**
 * Whether it is safe to read this file's contents during a scan.
 *
 * The answer is no only for a placeholder, and only because reading one
 * downloads it. A synced file that is actually present is read like any other
 * -- being in OneDrive is not in itself a reason to know less about a file.
 */
function mayReadContents(filePath, stats) {
  return !looksDehydrated(stats);
}

module.exports = {
  syncRoots,
  roots,
  reset,
  serviceForPath,
  isSynced,
  looksDehydrated,
  mayReadContents,
  SYNC_FOLDER_NAMES,
  RESIDENT_LIMIT,
};
