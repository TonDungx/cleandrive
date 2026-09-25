'use strict';

const api = window.cleandrive;
const $ = (id) => document.getElementById(id);

const state = {
  folder: null,
  scan: null,
  dupes: null,
  cleanup: null,
  accessTimes: null,
  selectedDupes: new Set(),
  // The Disk usage screen's selection, by path. The largest list and the map
  // of the folder tick into the same set, so one bar acts on both.
  selectedLarge: new Set(),
  selectedCleanup: new Set(),
  // Every file the map has offered, path -> view, so that bar can find the
  // ones that are not also in the largest list.
  mapViews: new Map(),
};

/* ------------------------------------------------------------------ format */

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * The language the app is *being read in*, for number and date formatting.
 *
 * Not the system locale, which is a different question and often a different
 * answer: this machine formats dates the Vietnamese way while its Windows
 * display language is English. An English window showing `19/09/2026` is
 * following a setting nobody pointed at the app.
 */
const uiLocale = () => (window.CleanDriveI18n ? window.CleanDriveI18n.getLanguage() : 'en');

const formatCount = (n) => (n || 0).toLocaleString(uiLocale());
const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)}${t('app.unit.seconds', 's')}`;

/**
 * The right word for a count.
 *
 * English needs two forms and Vietnamese needs one, so the caller asks for a
 * word rather than applying a rule -- `vi.js` maps both keys to the same
 * string and the sentence around it does not change shape.
 */
function word(n, key, one, other) {
  return n === 1 ? t(`${key}.one`, one) : t(`${key}.other`, other);
}

const DAY = 24 * 60 * 60 * 1000;

/** "3 months ago" / "2.4 years ago" -- coarse on purpose. */
function formatAgo(timestamp) {
  if (!timestamp) return t('app.ago.unknown', 'unknown');
  const days = (Date.now() - timestamp) / DAY;
  if (days < 1) return t('app.ago.today', 'today');
  if (days < 2) return t('app.ago.yesterday', 'yesterday');
  if (days < 60) return t('app.ago.days', '{n} days ago', { n: Math.round(days) });
  if (days < 365) return t('app.ago.months', '{n} months ago', { n: Math.round(days / 30) });
  const years = days / 365;
  return t('app.ago.years', '{n} years ago', { n: years < 2 ? years.toFixed(1) : Math.round(years) });
}

/**
 * The label for a file's timestamp. When the OS is not tracking access times,
 * atime is meaningless, so say "modified" and mean it.
 */
function timeLabel(file) {
  const tracked = state.accessTimes && state.accessTimes.tracked === true;
  return tracked && file.atimeMs
    ? t('app.lastOpened', 'Last opened {when}', { when: formatAgo(file.atimeMs) })
    : t('app.modified', 'Modified {when}', { when: formatAgo(file.mtimeMs) });
}

/** Keep the filename visible; drop characters from the middle of the path. */
function elide(text, max = 80) {
  if (text.length <= max) return text;
  const tail = Math.floor(max * 0.62);
  return `${text.slice(0, max - tail - 1)}…${text.slice(-tail)}`;
}

function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

/** Unwrap the { ok, data, error } envelope every IPC handler returns. */
function unwrap(envelope, label) {
  if (!envelope || !envelope.ok) {
    const message = envelope && envelope.error ? envelope.error : t('app.unknownError', 'Unknown error');
    if (!envelope || !envelope.cancelled) toast(`${label}: ${message}`, true);
    return null;
  }
  return envelope.data;
}

/* ------------------------------------------------------------------ folder */

async function setFolder(folder) {
  if (!folder) return;
  state.folder = folder;
  $('target-path').textContent = elide(folder, 70);
  $('target-path').title = folder;
  $('run-scan').disabled = false;
  $('run-dupes').disabled = false;
  $('scan-status').textContent = t('usage.ready', 'Ready to scan.');
  $('dupes-status').textContent = t('dupes.ready', 'Ready to search.');
}

$('pick-folder').addEventListener('click', async () => {
  const folder = unwrap(await api.pickFolder(), t('app.label.folderPicker', 'Folder picker'));
  if (folder) setFolder(folder);
});

(async function loadQuickPaths() {
  const paths = unwrap(await api.knownPaths(), t('app.label.paths', 'Paths'));
  if (!paths) return;
  const container = $('quick-paths');
  for (const [label, value] of Object.entries(paths)) {
    if (!value) continue;
    const btn = document.createElement('button');
    btn.className = 'btn btn-quick';
    // The keys are Electron's own path names (downloads, documents, …), so the
    // dictionary can name each one; anything unrecognised is shown as it came.
    const name = () => t(`app.path.${label}`, label[0].toUpperCase() + label.slice(1));
    btn.textContent = name();
    btn.title = value;
    btn.addEventListener('click', () => setFolder(value));
    // Built once from a reply, so the DOM pass that re-translates the markup
    // never reaches them; a language switch has to name them again.
    onLanguageChange(() => {
      btn.textContent = name();
    });
    container.appendChild(btn);
  }
})();

/* ------------------------------------------------------------------ tabs */

// [data-tab], not .tab: the sidebar also holds a button that hides it, and it
// is drawn as a row like the others. Matching on the class alone made clicking
// it switch to a panel called "panel-undefined", which left every panel hidden
// and the window empty.
for (const tab of document.querySelectorAll('.tab[data-tab]')) {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('is-active', p.id === `panel-${tab.dataset.tab}`);
    });
  });
}

/* A sticky bar earns its edge only once something has gone underneath it. A
   line drawn across an unscrolled panel is decoration, and this app has a rule
   about drawing things that do not mean anything. */
const scroller = document.querySelector('main');
scroller.addEventListener(
  'scroll',
  () => {
    const stuck = scroller.scrollTop > 2;
    for (const bar of document.querySelectorAll('.panel-bar')) {
      bar.classList.toggle('is-stuck', stuck);
    }
  },
  { passive: true }
);

/* ------------------------------------------------------------------ scan */

function setScanRunning(running) {
  $('run-scan').disabled = running || !state.folder;
  $('cancel-scan').hidden = !running;
  $('scan-progress').hidden = !running;
  $('pick-folder').disabled = running;
}

api.onScanProgress((p) => {
  $('scan-status').textContent = t('usage.scanning', 'Scanning… {files} files, {size} ({elapsed})', {
    files: formatCount(p.files),
    size: formatBytes(p.bytes),
    elapsed: formatSeconds(p.elapsedMs),
  });
});

$('run-scan').addEventListener('click', async () => {
  if (!state.folder) return;
  setScanRunning(true);
  $('scan-empty').hidden = true;

  const result = unwrap(await api.scan(state.folder), t('app.label.scan', 'Scan'));
  setScanRunning(false);
  if (!result) {
    $('scan-status').textContent = t('usage.failed', 'Scan failed.');
    return;
  }

  state.scan = hydrateScan(result);
  state.selectedLarge.clear();
  renderScan(state.scan);
  // The OneDrive card reads the reply before it is flattened: its rows are
  // candidates of their own, named in `cloud.ids`.
  window.CloudCard.show(result);
});

/**
 * Turn the scan's reply into the lists the two screens draw.
 *
 * The reply is a summary plus the candidates; the summary names its rows by id
 * -- `largest` and each cleanup group's `ids` -- so a file that is both large
 * and disposable is one record in both lists, with one verdict.
 */
function hydrateScan(result) {
  const byId = indexCandidates(result.candidates);
  const { candidates, largest, ...rest } = result;
  return {
    ...rest,
    largestFiles: viewsOf(largest, byId),
    cleanup: {
      ...result.cleanup,
      groups: result.cleanup.groups.map(({ ids, ...group }) => ({ ...group, files: viewsOf(ids, byId) })),
    },
  };
}

$('cancel-scan').addEventListener('click', () => api.cancelScan());

function renderScan(result) {
  $('stat-size').textContent = formatBytes(result.totalSize);
  $('stat-files').textContent = formatCount(result.totalFiles);
  $('stat-dirs').textContent = formatCount(result.totalDirs);
  $('stat-time').textContent = formatSeconds(result.durationMs);
  $('scan-stats').hidden = false;

  // Access-time support has to be known before any row renders its age.
  state.accessTimes = result.accessTimes;
  renderCleanup(result.cleanup, result.accessTimes);

  const parts = [t('usage.scanned', 'Scanned {n} files.', { n: formatCount(result.totalFiles) })];
  if (result.cancelled) parts.push(t('app.cancelledPartial', 'Cancelled — results are partial.'));
  if (result.errorCount) {
    parts.push(t('usage.unreadable', '{n} unreadable items skipped.', { n: formatCount(result.errorCount) }));
  }
  if (result.cleanup.protectedPaths.length) {
    const count = result.cleanup.protectedPaths.length;
    parts.push(
      t('usage.protectedExcluded', '{n} protected system {locations} excluded — see “What to delete”.', {
        n: formatCount(count),
        locations: word(count, 'app.location', 'location', 'locations'),
      })
    );
  }
  $('scan-status').textContent = parts.join(' ');

  if (result.totalFiles === 0) {
    $('scan-results').hidden = true;
    $('scan-empty').textContent = t('usage.empty', 'No readable files found in this folder.');
    $('scan-empty').hidden = false;
    return;
  }

  // Shown before the map is asked for, so it is laid out at its real width.
  $('scan-results').hidden = false;
  window.SpaceMap.show(result);

  const maxType = result.byType.length ? result.byType[0].size : 1;
  // The item is `type`, not `t`: named `t`, it hid the translation function,
  // which is how " files" stayed English in a Vietnamese window.
  renderBars($('by-type'), result.byType.slice(0, 12), maxType, (type) =>
    t('usage.typeRow', '{ext} · {n} {files}', {
      ext: type.none ? t('usage.noExtension', '(no extension)') : `.${type.ext}`,
      n: formatCount(type.count),
      files: word(type.count, 'app.file', 'file', 'files'),
    })
  );

  renderLargest(result.largestFiles);
}

function renderBars(list, items, max, labelFn) {
  list.replaceChildren();
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'bar-row';
    li.title = item.path || labelFn(item);

    const name = document.createElement('span');
    name.className = 'bar-name';
    name.textContent = labelFn(item);

    const size = document.createElement('span');
    size.className = 'bar-size';
    size.textContent = formatBytes(item.size);

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max(1, (item.size / max) * 100)}%`;
    track.appendChild(fill);

    li.append(name, size, track);
    list.appendChild(li);
  }
}

