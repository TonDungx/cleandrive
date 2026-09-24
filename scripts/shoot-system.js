'use strict';

// Screenshots of the System screen on the real system drive -- measured for
// real, unelevated (about two minutes) -- then with the elevated pass answered
// by the tool output captured on this machine (scripts/fixtures/system), so no
// UAC prompt is needed to see the screen in that state. Both themes, narrow,
// and Vietnamese.
//
//   npx electron scripts/shoot-system.js [outputDir]
//
// The screenshots name top-level folders on this drive; they are written to
// the output folder only, never into the repository.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootsystem-')));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootsystem';

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-system.js'))
  || path.join(os.tmpdir(), 'cd-system-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  const { measureTree } = require('../src/main/system/walk');
  const FIX = path.join(__dirname, 'fixtures', 'system');
  const text = (name) => fs.readFileSync(path.join(FIX, name), 'latin1');
  ipc.setHelperClientForHarness(() => ({
    start: async () => {},
    stop: () => {},
    async request(op, args) {
      if (op === 'ping') return { pid: 1, integrity: 'high', elevated: true };
      if (op === 'system.breakdown') {
        const sums = [];
        for (const dir of args.dirs) {
          const out = await measureTree(dir);
          const all = out.buckets.all || { allocated: 0, logical: 0, files: 0 };
          sums.push({ dir, allocated: all.allocated, logical: all.logical, files: all.files, denied: out.deniedCount });
        }
        return { sums, ms: 1 };
      }
      const files = {
        'shadowstorage.query': 'vssadmin-list-shadowstorage.en.txt',
        'ntfs.info': 'fsutil-fsinfo-ntfsinfo.en.txt',
        'storagereserve.query': 'fsutil-storagereserve-query.en.txt',
        'dism.analyze': 'dism-analyzecomponentstore.en.txt',
      };
      return { exitCode: 0, text: text(files[op]), ms: 1 };
    },
  }));
  ipc.setHandoffDepsForHarness({ openExternal: async () => {}, spawn: () => {} });

  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280, height: 860, show: true,
    // Painting continues when the window is behind others; without this a
    // capture returned the frame before the last change.
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
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
    // A fresh frame: ask for a repaint, and let one go by before keeping one.
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
  const until = async (expr, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(expr)) return true;
      await wait(500);
    }
    return false;
  };

  await js(`document.querySelector('.tab[data-tab="system"]').click()`);
  await until(`document.getElementById('sstat-total').textContent !== '–'`, 20000);
  await shoot('system-before-light');
  await js(`document.getElementById('system-measure').click()`);
  await wait(4000);
  await shoot('system-walking-light');
  console.log('  walking the real drive ...');
  await until(`document.getElementById('system-bar-card').hidden === false && !document.getElementById('system-measure').disabled`, 8 * 60000);

  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); document.querySelector('main').scrollTop = 0`);
    await wait(400);
    await shoot(`system-${theme}`);
    await js(`document.querySelector('.system-group[data-group="windows"]').scrollIntoView({ block: 'start' })`);
    await wait(300);
    await shoot(`system-windows-${theme}`);
  }

  await js(`document.getElementById('system-elevated').click()`);
  await until(`!!document.querySelector('.system-row[data-key="ntfsMetadata"]') && !/administrator/.test(document.querySelector('.system-row[data-key="ntfsMetadata"] .system-row-size').textContent)`, 5 * 60000);
  await js(`(() => { const pill = document.querySelector('.system-row[data-key="winsxs"] .badge'); if (pill) pill.click(); })()`);
  await wait(300);
  await js(`document.querySelector('main').scrollTop = 0`);
  await wait(300);
  await shoot('system-elevated-dark');
  await js(`document.querySelector('.system-row[data-key="winsxs"]').scrollIntoView({ block: 'center' })`);
  await wait(300);
  await shoot('system-winsxs-dark');

  await js(`document.querySelector('[data-language-choice="vi"]').click()`);
  await wait(800);
  nativeTheme.themeSource = 'light';
  await js(`document.documentElement.setAttribute('data-theme', 'light'); document.querySelector('main').scrollTop = 0`);
  await wait(400);
  await shoot('system-vi-light');
  await js(`document.querySelector('.system-group[data-group="windows"]').scrollIntoView({ block: 'start' })`);
  await wait(300);
  await shoot('system-vi-windows-light');

  await js(`document.querySelector('[data-language-choice="en"]').click()`);
  await wait(600);
  nativeTheme.themeSource = 'dark';
  await js(`document.documentElement.setAttribute('data-theme', 'dark')`);
  win.setSize(700, 760);
  await wait(500);
  await js(`document.querySelector('main').scrollTop = 0`);
  await wait(300);
  await shoot('system-narrow-dark');
  await js(`document.querySelector('.system-row[data-key="hiberfil"]').scrollIntoView({ block: 'center' })`);
  await wait(300);
  await shoot('system-narrow-hiberfil-dark');

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
