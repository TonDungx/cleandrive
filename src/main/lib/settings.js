'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const { renameRetrying } = require('./atomic');

const i18n = require('../../i18n');
const { ALLOWED_ADVISOR_NAMES } = require('../automatic/allowed-categories');
const themePalette = require('../../shared/theme-palette');

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

/**
 * The shape of the file, and how an older one becomes this one.
 *
 * A migration runs on the parsed file *before* coercion, so it only has to say
 * what changed; every value it produces still goes through the same clamps as
 * a value typed by hand. Migrations only ever go forward. An older build that
 * reads a newer file coerces what it understands and warns about the rest,
 * which is what it has always done with a key it did not know.
 *
 *   1 -> 2   `snapshots`: how many folder snapshots to keep (roadmap 0.6/0.7)
 *   2 -> 3   known apps' caches (D4) join `autoClean.categories` wherever
 *            `gpucache` was on -- see the migration for why
 *   3 -> 4   `quarantine`: where files moved to another drive go, how long
 *            before they are called expired, and whether originals are
 *            deleted outright (B1)
 *   4 -> 5   `appearance.custom`: the user's own colours, or null (I2)
 *   5 -> 6   `explorer.contextMenu`: CleanDrive in Explorer's right-click
 *            menu, off (I3)
 */
const SCHEMA_VERSION = 6;

const MIGRATIONS = Object.freeze([
  {
    from: 1,
    to: 2,
    migrate(raw) {
      // Additive. The defaults are what the snapshot store used before there
      // was anywhere to change them.
      return { ...raw, version: 2, snapshots: { keepRecent: 12, keepMonthly: 12, ...(raw.snapshots || {}) } };
    },
  },
  {
    from: 2,
    to: 3,
    migrate(raw) {
      // Chrome's and Edge's compiled-code and GPU caches used to be "GPU &
      // compiled-code caches"; they now belong to each browser's own
      // category, which the run only touches while that browser is closed.
      // Somebody who had the GPU category on was having those caches cleaned,
      // so they keep having them cleaned -- now safely. Nobody else gains
      // anything they did not ask for.
      const auto = isObject(raw.autoClean) ? raw.autoClean : null;
      const categories = auto && Array.isArray(auto.categories) ? auto.categories : null;
      if (!categories || !categories.some((c) => String(c).toLowerCase() === 'gpucache')) return { ...raw, version: 3 };
      const added = APP_CATEGORIES.filter((c) => !categories.includes(c));
      return { ...raw, version: 3, autoClean: { ...auto, categories: [...categories, ...added] } };
    },
  },
  {
    from: 3,
    to: 4,
    migrate(raw) {
      // Additive, and off: no folder is chosen, and nothing is ever deleted
      // outright until somebody switches that on.
      return {
        ...raw,
        version: 4,
        quarantine: { zone: null, retentionDays: 30, maxGB: 0, deleteOriginal: false, ...(raw.quarantine || {}) },
      };
    },
  },
  {
    from: 4,
    to: 5,
    migrate(raw) {
      // Additive: nobody has colours of their own yet. `theme` keeps its
      // three values, so the version before this one still reads the file and
      // shows the light or dark theme a custom one was built on.
      const appearance = isObject(raw.appearance) ? raw.appearance : {};
      return { ...raw, version: 5, appearance: { custom: null, ...appearance } };
    },
  },
  {
    from: 5,
    to: 6,
    migrate(raw) {
      // Additive, and off: nothing is written to the registry until somebody
      // switches the menu on in Settings.
      return { ...raw, version: 6, explorer: { contextMenu: false, ...(isObject(raw.explorer) ? raw.explorer : {}) } };
    },
  },
]);

/**
 * Bring a parsed file up to this version, one step at a time.
 *
 * A file with no version is a version 1 file: that is the only version that
 * ever omitted it.
 *
 * @returns {{raw: object, from: number, steps: number}}
 */
