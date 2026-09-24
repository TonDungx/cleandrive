'use strict';

// Screenshots of the Restore Center, in both themes, narrow, and in Vietnamese.
//
//   npx electron scripts/shoot-restore.js [outputDir]
//
// Every state on the screen is made for real rather than drawn from a fake
// journal: throwaway files go to the real Recycle Bin through the app's own
// IPC, some are put back, some are taken out of the bin behind the app's back
// ("emptied outside the app"), and an older scheduled run is recorded as
// purged. At the end every bin item this script made is removed from the bin
// and its folder deleted -- nothing of anybody else's is touched.
//
// Isolated: userData is a temporary folder, so the journal and settings are
// the sandbox's, and CLEANDRIVE_TASK_SUFFIX keeps it away from real tasks.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootrestore-'));
app.setName(require('../package.json').name);
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootrestore';

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-restore.js'))
  || path.join(os.tmpdir(), 'cd-restore-shots');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

app.whenReady().then(async () => {
  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  ipc.allowUnconfirmedForHarness();
  const { services } = require('../src/main/services');
  const { findUserBins, listItems } = require('../src/main/lib/recyclebin');
  const { pathKey } = require('../src/main/lib/util');

  if (pathKey(services().journalDir).indexOf(pathKey(SANDBOX)) !== 0) {
    console.error('refusing to run: the journal is not inside the sandbox');
    app.exit(1);
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(os.homedir(), `cleandrive-shoot-restore-${process.pid}`);
  const make = (rel, bytes) => {
    const file = path.join(base, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(bytes, 1));
    return file;
  };
  console.log(`\nfiles:  ${base}\noutput: ${OUT}\n`);

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

  try {
    /* ---- an older scheduled run, since purged ------------------------------ */
    const journal = services().journal;
    const older = Date.now() - 12 * DAY;
    const old = ['Cache\\shader-01.bin', 'Cache\\shader-02.bin', 'Temp\\update.tmp']
      .map((rel) => ({ path: path.join(base, rel), size: 3 * MB, trashedAt: older }));
    await journal.appendSession('recycle', old, { source: 'scheduled', runId: 'shoot', startedAt: older });
    await journal.appendSession('purge', old.map((o) => ({ path: o.path, size: o.size, recycledAt: o.trashedAt })), {
      source: 'purge', startedAt: older + 8 * DAY, freedOnSource: 9 * MB,
    });

    /* ---- a delete whose bin was emptied since ------------------------------ */
    const emptied = ['Downloads\\old-driver.zip', 'Downloads\\trial-setup.exe'].map((rel) => make(rel, 2 * MB));
    await js(`window.cleandrive.trash(${JSON.stringify(emptied)}, { confirm: false })`);
    const bins = await findUserBins([base]);
    for (const item of (await listItems(bins)).filter((i) => emptied.some((e) => pathKey(e) === pathKey(i.originalPath)))) {
      fs.rmSync(item.dataPath, { force: true });
      fs.rmSync(item.metaPath, { force: true });
    }

    /* ---- today's delete, three of it put back ------------------------------ */
    const today = [
      'Downloads\\setup-4.2.exe', 'Downloads\\holiday-2019.mkv', 'Downloads\\invoice-march.pdf',
      'Downloads\\report final (2).docx', 'Downloads\\scan-0001.jpg', 'Downloads\\scan-0002.jpg',
      'Videos\\screen-recording-0912.mp4', 'Documents\\draft-old.docx', 'Documents\\budget-2024.xlsx',
      'Temp\\render-cache.dat',
    ].map((rel, i) => make(rel, (i + 1) * 1.7 * MB));
    await js(`window.cleandrive.trash(${JSON.stringify(today)}, { confirm: false })`);
    await js(`document.querySelector('.tab[data-tab="restore"]').click()`);
    for (let i = 0; i < 40 && !(await js(`document.querySelectorAll('.restore-session').length >= 4`)); i++) await wait(250);
    const newest = await js(`document.querySelector('.restore-session[data-kind="recycle"]').dataset.session`);
    await js(`document.querySelector('[data-restore-toggle="${newest}"]').click()`);
    for (let i = 0; i < 40 && !(await js(`restoreCenter.view.items.has(${JSON.stringify(newest)})`)); i++) await wait(250);
    const ids = await js(`restoreCenter.view.items.get(${JSON.stringify(newest)}).slice(2, 5).map((r) => r.id)`);
    await js(`window.cleandrive.restore(${JSON.stringify(ids)}, { confirm: false })`);
    await js('restoreCenter.load()');
    await wait(300);

    const tick = `(() => {
      const card = document.querySelector('.restore-session[data-session="${newest}"]');
      const boxes = [...card.querySelectorAll('.file-row input:not(:disabled)')];
      for (const b of boxes.slice(0, 2)) if (!b.checked) b.click();
    })()`;

    for (const theme of ['light', 'dark']) {
      nativeTheme.themeSource = theme;
      await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
      await wait(300);
      await js(`document.querySelector('main').scrollTop = 0`);
      await js(tick);
      await wait(300);
      await shoot(`restore-${theme}`);
      await js(`document.querySelector('.restore-session[data-kind="purge"]').scrollIntoView({ block: 'center' })`);
      await wait(300);
      await shoot(`restore-older-${theme}`);
    }

    // Vietnamese, where every sentence is longer.
    await js(`document.querySelector('[data-language-choice="vi"]').click()`);
    await wait(800);
    nativeTheme.themeSource = 'light';
    await js(`document.documentElement.setAttribute('data-theme', 'light'); document.querySelector('main').scrollTop = 0`);
    await wait(300);
    await shoot('restore-vi-light');

    // Narrow: the card heads and the floating bar have to wrap.
    await js(`document.querySelector('[data-language-choice="en"]').click()`);
    await wait(600);
    nativeTheme.themeSource = 'dark';
    await js(`document.documentElement.setAttribute('data-theme', 'dark')`);
    win.setSize(700, 760);
    await wait(500);
    await js(`document.querySelector('main').scrollTop = 0`);
    await wait(200);
    await shoot('restore-narrow-dark');
  } finally {
    // Everything this script put in the bin, and nothing else.
    const bins = await findUserBins([base]);
    for (const item of await listItems(bins)) {
      if (pathKey(item.originalPath).startsWith(pathKey(base) + path.sep)) {
        fs.rmSync(item.dataPath, { force: true });
        fs.rmSync(item.metaPath, { force: true });
      }
    }
    fs.rmSync(base, { recursive: true, force: true });
    console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
    app.quit();
  }
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
