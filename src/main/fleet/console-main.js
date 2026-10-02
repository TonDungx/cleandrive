'use strict';

/**
 * `CleanDrive.exe --console [<folder>]` -- the organisation's view of every
 * machine that reports to a share (H3). The window, its dialogs, and the
 * handlers its preload reaches.
 *
 * A mode of the same executable, as the spec has it, so one signature covers
 * it: no server, no cloud, nothing listening. It opens one window, reads JSON
 * files, and writes only two things -- a CSV the person saves, and the
 * console's memory of each machine's seals in its own folder (console-state.js).
 *
 * It takes no single-instance lock: an administrator may have CleanDrive open
 * for their own machine, and that window and this one share nothing they
 * could fight over. It loads none of the main window's machinery -- no
 * scanner, tray, updater or task reconciliation -- which is why its handlers
 * are registered here, through the manifest's console list, rather than in
 * ipc.js (`scripts/test-ipc-manifest.js` holds both files to their lists).
 *
 * Whether this copy may open it at all (`biz.console`) is decided by main.js
 * and handed in, the way the journal is handed a sealer: nothing under fleet/
 * loads the licence.
 */

const path = require('node:path');
const fsp = require('node:fs/promises');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const manifest = require('../ipc-manifest');
const language = require('../language');
const appearance = require('../appearance');
const { ConsoleService } = require('./console');
const { ConsoleMemory } = require('./console-state');

const WINDOW_BACKGROUND = { dark: '#0c0e12', light: '#f4f5f8' };

/** The dialogs, replaceable by a harness so a screenshot run never waits on one. */
let dialogs = {
  pickFolder: (win, title) => dialog.showOpenDialog(win, { title, properties: ['openDirectory'] }),
  saveCsv: (win, title, defaultPath) => dialog.showSaveDialog(win, { title, defaultPath, filters: [{ name: 'CSV', extensions: ['csv'] }] }),
};
function setDialogsForHarness(next) {
  dialogs = { ...dialogs, ...next };
}

/**
 * Register the console's handlers, and only the console's.
 *
 * @param {ConsoleService} service
 * @param {() => BrowserWindow|null} windowOf
 */
function registerHandlers(service, windowOf) {
  const registered = new Set();
  const handle = (channel, fn) => {
    manifest.assertConsoleInvokable(channel);
    registered.add(channel);
    ipcMain.handle(channel, fn);
  };
  const guard = async (fn) => {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      console.error('[console]', err);
      return { ok: false, error: (err && err.message) || String(err) };
    }
  };

  handle('console:info', () => guard(async () => ({ ...service.info(), version: app.getVersion() })));

  handle('console:read', () => guard(() => service.read()));

  handle('console:pick', () =>
    guard(async () => {
      if (!service.allowed) return service.info();
      const picked = await dialogs.pickFolder(windowOf(), language.t('console.pick.title', 'The folder the computers write their reports to'));
      if (!picked.canceled && picked.filePaths && picked.filePaths[0]) service.setShare(picked.filePaths[0]);
      return service.info();
    })
  );

  handle('console:exportCsv', () =>
    guard(async () => {
      const body = service.csv((message) => language.render(message));
      if (!body) return { saved: false };
      const stamp = new Date().toISOString().slice(0, 10);
      const chosen = await dialogs.saveCsv(windowOf(), language.t('console.csv.title', 'Save the list as CSV'), `cleandrive-console-${stamp}.csv`);
      if (chosen.canceled || !chosen.filePath) return { saved: false };
      await fsp.writeFile(chosen.filePath, body, 'utf8');
      return { saved: true, file: chosen.filePath, bytes: Buffer.byteLength(body) };
    })
  );

  handle('console:forget', (_event, host) => guard(() => service.forget(host)));

  const missing = manifest.CONSOLE_INVOKE.filter((channel) => !registered.has(channel));
  if (missing.length > 0) throw new Error(`ipc-manifest.js lists console channels with no handler: ${missing.join(', ')}`);
}

/** The console's window, in the appearance and language the person chose for the app. */
function createWindow({ width = 1180, height = 780 } = {}) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: appearance.background(WINDOW_BACKGROUND),
    show: false,
    title: language.t('console.windowTitle', 'CleanDrive Console'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'console-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'console.html'), {
    query: { ...appearance.query(), lang: language.current() },
  });
  return win;
}

/**
 * The service, from this process's settings: the folder on the command line,
 * else the one this machine's own policy names for its report.
 */
async function serviceFor({ share, allowed }) {
  const { services } = require('../services');
  const svc = services();
  let settings = null;
  try {
    settings = await svc.settings.load();
    appearance.apply(settings.appearance);
    language.apply(settings.appearance.language);
  } catch (err) {
    console.error('[console] settings could not be read, using defaults:', err.message);
  }
  const fromPolicy = settings && settings.managed && settings.managed.report ? settings.managed.report.folder : null;
  return new ConsoleService({
    share: share || fromPolicy,
    allowed,
    memory: new ConsoleMemory(path.join(app.getPath('userData'), 'console-seen.json')),
    describeResult: (code) => require('../lib/scheduler').describeTaskResult(code),
  });
}

/** main.js's entry point for the mode. */
function start({ share, allowed }) {
  app.whenReady().then(async () => {
    const service = await serviceFor({ share, allowed });
    let win = null;
    registerHandlers(service, () => win);
    win = createWindow();
    win.on('closed', () => {
      win = null;
    });
  });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { start, registerHandlers, createWindow, serviceFor, setDialogsForHarness };