/*
 * Every list screen's rows are a CandidateList (components.js): the row shape,
 * shift-click ranges, arrow keys and the "why" behind each verdict live there
 * once. Each row still leads with View, then the two that leave -- these rows
 * exist so somebody can decide whether a file may go, and viewing is how.
 */

const lists = { largest: null, cleanup: [], dupes: [] };

const bars = {
  largest: ActionBar({
    root: $('large-actionbar'),
    readout: $('large-selection'),
    buttons: { recycle: $('delete-large') },
    selected: () => selectedOnUsage(),
  }),
  cleanup: ActionBar({
    root: $('cleanup-actionbar'),
    readout: $('cleanup-selection'),
    buttons: { recycle: $('delete-cleanup') },
    selected: () => selectedIn(state.cleanup && state.cleanup.groups, state.selectedCleanup),
  }),
  dupes: ActionBar({
    root: $('dupes-actionbar'),
    readout: $('selection-status'),
    buttons: { recycle: $('delete-dupes') },
    selected: () => selectedIn(state.dupes && state.dupes.groups, state.selectedDupes),
  }),
};

/** What is ticked on Disk usage, from the largest list and from the map, each once. */
function selectedOnUsage() {
  const out = [];
  const seen = new Set();
  for (const file of state.scan ? state.scan.largestFiles : []) {
    if (state.selectedLarge.has(file.path)) {
      seen.add(file.path);
      out.push(file);
    }
  }
  for (const [file, view] of state.mapViews) {
    if (state.selectedLarge.has(file) && !seen.has(file)) out.push(view);
  }
  return out;
}

