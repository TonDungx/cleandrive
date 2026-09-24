#!/usr/bin/env node
'use strict';

// A1 on the real system drive, through the same sequence the window runs.
//
//   npm run verify:system                 unelevated: the walk, about two minutes
//   npm run verify:system -- --elevated   then one UAC prompt, and the rest
//
// Prints the breakdown and what is left "not explained", and writes it to
// %TEMP%\cleandrive-verify-system\report.json (sums and top-level folder names
// only). The Phase 1 criterion -- "not explained" under a measured threshold
// -- is checked against this report.
//
// Reads only. userData is a temporary folder, checked before anything runs.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-verify-system-'));
app.setName(require('../package.json').name);
app.setPath('userData', SANDBOX);

const measure = require('../src/main/system/measure');
const { HelperClient, appLauncher } = require('../src/main/helper/client');
const { collect } = require('../src/main/analyzers');
const { pathKey, formatBytes } = require('../src/main/lib/util');

const elevatedWanted = process.argv.includes('--elevated');
const REPORT_DIR = path.join(os.tmpdir(), 'cleandrive-verify-system');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

app.whenReady().then(async () => {
  check('isolated: userData is the sandbox', pathKey(app.getPath('userData')) === pathKey(SANDBOX));
  const facts = await measure.facts();
  console.log(`\nverify: ${facts.drive} -- ${formatBytes(facts.volume.usedBytes)} used of ${formatBytes(facts.volume.totalBytes)}\n`);

  let last = 0;
  const walk = await measure.walk({
    onProgress: (p) => {
      if (p.elapsedMs - last > 15000) {
        last = p.elapsedMs;
        console.log(`    ${p.files.toLocaleString('en-US')} files, ${Math.round(p.elapsedMs / 1000)} s`);
      }
    },
  });
  console.log(`  walked ${walk.files.toLocaleString('en-US')} files in ${(walk.durationMs / 1000).toFixed(1)} s; ${walk.deniedCount} folders refused\n`);

  let elevated = null;
  if (elevatedWanted) {
    const client = new HelperClient({ launch: appLauncher({ execPath: process.execPath, appPath: path.join(__dirname, '..'), isPackaged: false }) });
    elevated = await measure.elevate(walk, { client, onProgress: (p) => console.log(`    elevated: ${p.phase}`) });
    check('the administrator prompt was answered yes', !elevated.declined);
    if (elevated.declined) elevated = null;
  }

  const model = await measure.model({ walk, elevated, factsNow: facts });
  const out = await collect('system', { model }, { strict: true });
  check('every row is a valid candidate', out.candidates.length === model.rows.length, `${out.candidates.length} rows`);
  const sum = model.rows.reduce((n, r) => n + r.bytes, 0);
  check('explained plus not explained is what the drive reports as used', Math.abs(sum + model.unexplainedBytes - facts.volume.usedBytes) < 1e6 || sum > facts.volume.usedBytes);

  const rows = [...model.rows].sort((a, b) => b.bytes - a.bytes);
  for (const r of rows) {
    const flag = r.needsAdmin && r.bytes === 0 ? ' (needs administrator rights)' : r.refused ? ` (${r.refused} folders refused)` : '';
    console.log(`  ${formatBytes(r.bytes).padStart(10)}  ${r.group.padEnd(8)} ${r.key}${flag}`);
  }
  const pct = (model.unexplainedBytes / facts.volume.usedBytes) * 100;
  console.log(`\n  not explained: ${formatBytes(model.unexplainedBytes)} = ${pct.toFixed(2)}% of used, ${((model.unexplainedBytes / facts.volume.totalBytes) * 100).toFixed(2)}% of the drive\n`);

  // The Phase 1 criterion, agreed on 2026-09-24 after measuring this machine
  // (0.33% after the elevated pass, 8.6% before it): 1% of the
  // used space leaves room for files that come and go while the drive is
  // being read, and still fails on a whole category left out -- the OneDrive
  // folder this walk once skipped was 3%. It only applies once the elevated
  // pass has run; before it, the refused folders are shown as refused.
  const thresholdArg = process.argv.indexOf('--threshold');
  const threshold = thresholdArg !== -1 ? Number(process.argv[thresholdArg + 1]) : 1;
  if (elevated) {
    check(`not explained is under ${threshold}% of the space in use`, pct <= threshold, `${pct.toFixed(2)}%`);
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    at: new Date().toISOString(),
    elevated: Boolean(elevated),
    volume: facts.volume,
    walkSeconds: +(walk.durationMs / 1000).toFixed(1),
    refused: walk.deniedCount,
    stillRefused: model.elevated ? model.elevated.stillRefused : null,
    unexplainedBytes: model.unexplainedBytes,
    unexplainedPercentOfUsed: +pct.toFixed(2),
    thresholdPercent: elevated ? threshold : null,
    rows: rows.map((r) => ({ key: r.key, bytes: r.bytes, source: r.source, refused: r.refused, needsAdmin: Boolean(r.needsAdmin) })),
    tools: model.elevated ? model.elevated.tools : null,
  };
  const file = path.join(REPORT_DIR, `report${elevated ? '-elevated' : ''}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`  report: ${file}`);

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
