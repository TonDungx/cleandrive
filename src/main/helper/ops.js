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
 * The roadmap's list -- system.breakdown, shadowstorage.query, dism.analyze
 * (A1), mft.enumerate and usn.query (A2), prefetch.list (D1) -- arrives with
 * the features that specify them. Until then there is one operation, which
 * answers the only question the machinery itself raises: is the helper
 * actually running elevated?
 */

const path = require('node:path');
const { execFile } = require('node:child_process');

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

const OPS = Object.freeze({
  async ping() {
    const level = await integrityLevel();
    return { pid: process.pid, integrity: level, elevated: level === 'high' || level === 'system' };
  },
});

function has(op) {
  return typeof op === 'string' && Object.prototype.hasOwnProperty.call(OPS, op);
}

module.exports = { OPS, has, integrityLevel, system32 };
