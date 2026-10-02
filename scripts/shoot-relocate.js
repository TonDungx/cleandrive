#!/usr/bin/env node
'use strict';

// Screenshots of moving a whole folder to another drive (B2): the map's
// right-click menu with the move on it, and the receipt afterwards. Both
// themes, narrow, Vietnamese.
//
//   npx electron scripts/shoot-relocate.js [outputDir]
//
// The folder being moved is this harness's own, built on C: so the move is a
// real cross-drive one; the destination is a folder of its own on the second
// drive and the Recycle Bin is stood in for, so nothing of anybody's is
// touched. Both are removed at the end.
//
// The confirmation itself is a native dialog and cannot be photographed --
// the same limit `shoot-recap.js` has with a Windows notification -- so this
// prints the text it would show instead of pretending to picture it.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootreloc-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootreloc';

require('../src/main/lib/preview/serve').registerScheme();

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-relocate.js')) ||
  path.join(os.tmpdir(), 'cd-relocate-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

function secondRoot() {
  for (const letter of 'DEFGH') {
    const root = `${letter}:\\`;
    try {
      if (fs.statSync(root).dev !== fs.statSync(path.parse(os.tmpdir()).root).dev) return root;
    } catch {
      // not there
    }
  }
  return null;
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');
  const far = secondRoot();
  if (!far) throw new Error('needs a second drive to move a folder to');

  const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootreloc-home-'));
  const DEST = fs.mkdtempSync(path.join(far, 'cleandrive-harness-reloc-'));
  const BIN = path.join(BASE, '.bin');
  fs.mkdirSync(BIN);

  // A home folder with something in it worth moving, named the way somebody
  // would name it -- the Vietnamese pictures are the point of the feature.
  const make = (rel, bytes) => {
    const full = path.join(BASE, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, crypto.randomBytes(bytes));
    const old = Date.now() / 1000 - (200 + rel.length) * 86400;
    fs.utimesSync(full, old, old);
    return full;
  };
  const clip = make(path.join('Video 2019', 'Đám cưới', 'toàn cảnh.mp4'), 42 * MB);
  make(path.join('Video 2019', 'Đám cưới', 'tiệc tối.mp4'), 28 * MB);
  make(path.join('Video 2019', 'Du lịch Đà Lạt', 'thác Datanla.mp4'), 21 * MB);
  make(path.join('Video 2019', 'Du lịch Đà Lạt', 'đồi chè.mp4'), 12 * MB);
  make(path.join('Tài liệu', 'hợp đồng.pdf'), 2 * MB);
  fs.mkdirSync(path.join(BASE, 'Video 2019', 'Chưa phân loại'), { recursive: true });
  fs.writeFileSync(`${clip}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n');

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  ipc.allowUnconfirmedForHarness();
  let n = 0;
  ipc.setRelocateHarness({
    pick: async () => DEST,
    shell: {
      trashItem: async (p) => {
        fs.renameSync(p, path.join(BIN, `${(n += 1)}-${path.basename(p)}`));
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
    // The first frame after a repaint is often the old one; it is thrown away.
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
  // Through the Settings control the person uses, not the IPC behind it: the
  // window re-translates itself on the change event, and a call that skips
  // the control skips the event.
  // Through the Settings control a person uses, not the IPC behind it: the
  // window re-translates itself on the change event, and a call that skips
  // the control skips the event.
  const language = async (code) => {
    await js(`document.querySelector('.tab[data-tab="settings"]').click()`);
    await wait(250);
    await js(`document.querySelector('[data-language-choice="${code}"]').click()`);
    await wait(700);
    await js(`document.querySelector('.tab[data-tab="usage"]').click()`);
    await wait(500);
  };

  // Driven through the window's own controls rather than the scan API: the
  // map is drawn from the renderer's state, and calling `scan()` directly
  // fills nothing in. This is the same route `smoke.js` takes.
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
    await js(`document.querySelector('.tab[data-tab="usage"]').click()`);
    for (let i = 0; i < 80; i++) {
      const ready = await js(
        `Boolean(window.SpaceMap && document.querySelectorAll('#spacemap-tree .spacemap-item.is-folder').length > 0)`
      );
      if (ready) break;
      await wait(250);
    }
    await wait(700);
  };

  /** Open the map's menu on the folder this feature is for. */
  const openMenu = async (label) => {
    return js(`
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
  };
  const closeMenu = () =>
    js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).then(() => wait(300));

  await scan();

  /* -- the menu, which is the whole of this feature's own interface -------- */
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    const menu = await openMenu('Video 2019');
    console.log(`  menu (${mode}): ${menu.opened ? menu.items.join(' | ') : `NOT OPENED -- ${JSON.stringify(menu.labels)}`}`);
    await shoot(`relocate-menu-${mode}`);
    await closeMenu();
  }

  /* -- Vietnamese --------------------------------------------------------- */
  await language('vi');
  await theme('light');
  const viMenu = await openMenu('Video 2019');
  console.log(`  menu (vi): ${viMenu.opened ? viMenu.items.join(' | ') : 'NOT OPENED'}`);
  await shoot('relocate-vi-menu-light');
  await closeMenu();

  /* -- narrow, where a menu has least room -------------------------------- */
  win.setSize(760, 900);
  await wait(500);
  await theme('dark');
  const narrow = await openMenu('Video 2019');
  console.log(`  menu (narrow, vi): ${narrow.opened ? narrow.items.join(' | ') : 'NOT OPENED'}`);
  await shoot('relocate-narrow-menu-dark');
  await closeMenu();
  win.setSize(1280, 900);
  await wait(400);

  /* -- the move, and the receipt it leaves -------------------------------- */
  // Through the window's own function, not the bridge under it: the receipt
  // and the map's redraw are the things being photographed, and both of them
  // live there. The destination comes from the harness hook in place of the
  // folder dialog, exactly as a person's choice would.
  const folder = path.join(BASE, 'Video 2019');
  await js(`relocateFolder(${JSON.stringify(folder)}, { confirm: false })`);
  await wait(2500);
  const after = await js(`({
    toast: document.getElementById('toast').hidden ? '(hidden)' : document.getElementById('toast').textContent,
    onMap: [...document.querySelectorAll('#spacemap-tree .spacemap-item')].map((e) => e.getAttribute('aria-label')).filter(Boolean),
  })`);
  console.log(`  toast: ${after.toast}`);
  console.log(`  still on the map: ${after.onMap.length === 0 ? '(nothing)' : after.onMap.join(' | ')}`);
  await shoot('relocate-vi-after-dark');
  await theme('light');
  await language('en');
  await wait(600);
  await shoot('relocate-after-light');

  /* -- what the confirmation would have said, since it cannot be pictured -- */
  console.log('\nthe confirmation (a native dialog, printed rather than photographed):');
  const relocate = require('../src/main/actions/relocate');
  const second = path.join(BASE, 'Tài liệu');
  const planned = await relocate.plan([second], { destination: DEST, leaveShortcut: true }, { deps: {} });
  const described = relocate.describe(planned);
  console.log(`  ${described.count} folder(s), ${described.files} file(s), ${described.bytes} bytes -> ${described.destination}`);
  console.log(`  frees on this volume: ${described.freesOnVolume} · reversible: ${described.reversible}`);

  console.log(`\nwritten to ${OUT}`);
  console.log(errors.length === 0 ? 'no renderer errors' : `renderer errors: ${errors.join(' | ')}`);

  fs.rmSync(BASE, { recursive: true, force: true });
  fs.rmSync(DEST, { recursive: true, force: true });
  app.exit(errors.length === 0 ? 0 : 1);
});
