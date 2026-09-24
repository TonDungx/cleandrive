'use strict';

/*
 * Where the space went, as a map of the folder -- and the same thing as a
 * list, one click away.
 *
 * ## What is on it
 *
 * Every folder in the one being looked at is a tile sized by what it holds,
 * with the folders inside it drawn inside it, three levels deep where there is
 * room. Click a folder to go into it; the path above the map goes back up.
 * Files of 10 MB or more have tiles of their own (the scan names ten per
 * folder, the same rule its snapshot keeps), and the rest of a folder's files
 * share one tile, "(n smaller files)", so the sizes add up and nothing looks
 * bigger than it is. On the machine this was written on the named files are
 * 78% of the bytes in the home folder.
 *
 * ## One accent, shaded by depth
 *
 * Green, amber and red mean verdicts in this app, and the accent means
 * interaction. So the map is weights of the accent: the folders at the top
 * level at full strength, each level inside them a step nearer the card, and
 * tiles that stand for many things -- the smaller files, the folders past the
 * first three hundred, the tiles too small to draw -- paler still. Nothing is
 * coloured by file type; a palette of types would be nine more colours to
 * learn and none of them would say whether a file can go.
 *
 * ## The tree stays in the main process
 *
 * The map asks for the folder it is showing and gets that folder and at most
 * three levels under it (`scan:children`). The whole tree of a home folder is
 * five megabytes of names the window would never draw.
 *
 * ## Drawn on a canvas, used through the DOM
 *
 * The canvas paints; it cannot be focused, read aloud or pointed at. Over it
 * sits a layer of real elements, one per tile, transparent, with the roles of
 * a tree: arrow keys move between them, Enter goes into a folder, Space ticks
 * a file, and the context-menu key opens what a right-click opens. Everything
 * the map does is also in the list view.
 */

