'use strict';

/**
 * Map tiles, for the map half of E4.
 *
 * ## This is the second thing in the app that touches the network
 *
 * The first is the update check, and until now the app told the user, in both
 * languages, that it was the only one. That sentence has been changed rather
 * than quietly left wrong.
 *
 * The user decided on 2026-10-01 that an online map was acceptable, on the
 * grounds that nearly every machine has a network. What that reasoning does
 * not cover, and what the card in front of this says out loud, is that a tile
 * request is *about* the pictures: tiles are fetched for the area the
 * photographs are in, so the tile server learns roughly where they were taken.
 * That is why the whole feature is behind a switch that ships off.
 *
 * ## The renderer still never touches the network
 *
 * `index.html` runs under `default-src 'none'`, and that is not loosened by a
 * word. The window asks this module for a list of tiles over IPC and gets PNG
 * bytes back as `data:` URIs, which `img-src` already allows because that is
 * how thumbnails have always arrived. The same arrangement §11 settled on for
 * payments in phase 6: requests go through the main process or not at all.
 *
 * ## Which tile server, and why that one
 *
 * Measured from this machine, 11 of 12 candidates were reachable -- and the
 * one that was not is `tile.openstreetmap.org` itself, reset in 155 ms while
 * `a.tile.openstreetmap.org` answered in 190 ms. So the bare hostname is
 * blocked here and the subdomain form is not.
 *
 * Of the reachable ones, OpenStreetMap is the only one whose terms fit a
 * product that is sold: Carto's free basemaps are non-commercial, Wikimedia's
 * are for Wikimedia projects, and Esri's want an ArcGIS account. OSM asks for
 * an identifying User-Agent, visible attribution and modest volume, and all
 * three are met here -- a tile is fetched once and then comes from the disk.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { app, net } = require('electron');

/**
 * `a`, `b` and `c` are the same tiles; spreading across them is what OSM's
 * usage policy asks for, and the bare `tile.openstreetmap.org` form is
 * unreachable from this machine anyway.
 */
const HOSTS = ['a', 'b', 'c'];

/** Shown on the map, because OSM's terms require it and because it is true. */
const ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * Beyond this the map is showing a street, which is far past what a few dozen
 * photographs justify and far past what this app has any business drawing.
 */
const MAX_ZOOM = 12;

/** A tile is about 5 KB; this is a bound on a single malformed answer. */
const MAX_TILE_BYTES = 512 * 1024;

const TIMEOUT_MS = 15000;

let cacheDir = null;
let userAgent = null;

/** Called once, after `app.whenReady`. */
function configure(options = {}) {
  cacheDir = options.cacheDir || path.join(app.getPath('userData'), 'map-tiles');
  userAgent =
    options.userAgent ||
    `CleanDrive/${app.getVersion()} (+https://github.com/dungdt58/cleandrive) map view`;
}

const keyOf = (z, x, y) => `${z}-${x}-${y}`;
const fileFor = (z, x, y) => path.join(cacheDir, `${keyOf(z, x, y)}.png`);

/** Whether a tile's coordinates are ones that exist at all. */
function valid(z, x, y) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > MAX_ZOOM) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

/**
 * One tile, from the disk if it is there and from the network if it is not.
 *
 * @returns {Promise<{ok: true, dataUri: string, cached: boolean}|{ok: false, code: string}>}
 */
async function fetchTile(z, x, y, { deps = {} } = {}) {
  if (!valid(z, x, y)) return { ok: false, code: 'ERANGE' };
  const file = fileFor(z, x, y);

  try {
    const cached = await fsp.readFile(file);
    if (cached.length > 0) return { ok: true, dataUri: asDataUri(cached), cached: true };
  } catch {
    // Not cached yet, which is the ordinary case the first time.
  }

  const get = deps.fetch || net.fetch;
  const host = HOSTS[Math.abs(hash(keyOf(z, x, y))) % HOSTS.length];
  const url = `https://${host}.tile.openstreetmap.org/${z}/${x}/${y}.png`;

  let body;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await get(url, { headers: { 'User-Agent': userAgent }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return { ok: false, code: `EHTTP${response.status}` };
    body = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    // The one that matters to the window: no network, a blocked host, or a
    // server that said nothing. All of them mean "no map right now", and the
    // screen says which rather than drawing an empty grid.
    return { ok: false, code: err.name === 'AbortError' ? 'ETIMEOUT' : 'ENETWORK' };
  }

  if (body.length === 0 || body.length > MAX_TILE_BYTES) return { ok: false, code: 'EBODY' };
  // A tile server behind a captive portal answers 200 with an HTML page.
  if (!(body[0] === 0x89 && body.toString('latin1', 1, 4) === 'PNG')) return { ok: false, code: 'ENOTPNG' };

  try {
    await fsp.mkdir(cacheDir, { recursive: true });
    // Written beside and renamed, so a half-written tile is never read back as
    // a whole one -- the same shape `lib/atomic.js` uses for settings.
    const scratch = `${file}.${crypto.randomBytes(4).toString('hex')}.part`;
    await fsp.writeFile(scratch, body);
    await fsp.rename(scratch, file);
  } catch {
    // A tile that cannot be cached is a slower map, not a broken one.
  }

  return { ok: true, dataUri: asDataUri(body), cached: false };
}

/**
 * A screenful of tiles.
 *
 * Fetched a few at a time: OSM asks for modest, serial-ish use, and measured
 * from here nine tiles took 6.3 s one after another. Four at a time is the
 * compromise, and after the first view they come off the disk anyway.
 */
async function fetchTiles(list, { deps = {} } = {}) {
  const wanted = (Array.isArray(list) ? list : []).slice(0, 64);
  const out = [];
  const CONCURRENCY = 4;

  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    const batch = wanted.slice(i, i + CONCURRENCY);
    const done = await Promise.all(
      batch.map(async (t) => {
        const got = await fetchTile(t.z, t.x, t.y, { deps });
        return { z: t.z, x: t.x, y: t.y, ...got };
      })
    );
    out.push(...done);
  }
  return { tiles: out, attribution: ATTRIBUTION };
}

/** Everything this has ever cached, in bytes -- for the card that offers to clear it. */
async function cacheSize() {
  try {
    const names = await fsp.readdir(cacheDir);
    let bytes = 0;
    let count = 0;
    for (const name of names) {
      if (!name.endsWith('.png')) continue;
      const st = await fsp.stat(path.join(cacheDir, name)).catch(() => null);
      if (st) {
        bytes += st.size;
        count += 1;
      }
    }
    return { count, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** Forget every cached tile. Nothing else in the app is touched. */
async function clearCache() {
  const before = await cacheSize();
  await fsp.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  return before;
}

const asDataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

module.exports = {
  configure,
  fetchTile,
  fetchTiles,
  cacheSize,
  clearCache,
  valid,
  ATTRIBUTION,
  MAX_ZOOM,
  HOSTS,
};
