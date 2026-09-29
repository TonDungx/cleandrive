'use strict';

const api = window.cleandrive;
const $ = (id) => document.getElementById(id);

const state = {
  folder: null,
  // Every folder chosen (A4); `folder` is the first.
  roots: [],
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
// The unit carries its own separator: English writes `17.7s` closed up and
// Vietnamese writes `17.7 giây` with a space, and deciding that here would
// make it English's rule for every language.
const formatSeconds = (ms) => t('app.seconds', '{n}s', { n: (ms / 1000).toFixed(1) });

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

/**
 * Tell a screen reader something that is not where its focus is.
 *
 * Cleared first and written a frame later, so the same sentence twice in a row
 * -- two deletes of the same size -- is announced twice rather than taken for
 * no change. A failure goes to the assertive region, which interrupts.
 */
function announce(message, { assertive = false } = {}) {
  const el = $(assertive ? 'sr-assertive' : 'sr-polite');
  if (!el || !message) return;
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}

/**
 * A receipt at the bottom of the window.
 *
 * It stays while the pointer or the focus is on it, and a long one stays
 * longer: a toast that vanishes before it has been read is a receipt nobody
 * got. A screen reader hears it through announce(), not by finding it.
 */
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.hidden = false;
  announce(message, { assertive: isError });
  toast._ms = Math.min(15000, 5000 + String(message).length * 40);
  armToast();
}

function armToast() {
  const el = $('toast');
  clearTimeout(toast._timer);
  if (el.matches(':hover, :focus-within')) return;
  toast._timer = setTimeout(() => {
    el.hidden = true;
  }, toast._ms || 5000);
}

$('toast').addEventListener('mouseenter', () => clearTimeout(toast._timer));
$('toast').addEventListener('mouseleave', armToast);
$('toast').addEventListener('focusin', () => clearTimeout(toast._timer));
$('toast').addEventListener('focusout', armToast);

/** Unwrap the { ok, data, error } envelope every IPC handler returns. */
function unwrap(envelope, label) {
  if (!envelope || !envelope.ok) {
    const message = envelope && envelope.error ? envelope.error : t('app.unknownError', 'Unknown error');
    if (!envelope || !envelope.cancelled) toast(`${label}: ${message}`, true);
    return null;
  }
  return envelope.data;
}

/* ------------------------------------------------------------------ redraw */

/**
 * Change a line of text only when the words are different.
 *
 * Assigning `textContent` swaps the text node for a new one even when nothing
 * changed, and a screen reader reading that line loses its place. Two screens
 * redraw themselves on every reading the disk monitor takes -- once a minute
 * by default -- so "nothing changed" is the usual case, not the rare one.
 */
function setText(el, text) {
  const value = String(text);
  if (el.textContent !== value) el.textContent = value;
}

/** What the keyboard can stand on inside a block that gets redrawn. */
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Put new rows in `host` only when they differ from the rows already there.
 *
 * The lists on Automatic and Trends used to be rebuilt from nothing on every
 * background write. Measured with the monitor on: a tick box with the keyboard
 * on it was taken out of the page at the next reading, focus fell to the
 * document, and Narrator went with it -- reading from a place the screen showed
 * as empty. Identical markup is identical data here (every handler on these
 * rows closes over something the row also shows, in its text or its title), so
 * the rows in place are kept, listeners and all.
 *
 * When something did change with focus inside, focus goes to the control in
 * the same position, or to the last one left, rather than to nowhere.
 *
 * Not for rows whose state lives in a property the markup does not show (a
 * tick box's `checked`): identical markup would not mean identical rows.
 */
function replaceChildrenIfChanged(host, nodes) {
  const next = document.createElement(host.tagName);
  next.append(...nodes);
  if (next.innerHTML === host.innerHTML) return false;

  const active = document.activeElement;
  const at = active && host.contains(active) ? [...host.querySelectorAll(FOCUSABLE)].indexOf(active) : -1;
  host.replaceChildren(...next.childNodes);
  if (at >= 0 && !host.contains(document.activeElement)) {
    const left = [...host.querySelectorAll(FOCUSABLE)];
    const target = left[Math.min(at, left.length - 1)];
    if (target) target.focus();
  }
  return true;
}

/* ------------------------------------------------------------------ folder */

/**
 * The folders every screen works on (A4). "Choose folder" picks one; more are
 * added beside it (roots.js), and a whole drive is one folder, its root.
 * `state.folder` stays the first of them, for everything that only ever took
 * one.
 */
function setRoots(list) {
  const roots = [];
  for (const folder of list) {
    if (folder && !roots.some((r) => r.toLowerCase() === folder.toLowerCase())) roots.push(folder);
  }
  if (roots.length === 0) return;
  state.roots = roots;
  state.folder = roots[0];
  showRoots();
  $('run-scan').disabled = false;
  $('run-dupes').disabled = false;
  $('scan-status').textContent = t('usage.ready', 'Ready to scan.');
  $('dupes-status').textContent = t('dupes.ready', 'Ready to search.');
  if (window.Roots) window.Roots.render();
}

function showRoots() {
  const roots = state.roots || [];
  $('target-path').textContent = roots.length > 1
    ? t('app.target.many', '{n} folders', { n: formatCount(roots.length) })
    : elide(roots[0], 70);
  $('target-path').title = roots.join('\n');
  $('run-scan').textContent = roots.length > 1
    ? t('usage.scanMany', 'Scan {n} folders', { n: formatCount(roots.length) })
    : t('usage.scan', 'Scan folder');
  showFastScan();
}

/**
 * "Fast scan (needs administrator)" (A2), offered for a whole drive only.
 *
 * Reading the volume's own catalogue costs what the *volume* costs. Measured:
 * D: holds 516,000 records where a walk of the same drive lists 192,000,
 * because the walk skips `node_modules`, `.git` and hidden folders and a
 * catalogue cannot skip anything. For one folder the fast scan is the slower
 * one, and it asks for a UAC prompt to be slower.
 *
 * Whether the drive is NTFS is not known here, and asking would be a second
 * round trip before anybody has pressed anything. The main process checks it
 * for real and falls back to the ordinary walk, saying so on the status line.
 */
function showFastScan() {
  const roots = state.roots || [];
  const wholeDrive = roots.length === 1 && /^[A-Za-z]:\\$/.test(roots[0]);
  $('fast-scan-box').hidden = !wholeDrive;
  if (!wholeDrive) $('fast-scan').checked = false;
}

async function setFolder(folder) {
  if (!folder) return;
  setRoots([folder]);
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
//
// The sidebar is a tab list in the ARIA sense as well as the visual one: each
// tab says whether it is the selected one and which panel it controls, only
// the selected tab is a Tab stop, and the arrow keys move between them. A
// screen reader used to hear nine tabs, every one of them "not selected".
const TABS = [...document.querySelectorAll('.tab[data-tab]')];

function selectTab(tab, { focus = false } = {}) {
  // A button that opens another screen (System's "Open Restore" and "Look
  // inside with Disk usage", Explorer's menu arriving while the keyboard is
  // somewhere in a screen) leaves the keyboard on a control that is
  // about to be hidden, and a hidden control drops focus to the document --
  // where Narrator starts reading from nothing. The new screen's tab takes it,
  // and says which screen this is. A caller that knows better focuses its own
  // control afterwards.
  const active = document.activeElement;
  const stranded = Boolean(active && active.closest('.panel') && !active.closest(`#panel-${tab.dataset.tab}`));
  for (const other of TABS) {
    const on = other === tab;
    other.classList.toggle('is-active', on);
    other.setAttribute('aria-selected', String(on));
    other.tabIndex = on ? 0 : -1;
  }
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('is-active', p.id === `panel-${tab.dataset.tab}`);
  });
  // The main region is named after the screen in it: "Disk usage, main".
  // Chromium makes it focusable (it is what scrolls), and a focusable thing
  // with no name is read as nothing.
  document.querySelector('main').setAttribute('aria-labelledby', tab.id);
  if (focus || stranded) tab.focus();
}

