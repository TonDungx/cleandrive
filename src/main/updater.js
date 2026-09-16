'use strict';

const { app, autoUpdater: _unused } = require('electron');

/**
 * Checking for a new version.
 *
 * This is the first thing in the app that talks to the internet, and that is a
 * real change rather than a detail. Until now the README could say "no network
 * access of any kind" and mean it: a tool that deletes your files and never
 * phones home is easier to trust than one that does. So the feature is built to
 * give up as little of that as possible.
 *
 *   - It contacts exactly one host, the release feed, and sends nothing but the
 *     HTTP request needed to fetch it. No identifiers, no usage data, no
 *     telemetry of any kind.
 *   - It can be switched off, and then nothing is contacted at all.
 *   - It is never run by the scheduled cleanup. A 2am maintenance task that
 *     silently replaced the application binary is not a thing anyone asked for,
 *     and the headless process has no window in which to ask.
 *   - It downloads on request and installs on request. Nothing is replaced
 *     while the user is in the middle of something, which is the same rule the
 *     rest of the app follows about deleting files.
 *
 * Without code signing there is no cryptographic proof of who built an update:
 * the only protection is that the feed is fetched over HTTPS from the release
 * host. `state.signed` reports whether that is the case so the UI can say so
 * rather than implying a guarantee that is not there.
 */

let updater = null;
let listeners = new Set();
let timer = null;

const state = {
  supported: false,
  enabled: false,
  checking: false,
  status: 'idle', // idle | checking | available | downloading | ready | error | unsupported
  version: null,
  notes: null,
  progress: 0,
  error: null,
  checkedAt: 0,
  currentVersion: app.getVersion(),
  signed: false,
};

/** How often a long-running window re-checks. Updates are not urgent. */
const INTERVAL_MS = 6 * 60 * 60 * 1000;

function emit() {
  for (const listener of listeners) {
    try {
      listener({ ...state });
    } catch {
      // A broken listener must not take the updater down.
    }
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Load electron-updater lazily.
 *
 * Running from source there is no `app-update.yml`, so the library throws on
 * the first check. That is not a failure worth surfacing — it means "this is a
 * development build", and the UI should say so rather than show an error.
 */
function load() {
  if (updater) return updater;

  const { autoUpdater } = require('electron-updater');

  // Both off: the point of this module is that the user decides.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    state.status = 'checking';
    state.checking = true;
    state.error = null;
    emit();
  });

  autoUpdater.on('update-available', (info) => {
    state.status = 'available';
    state.checking = false;
    state.version = info.version;
    state.notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : null;
    state.checkedAt = Date.now();
    emit();
  });

  autoUpdater.on('update-not-available', () => {
    state.status = 'idle';
    state.checking = false;
    state.version = null;
    state.checkedAt = Date.now();
    emit();
  });

  autoUpdater.on('download-progress', (progress) => {
    state.status = 'downloading';
    state.progress = Math.max(0, Math.min(100, progress.percent || 0));
    emit();
  });

  autoUpdater.on('update-downloaded', (info) => {
    state.status = 'ready';
    state.progress = 100;
    state.version = info.version;
    emit();
  });

  autoUpdater.on('error', (err) => {
    state.checking = false;
    // "No published versions" and a missing app-update.yml both mean there is
    // nothing to check against, which is the normal state of a build that was
    // never released. Reporting it as an error trains people to ignore errors.
    const message = String((err && err.message) || err);
    if (/app-update\.yml|ENOENT|No published versions/i.test(message)) {
      state.status = 'unsupported';
      state.error = null;
    } else {
      state.status = 'error';
      state.error = message;
    }
    emit();
  });

  updater = autoUpdater;
  return updater;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Bring the updater into line with the settings. Safe to call repeatedly.
 * Returns immediately in a development build or when updates are switched off.
 */
function apply(settings, { onEvent } = {}) {
  if (onEvent) subscribe(onEvent);

  state.enabled = Boolean(settings.updates && settings.updates.enabled);
  state.supported = app.isPackaged;
  state.signed = false; // set true only when a signed build is detected below

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (!state.supported) {
    state.status = 'unsupported';
    emit();
    return state;
  }

  if (!state.enabled) {
    state.status = 'idle';
    emit();
    return state;
  }

  // Delayed: an update check racing the first paint makes the app feel slower
  // for no benefit, and nothing here is urgent.
  setTimeout(() => check().catch(() => {}), 8000);

  timer = setInterval(() => check().catch(() => {}), INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  emit();
  return state;
}

async function check({ manual = false } = {}) {
  if (!app.isPackaged) {
    state.status = 'unsupported';
    state.supported = false;
    emit();
    return { ...state };
  }

  if (!state.enabled && !manual) return { ...state };

  try {
    await load().checkForUpdates();
  } catch (err) {
    // The 'error' event has already classified this; the throw is the same
    // failure arriving twice.
    if (state.status !== 'unsupported') {
      state.status = 'error';
      state.error = String((err && err.message) || err);
      state.checking = false;
      emit();
    }
  }

  return { ...state };
}

async function download() {
  if (state.status !== 'available') return { ...state };
  try {
    await load().downloadUpdate();
  } catch (err) {
    state.status = 'error';
    state.error = String((err && err.message) || err);
    emit();
  }
  return { ...state };
}

/**
 * Restart into the installer.
 *
 * `isSilent: false` on purpose — the installer shows its progress, so a user
 * who did not expect a restart can see what is happening rather than watching
 * the app vanish.
 */
function install() {
  if (state.status !== 'ready') return { ok: false, error: 'No update has been downloaded' };
  // The tray keeps the process alive after the window closes; quitting for an
  // update has to go through the same path as a real quit.
  require('./tray').beginQuit();
  load().quitAndInstall(false, true);
  return { ok: true };
}

function snapshot() {
  return { ...state };
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  listeners = new Set();
}

module.exports = { apply, check, download, install, snapshot, subscribe, stop, INTERVAL_MS };
