#!/usr/bin/env node
'use strict';

// Settings schema v6: the migrations forward, the copy kept of the old file,
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

/**
 * The policy, wherever it lives now.
 *
 * Works on a migrated raw file and on a coerced settings object alike,
 * because both keep the profiles in the same place (G4).
 */
const first = (obj) => obj.autoClean.profiles[0];

const V1 = {
  version: 1,
  autoClean: { enabled: true, dryRun: false, roots: ['C:\\Users\\a\\Downloads'], categories: ['temp', 'log'], minAgeDays: 30 },
  purge: { enabled: true, afterDays: 14 },
  appearance: { theme: 'dark', language: 'vi' },
  trends: { dailySample: false, sampleTime: '09:30' },
};

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-settings-v2-'));

  console.log('\nsettings: version 1 to 7\n');

  check('this build writes version 7', SCHEMA_VERSION === 7);
  {
    const { raw, from, steps } = migrate(V1);
    check('a version 1 file is migrated a step at a time, to 7', from === 1 && steps === 6 && raw.version === 7);
    check('it gains the snapshot section, at the defaults', raw.snapshots.keepRecent === 12 && raw.snapshots.keepMonthly === 12);
    // The one policy is now the first profile, field for field, and it keeps
    // the id `main` so the Windows task the user already had still belongs to
    // it rather than being orphaned beside a second one.
    const moved = raw.autoClean.profiles[0];
    check('and loses nothing it had',
      raw.autoClean.profiles.length === 1 &&
        Object.entries(V1.autoClean).every(([k, v]) => JSON.stringify(moved[k]) === JSON.stringify(v)) &&
        raw.purge.afterDays === 14 && raw.appearance.theme === 'dark',
      JSON.stringify(moved));
    check('and the profile keeps the id the registered task is named from', moved.id === 'main', moved.id);
    const unversioned = migrate({ appearance: { theme: 'light' } });
    check('a file with no version is read as version 1', unversioned.from === 1 && unversioned.raw.version === 7);
    check('migration does not change the object it was given', V1.version === 1 && V1.snapshots === undefined);
  }

  console.log('\nsettings: version 2 to 3 -- known apps’ caches\n');

  {
    // The GPU category used to cover Chrome's and Edge's compiled-code caches.
    // Somebody who had it on keeps having those cleaned, now under each app's
    // own category; somebody who did not gains nothing.
    const on = { version: 2, autoClean: { enabled: true, categories: ['temp', 'gpucache'] } };
    const withGpu = first(migrate(on).raw).categories;
    check('with the GPU category on, every known app’s cache is added',
      ['app.chrome', 'app.edge', 'app.teams', 'app.discord', 'app.zoom', 'app.figma'].every((c) => withGpu.includes(c)) &&
        withGpu[0] === 'temp' && withGpu[1] === 'gpucache', withGpu.join(', '));
    const off = first(migrate({ version: 2, autoClean: { enabled: true, categories: ['temp', 'log'] } }).raw).categories;
    check('with it off, nothing is added', JSON.stringify(off) === '["temp","log"]', off.join(', '));
    const unticked = first(migrate({ version: 3, autoClean: { categories: ['gpucache'] } }).raw).categories;
    check('a version 3 file keeps its categories -- an app somebody unticked stays unticked', JSON.stringify(unticked) === '["gpucache"]');
    const read = first(coerceSettings(on).settings).categories;
    check('and the added names are ones the settings accept', read.includes('app.edge') && read.length === 8, read.join(', '));
  }

  {
    const { settings, warnings } = coerceSettings(V1);
    check('an old file reads without a version warning', !warnings.some((w) => /version/.test(w)), warnings.join('; '));
    check('and every setting in it survives',
      first(settings).enabled && first(settings).minAgeDays === 30 && settings.purge.afterDays === 14 &&
        settings.appearance.language === 'vi' && settings.trends.sampleTime === '09:30' && settings.snapshots.keepRecent === 12);
  }

  {
    // In the shape this build writes, with a version from the future.
    const ahead = { ...V1, version: 8, autoClean: { profiles: [{ id: 'main', ...V1.autoClean }] }, futureThing: { x: 1 } };
    const { settings, warnings } = coerceSettings(ahead);
    check('a file from a newer build is read as far as this one understands it',
      first(settings).minAgeDays === 30 && warnings.some((w) => /newer CleanDrive/.test(w)), warnings.join('; '));
  }

  console.log('\nsettings: version 3 to 4 -- moving files to another drive (B1)\n');

  {
    const { raw } = migrate({ version: 3, autoClean: { categories: ['temp'] } });
    check('a version 3 file gains the quarantine section, with no folder and originals kept',
      raw.version === 7 && raw.quarantine.zone === null && raw.quarantine.deleteOriginal === false &&
        raw.quarantine.retentionDays === 30 && raw.quarantine.maxGB === 0);
    const read = coerceSettings({ version: 4, quarantine: { zone: 'relative\\place', retentionDays: 9000, maxGB: -4, deleteOriginal: 'yes' } });
    check('a zone that is not absolute is dropped, and the numbers are clamped',
      read.settings.quarantine.zone === null && read.settings.quarantine.retentionDays === LIMITS.quarantineRetentionDays.max &&
        read.settings.quarantine.maxGB === 0 && read.settings.quarantine.deleteOriginal === false, read.warnings.join('; '));
    const kept = coerceSettings({ version: 4, quarantine: { zone: 'D:\\CleanDrive Quarantine', deleteOriginal: true } }).settings.quarantine;
    check('an absolute zone is kept, and deleting originals is on only when the file says so',
      /CleanDrive Quarantine$/.test(kept.zone) && kept.deleteOriginal === true);
  }

  console.log('\nsettings: version 4 to 5 -- the user\u2019s own colours (I2)\n');

  {
    const { raw } = migrate({ version: 4, appearance: { theme: 'dark', language: 'vi' } });
    check('a version 4 file gains no colours of its own, and keeps its theme',
      raw.version === 7 && raw.appearance.custom === null && raw.appearance.theme === 'dark' && raw.appearance.language === 'vi');
    const palette = require('../src/shared/theme-palette');
    const good = { enabled: true, name: 'Mine', base: 'dark', colors: { ...palette.BASES.dark, accent: '#b48cff' } };
    const kept = coerceSettings({ version: 5, appearance: { theme: 'light', custom: good } });
    check('a palette that passes every rule is kept, switched on as the file says',
      kept.settings.appearance.custom && kept.settings.appearance.custom.enabled === true &&
        kept.settings.appearance.custom.colors.accent === '#b48cff' && kept.settings.appearance.theme === 'light' &&
        kept.warnings.length === 0, kept.warnings.join('; '));
    // Hand-edited into something unreadable: grey text on a grey card.
    const bad = coerceSettings({ version: 5, appearance: { custom: { ...good, colors: { ...good.colors, text: '#30343c' } } } });
    check('one that fails a rule is dropped, with a warning, and the window falls back to the theme',
      bad.settings.appearance.custom === null && bad.warnings.some((w) => /colour rules/.test(w)), bad.warnings.join('; '));
    const injected = coerceSettings({ version: 5, appearance: { custom: { ...good, colors: { ...good.colors, accent: 'url(http://x)' } } } });
    check('a value that is not #rrggbb never reaches the stylesheet',
      injected.settings.appearance.custom === null && injected.warnings.length === 1, injected.warnings.join('; '));
    const unknown = coerceSettings({ version: 5, appearance: { custom: { ...good, colors: { ...good.colors, '--bg': '#000000' } } } });
    check('nor does a colour it does not know', unknown.settings.appearance.custom === null);
  }

  console.log('\nsettings: version 5 to 6 -- Explorer\u2019s right-click menu (I3)\n');

  {
    const { raw } = migrate({ version: 5, appearance: { theme: 'dark' } });
    check('a version 5 file gains the menu setting, off', raw.version === 7 && raw.explorer && raw.explorer.contextMenu === false);
    const on = coerceSettings({ version: 6, explorer: { contextMenu: true } }).settings.explorer;
    check('on stays on', on.contextMenu === true);
    const odd = coerceSettings({ version: 6, explorer: { contextMenu: 'yes' } }).settings.explorer;
    check('and anything but true is off', odd.contextMenu === false);
    check('a fresh install has it off', coerceSettings({}).settings.explorer.contextMenu === false);
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
    check('but hands back version 7 settings', loaded.version === 7 && loaded.snapshots.keepMonthly === 12);

    await store.patch({ snapshots: { keepRecent: 3 } });
    const written = JSON.parse(await fsp.readFile(file, 'utf8'));
    check('the first save writes version 7', written.version === 7 && written.snapshots.keepRecent === 3);
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

  console.log('\nsettings: the way back from version 7 (G4)\n');

  {
    /*
     * Version 7 moved the cleanup rather than adding to it, so an older build
     * cannot read the policy out of a version 7 file -- the test further down
     * asserts exactly that, and asserts that it fails safe. What makes that
     * acceptable rather than a one-way door is this: the file the older build
     * does understand is still on disk, written before the first version 7
     * save, and it still holds the policy as it was configured.
     */
    const back = path.join(dir, 'back');
    await fsp.mkdir(back, { recursive: true });
    const file = path.join(back, 'settings.json');
    const configured = {
      version: 6,
      autoClean: { enabled: true, dryRun: false, roots: [path.resolve(dir)], minAgeDays: 30 },
    };
    await fsp.writeFile(file, `${JSON.stringify(configured, null, 2)}\n`);

    const store = new SettingsStore(file);
    await store.load();
    await store.patch({ purge: { enabled: true } });

    const copy = path.join(back, 'settings.v6.json');
    check('the version 6 file is kept before the first version 7 save', fs.existsSync(copy));
    const kept = JSON.parse(await fsp.readFile(copy, 'utf8'));
    check('and it still holds the policy in the shape an older build reads',
      kept.autoClean.enabled === true && kept.autoClean.minAgeDays === 30 &&
        kept.autoClean.roots.length === 1 && kept.autoClean.profiles === undefined,
      JSON.stringify(kept.autoClean));

    const now = JSON.parse(await fsp.readFile(file, 'utf8'));
    check('while the file in use is version 7, with the same policy as its first profile',
      now.version === 7 && now.autoClean.profiles.length === 1 &&
        now.autoClean.profiles[0].enabled === true && now.autoClean.profiles[0].minAgeDays === 30 &&
        now.autoClean.profiles[0].id === 'main',
      JSON.stringify(now.autoClean.profiles[0]));
  }

  console.log('\nsettings: an older build reading this build’s file\n');

  /*
   * An older settings.js, out of git, asked to read what this one writes.
   *
   * Two older builds: the commit before this one (while its schema is older
   * than the working tree's), and the last release -- the code people
   * actually have, which is what "the previous version still reads it"
   * promises. Each file that settings.js requires is fetched at the same
   * revision, and so is each of theirs; a revision that cannot be loaded says
   * why instead of being skipped in silence. It was skipped in silence for a
   * while: once settings.js began to require src/shared/theme-palette.js,
   * which this used not to fetch, every run printed "skipped".
   */
  {
    const repo = path.join(__dirname, '..');
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const schemaAt = (ref) => {
      const source = git(['show', `${ref}:src/main/lib/settings.js`]);
      return Number((/const SCHEMA_VERSION = (\d+);/.exec(source) || [])[1]) || 1;
    };

    async function loadAt(ref) {
      const sandbox = path.join(dir, `at-${ref.replace(/[^\w.-]/g, '_')}`);
      const fetched = new Set();
      async function fetch(rel) {
        if (fetched.has(rel)) return;
        fetched.add(rel);
        const body = git(['show', `${ref}:${rel}`]);
        await fsp.mkdir(path.join(sandbox, path.dirname(rel)), { recursive: true });
        await fsp.writeFile(path.join(sandbox, rel), body);
        for (const m of body.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
          let next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
          const candidates = /\.js$/.test(next) ? [next] : [`${next}.js`, `${next}/index.js`];
          for (const candidate of candidates) {
            try {
              await fetch(candidate);
              break;
            } catch {
              fetched.delete(candidate);
            }
          }
        }
      }
      await fetch('src/main/lib/settings.js');
      return require(path.join(sandbox, 'src', 'main', 'lib', 'settings.js'));
    }

    const refs = [];
    try {
      if (schemaAt('HEAD') < SCHEMA_VERSION) refs.push('HEAD');
      const tag = git(['describe', '--tags', '--abbrev=0', 'HEAD']).trim();
      if (tag && schemaAt(tag) < SCHEMA_VERSION && !refs.includes(tag)) refs.push(tag);
    } catch (err) {
      console.log(`  (no older build to ask: ${err.message.split('\n')[0]})`);
    }
    if (!refs.length) console.log('  (no older build to ask: HEAD and the last release both have this schema)');

    for (const ref of refs) {
      let released;
      try {
        released = await loadAt(ref);
      } catch (err) {
        check(`the build at ${ref} can be loaded to ask`, false, err.message.split('\n')[0]);
        continue;
      }
      const at = `the build at ${ref} (schema ${released.SCHEMA_VERSION})`;
      const ours = coerceSettings(V1).settings;
      const { settings, warnings } = released.coerceSettings(JSON.parse(JSON.stringify(ours)));

      /*
       * Version 7 is the first migration that *moves* something rather than
       * adding it: the one policy became `autoClean.profiles` (G4). So the old
       * promise -- "an older build reads every setting it knows" -- cannot hold
       * for the cleanup any more, and pretending otherwise by writing the old
       * fields beside the new ones would put the same fact in the file twice,
       * with nothing to keep the two in step.
       *
       * What is asserted instead is what an older build actually does, and it
       * is the safe half of the old promise: everything that did not move still
       * reads; it says out loud that the file is from a newer version; and the
       * cleanup it comes away with is *off*, not a stale or half-read policy.
       * An older build that quietly ran yesterday's rules would be worse than
       * one that runs nothing.
       *
       * The way back is already in place: `_keepOlderVersion` writes
       * `settings.v6.json` before the first version 7 save, so the file the old
       * build understands is still on disk.
       */
      check(`${at} still reads every setting that did not move`,
        settings.purge.afterDays === 14 && settings.appearance.theme === 'dark' &&
          settings.trends.sampleTime === '09:30',
        warnings.join('; '));
      check(`${at} says it found a version it did not expect, rather than failing`, warnings.some((w) => /version/.test(w)));
      check(`${at} does not come away with a cleanup it cannot read -- it comes away with none`,
        settings.autoClean.enabled === false && settings.autoClean.roots.length === 0,
        JSON.stringify({ enabled: settings.autoClean.enabled, roots: settings.autoClean.roots }));
      // A file with the user's own colours switched on: an older build does
      // not know them, and shows the theme they were built on.
      const palette = require('../src/shared/theme-palette');
      const custom = coerceSettings({ ...V1, version: SCHEMA_VERSION, appearance: { theme: 'dark', custom: { enabled: true, name: 'x', base: 'dark', colors: palette.BASES.dark } } }).settings;
      const older = released.coerceSettings(JSON.parse(JSON.stringify(custom))).settings;
      check(`${at}, with custom colours on, shows the theme underneath them`, older.appearance.theme === 'dark');
    }
  }

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
