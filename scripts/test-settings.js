#!/usr/bin/env node
'use strict';

// The settings file is read by a headless process that deletes files based on
// it, and it is plain JSON a user can edit by hand. So the coercion layer is
// treated as a security boundary, not a convenience: these cases are the ones
// where trusting the file would widen the blast radius.
//   node scripts/test-settings.js

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SettingsStore, coerceSettings, defaults, LIMITS } = require('../src/main/lib/settings');

/**
 * The harness still describes one policy at a time, because almost every
 * rule here is about one policy. These two put it where the file now keeps
 * it (G4) and take it back out, so the assertions below stay about the rule
 * they are testing rather than about the shape around it.
 */
const one = (partial = {}) => {
  const { autoClean, ...rest } = partial || {};
  // A partial that says nothing about the cleanup keeps saying nothing: a
  // patch of `{ purge }` must not replace the profile list with an empty one.
  if (!autoClean) return { ...rest };
  return { ...rest, autoClean: { profiles: [{ id: 'main', ...autoClean }] } };
};
const coerceOne = (partial, opts) => coerceSettings(one(partial), opts);
const first = (settings) => settings.autoClean.profiles[0];

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const SEP = path.sep;
const ABS = (...parts) => path.resolve(`C:${SEP}${parts.join(SEP)}`);

