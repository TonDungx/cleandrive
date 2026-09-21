'use strict';

// Screenshots of the Photos & video tab, at four widths and in both themes.
//
//   npx electron scripts/shoot-media.js [outputDir]
//
// ## Why a script rather than a person with a snipping tool
//
// Eight screenshots taken by hand are eight screenshots taken at slightly
// different moments, with whatever happened to be selected, and they go stale
// the first time a margin changes. This drives the real window through the real
// IPC against a photo library it builds itself, so the same eight pictures come
// out the same way every time and any of them can be regenerated in a minute.
//
// The widths are the ones the rest of this project checks: 1400 is a roomy
// window, 1180 is the default, 900 is the minimum the app allows, and 680 is
// narrower than that -- reachable only by dragging the sidebar shut, and worth
// looking at because the grid is the widest thing in the app.
//
// Nothing is deleted. The fixture tree is built in a temporary directory and
// removed afterwards, and `userData` is redirected the way every harness here
// redirects it.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shoot-')));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shoot';

const ipc = require('../src/main/ipc');

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-media.js'))
  || path.join(os.homedir(), 'Pictures', 'cleandrive-media-shots');

/** 1400 roomy · 1180 the default · 900 the app's minimum · 680 sidebar shut. */
const WIDTHS = [1400, 1180, 900, 680];
const HEIGHT = 900;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/* a photo library to point it at                                              */
/* -------------------------------------------------------------------------- */

const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

/**
 * A PNG of a stated size, with a real picture in it.
 *
 * The pixels matter here in a way they do not in the unit tests: these
 * screenshots are of a grid of thumbnails, and a grid of identical grey squares
 * would not show whether the grid works. So each one is a simple gradient with
 * a band of colour, deflate-compressed the way a PNG requires.
 */
function png(width, height, seed) {
  const zlib = require('node:zlib');
  const raw = Buffer.alloc(height * (1 + width * 3));

  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // no per-row filter
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

/** The PNG table, built once. `trayicon.js` does the same thing for the gauge. */
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

/** A JPEG whose header is real; the scan reads headers, not pixels. */
function jpeg(width, height, padTo) {
  const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker]), u16be(body.length + 2), body]);
  const head = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xc0, Buffer.concat([
      Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3]),
      Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ])),
    seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])),
  ]);
  const tail = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, padTo - head.length - tail.length), 0x7f), tail]);
}

/**
 * Enough files, and enough variety, that the screenshots show the feature
 * rather than an empty state: several origins so the chips have something to
 * hold, and enough rows that the grid has to scroll.
 */
function buildLibrary(root) {
  const write = (relative, bytes) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
  };

  for (let i = 0; i < 26; i++) {
    write(`Camera Roll/IMG_${1000 + i}.png`, png(120, 90, i + 1));
  }
  for (let i = 0; i < 18; i++) {
    write(`Screenshots/Screenshot 2025-06-${String(1 + (i % 28)).padStart(2, '0')} 1637${String(i).padStart(2, '0')}.png`,
      png(160, 90, i + 30));
  }
  for (let i = 0; i < 9; i++) {
    write(`Sent/IMG-2024081${i}-WA00${40 + i}.png`, png(100, 100, i + 60));
  }
  for (let i = 0; i < 6; i++) {
    write(`Edited/export-${i}.png`, png(140, 70, i + 80));
  }

  // Things the "what it is" axis has an opinion about, so those chips appear.
  write('Odds/tiny-icon.png', png(16, 16, 3));
  write('Odds/actually-a-png.jpg', png(60, 60, 7));
  write('Odds/broken.png', Buffer.alloc(0));
  write('Odds/huge.jpg', jpeg(6000, 4000, 900 * 1024));
  write('Odds/wide-strip.png', png(400, 60, 11));
}

/* -------------------------------------------------------------------------- */

app.whenReady().then(async () => {
  ipc.register();

  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shoot-library-'));
  buildLibrary(library);
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`\nlibrary: ${library}\noutput:  ${OUT}\n`);

  // Shown, not hidden.
  //
  // A hidden window has no compositor producing frames, and `capturePage()`
  // on one returns whatever the last composited state happened to be. The
  // first run of this script proved it: `getComputedStyle` reported
  // `color-scheme: light` and a light body background while the captured PNG
  // came out entirely dark. The same reason `verify-appearance.js` had to stop
  // waiting on `transition.finished` -- a window nobody can see does not
  // animate and does not repaint.
  const win = new BrowserWindow({
    width: WIDTHS[0],
    height: HEIGHT,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on('console-message', (...args) => {
    const level = typeof args[1] === 'object' ? args[1].level : args[1];
    const message = typeof args[1] === 'object' ? args[1].message : args[2];
    if (level === 3 || level === 'error') console.log(`    [renderer error] ${message}`);
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (expr) => win.webContents.executeJavaScript(expr);

  await wait(500);
  await js(`document.querySelector('.tab[data-tab="media"]').click()`);
  await wait(400);

  // Point the scan at the fixture library and run it once. The results stay in
  // the window across every resize and theme change below, so the eight
  // pictures differ only in what is being demonstrated.
  await js(`
    for (const root of media.roots) root.on = false;
    media.extraRoots = [{ path: ${JSON.stringify(library)}, name: 'Photos', why: null, on: true }];
    renderRoots();
    document.getElementById('media-scan').click();
  `);

  for (let i = 0; i < 60; i++) {
    if (await js(`document.getElementById('media-cancel').hidden && media.files.length > 0`)) break;
    await wait(300);
  }
  console.log(`scanned: ${await js('media.files.length')} files\n`);

  // Select one picture so the detail panel is showing its evidence: an empty
  // panel would leave the most important thing on this screen out of the
  // screenshots entirely.
  await js(`
    document.getElementById('media-roots-card').hidden = true;
    const cell = document.querySelector('.media-cell');
    if (cell) cell.click();
  `);
  await wait(900); // let the thumbnails arrive

  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
    await wait(250);

    for (const width of WIDTHS) {
      win.setContentSize(width, HEIGHT);
      // Below the sidebar's own breakpoint the labels go; at the narrowest
      // width it is shut altogether, which is the only way to reach 680.
      await js(width <= 680
        ? `document.getElementById('sidebar').classList.contains('is-hidden') || document.getElementById('sidebar-toggle').click()`
        : `document.getElementById('sidebar').classList.contains('is-hidden') && document.getElementById('sidebar-toggle').click()`);
      await wait(450);
      await js(`renderGrid()`);
      await wait(350);

      const image = await win.webContents.capturePage();
      const file = path.join(OUT, `media-${width}-${theme}.png`);
      fs.writeFileSync(file, image.toPNG());

      const cells = await js(`document.querySelectorAll('.media-cell').length`);
      const images = await js(`document.querySelectorAll('.media-img').length`);
      console.log(`  ${path.basename(file).padEnd(24)} ${cells} cells, ${images} drawn`);
    }
  }

  fs.rmSync(library, { recursive: true, force: true });
  console.log(`\n${WIDTHS.length * 2} screenshots in ${OUT}\n`);
  app.quit();
}).catch((err) => {
  console.error('\nScreenshots failed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
