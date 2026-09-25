'use strict';

/**
 * The quarantine folder (B1): where a file goes when it leaves a full drive
 * but not the computer.
 *
 * The person picks a folder on another drive; the app makes `CleanDrive
 * Quarantine` inside it, with a README.txt that tells anybody who finds it in
 * Explorer what it is, and one folder per session:
 *
 *   D:\CleanDrive Quarantine\README.txt
 *   D:\CleanDrive Quarantine\s_8f2c01ab\000001.iso
 *   D:\CleanDrive Quarantine\s_8f2c01ab\manifest.jsonl
 *
 * Every name under it is the app's own -- the session id, a counter and the
 * original's extension -- and never one read out of a file. `manifest.jsonl`
 * says which original each copy is, beside the copies, so the drive explains
 * itself even without the computer it came from.
 *
 * A folder only counts as a zone when it is exactly that: a real folder (not
 * a link or junction), called `CleanDrive Quarantine`, with its README, on a
 * local drive, and outside anything a cloud service syncs.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const { isProtectedPath, isProgramInstallPath, pathKey } = require('./util');
const cloud = require('./media/cloud');

const ZONE_NAME = 'CleanDrive Quarantine';
const README = 'README.txt';
const MANIFEST = 'manifest.jsonl';

/** Left free on the other drive after a batch, so the app never fills it to the last byte. */
const MARGIN_BYTES = 1024 * 1024 * 1024;

const README_TEXT = [
  'CleanDrive Quarantine',
  '=====================',
  '',
  'CleanDrive moved these files here from another drive, to free space there.',
  'Each folder is one session. The files are named by a counter; which original',
  'each one is, and its SHA-256, is in that folder\'s manifest.jsonl.',
  '',
  'Nothing here is deleted by CleanDrive, however long it stays. To put files',
  'back where they came from, open CleanDrive > Restore. To get rid of them,',
  'delete them yourself.',
  '',
  '---',
  '',
  'CleanDrive đã chuyển các tệp này từ một ổ khác sang đây để giải phóng chỗ trên',
  'ổ đó. Mỗi thư mục là một lần chuyển. Tệp được đặt tên theo số thứ tự; tệp nào',
  'là bản của tệp gốc nào, cùng mã SHA-256 của nó, ghi trong manifest.jsonl.',
  '',
  'CleanDrive không bao giờ tự xoá gì ở đây, dù để bao lâu. Muốn đưa tệp về chỗ',
  'cũ: mở CleanDrive > Khôi phục. Muốn bỏ hẳn: tự xoá chúng.',
  '',
].join('\r\n');

const SESSION_ID = /^[sh]_[0-9a-f]{8}$/;

const exists = (p) => fsp.lstat(p).then(() => true, () => false);

/* -------------------------------------------------------------------------- */
/* the drive                                                                   */
/* -------------------------------------------------------------------------- */

