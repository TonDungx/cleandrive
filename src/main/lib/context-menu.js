'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

/**
 * CleanDrive in Explorer's right-click menu (I3).
 *
 * Two entries: "Analyse with CleanDrive" on a folder, the inside of a folder
 * and a drive, and "Find duplicates with CleanDrive" on a file. They are the
 * classic kind, written under HKCU\Software\Classes -- per user, no
 * administrator. Windows 11's own menu wants an IExplorerCommand in a signed
 * package, which an unsigned app with no native code cannot have; there these
 * entries are under "Show more options" (Shift+F10).
 *
 * ## How the registry is touched
 *
 * Only through System32\reg.exe, by its absolute path, with fixed arguments:
 * `import <file>` to write or remove the keys, `export <key> <file> /y` to
 * read one back. The .reg file is written by this module, in its own temp
 * folder, as UTF-16 -- so a Vietnamese label arrives intact, and the quotes in
 * a command line are the .reg format's escapes rather than a second layer of
 * command-line quoting reg.exe would have to undo. Reading back is also
 * through a file: `reg query` prints in the console's code page, which has no
 * Vietnamese in it.
 *
 * ## Which keys
 *
 * Exactly the ones `entries()` names, and nothing else under Classes is ever
 * written or deleted. The key names carry CLEANDRIVE_TASK_SUFFIX when a
 * harness sets it, so a test's entries can never be the user's. The
 * uninstaller removes the same list: scripts/build.js writes it into
 * build/installer.nsh from `uninstallKeys()`.
 */

const CLASSES = 'HKEY_CURRENT_USER\\Software\\Classes';
const REG = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');

/** The verb names, suffixed for a harness. */
function verbs(suffix = process.env.CLEANDRIVE_TASK_SUFFIX) {
  const tag = suffix ? `CleanDrive.${String(suffix).replace(/[^\w-]/g, '')}` : 'CleanDrive';
  return { analyze: `${tag}.Analyze`, copies: `${tag}.Duplicates` };
}

/**
 * Everything written, for one executable and one language.
 *
 * `%1` is the item right-clicked; `%V` is the folder whose empty space was.
 * MultiSelectModel=Single keeps an entry off a selection of several items,
 * which would otherwise start the command once per item.
 *
 * @param {{exe: string, labels: {analyze: string, copies: string}, suffix?: string}} options
 */
function entries({ exe, labels, suffix }) {
  const v = verbs(suffix);
  // `--flag="%1"`: one token, which Chromium cannot separate from its value
  // when it reorders a command line (see launch-target.js).
  const run = (flag, token) => `"${exe}" ${flag}="${token}"`;
  return [
    { key: `${CLASSES}\\Directory\\shell\\${v.analyze}`, label: labels.analyze, command: run('--analyze', '%1') },
    { key: `${CLASSES}\\Directory\\Background\\shell\\${v.analyze}`, label: labels.analyze, command: run('--analyze', '%V') },
    { key: `${CLASSES}\\Drive\\shell\\${v.analyze}`, label: labels.analyze, command: run('--analyze', '%1') },
    { key: `${CLASSES}\\*\\shell\\${v.copies}`, label: labels.copies, command: run('--duplicates-of', '%1') },
  ].map((entry) => ({
    ...entry,
    values: { MUIVerb: entry.label, Icon: `"${exe}",0`, MultiSelectModel: 'Single' },
  }));
}

/** The keys the uninstaller removes, relative to HKCU. */
function uninstallKeys(suffix) {
  return entries({ exe: 'x', labels: { analyze: 'x', copies: 'x' }, suffix }).map((e) => e.key.replace(/^HKEY_CURRENT_USER\\/, ''));
}

/**
 * The uninstaller's part, as NSIS: remove every key the app may have written.
 * scripts/build.js writes this to build/installer.nsh, and electron-builder's
 * uninstaller runs `customUnInstall`. Not on an update -- electron-builder
 * runs the old version's uninstaller then too, and the new version would
 * start with its menu gone (it would put it back at launch, but there is no
 * reason to take it away).
 */
function uninstallerScript() {
  const lines = [
    '; Written by scripts/build.js from src/main/lib/context-menu.js. Do not edit.',
    '!macro customUnInstall',
    '  ${ifNot} ${isUpdated}',
    ...uninstallKeys('').map((key) => `    DeleteRegKey HKCU "${key}"`),
    '  ${endIf}',
    '!macroend',
    '',
  ];
  return lines.join('\r\n');
}

/* ------------------------------------------------------------ .reg files */

