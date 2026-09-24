'use strict';

/**
 * The filesystem as it is, rather than as it is first described.
 *
 * Two things give a walk of a Windows disk the wrong picture, and both were
 * found by measuring a real system drive, not by reading documentation.
 *
 * ## Electron's `.asar`
 *
 * Electron patches Node's `fs` so that an `.asar` archive -- the single file
 * most Electron apps ship their code in -- reads as a folder. That is how an
 * app loads its own code, and it is wrong for anything that measures a disk.
 * Inside Electron, `lstat` on a 125 MB `resources\app.asar` said *a directory,
 * 0 bytes*, with no block count. The scanner skipped every `.asar` it met (it
 * was "not a file"), and a walk that summed allocation got `NaN` from Zalo's,
 * VS Code's, Cursor's and Postman's.
 *
 * `original-fs` is the unpatched module Electron keeps for exactly this. Under
 * plain Node -- the unit harnesses -- it does not exist, and `node:fs` is
 * already the real thing.
 *
 * ## Reparse points that are not links
 *
 * `readdir` marks *every* reparse point as a symbolic link, but only two kinds
 * are links: symbolic links and junctions. OneDrive's folder is a reparse point
 * of another kind -- the cloud provider's sync root -- and so are Phone Link's
 * `CrossDevice` folders and `INetCache\Content.IE5`. A walk that trusted the
 * directory entry skipped all of them. On the machine this was written on that
 * meant the whole of OneDrive, which is where Windows had put Documents,
 * Pictures and the Desktop: a scan of the home folder left them out, and a
 * breakdown of the drive came up about 15 GB short.
 *
 * `lstat` asks the file itself, and libuv reports only symlinks and junctions
 * as links. So `entryKind` checks with `lstat` whenever the entry says "link":
 * `C:\Users\<name>\Application Data` still comes back a link (a junction to
 * `AppData\Roaming`, which a walk must not enter twice), and `OneDrive` comes
 * back a folder.
 */

let real;
try {
  // eslint-disable-next-line global-require
  real = require('original-fs');
} catch {
  // eslint-disable-next-line global-require
  real = require('node:fs');
}

/**
 * What a directory entry really is.
 *
 * @param {import('fs').Dirent} entry
 * @param {string} fullPath
 * @returns {Promise<'dir'|'file'|'link'|'other'>}  `other` for sockets, devices and
 *   entries that vanished or refused a look
 */
async function entryKind(entry, fullPath) {
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return 'file';
  if (!entry.isSymbolicLink()) return 'other';
  let stats;
  try {
    stats = await real.promises.lstat(fullPath);
  } catch {
    return 'other';
  }
  if (stats.isSymbolicLink()) return 'link';
  if (stats.isDirectory()) return 'dir';
  if (stats.isFile()) return 'file';
  return 'other';
}

module.exports = { fs: real, fsp: real.promises, entryKind };