for (const tab of TABS) {
  tab.id = `tab-${tab.dataset.tab}`;
  tab.setAttribute('aria-controls', `panel-${tab.dataset.tab}`);
  const panel = $(`panel-${tab.dataset.tab}`);
  if (panel) panel.setAttribute('aria-labelledby', tab.id);
  tab.addEventListener('click', () => selectTab(tab));
}
selectTab(TABS.find((tab) => tab.classList.contains('is-active')) || TABS[0]);

document.querySelector('.sidebar-nav').addEventListener('keydown', (event) => {
  const index = TABS.indexOf(event.target);
  if (index < 0) return;
  const last = TABS.length - 1;
  const next = {
    ArrowDown: index === last ? 0 : index + 1,
    ArrowRight: index === last ? 0 : index + 1,
    ArrowUp: index === 0 ? last : index - 1,
    ArrowLeft: index === 0 ? last : index - 1,
    Home: 0,
    End: last,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  // Selection follows focus: every panel is already drawn, so showing one
  // costs nothing and saves a second key press on every move. Through a
  // click, because the screens that load on being opened (Trends, Restore,
  // System, Settings) listen for exactly that.
  TABS[next].click();
  TABS[next].focus();
});

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
  // As for duplicates: a late frame must not overwrite the finished scan's line.
  if ($('cancel-scan').hidden) return;
  // The fast scan reads the volume's catalogue before any folder is walked,
  // and that is most of its time. Saying "scanning… 0 files" for twenty-three
  // seconds would look like a scan that had stopped.
  if (p.phase === 'prompt') {
    setText($('scan-status'), t('usage.fast.prompt', 'Waiting for the administrator prompt…'));
    return;
  }
  if (p.phase === 'mft') {
    setText($('scan-status'), t('usage.fast.reading', 'Reading the drive’s own catalogue… {n} of {of} records', {
      n: formatCount(p.records || 0),
      of: formatCount(p.of || 0),
    }));
    return;
  }
  const counts = {
    files: formatCount(p.files),
    size: formatBytes(p.bytes),
    elapsed: formatSeconds(p.elapsedMs),
  };
  // Several folders are scanned one after another; the line says which.
  $('scan-status').textContent = p.roots > 1
    ? t('usage.scanningMany', 'Scanning folder {i} of {n}, {root}… {files} files, {size} ({elapsed})', {
      ...counts,
      i: p.rootIndex + 1,
      n: p.roots,
      root: elide(p.root, 40),
    })
    : t('usage.scanning', 'Scanning… {files} files, {size} ({elapsed})', counts);
});

$('run-scan').addEventListener('click', async () => {
  if (!state.folder) return;
  setScanRunning(true);
  $('scan-empty').hidden = true;

  const result = unwrap(
    await api.scan(state.roots, !$('fast-scan-box').hidden && $('fast-scan').checked),
    t('app.label.scan', 'Scan')
  );
  setScanRunning(false);
  if (!result) {
    $('scan-status').textContent = t('usage.failed', 'Scan failed.');
    return;
  }

  state.scan = hydrateScan(result);
  state.selectedLarge.clear();
  renderScan(state.scan);
  if (window.Roots) window.Roots.describe(result);
  announce($('scan-status').textContent);
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
  // What it took, all of it. A fast scan spends most of its time reading the
  // volume's catalogue before a single folder is walked, and `durationMs` is
  // only the walking -- it is the number a snapshot keeps, so it has to stay
  // comparable between the two scanners. The tile is what somebody reads
  // against a clock, so the tile adds the reading back in.
  const readMs = (result.roots || []).reduce((t, r) => t + (r.mft ? r.mft.ms : 0), 0);
  $('stat-time').textContent = formatSeconds(result.durationMs + readMs);
  $('scan-stats').hidden = false;

  // Access-time support has to be known before any row renders its age.
  state.accessTimes = result.accessTimes;
  renderCleanup(result.cleanup, result.accessTimes);

  const roots = result.roots || [];
  const parts = [
    roots.length > 1
      ? t('usage.scannedMany', 'Scanned {n} files in {roots} folders.', { n: formatCount(result.totalFiles), roots: roots.length })
      : t('usage.scanned', 'Scanned {n} files.', { n: formatCount(result.totalFiles) }),
  ];
  if (result.cancelled) parts.push(t('app.cancelledPartial', 'Cancelled — results are partial.'));
  parts.push(...rootNotes(result));
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

/**
 * What the scan did with the folders it was given (A4): the ones folded into
 * another, the ones that were not there, the ones it only reads, and a whole
 * drive's space that it did not count.
 */
function rootNotes(result) {
  const notes = [];
  for (const { root, into } of result.merged || []) {
    notes.push(t('usage.merged', '{root} is inside {into}, so it was scanned with it.', { root: elide(root, 40), into: elide(into, 40) }));
  }
  for (const { root, reason } of result.refused || []) {
    notes.push(reason === 'notFolder'
      ? t('usage.refused.notFolder', '{root} was not scanned: it is not a folder.', { root: elide(root, 40) })
      : t('usage.refused.missing', '{root} was not scanned: it is not there any more.', { root: elide(root, 40) }));
  }
  if ((result.notScanned || []).length) {
    notes.push(t('usage.notReached', '{n} not reached before the scan was stopped.', { n: formatCount(result.notScanned.length) }));
  }
  const roots = result.roots || [];
  const count = (kind) => roots.filter((r) => r.readOnly === kind).length;
  if (count('network')) {
    notes.push(t('usage.readOnly.network', 'On a network drive: read, and nothing offered — Windows keeps no Recycle Bin there.'));
  }
  if (count('removable')) {
    notes.push(t('usage.readOnly.removable', 'On a removable drive: read, and nothing offered until the Recycle Bin has been measured there.'));
  }
  for (const r of roots) {
    if (r.unscanned) {
      notes.push(t('usage.unscanned', '{size} in use on {volume} is not in this scan — Windows, programs, other people’s folders; System says what it is.', {
        size: formatBytes(r.unscanned.bytes),
        volume: r.unscanned.volume,
      }));
    }
  }
  notes.push(...scannerNotes(roots));
  return notes;
}

/**
 * Which scanner answered (A2), and why it was not the one that was asked for.
 *
 * The spec asks for this in as many words: "the status line says which
 * scanner was used". A number whose method nobody can name is a number
 * nobody can check.
 */
// Spelled out one call at a time rather than looked up from a table of key
// and string: `test:i18n` reads this source for calls to t with a literal
// key, and a key it is handed as a variable is a key it cannot check. That is
// exactly how "(no extension)" stayed English through A3.
function fastRefusal(reason) {
  switch (reason) {
    case 'declined':
      return t('usage.fast.declined', 'The administrator prompt was declined, so the folders were walked instead.');
    case 'notNtfs':
      return t('usage.fast.notNtfs', 'This drive is not NTFS, so there is no catalogue to read — the folders were walked instead.');
    case 'notWholeDrive':
      return t('usage.fast.notWholeDrive', 'A fast scan reads a whole drive, so this folder was walked instead.');
    case 'network':
      return t('usage.fast.network', 'A network drive has no catalogue this app can read, so the folders were walked instead.');
    case 'readOnly':
      return t('usage.fast.readOnly', 'This drive is read only, so the folders were walked instead.');
    case 'locked':
      return t('usage.fast.locked', 'Fast scan is part of CleanDrive Pro, so the folders were walked instead.');
    case 'notElevated':
      return t('usage.fast.notElevated', 'The helper started without administrator rights, so the folders were walked instead.');
    case 'helper':
      return t('usage.fast.helper', 'The administrator helper could not be started, so the folders were walked instead.');
    default:
      return t('usage.fast.unreadable', 'The drive’s catalogue could not be read, so the folders were walked instead.');
  }
}

function scannerNotes(roots) {
  const notes = [];
  const fast = roots.filter((r) => r.scanner === 'mft');
  for (const r of fast) {
    notes.push(t('usage.fast.used', 'Read from {volume}’s own catalogue: {records} records, {size}, in {seconds}.', {
      volume: String(r.volume).replace(/\\+$/, ''),
      records: formatCount(r.mft.records),
      size: formatBytes(r.mft.bytes),
      seconds: formatSeconds(r.mft.ms),
    }));
    if (r.mft.torn) {
      notes.push(t('usage.fast.torn', '{n} records in the catalogue did not add up and were left out — run chkdsk.', {
        n: formatCount(r.mft.torn),
      }));
    }
  }
  const refused = roots.map((r) => r.fastRefused).find(Boolean);
  if (refused) notes.push(fastRefusal(refused));
  return notes;
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
    buttons: { quarantine: $('quarantine-large'), recycle: $('delete-large') },
    selected: () => selectedOnUsage(),
  }),
  cleanup: ActionBar({
    root: $('cleanup-actionbar'),
    readout: $('cleanup-selection'),
    buttons: { quarantine: $('quarantine-cleanup'), recycle: $('delete-cleanup') },
    selected: () => selectedIn(state.cleanup && state.cleanup.groups, state.selectedCleanup),
  }),
  dupes: ActionBar({
    root: $('dupes-actionbar'),
    readout: $('selection-status'),
    buttons: { quarantine: $('quarantine-dupes'), recycle: $('delete-dupes') },
    // The file groups, plus the files inside a folder that is a copy (F2).
    // `selectedIn` drops a path it has already seen, so a file that is both
    // is counted once.
    selected: () => selectedIn(dupeGroupsForSelection(), state.selectedDupes),
  }),
};

