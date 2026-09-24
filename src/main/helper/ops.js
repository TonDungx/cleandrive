'use strict';

/**
 * Everything the elevated helper will do. Nothing else can be asked of it.
 *
 * Every operation here only reads. The helper runs with administrator rights,
 * and the one thing that keeps that safe is that there is nothing in it that
 * writes, deletes or runs a command it was handed: every change to the system
 * the app suggests is a handoff to a Windows tool the user opens themselves.
 * `scripts/test-helper.js` reads this file and fails if a write API appears.
 *
 * The roadmap's list arrives with the features that specify them. A1 brings
 * four: `system.breakdown` (the size of folders a normal process may not
 * read), `shadowstorage.query`, `dism.analyze` and `ntfs.info`. The last three
 * run one Windows tool each, from the fixed table below -- the program by its
 * absolute path in System32, the arguments written here and nowhere else, the
 * drive letter from `SystemDrive` rather than from the request. Their output
 * comes back as text; it is parsed in the unelevated process
 * (`system/parse.js`), so the code that runs as administrator stays as small
 * as it can be. `mft.enumerate` and `usn.query` (A2) and `prefetch.list` (D1)
 * come later.
 *
 * DISM writes its own log under `C:\Windows\Logs\DISM` while it analyses; that
 * is DISM's doing and the only thing on disk any of these touch.
 */

const path = require('node:path');
const { execFile } = require('node:child_process');

const { measureTree } = require('../system/walk');

/**
 * A Windows tool by absolute path, never by name.
 *
 * This process is elevated. Resolving `whoami.exe` through PATH would run the
 * first file of that name in any folder on the PATH -- on the machine this was
 * written on that is Git's coreutils, which rejected the arguments, and on
 * somebody else's it could be anything the user can write to, now running as
 * administrator.
 */
function system32(exe) {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe);
}

/**
 * The mandatory integrity level of this process, from its own token.
 *
 * `whoami /groups` lists the token's groups including its integrity label; a
 * SID of S-1-16-12288 is High (elevated), S-1-16-16384 is System. Read by SID
 * rather than by the label's name, which Windows translates.
 */
function integrityLevel() {
  if (process.platform !== 'win32') return Promise.resolve(process.getuid && process.getuid() === 0 ? 'high' : 'medium');
  return new Promise((resolve) => {
    execFile(system32('whoami.exe'), ['/groups', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return resolve('unknown');
      const text = String(stdout);
      if (text.includes('S-1-16-16384')) return resolve('system');
      if (text.includes('S-1-16-12288')) return resolve('high');
      if (text.includes('S-1-16-8192')) return resolve('medium');
      if (text.includes('S-1-16-4096')) return resolve('low');
      return resolve('unknown');
    });
  });
}

/** The system drive, as `C:`. From the environment, never from a request. */
function systemDrive() {
  const drive = String(process.env.SystemDrive || 'C:');
  return /^[A-Za-z]:$/.test(drive) ? drive.toUpperCase() : 'C:';
}

/**
 * Every Windows tool an operation may run, with every argument it is run with.
 * A function only where the drive letter goes in.
 */
const TOOLS = Object.freeze({
  shadowstorage: { exe: 'vssadmin.exe', args: () => ['list', 'shadowstorage'], timeoutMs: 60000 },
  // `/English` makes DISM speak English whatever the display language, which
  // is what lets its output be parsed by label at all.
  dism: { exe: 'Dism.exe', args: () => ['/Online', '/Cleanup-Image', '/AnalyzeComponentStore', '/English'], timeoutMs: 20 * 60000 },
  ntfsinfo: { exe: 'fsutil.exe', args: () => ['fsinfo', 'ntfsinfo', systemDrive()], timeoutMs: 60000 },
  storagereserve: { exe: 'fsutil.exe', args: () => ['storagereserve', 'query', systemDrive()], timeoutMs: 60000 },
});

const MAX_OUTPUT = 512 * 1024;

/** Run one tool from the table and hand back what it printed. */
function runTool(name) {
  const tool = TOOLS[name];
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      system32(tool.exe),
      tool.args(),
      { windowsHide: true, timeout: tool.timeoutMs, encoding: 'buffer', maxBuffer: MAX_OUTPUT },
      (err, stdout, stderr) => {
        // These tools print ASCII in English; `latin1` keeps every byte of
        // anything else rather than turning it into replacement characters.
        resolve({
          exitCode: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          timedOut: Boolean(err && err.killed),
          text: Buffer.concat([stdout || Buffer.alloc(0), stderr || Buffer.alloc(0)]).toString('latin1').slice(0, MAX_OUTPUT),
          ms: Date.now() - started,
        });
      }
    );
  });
}

/** At most this many folders in one request: more than the walk ever lists. */
const MAX_DIRS = 5000;

/**
 * The folders a request may ask to have measured: absolute, already in their
 * normal form, on the system drive, and nothing that could be a pattern.
 */
function acceptableDir(dir) {
  if (typeof dir !== 'string' || dir.length < 4 || dir.length > 1024) return false;
  if (!path.win32.isAbsolute(dir) || path.win32.normalize(dir) !== dir) return false;
  if (/[*?"<>|]/.test(dir.slice(2))) return false;
  return dir.slice(0, 3).toUpperCase() === `${systemDrive()}\\`;
}

const OPS = Object.freeze({
  async ping() {
    const level = await integrityLevel();
    return { pid: process.pid, integrity: level, elevated: level === 'high' || level === 'system' };
  },

  /**
   * How much each of the given folders occupies. Sums only: no file name
   * inside any of them leaves this process.
   */
  async 'system.breakdown'(args) {
    const dirs = Array.isArray(args && args.dirs) ? args.dirs : [];
    if (dirs.length > MAX_DIRS) throw new Error(`at most ${MAX_DIRS} folders`);
    const refused = dirs.filter((d) => !acceptableDir(d));
    if (refused.length > 0) throw new Error(`not a folder on ${systemDrive()}: ${String(refused[0]).slice(0, 80)}`);
    const started = Date.now();
    const sums = [];
    for (const dir of dirs) {
      const out = await measureTree(dir);
      const all = out.buckets.all || { allocated: 0, logical: 0, files: 0 };
      sums.push({ dir, allocated: all.allocated, logical: all.logical, files: all.files, denied: out.deniedCount });
    }
    return { sums, ms: Date.now() - started };
  },

  'shadowstorage.query'() {
    return runTool('shadowstorage');
  },

  'dism.analyze'() {
    return runTool('dism');
  },

  'ntfs.info'() {
    return runTool('ntfsinfo');
  },

  'storagereserve.query'() {
    return runTool('storagereserve');
  },
});

function has(op) {
  return typeof op === 'string' && Object.prototype.hasOwnProperty.call(OPS, op);
}

module.exports = { OPS, TOOLS, has, integrityLevel, system32, systemDrive, acceptableDir, MAX_DIRS };