/** The selected rows of a grouped screen, each once. */
function selectedIn(groups, selection) {
  const out = [];
  const seen = new Set();
  for (const group of groups || []) {
    for (const file of group.files) {
      if (selection.has(file.path) && !seen.has(file.path)) {
        seen.add(file.path);
        out.push(file);
      }
    }
  }
  return out;
}

/**
 * The pill on a row that states a conclusion, and opens the reasons for it.
 *
 * `verdict · confidence` where the row carries its own verdict; the confidence
 * alone where the group it sits in has already said the verdict.
 */
function evidencePill(file, { verdict = true, className = null, text = null } = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className || `badge badge-${verdict ? file.verdict : 'confidence'} badge-button`;
  el.textContent = text || (verdict ? `${verdictWord(file.verdict)} · ${confidenceWord(file.confidence)}` : confidenceWord(file.confidence));
  el.title = evidenceText(file);
  el.setAttribute('aria-label', t('evidence.open', 'Why: {reasons}', { reasons: el.title }));
  return el;
}

function renderLargest(files) {
  lists.largest = CandidateList($('largest-files'), {
    rows: files.slice(0, 50),
    selection: state.selectedLarge,
    // A known app's cache while the app is open carries no action (D4).
    selectable: (row) => !row.actions || row.actions.includes('recycle'),
    onChange: () => {
      bars.largest.update();
      window.SpaceMap.syncSelection();
    },
    meta: (file) => (file.verdict !== 'keep' && file.reason ? `${timeLabel(file)} · ${tm(file.reason)}` : timeLabel(file)),
    // Only a row the app has an opinion about carries a pill. A file no rule
    // matched says nothing, rather than wearing a "keep" on every row.
    badge: (file) => (file.verdict === 'safe' || file.verdict === 'review' ? evidencePill(file) : null),
  });
  bars.largest.update();
}

/**
 * The verdict, as the badge says it.
 *
 * The badge used to print the raw verdict key -- "safe", "review" -- which
 * happens to be English and happens to be a word. It is neither in Vietnamese.
 */
function verdictWord(verdict) {
  switch (verdict) {
    case 'safe': return t('verdict.safe', 'safe');
    case 'review': return t('verdict.review', 'review');
    case 'protected': return t('verdict.protected', 'protected');
    default: return t('verdict.keep', 'keep');
  }
}

function makeBadge(verdict, text, title) {
  const el = document.createElement('span');
  el.className = `badge badge-${verdict}`;
  el.textContent = text;
  if (title) el.title = title;
  return el;
}

