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
  // Known apps' caches (D4): each taken only while that app is closed.
  'app.chrome': ['category.app.chrome', 'Google Chrome — cache'],
  'app.edge': ['category.app.edge', 'Microsoft Edge — cache'],
  'app.teams': ['category.app.teams', 'Microsoft Teams — cache'],
  'app.discord': ['category.app.discord', 'Discord — cache'],
  'app.zoom': ['category.app.zoom', 'Zoom — cache'],
  'app.figma': ['category.app.figma', 'Figma — cache'],
  'app.zalo': ['category.app.zalo', 'Zalo — cache'],
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
  const rows = [];

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'path-empty';
    empty.textContent = emptyText;
    rows.push(empty);
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
    rows.push(row);
  }
  replaceChildrenIfChanged(el, rows);
}

function renderAutoLists() {
  renderPathList($('auto-roots'), 'roots', t('auto.roots.empty', 'No folders yet — automatic cleanup will not run.'));
  renderPathList($('auto-whitelist'), 'whitelist', t('auto.whitelist.empty', 'No exclusions. System locations are still protected.'));
  renderPathList($('auto-skip'), 'skipIfRunning', t('auto.skip.empty', 'Nothing listed — the cleanup runs whatever is open.'), true);
  renderPathList($('monitor-volumes'), 'monitorVolumes', t('monitor.volumes.empty', 'None listed — your home drive is watched by default.'));
  // The rows were just made again, without their padlocks (H2).
  if (state.auto) applyManaged(state.auto);
}

function markAutoDirty() {
  autoDirty = true;
  setText($('auto-status'), t('auto.unsaved', 'Unsaved changes.'));
}

/* ---- form <-> settings -------------------------------------------------- */

function buildCategoryChecks(selected) {
  const host = $('auto-categories');

  // Built once, then only ticked and relabelled. Rebuilding them on every
  // refresh took the box the keyboard was on out of the page.
  const keys = Object.keys(CATEGORY_LABELS);
  const boxes = [...host.querySelectorAll('input[type=checkbox]')];
  if (boxes.length === keys.length && boxes.every((box, i) => box.dataset.category === keys[i])) {
    for (const box of boxes) {
      const [labelKey, labelEnglish] = CATEGORY_LABELS[box.dataset.category];
      box.checked = selected.includes(box.dataset.category);
      setText(box.nextElementSibling, t(labelKey, labelEnglish));
    }
    return;
  }

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

/** The categories ticked on screen, which are not the saved ones while unsaved. */
function checkedCategories() {
  const boxes = document.querySelectorAll('#auto-categories input[type=checkbox]');
  return [...boxes].filter((box) => box.checked).map((box) => box.dataset.category);
}

/* ---- profiles (G4) ------------------------------------------------------ */

/**
 * Which profile the form is editing.
 *
 * The screen shows one policy at a time, because a policy is twenty controls
 * and eight of them side by side is the wall of filters the Photos screen was
 * rejected for. The list above picks which one; everything below is that one.
 */
let selectedProfileId = null;

function profilesIn(data) {
  const auto = data && data.settings ? data.settings.autoClean : null;
  return auto && Array.isArray(auto.profiles) ? auto.profiles : [];
}

/**
 * The profile on screen, from the reply.
 *
 * Falls back to the first rather than to nothing: a profile can be removed
 * from another window, or by a hand-edited file, and a screen that answers
 * `undefined` for "what am I editing" draws nothing at all.
 */
function currentProfile(data) {
  const list = profilesIn(data);
  if (list.length === 0) return null;
  const found = list.find((p) => p.id === selectedProfileId);
  if (found) return found;
  selectedProfileId = list[0].id;
  return list[0];
}

/**
 * The profile on screen, never null.
 *
 * The settings layer always yields at least one profile, so this is only ever
 * reached before the first reply has arrived -- but the form reads
 * `auto.schedule.kind` without asking, and a screen that throws while drawing
 * shows nothing at all.
 */
const NO_PROFILE = Object.freeze({
  id: null,
  name: null,
  enabled: false,
  dryRun: true,
  action: 'recycle',
  deleteOriginal: false,
  schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1, everyMinutes: 15, catchUpAtLogon: false },
  roots: [],
  whitelist: [],
  skipIfRunning: [],
  categories: [],
  minAgeDays: 180,
  minDiskUsedPercent: 0,
  maxItemsPerRun: 20000,
  notify: true,
});

