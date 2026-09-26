'use strict';

/**
 * Apps that came from the Microsoft Store, which the Uninstall keys never
 * mention.
 *
 * There is no file to read for these: the package list lives in a database
 * only the AppX stack can open, so Windows PowerShell is asked, exactly the
 * way `lib/cloud-state.js` asks it -- absolute path under System32, a fixed
 * script sent as `-EncodedCommand`, nothing from anywhere else put into it,
 * and UTF-8 on the way back so that a package's display name survives.
 *
 * Measured on this machine, 2026-09-26: 207 packages, 147 of them not
 * frameworks, listed in 1.5 s. `C:\Program Files\WindowsApps` itself refuses
 * to be listed by a normal process (EPERM) -- but each package's own folder
 * inside it reads fine, all 147 of them, and measuring every one took 10.6 s
 * for 14.32 GB with nothing refused. So Store apps need no administrator
 * rights to be sized, which is more than can be said for most of the
 * programs in the registry.
 *
 * Frameworks (the shared runtimes packages depend on) are left out: they
 * belong to no app in particular, and removing one is not something a person
 * does from a list of their apps.
 *
 * Only reads.
 */

const path = require('node:path');
const { execFile } = require('node:child_process');

const powershell = () =>
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/**
 * Writes one package per line, tab-separated, so that a display name with a
 * space, a comma or a Vietnamese vowel in it stays one field. A tab cannot
 * appear in any of these fields.
 */
const SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  'Get-AppxPackage | Where-Object { -not $_.IsFramework } | ForEach-Object {',
  '  [Console]::Out.WriteLine(($_.Name, $_.PackageFullName, $_.PackageFamilyName, $_.Publisher,',
  '    $_.SignatureKind, $_.Version, $_.InstallLocation, $_.NonRemovable) -join "`t")',
  '}',
].join('\n');

const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

/**
 * A publisher as AppX writes it -- `CN=Valve, L=Bellevue, S=WA, C=US` -- is a
 * certificate subject, not a name anybody would recognise. The CN is the part
 * that reads like one.
 */
function publisherName(subject) {
  const cn = /CN=([^,]+)/.exec(String(subject || ''));
  return (cn ? cn[1] : String(subject || '')).replace(/^"|"$/g, '').trim();
}

/**
 * A package name as a person would read it.
 *
 * `Get-AppxPackage` has a DisplayName only where the package's manifest has
 * been indexed, and on this machine most of them come back as the package
 * identity instead -- `Microsoft.WindowsCalculator`. The last dotted part is
 * the closest to a name that is always there, split where it runs words
 * together.
 */
function readableName(name) {
  const parts = String(name || '').split('.').filter(Boolean);
  // The first part is the publisher (`Microsoft.WindowsCalculator`), and the
  // rest is the name. Taking only the last part turns
  // `Microsoft.Winget.Source` into "Source", which names nothing.
  const rest = parts.length > 1 ? parts.slice(1) : parts;
  return rest.join(' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').trim() || String(name || '');
}

function parseListing(stdout) {
  const packages = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.includes('\t')) continue;
    const [name, fullName, familyName, publisher, signature, version, location, nonRemovable] = line.split('\t');
    if (!name || !fullName) continue;
    packages.push({
      name,
      fullName,
      familyName: familyName || '',
      publisher: publisherName(publisher),
      signature: signature || 'None',
      version: version || '',
      location: location || '',
      // Windows' own flag for a package that cannot be removed.
      nonRemovable: String(nonRemovable || '').toLowerCase() === 'true',
    });
  }
  return packages;
}

/**
 * Every Store app on this machine.
 *
 * @returns {Promise<{ok: boolean, packages: object[], reason?: string, ms: number}>}
 */
function listPackages({ timeoutMs = 120000 } = {}, deps = {}) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, packages: [], reason: 'notWindows', ms: 0 });
  if (deps.listPackages) return deps.listPackages();

  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      powershell(),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => {
        const text = (stdout || Buffer.alloc(0)).toString('utf8');
        const packages = parseListing(text);
        // An error with packages still in hand is a package that failed, not a
        // listing that failed; nothing here is worth losing the other 146 over.
        if (err && packages.length === 0) {
          resolve({ ok: false, packages: [], reason: 'unavailable', ms: Date.now() - started });
          return;
        }
        resolve({ ok: true, packages, ms: Date.now() - started });
      }
    );
  });
}

module.exports = { listPackages, parseListing, publisherName, readableName, SCRIPT };
