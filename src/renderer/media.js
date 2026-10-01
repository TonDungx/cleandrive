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
  // `when` is the timeline's filter and its zoom at once (E4): nulls all the
  // way down means every year, and each level filled in is one level further
  // in. See `renderTimeline` for why those are deliberately one thing.
  filters: { origin: null, trait: null, when: { year: null, month: null, day: null }, conversation: null, place: null },
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
  // Not a partition like the three above: most files have no conversation,
  // and `bump` skips a null key, so this map counts the chat pictures only.
  const conversation = new Map();

  const bump = (map, key, size) => {
    if (key === null || key === undefined) return;
    const entry = map.get(key) || { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += size;
    map.set(key, entry);
  };

  for (const file of media.files) {
    bump(origin, file.origin, file.size);
    bump(conversation, file.conversation, file.size);
    // A file can wear several traits, so it is counted under each of them --
    // these are filters, not a partition.
    for (const one of file.traits) bump(trait, one.key, file.size);
  }

  return { origin, trait, conversation };
}

function applyFilters() {
  const { origin, trait, when, conversation, place } = media.filters;

  media.shown = media.files.filter((file) => {
    if (origin && file.origin !== origin) return false;
    if (!matchesWhen(file, when)) return false;
    // A place is a set of pictures rather than a value on a file (E4): what
    // was clicked was a cluster of pins, and which pictures that cluster held
    // is a question only the map, at the zoom it was drawn at, can answer.
    if (place && !place.paths.has(file.path)) return false;
    if (trait && !file.traits.some((one) => one.key === trait)) return false;
    if (conversation && file.conversation !== conversation) return false;
    return true;
  });

  sortShown();
  renderOverview();
  renderTokens();
  renderGrid(true);
  updateSelection();
}

function clearFilters() {
  media.filters = { origin: null, trait: null, when: { year: null, month: null, day: null }, conversation: null, place: null };
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
    Boolean(
      media.filters.origin ||
        media.filters.trait ||
        media.filters.when.year !== null ||
        media.filters.place ||
        media.filters.conversation
    )
  );

  const { origin, trait, conversation } = facets();
  const totalBytes = media.files.reduce((n, f) => n + f.size, 0);

  $('ov-total').textContent = t('media.overviewTotal', '{n} files · {size}', {
    n: formatCount(media.files.length),
    size: formatBytes(totalBytes),
  });

  renderOriginBar(origin, totalBytes);
  renderTimeline();
  if (window.MediaMap) window.MediaMap.draw();
  renderTraits(trait);
  renderConversations(conversation);
}

/**
 * Which conversation a picture arrived in (E5).
 *
 * The same proportional bar as "Where from", and for the same reason: a
 * conversation is a bucket a file is in or is not, and what somebody clearing
 * space wants to know is which chat took the room, not merely which chats
 * exist.
 *
 * Two things make it different from the three cards above it, and both are
 * visible rather than hidden:
 *
 *   - **It is not a partition of the library.** Most photographs came from no
 *     conversation at all. So the bar divides up the chat pictures only, and
 *     the line beside the heading says how many of the whole that is. A bar
 *     over everything would be one segment reading "not from a chat" with a
 *     sliver beside it, which is the shape the facet rules exist to refuse.
 *   - **The card is absent when there is nothing in it.** A library with no
 *     chat pictures gets no empty card and no explanation of a feature it
 *     cannot use — the roadmap asks for exactly that.
 */
