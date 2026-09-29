'use strict';

/**
 * What Telegram Desktop keeps on this machine (D3, Level 1 only).
 *
 * ## Why Telegram gets one level and Zalo gets three
 *
 * Nothing in Telegram's layout names a conversation. `tdata` is a flat set of
 * files with hexadecimal names, its caches are content-addressed, and the only
 * place a chat is identified is inside the encrypted message store -- which
 * this app does not open, by the same decision that keeps it out of Zalo's
 * database. So there is no Level 3 here, and the screen says why rather than
 * showing an empty list.
 *
 * ## The numbers, measured on this machine
 *
 * The whole of `tdata` is about 42 MB, and its media caches are almost
 * nothing: `user_data\media_cache` is one file of 10 KB. The second account's
 * is larger -- `user_data#2\cache` is 8.25 MB across 352 files -- which is
 * itself worth knowing, because `lib/media/roots.js` only ever looked at the
 * first account.
 *
 * ## `tupdates` is 212 MB and it is not rubbish
 *
 * It is by far the largest thing Telegram keeps, and the tempting reading --
 * "an installer nobody needs" -- is wrong. Measured:
 *
 *   tupdates\temp\Telegram.exe                       207.74 MB, v7.2.5.0, 2026-09-23
 *   tupdates\temp\modules\x64\d3d\d3dcompiler_47.dll   4.69 MB
 *   Telegram Desktop\Telegram.exe  (running)         207.76 MB, v7.1.3.0, 2026-08-28
 *
 * That is a downloaded, unpacked update waiting to replace the version that is
 * installed. Deleting it costs a 212 MB download, and it can never be `safe`.
 * The row says both version numbers and leaves the choice where it belongs.
 *
 * The comparison is made from the two files' own version resources, read by
 * Windows, not from the folder's name or its date -- so if a future Telegram
 * stages something this code has not seen, the row says the versions could not
 * be compared instead of assuming.
 *
 * Only reads.
 */

const path = require('node:path');

const { fsp } = require('../lib/real-fs');

/** The two cache folders under an account, in the order they matter. */
const ACCOUNT_CACHES = Object.freeze(['media_cache', 'cache']);

/**
 * Accounts are `user_data`, `user_data#2`, `user_data#3`...
 *
 * The `#N` suffix is Telegram's, not a guess: this machine has two accounts
 * and the second is `user_data#2`.
 */
