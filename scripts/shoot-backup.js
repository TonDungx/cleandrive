'use strict';

// Screenshots of backing up before deleting (E2): the Photos action bar with
// nothing chosen, with a folder chosen and backing up, and with the same
// folder but the switch off. Both themes, a narrow window, and Vietnamese.
//
//   npx electron scripts/shoot-backup.js [outputDir]
//
// The destination is a folder of the harness's own on the second drive and is
// removed at the end. The confirmation dialog is where the switch actually
// lives, and a native message box cannot be captured -- so its text is
// **printed** rather than photographed. Pretending otherwise would be the one
// thing screenshots are here to stop.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootbk-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootbk';

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-backup.js'))
  || path.join(os.tmpdir(), 'cd-backup-shots');

/** 1180 the default · 900 the app's minimum · 680 sidebar shut. */
const WIDTHS = [1180, 900, 680];
const HEIGHT = 900;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** A real PNG with a real picture in it, so the grid is a grid of pictures. */
function png(width, height, seed) {
  const zlib = require('node:zlib');
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      const u = x / Math.max(1, width - 1);
      const v = y / Math.max(1, height - 1);
      raw[i] = Math.round(40 + 180 * u * Math.abs(Math.sin(seed * 1.7)));
      raw[i + 1] = Math.round(50 + 150 * v);
      raw[i + 2] = Math.round(90 + 120 * (1 - u) * Math.abs(Math.cos(seed * 1.1)));
    }
  }
  const chunk = (type, body) => {
    const out = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(out) >>> 0);
    return Buffer.concat([u32be(body.length), out, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n', 'latin1'),
    chunk('IHDR', Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 2, 0, 0, 0])])),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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

  const drive = secondRoot();
  if (!drive) throw new Error('needs a second drive to back up to');
  const far = fs.mkdtempSync(path.join(drive, 'cleandrive-backup-shots-'));
  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootbk-library-'));

  // Vietnamese names throughout: this screen is a grid of somebody's photos,
  // and the Vietnamese screenshots have caught text problems twice now.
  const names = [
    'Ảnh cưới/IMG_2201.png', 'Ảnh cưới/IMG_2202.png', 'Ảnh cưới/IMG_2203.png',
    'Đà Lạt 2024/DSC_0140.png', 'Đà Lạt 2024/DSC_0141.png', 'Đà Lạt 2024/DSC_0142.png',
    'Màn hình/Ảnh chụp màn hình 2025-06-11 163700.png',
  ];
  names.forEach((rel, i) => {
    const full = path.join(library, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, png(150 + (i % 3) * 30, 100, i + 1));
    const when = new Date(2024 - (i % 3), i % 12, 12, 10, 30);
    fs.utimesSync(full, when, when);
  });

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  ipc.allowUnconfirmedForHarness();
  // The folder chooser is native and would block forever with nobody to click
  // it, so the harness answers it. Nothing else about the path is stood in
  // for: `backup:choose` still proves it can write there, and still saves it.
  ipc.setRelocateHarness({ pickBackup: async () => far });

  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: WIDTHS[0],
    height: HEIGHT,
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
  await wait(700);

  const shoot = async (name) => {
    win.webContents.invalidate();
    await wait(350);
    await win.webContents.capturePage(); // the first frame after a change is dropped
    await wait(200);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let i = 0; i < 4 && bytes.length === 0; i++) {
      await wait(400);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    if (bytes.length === 0) throw new Error(`the window never painted for ${name}`);
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };

  const theme = async (name) => {
    nativeTheme.themeSource = name;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(name)})`);
    await wait(500);
  };

  try {
    await js(`document.querySelector('.tab[data-tab="media"]').click()`);
    await wait(400);
    await js(`
      for (const root of media.roots) root.on = false;
      media.extraRoots = [{ path: ${JSON.stringify(library)}, name: 'Ảnh', why: null, on: true }];
      renderRoots();
      document.getElementById('media-scan').click();
    `);
    for (let i = 0; i < 60; i++) {
      if (await js(`document.getElementById('media-cancel').hidden && media.files.length > 0`)) break;
      await wait(300);
    }
    console.log(`\nscanned: ${await js('media.files.length')} files`);
    console.log(`destination: ${far}\noutput: ${OUT}\n`);

    // Pick some photos so the action bar is up, and hide the roots card so the
    // bar is not competing with it for the bottom of the frame.
    await js(`
      document.getElementById('media-roots-card').hidden = true;
      [...document.querySelectorAll('.media-cell')].slice(0, 3).forEach((c) => c.click());
    `);
    await wait(900);

    /* -- nothing chosen yet ---------------------------------------------- */
    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`backup-none-${name}`);
    }

    /* -- a folder chosen, and backing up --------------------------------- */
    await theme('light');
    await js(`document.getElementById('media-backup').click()`);
    for (let i = 0; i < 60; i++) {
      if (await js(`document.getElementById('media-backup').getAttribute('aria-pressed') === 'true'`)) break;
      await wait(150);
    }
    await wait(400);
    const label = await js(`document.getElementById('media-backup').textContent`);
    console.log(`  button now reads: ${label}`);

    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`backup-on-${name}`);
    }

    /* -- the same folder, switch off ------------------------------------- */
    await theme('light');
    await js(`document.getElementById('media-backup').click()`);
    await wait(400);
    console.log(`  switched off, reads: ${await js(`document.getElementById('media-backup').textContent`)}`);
    await shoot('backup-paused-light');
    await js(`document.getElementById('media-backup').click()`);
    await wait(400);

    /* -- narrow, where the bar has to wrap -------------------------------- */
    for (const width of WIDTHS.slice(1)) {
      win.setContentSize(width, HEIGHT);
      await js(width <= 680
        ? `document.getElementById('sidebar').classList.contains('is-hidden') || document.getElementById('sidebar-toggle').click()`
        : `document.getElementById('sidebar').classList.contains('is-hidden') && document.getElementById('sidebar-toggle').click()`);
      await wait(500);
      await js(`renderGrid()`);
      await wait(350);
      await shoot(`backup-on-${width}-light`);
    }
    win.setContentSize(WIDTHS[0], HEIGHT);
    await js(`document.getElementById('sidebar').classList.contains('is-hidden') && document.getElementById('sidebar-toggle').click()`);
    await wait(500);

    /* -- Vietnamese ------------------------------------------------------- */
    // Through the Settings control, not by calling the IPC: clicking what a
    // person clicks is the only way the screenshots prove the button works.
    await js(`document.querySelector('.tab[data-tab="settings"]').click()`);
    await wait(400);
    await js(`document.querySelector('[data-language-choice="vi"]').click()`);
    await wait(900);
    await js(`document.querySelector('.tab[data-tab="media"]').click()`);
    await wait(500);
    await js(`renderGrid()`);
    await wait(400);
    console.log(`  in Vietnamese: ${await js(`document.getElementById('media-backup').textContent`)}`);
    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`backup-on-vi-${name}`);
    }
    win.setContentSize(680, HEIGHT);
    await js(`document.getElementById('sidebar').classList.contains('is-hidden') || document.getElementById('sidebar-toggle').click()`);
    await wait(500);
    await theme('light');
    await js(`renderGrid()`);
    await wait(400);
    await shoot('backup-on-vi-680-light');

    /* -- the dialog, which cannot be captured ----------------------------- */
    // Printed instead of photographed. A native message box does not appear in
    // `capturePage`, and a screenshot of the window behind it labelled as the
    // dialog would be a lie in a file somebody would later trust.
    const recycle = require('../src/main/actions/recycle');
    const chosen = await js(`[...media.selected]`);
    const planned = await recycle.plan(chosen, {}, { token: { cancelled: false }, onProgress: () => {} });
    const described = recycle.describe(planned, { backupTo: far });
    console.log('\n--- the confirmation dialog, in Vietnamese (native: printed, not captured) ---');
    const i18n = require('../src/i18n');
    const t = (k, e, p) => i18n.t(k, e, p);
    console.log(`title:    ${t('dialog.confirmDelete.title', 'Confirm delete')}`);
    console.log(`message:  ${t('dialog.confirmDelete.message', 'Move {n} item(s) to the Recycle Bin?', { n: described.count })}`);
    console.log(`detail:   ${t('dialog.confirmDelete.detailBin', '{size} will move to the Recycle Bin, where it stays recoverable.', { size: `${described.bytes} B` })}`);
    console.log(`          ${t('dialog.confirmDelete.backup', '', { dest: far })}`);
    console.log(`checkbox: ${t('dialog.confirmDelete.backupCheck', 'Back up to {dest} first', { dest: far })}`);
    console.log(`buttons:  ${t('dialog.moveToBin', 'Move to Recycle Bin')} | ${t('app.cancel', 'Cancel')}`);
    console.log('---\n');

    if (errors.length) console.log(`renderer errors: ${errors.length}\n${errors.join('\n')}`);
    else console.log('no renderer errors');
  } finally {
    fs.rmSync(library, { recursive: true, force: true });
    fs.rmSync(far, { recursive: true, force: true });
  }

  console.log(`\nscreenshots in ${OUT}\n`);
  app.quit();
}).catch((err) => {
  console.error('\nScreenshots failed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
