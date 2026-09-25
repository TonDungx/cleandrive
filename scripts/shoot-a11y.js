'use strict';

// Screenshots of what I2 changed, for a person to look at:
//
//   npx electron scripts/shoot-a11y.js [outputDir]
//
//   - the colour editor, passing and failing, light and dark, Vietnamese and
//     a narrow window;
//   - the app drawn in a custom palette;
//   - a Windows contrast theme (emulated through CDP, which forces the palette
//     for real), on the map, a list and Settings -- and Custom winning over it;
//   - the list of keys, and a focus ring on a list row's own button.
//
// Throwaway userData, suffixed task names, fixture folders of its own.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shoota11y-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shoota11y';
require('../src/main/lib/preview/serve').registerScheme();

const T = require('../src/shared/theme-palette');
const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-a11y.js'))
  || path.join(os.tmpdir(), 'cd-a11y-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

function make(file, bytes, ageDays = 0, fill = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, fill));
  if (ageDays) {
    const when = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(file, when, when);
  }
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();

  fs.mkdirSync(OUT, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shoota11y-fixture-'));
  const MB = 1024 * 1024;
  make(path.join(root, 'Temp', 'session-cache.dat'), 6 * MB);
  make(path.join(root, 'Temp', 'render.tmp'), 3 * MB);
  make(path.join(root, 'Tool', 'Cache', 'index.bin'), 4 * MB);
  make(path.join(root, 'Downloads', 'setup-4.2.exe'), 30 * MB, 90);
  make(path.join(root, 'Videos', 'holiday.mkv'), 64 * MB);
  make(path.join(root, 'Videos', 'Trip', 'day-2.mkv'), 40 * MB);
  make(path.join(root, 'Reports', 'q3.pdf'), 12 * MB, 30, 7);
  make(path.join(root, 'Archive', 'q3.pdf'), 12 * MB, 5, 7);
  console.log(`\noutput: ${OUT}\n`);

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
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
  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  const emulate = (forced) => dbg.sendCommand('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'forced-colors', value: forced ? 'active' : 'none' },
    ],
  });
  await emulate(false);

  // The first frame after a change can be the old one; draw again and drop it.
  const shoot = async (name) => {
    await wait(250);
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
  const theme = async (mode) => {
    nativeTheme.themeSource = mode;
    await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
    await wait(250);
  };
  const toSettingsCard = () => js(`
    document.querySelector('.tab[data-tab="settings"]').click();
    document.getElementById('custom-card').scrollIntoView({ block: 'start' });
    document.querySelector('main').scrollTop -= 12;`);

  await js(`setFolder(${JSON.stringify(root)}); document.getElementById('run-scan').click();`);
  for (let i = 0; i < 80 && !(await js(`return document.getElementById('scan-stats').hidden === false`)); i++) await wait(250);
  await wait(600);

  // ---- the editor ----
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    await js(`ThemeEditor.load(${JSON.stringify(T.template(mode, mode === 'dark' ? 'Night' : 'Mine'))});
      ThemeEditor.set('accent', ${JSON.stringify(mode === 'dark' ? '#b48cff' : '#6d28d9')});`);
    await toSettingsCard();
    await shoot(`editor-pass-${mode}`);
    await js(`ThemeEditor.set('textTertiary', ${JSON.stringify(mode === 'dark' ? '#3d434f' : '#b3b8c0')});
      ThemeEditor.set('good', ${JSON.stringify(mode === 'dark' ? '#d8a020' : '#945a06')});`);
    await toSettingsCard();
    await shoot(`editor-fail-${mode}`);
  }

  // ---- the app in a custom palette ----
  const violet = { ...T.template('dark', 'Violet night'), colors: { ...T.BASES.dark, background: '#120f1a', surface: '#1b1726', accent: '#b48cff', border: '#857a9e' } };
  await js(`ThemeEditor.load(${JSON.stringify(violet)}); document.getElementById('custom-use').click();`);
  await wait(800);
  await js(`document.querySelector('.tab[data-tab="usage"]').click(); document.querySelector('main').scrollTop = 0;`);
  await shoot('custom-in-use-usage');
  await js(`document.querySelector('.tab[data-tab="cleanup"]').click(); document.getElementById('select-safe').click();`);
  await shoot('custom-in-use-cleanup');

  // ---- Windows contrast theme ----
  await js(`document.querySelector('#theme-switch-settings [data-theme-choice="light"]').click();`);
  await wait(400);
  await emulate(true);
  await wait(300);
  await js(`document.querySelector('.tab[data-tab="usage"]').click(); document.querySelector('main').scrollTop = 0;`);
  await wait(400);
  await shoot('forced-usage');
  await js(`const rows = document.querySelectorAll('#largest-files .file-row input'); if (rows[0] && !rows[0].checked) rows[0].click();
    document.getElementById('largest-files').scrollIntoView({ block: 'center' });`);
  await shoot('forced-largest');
  await js(`document.querySelector('.tab[data-tab="cleanup"]').click();
    progressPanel.show('Moving to Recycle Bin');
    progressPanel.update({ phase: 'deleting', done: 4, total: 10, freedBytes: 4 * 1048576, totalBytes: 10 * 1048576, ratePerSec: 2, etaMs: 3000 });`);
  await shoot('forced-cleanup-progress');
  await js(`progressPanel.hide(); document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('main').scrollTop = 0;`);
  await shoot('forced-settings');
  // Custom chosen: it wins over the Windows theme.
  await js(`document.querySelector('#theme-switch-settings [data-theme-choice="custom"]').click();`);
  await wait(500);
  await shoot('forced-but-custom');
  await emulate(false);
  await js(`document.querySelector('#theme-switch-settings [data-theme-choice="light"]').click();`);
  await wait(400);

  // ---- keys, focus ----
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    await js(`document.querySelector('.tab[data-tab="usage"]').click(); window.Shortcuts.open();`);
    await shoot(`shortcuts-${mode}`);
    await js(`document.getElementById('shortcuts').close();`);
  }
  await theme('light');
  win.focus();
  win.webContents.focus();
  await js(`document.getElementById('largest-files').scrollIntoView({ block: 'center' });
    document.querySelector('#largest-files .file-row').focus();`);
  for (const key of ['Down', 'Tab', 'Tab']) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
    await wait(80);
  }
  await shoot('focus-row-button-light');

  // ---- Vietnamese, narrow ----
  await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
  await wait(600);
  await js(`ThemeEditor.load(${JSON.stringify(T.template('light', 'Của tôi'))}); ThemeEditor.set('text', '#9aa0a8');`);
  await toSettingsCard();
  await shoot('editor-fail-vi-light');
  await js(`window.Shortcuts.open();`);
  await shoot('shortcuts-vi-light');
  await js(`document.getElementById('shortcuts').close();`);
  win.setSize(700, 800);
  await wait(500);
  await toSettingsCard();
  await shoot('editor-narrow-vi-light');
  await theme('dark');
  await js(`document.querySelector('.tab[data-tab="cleanup"]').click(); document.querySelector('main').scrollTop = 0;`);
  await shoot('cleanup-narrow-vi-dark');

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  dbg.detach();
  win.destroy();
  fs.rmSync(root, { recursive: true, force: true });
  setTimeout(() => {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* still in use */ }
    app.exit(errors.length ? 1 : 0);
  }, 500);
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
