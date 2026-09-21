'use strict';

/**
 * Photos and video.
 *
 * Shares `app.js`'s globals -- `$`, `t`, `tm`, `toast`, `formatBytes`,
 * `unwrap`, `elide`, `deleteSelected` -- the same way `automatic.js` and
 * `trends.js` do. Four scripts in one scope is the arrangement this project
 * chose over a build step, and adding a fifth does not change the trade.
 *
 * ## Nothing is ever ticked for you
 *
 * Not near-duplicates, not blank frames, not the thousand-icon folders. Every
 * other screen in this app has a "select everything safe" button because it is
 * talking about caches and installers, which can be got back. A photograph
 * cannot. So the only bulk action here is "select everything currently shown",
 * which acts on a filter the user chose and can see the count of.
 */

const media = {
  /** Every file the last scan produced, in arrival order. */
  files: [],
  /** The subset passing the current filters, in the current sort order. */
  shown: [],
  selected: new Set(),
  /** path -> { dataUri, hash, detail, ... } for cells that have been drawn. */
  thumbs: new Map(),
  /** Paths asked for but not yet answered, so a cell is not requested twice. */
  pending: new Set(),
  filters: { origin: null, trait: null, year: null },
  sort: 'size',
  roots: [],
  extraRoots: [],
  displays: [],
  focused: null,
  /** The anchor for shift-click, which is the last plain click rather than the last change. */
  anchor: null,
  scanning: false,
  excluded: [],
};

/* ------------------------------------------------------------------ layout */

/**
 * The grid's geometry.
 *
 * Fixed cell size rather than measured-per-item, because a virtualised grid
 * needs to know where row 4,000 is without having drawn rows 1 to 3,999.
 *
 * `CELL` is the picture; `CELL_H` is the picture plus the line of text under it
 * that says how big the file is. They were the same number at first, and the
 * result is visible in the first screenshot ever taken of this screen: every
 * caption sliced in half by the row beneath it. A virtualised grid has no
 * layout to fall back on, so a row pitch that does not include everything in
 * the row does not merely look tight -- it overlaps.
 */
const CELL = 148;
const CAPTION = 24;
const CELL_H = CELL + CAPTION;
const GAP = 10;
/** Rows drawn above and below the viewport, so scrolling does not reveal gaps. */
const OVERSCAN_ROWS = 3;

/** The grid's own padding, which `clientWidth` includes and the cells cannot use. */
const GRID_PADDING = 4;

function gridMetrics() {
  const grid = $('media-grid');
  // `clientWidth` already excludes the scrollbar but still counts the padding.
  // Not subtracting it loses a whole column at narrow widths, where columns are
  // the scarcest thing on the screen.
  const width = Math.max(CELL, (grid.clientWidth || 800) - GRID_PADDING);
  const columns = Math.max(1, Math.floor((width + GAP) / (CELL + GAP)));
  const rows = Math.ceil(media.shown.length / columns);
  return { columns, rows, width };
}

/* ------------------------------------------------------------------ filters */

/**
 * The chips, each carrying what it holds.
 *
 * Counts and totals are recomputed from the full set every time rather than
 * kept up to date incrementally: it is one pass over an array the renderer
 * already has, and an incremental count that drifts is worse than no count.
 */
