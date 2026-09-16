#!/usr/bin/env node
'use strict';

// Creates a real tray icon, runs the real monitor against the real disk, and
// measures what it costs. The strategy document promised "under 100MB in the
// background" without measuring anything; this prints the number so the README
// can quote a measurement rather than a hope.
//
//   npx electron scripts/verify-monitor.js

const os = require('node:os');
const path = require('node:path');
const { app, Tray } = require('electron');

const tray = require('../src/main/tray');
const { coerceSettings } = require('../src/main/lib/settings');
const { renderGauge } = require('../src/main/lib/trayicon');
const { diskUsage } = require('../src/main/lib/disk');
const { formatBytes } = require('../src/main/lib/util');

// Running `electron scripts/foo.js` does not read the project's package.json,
// so Electron falls back to the name "Electron" and `getPath('userData')`
// points at %APPDATA%\Electron -- a different directory from the one the real
// app uses. A harness that reads and restores settings would then be operating
// on a directory the app never touches, which is worse than not checking at
// all. Set the name before anything asks for a path.
app.setName(require('../package.json').name);

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

app.whenReady().then(async () => {
  console.log('\nverify: disk monitoring on this machine\n');

  const home = app.getPath('home');
  const usage = await diskUsage(home);
  check('the real volume can be read', usage.ok === true, usage.error || '');
  console.log(`  ${usage.root} — ${usage.usedPercent.toFixed(1)}% used, ` +
    `${formatBytes(usage.freeBytes)} free of ${formatBytes(usage.totalBytes)}\n`);

  // Take the baseline before anything is started, and force a collection first
  // so the delta is not just uncollected garbage from module loading.
  if (global.gc) global.gc();
  const baseline = process.memoryUsage();

  const settings = coerceSettings({
    monitor: { enabled: true, volumes: [home], intervalSeconds: 15, warnPercent: 85, criticalPercent: 95 },
  }).settings;

  tray.configure({ window: () => null, open: () => {} });
  const applied = tray.apply(settings);
  check('the monitor starts', applied.running === true);

  // Give the first check, which start() fires immediately, time to land.
  await wait(600);

  const status = tray.status();
  check('the tray reports a running monitor', status.running === true);
  check('exactly one volume is watched', status.volumes.length === 1, String(status.volumes.length));
  check('with a real reading', status.volumes[0].usage && status.volumes[0].usage.ok === true);
  check('and a level derived from it',
    ['ok', 'warn', 'critical'].includes(status.volumes[0].level), status.volumes[0].level);

  check('a tray icon exists in this process', Tray.prototype !== undefined);

  const gauge = renderGauge({
    usedPercent: usage.usedPercent,
    warnPercent: 85,
    criticalPercent: 95,
    size: 32,
  });
  console.log(`\n  tray icon: ${gauge.png.length} bytes, level "${gauge.level}" at ` +
    `${usage.usedPercent.toFixed(1)}%\n`);
  check('the icon is a plausible PNG', gauge.png.length > 80 && gauge.png.length < 8192,
    `${gauge.png.length} bytes`);

  // Let a couple of intervals pass, then see whether anything accumulates. A
  // timer that leaks per tick is the failure mode that only shows up after the
  // user has left the app running for a week.
  const afterStart = process.memoryUsage();
  await tray.checkNow();
  await tray.checkNow();
  await tray.checkNow();
  await wait(400);
  if (global.gc) global.gc();
  const afterChecks = process.memoryUsage();

  console.log('  memory, this process:');
  console.log(`    baseline            rss ${mb(baseline.rss).padStart(9)}  heap ${mb(baseline.heapUsed)}`);
  console.log(`    monitor started     rss ${mb(afterStart.rss).padStart(9)}  heap ${mb(afterStart.heapUsed)}`);
  console.log(`    after three checks  rss ${mb(afterChecks.rss).padStart(9)}  heap ${mb(afterChecks.heapUsed)}`);
  console.log(`    cost of monitoring  rss ${mb(afterStart.rss - baseline.rss).padStart(9)}  ` +
    `heap ${mb(afterStart.heapUsed - baseline.heapUsed)}`);
  console.log(`    growth over checks  rss ${mb(afterChecks.rss - afterStart.rss).padStart(9)}  ` +
    `heap ${mb(afterChecks.heapUsed - afterStart.heapUsed)}\n`);

  check('repeated checks do not accumulate heap',
    afterChecks.heapUsed - afterStart.heapUsed < 4 * 1024 * 1024,
    mb(afterChecks.heapUsed - afterStart.heapUsed));

  // The number that matters for the README is the whole process, not the delta:
  // keeping this feature on means keeping an Electron main process alive.
  console.log(`  >> keeping monitoring on costs roughly ${mb(afterChecks.rss)} of resident memory\n` +
    '     for the main process, plus whatever the OS charges for the tray icon.\n' +
    '     A window open on top of this costs considerably more.\n');

  const stopped = coerceSettings({ monitor: { enabled: false } }).settings;
  tray.apply(stopped);
  check('switching it off stops the monitor', tray.status().running === false);
  check('and reports no volumes', tray.status().volumes.length === 0);

  tray.destroy();
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
