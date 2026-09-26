'use strict';

// Screenshots of D1: the Apps screen after a real scan of this machine, in
// both themes, in Vietnamese, in a narrow window, with a row's evidence open,
// and as the Free tier sees it (no launch dates).
//
//   npx electron scripts/shoot-apps.js [outputDir]
//
// Throwaway userData and a suffixed task name. It reads the real registry and
// measures real install folders -- everything the screen does -- and writes
// nothing outside the output folder.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootapps-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootapps';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-apps.js'))
  || path.join(os.tmpdir(), 'cd-apps-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  try {
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
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'en' } });
    nativeTheme.themeSource = 'light';

    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    const until = async (expr, ms = 180000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await js(`return Boolean(${expr})`)) return true;
        await wait(200);
      }
      return false;
    };
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
    const theme = async (mode) => {
      nativeTheme.themeSource = mode;
      await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
      await wait(300);
    };

    await js(`document.querySelector('.tab[data-tab="apps"]').click();`);
    await wait(300);
    await shoot('apps-empty-light');

    await js(`document.getElementById('apps-scan').click();`);
    await wait(700);
    await shoot('apps-running-light');
    const done = await until(`document.getElementById('apps-cancel').hidden && document.querySelectorAll('#apps-list .apps-row').length > 1`);
    if (!done) throw new Error('the scan did not finish');
    await js(`document.querySelector('main').scrollTop = 0;`);
    await shoot('apps-light');

    await theme('dark');
    await shoot('apps-dark');

    // A row's evidence, with the uninstall command it registered.
    await js(`
      const row = [...document.querySelectorAll('#apps-list .apps-row')].find((r) => r.querySelector('.apps-col-actions .btn'));
      row.scrollIntoView({ block: 'center' });
      row.querySelector('.apps-col-badge .badge-button').click();
    `);
    await wait(400);
    await shoot('apps-evidence-dark');
    await js(`document.querySelector('#apps-list .apps-evidence-row .badge-button, #apps-list .apps-row .badge-button[aria-expanded="true"]').click();`);

    // Sorted by when each was last started, oldest first -- the Pro view.
    await js(`
      const sort = document.getElementById('apps-sort');
      sort.value = 'lastUsed';
      sort.dispatchEvent(new Event('change'));
      document.querySelector('main').scrollTop = 0;
    `);
    await wait(400);
    await shoot('apps-by-lastused-dark');

    await theme('light');
    await js(`
      const box = document.getElementById('apps-only-stale');
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      document.querySelector('main').scrollTop = 0;
    `);
    await wait(400);
    await shoot('apps-only-stale-light');
    await js(`
      const box = document.getElementById('apps-only-stale');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
    `);

    // Vietnamese.
    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
    await wait(800);
    await js(`document.querySelector('.tab[data-tab="apps"]').click(); document.querySelector('main').scrollTop = 0;`);
    await wait(500);
    await shoot('apps-vi-light');
    await theme('dark');
    await shoot('apps-vi-dark');

    // A narrow window: the two size columns are what gives way first.
    win.setSize(720, 820);
    await wait(500);
    await js(`document.querySelector('main').scrollTop = 0;`);
    await shoot('apps-narrow-vi-dark');
    win.setSize(560, 820);
    await wait(500);
    await shoot('apps-verynarrow-vi-dark');
    win.setSize(1180, 820);
    await wait(400);

    // Free: the list and the sizes stay, the launch dates go.
    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="en"]').click();`);
    await wait(700);
    process.env.CLEANDRIVE_ENTITLEMENTS = 'free';
    await js(`document.querySelector('.tab[data-tab="apps"]').click(); document.getElementById('apps-scan').click();`);
    await until(`document.getElementById('apps-cancel').hidden && document.querySelectorAll('#apps-list .apps-row').length > 1`);
    await js(`document.querySelector('main').scrollTop = 0;`);
    await theme('light');
    await shoot('apps-free-light');
    process.env.CLEANDRIVE_ENTITLEMENTS = 'all';

    if (errors.length) console.log(`\nconsole errors: ${errors.length}\n  ${errors.slice(0, 5).join('\n  ')}`);
    else console.log('\nno console errors');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await wait(300);
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    // Chromium is still holding its caches open in here, so the removal often
    // cannot finish. That is a note, not an error; the OS clears temp anyway.
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${SANDBOX})`);
    }
    app.quit();
  }
});