function facets() {
  const origin = new Map();
  const trait = new Map();
  const year = new Map();

  const bump = (map, key, size) => {
    if (key === null || key === undefined) return;
    const entry = map.get(key) || { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += size;
    map.set(key, entry);
  };

  for (const file of media.files) {
    bump(origin, file.origin, file.size);
    bump(year, file.year, file.size);
    // A file can wear several traits, so it is counted under each of them --
    // the chips are filters, not a partition.
    for (const one of file.traits) bump(trait, one.key, file.size);
  }

  return { origin, trait, year };
}

function applyFilters() {
  const { origin, trait, year } = media.filters;

  media.shown = media.files.filter((file) => {
    if (origin && file.origin !== origin) return false;
    if (year !== null && file.year !== year) return false;
    if (trait && !file.traits.some((one) => one.key === trait)) return false;
    return true;
  });

  sortShown();
  renderChips();
  renderGrid(true);
  updateSelection();
}

function sortShown() {
  const by = media.sort;
  media.shown.sort((a, b) => {
    switch (by) {
      case 'date': return (b.at || 0) - (a.at || 0);
      case 'dateAsc': return (a.at || 0) - (b.at || 0);
      case 'name': return a.name.localeCompare(b.name, uiLocale());
      case 'detail': {
        // Least detail first. Files nothing has measured yet sort last rather
        // than first: an unmeasured file is not a blank one, and putting it at
        // the top would be the list asserting something it does not know.
        const left = media.thumbs.get(a.path);
        const right = media.thumbs.get(b.path);
        const x = left && left.detail !== null && left.detail !== undefined ? left.detail : Infinity;
        const y = right && right.detail !== null && right.detail !== undefined ? right.detail : Infinity;
        return x - y || b.size - a.size;
      }
      default: return b.size - a.size;
    }
  });
}

/* ------------------------------------------------------------------ chips */

const ORIGIN_LABEL = {
  camera: ['media.origin.camera', 'From a camera'],
  screenshot: ['media.origin.screenshot', 'Screenshots'],
  messaging: ['media.origin.messaging', 'Received in a chat'],
  download: ['media.origin.download', 'Downloaded'],
  edited: ['media.origin.edited', 'Made or edited in software'],
  screenrecord: ['media.origin.screenrecord', 'Screen recordings'],
  gamecapture: ['media.origin.gamecapture', 'Game captures'],
  unknown: ['media.origin.unknown', 'No idea where from'],
};

const TRAIT_LABEL = {
  broken: ['media.trait.label.broken', 'Broken or empty'],
  mislabelled: ['media.trait.label.mislabelled', 'Wrong file extension'],
  tiny: ['media.trait.label.tiny', 'Icon-sized'],
  thumbnail: ['media.trait.label.thumbnail', 'Thumbnail-sized'],
  big: ['media.trait.label.big', 'Large files'],
  highres: ['media.trait.label.highres', 'Full resolution'],
  lowres: ['media.trait.label.lowres', 'Low resolution'],
  wide: ['media.trait.label.wide', 'Very wide'],
  tall: ['media.trait.label.tall', 'Very tall'],
  rotated: ['media.trait.label.rotated', 'Stored sideways'],
  'screen-sized': ['media.trait.label.screenSized', 'Screen-sized'],
  recompressed: ['media.trait.label.recompressed', 'Passed through a chat app'],
  'hard-compressed': ['media.trait.label.hardCompressed', 'Compressed hard'],
  generous: ['media.trait.label.generous', 'Barely compressed'],
  cloud: ['media.trait.label.cloud', 'Synced to the cloud'],
  'online-only': ['media.trait.label.onlineOnly', 'Stored online only'],
  located: ['media.trait.label.located', 'Records a location'],
  brief: ['media.trait.label.brief', 'Very short'],
  long: ['media.trait.label.long', 'Long'],
  '4k': ['media.trait.label.uhd', '4K'],
  'low-bitrate': ['media.trait.label.lowBitrate', 'Low bitrate'],
  silent: ['media.trait.label.silent', 'No sound'],
  'no-metadata': ['media.trait.label.noMetadata', 'No metadata'],
};

function labelFor(table, key) {
  const entry = table[key];
  return entry ? t(entry[0], entry[1]) : key;
}

function renderChips() {
  const container = $('media-chips');
  container.replaceChildren();
  if (media.files.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const { origin, trait, year } = facets();

  container.appendChild(
    chipRow(
      t('media.chip.origin', 'Where from'),
      [...origin.entries()].sort((a, b) => b[1].count - a[1].count),
      (key) => labelFor(ORIGIN_LABEL, key),
      media.filters.origin,
      (key) => {
        media.filters.origin = media.filters.origin === key ? null : key;
        applyFilters();
      }
    )
  );

  container.appendChild(
    chipRow(
      t('media.chip.what', 'What it is'),
      [...trait.entries()].sort((a, b) => b[1].count - a[1].count),
      (key) => labelFor(TRAIT_LABEL, key),
      media.filters.trait,
      (key) => {
        media.filters.trait = media.filters.trait === key ? null : key;
        applyFilters();
      }
    )
  );

  const years = [...year.entries()].filter(([key]) => key !== null).sort((a, b) => b[0] - a[0]);
  if (years.length > 1) {
    container.appendChild(
      chipRow(
        t('media.chip.year', 'Year'),
        years,
        (key) => String(key),
        media.filters.year,
        (key) => {
          media.filters.year = media.filters.year === key ? null : key;
          applyFilters();
        }
      )
    );
  }
}

function chipRow(title, entries, labelOf, active, onPick) {
  const row = document.createElement('div');
  row.className = 'chip-row';

  const heading = document.createElement('span');
  heading.className = 'chip-row-label';
  heading.textContent = title;
  row.appendChild(heading);

  for (const [key, stat] of entries) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.classList.toggle('is-active', active === key);
    chip.setAttribute('aria-pressed', String(active === key));
    chip.dataset.chip = String(key);

    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = labelOf(key);

    // The count and the size together. A chip that only says "Screenshots" is
    // a chip you have to click to find out whether it is worth clicking.
    const meta = document.createElement('span');
    meta.className = 'chip-meta';
    meta.textContent = `${formatCount(stat.count)} · ${formatBytes(stat.bytes)}`;

    chip.append(name, meta);
    chip.addEventListener('click', () => onPick(key));
    row.appendChild(chip);
  }

  return row;
}

/* ------------------------------------------------------------------ the grid */

let gridFrame = null;

/**
 * Draw the cells that are on screen, and only those.
 *
 * Called on scroll and on resize through `requestAnimationFrame`, so a fast
 * scroll coalesces into one pass per frame rather than one per event.
 */
function renderGrid(reset = false) {
  const grid = $('media-grid');
  const canvas = $('media-canvas');
  const { columns, rows } = gridMetrics();

  if (reset) grid.scrollTop = 0;

  // The canvas is the full height the whole list would occupy, so the scrollbar
  // is honest about how much there is even though the cells do not exist.
  canvas.style.height = `${Math.max(0, rows * (CELL_H + GAP) - GAP)}px`;

  const first = Math.max(0, Math.floor(grid.scrollTop / (CELL_H + GAP)) - OVERSCAN_ROWS);
  const visibleRows = Math.ceil(grid.clientHeight / (CELL_H + GAP)) + OVERSCAN_ROWS * 2;
  const from = first * columns;
  const to = Math.min(media.shown.length, (first + visibleRows) * columns);

  const wanted = new Map();
  for (let i = from; i < to; i++) wanted.set(media.shown[i].path, i);

  // Remove what has scrolled away. Dropping the element drops its data: URI
  // reference with it, which is what keeps a long scroll from accumulating
  // every thumbnail it has ever shown.
  for (const cell of [...canvas.children]) {
    if (!wanted.has(cell.dataset.path)) cell.remove();
  }

  const present = new Set([...canvas.children].map((c) => c.dataset.path));
  for (const [path, index] of wanted) {
    if (present.has(path)) {
      position(canvas.querySelector(`[data-path="${cssEscape(path)}"]`), index, columns);
      continue;
    }
    const cell = makeCell(media.shown[index], index);
    position(cell, index, columns);
    canvas.appendChild(cell);
  }

  requestThumbs([...wanted.keys()]);
}

function position(cell, index, columns) {
  if (!cell) return;
  const row = Math.floor(index / columns);
  const column = index % columns;
  cell.style.transform = `translate(${column * (CELL + GAP)}px, ${row * (CELL_H + GAP)}px)`;
}

/** `CSS.escape` is not available in every context; the paths here need quoting. */
function cssEscape(value) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function makeCell(file, index) {
  const cell = document.createElement('div');
  cell.className = 'media-cell';
  cell.dataset.path = file.path;
  cell.dataset.index = String(index);
  cell.setAttribute('role', 'option');
  cell.setAttribute('aria-selected', String(media.selected.has(file.path)));
  cell.classList.toggle('is-selected', media.selected.has(file.path));
  cell.classList.toggle('is-focused', media.focused === file.path);
  cell.title = file.path;

  const frame = document.createElement('div');
  frame.className = 'media-frame';

  const thumb = media.thumbs.get(file.path);
  if (thumb && thumb.dataUri) {
    const img = document.createElement('img');
    img.className = 'media-img';
    img.src = thumb.dataUri;
    img.alt = '';
    img.loading = 'lazy';
    frame.appendChild(img);
  } else {
    // Not a blank square: a file that cannot be drawn says so, because a blank
    // cell reads as the app still working on it.
    const placeholder = document.createElement('span');
    placeholder.className = 'media-placeholder';
    placeholder.textContent =
      thumb && !thumb.dataUri ? t('media.noPreview', 'no preview') : `.${file.ext}`;
    frame.appendChild(placeholder);
  }

  if (file.kind === 'video') {
    const badge = document.createElement('span');
    badge.className = 'media-duration';
    badge.textContent = file.durationSec ? formatClock(file.durationSec) : t('media.videoShort', 'video');
    frame.appendChild(badge);
  }

  if (file.cloudService) {
    const cloudBadge = document.createElement('span');
    cloudBadge.className = 'media-cloud';
    cloudBadge.textContent = '☁';
    cloudBadge.title = t('media.cloudBadge', 'Synced with {service} — deleting it here deletes it everywhere', {
      service: file.cloudService,
    });
    frame.appendChild(cloudBadge);
  }

  const tick = document.createElement('span');
  tick.className = 'media-tick';
  tick.setAttribute('aria-hidden', 'true');
  frame.appendChild(tick);

  const caption = document.createElement('span');
  caption.className = 'media-caption';
  caption.textContent = formatBytes(file.size);

  cell.append(frame, caption);
  cell.addEventListener('click', (event) => onCellClick(file, index, event));
  return cell;
}

function formatClock(seconds) {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ thumbs */

let thumbTimer = null;

/**
 * Ask for the pictures of the cells in view.
 *
 * Debounced, because a scroll produces a request per frame and each one costs a
 * full-resolution decode in the main process. The delay is short enough not to
 * be felt and long enough that flinging past a thousand cells asks for the one
 * screenful it lands on rather than all thousand.
 */
function requestThumbs(paths) {
  const missing = paths.filter((p) => !media.thumbs.has(p) && !media.pending.has(p));
  if (missing.length === 0) return;

  for (const p of missing) media.pending.add(p);

  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    const batch = [...media.pending];
    const envelope = await api.mediaThumbs(batch);
    for (const p of batch) media.pending.delete(p);

    if (!envelope || !envelope.ok) return;
    for (const [path, thumb] of Object.entries(envelope.data)) {
      media.thumbs.set(path, thumb);
    }

    // Only repaint the cells that are still on screen: by the time this comes
    // back the user may have scrolled somewhere else entirely.
    for (const cell of $('media-canvas').children) {
      const thumb = media.thumbs.get(cell.dataset.path);
      if (!thumb || cell.querySelector('.media-img')) continue;
      const frame = cell.querySelector('.media-frame');
      const placeholder = frame.querySelector('.media-placeholder');
      if (thumb.dataUri) {
        const img = document.createElement('img');
        img.className = 'media-img';
        img.src = thumb.dataUri;
        img.alt = '';
        if (placeholder) placeholder.remove();
        frame.prepend(img);
      } else if (placeholder) {
        placeholder.textContent = t('media.noPreview', 'no preview');
      }
    }

    if (media.sort === 'detail') {
      sortShown();
      renderGrid();
    }
  }, 60);
}

