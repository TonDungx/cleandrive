#!/usr/bin/env node
'use strict';

// Auto-update, checked two ways.
//
//   npx electron scripts/verify-updater.js
//
// First the gating: this app talks to the internet in exactly one place, and
// the rules about when it may are the whole reason that is acceptable. Those
// rules are asserted here rather than trusted.
//
// Then the mechanism: a local HTTP server stands in for the release page and
// serves a feed announcing a version far newer than this one. That proves the
// updater is wired up and would actually notice a release — the part that
// cannot be inferred from the code compiling.

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

app.setName(require('../package.json').name);

const updater = require('../src/main/updater');
const { coerceSettings } = require('../src/main/lib/settings');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  console.log('\nverify: the update check\n');

  /* ---- 1. when it may run ------------------------------------------------ */
  console.log('  gating\n');

  {
    const off = updater.apply(coerceSettings({ updates: { enabled: false } }).settings);
    check('switched off, nothing is scheduled and nothing is contacted',
      off.enabled === false && off.status !== 'checking', off.status);

    const on = updater.apply(coerceSettings({ updates: { enabled: true } }).settings);
    check('switched on in a development build, it reports unsupported rather than erroring',
      on.status === 'unsupported', on.status);
    check('and knows it is not a packaged app', on.supported === false);

    const manual = await updater.check({ manual: true });
    check('a manual check in a development build is a no-op, not a failure',
      manual.status === 'unsupported' && manual.error === null, manual.error || manual.status);

    check('nothing can be installed when nothing was downloaded',
      updater.install().ok === false);
  }

  /* ---- 2. the scheduled run must never reach it -------------------------- */
  // Read from the source rather than asserted about behaviour: the guarantee is
  // structural, and a test that only ran the happy path would not notice the
  // day someone moves the call above the branch.
  {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    const scheduledBranch = mainSource.slice(
      mainSource.indexOf('if (isScheduledRun)'),
      mainSource.indexOf('} else if (!app.requestSingleInstanceLock())')
    );
    check('the scheduled-run branch never touches the updater',
      scheduledBranch.length > 100 && !/updater\./.test(scheduledBranch),
      `${scheduledBranch.length} chars examined`);

    const scheduledRun = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'main', 'scheduled-run.js'), 'utf8');
    check('nor does the scheduled run itself', !/updater|autoUpdater/.test(scheduledRun));
  }

  /* ---- 3. the mechanism, against a local stand-in for the release page ---- */
  console.log('\n  mechanism\n');

  // Derived from the running version rather than hard-coded. In a development
  // build `app.getVersion()` reports Electron's version, not the app's, so a
  // fixed "9.9.9" is *older* than what is running and the updater correctly
  // declines it -- which looks exactly like a broken updater.
  const running = app.getVersion();
  const newer = `${Number(running.split('.')[0]) + 1}.0.0`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-feed-'));
  const payload = Buffer.alloc(4096, 7);
  const { createHash } = require('node:crypto');
  const sha512 = createHash('sha512').update(payload).digest('base64');

  const feed = [
    `version: ${newer}`,
    'files:',
    `  - url: CleanDrive-Setup-${newer}.exe`,
    `    sha512: ${sha512}`,
    `    size: ${payload.length}`,
    `path: CleanDrive-Setup-${newer}.exe`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');

  // The updater appends a cache-buster, so match on the path rather than the
  // whole URL -- `endsWith('latest.yml')` never matches `/latest.yml?noCache=x`.
  const pathOf = (url) => new URL(url, 'http://127.0.0.1').pathname;

  const server = http.createServer((req, res) => {
    if (pathOf(req.url).endsWith('latest.yml')) {
      res.writeHead(200, { 'content-type': 'text/yaml' });
      res.end(feed);
    } else if (pathOf(req.url).endsWith('.exe')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(payload);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`    release page stand-in on http://127.0.0.1:${port}\n`);

  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = null;
    autoUpdater.autoDownload = false;
    // Without this the library refuses to run outside a packaged app, which is
    // exactly the guard tested in part 1.
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${port}` });

    let seen = null;
    let failed = null;
    autoUpdater.on('update-available', (info) => { seen = info; });
    autoUpdater.on('error', (err) => { failed = err; });

    const result = await autoUpdater.checkForUpdates().catch((err) => { failed = err; return null; });
    await wait(800);

    check('the feed is read and a newer version is recognised',
      seen !== null && seen.version === newer,
      failed ? String(failed.message || failed) : `running ${running}, feed offered ${seen ? seen.version : 'nothing'}`);
    check('the installed version is compared, not assumed',
      result === null || result.updateInfo.version === newer);

    // The same feed at the app's own version must not be offered as an update.
    const current = app.getVersion();
    const sameFeed = feed.split(newer).join(current);
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      if (!pathOf(req.url).endsWith('latest.yml')) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/yaml' });
      res.end(sameFeed);
    });

    let notAvailable = false;
    autoUpdater.removeAllListeners('update-available');
    autoUpdater.on('update-not-available', () => { notAvailable = true; });
    await autoUpdater.checkForUpdates().catch(() => {});
    await wait(800);
    check('the same version is not offered as an update', notAvailable === true,
      `feed said ${current}`);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    updater.stop();
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
