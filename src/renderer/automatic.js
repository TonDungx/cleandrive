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
  temp: ['category.temp', 'Temporary files'],
  cache: ['category.cache', 'Caches'],
  crashdump: ['category.crashdump', 'Crash dumps'],
  log: ['category.log', 'Old log files'],
  gpucache: ['category.gpucache', 'GPU & compiled-code caches'],
  buildoutput: ['category.buildoutput', 'Build output'],
};

const WEEKDAY_KEYS = [
  ['day.sunday', 'Sunday'],
  ['day.monday', 'Monday'],
  ['day.tuesday', 'Tuesday'],
  ['day.wednesday', 'Wednesday'],
  ['day.thursday', 'Thursday'],
  ['day.friday', 'Friday'],
  ['day.saturday', 'Saturday'],
];

/** The weekday name in the language being read, not the one this file is in. */
function weekdayName(index) {
  const entry = WEEKDAY_KEYS[Number(index) || 0] || WEEKDAY_KEYS[0];
  return t(entry[0], entry[1]);
}

/**
 * Whether the form holds edits that have not been saved.
 *
 * A flag rather than a reading of the status line, which is what it used to be:
 * `textContent !== 'Unsaved changes.'` compares against an English sentence, so
 * translating the app would have quietly made every refresh overwrite whatever
 * the user was in the middle of typing.
 */
let autoDirty = false;

state.auto = null;
state.autoLists = { roots: [], whitelist: [], skipIfRunning: [], monitorVolumes: [] };

