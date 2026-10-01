#!/usr/bin/env node
'use strict';

/**
 * Where pictures were taken, and the line in front of it (E4).
 *
 *   node scripts/test-media-map.js
 *
 * ## What this is really for
 *
 * `lib/media/exif.js` and `lib/media/bmff.js` used to refuse to read a
 * position at all. The comment in each said why, and it was not theoretical:
 * an early run of the video parser printed the author's own home coordinates
 * to six decimal places. The user reversed that on 2026-10-01 so the map could
 * exist, and the guarantee that replaced it is narrower and has to be checked
 * rather than promised:
 *
 *   1. a coordinate crosses to a window only with the map switched on;
 *   2. nothing that writes a file is given one.
 *
 * Most of what follows is those two sentences, made failable. The rest is the
 * tile fetcher, driven against a fake so the suite never needs a network --
 * which matters twice over, because the tile server rate-limits repeat runs
 * and a test that depends on it would fail for reasons that are not about this
 * code.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const exif = require('../src/main/lib/media/exif');
const bmff = require('../src/main/lib/media/bmff');
const format = require('../src/main/lib/media/format');
const { toCandidate } = require('../src/main/analyzers/media');
const { jpegWithExif } = require('./lib/exif-fixture');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const readJpeg = (buf) => exif.fromJpeg(buf, format.jpegSegments(buf));

/* -------------------------------------------------------------------------- */

