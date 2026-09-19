'use strict';

const { app, dialog, BrowserWindow, Notification } = require('electron');

const { t } = require('./language');

/**
 * Checking for, fetching and installing a new version.
 *
 * This is the only thing in the app that talks to the internet, and that is a
 * real change rather than a detail. Until this existed the README could say "no
 * network access of any kind" and mean it: a tool that deletes your files and
 * never phones home is easier to trust. So it contacts exactly one host, the
 * release feed, sends nothing but the request needed to fetch it, can be
 * switched off entirely, and is never run by the scheduled cleanup — a 2am
 * maintenance task that replaced the application binary is not something
 * anybody asked for, and a headless process has no window in which to ask.
 *
 * ## Where the line is drawn, and where it was drawn wrong first
 *
 * The first version of this made the user click three times: check, then
 * download, then restart. The reasoning was that replacing the binary should
 * follow the same rule as deleting a file — nothing without a click. That was
 * the wrong line. Downloading costs bandwidth and some disk; it does not change
 * the application or touch anything the user owns. *Installing* is the step
 * that matters.
 *
 * So the update now downloads by itself and asks once, plainly, before it
 * installs — and the answer is remembered for the session, so declining does
 * not produce a prompt every six hours.
 *
 * Without code signing there is no cryptographic proof of who built an update.
 * The only protection is HTTPS to the release host, and the prompt says so
 * rather than implying a guarantee that is not there.
 */

let updater = null;
let listeners = new Set();
let timer = null;

/** Versions already offered in this session, so declining is not re-asked. */
const declined = new Set();
let prompting = false;

const state = {
  supported: false,
  enabled: false,
  checking: false,
  status: 'idle', // idle | checking | available | downloading | ready | error | unsupported
  version: null,
  progress: 0,
  error: null,
  checkedAt: 0,
  currentVersion: app.getVersion(),
  signed: false,
  justUpdated: null, // the version updated *from*, on the first run afterwards
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

  // Fetch without asking; install only on a yes. See the note above about
  // where the line belongs.
  autoUpdater.autoDownload = true;

  // If the prompt is declined, the update still goes on the next real quit
  // rather than being downloaded again and again and never applied.
  autoUpdater.autoInstallOnAppQuit = true;

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
    promptToInstall().catch(() => {});
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
/* the prompt                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ask once, when the download is already in hand.
 *
 * Asking at this point rather than before downloading is what makes the answer
 * cheap: yes means a restart, not a wait. Declining is remembered for the
 * session, and `autoInstallOnAppQuit` applies it the next time the app closes
 * properly, so "not now" is not a synonym for "never".
 */
async function promptToInstall() {
  if (prompting || state.status !== 'ready') return;
  if (declined.has(state.version)) return;

  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win) return; // nothing on screen to attach a dialog to

  prompting = true;
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: [t('update.install', 'Restart and install'), t('update.notNow', 'Not now')],
      defaultId: 0,
      cancelId: 1,
      title: t('update.dialog.title', 'Update ready'),
      message: t('update.dialog.message', 'CleanDrive {version} is ready to install.', {
        version: state.version,
      }),
      detail:
        t(
          'update.dialog.detail',
          'You are on {current}. The update is already downloaded — installing takes a few seconds ' +
            'and the app reopens by itself.',
          { current: state.currentVersion }
        ) +
        '\n\n' +
        t(
          'update.dialog.elevation',
          'Windows will ask for permission, because CleanDrive is installed for all users.'
        ) +
        (state.signed
          ? ''
          : '\n\n' +
            t(
              'update.detail.unsigned',
              'This build is not code-signed, so the only check on the download is that it came from ' +
                'the release server over HTTPS.'
            )) +
        '\n\n' +
        t('update.dialog.notNowNote', 'Choosing "Not now" installs it the next time you quit CleanDrive.'),
    });

    if (response === 0) install();
    else declined.add(state.version);
  } finally {
    prompting = false;
  }
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
  state.signed = false; // no certificate is configured; see the README

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

/**
 * Notice that this launch follows an update, and say so.
 *
 * The version last seen is kept in settings. When it differs from the running
 * one, the app has just been replaced — and telling the user that is the last
 * step of the sequence they started. An update that finishes in silence leaves
 * them wondering whether it worked.
 */
async function noteVersion(store) {
  try {
    const settings = await store.get();
    const previous = settings.updates.lastVersion || null;
    const current = app.getVersion();

    if (previous && previous !== current) {
      state.justUpdated = previous;
      emit();

      if (Notification.isSupported()) {
        new Notification({
          title: t('notify.updated.title', 'CleanDrive updated'),
          body: t('notify.updated.body', 'Now on version {current}, up from {previous}.', {
            current,
            previous,
          }),
          silent: true,
        }).show();
      }
    }

    if (previous !== current) await store.patch({ updates: { lastVersion: current } });
  } catch (err) {
    console.error('[updater] could not record the version:', err.message);
  }
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

/** Kept for the manual button; the automatic path downloads by itself. */
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
 * the app vanish for twenty seconds.
 */
function install() {
  if (state.status !== 'ready') return { ok: false, error: 'No update has been downloaded yet' };

  // The tray keeps the process alive after the window closes; quitting for an
  // update has to go through the same path as a real quit.
  try {
    require('./tray').beginQuit();
  } catch {
    // Tray not in play; nothing to stand down.
  }

  try {
    load().quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    state.status = 'error';
    state.error = String((err && err.message) || err);
    emit();
    return { ok: false, error: state.error };
  }
}

function snapshot() {
  return { ...state };
}

/** Clears the "you have just updated" flag once the UI has shown it. */
function acknowledgeUpdate() {
  state.justUpdated = null;
  emit();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  listeners = new Set();
}

module.exports = {
  apply,
  check,
  download,
  install,
  snapshot,
  subscribe,
  noteVersion,
  acknowledgeUpdate,
  promptToInstall,
  stop,
  INTERVAL_MS,
};