function migrate(raw) {
  if (!isObject(raw)) return { raw, from: SCHEMA_VERSION, steps: 0 };
  const from = Number.isInteger(raw.version) ? raw.version : 1;
  let current = raw;
  let version = from;
  let steps = 0;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) break;
    current = step.migrate(current);
    version = step.to;
    steps += 1;
  }
  return { raw: current, from, steps };
}

/**
 * The categories an unattended run may be allowed into -- the hard whitelist
 * in `automatic/allowed-categories.js`, in the advisor's own names. It is read
 * from there rather than written again here, so the settings file and the run
 * cannot disagree about what 2am may touch.
 *
 * `buildoutput` is deliberately absent from the default set: it is safe by the
 * advisor's rules, but "safe to delete" and "safe to delete at 2am while you
 * are not looking" are different bars. A developer can opt into it.
 */
const SAFE_CATEGORIES = [...ALLOWED_ADVISOR_NAMES];
// Known apps' caches (D4) are on by default: the run only takes one while that
// app is closed, and a browser's cache is among the most rebuilt things on a disk.
const APP_CATEGORIES = SAFE_CATEGORIES.filter((c) => c.startsWith('app.'));
const DEFAULT_CATEGORIES = ['temp', 'cache', 'crashdump', 'log', 'gpucache', ...APP_CATEGORIES];

/**
 * Process image names that mean "somebody is working right now". An unattended
 * cleanup that runs while an IDE is open can delete a cache the IDE is holding
 * open, or a build output it is about to link against.
 */
const DEFAULT_SKIP_PROCESSES = ['Code.exe', 'Docker Desktop.exe', 'idea64.exe', 'pycharm64.exe'];

/**
 * `minutes` is a fixed interval rather than a wall-clock appointment, and it
 * exists so the feature can be *proved* rather than believed. "It runs at 02:00
 * even with the app closed" is a claim nobody can check without staying up, and
 * one that was wrong here for a fortnight without anything on screen saying so.
 * A five-minute interval turns that claim into something testable over a cup of
 * coffee: close the app, wait, reopen it, read the run log.
 */
const SCHEDULE_KINDS = ['minutes', 'daily', 'weekly', 'monthly'];

/**
 * 'system' follows the OS and is the default. It is not merely the polite
 * choice: someone who has set their machine to switch at sunset has already
 * expressed a preference, and an app that ignores it is the one glowing white
 * at midnight.
 */
const THEMES = ['system', 'light', 'dark'];

/**
 * 'system' follows the OS here too, and for the same reason -- but the OS
 * setting it follows is the *display language*, not the regional format. A
 * machine can perfectly well be set to show English menus while formatting
 * dates the Vietnamese way, and this machine is: `getSystemLocale()` answers
 * `vi-VN` while the Windows display language is English. Reading the format
 * setting would hand somebody a Vietnamese app they never asked for.
 */
const LANGUAGES = ['system', ...i18n.CODES];

/** The top-level groups `patch` merges one level into. */
const SECTIONS = ['autoClean', 'purge', 'monitor', 'appearance', 'updates', 'trends', 'snapshots', 'quarantine', 'explorer'];