function renderConversations(conversation) {
  const card = $('ov-conversations-card');
  const bar = $('ov-conversations-bar');
  const legend = $('ov-conversations-legend');
  bar.replaceChildren();
  legend.replaceChildren();

  const entries = [...conversation.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  if (entries.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const chatBytes = entries.reduce((n, [, stat]) => n + stat.bytes, 0);
  const chatCount = entries.reduce((n, [, stat]) => n + stat.count, 0);
  setText($('ov-conversations-note'), t('media.conversationTotal', '{n} of {total} files · {size}', {
    n: formatCount(chatCount),
    total: formatCount(media.files.length),
    size: formatBytes(chatBytes),
  }));

  entries.forEach(([key, stat], index) => {
    const share = (stat.bytes / chatBytes) * 100;
    const shade = shadeFor(index, entries.length);
    const active = media.filters.conversation === key;
    const detail = `${key} · ${formatCount(stat.count)} · ${formatBytes(stat.bytes)}`;

    const seg = document.createElement('button');
    seg.className = 'ov-seg';
    seg.classList.toggle('is-active', active);
    seg.style.flex = `${Math.max(share, 0.25)} 1 0`;
    seg.style.opacity = String(shade);
    seg.title = detail;
    seg.setAttribute('aria-label', detail);
    seg.setAttribute('aria-pressed', String(active));
    seg.addEventListener('click', () => pickConversation(key));
    bar.appendChild(seg);

    // The legend is capped where the bar is not. Fifty-one ids is a wall of
    // digits; the bar still carries every one of them, and clicking a sliver
    // filters to it.
    if (index >= CONVERSATION_KEYS && !active) return;

    const entry = document.createElement('button');
    entry.className = 'ov-key';
    entry.classList.toggle('is-active', active);
    entry.title = detail;

    const dot = document.createElement('span');
    dot.className = 'ov-dot';
    dot.style.opacity = String(shade);

    const text = document.createElement('span');
    text.className = 'ov-key-id';
    text.textContent = key;

    const size = document.createElement('span');
    size.className = 'ov-key-size';
    size.textContent = formatBytes(stat.bytes);

    entry.append(dot, text, size);
    entry.addEventListener('click', () => pickConversation(key));
    legend.appendChild(entry);
  });

  if (entries.length > CONVERSATION_KEYS) {
    const rest = document.createElement('span');
    rest.className = 'ov-key-rest';
    rest.textContent = t('media.conversationRest', 'and {n} more, in the bar above', {
      n: formatCount(entries.length - CONVERSATION_KEYS),
    });
    legend.appendChild(rest);
  }
}

/** How many conversations get a line in the legend; the bar holds them all. */
const CONVERSATION_KEYS = 8;

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
 * The library over time, from years down to a single day (E4).
 *
 * The screen had a histogram of years since the photo subsystem shipped. This
 * is the same idea with two more levels under it: click a year and the bars
 * become its months, click a month and they become its days, and a trail above
 * them walks back out. Zooming and filtering are deliberately the same gesture
 * -- a bar you have zoomed into is a bar you are looking at, and a screen where
 * those two could disagree is a screen that needs a third control to explain
 * itself.
 *
 * ## Why every level says where its dates came from
 *
 * Measured on this machine's 11,419 files: **4.5%** carry a date from the
 * picture or video itself, and **95.5%** are dated by the file. That is not a
 * fault to hide, because for most of them the file's date is the right answer
 * -- a screenshot has no capture date and its file date is when it was taken,
 * and a picture from a chat is dated when it arrived, which is what somebody
 * clearing space means by "when". The one place it can mislead is a photograph
 * copied off a camera, and there the two were measured to agree anyway: of the
 * 513 files carrying both, **98.1% agree to the day** and none is more than a
 * year out.
 *
 * So the bars are drawn from whichever date exists, and the line under them
 * says how much of what is on screen came from which -- rather than a footnote
 * nobody reads, or a precision nobody can check.
 */

/** 0-based month index to its name in the window's language. */
function monthName(year, month, style) {
  return new Date(year, month, 1).toLocaleDateString(uiLocale(), { month: style });
}

/** Which bucket a timestamp falls in, at the level currently shown. */
function bucketOf(at, level) {
  const d = new Date(at);
  if (level === 'years') return d.getFullYear();
  if (level === 'months') return d.getMonth();
  return d.getDate();
}

/**
 * What the histogram is showing: years, the months of one year, or the days of
 * one month. Read from the filter rather than stored beside it, so the two
 * cannot drift apart.
 */
function timelineLevel() {
  const { year, month } = media.filters.when;
  if (year === null) return 'years';
  if (month === null) return 'months';
  return 'days';
}

/** The files a given level's bars are counted from: everything above it. */
function timelineScope() {
  const { year, month } = media.filters.when;
  return media.files.filter((file) => {
    if (!Number.isFinite(file.at)) return false;
    const d = new Date(file.at);
    if (year !== null && d.getFullYear() !== year) return false;
    if (month !== null && d.getMonth() !== month) return false;
    return true;
  });
}

/** Does this file fall inside the chosen year, month and day? */
function matchesWhen(file, when) {
  if (when.year === null) return true;
  if (!Number.isFinite(file.at)) return false;
  const d = new Date(file.at);
  if (d.getFullYear() !== when.year) return false;
  if (when.month !== null && d.getMonth() !== when.month) return false;
  if (when.day !== null && d.getDate() !== when.day) return false;
  return true;
}

/** The trail back out: every level above the one on screen, clickable. */
function renderTimelineTrail() {
  const host = $('ov-when-trail');
  host.replaceChildren();
  const { year, month, day } = media.filters.when;
  if (year === null) {
    host.hidden = true;
    return;
  }
  host.hidden = false;

  const step = (text, to) => {
    const button = document.createElement('button');
    button.className = 'ov-trail-step';
    button.textContent = text;
    button.addEventListener('click', () => setWhen(to));
    host.appendChild(button);
  };
  const here = (text) => {
    const span = document.createElement('span');
    span.className = 'ov-trail-here';
    span.textContent = text;
    host.appendChild(span);
  };

  step(t('media.when.allYears', 'All years'), { year: null, month: null, day: null });
  if (month === null) {
    here(String(year));
    return;
  }
  step(String(year), { year, month: null, day: null });
  if (day === null) {
    here(monthName(year, month, 'long'));
    return;
  }
  step(monthName(year, month, 'short'), { year, month, day: null });
  here(String(day));
}

/**
 * The bars themselves.
 *
 * Gaps are drawn rather than skipped at every level, for the reason the year
 * histogram already had: a month with nothing in it is a fact about the
 * library, and closing the gap would quietly redraw its history.
 */
function renderTimeline() {
  const card = $('ov-years-card');
  const host = $('ov-years');
  host.replaceChildren();

  const level = timelineLevel();
  const scope = timelineScope();
  const { year, month, day } = media.filters.when;

  const stats = new Map();
  let dated = 0;
  for (const file of scope) {
    if (!Number.isFinite(file.at)) continue;
    const key = bucketOf(file.at, level);
    const entry = stats.get(key) || { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += file.size;
    stats.set(key, entry);
    if (file.dateFrom === 'taken' || file.dateFrom === 'recorded') dated += 1;
  }

  // One year is not a distribution; the card would be a single bar saying
  // nothing the total does not already say. Deeper levels are always drawn --
  // a month with one busy day is exactly the shape somebody drilled in to see.
  if (level === 'years' && stats.size < 2) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  renderTimelineTrail();

  let first;
  let last;
  if (level === 'years') {
    const keys = [...stats.keys()].sort((a, b) => a - b);
    first = keys[0];
    last = keys[keys.length - 1];
  } else if (level === 'months') {
    first = 0;
    last = 11;
  } else {
    first = 1;
    last = new Date(year, month + 1, 0).getDate();
  }

  $('ov-years-note').textContent =
    level === 'years'
      ? `${first}–${last}`
      : t('media.when.inView', '{n} files', { n: formatCount(scope.length) });

  const biggest = Math.max(1, ...[...stats.values()].map((s) => s.bytes));
  const span = last - first + 1;
  const step = span <= 12 ? 1 : Math.ceil(span / 10);
  const shortLabels = level === 'years' && span > 8;

  for (let key = first; key <= last; key++) {
    const stat = stats.get(key);
    const active =
      (level === 'years' && year === key) ||
      (level === 'months' && month === key) ||
      (level === 'days' && day === key);

    const column = document.createElement('button');
    column.className = 'ov-year';
    column.classList.toggle('is-active', active);
    column.setAttribute('aria-pressed', String(active));

    const name =
      level === 'years'
        ? String(key)
        : level === 'months'
          ? monthName(year, key, 'long')
          : new Date(year, month, key).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' });

    const detail = stat
      ? `${name} · ${formatCount(stat.count)} · ${formatBytes(stat.bytes)}`
      : t('media.yearEmpty', '{year} · nothing', { year: name });
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
    const show = key === first || key === last || (key - first) % step === 0;
    label.textContent = !show
      ? ''
      : level === 'years'
        ? shortLabels
          ? String(key % 100).padStart(2, '0')
          : String(key)
        : level === 'months'
          ? monthName(year, key, 'narrow')
          : String(key);

    column.append(track, label);
    if (stat) column.addEventListener('click', () => drillTo(key, level));
    else column.disabled = true;
    host.appendChild(column);
  }

  // Where the dates on this screen came from. Said at every level, because the
  // deeper the level the more it matters.
  const note = $('ov-when-dated');
  if (scope.length === 0) {
    note.textContent = '';
  } else if (dated === scope.length) {
    note.textContent = t('media.when.allDated', 'All of these carry a date from the picture itself.');
  } else if (dated === 0) {
    note.textContent = t('media.when.noneDated', 'None of these carries a date from the picture itself — they are placed by the file’s own date.');
  } else {
    note.textContent = t('media.when.someDated', '{n} of {total} carry a date from the picture itself; the rest are placed by the file’s own date.', {
      n: formatCount(dated),
      total: formatCount(scope.length),
    });
  }
}

/** Click a bar: go one level in, or back out if it was already the one chosen. */
function drillTo(key, level) {
  const { year, month, day } = media.filters.when;
  if (level === 'years') {
    setWhen(year === key ? { year: null, month: null, day: null } : { year: key, month: null, day: null });
  } else if (level === 'months') {
    setWhen(month === key ? { year, month: null, day: null } : { year, month: key, day: null });
  } else {
    setWhen(day === key ? { year, month, day: null } : { year, month, day: key });
  }
}

function setWhen(when) {
  media.filters.when = { year: null, month: null, day: null, ...when };
  applyFilters();
}

/** What the filter chip says, at whatever level is chosen. */
function whenLabel(when) {
  if (when.year === null) return '';
  if (when.month === null) return String(when.year);
  if (when.day === null) return `${monthName(when.year, when.month, 'long')} ${when.year}`;
  return new Date(when.year, when.month, when.day).toLocaleDateString(uiLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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

  if (media.filters.conversation) {
    add(t('media.token.conversation', 'Conversation {id}', { id: media.filters.conversation }),
      () => pickConversation(media.filters.conversation));
  }
  if (media.filters.origin) {
    add(labelFor(ORIGIN_LABEL, media.filters.origin), () => pickOrigin(media.filters.origin));
  }
  if (media.filters.trait) {
    add(labelFor(TRAIT_LABEL, media.filters.trait), () => pickTrait(media.filters.trait));
  }
  if (media.filters.place) {
    add(
      t('media.token.place', '{n} in one place', { n: formatCount(media.filters.place.count) }),
      () => pickPlace(null)
    );
  }
  if (media.filters.when.year !== null) {
    add(whenLabel(media.filters.when), () => setWhen({ year: null, month: null, day: null }));
  }
}

/* ---- what the map card reads and writes (E4) ---- */

/**
 * The whole library, for the map.
 *
 * The map counts from everything rather than from what is on screen, the same
 * way every other card in the overview does -- a card that shrank as you
 * filtered would be answering a different question each time you looked.
 */
window.mediaFiles = () => media.files;

/** Clicking a cluster of pins filters the grid to the pictures it held. */
window.mediaPickPlace = (paths, count) => pickPlace({ paths: new Set(paths), count });

function pickPlace(value) {
  const same =
    media.filters.place && value && media.filters.place.count === value.count &&
    [...value.paths].every((p) => media.filters.place.paths.has(p));
  media.filters.place = same ? null : value;
  applyFilters();
}

/* ---- picking, which always toggles ---- */

function pickOrigin(key) {
  media.filters.origin = media.filters.origin === key ? null : key;
  applyFilters();
}

function pickConversation(key) {
  media.filters.conversation = media.filters.conversation === key ? null : key;
  applyFilters();
}

function pickTrait(key) {
  media.filters.trait = media.filters.trait === key ? null : key;
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

  // A focused cell scrolled out of the window has no element to point at.
  const pointed = $('media-grid').getAttribute('aria-activedescendant');
  if (pointed && !document.getElementById(pointed)) $('media-grid').removeAttribute('aria-activedescendant');

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

/**
 * One id per file for as long as the window is open, so the grid can point
 * a screen reader at the cell the arrow keys are on. The grid keeps the
 * focus itself (the cells come and go as it scrolls), and without
 * `aria-activedescendant` moving through it said nothing at all.
 */
const cellIds = new Map();
function cellId(path) {
  if (!cellIds.has(path)) cellIds.set(path, `media-cell-${cellIds.size + 1}`);
  return cellIds.get(path);
}

/** What a screen reader says for a cell. It used to be the size alone. */
function cellLabel(file) {
  const when = file.takenAt || file.mtimeMs;
  return [
    file.name,
    file.kind === 'video' ? t('media.videoShort', 'video') : t('media.photoShort', 'photo'),
    formatBytes(file.size),
    when ? new Date(when).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : null,
    file.cloudService ? t('media.cloudBadge', 'Synced with {service} — deleting it here deletes it everywhere', { service: file.cloudService }) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function makeCell(file, index) {
  const cell = document.createElement('div');
  cell.className = 'media-cell';
  cell.id = cellId(file.path);
  cell.dataset.path = file.path;
  cell.dataset.index = String(index);
  cell.setAttribute('role', 'option');
  cell.setAttribute('aria-label', cellLabel(file));
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
   * The tick toggles.
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
   *
   * It is for the pointer, and it is not a <button> (I2). The cell is an
   * option in a listbox, and a focusable control inside an option is one a
   * screen reader can land on without knowing what it belongs to -- axe calls
   * it nested-interactive, and tabindex=-1 does not stop it. From the
   * keyboard, Space on the grid is the same toggle, and the option itself
   * says whether it is selected.
   */
  const tick = document.createElement('span');
  tick.className = 'media-tick';
  tick.title = t('media.tickHint', 'Add to the selection (or shift-click to take a run of them)');
  tick.setAttribute('aria-hidden', 'true');
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
        // Marked so a language change can find it again. This text is written
        // here rather than by `renderGrid`, which rebuilds cells but reuses the
        // ones whose file has not changed -- so without the mark the sentence
        // stays in whichever language it was first written in. A screenshot of
        // the Vietnamese interface caught a tile still saying "NO PREVIEW".
        placeholder.classList.add('is-nopreview');
      }
    }

    if (media.sort === 'detail') {
      sortShown();
      renderGrid();
    }

    // E1: every screenful that arrives is more pictures that can be grouped,
    // so the list of look-alikes grows as somebody scrolls. Cheap to ask --
    // the grouping itself was 2 ms over 398 hashes on this machine -- and it
    // is what makes the card fill in without anybody pressing anything.
    refreshSimilar();
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
  let current = null;
  for (const cell of $('media-canvas').children) {
    const selected = media.selected.has(cell.dataset.path);
    cell.classList.toggle('is-selected', selected);
    cell.setAttribute('aria-selected', String(selected));
    const focused = media.focused === cell.dataset.path;
    cell.classList.toggle('is-focused', focused);
    if (focused) current = cell;
  }
  if (current) $('media-grid').setAttribute('aria-activedescendant', current.id);
  else $('media-grid').removeAttribute('aria-activedescendant');
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
  Managed.hold($('media-quarantine'), Managed.holds('quarantine'));
  let bytes = 0;
  let synced = 0;
  let videos = 0;
  for (const file of media.files) {
    if (!media.selected.has(file.path)) continue;
    bytes += file.size;
    if (file.cloudService) synced += 1;
    if (file.kind === 'video') videos += 1;
  }

  // E3. Hidden, not disabled: see the listener for why this bar cannot carry a
  // seventh button for the photographs that are most of every library.
  $('media-shrink').hidden = videos === 0;

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
  // As on the lists: a change in what is chosen is said, the return to
  // nothing is not (it follows a delete, and its receipt).
  const said = `${count}:${bytes}`;
  if (count > 0 && said !== updateSelection.said) announce(status.textContent);
  updateSelection.said = count > 0 ? said : '';

  // Once anything is chosen the whole grid shows its ticks, so adding the next
  // one is never a thing you have to go hunting for under the pointer.
  $('media-grid').classList.toggle('is-choosing', count > 0);

  $('media-delete').disabled = count === 0;
  $('media-delete').hidden = count === 0;
  // The organisation's view only (H2) holds both, whatever is ticked.
  Managed.hold($('media-delete'), Managed.holds('recycle'));
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

/**
 * The status line, and why it is a function rather than a string.
 *
 * `translateDom` rewrites only what is in the markup, so anything JavaScript
 * writes has to be able to write itself again when the language changes.
 * Keeping the *sentence* would hand Vietnamese an English one; keeping the
 * function re-says it with the numbers formatted to match.
 */
let statusLine = null;

function setStatus(fn) {
  statusLine = fn;
  renderStatus();
}

function renderStatus() {
  setText(
    $('media-status'),
    statusLine ? statusLine() : t('media.readyToScan', 'Ready to look through your photo folders.')
  );
}

// The markup no longer carries the idle sentence, so it is written once here.
renderStatus();

function setScanning(running) {
  media.scanning = running;
  $('media-scan').disabled = running;
  $('media-cancel').hidden = !running;
  $('media-progress').hidden = !running;
}

api.onMediaProgress((p) => {
  setStatus(() =>
    p.phase === 'walking'
      ? t('media.progress.walking', 'Looking through folders… {n} pictures and videos so far', {
          n: formatCount(p.media),
        })
      : t('media.progress.reading', 'Reading {done} of {total}…', {
          done: formatCount(p.probed),
          total: formatCount(p.media),
        })
  );
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
    setStatus(() => t('media.failed', 'The scan could not finish.'));
    return;
  }

  media.files = result.files.map(candidateView);
  media.displays = result.displays || [];
  media.excluded = result.excluded || [];
  similar.expanded = false;
  renderExcluded();
  applyFilters();
  reportScan(result);
  // E1: whatever was measured on an earlier run of this library is already in
  // the cache, so this is often not empty even straight after a scan.
  refreshSimilar();
});

/**
 * What a finished scan has to say, built from its numbers rather than kept as
 * a finished string.
 *
 * Separated out for one reason, and a screenshot found it: the status line used
 * to carry `data-i18n`, so `translateDom` replaced a finished scan's sentence
 * with "Ready to look through your photo folders" the instant somebody switched
 * to Vietnamese. The attribute is gone and this is what replaces it -- the
 * counts are remembered and the sentence is made again, in whichever language
 * is on, numbers formatted to match.
 */
function sentencesFor(said) {
  const parts = [
    t('media.found', 'Found {n} pictures and videos · {size}.', {
      n: formatCount(said.files),
      size: formatBytes(said.totalBytes),
    }),
  ];

  if (said.hidden > 0) {
    parts.push(
      t('media.hiddenAssets', '{n} more were a program’s own artwork and are not shown.', {
        n: formatCount(said.hidden),
      })
    );
  }
  if (said.dehydrated > 0) {
    parts.push(
      t('media.onlineOnly', '{n} are stored online only and were not opened, so nothing was downloaded.', {
        n: formatCount(said.dehydrated),
      })
    );
  }
  if (said.unreadable > 0) {
    parts.push(t('media.unreadable', '{n} could not be read.', { n: formatCount(said.unreadable) }));
  }
  // E5. Said rather than dropped in silence: these are real photographs, and
  // the only reason they are not here is that nothing on this machine can
  // draw one. The readable copy of each is in the list.
  if (said.chatUndrawable > 0) {
    parts.push(
      t('media.chatUndrawable', '{n} more ({size}) are the copies a chat app re-encoded, in a format nothing here can display. The originals of the same pictures are shown.', {
        n: formatCount(said.chatUndrawable),
        size: formatBytes(said.chatUndrawableBytes),
      })
    );
  }
  if (said.cancelled) parts.push(t('app.cancelledPartial', 'Cancelled — results are partial.'));
  return parts;
}

function reportScan(result) {
  const said = {
    ...result.stats,
    files: result.files.length,
    totalBytes: result.totalBytes,
    hidden: result.hidden,
    cancelled: result.cancelled,
  };

  // The headline count lives in the overview card, where it sits under the bar
  // that divides it up. What is left for the bar is what the bar is for: what
  // just happened, and anything that went wrong.
  setStatus(() => sentencesFor(said).slice(1).join(' '));
  // Said whole, headline included: the overview card it sits in is not where
  // a screen reader is when the scan ends.
  announce(sentencesFor(said).join(' '));

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

/* --------------------------------------------------- back up first (E2) -- */

/**
 * Where a copy goes before these photographs are deleted, and whether it does.
 *
 * Two separate facts, deliberately. The folder is remembered in settings, so
 * an external drive picked once is still named next month; whether a copy is
 * actually made is a switch that can be turned off without forgetting the
 * folder, because "not this time" and "not any more" are different answers.
 *
 * The real yes-or-no is asked again in the confirmation dialog, which is where
 * the roadmap puts it. This decides what that dialog is asked about.
 */
const backup = { destination: null, on: false };

function drawBackup() {
  const button = $('media-backup');
  const change = $('media-backup-choose');
  if (!button) return;

  if (!backup.destination) {
    button.textContent = t('media.backup.off', 'Back up before deleting…');
    button.title = t('media.backup.offHint', 'Copy each file somewhere else, and check the copy, before it goes to the bin');
    button.setAttribute('aria-pressed', 'false');
    change.hidden = true;
    return;
  }

  // Short on purpose, with the whole path in the tooltip. The first
  // screenshot of this bar put the full destination in the label, and at
  // 1180px that pushed "Move selected to Recycle Bin" clean off the right-hand
  // edge -- the same failure the wrap rule in `styles.css` was written for at
  // 700px, brought back by making one button wide enough to cause it again.
  const where = elide(backup.destination, 20);
  button.textContent = backup.on
    ? t('media.backup.on', 'Backing up to {dest}', { dest: where })
    : t('media.backup.paused', 'Not backing up to {dest}', { dest: where });
  button.title = backup.destination;
  button.setAttribute('aria-pressed', backup.on ? 'true' : 'false');
  change.hidden = false;
}

async function chooseBackup() {
  const result = unwrap(await api.backupChoose(), t('media.backup.label', 'Back up before deleting'));
  if (!result) return;
  if (!result.chosen) {
    if (result.refusal) toast(result.refusal, true);
    return;
  }
  backup.destination = result.destination;
  backup.on = true;
  drawBackup();
  toast(
    t('media.backup.set', 'Copies will go to {dest}, and each one is checked before the original is deleted.', {
      dest: result.destination,
    })
  );
}

$('media-backup').addEventListener('click', () => {
  if (!backup.destination) return chooseBackup();
  backup.on = !backup.on;
  drawBackup();
  return undefined;
});

$('media-backup-choose').addEventListener('click', chooseBackup);

// The markup carries `data-i18n` for the state where no folder is chosen,
// which is what the button says before this file has run. `translateDom`
// rewrites it from that key on every language change, so once a folder *is*
// chosen the switch would put "Back up before deleting…" back over the top of
// "Backing up to D:\…" and lose the destination from the screen. The
// Vietnamese screenshot caught exactly that. Listeners run after the DOM pass,
// so drawing again here is the last word.
onLanguageChange(drawBackup);
Managed.onChange(() => updateSelection());

// The setting is read once, when the screen is first built, the same way the
// quarantine card reads its own.
(async () => {
  const settings = unwrap(await api.getSettings(), t('media.backup.label', 'Back up before deleting'));
  const chosen = settings && settings.settings && settings.settings.backup
    ? settings.settings.backup.destination
    : null;
  if (chosen) {
    backup.destination = chosen;
    // A folder remembered from last time does not switch itself on. Deleting
    // is the thing this screen does most, and a copy the user did not ask for
    // this session is a surprise write to somebody's external drive.
    backup.on = false;
  }
  drawBackup();
})();

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
  }, {
    context: 'media',
    kind,
    // E2, and only for the bin: the quarantine already copies and verifies to
    // another drive, so backing that up would be a copy of a copy.
    ...(kind === 'recycle' && backup.on && backup.destination ? { backupTo: backup.destination } : {}),
  });
};
$('media-delete').addEventListener('click', onMediaAction('recycle'));
$('media-quarantine').addEventListener('click', onMediaAction('quarantine'));

/**
 * A smaller copy of the videos that are ticked (E3).
 *
 * The button is hidden rather than disabled when the selection holds no video,
 * and that is a measured decision rather than a tidy one: this bar already
 * carries two more buttons than any other, and at 1180px a seventh pushed the
 * delete button off the edge of the window — which is exactly how F4 broke the
 * Duplicates bar, in the same week, for the same reason.
 *
 * Placeholders are not filtered out here. They are offered to the dialog and
 * the dialog names them and leaves them out, because "308 of these are only in
 * the cloud" is worth saying once rather than hiding by making the button
 * quietly do less than it says.
 */
$('media-shrink').addEventListener('click', () => {
  const picked = media.files.filter((f) => media.selected.has(f.path) && f.kind === 'video');
  if (!picked.length) return;
  if (window.VideoShrink) window.VideoShrink.open(picked.map((f) => f.path));
});

/**
 * Put the new copies on the screen that made them.
 *
 * Without this the copy exists on the disk and not in the grid, so the
 * comparison the roadmap asks for would be between a file that is listed and
 * one that is not — and the next scan would make it appear as if from nowhere.
 */
media.refreshAfterEncode = async (paths) => {
  if (!Array.isArray(paths) || !paths.length) return;
  const roots = chosenRoots();
  if (!roots.length) return;
  const result = unwrap(await api.scanMedia(roots), t('media.label.scan', 'Photo scan'));
  if (!result) return;
  media.files = result.files.map(candidateView);
  media.excluded = result.excluded || [];
  // The copies arrive unticked. Nothing in this app ever ticks a file on
  // somebody's behalf, and a copy that arrived already selected would be one
  // keystroke from being deleted by a person who meant the original.
  media.selected.clear();
  renderExcluded();
  applyFilters();
};

$('ov-traits-more').addEventListener('click', () => {
  media.traitsExpanded = !media.traitsExpanded;
  renderOverview();
});

/* ------------------------------------------------ photos that look alike -- */

/**
 * Groups of near-identical pictures (E1).
 *
 * The grouping itself has been in the main process since the subsystem was
 * built -- `lib/media/perceptual.js`, reached through `media:similar` -- and
 * until now nothing in the window ever called it. This is that call, and the
 * list it draws.
 *
 * ## Why there is a button, and what it costs
 *
 * A picture can only be grouped once its pixels have been measured, and
 * measuring one means decoding it: **70.6 ms a file**, measured on this
 * machine with `npm run bench:media`. The grid does that lazily, a screenful
 * at a time, which is the only reason a library of thousands opens at all --
 * so straight after a scan almost nothing has been measured and this list is
 * nearly empty.
 *
 * Rather than pretend otherwise, the card says which of the two it is showing
 * ("looked at 214 of 4,124"), and offers the rest as an explicit job with a
 * progress bar and a stop button. Over the 4,124 readable photographs in the
 * default roots here that is about five minutes, paid once: the numbers are
 * cached against path, size and time, and a second run is 91 ms.
 *
 * Files that exist only in the cloud are never in it. Reading one downloads
 * it, and on this machine that is 2,534 pictures -- several gigabytes pulled
 * back onto a disk the user may have just freed with B3. They are counted and
 * named on screen instead.
 */
const similar = {
  groups: [],
  measured: 0,
  measurable: 0,
  dehydrated: 0,
  expanded: false,
  measuring: false,
  /** How many rows before "show more", which is what the other cards use. */
  shown: 5,
};

/** Thumbnails per row. More than this and the row is a contact sheet. */
const SIMILAR_STRIP = 4;

async function refreshSimilar() {
  if (media.files.length === 0) {
    similar.groups = [];
    renderSimilar();
    return;
  }
  const reply = await api.mediaSimilar();
  if (!reply || !reply.ok) return;
  similar.groups = reply.data.groups || [];
  similar.measured = reply.data.measured || 0;
  similar.measurable = reply.data.measurable || 0;
  similar.dehydrated = reply.data.dehydrated || 0;
  renderSimilar();
}

function renderSimilar() {
  const card = $('media-similar-card');
  // No library, no card. An empty one after a scan that found nothing would be
  // a box explaining a feature nobody had reached yet.
  if (media.files.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const groups = similar.groups;
  const wasted = groups.reduce((n, g) => n + (g.wastedBytes || 0), 0);
  setText(
    $('similar-total'),
    groups.length === 0
      ? t('similar.none', 'none found yet')
      : t('similar.total', '{n} groups · {size} if you kept one of each', {
          n: formatCount(groups.length),
          size: formatBytes(wasted),
        })
  );

  /* -- the honest denominator, and what is deliberately not in it --------- */
  const scope = [
    t('similar.looked', 'Looked at {done} of {total} photos so far.', {
      done: formatCount(similar.measured),
      total: formatCount(similar.measurable),
    }),
  ];
  if (similar.dehydrated > 0) {
    scope.push(
      t('similar.cloud', '{n} are stored online only and are left out — opening one would download it.', {
        n: formatCount(similar.dehydrated),
      })
    );
  }
  setText($('similar-scope'), scope.join(' '));

  const left = Math.max(0, similar.measurable - similar.measured);
  const measure = $('similar-measure');
  measure.hidden = similar.measuring || left === 0;
  measure.textContent = t('similar.measure', 'Look at the other {n}', { n: formatCount(left) });
  // Measured, so the estimate is a measurement rather than a guess: 70.6 ms a
  // file on this machine, and the button says so before it is pressed.
  measure.title = t('similar.measureHint', 'About {duration}. It is done once — the measurements are kept.', {
    duration: formatSpan(left * 71),
  });
  $('similar-stop').hidden = !similar.measuring;
  $('similar-progress').hidden = !similar.measuring;

  renderSimilarRows();
}

function renderSimilarRows() {
  const host = $('similar-list');
  const groups = similar.expanded ? similar.groups : similar.groups.slice(0, similar.shown);
  const rows = [];

  groups.forEach((group, index) => {
    const li = document.createElement('li');
    li.className = 'similar-row';

    const strip = document.createElement('div');
    strip.className = 'similar-strip';
    for (const file of group.files.slice(0, SIMILAR_STRIP)) {
      const thumb = media.thumbs.get(file.path);
      const cell = document.createElement('span');
      cell.className = 'similar-thumb';
      if (thumb && thumb.dataUri) {
        const img = document.createElement('img');
        img.src = thumb.dataUri;
        img.alt = '';
        cell.appendChild(img);
      }
      cell.title = file.path;
      strip.appendChild(cell);
    }
    if (group.files.length > SIMILAR_STRIP) {
      const more = document.createElement('span');
      more.className = 'similar-thumb is-more';
      more.textContent = `+${group.files.length - SIMILAR_STRIP}`;
      strip.appendChild(more);
    }

    const facts = document.createElement('div');
    facts.className = 'similar-facts';
    const line = document.createElement('strong');
    line.textContent = t('similar.group', '{n} photos · {size} in the copies', {
      n: formatCount(group.count),
      size: formatBytes(group.wastedBytes || 0),
    });
    const how = document.createElement('span');
    // `spread` has been computed by `perceptual.js` since it was written,
    // with a comment saying it is there "so the UI can say how alike these
    // actually are". This is that sentence, finally on a screen.
    how.textContent =
      group.spread === 0
        ? t('similar.identical', 'the same picture as far as this can tell')
        : t('similar.close', 'they differ by {n} of 64', { n: formatCount(group.spread) });
    facts.append(line, how);

    const go = document.createElement('button');
    go.className = 'btn btn-sm';
    go.textContent = t('similar.open', 'Compare');
    go.addEventListener('click', () => openSimilarGroup(index));

    li.append(strip, facts, go);
    rows.push(li);
  });

  if (similar.groups.length === 0) {
    const li = document.createElement('li');
    li.className = 'similar-empty';
    li.textContent =
      similar.measured >= similar.measurable && similar.measurable > 0
        ? t('similar.emptyDone', 'Every photo has been looked at, and no two of them are the same picture.')
        : t('similar.emptyYet', 'Nothing yet. Scroll the grid, or look at the rest, and any that match will appear here.');
    rows.push(li);
  }

  replaceChildrenIfChanged(host, rows);

  const more = $('similar-more');
  more.hidden = similar.groups.length <= similar.shown;
  more.textContent = similar.expanded
    ? t('similar.showFewer', 'Show fewer')
    : t('similar.showAll', 'Show all {n}', { n: formatCount(similar.groups.length) });
}

/** Open one group in the comparison panel, at most four of it. */
function openSimilarGroup(index) {
  const group = similar.groups[index];
  if (!group) return;
  const files = group.files
    .map((one) => media.files.find((f) => f.path === one.path))
    .filter(Boolean)
    .slice(0, window.PhotoCompare ? window.PhotoCompare.MAX_PANES : 4);
  if (files.length < 2) {
    toast(t('similar.gone', 'Those files are no longer in the list.'), true);
    return;
  }
  window.PhotoCompare.open(files, { groups: similar.groups, index });
}

$('similar-more').addEventListener('click', () => {
  similar.expanded = !similar.expanded;
  renderSimilarRows();
});

$('similar-measure').addEventListener('click', async () => {
  similar.measuring = true;
  renderSimilar();
  const reply = await api.mediaMeasureAll();
  similar.measuring = false;
  if (reply && reply.ok) {
    const d = reply.data;
    toast(
      d.cancelled
        ? t('similar.stopped', 'Stopped after looking at {n} — what was measured is kept.', {
            n: formatCount(d.measured),
          })
        : d.total === 0
          ? t('similar.already', 'Every photo had already been looked at — nothing left to do.')
          : t('similar.finished', 'Looked at {n} photos in {duration}.', {
              n: formatCount(d.measured),
              duration: formatSpan(d.elapsedMs),
            })
    );
  }
  await refreshSimilar();
});

$('similar-stop').addEventListener('click', () => {
  api.mediaMeasureCancel();
});

// Everything in this card except its heading is built from a result, and
// `translateDom` only reaches text that is in the markup as written -- so a
// switch to Vietnamese left "ẢNH TRÔNG GIỐNG NHAU" above five English lines.
// The Vietnamese screenshot caught it, which is the third time that pair of
// screenshots has earned its place.
onLanguageChange(renderSimilar);

api.onMediaMeasureProgress((p) => {
  if (!similar.measuring) return;
  setText(
    $('similar-progress'),
    t('similar.progress', '{done} of {total}', { done: formatCount(p.done), total: formatCount(p.total) })
  );
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
  renderStatus();
  renderRoots();
  renderOverview();
  renderTokens();
  renderExcluded();
  renderGrid();
  // The tiles whose label was written when a thumbnail came back rather than
  // when the grid was drawn. `renderGrid` reuses a cell whose file has not
  // changed, so these have to be re-said by hand.
  for (const tile of $('media-canvas').querySelectorAll('.media-placeholder.is-nopreview')) {
    tile.textContent = t('media.noPreview', 'no preview');
  }
  updateSelection();
  const focused = media.shown.find((f) => f.path === media.focused);
  renderDetail(focused || null);
});

loadRoots();
