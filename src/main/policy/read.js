'use strict';

/**
 * Reading the organisation's policy out of the registry (H2).
 *
 * Through System32\reg.exe, by its absolute path, as the rest of the app reads
 * the registry (apps/registry.js, lib/context-menu.js), and for the reasons
 * measured there and again on 2026-10-01 for this key:
 *
 *   - `reg export` writes UTF-16 to a file, and a Vietnamese folder name
 *     arrives intact. `reg query` prints in the console's code page and loses
 *     it for good -- "Thư mục của tôi — Ảnh" came back "Thu m?c c?a ti - ?nh".
 *   - `/reg:64`, always. `HKLM\SOFTWARE\WOW6432Node\Policies` is a separate key
 *     on this machine with different contents, and Group Policy writes the
 *     64-bit one. A 64-bit process reads that view by default; passing it
 *     means a 32-bit build could not quietly read the wrong one.
 *   - No administrator rights: reading `HKLM\SOFTWARE\Policies` unelevated
 *     took 25-45 ms.
 *
 * ## Not there, or not readable
 *
 * reg.exe exits 1 both when the key does not exist -- the case on almost every
 * machine -- and when it may not be read, and only its message tells the two
 * apart, in the language Windows is installed in. So a failed export of the
 * key is followed by an export of its parent: if that succeeds and does not
 * list the key, there is no policy. Only when the parent cannot be read either
 * is reg.exe itself in doubt, and the same key is read through PowerShell's
 * registry provider instead. Measured on an elevated run (2026-10-02): with
 * `DisableRegistryTools` set to 1 or to 2 -- a common policy on exactly the
 * machines this is for -- reg.exe refuses every export, exit 1, "Registry
 * editing has been disabled by your administrator", and PowerShell reads the
 * key as before. A person cannot set that value on themselves; it lives under
 * a Policies key only an administrator can write.
 *
 * Reading never fails loudly. A policy that cannot be read is reported as
 * unreadable and treated as no policy (decided 2026-10-01): "view only" is an
 * organisation's guard rail, not access control -- the person at the machine
 * can delete their own files in Explorer whatever this says -- and an app that
 * locked itself because a tool was blocked would punish the machines that never
 * had a CleanDrive policy at all.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { parseRegFile } = require('../apps/registry');
const { MACHINE_KEY } = require('./schema');

const windowsDir = () => process.env.SystemRoot || 'C:\\Windows';
const REG = () => path.join(windowsDir(), 'System32', 'reg.exe');
const POWERSHELL = () => path.join(windowsDir(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** A policy bigger than this is not something this app wrote a schema for. */
const MAX_EXPORT = 4 * 1024 * 1024;

/**
 * Where a harness may keep a policy of its own: outside every `Policies`
 * branch, because a user cannot write under one, and under a name nothing
 * else uses. Only a checkout honours it (see services.js).
 */
const HARNESS_PREFIX = 'HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\';

function isHarnessKey(key) {
  return (
    typeof key === 'string' &&
    key.toLowerCase().startsWith(HARNESS_PREFIX.toLowerCase()) &&
    /^[A-Za-z0-9_\\-]+$/.test(key.slice(HARNESS_PREFIX.length)) &&
    key.length > HARNESS_PREFIX.length
  );
}

function runReg(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(REG(), args, { windowsHide: true, timeout: timeoutMs, encoding: 'buffer' }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stderr: Buffer.isBuffer(stderr) ? stderr.toString('latin1').trim() : '' });
    });
  });
}

async function scratch() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-policy-'));
}

/**
 * `reg export` of one key into its own scratch folder, read back as text.
 * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
 */
