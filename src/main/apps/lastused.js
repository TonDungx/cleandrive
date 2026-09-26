'use strict';

/**
 * When a program was last started, from the records Windows keeps.
 *
 * The roadmap ranks three sources and says to rank them, never to add them up.
 * Two survived being measured on the machine this was written on; the third
 * did not, and the reason is written down here because it is the kind of thing
 * that gets re-added by somebody who has not measured it.
 *
 *   1  Prefetch        C:\Windows\Prefetch, one .pf per program. Refused to a
 *                      normal process (EPERM, measured), so it arrives through
 *                      the elevated helper's `prefetch.list` and only when the
 *                      person presses the button that asks for it.
 *   2  UserAssist      HKCU, what Explorer and the Start menu launched. Free,
 *                      instant, and per user.
 *   3  ~~the exe's last-access time~~  DROPPED, see below.
 *
 * **Why last-access time is not used.** NTFS on this machine records it
 * (`DisableLastAccess = 2`, System Managed, updates enabled), so the check in
 * `lib/util.js` says the dates are real -- and they are, they just do not mean
 * "you opened this". Measured 2026-09-26: of 400 binaries under
 * `C:\Program Files`, 281 had been read in the previous seven days, while
 * UserAssist had records of 94 programs being launched in four months. Of 30
 * executables that could be matched to an actual launch, all 30 had a
 * last-access time newer than their launch and only 5 were within a week of
 * it; MobaXterm was last started on 24 August and its last-access time said
 * today. A size-only walk does not cause this -- measured, 0 of 8 binaries
 * moved when `system/walk.js` read the folder -- but anything that opens the
 * file does, and on a Windows machine that is the antivirus, the search
 * indexer and the backup. Reporting it as "last used" would tell somebody
 * their four-month-old program was used last Tuesday.
 *
 * So an app with no record here is not called unused. It is called "no record
 * of it being started", with what was searched and how far back it goes.
 *
 * Only reads.
 */

const path = require('node:path');

const { exportKey, USERASSIST } = require('./registry');

/**
 * UserAssist stores value names in ROT13. There is no security in that and
 * Microsoft has never said why; it is simply the format.
 */
function rot13(text) {
  return String(text).replace(/[A-Za-z]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code < 97 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

/** A Windows FILETIME at `offset`, as a JS timestamp, or null when unset. */
function filetimeAt(buffer, offset) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + 8) return null;
  const value = buffer.readUInt32LE(offset + 4) * 4294967296 + buffer.readUInt32LE(offset);
  if (value === 0) return null;
  const ms = value / 10000 - 11644473600000;
  // A clock that has been wound forward writes dates that have not happened.
  if (!Number.isFinite(ms) || ms <= 0 || ms > Date.now() + 86400000) return null;
  return ms;
}

/**
 * The record Windows 7 and later write: 72 bytes, with the number of runs at
 * offset 4 and the last run at offset 60. Measured here: 529 values of 72
 * bytes and 8 of 1612 (a different, older format that is skipped).
 */
const RECORD_BYTES = 72;
const RUN_COUNT_AT = 4;
const LAST_RUN_AT = 60;

/**
 * The folder ids UserAssist puts in front of a path instead of the path.
 *
 * Only the ones seen on a real machine are resolved; an id that is not in
 * here leaves the entry with its name and no path, which costs it confidence
 * rather than inventing a location for it.
 */
const KNOWN_FOLDERS = Object.freeze({
  '1AC14E77-02E7-4E5D-B744-2EB1AE5198B7': () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
  'D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27': () => path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64'),
  'F38BF404-1D43-42F2-9305-67DE0B28FC23': () => process.env.SystemRoot || 'C:\\Windows',
  '6D809377-6AF0-444B-8957-A3773F02200E': () => process.env.ProgramW6432 || 'C:\\Program Files',
  '905E63B6-C1BF-494E-B29C-65B732D3D21A': () => process.env.ProgramFiles || 'C:\\Program Files',
  '7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E': () => process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'F7F1ED05-9F6D-47A2-AAAE-29D317C6F066': () => path.join(process.env.ProgramW6432 || 'C:\\Program Files', 'Common Files'),
  '1E87508D-89C2-42F0-8A7E-645A0F50CA58': () => process.env.ProgramData || 'C:\\ProgramData',
  'B4BFCC3A-DB2C-424C-B029-7FE99A87C641': () => path.join(process.env.USERPROFILE || '', 'Desktop'),
  'F1B32785-6FBA-4FCF-9D55-7B8E7F157091': () => process.env.LOCALAPPDATA || '',
  '3EB685DB-65F9-4CF6-A03A-E3EF65729F3D': () => process.env.APPDATA || '',
});

