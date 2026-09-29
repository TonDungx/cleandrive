'use strict';

// Screenshots of D3: the Chat screen after a real scan of this machine's Zalo
// and Telegram, in both themes, in Vietnamese, in a narrow window, with a
// conversation's kinds expanded, with a row's evidence open, and locked as
// Free sees it.
//
//   npx electron scripts/shoot-chat.js [outputDir]
//
// Throwaway userData and a suffixed task name. It reads folder listings and
// file sizes, never a message database, and writes nothing outside the output
// folder.
//
// One thing to know before reading the pictures: **Zalo runs at login on this
// machine**, so every Zalo row is held back as `keep` with "Zalo is open" as
// its first reason, and no chips are tickable. That is the screen working, not
// the screen empty; the Telegram rows in the same picture show the other side.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootchat-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootchat';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-chat.js'))
  || path.join(os.tmpdir(), 'cd-chat-shots');
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
    const until = async (expr, ms = 300000) => {
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
    const top = () => js(`document.querySelector('main').scrollTop = 0;`);
    const scrollTo = (id) => js(`
      const el = document.getElementById(${JSON.stringify(id)});
      if (el && !el.hidden) el.scrollIntoView({ block: 'start' });
    `);

    await js(`document.querySelector('.tab[data-tab="chat"]').click();`);
    await wait(300);
    await shoot('chat-empty-light');

    await js(`document.getElementById('chat-scan').click();`);
    await wait(500);
    const done = await until(`document.getElementById('chat-cancel').hidden && window.chatScreen.view.result`);
    if (!done) throw new Error('the scan did not finish');

    const found = await js(`
      const out = window.chatScreen.view.result;
      return Boolean(out && out.summary);
    `);
    if (!found) {
      console.log('  neither chat app on this machine; only the empty state was captured');
      await shoot('chat-noapps-light');
    } else {
      const state = await js(`return JSON.stringify(window.chatScreen.view.result.summary.running)`);
      console.log(`  which apps are open: ${state}`);

      await top();
      await shoot('chat-light');
      await theme('dark');
      await shoot('chat-dark');

      // Level 1 and level 2, which are the same for both apps.
      await scrollTo('chat-kinds-card');
      await shoot('chat-kinds-dark');
      await scrollTo('chat-months-card');
      await shoot('chat-months-dark');

      // Level 3, with one conversation's kinds opened.
      await scrollTo('chat-conversations-card');
      await js(`
        const row = document.querySelector('#chat-conversations .chat-row:not(.chat-head)');
        // The badge in the previous column also carries aria-expanded, so the
        // expander is named by its own column rather than by that attribute.
        const expand = row.querySelector('.chat-col-actions button');
        if (expand) expand.click();
      `);
      await wait(400);
      await shoot('chat-kinds-open-dark');

      // A conversation's evidence: why it has a number for a name, and the
      // photos it is keeping twice.
      await js(`
        const row = document.querySelector('#chat-conversations .chat-row:not(.chat-head)');
        row.scrollIntoView({ block: 'center' });
        row.querySelector('.chat-col-badge .badge-button').click();
      `);
      await wait(400);
      await shoot('chat-evidence-dark');
      await js(`
        const open = document.querySelector('#chat-conversations .badge-button[aria-expanded="true"]');
        if (open) open.click();
      `);

      // What belongs to no conversation, including the staged Telegram update.
      await scrollTo('chat-shared-card');
      await shoot('chat-shared-dark');

      // Vietnamese.
      await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
      await wait(800);
      await js(`document.querySelector('.tab[data-tab="chat"]').click();`);
      await top();
      await wait(500);
      await theme('light');
      await shoot('chat-vi-light');
      await theme('dark');
      await shoot('chat-vi-dark');
      await scrollTo('chat-conversations-card');
      await shoot('chat-vi-conversations-dark');
      await scrollTo('chat-shared-card');
      await shoot('chat-vi-shared-dark');

      win.setSize(720, 820);
      await wait(500);
      await top();
      await shoot('chat-narrow-vi-dark');
      await scrollTo('chat-conversations-card');
      await shoot('chat-narrow-vi-conversations-dark');
      win.setSize(560, 820);
      await wait(500);
      await top();
      await shoot('chat-verynarrow-vi-dark');
      await scrollTo('chat-kinds-card');
      await shoot('chat-verynarrow-vi-kinds-dark');
      win.setSize(1180, 820);
      await wait(400);

      await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="en"]').click();`);
      await wait(700);
      await theme('light');

      // Locked: what somebody without Pro sees.
      await js(`
        document.querySelector('.tab[data-tab="chat"]').click();
        const out = window.chatScreen.view.result;
        window.chatScreen.view.result = { candidates: null, summary: null, locked: 'pro.chat', apps: out.apps };
        window.chatScreen.render();
      `);
      await wait(400);
      await shoot('chat-locked-light');
    }

    if (errors.length) console.log(`\nconsole errors: ${errors.length}\n  ${errors.slice(0, 5).join('\n  ')}`);
    else console.log('\nno console errors');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await wait(300);
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${SANDBOX})`);
    }
    app.quit();
  }
});
