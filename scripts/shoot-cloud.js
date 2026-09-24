'use strict';

// Screenshots of "Available in the cloud" on What to delete, with OneDrive
// stood in for: a folder this harness builds plays OneDrive, and what Windows
// would say about each file comes from the harness hook. Both themes, the
// selection with its bar, OneDrive not running, the receipt, narrow and
// Vietnamese.
//
//   npx electron scripts/shoot-cloud.js [outputDir]

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootcloud-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootcloud';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootcloud-fixture-'));
const OD = path.join(BASE, 'OneDrive');
// Before anything reads it: this folder is OneDrive for the length of the run.
process.env.OneDrive = OD;

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-cloud.js'))
  || path.join(os.tmpdir(), 'cd-cloud-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

function make(rel, bytes) {
  const full = path.join(OD, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fd = fs.openSync(full, 'w');
  fs.ftruncateSync(fd, bytes);
  fs.closeSync(fd);
  const old = Date.now() - (60 + rel.length * 7) * 86400000;
  fs.utimesSync(full, old / 1000, old / 1000);
  return full;
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');
  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  const cs = require('../src/main/lib/cloud-state');

  const synced = cs.describe(0x420, cs.STATE.PLACEHOLDER | cs.STATE.IN_SYNC);
  const states = new Map();
  for (const [rel, size] of [
    [path.join('Hình ảnh', 'Cuộn phim', 'VID_20240812_183044.mp4'), 420 * MB],
    [path.join('Hình ảnh', 'Cuộn phim', 'VID_20240815_091210.mp4'), 260 * MB],
    [path.join('Documents', 'Luận văn', 'thesis-final.pdf'), 38 * MB],
    [path.join('Documents', 'Scans', 'hop-dong-2023.pdf'), 12 * MB],
    [path.join('Máy tính', 'setup-files.zip'), 95 * MB],
  ]) states.set(make(rel, size), synced);
  states.set(make(path.join('Documents', 'Always here', 'passport.pdf'), 6 * MB), cs.describe(0x420 | cs.ATTR.PINNED, cs.STATE.PLACEHOLDER | cs.STATE.IN_SYNC));
  states.set(make(path.join('Documents', 'VMs', 'win11.vmdk'), 1800 * MB), cs.describe(0x20, 0));
  states.set(make(path.join('Documents', 'draft.docx'), 3 * MB), cs.describe(0x420, cs.STATE.PLACEHOLDER));

  const fake = { running: true, made: [] };
  ipc.setCloudDepsForHarness({
    running: async () => fake.running,
    query: async (paths) => ({ ok: true, states: new Map(paths.map((p) => [p, states.get(p) || cs.describe(0x20, 0)])) }),
    makeOnlineOnly: async (file) => {
      fake.made.push(file);
    },
    allocated: async (file) => (fake.made.includes(file) ? 0 : fs.statSync(file).size),
    watchMs: 1500,
    stepMs: 50,
  });

  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
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
  win.webContents.on('console-message', (...a) => {
    const level = typeof a[1] === 'object' ? a[1].level : a[1];
    const message = typeof a[1] === 'object' ? a[1].message : a[2];
    if (level === 3 || level === 'error') errors.push(message);
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (expr) => win.webContents.executeJavaScript(expr);
  await wait(500);
  const shoot = async (name) => {
    win.webContents.invalidate();
    await wait(350);
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let n = 0; n < 3 && bytes.length === 0; n++) {
      await wait(400);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };
  const theme = async (name) => {
    nativeTheme.themeSource = name;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(name)})`);
    await wait(500);
  };
  const toCard = () => js(`document.getElementById('cloud-card').scrollIntoView({ block: 'start' })`);

  try {
    await js(`setFolder(${JSON.stringify(BASE)}); document.getElementById('run-scan').click()`);
    for (let i = 0; i < 120 && !(await js(`window.CloudCard.debug().summary !== null`)); i++) await wait(250);
    await js(`document.querySelector('.tab[data-tab="cleanup"]').click()`);
    await wait(500);

    for (const name of ['light', 'dark']) {
      await theme(name);
      await toCard();
      await shoot(`cloud-${name}`);
    }
    await theme('light');
    await js(`document.getElementById('cloud-select-all').click()`);
    await wait(300);
    await toCard();
    await shoot('cloud-selected-light');

    fake.running = false;
    await js(`window.CloudCard.run({ confirm: false })`);
    await wait(200);
    await shoot('cloud-refused-off-light');

    fake.running = true;
    await js(`(() => { document.getElementById('cloud-select-all').click(); })()`);
    await js(`window.CloudCard.run({ confirm: false })`);
    await wait(200);
    await toCard();
    await shoot('cloud-done-light');

    // Scan again for the language and the narrow window, with a fresh card.
    fake.made.length = 0;
    await js(`document.querySelector('.tab[data-tab="usage"]').click(); document.getElementById('run-scan').click()`);
    await wait(1500);
    await js(`document.querySelector('.tab[data-tab="cleanup"]').click()`);
    await js(`document.querySelector('[data-language-choice="vi"]').click()`);
    await wait(900);
    await toCard();
    await shoot('cloud-vi-light');
    await js(`document.getElementById('cloud-select-all').click()`);
    await wait(300);
    await shoot('cloud-vi-selected-light');
    await js(`document.querySelector('[data-language-choice="en"]').click()`);
    await wait(700);

    await theme('dark');
    win.setSize(700, 820);
    await wait(900);
    await toCard();
    await shoot('cloud-narrow-dark');
  } finally {
    fs.rmSync(BASE, { recursive: true, force: true });
  }

  console.log(`\nwritten to ${OUT}`);
  console.log(errors.length ? `renderer errors: ${errors.slice(0, 4).join(' | ')}` : 'no renderer errors');
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
