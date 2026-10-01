'use strict';

/**
 * Where the pictures were taken (E4), on the Photos screen.
 *
 * ## Three things this card refuses to do
 *
 * **It does not appear when there is nothing to put in it.** A library with no
 * positioned pictures gets no card, no empty state and no explanation of a
 * feature it cannot use -- the same rule E5's conversation card follows, and
 * for the same reason.
 *
 * **It does not fetch anything until somebody says so.** With the map switched
 * off, which is how the app ships, the card says what is there and what
 * turning it on would do, and nothing leaves the machine. Turning it on is the
 * consent, and the sentence above the button is what is being consented to.
 *
 * **It does not pretend the request is private.** Tiles are fetched for the
 * area the photographs are in, so the tile server learns roughly where they
 * were taken. That is said in the card rather than in a document nobody opens.
 *
 * ## No map library
 *
 * A slippy map is a grid of 256-pixel images and two formulas, and this app
 * does not add dependencies. `project` and `unproject` below are Web Mercator,
 * the same projection every tile server uses; everything else is arithmetic on
 * the result. The window never fetches a tile itself -- it cannot, under
 * `default-src 'none'` -- so it asks the main process and gets PNG bytes back
 * as `data:` URIs.
 */
(() => {
  const TILE = 256;
  /** Past this the map is drawing streets, which a few dozen pictures do not justify. */
  const MAX_ZOOM = 12;
  const MIN_ZOOM = 1;
  /** Pins closer together than this on screen become one. */
  const CLUSTER_PX = 30;

  const state = {
    /** null until the card has asked; true or false after. */
    enabled: null,
    zoom: 3,
    /** Centre, in world pixels at `zoom`. */
    centre: null,
    points: [],
    tiles: new Map(),
    /** key -> how many times fetching it has failed. */
    failed: new Map(),
    attribution: '',
    problem: null,
    lastCode: null,
    busy: false,
  };

  /** A tile that fails twice is a tile this view is not going to get. */
  const MAX_TRIES = 2;

  /* --------------------------------------------------------------- the maths */

  /** A position to world pixels at a zoom. Web Mercator, as every tile uses. */
  function project(lat, lon, zoom) {
    const n = 2 ** zoom * TILE;
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const s = Math.sin((clamped * Math.PI) / 180);
    return {
      x: ((lon + 180) / 360) * n,
      y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
    };
  }

  /** The zoom at which every point fits inside a box of this size, with room to spare. */
  function zoomToFit(points, width, height) {
    if (points.length === 0) return 2;
    if (points.length === 1) return 9;
    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        const at = project(p.lat, p.lon, z);
        minX = Math.min(minX, at.x);
        maxX = Math.max(maxX, at.x);
        minY = Math.min(minY, at.y);
        maxY = Math.max(maxY, at.y);
      }
      // 48px of margin so pins near the edge are not half off it.
      if (maxX - minX <= width - 48 && maxY - minY <= height - 48) return z;
    }
    return MIN_ZOOM;
  }

  function centreOf(points, zoom) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const at = project(p.lat, p.lon, zoom);
      minX = Math.min(minX, at.x);
      maxX = Math.max(maxX, at.x);
      minY = Math.min(minY, at.y);
      maxY = Math.max(maxY, at.y);
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  /** Pins that land on top of each other become one, with a count on it. */
  function cluster(placed) {
    const out = [];
    for (const pin of placed) {
      const near = out.find((c) => Math.hypot(c.x - pin.x, c.y - pin.y) < CLUSTER_PX);
      if (near) {
        near.files.push(pin.file);
        // The cluster sits at the mean of what it holds, so it moves towards
        // the weight rather than staying on whichever pin happened to be first.
        near.x = (near.x * (near.files.length - 1) + pin.x) / near.files.length;
        near.y = (near.y * (near.files.length - 1) + pin.y) / near.files.length;
      } else {
        out.push({ x: pin.x, y: pin.y, files: [pin.file] });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ drawing */

  const el = (id) => document.getElementById(id);

  /** Everything in the library that recorded where it was. */
  function positioned() {
    return (window.mediaFiles ? window.mediaFiles() : []).filter(
      (f) => Number.isFinite(f.lat) && Number.isFinite(f.lon)
    );
  }

  /** How many recorded a position but did not send one, because the map is off. */
  function withGpsCount() {
    return (window.mediaFiles ? window.mediaFiles() : []).filter((f) => f.hasGps).length;
  }

  function draw() {
    const card = el('ov-map-card');
    if (!card) return;

    const located = withGpsCount();
    // Nothing positioned anywhere: no card at all, not an empty one.
    if (located === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    el('ov-map-count').textContent = t('media.map.count', '{n} of these recorded where they were taken', {
      n: formatCount(located),
    });

    const off = state.enabled !== true;
    el('ov-map-consent').hidden = !off;
    el('ov-map-body').hidden = off;
    if (off) {
      el('ov-map-why').textContent = t(
        'media.map.why',
        'Showing them on a map means two things. The position stored inside each picture is read, which nothing in this app does otherwise. And map tiles are fetched for the area they are in — so whoever serves those tiles learns roughly where your pictures were taken. Tiles come from OpenStreetMap, through this app rather than from the page, and each one is kept on this computer after the first time.'
      );
      el('ov-map-turn-on').textContent = t('media.map.turnOn', 'Show the map');
      return;
    }

    drawMap();
  }

  function drawMap() {
    const host = el('ov-map');
    const width = host.clientWidth || 640;
    const height = host.clientHeight || 260;

    state.points = positioned().map((f) => ({ lat: f.lat, lon: f.lon, file: f }));
    if (state.points.length === 0) {
      // The only way to be here: pictures record positions, but the scan that
      // found them ran while the map was off, so `analyzers/media.js` left the
      // coordinates out. Saying that beats an empty map that looks broken.
      el('ov-map-note').textContent = t(
        'media.map.rescan',
        'Scan again to read the positions — the last scan left them out because the map was off.'
      );
      host.replaceChildren();
      return;
    }

    if (!state.centre) {
      state.zoom = zoomToFit(state.points, width, height);
      state.centre = centreOf(state.points, state.zoom);
    }

    const left = state.centre.x - width / 2;
    const top = state.centre.y - height / 2;
    const n = 2 ** state.zoom;

    /* -- which tiles cover the viewport -- */
    const wanted = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        // The world does not wrap vertically; horizontally it does, and asking
        // for a tile off the left edge is asking for one that does not exist.
        if (ty < 0 || ty >= n) continue;
        const wrapped = ((tx % n) + n) % n;
        wanted.push({ z: state.zoom, x: wrapped, y: ty, screenX: tx * TILE - left, screenY: ty * TILE - top });
      }
    }

    /* -- draw what we have, ask for what we do not -- */
    const layer = document.createElement('div');
    layer.className = 'map-tiles';
    for (const tile of wanted) {
      const key = `${tile.z}/${tile.x}/${tile.y}`;
      const img = document.createElement('img');
      img.className = 'map-tile';
      img.alt = '';
      img.style.left = `${tile.screenX}px`;
      img.style.top = `${tile.screenY}px`;
      const have = state.tiles.get(key);
      if (have) img.src = have;
      layer.appendChild(img);
    }

    const pins = document.createElement('div');
    pins.className = 'map-pins';
    const placed = state.points.map((p) => {
      const at = project(p.lat, p.lon, state.zoom);
      return { x: at.x - left, y: at.y - top, file: p.file };
    });

    for (const group of cluster(placed)) {
      if (group.x < -20 || group.y < -20 || group.x > width + 20 || group.y > height + 20) continue;
      const pin = document.createElement('button');
      pin.className = 'map-pin';
      pin.style.left = `${group.x}px`;
      pin.style.top = `${group.y}px`;
      pin.textContent = group.files.length > 1 ? formatCount(group.files.length) : '';
      const label =
        group.files.length > 1
          ? t('media.map.pinMany', '{n} pictures taken here', { n: formatCount(group.files.length) })
          : t('media.map.pinOne', 'Taken here: {name}', { name: group.files[0].name });
      pin.title = label;
      pin.setAttribute('aria-label', label);
      pin.addEventListener('click', () => {
        if (typeof window.mediaPickPlace === 'function') {
          window.mediaPickPlace(group.files.map((f) => f.path), group.files.length);
        }
      });
      pins.appendChild(pin);
    }

    // The tile licence requires this, verbatim, and the same in every language
    // -- which is why it is a dictionary entry whose Vietnamese is identical
    // rather than a bare string the harness would rightly object to.
    const credit = document.createElement('span');
    credit.className = 'map-credit';
    credit.textContent = state.attribution || t('media.map.credit', '© OpenStreetMap contributors');

    host.replaceChildren(layer, pins, credit);

    el('ov-map-note').textContent = state.problem
      ? problemText(state.problem)
      : t('media.map.shown', '{n} on the map', { n: formatCount(state.points.length) });

    requestTiles(wanted);
  }

  function problemText(code) {
    if (code === 'ENETWORK') {
      return t('media.map.noNetwork', 'The map tiles could not be fetched — there may be no connection, or this network may be blocking them. The positions are still correct; only the background is missing.');
    }
    if (code === 'ETIMEOUT') {
      return t('media.map.slow', 'The tile server did not answer in time. The positions are still correct; only the background is missing.');
    }
    if (code === 'off') {
      return t('media.map.refused', 'The map is switched off.');
    }
    return t('media.map.problem', 'The map tiles could not be fetched ({code}). The positions are still correct; only the background is missing.', { code });
  }

  /**
   * Ask the main process for whatever is not already in hand.
   *
   * ## Two things the first version got wrong, both visible in a screenshot
   *
   * It redrew from inside its own `try`, so `busy` was still set when the
   * redraw asked again -- which meant a tile that failed was never asked for a
   * second time. Two of eight stayed blank for good.
   *
   * And a batch where some tiles arrived cleared the problem for the ones that
   * did not, so those blanks had nothing to explain them. Now a tile that
   * fails is counted, retried once, and then said out loud; the map draws the
   * pins either way, because where the pictures were is not in doubt just
   * because the background is.
   */
  async function requestTiles(wanted) {
    const missing = wanted.filter((tile) => {
      const key = `${tile.z}/${tile.x}/${tile.y}`;
      return !state.tiles.has(key) && (state.failed.get(key) || 0) < MAX_TRIES;
    });
    if (missing.length === 0 || state.busy) {
      // Nothing more will arrive for this view: if anything is still missing,
      // that is now the answer rather than a wait.
      if (!state.busy) reportMissing(wanted);
      return;
    }

    state.busy = true;
    let arrived = false;
    try {
      const out = unwrap(
        await api.mapTiles(missing.map((tile) => ({ z: tile.z, x: tile.x, y: tile.y }))),
        t('media.map.title', 'Where they were taken')
      );
      if (out) {
        state.attribution = out.attribution || state.attribution;
        if (out.refused) state.problem = out.refused;
        for (const tile of out.tiles || []) {
          const key = `${tile.z}/${tile.x}/${tile.y}`;
          if (tile.ok && tile.dataUri) {
            state.tiles.set(key, tile.dataUri);
            state.failed.delete(key);
            arrived = true;
          } else {
            state.failed.set(key, (state.failed.get(key) || 0) + 1);
            state.lastCode = tile.code || 'ENETWORK';
          }
        }
      }
    } finally {
      // Before the redraw, not after: the redraw asks again for whatever is
      // still missing, and with this still set it would ask for nothing.
      state.busy = false;
    }

    if (arrived) drawMap();
    else reportMissing(wanted);
  }

  /** Say how much of the background is missing, once nothing more is coming. */
  function reportMissing(wanted) {
    const absent = wanted.filter((tile) => !state.tiles.has(`${tile.z}/${tile.x}/${tile.y}`));
    if (absent.length === 0) {
      state.problem = null;
      el('ov-map-note').textContent = t('media.map.shown', '{n} on the map', {
        n: formatCount(state.points.length),
      });
      return;
    }
    state.problem = state.problem || state.lastCode || 'ENETWORK';
    el('ov-map-note').textContent = problemText(state.problem);
  }

  /* ------------------------------------------------------------------ wiring */

  function zoomBy(delta) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom + delta));
    if (next === state.zoom) return;
    // Keep the centre of the view where it is: the world doubles in size with
    // each zoom level, so the centre's world coordinates double with it.
    const scale = 2 ** (next - state.zoom);
    state.centre = { x: state.centre.x * scale, y: state.centre.y * scale };
    state.zoom = next;
    // A different zoom is a different set of tiles, and a server that refused
    // one is not refusing all of them. The count starts again.
    state.failed.clear();
    drawMap();
  }

  function fit() {
    const host = el('ov-map');
    state.zoom = zoomToFit(state.points, host.clientWidth || 640, host.clientHeight || 260);
    state.centre = centreOf(state.points, state.zoom);
    drawMap();
  }

  async function load() {
    const got = unwrap(await api.getSettings(), t('media.map.title', 'Where they were taken'));
    state.enabled = Boolean(got && got.settings && got.settings.map && got.settings.map.enabled);
    draw();
  }

  function wire() {
    const on = el('ov-map-turn-on');
    if (!on) return;

    on.addEventListener('click', async () => {
      on.disabled = true;
      const saved = unwrap(
        await api.saveSettings({ map: { enabled: true } }),
        t('app.label.saveSettings', 'Save settings')
      );
      on.disabled = false;
      if (!saved || !saved.settings) return;
      state.enabled = Boolean(saved.settings.map && saved.settings.map.enabled);
      state.centre = null;
      // `drawMap` says the rest: the positions were left out of the last
      // scan's payload, so there is nothing to draw until it runs again.
      draw();
    });

    /*
     * A narrower window is a smaller map, and the tiles were laid out for the
     * old one: a screenshot at 720px showed pins that had been on screen at
     * 1180px sitting outside it with nothing drawn where they used to be.
     *
     * Redrawn, not refitted. Refitting would undo a zoom somebody had just
     * chosen every time they dragged the window edge; "Fit all" is the button
     * for that and it is right there.
     */
    let resizing = null;
    window.addEventListener('resize', () => {
      if (state.enabled !== true || !state.centre) return;
      clearTimeout(resizing);
      resizing = setTimeout(() => {
        if (!el('ov-map-card').hidden && !el('ov-map-body').hidden) drawMap();
      }, 150);
    });

    el('ov-map-in').addEventListener('click', () => zoomBy(1));
    el('ov-map-out').addEventListener('click', () => zoomBy(-1));
    el('ov-map-fit').addEventListener('click', fit);

    onLanguageChange(draw);
  }

  /* --------------------------------------------- the tiles it kept, in Settings */

  /**
   * What the map has downloaded, and a way to remove it.
   *
   * This is a disk cleanup tool; anything it caches on somebody's disk has to
   * be visible and removable, and this is the only thing in the app that
   * downloads files at all.
   */
  function wireCacheCard() {
    const line = el('map-cache-state');
    const clear = el('map-cache-clear');
    if (!line || !clear) return;

    const show = (cache) => {
      if (!cache || cache.count === 0) {
        line.textContent = t('map.cache.empty', 'Nothing kept yet.');
        clear.disabled = true;
        return;
      }
      line.textContent = t('map.cache.held', '{n} pieces of map · {size}', {
        n: formatCount(cache.count),
        size: formatBytes(cache.bytes),
      });
      clear.disabled = false;
    };

    const refresh = async () => show(unwrap(await api.mapCache(), t('map.cache.title', 'Map tiles')));

    clear.addEventListener('click', async () => {
      clear.disabled = true;
      const gone = unwrap(await api.mapClearCache(), t('map.cache.title', 'Map tiles'));
      if (gone) {
        // Drop what is held in this window too, or the map would go on drawing
        // from memory tiles that are no longer on the disk.
        state.tiles.clear();
        toast(
          t('map.cache.removed', 'Removed {n} pieces of map · {size} freed', {
            n: formatCount(gone.count),
            size: formatBytes(gone.bytes),
          })
        );
      }
      await refresh();
    });

    const tab = document.querySelector('.tab[data-tab="settings"]');
    if (tab) tab.addEventListener('click', refresh);
    onLanguageChange(refresh);
    refresh();
  }

  wire();
  wireCacheCard();
  load();

  // media.js redraws the overview; this is how it redraws this card with it.
  window.MediaMap = { draw, reset: () => { state.centre = null; } };
})();