function linkButton(label, handler, extra = '') {
  const btn = document.createElement('button');
  btn.className = extra ? `link ${extra}` : 'link';
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

$('delete-large').addEventListener('click', async () => {
  await deleteSelected([...state.selectedLarge], (moved) => {
    // What moved leaves the list, as it does on every other screen. It used to
    // stay, ticked off, looking as though it was still on the disk.
    const gone = new Set(moved.map((m) => m.path));
    state.selectedLarge.clear();
    for (const file of gone) state.mapViews.delete(file);
    if (state.scan) {
      state.scan.largestFiles = state.scan.largestFiles.filter((f) => !gone.has(f.path));
      renderLargest(state.scan.largestFiles);
    }
    bars.largest.update();
  });
});

/* ------------------------------------------------------------------ cleanup */

/** A group's verdict, as its head says it -- a phrase, where a row says one word. */
function groupVerdictText(verdict) {
  if (verdict === 'safe') return t('cleanup.verdict.safe', 'safe to delete');
  if (verdict === 'review') return t('cleanup.verdict.review', 'your call');
  return verdictWord(verdict);
}

function renderCleanup(cleanup, accessTimes) {
  state.cleanup = cleanup;
  state.selectedCleanup.clear();

  /* -- honesty about the timestamps we are showing ---------------------- */
  const notice = $('atime-notice');
  if (accessTimes && accessTimes.tracked === true) {
    notice.hidden = true;
  } else {
    notice.hidden = false;
    notice.textContent =
      (accessTimes && accessTimes.tracked === false
        ? t('usage.atime.unavailable', 'Last-opened dates are not available on this system.')
        : t('usage.atime.unconfirmed', 'Last-opened dates could not be confirmed on this system.')) +
      ' ' +
      (accessTimes ? `${tm(accessTimes.detail)} ` : '') +
      t('usage.atime.fallback', 'Ages below are based on the modified date instead.');
  }

  $('cstat-safe').textContent = formatBytes(cleanup.safeBytes);
  $('cstat-review').textContent = formatBytes(cleanup.reviewBytes);
  $('cstat-protected').textContent = formatCount(
    cleanup.protectedPaths.length + (cleanup.appFolders || []).length
  );
  $('cleanup-stats').hidden = false;

  const badge = $('cleanup-badge');
  if (cleanup.safeBytes > 0) {
    badge.textContent = formatBytes(cleanup.safeBytes);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  const container = $('cleanup-groups');
  container.replaceChildren();
  lists.cleanup = [];

  for (const group of cleanup.groups) {
    container.appendChild(renderCleanupGroup(group));
  }

  renderProtected([...cleanup.protectedPaths, ...(cleanup.appFolders || [])]);

  const hasSuggestions = cleanup.groups.length > 0;
  $('cleanup-toolbar').hidden = !hasSuggestions;
  $('cleanup-empty').hidden = hasSuggestions || cleanup.protectedPaths.length > 0;
  if (!hasSuggestions) {
    $('cleanup-empty').textContent = t(
      'cleanup.alreadyClean',
      'Nothing obviously disposable in this folder — it is already clean.'
    );
  }

  updateCleanupSelection();
}

function renderCleanupGroup(group) {
  const section = document.createElement('section');
  section.className = 'group';
  section.dataset.category = group.category;

  const head = document.createElement('div');
  head.className = 'group-head';

  const title = document.createElement('strong');
  // Translated from the category key rather than from the label the scan
  // produced, so switching language re-words the groups without re-scanning.
  title.textContent = t(`category.${group.category}`, group.label);

  const size = document.createElement('span');
  size.className = group.verdict === 'safe' ? 'group-waste' : '';
  size.textContent = `${formatBytes(group.bytes)} · ${formatCount(group.count)} ${word(group.count, 'app.file', 'file', 'files')}`;

  // A known app that is open (D4): its cache is shown, and nothing in it can
  // be ticked -- the rows carry no action -- until the app is closed and the
  // folder scanned again.
  const open = group.app && group.app.open !== false;
  const tickable = (file) => !file.actions || file.actions.includes('recycle');

  const selectAll = document.createElement('button');
  selectAll.className = 'group-select';
  selectAll.textContent = t('cleanup.selectAllInGroup', 'select all');
  selectAll.hidden = open;
  selectAll.addEventListener('click', () => {
    for (const file of group.files) if (tickable(file)) state.selectedCleanup.add(file.path);
    syncCleanupCheckboxes();
    updateCleanupSelection();
  });

  head.append(
    open
      ? makeBadge('keep', group.app.open === null ? t('cleanup.appUnknown', 'could not check') : t('cleanup.appOpen', 'open'))
      : makeBadge(group.verdict, groupVerdictText(group.verdict)),
    title,
    size,
    selectAll
  );

  const body = document.createElement('div');
  body.className = 'group-body';

  const hint = document.createElement('p');
  hint.className = 'group-hint';
  hint.textContent = t(`category.${group.category}.hint`, group.hint);
  body.appendChild(hint);
  if (open) {
    const why = document.createElement('p');
    why.className = 'group-hint group-open';
    why.textContent =
      group.app.open === null
        ? t('cleanup.appUnknownHint', 'Could not tell whether {app} is open, so none of this is offered.', { app: group.app.name })
        : t('cleanup.appOpenHint', '{app} is open. Close it and scan again to clear its cache.', { app: group.app.name });
    body.appendChild(why);
  }

  const list = document.createElement('ul');
  list.className = 'files';
  lists.cleanup.push(
    CandidateList(list, {
      rows: group.files,
      selection: state.selectedCleanup,
      onChange: updateCleanupSelection,
      selectable: tickable,
      meta: (file) => `${timeLabel(file)} · ${tm(file.reason)}`,
      // The group head already says the verdict; each row says how sure.
      badge: (file) => evidencePill(file, { verdict: false }),
    })
  );
  body.appendChild(list);

  if (group.truncated) {
    const more = document.createElement('p');
    more.className = 'group-hint';
    more.textContent = t('cleanup.showingLargest', 'Showing the {shown} largest of {total} files in this category.', {
      shown: group.files.length,
      total: formatCount(group.count),
    });
    body.appendChild(more);
  }

  section.append(head, body);
  return section;
}

function renderProtected(entries) {
  const card = $('protected-card');
  const list = $('protected-list');
  list.replaceChildren();

  if (!entries.length) {
    card.hidden = true;
    return;
  }

  for (const entry of entries.slice(0, 50)) {
    const li = document.createElement('li');
    li.className = 'file-row';

    const main = document.createElement('span');
    main.className = 'file-main';

    const pathEl = document.createElement('span');
    pathEl.className = 'file-path';
    pathEl.textContent = elide(entry.path, 90);
    pathEl.title = entry.path;

    const metaEl = document.createElement('span');
    metaEl.className = 'file-meta';
    metaEl.textContent = tm(entry.reason);

    main.append(pathEl, metaEl);
    li.append(makeBadge('protected', t('cleanup.blocked', 'blocked')), main);
    list.appendChild(li);
  }

  card.hidden = false;
}

function syncCleanupCheckboxes() {
  for (const list of lists.cleanup) list.sync();
}

function updateCleanupSelection() {
  // One selection on the screen at a time: the OneDrive card has a floating
  // bar of its own, and two would sit on top of each other.
  if (state.selectedCleanup.size > 0 && window.CloudCard) window.CloudCard.clearSelection();
  bars.cleanup.update();
}

$('select-safe').addEventListener('click', () => {
  if (!state.cleanup) return;
  state.selectedCleanup.clear();
  for (const group of state.cleanup.groups) {
    if (group.verdict !== 'safe') continue;
    for (const file of group.files) state.selectedCleanup.add(file.path);
  }
  syncCleanupCheckboxes();
  updateCleanupSelection();
});

$('cleanup-select-none').addEventListener('click', () => {
  state.selectedCleanup.clear();
  syncCleanupCheckboxes();
  updateCleanupSelection();
});

$('delete-cleanup').addEventListener('click', async () => {
  await deleteSelected([...state.selectedCleanup], (moved) => {
    const gone = new Set(moved.map((m) => m.path));
    state.cleanup.groups = state.cleanup.groups
      .map((g) => {
        const kept = g.files.filter((f) => !gone.has(f.path));
        const removedBytes = g.files.filter((f) => gone.has(f.path)).reduce((n, f) => n + f.size, 0);
        return { ...g, files: kept, bytes: g.bytes - removedBytes, count: g.count - (g.files.length - kept.length) };
      })
      .filter((g) => g.files.length > 0);

    const total = (verdict) =>
      state.cleanup.groups.filter((g) => g.verdict === verdict).reduce((n, g) => n + g.bytes, 0);
    state.cleanup.safeBytes = total('safe');
    state.cleanup.reviewBytes = total('review');

    renderCleanup(state.cleanup, state.accessTimes);
  });
});

/* ------------------------------------------------------------------ duplicates */

function setDupesRunning(running) {
  $('run-dupes').disabled = running || !state.folder;
  $('cancel-dupes').hidden = !running;
  $('dupes-progress').hidden = !running;
  $('pick-folder').disabled = running;
}

const PHASE_LABEL = {
  indexing: ['dupes.phase.indexing', 'Indexing files'],
  grouping: ['dupes.phase.grouping', 'Grouping by size'],
  'hashing-partial': ['dupes.phase.partial', 'Comparing file heads'],
  'hashing-full': ['dupes.phase.full', 'Verifying full contents'],
};

api.onDuplicateProgress((p) => {
  const phase = PHASE_LABEL[p.phase];
  const label = phase ? t(phase[0], phase[1]) : p.phase;
  const detail =
    p.phase === 'indexing'
      ? t('dupes.detail.indexing', '{n} files', { n: formatCount(p.files) })
      : t('dupes.detail.hashing', '{done} hashed of {total} candidates', {
          done: formatCount(p.filesHashed),
          total: formatCount(p.total || p.candidatesBySize),
        });
  $('dupes-status').textContent = `${label}… ${detail} (${formatSeconds(p.elapsedMs)})`;
});

$('run-dupes').addEventListener('click', async () => {
  if (!state.folder) return;
  setDupesRunning(true);
  $('dupes-empty').hidden = true;
  $('dupe-groups').replaceChildren();
  state.selectedDupes.clear();

  const minSize = Number($('min-size').value);
  const result = unwrap(
    await api.findDuplicates([state.folder], { minSize }),
    t('app.label.dupes', 'Duplicate search')
  );
  setDupesRunning(false);
  if (!result) {
    $('dupes-status').textContent = t('dupes.failed', 'Duplicate search failed.');
    return;
  }

  state.dupes = hydrateDupes(result);
  renderDupes(state.dupes);
});

/** The duplicate groups, each holding the candidates it names. */
function hydrateDupes(result) {
  const byId = indexCandidates(result.candidates);
  const { candidates, ...rest } = result;
  return {
    ...rest,
    groups: result.groups.map(({ ids, ...group }) => ({
      ...group,
      files: viewsOf(ids, byId).map((file) => ({
        ...file,
        keeper: file.keeper,
        protected: file.component,
        protectionReason: file.component ? file.reason : null,
      })),
    })),
  };
}

$('cancel-dupes').addEventListener('click', () => api.cancelDuplicates());

function renderDupes(result) {
  $('dstat-groups').textContent = formatCount(result.totalGroups);
  $('dstat-waste').textContent = formatBytes(result.reclaimableBytes);
  $('dstat-hashed').textContent = formatCount(result.filesHashed);
  $('dstat-time').textContent = formatSeconds(result.durationMs);
  $('dupes-stats').hidden = false;

  const notes = [t('dupes.checked', 'Checked {n} files.', { n: formatCount(result.indexedFiles) })];
  if (result.withheldFiles) {
    notes.push(
      t(
        'dupes.withheld',
        '{n} copies belong to installed programs or dependency folders and are not auto-selected — ' +
          'only {selectable} of the {total} is safe to bulk-delete.',
        {
          n: formatCount(result.withheldFiles),
          selectable: formatBytes(result.selectableBytes),
          total: formatBytes(result.reclaimableBytes),
        }
      )
    );
  }
  if (result.cacheHits) {
    notes.push(t('dupes.cacheHits', '{n} hashes reused from cache.', { n: formatCount(result.cacheHits) }));
  }
  if (result.cancelled) notes.push(t('app.cancelledPartial', 'Cancelled — results are partial.'));
  if (result.errorCount) {
    notes.push(t('dupes.unreadable', '{n} files could not be read.', { n: formatCount(result.errorCount) }));
  }
  $('dupes-status').textContent = notes.join(' ');

  const container = $('dupe-groups');
  container.replaceChildren();
  lists.dupes = [];

  if (result.totalGroups === 0) {
    $('dupes-toolbar').hidden = true;
    $('dupes-empty').textContent = t('dupes.empty', 'No duplicate files found in this folder.');
    $('dupes-empty').hidden = false;
    return;
  }

  $('dupes-toolbar').hidden = false;
  for (const group of result.groups.slice(0, 300)) {
    container.appendChild(renderGroup(group));
  }
  updateSelectionStatus();
}

function renderGroup(group) {
  const section = document.createElement('section');
  section.className = 'group';
  section.dataset.hash = group.hash;

  const head = document.createElement('div');
  head.className = 'group-head';
  const title = document.createElement('strong');
  title.textContent = t('dupes.groupTitle', '{n} identical copies · {size} each', {
    n: group.count,
    size: formatBytes(group.size),
  });
  const waste = document.createElement('span');
  waste.className = 'group-waste';
  waste.textContent = t('dupes.reclaimableAmount', '{size} reclaimable', { size: formatBytes(group.wastedBytes) });
  head.append(title, waste);

  const body = document.createElement('div');
  body.className = 'group-body';
  const list = document.createElement('ul');
  list.className = 'files';

  lists.dupes.push(
    CandidateList(list, {
      rows: group.files,
      selection: state.selectedDupes,
      onChange: updateSelectionStatus,
      meta: (file) => (file.protected ? `${timeLabel(file)} · ${tm(file.protectionReason)}` : timeLabel(file)),
      // Every copy says why it is where it is: the oldest, one an installed
      // program uses, or simply identical -- which is the one thing on this
      // screen the app is certain of.
      badge: (file) => {
        if (file.protected) {
          return evidencePill(file, {
            className: 'badge badge-protected badge-button',
            text: `${t('cleanup.inUse', 'in use')} · ${confidenceWord(file.confidence)}`,
          });
        }
        if (file.keeper) {
          return evidencePill(file, {
            className: 'keeper-tag badge-button',
            text: `${t('dupes.oldest', 'oldest')} · ${confidenceWord(file.confidence)}`,
          });
        }
        return evidencePill(file, {
          className: 'badge badge-confidence badge-button',
          text: `${t('dupes.identical', 'identical')} · ${confidenceWord(file.confidence)}`,
        });
      },
    })
  );

  body.appendChild(list);
  section.append(head, body);
  return section;
}

function updateSelectionStatus() {
  bars.dupes.update();
}

$('select-extra').addEventListener('click', () => {
  if (!state.dupes) return;
  state.selectedDupes.clear();
  let skipped = 0;
  for (const group of state.dupes.groups) {
    for (const file of group.files) {
      if (file.keeper) continue;
      // Program components are listed but never bulk-selected: for these,
      // "identical" does not mean "redundant".
      if (file.protected) {
        skipped++;
        continue;
      }
      state.selectedDupes.add(file.path);
    }
  }
  syncCheckboxes();
  updateSelectionStatus();
  if (skipped > 0) {
    toast(
      t(
        'dupes.skippedNote',
        '{n} {files} left unselected — they belong to installed programs or dependency folders. ' +
          'Tick them individually if you are sure.',
        { n: formatCount(skipped), files: word(skipped, 'app.file', 'file', 'files') }
      )
    );
  }
});

$('select-none').addEventListener('click', () => {
  state.selectedDupes.clear();
  syncCheckboxes();
  updateSelectionStatus();
});

function syncCheckboxes() {
  for (const list of lists.dupes) list.sync();
}

$('delete-dupes').addEventListener('click', async () => {
  await deleteSelected([...state.selectedDupes], (moved) => {
    const gone = new Set(moved.map((m) => m.path));
    state.selectedDupes.clear();

    // Drop deleted files from the model, then any group that no longer has
    // two copies left.
    state.dupes.groups = state.dupes.groups
      .map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) }))
      .filter((g) => g.files.length > 1)
      .map((g) => ({
        ...g,
        count: g.files.length,
        wastedBytes: g.size * (g.files.length - 1),
      }));

    state.dupes.totalGroups = state.dupes.groups.length;
    state.dupes.reclaimableBytes = state.dupes.groups.reduce((n, g) => n + g.wastedBytes, 0);
    renderDupes(state.dupes);
  });
});

