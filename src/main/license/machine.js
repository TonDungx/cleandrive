'use strict';

/**
 * Which computer this is, as far as a licence needs to know (ROADMAP §7.5).
 *
 *   machineId = SHA-256("cleandrive.machine/1:" + MachineGuid)
 *
 * `MachineGuid` is Windows' own id for the installation, in
 * `HKLM\SOFTWARE\Microsoft\Cryptography`. Measured 2026-10-02: readable
 * without elevation (`BUILTIN\Users` has ReadKey), 14 ms through `reg.exe`,
 * 46 ms through PowerShell. The raw GUID never leaves this function -- only
 * the salted hash does, so the id a licence or an order carries cannot be
 * matched against anything else that reads the same value.
 *
 * `reg.exe` first; PowerShell when it is refused, which it is under the
 * `DisableRegistryTools` policy (measured for H2). Both by absolute path. A
 * GUID is ASCII, so `reg query`'s console code page cannot mangle it -- the
 * reason the policy reader uses `export` does not apply here.
 *
 * Null when neither can read it: a licence still works, it simply has no
 * machine to name.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { execFile } = require('node:child_process');

const KEY = 'HKLM\\SOFTWARE\\Microsoft\\Cryptography';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const system32 = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 15000 }, (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

async function viaReg() {
  const out = await run(path.join(system32(), 'reg.exe'), ['query', KEY, '/v', 'MachineGuid', '/reg:64']);
  const m = out && /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
  return m && GUID.test(m[1]) ? m[1] : null;
}

async function viaPowerShell() {
  const script = "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid";
  const out = await run(path.join(system32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script]);
  const guid = out && out.trim();
  return guid && GUID.test(guid) ? guid : null;
}

/** The salted hash for a GUID. */
function idFor(guid) {
  return crypto.createHash('sha256').update(`cleandrive.machine/1:${String(guid).toLowerCase()}`).digest('hex');
}

let cached = null;

/**
 * @param {object} [deps]  for the harness: { readGuid }
 * @returns {Promise<string|null>} 64 hex characters, or null
 */
async function machineId(deps = {}) {
  if (!deps.readGuid && cached) return cached;
  const read = deps.readGuid || (async () => (await viaReg()) || viaPowerShell());
  const guid = await read();
  const id = guid && GUID.test(guid) ? idFor(guid) : null;
  if (!deps.readGuid) cached = id ? Promise.resolve(id) : null;
  return id;
}

/** What a screen shows: enough to tell two computers apart, nothing more. */
const shortId = (id) => (typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id.slice(0, 8) : null);

module.exports = { machineId, idFor, shortId, viaReg, viaPowerShell };
