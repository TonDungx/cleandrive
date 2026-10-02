'use strict';

// Screenshots of E5: the Conversation axis on the Photos & video screen, after
// a real scan of this machine's Zalo folder. Both themes, Vietnamese, a narrow
// window, a conversation filtered, and the card absent on a library that has
// no chat pictures at all.
//
//   npx electron scripts/shoot-conversations.js [outputDir]
//
// Against the real folder rather than a fixture, and it has to be: whether a
// folder counts as a chat folder is decided from APPDATA by `chat/known.js`,
// so a tree built in the temp directory is not one and neither relaxed rule
// would apply to it. Throwaway userData, a suffixed task name, and nothing is
// written outside the output folder.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootconv-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootconv';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-conversations.js'))
  || path.join(os.tmpdir(), 'cd-conversation-shots');
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
    const toCard = () => js(`
      const el = document.getElementById('ov-conversations-card');
      if (el && !el.hidden) el.scrollIntoView({ block: 'center' });
    `);

    await js(`document.querySelector('.tab[data-tab="media"]').click();`);
    await until(`document.querySelectorAll('#media-roots .check').length > 0`, 20000);

    const root = await js(`
      const found = media.roots.find((r) => r.name.startsWith('Zalo conversations'));
      return found ? found.path : null;
    `);
    if (!root) {
      console.log('  no Zalo conversation folder on this machine; nothing to shoot');
      await shoot('conversations-none-light');
    } else {
      console.log(`  scanning ${root}`);
      await js(`
        for (const r of media.roots) r.on = r.path === ${JSON.stringify(root)};
        media.extraRoots = [];
        renderRoots();
        document.getElementById('media-scan').click();
      `);
      const done = await until(`document.getElementById('media-cancel').hidden === true && media.files.length > 0`);
      if (!done) throw new Error('the scan did not finish');

      const found = await js(`return media.files.length + ' files, ' +
        new Set(media.files.map((f) => f.conversation).filter(Boolean)).size + ' conversations'`);
      console.log(`  ${found}`);

      await toCard();
      await shoot('conversations-light');
      await theme('dark');
      await shoot('conversations-dark');

      // What the grid looks like once one conversation is picked, which is the
      // whole point of the axis.
      await js(`document.querySelector('#ov-conversations-bar .ov-seg').click();`);
      await wait(500);
      await js(`document.querySelector('main').scrollTop = 0;`);
      await shoot('conversations-filtered-dark');
      await toCard();
      await shoot('conversations-filtered-card-dark');
      await js(`document.querySelector('#ov-conversations-bar .ov-seg').click();`);

      // The sentence about the copies that were left out.
      await js(`document.querySelector('main').scrollTop = 0;`);
      await shoot('conversations-status-dark');

      // Vietnamese.
      await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
      await wait(800);
      await js(`document.querySelector('.tab[data-tab="media"]').click();`);
      await wait(400);
      await toCard();
      await theme('light');
      await shoot('conversations-vi-light');
      await theme('dark');
      await shoot('conversations-vi-dark');

      win.setSize(720, 900);
      await wait(500);
      await toCard();
      await shoot('conversations-narrow-vi-dark');
      win.setSize(560, 900);
      await wait(500);
      await toCard();
      await shoot('conversations-verynarrow-vi-dark');
      win.setSize(1180, 900);
      await wait(400);

      await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="en"]').click();`);
      await wait(700);
      await theme('light');

      // And the case the roadmap asks for in words: a library with no chat
      // pictures leaves no trace of the feature.
      await js(`
        document.querySelector('.tab[data-tab="media"]').click();
        const keep = media.files;
        window.__keep = keep;
        media.files = keep.slice(0, 60).map((f) => ({ ...f, conversation: null, conversationApp: null }));
        applyFilters();
        document.querySelector('main').scrollTop = 0;
      `);
      await wait(400);
      await shoot('conversations-absent-light');
      await js(`media.files = window.__keep; applyFilters();`);
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