/** Everything on the Duplicates screen a tick can land on: files, then folders. */
function dupeGroupsForSelection() {
  const dupes = state.dupes;
  if (!dupes) return [];
  if (!dupes.folders) return dupes.groups;
  return [...dupes.groups, ...dupes.folders.exact, ...dupes.folders.near];
}

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

// The same list after either action: to the bin, or to another drive (B1).
const onLargestAction = (kind) => async () => {
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
  }, { kind });
};
$('delete-large').addEventListener('click', onLargestAction('recycle'));
$('quarantine-large').addEventListener('click', onLargestAction('quarantine'));

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

const onCleanupAction = (kind) => async () => {
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
  }, { kind });
};
$('delete-cleanup').addEventListener('click', onCleanupAction('recycle'));
$('quarantine-cleanup').addEventListener('click', onCleanupAction('quarantine'));

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
  // F2. The shape pass reads nothing at all, which is why it goes by so fast.
  'folders-shape': ['dupes.phase.shape', 'Comparing folders by name and size'],
  'folders-content': ['dupes.phase.folders', 'Verifying folder contents'],
  'hashing-folders': ['dupes.phase.folders', 'Verifying folder contents'],
  'folders-near': ['dupes.phase.near', 'Comparing folders that nearly match'],
};

api.onDuplicateProgress((p) => {
  // A progress frame that lands after the search has answered -- the reply
  // and the frames do not share an order -- would write "Grouping by size…"
  // over the result it had just put there (seen in test-explorer.js).
  if ($('cancel-dupes').hidden) return;
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
  $('dupe-folders').replaceChildren();
  $('dupe-versions').replaceChildren();
  state.selectedDupes.clear();

  const minSize = Number($('min-size').value);
  // Which copy to suggest keeping (F1). Main decides whether the licence
  // allows anything but the oldest, and says in the reply which rule it
  // actually applied -- so the line below reports what happened rather than
  // what was asked for.
  const prefer = $('dupes-prefer').value;
  // Whole folders (F2). Asked for here, allowed or refused there.
  const folders = $('dupes-folders').checked;
  // Drafts of one document (F3). Names only, so it adds nothing to the walk.
  const versions = $('dupes-versions').checked;
  const result = unwrap(
    await api.findDuplicates(state.roots, { minSize, prefer, folders, versions }),
    t('app.label.dupes', 'Duplicate search')
  );
  setDupesRunning(false);
  if (!result) {
    $('dupes-status').textContent = t('dupes.failed', 'Duplicate search failed.');
    return;
  }

  state.dupes = hydrateDupes(result);
  renderDupes(state.dupes);
  announce($('dupes-status').textContent);
});

/**
 * Copies of one file, asked for from Explorer's menu (I3). The same screen,
 * the same list and the same rules -- the oldest copy is the suggested
 * keeper and nothing is ticked -- over the files of that one size in Home
 * (or the file's drive, when it is not in Home; the main process decides).
 */
async function findCopiesOf(filePath) {
  document.querySelector('.tab[data-tab="dupes"]').click();
  setDupesRunning(true);
  $('dupes-empty').hidden = true;
  $('dupe-groups').replaceChildren();
  state.selectedDupes.clear();
  $('dupes-status').textContent = t('dupes.copies.looking', 'Looking for copies of {name}…', { name: filePath.split(/[\\/]/).pop() });

  const result = unwrap(await api.findCopies(filePath), t('app.label.dupes', 'Duplicate search'));
  setDupesRunning(false);
  if (!result) {
    $('dupes-status').textContent = t('dupes.failed', 'Duplicate search failed.');
    return;
  }
  state.dupes = hydrateDupes(result);
  renderDupes(state.dupes);
  announce($('dupes-status').textContent);
}

/**
 * Explorer's right-click menu asked for something (I3). The main process has
 * checked the path exists and is the right kind of thing. Analysing a folder
 * scans it -- the person pressed "Analyse" -- and deletes nothing; finding
 * duplicates looks, and ticks nothing.
 */
