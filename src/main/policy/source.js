'use strict';

/**
 * The policy this process is under, read when asked and kept until asked again
 * (H2).
 *
 * Group Policy refreshes in the background every 90 minutes or so, and the
 * window can stay open for days, so a policy read once at launch would go
 * stale. Reading costs one or two reg.exe processes (25-50 ms measured), which
 * is nothing for a click and too much for every getter, so it is re-read where
 * it decides something -- before an action, before a run, when a screen asks
 * for its state -- and the last answer is kept for everything else.
 *
 * Whether the acting half may apply (`biz.policy`) is not this module's
 * question: it is handed `acting` by services.js, the way the journal is
 * handed a sealer (H4), and never loads the licence.
 */

const { readPolicy } = require('./read');
const { interpret, emptyPolicy } = require('./interpret');

class PolicySource {
  /**
   * @param {object} options
   * @param {string|null} options.key   null: no policy here at all (an isolated harness)
   * @param {boolean} [options.acting]  whether CleanDrive Business is in this copy
   * @param {object} [options.env]
   * @param {number} [options.minMinutes]
   * @param {Function} [options.read]   for the harness
   */
  constructor({ key, acting = false, env = process.env, minMinutes = 1, read = readPolicy, settleMs = 750 } = {}) {
    this.key = key === undefined ? null : key;
    this.acting = acting;
    this.env = env;
    this.minMinutes = minMinutes;
    this._read = read;
    this._settleMs = settleMs;
    this._value = null;
    this.readCount = 0;
  }

  async _readOnce() {
    this.readCount += 1;
    try {
      return await this._read({ key: this.key });
    } catch (err) {
      return { status: 'unreadable', key: this.key, via: null, tree: {}, error: err && err.message ? err.message : String(err) };
    }
  }

  /**
   * Read the registry again and interpret it. Never throws.
   *
   * A policy that was there and now is not is read a second time, a moment
   * later, before it is believed. The harness caught the reason: a read that
   * lands while the key is being written again -- deleted, then imported --
   * finds nothing, and "nothing" is "no restrictions". Group Policy rewrites
   * its keys the same way when it refreshes [Inference: not measured here,
   * there is no domain], so a window open for days would otherwise sometimes
   * let one click through on a policy that never went away.
   */
  async refresh() {
    let raw = await this._readOnce();
    if (this._value && this._value.status === 'present' && raw.status !== 'present') {
      await new Promise((resolve) => setTimeout(resolve, this._settleMs));
      raw = await this._readOnce();
    }
    this._value = interpret(raw, { acting: this.acting, env: this.env, minMinutes: this.minMinutes });
    return this._value;
  }

  /** The policy, read once if it never has been. */
  async ensure() {
    return this._value || this.refresh();
  }

  /** The last answer, or "no policy" before the first read. */
  current() {
    return this._value || emptyPolicy({ key: this.key });
  }

  /** Whether anything has been read in this process. */
  get loaded() {
    return this._value !== null;
  }
}

module.exports = { PolicySource };