(async () => {
  console.log('\nsettings: defaults\n');

  const base = defaults();
  check('automatic cleanup is off out of the box', first(base).enabled === false);
  check('the first run would be a dry run', first(base).dryRun === true);
  check('purge is off out of the box', base.purge.enabled === false);
  check('no folders are targeted by default', first(base).roots.length === 0);
  check('build output is not auto-deleted by default',
    !first(base).categories.includes('buildoutput'));

  console.log('\nsettings: coercion of hostile input\n');

  {
    const { settings, warnings } = coerceOne({
      autoClean: { categories: ['cache', 'stale', 'appcache', 'archive', 'installer'] },
    });
    check('a review-only category cannot be scheduled for deletion',
      !first(settings).categories.includes('stale') &&
      !first(settings).categories.includes('appcache') &&
      !first(settings).categories.includes('archive') &&
      !first(settings).categories.includes('installer'),
      first(settings).categories.join(','));
    check('only the safe category survives', first(settings).categories.join(',') === 'cache');
    check('each rejection is reported', warnings.filter((w) => w.includes('not an auto-cleanable')).length === 4);
  }

  {
    const { settings, warnings } = coerceOne({ autoClean: { minAgeDays: 0 } });
    check('a zero-day age threshold is clamped up', first(settings).minAgeDays === LIMITS.minAgeDays.min,
      String(first(settings).minAgeDays));
    check('the clamp is reported', warnings.some((w) => w.includes('minAgeDays')));
  }

  {
    const { settings } = coerceOne({ autoClean: { minAgeDays: -99999, maxItemsPerRun: 9e9 } });
    check('a negative age is clamped, not negated', first(settings).minAgeDays === LIMITS.minAgeDays.min);
    check('an absurd per-run cap is clamped', first(settings).maxItemsPerRun === LIMITS.maxItemsPerRun.max);
  }

  {
    const { settings, warnings } = coerceOne({
      autoClean: { roots: ['relative/path', '', 42, ABS('Users', 'me', 'Downloads')] },
    });
    check('relative and non-string roots are dropped', first(settings).roots.length === 1,
      JSON.stringify(first(settings).roots));
    check('the absolute root survives', first(settings).roots[0] === ABS('Users', 'me', 'Downloads'));
    check('the dropped relative path is reported', warnings.some((w) => w.includes('not absolute')));
  }

  {
    const { settings, warnings } = coerceOne({ autoClean: { enabled: true, roots: [] } });
    check('enabling with no folders does not stay enabled', first(settings).enabled === false);
    check('and says why', warnings.some((w) => w.includes('no folders')));
  }

  {
    const { settings } = coerceOne({ autoClean: { enabled: true, roots: [ABS('Users', 'me', 'Downloads')] } });
    check('enabling with a folder does stay enabled', first(settings).enabled === true);
  }

  {
    const { settings, warnings } = coerceOne({ autoClean: { schedule: { kind: 'hourly', time: '25:61', day: 31 } } });
    check('an unknown schedule kind falls back', first(settings).schedule.kind === 'weekly',
      first(settings).schedule.kind);
    check('an impossible time falls back', first(settings).schedule.time === '02:00',
      first(settings).schedule.time);
    check('a monthly day past 28 falls back so every month fires',
      first(settings).schedule.day === 1, String(first(settings).schedule.day));
    check('all three are reported', warnings.length >= 3, warnings.join(' | '));
  }

  {
    const { settings } = coerceOne({ autoClean: { schedule: { time: '7:05' } } });
    check('a single-digit hour is zero-padded', first(settings).schedule.time === '07:05',
      first(settings).schedule.time);
  }

  {
    // "7:5" could mean 07:05 or 07:50. A cleanup time is not a thing to guess
    // at, so an ambiguous minute field is refused rather than interpreted.
    const { settings } = coerceOne({ autoClean: { schedule: { time: '7:5' } } });
    check('an ambiguous minute field is refused, not guessed',
      first(settings).schedule.time === '02:00', first(settings).schedule.time);
  }

  {
    const { settings } = coerceOne('not an object');
    check('a non-object file yields defaults', first(settings).enabled === false);
  }

  console.log('\nsettings: an interval schedule\n');

  {
    const { settings } = coerceOne({ autoClean: { schedule: { kind: 'minutes', everyMinutes: 5 } } });
    check('an interval kind is accepted', first(settings).schedule.kind === 'minutes');
    check('and its interval is kept', first(settings).schedule.everyMinutes === 5);
    // The interval kind exists to be watched working, so the run that proves a
    // restart did not break it is on by default for that kind only.
    check('the logon catch-up defaults on for an interval',
      first(settings).schedule.catchUpAtLogon === true);

    const weekly = coerceOne({ autoClean: { schedule: { kind: 'weekly' } } });
    check('and off for an appointment, which is not what "every Sunday" means',
      first(weekly.settings).schedule.catchUpAtLogon === false);

    const asked = coerceOne({ autoClean: { schedule: { kind: 'weekly', catchUpAtLogon: true } } });
    check('but an appointment can opt in', first(asked.settings).schedule.catchUpAtLogon === true);
  }

  {
    // The floor is a property of the build: a checkout may loop every minute to
    // watch it work, an installed copy may not turn a stranger's machine into a
    // scanner that never stops.
    const dev = coerceOne({ autoClean: { schedule: { kind: 'minutes', everyMinutes: 1 } } });
    check('a one-minute interval is allowed from source', first(dev.settings).schedule.everyMinutes === 1);

    const packaged = coerceOne(
      { autoClean: { schedule: { kind: 'minutes', everyMinutes: 1 } } },
      { minMinutes: 5 }
    );
    check('an installed build raises it to the floor',
      first(packaged.settings).schedule.everyMinutes === 5,
      String(first(packaged.settings).schedule.everyMinutes));
    check('and says it did',
      packaged.warnings.some((w) => w.includes('everyMinutes')), packaged.warnings.join(' | '));

    const silent = coerceOne(
      { autoClean: { schedule: { kind: 'weekly', everyMinutes: 1 } } },
      { minMinutes: 5 }
    );
    check('a clamp nobody asked about is not reported',
      !silent.warnings.some((w) => w.includes('everyMinutes')), silent.warnings.join(' | '));

    const absurd = coerceOne({ autoClean: { schedule: { kind: 'minutes', everyMinutes: 99999 } } });
    check('an interval longer than a day is clamped to a day',
      first(absurd.settings).schedule.everyMinutes === LIMITS.everyMinutes.max);
  }

  console.log('\nsettings: the daily disk measurement\n');

  {
    check('measuring is on out of the box', defaults().trends.dailySample === true);

    const { settings } = coerceOne({ trends: { dailySample: false, sampleTime: '6:30' } });
    check('it can be switched off', settings.trends.dailySample === false);
    check('and its time is normalised', settings.trends.sampleTime === '06:30');

    const bad = coerceOne({ trends: { sampleTime: 'lunchtime' } });
    check('an unreadable time falls back rather than scheduling at a guess',
      bad.settings.trends.sampleTime === '12:00', bad.settings.trends.sampleTime);
    check('and says so', bad.warnings.some((w) => w.includes('trends.sampleTime')), bad.warnings.join(' | '));

    const notAnObject = coerceOne({ trends: 'yes please' });
    check('trends given as a string does not throw', notAnObject.settings.trends.dailySample === true);
  }

  {
    const { settings } = coerceOne({ purge: { afterDays: 0 } });
    check('a zero-day grace period is clamped up', settings.purge.afterDays === LIMITS.purgeAfterDays.min);
  }

  {
    const dupe = ABS('Users', 'me', 'Downloads');
    const { settings } = coerceOne({ autoClean: { roots: [dupe, dupe.toUpperCase()] } });
    check('roots are de-duplicated case-insensitively on Windows',
      process.platform !== 'win32' || first(settings).roots.length === 1,
      JSON.stringify(first(settings).roots));
  }

  console.log('\nsettings: the file on disk\n');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-settings-'));
  const file = path.join(dir, 'settings.json');

  {
    const store = new SettingsStore(file);
    const loaded = await store.load();
    check('a missing file loads as defaults without throwing', first(loaded).enabled === false);
    check('and is not treated as an error', store.warnings.length === 0);
  }

  {
    await fsp.writeFile(file, '{ this is not json', 'utf8');
    const store = new SettingsStore(file);
    const loaded = await store.load();
    check('a corrupt file loads as defaults', first(loaded).enabled === false);
    check('and says so', store.warnings.some((w) => w.includes('not valid JSON')));
  }

  {
    const store = new SettingsStore(file);
    await store.save(one({ autoClean: { enabled: true, roots: [ABS('Users', 'me', 'Downloads')], minAgeDays: 90 } }));
    const reread = await new SettingsStore(file).load();
    check('a save round-trips', first(reread).minAgeDays === 90 && first(reread).enabled === true,
      JSON.stringify(first(reread).minAgeDays));
    check('saved JSON is readable by hand', (await fsp.readFile(file, 'utf8')).includes('\n  "autoClean"'));
  }

  {
    const store = new SettingsStore(file);
    await store.load();
    await store.patch(one({ purge: { enabled: true } }));
    const reread = await new SettingsStore(file).load();
    check('patch keeps untouched fields', first(reread).minAgeDays === 90);
    check('patch applies the change', reread.purge.enabled === true);
  }

  {
    // The settings screen builds its payload from the form, and the form does
    // not carry every section. A wholesale save of that payload reset the rest
    // to defaults -- silently, because nothing on screen showed the loss.
    const store = new SettingsStore(file);
    await store.load();
    await store.patch(one({
      monitor: { enabled: true, volumes: [ABS('Users', 'me')], warnPercent: 70 },
      appearance: { theme: 'light' },
    }));

    await store.patch(one({ autoClean: { minAgeDays: 45 } }));

    const reread = await new SettingsStore(file).load();
    check('patching one section leaves another alone',
      reread.monitor.warnPercent === 70 && reread.monitor.volumes.length === 1,
      `${reread.monitor.warnPercent}% / ${reread.monitor.volumes.length} volume(s)`);
    check('and leaves the theme alone', reread.appearance.theme === 'light', reread.appearance.theme);
    check('while applying what it did send', first(reread).minAgeDays === 45);

    // A key that *is* sent still replaces, so a list can genuinely be emptied.
    await store.patch(one({ monitor: { volumes: [] } }));
    const emptied = await new SettingsStore(file).load();
    check('an explicitly sent empty list does empty it', emptied.monitor.volumes.length === 0);
    check('without disturbing its neighbours', emptied.monitor.warnPercent === 70);
  }

  console.log('\nsettings: appearance\n');

  {
    check('the theme follows the system out of the box', defaults().appearance.theme === 'system');

    for (const theme of ['system', 'light', 'dark']) {
      const { settings } = coerceOne({ appearance: { theme } });
      check(`"${theme}" is accepted`, settings.appearance.theme === theme);
    }

    const { settings, warnings } = coerceOne({ appearance: { theme: 'solarized' } });
    check('an unknown theme falls back to system', settings.appearance.theme === 'system');
    check('and says so', warnings.some((w) => w.includes('appearance.theme')), warnings.join(' | '));

    const notAnObject = coerceOne({ appearance: 'dark' });
    check('appearance given as a string does not throw',
      notAnObject.settings.appearance.theme === 'system');
  }

  console.log('\nsettings: a save that did not happen must not report success\n');

  {
    // The failure this guards against is the one that made a configured
    // schedule vanish: the write error was swallowed, save() resolved, and the
    // screen said "Saved. Next run Sunday 02:00" for a schedule that was never
    // written down.
    const store = new SettingsStore(path.join(dir, 'unwritable', 'settings.json'));
    await store.load();
    check('a file that is not there reads as absent', store.exists === false);

    // A directory where the file should be: the rename cannot succeed.
    await fsp.mkdir(path.join(dir, 'unwritable', 'settings.json'), { recursive: true });

    let threw = null;
    try {
      await store.save(defaults());
    } catch (err) {
      threw = err;
    }
    check('a save that could not be written throws', threw !== null, threw ? threw.code || threw.message : 'resolved');
    check('and does not claim the file now exists', store.exists === false);

    await fsp.rm(path.join(dir, 'unwritable'), { recursive: true, force: true });
  }

  {
    const store = new SettingsStore(path.join(dir, 'fresh', 'settings.json'));
    await store.load();
    check('a fresh store reports no file', store.exists === false);
    await store.save(defaults());
    check('and reports one after a successful save', store.exists === true);
    await store.load();
    check('which survives a re-read', store.exists === true);
  }

  {
    // Concurrent saves must not interleave into a half-written file.
    const store = new SettingsStore(file);
    await store.load();
    await Promise.all([
      store.patch(one({ autoClean: { minAgeDays: 100 } })),
      store.patch(one({ autoClean: { minAgeDays: 200 } })),
      store.patch(one({ autoClean: { minAgeDays: 300 } })),
    ]);
    const text = await fsp.readFile(file, 'utf8');
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* left null */ }
    check('concurrent saves leave valid JSON', parsed !== null);
    const leftovers = (await fsp.readdir(dir)).filter((n) => n.endsWith('.tmp'));
    check('no temp files are left behind', leftovers.length === 0, leftovers.join(','));
  }

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
