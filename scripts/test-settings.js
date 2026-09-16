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
  check('automatic cleanup is off out of the box', base.autoClean.enabled === false);
  check('the first run would be a dry run', base.autoClean.dryRun === true);
  check('purge is off out of the box', base.purge.enabled === false);
  check('no folders are targeted by default', base.autoClean.roots.length === 0);
  check('build output is not auto-deleted by default',
    !base.autoClean.categories.includes('buildoutput'));

  console.log('\nsettings: coercion of hostile input\n');

  {
    const { settings, warnings } = coerceSettings({
      autoClean: { categories: ['cache', 'stale', 'appcache', 'archive', 'installer'] },
    });
    check('a review-only category cannot be scheduled for deletion',
      !settings.autoClean.categories.includes('stale') &&
      !settings.autoClean.categories.includes('appcache') &&
      !settings.autoClean.categories.includes('archive') &&
      !settings.autoClean.categories.includes('installer'),
      settings.autoClean.categories.join(','));
    check('only the safe category survives', settings.autoClean.categories.join(',') === 'cache');
    check('each rejection is reported', warnings.filter((w) => w.includes('not an auto-cleanable')).length === 4);
  }

  {
    const { settings, warnings } = coerceSettings({ autoClean: { minAgeDays: 0 } });
    check('a zero-day age threshold is clamped up', settings.autoClean.minAgeDays === LIMITS.minAgeDays.min,
      String(settings.autoClean.minAgeDays));
    check('the clamp is reported', warnings.some((w) => w.includes('minAgeDays')));
  }

  {
    const { settings } = coerceSettings({ autoClean: { minAgeDays: -99999, maxItemsPerRun: 9e9 } });
    check('a negative age is clamped, not negated', settings.autoClean.minAgeDays === LIMITS.minAgeDays.min);
    check('an absurd per-run cap is clamped', settings.autoClean.maxItemsPerRun === LIMITS.maxItemsPerRun.max);
  }

  {
    const { settings, warnings } = coerceSettings({
      autoClean: { roots: ['relative/path', '', 42, ABS('Users', 'me', 'Downloads')] },
    });
    check('relative and non-string roots are dropped', settings.autoClean.roots.length === 1,
      JSON.stringify(settings.autoClean.roots));
    check('the absolute root survives', settings.autoClean.roots[0] === ABS('Users', 'me', 'Downloads'));
    check('the dropped relative path is reported', warnings.some((w) => w.includes('not absolute')));
  }

  {
    const { settings, warnings } = coerceSettings({ autoClean: { enabled: true, roots: [] } });
    check('enabling with no folders does not stay enabled', settings.autoClean.enabled === false);
    check('and says why', warnings.some((w) => w.includes('no folders')));
  }

  {
    const { settings } = coerceSettings({ autoClean: { enabled: true, roots: [ABS('Users', 'me', 'Downloads')] } });
    check('enabling with a folder does stay enabled', settings.autoClean.enabled === true);
  }

  {
    const { settings, warnings } = coerceSettings({ autoClean: { schedule: { kind: 'hourly', time: '25:61', day: 31 } } });
    check('an unknown schedule kind falls back', settings.autoClean.schedule.kind === 'weekly',
      settings.autoClean.schedule.kind);
    check('an impossible time falls back', settings.autoClean.schedule.time === '02:00',
      settings.autoClean.schedule.time);
    check('a monthly day past 28 falls back so every month fires',
      settings.autoClean.schedule.day === 1, String(settings.autoClean.schedule.day));
    check('all three are reported', warnings.length >= 3, warnings.join(' | '));
  }

  {
    const { settings } = coerceSettings({ autoClean: { schedule: { time: '7:05' } } });
    check('a single-digit hour is zero-padded', settings.autoClean.schedule.time === '07:05',
      settings.autoClean.schedule.time);
  }

  {
    // "7:5" could mean 07:05 or 07:50. A cleanup time is not a thing to guess
    // at, so an ambiguous minute field is refused rather than interpreted.
    const { settings } = coerceSettings({ autoClean: { schedule: { time: '7:5' } } });
    check('an ambiguous minute field is refused, not guessed',
      settings.autoClean.schedule.time === '02:00', settings.autoClean.schedule.time);
  }

  {
    const { settings } = coerceSettings('not an object');
    check('a non-object file yields defaults', settings.autoClean.enabled === false);
  }

  {
    const { settings } = coerceSettings({ purge: { afterDays: 0 } });
    check('a zero-day grace period is clamped up', settings.purge.afterDays === LIMITS.purgeAfterDays.min);
  }

  {
    const dupe = ABS('Users', 'me', 'Downloads');
    const { settings } = coerceSettings({ autoClean: { roots: [dupe, dupe.toUpperCase()] } });
    check('roots are de-duplicated case-insensitively on Windows',
      process.platform !== 'win32' || settings.autoClean.roots.length === 1,
      JSON.stringify(settings.autoClean.roots));
  }

  console.log('\nsettings: the file on disk\n');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-settings-'));
  const file = path.join(dir, 'settings.json');

  {
    const store = new SettingsStore(file);
    const loaded = await store.load();
    check('a missing file loads as defaults without throwing', loaded.autoClean.enabled === false);
    check('and is not treated as an error', store.warnings.length === 0);
  }

  {
    await fsp.writeFile(file, '{ this is not json', 'utf8');
    const store = new SettingsStore(file);
    const loaded = await store.load();
    check('a corrupt file loads as defaults', loaded.autoClean.enabled === false);
    check('and says so', store.warnings.some((w) => w.includes('not valid JSON')));
  }

  {
    const store = new SettingsStore(file);
    await store.save({ autoClean: { enabled: true, roots: [ABS('Users', 'me', 'Downloads')], minAgeDays: 90 } });
    const reread = await new SettingsStore(file).load();
    check('a save round-trips', reread.autoClean.minAgeDays === 90 && reread.autoClean.enabled === true,
      JSON.stringify(reread.autoClean.minAgeDays));
    check('saved JSON is readable by hand', (await fsp.readFile(file, 'utf8')).includes('\n  "autoClean"'));
  }

  {
    const store = new SettingsStore(file);
    await store.load();
    await store.patch({ purge: { enabled: true } });
    const reread = await new SettingsStore(file).load();
    check('patch keeps untouched fields', reread.autoClean.minAgeDays === 90);
    check('patch applies the change', reread.purge.enabled === true);
  }

  {
    // The settings screen builds its payload from the form, and the form does
    // not carry every section. A wholesale save of that payload reset the rest
    // to defaults -- silently, because nothing on screen showed the loss.
    const store = new SettingsStore(file);
    await store.load();
    await store.patch({
      monitor: { enabled: true, volumes: [ABS('Users', 'me')], warnPercent: 70 },
      appearance: { theme: 'light' },
    });

    await store.patch({ autoClean: { minAgeDays: 45 } });

    const reread = await new SettingsStore(file).load();
    check('patching one section leaves another alone',
      reread.monitor.warnPercent === 70 && reread.monitor.volumes.length === 1,
      `${reread.monitor.warnPercent}% / ${reread.monitor.volumes.length} volume(s)`);
    check('and leaves the theme alone', reread.appearance.theme === 'light', reread.appearance.theme);
    check('while applying what it did send', reread.autoClean.minAgeDays === 45);

    // A key that *is* sent still replaces, so a list can genuinely be emptied.
    await store.patch({ monitor: { volumes: [] } });
    const emptied = await new SettingsStore(file).load();
    check('an explicitly sent empty list does empty it', emptied.monitor.volumes.length === 0);
    check('without disturbing its neighbours', emptied.monitor.warnPercent === 70);
  }

  console.log('\nsettings: appearance\n');

  {
    check('the theme follows the system out of the box', defaults().appearance.theme === 'system');

    for (const theme of ['system', 'light', 'dark']) {
      const { settings } = coerceSettings({ appearance: { theme } });
      check(`"${theme}" is accepted`, settings.appearance.theme === theme);
    }

    const { settings, warnings } = coerceSettings({ appearance: { theme: 'solarized' } });
    check('an unknown theme falls back to system', settings.appearance.theme === 'system');
    check('and says so', warnings.some((w) => w.includes('appearance.theme')), warnings.join(' | '));

    const notAnObject = coerceSettings({ appearance: 'dark' });
    check('appearance given as a string does not throw',
      notAnObject.settings.appearance.theme === 'system');
  }

  {
    // Concurrent saves must not interleave into a half-written file.
    const store = new SettingsStore(file);
    await store.load();
    await Promise.all([
      store.patch({ autoClean: { minAgeDays: 100 } }),
      store.patch({ autoClean: { minAgeDays: 200 } }),
      store.patch({ autoClean: { minAgeDays: 300 } }),
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