/* ------------------------------------------------------------------ selection */

function onCellClick(file, index, event) {
  if (event.shiftKey && media.anchor !== null) {
    const from = media.shown.findIndex((f) => f.path === media.anchor);
    if (from >= 0) {
      const [lo, hi] = from < index ? [from, index] : [index, from];
      for (let i = lo; i <= hi; i++) media.selected.add(media.shown[i].path);
    }
  } else if (event.ctrlKey || event.metaKey) {
    toggle(file.path);
    media.anchor = file.path;
  } else {
    // A plain click on an unselected cell selects only it; on a selected one it
    // deselects. Nothing here selects a range the user did not ask for.
    const wasOnly = media.selected.size === 1 && media.selected.has(file.path);
    media.selected.clear();
    if (!wasOnly) media.selected.add(file.path);
    media.anchor = file.path;
  }

  media.focused = file.path;
  syncCells();
  updateSelection();
  renderDetail(file);
}

function toggle(path) {
  if (media.selected.has(path)) media.selected.delete(path);
  else media.selected.add(path);
}

function syncCells() {
  for (const cell of $('media-canvas').children) {
    const selected = media.selected.has(cell.dataset.path);
    cell.classList.toggle('is-selected', selected);
    cell.setAttribute('aria-selected', String(selected));
    cell.classList.toggle('is-focused', media.focused === cell.dataset.path);
  }
}