/** Hard ceilings. These are not preferences -- they bound the blast radius. */
const LIMITS = {
  minAgeDays: { min: 7, max: 3650, fallback: 180 },
  maxItemsPerRun: { min: 1, max: 200000, fallback: 20000 },
  minDiskUsedPercent: { min: 0, max: 100, fallback: 0 },
  purgeAfterDays: { min: 1, max: 365, fallback: 7 },
  // 15s is the floor because the check is a statfs call and costs nothing, but
  // a value of 0 would spin a timer flat out.
  monitorIntervalSeconds: { min: 15, max: 3600, fallback: 60 },
  // The floor is raised to MIN_MINUTES_PACKAGED in a build people install; see
  // SettingsStore's `minMinutes`. One minute is for a developer watching it
  // work, not for somebody's laptop.
  everyMinutes: { min: 1, max: 1440, fallback: 15 },
  warnPercent: { min: 50, max: 99, fallback: 85 },
  criticalPercent: { min: 51, max: 100, fallback: 95 },
  snoozeMinutes: { min: 5, max: 1440, fallback: 60 },
  // Snapshots per folder: the newest few, plus one a month. At least one
  // recent one, or the next scan would have nothing to be compared with.
  snapshotKeepRecent: { min: 1, max: 100, fallback: 12 },
  snapshotKeepMonthly: { min: 0, max: 60, fallback: 12 },
  // Days before a quarantined file is called expired -- which is only said,
  // never acted on -- and the most the folder may hold, in GB (0: no limit
  // but the drive's own room).
  quarantineRetentionDays: { min: 1, max: 365, fallback: 30 },
  quarantineMaxGB: { min: 0, max: 100000, fallback: 0 },
  roots: 32,
  whitelist: 256,
  skipIfRunning: 64,
  monitorVolumes: 16,
};

/**
 * The shortest interval an installed build will accept.
 *
 * Each interval run starts a fresh process that scans the configured folders,
 * so a one-minute interval on a real machine is a scanner running essentially
 * without pause. That is a fine thing to watch on purpose and a bad thing to
 * leave switched on, so the installed app declines it and says why.
 */
const MIN_MINUTES_PACKAGED = 5;

