'use strict';

// Screenshots of the list screens -- Disk usage, What to delete, Duplicates --
// with a selection made and a row's reasons open, in both themes.
//
//   npx electron scripts/shoot-lists.js [outputDir]
//
// Built on a fixture tree this script writes, so every kind of row appears:
// a safe cache file, a review installer, a large file no rule matches, and a
// duplicate group with its oldest copy and one inside a dependency folder.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootlists-')));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootlists';

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-lists.js'))
  || path.join(os.tmpdir(), 'cd-list-shots');

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

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shoot-fixture-'));
  const MB = 1024 * 1024;
  make(path.join(root, 'Temp', 'session-cache.dat'), 6 * MB);
  make(path.join(root, 'Temp', 'old-upload.tmp'), 2 * MB);
  make(path.join(root, 'Temp', 'render.tmp'), 3 * MB);
  make(path.join(root, 'backup.bak'), 1 * MB);
  make(path.join(root, 'Tool', 'Cache', 'index.bin'), 4 * MB);
  make(path.join(root, 'logs', 'service.log'), 2 * MB, 40);
  make(path.join(root, 'Downloads', 'setup-4.2.exe'), 30 * MB, 90);
  make(path.join(root, 'Videos', 'holiday.mkv'), 120 * MB);
  make(path.join(root, 'Reports', 'q3.pdf'), 3 * MB, 30, 7);
  make(path.join(root, 'Reports', 'copy of q3.pdf'), 3 * MB, 10, 7);
  make(path.join(root, 'Archive', 'q3.pdf'), 3 * MB, 5, 7);
  make(path.join(root, 'env', 'site-packages', 'q3.pdf'), 3 * MB, 2, 7);
  return root;
}

app.whenReady().then(async () => {
  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();

  fs.mkdirSync(OUT, { recursive: true });
  const fixture = buildFixture();
  console.log(`\nfixture: ${fixture}\noutput:  ${OUT}\n`);

  const win = new BrowserWindow({
    width: 1280, height: 860, show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });

  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const level = typeof args[1] === 'object' ? args[1].level : args[1];
    const message = typeof args[1] === 'object' ? args[1].message : args[2];
    if (level === 3 || level === 'error') errors.push(message);
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (expr) => win.webContents.executeJavaScript(expr);
  await wait(500);

  const shoot = async (name) => {
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let n = 0; n < 3 && bytes.length === 0; n++) {
      await wait(400);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };

  await js(`setFolder(${JSON.stringify(fixture)})`);
  await js(`document.getElementById('run-scan').click()`);
  for (let i = 0; i < 60 && !(await js(`document.getElementById('scan-stats').hidden === false`)); i++) await wait(250);
  await js(`document.querySelector('.tab[data-tab="dupes"]').click(); document.getElementById('min-size').value = '1024'; document.getElementById('run-dupes').click()`);
  for (let i = 0; i < 60 && !(await js(`document.getElementById('dupes-stats').hidden === false`)); i++) await wait(250);

  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
    await wait(300);

    // Disk usage: two rows ticked, one row's reasons open, scrolled to the list.
    await js(`(() => {
      document.querySelector('.tab[data-tab="usage"]').click();
      const rows = document.querySelectorAll('#largest-files .file-row input[type="checkbox"]');
      if (rows[0] && !rows[0].checked) rows[0].click();
      if (rows[1] && !rows[1].checked) rows[1].click();
      const pill = document.querySelector('#largest-files .badge-button');
      if (pill && !document.querySelector('#largest-files .evidence-row')) pill.click();
      document.getElementById('largest-files').scrollIntoView({ block: 'center' });
    })()`);
    await wait(300);
    await shoot(`usage-${theme}`);

    // What to delete: everything safe selected, one row's reasons open.
    await js(`(() => {
      document.querySelector('.tab[data-tab="cleanup"]').click();
      document.getElementById('select-safe').click();
      const pill = document.querySelector('#cleanup-groups .badge-button');
      if (pill && !document.querySelector('#cleanup-groups .evidence-row')) pill.click();
      document.querySelector('main').scrollTop = 0;
    })()`);
    await wait(300);
    await shoot(`cleanup-${theme}`);

    // Duplicates: all but the oldest, and the reasons for the kept copy.
    await js(`(() => {
      document.querySelector('.tab[data-tab="dupes"]').click();
      document.getElementById('select-extra').click();
      const pill = document.querySelector('#dupe-groups .keeper-tag');
      if (pill && !document.querySelector('#dupe-groups .evidence-row')) pill.click();
      document.querySelector('main').scrollTop = 0;
    })()`);
    await wait(300);
    await shoot(`dupes-${theme}`);
  }

  // Narrow, where the action bar has to wrap.
  win.setSize(700, 760);
  await wait(400);
  await js(`document.querySelector('.tab[data-tab="cleanup"]').click()`);
  await wait(300);
  await shoot('cleanup-narrow-dark');

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  fs.rmSync(fixture, { recursive: true, force: true });
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
