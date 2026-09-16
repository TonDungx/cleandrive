'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

/**
 * Persisted application settings.
 *
 * Until now the only thing this app wrote outside the Recycle Bin was the hash
 * cache, and that was a deliberate property worth stating: nothing the app
 * remembered could change what it deleted. Automatic cleanup breaks that -- a
 * run that nobody watches has to read its policy from somewhere.
 *
 * So this file is treated as untrusted input even though we wrote it. It is
 * plain JSON on disk, editable by hand, and it is read by a headless process
 * that will delete files based on it. Every value is coerced and clamped on
 * load; anything unrecognised is dropped and reported in `warnings` rather than
 * being allowed through. A corrupt file yields defaults, never an exception,
 * because the alternative is a scheduled task that silently stops running.
 */

const SCHEMA_VERSION = 1;

/**
 * Advisor categories whose verdict is 'safe' (see CATEGORIES in advisor.js).
 * `buildoutput` is deliberately absent from the default set: it is safe by the
 * advisor's rules, but "safe to delete" and "safe to delete at 2am while you
 * are not looking" are different bars. A developer can opt into it.
 */
const SAFE_CATEGORIES = ['temp', 'cache', 'crashdump', 'log', 'gpucache', 'buildoutput'];
const DEFAULT_CATEGORIES = ['temp', 'cache', 'crashdump', 'log', 'gpucache'];

/**
 * Process image names that mean "somebody is working right now". An unattended
 * cleanup that runs while an IDE is open can delete a cache the IDE is holding
 * open, or a build output it is about to link against.
 */
const DEFAULT_SKIP_PROCESSES = ['Code.exe', 'Docker Desktop.exe', 'idea64.exe', 'pycharm64.exe'];

const SCHEDULE_KINDS = ['daily', 'weekly', 'monthly'];

/**
 * 'system' follows the OS and is the default. It is not merely the polite
 * choice: someone who has set their machine to switch at sunset has already
 * expressed a preference, and an app that ignores it is the one glowing white
 * at midnight.
 */
const THEMES = ['system', 'light', 'dark'];

/** The top-level groups `patch` merges one level into. */
const SECTIONS = ['autoClean', 'purge', 'monitor', 'appearance', 'updates'];

/** Hard ceilings. These are not preferences -- they bound the blast radius. */
const LIMITS = {
  minAgeDays: { min: 7, max: 3650, fallback: 180 },
  maxItemsPerRun: { min: 1, max: 200000, fallback: 20000 },
  minDiskUsedPercent: { min: 0, max: 100, fallback: 0 },
  purgeAfterDays: { min: 1, max: 365, fallback: 7 },
  // 15s is the floor because the check is a statfs call and costs nothing, but
  // a value of 0 would spin a timer flat out.
  monitorIntervalSeconds: { min: 15, max: 3600, fallback: 60 },
  warnPercent: { min: 50, max: 99, fallback: 85 },
  criticalPercent: { min: 51, max: 100, fallback: 95 },
  snoozeMinutes: { min: 5, max: 1440, fallback: 60 },
  roots: 32,
  whitelist: 256,
  skipIfRunning: 64,
  monitorVolumes: 16,
};

