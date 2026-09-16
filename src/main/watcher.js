'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

/**
 * Telling an open window that something changed underneath it.
 *
 * The scheduled cleanup runs in a *separate process*. It writes its result to
 * the run log, updates the history and possibly the trash ledger, and exits —
 * and a window that happened to be open at the time knows none of it, because
 * it read all of that once at startup.
 *
 * That produced the worst failure mode this app can have. The 02:00 run fired
 * correctly, logged 122 files, returned success — and the open window went on
 * displaying the previous evening's figures, so the feature looked broken while
 * working perfectly. An app whose whole pitch is not overstating what it did
 * cannot also understate it.
 *
 * So the user-data directory is watched, and any change to a file the UI draws
 * from is announced. The directory is watched rather than the individual files
 * because every writer here saves to a temporary name and renames it into
 * place: a watch on the target path stops firing the moment it is replaced.
 */

const WATCHED = new Set(['settings.json', 'autoclean-log.json', 'history.json', 'trash-ledger.json']);

// Long enough to coalesce the several writes one run produces, short enough
// that the window updates while the user is still looking at it.
const DEBOUNCE_MS = 400;

let watcher = null;
let timer = null;
let pending = new Set();

function flush() {
  timer = null;
  const files = [...pending];
  pending = new Set();
  if (files.length === 0) return;

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('app:data-changed', { files });
    }
  }
}

/** Begin watching. Safe to call twice; failure is not fatal. */
function start() {
  if (watcher) return true;

  const dir = app.getPath('userData');

  try {
    watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename) return;
      const name = path.basename(String(filename));
      if (!WATCHED.has(name)) return;

      pending.add(name);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    });

    // A watcher that dies must not take the app with it. Losing live updates
    // is a degraded window, not a broken one.
    watcher.on('error', (err) => {
      console.error('[watch] stopped:', err.message);
      stop();
    });

    return true;
  } catch (err) {
    console.error('[watch] could not start:', err.message);
    watcher = null;
    return false;
  }
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = new Set();
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // Already gone.
    }
    watcher = null;
  }
}

function running() {
  return watcher !== null;
}

module.exports = { start, stop, running, WATCHED, DEBOUNCE_MS };
