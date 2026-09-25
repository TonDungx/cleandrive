'use strict';

// Screenshots of the introduction (I4): its three screens in the light theme
// in English and the dark theme in Vietnamese, the second screen in a narrow
// window and under an emulated Windows contrast theme.
//
//   npx electron scripts/shoot-intro.js [outputDir]
//
// Throwaway userData, suffixed task names.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootintro-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootintro';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-intro.js'))
  || path.join(os.tmpdir(), 'cd-intro-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();
  fs.mkdirSync(OUT, { recursive: true });
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
  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'en', intro: '1' } });
  nativeTheme.themeSource = 'light';
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  const emulate = (forced) => dbg.sendCommand('Emulation.setEmulatedMedia', {
    features: [
      // Motion stays on for the shots: the file is caught part way into the bin.
      { name: 'prefers-reduced-motion', value: 'no-preference' },
      { name: 'forced-colors', value: forced ? 'active' : 'none' },
    ],
  });
  await emulate(false);
  await wait(600);

  const shoot = async (name) => {
    await wait(350);
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

  for (let page = 0; page < 3; page++) {
    await js(`Intro.show(${page});`);
    await shoot(`intro-${page + 1}-light-en`);
  }

  await js(`document.getElementById('intro').close(); document.querySelector('[data-language-choice="vi"]').click();`);
  await wait(500);
  nativeTheme.themeSource = 'dark';
  await js(`ThemeSwitch.adopt('dark'); document.getElementById('intro-open').click();`);
  await wait(400);
  for (let page = 0; page < 3; page++) {
    await js(`Intro.show(${page});`);
    await shoot(`intro-${page + 1}-dark-vi`);
  }

  await js(`ThemeSwitch.adopt('light');`);
  nativeTheme.themeSource = 'light';
  win.setSize(620, 780);
  await wait(500);
  await js(`Intro.show(1);`);
  await shoot('intro-2-narrow-vi');
  await js(`Intro.show(0);`);
  await shoot('intro-1-narrow-vi');

  win.setSize(1180, 820);
  await emulate(true);
  await wait(400);
  await js(`Intro.show(1);`);
  await shoot('intro-2-forced');

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  dbg.detach();
  win.destroy();
  setTimeout(() => {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* still in use */ }
    app.exit(errors.length ? 1 : 0);
  }, 500);
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
