'use strict';

/**
 * Which programs are running, by image name.
 *
 * `tasklist /FO CSV` is used because the image name column is a filename, not a
 * translated string -- the same reasoning that keeps scheduler.js away from
 * parsing localised output. It is run by its absolute path in System32: the
 * unattended cleanup used to ask for plain `tasklist.exe`, which is whatever
 * the PATH finds first, and on the machine this was written on the PATH puts
 * Git's own tools ahead of Windows' (its `whoami.exe` answered for the real
 * one once already).
 *
 * A failure to enumerate returns null rather than an empty set, so a caller can
 * tell "nothing is running" apart from "we could not find out", and treat the
 * second as a reason not to delete anything.
 */

const path = require('node:path');
const { execFile } = require('node:child_process');

const tasklist = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');

/** @returns {Promise<Set<string>|null>} lowercased image names */
function runningProcessNames() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      tasklist(),
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        const names = new Set();
        for (const line of String(stdout).split(/\r?\n/)) {
          const match = /^"([^"]+)"/.exec(line.trim());
          if (match) names.add(match[1].toLowerCase());
        }
        resolve(names.size > 0 ? names : null);
      }
    );
  });
}

module.exports = { runningProcessNames, tasklist };