api.onTarget((target) => {
  if (!target) return;

  // The periodic summary was clicked (G3). It opens the screen that explains
  // the number and does nothing else -- no scan, and certainly no cleanup.
  if (target.kind === 'changes') {
    document.querySelector('.tab[data-tab="trends"]').click();
    if (window.Changes && typeof window.Changes.openBest === 'function') window.Changes.openBest();
    return;
  }

  if (typeof target.path !== 'string') return;
  if (target.kind === 'analyze') {
    document.querySelector('.tab[data-tab="usage"]').click();
    if (!$('cancel-scan').hidden) {
      toast(t('explorer.busy', 'A scan is already running. Stop it, then try again.'));
      return;
    }
    setFolder(target.path);
    $('run-scan').click();
  } else if (target.kind === 'duplicates') {
    if (!$('cancel-dupes').hidden) {
      toast(t('explorer.busyDupes', 'A search for duplicates is already running. Stop it, then try again.'));
      return;
    }
    findCopiesOf(target.path);
  }
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
    folders: result.folders ? hydrateFolders(result.folders, byId) : null,
    versions: result.versions
      ? {
          ...result.versions,
          groups: result.versions.groups.map(({ ids, ...group }) => ({ ...group, files: viewsOf(ids, byId) })),
        }
      : null,
  };
}