const profileOnScreen = (data) => currentProfile(data) || NO_PROFILE;

/** The OS's view of the profile on screen, from the per-profile task list. */
function taskOf(data, profile) {
  const list = data && data.tasks && Array.isArray(data.tasks.profiles) ? data.tasks.profiles : [];
  return list.find((p) => p.profileId === profile.id) || (data && data.tasks ? data.tasks.cleanup : null) || null;
}

/**
 * This profile's own last run.
 *
 * The run log is one list in time order, shared by every profile, so "the last
 * run" and "the last run of what is on screen" are different questions. The
 * main process answers the second one; `lastRun` is kept for the first.
 */
function lastRunOf(data, profile) {
  const byProfile = data && data.lastRunByProfile ? data.lastRunByProfile : null;
  if (byProfile && profile.id && profile.id in byProfile) return byProfile[profile.id];
  return data ? data.lastRun : null;
}

/** What to call a profile that has not been named. */
function profileTitle(profile, index) {
  // The organisation's (H2): never named by the person, and never theirs.
  if (profile.managed) return t('auto.profile.managed', 'Your organisation’s profile');
  if (profile.name) return profile.name;
  return index === 0
    ? t('auto.profile.first', 'Automatic cleanup')
    : t('auto.profile.nth', 'Profile {n}', { n: index + 1 });
}

/**
 * A profile that would act, on a computer the organisation set to view only
 * (H2): switched on, and still nothing will happen. Saying "On" in green
 * would be the screen claiming a cleanup that is refused every time.
 */
function heldByPolicy(profile) {
  const m = state.auto && state.auto.settings ? state.auto.settings.managed : null;
  return Boolean(m && m.viewOnly && profile.enabled && !profile.dryRun);
}

/** A word for what a profile is doing, for its row in the list. */
function profileStateWord(profile) {
  if (!profile.enabled) return t('app.off', 'Off');
  if (heldByPolicy(profile)) return t('auto.state.held', 'Held: view only');
  return profile.dryRun ? t('auto.state.reportOnly', 'Report only') : t('app.on', 'On');
}