async function main() {
  console.log('\nmap: reading a position out of a picture\n');

  {
    const buf = jpegWithExif({
      width: 4032,
      height: 3024,
      padTo: 64 * 1024,
      make: 'Apple',
      model: 'iPhone 13',
      takenAt: new Date(2026, 8, 17, 10, 30, 0),
      lat: 21.0285,
      lon: 105.8542,
    });
    const tags = readJpeg(buf);
    check('a position is read at all', tags && tags.hasGps === true);
    check(
      'and it is the whole position, not the degrees alone',
      tags && Math.abs(tags.latitude - 21.0285) < 1e-6 && Math.abs(tags.longitude - 105.8542) < 1e-6,
      tags ? `${tags.latitude}, ${tags.longitude}` : 'none'
    );
    // A latitude is three rationals. A reader that takes the first one gets 21
    // instead of 21.0285 -- which is 3 km out and still looks plausible.
    check('the minutes and seconds are part of it', tags && tags.latitude !== 21 && tags.longitude !== 105);
    check('the rest of the picture still reads', tags && tags.camera === 'Apple iPhone 13' && tags.takenAt > 0);
  }

  {
    const south = readJpeg(jpegWithExif({ padTo: 4096, lat: -33.8688, lon: -70.6693 }));
    check(
      'south and west are negative, not merely unsigned',
      south && south.latitude < 0 && south.longitude < 0,
      south ? `${south.latitude}, ${south.longitude}` : 'none'
    );
    check(
      'and they are still the right numbers',
      south && Math.abs(south.latitude + 33.8688) < 1e-6 && Math.abs(south.longitude + 70.6693) < 1e-6
    );
  }

  {
    const none = readJpeg(jpegWithExif({ padTo: 4096, takenAt: new Date(2024, 1, 2) }));
    check('a picture with no position reports none', none && none.hasGps === false);
    check('and offers no coordinates rather than zeroes', none && none.latitude === null && none.longitude === null);
  }

  {
    check('a video position parses', JSON.stringify(bmff.parseIso6709('+21.0285+105.8542/')) ===
      JSON.stringify({ latitude: 21.0285, longitude: 105.8542 }));
    check('a video with no fix has no position', bmff.parseIso6709('+00.0000+000.0000/') === null);
  }

  /* ---- the gate ---------------------------------------------------------- */

  console.log('\nmap: the gate in front of every coordinate\n');

  const record = {
    path: 'D:\\Pictures\\IMG_0001.jpg',
    name: 'IMG_0001.jpg',
    ext: 'jpg',
    kind: 'image',
    size: 4 * 1024 * 1024,
    mtimeMs: Date.UTC(2026, 8, 17),
    takenAt: Date.UTC(2026, 8, 17),
    width: 4032,
    height: 3024,
    hasGps: true,
    latitude: 21.0285,
    longitude: 105.8542,
  };

  {
    const off = toCandidate(record, { displays: [] });
    const text = JSON.stringify(off);
    check('with the map off, no coordinate is in the payload',
      off.meta.lat === undefined && off.meta.lon === undefined);
    check('not as null, not as zero -- the keys are not there',
      !Object.prototype.hasOwnProperty.call(off.meta, 'lat') &&
      !Object.prototype.hasOwnProperty.call(off.meta, 'lon'));
    // The strongest form of the check: the number itself appears nowhere in
    // what would cross the boundary, whatever it might be called.
    check('and the number appears nowhere in the whole candidate',
      !text.includes('21.0285') && !text.includes('105.8542'));
    check('but that a position exists still crosses, as it always has', off.meta.hasGps === true);
  }

  {
    const on = toCandidate(record, { displays: [], coordinates: true });
    check('with the map on, the coordinate crosses', on.meta.lat === 21.0285 && on.meta.lon === 105.8542);
    check('and still says a position exists', on.meta.hasGps === true);
  }

  {
    // A picture with no position must not gain one from the switch.
    const bare = toCandidate({ ...record, hasGps: false, latitude: undefined, longitude: undefined },
      { displays: [], coordinates: true });
    check('turning the map on invents nothing',
      bare.meta.lat === undefined && bare.meta.hasGps === false);
  }

  {
    // Anything other than exactly `true` is off. A settings file edited by hand
    // is untrusted input, and `'false'` is a truthy string.
    for (const value of ['true', 1, {}, 'yes']) {
      const out = toCandidate(record, { displays: [], coordinates: value });
      if (out.meta.lat !== undefined) {
        check(`a coordinates flag of ${JSON.stringify(value)} does not open the gate`, false);
        break;
      }
    }
    check('only exactly true opens the gate', true);
  }

  /* ---- nothing that writes a file is given one --------------------------- */

  console.log('\nmap: what is allowed to write a position to disk\n');

  {
    // The specific fear the old comment named: "one export away from being a
    // location history". Read as source rather than exercised, the same way
    // `test-entitlements.js` proves its modules never load the licence.
    //
    // `lib/media/mp4` joined this list with E3, and it is the sharpest case in
    // it. That code writes a *video* file, and the format it writes has a box
    // for a position -- so "keep the metadata" and this rule point in opposite
    // directions, and the rule wins. The copy carries the capture date and the
    // rotation and deliberately not the place.
    //
    // The whole of `journal` with H4, not just `journal.js`: the seal is a line
    // the journal writes, and the key is a file of its own.
    //
    // And the command line with H1: what `--json` prints is a file the moment
    // anybody redirects it, so it is held to the same rule.
    const roots = ['report', 'snapshots', 'journal', path.join('lib', 'media', 'mp4'), 'cli'];
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    for (const name of roots) {
      const dir = path.join(__dirname, '..', 'src', 'main', name);
      if (fs.existsSync(dir)) walk(dir);
    }
    const named = files.map((f) => path.basename(f));
    check('the journal, its seal and its key are among what is read',
      ['journal.js', 'seal.js', 'seal-key.js'].every((name) => named.includes(name)), named.filter((n) => /journal|seal/.test(n)).join(', '));
    check('and so is the command line', files.some((file) => /[\\/]cli[\\/]output\.js$/.test(file)) && files.some((file) => /[\\/]cli[\\/]commands[\\/]scan\.js$/.test(file)));

    const guilty = files.filter((file) => {
      const src = fs.readFileSync(file, 'utf8');
      return /\b(latitude|longitude|\.lat\b|\.lon\b)/.test(src);
    });
    check('nothing that writes a file mentions a coordinate',
      guilty.length === 0,
      guilty.map((f) => path.basename(f)).join(', ') || `${files.length} files read`);
  }

  /* ---- tiles -------------------------------------------------------------- */

  console.log('\nmap: tiles, without a network\n');

  const tiles = require('../src/main/map/tiles');
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-tiles-'));
  process.on('exit', () => {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      /* a temp directory left behind is not a failure */
    }
  });
  tiles.configure({ cacheDir, userAgent: 'CleanDrive test' });

  check('the world tile is a tile', tiles.valid(0, 0, 0));
  check('a tile past the edge of the world is not', !tiles.valid(2, 4, 0));
  check('nor is one below it', !tiles.valid(2, 0, -1));
  check('nor one past the zoom this app will draw', !tiles.valid(tiles.MAX_ZOOM + 1, 0, 0));

  // A real one-pixel PNG, so the magic-number check is being satisfied
  // honestly rather than waved through.
  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000a49444154789c6300010000050001' + '0d0a2db40000000049454e44ae426082',
    'hex'
  );

  {
    let calls = 0;
    const fake = async () => {
      calls += 1;
      return { ok: true, status: 200, arrayBuffer: async () => PNG };
    };
    const first = await tiles.fetchTile(3, 6, 3, { deps: { fetch: fake } });
    check('a tile is fetched and comes back as a data URI',
      first.ok && first.dataUri.startsWith('data:image/png;base64,'), first.ok ? 'ok' : first.code);
    check('and it was not already cached', first.cached === false);

    const second = await tiles.fetchTile(3, 6, 3, { deps: { fetch: fake } });
    check('the second time it comes off the disk', second.ok && second.cached === true);
    check('and the network was asked exactly once', calls === 1, `${calls} call(s)`);
  }

  {
    const notPng = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('<html>login</html>') });
    const out = await tiles.fetchTile(4, 1, 1, { deps: { fetch: notPng } });
    // A captive portal answers 200 with a login page, and a map made of login
    // pages is worse than a map with holes in it.
    check('a 200 that is not a PNG is refused', out.ok === false && out.code === 'ENOTPNG');
  }

  {
    const refused = async () => ({ ok: false, status: 429, arrayBuffer: async () => Buffer.alloc(0) });
    const out = await tiles.fetchTile(4, 2, 1, { deps: { fetch: refused } });
    check('a refusal carries its status, so the screen can say which', out.ok === false && out.code === 'EHTTP429');
  }

  {
    const dead = async () => {
      throw Object.assign(new Error('nope'), { name: 'TypeError' });
    };
    const out = await tiles.fetchTile(4, 3, 1, { deps: { fetch: dead } });
    check('no network reads as no network', out.ok === false && out.code === 'ENETWORK');
  }

  {
    const out = await tiles.fetchTile(99, 0, 0, { deps: { fetch: async () => { throw new Error('should not be called'); } } });
    check('a tile that cannot exist is refused before anything is fetched', out.ok === false && out.code === 'ERANGE');
  }

  {
    const fake = async () => ({ ok: true, status: 200, arrayBuffer: async () => PNG });
    const many = await tiles.fetchTiles(
      [{ z: 5, x: 1, y: 1 }, { z: 5, x: 2, y: 1 }, { z: 5, x: 3, y: 1 }],
      { deps: { fetch: fake } }
    );
    check('a screenful comes back in one answer', many.tiles.length === 3 && many.tiles.every((t) => t.ok));
    check('with the attribution the licence requires', many.attribution === tiles.ATTRIBUTION);
    check('and the attribution names OpenStreetMap', /OpenStreetMap/.test(many.attribution), many.attribution);
  }

  {
    const held = await tiles.cacheSize();
    check('the cache knows what it is holding', held.count > 0 && held.bytes > 0, `${held.count} tiles, ${held.bytes} B`);
    const gone = await tiles.clearCache();
    const after = await tiles.cacheSize();
    check('clearing it says how much it freed', gone.count === held.count && gone.bytes === held.bytes);
    check('and afterwards there is nothing', after.count === 0 && after.bytes === 0);
  }

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILURE(S)\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
