'use strict';

/**
 * The console's work, apart from its window (H3): read the share, compare
 * with what it remembers, hand the window rows, and write a CSV when asked.
 *
 * Kept free of Electron so `scripts/test-fleet.js` can run it against a real
 * folder under plain Node. The window, the dialogs and the licence question
 * live in console-main.js.
 *
 * ## A share that hangs
 *
 * Measured (2026-10-02): a server address that does not answer holds a read
 * for about 42 seconds. A read runs off the window's thread, so the window
 * stays usable and says it is reading; a second request while one is under
 * way joins it instead of starting another, so pressing "Read again" ten times
 * does not queue ten 42-second waits.
 */

const shareLib = require('./share');
const model = require('./console-model');

class ConsoleService {
  /**
   * @param {object} options
   * @param {string|null} options.share
   * @param {boolean|(() => boolean)} options.allowed  biz.console, decided by the caller --
   *   or the question, asked afresh each time, so a licence bought while the console is open counts
   * @param {{load: Function, save: Function}} options.memory
   * @param {(code: number) => string|null} [options.describeResult]  Task Scheduler code in words
   * @param {Function} [options.readReports]
   * @param {() => number} [options.now]
   */
  constructor({ share = null, allowed = false, memory, describeResult = () => null, readReports = shareLib.readReports, now = () => Date.now() }) {
    this.share = share;
    this._allowed = allowed;
    this.memory = memory;
    this.describeResult = describeResult;
    this.readReports = readReports;
    this.now = now;
    this.last = null;
    this.pending = null;
  }

  get allowed() {
    return typeof this._allowed === 'function' ? Boolean(this._allowed()) : Boolean(this._allowed);
  }

  info() {
    return { share: this.share, allowed: this.allowed, readAt: this.last ? this.last.readAt : null };
  }

  setShare(folder) {
    this.share = folder;
    this.last = null;
  }

  /** Read the share now, or join the read already under way. */
  read() {
    if (!this.pending) {
      this.pending = this._read().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  async _read() {
    const share = this.share;
    const started = this.now();
    if (!this.allowed) return { allowed: false, share };
    if (!share) return { allowed: true, share: null };

    const listing = await this.readReports(share);
    const readAt = this.now();
    if (!listing.ok) {
      return { allowed: true, share, readAt, ms: readAt - started, ok: false, code: listing.code, error: listing.error };
    }
    const seen = await this.memory.load();
    const built = model.build(listing.files, seen, share, readAt);
    try {
      await this.memory.save(built.seen);
    } catch (err) {
      console.warn('[console] the memory of seals could not be saved:', err.message);
    }
    for (const m of built.machines) this._word(m);
    const result = {
      allowed: true,
      share,
      readAt,
      ms: readAt - started,
      ok: true,
      truncated: listing.truncated === true,
      machines: built.machines,
      unreadable: built.unreadable,
      thresholds: { staleDays: model.STALE_MS / 86400000, fillsSoonDays: model.FILLS_SOON_DAYS, nearlyFullPercent: model.NEARLY_FULL_PERCENT },
    };
    // Only a read of the share the window is still pointed at is kept.
    if (share === this.share) this.last = result;
    return result;
  }

  /** Task Scheduler's numbers in this console's words, before they go to the window. */
  _word(machine) {
    for (const p of machine.tasks ? machine.tasks.profiles : []) {
      if (p.os && p.os.lastResult !== null) p.os.resultText = this.describeResult(p.os.lastResult);
    }
    if (machine.lastRun && machine.lastRun.result !== null) machine.lastRun.resultText = this.describeResult(machine.lastRun.result);
    for (const a of machine.attention) if (a.code === 'taskFailed') a.resultText = this.describeResult(a.result);
  }

  /** The last read as CSV, or null when there is nothing to export. */
  csv(render) {
    if (!this.last || !this.last.ok) return null;
    return model.toCsv(this.last.machines, render);
  }

  /** Start one machine's seal memory again from its next report. */
  async forget(host) {
    if (!this.allowed || !this.share || typeof host !== 'string') return false;
    const seen = await this.memory.load();
    await this.memory.save(model.forget(seen, this.share, host));
    return true;
  }
}

module.exports = { ConsoleService };
