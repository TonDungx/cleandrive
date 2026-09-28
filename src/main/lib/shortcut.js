'use strict';

/**
 * Leaving a `.lnk` behind where a folder used to be (B2).
 *
 * The spec is emphatic that this is **not** a junction, and the reason is
 * worth keeping next to the code: a junction is transparent. Every tool that
 * walks a disk -- Explorer's size column, a backup, and this app's own scanner
 * -- follows one without being told, so a folder "moved" behind a junction is
 * counted on both drives at once, and a later cleanup can delete through it
 * into the real files. A `.lnk` is inert. Nothing follows it except a person
 * double-clicking it, which is exactly the audience it is for.
 *
 * Writing one means the shell's `IShellLink`, which Node has no access to, so
 * this goes out to PowerShell's `WScript.Shell` COM object -- built the same
 * way as `cloud-state.js`: fixed script text sent as `-EncodedCommand`, the
 * two paths over stdin as UTF-8 so neither is ever part of the script, and
 * powershell.exe named by absolute path under System32.
 *
 * A shortcut that cannot be written is not a failed move. The folder is
 * already somewhere safe by the time this runs, so the caller reports it and
 * carries on.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

const { IS_WIN } = require('./util');

const windowsDir = () => process.env.SystemRoot || 'C:\\Windows';
const powershell = () =>
  path.join(windowsDir(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/**
 * Reads exactly three lines -- where the shortcut goes, what it points at, and
 * the description -- and writes `OK` or `ERR <message>`.
 */
const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  '$link = [Console]::In.ReadLine()',
  '$target = [Console]::In.ReadLine()',
  '$note = [Console]::In.ReadLine()',
  'try {',
  '  $shell = New-Object -ComObject WScript.Shell',
  '  $cut = $shell.CreateShortcut($link)',
  '  $cut.TargetPath = $target',
  '  $cut.WorkingDirectory = $target',
  '  $cut.Description = $note',
  '  $cut.Save()',
  '  [Console]::Out.WriteLine("OK")',
  '} catch {',
  '  [Console]::Out.WriteLine("ERR " + $_.Exception.Message.Replace("`n", " ").Replace("`r", " "))',
  '}',
].join('\n');

const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

/**
 * Write `linkPath` (which should end in `.lnk`) pointing at `targetPath`.
 *
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
function create(linkPath, targetPath, description = '', { timeoutMs = 30000 } = {}) {
  if (!IS_WIN) return Promise.resolve({ ok: false, error: 'Shortcuts are a Windows thing' });
  if (!linkPath || !targetPath) return Promise.resolve({ ok: false, error: 'No path' });

  // A newline in a path would be read as the next field. Windows does not
  // allow one in a file name, so this is a guard against a caller's mistake
  // rather than against a real path.
  if (/[\r\n]/.test(linkPath) || /[\r\n]/.test(targetPath)) {
    return Promise.resolve({ ok: false, error: 'A path cannot contain a line break' });
  }

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
    const timer = setTimeout(() => {
      if (child) child.kill();
      done({ ok: false, error: 'timed out' });
    }, timeoutMs);

    try {
      child = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err) {
      done({ ok: false, error: err.message });
      return;
    }

    child.on('error', (err) => done({ ok: false, error: err.message }));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('close', () => {
      const reply = out.trim();
      if (reply.startsWith('OK')) done({ ok: true, error: null });
      else done({ ok: false, error: reply.replace(/^ERR\s*/, '') || 'the shortcut was not written' });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(`${linkPath}\n${targetPath}\n${String(description).replace(/[\r\n]+/g, ' ')}\n`, 'utf8');
  });
}

module.exports = { create, SCRIPT };
