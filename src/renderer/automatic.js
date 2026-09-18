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
        everyMinutes: Number($('auto-minutes').value),
        catchUpAtLogon: $('auto-catchup').checked,
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
  $('auto-minutes').value = String(auto.schedule.everyMinutes);
  $('auto-catchup').checked = auto.schedule.catchUpAtLogon;

  // An installed build will not accept an interval below five minutes, so the
  // input says so instead of accepting a 1 and silently storing a 5.
  const minMinutes = data.limits ? data.limits.minMinutes : 1;
  $('auto-minutes').min = String(minMinutes);
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
  // never run, which is the failure this whole feature exists to avoid. Each
  // branch below is a real state this app has been found in.
  const cleanup = data.tasks ? data.tasks.cleanup : null;

  if (data.tasks && !data.tasks.supported) {
    showNotice('auto-unsupported',
      'Scheduling is implemented for Windows only. Everything here can still be run by hand.');
  } else if (cleanup && cleanup.orphaned) {
    showNotice('auto-unsupported',
      'A CleanDrive task is registered with Windows but this app has no saved settings, so it ' +
      'would run and find nothing configured. Save your configuration to repair it.');
  } else if (auto.enabled && cleanup && !cleanup.installed) {
    showNotice('auto-unsupported',
      'Automatic cleanup is switched on but no Windows task is registered — it will not run. ' +
      'Press “Repair registration”, or save the settings again, to create it.');
  } else if (auto.enabled && cleanup && !cleanup.verified) {
    showNotice('auto-unsupported',
      `The registered Windows task does not match these settings: ${cleanup.problems.join(' ')}`);
  } else {
    $('auto-unsupported').hidden = true;
  }

  // What the launch-time check had to put right, or could not. Worth saying
  // out loud: this is the answer to "why did my schedule stop running".
  const notes = [];
  if (data.reconciliation) {
    notes.push(...data.reconciliation.changes, ...data.reconciliation.problems);
  }
  if (data.warnings && data.warnings.length > 0) {
    notes.push(`Settings were adjusted on load: ${data.warnings.join(' · ')}`);
  }
  if (notes.length > 0) showNotice('auto-warnings', notes.join(' · '));
  else $('auto-warnings').hidden = true;

  renderTaskFacts(data.tasks, null);

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
  if (auto.schedule.kind === 'minutes') {
    const every = auto.schedule.everyMinutes;
    when = every === 1 ? 'every minute' : `every ${every} minutes`;
  } else if (auto.schedule.kind === 'daily') {
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
  $('auto-minutes-row').hidden = kind !== 'minutes';
  // An interval repeats from midnight, so a start time would be a control that
  // changes nothing -- hide it rather than leave it there looking meaningful.
  $('auto-time-row').hidden = kind === 'minutes';

  if (kind === 'minutes') {
    $('auto-schedule-note').textContent =
      'For testing that the schedule really is a Windows task: it keeps running with CleanDrive ' +
      'closed and after a restart. Each run is a real cleanup with your settings, so leave it in ' +
      'report-only mode unless you mean it.';
  } else if (kind === 'monthly') {
    $('auto-schedule-note').textContent =
      'Days run to 28 only, so a monthly cleanup fires in February too.';
  } else {
    $('auto-schedule-note').textContent =
      'A run missed because the PC was off happens at the next opportunity.';
  }
}

/* ---- the Windows task --------------------------------------------------- */

function factRow(label, value, title, { name = false } = {}) {
  const row = document.createElement('li');
  row.className = 'pair-row';

  const left = document.createElement('span');
  left.className = 'pair-label';
  left.textContent = label;

  const right = document.createElement('span');
  // `is-name` is monospaced and truncates; the default wraps, because some of
  // these values are a whole sentence about why a run failed.
  right.className = name ? 'pair-value is-name' : 'pair-value';
  right.textContent = value;
  if (title) right.title = title;

  row.append(left, right);
  return row;
}

/**
 * What Windows holds, as opposed to what this app intends.
 *
 * `osInfo` is the expensive half (a PowerShell call per task) and arrives
 * separately; until it does, the rows that need it say so rather than showing a
 * time the app worked out for itself. That distinction is the entire point of
 * this card: the previous version of this screen could not tell "Windows ran it
 * at 02:00:34 and it exited 0" from "the settings file says it should have".
 */
function renderTaskFacts(status, osInfo) {
  const list = $('task-facts');
  list.replaceChildren();

  if (!status) {
    list.append(factRow('Registration', 'not checked yet'));
    return;
  }

  if (!status.supported) {
    list.append(factRow('Registration', 'Windows only'));
    return;
  }

  const cleanup = status.cleanup;
  const os = osInfo || cleanup.os;

  list.append(factRow(
    'Registered task',
    cleanup.installed ? `\\${cleanup.taskPath}` : 'none',
    cleanup.installed ? 'Visible in Task Scheduler under this name' : '',
    { name: true }
  ));

  list.append(factRow(
    'Matches these settings',
    cleanup.installed ? (cleanup.verified ? 'yes' : 'no') : '–',
    cleanup.problems && cleanup.problems.length > 0 ? cleanup.problems.join(' ') : ''
  ));

  // Two rows, never one. The first version showed a single "Windows holds" row
  // that fell back to the app's own schedule when nothing was registered --
  // which is the precise confusion this card was built to remove: the screen
  // presenting an intention as though the OS had confirmed it.
  list.append(factRow('These settings ask for', cleanup.description));
  list.append(factRow(
    'Windows holds',
    cleanup.registered ? describeRegistered(cleanup.registered) : 'nothing — no task is registered'
  ));

  if (os && os.error) {
    // Only the error. "Windows says last run: never" for a task Windows has
    // never heard of would be a fact about nothing, dressed as a reading.
    list.append(factRow('Could not ask Windows', os.error));
  } else if (os) {
    list.append(factRow('Windows says last run', os.lastRunAt ? formatWhen(os.lastRunAt) : 'never'));
    list.append(factRow('Windows says next run', os.nextRunAt ? formatWhen(os.nextRunAt) : 'none scheduled'));
    list.append(factRow(
      'Result of that run',
      status.cleanup.osResult || '–',
      os.lastResult === null || os.lastResult === undefined
        ? ''
        : `Task Scheduler code ${os.lastResult}`
    ));
    if (os.missedRuns) list.append(factRow('Runs missed', String(os.missedRuns)));
    if (os.state) list.append(factRow('Task state', os.state));
  } else {
    list.append(factRow('Windows says last run', 'press “Check with Windows”'));
  }

  list.append(factRow(
    'Daily disk measurement',
    status.sampler.installed
      ? (status.sampler.verified ? `registered, ${status.sampler.description}` : 'registered but does not match')
      : (status.sampler.wanted ? 'wanted but not registered' : 'off'),
    'Used by the Trends tab; deletes nothing'
  ));

  const problems = [
    ...(cleanup.problems || []),
    ...(status.sampler.problems || []),
  ];
  if (problems.length > 0) showNotice('task-problems', problems.join(' '));
  else $('task-problems').hidden = true;
}

