#!/usr/bin/env node
'use strict';

// An unattended run has no dialog in front of it. Every test here is a case
// where the interactive app would have asked the user and this one must decide
// on its own -- and in each, the correct decision is the timid one.
//   node scripts/test-autoclean.js

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { runAutoClean, selectFiles, lastTouched, blockingApps, RunLog } = require('../src/main/lib/autoclean');
// A run's reason is a message now -- { i18n, en, params } -- so the log it is
// written to can be read later in whatever language is set then.
const { render } = require('../src/i18n');
const { coerceSettings, profilesOf } = require('../src/main/lib/settings');
const { TrashLedger } = require('../src/main/lib/ledger');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1, 2, 0, 0);
const OLD = NOW - 400 * DAY;
const RECENT = NOW - 3 * DAY;

/** A cleanup summary shaped exactly like Advisor.summary() produces. */
function cleanupOf(groups) {
  return { groups, safeBytes: 0, reviewBytes: 0, protectedPaths: [], appFolders: [] };
}
function group(category, verdict, files) {
  return { category, verdict, label: category, hint: '', bytes: 0, count: files.length, files, truncated: false };
}
function file(p, size, mtimeMs = OLD, atimeMs = 0) {
  return { path: p, size, mtimeMs, atimeMs, reason: 'test' };
}

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-auto-'));
  const root = path.join(dir, 'root');
  const keepDir = path.join(root, 'keep');
  await fsp.mkdir(keepDir, { recursive: true });

  // One profile, since almost every rule here is about one policy (G4).
  // `S` is the whole settings object, as `runAutoClean` takes it; `P` is
  // the policy inside it, as `selectFiles` takes it.
  const S = (over = {}) =>
    coerceSettings({ autoClean: { profiles: [{ id: 'main', enabled: true, roots: [root], dryRun: false, ...over }] } }).settings;
  const P = (over = {}) => profilesOf(S(over))[0];

  console.log('\nautoclean: what may be selected\n');

  {
    const cleanup = cleanupOf([
      group('cache', 'safe', [file(path.join(root, 'a.bin'), 100)]),
      group('stale', 'review', [file(path.join(root, 'big.iso'), 9e9)]),
      group('installer', 'review', [file(path.join(root, 'setup.exe'), 5e8)]),
      group('archive', 'review', [file(path.join(root, 'backup.zip'), 5e8)]),
    ]);
    const picked = selectFiles(cleanup, P(), NOW);
    check('only the safe category is selected', picked.files.length === 1, String(picked.files.length));
    check('a "worth reviewing" file is never picked unattended',
      !picked.files.some((f) => f.path.endsWith('.iso')));
    check('a large archive is never picked unattended',
      !picked.files.some((f) => f.path.endsWith('.zip')));
  }

  {
    // A verdict of 'safe' on a category the user did not enable is still a no.
    const cleanup = cleanupOf([group('buildoutput', 'safe', [file(path.join(root, 'out.o'), 100)])]);
    const picked = selectFiles(cleanup, P(), NOW);
    check('a safe category the user did not enable is skipped', picked.files.length === 0);
  }

  {
    // A forged settings file naming a review category must not get through.
    const forged = { ...P(), categories: ['cache', 'stale'] };
    const cleanup = cleanupOf([group('stale', 'review', [file(path.join(root, 'big.iso'), 9e9)])]);
    const picked = selectFiles(cleanup, forged, NOW);
    check('a hand-edited category list cannot smuggle in a review verdict',
      picked.files.length === 0, String(picked.files.length));
  }

  console.log('\nautoclean: photographs are out of reach\n');

  {
    // The rule the photo subsystem was built under: an unattended run must
    // never touch a picture. Structurally it already cannot -- an unattended
    // run acts on `cleanup.groups`, which come from the advisor, and the media
    // scan never goes near the advisor. But "it cannot happen because of how
    // the code is arranged" is exactly the kind of guarantee that stops being
    // true when somebody rearranges the code, so it is asserted rather than
    // relied upon.
    const { SAFE_CATEGORIES } = require('../src/main/lib/settings');
    const mediaish = ['photo', 'photos', 'video', 'media', 'picture', 'screenshot', 'camera'];
    check('no media category is on the unattended allowlist',
      !SAFE_CATEGORIES.some((c) => mediaish.includes(c)), SAFE_CATEGORIES.join(', '));

    // And if one were somehow named in a settings file, `coerceSettings`
    // refuses it before it reaches the run.
    const smuggled = coerceSettings({ autoClean: { profiles: [{ id: 'main', categories: ['cache', 'photos', 'video'] }] } });
    check('a settings file naming a photo category has it stripped out',
      !profilesOf(smuggled.settings)[0].categories.includes('photos') &&
        !profilesOf(smuggled.settings)[0].categories.includes('video'),
      profilesOf(smuggled.settings)[0].categories.join(', '));
    check('and the rest of the list survives',
      profilesOf(smuggled.settings)[0].categories.includes('cache'));

    // The last line of defence: even a group that reached `selectFiles` with a
    // media-sounding category and a verdict of 'safe' is refused, because the
    // category is not one the user enabled and cannot become one.
    const cleanup = cleanupOf([group('photos', 'safe', [file(path.join(root, 'wedding.jpg'), 4e6)])]);
    const forced = { ...P(), categories: ['cache', 'photos'] };
    const picked = selectFiles(cleanup, forced, NOW);
    check('a photo group is refused even with its category forced on',
      picked.files.length === 0, `${picked.files.length} picked`);
  }

  console.log('\nautoclean: the age gate\n');

  {
    const cleanup = cleanupOf([
      group('cache', 'safe', [
        file(path.join(root, 'old.bin'), 100, OLD),
        file(path.join(root, 'new.bin'), 100, RECENT),
      ]),
    ]);
    const picked = selectFiles(cleanup, P(), NOW);
    check('a recently modified file is left alone', picked.files.length === 1 && picked.files[0].path.endsWith('old.bin'));
    check('the skip is counted', picked.skipped.tooRecent === 1);
  }

  {
    // Written a year ago, opened yesterday. The later timestamp must win.
    const opened = file(path.join(root, 'inuse.bin'), 100, OLD, RECENT);
    check('age uses the most recent of the two timestamps', lastTouched(opened) === RECENT);
    const picked = selectFiles(cleanupOf([group('cache', 'safe', [opened])]), P(), NOW);
    check('a stale file that was opened yesterday is not deleted', picked.files.length === 0);
  }

  console.log('\nautoclean: whitelist and guards\n');

  {
    const cleanup = cleanupOf([
      group('cache', 'safe', [
        file(path.join(keepDir, 'protected.bin'), 100),
        file(path.join(root, 'free.bin'), 100),
      ]),
    ]);
    const picked = selectFiles(cleanupOf(cleanup.groups), P({ whitelist: [keepDir] }), NOW);
    check('a whitelisted folder is honoured', picked.files.length === 1 && picked.files[0].path.endsWith('free.bin'));
    check('the whitelist skip is counted', picked.skipped.whitelisted === 1);
  }

  {
    const sysDrive = process.env.SystemDrive || 'C:';
    const cleanup = cleanupOf([
      group('cache', 'safe', [file(path.join(sysDrive, path.sep, 'Windows', 'System32', 'x.dll'), 100)]),
    ]);
    const picked = selectFiles(cleanup, P(), NOW);
    check('a protected system path is refused even when tagged safe',
      picked.files.length === 0, String(picked.files.length));
    check('the guard skip is counted', picked.skipped.guarded === 1);
  }

  console.log('\nautoclean: the per-run cap\n');

  {
    const files = Array.from({ length: 10 }, (_, i) => file(path.join(root, `f${i}.bin`), (i + 1) * 100));
    const picked = selectFiles(cleanupOf([group('cache', 'safe', files)]), P({ maxItemsPerRun: 3 }), NOW);
    check('the cap is applied', picked.files.length === 3);
    check('the largest files are taken first', picked.files[0].size === 1000 && picked.files[2].size === 800,
      picked.files.map((f) => f.size).join(','));
    check('truncation is reported', picked.truncated === true);
  }

  console.log('\nautoclean: gates that stop the whole run\n');

  const fakeScan = (groups) => async () => ({
    totalFiles: 1, totalSize: 1, errorCount: 0, cleanup: cleanupOf(groups),
  });
  const bigCache = [group('cache', 'safe', [file(path.join(root, 'a.bin'), 1024)])];

  {
    const run = await runAutoClean({
      settings: coerceSettings({ autoClean: { enabled: false, roots: [root] } }).settings,
      now: NOW,
    });
    check('a disabled config does nothing', run.outcome === 'skipped', render(run.reason));
  }

  {
    const run = await runAutoClean({
      settings: S({ minDiskUsedPercent: 100 }),
      deps: { scan: fakeScan(bigCache) },
      now: NOW,
    });
    check('a disk below the usage threshold stops the run', run.outcome === 'skipped', render(run.reason));
    check('and says what the disk actually is', /% full/.test(render(run.reason)), render(run.reason));
  }

  {
    const self = path.basename(process.execPath); // this very process is running
    const run = await runAutoClean({
      settings: S({ skipIfRunning: [self] }),
      deps: { scan: fakeScan(bigCache) },
      now: NOW,
    });
    check('a named app being open stops the run', run.outcome === 'skipped', render(run.reason));
    check('and names the app', render(run.reason).toLowerCase().includes(self.toLowerCase()),
      render(run.reason));
  }

  {
    const apps = await blockingApps(['definitely-not-a-real-process-xyz.exe']);
    check('an app that is not running does not block', apps.blocked.length === 0 && apps.known === true);
  }

  console.log('\nautoclean: dry run and the real thing\n');

  {
    const run = await runAutoClean({
      settings: S({ dryRun: true, skipIfRunning: [] }),
      deps: {
        scan: fakeScan(bigCache),
        planTrash: async () => { throw new Error('a dry run must not reach planTrash'); },
      },
      now: NOW,
    });
    check('a dry run reports without deleting', run.outcome === 'dry-run', render(run.reason));
    check('a dry run counts what it would take', run.selected.files === 1);
    check('a dry run shows a sample', Array.isArray(run.sample) && run.sample.length === 1);
  }

  {
    const trashed = [];
    const ledgerFile = path.join(dir, 'ledger.json');
    const ledger = new TrashLedger(ledgerFile);
    await ledger.load();

    const run = await runAutoClean({
      settings: S({ skipIfRunning: [] }),
      ledger,
      deps: {
        scan: fakeScan(bigCache),
        planTrash: async (paths) => ({
          plan: paths.map((p) => ({ path: p, size: 1024 })),
          failed: [], needsAdmin: [], inUse: [], totalBytes: 1024 * paths.length,
          cancelled: false, estimatedMs: 0,
        }),
        executeTrash: async (plan) => {
          trashed.push(...plan.map((p) => p.path));
          return { moved: plan, failed: [], freedBytes: 1024 * plan.length, cancelled: false, remaining: 0, durationMs: 1 };
        },
      },
      now: NOW,
    });

    check('a real run deletes what it selected', trashed.length === 1, String(trashed.length));
    check('the run reports the bytes', run.trashed.bytes === 1024, String(run.trashed.bytes));

    const reread = new TrashLedger(ledgerFile);
    await reread.load();
    check('every deleted file is written to the ledger', reread.entries.length === 1, String(reread.entries.length));
    check('the ledger records the run id', reread.entries[0].runId === run.runId);

    check('with purge off the run says the space is not actually free',
      run.notes.some((n) => render(n).includes('no space is free until the bin is emptied')),
      run.notes.map(render).join(' | '));
  }

  console.log('\nautoclean: what the licence includes\n');

  {
    // Two profiles of the person's own, and a licence that says no to
    // everything: the first still runs, the second becomes a report and says
    // why. Nothing may reach the Recycle Bin for the second.
    const two = coerceSettings({
      autoClean: {
        profiles: [
          { id: 'main', enabled: true, roots: [root], dryRun: false, skipIfRunning: [] },
          { id: 'psecond', enabled: true, roots: [root], dryRun: false, skipIfRunning: [] },
        ],
      },
    }).settings;
    const [first, second] = profilesOf(two);
    // Free features are always allowed, as the real `can` answers.
    const none = (f) => f === 'free';
    let reached = 0;
    const realDeps = {
      scan: fakeScan(bigCache),
      planTrash: async (paths) => {
        reached += 1;
        return {
          plan: paths.map((p) => ({ path: p, size: 1024 })),
          failed: [], needsAdmin: [], inUse: [], totalBytes: 1024 * paths.length, cancelled: false, estimatedMs: 0,
        };
      },
      executeTrash: async (plan) => ({ moved: plan, failed: [], freedBytes: 0, cancelled: false, remaining: 0, durationMs: 1 }),
    };

    const ran = await runAutoClean({ settings: two, profile: first, can: none, deps: realDeps, now: NOW });
    check('the first profile is free: it runs for real without Pro', ran.outcome !== 'dry-run' && reached === 1,
      `${ran.outcome}, planTrash reached ${reached}`);
    check('and carries no licence note', !ran.lacking && !ran.notes.some((n) => n && /^run\.note\.licence/.test(n.i18n)));

    reached = 0;
    const reported = await runAutoClean({ settings: two, profile: second, can: none, deps: realDeps, now: NOW });
    check('a second profile without Pro only reports', reported.outcome === 'dry-run' && reached === 0,
      `${reported.outcome}, planTrash reached ${reached}`);
    check('it still counts what it would have taken', reported.selected.files === 1, String(reported.selected.files));
    check('and says why, as a message the log can translate later',
      reported.notes.some((n) => n && n.i18n === 'run.note.licenceProfiles'), reported.notes.map(render).join(' | '));
    check('the run names what was missing', JSON.stringify(reported.lacking) === '["pro.automatic.profiles"]',
      JSON.stringify(reported.lacking));
    check('a report-only run is recorded as one', reported.dryRun === true);

    reached = 0;
    const allowed = await runAutoClean({
      settings: two, profile: second, can: (f) => f === 'free' || f === 'pro.automatic.profiles', deps: realDeps, now: NOW,
    });
    check('with Pro the second profile runs for real', allowed.outcome !== 'dry-run' && reached === 1,
      `${allowed.outcome}, planTrash reached ${reached}`);

    reached = 0;
    const already = await runAutoClean({
      settings: two, profile: { ...second, dryRun: true }, can: none, deps: realDeps, now: NOW,
    });
    check('a profile already in report only gains no licence note', already.outcome === 'dry-run' &&
      !already.notes.some((n) => n && /^run\.note\.licence/.test(n.i18n)) && JSON.stringify(already.lacking) === '["pro.automatic.profiles"]');

    reached = 0;
    const noGate = await runAutoClean({ settings: two, profile: second, deps: realDeps, now: NOW });
    check('a caller that hands in no licence is not gated here (the pipeline rule)', noGate.outcome !== 'dry-run' && reached === 1);
  }

  {
    // Moving to another drive is Pro on its own, even as the free profile.
    const zone = path.join(dir, 'zone');
    const settings = coerceSettings({
      autoClean: { profiles: [{ id: 'main', enabled: true, roots: [root], dryRun: false, skipIfRunning: [], action: 'quarantine' }] },
    }).settings;
    const run = await runAutoClean({
      settings,
      profile: profilesOf(settings)[0],
      quarantine: { zone, maxGB: 0, retentionDays: 30 },
      can: () => false,
      deps: {
        scan: fakeScan(bigCache),
        zoneReady: async () => true,
        planTrash: async () => { throw new Error('a report must not reach the pipeline'); },
      },
      now: NOW,
    });
    check('a quarantine profile without Pro only reports', run.outcome === 'dry-run', render(run.reason));
    check('in the words of moving to another drive', /other drive/.test(render(run.reason)), render(run.reason));
    check('and says why', run.notes.some((n) => n && n.i18n === 'run.note.licenceQuarantine'));
  }

  {
    // The organisation's profile (H2) is there only when Business is, so it is
    // neither counted nor asked about; the person's first profile stays free.
    const { licenceLacks } = require('../src/main/lib/autoclean');
    const own = { id: 'main', enabled: true, roots: [root] };
    const org = { id: 'porganisation', managed: true, enabled: true, roots: [root] };
    const settings = { autoClean: { profiles: [org, own] } };
    check('the organisation\'s profile asks the licence nothing', licenceLacks(settings, org, () => false).length === 0);
    check('and does not push the person\'s first profile into second place',
      licenceLacks(settings, own, () => false).length === 0);
  }

  {
    // Every door into an unattended run hands it the licence. A door without
    // it would run the profile whatever the licence says.
    const fs = require('node:fs');
    const SRC = path.join(__dirname, '..', 'src', 'main');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
    const calls = [];
    for (const f of walk(SRC)) {
      const text = fs.readFileSync(f, 'utf8');
      let at = text.indexOf('runAutoClean({');
      while (at !== -1) {
        const end = text.indexOf('});', at);
        calls.push({ file: path.relative(SRC, f), passes: /\bcan:/.test(text.slice(at, end)) });
        at = text.indexOf('runAutoClean({', at + 1);
      }
    }
    const missing = calls.filter((c) => !c.passes).map((c) => c.file);
    check('every caller of runAutoClean hands it the licence', calls.length === 3 && missing.length === 0,
      `${calls.length} calls; without can: ${missing.join(', ') || 'none'}`);
  }

  console.log('\nautoclean: the run log\n');

  {
    const logFile = path.join(dir, 'runs.json');
    const log = new RunLog(logFile, { keep: 3 });
    await log.load();
    for (let i = 0; i < 5; i++) await log.append({ runId: `r${i}`, startedAt: NOW + i, outcome: 'ok' });
    const reread = new RunLog(logFile, { keep: 3 });
    await reread.load();
    check('the log keeps only the most recent runs', reread.runs.length === 3, String(reread.runs.length));
    check('the newest run is first', reread.latest().runId === 'r4', reread.latest().runId);
  }

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