/**
 * One UserAssist entry's name, turned into a path where that is possible.
 *
 * Three shapes appear, measured over 94 dated executables here: 67 with a
 * folder id in front (`{6D809377-…}\Git\git-gui.exe`), 27 already absolute
 * (`D:\ToWRR\ToW.exe`), and none with anything else. A name that is neither
 * -- `Microsoft.Office.WINWORD.EXE.15`, which is how Office registers itself
 * -- keeps its name and gets no path.
 */
function resolveEntryPath(name) {
  const prefixed = /^\{([0-9A-Fa-f-]{36})\}\\(.+)$/.exec(name);
  if (prefixed) {
    const resolve = KNOWN_FOLDERS[prefixed[1].toUpperCase()];
    const base = resolve ? resolve() : '';
    return base ? path.win32.normalize(path.win32.join(base, prefixed[2])) : null;
  }
  if (/^[A-Za-z]:\\/.test(name)) return path.win32.normalize(name);
  return null;
}

/**
 * Everything UserAssist knows about executables being started.
 *
 * Nine GUID subkeys exist here and two carry anything: one holds executables
 * and one holds shortcuts. Both are read -- a program started from its Start
 * menu shortcut appears only in the second -- and each entry says which it
 * came from, because a shortcut being opened is weaker evidence than the
 * program itself being started.
 *
 * @returns {Promise<{entries: object[], available: boolean, oldestMs: number|null, newestMs: number|null}>}
 */
async function readUserAssist(deps = {}) {
  const keys = await exportKey(USERASSIST, deps);
  if (!keys) return { entries: [], available: false, oldestMs: null, newestMs: null };

  const entries = [];
  for (const [keyPath, values] of Object.entries(keys)) {
    if (!/\\Count$/i.test(keyPath)) continue;
    for (const [rawName, value] of Object.entries(values)) {
      if (!Buffer.isBuffer(value) || value.length !== RECORD_BYTES) continue;
      const name = rot13(rawName);
      const lastRunMs = filetimeAt(value, LAST_RUN_AT);
      if (lastRunMs === null) continue;
      const isShortcut = /\.lnk$/i.test(name);
      const isExe = /\.exe(\.\d+)?$/i.test(name);
      if (!isExe && !isShortcut) continue;
      entries.push({
        name,
        fullPath: resolveEntryPath(name),
        lastRunMs,
        runs: value.readUInt32LE(RUN_COUNT_AT),
        kind: isShortcut ? 'shortcut' : 'exe',
      });
    }
  }

  const times = entries.map((e) => e.lastRunMs);
  return {
    entries,
    available: true,
    oldestMs: times.length ? Math.min(...times) : null,
    newestMs: times.length ? Math.max(...times) : null,
  };
}

/**
 * The Prefetch listing the helper hands back, as launch records.
 *
 * A prefetch file is named after the program and a hash of where it was
 * started from -- `NOTEPAD.EXE-9B4F2A1C.pf` -- and Windows rewrites it a few
 * seconds after each start. [Inference] So the file's modified time is the
 * last start, give or take those seconds; the times inside the file would say
 * so exactly, but reading them means decompressing and parsing it inside the
 * elevated process, and the helper is deliberately the smallest thing it can
 * be (roadmap 4.5). `npm run verify:prefetch -- --elevated` is what checks
 * that assumption against a program whose start time is known.
 *
 * The name gives an executable, never a path: two programs installed in
 * different folders and both called `setup.exe` are two prefetch files that
 * differ only in the hash. That is why a prefetch match is never better than
 * `likely`.
 */
function fromPrefetchListing(files) {
  const byExe = new Map();
  for (const file of files || []) {
    const match = /^(.+)-[0-9A-F]{8,16}\.pf$/i.exec(String(file.name || ''));
    if (!match) continue;
    const exe = match[1].toLowerCase();
    const at = Number(file.mtimeMs) || 0;
    if (at <= 0) continue;
    const seen = byExe.get(exe);
    if (!seen || at > seen.lastRunMs) byExe.set(exe, { exe, lastRunMs: at, files: (seen ? seen.files : 0) + 1 });
    else seen.files++;
  }
  const times = [...byExe.values()].map((e) => e.lastRunMs);
  return {
    byExe,
    available: byExe.size > 0,
    oldestMs: times.length ? Math.min(...times) : null,
    newestMs: times.length ? Math.max(...times) : null,
  };
}

module.exports = {
  rot13,
  filetimeAt,
  resolveEntryPath,
  readUserAssist,
  fromPrefetchListing,
  KNOWN_FOLDERS,
  RECORD_BYTES,
};