function updateSelection() {
  const count = media.selected.size;
  let bytes = 0;
  let synced = 0;
  for (const file of media.files) {
    if (!media.selected.has(file.path)) continue;
    bytes += file.size;
    if (file.cloudService) synced += 1;
  }

  const status = $('media-selection');
  if (count === 0) {
    status.textContent = t('app.nothingSelected', 'Nothing selected');
  } else {
    status.textContent =
      t('app.selectedCount', '{n} selected · {size}', { n: formatCount(count), size: formatBytes(bytes) }) +
      (synced
        ? ` · ${t('media.selectedSynced', '{n} synced to the cloud', { n: formatCount(synced) })}`
        : '');
  }
  $('media-delete').disabled = count === 0;

  const badge = $('media-badge');
  if (media.files.length > 0) {
    badge.textContent = formatCount(media.files.length);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

/* ------------------------------------------------------------------ detail */

/**
 * One picture, and the reasoning behind where it was filed.
 *
 * The evidence list is the point. This app's rule is that a conclusion always
 * arrives with its grounds, and on this screen the conclusion was reached by
 * combining several weak signals -- so one sentence would not be honest. The
 * user sees all of them, in the order they were weighed, and can tell which one
 * is wrong if they disagree.
 */
function renderDetail(file) {
  const panel = $('media-detail');
  panel.replaceChildren();
  if (!file) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const preview = document.createElement('div');
  preview.className = 'detail-preview';
  const thumb = media.thumbs.get(file.path);
  if (thumb && thumb.dataUri) {
    const img = document.createElement('img');
    img.src = thumb.dataUri;
    img.alt = '';
    preview.appendChild(img);
  }
  panel.appendChild(preview);

  const name = document.createElement('h3');
  name.className = 'detail-name';
  name.textContent = file.name;
  name.title = file.path;
  panel.appendChild(name);

  /* -- the verdict, and how sure it is ---------------------------------- */

  const verdict = document.createElement('div');
  verdict.className = 'detail-verdict';

  const label = document.createElement('span');
  label.className = 'detail-origin';
  label.textContent = file.app
    ? `${labelFor(ORIGIN_LABEL, file.origin)} · ${file.app}`
    : labelFor(ORIGIN_LABEL, file.origin);

  const strength = document.createElement('span');
  strength.className = `detail-strength is-${file.strength}`;
  strength.textContent = strengthWord(file.strength);

  verdict.append(label, strength);
  panel.appendChild(verdict);

  const why = document.createElement('ul');
  why.className = 'detail-why';
  for (const reason of file.why) {
    const li = document.createElement('li');
    li.textContent = tm(reason);
    why.appendChild(li);
  }
  panel.appendChild(why);

  /* -- the facts -------------------------------------------------------- */

  const facts = document.createElement('dl');
  facts.className = 'detail-facts';

  /*
   * The label is translated at the call site rather than by key inside here.
   *
   * `test-i18n.js` finds the keys an app asks for by looking for `t(` with a
   * literal key beside it, and a helper taking the key as an argument hides
   * every one of them -- the dictionary then reads as having dead entries while
   * the screen is perfectly translated. Passing the rendered label keeps the
   * keys where the checker can see them.
   */
  const add = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    facts.append(dt, dd);
  };

  add(t('media.fact.size', 'Size'), formatBytes(file.size));
  if (file.width && file.height) {
    add(t('media.fact.dimensions', 'Dimensions'), `${formatCount(file.width)} × ${formatCount(file.height)}`);
  }
  if (file.megapixels) add(t('media.fact.megapixels', 'Megapixels'), String(file.megapixels));
  if (file.durationSec) add(t('media.fact.duration', 'Length'), formatClock(file.durationSec));
  if (file.bitrateKbps) add(t('media.fact.bitrate', 'Bitrate'), `${formatCount(file.bitrateKbps)} kbps`);
  add(t('media.fact.format', 'Format'), file.format ? file.format.toUpperCase() : null);
  add(t('media.fact.camera', 'Camera'), file.camera);
  add(t('media.fact.lens', 'Lens'), file.lens);
  add(t('media.fact.software', 'Software'), file.software);
  if (file.takenAt) {
    add(t('media.fact.taken', 'Taken'), new Date(file.takenAt).toLocaleString(uiLocale()));
  }
  add(t('media.fact.modified', 'Modified'), new Date(file.mtimeMs).toLocaleString(uiLocale()));
  if (file.bytesPerPixel) {
    add(t('media.fact.bpp', 'Bytes per pixel'), String(file.bytesPerPixel));
  }
  add(t('media.fact.cloud', 'Synced with'), file.cloudService);

  const measured = media.thumbs.get(file.path);
  if (measured && measured.detail !== null && measured.detail !== undefined) {
    add(t('media.fact.detail', 'Detail'), formatCount(measured.detail));
  }

  panel.appendChild(facts);

  /* -- what it is, with the reason for each ------------------------------ */

  if (file.traits.length) {
    const traits = document.createElement('ul');
    traits.className = 'detail-traits';
    for (const trait of file.traits) {
      const li = document.createElement('li');
      const key = document.createElement('strong');
      key.textContent = labelFor(TRAIT_LABEL, trait.key);
      const reason = document.createElement('span');
      reason.textContent = tm(trait.evidence);
      li.append(key, reason);
      traits.appendChild(li);
    }
    panel.appendChild(traits);
  }

  const actions = document.createElement('div');
  actions.className = 'panel-actions panel-actions-tight';
  actions.append(
    linkButton(t('app.reveal', 'Reveal'), () => api.reveal(file.path)),
    linkButton(t('app.open', 'Open'), async () => unwrap(await api.open(file.path), t('app.open', 'Open')))
  );
  panel.appendChild(actions);
}

function strengthWord(strength) {
  switch (strength) {
    case 'certain': return t('media.strength.certain', 'certain');
    case 'strong': return t('media.strength.strong', 'strong evidence');
    case 'likely': return t('media.strength.likely', 'likely');
    default: return t('media.strength.guess', 'a guess');
  }
}

/* ------------------------------------------------------------------ roots */

async function loadRoots() {
  const list = unwrap(await api.mediaRoots(), t('media.label.folders', 'Photo folders'));
  if (!list) return;
  media.roots = list.map((entry) => ({ ...entry, on: entry.defaultOn }));
  renderRoots();
}

function renderRoots() {
  const container = $('media-roots');
  container.replaceChildren();

  for (const entry of [...media.roots, ...media.extraRoots]) {
    const row = document.createElement('label');
    row.className = 'check';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = entry.on;
    box.addEventListener('change', () => {
      entry.on = box.checked;
    });

    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const why = document.createElement('span');
    why.className = 'check-note';
    why.textContent = entry.why ? tm(entry.why) : entry.path;
    text.append(name, document.createElement('br'), why);

    row.append(box, text);
    row.title = entry.path;

    if (entry.cloudService) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-review';
      badge.textContent = entry.cloudService;
      badge.title = t('media.cloudRoot', 'This folder syncs to {service}', { service: entry.cloudService });
      row.appendChild(badge);
    }

    container.appendChild(row);
  }
}

