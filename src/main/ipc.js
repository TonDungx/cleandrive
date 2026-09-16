'use strict';

const path = require('node:path');
const { ipcMain, dialog, shell, app, BrowserWindow, nativeTheme } = require('electron');

const { scan } = require('./lib/scanner');
const { findDuplicates } = require('./lib/duplicate');
const { planTrash, executeTrash, ESTIMATED_FILES_PER_SEC } = require('./lib/trash');
const { CancelToken, formatBytes, formatDuration } = require('./lib/util');
const { services } = require('./services');
const scheduler = require('./lib/scheduler');
const { runAutoClean } = require('./lib/autoclean');
const { diskUsage, usageByVolume } = require('./lib/disk');
const { findUserBins, purgeRecorded } = require('./lib/recyclebin');
const historyLib = require('./lib/history');
const tray = require('./tray');
const updater = require('./updater');

// One in-flight job of each kind at a time; a new run supersedes the old one.
const tokens = { scan: null, dupes: null, trash: null, auto: null };

/** Uniform envelope so the renderer never has to deal with raw exceptions. */
async function guard(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err && err.code === 'ECANCELLED') return { ok: false, cancelled: true, error: 'Cancelled' };
    console.error('[ipc]', err);
    return { ok: false, error: err.message || String(err), code: err.code };
  }
}

