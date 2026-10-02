'use strict';

// Screenshots of F2: whole folders that hold the same thing, the near-match
// with its tree comparison, and the refusal on Free -- in both themes, in
// Vietnamese and narrow.
//
//   npx electron scripts/shoot-folder-dupes.js [outputDir]
//
// Throwaway userData, a suffixed task name, a fixture of its own on D:.
//
// Nothing here is staged: the real duplicate pipeline walks a real fixture
// and the real screen draws what comes back. The fixture goes on `D:` rather
// than under `os.tmpdir()`, which is inside AppData.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootf2-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootf2';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-folder-dupes.js'))
  || path.join(os.tmpdir(), 'cd-f2-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const KB = 1024;

app.on('window-all-closed', () => {});

/** A small site, ten files, optionally differing in one of them. */
function site(root, name, differs) {
  const at = (...bits) => path.join(root, name, ...bits);
  const put = (file, bytes, fill) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(bytes, fill));
  };
  put(at('index.html'), 320 * KB, 1);
  put(at('css', 'site.css'), 410 * KB, 2);
  put(at('.git', 'HEAD'), 220 * KB, 3);
  for (let i = 0; i < 7; i++) {
    put(at('img', `photo-${i}.jpg`), 240 * KB, differs && i === 0 ? 200 : i + 10);
  }
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');

  const base = fs.mkdtempSync(path.join('D:\\', 'cleandrive-shoot-f2-'));
  if (!base.toLowerCase().startsWith('d:\\')) throw new Error(`fixture is not on D: (${base})`);
  if (base.toLowerCase().startsWith(os.tmpdir().toLowerCase())) throw new Error('fixture is inside AppData');

  try {
    require('../src/main/lib/preview/serve').serve();
    require('../src/main/ipc').register();
    fs.mkdirSync(OUT, { recursive: true });

    site(base, 'Site 2023', false);
    site(base, 'Site 2023 backup', false);
    site(base, 'Site 2024', true);
    console.log(`\nfixture: ${base}`);
    console.log(`output:  ${OUT}\n`);

    const win = new BrowserWindow({
      width: 1180,
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
    win.webContents.on('console-message', (...args) => {
      const level = typeof args[1] === 'object' ? args[1].level : args[1];
      const message = typeof args[1] === 'object' ? args[1].message : args[2];
      if (level === 3 || level === 'error') errors.push(message);
    });

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'en' } });
    nativeTheme.themeSource = 'light';
    win.focus();
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
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
    const until = async (expr, ms = 120000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await win.webContents.executeJavaScript(`Boolean(${expr})`)) return true;
        await wait(200);
      }
      throw new Error(`timed out: ${expr}`);
    };

    const run = async () => {
      await js(`
        document.querySelector('.tab[data-tab="dupes"]').click();
        document.getElementById('min-size').value = '102400';
        document.getElementById('dupes-folders').checked = true;
        document.getElementById('run-dupes').click();
      `);
      await until(`document.getElementById('cancel-dupes').hidden === true`);
      await wait(600);
    };

    await js(`setFolder(${JSON.stringify(base)});`);
    await until(`document.getElementById('run-dupes').disabled === false`);
    await run();

    const found = await win.webContents.executeJavaScript(`({
      exact: document.querySelectorAll('#dupe-folders .group:not(.group-near)').length,
      near: document.querySelectorAll('#dupe-folders .group-near').length,
      status: document.getElementById('dupes-status').textContent,
    })`);
    console.log(`  ${found.exact} identical, ${found.near} near`);
    console.log(`  ${found.status}\n`);
    if (found.exact === 0 || found.near === 0) throw new Error('the fixture produced nothing to photograph');

    await js(`document.getElementById('dupe-folders-section').scrollIntoView({ block: 'start' });`);
    await shoot('folders-light');
    await theme('dark');
    await shoot('folders-dark');
    await theme('light');

    // The comparison is the point of a near match: which files are on one
    // side only, and which hold different bytes at the same place.
    await js(`document.querySelector('#dupe-folders .compare-tree').scrollIntoView({ block: 'center' });`);
    await shoot('compare-light');
    await theme('dark');
    await shoot('compare-dark');
    await theme('light');

    // Ticked: what "select every file in this copy" actually does.
    await js(`
      document.querySelector('#dupe-folders .folder-files .btn').click();
      document.querySelector('#dupe-folders .folder-files').scrollIntoView({ block: 'center' });
    `);
    await shoot('selected-light');
    await js(`document.getElementById('select-none').click();`);

    // Narrow: the three columns have to stack rather than overflow.
    win.setBounds({ width: 860, height: 900 });
    await wait(500);
    await js(`document.querySelector('#dupe-folders .compare-tree').scrollIntoView({ block: 'center' });`);
    await shoot('compare-narrow');
    win.setBounds({ width: 1180, height: 900 });
    await wait(500);

    // Vietnamese, where the labels are longest.
    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="vi"]').click();
    `);
    await wait(700);
    await run();
    await js(`document.getElementById('dupe-folders-section').scrollIntoView({ block: 'start' });`);
    await shoot('folders-vi');
    await js(`document.querySelector('#dupe-folders .compare-tree').scrollIntoView({ block: 'center' });`);
    await shoot('compare-vi');

    // Refused on Free, out loud rather than quietly downgraded.
    process.env.CLEANDRIVE_ENTITLEMENTS = 'free';
    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="en"]').click();
    `);
    await wait(700);
    await run();
    await js(`document.getElementById('dupes-status').scrollIntoView({ block: 'center' });`);
    await shoot('refused-free-light');
    process.env.CLEANDRIVE_ENTITLEMENTS = 'all';

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
