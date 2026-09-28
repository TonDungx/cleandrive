'use strict';

/**
 * NTFS alternate data streams, for the one job that needs them: moving a file
 * without quietly throwing part of it away (B2).
 *
 * A stream is a second body hanging off the same name. Windows uses them for
 * small metadata, and one of those is `Zone.Identifier` -- the mark that says
 * "this came from the internet", which is what makes SmartScreen warn about a
 * downloaded installer. A copy that drops it produces a file that *looks*
 * identical and is treated as more trustworthy than the original. That is the
 * kind of difference this app must not make silently.
 *
 * Measured on this machine, 3,000 files sampled in each place:
 *
 *   Downloads   318 files with a stream (10.6%) -- Zone.Identifier,
 *               SmartScreen, OECustomProperty
 *   D:\           2 files with a stream (0.07%)
 *
 * So: common where things are downloaded, rare elsewhere, and never large.
 *
 * ## Why half of this is PowerShell
 *
 * Node can *read and write* a stream perfectly well -- `fs` accepts
 * `C:\file.txt:Zone.Identifier` as a path, which is measured in this module's
 * test and is how `media/probe.js` already reads zone marks. What Node cannot
 * do is *enumerate* them: there is no API for "what streams does this file
 * have", only `FindFirstStreamW`/`FindNextStreamW`.
 *
 * So enumeration goes out to one PowerShell process for a whole batch of
 * paths, built exactly like `cloud-state.js`: the script is fixed text sent as
 * `-EncodedCommand`, the paths go in over stdin as UTF-8 and never appear in
 * the script, and powershell.exe is named by absolute path under System32.
 * Copying is then plain Node, one stream at a time.
 *
 * If the enumeration cannot run -- AppLocker, WDAC, a stripped Windows -- this
 * returns `ok: false` and the caller must say so rather than proceed as though
 * the files had no streams. Not knowing and finding none are different answers.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');

const { IS_WIN } = require('./util');

const windowsDir = () => process.env.SystemRoot || 'C:\\Windows';
const powershell = () =>
  path.join(windowsDir(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/**
 * Reads one path per line and writes one line per path:
 *
 *   `<index> <name>:<size> <name>:<size> ...`
 *
 * A file with no alternate streams writes its index and nothing else. A file
 * that cannot be opened writes `<index> !`, which is not the same as none.
 *
 * `cStreamName` arrives as `:Zone.Identifier:$DATA`; the `$DATA` suffix is the
 * stream *type* and is the same for every one of these, so only the middle is
 * kept. The default stream is reported as `::$DATA` and is the file itself,
 * which is copied by the ordinary path and must not be copied twice.
 */
const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Text;',
  'using System.Runtime.InteropServices;',
  'public static class CleanDriveStreams {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '  public struct FindStreamData {',
  '    public long StreamSize;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 296)] public string StreamName;',
  '  }',
  '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
  '  static extern IntPtr FindFirstStreamW(string name, int level, out FindStreamData data, uint flags);',
  '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
  '  static extern bool FindNextStreamW(IntPtr handle, out FindStreamData data);',
  '  [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr handle);',
  '  public static string List(string file) {',
  '    FindStreamData data;',
  '    IntPtr handle = FindFirstStreamW(file, 0, out data, 0);',
  '    if (handle == new IntPtr(-1)) {',
  '      int err = Marshal.GetLastWin32Error();',
  // ERROR_HANDLE_EOF (38) means the file is there and has no streams to list.
  '      return (err == 38) ? "" : "!";',
  '    }',
  '    StringBuilder found = new StringBuilder();',
  '    do {',
  '      string raw = data.StreamName;',
  '      if (raw != null && raw != "::$DATA") {',
  '        string trimmed = raw;',
  '        if (trimmed.StartsWith(":")) trimmed = trimmed.Substring(1);',
  '        int mark = trimmed.LastIndexOf(":$DATA");',
  '        if (mark >= 0) trimmed = trimmed.Substring(0, mark);',
  '        if (trimmed.Length > 0) {',
  '          if (found.Length > 0) found.Append(" ");',
  '          found.Append(trimmed.Replace(" ", "%20"));',
  '          found.Append(":");',
  '          found.Append(data.StreamSize);',
  '        }',
  '      }',
  '    } while (FindNextStreamW(handle, out data));',
  '    FindClose(handle);',
  '    return found.ToString();',
  '  }',
  '}',
  "'@",
  '$index = 0',
  'while ($null -ne ($line = [Console]::In.ReadLine())) {',
  '  [Console]::Out.WriteLine(([string]$index) + " " + [CleanDriveStreams]::List($line))',
  '  $index++',
  '}',
].join('\n');

