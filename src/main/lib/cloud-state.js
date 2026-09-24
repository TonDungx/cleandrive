'use strict';

/**
 * What OneDrive has done with a file, asked of Windows rather than guessed.
 *
 * "Free up space" makes a synced file online-only: its name, size and date
 * stay, its contents go back to the cloud and come down again when it is
 * opened. That is only safe -- and only frees anything -- for a file whose
 * contents are already in the cloud. Node cannot tell. Measured on the machine
 * this was written on, with OneDrive not running:
 *
 *   566 files of 1 MB or more in the OneDrive folder
 *     391, 1.30 GB   placeholders, in sync, contents on this disk
 *     153, 10.3 GB   not placeholders at all: never uploaded
 *      22, 332 MB    placeholders already online-only
 *
 * `fs.Stats.blocks` separates the last group from the others and nothing
 * more; a directory entry does not flag a placeholder file; and `attrib.exe`
 * prints in the console's code page, which mangles Vietnamese file names. So
 * Windows is asked directly, through the Cloud Files API
 * (`CfGetPlaceholderStateFromFindData`), from a small C# class that Windows
 * PowerShell compiles when it starts. It reads each file's directory entry
 * with `FindFirstFileW` -- it never opens a file, so it cannot make a
 * placeholder download. On this machine the whole thing took 0.9 s, of which
 * the 566 queries were under a tenth.
 *
 * The script is fixed text, sent as `-EncodedCommand`; the paths go in on
 * standard input, one per line, UTF-8, and are never part of anything
 * PowerShell parses. Every program is named by its absolute path under
 * `System32`. Where the compiler is blocked (AppLocker, WDAC), the query fails
 * and the answer is "could not check" -- never a guess.
 */

const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const { fsp } = require('./real-fs');
const cloud = require('./media/cloud');

/** CF_PLACEHOLDER_STATE, cfapi.h */
const STATE = Object.freeze({
  PLACEHOLDER: 0x1,
  SYNC_ROOT: 0x2,
  ESSENTIAL_PROP_PRESENT: 0x4,
  IN_SYNC: 0x8,
  PARTIAL: 0x10,
  PARTIALLY_ON_DISK: 0x20,
});

/** FILE_ATTRIBUTE_*, winnt.h */
const ATTR = Object.freeze({
  REPARSE_POINT: 0x400,
  OFFLINE: 0x1000,
  RECALL_ON_OPEN: 0x40000,
  PINNED: 0x80000,
  UNPINNED: 0x100000,
  RECALL_ON_DATA_ACCESS: 0x400000,
});

