'use strict';

// Screenshots of D2: the Games screen after a real scan of this machine's
// Steam install, in both themes, in Vietnamese, in a narrow window, with a
// game's evidence open, and with the screen locked as Free sees it.
//
//   npx electron scripts/shoot-games.js [outputDir]
//
// Throwaway userData and a suffixed task name. It reads Steam's own files and
// measures only what Steam keeps no figure for; it writes nothing outside the
// output folder.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootgames-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootgames';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-games.js'))
  || path.join(os.tmpdir(), 'cd-games-shots');
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

    await js(`document.querySelector('.tab[data-tab="games"]').click();`);
    await wait(300);
    await shoot('games-empty-light');

    await js(`document.getElementById('games-scan').click();`);
    await wait(500);
    const done = await until(`document.getElementById('games-cancel').hidden && window.gamesScreen.view.result`);
    if (!done) throw new Error('the scan did not finish');
    const hasSteam = await js(`return Boolean(window.gamesScreen.view.result && window.gamesScreen.view.result.summary)`);
    if (!hasSteam) {
      console.log('  no Steam on this machine; only the empty state was captured');
      await shoot('games-nosteam-light');
    } else {
      await js(`document.querySelector('main').scrollTop = 0;`);
      await shoot('games-light');
      await theme('dark');
      await shoot('games-dark');

      // A game's evidence, with the reason the app will not remove it.
      await js(`
        const row = document.querySelector('#games-list .games-row:not(.games-head)');
        row.scrollIntoView({ block: 'center' });
        row.querySelector('.games-col-badge .badge-button').click();
      `);
      await wait(400);
      await shoot('games-evidence-dark');
      await js(`document.querySelector('#games-list .games-row:not(.games-head) .badge-button[aria-expanded="true"]').click();`);

      // What Steam left behind.
      await js(`
        const card = document.getElementById('games-leftovers-card');
        if (!card.hidden) card.scrollIntoView({ block: 'start' });
      `);
      await wait(400);
      await shoot('games-leftovers-dark');

      // Vietnamese.
      await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
      await wait(800);
      await js(`document.querySelector('.tab[data-tab="games"]').click(); document.querySelector('main').scrollTop = 0;`);
      await wait(500);
      await theme('light');
      await shoot('games-vi-light');
      await theme('dark');
      await shoot('games-vi-dark');

      win.setSize(720, 820);
      await wait(500);
      await js(`document.querySelector('main').scrollTop = 0;`);
      await shoot('games-narrow-vi-dark');
      win.setSize(560, 820);
      await wait(500);
      await shoot('games-verynarrow-vi-dark');
      win.setSize(1180, 820);
      await wait(400);

      await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="en"]').click();`);
      await wait(700);
      await theme('light');

      // Locked: what somebody without Pro sees.
      await js(`
        document.querySelector('.tab[data-tab="games"]').click();
        const out = window.gamesScreen.view.result;
        window.gamesScreen.view.result = { candidates: null, summary: null, locked: 'pro.games', steam: out.steam };
        window.gamesScreen.render();
      `);
      await wait(400);
      await shoot('games-locked-light');
    }

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
