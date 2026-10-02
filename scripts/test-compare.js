'use strict';

// Photos that look the same, and the panel that puts them side by side (E1),
// in the real window over the real IPC.
//
//   npx electron scripts/test-compare.js
//
// Nothing is stood in for. The pictures are real PNGs written to disk, the
// scan is the real scan, the grouping is `lib/media/perceptual.js` reached
// through `media:similar`, and the panel is the one the app ships. The
// fixture is built so the answer is known in advance: three near-identical
// copies of one picture at three sizes, two of another, and several that are
// nothing like either -- so a run that groups everything, or nothing, fails.
//
// Isolation: throwaway userData, suffixed task names, a fixture folder of the
// harness's own; all checked first, all removed after.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { app, BrowserWindow } = require('electron');

app.setName(require('../package.json').name);
const PRODUCTION_USER_DATA = app.getPath('userData');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-compare-userdata-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'compare';
require('../src/main/lib/preview/serve').registerScheme();

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chromium holds userData until this process is gone; a small Node process removes it after. */
function removeAfterExit(dir) {
  const script = `
    const fs = require('node:fs');
    const alive = () => { try { process.kill(${process.pid}, 0); return true; } catch { return false; } };
    let tries = 0;
    const tick = () => {
      if (!alive() || tries > 60) {
        try { fs.rmSync(${JSON.stringify(dir)}, { recursive: true, force: true }); return; } catch {}
      }
      if (++tries < 120) setTimeout(tick, 250);
    };
    tick();`;
  require('node:child_process')
    .spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    .unref();
}

/* -------------------------------------------------------------------------- */
/* pictures whose grouping is known in advance                                 */
/* -------------------------------------------------------------------------- */

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

/**
 * A PNG carrying a picture drawn by `paint`.
 *
 * Real pixels, because that is what is being tested: the grouping works from a
 * perceptual hash of the decoded image, so a fixture of flat grey squares
 * would group everything and prove nothing.
 */
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

/* -------------------------------------------------------------------------- */
/* a real JPEG that really carries EXIF                                        */
/* -------------------------------------------------------------------------- */

/*
 * ISO and shutter speed are the two fields E1 added to what the window is
 * told, and a fixture of PNGs never exercises them: a PNG carries no EXIF, so
 * those rows are correctly left out of the table and the change goes untested.
 *
 * So two of the pictures below are genuine JPEGs -- encoded by the same
 * `nativeImage` the app decodes with, so they really decode and really group
 * -- with an APP1 block spliced in after the start-of-image marker. Written
 * here rather than borrowed from `test-media-format.js`, whose builder makes a
 * JPEG with a fake entropy-coded scan: perfect for testing a parser, useless
 * for testing anything that needs the pixels back.
 */

const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16beBuf = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

/** A little-endian TIFF block with an IFD0 and an Exif sub-IFD. */
function exifBlock({ make, model, iso, exposure, taken }) {
  const overflow = [];
  const ifdBytes = (n) => 2 + n * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + ifdBytes(3);
  const overflowBase = exifAt + ifdBytes(3);
  const put = (bytes) => {
    const at = overflowBase + overflow.reduce((n, b) => n + b.length, 0);
    overflow.push(bytes);
    return at;
  };

  const ascii = (tag, text) => {
    const bytes = Buffer.from(`${text}\0`, 'latin1');
    return Buffer.concat([u16le(tag), u16le(2), u32le(bytes.length), u32le(put(bytes))]);
  };
  const short = (tag, value) => {
    const inline = Buffer.alloc(4);
    inline.writeUInt16LE(value, 0);
    return Buffer.concat([u16le(tag), u16le(3), u32le(1), inline]);
  };
  const rational = (tag, [num, den]) =>
    Buffer.concat([u16le(tag), u16le(5), u32le(1), u32le(put(Buffer.concat([u32le(num), u32le(den)])))]);

  const ifd0 = [ascii(0x010f, make), ascii(0x0110, model)];
  const exif = [short(0x8827, iso), rational(0x829a, exposure), ascii(0x9003, taken)];

  return Buffer.concat([
    Buffer.from('II', 'latin1'), u16le(42), u32le(ifd0At),
    u16le(3), ...ifd0, Buffer.concat([u16le(0x8769), u16le(4), u32le(1), u32le(exifAt)]), u32le(0),
    u16le(3), ...exif, u32le(0),
    ...overflow,
  ]);
}