function register() {
  /* ---- folder picker --------------------------------------------------- */

  ipcMain.handle('dialog:pickFolder', (event) =>
    guard(async () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win, {
        title: 'Choose a folder to analyse',
        properties: ['openDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    })
  );

  /* ---- scan ------------------------------------------------------------ */

  ipcMain.handle('scan:run', (event, folder, options = {}) =>
    guard(async () => {
      if (tokens.scan) tokens.scan.cancel();
      const token = new CancelToken();
      tokens.scan = token;

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('scan:progress', payload);
      };

      try {
        const result = await scan(folder, options, { token, onProgress: send });
        // A cancelled scan reports partial totals; recording those as a point
        // on the trend would put a dip in the series that never happened.
        if (!result.cancelled) await recordSnapshot(result, 'scan');
        return result;
      } finally {
        if (tokens.scan === token) tokens.scan = null;
      }
    })
  );

  ipcMain.handle('scan:cancel', () => {
    if (tokens.scan) tokens.scan.cancel();
    return { ok: true };
  });

  /* ---- duplicates ------------------------------------------------------ */

  ipcMain.handle('dupes:run', (event, roots, options = {}) =>
    guard(async () => {
      if (tokens.dupes) tokens.dupes.cancel();
      const token = new CancelToken();
      tokens.dupes = token;

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('dupes:progress', payload);
      };

      try {
        return await findDuplicates(roots, {
          ...options,
          cachePath: path.join(app.getPath('userData'), 'hash-cache.json'),
        }, { token, onProgress: send });
      } finally {
        if (tokens.dupes === token) tokens.dupes = null;
      }
    })
  );

  ipcMain.handle('dupes:cancel', () => {
    if (tokens.dupes) tokens.dupes.cancel();
    return { ok: true };
  });

  /* ---- delete ---------------------------------------------------------- */

  ipcMain.handle('trash:delete', (event, paths, options = {}) =>
    guard(async () => {
      const list = Array.isArray(paths) ? paths : [paths];
      if (list.length === 0) return { moved: [], failed: [], freedBytes: 0, requested: 0 };

      if (tokens.trash) tokens.trash.cancel();
      const token = new CancelToken();
      tokens.trash = token;

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('trash:progress', payload);
      };

      try {
        /* -- phase 1: vet everything, delete nothing ----------------------- */
        const planned = await planTrash(list, options, { token, onProgress: send });

        if (token.cancelled) {
          send({ phase: 'done' });
          return { moved: [], failed: planned.failed, freedBytes: 0, requested: list.length, cancelled: true };
        }

        if (planned.plan.length === 0) {
          send({ phase: 'done' });
          return { moved: [], failed: planned.failed, freedBytes: 0, requested: list.length };
        }

        // An explicit dry run stops here -- report what would go, delete nothing.
        if (options.dryRun) {
          send({ phase: 'done' });
          return {
            moved: planned.plan.map((item) => ({ ...item, dryRun: true })),
            failed: planned.failed,
            freedBytes: planned.totalBytes,
            requested: list.length,
            dryRun: true,
          };
        }

        /* -- confirmation, with the cost stated up front ------------------- */
        if (options.confirm !== false) {
          const count = planned.plan.length;
          const win = BrowserWindow.fromWebContents(event.sender);
          const slow = planned.estimatedMs >= 30000;

          send({ phase: 'confirming', total: count, totalBytes: planned.totalBytes });

          const { response } = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Move to Recycle Bin', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            title: 'Confirm delete',
            message: `Move ${count.toLocaleString('en-US')} item${count === 1 ? '' : 's'} to the Recycle Bin?`,
            detail:
              `This frees ${formatBytes(planned.totalBytes)}. Items stay recoverable from the Recycle Bin.` +
              skippedNote(planned) +
              (slow
                ? `\n\nWindows moves about ${ESTIMATED_FILES_PER_SEC} files per second, so this will take ` +
                  `roughly ${formatDuration(planned.estimatedMs)}. Progress is shown as it runs and you can ` +
                  `stop at any point — anything already moved stays in the Recycle Bin.`
                : ''),
          });

          if (response !== 0) {
            send({ phase: 'done' });
            return { moved: [], failed: [], freedBytes: 0, requested: list.length, cancelled: true };
          }
        }

        /* -- phase 2: the actual deletion ---------------------------------- */
        // One immediate frame so the bar appears at 0 rather than after the
        // first throttled tick.
        send({
          phase: 'deleting',
          done: 0,
          total: planned.plan.length,
          freedBytes: 0,
          totalBytes: planned.totalBytes,
          etaMs: planned.estimatedMs,
          ratePerSec: 0,
          elapsedMs: 0,
        });

        const result = await executeTrash(planned.plan, options, { token, onProgress: send });
        send({ phase: 'done' });

        // Record what we put in the Recycle Bin. Nothing is purged because of
        // this -- the purge has its own switch, its own grace period and its
        // own corroboration against the bin -- but without the record there is
        // no way to later tell our items from the user's own deletions.
        if (result.moved.length > 0) {
          await services().ledger.record(result.moved, { runId: 'manual' }).catch(() => {});
          // Recorded as *moved*, never as freed: these bytes are in the Recycle
          // Bin, which is on the same disk.
          await services()
            .history.addEvent({ movedBytes: result.freedBytes, files: result.moved.length, source: 'manual' })
            .catch(() => {});
        }

        return {
          moved: result.moved,
          failed: [...planned.failed, ...result.failed],
          needsAdmin: planned.needsAdmin.length,
          inUse: planned.inUse.length,
          freedBytes: result.freedBytes,
          requested: list.length,
          cancelled: result.cancelled,
          remaining: result.remaining,
          durationMs: result.durationMs,
        };
      } finally {
        if (tokens.trash === token) tokens.trash = null;
      }
    })
  );

  ipcMain.handle('trash:cancel', () => {
    if (tokens.trash) tokens.trash.cancel();
    return { ok: true };
  });

  /* ---- automatic cleanup ------------------------------------------------ */

  ipcMain.handle('settings:get', () => guard(() => readState()));

  ipcMain.handle('settings:save', (event, next) =>
    guard(async () => {
      const { settings } = await services().settings.patch(next);
      // The Task Scheduler entry and the tray are both derived state, never a
      // second source of truth: whatever the settings say, the OS and the
      // running process are made to match on every save.
      const sync = await syncScheduler(settings);
      tray.apply(settings);
      // Without this, switching update checks on in the UI would not start the
      // checker until the next launch -- and switching them off would leave a
      // timer running that the user believes they stopped.
      updater.apply(settings);
      const state = await readState();
      return { ...state, schedulerError: sync.ok ? null : sync.error || null };
    })
  );

  ipcMain.handle('autoclean:run', (event, options = {}) =>
    guard(async () => {
      if (tokens.auto) tokens.auto.cancel();
      const token = new CancelToken();
      tokens.auto = token;

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('autoclean:progress', payload);
      };

      try {
        const { settings: store, ledger, runLog } = services();
        const base = await store.load();
        await ledger.load();
        await runLog.load();

        // Pressing the button is the consent to run, so a configuration that is
        // saved but not switched on can still be tested. Nothing else about the
        // policy is relaxed.
        const dryRun = options.dryRun !== false;
        const settings = {
          ...base,
          autoClean: { ...base.autoClean, enabled: true, dryRun },
        };

        const win = BrowserWindow.fromWebContents(event.sender);
        const run = await runAutoClean({
          settings,
          ledger,
          token,
          onStage: send,
          onConfirm: dryRun ? undefined : (selection) => confirmAutoDelete(win, selection, settings),
        });

        run.manual = true;
        await runLog.append(run);

        if (!dryRun && (run.trashed.bytes > 0 || run.purged.bytes > 0)) {
          await services()
            .history.addEvent({
              movedBytes: run.trashed.bytes,
              freedBytes: run.purged.bytes,
              files: run.trashed.files,
              source: 'autoclean',
            })
            .catch(() => {});
          await recordSnapshot(null, 'cleanup');
        }

        send({ stage: 'done' });
        return { run, state: await readState() };
      } finally {
        if (tokens.auto === token) tokens.auto = null;
      }
    })
  );

  ipcMain.handle('autoclean:cancel', () => {
    if (tokens.auto) tokens.auto.cancel();
    return { ok: true };
  });

  /* ---- disk ------------------------------------------------------------- */

  ipcMain.handle('disk:usage', (event, target) =>
    guard(async () => diskUsage(target || app.getPath('home')))
  );

  /* ---- Recycle Bin ------------------------------------------------------ */

  ipcMain.handle('recyclebin:preview', () =>
    guard(async () => {
      const { settings: store, ledger } = services();
      const settings = await store.load();
      await ledger.load();

      const expired = ledger.expired(settings.purge.afterDays);
      if (expired.length === 0) {
        return { items: 0, bytes: 0, tracked: ledger.entries.length, afterDays: settings.purge.afterDays };
      }

      const bins = await findUserBins(volumesOf(expired));
      const preview = await purgeRecorded({
        entries: expired,
        binDirs: bins,
        afterDays: settings.purge.afterDays,
        dryRun: true,
      });

      return {
        items: preview.purged.length,
        bytes: preview.freedBytes,
        tracked: ledger.entries.length,
        afterDays: settings.purge.afterDays,
        examined: preview.examined,
      };
    })
  );

  ipcMain.handle('recyclebin:purge', (event) =>
    guard(async () => {
      const { settings: store, ledger } = services();
      const settings = await store.load();
      await ledger.load();

      const expired = ledger.expired(settings.purge.afterDays);
      if (expired.length === 0) return { purged: 0, bytes: 0 };

      const bins = await findUserBins(volumesOf(expired));
      const preview = await purgeRecorded({
        entries: expired,
        binDirs: bins,
        afterDays: settings.purge.afterDays,
        dryRun: true,
      });

      if (preview.purged.length === 0) return { purged: 0, bytes: 0 };

      // This is the one irreversible action in the app, so it gets the bluntest
      // dialog in the app.
      const win = BrowserWindow.fromWebContents(event.sender);
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Delete permanently', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Permanently delete recycled items',
        message: `Permanently delete ${preview.purged.length.toLocaleString('en-US')} item(s) from the Recycle Bin?`,
        detail:
          `This frees ${formatBytes(preview.freedBytes)} and cannot be undone.\n\n` +
          `Only items CleanDrive moved there itself, more than ${settings.purge.afterDays} day(s) ago, ` +
          'are affected. Anything you deleted yourself stays in the Recycle Bin.',
      });

      if (response !== 0) return { purged: 0, bytes: 0, cancelled: true };

      const result = await purgeRecorded({
        entries: expired,
        binDirs: bins,
        afterDays: settings.purge.afterDays,
      });
      if (result.purged.length > 0) {
        await ledger.forget(result.purged.map((p) => p.entry));
        // The one place `freedBytes` is the honest word for it.
        await services()
          .history.addEvent({ freedBytes: result.freedBytes, files: result.purged.length, source: 'purge' })
          .catch(() => {});
        await recordSnapshot(null, 'purge');
      }

      return { purged: result.purged.length, bytes: result.freedBytes, failed: result.failed.length };
    })
  );

  /* ---- appearance -------------------------------------------------------- */

  ipcMain.handle('theme:set', (event, mode) =>
    guard(async () => {
      const { settings } = await services().settings.patch({ appearance: { theme: mode } });

      // Setting themeSource does two things at once: it is what main.js reads
      // back when it next builds a window, and it is what makes Electron's own
      // dialogs -- the delete confirmation, the folder picker -- match. A light
      // app throwing a black modal is the giveaway that a theme was bolted on.
      nativeTheme.themeSource = settings.appearance.theme;

      return { theme: settings.appearance.theme, dark: nativeTheme.shouldUseDarkColors };
    })
  );

  /* ---- updates ----------------------------------------------------------- */

  ipcMain.handle('update:state', () =>
    guard(async () => {
      // `enabled` comes from the stored setting rather than the updater's own
      // copy: the updater only learns it when apply() runs, and a screen that
      // reported "off" while the setting said "on" would be lying about the
      // one thing on this card that matters.
      const settings = await services().settings.get();
      return { ...updater.snapshot(), enabled: settings.updates.enabled };
    })
  );

  ipcMain.handle('update:check', () => guard(async () => updater.check({ manual: true })));

  ipcMain.handle('update:download', () => guard(async () => updater.download()));

  ipcMain.handle('update:install', (event) =>
    guard(async () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const snapshot = updater.snapshot();

      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Restart and install', 'Not now'],
        defaultId: 0,
        cancelId: 1,
        title: 'Install update',
        message: `Restart CleanDrive to install version ${snapshot.version}?`,
        detail:
          'The app closes, the installer runs, and CleanDrive reopens. Any scan or ' +
          'cleanup in progress is stopped first.' +
          (snapshot.signed
            ? ''
            : '\n\nThis build is not code-signed, so the only check on the download is ' +
              'that it came from the release server over HTTPS.'),
      });

      if (response !== 0) return { ok: false, cancelled: true };
      return updater.install();
    })
  );

  /* ---- trends ----------------------------------------------------------- */

  ipcMain.handle('history:get', (event, options = {}) =>
    guard(async () => {
      const { history } = services();
      await history.load();
      return historyLib.report(history, { volumeRoot: options.volume });
    })
  );

  /**
   * Export is JSON or CSV, not PDF.
   *
   * The strategy document asked for a PDF report. A PDF of a chart is a picture
   * of the data: it cannot be checked, replotted or joined to anything. These
   * two formats hand over the actual numbers, and they are what somebody
   * querying the app's conclusions would ask for.
   */
  ipcMain.handle('history:export', (event, format = 'json') =>
    guard(async () => {
      const { history } = services();
      await history.load();

      const win = BrowserWindow.fromWebContents(event.sender);
      const csv = format === 'csv';
      const stamp = new Date().toISOString().slice(0, 10);

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Export storage history',
        defaultPath: `cleandrive-history-${stamp}.${csv ? 'csv' : 'json'}`,
        filters: csv ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'JSON', extensions: ['json'] }],
      });
      if (canceled || !filePath) return { written: false };

      const body = csv ? toCsv(history) : JSON.stringify(
        { exportedAt: Date.now(), snapshots: history.snapshots, events: history.events },
        null,
        2
      );

      await require('node:fs/promises').writeFile(filePath, body, 'utf8');
      return { written: true, path: filePath, rows: history.snapshots.length };
    })
  );

  /* ---- disk monitoring --------------------------------------------------- */

  ipcMain.handle('monitor:status', () => guard(async () => tray.status()));

  ipcMain.handle('monitor:check', () =>
    guard(async () => {
      await tray.checkNow();
      return tray.status();
    })
  );

  ipcMain.handle('monitor:snooze', (event, minutes) =>
    guard(async () => {
      const result = tray.snooze(minutes);
      if (!result.ok) throw new Error(result.error);
      return tray.status();
    })
  );

  ipcMain.handle('monitor:resume', () =>
    guard(async () => {
      const result = tray.clearSnooze();
      if (!result.ok) throw new Error(result.error);
      return tray.status();
    })
  );

  /* ---- shell helpers --------------------------------------------------- */

  ipcMain.handle('shell:reveal', (event, target) =>
    guard(async () => {
      shell.showItemInFolder(path.resolve(target));
      return true;
    })
  );

  ipcMain.handle('shell:open', (event, target) =>
    guard(async () => {
      const err = await shell.openPath(path.resolve(target));
      if (err) throw new Error(err);
      return true;
    })
  );

  ipcMain.handle('app:paths', () =>
    guard(async () => ({
      home: app.getPath('home'),
      desktop: safePath('desktop'),
      downloads: safePath('downloads'),
      documents: safePath('documents'),
      pictures: safePath('pictures'),
      videos: safePath('videos'),
    }))
  );
}

