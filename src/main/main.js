'use strict';

// Raise libuv's fs threadpool before anything touches the filesystem -- the
// scanner is stat-bound and the default of 4 is the bottleneck.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const { app, BrowserWindow, shell, nativeTheme } = require('electron');

const language = require('./language');

const isDev = process.argv.includes('--dev');

// Task Scheduler starts the same executable with this flag. There is no window
// in that mode: a cleanup that popped a window open at 02:00 would be worse
// than no cleanup at all.
const isScheduledRun = process.argv.includes('--scheduled-run');

// And with this one for the daily disk measurement the Trends tab is drawn
// from. It is a different mode rather than a second job for the cleanup task,
// because measuring a disk needs no permission to delete anything.
const isSampleOnly = process.argv.includes('--sample-only');

// The elevated helper: this same executable, started through a UAC prompt the
// user answered, to read the few things only an administrator can. It opens
// no window and answers only the fixed, read-only list in helper/ops.js.
const isHelper = process.argv.includes('--helper');

// Required lazily, inside the windowed branch. Between them these pull in the
// scanner, the duplicate finder, the tray and the updater, and the two headless
// modes need none of it -- the sampler in particular is a ~150ms process and
// loading a module graph it never calls would be most of its runtime.
let ipc = null;
let tray = null;
let updater = null;

let mainWindow = null;

// The colour the window is painted before the renderer has produced a frame.
// Getting this wrong is the flash of the wrong theme on every launch, so it is
// resolved from the same place the CSS resolves from.
const WINDOW_BACKGROUND = { dark: '#0c0e12', light: '#f4f5f8' };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    // The floor the layout is actually built for: the sidebar drops to icons,
    // the cards fall to one column, and the top bar wraps. It used to be 900,
    // which was not a statement about the layout so much as the width nobody
    // had tried going below.
    minWidth: 680,
    minHeight: 520,
    backgroundColor: nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light,
    show: false,
    title: 'CleanDrive',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // `nativeTheme.themeSource` is the single source of truth for the chosen
  // mode: the IPC layer writes it when the user picks one, and reading it back
  // here avoids main.js and ipc.js having to share a variable. The renderer
  // needs it synchronously, before its first paint, so it travels in the URL
  // rather than over IPC.
  //
  // The language travels the same way and for a sharper version of the same
  // reason: the window is written in English, so a Vietnamese user would watch
  // it translate itself if the answer arrived over IPC after the first frame.
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    query: { theme: nativeTheme.themeSource, lang: language.current() },
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // External links open in the real browser, never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // With monitoring on, closing the window hides it instead of ending the
  // process -- otherwise the alerts the user just switched on would stop the
  // moment they closed the app. With monitoring off there is nothing to keep
  // alive, and close means close exactly as it always has.
  mainWindow.on('close', (event) => {
    if (tray.isQuitting()) return;
    const status = tray.status();
    if (!status.running || !tray.shouldCloseToTray()) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    ipc.cancelAll();
    mainWindow = null;
  });
}

/**
 * Bring Windows Task Scheduler into line with the settings, at every launch.
 *
 * A Windows scheduled task stores an absolute path to an executable. Copy the
 * app to another machine, install a new version to a different folder, or just
 * move the folder, and the task survives — still pointing at the old location,
 * failing silently every week with nothing on screen to say so.
 *
 * The check is broader than it used to be, because the narrow version missed
 * the failure that actually happened: the task was *deleted* while the settings
 * still said it was on, and nothing noticed for a fortnight. So this compares
 * existence, the command, and the schedule itself, and anything it changed or
 * could not fix is handed to the window to display rather than only logged.
 *
 * @returns {Promise<object|null>} the reconciliation result, for the renderer
 */
async function reconcileTasks(settings, { settingsExisted }) {
  try {
    const result = await require('./tasks').reconcile(settings, { settingsExisted });
    for (const change of result.changes) console.log(`[tasks] ${change}`);
    for (const problem of result.problems) console.warn(`[tasks] ${problem}`);
    return result;
  } catch (err) {
    console.error('[tasks] could not be checked:', err.message);
    return null;
  }
}

/**
 * One disk measurement at launch.
 *
 * Cheap (a statfs per volume) and it means the trend keeps a pulse even on a
 * machine where the daily task was switched off — opening the app is itself an
 * observation of the disk.
 */
async function sampleAtLaunch(settings) {
  try {
    const { services } = require('./services');
    const { history } = services();
    await history.load();
    const { sample } = require('./lib/sampler');
    const result = await sample({
      history,
      settings,
      source: 'launch',
      extraTargets: [app.getPath('userData')],
    });
    if (!result.ok) console.warn('[sample] launch measurement skipped:', result.error);
  } catch (err) {
    console.error('[sample] launch measurement failed:', err.message);
  }
}

/** Show the window, creating it again if it was closed to the tray. */
function revealWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Windows shows notifications under an application identity. Without this the
// scheduled run's toast is attributed to "electron.exe", or dropped entirely.
app.setAppUserModelId('com.cleandrive.app');

