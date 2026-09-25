'use strict';

// Screenshots of I3's window side: the Settings card (as a checkout shows it,
// and switched on over a stand-in for reg.exe) and a search for the copies of
// one file, in both themes, in Vietnamese and in a narrow window.
//
//   npx electron scripts/shoot-explorer.js [outputDir]
//
// Throwaway userData, suffixed task names, a folder of its own; the registry
// is scripts/fake-reg.js.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootexplorer-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootexplorer';
require('../src/main/lib/preview/serve').registerScheme();
const { createFakeReg } = require('./fake-reg');

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-explorer.js'))
  || path.join(os.tmpdir(), 'cd-explorer-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  fs.mkdirSync(OUT, { recursive: true });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootexplorer-fixture-'));
  const body = crypto.randomBytes(2 * 1024 * 1024);
  for (const rel of ['Documents\\Hợp đồng 2025.pdf', 'Downloads\\Hợp đồng 2025 (1).pdf', 'Backup\\old\\Hợp đồng 2025.pdf']) {
    const f = path.join(work, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    fs.utimesSync(f, new Date(Date.now() - rel.length * 86400000), new Date(Date.now() - rel.length * 86400000));
  }
  ipc.setCopiesScopeForHarness(work);
  console.log(`\noutput: ${OUT}\n`);

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
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
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'en' } });
  nativeTheme.themeSource = 'light';
  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  await wait(600);

  const shoot = async (name) => {
    await wait(400);
    win.webContents.invalidate();
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let n = 0; n < 3 && bytes.length === 0; n++) {
      await wait(300);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };
  const toCard = () => js(`document.querySelector('.tab[data-tab="usage"]').click(); document.querySelector('.tab[data-tab="settings"]').click();
    await new Promise((r) => setTimeout(r, 500)); document.getElementById('explorer-card').scrollIntoView({ block: 'center' });`);
  const theme = async (mode) => {
    nativeTheme.themeSource = mode;
    await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
    await wait(300);
  };

  await toCard();
  await shoot('card-checkout-light');

  ipc.setContextMenuForHarness({ exe: 'C:\\Program Files\\CleanDrive\\CleanDrive.exe', deps: createFakeReg() });
  await toCard();
  await js(`document.getElementById('explorer-menu').click(); await new Promise((r) => setTimeout(r, 800));`);
  await shoot('card-on-light');

  win.webContents.send('app:target', { kind: 'duplicates', path: path.join(work, 'Documents', 'Hợp đồng 2025.pdf') });
  await wait(1500);
  await js(`document.querySelector('main').scrollTop = 0;`);
  await shoot('copies-light');
  await theme('dark');
  await shoot('copies-dark');

  await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
  await wait(800);
  await toCard();
  await shoot('card-on-dark-vi');
  win.webContents.send('app:target', { kind: 'duplicates', path: path.join(work, 'Documents', 'Hợp đồng 2025.pdf') });
  await wait(1500);
  await shoot('copies-dark-vi');
  await theme('light');
  win.setSize(680, 800);
  await wait(500);
  await shoot('copies-narrow-vi');
  await toCard();
  await shoot('card-narrow-vi');

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  win.destroy();
  fs.rmSync(work, { recursive: true, force: true });
  setTimeout(() => {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* still in use */ }
    app.exit(errors.length ? 1 : 0);
  }, 500);
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
