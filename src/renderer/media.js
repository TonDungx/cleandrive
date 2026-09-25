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
  /** Whether the trait row is showing the ones that barely divide anything. */
  traitsExpanded: false,
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

/**
 * The page's scroller, which is also the grid's.
 *
 * The first version gave the grid `overflow-y: auto` and a height of
 * `min(70vh, 720px)`. That is two nested scrollbars, and it caps the grid at a
 * slot however much room the window has. It now scrolls with the page like
 * everything else, so the overview above it scrolls away and the pictures get
 * the rest -- which means the virtualisation has to read this element's scroll
 * position and work out where the canvas sits inside it.
 */
const pageScroller = () => document.querySelector('main');

function gridMetrics() {
  const grid = $('media-grid');
  const width = Math.max(CELL, grid.clientWidth || 800);
  const columns = Math.max(1, Math.floor((width + GAP) / (CELL + GAP)));
  const rows = Math.ceil(media.shown.length / columns);
  return { columns, rows, width };
}

/** Which slice of the canvas is on screen, in canvas coordinates. */
function visibleBand() {
  const scroller = pageScroller();
  const canvas = $('media-canvas');
  if (!scroller || !canvas) return { top: 0, height: 900 };

  // Where the canvas begins, measured against the scroller rather than the
  // document: the panel above it changes height as filters come and go.
  const offset = canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  return {
    top: Math.max(0, -offset),
    height: scroller.clientHeight,
  };
}

/* ------------------------------------------------------------------ filters */

/**
 * What the library is made of, by count and by bytes.
 *
 * Recomputed from the full set every time rather than kept up to date
 * incrementally: it is one pass over an array the renderer already has, and an
 * incremental count that drifts is worse than no count.
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
    // these are filters, not a partition.
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
  renderOverview();
  renderTokens();
  renderGrid(true);
  updateSelection();
}

function clearFilters() {
  media.filters = { origin: null, trait: null, year: null };
  applyFilters();
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

/* ------------------------------------------------------------------ labels */

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

/* ------------------------------------------------------------------ overview */

/** How many trait chips are offered before "show more". */
const TRAIT_VISIBLE = 7;

/**
 * Traits, ordered by how much they actually divide the library.
 *
 * The first version showed all seventeen, and the widest chip on screen read
 * "Synced to the cloud 4,032 · 2.0 GB" out of a library of 4,062 -- ninety-nine
 * per cent of it, and therefore no help at all in finding anything. A filter
 * that matches almost everything, or almost nothing, splits nothing.
 *
 * So the ranking is the size of the *smaller* side of the split. A trait
 * matching half the library scores highest; one matching all of it or one file
 * of it scores near zero, and both fall to the bottom together. That is one
 * expression rather than two thresholds, and it has no cliff -- an earlier
 * attempt cut at "more than 2 and under 80%" and left a card holding a single
 * chip on any small library, because almost everything fell off one edge or the
 * other.
 *
 * Nothing is removed, only ordered: "show more" reveals the rest, because
 * "which of my pictures record where they were taken" is a real question even
 * when the answer is nearly all of them.
 */
function rankedTraits(traits, total) {
  return [...traits.entries()].sort((a, b) => {
    const split = (stat) => Math.min(stat.count, Math.max(0, total - stat.count));
    return split(b[1]) - split(a[1]) || b[1].bytes - a[1].bytes;
  });
}

/**
 * Opacity for a segment of the origin bar.
 *
 * Seven weights of one accent rather than seven hues. This app rations colour
 * -- green, amber and red are reserved for verdicts -- so a rainbow here would
 * spend the one thing the interface is careful with on a chart legend. It also
 * reads as one object rather than a pie, which is what it is: the library.
 */
function shadeFor(index, count) {
  if (count <= 1) return 0.92;
  const top = 0.92;
  const bottom = 0.26;
  return top - ((top - bottom) * index) / (count - 1);
}