const windowsDir = () => process.env.SystemRoot || 'C:\\Windows';
const programs = {
  powershell: () => path.join(windowsDir(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  attrib: () => path.join(windowsDir(), 'System32', 'attrib.exe'),
  tasklist: () => path.join(windowsDir(), 'System32', 'tasklist.exe'),
};

/**
 * Reads one path per line from standard input and writes, per line,
 * `<index> <attributes> <placeholder state>`. A path it cannot find comes back
 * with attributes 4294967295.
 */
const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class CleanDriveCloudState {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '  public struct FindData {',
  '    public uint Attributes;',
  '    public System.Runtime.InteropServices.ComTypes.FILETIME Created;',
  '    public System.Runtime.InteropServices.ComTypes.FILETIME Accessed;',
  '    public System.Runtime.InteropServices.ComTypes.FILETIME Written;',
  '    public uint SizeHigh;',
  '    public uint SizeLow;',
  '    public uint Reserved0;',
  '    public uint Reserved1;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string ShortName;',
  '  }',
  '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
  '  static extern IntPtr FindFirstFileW(string name, out FindData data);',
  '  [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr handle);',
  '  [DllImport("cldapi.dll")] static extern uint CfGetPlaceholderStateFromFindData(ref FindData data);',
  '  public static string Query(string file) {',
  '    FindData data;',
  '    IntPtr handle = FindFirstFileW(file, out data);',
  '    if (handle == new IntPtr(-1)) return "4294967295 0";',
  '    FindClose(handle);',
  '    return data.Attributes + " " + CfGetPlaceholderStateFromFindData(ref data);',
  '  }',
  '}',
  "'@",
  '$index = 0',
  'while ($null -ne ($line = [Console]::In.ReadLine())) {',
  '  [Console]::Out.WriteLine(([string]$index) + " " + [CleanDriveCloudState]::Query($line))',
  '  $index++',
  '}',
].join('\n');

const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

function describe(attributes, state) {
  const missing = attributes === 0xffffffff;
  return {
    missing,
    attributes,
    state,
    placeholder: !missing && (state & STATE.PLACEHOLDER) !== 0,
    inSync: !missing && (state & STATE.IN_SYNC) !== 0,
    // PARTIAL: some of the contents are not on this disk. What "free up
    // space" would do has, at least in part, already been done.
    onDisk: !missing && (state & STATE.PARTIAL) === 0,
    pinned: !missing && (attributes & ATTR.PINNED) !== 0,
    unpinned: !missing && (attributes & ATTR.UNPINNED) !== 0,
  };
}

/** Lines of `<index> <attributes> <state>` back into a map by path. */
function parseReply(paths, stdout) {
  const out = new Map();
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = /^(\d+) (\d+) (\d+)$/.exec(line.trim());
    if (!m) continue;
    const index = Number(m[1]);
    if (index >= paths.length) continue;
    out.set(paths[index], describe(Number(m[2]), Number(m[3])));
  }
  return out;
}

/**
 * The state of each file, by path.
 *
 * @param {string[]} paths  absolute
 * @returns {Promise<{ok: true, states: Map} | {ok: false, reason: string}>}
 */
function query(paths, { timeoutMs = 60000 } = {}) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: 'notWindows' });
  const list = paths.filter((p) => typeof p === 'string' && path.isAbsolute(p) && !/[\r\n]/.test(p));
  if (list.length === 0) return Promise.resolve({ ok: true, states: new Map() });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn(programs.powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      finish({ ok: false, reason: 'unavailable' });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', () => finish({ ok: false, reason: 'unavailable' }));
    child.once('close', (code) => {
      const states = parseReply(list, stdout);
      // Every path must come back. A partial answer is no answer: the ones
      // missing from it would otherwise read as "not synced".
      if (code !== 0 || states.size !== list.length) {
        finish({ ok: false, reason: 'unavailable', detail: stderr.slice(0, 400) });
        return;
      }
      finish({ ok: true, states });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${list.join('\n')}\n`, 'utf8');
  });
}

/** Whether OneDrive's own process is running, which it must be to free anything. */
function oneDriveRunning() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      programs.tasklist(),
      ['/FI', 'IMAGENAME eq OneDrive.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        // The "no tasks" line is in the system's language; the process line is
        // not, so it is the one tested for.
        resolve(String(stdout).split(/\r?\n/).some((line) => /^"onedrive\.exe"/i.test(line.trim())));
      }
    );
  });
}

/**
 * Mark one file online-only: `attrib +U -P`, the command Microsoft documents
 * for OneDrive's Files On-Demand. OneDrive then removes the local copy of the
 * contents, in its own time.
 */
function makeOnlineOnly(file) {
  return new Promise((resolve, reject) => {
    execFile(programs.attrib(), ['+U', '-P', file], { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      // attrib says what went wrong on its output and still exits 0.
      const said = `${stdout || ''}${stderr || ''}`.trim();
      if (err || said) reject(new Error(said || (err && err.message) || 'attrib failed'));
      else resolve();
    });
  });
}

/** What a file takes on the disk, as the file system has it allocated. */
async function allocated(file) {
  const stats = await fsp.lstat(file);
  return Number.isFinite(stats.blocks) ? stats.blocks * 512 : stats.size;
}

/** The OneDrive folders this account has -- the only ones "free up space" is offered for. */
function oneDriveRoots() {
  return cloud.roots().filter((r) => r.service === 'OneDrive');
}

/** The OneDrive folder a path is inside, or null. */
function oneDriveRootOf(file, roots = oneDriveRoots()) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
  const key = path.resolve(file).toLowerCase();
  const root = roots.find((r) => key.startsWith(r.key.endsWith(path.sep) ? r.key : r.key + path.sep));
  return root ? root.root : null;
}

module.exports = {
  query,
  oneDriveRunning,
  makeOnlineOnly,
  allocated,
  oneDriveRoots,
  oneDriveRootOf,
  parseReply,
  describe,
  programs,
  SCRIPT,
  STATE,
  ATTR,
};