const escape = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** A .reg file that writes every entry (or, with `remove`, deletes them). */
function regFile(list, { remove = false } = {}) {
  const lines = ['Windows Registry Editor Version 5.00', ''];
  for (const entry of list) {
    if (remove) {
      lines.push(`[-${entry.key}]`, '');
      continue;
    }
    lines.push(`[${entry.key}]`);
    for (const [name, value] of Object.entries(entry.values)) lines.push(`"${name}"="${escape(value)}"`);
    lines.push('', `[${entry.key}\\command]`, `@="${escape(entry.command)}"`, '');
  }
  return lines.join('\r\n');
}

/** Read the string values out of `reg export` text: { key: { name: value } }. */
function parseExport(text) {
  const keys = {};
  let current = null;
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      current = keys[head[1]] = {};
      continue;
    }
    const value = /^(@|"((?:[^"\\]|\\.)*)")="((?:[^"\\]|\\.)*)"$/.exec(line);
    if (value && current) {
      const name = value[1] === '@' ? '' : value[2].replace(/\\(.)/g, '$1');
      current[name] = value[3].replace(/\\(.)/g, '$1');
    }
  }
  return keys;
}

/* ------------------------------------------------------------ reg.exe */

function runReg(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(REG, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function scratch() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-reg-'));
}

async function importFile(content, deps) {
  const dir = await scratch();
  const file = path.join(dir, 'cleandrive.reg');
  try {
    await fsp.writeFile(file, Buffer.from(`\uFEFF${content}`, 'utf16le'));
    return await deps.run(['import', file]);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** One key and its command subkey, as the registry has them now, or null. */
async function readKey(key, deps) {
  const dir = await scratch();
  const file = path.join(dir, 'export.reg');
  try {
    const result = await deps.run(['export', key, file, '/y']);
    if (!result.ok) return null;
    const keys = parseExport((await fsp.readFile(file)).toString('utf16le'));
    const own = keys[key];
    if (!own) return null;
    const command = keys[`${key}\\command`] || {};
    return { values: own, command: command[''] || null };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------ the API */

/**
 * What is in the registry, against what should be.
 *
 * @returns {Promise<{present: number, total: number, current: boolean, stale: string[]}>}
 *   `current` when every entry is there with exactly the values this build
 *   would write; `stale` names the ones that differ (an old exe path after the
 *   app was moved, the other language's label).
 */
async function status(options, deps = { run: runReg }) {
  const want = entries(options);
  let present = 0;
  const stale = [];
  for (const entry of want) {
    const found = await readKey(entry.key, deps);
    if (!found) {
      stale.push(entry.key);
      continue;
    }
    present += 1;
    const same = found.command === entry.command && Object.entries(entry.values).every(([k, v]) => found.values[k] === v);
    if (!same) stale.push(entry.key);
  }
  return { present, total: want.length, current: stale.length === 0, stale };
}

async function install(options, deps = { run: runReg }) {
  const result = await importFile(regFile(entries(options)), deps);
  if (!result.ok) throw Object.assign(new Error(`reg import failed: ${result.stderr.trim() || result.code}`), { code: 'EREG' });
  const after = await status(options, deps);
  if (!after.current) throw Object.assign(new Error('The menu entries did not read back as written'), { code: 'EREG', status: after });
  return after;
}

async function uninstall(options, deps = { run: runReg }) {
  // A key that is not there is fine to "delete": reg import skips it.
  const result = await importFile(regFile(entries(options), { remove: true }), deps);
  if (!result.ok) throw Object.assign(new Error(`reg import failed: ${result.stderr.trim() || result.code}`), { code: 'EREG' });
  const after = await status(options, deps);
  if (after.present !== 0) throw Object.assign(new Error('Some menu entries are still there'), { code: 'EREG', status: after });
  return after;
}

/**
 * Make the registry match the setting: on, every entry there and pointing at
 * this executable in this language; off, none of them. Writes only when
 * something differs, so a launch with nothing to change is a few reads.
 *
 * @returns {Promise<{enabled: boolean, changed: boolean, status: object}>}
 */
async function reconcile({ enabled, ...options }, deps = { run: runReg }) {
  const now = await status(options, deps);
  if (enabled) {
    if (now.current) return { enabled, changed: false, status: now };
    return { enabled, changed: true, status: await install(options, deps) };
  }
  if (now.present === 0) return { enabled, changed: false, status: now };
  return { enabled, changed: true, status: await uninstall(options, deps) };
}

module.exports = {
  CLASSES,
  REG,
  verbs,
  entries,
  uninstallKeys,
  uninstallerScript,
  regFile,
  parseExport,
  status,
  install,
  uninstall,
  reconcile,
  runReg,
};
