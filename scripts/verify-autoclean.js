#!/usr/bin/env node
'use strict';

// End-to-end proof on real files, the real Recycle Bin and the real disk.
// The unit tests use synthesised bin entries; this one creates throwaway files,
// lets the scheduled-run code path take them, finds them in the actual Recycle
// Bin, purges exactly those, and shows the free space moving.
//
//   npx electron scripts/verify-autoclean.js

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const { coerceSettings } = require('../src/main/lib/settings');
const { TrashLedger } = require('../src/main/lib/ledger');
const { runAutoClean } = require('../src/main/lib/autoclean');
const { findUserBins, listItems, purgeRecorded } = require('../src/main/lib/recyclebin');
const { diskUsage } = require('../src/main/lib/disk');
const { formatBytes, pathKey } = require('../src/main/lib/util');

// Running `electron scripts/foo.js` does not read the project's package.json,
// so Electron falls back to the name "Electron" and `getPath('userData')`
// points at %APPDATA%\Electron -- a different directory from the one the real
// app uses. A harness that reads and restores settings would then be operating
// on a directory the app never touches, which is worse than not checking at
// all. Set the name before anything asks for a path.
app.setName(require('../package.json').name);

const FILES = 12;
// Large enough that the free-space check is not competing with background disk
// churn. At 512 KB a file the whole payload was 6 MB, which any other process
// writing during the run could swamp -- the assertion failed intermittently for
// that reason alone, which is worse than not asserting it.
const FILE_BYTES = 4 * 1024 * 1024;
const AGE_DAYS = 400;

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const exists = (p) => fsp.access(p).then(() => true, () => false);

app.whenReady().then(async () => {
  // Deliberately not under AppData: anything below an application's data folder
  // is demoted to "review" by the advisor, which is correct behaviour and would
  // make this test prove nothing.
  const base = path.join(os.homedir(), 'cleandrive-autoclean-e2e');
  const cacheDir = path.join(base, 'Cache');
  const ledgerPath = path.join(base, 'ledger.json');

  await fsp.rm(base, { recursive: true, force: true });
  await fsp.mkdir(cacheDir, { recursive: true });

  const created = [];
  const old = new Date(Date.now() - AGE_DAYS * 24 * 60 * 60 * 1000);
  for (let i = 0; i < FILES; i++) {
    const target = path.join(cacheDir, `stale-${i}.bin`);
    await fsp.writeFile(target, Buffer.alloc(FILE_BYTES, i));
    await fsp.utimes(target, old, old);
    created.push(target);
  }

  console.log(`\nverify: ${FILES} files of ${formatBytes(FILE_BYTES)} in ${cacheDir}\n`);

  const before = await diskUsage(base);
  console.log(`  disk before: ${formatBytes(before.freeBytes)} free (${before.usedPercent.toFixed(2)}% used)\n`);

  const settingsFor = (over) =>
    coerceSettings({
      autoClean: {
        enabled: true,
        roots: [base],
        categories: ['cache'],
        minAgeDays: 180,
        skipIfRunning: [],
        ...over,
      },
      purge: { enabled: false, afterDays: 1 },
    }).settings;

  /* ---- 1. report only ---------------------------------------------------- */

  console.log('  step 1: report-only run\n');
  const dry = await runAutoClean({ settings: settingsFor({ dryRun: true }), now: Date.now() });
  check('the report-only run finds every stale file', dry.selected.files === FILES,
    `${dry.selected.files} of ${FILES}`);
  check('it deleted nothing', (await Promise.all(created.map(exists))).every(Boolean));
  check('its outcome says so', dry.outcome === 'dry-run', dry.outcome);

  /* ---- 2. the real thing ------------------------------------------------- */

  console.log('\n  step 2: real run\n');
  const ledger = new TrashLedger(ledgerPath);
  await ledger.load();

  const real = await runAutoClean({ settings: settingsFor({ dryRun: false }), ledger, now: Date.now() });
  check('every file was moved to the Recycle Bin', real.trashed.files === FILES,
    `${real.trashed.files} of ${FILES}`);
  check('the files are gone from where they were',
    (await Promise.all(created.map(exists))).every((e) => e === false));
  check('the ledger recorded them', ledger.entries.length === FILES, String(ledger.entries.length));
  check('the run warns that no space is free yet',
    real.notes.some((n) => n.includes('no space is free')), real.notes.join(' | '));

  const midway = await diskUsage(base);
  console.log(`\n  disk after moving to the bin: ${formatBytes(midway.freeBytes)} free`);
  console.log('  (unchanged, or nearly so, is the correct and often surprising result)\n');

  /* ---- 3. they really are in the bin ------------------------------------- */

  console.log('  step 3: find them in the real Recycle Bin\n');
  const bins = await findUserBins([base]);
  const items = await listItems(bins);
  const ourKeys = new Set(created.map(pathKey));
  const mine = items.filter((item) => ourKeys.has(pathKey(item.originalPath)));

  check('Windows has them under their original paths', mine.length === FILES, `${mine.length} of ${FILES}`);
  check('their recorded deletion time matches ours',
    mine.every((item) => ledger.entries.some((e) =>
      pathKey(e.path) === pathKey(item.originalPath) && Math.abs(e.trashedAt - item.deletedAt) < 5 * 60 * 1000)));

  const binTotal = items.length;
  console.log(`\n  the bin holds ${binTotal.toLocaleString('en-US')} item(s) in total; ` +
    `${mine.length} of them are ours\n`);

  /* ---- 4. purge exactly ours --------------------------------------------- */

  console.log('  step 4: purge, with a zero grace period for the test\n');
  const purge = await purgeRecorded({ entries: ledger.entries, binDirs: bins, afterDays: 0 });

  check('exactly our items were purged', purge.purged.length === FILES,
    `${purge.purged.length} of ${FILES}`);
  check('nothing else in the bin was touched',
    (await listItems(bins)).length === binTotal - FILES,
    `${(await listItems(bins)).length} left, expected ${binTotal - FILES}`);
  check('both halves of each pair are gone',
    (await Promise.all(mine.flatMap((i) => [exists(i.dataPath), exists(i.metaPath)]))).every((e) => e === false));

  await ledger.forget(purge.purged.map((p) => p.entry));
  check('the ledger no longer claims them', ledger.entries.length === 0, String(ledger.entries.length));

  // Windows does not always reflect a deletion in the volume's free-space
  // counter the instant the handle closes.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const after = await diskUsage(base);
  const reclaimed = after.freeBytes - midway.freeBytes;
  console.log(`\n  disk after purge: ${formatBytes(after.freeBytes)} free`);
  console.log(`  reclaimed by the purge: ${formatBytes(Math.max(0, reclaimed))} ` +
    `(the files were ${formatBytes(FILES * FILE_BYTES)})\n`);

  // Still asserted loosely: this measures a resource the whole machine shares,
  // so the claim is "most of it came back", not an exact figure. The contrast
  // with the unchanged reading after the move is the actual result.
  check('the purge is what actually returned the space',
    reclaimed > FILES * FILE_BYTES * 0.5,
    `${formatBytes(reclaimed)} of ${formatBytes(FILES * FILE_BYTES)}`);

  await fsp.rm(base, { recursive: true, force: true });

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
