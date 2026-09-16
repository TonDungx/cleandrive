'use strict';

const { diskUsage, volumeRoot } = require('./disk');
const { pathKey } = require('./util');

/**
 * Watching the disk fill up.
 *
 * The naive version of this feature -- check every minute, notify whenever
 * usage is above the threshold -- produces an alert every minute forever once
 * the disk crosses 85%, which is how a useful warning becomes something the
 * user turns off. Three things prevent that here:
 *
 *   - **Edge triggering.** A notification fires when the level *changes*, not
 *     while it is high. Sitting at 88% is one alert, not one per minute.
 *   - **Hysteresis.** The level only falls again once usage drops a couple of
 *     points below the threshold it crossed. A disk hovering at exactly 85.0%
 *     would otherwise flip state on rounding noise and alert repeatedly.
 *   - **Snooze.** An explicit "not now" that holds for a set period.
 *
 * The class holds state and no I/O policy: it is handed a clock and a reader so
 * the whole state machine can be tested without a disk, a timer, or a wait.
 */

/** How far usage must fall below a threshold before that level re-arms. */
const HYSTERESIS_PERCENT = 2;

const LEVELS = { ok: 0, warn: 1, critical: 2 };

class DiskMonitor {
  /**
   * @param {object}   options
   * @param {string[]} options.volumes          paths whose volumes are watched
   * @param {number}   [options.warnPercent=85]
   * @param {number}   [options.criticalPercent=95]
   * @param {number}   [options.intervalSeconds=60]
   * @param {number}   [options.snoozeMinutes=60]
   * @param {Function} [options.read]           injectable disk reader
   * @param {Function} [options.now]            injectable clock
   */
  constructor(options = {}) {
    this.warnPercent = options.warnPercent ?? 85;
    this.criticalPercent = options.criticalPercent ?? 95;
    this.intervalSeconds = options.intervalSeconds ?? 60;
    this.snoozeMinutes = options.snoozeMinutes ?? 60;

    this.read = options.read || diskUsage;
    this.now = options.now || (() => Date.now());

    this.volumes = new Map(); // volumeRoot -> { path, usage, level }
    this.setVolumes(options.volumes || []);

    this.snoozedUntil = 0;
    this.timer = null;
    this.listeners = new Set();
    this.lastCheckedAt = 0;
  }

  /** Watch the volumes these paths sit on, one entry per distinct volume. */
  setVolumes(paths) {
    const next = new Map();
    for (const target of paths) {
      if (typeof target !== 'string' || target.trim() === '') continue;
      const root = volumeRoot(target);
      const key = pathKey(root);
      if (next.has(key)) continue;
      // Preserve the level of a volume we were already watching, so editing the
      // list does not re-alert for a disk whose state has not changed.
      const existing = this.volumes.get(key);
      next.set(key, existing || { root, path: target, usage: null, level: 'ok' });
    }
    this.volumes = next;
  }

  /** @param {(event: object) => void} listener @returns {() => void} unsubscribe */
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must not stop the monitor.
      }
    }
  }

  /**
   * The level a reading implies, given the level it is coming from.
   *
   * Rising uses the plain threshold; falling requires clearing it by the
   * hysteresis margin. That asymmetry is the entire anti-flap mechanism.
   */
  levelFor(usedPercent, previous) {
    const margin = previous === 'ok' ? 0 : HYSTERESIS_PERCENT;

    if (usedPercent >= this.criticalPercent) return 'critical';
    if (previous === 'critical' && usedPercent >= this.criticalPercent - margin) return 'critical';
    if (usedPercent >= this.warnPercent) return 'warn';
    if (previous !== 'ok' && usedPercent >= this.warnPercent - margin) return 'warn';
    return 'ok';
  }

  /** Read every watched volume once and report any level changes. */
  async check() {
    this.lastCheckedAt = this.now();
    const changes = [];

    for (const [key, entry] of this.volumes) {
      const usage = await this.read(entry.path);
      entry.usage = usage;

      if (!usage || usage.ok !== true) {
        // An unreadable volume is not an emergency and not an all-clear; leave
        // the level where it was rather than inventing a transition.
        continue;
      }

      const previous = entry.level;
      const level = this.levelFor(usage.usedPercent, previous);
      entry.level = level;

      if (level !== previous) {
        changes.push({
          root: entry.root,
          path: entry.path,
          usage,
          from: previous,
          to: level,
          rising: LEVELS[level] > LEVELS[previous],
        });
      }
      this.volumes.set(key, entry);
    }

    const snoozed = this.isSnoozed();
    for (const change of changes) {
      // A rising edge while snoozed is still recorded -- the state machine must
      // not re-alert for it later -- but nothing is announced.
      this.emit({ type: 'level', ...change, suppressed: snoozed && change.rising });
    }

    this.emit({ type: 'reading', volumes: this.snapshot(), snoozed });
    return this.snapshot();
  }

  /** Current state of every watched volume. */
  snapshot() {
    return [...this.volumes.values()].map((entry) => ({
      root: entry.root,
      path: entry.path,
      level: entry.level,
      usage: entry.usage,
    }));
  }

  /** The volume in the worst state, for the tray icon and tooltip. */
  worst() {
    let worst = null;
    for (const entry of this.volumes.values()) {
      if (!entry.usage || entry.usage.ok !== true) continue;
      if (!worst || entry.usage.usedPercent > worst.usage.usedPercent) worst = entry;
    }
    return worst;
  }

  isSnoozed() {
    return this.now() < this.snoozedUntil;
  }

  /**
   * Silence alerts for a while.
   *
   * Deliberately not persisted. Snoozing is a statement about the next hour,
   * not a setting, and a "quiet" flag that survives restarts is one nobody
   * remembers turning on.
   */
  snooze(minutes = this.snoozeMinutes) {
    this.snoozedUntil = this.now() + Math.max(1, minutes) * 60 * 1000;
    this.emit({ type: 'snoozed', until: this.snoozedUntil });
    return this.snoozedUntil;
  }

  clearSnooze() {
    this.snoozedUntil = 0;
    this.emit({ type: 'snoozed', until: 0 });
  }

  start() {
    if (this.timer) return;
    // Checked immediately so the tray shows a real figure rather than a
    // placeholder for the first interval.
    this.check().catch(() => {});
    this.timer = setInterval(() => this.check().catch(() => {}), this.intervalSeconds * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  get running() {
    return this.timer !== null;
  }
}

module.exports = { DiskMonitor, HYSTERESIS_PERCENT, LEVELS };
