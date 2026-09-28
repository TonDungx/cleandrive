#!/usr/bin/env node
'use strict';

// Screenshots of packing a folder into an archive (B5): the map's menu with
// both folder actions on it, the receipt afterwards, and the Restore Center
// row that knows the folder is inside an archive. Both themes, narrow,
// Vietnamese.
//
//   npx electron scripts/shoot-archive.js [outputDir]
//
// Two folders are built by this harness on C: -- one of source code, which
// compresses, and one standing in for photos, which does not -- so the two
// sentences the receipt can say are both photographed rather than only the
// flattering one. The archives go to a folder of the harness's own and the
// Recycle Bin is stood in for. Everything is removed at the end.
//
// The confirmation is a native dialog and cannot be photographed, so its text
// is printed instead, for both the compressible folder and the other one.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootarch-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootarch';

require('../src/main/lib/preview/serve').registerScheme();

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-archive.js')) ||
  path.join(os.tmpdir(), 'cd-archive-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');

  const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootarch-home-'));
  const KEEP = path.join(BASE, 'Lưu trữ');
  const BIN = path.join(BASE, '.bin');
  fs.mkdirSync(KEEP);
  fs.mkdirSync(BIN);

  // One folder that compresses and one that does not, so both receipts exist.
  const project = path.join(BASE, 'Dự án cũ');
  fs.mkdirSync(path.join(project, 'src', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(project, 'Chưa dùng'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'app.js'), 'const value = 1;\n'.repeat(90000));
  fs.writeFileSync(path.join(project, 'src', 'lib', 'tiện ích.js'), 'function helper() { return 1; }\n'.repeat(40000));
  fs.writeFileSync(path.join(project, 'README.md'), '# Dự án cũ\n\n'.repeat(4000));

  const photos = path.join(BASE, 'Ảnh 2015');
  fs.mkdirSync(path.join(photos, 'Đà Lạt'), { recursive: true });
  for (let n = 0; n < 8; n++) {
    fs.writeFileSync(path.join(photos, `DSC0${n}.jpg`), crypto.randomBytes(1_400_000));
  }
  for (let n = 0; n < 4; n++) {
    fs.writeFileSync(path.join(photos, 'Đà Lạt', `thác ${n}.jpg`), crypto.randomBytes(900_000));
  }

  const old = Date.now() / 1000 - 400 * 86400;
  for (const dir of [project, photos]) {
    const walk = (here) => {
      for (const entry of fs.readdirSync(here, { withFileTypes: true })) {
        const full = path.join(here, entry.name);
        if (entry.isDirectory()) walk(full);
        else fs.utimesSync(full, old, old);
      }
    };
    walk(dir);
  }

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  ipc.allowUnconfirmedForHarness();
  ipc.setRelocateHarness({
    pick: async () => KEEP,
    shell: {
      trashItem: async (p) => {
        fs.renameSync(p, path.join(BIN, path.basename(p)));
      },
    },
  });

  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280,
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
  win.webContents.on('console-message', (...a) => {
    const level = typeof a[1] === 'object' ? a[1].level : a[1];
    const message = typeof a[1] === 'object' ? a[1].message : a[2];
    if (level === 3 || level === 'error') errors.push(message);
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (expr) => win.webContents.executeJavaScript(expr);
  await wait(600);

  const shoot = async (name) => {
    win.webContents.invalidate();
    await wait(350);
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let i = 0; i < 3 && bytes.length === 0; i++) {
      await wait(400);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };

  const theme = async (name) => {
    nativeTheme.themeSource = name;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(name)})`);
    await wait(500);
  };

  const language = async (code) => {
    await js(`document.querySelector('.tab[data-tab="settings"]').click()`);
    await wait(250);
    await js(`document.querySelector('[data-language-choice="${code}"]').click()`);
    await wait(700);
  };

  const toTab = async (name) => {
    await js(`document.querySelector('.tab[data-tab="${name}"]').click()`);
    await wait(500);
  };

  const scan = async () => {
    await js(`setFolder(${JSON.stringify(BASE)})`);
    for (let i = 0; i < 40; i++) {
      if (await js(`document.getElementById('run-scan').disabled === false`)) break;
      await wait(250);
    }
    await js(`document.getElementById('run-scan').click()`);
    for (let i = 0; i < 80; i++) {
      if (await js(`document.getElementById('scan-stats').hidden === false`)) break;
      await wait(250);
    }
    await toTab('usage');
    for (let i = 0; i < 80; i++) {
      if (await js(`document.querySelectorAll('#spacemap-tree .spacemap-item.is-folder').length > 0`)) break;
      await wait(250);
    }
    await wait(700);
  };

  const openMenu = async (label) =>
    js(`
      (async () => {
        const settle = () => new Promise((r) => setTimeout(r, 250));
        const tile = [...document.querySelectorAll('#spacemap-tree .spacemap-item.is-folder')]
          .find((el) => (el.getAttribute('aria-label') || '').startsWith(${JSON.stringify(label)}));
        if (!tile) return { opened: false, labels: [...document.querySelectorAll('#spacemap-tree .spacemap-item.is-folder')].map((e) => e.getAttribute('aria-label')) };
        const r = tile.getBoundingClientRect();
        tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 6, clientY: r.top + 6 }));
        await settle();
        const menu = document.querySelector('.spacemap-menu');
        return { opened: Boolean(menu && !menu.hidden), items: menu ? [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent) : [] };
      })()
    `);
  const closeMenu = () =>
    js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).then(() => wait(300));

  /* -- what the confirmation would say, for both kinds of folder ---------- */
  const archiveAction = require('../src/main/actions/archive');
  console.log('\nthe confirmation (a native dialog, printed rather than photographed):');
  for (const [what, folder] of [['a source project', project], ['a folder of photos', photos]]) {
    const planned = await archiveAction.plan([folder], { destination: KEEP }, { deps: {} });
    const described = archiveAction.describe(planned);
    const saving = described.bytes > 0 ? 1 - described.estimatedArchiveBytes / described.bytes : 0;
    console.log(
      `  ${what}: ${described.files} files, ${(described.bytes / 1048576).toFixed(1)} MB -> about ` +
        `${(described.estimatedArchiveBytes / 1048576).toFixed(1)} MB (${Math.round(saving * 100)}% smaller), ` +
        `same drive: ${described.sameVolume}, frees about ${(described.estimatedFreedBytes / 1048576).toFixed(1)} MB`
    );
  }

  await scan();

  /* -- the menu, which now carries both folder actions -------------------- */
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    const menu = await openMenu('Dự án cũ');
    console.log(`  menu (${mode}): ${menu.opened ? menu.items.join(' | ') : `NOT OPENED -- ${JSON.stringify(menu.labels)}`}`);
    await shoot(`archive-menu-${mode}`);
    await closeMenu();
  }

  /* -- packing the folder that compresses --------------------------------- */
  await theme('light');
  await js(`archiveFolder(${JSON.stringify(project)}, { confirm: false })`);
  await wait(3000);
  const first = await js(`document.getElementById('toast').hidden ? '(hidden)' : document.getElementById('toast').textContent`);
  console.log(`  toast (source project): ${first}`);
  await shoot('archive-after-light');

  /* -- and the one that does not, in Vietnamese --------------------------- */
  await language('vi');
  await toTab('usage');
  await theme('dark');
  await js(`archiveFolder(${JSON.stringify(photos)}, { confirm: false })`);
  await wait(4000);
  const second = await js(`document.getElementById('toast').hidden ? '(hidden)' : document.getElementById('toast').textContent`);
  console.log(`  toast (photos, vi):    ${second}`);
  await shoot('archive-vi-after-dark');

  /* -- the Restore Center, which is where the way back lives -------------- */
  await toTab('restore');
  await wait(1500);
  const rows = await js(`
    ({
      titles: [...document.querySelectorAll('#restore-sessions .restore-head')].map((e) => e.textContent.trim().split(String.fromCharCode(10))[0]).slice(0, 4),
      // The line that said "0 items can be put back" while listing two
      // archive sessions. Printed so a run says whether that is still true.
      summary: (document.querySelector('#panel-restore .group-hint, #panel-restore p') || {}).textContent || '(no summary)',
    })
  `).catch(() => ({ titles: [], summary: '(threw)' }));
  console.log(`  restore titles : ${rows.titles.join(' | ') || '(none found)'}`);
  console.log(`  restore summary: ${String(rows.summary).trim().slice(0, 120)}`);
  await shoot('archive-vi-restore-dark');

  await language('en');
  await theme('light');
  await toTab('restore');
  await wait(800);
  await shoot('archive-restore-light');

  /* -- narrow ------------------------------------------------------------- */
  win.setSize(760, 900);
  await wait(500);
  await theme('dark');
  await shoot('archive-narrow-restore-dark');
  win.setSize(1280, 900);

  console.log(`\nwritten to ${OUT}`);
  console.log(errors.length === 0 ? 'no renderer errors' : `renderer errors: ${errors.join(' | ')}`);

  fs.rmSync(BASE, { recursive: true, force: true });
  app.exit(errors.length === 0 ? 0 : 1);
});
