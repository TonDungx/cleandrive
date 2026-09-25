#!/usr/bin/env node
'use strict';

// Settings schema v4: the migrations forward, the copy kept of the old file,
// and what the previous build makes of a file this one wrote.
//   node scripts/test-settings-migration.js
//
// The last part runs the *previous* settings.js -- read out of git at HEAD --
// against a file this one wrote, because "an older build still reads it" is a
// claim about code that is not in the working tree any more.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  SettingsStore,
  coerceSettings,
  migrate,
  SCHEMA_VERSION,
  LIMITS,
} = require('../src/main/lib/settings');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const V1 = {
  version: 1,
  autoClean: { enabled: true, dryRun: false, roots: ['C:\\Users\\a\\Downloads'], categories: ['temp', 'log'], minAgeDays: 30 },
  purge: { enabled: true, afterDays: 14 },
  appearance: { theme: 'dark', language: 'vi' },
  trends: { dailySample: false, sampleTime: '09:30' },
};

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-settings-v2-'));

  console.log('\nsettings: version 1 to 4\n');

  check('this build writes version 4', SCHEMA_VERSION === 4);
  {
    const { raw, from, steps } = migrate(V1);
    check('a version 1 file is migrated a step at a time, to 4', from === 1 && steps === 3 && raw.version === 4);
    check('it gains the snapshot section, at the defaults', raw.snapshots.keepRecent === 12 && raw.snapshots.keepMonthly === 12);
    check('and loses nothing it had', JSON.stringify(raw.autoClean) === JSON.stringify(V1.autoClean) &&
      raw.purge.afterDays === 14 && raw.appearance.theme === 'dark');
    const unversioned = migrate({ appearance: { theme: 'light' } });
    check('a file with no version is read as version 1', unversioned.from === 1 && unversioned.raw.version === 4);
    check('migration does not change the object it was given', V1.version === 1 && V1.snapshots === undefined);
  }

  console.log('\nsettings: version 2 to 3 -- known apps’ caches\n');

  {
    // The GPU category used to cover Chrome's and Edge's compiled-code caches.
    // Somebody who had it on keeps having those cleaned, now under each app's
    // own category; somebody who did not gains nothing.
    const on = { version: 2, autoClean: { enabled: true, categories: ['temp', 'gpucache'] } };
    const withGpu = migrate(on).raw.autoClean.categories;
    check('with the GPU category on, every known app’s cache is added',
      ['app.chrome', 'app.edge', 'app.teams', 'app.discord', 'app.zoom', 'app.figma'].every((c) => withGpu.includes(c)) &&
        withGpu[0] === 'temp' && withGpu[1] === 'gpucache', withGpu.join(', '));
    const off = migrate({ version: 2, autoClean: { enabled: true, categories: ['temp', 'log'] } }).raw.autoClean.categories;
    check('with it off, nothing is added', JSON.stringify(off) === '["temp","log"]', off.join(', '));
    const unticked = migrate({ version: 3, autoClean: { categories: ['gpucache'] } }).raw.autoClean.categories;
    check('a version 3 file keeps its categories -- an app somebody unticked stays unticked', JSON.stringify(unticked) === '["gpucache"]');
    const read = coerceSettings(on).settings.autoClean.categories;
    check('and the added names are ones the settings accept', read.includes('app.edge') && read.length === 8, read.join(', '));
  }

  {
    const { settings, warnings } = coerceSettings(V1);
    check('an old file reads without a version warning', !warnings.some((w) => /version/.test(w)), warnings.join('; '));
    check('and every setting in it survives',
      settings.autoClean.enabled && settings.autoClean.minAgeDays === 30 && settings.purge.afterDays === 14 &&
        settings.appearance.language === 'vi' && settings.trends.sampleTime === '09:30' && settings.snapshots.keepRecent === 12);
  }

  {
    const { settings, warnings } = coerceSettings({ ...V1, version: 5, futureThing: { x: 1 } });
    check('a file from a newer build is read as far as this one understands it',
      settings.autoClean.minAgeDays === 30 && warnings.some((w) => /newer CleanDrive/.test(w)), warnings.join('; '));
  }

  console.log('\nsettings: version 3 to 4 -- moving files to another drive (B1)\n');

  {
    const { raw } = migrate({ version: 3, autoClean: { categories: ['temp'] } });
    check('a version 3 file gains the quarantine section, with no folder and originals kept',
      raw.version === 4 && raw.quarantine.zone === null && raw.quarantine.deleteOriginal === false &&
        raw.quarantine.retentionDays === 30 && raw.quarantine.maxGB === 0);
    const read = coerceSettings({ version: 4, quarantine: { zone: 'relative\\place', retentionDays: 9000, maxGB: -4, deleteOriginal: 'yes' } });
    check('a zone that is not absolute is dropped, and the numbers are clamped',
      read.settings.quarantine.zone === null && read.settings.quarantine.retentionDays === LIMITS.quarantineRetentionDays.max &&
        read.settings.quarantine.maxGB === 0 && read.settings.quarantine.deleteOriginal === false, read.warnings.join('; '));
    const kept = coerceSettings({ version: 4, quarantine: { zone: 'D:\\CleanDrive Quarantine', deleteOriginal: true } }).settings.quarantine;
    check('an absolute zone is kept, and deleting originals is on only when the file says so',
      /CleanDrive Quarantine$/.test(kept.zone) && kept.deleteOriginal === true);
  }

  console.log('\nsettings: the snapshot section is clamped like everything else\n');

  {
    const low = coerceSettings({ version: 2, snapshots: { keepRecent: 0, keepMonthly: -3 } });
    check('fewer than one recent snapshot is raised to one', low.settings.snapshots.keepRecent === 1 &&
      low.settings.snapshots.keepMonthly === 0 && low.warnings.length === 2, low.warnings.join('; '));
    const high = coerceSettings({ version: 2, snapshots: { keepRecent: 5000, keepMonthly: 'lots' } });
    check('and too many is capped', high.settings.snapshots.keepRecent === LIMITS.snapshotKeepRecent.max &&
      high.settings.snapshots.keepMonthly === LIMITS.snapshotKeepMonthly.fallback, high.warnings.join('; '));
  }

  console.log('\nsettings: on disk\n');

  {
    const file = path.join(dir, 'settings.json');
    const original = `${JSON.stringify(V1, null, 2)}\n`;
    await fsp.writeFile(file, original);

    const store = new SettingsStore(file);
    const loaded = await store.load();
    check('loading an old file does not write anything', (await fsp.readFile(file, 'utf8')) === original &&
      !fs.existsSync(path.join(dir, 'settings.v1.json')));
    check('but hands back version 4 settings', loaded.version === 4 && loaded.snapshots.keepMonthly === 12);

    await store.patch({ snapshots: { keepRecent: 3 } });
    const written = JSON.parse(await fsp.readFile(file, 'utf8'));
    check('the first save writes version 4', written.version === 4 && written.snapshots.keepRecent === 3);
    check('patching one snapshot field keeps the other', written.snapshots.keepMonthly === 12);
    check('and keeps the old file, byte for byte, as settings.v1.json',
      (await fsp.readFile(path.join(dir, 'settings.v1.json'), 'utf8')) === original);

    await store.patch({ appearance: { theme: 'light' } });
    check('a later save leaves that copy alone',
      (await fsp.readFile(path.join(dir, 'settings.v1.json'), 'utf8')) === original);

    const fresh = new SettingsStore(path.join(dir, 'new', 'settings.json'));
    await fresh.load();
    await fresh.save(await fresh.get());
    check('a new install keeps no copy -- there was nothing older', !fs.existsSync(path.join(dir, 'new', 'settings.v1.json')));
  }

  console.log('\nsettings: the previous build reading this build’s file\n');

  {
    let released = null;
    try {
      const source = execFileSync('git', ['show', 'HEAD:src/main/lib/settings.js'], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // Only when HEAD is an older schema than the working tree; once this
      // version is committed there is nothing older at HEAD to ask.
      const headVersion = Number((/const SCHEMA_VERSION = (\d+);/.exec(source) || [])[1]);
      if (headVersion < SCHEMA_VERSION) {
        // Laid out as it is in the repo, so its `require('../../i18n')` resolves.
        const sandbox = path.join(dir, 'released');
        await fsp.mkdir(path.join(sandbox, 'src', 'main', 'lib'), { recursive: true });
        await fsp.writeFile(path.join(sandbox, 'src', 'main', 'lib', 'settings.js'), source);
        // What that settings.js requires, as HEAD has it too. A file HEAD does
        // not have is one that version did not need.
        for (const rel of ['src/i18n/index.js', 'src/main/lib/atomic.js', 'src/main/automatic/allowed-categories.js']) {
          let body;
          try {
            body = execFileSync('git', ['show', `HEAD:${rel}`], {
              cwd: path.join(__dirname, '..'),
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
            });
          } catch {
            continue;
          }
          await fsp.mkdir(path.join(sandbox, path.dirname(rel)), { recursive: true });
          await fsp.writeFile(path.join(sandbox, rel), body);
        }
        released = require(path.join(sandbox, 'src', 'main', 'lib', 'settings.js'));
      }
    } catch {
      released = null;
    }

    if (!released) {
      console.log('  (skipped: HEAD is not an older schema, or git is not available)');
    } else {
      const ours = coerceSettings(V1).settings;
      const { settings, warnings } = released.coerceSettings(JSON.parse(JSON.stringify(ours)));
      check(`the previous build reads every setting it knows from a version ${SCHEMA_VERSION} file`,
        settings.autoClean.minAgeDays === 30 && settings.purge.afterDays === 14 &&
          settings.appearance.theme === 'dark' && settings.trends.sampleTime === '09:30',
        warnings.join('; '));
      check('and says it found a version it did not expect, rather than failing', warnings.some((w) => /version/.test(w)));
      check('its cleanup stays exactly as configured -- nothing is switched on or off by the upgrade',
        settings.autoClean.enabled === true && settings.autoClean.dryRun === false &&
          JSON.stringify(settings.autoClean.categories) === '["temp","log"]');
    }
  }

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
