'use strict';

/**
 * The Automatic tab.
 *
 * Loaded after app.js and sharing its globals (`api`, `$`, `state`, `toast`,
 * `unwrap`, the formatters). It is a separate file rather than more of app.js
 * because it is the only part of the UI that configures something which then
 * runs when the window is closed, and that distinction is worth being able to
 * read in one place.
 */

// Labels mirror the advisor's own category names. Only categories it calls
// "safe" can appear here, and the main process re-checks the verdict before
// deleting anything -- this list is a convenience, not the gate.
const CATEGORY_LABELS = {
  temp: 'Temporary files',
  cache: 'Caches',
  crashdump: 'Crash dumps',
  log: 'Old log files',
  gpucache: 'GPU & compiled-code caches',
  buildoutput: 'Build output',
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

state.auto = null;
state.autoLists = { roots: [], whitelist: [], skipIfRunning: [], monitorVolumes: [] };

function formatWhen(timestamp) {
  if (!timestamp) return '–';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The same instant without the weekday, for the stat tiles.
 *
 * Those are set in a 22px display face so the number reads at a glance; a full
 * "Wed, Sep 16, 06:53 PM" at that size is wider than the tile and turns the
 * headline figure into a paragraph.
 */
function formatWhenShort(timestamp) {
  if (!timestamp) return '–';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ---- list editors ------------------------------------------------------- */

function renderPathList(el, key, emptyText, verbatim) {
  const items = state.autoLists[key];
  el.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'path-empty';
    empty.textContent = emptyText;
    el.append(empty);
    return;
  }

  for (const value of items) {
    const row = document.createElement('li');
    row.className = 'path-row';

    const text = document.createElement('span');
    text.className = 'path-text';
    text.textContent = verbatim ? value : elide(value, 90);
    text.title = value;

    const remove = document.createElement('button');
    remove.className = 'btn btn-sm';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      state.autoLists[key] = state.autoLists[key].filter((entry) => entry !== value);
      renderAutoLists();
      markAutoDirty();
    });

    row.append(text, remove);
    el.append(row);
  }
}

function renderAutoLists() {
  renderPathList($('auto-roots'), 'roots', 'No folders yet — automatic cleanup will not run.');
  renderPathList($('auto-whitelist'), 'whitelist', 'No exclusions. System locations are still protected.');
  renderPathList($('auto-skip'), 'skipIfRunning', 'Nothing listed — the cleanup runs whatever is open.', true);
  renderPathList($('monitor-volumes'), 'monitorVolumes', 'None listed — your home drive is watched by default.');
}

function markAutoDirty() {
  $('auto-status').textContent = 'Unsaved changes.';
}

/* ---- form <-> settings -------------------------------------------------- */

function buildCategoryChecks(selected) {
  const host = $('auto-categories');
  host.replaceChildren();

  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const wrap = document.createElement('label');
    wrap.className = 'check';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.category = key;
    box.checked = selected.includes(key);
    box.addEventListener('change', markAutoDirty);

    const text = document.createElement('span');
    text.textContent = label;

    wrap.append(box, text);
    host.append(wrap);
  }
}

function readAutoForm() {
  const boxes = document.querySelectorAll('#auto-categories input[type=checkbox]');
  const categories = [...boxes].filter((box) => box.checked).map((box) => box.dataset.category);

  return {
    autoClean: {
      enabled: $('auto-enabled').checked,
      dryRun: $('auto-dryrun').checked,
      schedule: {
        kind: $('auto-kind').value,
        time: $('auto-time').value || '02:00',
        weekday: Number($('auto-weekday').value),
        day: Number($('auto-day').value),
      },
      roots: state.autoLists.roots,
      whitelist: state.autoLists.whitelist,
      skipIfRunning: state.autoLists.skipIfRunning,
      categories,
      minAgeDays: Number($('auto-age').value),
      minDiskUsedPercent: Number($('auto-threshold').value),
      maxItemsPerRun: Number($('auto-max').value),
      notify: true,
    },
    purge: {
      enabled: $('purge-enabled').checked,
      afterDays: Number($('purge-days').value),
    },
    monitor: {
      enabled: $('monitor-enabled').checked,
      volumes: state.autoLists.monitorVolumes,
      warnPercent: Number($('monitor-warn').value),
      criticalPercent: Number($('monitor-critical').value),
      intervalSeconds: Number($('monitor-interval').value),
      snoozeMinutes: Number($('monitor-snooze').value),
      closeToTray: $('monitor-close-to-tray').checked,
    },
  };
}