function powershell() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * What kind of drive a root is -- `Fixed`, `Removable`, `Network`, `CDRom`,
 * `Ram`, `NoRootDirectory` -- as .NET's DriveInfo says it.
 *
 * Node has no way to ask. The script is fixed text; the root goes in on stdin
 * and must look like `D:\`. The answer is an enum name, the same in every
 * display language. Measured here: about half a second, no administrator.
 */
const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'while ($null -ne ($d = [Console]::In.ReadLine())) {',
  "  if ($d -match '^[A-Za-z]:\\\\$') {",
  '    $i = New-Object System.IO.DriveInfo $d',
  "    [Console]::Out.WriteLine($d + ' ' + $i.DriveType.ToString())",
  '  }',
  '}',
].join('\n');
const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

const typeCache = new Map();
const TYPE_TTL_MS = 60 * 1000;

function driveType(root) {
  if (process.platform !== 'win32' || !/^[A-Za-z]:\\$/.test(root)) return Promise.resolve('Unknown');
  const key = root.toUpperCase();
  const hit = typeCache.get(key);
  if (hit && Date.now() - hit.at < TYPE_TTL_MS) return Promise.resolve(hit.type);
  return new Promise((resolve) => {
    const child = execFile(
      powershell(),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        const m = err ? null : /^[A-Za-z]:\\ (\w+)\s*$/m.exec(String(stdout));
        const type = m ? m[1] : 'Unknown';
        if (m) typeCache.set(key, { type, at: Date.now() });
        resolve(type);
      }
    );
    child.stdin.on('error', () => {});
    child.stdin.end(`${key}\n`);
  });
}

/* -------------------------------------------------------------------------- */
/* the folder                                                                  */
/* -------------------------------------------------------------------------- */

/** Why a folder may not hold a zone, or null. */
function refusePlace(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return 'notAbsolute';
  if (/^\\\\/.test(dir)) return 'network';
  if (isProtectedPath(dir)) return 'system';
  if (isProgramInstallPath(dir)) return 'program';
  if (cloud.serviceForPath(dir)) return 'synced';
  return null;
}

/**
 * Make, or adopt, the zone under the folder somebody picked.
 *
 * Picking a folder called `CleanDrive Quarantine` means that folder; picking
 * anything else means a `CleanDrive Quarantine` inside it. The README is
 * written once and never overwritten.
 *
 * @returns {Promise<{ok: true, zone: string} | {ok: false, reason: string}>}
 */
async function prepare(picked, { driveTypeOf = driveType } = {}) {
  const refusal = refusePlace(picked);
  if (refusal) return { ok: false, reason: refusal };
  let real;
  try {
    real = await fsp.realpath(picked);
    if (!(await fsp.stat(real)).isDirectory()) return { ok: false, reason: 'notFolder' };
  } catch {
    return { ok: false, reason: 'missing' };
  }
  // Resolved through its links first: a folder that only looks like it is
  // elsewhere is judged by where it really is.
  const realRefusal = refusePlace(real);
  if (realRefusal) return { ok: false, reason: realRefusal };
  const type = await driveTypeOf(path.parse(real).root);
  if (type === 'Network') return { ok: false, reason: 'network' };
  if (type === 'CDRom') return { ok: false, reason: 'readOnly' };

  const zone = path.basename(real).toLowerCase() === ZONE_NAME.toLowerCase() ? real : path.join(real, ZONE_NAME);
  try {
    await fsp.mkdir(zone);
  } catch (err) {
    if (err.code !== 'EEXIST') return { ok: false, reason: 'cannotWrite' };
  }
  const st = await fsp.lstat(zone).catch(() => null);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return { ok: false, reason: 'notFolder' };
  try {
    await fsp.writeFile(path.join(zone, README), README_TEXT, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') return { ok: false, reason: 'cannotWrite' };
  }
  return { ok: true, zone };
}

/**
 * Whether the zone in the settings can take files now, and what it has room for.
 *
 * Asked before a batch is planned and again before its first copy, because
 * the dialog in between can sit open while the drive is pulled out.
 *
 * @returns {Promise<object>} `{ ok: true, zone, root, dev, freeBytes, totalBytes, type }`
 *   or `{ ok: false, reason, zone }` -- `none`, `unavailable` (the drive is not
 *   there), `missing` (it is, the folder is not), `notAZone`, `moved` (a link
 *   or junction now), or a `refusePlace` reason
 */
async function check(zone, { driveTypeOf = driveType, statfs = fsp.statfs } = {}) {
  if (!zone) return { ok: false, reason: 'none', zone: null };
  const refusal = refusePlace(zone);
  if (refusal) return { ok: false, reason: refusal, zone };
  const root = path.parse(zone).root;
  if (!(await exists(root))) return { ok: false, reason: 'unavailable', zone };

  let st;
  try {
    st = await fsp.lstat(zone);
  } catch {
    return { ok: false, reason: 'missing', zone };
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, reason: 'moved', zone };
  if (path.basename(zone).toLowerCase() !== ZONE_NAME.toLowerCase()) return { ok: false, reason: 'notAZone', zone };
  let real;
  try {
    real = await fsp.realpath(zone);
  } catch {
    return { ok: false, reason: 'missing', zone };
  }
  // A folder on the way there that became a junction moves the zone
  // somewhere nobody chose.
  if (pathKey(real) !== pathKey(zone)) return { ok: false, reason: 'moved', zone };
  if (!(await exists(path.join(zone, README)))) return { ok: false, reason: 'notAZone', zone };

  const type = await driveTypeOf(root);
  if (type === 'Network') return { ok: false, reason: 'network', zone };

  let freeBytes = 0;
  let totalBytes = 0;
  try {
    const fsStat = await statfs(zone);
    freeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
    totalBytes = Number(fsStat.blocks) * Number(fsStat.bsize);
  } catch {
    return { ok: false, reason: 'unavailable', zone };
  }
  const dev = String((await fsp.stat(zone, { bigint: true })).dev);
  return { ok: true, zone, root, dev, freeBytes, totalBytes, type };
}

/**
 * A copy is written under this suffix and renamed only once it has been read
 * back and matched. Measured on a virtual disk pulled out part way through a
 * copy: the half-written file was still on it when it came back. Under this
 * name it cannot be mistaken for a copy, and is the app's own to remove.
 */
const PARTIAL = '.partial';

/**
 * Remove copies a batch never finished -- a drive pulled out, a crash. Only
 * `*.partial` files inside session folders, which were never anybody's only
 * copy: their originals were not touched.
 *
 * @returns {Promise<number>} how many were removed
 */
async function sweepPartials(zone) {
  let removed = 0;
  let sessions = [];
  try {
    sessions = await fsp.readdir(zone, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of sessions) {
    if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue;
    const dir = path.join(zone, entry.name);
    let names = [];
    try {
      names = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of names) {
      if (!file.isFile() || !file.name.endsWith(PARTIAL)) continue;
      try {
        await fsp.rm(path.join(dir, file.name));
        removed += 1;
      } catch {
        // In use by the batch writing it, or already gone.
      }
    }
  }
  return removed;
}

/** What the zone holds: its sessions' copies, not their manifests, the README or unfinished copies. */
async function usage(zone) {
  let bytes = 0;
  let files = 0;
  let sessions = [];
  try {
    sessions = await fsp.readdir(zone, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }
  for (const entry of sessions) {
    if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue;
    let names = [];
    try {
      names = await fsp.readdir(path.join(zone, entry.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of names) {
      if (!file.isFile() || file.name === MANIFEST || file.name.endsWith(PARTIAL)) continue;
      try {
        bytes += (await fsp.stat(path.join(zone, entry.name, file.name))).size;
        files += 1;
      } catch {
        // Gone between the listing and the stat: somebody is tidying up.
      }
    }
  }
  return { bytes, files };
}

/* -------------------------------------------------------------------------- */
/* names                                                                       */
/* -------------------------------------------------------------------------- */

function sessionDir(zone, sessionId) {
  if (!SESSION_ID.test(sessionId)) throw new Error(`quarantine: "${sessionId}" is not a session id`);
  return path.join(zone, sessionId);
}

/**
 * `000001.iso`: a counter, and the original's extension when it is a plain
 * one. The extension is kept so the copy still opens with the right program
 * from Explorer; anything odd about it is dropped rather than carried over.
 */
function storedName(n, source) {
  const ext = path.extname(path.basename(String(source))).toLowerCase();
  return `${String(n).padStart(6, '0')}${/^\.[a-z0-9]{1,12}$/.test(ext) ? ext : ''}`;
}

/** True when `p` is inside `zone`. */
function inside(zone, p) {
  if (!zone) return false;
  const z = pathKey(zone);
  const k = pathKey(p);
  return k === z || k.startsWith(z + path.sep);
}

/** One line of the session's manifest: which original a copy is. */
async function appendManifest(dir, entry) {
  await fsp.appendFile(path.join(dir, MANIFEST), `${JSON.stringify(entry)}\n`, 'utf8');
}

module.exports = {
  ZONE_NAME,
  README,
  README_TEXT,
  MANIFEST,
  MARGIN_BYTES,
  SESSION_ID,
  PARTIAL,
  sweepPartials,
  SCRIPT,
  powershell,
  driveType,
  refusePlace,
  prepare,
  check,
  usage,
  sessionDir,
  storedName,
  inside,
  appendManifest,
};