/** The folder half (F2): folder rows, and the files each copy holds. */
function hydrateFolders(folders, byId) {
  return {
    ...folders,
    exact: folders.exact.map(({ ids, fileIds, ...group }) => ({
      ...group,
      rows: viewsOf(ids, byId),
      files: viewsOf(fileIds, byId),
    })),
    near: folders.near.map(({ ids, fileIds, ...pair }) => ({
      ...pair,
      rows: viewsOf(ids, byId),
      files: viewsOf(fileIds, byId),
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

  const notes = [];
  if (result.copiesOf) {
    // Copies of one file, from Explorer's menu: say which file, and where the
    // app looked -- "none" means none in that folder, not none anywhere.
    const name = result.copiesOf.split(/[\\/]/).pop();
    const copies = result.groups.length ? result.groups[0].count - 1 : 0;
    notes.push(
      copies
        ? t('dupes.copies.found', '{name}: {n} other {copies} in {scope}.', {
            name,
            n: formatCount(copies),
            copies: word(copies, 'dupes.copyWord', 'copy', 'copies'),
            scope: result.scope,
          })
        : t('dupes.copies.none', '{name}: no other copy in {scope}.', { name, scope: result.scope })
    );
  }
  notes.push(t('dupes.checked', 'Checked {n} files.', { n: formatCount(result.indexedFiles) }));
  if ((result.skipped || []).length) {
    notes.push(t('dupes.skippedNetwork', 'Not searched, on a network drive: {roots}.', {
      roots: result.skipped.map((r) => elide(r, 40)).join(', '),
    }));
  }
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
  // Which rule chose the keepers (F1), from the reply rather than from the
  // control: on Free the request for a drive-based rule is refused and the
  // oldest copy is kept, and the line has to say what happened.
  if (result.preferRefused === 'locked') {
    notes.push(t('dupes.kept.locked', 'Choosing which copy to keep by drive is part of CleanDrive Pro, so the oldest copy is the one suggested.'));
  } else if (result.prefer === 'internal') {
    notes.push(t('dupes.kept.internal', 'The copy on this computer is the one suggested for keeping.'));
  } else if (result.prefer === 'backup') {
    notes.push(t('dupes.kept.backup', 'The copy on an external or network drive is the one suggested for keeping.'));
  }
  // Whole folders (F2), from the reply rather than from the tick-box: on Free
  // the request is refused and the line has to say so, the same way the
  // keeper rule does.
  if (result.foldersRefused === 'locked') {
    notes.push(t('dupes.folders.locked', 'Comparing whole folders is part of CleanDrive Pro, so only individual files were compared.'));
  } else if (result.folders) {
    notes.push(
      t('dupes.folders.checked', 'Compared {n} folders, reading everything inside them — including hidden names, node_modules and .git.', {
        n: formatCount(result.folders.foldersIndexed),
      })
    );
    if (result.folders.nestedDropped) {
      notes.push(
        t('dupes.folders.nested', '{n} folders inside another copy are not listed separately, so nothing is counted twice.', {
          n: formatCount(result.folders.nestedDropped),
        })
      );
    }
    if (result.folders.unreadableFolders) {
      notes.push(
        t('dupes.folders.unreadable', '{n} folders hold a file that could not be read, so they are not claimed as copies.', {
          n: formatCount(result.folders.unreadableFolders),
        })
      );
    }
  }
  // Drafts of one document (F3). Refused out loud for the third time on this
  // screen and for the same reason: being handed a shorter list than the one
  // asked for, with nothing said, teaches the wrong thing about the disk.
  if (result.versionsRefused === 'locked') {
    notes.push(t('dupes.versions.locked', 'Looking for drafts of one document is part of CleanDrive Pro, so only identical files were compared.'));
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

  // Folders first: one row there stands for hundreds here.
  renderFolders(result.folders);
  renderVersions(result.versions);
  const anyFolders = Boolean(result.folders && (result.folders.exact.length || result.folders.near.length));
  const anyVersions = Boolean(result.versions && result.versions.groups.length);
  // Both sections sit above the file groups and both put rows into the same
  // selection, so the heading and the toolbar answer to either of them.
  const anyAbove = anyFolders || anyVersions;
  $('dupe-files-heading').hidden = !anyAbove;

  // "Select all but the oldest copy" is about file groups. With folders found
  // and no file groups it would clear a folder selection and tick nothing, so
  // it goes and the toolbar keeps only Clear selection.
  $('select-extra').hidden = result.totalGroups === 0;

  if (result.totalGroups === 0) {
    $('dupes-toolbar').hidden = !anyAbove;
    $('dupe-files-heading').hidden = true;
    $('dupes-empty').textContent = result.copiesOf
      ? t('dupes.copies.empty', 'No other copy of this file, byte for byte, in {scope}.', { scope: result.scope })
      : anyFolders
        ? t('dupes.empty.filesOnly', 'No duplicate files outside the folders above.')
        : anyVersions
          ? t('dupes.empty.versionsOnly', 'Nothing here is a byte-for-byte copy of anything else — only the sets of drafts above.')
          : t('dupes.empty', 'No duplicate files found in this folder.');
    $('dupes-empty').hidden = false;
    if (anyAbove) updateSelectionStatus();
    return;
  }

  $('dupes-toolbar').hidden = false;
  for (const group of result.groups.slice(0, 300)) {
    container.appendChild(renderGroup(group));
  }
  updateSelectionStatus();
}

/* ---- whole folders (F2) ------------------------------------------------- */

/**
 * The folder half of the screen.
 *
 * A folder row is a heading and never a thing to tick: the app does not
 * delete folders, and neither `recycle` nor `quarantine` accepts one. What is
 * tickable is the files inside a copy, which the row unfolds to show -- so
 * "delete this copy" is, honestly and visibly, "send these N files to the
 * Recycle Bin".
 */
function renderFolders(folders) {
  const section = $('dupe-folders-section');
  const container = $('dupe-folders');
  container.replaceChildren();

  if (!folders || (folders.exact.length === 0 && folders.near.length === 0)) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const group of folders.exact.slice(0, 200)) container.appendChild(renderFolderGroup(group));
  for (const pair of folders.near.slice(0, 200)) container.appendChild(renderNearPair(pair));
}

/** One folder row: what it is, how big, and how many files it holds. */
function folderHead(row, extra) {
  const head = document.createElement('div');
  head.className = `folder-row${row.keeper ? ' is-keeper' : ''}`;

  const name = document.createElement('div');
  name.className = 'folder-path';
  name.textContent = row.path;
  name.title = row.path;

  const facts = document.createElement('span');
  facts.className = 'folder-facts';
  facts.textContent = t('dupes.folders.facts', '{size} · {n} files', {
    size: formatBytes(row.size),
    n: formatCount(row.fileCount),
  });

  const tag = document.createElement('span');
  tag.className = row.keeper ? 'keeper-tag' : 'badge badge-confidence';
  tag.textContent = extra;

  head.append(name, facts, tag);
  return head;
}

function renderFolderGroup(group) {
  const section = document.createElement('section');
  section.className = 'group group-folder';

  const head = document.createElement('div');
  head.className = 'group-head';
  const title = document.createElement('strong');
  title.textContent = t('dupes.folders.groupTitle', '{n} identical folders · {size} each', {
    n: group.count,
    size: formatBytes(group.bytes),
  });
  const waste = document.createElement('span');
  waste.className = 'group-waste';
  waste.textContent = t('dupes.reclaimableAmount', '{size} reclaimable', { size: formatBytes(group.wastedBytes) });
  head.append(title, waste);

  const body = document.createElement('div');
  body.className = 'group-body';
  for (const row of group.rows) {
    body.appendChild(
      folderHead(
        row,
        row.keeper
          ? t('dupes.folders.keeping', 'keeping')
          : `${t('dupes.folders.copy', 'copy')} · ${confidenceWord(row.confidence)}`
      )
    );
    if (row.keeper) continue;
    body.appendChild(filesOfCopy(group.files.filter((f) => f.folder === row.path), row));
  }

  section.append(head, body);
  return section;
}

/**
 * The files a copy holds, ticked together.
 *
 * A folder past the message's file budget lists none, and says so rather than
 * offering half of itself -- half a folder deleted is the one outcome nobody
 * asked for.
 */
function filesOfCopy(files, row) {
  const wrap = document.createElement('div');
  wrap.className = 'folder-files';

  if (row.truncated || (files.length === 0 && row.fileCount > 0)) {
    const note = document.createElement('p');
    note.className = 'empty';
    note.textContent = t(
      'dupes.folders.tooMany',
      'This copy holds {n} files — too many to list here. Open it in Explorer to deal with it.',
      { n: formatCount(row.fileCount) }
    );
    wrap.appendChild(note);
    return wrap;
  }

  const bar = document.createElement('div');
  bar.className = 'panel-actions';
  const all = document.createElement('button');
  all.className = 'btn btn-sm';
  all.textContent = t('dupes.folders.selectCopy', 'Select every file in this copy');
  all.addEventListener('click', () => {
    for (const file of files) state.selectedDupes.add(file.path);
    syncCheckboxes();
    updateSelectionStatus();
  });
  bar.appendChild(all);

  const list = document.createElement('ul');
  list.className = 'files';
  lists.dupes.push(
    CandidateList(list, {
      rows: files,
      selection: state.selectedDupes,
      onChange: updateSelectionStatus,
      meta: (file) => `${file.rel} · ${timeLabel(file)}`,
      badge: (file) =>
        evidencePill(file, {
          className: 'badge badge-confidence badge-button',
          text: `${t('dupes.identical', 'identical')} · ${confidenceWord(file.confidence)}`,
        }),
    })
  );

  wrap.append(bar, list);
  return wrap;
}

/**
 * Two folders that nearly match, and what is actually different about them.
 *
 * The comparison is the point of the row: "97% the same" is not a number
 * anybody can act on until they can see which files make up the other 3%.
 */
function renderNearPair(pair) {
  const section = document.createElement('section');
  section.className = 'group group-folder group-near';

  const head = document.createElement('div');
  head.className = 'group-head';
  const title = document.createElement('strong');
  title.textContent = t('dupes.near.title', '{pct}% the same · {n} files identical', {
    pct: (pair.ratio * 100).toFixed(1),
    n: formatCount(pair.matched),
  });
  const waste = document.createElement('span');
  waste.className = 'group-waste';
  waste.textContent = t('dupes.near.shared', '{size} held twice', { size: formatBytes(pair.sameBytes) });
  head.append(title, waste);

  const body = document.createElement('div');
  body.className = 'group-body';
  const [keepRow, otherRow] = [pair.rows.find((r) => r.keeper), pair.rows.find((r) => !r.keeper)];
  if (keepRow) body.appendChild(folderHead(keepRow, t('dupes.folders.keeping', 'keeping')));
  if (otherRow) {
    body.appendChild(
      folderHead(otherRow, `${t('dupes.near.other', 'nearly the same')} · ${confidenceWord(otherRow.confidence)}`)
    );
  }
  body.appendChild(compareTree(pair, keepRow, otherRow));
  if (otherRow) body.appendChild(filesOfCopy(pair.files, otherRow));

  section.append(head, body);
  return section;
}

/* ---- documents that look like drafts of one another (F3) ----------------- */

/**
 * Sets of documents whose names look like versions of one another.
 *
 * There is no "select all but the newest" and there will not be one: the whole
 * set is a guess made from filenames, and a single click that acts on a guess
 * is the thing this app exists not to do. Each row is ticked by hand, and the
 * pair of buttons above a set opens two of them side by side so the decision
 * is made by looking rather than by trusting a name.
 */
function renderVersions(versions) {
  const section = $('dupe-versions-section');
  const container = $('dupe-versions');
  container.replaceChildren();

  if (!versions || versions.groups.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const notes = [
    t('dupes.versions.note', 'Grouped by what their names have in common, and nothing else was read. That is a weak signal, so nothing here is ticked for you and there is no “keep only the newest”.'),
  ];
  if (versions.skippedDateOnly) {
    notes.push(t(
      'dupes.versions.skippedDates',
      '{n} {sets} left out for differing by nothing but a date in the name — a date usually says which document this is, not which draft.',
      { n: formatCount(versions.skippedDateOnly), sets: setWord(versions.skippedDateOnly) }
    ));
  }
  if (versions.skippedCommonName) {
    notes.push(t(
      'dupes.versions.skippedCommon',
      '{n} {sets} left out for sharing a common filename across folders that have nothing to do with each other.',
      { n: formatCount(versions.skippedCommonName), sets: setWord(versions.skippedCommonName) }
    ));
  }
  setText($('dupe-versions-note'), notes.join(' '));

  for (const group of versions.groups.slice(0, 200)) container.appendChild(renderVersionGroup(group));
}

/** Where a row sits in time: the newest, tied with it, or behind it. */
function versionWhen(file) {
  if (file.newest) return t('dupes.versions.newest', 'newest');
  if (file.sameTimeAsNewest) return t('dupes.versions.sameTime', 'same time');
  return t('dupes.versions.older', 'older');
}

/** One set, or several. Vietnamese does not inflect it; English does. */
const setWord = (n) => word(n, 'dupes.versions.setWord', 'set', 'sets');

function renderVersionGroup(group) {
  const section = document.createElement('section');
  section.className = 'group group-versions';

  const head = document.createElement('div');
  head.className = 'group-head';
  const title = document.createElement('strong');
  title.textContent = t('dupes.versions.groupTitle', '{n} files named like one document · {size} together', {
    n: group.count,
    size: formatBytes(group.bytes),
  });
  const how = document.createElement('span');
  how.className = 'group-waste';
  how.textContent = group.markers.length
    ? t('dupes.versions.by', 'differing by {markers}', { markers: group.markers.join(', ') })
    : t('dupes.versions.byFormat', 'one name, several formats');
  head.append(title, how);

  const body = document.createElement('div');
  body.className = 'group-body';

  // Side by side, which is the only way to tell two drafts apart.
  const bar = document.createElement('div');
  bar.className = 'panel-actions';
  const compare = document.createElement('button');
  compare.className = 'btn btn-sm';
  compare.textContent = t('dupes.versions.compare', 'Open the two newest side by side');
  compare.disabled = group.files.length < 2;
  compare.addEventListener('click', () => openCompare(group.files[0].path, group.files[1].path));
  bar.appendChild(compare);

  const list = document.createElement('ul');
  list.className = 'files';
  lists.dupes.push(
    CandidateList(list, {
      rows: group.files,
      selection: state.selectedDupes,
      onChange: updateSelectionStatus,
      meta: (file) => `${file.ext.toUpperCase()} · ${timeLabel(file)}`,
      badge: (file) =>
        evidencePill(file, {
          className: file.newest ? 'keeper-tag badge-button' : 'badge badge-confidence badge-button',
          text: `${versionWhen(file)} · ${confidenceWord(file.confidence)}`,
        }),
    })
  );

  body.append(bar, list);
  section.append(head, body);
  return section;
}

/** Three columns: only on the left, only on the right, same place different bytes. */
function compareTree(pair, keepRow, otherRow) {
  const wrap = document.createElement('div');
  wrap.className = 'compare-tree';

  const column = (headingText, entries, emptyText) => {
    const col = document.createElement('div');
    col.className = 'compare-column';
    const heading = document.createElement('h4');
    heading.textContent = headingText;
    col.appendChild(heading);
    if (entries.length === 0) {
      const none = document.createElement('p');
      none.className = 'empty';
      none.textContent = emptyText;
      col.appendChild(none);
      return col;
    }
    const list = document.createElement('ul');
    list.className = 'compare-list';
    for (const entry of entries.slice(0, 200)) {
      const item = document.createElement('li');
      const rel = document.createElement('span');
      rel.className = 'compare-rel';
      rel.textContent = entry.rel;
      rel.title = entry.rel;
      const size = document.createElement('span');
      size.className = 'compare-size';
      size.textContent = formatBytes(entry.bytes);
      item.append(rel, size);
      list.appendChild(item);
    }
    col.appendChild(list);
    return col;
  };

  const nameOf = (row, fallback) => (row ? row.path.split(/[\\/]/).pop() : fallback);
  wrap.append(
    column(
      t('dupes.near.onlyIn', 'Only in {name}', { name: nameOf(keepRow, 'A') }),
      pair.compare.onlyKeep,
      t('dupes.near.nothingOnly', 'Nothing here that is not on the other side.')
    ),
    column(
      t('dupes.near.onlyIn', 'Only in {name}', { name: nameOf(otherRow, 'B') }),
      pair.compare.onlyOther,
      t('dupes.near.nothingOnly', 'Nothing here that is not on the other side.')
    ),
    column(
      t('dupes.near.changed', 'Same place, different contents'),
      pair.compare.changed,
      t('dupes.near.nothingChanged', 'Every shared file holds the same bytes.')
    )
  );

  if (pair.compare.truncated) {
    const note = document.createElement('p');
    note.className = 'empty';
    note.textContent = t('dupes.near.truncated', 'Only the first 200 differences of each kind are listed.');
    wrap.appendChild(note);
  }
  return wrap;
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

/**
 * The folder half, after some of its files have gone to the bin (F2).
 *
 * A copy that has lost files is no longer a copy of anything, so it stops
 * claiming to be one: the row goes, and with it the group when there is no
 * longer a second folder in it. The alternative -- redrawing the same row
 * over files that are not there any more -- is the screen lying about what
 * it just did.
 */
function pruneFolders(gone) {
  const folders = state.dupes && state.dupes.folders;
  if (!folders) return;

  const survived = (row) => !(row.files || []).some((f) => gone.has(f.path));

  folders.exact = folders.exact
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => row.keeper || !group.files.some((f) => f.folder === row.path && gone.has(f.path))),
      files: group.files.filter((f) => !gone.has(f.path)),
    }))
    .filter((group) => group.rows.filter((r) => !r.keeper).length > 0)
    .map((group) => ({ ...group, count: group.rows.length, wastedBytes: group.bytes * (group.rows.length - 1) }));

  folders.near = folders.near.filter((pair) => survived(pair));
  folders.totalFolderGroups = folders.exact.length;
  folders.folderReclaimableBytes = folders.exact.reduce((n, g) => n + g.wastedBytes, 0);
  folders.nearReclaimableBytes = folders.near.reduce((n, p) => n + p.sameBytes, 0);
}

const onDupesAction = (kind) => async () => {
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
    pruneFolders(gone);
    renderDupes(state.dupes);
  }, { kind });
};
$('delete-dupes').addEventListener('click', onDupesAction('recycle'));
$('quarantine-dupes').addEventListener('click', onDupesAction('quarantine'));

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