function renderOverview() {
  const panel = $('media-overview');
  if (media.files.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.classList.toggle(
    'is-filtered',
    Boolean(media.filters.origin || media.filters.trait || media.filters.year !== null)
  );

  const { origin, trait, year } = facets();
  const totalBytes = media.files.reduce((n, f) => n + f.size, 0);

  $('ov-total').textContent = t('media.overviewTotal', '{n} files · {size}', {
    n: formatCount(media.files.length),
    size: formatBytes(totalBytes),
  });

  renderOriginBar(origin, totalBytes);
  renderYears(year);
  renderTraits(trait);
}

/**
 * The library as one bar, divided by where its pictures came from.
 *
 * This replaces a row of chips, and carries more than they did: a chip says a
 * source exists and how big it is, while a segment says what *share* of the
 * library it is, which is the question somebody clearing space is actually
 * asking. Sized by bytes rather than by count for the same reason -- 3,450
 * screenshots at 674 MB matter less than 463 photographs at 1.3 GB.
 */
function renderOriginBar(origin, totalBytes) {
  const bar = $('ov-origin-bar');
  const legend = $('ov-origin-legend');
  bar.replaceChildren();
  legend.replaceChildren();

  const entries = [...origin.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  if (entries.length === 0 || totalBytes === 0) return;

  entries.forEach(([key, stat], index) => {
    const share = (stat.bytes / totalBytes) * 100;
    const shade = shadeFor(index, entries.length);
    const name = labelFor(ORIGIN_LABEL, key);
    const active = media.filters.origin === key;
    const detail = `${name} · ${formatCount(stat.count)} · ${formatBytes(stat.bytes)}`;

    const seg = document.createElement('button');
    seg.className = 'ov-seg';
    seg.classList.toggle('is-active', active);
    // A share below about a quarter of a per cent would otherwise be invisible;
    // `min-width` in the stylesheet keeps it clickable.
    seg.style.flex = `${Math.max(share, 0.25)} 1 0`;
    seg.style.opacity = String(shade);
    seg.title = detail;
    seg.setAttribute('aria-label', detail);
    seg.setAttribute('aria-pressed', String(active));
    seg.addEventListener('click', () => pickOrigin(key));
    bar.appendChild(seg);

    const key1 = document.createElement('button');
    key1.className = 'ov-key';
    key1.classList.toggle('is-active', active);
    key1.title = detail;

    const dot = document.createElement('span');
    dot.className = 'ov-dot';
    dot.style.opacity = String(shade);

    const text = document.createElement('span');
    text.textContent = name;

    const size = document.createElement('span');
    size.className = 'ov-key-size';
    size.textContent = formatBytes(stat.bytes);

    key1.append(dot, text, size);
    key1.addEventListener('click', () => pickOrigin(key));
    legend.appendChild(key1);
  });
}

/**
 * The years as a histogram rather than as a row of chips.
 *
 * A year is a position on an axis, and nine chips in a row throw that away --
 * they say which years exist but not what the library looks like over time.
 * Bars say both, in less space, and the gap where a year has nothing is itself
 * an answer.
 */
function renderYears(year) {
  const card = $('ov-years-card');
  const host = $('ov-years');
  host.replaceChildren();

  const entries = [...year.entries()]
    .filter(([key]) => key !== null && Number.isFinite(key))
    .sort((a, b) => a[0] - b[0]);

  // One year is not a distribution; the card would be a single bar saying
  // nothing the total does not already say.
  if (entries.length < 2) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const first = entries[0][0];
  const last = entries[entries.length - 1][0];
  $('ov-years-note').textContent = `${first}–${last}`;

  // Gaps are drawn, not skipped: a year with nothing in it is a fact about the
  // library, and closing the gap would quietly redraw its history.
  const byYear = new Map(entries);
  const biggest = Math.max(...entries.map(([, stat]) => stat.bytes));
  const span = last - first + 1;
  // Every year gets a label when there is room; beyond that every other one,
  // and the ends always. A short span gets the whole year written out, because
  // "22 23 24" is a decade short of unambiguous and there is space for "2022".
  const step = span <= 12 ? 1 : Math.ceil(span / 10);
  const shortLabels = span > 8;

  for (let y = first; y <= last; y++) {
    const stat = byYear.get(y);
    const active = media.filters.year === y;

    const column = document.createElement('button');
    column.className = 'ov-year';
    column.classList.toggle('is-active', active);
    column.setAttribute('aria-pressed', String(active));

    const detail = stat
      ? `${y} · ${formatCount(stat.count)} · ${formatBytes(stat.bytes)}`
      : t('media.yearEmpty', '{year} · nothing', { year: y });
    column.title = detail;
    column.setAttribute('aria-label', detail);

    // The bar lives in a track of its own rather than directly in the column.
    // With the fill's percentage measured against the whole column, a
    // full-height bar plus the label beneath it came to more than the column,
    // and the last year's label was sliced off by the card's edge.
    const track = document.createElement('span');
    track.className = 'ov-year-track';

    const fill = document.createElement('span');
    fill.className = 'ov-year-fill';
    fill.style.height = stat ? `${Math.max(4, (stat.bytes / biggest) * 100)}%` : '0';
    track.appendChild(fill);

    const label = document.createElement('span');
    label.className = 'ov-year-label';
    const show = y === first || y === last || (y - first) % step === 0;
    label.textContent = show ? (shortLabels ? String(y % 100).padStart(2, '0') : String(y)) : '';

    column.append(track, label);
    if (stat) column.addEventListener('click', () => pickYear(y));
    else column.disabled = true;
    host.appendChild(column);
  }
}

function renderTraits(trait) {
  const card = $('ov-traits-card');
  const host = $('ov-traits');
  const more = $('ov-traits-more');
  host.replaceChildren();

  const ranked = rankedTraits(trait, media.files.length);
  if (ranked.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const shown = media.traitsExpanded ? ranked : ranked.slice(0, TRAIT_VISIBLE);
  for (const [key, stat] of shown) {
    host.appendChild(
      chip(labelFor(TRAIT_LABEL, key), stat, media.filters.trait === key, () => pickTrait(key))
    );
  }

  const hidden = ranked.length - shown.length;
  more.hidden = hidden <= 0 && !media.traitsExpanded;
  more.textContent = media.traitsExpanded
    ? t('media.showFewer', 'Show fewer')
    : t('media.showMore', '{n} more', { n: formatCount(hidden) });
}

function chip(name, stat, active, onPick) {
  const el = document.createElement('button');
  el.className = 'chip';
  el.classList.toggle('is-active', active);
  el.setAttribute('aria-pressed', String(active));

  const label = document.createElement('span');
  label.className = 'chip-name';
  label.textContent = name;

  // The count and the size together. A chip that does not say how much it holds
  // is a chip you have to click to find out whether it was worth clicking.
  const meta = document.createElement('span');
  meta.className = 'chip-meta';
  meta.textContent = `${formatCount(stat.count)} · ${formatBytes(stat.bytes)}`;

  el.append(label, meta);
  el.addEventListener('click', onPick);
  return el;
}

/* ---- the active filters, in the pinned bar ---- */

/**
 * What is being looked at, kept in the one part of the screen that does not
 * scroll away.
 *
 * The overview sets the filters and then scrolls out of sight, so without this
 * somebody who has scrolled a few screens into a filtered grid has no way of
 * telling it is filtered -- which is the sort of thing that ends with a
 * selection nobody meant to make.
 */
function renderTokens() {
  const host = $('media-tokens');
  host.replaceChildren();

  const add = (text, clear) => {
    const token = document.createElement('button');
    token.className = 'token';
    token.title = t('media.removeFilter', 'Remove this filter');

    const label = document.createElement('span');
    label.textContent = text;

    const x = document.createElement('span');
    x.className = 'token-x';
    x.textContent = '×';
    x.setAttribute('aria-hidden', 'true');

    token.append(label, x);
    token.addEventListener('click', clear);
    host.appendChild(token);
  };

  if (media.filters.origin) {
    add(labelFor(ORIGIN_LABEL, media.filters.origin), () => pickOrigin(media.filters.origin));
  }
  if (media.filters.trait) {
    add(labelFor(TRAIT_LABEL, media.filters.trait), () => pickTrait(media.filters.trait));
  }
  if (media.filters.year !== null) {
    add(String(media.filters.year), () => pickYear(media.filters.year));
  }
}

/* ---- picking, which always toggles ---- */

function pickOrigin(key) {
  media.filters.origin = media.filters.origin === key ? null : key;
  applyFilters();
}

function pickTrait(key) {
  media.filters.trait = media.filters.trait === key ? null : key;
  applyFilters();
}

function pickYear(value) {
  media.filters.year = media.filters.year === value ? null : value;
  applyFilters();
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
  const canvas = $('media-canvas');
  const { columns, rows } = gridMetrics();

  // Changing the filter changes what the grid is showing, so the reading
  // position from the last set of results means nothing against the new one.
  // The page is scrolled back to the panel's top rather than to the document's,
  // so the overview stays where it was and only the results move.
  if (reset) {
    const scroller = pageScroller();
    if (scroller) scroller.scrollTop = 0;
  }

  // The canvas is the full height the whole list would occupy, so the scrollbar
  // is honest about how much there is even though the cells do not exist.
  canvas.style.height = `${Math.max(0, rows * (CELL_H + GAP) - GAP)}px`;

  const band = visibleBand();
  const first = Math.max(0, Math.floor(band.top / (CELL_H + GAP)) - OVERSCAN_ROWS);
  const visibleRows = Math.ceil(band.height / (CELL_H + GAP)) + OVERSCAN_ROWS * 2;
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

  /*
   * The tick is a button, and it toggles.
   *
   * It was a decoration -- `aria-hidden`, no handler -- drawn on hover because
   * it looked right. It looked like a checkbox, so people clicked it like one,
   * and the click fell through to the cell, whose plain-click behaviour is
   * "clear the selection and take only this". Ticking three pictures left one
   * selected. The affordance promised multi-select and the handler underneath
   * it did the opposite.
   *
   * Clicking the picture still means "show me this one". Clicking the tick
   * means "add this to what I am choosing", which is what every photo app on
   * the machine already taught the user it means.
   */
  const tick = document.createElement('button');
  tick.className = 'media-tick';
  tick.type = 'button';
  tick.tabIndex = -1;
  tick.title = t('media.tickHint', 'Add to the selection (or shift-click to take a run of them)');
  tick.setAttribute('aria-label', tick.title);
  tick.addEventListener('click', (event) => {
    // Stop it reaching the cell, or the cell would immediately replace the
    // selection this just added to.
    event.stopPropagation();
    onTickClick(file, index, event);
  });
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

/**
 * The tick: add this one, or everything between it and the last one ticked.
 *
 * Shift here extends without needing the keyboard to have been involved in the
 * first click, which is the thing that makes choosing forty pictures bearable:
 * tick the first, shift-tick the fortieth.
 */
function onTickClick(file, index, event) {
  if (event.shiftKey && media.anchor !== null) {
    extendTo(index);
  } else {
    toggle(file.path);
    media.anchor = file.path;
  }

  media.focused = file.path;
  syncCells();
  updateSelection();
  // Deliberately not touching the detail panel. Ticking is choosing, not
  // looking, and having the panel jump about while somebody works down a row
  // of pictures is the sort of movement that makes a screen feel unsteady.
}

function extendTo(index) {
  const from = media.shown.findIndex((f) => f.path === media.anchor);
  if (from < 0) return;
  const [lo, hi] = from < index ? [from, index] : [index, from];
  for (let i = lo; i <= hi; i++) media.selected.add(media.shown[i].path);
}

function onCellClick(file, index, event) {
  if (event.shiftKey && media.anchor !== null) {
    extendTo(index);
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

// Beside the button, the sentence every screen's action carries: moving a
// photograph to the Recycle Bin frees nothing until the bin is emptied.
const mediaFrees = FreesBadge(false);
pairUp(mediaFrees, $('media-delete'));
// And beside "Move to D:" (B1), what that frees -- which depends on a setting.
const mediaQuarantineFrees = FreesBadge(false, 'quarantine');
pairUp(mediaQuarantineFrees, $('media-quarantine'));

function updateSelection() {
  const count = media.selected.size;
  mediaFrees.hidden = count === 0;
  mediaQuarantineFrees.hidden = count === 0;
  $('media-quarantine').disabled = count === 0;
  $('media-quarantine').hidden = count === 0;
  let bytes = 0;
  let synced = 0;
  for (const file of media.files) {
    if (!media.selected.has(file.path)) continue;
    bytes += file.size;
    if (file.cloudService) synced += 1;
  }

  const status = $('media-selection');
  if (count === 0) {
    // With nothing chosen the bar is not empty and it is not a toolbar either:
    // it says what is in front of you, which is the one thing worth knowing
    // before you start picking.
    status.textContent = t('media.showingCount', 'Showing {n} · {size}', {
      n: formatCount(media.shown.length),
      size: formatBytes(media.shown.reduce((n, f) => n + f.size, 0)),
    });
  } else {
    status.textContent =
      t('app.selectedCount', '{n} selected · {size}', { n: formatCount(count), size: formatBytes(bytes) }) +
      (synced
        ? ` · ${t('media.selectedSynced', '{n} synced to the cloud', { n: formatCount(synced) })}`
        : '');
  }

  // Once anything is chosen the whole grid shows its ticks, so adding the next
  // one is never a thing you have to go hunting for under the pointer.
  $('media-grid').classList.toggle('is-choosing', count > 0);

  $('media-delete').disabled = count === 0;
  $('media-delete').hidden = count === 0;
  $('media-select-none').hidden = count === 0;
  // "Select everything shown" is only an offer while there is something left
  // to select; once everything is, it is a button that does nothing.
  $('media-select-filtered').hidden = media.shown.length === 0 || count === media.shown.length;
  // The bar exists only when there are results to act on. No results, no bar,
  // and the screen is the pictures and nothing else.
  $('media-actionbar').hidden = media.files.length === 0;

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
  strength.className = `detail-strength is-${file.confidence}`;
  strength.textContent = confidenceWord(file.confidence);

  verdict.append(label, strength);
  panel.appendChild(verdict);

  const why = document.createElement('ul');
  why.className = 'detail-why';
  for (const reason of file.evidence) {
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
    linkButton(t('app.view', 'View'), () => openViewer(file.path), 'is-lead'),
    linkButton(t('app.reveal', 'Reveal'), () => api.reveal(file.path)),
    linkButton(t('app.open', 'Open'), async () => unwrap(await api.open(file.path), t('app.open', 'Open')))
  );
  panel.appendChild(actions);
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
  media.files.push(...batch.map(candidateView));
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

  media.files = result.files.map(candidateView);
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

  // The headline count lives in the overview card, where it sits under the bar
  // that divides it up. What is left for the bar is what the bar is for: what
  // just happened, and anything that went wrong.
  $('media-status').textContent = parts.slice(1).join(' ');

  const empty = result.files.length === 0;
  $('media-layout').hidden = empty;
  $('media-sort-field').hidden = empty;
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
  media.focused = null;
  syncCells();
  updateSelection();
  // Clearing the selection closes the detail panel with it, which hands the
  // grid back three hundred pixels -- two more columns at the default width.
  renderDetail(null);
  renderGrid();
});

// The same grid after either action: to the bin, or to another drive (B1).
const onMediaAction = (kind) => async () => {
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
  }, { context: 'media', kind });
};
$('media-delete').addEventListener('click', onMediaAction('recycle'));
$('media-quarantine').addEventListener('click', onMediaAction('quarantine'));

$('ov-traits-more').addEventListener('click', () => {
  media.traitsExpanded = !media.traitsExpanded;
  renderOverview();
});

// The page is the grid's scroller now, so this is where the virtualisation
// listens. Coalesced to one pass per frame: a fling produces a scroll event per
// frame and rebuilding the visible rows twice in one frame paints nothing extra.
pageScroller().addEventListener(
  'scroll',
  () => {
    if (gridFrame || $('media-layout').hidden) return;
    gridFrame = requestAnimationFrame(() => {
      gridFrame = null;
      renderGrid();
    });
  },
  { passive: true }
);

/**
 * A narrower window means fewer columns, which moves every cell.
 *
 * Watched with an observer rather than `window.resize`, because the sidebar can
 * be dragged narrower without the window changing size at all.
 *
 * **Width only, and deferred.** Once the grid stopped having a height of its
 * own it grew with its canvas -- so `renderGrid` set the canvas height, which
 * resized the grid, which woke the observer, which called `renderGrid`. Chromium
 * breaks that cycle itself and says so: "ResizeObserver loop completed with
 * undelivered notifications", which the smoke test counts as a renderer error
 * and is right to. Columns depend on width and nothing else, so a height change
 * has nothing to tell us.
 */
if (typeof ResizeObserver !== 'undefined') {
  let lastWidth = 0;
  new ResizeObserver(() => {
    if ($('media-layout').hidden) return;
    const width = $('media-grid').clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    // Out of the observer's own callback, so the relayout it causes belongs to
    // the next frame rather than to this one.
    requestAnimationFrame(() => renderGrid());
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
    case 'Escape':
      // The detail panel takes three hundred pixels of a screen whose width is
      // columns of photographs, and until this there was no way to give them
      // back: selecting anything opened it and nothing closed it.
      media.selected.clear();
      media.focused = null;
      media.anchor = null;
      syncCells();
      updateSelection();
      renderDetail(null);
      renderGrid();
      event.preventDefault();
      return;
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
  // actually outside the viewport. Measured against the page, which is what
  // scrolls now -- and the canvas's own offset has to come into it, because
  // the overview above changes height as filters come and go.
  const scroller = pageScroller();
  const canvas = $('media-canvas');
  const canvasTop =
    canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const row = Math.floor(next / columns);
  const top = canvasTop + row * (CELL_H + GAP);
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (top + CELL_H > scroller.scrollTop + scroller.clientHeight) {
    scroller.scrollTop = top + CELL_H - scroller.clientHeight;
  }

  renderGrid();
  syncCells();
  renderDetail(file);
});

/* ---- language ---- */

onLanguageChange(() => {
  renderRoots();
  renderOverview();
  renderTokens();
  renderExcluded();
  renderGrid();
  updateSelection();
  const focused = media.shown.find((f) => f.path === media.focused);
  renderDetail(focused || null);
});

loadRoots();