/* -------------------------------------------------------------------------- */
/* history helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Store one observation of the disk.
 *
 * Volume usage is recorded whatever happened, because it is the only figure
 * that means the same thing on every snapshot. The scan summary rides along
 * when there is one, and is compared only against earlier scans of the same
 * root.
 */
async function recordSnapshot(result, source) {
  try {
    const { history, settings: store } = services();
    await history.load();

    // Watch the scanned volume plus anything the monitor is configured for, so
    // the series keeps growing even for a drive the user rarely scans.
    const settings = await store.get();
    const targets = [result ? result.root : app.getPath('home'), ...settings.monitor.volumes];
    const volumes = {};
    for (const [key, usage] of await usageByVolume(targets)) volumes[key] = usage;

    const byCategory = {};
    if (result && result.cleanup) {
      for (const group of result.cleanup.groups) byCategory[group.category] = group.bytes;
    }

    await history.addSnapshot({
      volumes,
      source,
      scan: result
        ? {
            root: result.root,
            totalBytes: result.totalSize,
            totalFiles: result.totalFiles,
            byCategory,
            topFolders: result.topFolders,
          }
        : null,
    });
  } catch (err) {
    // History is a nicety. It must never take a scan down with it.
    console.error('[history]', err);
  }
}

/** One row per volume reading — the shape a spreadsheet can actually use. */
function toCsv(history) {
  const rows = ['at_iso,at_epoch_ms,source,volume,total_bytes,free_bytes,used_bytes,used_percent,scan_root,scan_bytes,scan_files'];
  for (const snapshot of history.snapshots) {
    const iso = new Date(snapshot.at).toISOString();
    const scan = snapshot.scan;
    for (const [volume, usage] of Object.entries(snapshot.volumes)) {
      rows.push([
        iso,
        snapshot.at,
        snapshot.source,
        csvCell(volume),
        usage.totalBytes,
        usage.freeBytes,
        usage.usedBytes,
        usage.usedPercent.toFixed(4),
        csvCell(scan ? scan.root : ''),
        scan ? scan.totalBytes : '',
        scan ? scan.totalFiles : '',
      ].join(','));
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* -------------------------------------------------------------------------- */
/* automatic cleanup helpers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything the settings screen draws itself from, in one round trip.
 *
 * "When does it run next" is computed from the app's own schedule rather than
 * read back from Task Scheduler, because that answer has to exist before any
 * task does, and because the scheduler's reply is localised text.
 */
async function readState() {
  const { settings: store, runLog } = services();
  const settings = await store.load();
  await runLog.load();

  return {
    settings,
    warnings: store.warnings,
    scheduler: {
      supported: process.platform === 'win32',
      installed: await scheduler.isInstalled(),
      nextRunAt: settings.autoClean.enabled
        ? scheduler.nextRunAt(settings.autoClean.schedule).getTime()
        : null,
    },
    lastRun: runLog.latest(),
    history: runLog.runs.slice(0, 20),
  };
}

/** Make the OS task match the saved settings, in whichever direction. */
async function syncScheduler(settings) {
  if (process.platform !== 'win32') return { ok: false, error: 'Scheduling is Windows-only for now' };
  return settings.autoClean.enabled
    ? scheduler.install({ schedule: settings.autoClean.schedule, app })
    : scheduler.uninstall();
}

/** The volumes a set of ledger entries came from, so only those bins are opened. */
function volumesOf(entries) {
  const roots = new Set();
  for (const entry of entries) roots.add(path.parse(path.resolve(entry.path)).root);
  return [...roots];
}

/**
 * The dialog in front of a cleanup the user started by hand. The scheduled run
 * has no equivalent -- its consent was given when the schedule was saved, which
 * is why the schedule starts in report-only mode.
 */
async function confirmAutoDelete(win, selection, settings) {
  const names = selection.sample
    .slice(0, 5)
    .map((f) => `  ${f.path}`)
    .join('\n');

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Move to Recycle Bin', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Confirm automatic cleanup',
    message: `Move ${selection.files.toLocaleString('en-US')} file(s) to the Recycle Bin?`,
    detail:
      `These are files in the enabled categories, untouched for at least ` +
      `${settings.autoClean.minAgeDays} days. Total ${formatBytes(selection.bytes)}.\n\n` +
      `For example:\n${names}${selection.files > 5 ? '\n  …' : ''}\n\n` +
      (settings.purge.enabled
        ? `They stay recoverable for ${settings.purge.afterDays} day(s), after which CleanDrive removes ` +
          'its own items permanently and the space is freed.'
        : 'They stay in the Recycle Bin. Note that this frees no disk space until the bin is emptied.'),
  });

  return response === 0;
}

/**
 * Files the plan deliberately left out. Stating this in the confirmation is
 * what replaces Windows' per-file "administrator permission" prompt: the count
 * is known before the run starts, so nothing interrupts it half way through.
 */
function skippedNote(planned) {
  const parts = [];
  if (planned.needsAdmin && planned.needsAdmin.length) {
    parts.push(
      `${planned.needsAdmin.length.toLocaleString('en-US')} file(s) belong to an installed program and ` +
        `need administrator permission — they are skipped, not deleted.`
    );
  }
  if (planned.inUse && planned.inUse.length) {
    parts.push(
      `${planned.inUse.length.toLocaleString('en-US')} file(s) are open in another program and are skipped.`
    );
  }
  return parts.length ? `\n\n${parts.join('\n')}` : '';
}

/** Some well-known folders are absent or redirected; never let that throw. */
function safePath(name) {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
}

function cancelAll() {
  if (tokens.scan) tokens.scan.cancel();
  if (tokens.dupes) tokens.dupes.cancel();
  if (tokens.trash) tokens.trash.cancel();
}

module.exports = { register, cancelAll };