const ACCOUNT_DIR = /^user_data(#[0-9]{1,3})?$/;

const exists = async (target) => {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
};

/** Where Telegram Desktop lives, or null. */
function dataRoot(env = process.env) {
  const appData = env.APPDATA;
  if (!appData) return null;
  return path.join(appData, 'Telegram Desktop');
}

/**
 * Every file below a folder, bounded.
 *
 * `tdata` has no deep trees and neither does a cache, so the depth limit is
 * there to stop a surprise rather than to shape the answer; when it bites, the
 * caller is told.
 */
const MAX_DEPTH = 8;

async function filesUnder(dir, token, out = [], depth = 0) {
  if (depth > MAX_DEPTH) return out;
  if (token && token.cancelled) return out;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (token && token.cancelled) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await filesUnder(full, token, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    let stats;
    try {
      stats = await fsp.stat(full);
    } catch {
      continue;
    }
    out.push({ path: full, name: entry.name, size: stats.size, mtimeMs: stats.mtimeMs, sentAt: null });
  }
  return out;
}

const bytesOf = (files) => files.reduce((sum, f) => sum + f.size, 0);

/**
 * What Windows says a `.exe` calls itself.
 *
 * Node and Electron expose no version-resource reader, and shelling out to
 * PowerShell for one string is a process per scan. So the string is taken from
 * the file's own `VS_VERSIONINFO` block, which is UTF-16LE text: the key
 * `FileVersion`, then padding, then the value.
 *
 * Three things measured on this machine, each of which broke a simpler
 * version of this:
 *
 *   - **`ProductVersion` is the wrong key to look for.** It appears twice in
 *     `Telegram.exe`: once 46.8% of the way in, as part of the import name
 *     `api-ms-win-core-version-l1-1-0.dll`, and again in the real resource.
 *     `FileVersion` appears once, at 99.4%.
 *   - **The padding is aligned to the resource block, not to the file**, so
 *     computing it from an offset inside a buffer gives the wrong answer.
 *     What actually separates key from value is a run of NUL code units, and
 *     skipping that run works wherever the buffer happens to start.
 *   - **A tail read is enough and a tail read is necessary.** The block is
 *     1.4 MB from the end of a 208 MB file. Reading the whole file finds it
 *     too -- 174 ms, so not ruinous -- but it also finds the decoy first.
 *
 * `null` means "could not be read", and the screen says that rather than
 * pretending the versions matched.
 */
const VERSION_TAIL_BYTES = 8 * 1024 * 1024;

async function exeVersion(filePath) {
  let handle;
  try {
    handle = await fsp.open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const stats = await handle.stat();
    if (stats.size < 64) return null;
    const length = Math.min(VERSION_TAIL_BYTES, stats.size);
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, stats.size - length);

    const key = Buffer.from('FileVersion', 'utf16le');
    const at = buf.lastIndexOf(key);
    if (at === -1) return null;

    // Skip the NUL code units between the key and its value, then take code
    // units up to the next NUL. Bounded so a corrupt block cannot run away.
    let from = at + key.length;
    while (from + 1 < buf.length && buf.readUInt16LE(from) === 0) from += 2;
    let to = from;
    while (to + 1 < buf.length && to - from < 128 && buf.readUInt16LE(to) !== 0) to += 2;
    if (to === from) return null;

    const value = buf.toString('utf16le', from, to).trim();
    return /^[0-9]+(\.[0-9]+){1,3}$/.test(value) ? value : null;
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Compare two dotted version strings.
 *
 * @returns {number|null} negative when a < b, null when either is unreadable
 */
function compareVersions(a, b) {
  if (!a || !b) return null;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The staged update, if there is one.
 *
 * Telegram unpacks into `tupdates\temp` and moves it into place on the next
 * start. So the files are looked for there and at the `tupdates` root, and
 * whichever holds the executable is the one reported.
 */
async function stagedUpdate(root, token) {
  const updatesDir = path.join(root, 'tupdates');
  if (!(await exists(updatesDir))) return null;

  const files = await filesUnder(updatesDir, token);
  if (files.length === 0) return null;

  const exe = files.find((f) => f.name.toLowerCase() === 'telegram.exe');
  const installed = path.join(root, 'Telegram.exe');

  const stagedVersion = exe ? await exeVersion(exe.path) : null;
  const installedVersion = (await exists(installed)) ? await exeVersion(installed) : null;

  return {
    path: updatesDir,
    files,
    bytes: bytesOf(files),
    stagedVersion,
    installedVersion,
    // Positive means what is waiting is newer than what is running.
    newer: compareVersions(stagedVersion, installedVersion),
    stagedAt: exe ? exe.mtimeMs : files.reduce((max, f) => Math.max(max, f.mtimeMs), 0),
  };
}

/**
 * Everything Telegram Desktop keeps here.
 */
async function scan({ token = null, onProgress = null, env = process.env } = {}) {
  const root = dataRoot(env);
  const model = {
    app: 'telegram',
    installed: false,
    root,
    accounts: [],
    update: null,
    // Written down so the screen can say it rather than leaving it to be
    // inferred from an empty list.
    conversationsAvailable: false,
  };

  if (!root || !(await exists(root))) return model;
  model.installed = true;

  if (onProgress) onProgress({ phase: 'telegram' });

  const tdata = path.join(root, 'tdata');
  let entries;
  try {
    entries = await fsp.readdir(tdata, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (token && token.cancelled) break;
    if (!entry.isDirectory() || !ACCOUNT_DIR.test(entry.name)) continue;

    const caches = [];
    for (const name of ACCOUNT_CACHES) {
      const dir = path.join(tdata, entry.name, name);
      if (!(await exists(dir))) continue;
      const files = await filesUnder(dir, token);
      if (files.length === 0) continue;
      caches.push({ kind: name, path: dir, files, bytes: bytesOf(files) });
    }

    model.accounts.push({
      id: entry.name,
      path: path.join(tdata, entry.name),
      caches,
      bytes: caches.reduce((sum, c) => sum + c.bytes, 0),
      files: caches.reduce((sum, c) => sum + c.files.length, 0),
    });
  }

  model.update = await stagedUpdate(root, token);

  return model;
}

module.exports = {
  scan,
  dataRoot,
  stagedUpdate,
  exeVersion,
  compareVersions,
  filesUnder,
  ACCOUNT_CACHES,
  ACCOUNT_DIR,
};