function defaults() {
  return {
    version: SCHEMA_VERSION,
    autoClean: {
      enabled: false,
      // Starts in dry-run on purpose. The first scheduled run should tell you
      // what it would have deleted, not tell you what it did.
      dryRun: true,
      schedule: {
        kind: 'weekly',
        time: '02:00',
        weekday: 0,
        day: 1,
        everyMinutes: LIMITS.everyMinutes.fallback,
        // Windows' own catch-up for a missed appointment can take ten minutes
        // after logon and applies only to occurrences it considers missed, so
        // "does it survive a restart" is not answerable by watching. An
        // explicit logon trigger makes the answer arrive in two minutes.
        catchUpAtLogon: false,
      },
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
      language: 'system',
      // The user's own colours (I2): { enabled, name, base, colors }, or null.
      // While enabled they are drawn instead of the theme above -- and instead
      // of a Windows contrast theme, which was the user's call to make.
      custom: null,
    },
    trends: {
      /**
       * A daily measurement of the disk, taken whether or not anybody opens
       * the app.
       *
       * Without this the Trends tab is a chart of when the user happened to
       * feel like running a scan, which is not a time series -- and it was
       * empty in practice, because the only samplers were a manual scan and a
       * cleanup that most people have switched off. The sampler is its own
       * Task Scheduler entry rather than part of the cleanup task, so trends
       * do not require anyone to enable automatic deletion.
       *
       * On by default because it costs one short process a day that reads free
       * space and writes one line of JSON. Measured on a packaged build: 672ms
       * from launch to exit. It never deletes anything and it never opens a
       * window.
       */
      dailySample: true,
      sampleTime: '12:00',
    },
    snapshots: {
      // A compressed tree of each scan, kept so two can be compared. Twelve of
      // the newest and one a month for a year is at most 24 per folder -- a
      // few hundred kilobytes each for a home folder.
      keepRecent: LIMITS.snapshotKeepRecent.fallback,
      keepMonthly: LIMITS.snapshotKeepMonthly.fallback,
    },
    quarantine: {
      // The `CleanDrive Quarantine` folder on another drive, once somebody has
      // chosen where. Only `quarantine:choose` sets it, after checking it.
      zone: null,
      retentionDays: LIMITS.quarantineRetentionDays.fallback,
      maxGB: LIMITS.quarantineMaxGB.fallback,
      // Off by default (decided 2026-09-24). With it off the original goes to
      // the Recycle Bin, which frees nothing on its drive until the bin is
      // emptied; with it on the copy on the other drive is the only one left.
      deleteOriginal: false,
    },
    explorer: {
      // "Analyse with CleanDrive" and "Find duplicates with CleanDrive" in
      // Explorer's right-click menu (I3). Off by default (decided 2026-09-25):
      // the app writes nothing to the registry until somebody asks it to.
      contextMenu: false,
    },
    updates: {
      // On by default. This is distributed to people with no support channel,
      // so a fix that never reaches them is not a fix -- but it is the only
      // thing in the app that contacts the internet, so it is switchable and
      // the UI says what it does.
      enabled: true,
      // The version running last time the app started. When it differs from the
      // current one, an update has just been applied and the app says so --
      // an update that finishes in silence leaves people unsure it worked.
      lastVersion: null,
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

function coerceSchedule(value, warnings, minMinutes = 1) {
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

  // The floor is a build-time policy, not a stored preference, so it is applied
  // here rather than written into LIMITS: the same settings file read by an
  // installed app and by a checkout gets the same answer for everything else.
  const spec = { ...LIMITS.everyMinutes, min: Math.max(LIMITS.everyMinutes.min, minMinutes) };
  const everyMinutes = clampInt(
    value.everyMinutes === undefined ? base.everyMinutes : value.everyMinutes,
    spec,
    'autoClean.schedule.everyMinutes',
    // Only worth reporting when this schedule actually uses it.
    kind === 'minutes' ? warnings : []
  );

  // Defaults to on for the interval kind, because that kind exists to be
  // observed and a run that appears within two minutes of logging back in is
  // the observation. The appointment kinds leave it off: an extra cleanup at
  // every logon is not what "every Sunday at 02:00" means.
  const catchUpAtLogon =
    typeof value.catchUpAtLogon === 'boolean' ? value.catchUpAtLogon : kind === 'minutes';

  return { kind, time, weekday, day, everyMinutes, catchUpAtLogon };
}

/**
 * Turn arbitrary parsed JSON into a settings object that is safe to act on.
 *
 * @param {*} raw
 * @param {object} [options]
 * @param {number} [options.minMinutes]  floor for an interval schedule; an
 *   installed build passes MIN_MINUTES_PACKAGED.
 * @returns {{settings: object, warnings: string[]}}
 */
/**
 * The user's own colours, held to the same rules the editor and an imported
 * file are held to (src/shared/theme-palette.js). A palette that fails any of
 * them -- somebody edited the file by hand, or a later version tightened a
 * rule -- is dropped with a warning, and the window falls back to the theme
 * underneath rather than drawing text nobody can read.
 */
function coerceCustom(value, warnings) {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) {
    warnings.push('appearance.custom: not an object, so it was dropped');
    return null;
  }
  const shaped = themePalette.normalise({
    format: themePalette.FORMAT,
    version: themePalette.VERSION,
    name: value.name === undefined ? '' : value.name,
    base: value.base,
    colors: value.colors,
  });
  if (!shaped.ok) {
    warnings.push(`appearance.custom: ${shaped.errors.map((e) => i18n.render(e)).join('; ')}`);
    return null;
  }
  const verdict = themePalette.check(shaped.theme);
  if (!verdict.ok) {
    warnings.push(`appearance.custom: fails ${verdict.failures.length} of the colour rules, so it was dropped`);
    return null;
  }
  const { name, base, colors } = shaped.theme;
  return { enabled: bool(value.enabled, false), name, base, colors };
}

function coerceSettings(input, { minMinutes = 1 } = {}) {
  const warnings = [];
  const base = defaults();
  if (!isObject(input)) {
    if (input !== undefined && input !== null) warnings.push('settings: not an object, using defaults');
    return { settings: base, warnings };
  }

  const { raw, from } = migrate(input);
  if (from > SCHEMA_VERSION) {
    warnings.push(
      `settings.version: this file was written by a newer CleanDrive (version ${from}); ` +
        `only what version ${SCHEMA_VERSION} understands was read`
    );
  }

  const rawAuto = isObject(raw.autoClean) ? raw.autoClean : {};
  const rawPurge = isObject(raw.purge) ? raw.purge : {};
  const rawMonitor = isObject(raw.monitor) ? raw.monitor : {};

  const autoClean = {
    enabled: bool(rawAuto.enabled, base.autoClean.enabled),
    dryRun: bool(rawAuto.dryRun, base.autoClean.dryRun),
    schedule: coerceSchedule(rawAuto.schedule, warnings, minMinutes),
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

  const language = LANGUAGES.includes(rawAppearance.language)
    ? rawAppearance.language
    : base.appearance.language;
  if (rawAppearance.language !== undefined && !LANGUAGES.includes(rawAppearance.language)) {
    warnings.push(`appearance.language: "${rawAppearance.language}" is not one of ${LANGUAGES.join(', ')}`);
  }

  const custom = coerceCustom(rawAppearance.custom, warnings);

  const rawUpdates = isObject(raw.updates) ? raw.updates : {};
  const updates = {
    enabled: bool(rawUpdates.enabled, base.updates.enabled),
    lastVersion: typeof rawUpdates.lastVersion === 'string' ? rawUpdates.lastVersion : null,
  };

  const rawTrends = isObject(raw.trends) ? raw.trends : {};
  const trends = {
    dailySample: bool(rawTrends.dailySample, base.trends.dailySample),
    sampleTime: coerceTime(
      rawTrends.sampleTime === undefined ? base.trends.sampleTime : rawTrends.sampleTime,
      'trends.sampleTime',
      warnings,
      base.trends.sampleTime
    ),
  };

  const rawSnapshots = isObject(raw.snapshots) ? raw.snapshots : {};
  const snapshots = {
    keepRecent: clampInt(
      rawSnapshots.keepRecent === undefined ? base.snapshots.keepRecent : rawSnapshots.keepRecent,
      LIMITS.snapshotKeepRecent,
      'snapshots.keepRecent',
      warnings
    ),
    keepMonthly: clampInt(
      rawSnapshots.keepMonthly === undefined ? base.snapshots.keepMonthly : rawSnapshots.keepMonthly,
      LIMITS.snapshotKeepMonthly,
      'snapshots.keepMonthly',
      warnings
    ),
  };

  const rawQuarantine = isObject(raw.quarantine) ? raw.quarantine : {};
  let zone = null;
  if (typeof rawQuarantine.zone === 'string' && rawQuarantine.zone.trim() !== '') {
    if (path.isAbsolute(rawQuarantine.zone.trim())) zone = path.resolve(rawQuarantine.zone.trim());
    else warnings.push(`quarantine.zone: "${rawQuarantine.zone}" is not absolute, ignored`);
  }
  const quarantine = {
    zone,
    retentionDays: clampInt(
      rawQuarantine.retentionDays === undefined ? base.quarantine.retentionDays : rawQuarantine.retentionDays,
      LIMITS.quarantineRetentionDays,
      'quarantine.retentionDays',
      warnings
    ),
    maxGB: clampInt(
      rawQuarantine.maxGB === undefined ? base.quarantine.maxGB : rawQuarantine.maxGB,
      LIMITS.quarantineMaxGB,
      'quarantine.maxGB',
      warnings
    ),
    deleteOriginal: bool(rawQuarantine.deleteOriginal, base.quarantine.deleteOriginal),
  };

  return {
    settings: {
      version: SCHEMA_VERSION,
      autoClean,
      purge,
      monitor,
      appearance: { theme, language, custom },
      updates,
      trends,
      snapshots,
      quarantine,
      explorer: {
        contextMenu: bool(isObject(raw.explorer) ? raw.explorer.contextMenu : undefined, base.explorer.contextMenu),
      },
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
  /**
   * @param {string} filePath
   * @param {object} [options]
   * @param {number} [options.minMinutes]  floor for an interval schedule
   */
  constructor(filePath, { minMinutes = 1 } = {}) {
    this.filePath = path.resolve(filePath);
    this.minMinutes = minMinutes;
    this.warnings = [];
    /**
     * Whether the file was actually there the last time it was read.
     *
     * This is not the same question as "are the settings valid", and telling
     * them apart matters: a missing file yields the defaults, and the defaults
     * say automatic cleanup is off. Something that reconciles the OS against
     * the settings would then read "off" as an instruction and delete a
     * scheduled task the user had configured — which is very close to what
     * happened here. A missing file means "intent unknown", and the app says so
     * instead of acting on it.
     */
    this.exists = false;
    this.fileVersion = null;
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
      this.exists = false;
      this._cache = defaults();
      return this._cache;
    }

    this.exists = true;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.warnings = ['settings: file is not valid JSON, using defaults'];
      this._cache = defaults();
      return this._cache;
    }

    // Remembered so the first save over an older file can keep a copy of it.
    this.fileVersion = isObject(parsed) && Number.isInteger(parsed.version) ? parsed.version : 1;

    const { settings, warnings } = coerceSettings(parsed, { minMinutes: this.minMinutes });
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
   *
   * Throws if the bytes did not reach the disk. That sounds obvious and it is
   * the whole point of this method's history: the failure used to be swallowed,
   * so a save that never happened returned success, the settings screen said
   * "Saved. Next run Sunday 02:00", and the schedule it described did not
   * exist. A cleaner that reports a configuration it does not have is worse
   * than one that refuses to save.
   */
  async save(next) {
    const { settings, warnings } = coerceSettings(next, { minMinutes: this.minMinutes });
    this.warnings = warnings;

    await this._keepOlderVersion();

    // Serialised: two saves racing on the same temp name would interleave. An
    // earlier save's failure must not fail this one, so the chain is joined on
    // both settlements -- but *this* write's own failure is re-thrown below.
    const write = this._writeChain.then(
      () => this._writeAtomic(settings),
      () => this._writeAtomic(settings)
    );
    this._writeChain = write.catch(() => {});
    await write;

    // Only after the write: the cache is meant to be what is on disk, and a
    // failed save that left a new value in memory would have the next patch()
    // merge on top of something no process could read back.
    this._cache = settings;
    this.exists = true;
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

  /**
   * Before the first save replaces a file written by an older version, keep
   * that file as `settings.v<N>.json`.
   *
   * The migration from 1 to 2 only adds a section, so nothing is lost by it.
   * The copy is for the migration that one day is not so kind, and for going
   * back to an older build: its settings are then still where it left them.
   * Written once, never overwritten, and never read by the app.
   */
  async _keepOlderVersion() {
    if (!this.exists || !Number.isInteger(this.fileVersion) || this.fileVersion >= SCHEMA_VERSION) return;
    const copy = path.join(path.dirname(this.filePath), `settings.v${this.fileVersion}.json`);
    try {
      await fsp.copyFile(this.filePath, copy, fs.constants.COPYFILE_EXCL);
    } catch {
      // Already kept by an earlier save, or the original is gone. Neither is a
      // reason to refuse the save the user asked for.
    }
    this.fileVersion = SCHEMA_VERSION;
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

    await renameRetrying(temp, this.filePath);
  }
}

module.exports = {
  SettingsStore,
  coerceSettings,
  migrate,
  MIGRATIONS,
  defaults,
  MIN_MINUTES_PACKAGED,
  SCHEMA_VERSION,
  SAFE_CATEGORIES,
  DEFAULT_CATEGORIES,
  DEFAULT_SKIP_PROCESSES,
  SCHEDULE_KINDS,
  THEMES,
  LANGUAGES,
  SECTIONS,
  LIMITS,
};