function chosenRoots() {
  return [...media.roots, ...media.extraRoots].filter((entry) => entry.on).map((entry) => entry.path);
}

/* ------------------------------------------------------------------ the scan */

function setScanning(running) {
  media.scanning = running;
  $('media-scan').disabled = running;
  $('media-cancel').hidden = !running;
  $('media-progress').hidden = !running;
}

api.onMediaProgress((p) => {
  $('media-status').textContent =
    p.phase === 'walking'
      ? t('media.progress.walking', 'Looking through folders… {n} pictures and videos so far', {
          n: formatCount(p.media),
        })
      : t('media.progress.reading', 'Reading {done} of {total}…', {
          done: formatCount(p.probed),
          total: formatCount(p.media),
        });
});

// Files arrive in batches while the scan is still running, so the grid starts
// filling immediately rather than after everything has been read.
api.onMediaBatch((batch) => {
  media.files.push(...batch);
  applyFilters();
});

$('media-scan').addEventListener('click', async () => {
  const roots = chosenRoots();
  if (roots.length === 0) {
    toast(t('media.noFolders', 'No folders are ticked — open “Where to look” and choose at least one.'), true);
    $('media-roots-card').hidden = false;
    return;
  }

  setScanning(true);
  media.files = [];
  media.selected.clear();
  media.focused = null;
  media.anchor = null;
  media.thumbs.clear();
  media.pending.clear();
  $('media-empty').hidden = true;
  renderDetail(null);

  const result = unwrap(await api.scanMedia(roots), t('media.label.scan', 'Photo scan'));
  setScanning(false);
  if (!result) {
    $('media-status').textContent = t('media.failed', 'The scan could not finish.');
    return;
  }

  media.files = result.files;
  media.displays = result.displays || [];
  media.excluded = result.excluded || [];
  renderExcluded();
  applyFilters();
  reportScan(result);
});

