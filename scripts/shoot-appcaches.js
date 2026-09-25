'use strict';

// Screenshots of known apps' caches on What to delete, with AppData stood in
// for: a folder this harness builds is LOCALAPPDATA and APPDATA, laid out as
// the fixtures say the apps lay theirs out, and the process list comes from
// the harness hook. Chrome is open, the others closed; then nothing can tell
// what is running. Both themes, a selection, narrow, Vietnamese, and the
// Automatic tab's list.
//
//   npx electron scripts/shoot-appcaches.js [outputDir]

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootapps-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootapps';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootapps-fixture-'));
const LOCAL = path.join(BASE, 'AppData', 'Local');
const ROAMING = path.join(BASE, 'AppData', 'Roaming');

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-appcaches.js'))
  || path.join(os.tmpdir(), 'cd-appcaches-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

function make(base, rel, bytes, days = 3) {
  const full = path.join(base, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fd = fs.openSync(full, 'w');
  fs.ftruncateSync(fd, bytes);
  fs.closeSync(fd);
  const at = Date.now() - days * 86400000;
  fs.utimesSync(full, at / 1000, at / 1000);
  return full;
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');
  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();

  const chrome = 'Google/Chrome/User Data';
  make(LOCAL, `${chrome}/Default/Cache/Cache_Data/f_00a1b2`, 212 * MB);
  make(LOCAL, `${chrome}/Default/Cache/Cache_Data/f_00a1c9`, 96 * MB);
  make(LOCAL, `${chrome}/Default/Code Cache/js/index-dir`, 64 * MB);
  make(LOCAL, `${chrome}/Profile 1/GPUCache/data_1`, 18 * MB);
  make(LOCAL, `${chrome}/GrShaderCache/data_1`, 9 * MB);
  make(LOCAL, `${chrome}/Default/IndexedDB/https_mail.example_0.indexeddb.leveldb/000003.log`, 140 * MB);
  const edge = 'Microsoft/Edge/User Data';
  make(LOCAL, `${edge}/Default/Cache/Cache_Data/f_0019ee`, 380 * MB, 12);
  make(LOCAL, `${edge}/Default/Code Cache/wasm/index-dir`, 120 * MB, 12);
  make(LOCAL, `${edge}/ShaderCache/data_2`, 14 * MB, 12);
  make(LOCAL, `${edge}/Default/Service Worker/CacheStorage/blob`, 600 * MB, 12);
  make(LOCAL, 'Packages/MSTeams_8wekyb3d8bbwe/LocalCache/Microsoft/MSTeams/EBWebView/Default/Cache/Cache_Data/f_1', 150 * MB, 20);
  make(ROAMING, 'discord/Cache/Cache_Data/f_7788', 88 * MB, 6);
  make(ROAMING, 'discord/Code Cache/js/index', 31 * MB, 6);
  make(LOCAL, 'Temp/setup-log-2024.tmp', 42 * MB, 40);

  const fake = { running: new Set(['chrome.exe', 'explorer.exe']) };
  ipc.setAppCacheHarness({
    env: { LOCALAPPDATA: LOCAL, APPDATA: ROAMING },
    runningProcessNames: async () => fake.running,
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
  const scan = async () => {
    await js(`document.querySelector('.tab[data-tab="usage"]').click()`);
    await js(`setFolder(${JSON.stringify(BASE)}); window.__before = state.scan; document.getElementById('run-scan').click()`);
    for (let i = 0; i < 160 && !(await js(`document.getElementById('run-scan').disabled === false && state.scan !== window.__before`)); i++) await wait(250);
    await js(`document.querySelector('.tab[data-tab="cleanup"]').click()`);
    await wait(500);
  };
  const toGroup = (category) =>
    js(`(() => { const s = document.querySelector('section.group[data-category="${category}"]'); if (s) s.scrollIntoView({ block: 'start' }); return !!s; })()`);
  const toTop = () => js(`document.getElementById('cleanup-stats').scrollIntoView({ block: 'start' })`);

  try {
    await scan();
    for (const name of ['light', 'dark']) {
      await theme(name);
      await toTop();
      await shoot(`appcaches-top-${name}`);
      await toGroup('app.chrome');
      await shoot(`appcaches-open-${name}`);
    }
    await theme('light');
    await js(`document.getElementById('select-safe').click()`);
    await wait(300);
    await toGroup('app.edge');
    await shoot('appcaches-selected-light');
    await js(`document.getElementById('cleanup-select-none').click()`);

    await js(`document.querySelector('[data-language-choice="vi"]').click()`);
    await wait(900);
    await toTop();
    await shoot('appcaches-vi-top-light');
    await toGroup('app.chrome');
    await shoot('appcaches-vi-open-light');
    await js(`document.querySelector('.tab[data-tab="auto"]').click()`);
    await wait(700);
    await js(`document.getElementById('auto-categories').scrollIntoView({ block: 'center' })`);
    await shoot('appcaches-vi-automatic-light');
    await js(`document.querySelector('[data-language-choice="en"]').click()`);
    await wait(700);
    await js(`document.getElementById('auto-categories').scrollIntoView({ block: 'center' })`);
    await shoot('appcaches-automatic-light');

    fake.running = null;
    await scan();
    await toGroup('app.edge');
    await shoot('appcaches-unknown-light');

    fake.running = new Set(['chrome.exe', 'explorer.exe']);
    await scan();
    await theme('dark');
    win.setSize(700, 820);
    await wait(900);
    await toGroup('app.chrome');
    await shoot('appcaches-narrow-dark');
  } finally {
    ipc.setAppCacheHarness(null);
    fs.rmSync(BASE, { recursive: true, force: true });
  }

  console.log(`\nwritten to ${OUT}`);
  console.log(errors.length ? `renderer errors: ${errors.slice(0, 4).join(' | ')}` : 'no renderer errors');
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