if (isHelper) {
  /*
   * Like the sampler, this never waits for `app.whenReady()` -- there is no
   * window to paint -- and it takes no single-instance lock, because the app
   * that launched it is holding that lock and is the process it talks to.
   */
  require('./helper/helper-process')
    .runHelper(process.argv)
    .then((code) => app.exit(code))
    .catch(() => app.exit(1));
} else if (isSampleOnly) {
  /*
   * The measuring mode, and the only part of the app that never waits for
   * `app.whenReady()`.
   *
   * Waiting would start Chromium -- a browser process, a GPU process and a few
   * tens of megabytes -- in order to call `fs.statfs` a handful of times.
   * `app.getPath` is available before ready, so this mode does its work on the
   * Node side alone and exits. Measured: 124ms of work, and 672ms for the whole
   * packaged process -- the rest being Electron's binary starting, which no
   * mode of this app can avoid.
   */
  require('./sample-only')
    .runSample()
    .catch((err) => {
      console.error('[sample] failed:', err);
      process.exitCode = 1;
    })
    .finally(() => app.exit(process.exitCode || 0));
} else if (isScheduledRun) {
  /*
   * The scheduled run deliberately does not take the single-instance lock.
   *
   * That lock exists because two windows would fight over the hash cache. This
   * process never opens the duplicate finder, so it never touches that file --
   * and if it did take the lock, the cleanup would be cancelled outright on any
   * night the user happened to have the app open. A maintenance task that
   * silently skips itself whenever you are using the app is the worst of both
   * worlds: it looks configured and does nothing.
   */
  app.whenReady().then(async () => {
    try {
      await require('./scheduled-run').runScheduled();
    } catch (err) {
      console.error('[scheduled] run failed:', err);
      process.exitCode = 1;
    } finally {
      app.quit();
    }
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  /*
   * Someone tried to start the app again -- the shortcut, the Start menu, the
   * .exe. The lock stops the second process, so this is the only chance the
   * first one gets to answer, and the answer has to be the window.
   *
   * It used to focus the window and nothing else, which did nothing at all in
   * the state people actually hit: with monitoring on, closing the window
   * hides it, and focusing a hidden window leaves it hidden. The app was
   * running, the shortcut did nothing when clicked, and the only way back in
   * was the tray icon.
   *
   * revealWindow() is the same path the tray uses, and it covers the window
   * being hidden, minimised, or gone entirely.
   */
  app.on('second-instance', () => revealWindow());

  /*
   * The preview scheme, declared before `ready` because Electron requires it.
   *
   * It is how the window shows a PDF, a picture at full size or a video
   * without the renderer ever touching the filesystem: the main process vets a
   * file, hands back an opaque token, and serves exactly that. Only the window
   * mode registers it -- the scheduled run and the sampler have no window and
   * nothing to show.
   */
  require('./lib/preview/serve').registerScheme();

  app.whenReady().then(async () => {
    require('./lib/preview/serve').serve();

    ipc = require('./ipc');
    tray = require('./tray');
    updater = require('./updater');

    ipc.register();
    tray.configure({ window: () => mainWindow, open: revealWindow });

    // Settings are read before the window exists, not after: the chosen theme
    // decides the window's background colour, and that is chosen once, at
    // construction. Monitoring likewise has to come up with the app rather than
    // only when somebody opens the settings screen.
    let settings = null;
    let settingsExisted = true;
    try {
      const store = require('./services').services().settings;
      settings = await store.load();
      settingsExisted = store.exists;
      nativeTheme.themeSource = settings.appearance.theme;
      language.apply(settings.appearance.language);
    } catch (err) {
      console.error('[settings] could not be read, using defaults:', err);
    }

    createWindow();

    try {
      if (settings) tray.apply(settings);
    } catch (err) {
      console.error('[monitor] could not start:', err);
    }

    if (settings) {
      // Both after the window exists, so anything they find can be shown. The
      // measurement is not awaited alongside the reconciliation because it
      // writes to the history file the reconciliation never touches.
      const reconciled = await reconcileTasks(settings, { settingsExisted });
      if (reconciled) ipc.noteReconciliation(reconciled);
      await sampleAtLaunch(settings);
    }

    // Whole month files past the journal's retention. Never a line within one.
    require('./services')
      .services()
      .journal.prune()
      .catch((err) => console.error('[journal] could not prune:', err.message));

    // Files quarantined longer than the days in Settings (B1): said once a
    // day at most, after the window has settled, and never acted on.
    setTimeout(() => {
      const svc = require('./services').services();
      const notify = require('./lib/notify');
      require('./lib/quarantine-notice')
        .noteExpired({
          journal: svc.journal,
          settings: svc.settings,
          stateFile: path.join(app.getPath('userData'), 'quarantine-notice.json'),
          show: (n, days) =>
            notify.show(
              {
                title: language.t('notify.quarantine.title', 'CleanDrive: files still in quarantine'),
                body: language.t('notify.quarantine.body', '{n} file(s) have been in the quarantine folder longer than {days} days. Nothing is deleted — they are listed in Restore.', {
                  n: n.toLocaleString(language.current()),
                  days,
                }),
              },
              () => revealWindow()
            ),
        })
        .catch((err) => console.error('[quarantine] could not check for expired items:', err.message));
    }, 15000).unref();

    // Deliberately only in the windowed branch. The scheduled run above never
    // reaches this line: a 2am maintenance task that silently replaced the
    // application binary is not something anyone asked for, and a headless
    // process has no window in which to ask.
    if (settings) {
      // Before apply(), so the "you have just updated" notice is ready by the
      // time the window asks for it.
      await updater.noteVersion(require('./services').services().settings);

      updater.apply(settings, {
        onEvent: (payload) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update:state', payload);
          }
        },
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else revealWindow();
    });
  });

  // Both guard on the module being loaded: these listeners are registered
  // before `whenReady` resolves, so a quit during startup would otherwise
  // reach a null.
  app.on('before-quit', () => {
    if (tray) tray.beginQuit();
  });

  app.on('window-all-closed', () => {
    if (ipc) ipc.cancelAll();
    // A running tray is the app still doing its job with no window; quitting
    // here would silently switch the alerts off.
    if (tray && tray.status().running) return;
    if (process.platform !== 'darwin') app.quit();
  });

  // Block navigation away from the bundled UI.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });
  });
}