(function () {
  const Layout = window.TreemapLayout;

  /** A nested folder's name strip, and the frame around what is inside it. */
  const HEADER = 18;
  const PAD = 3;
  /** Below this a folder is drawn flat, with its name, rather than opened up. */
  const NEST_MIN_W = 56;
  const NEST_MIN_H = 44;
  /** Tiles that would come out smaller than this many square pixels are folded together. */
  const MIN_TILE_AREA = 40;
  /** The share of the accent over the card at each depth. Three, so three levels. */
  const WEIGHTS = [1, 0.5, 0.26];
  /** Tiles that stand for many things are paler than the level they sit in. */
  const GROUP_SHARE = 0.34;
  const VIEW_KEY = 'cleandrive.spacemap.view';

  const card = $('spacemap-card');
  const box = $('spacemap');
  const canvas = $('spacemap-canvas');
  const treeEl = $('spacemap-tree');
  const listEl = $('top-folders');
  const crumbsEl = $('spacemap-crumbs');
  const noteEl = $('spacemap-note');
  const viewSwitch = $('spacemap-view');
  const viewButtons = [...viewSwitch.querySelectorAll('[data-map-view]')];

  // Fixed to the window rather than inside the card: the map clips what is
  // drawn over it, and a tooltip or a menu cut off at its edge is no use.
  const tip = document.createElement('div');
  tip.className = 'spacemap-tip';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tip);

  const menu = document.createElement('div');
  menu.className = 'spacemap-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.appendChild(menu);

  // Reads a colour token as the browser resolved it, for the canvas, which
  // cannot use `var()`.
  const probe = document.createElement('span');
  probe.className = 'spacemap-probe';
  probe.setAttribute('aria-hidden', 'true');
  card.appendChild(probe);

  const map = {
    treeId: null,
    level: null,
    rel: '',
    error: null,
    roots: [],
    byKey: new Map(),
    focusKey: null,
    hoverKey: null,
    request: 0,
  };

  let view = readView();

  /* ------------------------------------------------------------ helpers */

  function readView() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'map';
    } catch {
      return 'map';
    }
  }

  function writeView(value) {
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch {
      // A remembered view is a convenience; the map works without it.
    }
  }

  function percent(part, whole) {
    const share = whole > 0 ? part / whole : 0;
    const format = (n) => n.toLocaleString(uiLocale(), { style: 'percent', maximumFractionDigits: n < 0.1 ? 1 : 0 });
    // Something is not nothing: a folder of a few kilobytes says so rather
    // than "0%".
    return share > 0 && share < 0.001 ? `< ${format(0.001)}` : format(share);
  }

  function labelOf(entry) {
    switch (entry.kind) {
      case 'folder':
      case 'file':
        return entry.name;
      case 'rest':
        return t('map.rest', '({n} smaller {files})', {
          n: formatCount(entry.files),
          files: word(entry.files, 'app.file', 'file', 'files'),
        });
      case 'others':
        return t('map.others', '({n} more {folders})', {
          n: formatCount(entry.count),
          folders: word(entry.count, 'map.folder', 'folder', 'folders'),
        });
      default:
        return t('map.small', '({n} small items)', { n: formatCount(entry.count) });
    }
  }

  const isGroup = (entry) => entry.kind === 'rest' || entry.kind === 'others' || entry.kind === 'small';
  const viewOf = (entry) => (entry.kind === 'file' ? state.mapViews.get(entry.candidate.path) || candidateView(entry.candidate) : null);
  const pathOfEntry = (entry) => (entry.kind === 'file' ? entry.candidate.path : entry.path || null);

  /** The folder a tile sits in, as the tile or the level itself. */
  function containerOf(tile) {
    return tile.parent ? tile.parent.entry : map.level;
  }

  function keyOf(entry, folder) {
    switch (entry.kind) {
      case 'folder': return `d:${entry.rel}`;
      case 'file': return `f:${entry.candidate.id}`;
      case 'rest': return `r:${folder.rel}`;
      case 'others': return `o:${folder.rel}`;
      default: return `s:${folder.rel}`;
    }
  }

  /** Remember every file the map can offer, so the selection bar can find it. */
  function remember(folder) {
    for (const entry of folder.children || []) {
      if (entry.kind === 'file') state.mapViews.set(entry.candidate.path, candidateView(entry.candidate));
      else if (entry.kind === 'folder') remember(entry);
    }
  }

  /* ------------------------------------------------------------ colour */

  function rgbOf(token) {
    probe.style.color = `var(${token})`;
    const parts = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).map(Number);
    return parts.length >= 3 ? parts.slice(0, 3) : [128, 128, 128];
  }

  function luminance([r, g, b]) {
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  const css = ([r, g, b]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

  /** The fills for this theme, and for each the label colour that reads best on it. */
  function palette() {
    const accent = rgbOf('--accent');
    const surface = rgbOf('--surface');
    const text = rgbOf('--text');
    const inks = [[255, 255, 255], [17, 21, 28]];
    const fill = (weight) => {
      const rgb = surface.map((s, i) => s + (accent[i] - s) * weight);
      const ink = inks.reduce((best, c) => (contrast(c, rgb) > contrast(best, rgb) ? c : best));
      return { fill: css(rgb), ink: css(ink) };
    };
    return {
      surface: css(surface),
      text: css(text),
      depth: WEIGHTS.map((w) => fill(w)),
      group: WEIGHTS.map((w) => fill(w * GROUP_SHARE)),
      groupLine: `rgba(${accent.join(', ')}, 0.45)`,
      font: getComputedStyle(card).fontFamily,
    };
  }

  /* ------------------------------------------------------------ data */

  async function go(rel, { focus = null } = {}) {
    if (!map.treeId) return;
    const ticket = ++map.request;
    const reply = await api.scanChildren(map.treeId, rel);
    // Somebody clicked again before this one came back; theirs wins.
    if (ticket !== map.request) return;

    if (!reply || !reply.ok) {
      if (reply && reply.code === 'ESTALE') {
        map.level = null;
        map.error = 'stale';
        render();
        return;
      }
      if (reply && reply.code === 'ENOENT' && rel !== '') {
        go('', { focus });
        return;
      }
      unwrap(reply, t('map.label', 'Map'));
      return;
    }

    map.level = reply.data;
    map.rel = rel;
    map.error = null;
    remember(map.level);
    render({ focus });
  }

  /* ------------------------------------------------------------ layout */

  function layout(folder, rect, depth, parent) {
    const items = (folder.children || [])
      .filter((entry) => entry.bytes > 0)
      .map((entry) => ({ value: entry.bytes, entry }));
    const grouped = Layout.groupSmall(items, rect.w * rect.h, MIN_TILE_AREA, (folded) => ({
      entry: {
        kind: 'small',
        count: folded.length,
        bytes: folded.reduce((n, item) => n + item.value, 0),
        files: folded.reduce((n, item) => n + (item.entry.files || 1), 0),
      },
    }));
    grouped.sort((a, b) => b.value - a.value);

    const siblings = [];
    for (const placed of Layout.squarify(grouped, rect)) {
      const { entry } = placed.item;
      const tile = {
        key: keyOf(entry, folder),
        entry,
        parent,
        depth,
        x: placed.x,
        y: placed.y,
        w: placed.w,
        h: placed.h,
        kids: [],
        nested: false,
        el: null,
      };
      siblings.push(tile);
      if (
        entry.kind === 'folder' &&
        Array.isArray(entry.children) &&
        depth < WEIGHTS.length &&
        placed.w >= NEST_MIN_W &&
        placed.h >= NEST_MIN_H
      ) {
        const inner = { x: placed.x + PAD, y: placed.y + HEADER, w: placed.w - 2 * PAD, h: placed.h - HEADER - PAD };
        tile.kids = layout(entry, inner, depth + 1, tile);
        tile.nested = tile.kids.length > 0;
      }
    }
    return siblings;
  }

  function eachTile(tiles, fn) {
    for (const tile of tiles) {
      fn(tile);
      eachTile(tile.kids, fn);
    }
  }

  /* ------------------------------------------------------------ painting */

  function fitText(ctx, text, max) {
    if (max <= 0) return '';
    if (ctx.measureText(text).width <= max) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? `${text.slice(0, lo)}…` : '';
  }

  function paint(ctx, colors) {
    eachTile(map.roots, (tile) => {
      const x0 = Math.round(tile.x);
      const y0 = Math.round(tile.y);
      // One pixel of card between neighbours, so a wall of one colour still
      // reads as separate tiles.
      const w = Math.round(tile.x + tile.w) - x0 - 1;
      const h = Math.round(tile.y + tile.h) - y0 - 1;
      if (w < 1 || h < 1) return;

      const level = Math.min(tile.depth, WEIGHTS.length) - 1;
      const tone = isGroup(tile.entry) ? colors.group[level] : colors.depth[level];
      ctx.fillStyle = tone.fill;
      ctx.fillRect(x0, y0, w, h);
      if (isGroup(tile.entry) && w > 3 && h > 3) {
        ctx.strokeStyle = colors.groupLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
        ctx.setLineDash([]);
      }

      ctx.fillStyle = tone.ink;
      ctx.textBaseline = 'alphabetic';
      const name = labelOf(tile.entry);
      const size = formatBytes(tile.entry.bytes);
      if (tile.nested) {
        if (w < 28) return;
        ctx.font = `600 11px ${colors.font}`;
        const sizeWidth = ctx.measureText(size).width;
        const room = w - 10;
        if (room > sizeWidth + 40) {
          ctx.fillText(fitText(ctx, name, room - sizeWidth - 8), x0 + 5, y0 + 13);
          ctx.font = `11px ${colors.font}`;
          ctx.fillText(size, x0 + w - 5 - ctx.measureText(size).width, y0 + 13);
        } else {
          ctx.fillText(fitText(ctx, name, room), x0 + 5, y0 + 13);
        }
        return;
      }
      if (w < 34 || h < 17) return;
      ctx.font = `600 11px ${colors.font}`;
      ctx.fillText(fitText(ctx, name, w - 10), x0 + 5, y0 + 14);
      if (h >= 32) {
        ctx.font = `11px ${colors.font}`;
        ctx.fillText(fitText(ctx, size, w - 10), x0 + 5, y0 + 28);
      }
    });
  }

  /* ------------------------------------------------------------ the tree layer */

  function ariaLabel(tile) {
    const entry = tile.entry;
    const container = containerOf(tile);
    const params = {
      name: labelOf(entry),
      size: formatBytes(entry.bytes),
      share: percent(entry.bytes, container.bytes),
      parent: container.name,
    };
    if (entry.kind === 'folder') {
      return t('map.aria.folder', '{name}: {size}, {share} of {parent}, {n} {files}', {
        ...params,
        n: formatCount(entry.files),
        files: word(entry.files, 'app.file', 'file', 'files'),
      });
    }
    let text = t('map.aria.item', '{name}: {size}, {share} of {parent}', params);
    const v = viewOf(entry);
    if (v && (v.verdict === 'safe' || v.verdict === 'review')) {
      text += ` — ${verdictWord(v.verdict)} · ${confidenceWord(v.confidence)}`;
    }
    return text;
  }

  function buildItems() {
    map.byKey.clear();
    const frag = document.createDocumentFragment();
    const make = (tile, originX, originY, container, level, count, index) => {
      const el = document.createElement('div');
      el.className = `spacemap-item is-${tile.entry.kind}`;
      el.setAttribute('role', 'treeitem');
      el.dataset.key = tile.key;
      el.setAttribute('aria-level', String(level));
      el.setAttribute('aria-setsize', String(count));
      el.setAttribute('aria-posinset', String(index + 1));
      el.setAttribute('aria-label', ariaLabel(tile));
      el.tabIndex = -1;
      el.style.left = `${tile.x - originX}px`;
      el.style.top = `${tile.y - originY}px`;
      el.style.width = `${tile.w}px`;
      el.style.height = `${tile.h}px`;
      if (tile.entry.kind === 'folder') el.setAttribute('aria-expanded', String(tile.nested));
      if (tile.entry.kind === 'file') markSelected(el, tile.entry);
      tile.el = el;
      map.byKey.set(tile.key, tile);
      container.appendChild(el);
      if (tile.kids.length > 0) {
        const group = document.createElement('div');
        group.className = 'spacemap-group';
        group.setAttribute('role', 'group');
        el.appendChild(group);
        tile.kids.forEach((kid, i) => make(kid, tile.x, tile.y, group, level + 1, tile.kids.length, i));
      }
    };
    map.roots.forEach((tile, i) => make(tile, 0, 0, frag, 1, map.roots.length, i));
    treeEl.replaceChildren(frag);
    treeEl.setAttribute(
      'aria-label',
      t('map.tree', 'Where the space went in {folder}', { folder: map.level ? map.level.name : '' })
    );

    // One tile in the tab order, as a tree has: the one last focused, or the first.
    const current = map.byKey.get(map.focusKey) || map.roots[0];
    if (current) current.el.tabIndex = 0;
  }

  function markSelected(el, entry) {
    const on = state.selectedLarge.has(entry.candidate.path);
    el.classList.toggle('is-selected', on);
    el.setAttribute('aria-selected', String(on));
  }

  function focusTile(tile) {
    if (!tile || !tile.el) return;
    for (const other of treeEl.querySelectorAll('.spacemap-item[tabindex="0"]')) other.tabIndex = -1;
    tile.el.tabIndex = 0;
    map.focusKey = tile.key;
    tile.el.focus();
  }

  function tileFrom(target) {
    const el = target && target.closest ? target.closest('.spacemap-item') : null;
    return el ? map.byKey.get(el.dataset.key) || null : null;
  }

  /* ------------------------------------------------------------ drawing */

  let frame = 0;
  function requestDraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const focused = treeEl.contains(document.activeElement) ? map.focusKey : null;
      drawMap();
      if (focused) focusTile(map.byKey.get(focused) || map.roots[0]);
    });
  }

  function drawMap() {
    const width = box.clientWidth;
    const height = box.clientHeight;
    const ctx = canvas.getContext('2d');
    map.roots = [];
    if (!map.level || view !== 'map' || width === 0 || height === 0) {
      treeEl.replaceChildren();
      map.byKey.clear();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = palette();
    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, width, height);

    map.roots = layout(map.level, { x: 0, y: 0, w: width, h: height }, 1, null);
    paint(ctx, colors);
    buildItems();
  }

  /* ------------------------------------------------------------ the tooltip */

  let tipKey = null;

  function showTip(tile, anchor) {
    // The pointer moving within one tile only moves the tooltip.
    if (tipKey === tile.key && !tip.hidden) {
      placeTip(tile, anchor);
      return;
    }
    tipKey = tile.key;
    const entry = tile.entry;
    const container = containerOf(tile);
    tip.replaceChildren();

    const where = document.createElement('div');
    where.className = 'spacemap-tip-path';
    where.textContent = pathOfEntry(entry) || container.path;
    tip.appendChild(where);

    const facts = document.createElement('div');
    facts.className = 'spacemap-tip-line';
    const parts = [formatBytes(entry.bytes)];
    if (entry.kind !== 'file') {
      parts.push(`${formatCount(entry.files)} ${word(entry.files, 'app.file', 'file', 'files')}`);
    }
    parts.push(t('map.share', '{share} of {parent}', { share: percent(entry.bytes, container.bytes), parent: container.name }));
    facts.textContent = parts.join(' · ');
    tip.appendChild(facts);

    const v = viewOf(entry);
    if (v) {
      const when = document.createElement('div');
      when.className = 'spacemap-tip-line';
      when.textContent = timeLabel(v);
      tip.appendChild(when);
      if (v.verdict === 'safe' || v.verdict === 'review') {
        const why = document.createElement('div');
        why.className = 'spacemap-tip-line';
        why.append(
          makeBadge(v.verdict, `${verdictWord(v.verdict)} · ${confidenceWord(v.confidence)}`),
          document.createTextNode(v.reason ? tm(v.reason) : '')
        );
        tip.appendChild(why);
      }
    } else if (entry.kind === 'rest') {
      const note = document.createElement('div');
      note.className = 'spacemap-tip-line is-quiet';
      note.textContent = t('map.restHint', 'Files under 10 MB, and any past the ten largest, are counted here rather than drawn one by one.');
      tip.appendChild(note);
    }

    tip.hidden = false;
    placeTip(tile, anchor);
  }

  function placeTip(tile, anchor) {
    const r = tip.getBoundingClientRect();
    let x;
    let y;
    if (anchor && anchor.clientX !== undefined) {
      x = anchor.clientX + 14;
      y = anchor.clientY + 16;
    } else {
      const at = tile.el.getBoundingClientRect();
      x = at.left + 8;
      y = at.top + Math.min(at.height, 40) + 6;
    }
    x = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, y - r.height - 32);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function hideTip() {
    tip.hidden = true;
    tipKey = null;
  }

  function setHover(tile) {
    const key = tile ? tile.key : null;
    if (key === map.hoverKey) return;
    const old = map.byKey.get(map.hoverKey);
    if (old && old.el) old.el.classList.remove('is-hover');
    map.hoverKey = key;
    if (tile && tile.el) tile.el.classList.add('is-hover');
  }

  /* ------------------------------------------------------------ the menu */

  let menuReturn = null;

  function menuEntries(entry) {
    if (entry.kind === 'folder') {
      return [
        { label: t('map.menu.open', 'Open this folder'), run: () => go(entry.rel, { focus: 'first' }) },
        { label: t('app.reveal', 'Reveal'), run: () => api.reveal(entry.path) },
      ];
    }
    if (entry.kind === 'file') {
      const file = entry.candidate.path;
      const selected = state.selectedLarge.has(file);
      const items = [
        { label: t('app.view', 'View'), run: () => openViewer(file) },
        { label: t('app.reveal', 'Reveal'), run: () => api.reveal(file) },
      ];
      if ((entry.candidate.actions || []).length > 0) {
        items.push({
          label: selected ? t('map.menu.deselect', 'Remove from selection') : t('map.menu.select', 'Add to selection'),
          run: () => toggleSelected(file),
        });
      }
      return items;
    }
    return [];
  }

  function openMenu(entry, at, returnTo) {
    const entries = menuEntries(entry);
    if (entries.length === 0) return;
    hideTip();
    menuReturn = returnTo || null;
    menu.replaceChildren();
    menu.setAttribute('aria-label', t('map.menu.aria', 'Actions for {name}', { name: labelOf(entry) }));
    // What the menu acts on, since a tile's own label may be cut short. The
    // menu's accessible name already says it, so this is for the eye only.
    const head = document.createElement('div');
    head.className = 'spacemap-menu-head';
    head.setAttribute('aria-hidden', 'true');
    head.textContent = `${labelOf(entry)} · ${formatBytes(entry.bytes)}`;
    head.title = pathOfEntry(entry) || '';
    menu.appendChild(head);
    for (const item of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.textContent = item.label;
      button.addEventListener('click', () => {
        closeMenu(false);
        item.run();
      });
      menu.appendChild(button);
    }
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    const x = Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8));
    const y = at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.querySelector('[role="menuitem"]').focus();
  }

  function closeMenu(restoreFocus = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (restoreFocus && menuReturn && menuReturn.isConnected) menuReturn.focus();
    menuReturn = null;
  }

  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      closeMenu(true);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target)) closeMenu(false);
  });
  window.addEventListener('blur', () => closeMenu(false));
  (document.querySelector('main') || window).addEventListener('scroll', () => {
    closeMenu(false);
    hideTip();
  }, { passive: true });

  /* ------------------------------------------------------------ selection */

  function toggleSelected(file) {
    if (state.selectedLarge.has(file)) state.selectedLarge.delete(file);
    else state.selectedLarge.add(file);
    if (lists.largest) lists.largest.sync();
    bars.largest.update();
    syncSelection();
  }

  function syncSelection() {
    for (const tile of map.byKey.values()) {
      if (tile.entry.kind === 'file' && tile.el) markSelected(tile.el, tile.entry);
    }
    for (const row of listEl.querySelectorAll('.spacemap-row.is-file')) {
      row.classList.toggle('is-selected', state.selectedLarge.has(row.dataset.path));
    }
  }

  /* ------------------------------------------------------------ the map's input */

  treeEl.addEventListener('click', (event) => {
    const tile = tileFrom(event.target);
    if (!tile) return;
    if (tile.entry.kind === 'folder') go(tile.entry.rel, { focus: 'first' });
    else if (tile.entry.kind === 'file') openMenu(tile.entry, { x: event.clientX, y: event.clientY }, tile.el);
  });

  treeEl.addEventListener('contextmenu', (event) => {
    const tile = tileFrom(event.target);
    if (!tile) return;
    event.preventDefault();
    openMenu(tile.entry, { x: event.clientX, y: event.clientY }, tile.el);
  });

  treeEl.addEventListener('pointermove', (event) => {
    const tile = tileFrom(event.target);
    setHover(tile);
    if (tile && menu.hidden) showTip(tile, event);
    else hideTip();
  });

  treeEl.addEventListener('pointerleave', () => {
    setHover(null);
    hideTip();
  });

  treeEl.addEventListener('focusin', (event) => {
    const tile = tileFrom(event.target);
    if (!tile) return;
    map.focusKey = tile.key;
    for (const other of treeEl.querySelectorAll('.spacemap-item[tabindex="0"]')) {
      if (other !== tile.el) other.tabIndex = -1;
    }
    tile.el.tabIndex = 0;
    // A keyboard gets the same facts a pointer does.
    if (tile.el.matches(':focus-visible') && menu.hidden) showTip(tile, null);
  });

  treeEl.addEventListener('focusout', (event) => {
    if (!treeEl.contains(event.relatedTarget)) hideTip();
  });

  function siblingsOf(tile) {
    return tile.parent ? tile.parent.kids : map.roots;
  }

  function goUp() {
    const crumbs = map.level ? map.level.crumbs : [];
    if (crumbs.length < 2) return;
    go(crumbs[crumbs.length - 2].rel, { focus: `key:d:${map.rel}` });
  }

  treeEl.addEventListener('keydown', (event) => {
    const tile = tileFrom(event.target);
    if (!tile) return;
    const siblings = siblingsOf(tile);
    const at = siblings.indexOf(tile);
    const entry = tile.entry;
    let handled = true;

    switch (event.key) {
      case 'ArrowDown':
        focusTile(siblings[Math.min(siblings.length - 1, at + 1)]);
        break;
      case 'ArrowUp':
        focusTile(siblings[Math.max(0, at - 1)]);
        break;
      case 'Home':
        focusTile(siblings[0]);
        break;
      case 'End':
        focusTile(siblings[siblings.length - 1]);
        break;
      case 'ArrowRight':
        if (entry.kind !== 'folder') break;
        if (tile.kids.length > 0) focusTile(tile.kids[0]);
        else go(entry.rel, { focus: 'first' });
        break;
      case 'ArrowLeft':
        if (tile.parent) focusTile(tile.parent);
        else goUp();
        break;
      case 'Backspace':
        goUp();
        break;
      case 'Enter':
        if (entry.kind === 'folder') go(entry.rel, { focus: 'first' });
        else if (entry.kind === 'file') openViewer(entry.candidate.path);
        break;
      case ' ':
        if (entry.kind === 'file' && (entry.candidate.actions || []).length > 0) toggleSelected(entry.candidate.path);
        break;
      case 'ContextMenu':
        openMenuFor(tile);
        break;
      case 'F10':
        if (event.shiftKey) openMenuFor(tile);
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  });

  function openMenuFor(tile) {
    const r = tile.el.getBoundingClientRect();
    openMenu(tile.entry, { x: r.left + 8, y: r.top + Math.min(r.height, 24) }, tile.el);
  }

  /* ------------------------------------------------------------ the list */

  function renderList() {
    listEl.replaceChildren();
    if (!map.level) return;
    const items = map.level.children || [];
    const max = items.reduce((n, entry) => Math.max(n, entry.bytes), 0) || 1;

    for (const entry of items) {
      const li = document.createElement('li');
      li.className = `bar-row spacemap-row is-${entry.kind}`;
      const head = document.createElement('span');
      head.className = 'spacemap-row-name';

      let name;
      if (entry.kind === 'folder') {
        name = document.createElement('button');
        name.type = 'button';
        name.className = 'bar-name spacemap-open';
        name.addEventListener('click', () => go(entry.rel, { focus: 'first' }));
      } else {
        name = document.createElement('span');
        name.className = 'bar-name';
      }
      name.textContent = labelOf(entry);
      name.title = pathOfEntry(entry) || labelOf(entry);
      head.appendChild(name);

      const end = document.createElement('span');
      end.className = 'spacemap-row-end';
      const size = document.createElement('span');
      size.className = 'bar-size';
      size.textContent = `${formatBytes(entry.bytes)} · ${percent(entry.bytes, map.level.bytes)}`;
      end.appendChild(size);

      if (entry.kind === 'file') {
        li.dataset.path = entry.candidate.path;
        li.classList.toggle('is-selected', state.selectedLarge.has(entry.candidate.path));
        const v = viewOf(entry);
        if (v && (v.verdict === 'safe' || v.verdict === 'review')) {
          const pill = evidencePill(v);
          pill.setAttribute('aria-expanded', 'false');
          pill.addEventListener('click', () => {
            const open = li.nextElementSibling && li.nextElementSibling.classList.contains('spacemap-evidence');
            if (open) li.nextElementSibling.remove();
            else {
              const row = document.createElement('li');
              row.className = 'spacemap-evidence';
              row.setAttribute('role', 'note');
              row.appendChild(EvidencePanel(v));
              li.after(row);
            }
            pill.setAttribute('aria-expanded', String(!open));
          });
          head.appendChild(pill);
        }
      }

      if (entry.kind === 'folder' || entry.kind === 'file') {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'spacemap-more';
        more.textContent = '…';
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-label', t('map.menu.aria', 'Actions for {name}', { name: labelOf(entry) }));
        more.title = more.getAttribute('aria-label');
        more.addEventListener('click', () => {
          const r = more.getBoundingClientRect();
          openMenu(entry, { x: r.left, y: r.bottom + 4 }, more);
        });
        end.appendChild(more);
      }

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${Math.max(entry.bytes > 0 ? 1 : 0, (entry.bytes / max) * 100)}%`;
      track.appendChild(fill);

      li.append(head, end, track);
      listEl.appendChild(li);
    }
  }

  /* ------------------------------------------------------------ the frame */

  function renderCrumbs() {
    crumbsEl.replaceChildren();
    if (!map.level) return;
    const list = document.createElement('ol');
    map.level.crumbs.forEach((crumb, i) => {
      const li = document.createElement('li');
      const last = i === map.level.crumbs.length - 1;
      const el = document.createElement(last ? 'span' : 'button');
      el.textContent = crumb.name;
      if (last) {
        el.setAttribute('aria-current', 'location');
        el.className = 'spacemap-crumb-here';
      } else {
        el.type = 'button';
        el.className = 'link spacemap-crumb';
        el.addEventListener('click', () => go(crumb.rel, { focus: `key:d:${map.level.crumbs[i + 1].rel}` }));
      }
      li.appendChild(el);
      list.appendChild(li);
    });
    crumbsEl.appendChild(list);

    const total = document.createElement('span');
    total.className = 'spacemap-total';
    total.textContent = `${formatBytes(map.level.bytes)} · ${formatCount(map.level.files)} ${word(map.level.files, 'app.file', 'file', 'files')}`;
    crumbsEl.appendChild(total);
  }

  function renderNote() {
    const lines = [];
    if (map.error === 'stale') {
      lines.push(t('map.stale', 'This map belonged to an earlier scan. Scan again to draw it.'));
    } else if (map.level) {
      if ((map.level.children || []).every((entry) => entry.bytes === 0)) {
        lines.push(t('map.empty', 'Nothing in this folder takes up any space.'));
      }
      if (!map.level.complete) {
        lines.push(t('map.partial', 'The scan was stopped early, so this shows only what it had read by then.'));
      }
      if (map.level.removed && map.level.removed.files > 0) {
        lines.push(
          t('map.movedSince', 'Moved to the Recycle Bin since this scan, so no longer drawn: {n} {files} ({size}). Not freed until the bin is emptied.', {
            n: formatCount(map.level.removed.files),
            files: word(map.level.removed.files, 'app.file', 'file', 'files'),
            size: formatBytes(map.level.removed.bytes),
          })
        );
      }
      lines.push(
        view === 'map'
          ? t('map.hint', "Each tile is sized by what it holds. Files of 10 MB or more have tiles of their own; the rest of a folder's files share one. Click a folder to go into it, or right-click a tile for more.")
          : t('map.listHint', "Files of 10 MB or more are listed one by one; the rest of a folder's files are counted together.")
      );
    }
    noteEl.textContent = lines.join(' ');
    noteEl.hidden = lines.length === 0;
  }

  function applyView() {
    viewSwitch.style.setProperty('--switch-index', String(view === 'list' ? 1 : 0));
    for (const button of viewButtons) {
      const active = button.dataset.mapView === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    box.hidden = view !== 'map';
    listEl.hidden = view !== 'list';
  }

  function render({ focus = null } = {}) {
    closeMenu(false);
    hideTip();
    applyView();
    renderCrumbs();
    renderNote();
    renderList();
    drawMap();

    if (!focus) return;
    if (view === 'list') {
      const first = listEl.querySelector('button');
      if (first) first.focus();
      return;
    }
    if (focus === 'first') focusTile(map.roots[0]);
    else if (focus.startsWith('key:')) focusTile(map.byKey.get(focus.slice(4)) || map.roots[0]);
  }

  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      view = button.dataset.mapView === 'list' ? 'list' : 'map';
      writeView(view);
      render();
    });
  }

  new ResizeObserver(() => requestDraw()).observe(box);
  new MutationObserver(() => requestDraw()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestDraw());
  onLanguageChange(() => {
    if (map.level || map.error) render();
  });

  window.SpaceMap = {
    /** A scan's reply arrived. The same scan again (a language change) only redraws. */
    show(scan) {
      if (scan && scan.treeId && scan.treeId === map.treeId) {
        render();
        return;
      }
      map.treeId = scan ? scan.treeId || null : null;
      map.level = null;
      map.error = null;
      map.rel = '';
      map.focusKey = null;
      state.mapViews.clear();
      if (map.treeId) go('');
      else render();
    },
    /** Something moved out of the folder; the main process has already taken it off. */
    refresh() {
      if (map.treeId) go(map.rel);
    },
    syncSelection,
    /** For the harnesses: what the map is drawing, without reading pixels. */
    debug() {
      const tiles = [];
      eachTile(map.roots, (tile) => tiles.push({ key: tile.key, kind: tile.entry.kind, depth: tile.depth, w: tile.w, h: tile.h }));
      return { view, rel: map.rel, error: map.error, tiles, level: map.level };
    },
  };
})();