const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

/** One reply line back into streams, or null when the file could not be read. */
function parseLine(rest) {
  const text = String(rest || '').trim();
  if (text === '') return [];
  if (text === '!') return null;

  const streams = [];
  for (const token of text.split(' ')) {
    const at = token.lastIndexOf(':');
    if (at <= 0) continue;
    const name = token.slice(0, at).replace(/%20/g, ' ');
    const size = Number(token.slice(at + 1));
    if (name) streams.push({ name, size: Number.isFinite(size) ? size : 0 });
  }
  return streams;
}

/**
 * What streams each of these files carries.
 *
 * @param {string[]} paths
 * @returns {Promise<{ok: boolean, streams: Map<string, {name: string, size: number}[]>,
 *                    unreadable: string[], error: string|null}>}
 */
function list(paths, { timeoutMs = 120000 } = {}) {
  const files = (paths || []).filter((p) => typeof p === 'string' && p !== '');
  const empty = { ok: true, streams: new Map(), unreadable: [], error: null };
  if (!IS_WIN || files.length === 0) return Promise.resolve(empty);

  return new Promise((resolve) => {
    let child;
    let out = '';
    let settled = false;

    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const failed = (error) => done({ ok: false, streams: new Map(), unreadable: [], error });

    const timer = setTimeout(() => {
      if (child) child.kill();
      failed('timed out');
    }, timeoutMs);

    try {
      child = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err) {
      failed(err.message);
      return;
    }

    child.on('error', (err) => failed(err.message));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });

    child.on('close', (code) => {
      if (code !== 0 && out === '') return failed(`powershell exited ${code}`);

      const streams = new Map();
      const unreadable = [];
      for (const line of out.split(/\r?\n/)) {
        const at = line.indexOf(' ');
        const index = Number(at === -1 ? line : line.slice(0, at));
        if (!Number.isInteger(index) || index < 0 || index >= files.length) continue;
        const parsed = parseLine(at === -1 ? '' : line.slice(at + 1));
        if (parsed === null) unreadable.push(files[index]);
        else if (parsed.length > 0) streams.set(files[index], parsed);
      }
      done({ ok: true, streams, unreadable, error: null });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(`${files.join('\n')}\n`, 'utf8');
  });
}

/**
 * Copy named streams from one file to another.
 *
 * Node does this without help: `fs` treats `file:stream` as a path of its own.
 * A stream that will not copy is reported rather than thrown, because losing a
 * zone mark is worth saying out loud and is not worth abandoning a move over.
 */
async function copy(from, to, streams) {
  const copied = [];
  const failed = [];

  for (const stream of streams || []) {
    const name = stream && stream.name;
    if (!name) continue;
    try {
      const body = await fsp.readFile(`${from}:${name}`);
      await fsp.writeFile(`${to}:${name}`, body);
      copied.push(name);
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }

  return { copied, failed };
}

/**
 * Whether a stream is the mark that changes how Windows treats a file.
 *
 * Used to word the warning: "12 files carry extra data" is a shrug, and "9 of
 * them are marked as downloaded from the internet" is the sentence somebody
 * can act on.
 */
const isZoneMark = (name) => String(name || '').toLowerCase() === 'zone.identifier';

module.exports = { list, copy, isZoneMark, parseLine, SCRIPT };
