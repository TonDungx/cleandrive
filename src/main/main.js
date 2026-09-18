'use strict';

// Raise libuv's fs threadpool before anything touches the filesystem -- the
// scanner is stat-bound and the default of 4 is the bottleneck.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const { app, BrowserWindow, shell, nativeTheme } = require('electron');

const ipc = require('./ipc');
const tray = require('./tray');
const updater = require('./updater');

const isDev = process.argv.includes('--dev');

// Task Scheduler starts the same executable with this flag. There is no window
// in that mode: a cleanup that popped a window open at 02:00 would be worse
// than no cleanup at all.
const isScheduledRun = process.argv.includes('--scheduled-run');

let mainWindow = null;

// The colour the window is painted before the renderer has produced a frame.
// Getting this wrong is the flash of the wrong theme on every launch, so it is
// resolved from the same place the CSS resolves from.
const WINDOW_BACKGROUND = { dark: '#0c0e12', light: '#f4f5f8' };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
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
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    query: { theme: nativeTheme.themeSource },
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
 * Re-register the scheduled task if it points somewhere the app no longer is.
 *
 * A Windows scheduled task stores an absolute path to an executable. Copy the
 * app to another machine, install a new version to a different folder, or just
 * move the folder, and the task survives — still pointing at the old location,
 * failing silently every week with nothing on screen to say so. The settings
 * screen would go on cheerfully reporting the next run time.
 *
 * So on every launch the registered command is compared against this build's
 * own, and a mismatch is repaired. This is the one piece of self-healing in the
 * app, and it earns its place: the failure it prevents is invisible.
 */
async function repairScheduledTask(settings) {
  if (process.platform !== 'win32' || !settings.autoClean.enabled) return;

  try {
    const scheduler = require('./lib/scheduler');
    const invocation = scheduler.selfInvocation(app);

    if (!(await scheduler.isInstalled())) {
      const created = await scheduler.install({ schedule: settings.autoClean.schedule, app });
      console.log(created.ok
        ? '[scheduler] task was missing and has been recreated'
        : `[scheduler] task is missing and could not be created: ${created.error}`);
      return;
    }

    if (await scheduler.isStale(invocation)) {
      const fixed = await scheduler.install({ schedule: settings.autoClean.schedule, app });
      console.log(fixed.ok
        ? `[scheduler] task pointed at a different location; repointed to ${invocation.command}`
        : `[scheduler] task is stale and could not be repaired: ${fixed.error}`);
    }
  } catch (err) {
    console.error('[scheduler] could not be checked:', err.message);
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

if (isScheduledRun) {
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
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    ipc.register();
    tray.configure({ window: () => mainWindow, open: revealWindow });

    // Settings are read before the window exists, not after: the chosen theme
    // decides the window's background colour, and that is chosen once, at
    // construction. Monitoring likewise has to come up with the app rather than
    // only when somebody opens the settings screen.
    let settings = null;
    try {
      settings = await require('./services').services().settings.load();
      nativeTheme.themeSource = settings.appearance.theme;
    } catch (err) {
      console.error('[settings] could not be read, using defaults:', err);
    }

    createWindow();

    try {
      if (settings) tray.apply(settings);
    } catch (err) {
      console.error('[monitor] could not start:', err);
    }

    if (settings) await repairScheduledTask(settings);

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

  app.on('before-quit', () => tray.beginQuit());

  app.on('window-all-closed', () => {
    ipc.cancelAll();
    // A running tray is the app still doing its job with no window; quitting
    // here would silently switch the alerts off.
    if (tray.status().running) return;
    if (process.platform !== 'darwin') app.quit();
  });

  // Block navigation away from the bundled UI.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });
  });
}