function applyAutoState(data) {
  state.auto = data;
  const auto = data.settings.autoClean;

  $('auto-enabled').checked = auto.enabled;
  $('auto-dryrun').checked = auto.dryRun;
  $('auto-kind').value = auto.schedule.kind;
  $('auto-weekday').value = String(auto.schedule.weekday);
  $('auto-day').value = String(auto.schedule.day);
  $('auto-time').value = auto.schedule.time;
  $('auto-age').value = String(auto.minAgeDays);
  $('auto-threshold').value = String(auto.minDiskUsedPercent);
  $('auto-max').value = String(auto.maxItemsPerRun);
  $('purge-enabled').checked = data.settings.purge.enabled;
  $('purge-days').value = String(data.settings.purge.afterDays);

  const monitor = data.settings.monitor;
  $('monitor-enabled').checked = monitor.enabled;
  $('monitor-close-to-tray').checked = monitor.closeToTray;
  $('monitor-warn').value = String(monitor.warnPercent);
  $('monitor-critical').value = String(monitor.criticalPercent);
  $('monitor-interval').value = String(monitor.intervalSeconds);
  $('monitor-snooze').value = String(monitor.snoozeMinutes);

  state.autoLists = {
    roots: [...auto.roots],
    whitelist: [...auto.whitelist],
    skipIfRunning: [...auto.skipIfRunning],
    monitorVolumes: [...monitor.volumes],
  };

  buildCategoryChecks(auto.categories);
  renderAutoLists();
  syncScheduleRows();

  $('astat-state').textContent = auto.enabled ? (auto.dryRun ? 'Report only' : 'On') : 'Off';
  $('astat-next').textContent = auto.enabled ? formatWhenShort(data.scheduler.nextRunAt) : '–';
  $('astat-next').title = auto.enabled ? formatWhen(data.scheduler.nextRunAt) : '';
  $('astat-last').textContent = data.lastRun ? formatWhenShort(data.lastRun.startedAt) : 'Never';
  $('astat-last').title = data.lastRun ? `${formatWhen(data.lastRun.startedAt)} — ${data.lastRun.reason || data.lastRun.outcome}` : '';

  // A schedule that is switched on but has no task behind it would silently
  // never run, which is the failure this whole feature exists to avoid.
  if (!data.scheduler.supported) {
    showNotice('auto-unsupported',
      'Scheduling is implemented for Windows only. Everything here can still be run by hand.');
  } else if (auto.enabled && !data.scheduler.installed) {
    showNotice('auto-unsupported',
      'Automatic cleanup is switched on but no Windows task is registered — it will not run. ' +
      'Save the settings again to create it.');
  } else {
    $('auto-unsupported').hidden = true;
  }

  if (data.warnings && data.warnings.length > 0) {
    showNotice('auto-warnings', `Settings were adjusted on load: ${data.warnings.join(' · ')}`);
  } else {
    $('auto-warnings').hidden = true;
  }

  renderRunResult(data.lastRun);
  renderRunHistory(data.history || []);
  $('auto-status').textContent = describeSchedule(auto);
}

function showNotice(id, text) {
  $(id).textContent = text;
  $(id).hidden = false;
}

function describeSchedule(auto) {
  if (!auto.enabled) return 'Automatic cleanup is off.';

  let when;
  if (auto.schedule.kind === 'daily') {
    when = `every day at ${auto.schedule.time}`;
  } else if (auto.schedule.kind === 'weekly') {
    when = `every ${WEEKDAY_NAMES[auto.schedule.weekday]} at ${auto.schedule.time}`;
  } else {
    when = `on day ${auto.schedule.day} of each month at ${auto.schedule.time}`;
  }

  return auto.dryRun
    ? `Reporting only, ${when}. Nothing will be deleted.`
    : `Cleaning ${when}.`;
}

function syncScheduleRows() {
  const kind = $('auto-kind').value;
  $('auto-weekday-row').hidden = kind !== 'weekly';
  $('auto-day-row').hidden = kind !== 'monthly';
  $('auto-schedule-note').textContent =
    kind === 'monthly'
      ? 'Days run to 28 only, so a monthly cleanup fires in February too.'
      : 'A run missed because the PC was off happens at the next opportunity.';
}

/* ---- results ------------------------------------------------------------ */

function resultLine(label, value) {
  const row = document.createElement('div');
  row.className = 'result-line';
  const left = document.createElement('span');
  left.textContent = label;
  const right = document.createElement('span');
  right.textContent = value;
  row.append(left, right);
  return row;
}