async function exportText(key, deps) {
  const dir = await (deps.scratch || scratch)();
  const file = path.join(dir, 'policy.reg');
  try {
    const result = await (deps.run || runReg)(['export', key, file, '/y', '/reg:64']);
    if (!result.ok) return { ok: false, error: result.stderr || `reg.exe exited ${result.code}` };
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) return { ok: false, error: 'reg.exe wrote nothing' };
    if (stat.size > MAX_EXPORT) return { ok: false, error: `the exported key is ${stat.size} bytes, more than this app reads` };
    return { ok: true, text: (await fsp.readFile(file)).toString('utf16le') };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The key and everything under it, from a parsed `.reg` file, as
 * `{ '<relative subkey, lower case>': { '<value name, lower case>': { name, value } } }`.
 * The root is `''`. Registry names are not case-sensitive, so neither is this.
 * A `.reg` file may hold other keys too (the parent's export does); only this
 * one's subtree is taken.
 */
function treeOf(keys, key) {
  const want = key.toLowerCase();
  const tree = {};
  let found = false;
  for (const [name, values] of Object.entries(keys)) {
    const lower = name.toLowerCase();
    let rel;
    if (lower === want) rel = '';
    else if (lower.startsWith(`${want}\\`)) rel = lower.slice(want.length + 1);
    else continue;
    found = true;
    const out = {};
    for (const [valueName, value] of Object.entries(values)) out[valueName.toLowerCase()] = { name: valueName, value };
    tree[rel] = out;
  }
  return found ? tree : null;
}

/** The parent of a registry path, or null at a hive. */
function parentOf(key) {
  const cut = key.lastIndexOf('\\');
  return cut > 0 && key.slice(0, cut).includes('\\') ? key.slice(0, cut) : null;
}

/*
 * The fallback, through PowerShell's registry provider. A fixed script, the
 * key on stdin, JSON out -- the shape of lib/ads.js and lib/dpapi.js. Values
 * come back already typed by .NET: Int32 for a DWORD, a string for REG_SZ and
 * REG_EXPAND_SZ (expanded, which the reader would do anyway), an array for
 * the rest, which the reader then refuses by type.
 */
const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  "$path = 'Registry::' + [Console]::In.ReadToEnd().Trim()",
  "if (-not (Test-Path -LiteralPath $path)) { '{\"exists\":false}'; exit 0 }",
  '$top = Get-Item -LiteralPath $path',
  '$all = @($top) + @(Get-ChildItem -LiteralPath $path -Recurse)',
  '$keys = @{}',
  'foreach ($k in $all) {',
  "  $rel = $k.Name.Substring($top.Name.Length).TrimStart('\\')",
  "  if ($rel -eq '') { $rel = '.' }",
  '  $values = @{}',
  "  foreach ($n in $k.GetValueNames()) { if ($n -ne '') { $values[$n] = $k.GetValue($n) } }",
  '  $keys[$rel] = $values',
  '}',
  'ConvertTo-Json -Compress -Depth 6 -InputObject @{ exists = $true; keys = $keys }',
].join('\r\n');

function runPowerShell(key, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      POWERSHELL(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: MAX_EXPORT * 2 },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), error: err ? String(stderr || err.message).trim().split(/\r?\n/)[0] : null })
    );
    child.stdin.end(key, 'utf8');
  });
}

async function readThroughPowerShell(key, deps) {
  const result = await (deps.powershell || runPowerShell)(key);
  if (!result.ok) return { ok: false, error: result.error || 'PowerShell could not read it' };
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    return { ok: false, error: 'PowerShell answered with something that is not JSON' };
  }
  if (!parsed || parsed.exists !== true) return { ok: true, tree: null };
  const tree = {};
  for (const [rel, values] of Object.entries(parsed.keys || {})) {
    const out = {};
    for (const [name, value] of Object.entries(values || {})) out[name.toLowerCase()] = { name, value };
    tree[rel === '.' ? '' : rel.toLowerCase()] = out;
  }
  return { ok: true, tree };
}

/**
 * @param {object} [options]
 * @param {string|null} [options.key]  the key to read; null means "none here" (a harness, isolated)
 * @param {object} [options.deps]      { run, scratch, powershell } for the harness
 * @returns {Promise<{status: 'none'|'present'|'unreadable', key: string|null, via: string|null,
 *   tree: object, error: string|null, ms: number}>}
 */
async function readPolicy({ key = MACHINE_KEY, deps = {} } = {}) {
  const started = Date.now();
  const done = (status, via, tree, error = null) => ({ status, key, via, tree: tree || {}, error, ms: Date.now() - started });
  if (key === null) return done('none', null, {});
  if (process.platform !== 'win32' && !deps.run) return done('none', null, {});

  const own = await exportText(key, deps);
  if (own.ok) {
    const tree = treeOf(parseRegFile(own.text), key);
    return done(tree ? 'present' : 'none', 'reg.exe', tree);
  }

  const parent = parentOf(key);
  if (parent) {
    const up = await exportText(parent, deps);
    if (up.ok) {
      const tree = treeOf(parseRegFile(up.text), key);
      return done(tree ? 'present' : 'none', 'reg.exe', tree);
    }
  }

  const ps = await readThroughPowerShell(key, deps);
  if (ps.ok) return done(ps.tree ? 'present' : 'none', 'powershell', ps.tree);
  return done('unreadable', null, {}, `reg.exe: ${own.error}; PowerShell: ${ps.error}`);
}

/**
 * The same tree out of a `.reg` file somebody saved -- `reg export` of a
 * reference machine, or the file a script will `reg import` -- so it can be
 * checked before it is rolled out. reg.exe writes UTF-16 with a byte-order
 * mark; a file written by hand is often UTF-8, and both are read.
 *
 * @returns {{tree: object|null, keys: string[]}}  null when the file holds nothing under the key
 */
function readRegFile(bytes, key = MACHINE_KEY) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  const text = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString('utf16le') : buffer.toString('utf8');
  const keys = parseRegFile(text);
  return { tree: treeOf(keys, key), keys: Object.keys(keys) };
}

module.exports = { readPolicy, readRegFile, treeOf, parentOf, isHarnessKey, HARNESS_PREFIX, MACHINE_KEY, REG, POWERSHELL, SCRIPT };
