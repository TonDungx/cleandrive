'use strict';

// Screenshots of C2 and C4: the Developer screen after a real scan of this
// machine's tools, in both themes, in Vietnamese, in a narrow window, with a
// tool's evidence open, and with the screen locked as Free sees it.
//
//   npx electron scripts/shoot-dev.js [outputDir]
//
// Throwaway userData and a suffixed task name. It measures the real caches and
// lists the editor ones; it writes nothing outside the output folder.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootdev-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootdev';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-dev.js'))
  || path.join(os.tmpdir(), 'cd-dev-shots');
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

    await js(`document.querySelector('.tab[data-tab="dev"]').click();`);
    await wait(300);
    await shoot('dev-empty-light');

    await js(`document.getElementById('dev-scan').click();`);
    await wait(700);
    await shoot('dev-running-light');
    const done = await until(`document.getElementById('dev-cancel').hidden && window.devScreen.view.result`);
    if (!done) throw new Error('the scan did not finish');
    await js(`document.querySelector('main').scrollTop = 0;`);
    await shoot('dev-light');
    await theme('dark');
    await shoot('dev-dark');

    // The Linux and container disks: the biggest things here, and the ones
    // with steps rather than a single command.
    await js(`
      const section = document.querySelector('#dev-groups .dev-group[data-kind="machine"]');
      if (section) section.scrollIntoView({ block: 'start' });
    `);
    await wait(400);
    await shoot('dev-machines-dark');

    // The package caches, further down: one number and one command each.
    await js(`
      const section = document.querySelector('#dev-groups .dev-group[data-kind="packageCache"]');
      if (section) section.scrollIntoView({ block: 'start' });
    `);
    await wait(400);
    await shoot('dev-packages-dark');

    // A tool's evidence.
    await js(`
      const card = document.querySelector('#dev-groups .dev-tool');
      card.scrollIntoView({ block: 'center' });
      card.querySelector('.badge-button').click();
    `);
    await wait(400);
    await shoot('dev-evidence-dark');
    await js(`document.querySelector('#dev-groups .dev-tool .badge-button[aria-expanded="true"]').click();`);

    // Vietnamese.
    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
    await wait(800);
    await js(`document.querySelector('.tab[data-tab="dev"]').click(); document.querySelector('main').scrollTop = 0;`);
    await wait(500);
    await theme('light');
    await shoot('dev-vi-light');
    await theme('dark');
    await shoot('dev-vi-dark');

    win.setSize(720, 820);
    await wait(500);
    await js(`document.querySelector('main').scrollTop = 0;`);
    await shoot('dev-narrow-vi-dark');
    win.setSize(560, 820);
    await wait(500);
    await shoot('dev-verynarrow-vi-dark');
    win.setSize(1180, 820);
    await wait(400);

    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="en"]').click();`);
    await wait(700);
    await theme('light');

    await js(`
      document.querySelector('.tab[data-tab="dev"]').click();
      window.devScreen.view.result = { candidates: null, summary: null, locked: 'pro.dev' };
      window.devScreen.render();
    `);
    await wait(400);
    await shoot('dev-locked-light');

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