function renderRunResult(run) {
  const card = $('auto-result');
  const body = $('auto-result-body');

  if (!run) {
    card.hidden = true;
    return;
  }

  body.replaceChildren();

  const outcome = document.createElement('div');
  outcome.className = `result-line run-outcome-${run.outcome}`;
  const left = document.createElement('span');
  left.textContent = `${formatWhen(run.startedAt)}${run.manual ? ' (started by hand)' : ''}`;
  const right = document.createElement('span');
  right.textContent = run.reason || run.outcome;
  outcome.append(left, right);
  body.append(outcome);

  body.append(resultLine('Files scanned', formatCount(run.scanned.files)));
  body.append(resultLine('Selected', `${formatCount(run.selected.files)} · ${formatBytes(run.selected.bytes)}`));

  if (!run.dryRun) {
    body.append(resultLine('Moved to Recycle Bin',
      `${formatCount(run.trashed.files)} · ${formatBytes(run.trashed.bytes)}`));
    body.append(resultLine('Permanently removed',
      `${formatCount(run.purged.files)} · ${formatBytes(run.purged.bytes)}`));
  }

  if (run.diskBefore && run.diskAfter && run.diskBefore.ok && run.diskAfter.ok) {
    body.append(resultLine('Disk in use',
      `${run.diskBefore.usedPercent.toFixed(1)}% to ${run.diskAfter.usedPercent.toFixed(1)}%`));
  }

  const skipped = run.skipped || {};
  const parts = [];
  if (skipped.tooRecent) parts.push(`${formatCount(skipped.tooRecent)} too recent`);
  if (skipped.whitelisted) parts.push(`${formatCount(skipped.whitelisted)} excluded`);
  if (skipped.guarded) parts.push(`${formatCount(skipped.guarded)} protected`);
  if (parts.length > 0) body.append(resultLine('Left alone', parts.join(' · ')));

  for (const note of run.notes || []) {
    const para = document.createElement('p');
    para.className = 'result-note';
    para.textContent = note;
    body.append(para);
  }

  card.hidden = false;
}

function renderRunHistory(runs) {
  const list = $('auto-history');
  list.replaceChildren();

  if (runs.length <= 1) {
    $('auto-history-card').hidden = true;
    return;
  }

  for (const run of runs) {
    const row = document.createElement('li');
    row.className = 'file-row';

    const main = document.createElement('div');
    main.className = 'file-main';

    const when = document.createElement('div');
    when.className = 'file-path';
    when.textContent = formatWhen(run.startedAt);

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.textContent = run.dryRun
      ? `report only — ${formatCount(run.selected.files)} file(s) would go`
      : `${formatCount(run.trashed.files)} moved · ${formatCount(run.purged.files)} permanently removed`;

    main.append(when, meta);

    const size = document.createElement('div');
    size.className = 'file-size';
    size.textContent = formatBytes(run.dryRun ? run.selected.bytes : run.trashed.bytes);

    row.append(size, main);
    list.append(row);
  }

  $('auto-history-card').hidden = false;
}

/* ---- disk monitoring ---------------------------------------------------- */

const LEVEL_WORDS = { ok: 'fine', warn: 'low', critical: 'almost full' };

async function refreshMonitorStatus() {
  const status = unwrap(await api.monitorStatus(), 'Disk monitoring');
  if (!status) return;

  const badge = $('monitor-badge');
  const line = $('monitor-status');

  $('monitor-check').disabled = !status.running;
  $('monitor-snooze-btn').disabled = !status.running;

  if (!status.running) {
    badge.textContent = 'Off';
    badge.className = 'card-badge';
    line.textContent = 'Not running. Nothing of CleanDrive stays in memory.';
    return;
  }

  const readable = status.volumes.filter((v) => v.usage && v.usage.ok);
  const worst = readable.reduce((a, b) => (!a || b.usage.usedPercent > a.usage.usedPercent ? b : a), null);

  if (worst) {
    badge.textContent = `${worst.usage.usedPercent.toFixed(0)}% · ${LEVEL_WORDS[worst.level]}`;
    badge.className = `card-badge is-${worst.level}`;
  } else {
    badge.textContent = 'no readings';
    badge.className = 'card-badge';
  }

  const parts = readable.map(
    (v) => `${v.root} ${v.usage.usedPercent.toFixed(1)}% (${formatBytes(v.usage.freeBytes)} free)`
  );
  if (parts.length === 0) parts.push('No volume could be read.');
  if (status.snoozed) parts.push(`alerts snoozed until ${formatWhen(status.snoozedUntil)}`);

  line.textContent = parts.join(' · ');
  $('monitor-snooze-btn').textContent = status.snoozed ? 'Resume alerts' : 'Snooze';
}