/** Put an APP1 Exif segment straight after the SOI of a real JPEG. */
function withExif(jpeg, tags) {
  const block = exifBlock(tags);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), block]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16beBuf(body.length + 2), body]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** Two pictures that do not look like each other, and never should group. */
const SCENES = {
  // A diagonal gradient with a bright band: plenty of structure for a hash.
  beach: (u, v) => [
    Math.round(30 + 200 * u),
    Math.round(60 + 160 * v),
    Math.round(200 - 150 * Math.abs(u - v)),
  ],
  // Concentric rings -- nothing like the gradient above.
  rings: (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5);
    const ring = Math.round(128 + 120 * Math.sin(d * 38));
    return [ring, Math.round(255 - ring), Math.round(40 + 180 * d)];
  },
  // A checker, different again.
  tiles: (u, v) => {
    const on = (Math.floor(u * 9) + Math.floor(v * 9)) % 2 === 0;
    return on ? [235, 228, 210] : [40, 52, 74];
  },
  // Broad soft columns, for the two JPEGs.
  //
  // Two constraints pull against each other here, and the first fixture got it
  // wrong. It has to be *smooth*, because a checker does not survive JPEG
  // quantisation and the two sizes would then stop matching for a reason that
  // has nothing to do with what is being tested. But it also has to differ
  // from `beach` along the horizontal, because the hash compares each pixel
  // with the one to its right -- and a first attempt at this was a smooth
  // vertical gradient, which has almost no horizontal structure at all and
  // duly landed in the same group as the beach. Low-frequency columns are
  // smooth and unmistakably not a left-to-right ramp.
  dusk: (u, v) => {
    const band = Math.sin(u * Math.PI * 6);
    return [
      Math.round(150 + 90 * band),
      Math.round(120 - 70 * band + 30 * v),
      Math.round(160 + 80 * Math.sin(u * Math.PI * 6 + 2)),
    ];
  },
};

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const cleanups = [];
  try {
    console.log('\nIsolation:');
    check(
      'userData is a throwaway directory',
      app.getPath('userData') === SANDBOX && SANDBOX !== PRODUCTION_USER_DATA && SANDBOX.startsWith(os.tmpdir()),
      SANDBOX
    );
    check('scheduled-task names are suffixed', Boolean(process.env.CLEANDRIVE_TASK_SUFFIX), process.env.CLEANDRIVE_TASK_SUFFIX);
    const realSettings = path.join(PRODUCTION_USER_DATA, 'settings.json');
    const realBefore = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;

    /* -- the library ------------------------------------------------------ */
    const library = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-compare-library-'));
    cleanups.push(() => fs.rmSync(library, { recursive: true, force: true }));

    const write = (name, bytes) => {
      const full = path.join(library, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, bytes);
      return full;
    };

    // One picture at three sizes: the same photograph re-encoded, which is
    // what a chat app does to it. These must land in one group.
    const beachBig = write('Trip/beach-original.png', png(480, 360, SCENES.beach));
    const beachMid = write('Trip/beach-sent.png', png(320, 240, SCENES.beach));
    const beachSmall = write('Trip/beach-thumb.png', png(160, 120, SCENES.beach));

    // A second picture at two sizes: a second group, and proof that one group
    // is not simply everything that was measured.
    const ringsBig = write('Trip/rings-original.png', png(400, 300, SCENES.rings));
    const ringsSmall = write('Trip/rings-copy.png', png(200, 150, SCENES.rings));

    // And one that is like neither, which must be in no group at all.
    const tiles = write('Trip/tiles.png', png(360, 270, SCENES.tiles));

    // A third group, as two genuine JPEGs carrying genuine EXIF, so the ISO
    // and shutter rows of the table are exercised by something rather than
    // correctly left out. The same scene at two sizes and two ISOs -- which is
    // what a burst looks like, and the case E1 exists for.
    const { nativeImage } = require('electron');
    const asJpeg = (width, height, quality) =>
      nativeImage.createFromBuffer(png(width, height, SCENES.dusk)).toJPEG(quality);
    const duskBig = write(
      'Trip/dusk-1.jpg',
      withExif(asJpeg(420, 315, 92), {
        make: 'Canon', model: 'Canon EOS R6', iso: 200, exposure: [1, 500], taken: '2024:06:14 18:42:07',
      })
    );
    const duskSmall = write(
      'Trip/dusk-2.jpg',
      withExif(asJpeg(280, 210, 82), {
        make: 'Canon', model: 'Canon EOS R6', iso: 3200, exposure: [1, 60], taken: '2024:06:14 18:42:09',
      })
    );

    const all = [beachBig, beachMid, beachSmall, ringsBig, ringsSmall, tiles, duskBig, duskSmall];
    check('the fixture is eight real pictures', all.every((p) => fs.statSync(p).size > 200), `${all.length} files`);
    check('two of them are JPEGs the encoder really produced',
      [duskBig, duskSmall].every((p) => {
        const head = fs.readFileSync(p).subarray(0, 4);
        return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff && head[3] === 0xe1;
      }),
      `${fs.statSync(duskBig).size} B, ${fs.statSync(duskSmall).size} B`);

    /* -- the window ------------------------------------------------------- */
    require('../src/main/lib/preview/serve').serve();
    const ipc = require('../src/main/ipc');
    ipc.register();
    ipc.allowUnconfirmedForHarness();

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
    win.webContents.on('console-message', (...args) => {
      const level = typeof args[1] === 'object' ? args[1].level : args[1];
      const message = typeof args[1] === 'object' ? args[1].message : args[2];
      if (level === 3 || level === 'error') errors.push(message);
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const js = (expr) => win.webContents.executeJavaScript(expr);
    await wait(600);

    await js(`document.querySelector('.tab[data-tab="media"]').click()`);
    await wait(300);
    await js(`
      for (const root of media.roots) root.on = false;
      media.extraRoots = [{ path: ${JSON.stringify(library)}, name: 'Fixture', why: null, on: true }];
      renderRoots();
      document.getElementById('media-scan').click();
    `);
    for (let i = 0; i < 80; i++) {
      if (await js(`document.getElementById('media-cancel').hidden && media.files.length > 0`)) break;
      await wait(250);
    }

    console.log('\nThe scan, before anything has been looked at:');
    check('all eight pictures are in the list', (await js('media.files.length')) === 8, String(await js('media.files.length')));
    check('the card is on screen', (await js(`document.getElementById('media-similar-card').hidden`)) === false);
    check(
      'and it says how much of the library has been looked at',
      /0|[0-9]/.test(await js(`document.getElementById('similar-scope').textContent`)),
      await js(`document.getElementById('similar-scope').textContent`)
    );

    /* -- look at everything ------------------------------------------------ */
    console.log('\nLooking at every picture:');
    const before = await js(`similar.measured`);
    await js(`document.getElementById('similar-measure').click()`);
    for (let i = 0; i < 160; i++) {
      if ((await js(`similar.measuring`)) === false && (await js(`similar.measured`)) > before) break;
      await wait(250);
    }
    await wait(400);
    check(
      'every readable picture has now been measured',
      (await js(`similar.measured`)) === 8,
      `${await js(`similar.measured`)} of ${await js(`similar.measurable`)}`
    );
    check('none of them was stored online only', (await js(`similar.dehydrated`)) === 0, String(await js(`similar.dehydrated`)));

    /* -- the grouping ----------------------------------------------------- */
    console.log('\nWhat was grouped:');
    const groups = await js(`similar.groups.map(g => ({ count: g.count, spread: g.spread, files: g.files.map(f => f.path.split(/[\\\\/]/).pop()) }))`);
    check('three groups, not one and not eight', groups.length === 3, JSON.stringify(groups.map((g) => g.files)));

    const names = groups.map((g) => g.files.slice().sort().join(','));
    check(
      'the three sizes of one photograph are one group',
      names.some((n) => n === ['beach-original.png', 'beach-sent.png', 'beach-thumb.png'].join(',')),
      names.join(' | ')
    );
    check(
      'the two sizes of the other are the second',
      names.some((n) => n === ['rings-copy.png', 'rings-original.png'].join(',')),
      names.join(' | ')
    );
    check(
      'the picture that looks like neither is in no group',
      !names.some((n) => n.includes('tiles.png')),
      names.join(' | ')
    );
    check(
      'each group says how far apart its members are',
      groups.every((g) => Number.isInteger(g.spread) && g.spread <= 4),
      groups.map((g) => g.spread).join(', ')
    );
    check(
      'the two JPEGs of one scene are the third',
      names.some((n) => n === ['dusk-1.jpg', 'dusk-2.jpg'].join(',')),
      names.join(' | ')
    );
    check(
      'the rows are on screen, one per group',
      (await js(`document.querySelectorAll('#similar-list .similar-row').length`)) === 3
    );

    /* -- the comparison panel --------------------------------------------- */
    console.log('\nThe comparison:');
    const beachIndex = await js(`similar.groups.findIndex(g => g.count === 3)`);
    await js(`document.querySelectorAll('#similar-list .similar-row')[${beachIndex}].querySelector('button').click()`);
    for (let i = 0; i < 40; i++) {
      if (await js(`document.querySelectorAll('#compare-panes .compare-img').length === 3`)) break;
      await wait(200);
    }
    await wait(300);

    check('it opened', (await js(`document.getElementById('compare').hidden`)) === false);
    check('with one pane per picture', (await js(`document.querySelectorAll('#compare-panes .cmp-pane').length`)) === 3);
    check('and every one of them drew', (await js(`document.querySelectorAll('#compare-panes .compare-img').length`)) === 3);

    // The roadmap's order: resolution, then detail, then size. Largest first.
    const order = await js(`[...document.querySelectorAll('#compare-panes .cmp-pane-name')].map(e => e.textContent)`);
    check(
      'the panes are in the suggested order, largest resolution first',
      order[0] === 'beach-original.png' && order[2] === 'beach-thumb.png',
      order.join(' → ')
    );
    check('nothing arrived ticked', (await js(`media.selected.size`)) === 0, String(await js(`media.selected.size`)));

    /* -- the table -------------------------------------------------------- */
    const rows = await js(`[...document.querySelectorAll('#compare-facts tr')].slice(1).map(tr => tr.querySelector('th').textContent)`);
    check('the table has a row per fact that differs', rows.length >= 3, rows.join(', '));
    const standout = await js(`document.querySelectorAll('#compare-facts td.is-standout').length`);
    check('the value that stands out is marked in each row', standout >= 3, String(standout));
    check(
      'one cell per row, never two',
      (await js(`[...document.querySelectorAll('#compare-facts tr')].every(tr => tr.querySelectorAll('td.is-standout').length <= 1)`)) === true
    );
    check(
      'and the note says the shading is not a recommendation',
      /not a recommendation/i.test(await js(`document.querySelector('#compare-facts .compare-note').textContent`))
    );
    check(
      'a fact no picture carries is left out rather than printed as dashes',
      !rows.includes('ISO') && !rows.includes('Camera'),
      rows.join(', ')
    );
    // A dash means "not known" everywhere in this table. The thumbnail in this
    // group is 160x120, which rounds to zero megapixels -- and the first
    // version printed a dash for it, claiming not to know something it had
    // just printed the dimensions of one row above. A screenshot caught it.
    const mp = await js(`(() => {
      for (const tr of [...document.querySelectorAll('#compare-facts tr')].slice(1)) {
        if (tr.querySelector('th').textContent !== 'Megapixels') continue;
        return [...tr.querySelectorAll('td')].map(td => td.textContent);
      }
      return [];
    })()`);
    check('a picture too small to round to 0.1 MP still says so, rather than a dash',
      mp.length === 3 && !mp.includes('—') && /under/i.test(mp[2]), JSON.stringify(mp));
    // The verdict colours are spoken for. A table that borrowed green here
    // would be telling somebody which photograph to keep.
    const shade = await js(`(() => {
      const el = document.querySelector('#compare-facts td.is-standout');
      return el ? getComputedStyle(el).backgroundColor : '';
    })()`);
    check('the shading is not a verdict colour', shade !== '' && !/^rgb\(\s*(0|1?\d{1,2}),\s*(1[5-9]\d|2\d\d)/.test(shade), shade);

    /* -- the two facts E1 had to add to the payload ------------------------ */
    // `iso` and `exposureTime` were read by `lib/media/probe.js` from the
    // start and dropped when `analyzers/media.js` built what the window sees.
    // On a burst from one camera they are often the only two facts that differ
    // at all, which is why they are here and why this checks them on a real
    // JPEG rather than trusting the payload.
    console.log('\nISO and shutter, from real EXIF:');
    const duskIndex = await js(`similar.groups.findIndex(g => g.files.every(f => /dusk/.test(f.path)))`);
    await js(`document.querySelectorAll('#similar-list .similar-row')[${duskIndex}].querySelector('button').click()`);
    for (let i = 0; i < 40; i++) {
      if ((await js(`document.querySelectorAll('#compare-panes .cmp-pane').length`)) === 2) break;
      await wait(200);
    }
    await wait(300);
    const exifRows = await js(`(() => {
      const out = {};
      for (const tr of [...document.querySelectorAll('#compare-facts tr')].slice(1)) {
        out[tr.querySelector('th').textContent] = [...tr.querySelectorAll('td')].map(td => td.textContent);
      }
      return out;
    })()`);
    check('the ISO row is there, with both values', Array.isArray(exifRows.ISO) && exifRows.ISO.length === 2, JSON.stringify(exifRows.ISO));
    check('and they are the ones written into the files', exifRows.ISO && exifRows.ISO.join(',') === '200,3,200', JSON.stringify(exifRows.ISO));
    check(
      'the shutter row reads the way a camera says it',
      exifRows.Shutter && exifRows.Shutter.every((v) => /^1\/\d+ s$/.test(v)),
      JSON.stringify(exifRows.Shutter)
    );
    check('and it is 1/500 and 1/60', exifRows.Shutter && exifRows.Shutter.join(',') === '1/500 s,1/60 s', JSON.stringify(exifRows.Shutter));
    check('the camera is named', exifRows.Camera && exifRows.Camera.every((v) => /Canon EOS R6/.test(v)), JSON.stringify(exifRows.Camera));
    // The one row where the tinted cell is the *smaller* number: less
    // amplification is less noise, and tinting the larger one would be
    // pointing at the noisier photograph.
    const isoStandout = await js(`(() => {
      for (const tr of [...document.querySelectorAll('#compare-facts tr')].slice(1)) {
        if (!/^(ISO)$/.test(tr.querySelector('th').textContent)) continue;
        const tds = [...tr.querySelectorAll('td')];
        return tds.findIndex(td => td.classList.contains('is-standout'));
      }
      return -2;
    })()`);
    check('the lower ISO is the one that stands out, not the higher', isoStandout === 0, String(isoStandout));
    check(
      'a fact both pictures share is never tinted',
      (await js(`(() => {
        for (const tr of [...document.querySelectorAll('#compare-facts tr')].slice(1)) {
          if (tr.querySelector('th').textContent !== 'Camera') continue;
          return tr.querySelectorAll('td.is-standout').length;
        }
        return -1;
      })()`)) === 0
    );
    await js(`window.PhotoCompare.close()`);
    await wait(200);

    // Back to the three-copy group for the zoom and keyboard checks below.
    await js(`document.querySelectorAll('#similar-list .similar-row')[${beachIndex}].querySelector('button').click()`);
    for (let i = 0; i < 40; i++) {
      if ((await js(`document.querySelectorAll('#compare-panes .compare-img').length`)) === 3) break;
      await wait(200);
    }
    await wait(300);

    /* -- zoom and pan move together --------------------------------------- */
    console.log('\nZoom, pan and flicker:');
    const transforms = () => js(`[...document.querySelectorAll('#compare-panes .compare-img')].map(i => i.style.transform)`);
    const atRest = await transforms();
    check('they open at fit, with no transform of their own', atRest.every((t) => t === atRest[0]), atRest[0] || '(none)');

    await js(`document.getElementById('compare-panes').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`);
    await wait(200);
    const zoomed = await transforms();
    check('a scroll zooms', /scale\((?!1\))/.test(zoomed[0] || ''), zoomed[0] || '(none)');
    check('and every pane zoomed by the same amount', new Set(zoomed).size === 1, zoomed.join(' | '));

    await js(`document.getElementById('compare-reset').click()`);
    await wait(150);
    check('Fit puts them back', (await transforms()).every((t) => /scale\(1\)/.test(t)), (await transforms())[0]);

    /* -- flicker ---------------------------------------------------------- */
    await js(`document.getElementById('compare-flicker').click()`);
    await wait(150);
    check('flicking shows one picture at a time', (await js(`document.querySelectorAll('#compare-panes .cmp-pane:not(.is-hidden-frame)').length`)) === 1);
    const first = await js(`document.querySelector('#compare-panes .cmp-pane:not(.is-hidden-frame) .cmp-pane-name').textContent`);
    await wait(900);
    const second = await js(`document.querySelector('#compare-panes .cmp-pane:not(.is-hidden-frame) .cmp-pane-name').textContent`);
    check('and it alternates between the first two', first !== second, `${first} → ${second}`);
    await js(`document.getElementById('compare-flicker').click()`);
    await wait(200);
    check('turning it off shows them all again', (await js(`document.querySelectorAll('#compare-panes .cmp-pane:not(.is-hidden-frame)').length`)) === 3);

    /* -- the keys --------------------------------------------------------- */
    console.log('\nThe keyboard:');
    const press = (key) => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
    await press('2');
    await wait(150);
    check('2 ticks the second picture', (await js(`media.selected.size`)) === 1, String(await js(`media.selected.size`)));
    check(
      'and it is the second one, in the grid’s own selection',
      (await js(`[...media.selected][0].endsWith('beach-sent.png')`)) === true,
      await js(`[...media.selected][0]`)
    );
    check('the tick box shows it', (await js(`document.getElementById('compare-tick-1').checked`)) === true);
    await press('2');
    await wait(150);
    check('pressing it again unticks', (await js(`media.selected.size`)) === 0);

    await press('4');
    await wait(150);
    check('a number with no pane behind it does nothing', (await js(`media.selected.size`)) === 0);

    // ← and → walk the groups this was opened from.
    await press('ArrowRight');
    for (let i = 0; i < 40; i++) {
      if ((await js(`document.querySelectorAll('#compare-panes .cmp-pane').length`)) === 2) break;
      await wait(200);
    }
    check('the right arrow moves to the next group', (await js(`document.querySelectorAll('#compare-panes .cmp-pane').length`)) === 2);
    check(
      'and it is the other photograph',
      (await js(`[...document.querySelectorAll('#compare-panes .cmp-pane-name')].every(e => e.textContent.startsWith('rings'))`)) === true,
      await js(`[...document.querySelectorAll('#compare-panes .cmp-pane-name')].map(e => e.textContent).join(', ')`)
    );

    await press('Escape');
    await wait(250);
    check('Escape closes it', (await js(`document.getElementById('compare').hidden`)) === true);
    check('and the grid keeps whatever was ticked', (await js(`media.selected.size`)) === 0);

    /* -- two the user ticked themselves ----------------------------------- */
    console.log('\nOpened from a free selection, not a group:');
    await js(`window.PhotoCompare.open([media.files[0], media.files[1]], {})`);
    for (let i = 0; i < 40; i++) {
      if ((await js(`document.getElementById('compare').hidden`)) === false) break;
      await wait(150);
    }
    await wait(300);
    check('two panes', (await js(`document.querySelectorAll('#compare-panes .cmp-pane').length`)) === 2);
    check('the group arrows are not offered', (await js(`document.getElementById('compare-next').hidden`)) === true);
    check(
      'and it says where these came from',
      (await js(`document.getElementById('compare-where').textContent.length`)) > 0,
      await js(`document.getElementById('compare-where').textContent`)
    );
    await js(`window.PhotoCompare.close()`);
    await wait(200);

    /* -- one picture is not a comparison ---------------------------------- */
    await js(`window.PhotoCompare.open([media.files[0]], {})`);
    await wait(300);
    check('one picture is refused', (await js(`document.getElementById('compare').hidden`)) === true);

    /* -- Vietnamese -------------------------------------------------------- */
    console.log('\nIn Vietnamese:');
    await js(`document.querySelector('.tab[data-tab="settings"]').click()`);
    await wait(300);
    await js(`document.querySelector('[data-language-choice="vi"]').click()`);
    await wait(700);
    await js(`document.querySelector('.tab[data-tab="media"]').click()`);
    await wait(400);
    const viTitle = await js(`document.querySelector('#media-similar-card h2').textContent`);
    check('the card heading is translated', /Ảnh/.test(viTitle), viTitle);
    // The heading is in the markup, so `translateDom` gets it for free; every
    // other line in this card is built from a result and has to be built
    // again. Checking only the heading passed while the five lines under it
    // were still English -- which is exactly what the screenshot showed.
    const viBody = await js(`(() => {
      const card = document.getElementById('media-similar-card');
      return [
        card.querySelector('#similar-total').textContent,
        card.querySelector('#similar-scope').textContent,
        card.querySelector('.similar-facts strong').textContent,
        // .similar-facts span, not .similar-row span: the thumbnail cells are
        // spans too and come first, so the looser selector picked an empty one
        // and this check passed for the wrong reason. (No backticks in here --
        // this whole block is inside a template literal, and a pair of them in
        // a comment ends the string. It did, and the harness hung on load.)
        card.querySelector('.similar-facts span').textContent,
        card.querySelector('.similar-row button').textContent,
      ];
    })()`);
    check(
      'and so is everything the card builds for itself',
      viBody.every((line) => line.length > 0 && !/\b(groups|photos|Looked at|the same picture|Compare)\b/.test(line)),
      viBody.join(' | ')
    );
    await js(`document.querySelectorAll('#similar-list .similar-row')[0].querySelector('button').click()`);
    for (let i = 0; i < 40; i++) {
      if ((await js(`document.getElementById('compare').hidden`)) === false) break;
      await wait(150);
    }
    await wait(400);
    const viRows = await js(`[...document.querySelectorAll('#compare-facts tr')].slice(1).map(tr => tr.querySelector('th').textContent)`);
    check('so is the table', viRows.some((r) => /Dung lượng|Kích thước/.test(r)), viRows.join(', '));
    check(
      'and the hint',
      /phóng to|tick/i.test(await js(`document.getElementById('compare-hint').textContent`)),
      await js(`document.getElementById('compare-hint').textContent`)
    );
    await js(`window.PhotoCompare.close()`);
    await wait(200);

    /* -- nothing of the person's was touched ------------------------------- */
    console.log('\nConsole and isolation:');
    check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    const realAfter = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;
    check('the real settings file was not written', realAfter === realBefore, String(realAfter));

    win.destroy();
  } finally {
    for (const undo of cleanups) {
      try {
        undo();
      } catch {
        // best effort
      }
    }
    removeAfterExit(SANDBOX);
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error(err);
  removeAfterExit(SANDBOX);
  app.exit(1);
});