/* ------------------------------------------------------------------ delete */

/** "about 2 minutes" / "about 1 hour 38 minutes" -- for a wait, not a duration stat. */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 5) return t('app.eta.almost', 'almost done');
  if (seconds < 60) return t('app.eta.seconds', '{n}s left', { n: seconds });

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('app.eta.minutes', '{n} min left', { n: minutes });

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t('app.eta.hoursMinutes', '{h}h {m}m left', { h: hours, m: rest })
    : t('app.eta.hours', '{h}h left', { h: hours });
}

/* ---- the shared progress panel, used by every delete path ---- */

const DELETE_BUTTONS = ['delete-large', 'delete-dupes', 'delete-cleanup', 'media-delete', 'restore-selected', 'cloud-dehydrate'];

const progressPanel = {
  show(title) {
    $('dp-title').textContent = title;
    $('dp-count').textContent = t('app.preparing', 'Preparing…');
    $('dp-rate').textContent = '';
    $('dp-eta').textContent = '';
    $('dp-current').textContent = '';
    $('dp-fill').style.width = '0%';
    $('dp-cancel').disabled = false;
    $('dp-cancel').textContent = t('app.stop', 'Stop');
    $('delete-progress').hidden = false;

    // Nothing else may start a delete while one is running.
    setActionRunning(true);
    for (const id of DELETE_BUTTONS) $(id).disabled = true;
  },

  update(p) {
    if (p.phase === 'done') return;

    const fill = $('dp-fill');
    const pct = p.total > 0 ? Math.min(100, (p.done / p.total) * 100) : 0;
    fill.style.width = `${pct}%`;
    fill.classList.toggle('is-checking', p.phase === 'checking');

    if (p.phase === 'checking') {
      $('dp-title').textContent = t('delete.checking', 'Checking what can be deleted');
      $('dp-count').textContent = t('delete.checkedCount', '{done} of {total} checked', {
        done: formatCount(p.done),
        total: formatCount(p.total),
      });
      $('dp-rate').textContent = p.bytes ? formatBytes(p.bytes) : '';
      $('dp-eta').textContent = '';
      return;
    }

    if (p.phase === 'confirming') {
      $('dp-title').textContent = t('delete.waiting', 'Waiting for confirmation');
      $('dp-count').textContent = t('delete.ready', '{n} {items} ready · {size}', {
        n: formatCount(p.total),
        items: word(p.total, 'app.item', 'item', 'items'),
        size: formatBytes(p.totalBytes),
      });
      $('dp-rate').textContent = '';
      $('dp-eta').textContent = '';
      $('dp-current').textContent = '';
      fill.style.width = '100%';
      return;
    }

    // Making files online-only moves nothing and deletes nothing: its words
    // are its own, and what it counts as freed is what it measured.
    if (p.phase === 'dehydrating' || p.phase === 'waitingForOneDrive') {
      $('dp-title').textContent =
        p.phase === 'dehydrating'
          ? t('cloud.progress.handing', 'Handing files to OneDrive')
          : t('cloud.progress.waiting', 'Waiting for OneDrive to free the space');
      $('dp-count').textContent =
        p.phase === 'dehydrating'
          ? t('cloud.progress.handed', '{done} of {total}', { done: formatCount(p.done), total: formatCount(p.total) })
          : t('cloud.progress.freed', '{done} of {total} freed · {freed} measured so far', {
              done: formatCount(p.done),
              total: formatCount(p.total),
              freed: formatBytes(p.freedBytes),
            });
      $('dp-rate').textContent = '';
      $('dp-eta').textContent = '';
      $('dp-current').textContent = p.currentPath ? elide(p.currentPath, 78) : '';
      return;
    }

    $('dp-title').textContent =
      p.phase === 'restoring'
        ? t('restore.progressTitle', 'Putting back from the Recycle Bin')
        : t('delete.title', 'Moving to Recycle Bin');
    // `freedBytes` in the progress frames is what has *moved*: nothing is
    // freed until the bin is emptied, and the words here say moved.
    $('dp-count').textContent = t('delete.progress', '{done} of {total} · {moved} of {size}', {
      done: formatCount(p.done),
      total: formatCount(p.total),
      moved: formatBytes(p.freedBytes),
      size: formatBytes(p.totalBytes),
    });
    $('dp-rate').textContent =
      p.ratePerSec > 0 ? t('delete.rate', '{n} files/s', { n: Math.round(p.ratePerSec) }) : '';
    $('dp-eta').textContent = p.etaMs != null ? formatDuration(p.etaMs) : '';
    if (p.currentPath) $('dp-current').textContent = elide(p.currentPath, 78);
  },

  hide() {
    $('delete-progress').hidden = true;
    setActionRunning(false);
    for (const id of DELETE_BUTTONS) $(id).disabled = true; // re-enabled by selection state
    for (const bar of Object.values(bars)) bar.update();
    // `media.js` loads after this file, so its updater may not exist yet -- a
    // delete cannot have run before then, but guarding costs nothing and the
    // alternative is a load-order dependency nobody would expect.
    if (typeof updateSelection === 'function') updateSelection();
  },
};