function defaults() {
  return {
    version: SCHEMA_VERSION,
    autoClean: {
      enabled: false,
      // Starts in dry-run on purpose. The first scheduled run should tell you
      // what it would have deleted, not tell you what it did.
      dryRun: true,
      schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1 },
      roots: [],
      whitelist: [],
      categories: [...DEFAULT_CATEGORIES],
      minAgeDays: LIMITS.minAgeDays.fallback,
      // 0 = run regardless of how full the disk is.
      minDiskUsedPercent: 0,
      skipIfRunning: [...DEFAULT_SKIP_PROCESSES],
      maxItemsPerRun: LIMITS.maxItemsPerRun.fallback,
      notify: true,
    },
    purge: {
      // Emptying part of the Recycle Bin is the only thing this app does that
      // cannot be undone, so it is off until switched on explicitly.
      enabled: false,
      afterDays: LIMITS.purgeAfterDays.fallback,
    },
    monitor: {
      // Off by default, and the reason is the same one that kept the scheduled
      // cleanup out of a resident timer: this is the only setting in the app
      // that keeps a process alive after the window is closed. That is a real
      // cost in memory, and it should be a choice rather than a default.
      enabled: false,
      // Empty means "the volume this app is installed on" -- resolved at
      // startup, because the system drive letter is not knowable here.
      volumes: [],
      warnPercent: LIMITS.warnPercent.fallback,
      criticalPercent: LIMITS.criticalPercent.fallback,
      intervalSeconds: LIMITS.monitorIntervalSeconds.fallback,
      snoozeMinutes: LIMITS.snoozeMinutes.fallback,
      // Only consulted while monitoring is on: with it off there is nothing to
      // keep running, so closing the window quits as it always has.
      closeToTray: true,
    },
    appearance: {
      theme: 'system',
    },
    updates: {
      // On by default. This is distributed to people with no support channel,
      // so a fix that never reaches them is not a fix -- but it is the only
      // thing in the app that contacts the internet, so it is switchable and
      // the UI says what it does.
      enabled: true,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* coercion                                                                    */
/* -------------------------------------------------------------------------- */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function clampInt(value, spec, key, warnings) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    warnings.push(`${key}: not a number, using ${spec.fallback}`);
    return spec.fallback;
  }
  const rounded = Math.round(n);
  if (rounded < spec.min) {
    warnings.push(`${key}: ${rounded} is below the minimum of ${spec.min}`);
    return spec.min;
  }
  if (rounded > spec.max) {
    warnings.push(`${key}: ${rounded} is above the maximum of ${spec.max}`);
    return spec.max;
  }
  return rounded;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/** "HH:MM", 24-hour. Anything else falls back rather than scheduling at a guess. */
function coerceTime(value, key, warnings, fallback) {
  if (typeof value === 'string') {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (match) {
      const h = Number(match[1]);
      const m = Number(match[2]);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }
  }
  warnings.push(`${key}: not a valid HH:MM time, using ${fallback}`);
  return fallback;
}

/**
 * Absolute paths only, de-duplicated, capped. A relative path in a config read
 * by a headless process resolves against whatever directory the scheduler
 * happened to start it in, which is not a thing to leave to chance.
 */
function coercePaths(value, key, warnings, cap) {
  if (!Array.isArray(value)) {
    if (value !== undefined) warnings.push(`${key}: not a list, ignored`);
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') continue;
    const resolved = path.resolve(entry.trim());
    if (!path.isAbsolute(entry.trim())) {
      warnings.push(`${key}: "${entry}" is not absolute, ignored`);
      continue;
    }
    const dedupeKey = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(resolved);
    if (out.length >= cap) {
      warnings.push(`${key}: more than ${cap} entries, the rest were dropped`);
      break;
    }
  }
  return out;
}

function coerceStrings(value, key, warnings, cap) {
  if (!Array.isArray(value)) {
    if (value !== undefined) warnings.push(`${key}: not a list, ignored`);
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') continue;
    const trimmed = entry.trim();
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

/** Only categories the advisor actually marks 'safe' may be auto-deleted. */
function coerceCategories(value, warnings) {
  if (!Array.isArray(value)) {
    if (value !== undefined) warnings.push('autoClean.categories: not a list, using defaults');
    return [...DEFAULT_CATEGORIES];
  }
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const key = entry.trim().toLowerCase();
    if (!SAFE_CATEGORIES.includes(key)) {
      warnings.push(`autoClean.categories: "${entry}" is not an auto-cleanable category, ignored`);
      continue;
    }
    if (!out.includes(key)) out.push(key);
  }
  // An empty list would mean "delete nothing", which is a confusing way to
  // express "disabled" -- say so rather than scheduling a no-op forever.
  if (out.length === 0) warnings.push('autoClean.categories: empty, no files will match');
  return out;
}

function coerceSchedule(value, warnings) {
  const base = defaults().autoClean.schedule;
  if (!isObject(value)) {
    if (value !== undefined) warnings.push('autoClean.schedule: not an object, using defaults');
    return base;
  }

  const kind = SCHEDULE_KINDS.includes(value.kind) ? value.kind : base.kind;
  if (!SCHEDULE_KINDS.includes(value.kind) && value.kind !== undefined) {
    warnings.push(`autoClean.schedule.kind: "${value.kind}" is not one of ${SCHEDULE_KINDS.join(', ')}`);
  }

  const time = coerceTime(value.time, 'autoClean.schedule.time', warnings, base.time);

  let weekday = Number(value.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    if (value.weekday !== undefined) warnings.push('autoClean.schedule.weekday: must be 0 (Sunday) to 6');
    weekday = base.weekday;
  }

  // Capped at 28 deliberately: a monthly task set to the 30th simply does not
  // fire in February, and a cleaner that silently skips a month is worse than
  // one that runs three days early.
  let day = Number(value.day);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    if (value.day !== undefined) warnings.push('autoClean.schedule.day: must be 1-28 (28 is the cap so every month fires)');
    day = base.day;
  }

  return { kind, time, weekday, day };
}

/**
 * Turn arbitrary parsed JSON into a settings object that is safe to act on.
 *
 * @returns {{settings: object, warnings: string[]}}
 */
function coerceSettings(raw) {
  const warnings = [];
  const base = defaults();
  if (!isObject(raw)) {
    if (raw !== undefined && raw !== null) warnings.push('settings: not an object, using defaults');
    return { settings: base, warnings };
  }

  if (raw.version !== undefined && raw.version !== SCHEMA_VERSION) {
    warnings.push(`settings.version: found ${raw.version}, expected ${SCHEMA_VERSION}`);
  }

  const rawAuto = isObject(raw.autoClean) ? raw.autoClean : {};
  const rawPurge = isObject(raw.purge) ? raw.purge : {};
  const rawMonitor = isObject(raw.monitor) ? raw.monitor : {};

  const autoClean = {
    enabled: bool(rawAuto.enabled, base.autoClean.enabled),
    dryRun: bool(rawAuto.dryRun, base.autoClean.dryRun),
    schedule: coerceSchedule(rawAuto.schedule, warnings),
    roots: coercePaths(rawAuto.roots, 'autoClean.roots', warnings, LIMITS.roots),
    whitelist: coercePaths(rawAuto.whitelist, 'autoClean.whitelist', warnings, LIMITS.whitelist),
    categories: coerceCategories(rawAuto.categories, warnings),
    minAgeDays: clampInt(
      rawAuto.minAgeDays === undefined ? base.autoClean.minAgeDays : rawAuto.minAgeDays,
      LIMITS.minAgeDays,
      'autoClean.minAgeDays',
      warnings
    ),
    minDiskUsedPercent: clampInt(
      rawAuto.minDiskUsedPercent === undefined ? base.autoClean.minDiskUsedPercent : rawAuto.minDiskUsedPercent,
      LIMITS.minDiskUsedPercent,
      'autoClean.minDiskUsedPercent',
      warnings
    ),
    skipIfRunning:
      rawAuto.skipIfRunning === undefined
        ? [...base.autoClean.skipIfRunning]
        : coerceStrings(rawAuto.skipIfRunning, 'autoClean.skipIfRunning', warnings, LIMITS.skipIfRunning),
    maxItemsPerRun: clampInt(
      rawAuto.maxItemsPerRun === undefined ? base.autoClean.maxItemsPerRun : rawAuto.maxItemsPerRun,
      LIMITS.maxItemsPerRun,
      'autoClean.maxItemsPerRun',
      warnings
    ),
    notify: bool(rawAuto.notify, base.autoClean.notify),
  };

  // Enabling a cleanup with nothing to clean is a misconfiguration, not a
  // preference. Refuse to call it enabled rather than run an empty task nightly.
  if (autoClean.enabled && autoClean.roots.length === 0) {
    warnings.push('autoClean: enabled but no folders are listed, so it was left off');
    autoClean.enabled = false;
  }

  const purge = {
    enabled: bool(rawPurge.enabled, base.purge.enabled),
    afterDays: clampInt(
      rawPurge.afterDays === undefined ? base.purge.afterDays : rawPurge.afterDays,
      LIMITS.purgeAfterDays,
      'purge.afterDays',
      warnings
    ),
  };

  const monitor = {
    enabled: bool(rawMonitor.enabled, base.monitor.enabled),
    volumes: coercePaths(rawMonitor.volumes, 'monitor.volumes', warnings, LIMITS.monitorVolumes),
    warnPercent: clampInt(
      rawMonitor.warnPercent === undefined ? base.monitor.warnPercent : rawMonitor.warnPercent,
      LIMITS.warnPercent,
      'monitor.warnPercent',
      warnings
    ),
    criticalPercent: clampInt(
      rawMonitor.criticalPercent === undefined ? base.monitor.criticalPercent : rawMonitor.criticalPercent,
      LIMITS.criticalPercent,
      'monitor.criticalPercent',
      warnings
    ),
    intervalSeconds: clampInt(
      rawMonitor.intervalSeconds === undefined ? base.monitor.intervalSeconds : rawMonitor.intervalSeconds,
      LIMITS.monitorIntervalSeconds,
      'monitor.intervalSeconds',
      warnings
    ),
    snoozeMinutes: clampInt(
      rawMonitor.snoozeMinutes === undefined ? base.monitor.snoozeMinutes : rawMonitor.snoozeMinutes,
      LIMITS.snoozeMinutes,
      'monitor.snoozeMinutes',
      warnings
    ),
    closeToTray: bool(rawMonitor.closeToTray, base.monitor.closeToTray),
  };

  // A critical threshold at or below the warning one would mean the disk is
  // "critical" before it is ever "low", and the warning level would be
  // unreachable. Push critical above rather than silently accept the inversion.
  if (monitor.criticalPercent <= monitor.warnPercent) {
    const corrected = Math.min(LIMITS.criticalPercent.max, monitor.warnPercent + 1);
    warnings.push(
      `monitor.criticalPercent: ${monitor.criticalPercent}% is not above the warning level of ` +
        `${monitor.warnPercent}%, so it was raised to ${corrected}%`
    );
    monitor.criticalPercent = corrected;
  }

  const rawAppearance = isObject(raw.appearance) ? raw.appearance : {};
  const theme = THEMES.includes(rawAppearance.theme) ? rawAppearance.theme : base.appearance.theme;
  if (rawAppearance.theme !== undefined && !THEMES.includes(rawAppearance.theme)) {
    warnings.push(`appearance.theme: "${rawAppearance.theme}" is not one of ${THEMES.join(', ')}`);
  }

  const rawUpdates = isObject(raw.updates) ? raw.updates : {};
  const updates = { enabled: bool(rawUpdates.enabled, base.updates.enabled) };

  return {
    settings: {
      version: SCHEMA_VERSION,
      autoClean,
      purge,
      monitor,
      appearance: { theme },
      updates,
    },
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* store                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A settings file on disk.
 *
 * Writes go to a sibling temp file and are renamed into place, so a crash or a
 * power cut during a save leaves the previous settings intact rather than a
 * half-written file that the next scheduled run would read as "no policy".
 */
class SettingsStore {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.warnings = [];
    this._cache = null;
    this._writeChain = Promise.resolve();
  }

  /** Read and validate. Never throws; a bad file yields defaults plus warnings. */
  async load() {
    let text;
    try {
      text = await fsp.readFile(this.filePath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.warnings = [`settings: could not be read (${err.code}), using defaults`];
      } else {
        this.warnings = [];
      }
      this._cache = defaults();
      return this._cache;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.warnings = ['settings: file is not valid JSON, using defaults'];
      this._cache = defaults();
      return this._cache;
    }

    const { settings, warnings } = coerceSettings(parsed);
    this.warnings = warnings;
    this._cache = settings;
    return settings;
  }

  /** The last loaded value, loading it first if that has not happened yet. */
  async get() {
    return this._cache ? this._cache : this.load();
  }

  /**
   * Validate and persist. Returns the value actually stored, which may differ
   * from the input wherever a value was clamped or dropped.
   */
  async save(next) {
    const { settings, warnings } = coerceSettings(next);
    this.warnings = warnings;
    this._cache = settings;

    // Serialise writes: two saves racing on the same temp name would interleave.
    this._writeChain = this._writeChain.then(() => this._writeAtomic(settings)).catch(() => {});
    await this._writeChain;
    return { settings, warnings };
  }

  /**
   * Merge a partial into the current settings, then save.
   *
   * Merging happens one level down, per section, so a caller that sends only
   * `{ monitor: { enabled: false } }` keeps its thresholds and its volume list.
   * A wholesale `save()` of that object would quietly reset everything it did
   * not mention to the defaults — which is what the settings screen was doing
   * every time it saved, because the form it builds does not carry the theme.
   *
   * Keys the caller *does* send still replace outright, so an empty `roots: []`
   * genuinely empties the list.
   */
  async patch(partial) {
    const current = await this.get();
    const merged = { ...current, ...partial };

    for (const section of SECTIONS) {
      merged[section] = { ...current[section], ...(partial && partial[section]) };
    }

    return this.save(merged);
  }

  async _writeAtomic(settings) {
    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    const body = `${JSON.stringify(settings, null, 2)}\n`;

    let handle;
    try {
      handle = await fsp.open(temp, 'w');
      await handle.writeFile(body, 'utf8');
      // Rename is atomic but does not imply the bytes reached the platter; a
      // scheduled task reading this after a hard reset deserves the real file.
      await handle.sync();
    } finally {
      if (handle) await handle.close();
    }

    await fsp.rename(temp, this.filePath);
  }
}

module.exports = {
  SettingsStore,
  coerceSettings,
  defaults,
  SCHEMA_VERSION,
  SAFE_CATEGORIES,
  DEFAULT_CATEGORIES,
  DEFAULT_SKIP_PROCESSES,
  SCHEDULE_KINDS,
  THEMES,
  SECTIONS,
  LIMITS,
};