$('monitor-add-volume').addEventListener('click', () => addFolderTo('monitorVolumes'));

$('monitor-check').addEventListener('click', async () => {
  $('monitor-status').textContent = 'Checking…';
  const status = unwrap(await api.monitorCheck(), 'Disk monitoring');
  if (status) await refreshMonitorStatus();
});

$('monitor-snooze-btn').addEventListener('click', async () => {
  const status = unwrap(await api.monitorStatus(), 'Disk monitoring');
  if (!status) return;
  const next = status.snoozed ? await api.monitorResume() : await api.monitorSnooze();
  if (unwrap(next, 'Disk monitoring')) await refreshMonitorStatus();
});

/* ---- purge -------------------------------------------------------------- */

async function refreshPurgeStatus() {
  const preview = unwrap(await api.previewPurge(), 'Recycle Bin');
  if (!preview) return;

  $('purge-now').disabled = preview.items === 0;

  if (preview.tracked === 0) {
    $('purge-status').textContent = 'Nothing recorded yet.';
  } else if (preview.items === 0) {
    $('purge-status').textContent =
      `${formatCount(preview.tracked)} item(s) tracked, none older than ${preview.afterDays} day(s) yet.`;
  } else {
    const suffix = $('purge-enabled').checked ? '' : ' — switch on above to do this on a schedule';
    $('purge-status').textContent =
      `${formatCount(preview.items)} item(s) · ${formatBytes(preview.bytes)} ready to free${suffix}`;
  }
}

/* ---- wiring ------------------------------------------------------------- */

(function fillDayOptions() {
  const select = $('auto-day');
  for (let day = 1; day <= 28; day++) {
    const option = document.createElement('option');
    option.value = String(day);
    option.textContent = String(day);
    select.append(option);
  }
})();

for (const id of [
  'auto-enabled', 'auto-dryrun', 'auto-kind', 'auto-weekday', 'auto-day', 'auto-time',
  'auto-age', 'auto-threshold', 'auto-max', 'purge-enabled', 'purge-days',
  'monitor-enabled', 'monitor-close-to-tray', 'monitor-warn', 'monitor-critical',
  'monitor-interval', 'monitor-snooze',
]) {
  $(id).addEventListener('change', () => {
    if (id === 'auto-kind') syncScheduleRows();
    markAutoDirty();
  });
}

async function addFolderTo(key) {
  const folder = unwrap(await api.pickFolder(), 'Choose folder');
  if (!folder || state.autoLists[key].includes(folder)) return;
  state.autoLists[key].push(folder);
  renderAutoLists();
  markAutoDirty();
}

$('auto-add-root').addEventListener('click', () => addFolderTo('roots'));
$('auto-add-whitelist').addEventListener('click', () => addFolderTo('whitelist'));

function addSkipEntry() {
  const input = $('auto-skip-input');
  const value = input.value.trim();
  if (value === '' || state.autoLists.skipIfRunning.includes(value)) return;
  state.autoLists.skipIfRunning.push(value);
  input.value = '';
  renderAutoLists();
  markAutoDirty();
}

$('auto-add-skip').addEventListener('click', addSkipEntry);
$('auto-skip-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addSkipEntry();
});

$('auto-save').addEventListener('click', async () => {
  $('auto-status').textContent = 'Saving…';
  const data = unwrap(await api.saveSettings(readAutoForm()), 'Save settings');
  if (!data) return;

  applyAutoState(data);
  await refreshPurgeStatus();
  await refreshMonitorStatus();

  if (data.schedulerError) {
    toast(`Saved, but Windows Task Scheduler refused the task: ${data.schedulerError}`, true);
  } else if (data.settings.autoClean.enabled) {
    toast(`Saved. Next run ${formatWhen(data.scheduler.nextRunAt)}.`);
  } else {
    toast('Saved. Automatic cleanup is off and the Windows task was removed.');
  }
});

function setAutoRunning(running) {
  $('auto-preview').disabled = running;
  $('auto-run').disabled = running;
  $('auto-save').disabled = running;
  $('auto-cancel').hidden = !running;
  $('auto-progress').hidden = !running;
}

api.onAutoCleanProgress((payload) => {
  if (payload.stage === 'checking') {
    $('auto-status').textContent = 'Checking disk usage and running apps…';
  } else if (payload.stage === 'scanning') {
    $('auto-status').textContent = `Scanning ${elide(payload.root, 60)}…`;
  } else if (payload.stage === 'deleting') {
    $('auto-status').textContent = `Moving ${formatCount(payload.total)} file(s) to the Recycle Bin…`;
  } else if (payload.stage === 'purging') {
    $('auto-status').textContent = 'Emptying older recycled items…';
  }
});