function formatWhen(timestamp) {
  if (!timestamp) return '–';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString(uiLocale(), {
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
  return date.toLocaleString(uiLocale(), {
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
    remove.textContent = t('app.remove', 'Remove');
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
  renderPathList($('auto-roots'), 'roots', t('auto.roots.empty', 'No folders yet — automatic cleanup will not run.'));
  renderPathList($('auto-whitelist'), 'whitelist', t('auto.whitelist.empty', 'No exclusions. System locations are still protected.'));
  renderPathList($('auto-skip'), 'skipIfRunning', t('auto.skip.empty', 'Nothing listed — the cleanup runs whatever is open.'), true);
  renderPathList($('monitor-volumes'), 'monitorVolumes', t('monitor.volumes.empty', 'None listed — your home drive is watched by default.'));
}

function markAutoDirty() {
  autoDirty = true;
  $('auto-status').textContent = t('auto.unsaved', 'Unsaved changes.');
}

/* ---- form <-> settings -------------------------------------------------- */

function buildCategoryChecks(selected) {
  const host = $('auto-categories');
  host.replaceChildren();

  for (const [key, [labelKey, labelEnglish]] of Object.entries(CATEGORY_LABELS)) {
    const wrap = document.createElement('label');
    wrap.className = 'check';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.category = key;
    box.checked = selected.includes(key);
    box.addEventListener('change', markAutoDirty);

    const text = document.createElement('span');
    text.textContent = t(labelKey, labelEnglish);

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

  const stateWord = auto.enabled
    ? auto.dryRun
      ? t('auto.state.reportOnly', 'Report only')
      : t('app.on', 'On')
    : t('app.off', 'Off');

  $('astat-state').textContent = stateWord;

  // The same word in the bar that stays on screen. The tile scrolls away; the
  // question it answers -- is any of this actually running -- does not.
  const chip = $('auto-state');
  chip.textContent = stateWord;
  chip.classList.toggle('is-on', auto.enabled && !auto.dryRun);
  chip.classList.toggle('is-dry', auto.enabled && auto.dryRun);
  $('astat-next').textContent = auto.enabled ? formatWhenShort(data.scheduler.nextRunAt) : '–';
  $('astat-next').title = auto.enabled ? formatWhen(data.scheduler.nextRunAt) : '';
  $('astat-last').textContent = data.lastRun ? formatWhenShort(data.lastRun.startedAt) : t('app.never', 'Never');
  $('astat-last').title = data.lastRun
    ? `${formatWhen(data.lastRun.startedAt)} — ${tm(data.lastRun.reason) || data.lastRun.outcome}`
    : '';

  // A schedule that is switched on but has no task behind it would silently
  // never run, which is the failure this whole feature exists to avoid. Each
  // branch below is a real state this app has been found in.
  const cleanup = data.tasks ? data.tasks.cleanup : null;

  if (data.tasks && !data.tasks.supported) {
    showNotice('auto-unsupported',
      t('auto.notice.windowsOnly', 'Scheduling is implemented for Windows only. Everything here can still be run by hand.'));
  } else if (cleanup && cleanup.orphaned) {
    showNotice('auto-unsupported',
      t('auto.notice.orphaned',
        'A CleanDrive task is registered with Windows but this app has no saved settings, so it ' +
        'would run and find nothing configured. Save your configuration to repair it.'));
  } else if (auto.enabled && cleanup && !cleanup.installed) {
    showNotice('auto-unsupported',
      t('auto.notice.noTask',
        'Automatic cleanup is switched on but no Windows task is registered — it will not run. ' +
        'Press “Repair registration”, or save the settings again, to create it.'));
  } else if (auto.enabled && cleanup && !cleanup.verified) {
    showNotice('auto-unsupported',
      t('auto.notice.mismatch', 'The registered Windows task does not match these settings: {problems}', {
        problems: cleanup.problems.join(' '),
      }));
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
    notes.push(t('auto.notice.adjusted', 'Settings were adjusted on load: {warnings}', {
      warnings: data.warnings.join(' · '),
    }));
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
  if (!auto.enabled) return t('auto.describe.off', 'Automatic cleanup is off.');

  let when;
  if (auto.schedule.kind === 'minutes') {
    const every = auto.schedule.everyMinutes;
    when =
      every === 1
        ? t('schedule.everyMinute', 'every minute')
        : t('schedule.everyMinutes', 'every {n} minutes', { n: every });
  } else if (auto.schedule.kind === 'daily') {
    when = t('schedule.everyDay', 'every day at {time}', { time: auto.schedule.time });
  } else if (auto.schedule.kind === 'weekly') {
    when = t('schedule.everyWeek', 'every {day} at {time}', {
      day: weekdayName(auto.schedule.weekday),
      time: auto.schedule.time,
    });
  } else {
    when = t('schedule.everyMonth', 'on day {day} of each month at {time}', {
      day: auto.schedule.day,
      time: auto.schedule.time,
    });
  }

  return auto.dryRun
    ? t('auto.describe.reportOnly', 'Reporting only, {when}. Nothing will be deleted.', { when })
    : t('auto.describe.cleaning', 'Cleaning {when}.', { when });
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
    $('auto-schedule-note').textContent = t(
      'auto.note.minutes',
      'For testing that the schedule really is a Windows task: it keeps running with CleanDrive ' +
        'closed and after a restart. Each run is a real cleanup with your settings, so leave it in ' +
        'report-only mode unless you mean it.'
    );
  } else if (kind === 'monthly') {
    $('auto-schedule-note').textContent = t(
      'auto.note.monthly',
      'Days run to 28 only, so a monthly cleanup fires in February too.'
    );
  } else {
    $('auto-schedule-note').textContent = t(
      'auto.note.missed',
      'A run missed because the PC was off happens at the next opportunity.'
    );
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
    list.append(factRow(t('task.registration', 'Registration'), t('task.notCheckedYet', 'not checked yet')));
    return;
  }

  if (!status.supported) {
    list.append(factRow(t('task.registration', 'Registration'), t('task.windowsOnly', 'Windows only')));
    return;
  }

  const cleanup = status.cleanup;
  const os = osInfo || cleanup.os;

  list.append(factRow(
    t('task.registeredTask', 'Registered task'),
    cleanup.installed ? `\\${cleanup.taskPath}` : t('task.none', 'none'),
    cleanup.installed ? t('task.visibleHint', 'Visible in Task Scheduler under this name') : '',
    { name: true }
  ));

  list.append(factRow(
    t('task.matches', 'Matches these settings'),
    cleanup.installed ? (cleanup.verified ? t('app.yes', 'yes') : t('app.no', 'no')) : '–',
    cleanup.problems && cleanup.problems.length > 0 ? cleanup.problems.join(' ') : ''
  ));

  // Two rows, never one. The first version showed a single "Windows holds" row
  // that fell back to the app's own schedule when nothing was registered --
  // which is the precise confusion this card was built to remove: the screen
  // presenting an intention as though the OS had confirmed it.
  list.append(factRow(t('task.settingsAskFor', 'These settings ask for'), cleanup.description));
  list.append(factRow(
    t('task.windowsHolds', 'Windows holds'),
    cleanup.registered
      ? describeRegistered(cleanup.registered)
      : t('task.holdsNothing', 'nothing — no task is registered')
  ));

  if (os && os.error) {
    // Only the error. "Windows says last run: never" for a task Windows has
    // never heard of would be a fact about nothing, dressed as a reading.
    list.append(factRow(t('task.couldNotAsk', 'Could not ask Windows'), os.error));
  } else if (os) {
    list.append(factRow(
      t('task.lastRun', 'Windows says last run'),
      os.lastRunAt ? formatWhen(os.lastRunAt) : t('app.never.lower', 'never')
    ));
    list.append(factRow(
      t('task.nextRun', 'Windows says next run'),
      os.nextRunAt ? formatWhen(os.nextRunAt) : t('task.noneScheduled', 'none scheduled')
    ));
    list.append(factRow(
      t('task.result', 'Result of that run'),
      status.cleanup.osResult || '–',
      os.lastResult === null || os.lastResult === undefined
        ? ''
        : t('task.resultCode', 'Task Scheduler code {code}', { code: os.lastResult })
    ));
    if (os.missedRuns) list.append(factRow(t('task.missed', 'Runs missed'), String(os.missedRuns)));
    if (os.state) list.append(factRow(t('task.state', 'Task state'), os.state));
  } else {
    list.append(factRow(t('task.lastRun', 'Windows says last run'), t('task.pressCheck', 'press “Check with Windows”')));
  }

  list.append(factRow(
    t('task.sampler', 'Daily disk measurement'),
    status.sampler.installed
      ? status.sampler.verified
        ? t('task.samplerOk', 'registered, {schedule}', { schedule: status.sampler.description })
        : t('task.samplerMismatch', 'registered but does not match')
      : status.sampler.wanted
        ? t('task.samplerMissing', 'wanted but not registered')
        : t('app.off.lower', 'off'),
    t('task.samplerHint', 'Used by the Trends tab; deletes nothing')
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
    when =
      registered.everyMinutes === 1
        ? t('task.holds.everyMinute', 'a run every minute')
        : t('task.holds.everyMinutes', 'a run every {n} minutes', { n: registered.everyMinutes });
  } else if (registered.kind === 'daily') {
    when = t('task.holds.daily', 'a daily run at {time}', { time: registered.time });
  } else if (registered.kind === 'monthly') {
    when = t('task.holds.monthly', 'a monthly run on day {day} at {time}', {
      day: registered.day,
      time: registered.time,
    });
  } else {
    when = t('task.holds.weekly', 'a weekly run on {day} at {time}', {
      day: weekdayName(registered.weekday),
      time: registered.time,
    });
  }
  return registered.catchUpAtLogon ? t('task.holds.plusLogon', '{when}, plus one after logging in', { when }) : when;
}

/** Ask Windows directly. Slow enough (~1s per task) to be a deliberate act. */
async function refreshTaskStatus({ quiet = false, fresh = false } = {}) {
  if (!quiet) $('task-status').textContent = t('task.asking', 'Asking Windows…');
  const status = unwrap(await api.taskStatus({ fresh }), t('task.label', 'Windows task'));
  if (!status) {
    $('task-status').textContent = t('task.askFailed', 'Windows could not be asked.');
    return null;
  }

  renderTaskFacts(status, status.cleanup.os);
  $('task-status').textContent = status.supported
    ? status.cleanup.installed
      ? status.cleanup.verified
        ? t('task.statusExact', 'Windows holds exactly what these settings describe.')
        : t('task.statusOther', 'Windows holds something other than these settings.')
      : t('task.statusNone', 'Windows has no CleanDrive cleanup task registered.')
    : t('task.statusUnsupported', 'Scheduling is Windows only.');
  return status;
}

$('task-check').addEventListener('click', () => refreshTaskStatus({ fresh: true }));

$('task-repair').addEventListener('click', async () => {
  $('task-status').textContent = t('task.reRegistering', 'Re-registering…');
  const result = unwrap(await api.reconcileTasks(), t('task.label', 'Windows task'));
  if (!result) return;

  applyAutoState(result.state);
  await refreshTaskStatus({ quiet: true });

  const { changes, problems } = result.reconciled;
  if (problems.length > 0) toast(problems.join(' '), true);
  else if (changes.length > 0) toast(changes.join(' '));
  else toast(t('task.nothingToChange', 'Nothing needed changing — Windows already matches these settings.'));
});

$('task-run').addEventListener('click', async () => {
  $('task-status').textContent = t('task.starting', 'Asking Task Scheduler to start the task…');
  const started = unwrap(await api.runTaskNow('cleanup'), t('task.runLabel', 'Run task'));
  if (!started) {
    $('task-status').textContent = t('task.startFailed', 'The task could not be started.');
    return;
  }
  // Deliberately not awaited: the run is a separate process and the result
  // arrives through the file watcher, exactly as a 02:00 run would. Waiting
  // here would prove less than letting the normal path report it.
  $('task-status').textContent = t(
    'task.started',
    'Windows has started the task. Its result appears below when the run finishes, the same way ' +
      'a scheduled run does.'
  );
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
  left.textContent = run.manual
    ? t('auto.result.byHand', '{when} (started by hand)', { when: formatWhen(run.startedAt) })
    : formatWhen(run.startedAt);
  const right = document.createElement('span');
  right.textContent = tm(run.reason) || run.outcome;
  outcome.append(left, right);
  body.append(outcome);

  body.append(resultLine(t('auto.result.scanned', 'Files scanned'), formatCount(run.scanned.files)));
  body.append(resultLine(
    t('auto.result.selected', 'Selected'),
    `${formatCount(run.selected.files)} · ${formatBytes(run.selected.bytes)}`
  ));

  if (!run.dryRun) {
    body.append(resultLine(
      t('auto.result.moved', 'Moved to Recycle Bin'),
      `${formatCount(run.trashed.files)} · ${formatBytes(run.trashed.bytes)}`
    ));
    body.append(resultLine(
      t('auto.result.purged', 'Permanently removed'),
      `${formatCount(run.purged.files)} · ${formatBytes(run.purged.bytes)}`
    ));
  }

  if (run.diskBefore && run.diskAfter && run.diskBefore.ok && run.diskAfter.ok) {
    body.append(resultLine(
      t('auto.statDisk', 'Disk in use'),
      t('auto.result.diskChange', '{before}% to {after}%', {
        before: run.diskBefore.usedPercent.toFixed(1),
        after: run.diskAfter.usedPercent.toFixed(1),
      })
    ));
  }

  const skipped = run.skipped || {};
  const parts = [];
  if (skipped.tooRecent) parts.push(t('auto.result.tooRecent', '{n} too recent', { n: formatCount(skipped.tooRecent) }));
  if (skipped.whitelisted) parts.push(t('auto.result.excluded', '{n} excluded', { n: formatCount(skipped.whitelisted) }));
  if (skipped.guarded) parts.push(t('auto.result.guarded', '{n} protected', { n: formatCount(skipped.guarded) }));
  if (parts.length > 0) body.append(resultLine(t('auto.result.leftAlone', 'Left alone'), parts.join(' · ')));

  for (const note of run.notes || []) {
    const para = document.createElement('p');
    para.className = 'result-note';
    para.textContent = tm(note);
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
      ? t('auto.history.dryRun', 'report only — {n} file(s) would go', { n: formatCount(run.selected.files) })
      : t('auto.history.real', '{moved} moved · {purged} permanently removed', {
          moved: formatCount(run.trashed.files),
          purged: formatCount(run.purged.files),
        });

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

const LEVEL_WORDS = {
  ok: ['monitor.level.ok', 'fine'],
  warn: ['monitor.level.warn', 'low'],
  critical: ['monitor.level.critical', 'almost full'],
};

async function refreshMonitorStatus() {
  const status = unwrap(await api.monitorStatus(), t('monitor.label', 'Disk monitoring'));
  if (!status) return;

  const badge = $('monitor-badge');
  const line = $('monitor-status');

  $('monitor-check').disabled = !status.running;
  $('monitor-snooze-btn').disabled = !status.running;

  if (!status.running) {
    badge.textContent = t('app.off', 'Off');
    badge.className = 'card-badge';
    line.textContent = t('monitor.notRunningNote', 'Not running. Nothing of CleanDrive stays in memory.');
    return;
  }

  const readable = status.volumes.filter((v) => v.usage && v.usage.ok);
  const worst = readable.reduce((a, b) => (!a || b.usage.usedPercent > a.usage.usedPercent ? b : a), null);

  if (worst) {
    const level = LEVEL_WORDS[worst.level];
    badge.textContent = `${worst.usage.usedPercent.toFixed(0)}% · ${level ? t(level[0], level[1]) : worst.level}`;
    badge.className = `card-badge is-${worst.level}`;
  } else {
    badge.textContent = t('monitor.noReadings', 'no readings');
    badge.className = 'card-badge';
  }

  const parts = readable.map((v) =>
    t('monitor.volumeLine', '{root} {percent}% ({free} free)', {
      root: v.root,
      percent: v.usage.usedPercent.toFixed(1),
      free: formatBytes(v.usage.freeBytes),
    })
  );
  if (parts.length === 0) parts.push(t('monitor.unreadable', 'No volume could be read.'));
  if (status.snoozed) {
    parts.push(t('monitor.snoozedUntil', 'alerts snoozed until {when}', { when: formatWhen(status.snoozedUntil) }));
  }

  line.textContent = parts.join(' · ');
  $('monitor-snooze-btn').textContent = status.snoozed
    ? t('monitor.resume', 'Resume alerts')
    : t('monitor.snooze', 'Snooze');
}

$('monitor-add-volume').addEventListener('click', () => addFolderTo('monitorVolumes'));

$('monitor-check').addEventListener('click', async () => {
  $('monitor-status').textContent = t('app.checking', 'Checking…');
  const status = unwrap(await api.monitorCheck(), t('monitor.label', 'Disk monitoring'));
  if (status) await refreshMonitorStatus();
});

$('monitor-snooze-btn').addEventListener('click', async () => {
  const status = unwrap(await api.monitorStatus(), t('monitor.label', 'Disk monitoring'));
  if (!status) return;
  const next = status.snoozed ? await api.monitorResume() : await api.monitorSnooze();
  if (unwrap(next, t('monitor.label', 'Disk monitoring'))) await refreshMonitorStatus();
});

/* ---- purge -------------------------------------------------------------- */

async function refreshPurgeStatus() {
  const preview = unwrap(await api.previewPurge(), t('purge.label', 'Recycle Bin'));
  if (!preview) return;

  $('purge-now').disabled = preview.items === 0;

  if (preview.tracked === 0) {
    $('purge-status').textContent = t('purge.nothingRecorded', 'Nothing recorded yet.');
  } else if (preview.items === 0) {
    $('purge-status').textContent = t('purge.noneOldEnough', '{n} item(s) tracked, none older than {days} day(s) yet.', {
      n: formatCount(preview.tracked),
      days: preview.afterDays,
    });
  } else {
    const suffix = $('purge-enabled').checked
      ? ''
      : t('purge.switchOnHint', ' — switch on above to do this on a schedule');
    $('purge-status').textContent =
      t('purge.ready', '{n} item(s) · {size} ready to free', {
        n: formatCount(preview.items),
        size: formatBytes(preview.bytes),
      }) + suffix;
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
  const folder = unwrap(await api.pickFolder(), t('app.label.chooseFolder', 'Choose folder'));
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
  $('auto-status').textContent = t('app.saving', 'Saving…');

  // Read before saving, so the reply can be compared against what was asked
  // for. The settings layer refuses some combinations -- switching the cleanup
  // on with no folders listed is the common one -- and a save that quietly
  // returns "off" after the user ticked "on" must not be reported as "Saved".
  const requested = readAutoForm();
  const data = unwrap(await api.saveSettings(requested), t('app.label.saveSettings', 'Save settings'));
  if (!data) {
    $('auto-status').textContent = t('app.notSaved', 'Nothing was saved.');
    return;
  }
  autoDirty = false;

  applyAutoState(data);
  await refreshPurgeStatus();
  await refreshMonitorStatus();

  const saved = data.settings.autoClean;
  const problems = data.reconciled ? data.reconciled.problems : [];

  if (requested.autoClean.enabled && !saved.enabled) {
    toast(
      t('auto.saved.leftOff', 'Saved, but automatic cleanup was left off: {reason}', {
        reason:
          data.warnings.join(' ') ||
          t('auto.saved.notRunnable', 'the configuration is not runnable as it stands.'),
      }),
      true
    );
  } else if (problems.length > 0) {
    toast(t('auto.saved.taskWrong', 'Saved, but the Windows task is not right: {problems}', {
      problems: problems.join(' '),
    }), true);
  } else if (saved.enabled) {
    toast(t('auto.saved.registered', 'Saved and registered with Windows. Next run {when}.', {
      when: formatWhen(data.scheduler.nextRunAt),
    }));
  } else {
    toast(t('auto.saved.off', 'Saved. Automatic cleanup is off and its Windows task was removed.'));
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
    $('auto-status').textContent = t('auto.stage.checking', 'Checking disk usage and running apps…');
  } else if (payload.stage === 'scanning') {
    $('auto-status').textContent = t('auto.stage.scanning', 'Scanning {root}…', {
      root: elide(payload.root, 60),
    });
  } else if (payload.stage === 'deleting') {
    $('auto-status').textContent = t('auto.stage.deleting', 'Moving {n} file(s) to the Recycle Bin…', {
      n: formatCount(payload.total),
    });
  } else if (payload.stage === 'purging') {
    $('auto-status').textContent = t('auto.stage.purging', 'Emptying older recycled items…');
  }
});

async function performAutoRun(dryRun) {
  if (state.autoLists.roots.length === 0) {
    toast(t('auto.needFolder', 'Add at least one folder first.'), true);
    return;
  }

  setAutoRunning(true);

  // The run reads the saved policy, not this form. Pressing the button is a
  // statement about what is on screen, so save it first -- otherwise adding a
  // folder and clicking Preview silently tests the previous configuration and
  // reports a result for something the user is no longer looking at.
  $('auto-status').textContent = t('auto.savingSettings', 'Saving settings…');
  const saved = unwrap(await api.saveSettings(readAutoForm()), t('app.label.saveSettings', 'Save settings'));
  if (!saved) {
    setAutoRunning(false);
    return;
  }
  applyAutoState(saved);

  $('auto-status').textContent = dryRun
    ? t('auto.workingOut', 'Working out what would go…')
    : t('auto.running', 'Running cleanup…');

  const data = unwrap(await api.runAutoClean({ dryRun }), t('auto.label', 'Cleanup'));
  setAutoRunning(false);

  if (!data) {
    $('auto-status').textContent = t('auto.failed', 'Cleanup failed.');
    return;
  }

  applyAutoState(data.state);
  await refreshPurgeStatus();
  renderRunResult(data.run);

  const run = data.run;
  if (run.outcome === 'dry-run') {
    toast(t('auto.toast.dryRun', '{n} file(s), {size} would be moved.', {
      n: formatCount(run.selected.files),
      size: formatBytes(run.selected.bytes),
    }));
  } else if (run.outcome === 'skipped' || run.outcome === 'cancelled') {
    toast(tm(run.reason) || t('auto.toast.nothingDone', 'Nothing was done.'));
  } else {
    toast(t('auto.toast.moved', 'Moved {n} file(s) to the Recycle Bin.', {
      n: formatCount(run.trashed.files),
    }));
  }
}

$('auto-preview').addEventListener('click', () => performAutoRun(true));
$('auto-run').addEventListener('click', () => performAutoRun(false));
$('auto-cancel').addEventListener('click', () => api.cancelAutoClean());

$('purge-now').addEventListener('click', async () => {
  const result = unwrap(await api.purgeNow(), t('purge.label', 'Recycle Bin'));
  if (!result) return;

  await refreshPurgeStatus();
  if (result.cancelled || result.purged === 0) {
    toast(t('purge.nothingDeleted', 'Nothing was permanently deleted.'));
  } else {
    toast(t('purge.deleted', 'Permanently deleted {n} item(s), freeing {size}.', {
      n: formatCount(result.purged),
      size: formatBytes(result.bytes),
    }));
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
  const data = unwrap(await api.getSettings(), t('app.label.settings', 'Settings'));
  if (data) applyAutoState(data);

  const usage = unwrap(await api.diskUsage(null), t('app.label.diskUsage', 'Disk usage'));
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
      ? t('auto.scheduled.report', 'Scheduled report finished: {n} file(s) would be moved.', {
          n: formatCount(run.selected.files),
        })
      : run.outcome === 'skipped'
        ? t('auto.scheduled.skipped', 'Scheduled cleanup skipped: {reason}', { reason: tm(run.reason) })
        : t('auto.scheduled.moved', 'Scheduled cleanup moved {n} file(s) to the Recycle Bin.', {
            n: formatCount(run.trashed.files),
          })
  );
});

// Cheap belt to the watcher's braces: if the watch ever fails to start, opening
// the tab still shows current figures.
for (const tab of document.querySelectorAll('.tab[data-tab="auto"]')) {
  tab.addEventListener('click', () => {
    if (!autoDirty) refreshAutoState({ silent: true });
    // Opening the tab is the moment to spend a second asking Windows what it
    // actually holds. Not on every refresh: the file watcher can fire this tab
    // several times during one background run.
    refreshTaskStatus({ quiet: true });
  });
}

refreshAutoState();

onLanguageChange(() => {
  // The whole tab is drawn from `state.auto`, so re-applying it is both the
  // simplest redraw and the one least likely to miss a corner.
  if (state.auto) applyAutoState(state.auto);
  refreshPurgeStatus();
  refreshMonitorStatus();
  refreshTaskStatus({ quiet: true });
});
