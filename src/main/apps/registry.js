'use strict';

/**
 * The installed-programs list, read out of the registry.
 *
 * Windows keeps it in three Uninstall keys -- machine-wide, machine-wide for
 * 32-bit programs, and per user -- and every installer writes what it feels
 * like into them. So this file does two things and nothing else: run
 * `reg.exe export` on each of the three, and turn the `.reg` file it writes
 * into records. Deciding what any of it means is `inventory.js`.
 *
 * Why `export` and not `reg query /s`:
 *
 *   - `query` prints to the console, in the console's code page. A program
 *     called "Bánh Mì Bách Khoa" (there is one on the machine this was
 *     written on) comes back mangled, the same way `attrib.exe` mangles
 *     Vietnamese file names in cloud-state.js. `export` writes UTF-16LE to a
 *     file and nothing is lost.
 *   - `export` is also one process for a whole hive: 112 ms for the 277 keys
 *     under HKLM here, against a `query` per key.
 *
 * Measured on this machine, 2026-09-26: HKLM 277 keys / 453 KB in 112 ms,
 * WOW6432Node 339 / 450 KB in 100 ms, HKCU 23 / 18 KB in 43 ms.
 *
 * Only reads. The one thing it writes is its own `.reg` file in a scratch
 * folder it makes and removes.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

/** By absolute path, never through PATH -- the rule the helper is built on. */
const REG = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');

const HIVES = Object.freeze([
  { hive: 'HKLM', key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'WOW6432Node', key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKCU', key: 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
]);

/** Where UserAssist keeps what was launched from Explorer and the Start menu. */
const USERASSIST = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist';

/** A hive bigger than this is not something this app was built to read. */
const MAX_EXPORT = 16 * 1024 * 1024;

/**
 * A `.reg` file, as `{ 'KEY\\PATH': { valueName: value } }`.
 *
 * Three value forms appear in one of these files, and the third is the one
 * that catches people out:
 *
 *   "Name"="text"                 a string, with \\ and \" escaped
 *   "Name"=dword:0000002a         a number, hex
 *   "Name"=hex(2):43,00,3a,00,…   UTF-16LE bytes, one line per 25 of them,
 *                                 continued wherever a line ends in a
 *                                 backslash
 *
 * `reg export` uses the third form for a REG_EXPAND_SZ and for any string it
 * would otherwise have to escape heavily. Two entries here (Gpg4win and
 * GnuPG) keep their `InstallLocation` that way, and a parser that only reads
 * the quoted form -- which is what `lib/context-menu.js` needs and has --
 * loses them without saying so. So hex(1) and hex(2) are decoded as UTF-16LE
 * and become strings like any other; every other hex type stays a Buffer,
 * because UserAssist's records are binary and are read byte by byte.
 */
function parseRegFile(text) {
  const keys = {};
  let current = null;
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    const header = /^\[(.+)\]$/.exec(line.trim());
    if (header) {
      current = {};
      keys[header[1]] = current;
      continue;
    }
    if (!current) continue;

    // A hex value runs on for as many lines as it needs, each but the last
    // ending in a backslash. Joined before anything is matched, so a value is
    // always looked at whole.
    while (/\\$/.test(line) && i + 1 < lines.length) line = `${line.slice(0, -1)}${lines[++i].trim()}`;

    const name = /^"((?:[^"\\]|\\.)*)"=/.exec(line);
    if (!name) continue;
    const label = name[1].replace(/\\(.)/g, '$1');
    const rest = line.slice(name[0].length);

    const asString = /^"((?:[^"\\]|\\.)*)"$/.exec(rest);
    if (asString) {
      current[label] = asString[1].replace(/\\(.)/g, '$1');
      continue;
    }

    const asDword = /^dword:([0-9a-fA-F]+)$/.exec(rest);
    if (asDword) {
      current[label] = parseInt(asDword[1], 16);
      continue;
    }

    const asHex = /^hex(?:\(([0-9a-fA-F]+)\))?:(.*)$/.exec(rest);
    if (asHex) {
      const type = asHex[1] ? parseInt(asHex[1], 16) : 3;
      const bytes = [];
      for (const part of asHex[2].split(',')) {
        const byte = part.trim();
        if (/^[0-9a-fA-F]{1,2}$/.test(byte)) bytes.push(parseInt(byte, 16));
      }
      const buffer = Buffer.from(bytes);
      // 1 = REG_SZ, 2 = REG_EXPAND_SZ. Both are UTF-16LE with a trailing NUL.
      current[label] = type === 1 || type === 2 ? buffer.toString('utf16le').replace(/\0+$/, '') : buffer;
    }
  }

  return keys;
}

function runReg(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile(REG(), args, { windowsHide: true, timeout: timeoutMs }, (err) => resolve(!err));
  });
}

/** A scratch folder of this process's own, removed when the read is done. */
async function scratch() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-reg-'));
}

/**
 * One registry key and everything under it.
 *
 * A key that is not there is not an error: HKCU's Uninstall key does not
 * exist on a fresh account, and neither does UserAssist.
 *
 * @returns {Promise<object|null>} null when the key could not be exported
 */
async function exportKey(key, deps = {}) {
  const run = deps.run || runReg;
  const dir = await (deps.scratch || scratch)();
  const file = path.join(dir, 'export.reg');
  try {
    if (!(await run(['export', key, file, '/y']))) return null;
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat || stat.size > MAX_EXPORT) return null;
    return parseRegFile((await fsp.readFile(file)).toString('utf16le'));
  } catch {
    return null;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Every Uninstall entry in the three hives, as they are written.
 *
 * Nothing is filtered here -- a `SystemComponent` entry and a Windows update
 * come back like anything else, because whether to show them is a decision
 * with reasons, and those live in `inventory.js`.
 *
 * @returns {Promise<{entries: object[], hives: object[]}>}
 */
async function readUninstallEntries(deps = {}) {
  const entries = [];
  const hives = [];

  for (const { hive, key } of HIVES) {
    const started = Date.now();
    const keys = await exportKey(key, deps);
    if (!keys) {
      hives.push({ hive, ok: false, count: 0, ms: Date.now() - started });
      continue;
    }
    let count = 0;
    for (const [keyPath, values] of Object.entries(keys)) {
      // The hive's own key carries no program.
      if (keyPath.toLowerCase() === key.toLowerCase()) continue;
      const id = keyPath.slice(keyPath.lastIndexOf('\\') + 1);
      // Only the entries directly under the hive: an installer that keeps its
      // own subkeys below one is describing one program, not several.
      if (keyPath.slice(0, keyPath.lastIndexOf('\\')).toLowerCase() !== key.toLowerCase()) continue;
      count++;
      entries.push({ hive, id, keyPath, values });
    }
    hives.push({ hive, ok: true, count, ms: Date.now() - started });
  }

  return { entries, hives };
}

module.exports = { parseRegFile, exportKey, readUninstallEntries, HIVES, USERASSIST, REG };