function reportScan(result) {
  const parts = [
    t('media.found', 'Found {n} pictures and videos · {size}.', {
      n: formatCount(result.files.length),
      size: formatBytes(result.totalBytes),
    }),
  ];

  if (result.hidden > 0) {
    parts.push(
      t('media.hiddenAssets', '{n} more were a program’s own artwork and are not shown.', {
        n: formatCount(result.hidden),
      })
    );
  }
  if (result.stats.dehydrated > 0) {
    parts.push(
      t('media.onlineOnly', '{n} are stored online only and were not opened, so nothing was downloaded.', {
        n: formatCount(result.stats.dehydrated),
      })
    );
  }
  if (result.stats.unreadable > 0) {
    parts.push(t('media.unreadable', '{n} could not be read.', { n: formatCount(result.stats.unreadable) }));
  }
  if (result.cancelled) parts.push(t('app.cancelledPartial', 'Cancelled — results are partial.'));

  $('media-status').textContent = parts.join(' ');

  const empty = result.files.length === 0;
  $('media-layout').hidden = empty;
  $('media-toolbar').hidden = empty;
  $('media-empty').hidden = !empty;
  if (empty) {
    $('media-empty').textContent = t(
      'media.empty',
      'No pictures or videos in the folders that are ticked. Open “Where to look” to add one.'
    );
  }
}

