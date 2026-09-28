#!/usr/bin/env node
'use strict';

// Screenshots of NTFS compression (B4): the map's menu with all three things
// you can do to a folder, and the receipt for each of the three outcomes --
// a folder that compresses, one that will not, and stopping again. Both
// themes, narrow, Vietnamese.
//
//   npx electron scripts/shoot-compress.js [outputDir]
//
// Nothing is stood in for. This feature moves nothing and deletes nothing, so
// there is no Recycle Bin to substitute; the folders are this harness's own
// and are removed at the end. `compact.exe` needs no elevation for them.
//
// The confirmation is a native dialog and cannot be photographed, so its text
// is printed for each of the three cases instead.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootcomp-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootcomp';

require('../src/main/lib/preview/serve').registerScheme();

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-compress.js')) ||
  path.join(os.tmpdir(), 'cd-compress-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');

  const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootcomp-home-'));

  const project = path.join(BASE, 'Dự án cũ');
  fs.mkdirSync(path.join(project, 'src', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(project, 'Chưa dùng'), { recursive: true });
  const code = Buffer.from('const value = 1; // a line of ordinary source code\n'.repeat(60000));
  for (let n = 0; n < 6; n++) fs.writeFileSync(path.join(project, 'src', `module-${n}.js`), code);
  fs.writeFileSync(path.join(project, 'src', 'lib', 'tiện ích.js'), code);
  fs.writeFileSync(path.join(project, 'nhật ký máy chủ.log'), Buffer.from('2026-09-28 10:00:00 INFO  request handled in 12ms\n'.repeat(120000)));

  const photos = path.join(BASE, 'Ảnh 2015');
  fs.mkdirSync(path.join(photos, 'Đà Lạt'), { recursive: true });
  for (let n = 0; n < 8; n++) fs.writeFileSync(path.join(photos, `DSC0${n}.jpg`), crypto.randomBytes(1_600_000));
  for (let n = 0; n < 4; n++) fs.writeFileSync(path.join(photos, 'Đà Lạt', `thác ${n}.jpg`), crypto.randomBytes(1_100_000));

  const old = Date.now() / 1000 - 500 * 86400;
  const age = (here) => {
    for (const entry of fs.readdirSync(here, { withFileTypes: true })) {
      const full = path.join(here, entry.name);
      if (entry.isDirectory()) age(full);
      else fs.utimesSync(full, old, old);
    }
  };
  age(project);
  age(photos);

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  ipc.allowUnconfirmedForHarness();

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
  const toast = () =>
    js(`document.getElementById('toast').hidden ? '(hidden)' : document.getElementById('toast').textContent`);

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

  /* -- what the confirmation would say, for all three cases --------------- */
  const compressAction = require('../src/main/actions/compress');
  console.log('\nthe confirmation (a native dialog, printed rather than photographed):');
  for (const [what, folder, options] of [
    ['a source project', project, {}],
    ['a folder of photos', photos, {}],
  ]) {
    const planned = await compressAction.plan([folder], options, { deps: {} });
    const d = compressAction.describe(planned);
    console.log(
      `  ${what}: ${d.files} files, on disk ${(d.onDiskBefore / 1048576).toFixed(1)} MB -> about ` +
        `${(d.estimatedBytes / 1048576).toFixed(1)} MB, frees about ${(d.estimatedFreedBytes / 1048576).toFixed(1)} MB ` +
        `(sampled ${d.sampled}, already compressed ${d.alreadyCompressed})`
    );
  }

  await scan();

  /* -- the menu, which now holds all three folder actions ----------------- */
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    const menu = await openMenu('Dự án cũ');
    console.log(`  menu (${mode}): ${menu.opened ? menu.items.join(' | ') : `NOT OPENED -- ${JSON.stringify(menu.labels)}`}`);
    await shoot(`compress-menu-${mode}`);
    await closeMenu();
  }

  /* -- the folder that compresses ----------------------------------------- */
  await theme('light');
  await js(`compressFolder(${JSON.stringify(project)}, { confirm: false })`);
  await wait(3000);
  console.log(`  toast (source project): ${await toast()}`);
  await shoot('compress-after-light');

  /* -- the one that will not, in Vietnamese ------------------------------- */
  await language('vi');
  await toTab('usage');
  await theme('dark');
  await js(`compressFolder(${JSON.stringify(photos)}, { confirm: false })`);
  await wait(4000);
  console.log(`  toast (photos, vi):     ${await toast()}`);
  await shoot('compress-vi-photos-dark');

  /* -- and stopping again -------------------------------------------------- */
  await js(`compressFolder(${JSON.stringify(project)}, { confirm: false })`);
  await wait(3000);
  console.log(`  toast (stopping, vi):   ${await toast()}`);
  await shoot('compress-vi-undo-dark');

  /* -- narrow -------------------------------------------------------------- */
  win.setSize(760, 900);
  await wait(500);
  const narrow = await openMenu('Dự án cũ');
  console.log(`  menu (narrow, vi): ${narrow.opened ? narrow.items.join(' | ') : 'NOT OPENED'}`);
  await shoot('compress-narrow-menu-dark');
  await closeMenu();
  win.setSize(1280, 900);

  console.log(`\nwritten to ${OUT}`);
  console.log(errors.length === 0 ? 'no renderer errors' : `renderer errors: ${errors.join(' | ')}`);

  fs.rmSync(BASE, { recursive: true, force: true });
  app.exit(errors.length === 0 ? 0 : 1);
});
