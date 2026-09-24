'use strict';

/**
 * The last step of every "write a temporary file, then rename it over the
 * real one" in this app, made to survive Windows.
 *
 * On Windows a rename onto a file that another process has open without
 * FILE_SHARE_DELETE fails with EPERM (sometimes EACCES or EBUSY) -- and
 * something often does have it open for a moment: an antivirus scanner looking
 * at what was just written, the search indexer, a backup agent. It is brief,
 * and it is not a reason for a save to fail. Seen here: one run in seven of the
 * end-to-end test, `EPERM: operation not permitted, rename 'settings.json.<pid>.tmp'
 * -> 'settings.json'`, on a machine where OneDrive had just started and was
 * churning through the disk. To the user that is "Save" failing at random.
 *
 * So the rename is tried again, a few times over a fraction of a second, for
 * those three codes only; anything else is a real error and is thrown at once.
 * The same approach as graceful-fs, without the dependency.
 */

const fsp = require('node:fs/promises');

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
const ATTEMPTS = 6;
const STEP_MS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} from
 * @param {string} to
 * @param {object} [options]  injectable, for the harness
 * @returns {Promise<{attempts: number}>}
 */
async function renameRetrying(from, to, { rename = fsp.rename, attempts = ATTEMPTS, stepMs = STEP_MS } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return { attempts: attempt };
    } catch (err) {
      if (!err || !RETRYABLE.has(err.code) || attempt >= attempts) throw err;
      // 30, 60, 90, 120, 150 ms: under half a second in all.
      await sleep(stepMs * attempt);
    }
  }
}

module.exports = { renameRetrying, RETRYABLE, ATTEMPTS };
