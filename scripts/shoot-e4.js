'use strict';

// Screenshots of E4: the timeline drilling from years to a day, and the map --
// both themes, Vietnamese, and the narrow widths.
//
//   npx electron scripts/shoot-e4.js [outputDir]
//
// The library is built here, with real EXIF: capture dates spread over years
// so the timeline has something to drill into, and positions on a few of them
// so the map has pins. Nothing is staged -- the real scan reads the real
// headers and the real screen draws what comes back.
//
// The map's tiles come from the network. When the network is not there, the
// screenshots still get taken: the map says what went wrong and draws the pins
// on an empty background, which is a state worth photographing too.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shoote4-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shoote4';
require('../src/main/lib/preview/serve').registerScheme();

const { jpegWithExif } = require('./lib/exif-fixture');

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-e4.js')) ||
  path.join(os.tmpdir(), 'cd-e4-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

/**
 * A library with a shape worth drawing: a long tail of older years, a heavy
 * recent one, one very busy day inside it, and a handful of positions.
 */
function buildLibrary(root) {
  const put = (relative, bytes) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
  };

  let serial = 0;
  const shot = (when, { lat = null, lon = null, folder = 'Camera' } = {}) => {
    serial += 1;
    const name = `IMG_${String(serial).padStart(4, '0')}.jpg`;
    put(
      path.join(folder, name),
      jpegWithExif({
        width: 4032,
        height: 3024,
        padTo: 900 * 1024,
        make: 'Apple',
        model: 'iPhone 13',
        takenAt: when,
        lat,
        lon,
      })
    );
  };

  // A few each across several years, so the year bars have a shape.
  for (const [year, count] of [[2019, 3], [2020, 6], [2021, 4], [2022, 9], [2023, 14]]) {
    for (let i = 0; i < count; i++) shot(new Date(year, (i * 3) % 12, 4 + (i % 20), 11, 0, 0));
  }

  // One recent year carrying most of it, with the weight in two months.
  for (let i = 0; i < 22; i++) shot(new Date(2026, 2, 2 + (i % 26), 9, 0, 0));
  for (let i = 0; i < 31; i++) shot(new Date(2026, 8, 1 + (i % 28), 15, 0, 0));
  // And one day that stands out inside September, the way a real event does.
  for (let i = 0; i < 24; i++) shot(new Date(2026, 8, 17, 10 + (i % 10), i, 0));

  // Positions: a cluster, a second place, and one far away -- enough that the
  // map has to cluster, and that "fit all" has work to do.
  const places = [
    [21.0285, 105.8542], [21.0291, 105.8549], [21.0277, 105.8531], [21.03, 105.856],
    [16.0544, 108.2022], [16.0601, 108.2099],
    [35.6762, 139.6503],
  ];
  places.forEach(([lat, lon], i) => shot(new Date(2026, 8, 17, 12, i, 0), { lat, lon, folder: 'Trips' }));
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');

  const base = fs.mkdtempSync(path.join('D:\\', 'cleandrive-shoot-e4-'));
  if (!base.toLowerCase().startsWith('d:\\')) throw new Error(`fixture is not on D: (${base})`);

  try {
    require('../src/main/lib/preview/serve').serve();
    require('../src/main/ipc').register();
    fs.mkdirSync(OUT, { recursive: true });

    buildLibrary(base);
    console.log(`\nfixture: ${base}`);
    console.log(`output:  ${OUT}\n`);

    const win = new BrowserWindow({
      width: 1180,
      height: 980,
      show: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const errors = [];
    win.webContents.on('console-message', (...args) => {
      const level = typeof args[1] === 'object' ? args[1].level : args[1];
      const message = typeof args[1] === 'object' ? args[1].message : args[2];
      if (level === 3 || level === 'error') errors.push(message);
    });

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), {
      query: { theme: 'light', lang: 'en' },
    });
    nativeTheme.themeSource = 'light';
    win.focus();
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    const read = (expr) => win.webContents.executeJavaScript(expr);
    await wait(800);

    const shoot = async (name) => {
      await wait(400);
      win.webContents.invalidate();
      await win.webContents.capturePage();
      await wait(150);
      let bytes = (await win.webContents.capturePage()).toPNG();
      for (let k = 0; k < 3 && bytes.length === 0; k++) {
        await wait(300);
        bytes = (await win.webContents.capturePage()).toPNG();
      }
      fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
      console.log(`  ${name}.png`);
    };
    const theme = async (mode) => {
      nativeTheme.themeSource = mode;
      await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
      await wait(300);
    };
    const until = async (expr, ms = 180000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await read(`Boolean(${expr})`)) return true;
        await wait(200);
      }
      throw new Error(`timed out: ${expr}`);
    };

    /* -- scan the fixture ------------------------------------------------- */

    // The same way `shoot-media.js` points a scan at a fixture: turn the real
    // roots off and give it one of our own, so nothing here depends on what is
    // in the tester's Pictures folder.
    const scan = async () => {
      await js(`document.querySelector('.tab[data-tab="media"]').click();`);
      await wait(400);
      await js(`
        for (const root of media.roots) root.on = false;
        media.extraRoots = [{ path: ${JSON.stringify(base)}, name: 'Photos', why: null, on: true }];
        renderRoots();
        document.getElementById('media-scan').click();
      `);
      await until(`document.getElementById('media-cancel').hidden === true`);
      await wait(1200);
    };
    await scan();

    const found = await read(`({
      total: (window.mediaFiles ? window.mediaFiles().length : 0),
      located: (window.mediaFiles ? window.mediaFiles().filter((f) => f.hasGps).length : 0),
      withCoords: (window.mediaFiles ? window.mediaFiles().filter((f) => Number.isFinite(f.lat)).length : 0),
      timeline: document.getElementById('ov-years-card').hidden === false,
      mapCard: document.getElementById('ov-map-card').hidden === false,
    })`);
    console.log(`  ${found.total} files · ${found.located} with a position · ${found.withCoords} carrying coordinates`);
    console.log(`  timeline card: ${found.timeline} · map card: ${found.mapCard}\n`);

    /* -- the timeline ----------------------------------------------------- */

    const toOverview = `document.getElementById('ov-years-card').scrollIntoView({ block: 'center' });`;
    await js(toOverview);
    await shoot('timeline-years-light');
    await theme('dark');
    await shoot('timeline-years-dark');
    await theme('light');

    // Drill: a year, then a month, then the day that stands out.
    // Matched on every word rather than on a prefix: a day's label is built by
    // `toLocaleDateString`, so it reads "Sep 17" under one locale and "17 Sep"
    // under another -- and a prefix match silently clicked nothing, which left
    // two screenshots showing the same month twice.
    const clickBar = async (...words) => {
      const hit = await read(`(() => {
        const bars = [...document.querySelectorAll('#ov-years .ov-year')];
        const want = ${JSON.stringify(words)};
        const found = bars.find((b) => {
          const label = b.getAttribute('aria-label') || '';
          return want.every((w) => label.includes(w));
        });
        if (found) { found.click(); return found.getAttribute('aria-label'); }
        return null;
      })()`);
      if (!hit) throw new Error(`no bar matched ${words.join(' + ')}`);
      console.log(`  clicked: ${hit}`);
      await wait(600);
    };

    await clickBar('2026');
    await js(toOverview);
    await shoot('timeline-months-light');
    await theme('dark');
    await shoot('timeline-months-dark');
    await theme('light');

    await clickBar('September');
    await js(toOverview);
    await shoot('timeline-days-light');

    await clickBar('Sep', '17');
    await js(toOverview);
    await shoot('timeline-oneday-light');
    console.log(`  trail: ${await read(`document.getElementById('ov-when-trail').textContent`)}`);
    console.log(`  note:  ${await read(`document.getElementById('ov-when-dated').textContent`)}`);

    // Back out by the trail, which is the other half of the gesture.
    await js(`
      const steps = [...document.querySelectorAll('#ov-when-trail .ov-trail-step')];
      if (steps[0]) steps[0].click();
    `);
    await wait(500);
    await js(toOverview);
    await shoot('timeline-back-light');

    /* -- the map ---------------------------------------------------------- */

    const toMap = `document.getElementById('ov-map-card').scrollIntoView({ block: 'center' });`;
    await js(toMap);
    await shoot('map-consent-light');
    await theme('dark');
    await shoot('map-consent-dark');
    await theme('light');

    await js(`document.getElementById('ov-map-turn-on').click();`);
    await wait(1200);
    await js(toMap);
    await shoot('map-after-consent-light');

    // The positions were left out of the scan that ran with the map off, so a
    // second scan is what actually puts pins on it.
    await scan();
    await js(toMap);
    await wait(3500);
    await js(toMap);
    await shoot('map-light');
    await theme('dark');
    await shoot('map-dark');
    await theme('light');

    const mapState = await read(`({
      pins: document.querySelectorAll('#ov-map .map-pin').length,
      tiles: document.querySelectorAll('#ov-map .map-tile').length,
      drawn: [...document.querySelectorAll('#ov-map .map-tile')].filter((i) => i.src).length,
      note: document.getElementById('ov-map-note').textContent,
      credit: (document.querySelector('#ov-map .map-credit') || {}).textContent || '',
    })`);
    console.log(`\n  pins ${mapState.pins} · tiles ${mapState.drawn}/${mapState.tiles} drawn`);
    console.log(`  note:   ${mapState.note}`);
    console.log(`  credit: ${mapState.credit}`);

    // Zoomed in, and a cluster clicked -- which filters the grid.
    await js(`document.getElementById('ov-map-in').click();`);
    await wait(2500);
    await js(toMap);
    await shoot('map-zoomed-light');

    await js(`
      const pin = document.querySelector('#ov-map .map-pin');
      if (pin) pin.click();
    `);
    await wait(900);
    await js(`document.getElementById('media-tokens').scrollIntoView({ block: 'center' });`);
    await shoot('map-picked-light');
    console.log(`  after clicking a cluster: ${await read(`document.getElementById('media-tokens').textContent`)}`);

    /* -- narrow, and Vietnamese ------------------------------------------- */

    for (const width of [900, 720]) {
      win.setBounds({ width, height: 980 });
      await wait(700);
      await js(toMap);
      await shoot(`map-${width}`);
      await js(toOverview);
      await shoot(`timeline-${width}`);
    }
    win.setBounds({ width: 1180, height: 980 });
    await wait(500);

    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="vi"]').click();
    `);
    await wait(900);
    await js(`document.getElementById('map-cache-card').scrollIntoView({ block: 'center' });`);
    await shoot('cache-card-vi');
    console.log(`  cache card: ${await read(`document.getElementById('map-cache-state').textContent`)}`);

    await js(`document.querySelector('.tab[data-tab="media"]').click();`);
    await wait(600);
    await js(toOverview);
    await shoot('timeline-vi');
    await js(toMap);
    await shoot('map-vi');

    if (errors.length) console.log(`\n  renderer errors: ${errors.length}\n${errors.map((e) => `    ${e}`).join('\n')}`);
    else console.log('\n  no renderer errors');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    app.quit();
  }
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