function renderExcluded() {
  const list = $('media-excluded');
  list.replaceChildren();
  if (!media.excluded.length) return;

  const heading = document.createElement('li');
  heading.className = 'path-note';
  heading.textContent = t('media.excludedTitle', 'Folders that were not searched');
  list.appendChild(heading);

  for (const group of media.excluded.slice(0, 8)) {
    const li = document.createElement('li');
    const count = document.createElement('strong');
    count.textContent = formatCount(group.count);
    const reason = document.createElement('span');
    reason.textContent = ` ${tm(group.reason)}`;
    const examples = document.createElement('span');
    examples.className = 'path-example';
    examples.textContent = group.examples.map((e) => e.name).join(', ');
    li.append(count, reason, examples);
    list.appendChild(li);
  }
}

$('media-cancel').addEventListener('click', () => api.cancelMediaScan());

/* ------------------------------------------------------------------ wiring */

$('media-folders').addEventListener('click', () => {
  const card = $('media-roots-card');
  card.hidden = !card.hidden;
});
$('media-roots-close').addEventListener('click', () => {
  $('media-roots-card').hidden = true;
});

$('media-add-folder').addEventListener('click', async () => {
  const folder = unwrap(await api.pickFolder(), t('app.label.folderPicker', 'Folder picker'));
  if (!folder) return;
  if ([...media.roots, ...media.extraRoots].some((entry) => entry.path === folder)) return;
  media.extraRoots.push({
    path: folder,
    name: folder.split(/[\\/]/).filter(Boolean).pop() || folder,
    why: null,
    on: true,
  });
  renderRoots();
});

