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
  selectedLarge: new Set(),
  selectedCleanup: new Set(),
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
    btn.textContent = t(`app.path.${label}`, label[0].toUpperCase() + label.slice(1));
    btn.title = value;
    btn.addEventListener('click', () => setFolder(value));
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

  state.scan = result;
  state.selectedLarge.clear();
  renderScan(result);
});

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

  const max = result.topFolders.length ? result.topFolders[0].size : 1;
  renderBars($('top-folders'), result.topFolders.slice(0, 12), max, (f) => f.name);

  const maxType = result.byType.length ? result.byType[0].size : 1;
  renderBars($('by-type'), result.byType.slice(0, 12), maxType, (t) => `.${t.ext} · ${formatCount(t.count)} files`);

  renderLargest(result.largestFiles);
  $('scan-results').hidden = false;
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

function renderLargest(files) {
  const list = $('largest-files');
  list.replaceChildren();

  for (const file of files.slice(0, 50)) {
    const badge =
      file.verdict === 'safe' || file.verdict === 'review'
        ? makeBadge(file.verdict, verdictWord(file.verdict), tm(file.reason))
        : null;

    list.appendChild(
      fileRow(
        file,
        state.selectedLarge,
        () => {
          $('delete-large').disabled = state.selectedLarge.size === 0;
        },
        {
          meta: file.reason ? `${timeLabel(file)} · ${tm(file.reason)}` : timeLabel(file),
          badge,
        }
      )
    );
  }
  $('delete-large').disabled = true;
}

/**
 * One selectable file row: checkbox, size, path, a reason/age line, an optional
 * verdict badge, and reveal/open actions.
 */
function fileRow(file, selection, onToggle, { meta = null, badge = null } = {}) {
  const li = document.createElement('li');
  li.className = 'file-row';
  li.dataset.path = file.path;

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = selection.has(file.path);
  check.addEventListener('change', () => {
    if (check.checked) selection.add(file.path);
    else selection.delete(file.path);
    onToggle();
  });

  const size = document.createElement('span');
  size.className = 'file-size';
  size.textContent = formatBytes(file.size);

  const main = document.createElement('span');
  main.className = 'file-main';

  const pathEl = document.createElement('span');
  pathEl.className = 'file-path';
  pathEl.textContent = elide(file.path, 90);
  pathEl.title = file.path;
  main.appendChild(pathEl);

  const metaText = meta === null ? timeLabel(file) : meta;
  if (metaText) {
    const metaEl = document.createElement('span');
    metaEl.className = 'file-meta';
    metaEl.textContent = metaText;
    metaEl.title = metaText;
    main.appendChild(metaEl);
  }

  /*
   * View first, then the two that leave.
   *
   * These rows exist so somebody can decide whether a file may go, and until
   * now the only way to find out what was in one was Open -- which hands it to
   * Word or Acrobat and puts the decision two applications away from the list
   * it was being made in. Viewing is the common act, so it leads and it is the
   * one drawn as a button; revealing and opening are the exits and stay quiet.
   */
  const actions = document.createElement('span');
  actions.className = 'file-actions';
  actions.append(
    linkButton(t('app.view', 'View'), () => openViewer(file.path), 'is-lead'),
    linkButton(t('app.reveal', 'Reveal'), () => api.reveal(file.path)),
    linkButton(t('app.open', 'Open'), async () =>
      unwrap(await api.open(file.path), t('app.open', 'Open'))
    )
  );

  li.append(check, size, main);
  if (badge) li.appendChild(badge);
  li.appendChild(actions);
  return li;
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
  await deleteSelected([...state.selectedLarge], () => {
    state.selectedLarge.clear();
    $('delete-large').disabled = true;
  });
});

/* ------------------------------------------------------------------ cleanup */

const VERDICT_TEXT = {
  safe: 'safe to delete',
  review: 'your call',
};

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

  const selectAll = document.createElement('button');
  selectAll.className = 'group-select';
  selectAll.textContent = t('cleanup.selectAllInGroup', 'select all');
  selectAll.addEventListener('click', () => {
    for (const file of group.files) state.selectedCleanup.add(file.path);
    syncCleanupCheckboxes();
    updateCleanupSelection();
  });

  head.append(
    makeBadge(group.verdict, VERDICT_TEXT[group.verdict] || group.verdict),
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

  const list = document.createElement('ul');
  list.className = 'files';
  for (const file of group.files) {
    list.appendChild(
      fileRow(file, state.selectedCleanup, updateCleanupSelection, {
        meta: `${timeLabel(file)} · ${tm(file.reason)}`,
      })
    );
  }
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
  for (const row of $('cleanup-groups').querySelectorAll('.file-row')) {
    const box = row.querySelector('input[type="checkbox"]');
    if (box) box.checked = state.selectedCleanup.has(row.dataset.path);
  }
}