async function performAutoRun(dryRun) {
  if (state.autoLists.roots.length === 0) {
    toast('Add at least one folder first.', true);
    return;
  }

  setAutoRunning(true);

  // The run reads the saved policy, not this form. Pressing the button is a
  // statement about what is on screen, so save it first -- otherwise adding a
  // folder and clicking Preview silently tests the previous configuration and
  // reports a result for something the user is no longer looking at.
  $('auto-status').textContent = 'Saving settings…';
  const saved = unwrap(await api.saveSettings(readAutoForm()), 'Save settings');
  if (!saved) {
    setAutoRunning(false);
    return;
  }
  applyAutoState(saved);

  $('auto-status').textContent = dryRun ? 'Working out what would go…' : 'Running cleanup…';

  const data = unwrap(await api.runAutoClean({ dryRun }), 'Cleanup');
  setAutoRunning(false);

  if (!data) {
    $('auto-status').textContent = 'Cleanup failed.';
    return;
  }

  applyAutoState(data.state);
  await refreshPurgeStatus();
  renderRunResult(data.run);

  const run = data.run;
  if (run.outcome === 'dry-run') {
    toast(`${formatCount(run.selected.files)} file(s), ${formatBytes(run.selected.bytes)} would be moved.`);
  } else if (run.outcome === 'skipped' || run.outcome === 'cancelled') {
    toast(run.reason || 'Nothing was done.');
  } else {
    toast(`Moved ${formatCount(run.trashed.files)} file(s) to the Recycle Bin.`);
  }
}

$('auto-preview').addEventListener('click', () => performAutoRun(true));
$('auto-run').addEventListener('click', () => performAutoRun(false));
$('auto-cancel').addEventListener('click', () => api.cancelAutoClean());

$('purge-now').addEventListener('click', async () => {
  const result = unwrap(await api.purgeNow(), 'Recycle Bin');
  if (!result) return;

  await refreshPurgeStatus();
  if (result.cancelled || result.purged === 0) {
    toast('Nothing was permanently deleted.');
  } else {
    toast(`Permanently deleted ${formatCount(result.purged)} item(s), freeing ${formatBytes(result.bytes)}.`);
  }
});

/**
 * Re-read everything this tab draws.
 *
 * Needed because the scheduled cleanup runs in a different process. A window
 * left open overnight would otherwise still be showing yesterday's figures
 * while the 02:00 run sat in the log unread — the feature working perfectly and
 * the screen reporting that it had not.
 *
 * `silent` skips the unsaved-changes wording: a refresh triggered by a
 * background write is not the user typing.
 */
async function refreshAutoState({ silent = false } = {}) {
  const data = unwrap(await api.getSettings(), 'Settings');
  if (data) applyAutoState(data);

  const usage = unwrap(await api.diskUsage(null), 'Disk usage');
  if (usage && usage.ok) {
    $('astat-disk').textContent = `${usage.usedPercent.toFixed(0)}%`;
    $('astat-disk').title =
      `${formatBytes(usage.freeBytes)} free of ${formatBytes(usage.totalBytes)} on ${usage.root}`;
  }

  await refreshPurgeStatus();
  await refreshMonitorStatus();
  return data;
}

// A run that finished in the background, announced by the main process. The
// whole point is that an open window notices without being clicked.
api.onDataChanged(async (payload) => {
  const before = state.auto && state.auto.lastRun ? state.auto.lastRun.startedAt : 0;
  const data = await refreshAutoState({ silent: true });
  if (!data || !data.lastRun || data.lastRun.startedAt === before) return;

  const run = data.lastRun;
  if (run.manual) return; // the manual path reports its own result already

  toast(
    run.outcome === 'dry-run'
      ? `Scheduled report finished: ${formatCount(run.selected.files)} file(s) would be moved.`
      : run.outcome === 'skipped'
        ? `Scheduled cleanup skipped: ${run.reason}`
        : `Scheduled cleanup moved ${formatCount(run.trashed.files)} file(s) to the Recycle Bin.`
  );
});

// Cheap belt to the watcher's braces: if the watch ever fails to start, opening
// the tab still shows current figures.
for (const tab of document.querySelectorAll('.tab[data-tab="auto"]')) {
  tab.addEventListener('click', () => {
    if ($('auto-status').textContent !== 'Unsaved changes.') refreshAutoState({ silent: true });
  });
}

refreshAutoState();
