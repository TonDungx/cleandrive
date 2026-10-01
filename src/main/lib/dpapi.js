'use strict';

/**
 * Windows DPAPI, for the one secret the app keeps: the key that seals the
 * journal (H4).
 *
 * ## Scope: the user, not the machine
 *
 * The spec said machine scope. Decided 2026-10-01 to use the user's: the
 * journal already lives in the user's profile, the scheduled run already runs
 * as that user (`InteractiveToken`, `LeastPrivilege` in `scheduler.js`), and
 * machine scope only adds that every *other* account on the computer could
 * open the key as well -- wider, never narrower.
 *
 * ## Why PowerShell and not Electron's `safeStorage`
 *
 * `safeStorage` is DPAPI too and costs 1.7 ms instead of half a second. It was
 * measured and rejected: its own key lives in Chromium's `Local State`, which
 * is written when the app quits normally and is **not** written when a process
 * ends with `app.exit()` -- a blob encrypted in such a process could not be
 * decrypted by the next one. `app.exit(code)` is how the scheduled run ends
 * (`main.js`), and the scheduled run is exactly the process most likely to
 * seal the first session on a managed machine.
 *
 * So the call goes out to PowerShell, built like `ads.js` and
 * `cloud-state.js`: the script is fixed text sent as `-EncodedCommand`, the
 * bytes go in over stdin and never appear on a command line, and
 * powershell.exe is named by absolute path. Measured on this machine, not
 * elevated: about 500 ms a call for either scope, nearly all of it PowerShell
 * starting. The caller keeps the result for the life of the process, so that
 * is paid once.
 *
 * If PowerShell cannot run -- AppLocker, WDAC, Constrained Language Mode --
 * this rejects, and the journal writes its lines without a seal rather than
 * not at all.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

const windowsDir = () => process.env.SystemRoot || 'C:\\Windows';
const powershell = () => path.join(windowsDir(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/**
 * Bound to this app, so another program running as the same user cannot hand
 * the blob to `Unprotect` and get the key back without knowing it. That is
 * not secrecy -- the string is in this file -- only a refusal to be a
 * general-purpose decryption oracle.
 */
const ENTROPY = 'cleandrive.journal-seal/1';

/**
 * Exit 3 means DPAPI itself refused the blob -- the one failure that says the
 * key is lost. Anything else (exit 1, a timeout, PowerShell that would not
 * start) says only that this attempt did not work, and must never be taken
 * as a reason to make a new key.
 */
const REFUSED = 3;

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'try {',
  '  Add-Type -AssemblyName System.Security',
  '  $op = [Console]::In.ReadLine()',
  '  $data = [Convert]::FromBase64String([Console]::In.ReadLine())',
  `  $entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')`,
  '  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser',
  "  if ($op -eq 'protect') { $out = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope) }",
  "  elseif ($op -eq 'unprotect') { $out = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope) }",
  '  else { exit 2 }',
  '  [Console]::Out.Write([Convert]::ToBase64String($out))',
  '} catch {',
  '  $e = $_.Exception',
  '  while ($e -ne $null -and -not ($e -is [Security.Cryptography.CryptographicException])) { $e = $e.InnerException }',
  `  if ($e -ne $null) { exit ${REFUSED} } else { exit 1 }`,
  '}',
].join('\n');

const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

function run(op, data, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let out = '';
    let settled = false;
    const finish = (err, value, refused = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(Object.assign(new Error(`DPAPI ${op}: ${err}`), { code: 'EDPAPI', refused }));
      else resolve(value);
    };
    const timer = setTimeout(() => {
      if (child) child.kill();
      finish('timed out');
    }, timeoutMs);

    try {
      child = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err) {
      finish(err.message);
      return;
    }
    child.on('error', (err) => finish(err.message));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('close', (code) => {
      const text = out.trim();
      if (code === REFUSED) {
        finish('the blob was refused', null, true);
        return;
      }
      if (code !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(text)) {
        finish(`powershell exited ${code}`);
        return;
      }
      finish(null, Buffer.from(text, 'base64'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${op}\n${Buffer.from(data).toString('base64')}\n`, 'utf8');
  });
}

/** @param {Buffer} data @returns {Promise<Buffer>} */
const protect = (data, options) => run('protect', data, options);

/** @param {Buffer} blob @returns {Promise<Buffer>} */
const unprotect = (blob, options) => run('unprotect', blob, options);

module.exports = { protect, unprotect, SCOPE: 'CurrentUser', ENTROPY };