function updateCleanupSelection() {
  const count = state.selectedCleanup.size;
  let bytes = 0;
  if (state.cleanup) {
    for (const group of state.cleanup.groups) {
      for (const file of group.files) {
        if (state.selectedCleanup.has(file.path)) bytes += file.size;
      }
    }
  }
  $('cleanup-selection').textContent = count
    ? t('app.selectedCount', '{n} selected · {size}', { n: formatCount(count), size: formatBytes(bytes) })
    : t('app.nothingSelected', 'Nothing selected');
  $('delete-cleanup').disabled = count === 0;
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

  state.dupes = result;
  renderDupes(result);
});

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

  for (const file of group.files) {
    let badge = null;
    if (file.protected) {
      badge = makeBadge('protected', t('cleanup.inUse', 'in use'), tm(file.protectionReason));
    } else if (file.keeper) {
      badge = document.createElement('span');
      badge.className = 'keeper-tag';
      badge.textContent = t('dupes.oldest', 'oldest');
      badge.title = t('dupes.oldestHint', 'Oldest copy — suggested keeper');
    }

    list.appendChild(
      fileRow(file, state.selectedDupes, updateSelectionStatus, {
        badge,
        meta: file.protected ? `${timeLabel(file)} · ${file.protectionReason}` : null,
      })
    );
  }

  body.appendChild(list);
  section.append(head, body);
  return section;
}

function updateSelectionStatus() {
  const count = state.selectedDupes.size;
  const bytes = sumSelected(state.selectedDupes);
  $('selection-status').textContent = count
    ? t('app.selectedCount', '{n} selected · {size}', { n: formatCount(count), size: formatBytes(bytes) })
    : t('app.nothingSelected', 'Nothing selected');
  $('delete-dupes').disabled = count === 0;
}

function sumSelected(selection) {
  if (!state.dupes) return 0;
  let total = 0;
  for (const group of state.dupes.groups) {
    for (const file of group.files) {
      if (selection.has(file.path)) total += file.size;
    }
  }
  return total;
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
  for (const row of $('dupe-groups').querySelectorAll('.file-row')) {
    const box = row.querySelector('input[type="checkbox"]');
    if (box) box.checked = state.selectedDupes.has(row.dataset.path);
  }
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

const DELETE_BUTTONS = ['delete-large', 'delete-dupes', 'delete-cleanup', 'media-delete'];

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

    $('dp-title').textContent = t('delete.title', 'Moving to Recycle Bin');
    $('dp-count').textContent =
      `${formatCount(p.done)} of ${formatCount(p.total)} · ${formatBytes(p.freedBytes)} of ${formatBytes(p.totalBytes)}`;
    $('dp-rate').textContent =
      p.ratePerSec > 0 ? t('delete.rate', '{n} files/s', { n: Math.round(p.ratePerSec) }) : '';
    $('dp-eta').textContent = p.etaMs != null ? formatDuration(p.etaMs) : '';
    if (p.currentPath) $('dp-current').textContent = elide(p.currentPath, 78);
  },

  hide() {
    $('delete-progress').hidden = true;
    for (const id of DELETE_BUTTONS) $(id).disabled = true; // re-enabled by selection state
    updateSelectionStatus();
    updateCleanupSelection();
    // `media.js` loads after this file, so its updater may not exist yet -- a
    // delete cannot have run before then, but guarding costs nothing and the
    // alternative is a load-order dependency nobody would expect.
    if (typeof updateSelection === 'function') updateSelection();
    $('delete-large').disabled = state.selectedLarge.size === 0;
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

  // A stop part-way through still moved everything up to that point.
  if (result.cancelled) {
    if (moved > 0) {
      toast(
        t(
          'delete.stopped',
          'Stopped. {n} {items} already moved to the Recycle Bin · {freed} freed · {left} left untouched.',
          {
            n: formatCount(moved),
            items: word(moved, 'app.item', 'item', 'items'),
            freed: formatBytes(result.freedBytes),
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

    toast(
      t('delete.moved', 'Moved {n} {items} to the Recycle Bin{took} · {freed} freed', {
        n: formatCount(moved),
        items: word(moved, 'app.item', 'item', 'items'),
        took,
        freed: formatBytes(result.freedBytes),
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
