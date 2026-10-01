'use strict';

/**
 * The settings store every process uses, with the organisation's policy laid
 * over it (H2).
 *
 * A wrapper rather than a change to SettingsStore, so the file's own rules --
 * coercion, migration, atomic writes, the copy of an older version -- stay in
 * one place and are not taught about policy at all. Everything that reads
 * settings goes through `load()` or `get()` and is handed the effective view;
 * everything that writes goes through `save()` or `patch()`, and what reaches
 * the disk is put back to the file's own values wherever the policy has its
 * hand on a field (effective.js).
 *
 * The policy is read by `load()` -- which already means "read it again from
 * disk" -- and not by `get()`, which answers from memory like the store it
 * wraps. A process that never reads the policy (the daily sampler, which only
 * wants to know which volumes to measure) never pays for it: `load({ policy:
 * false })`.
 */

const { SECTIONS } = require('../lib/settings');
const { effective, toFile } = require('./effective');

class ManagedSettingsStore {
  /**
   * @param {object} inner          a SettingsStore
   * @param {() => object} source   the PolicySource, asked for lazily
   */
  constructor(inner, source) {
    this.inner = inner;
    this._source = source;
  }

  get policy() {
    return this._source();
  }

  /* The wrapped store's own facts, unchanged. */
  get filePath() {
    return this.inner.filePath;
  }
  get minMinutes() {
    return this.inner.minMinutes;
  }
  get exists() {
    return this.inner.exists;
  }
  get fileVersion() {
    return this.inner.fileVersion;
  }
  get warnings() {
    return this.inner.warnings;
  }

  _view(file) {
    const source = this.policy;
    return effective(file, source.current());
  }

  /** Read the file and the policy afresh. */
  async load({ policy = true } = {}) {
    const file = await this.inner.load();
    if (policy) await this.policy.refresh();
    return this._view(file);
  }

  /** The last loaded value; the policy is read once if this process never has. */
  async get() {
    const file = await this.inner.get();
    if (!this.policy.loaded) await this.policy.ensure();
    return this._view(file);
  }

  /** The file as it is, with no policy over it. For the code that writes it back, and the harness. */
  async file() {
    return this.inner.get();
  }

  async save(next) {
    const file = await this.inner.get();
    const { settings, warnings } = await this.inner.save(toFile(next, file, this.policy.current()));
    return { settings: this._view(settings), warnings };
  }

  /**
   * SettingsStore's merge -- one level down per section -- done against the
   * effective view the caller was shown, then put back to file values.
   */
  async patch(partial) {
    const current = await this.get();
    const merged = { ...current, ...partial };
    for (const section of SECTIONS) {
      merged[section] = { ...current[section], ...(partial && partial[section]) };
    }
    return this.save(merged);
  }
}

module.exports = { ManagedSettingsStore };