api.onTrashProgress((p) => progressPanel.update(p));

$('dp-cancel').addEventListener('click', async () => {
  $('dp-cancel').disabled = true;
  $('dp-cancel').textContent = t('app.stopping', 'Stopping…');
  await api.cancelTrash();
});

/**
 * Hand paths to the main process, which vets them and shows the native
 * confirmation dialog before anything moves to the Recycle Bin. Progress
 * arrives on trash:progress and drives the shared panel above.
 *
 * `options.context` reaches the confirmation dialog, which uses it to decide
 * which warnings belong in front of this particular delete. It is a hint about
 * where the request came from and never a permission: every guard in
 * `trash.js`, and the cloud warning in `ipc.js`, applies whatever it says.
 */
async function deleteSelected(paths, onDone, options = {}) {
  if (paths.length === 0) return;

  progressPanel.show(t('delete.checking', 'Checking what can be deleted'));
  let result;
  try {
    result = unwrap(await api.trash(paths, options), t('app.label.delete', 'Delete'));
  } finally {
    progressPanel.hide();
  }
  if (!result) return;

  const moved = result.moved.length;

  // Whatever screen this came from, the main process has taken what moved off
  // the map of the folder; the map asks again so it stops drawing it.
  if (moved > 0 && !result.dryRun && window.SpaceMap) window.SpaceMap.refresh();

  // A stop part-way through still moved everything up to that point.
  if (result.cancelled) {
    if (moved > 0) {
      toast(
        t(
          'delete.stoppedToBin',
          'Stopped. {n} {items} ({size}) already in the Recycle Bin · {left} left untouched.',
          {
            n: formatCount(moved),
            items: word(moved, 'app.item', 'item', 'items'),
            size: formatBytes(result.movedBytes),
            left: formatCount(result.remaining || 0),
          }
        )
      );
      onDone(result.moved);
    } else {
      toast(t('delete.cancelled', 'Delete cancelled — nothing was removed.'));
    }
    return;
  }

  if (moved > 0) {
    const took = result.durationMs
      ? t('delete.took', ' in {n}s', { n: (result.durationMs / 1000).toFixed(1) })
      : '';
    const skipped = [];
    if (result.needsAdmin) {
      skipped.push(t('delete.needsAdmin', '{n} need administrator permission', { n: formatCount(result.needsAdmin) }));
    }
    if (result.inUse) {
      skipped.push(t('delete.inUse', '{n} in use by another program', { n: formatCount(result.inUse) }));
    }
    const otherFailures = result.failed.length - (result.needsAdmin || 0) - (result.inUse || 0);
    if (otherFailures > 0) {
      skipped.push(t('delete.otherSkipped', '{n} skipped', { n: formatCount(otherFailures) }));
    }

    // The receipt says moved, and says what that means. "2.1 GB freed" after a
    // move to the Recycle Bin was the most misleading sentence the app could
    // print, and it printed it after every delete.
    toast(
      t('delete.movedToBin', 'Moved {n} {items} ({size}) to the Recycle Bin{took} — not freed until the bin is emptied', {
        n: formatCount(moved),
        items: word(moved, 'app.item', 'item', 'items'),
        took,
        size: formatBytes(result.movedBytes),
      }) + (skipped.length ? ` · ${skipped.join(', ')}` : '')
    );
    onDone(result.moved);
  } else {
    toast(
      t('delete.nothing', 'Nothing was deleted. {reason}', {
        reason: result.failed[0] ? result.failed[0].error : '',
      }),
      true
    );
  }

  if (result.failed.length) {
    console.warn('Skipped during delete:', result.failed);
  }
}

/* ------------------------------------------------------- language changes */

/**
 * Redraw what the DOM pass cannot reach.
 *
 * `translateDom` only touches text that is in the markup as written. Everything
 * built from a result -- the file rows, the category groups, the status lines --
 * was composed in the old language and has to be composed again. Rendering from
 * the state already held is what makes the switch instant rather than a reload.
 */
onLanguageChange(() => {
  if (state.folder) {
    $('target-path').textContent = elide(state.folder, 70);
    $('target-path').title = state.folder;
  } else {
    $('target-path').textContent = t('app.noFolder', 'No folder selected');
    $('scan-status').textContent = t('app.pickToBegin', 'Pick a folder to begin.');
    $('dupes-status').textContent = t('app.pickToBegin', 'Pick a folder to begin.');
  }

  if (state.scan) renderScan(state.scan);
  if (state.dupes) renderDupes(state.dupes);
  updateCleanupSelection();
  updateSelectionStatus();
});