function renderProfileList(data) {
  const list = profilesIn(data);
  const holder = $('auto-profiles');
  const current = currentProfile(data);
  const limits = data.profileLimits || { allowed: 1, max: 1 };

  const rows = list.map((profile, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-chip${current && profile.id === current.id ? ' is-current' : ''}`;
    button.dataset.profileId = profile.id;
    button.setAttribute('aria-pressed', String(Boolean(current && profile.id === current.id)));

    const name = document.createElement('span');
    name.className = 'profile-chip-name';
    name.textContent = profileTitle(profile, index);

    const state = document.createElement('span');
    state.className = `profile-chip-state${profile.enabled && !profile.dryRun && !heldByPolicy(profile) ? ' is-on' : ''}${
      profile.enabled && profile.dryRun ? ' is-dry' : ''
    }`;
    state.textContent = profileStateWord(profile);

    if (profile.managed) {
      button.classList.add('is-managed-profile');
      button.prepend(Managed.lockIcon());
    }
    button.append(name, state);
    button.addEventListener('click', () => selectProfile(profile.id));
    return button;
  });

  replaceChildrenIfChanged(holder, rows, list.map((p, i) => `${p.id}:${profileTitle(p, i)}:${profileStateWord(p)}:${current && p.id === current.id}`).join('|'));

  // Adding is refused out loud rather than by a button that does nothing.
  // The organisation's profile (H2) is not the person's and is not counted.
  const own = list.filter((p) => !p.managed);
  const atLimit = own.length >= Math.min(limits.allowed, limits.max);
  $('auto-profile-add').disabled = atLimit;
  $('auto-profile-add').title = atLimit
    ? limits.allowed <= 1
      ? t('auto.profile.locked', 'More than one profile is part of CleanDrive Pro.')
      : t('auto.profile.full', 'At most {n} profiles.', { n: limits.max })
    : '';
  $('auto-profile-remove').disabled = own.length <= 1 || Boolean(current && current.managed);
  $('auto-profile-name').value = current && current.name ? current.name : '';
  $('auto-profile-name').placeholder = current ? profileTitle(current, list.indexOf(current)) : '';
}

/**
 * Swap which profile the form edits.
 *
 * Unsaved edits are the user's, so switching away is refused while they are on
 * screen rather than throwing them away silently.
 */
async function selectProfile(id) {
  if (id === selectedProfileId) return;
  if (autoDirty) {
    toast(t('auto.profile.unsaved', 'Save or undo the changes on screen before switching profile.'), true);
    return;
  }
  selectedProfileId = id;
  if (state.auto) applyAutoState(state.auto);
  await refreshTaskStatus({ quiet: true });
}

function readAutoForm() {
  const categories = checkedCategories();
  const current = state.auto ? currentProfile(state.auto) : null;

  return {
    // The profile the form is editing, in the shape `autoclean:saveProfile`
    // takes. `purge` and `monitor` are not a profile's business -- they are
    // the app's, and they go through `settings:save` as they always did.
    profile: {
      id: current ? current.id : null,
      name: $('auto-profile-name').value.trim() || null,
      action: $('auto-action').value,
      deleteOriginal: $('auto-delete-original').checked,
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

/**
 * Draw the tab from what the main process holds.
 *
 * `form: false` leaves the fields, tick boxes and lists as they are on screen
 * and redraws only their words and everything around them. Every background
 * refresh passes it while the form holds unsaved edits: they used to be
 * overwritten by the next disk-monitor reading, a minute after being typed,
 * committed or not.
 */
function applyAutoState(data, { form = true } = {}) {
  state.auto = data;
  const auto = profileOnScreen(data);

  renderProfileList(data);
  if (form) fillAutoForm(data);
  buildCategoryChecks(form ? auto.categories : checkedCategories());
  renderAutoLists();
  syncScheduleRows();

  const stateWord = profileStateWord(auto);

  setText($('astat-state'), stateWord);

  // The same word in the bar that stays on screen. The tile scrolls away; the
  // question it answers -- is any of this actually running -- does not.
  const chip = $('auto-state');
  setText(chip, stateWord);
  chip.classList.toggle('is-on', auto.enabled && !auto.dryRun && !heldByPolicy(auto));
  chip.classList.toggle('is-dry', auto.enabled && auto.dryRun);
  // The figures are about the profile on screen, not about whichever profile
  // happens to be first or ran most recently (G4).
  const task = taskOf(data, auto);
  const nextAt = task ? task.expectedNextRunAt : null;
  setText($('astat-next'), auto.enabled ? formatWhenShort(nextAt) : '–');
  $('astat-next').title = auto.enabled ? formatWhen(nextAt) : '';

  const lastRun = lastRunOf(data, auto);
  setText($('astat-last'), lastRun ? formatWhenShort(lastRun.startedAt) : t('app.never', 'Never'));
  $('astat-last').title = lastRun
    ? `${formatWhen(lastRun.startedAt)} — ${tm(lastRun.reason) || lastRun.outcome}`
    : '';

  applyAutoNotices(data);
  renderTaskFacts(data.tasks, null);

  renderRunResult(lastRun);
  renderRunHistory(data.history || []);
  setText($('auto-status'), autoDirty ? t('auto.unsaved', 'Unsaved changes.') : describeSchedule(auto));
  applyManaged(data);
}

/**
 * The organisation's hand on this screen (H2): every control it holds is
 * disabled and padlocked, with the line that says whose decision it was.
 *
 * Drawn after everything else, so whatever the rest of the tab decided about
 * a control, the policy has the last word. Released controls are switched
 * back on only where nothing but the policy turned them off.
 */
const PROFILE_CONTROLS = [
  'auto-dryrun', 'auto-action', 'auto-delete-original', 'auto-kind', 'auto-minutes', 'auto-weekday', 'auto-day',
  'auto-time', 'auto-catchup', 'auto-age', 'auto-threshold', 'auto-max', 'auto-add-root', 'auto-add-whitelist',
  'auto-add-skip', 'auto-skip-input', 'auto-profile-name',
];

function applyManaged(data) {
  const m = (data && data.settings && data.settings.managed) || {};
  const auto = profileOnScreen(data);
  const theirs = auto.managed === true;
  const off = m.automatic === 'off';
  const viewOnly = Boolean(m.viewOnly);

  for (const id of PROFILE_CONTROLS) Managed.hold($(id), theirs, { release: true });
  Managed.hold($('auto-enabled'), theirs || off, { release: true });
  // A category outside the organisation's list is unticked and held; inside
  // it, the person still chooses.
  for (const box of document.querySelectorAll('#auto-categories input[type=checkbox]')) {
    const outside = Array.isArray(m.categories) && !m.categories.includes(box.dataset.category);
    if (outside) box.checked = false;
    Managed.hold(box, theirs || outside, { release: true });
  }
  // A folder the organisation protects stays on the list, padlocked, with no
  // way to take it off.
  const protectedKeys = new Set((m.protectedFolders || []).map((p) => p.toLowerCase()));
  for (const row of document.querySelectorAll('#auto-whitelist .path-row')) {
    const text = row.querySelector('.path-text');
    const remove = row.querySelector('button');
    const isTheirs = theirs || (text && protectedKeys.has(String(text.title).toLowerCase()));
    if (remove) Managed.hold(remove, isTheirs, { release: true });
    row.classList.toggle('is-managed-row', Boolean(isTheirs));
  }
  for (const row of document.querySelectorAll('#auto-roots .path-row button, #auto-skip .path-row button')) {
    Managed.hold(row, theirs, { release: true });
  }

  // "Run cleanup now" acts; a report never does, so Preview is never held.
  const runHeld = viewOnly || off || (theirs && auto.dryRun);
  Managed.hold($('auto-run'), runHeld, { release: !autoRunning });
  for (const id of ['purge-enabled', 'purge-days']) Managed.hold($(id), viewOnly, { release: true });
  Managed.hold($('purge-now'), viewOnly);

  Managed.show('profile', theirs);
  for (const note of document.querySelectorAll('[data-managed-note="profile"]')) note.hidden = !theirs;
  Managed.show('automaticOff', off && !theirs);
  Managed.show('categories', theirs || Array.isArray(m.categories));
  Managed.show('protected', theirs || protectedKeys.size > 0);
  Managed.show('run', runHeld);
}

/** The saved settings into the fields. Only when nothing on screen is unsaved. */
function fillAutoForm(data) {
  const auto = profileOnScreen(data);

  $('auto-enabled').checked = auto.enabled;
  $('auto-dryrun').checked = auto.dryRun;
  $('auto-action').value = auto.action || 'recycle';
  $('auto-delete-original').checked = auto.deleteOriginal === true;
  syncActionRows(data);
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
}

function applyAutoNotices(data) {
  const auto = profileOnScreen(data);

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
}

function showNotice(id, text) {
  setText($(id), text);
  $(id).hidden = false;
}

function describeSchedule(auto) {
  if (!auto.enabled) return t('auto.describe.off', 'Automatic cleanup is off.');
  if (heldByPolicy(auto)) {
    return t('auto.describe.held', 'Your organisation has set this computer to view only, so this profile does not run until that is lifted.');
  }

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
    setText($('auto-schedule-note'), t(
      'auto.note.minutes',
      'For testing that the schedule really is a Windows task: it keeps running with CleanDrive ' +
        'closed and after a restart. Each run is a real cleanup with your settings, so leave it in ' +
        'report-only mode unless you mean it.'
    ));
  } else if (kind === 'monthly') {
    setText($('auto-schedule-note'), t(
      'auto.note.monthly',
      'Days run to 28 only, so a monthly cleanup fires in February too.'
    ));
  } else {
    setText($('auto-schedule-note'), t(
      'auto.note.missed',
      'A run missed because the PC was off happens at the next opportunity.'
    ));
  }
}

/**
 * What the action control shows, and what it warns about (G4).
 *
 * `quarantine` needs a folder on another drive, and until one has been chosen
 * there is nothing for the run to do but skip. Its second control is the one
 * that decides whether any space actually comes back: copying and keeping the
 * original uses *more* room overall, and the note says so in those words
 * rather than leaving the user to work it out from a figure that never moves.
 */
function syncActionRows(data) {
  const action = $('auto-action').value;
  const quarantine = action === 'quarantine';
  $('auto-delete-original-row').hidden = !quarantine;

  if (!quarantine) {
    setText($('auto-action-note'), t(
      'auto.note.recycle',
      'Files go to the Recycle Bin, which is on the same drive — no space comes back until the bin is emptied.'
    ));
    return;
  }

  const zone = data && data.settings && data.settings.quarantine ? data.settings.quarantine.zone : null;
  if (!zone) {
    setText($('auto-action-note'), t(
      'auto.note.noZone',
      'No folder has been chosen for files moved to another drive, so this profile would skip every run. ' +
        'Choose one under “Move to another drive” on the What to delete screen.'
    ));
  } else if ($('auto-delete-original').checked) {
    setText($('auto-action-note'), t(
      'auto.note.quarantineFrees',
      'Each file is copied to {zone} and the original is then deleted outright — not sent to the Recycle Bin. ' +
        'This is the only setting here that frees space on the drive being cleaned.',
      { zone }
    ));
  } else {
    setText($('auto-action-note'), t(
      'auto.note.quarantineKeeps',
      'Each file is copied to {zone} and the original is kept, so this frees nothing on the drive being ' +
        'cleaned — it uses more space overall.',
      { zone }
    ));
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
  replaceChildrenIfChanged($('task-facts'), taskFactRows(status, osInfo));

  if (!status || !status.supported) return;
  const shown = (state.auto && taskOf(state.auto, profileOnScreen(state.auto))) || status.cleanup;
  const problems = [
    ...(shown.problems || []),
    ...(status.sampler.problems || []),
  ];
  if (problems.length > 0) showNotice('task-problems', problems.join(' '));
  else $('task-problems').hidden = true;
}

function taskFactRows(status, osInfo) {
  const list = [];

  if (!status) {
    list.push(factRow(t('task.registration', 'Registration'), t('task.notCheckedYet', 'not checked yet')));
    return list;
  }

  if (!status.supported) {
    list.push(factRow(t('task.registration', 'Registration'), t('task.windowsOnly', 'Windows only')));
    return list;
  }

  // The task of the profile being edited, not of whichever profile is first
  // (G4). Without this the card described one profile's Windows entry under
  // another profile's schedule -- "these settings ask for weekly on Sunday"
  // beside a form showing monthly on the 1st.
  const cleanup = (state.auto && taskOf(state.auto, profileOnScreen(state.auto))) || status.cleanup;
  const os = osInfo || cleanup.os;

  list.push(factRow(
    t('task.registeredTask', 'Registered task'),
    cleanup.installed ? `\\${cleanup.taskPath}` : t('task.none', 'none'),
    cleanup.installed ? t('task.visibleHint', 'Visible in Task Scheduler under this name') : '',
    { name: true }
  ));

  list.push(factRow(
    t('task.matches', 'Matches these settings'),
    cleanup.installed ? (cleanup.verified ? t('app.yes', 'yes') : t('app.no', 'no')) : '–',
    cleanup.problems && cleanup.problems.length > 0 ? cleanup.problems.join(' ') : ''
  ));

  // Two rows, never one. The first version showed a single "Windows holds" row
  // that fell back to the app's own schedule when nothing was registered --
  // which is the precise confusion this card was built to remove: the screen
  // presenting an intention as though the OS had confirmed it.
  list.push(factRow(t('task.settingsAskFor', 'These settings ask for'), cleanup.description));
  list.push(factRow(
    t('task.windowsHolds', 'Windows holds'),
    cleanup.registered
      ? describeRegistered(cleanup.registered)
      : t('task.holdsNothing', 'nothing — no task is registered')
  ));

  if (os && os.error) {
    // Only the error. "Windows says last run: never" for a task Windows has
    // never heard of would be a fact about nothing, dressed as a reading.
    list.push(factRow(t('task.couldNotAsk', 'Could not ask Windows'), os.error));
  } else if (os) {
    list.push(factRow(
      t('task.lastRun', 'Windows says last run'),
      os.lastRunAt ? formatWhen(os.lastRunAt) : t('app.never.lower', 'never')
    ));
    list.push(factRow(
      t('task.nextRun', 'Windows says next run'),
      os.nextRunAt ? formatWhen(os.nextRunAt) : t('task.noneScheduled', 'none scheduled')
    ));
    list.push(factRow(
      t('task.result', 'Result of that run'),
      status.cleanup.osResult || '–',
      os.lastResult === null || os.lastResult === undefined
        ? ''
        : t('task.resultCode', 'Task Scheduler code {code}', { code: os.lastResult })
    ));
    if (os.missedRuns) list.push(factRow(t('task.missed', 'Runs missed'), String(os.missedRuns)));
    if (os.state) list.push(factRow(t('task.state', 'Task state'), os.state));
  } else {
    list.push(factRow(t('task.lastRun', 'Windows says last run'), t('task.pressCheck', 'press “Check with Windows”')));
  }

  list.push(factRow(
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

  return list;
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

  const mine = (state.auto && taskOf(state.auto, profileOnScreen(state.auto))) || status.cleanup;
  renderTaskFacts(status, mine.os);
  setText($('task-status'), status.supported
    ? mine.installed
      ? mine.verified
        ? t('task.statusExact', 'Windows holds exactly what these settings describe.')
        : t('task.statusOther', 'Windows holds something other than these settings.')
      : t('task.statusNone', 'Windows has no CleanDrive cleanup task registered.')
    : t('task.statusUnsupported', 'Scheduling is Windows only.'));
  return status;
}

$('task-check').addEventListener('click', () => refreshTaskStatus({ fresh: true }));

$('task-repair').addEventListener('click', async () => {
  $('task-status').textContent = t('task.reRegistering', 'Re-registering…');
  const result = unwrap(await api.reconcileTasks(), t('task.label', 'Windows task'));
  if (!result) return;

  // Re-registering reads the saved settings; it says nothing about the form.
  applyAutoState(result.state, { form: !autoDirty });
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

  const rows = [];

  const outcome = document.createElement('div');
  outcome.className = `result-line run-outcome-${run.outcome}`;
  const left = document.createElement('span');
  left.textContent = run.manual
    ? t('auto.result.byHand', '{when} (started by hand)', { when: formatWhen(run.startedAt) })
    : run.via === 'cli'
      ? t('auto.result.fromCli', '{when} (from the command line)', { when: formatWhen(run.startedAt) })
      : formatWhen(run.startedAt);
  const right = document.createElement('span');
  right.textContent = tm(run.reason) || run.outcome;
  outcome.append(left, right);
  rows.push(outcome);

  rows.push(resultLine(t('auto.result.scanned', 'Files scanned'), formatCount(run.scanned.files)));
  rows.push(resultLine(
    t('auto.result.selected', 'Selected'),
    `${formatCount(run.selected.files)} · ${formatBytes(run.selected.bytes)}`
  ));

  if (!run.dryRun) {
    rows.push(resultLine(
      t('auto.result.moved', 'Moved to Recycle Bin'),
      `${formatCount(run.trashed.files)} · ${formatBytes(run.trashed.bytes)}`
    ));
    rows.push(resultLine(
      t('auto.result.purged', 'Permanently removed'),
      `${formatCount(run.purged.files)} · ${formatBytes(run.purged.bytes)}`
    ));
  }

  if (run.diskBefore && run.diskAfter && run.diskBefore.ok && run.diskAfter.ok) {
    rows.push(resultLine(
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
  if (skipped.appOpen) {
    parts.push(t('auto.result.appOpen', '{n} left because their app was open', { n: formatCount(skipped.appOpen) }));
  }
  if (parts.length > 0) rows.push(resultLine(t('auto.result.leftAlone', 'Left alone'), parts.join(' · ')));

  for (const note of run.notes || []) {
    const para = document.createElement('p');
    para.className = 'result-note';
    para.textContent = tm(note);
    rows.push(para);
  }

  replaceChildrenIfChanged(body, rows);
  card.hidden = false;
}

function renderRunHistory(runs) {
  const list = $('auto-history');
  const rows = [];

  if (runs.length <= 1) {
    replaceChildrenIfChanged(list, rows);
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
    rows.push(row);
  }
  replaceChildrenIfChanged(list, rows);

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
    setText(badge, t('app.off', 'Off'));
    badge.className = 'card-badge';
    setText(line, t('monitor.notRunningNote', 'Not running. Nothing of CleanDrive stays in memory.'));
    return;
  }

  const readable = status.volumes.filter((v) => v.usage && v.usage.ok);
  const worst = readable.reduce((a, b) => (!a || b.usage.usedPercent > a.usage.usedPercent ? b : a), null);

  if (worst) {
    const level = LEVEL_WORDS[worst.level];
    setText(badge, `${worst.usage.usedPercent.toFixed(0)}% · ${level ? t(level[0], level[1]) : worst.level}`);
    badge.className = `card-badge is-${worst.level}`;
  } else {
    setText(badge, t('monitor.noReadings', 'no readings'));
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

  setText(line, parts.join(' · '));
  setText($('monitor-snooze-btn'), status.snoozed
    ? t('monitor.resume', 'Resume alerts')
    : t('monitor.snooze', 'Snooze'));
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

  $('purge-now').disabled = preview.items === 0 || Managed.viewOnly();

  if (preview.tracked === 0) {
    setText($('purge-status'), t('purge.nothingRecorded', 'Nothing recorded yet.'));
  } else if (preview.items === 0) {
    setText($('purge-status'), t('purge.noneOldEnough', '{n} item(s) tracked, none older than {days} day(s) yet.', {
      n: formatCount(preview.tracked),
      days: preview.afterDays,
    }));
  } else {
    const suffix = $('purge-enabled').checked
      ? ''
      : t('purge.switchOnHint', ' — switch on above to do this on a schedule');
    setText($('purge-status'),
      t('purge.ready', '{n} item(s) · {size} ready to free', {
        n: formatCount(preview.items),
        size: formatBytes(preview.bytes),
      }) + suffix);
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
  'auto-minutes', 'auto-catchup', 'auto-profile-name', 'auto-action', 'auto-delete-original',
  'auto-age', 'auto-threshold', 'auto-max', 'purge-enabled', 'purge-days',
  'monitor-enabled', 'monitor-close-to-tray', 'monitor-warn', 'monitor-critical',
  'monitor-interval', 'monitor-snooze',
]) {
  $(id).addEventListener('change', () => {
    if (id === 'auto-kind') syncScheduleRows();
    if (id === 'auto-action' || id === 'auto-delete-original') syncActionRows(state.auto);
    markAutoDirty();
  });
  // A number being typed is an edit before it is a change: `change` waits for
  // the field to lose focus, and a background refresh can land before that.
  $(id).addEventListener('input', markAutoDirty);
}

/* ---- adding and removing a profile (G4) --------------------------------- */

$('auto-profile-add').addEventListener('click', async () => {
  if (autoDirty) {
    toast(t('auto.profile.unsaved', 'Save or undo the changes on screen before switching profile.'), true);
    return;
  }
  const data = unwrap(await api.addAutoProfile({}), t('auto.profile.addLabel', 'Add profile'));
  if (!data) return;
  // The new one is what the form now edits, and it arrives switched off and in
  // report-only whatever the profile beside it was doing.
  selectedProfileId = data.addedId || selectedProfileId;
  applyAutoState(data);
  toast(t('auto.profile.added', 'A profile was added. It is off and in report-only until you say otherwise.'));
  await refreshTaskStatus({ quiet: true });
});

$('auto-profile-remove').addEventListener('click', async () => {
  const data = state.auto;
  const profile = data ? currentProfile(data) : null;
  if (!profile) return;

  const list = profilesIn(data);
  const name = profileTitle(profile, list.indexOf(profile));
  // Removing one takes its Windows task away with it, which is the whole point
  // -- so say that, rather than only naming the profile.
  if (!window.confirm(t(
    'auto.profile.confirmRemove',
    'Remove “{name}”? Its Windows task is removed with it, so it stops running. Nothing already deleted is affected.',
    { name }
  ))) {
    return;
  }

  const next = unwrap(await api.removeAutoProfile(profile.id), t('auto.profile.removeLabel', 'Remove profile'));
  if (!next) return;
  selectedProfileId = null;
  autoDirty = false;
  applyAutoState(next);
  toast(t('auto.profile.removed', '“{name}” was removed, and so was its Windows task.', { name }));
  await refreshTaskStatus({ quiet: true });
});

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

/**
 * Save the profile on screen, and the settings that are not a profile's.
 *
 * Two calls because they are two decisions: adding a profile has a licence to
 * check and removing one has a Windows task to take away, so profiles have
 * their own channel. The profile goes first -- it is what the button is
 * mostly about, and the second call returns the state both are then drawn
 * from.
 */
async function saveAll(requested) {
  // The organisation's profile (H2) is not saved from here; the rest is.
  const current = state.auto ? currentProfile(state.auto) : null;
  if (requested.profile.id && !(current && current.managed)) {
    const afterProfile = unwrap(
      await api.saveAutoProfile(requested.profile),
      t('app.label.saveSettings', 'Save settings')
    );
    if (!afterProfile) return null;
  }
  return unwrap(
    await api.saveSettings({ purge: requested.purge, monitor: requested.monitor }),
    t('app.label.saveSettings', 'Save settings')
  );
}

$('auto-save').addEventListener('click', async () => {
  $('auto-status').textContent = t('app.saving', 'Saving…');

  // Read before saving, so the reply can be compared against what was asked
  // for. The settings layer refuses some combinations -- switching the cleanup
  // on with no folders listed is the common one -- and a save that quietly
  // returns "off" after the user ticked "on" must not be reported as "Saved".
  const requested = readAutoForm();
  const data = await saveAll(requested);
  if (!data) {
    $('auto-status').textContent = t('app.notSaved', 'Nothing was saved.');
    return;
  }
  autoDirty = false;

  applyAutoState(data);
  await refreshPurgeStatus();
  await refreshMonitorStatus();

  const saved = currentProfile(data) || {};
  const problems = data.reconciled ? data.reconciled.problems : [];

  if (requested.profile.enabled && !saved.enabled) {
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

let autoRunning = false;

function setAutoRunning(running) {
  autoRunning = running;
  $('auto-preview').disabled = running;
  // Held by the organisation's policy (H2) or not, it is never on during a run.
  $('auto-run').disabled = running || $('auto-run').classList.contains('is-managed');
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
  const saved = await saveAll(readAutoForm());
  if (!saved) {
    setAutoRunning(false);
    return;
  }
  autoDirty = false;
  applyAutoState(saved);

  $('auto-status').textContent = dryRun
    ? t('auto.workingOut', 'Working out what would go…')
    : t('auto.running', 'Running cleanup…');

  // Which profile the button belongs to: the one on screen (G4).
  const running = currentProfile(saved);
  const data = unwrap(
    await api.runAutoClean({ dryRun, profileId: running ? running.id : null }),
    t('auto.label', 'Cleanup')
  );
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
 * `form: false` keeps what is in the fields; see applyAutoState.
 */
async function refreshAutoState({ form = true } = {}) {
  const data = unwrap(await api.getSettings(), t('app.label.settings', 'Settings'));
  if (data) applyAutoState(data, { form });
  await refreshFigures();
  return data;
}

/** The figures around the form: the disk in use, the bin, the monitor. */
async function refreshFigures() {
  const usage = unwrap(await api.diskUsage(null), t('app.label.diskUsage', 'Disk usage'));
  if (usage && usage.ok) {
    setText($('astat-disk'), `${usage.usedPercent.toFixed(0)}%`);
    $('astat-disk').title =
      `${formatBytes(usage.freeBytes)} free of ${formatBytes(usage.totalBytes)} on ${usage.root}`;
  }

  await refreshPurgeStatus();
  await refreshMonitorStatus();
}

// A run that finished in the background, announced by the main process. The
// whole point is that an open window notices without being clicked.
//
// Only what the written file can have changed is read again. The disk monitor
// writes history.json at every reading, once a minute by default, and each one
// used to redraw this whole tab -- the form, its tick boxes and its lists --
// which is what took the keyboard and Narrator somewhere empty.
api.onDataChanged(async (payload) => {
  const files = payload && Array.isArray(payload.files) ? payload.files : null;
  const wrote = (name) => !files || files.includes(name);
  if (!wrote('settings.json') && !wrote('autoclean-log.json')) {
    await refreshFigures();
    return;
  }

  const before = state.auto && state.auto.lastRun ? state.auto.lastRun.startedAt : 0;
  // Saved settings go into the fields only when it is the settings that were
  // written, and only when nothing in the fields is unsaved.
  const data = await refreshAutoState({ form: !autoDirty && wrote('settings.json') });
  if (!data || !data.lastRun || data.lastRun.startedAt === before) return;

  const run = data.lastRun;
  // The manual path reports its own result already, and so does the command
  // line -- in the terminal it was started from. Announcing either here as a
  // "Scheduled cleanup" would name something that did not happen.
  if (run.manual || run.via === 'cli') return;

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
    refreshAutoState({ form: !autoDirty });
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
  if (state.auto) applyAutoState(state.auto, { form: !autoDirty });
  refreshPurgeStatus();
  refreshMonitorStatus();
  refreshTaskStatus({ quiet: true });
});