/**
 * A length of time, as a length of time.
 *
 * `formatDuration` above is an *estimate* formatter and every one of its
 * branches ends in "left". Reaching for it to say how long something took
 * printed "Looked at 8 photos in almost done", which a screenshot caught; and
 * in front of a job that has not started it promises "5 min left" before there
 * is anything left. This is the plain one.
 */
function formatSpan(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t('app.span.seconds', '{n} seconds', { n: Math.max(1, seconds) });

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('app.span.minutes', '{n} minutes', { n: minutes });

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t('app.span.hoursMinutes', '{h}h {m}m', { h: hours, m: rest })
    : t('app.span.hours', '{h}h', { h: hours });
}

/* ---- the shared progress panel, used by every delete path ---- */

const DELETE_BUTTONS = [
  'delete-large',
  'delete-dupes',
  'delete-cleanup',
  'media-delete',
  'restore-selected',
  'cloud-dehydrate',
  'quarantine-large',
  'quarantine-cleanup',
  'quarantine-dupes',
  'media-quarantine',
];

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
    progressPanel.said = title;
    progressPanel.value(0);
    announce(title);

    // Nothing else may start a delete while one is running.
    setActionRunning(true);
    for (const id of DELETE_BUTTONS) $(id).disabled = true;
  },

  /** The bar as a screen reader has it: a percentage, and the words beside it. */
  value(pct) {
    const track = $('dp-track');
    track.setAttribute('aria-valuenow', String(Math.round(pct)));
    const words = [$('dp-count').textContent, $('dp-eta').textContent].filter(Boolean).join(' · ');
    if (words) track.setAttribute('aria-valuetext', words);
    else track.removeAttribute('aria-valuetext');
  },

  update(p) {
    if (p.phase === 'done') return;
    this.render(p);
    const fill = $('dp-fill');
    this.value(parseFloat(fill.style.width) || 0);
    // A new phase is news; the hundredth file of the same phase is not.
    const title = $('dp-title').textContent;
    if (title !== this.said) {
      this.said = title;
      announce(title);
    }
  },

  render(p) {
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

    // Backing up before deleting (E2). Paced by bytes for the same reason the
    // quarantine's copy is, and it says "and checking" because it is: nothing
    // reaches the bin until its copy has been read back and matched.
    if (p.phase === 'backing-up') {
      $('dp-title').textContent = t('backup.progressTitle', 'Copying and checking each copy before anything is deleted');
      $('dp-count').textContent = t('delete.progress', '{done} of {total} · {moved} of {size}', {
        done: formatCount(p.done),
        total: formatCount(p.total),
        moved: formatBytes(p.bytes),
        size: formatBytes(p.totalBytes),
      });
      $('dp-rate').textContent = '';
      $('dp-eta').textContent = '';
      if (p.currentPath) $('dp-current').textContent = elide(p.currentPath, 78);
      $('dp-fill').style.width = `${p.totalBytes > 0 ? Math.min(100, (p.bytes / p.totalBytes) * 100) : 0}%`;
      return;
    }

    // Copying to another drive (B1) is paced by bytes, not by files: one ISO
    // is most of the time.
    if (p.phase === 'copying') {
      $('dp-title').textContent = t('quarantine.progressTitle', 'Copying to {drive} and checking each copy', {
        drive: window.Quarantine ? window.Quarantine.drive() : '',
      });
      $('dp-count').textContent = t('delete.progress', '{done} of {total} · {moved} of {size}', {
        done: formatCount(p.done),
        total: formatCount(p.total),
        moved: formatBytes(p.freedBytes),
        size: formatBytes(p.totalBytes),
      });
      $('dp-rate').textContent = p.bytesPerSec > 0 ? t('quarantine.rate', '{size}/s', { size: formatBytes(p.bytesPerSec) }) : '';
      $('dp-eta').textContent = p.etaMs != null ? formatDuration(p.etaMs) : '';
      if (p.currentPath) $('dp-current').textContent = elide(p.currentPath, 78);
      $('dp-fill').style.width = `${p.totalBytes > 0 ? Math.min(100, (p.freedBytes / p.totalBytes) * 100) : 0}%`;
      return;
    }

    $('dp-title').textContent =
      p.phase === 'restoring'
        ? p.from && p.from !== 'bin'
          ? t('restore.progressTitleAny', 'Putting back')
          : t('restore.progressTitle', 'Putting back from the Recycle Bin')
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
  if (options.kind === 'quarantine') {
    const { kind, ...rest } = options;
    return quarantineSelected(paths, onDone, rest);
  }

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
    // E2: what the backup did, in front of what the delete did. A file that
    // was not copied was not deleted either, and that is the half of the
    // receipt somebody has to act on.
    const backedUp = result.backup
      ? ` · ${t('delete.backedUp', '{n} copied to {dest} and checked first', {
          n: formatCount(result.backup.saved),
          dest: result.backup.destination,
        })}${
          result.backup.failed
            ? ` · ${t('delete.backupFailed', '{n} left alone — the copy could not be verified', {
                n: formatCount(result.backup.failed),
              })}`
            : ''
        }`
      : '';

    // The receipt says moved, and says what that means. "2.1 GB freed" after a
    // move to the Recycle Bin was the most misleading sentence the app could
    // print, and it printed it after every delete.
    toast(
      t('delete.movedToBin', 'Moved {n} {items} ({size}) to the Recycle Bin{took} — not freed until the bin is emptied', {
        n: formatCount(moved),
        items: word(moved, 'app.item', 'item', 'items'),
        took,
        size: formatBytes(result.movedBytes),
      }) + backedUp + (skipped.length ? ` · ${skipped.join(', ')}` : '')
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

/**
 * Move files to the quarantine folder on another drive (B1).
 *
 * The receipt says where they went and what happened to the originals,
 * because that is what decides whether anything was freed: an original in
 * the Recycle Bin is still on its drive.
 */
async function quarantineSelected(paths, onDone, options = {}) {
  if (!window.Quarantine || !window.Quarantine.ready()) {
    toast(t('quarantine.chooseFirst', 'Choose where moved files go first — Settings, “Move to another drive”.'), true);
    window.Quarantine && window.Quarantine.showCard();
    return;
  }

  progressPanel.show(t('quarantine.checking', 'Checking what can be moved'));
  let result;
  try {
    result = unwrap(await api.quarantine(paths, options), t('quarantine.label', 'Move to another drive'));
  } finally {
    progressPanel.hide();
  }
  if (!result) return;

  const moved = result.moved.length;
  const drive = window.Quarantine.drive();
  if (moved > 0 && !result.dryRun && window.SpaceMap) window.SpaceMap.refresh();
  if (moved > 0) window.Quarantine.refresh();

  // What the originals came to: in the bin frees nothing yet; deleted frees it.
  const originals = () =>
    result.freedBytes > 0
      ? t('quarantine.freed', 'the originals are deleted, {size} freed', { size: formatBytes(result.freedBytes) })
      : t('quarantine.inBin', 'the originals are in the Recycle Bin, not freed until it is emptied');

  if (result.cancelled) {
    if (moved > 0) {
      toast(
        t('quarantine.stopped', 'Stopped. {n} {items} ({size}) already on {drive} — {originals} · {left} left where they were.', {
          n: formatCount(moved),
          items: word(moved, 'app.item', 'item', 'items'),
          size: formatBytes(result.movedBytes),
          drive,
          originals: originals(),
          left: formatCount(result.remaining || 0),
        })
      );
      onDone(result.moved);
    } else {
      toast(t('quarantine.cancelled', 'Cancelled — nothing was moved.'));
    }
    return;
  }

  if (moved > 0) {
    const skipped = result.failed.length
      ? ` · ${t('quarantine.skipped', '{n} left where they were', { n: formatCount(result.failed.length) })}`
      : '';
    toast(
      t('quarantine.done', 'Moved {n} {items} ({size}) to {drive}, each copy checked — {originals}', {
        n: formatCount(moved),
        items: word(moved, 'app.item', 'item', 'items'),
        size: formatBytes(result.movedBytes),
        drive,
        originals: originals(),
      }) + skipped
    );
    onDone(result.moved);
  } else {
    toast(t('quarantine.nothing', 'Nothing was moved. {reason}', { reason: result.failed[0] ? result.failed[0].error : '' }), true);
  }
  if (result.failed.length) console.warn('Left where they were:', result.failed);
}

/**
 * Move a whole folder to another drive (B2).
 *
 * Started from the map, on a folder somebody is looking at and wondering
 * about -- which is why there is no list of "folders you should move". Nothing
 * here can honestly rank that; it depends on what you open, not on what the
 * disk can see.
 *
 * The destination is asked for first, before any dialog about copying, so the
 * question "where to?" is never answered by a person who has already agreed
 * to something. The confirmation comes from the main process afterwards.
 */
async function relocateFolder(folderPath, options = {}) {
  const where = unwrap(await api.relocateChoose(folderPath), t('relocate.label', 'Move to another drive'));
  if (!where || !where.chosen) return;

  progressPanel.show(t('relocate.checking', 'Reading the folder'));
  let result;
  try {
    result = unwrap(
      await api.relocate([folderPath], {
        // Spread the same way `quarantineSelected` does, so a harness driving
        // the real window can suppress the dialog the way it already does for
        // every other action. The main process still decides whether to honour
        // that; the window cannot switch the confirmation off by itself.
        ...options,
        destination: where.destination,
        leaveShortcut: options.leaveShortcut === true,
      }),
      t('relocate.label', 'Move to another drive')
    );
  } finally {
    progressPanel.hide();
  }
  if (!result) return;

  // Said out loud, never a quiet downgrade.
  if (result.refused === 'locked') {
    toast(t('relocate.locked', 'Moving a folder to another drive is part of CleanDrive Pro.'), true);
    return;
  }

  const moved = result.moved.length;
  if (moved > 0 && window.SpaceMap) window.SpaceMap.refresh();

  if (result.cancelled && moved === 0) {
    toast(t('relocate.cancelled', 'Cancelled — nothing was moved.'));
    return;
  }

  if (moved > 0) {
    const one = result.moved[0];
    toast(
      t('relocate.done', 'Moved {name} to {drive}, all {files} file(s) checked — {originals}', {
        name: one.path.split('\\').pop(),
        drive: where.drive || where.destination,
        files: formatCount(one.files),
        originals: result.freedBytes > 0
          ? t('relocate.freed', 'the original is deleted, {size} freed', { size: formatBytes(result.freedBytes) })
          : t('relocate.inBin', 'the original is in the Recycle Bin, not freed until it is emptied'),
      })
    );
    return;
  }

  const why = result.failed[0];
  toast(t('relocate.nothing', 'Nothing was moved. {reason}', { reason: why ? why.error : '' }), true);
  if (result.failed.length) console.warn('Not moved:', result.failed);
}

/**
 * Pack a folder into one archive (B5).
 *
 * The receipt says the two things that are not obvious from the map: how much
 * smaller it actually turned out -- which for photos is "not at all" -- and
 * that the folder is in the Recycle Bin, so nothing is freed until that is
 * emptied.
 */
async function archiveFolder(folderPath, options = {}) {
  const where = unwrap(await api.archiveChoose(folderPath), t('archive.label', 'Pack into an archive'));
  if (!where || !where.chosen) return;

  progressPanel.show(t('archive.checking', 'Reading the folder'));
  let result;
  try {
    result = unwrap(
      await api.archive([folderPath], { ...options, destination: where.destination }),
      t('archive.label', 'Pack into an archive')
    );
  } finally {
    progressPanel.hide();
  }
  if (!result) return;

  if (result.refused === 'locked') {
    toast(t('archive.locked', 'Packing a folder into an archive is part of CleanDrive Pro.'), true);
    return;
  }

  const packed = result.moved.length;
  if (packed > 0 && window.SpaceMap) window.SpaceMap.refresh();

  if (result.cancelled && packed === 0) {
    toast(t('archive.cancelled', 'Cancelled — nothing was packed.'));
    return;
  }

  if (packed > 0) {
    const one = result.moved[0];
    const smaller = one.size > 0 ? 1 - one.archiveBytes / one.size : 0;
    // Both figures rather than a percentage. 2.7 MB of repeated source text
    // becomes 8 KB, which rounds to "100% smaller" and reads as though the
    // folder had vanished; the two sizes cannot be misread.
    toast(
      t('archive.done', 'Packed {name} into {archive} — {files} file(s), {from} became {size}, and every one was checked inside it. {shrunk}The folder is in the Recycle Bin, not freed until it is emptied.', {
        name: one.path.split('\\').pop(),
        archive: one.to.split('\\').pop(),
        files: formatCount(one.files),
        from: formatBytes(one.size),
        size: formatBytes(one.archiveBytes),
        shrunk:
          smaller < 0.05
            ? `${t('archive.noSmaller', 'It is no smaller — these files were already compressed.')} `
            : '',
      })
    );
    return;
  }

  const why = result.failed[0];
  toast(t('archive.nothing', 'Nothing was packed. {reason}', { reason: why ? why.error : '' }), true);
  if (result.failed.length) console.warn('Not packed:', result.failed);
}

/**
 * Let NTFS hold a folder in less room, or stop (B4).
 *
 * Which of the two it is comes from the disk, not from the menu: a folder
 * that is already compressed is offered the way back instead. The receipt is
 * the only one in this app that can say "freed" without a caveat, because
 * there is no Recycle Bin between here and the space.
 */
async function compressFolder(folderPath, options = {}) {
  const state = unwrap(await api.compressState(folderPath), t('compress.label', 'NTFS compression'));
  if (!state) return;
  const undo = options.uncompress === true || state.compressed === true;

  progressPanel.show(
    undo ? t('compress.checking.undo', 'Reading the folder') : t('compress.checking', 'Measuring what compressing would give back')
  );
  let result;
  try {
    result = unwrap(await api.compress([folderPath], { ...options, uncompress: undo }), t('compress.label', 'NTFS compression'));
  } finally {
    progressPanel.hide();
  }
  if (!result) return;

  if (result.refused === 'locked') {
    toast(t('compress.locked', 'NTFS compression is part of CleanDrive Pro.'), true);
    return;
  }

  const done = result.moved.length;
  if (done > 0 && window.SpaceMap) window.SpaceMap.refresh();

  if (result.cancelled && done === 0) {
    toast(t('compress.cancelled', 'Cancelled — nothing was changed.'));
    return;
  }

  if (done > 0) {
    const one = result.moved[0];
    const name = one.path.split('\\').pop();
    // "now takes 16.4 MB instead of 16.4 MB — 0 B back" is true and reads
    // like a fault. A folder NTFS could do nothing with says that instead.
    const gained = Math.max(0, one.changedBytes);
    const worthSaying = one.onDiskBefore > 0 && gained > one.onDiskBefore * 0.02;
    toast(
      undo
        ? t('compress.undone', '{name} is no longer compressed — it takes {size} on the disk again. Nothing was deleted.', {
            name,
            size: formatBytes(one.onDiskAfter),
          })
        : worthSaying
          ? t('compress.done', '{name} now takes {after} instead of {before} — {freed} back, straight away, with nothing in the Recycle Bin. {files} file(s), unchanged.', {
              name,
              after: formatBytes(one.onDiskAfter),
              before: formatBytes(one.onDiskBefore),
              freed: formatBytes(gained),
              files: formatCount(one.files),
            })
          : t('compress.doneNothing', '{name} is still {before} — NTFS had nothing to take out of these {files} file(s), which are already compressed inside. Nothing was changed.', {
              name,
              before: formatBytes(one.onDiskBefore),
              files: formatCount(one.files),
            })
    );
    return;
  }

  const why = result.failed[0];
  toast(t('compress.nothing', 'Nothing was changed. {reason}', { reason: why ? why.error : '' }), true);
  if (result.failed.length) console.warn('Not compressed:', result.failed);
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
    showRoots();
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
