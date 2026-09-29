'use strict';

// Screenshots of E1: the "photos that look the same" card on the Photos
// screen, and the side-by-side comparison it opens — at rest, zoomed in, and
// flicking. Both themes, a narrow window, and Vietnamese.
//
//   npx electron scripts/shoot-compare.js [outputDir]
//
// The library is a fixture of this harness's own, removed at the end, and it
// is the same one `test-compare.js` uses so the pictures on screen are the
// ones whose grouping is known in advance.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootcmp-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootcmp';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-compare.js'))
  || path.join(os.tmpdir(), 'cd-compare-shots');

const HEIGHT = 900;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

function png(width, height, paint) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      const [r, g, b] = paint(x / (width - 1), y / (height - 1));
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
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

const SCENES = {
  beach: (u, v) => [
    Math.round(30 + 200 * u),
    Math.round(60 + 160 * v),
    Math.round(200 - 150 * Math.abs(u - v)),
  ],
  rings: (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5);
    const ring = Math.round(128 + 120 * Math.sin(d * 38));
    return [ring, Math.round(255 - ring), Math.round(40 + 180 * d)];
  },
  dusk: (u, v) => {
    const band = Math.sin(u * Math.PI * 6);
    return [
      Math.round(150 + 90 * band),
      Math.round(120 - 70 * band + 30 * v),
      Math.round(160 + 80 * Math.sin(u * Math.PI * 6 + 2)),
    ];
  },
  tiles: (u, v) => {
    const on = (Math.floor(u * 9) + Math.floor(v * 9)) % 2 === 0;
    return on ? [235, 228, 210] : [40, 52, 74];
  },
};

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');

  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootcmp-library-'));
  const write = (name, bytes) => {
    const full = path.join(library, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
  };

  // Vietnamese names throughout, as the other photo shoots use.
  write('Đà Lạt/hoàng hôn gốc.png', png(520, 390, SCENES.beach));
  write('Đà Lạt/hoàng hôn gửi Zalo.png', png(320, 240, SCENES.beach));
  write('Đà Lạt/hoàng hôn thu nhỏ.png', png(160, 120, SCENES.beach));
  write('Đà Lạt/vòng sáng.png', png(420, 315, SCENES.rings));
  write('Đà Lạt/vòng sáng (bản sao).png', png(210, 158, SCENES.rings));
  write('Ảnh cưới/rèm cửa.png', png(460, 345, SCENES.dusk));
  write('Ảnh cưới/rèm cửa nhỏ.png', png(280, 210, SCENES.dusk));
  write('Ảnh cưới/gạch hoa.png', png(380, 285, SCENES.tiles));

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  ipc.allowUnconfirmedForHarness();

  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280,
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

  const openFirstGroup = async () => {
    await js(`document.querySelectorAll('#similar-list .similar-row')[0].querySelector('button').click()`);
    for (let i = 0; i < 40; i++) {
      if ((await js(`document.getElementById('compare').hidden`)) === false) break;
      await wait(200);
    }
    await wait(700);
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
    console.log(`\nscanned: ${await js('media.files.length')} files\noutput: ${OUT}\n`);

    await js(`document.getElementById('media-roots-card').hidden = true`);

    /* -- the card before anything has been looked at ---------------------- */
    await theme('light');
    await shoot('similar-before-light');

    /* -- look at everything ------------------------------------------------ */
    await js(`document.getElementById('similar-measure').click()`);
    for (let i = 0; i < 120; i++) {
      if ((await js(`similar.measuring`)) === false) break;
      await wait(250);
    }
    await wait(600);
    console.log(`  groups: ${await js(`similar.groups.length`)}`);

    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`similar-${name}`);
    }

    /* -- the comparison ---------------------------------------------------- */
    await theme('light');
    await openFirstGroup();
    console.log(`  panes: ${await js(`document.querySelectorAll('#compare-panes .cmp-pane').length`)}`);
    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`compare-${name}`);
    }

    /* -- zoomed in, which is what the panel is for ------------------------- */
    await theme('light');
    for (let i = 0; i < 6; i++) {
      await js(`document.getElementById('compare-panes').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`);
      await wait(80);
    }
    await wait(400);
    console.log(`  zoom: ${await js(`document.querySelector('#compare-panes .compare-img').style.transform`)}`);
    await shoot('compare-zoomed-light');
    await js(`document.getElementById('compare-reset').click()`);
    await wait(300);

    /* -- flicking ---------------------------------------------------------- */
    await js(`document.getElementById('compare-flicker').click()`);
    await wait(300);
    await shoot('compare-flicking-light');
    await js(`document.getElementById('compare-flicker').click()`);
    await wait(300);

    /* -- narrow, where the panes stack ------------------------------------- */
    for (const width of [900, 680]) {
      win.setContentSize(width, HEIGHT);
      await wait(600);
      await shoot(`compare-${width}-light`);
    }
    win.setContentSize(1280, HEIGHT);
    await wait(500);

    /* -- Vietnamese --------------------------------------------------------- */
    await js(`window.PhotoCompare.close()`);
    await wait(300);
    await js(`document.querySelector('.tab[data-tab="settings"]').click()`);
    await wait(400);
    await js(`document.querySelector('[data-language-choice="vi"]').click()`);
    await wait(900);
    await js(`document.querySelector('.tab[data-tab="media"]').click()`);
    await wait(500);
    console.log(`  in Vietnamese: ${await js(`document.querySelector('#media-similar-card h2').textContent`)}`);
    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`similar-vi-${name}`);
    }
    await theme('light');
    await openFirstGroup();
    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`compare-vi-${name}`);
    }
    await theme('light');
    win.setContentSize(680, HEIGHT);
    await wait(700);
    await shoot('compare-vi-680-light');

    if (errors.length) console.log(`\nrenderer errors: ${errors.length}\n${errors.join('\n')}`);
    else console.log('\nno renderer errors');
  } finally {
    fs.rmSync(library, { recursive: true, force: true });
  }

  console.log(`\nscreenshots in ${OUT}\n`);
  app.quit();
}).catch((err) => {
  console.error('\nScreenshots failed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