/** One line for a schedule read back out of the registered task. */
function describeRegistered(registered) {
  let when;
  if (registered.kind === 'minutes') {
    when = registered.everyMinutes === 1
      ? 'a run every minute'
      : `a run every ${registered.everyMinutes} minutes`;
  } else if (registered.kind === 'daily') {
    when = `a daily run at ${registered.time}`;
  } else if (registered.kind === 'monthly') {
    when = `a monthly run on day ${registered.day} at ${registered.time}`;
  } else {
    when = `a weekly run on ${WEEKDAY_NAMES[registered.weekday]} at ${registered.time}`;
  }
  return registered.catchUpAtLogon ? `${when}, plus one after logging in` : when;
}

/** Ask Windows directly. Slow enough (~1s per task) to be a deliberate act. */
async function refreshTaskStatus({ quiet = false, fresh = false } = {}) {
  if (!quiet) $('task-status').textContent = 'Asking Windows…';
  const status = unwrap(await api.taskStatus({ fresh }), 'Windows task');
  if (!status) {
    $('task-status').textContent = 'Windows could not be asked.';
    return null;
  }

  renderTaskFacts(status, status.cleanup.os);
  $('task-status').textContent = status.supported
    ? (status.cleanup.installed
        ? (status.cleanup.verified
            ? 'Windows holds exactly what these settings describe.'
            : 'Windows holds something other than these settings.')
        : 'Windows has no CleanDrive cleanup task registered.')
    : 'Scheduling is Windows only.';
  return status;
}

$('task-check').addEventListener('click', () => refreshTaskStatus({ fresh: true }));

$('task-repair').addEventListener('click', async () => {
  $('task-status').textContent = 'Re-registering…';
  const result = unwrap(await api.reconcileTasks(), 'Windows task');
  if (!result) return;

  applyAutoState(result.state);
  await refreshTaskStatus({ quiet: true });

  const { changes, problems } = result.reconciled;
  if (problems.length > 0) toast(problems.join(' '), true);
  else if (changes.length > 0) toast(changes.join(' '));
  else toast('Nothing needed changing — Windows already matches these settings.');
});

$('task-run').addEventListener('click', async () => {
  $('task-status').textContent = 'Asking Task Scheduler to start the task…';
  const started = unwrap(await api.runTaskNow('cleanup'), 'Run task');
  if (!started) {
    $('task-status').textContent = 'The task could not be started.';
    return;
  }
  // Deliberately not awaited: the run is a separate process and the result
  // arrives through the file watcher, exactly as a 02:00 run would. Waiting
  // here would prove less than letting the normal path report it.
  $('task-status').textContent =
    'Windows has started the task. Its result appears below when the run finishes, the same way ' +
    'a scheduled run does.';
});

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
  'auto-minutes', 'auto-catchup',
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

  // Read before saving, so the reply can be compared against what was asked
  // for. The settings layer refuses some combinations -- switching the cleanup
  // on with no folders listed is the common one -- and a save that quietly
  // returns "off" after the user ticked "on" must not be reported as "Saved".
  const requested = readAutoForm();
  const data = unwrap(await api.saveSettings(requested), 'Save settings');
  if (!data) {
    $('auto-status').textContent = 'Nothing was saved.';
    return;
  }

  applyAutoState(data);
  await refreshPurgeStatus();
  await refreshMonitorStatus();

  const saved = data.settings.autoClean;
  const problems = data.reconciled ? data.reconciled.problems : [];

  if (requested.autoClean.enabled && !saved.enabled) {
    toast(
      'Saved, but automatic cleanup was left off: ' +
        (data.warnings.join(' ') || 'the configuration is not runnable as it stands.'),
      true
    );
  } else if (problems.length > 0) {
    toast(`Saved, but the Windows task is not right: ${problems.join(' ')}`, true);
  } else if (saved.enabled) {
    toast(`Saved and registered with Windows. Next run ${formatWhen(data.scheduler.nextRunAt)}.`);
  } else {
    toast('Saved. Automatic cleanup is off and its Windows task was removed.');
  }

  // The OS's own view, after a save that just rewrote it.
  await refreshTaskStatus({ quiet: true });
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
    // Opening the tab is the moment to spend a second asking Windows what it
    // actually holds. Not on every refresh: the file watcher can fire this tab
    // several times during one background run.
    refreshTaskStatus({ quiet: true });
  });
}

refreshAutoState();