$('media-sort').addEventListener('change', () => {
  media.sort = $('media-sort').value;
  sortShown();
  renderGrid(true);
});

$('media-select-filtered').addEventListener('click', () => {
  // The only bulk action on this screen, and it acts on a filter the user chose
  // and can see the count of. Nothing here decides for them what is disposable.
  for (const file of media.shown) media.selected.add(file.path);
  syncCells();
  updateSelection();
});

$('media-select-none').addEventListener('click', () => {
  media.selected.clear();
  syncCells();
  updateSelection();
});

$('media-delete').addEventListener('click', async () => {
  await deleteSelected([...media.selected], (moved) => {
    const gone = new Set(moved.map((m) => m.path));
    media.files = media.files.filter((f) => !gone.has(f.path));
    for (const path of gone) {
      media.selected.delete(path);
      media.thumbs.delete(path);
    }
    media.focused = null;
    renderDetail(null);
    applyFilters();
  }, { context: 'media' });
});

$('media-grid').addEventListener(
  'scroll',
  () => {
    if (gridFrame) return;
    gridFrame = requestAnimationFrame(() => {
      gridFrame = null;
      renderGrid();
    });
  },
  { passive: true }
);

// A narrower window means fewer columns, which moves every cell. Rebuilding on
// the observer rather than on `window.resize` catches the sidebar being dragged
// as well, which does not fire a window resize at all.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (!$('media-layout').hidden) renderGrid();
  }).observe($('media-grid'));
}

/* ---- keyboard ---- */

$('media-grid').addEventListener('keydown', (event) => {
  if (media.shown.length === 0) return;
  const { columns } = gridMetrics();
  const current = media.focused ? media.shown.findIndex((f) => f.path === media.focused) : -1;

  let next = current;
  switch (event.key) {
    case 'ArrowRight': next = current + 1; break;
    case 'ArrowLeft': next = current - 1; break;
    case 'ArrowDown': next = current + columns; break;
    case 'ArrowUp': next = current - columns; break;
    case 'Home': next = 0; break;
    case 'End': next = media.shown.length - 1; break;
    case ' ':
      if (media.focused) {
        toggle(media.focused);
        syncCells();
        updateSelection();
        event.preventDefault();
      }
      return;
    default: return;
  }

  event.preventDefault();
  next = Math.max(0, Math.min(media.shown.length - 1, next < 0 ? 0 : next));
  const file = media.shown[next];
  media.focused = file.path;
  if (!event.shiftKey) media.anchor = file.path;

  // Scroll the focused cell into view without jumping: only move if it is
  // actually outside the viewport.
  const grid = $('media-grid');
  const row = Math.floor(next / columns);
  const top = row * (CELL_H + GAP);
  if (top < grid.scrollTop) grid.scrollTop = top;
  else if (top + CELL_H > grid.scrollTop + grid.clientHeight) {
    grid.scrollTop = top + CELL_H - grid.clientHeight;
  }

  renderGrid();
  syncCells();
  renderDetail(file);
});

/* ---- language ---- */

onLanguageChange(() => {
  renderRoots();
  renderChips();
  renderExcluded();
  renderGrid();
  updateSelection();
  const focused = media.shown.find((f) => f.path === media.focused);
  renderDetail(focused || null);
});

loadRoots();
