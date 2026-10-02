'use strict';

/**
 * Remove a harness's throwaway folders once the harness has exited.
 *
 * Chromium keeps files open in userData (and Electron keeps an `.asar` it
 * has looked into) until the process ends, so a harness that removes its
 * sandbox from inside itself -- at the end, or in `process.on('exit')` -- is
 * refused and leaves it behind. Found 2026-10-02: 780 such folders, ~972 MB,
 * in %TEMP% (ROADMAP §11 row 32). `test-idle.js` had the answer already: a
 * small detached process that waits for this one to be gone, then removes
 * the folder. This is that, for every harness.
 *
 * Called once, as soon as the folder exists: the waiter keeps watching for as
 * long as the harness runs, however long that is. Measured 2026-10-02 with
 * test-idle: a normal run leaves nothing; the main process killed
 * (`taskkill /PID`) -- its userData is still removed; the whole tree killed
 * (`taskkill /T`) takes the waiter with it, and the folder stays. Fixtures a
 * harness makes later and removes at its own end are not covered when it is
 * killed.
 *
 * It removes only what a harness could have made: an absolute path directly
 * inside the temp folder, named `cleandrive…` or `cd-…`. It never follows a
 * link (Node's rm unlinks a junction or symlink rather than entering it).
 *
 * @param {...string} dirs
 * @returns {string} the first folder, so it can wrap the expression that made it
 */
function removeAfterExit(...dirs) {
  const os = require('node:os');
  const path = require('node:path');
  const tmp = path.resolve(os.tmpdir()).toLowerCase();
  for (const dir of dirs) {
    const full = path.resolve(dir);
    if (path.dirname(full).toLowerCase() !== tmp || !/^(cleandrive|cd-)/i.test(path.basename(full))) {
      throw new Error(`sandbox: refusing to schedule removal of ${dir} -- not a harness folder directly in ${os.tmpdir()}`);
    }
  }
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  require('node:child_process')
    .spawn(process.execPath, [path.join(__dirname, 'sandbox-cleaner.js'), String(process.pid), ...dirs.map((d) => path.resolve(d))], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    })
    .unref();
  return dirs[0];
}

module.exports = { removeAfterExit };
