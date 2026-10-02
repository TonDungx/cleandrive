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

  /* ---- 1b. where the line between fetching and installing sits ----------- */
  // The first version made the user click three times: check, download,
  // restart. That was the wrong line -- downloading costs bandwidth, installing
  // is what changes the app. These assert the corrected policy.
  //
  // Since Phase 6 the fetch is started by the app's own handler rather than by
  // the library, so that one kind of update can be held (part 4).
  {
    const { autoUpdater } = require('electron-updater');
    updater.loadForHarness();
    check('the library does not fetch by itself: the app decides, update by update', autoUpdater.autoDownload === false);
    check('a declined update still installs on the next real quit',
      autoUpdater.autoInstallOnAppQuit === true);
  }

  /* ---- 1c. saying so afterwards ------------------------------------------ */
  // An update that finishes in silence leaves people unsure it worked.
  {
    const fsp = require('node:fs/promises');
    const { SettingsStore } = require('../src/main/lib/settings');
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-ver-'));
    const store = new SettingsStore(path.join(tmp, 'settings.json'));

    await store.load();
    await updater.noteVersion(store);
    check('a first run records the version without claiming an update',
      updater.snapshot().justUpdated === null);
    check('and the version is remembered',
      (await store.get()).updates.lastVersion === app.getVersion(),
      String((await store.get()).updates.lastVersion));

    await store.patch({ updates: { lastVersion: '0.0.1' } });
    await updater.noteVersion(store);
    check('a run after an update reports what it came from',
      updater.snapshot().justUpdated === '0.0.1', String(updater.snapshot().justUpdated));

    updater.acknowledgeUpdate();
    check('and the notice clears once shown', updater.snapshot().justUpdated === null);

    await updater.noteVersion(store);
    check('the same launch is not reported as an update twice',
      updater.snapshot().justUpdated === null);

    await fsp.rm(tmp, { recursive: true, force: true });
  }

  /* ---- 2. the scheduled run must never reach it -------------------------- */
  // Read from the source rather than asserted about behaviour: the guarantee is
  // structural, and a test that only ran the happy path would not notice the
  // day someone moves the call above the branch.
  {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    // The end is the call's prefix: since I3 the lock takes an argument, and the
    // old full-call marker stopped matching -- the slice then ran to the end of
    // main.js and this check failed on the window's own branch.
    const start = mainSource.indexOf('if (isScheduledRun)');
    const end = mainSource.indexOf('} else if (!app.requestSingleInstanceLock(');
    check('both ends of the scheduled-run branch are found in main.js', start >= 0 && end > start, `${start}..${end}`);
    const scheduledBranch = mainSource.slice(start, end);
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

    /* ---- 4. an update that would end Pro (§7.6) ------------------------- */
    // A yearly licence keeps Pro on the versions released before it ended.
    // The feed above says its release is today; a licence that ended a month
    // ago must hold it back, and nothing else may.
    console.log('\n  an update that would end Pro\n');
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      if (!pathOf(req.url).endsWith('latest.yml')) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/yaml' });
      res.end(feed);
    });
    const licence = require('../src/main/license/state');
    const issuer = require('../src/main/license/mock-issuer');
    const licDir = require('./lib/sandbox').removeAfterExit(fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-updlicence-')));
    licence.setFileForHarness(path.join(licDir, 'license.dat'));
    check('isolated: the licence is the harness\'s own', licence.licenceFile().startsWith(licDir));
    autoUpdater.removeAllListeners('update-available');
    autoUpdater.removeAllListeners('update-not-available');
    updater.loadForHarness();
    let downloads = 0;
    autoUpdater.downloadUpdate = async () => { downloads += 1; return []; };
    const DAY = 24 * 60 * 60 * 1000;
    const ask = async () => { await autoUpdater.checkForUpdates().catch(() => {}); await wait(800); return updater.snapshot(); };

    const ended = issuer.issue({ plan: 'pro-annual', tier: 'pro', seats: 3, expires: new Date(Date.now() - 30 * DAY).toISOString() });
    await licence.activate(ended.token, {});
    let s = await ask();
    check('released after a yearly licence ended: held, not fetched', downloads === 0 && s.status === 'available' && s.licenceHold && s.licenceHold.expires === licence.storedLicence().expires,
      `downloads ${downloads}, hold ${JSON.stringify(s.licenceHold)}`);

    const running = issuer.issue({ plan: 'pro-annual', tier: 'pro', seats: 3, expires: new Date(Date.now() + 300 * DAY).toISOString() });
    await licence.activate(running.token, {});
    s = await ask();
    check('a licence still running: fetched at once, as before', downloads === 1 && !s.licenceHold, `downloads ${downloads}`);

    const lifetime = issuer.issue({ plan: 'pro-lifetime', tier: 'pro', seats: 3, expires: null });
    await licence.activate(lifetime.token, {});
    s = await ask();
    check('lifetime covers every later version: fetched', downloads === 2 && !s.licenceHold, `downloads ${downloads}`);

    const business = issuer.issue({ plan: 'business-annual', tier: 'business', seats: 5, expires: new Date(Date.now() - 30 * DAY).toISOString() });
    await licence.activate(business.token, {});
    s = await ask();
    check('Business has no fallback to lose: fetched', downloads === 3 && !s.licenceHold, `downloads ${downloads}`);

    await licence.deactivate();
    s = await ask();
    check('and Free: fetched', downloads === 4 && !s.licenceHold, `downloads ${downloads}`);
    licence.setFileForHarness(null);
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
