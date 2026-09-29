'use strict';

/**
 * One unattended run at a time, across processes (G4).
 *
 * With several profiles on their own timetables, two of them can come due in
 * the same minute, and Task Scheduler will happily start both -- two processes
 * that know nothing about each other, each about to walk folders and delete
 * files. The spec asks for a named mutex. Node has no named mutex and Electron
 * exposes none, so this is a lock *file*, which does the same job on Windows
 * for the same reason: `open(..., 'wx')` either creates the file or fails, and
 * the OS decides which caller wins.
 *
 * ## Why this is not `requestSingleInstanceLock`
 *
 * Electron has a cross-process lock already, and `main.js` deliberately does
 * not take it for a scheduled run -- the comment there says why: the cleanup
 * would be cancelled on any night the user happened to have the app open. A
 * maintenance task that skips itself whenever you are using the computer looks
 * configured and does nothing. So this lock is held only against *other
 * unattended runs*, never against the window.
 *
 * ## The reason that is not about disks
 *
 * Two runs walking the disk at once is merely slow. The real damage is the run
 * log: `RunLog.append` reads the whole file, unshifts, and writes it back. Two
 * processes doing that within a second of each other lose one run's record
 * entirely -- and a record of what was deleted while nobody was watching is
 * the one thing this app cannot afford to lose.
 *
 * ## A lock nobody holds
 *
 * A machine that loses power mid-run leaves the file behind. A lock that can
 * outlive its owner is a feature that breaks itself after one bad night, so
 * the file carries the pid and the time, and a waiter treats it as free when
 * the process is gone, or when it is older than `staleAfterMs` -- whichever
 * comes first. Both checks, because a pid can be reused and a long run is not
 * a dead one.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const DEFAULTS = Object.freeze({
  /**
   * How long a later profile waits for the one in front.
   *
   * Long enough that two profiles set to the same minute both run -- a small
   * cleanup finishes well inside this -- and short enough that the waiting
   * process is not still sitting there at breakfast. Past it, the run is
   * skipped and says so, which the spec allows and which is the honest
   * outcome: the work will come round again on its own timetable.
   */
  waitMs: 90_000,
  pollMs: 500,
  /** Past this a held lock is presumed abandoned even if the pid is alive. */
  staleAfterMs: 60 * 60 * 1000,
});

/** Is that process still there? */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to somebody else, which still counts.
    return err.code === 'EPERM';
  }
}

async function readHolder(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // Unreadable or half-written: treated as a holder with nothing known
    // about it, so only the age test can free it.
    return null;
  }
}

/**
 * Take the lock, or say why not.
 *
 * @param {string} file   the lock file's path (one per installation)
 * @param {object} [options]
 * @param {string} [options.holder]      what to record as the owner, for the log
 * @param {number} [options.waitMs]      0 to try once and give up
 * @param {object} [options.deps]        `now` and `sleep`, for the harness
 * @returns {Promise<{ok: boolean, release: Function, waitedMs: number,
 *   heldBy: object|null, reason: string|null}>}
 */
async function acquire(file, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const deps = options.deps || {};
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const started = now();

  await fsp.mkdir(path.dirname(path.resolve(file)), { recursive: true });

  let lastHolder = null;
  for (;;) {
    try {
      const handle = await fsp.open(file, 'wx');
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, holder: options.holder || null, at: now() }),
          'utf8'
        );
      } finally {
        await handle.close();
      }
      return { ok: true, release: () => release(file), waitedMs: now() - started, heldBy: null, reason: null };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }

    lastHolder = await readHolder(file);

    /*
     * How old is it, when the file will not say?
     *
     * A lock being written *right now* is unreadable for a moment, and the
     * first version of this treated "cannot read it" as "nobody holds it" --
     * which is the one answer that lets two unattended runs start at once,
     * exactly what the lock is for. So the age comes from the filesystem when
     * it cannot come from the contents, and only when neither can answer is it
     * presumed ancient.
     */
    /*
     * Never negative.
     *
     * `Date.now()` on Windows moves in steps of about 15 ms while an NTFS
     * timestamp is far finer, so a file written a moment ago can carry a time
     * *after* the clock reading it, and the subtraction comes out negative. A
     * lock is not younger than no time at all, and a negative age compared
     * against a threshold gives an answer that depends on how the two clocks
     * happened to line up. `test-profiles.js` failed on exactly this, twice, in
     * runs where nothing about the lock had changed.
     */
    const ageOf = (from) => Math.max(0, now() - from);

    let age = lastHolder && Number.isFinite(lastHolder.at) ? ageOf(lastHolder.at) : null;
    if (age === null) {
      try {
        age = ageOf((await fsp.stat(file)).mtimeMs);
      } catch {
        // Gone between the failed create and here: go round again and take it.
        continue;
      }
    }
    const abandoned = age > opts.staleAfterMs || (lastHolder && !alive(lastHolder.pid));

    if (abandoned) {
      // Whoever wrote it is gone. Remove it and go round again rather than
      // assuming the removal makes this process the owner -- another waiter
      // may create it first, and then this one waits for that, correctly.
      try {
        await fsp.rm(file, { force: true });
      } catch {
        // Somebody else got there first; the next loop finds out.
      }
      continue;
    }

    if (now() - started >= opts.waitMs) {
      return {
        ok: false,
        release: () => Promise.resolve(false),
        waitedMs: now() - started,
        heldBy: lastHolder,
        reason: 'busy',
      };
    }
    await sleep(opts.pollMs);
  }
}

/** Give it up. Safe to call twice, and safe when the file is already gone. */
async function release(file) {
  try {
    await fsp.rm(path.resolve(file), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Who holds it right now, or null. For the screen, never for a decision. */
async function inspect(file) {
  const holder = await readHolder(file);
  if (!holder) return null;
  return { ...holder, running: alive(holder.pid) };
}

module.exports = { acquire, release, inspect, alive, DEFAULTS };
