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
const { sample, volumeTargets } = require('./lib/sampler');
const tasks = require('./tasks');
const language = require('./language');
const { t } = language;
const tray = require('./tray');
const updater = require('./updater');
const watcher = require('./watcher');

// One in-flight job of each kind at a time; a new run supersedes the old one.
const tokens = { scan: null, dupes: null, trash: null, auto: null };

/**
 * What the launch-time reconciliation found, held until a window asks.
 *
 * The check runs before the renderer has loaded, and its result is the answer
 * to "why is my schedule not running" -- so it is kept rather than logged and
 * forgotten. Cleared once the user has been shown it.
 */
let lastReconciliation = null;

/** Called by main.js after the launch reconciliation. */
function noteReconciliation(result) {
  lastReconciliation = result && (result.changes.length > 0 || result.problems.length > 0) ? result : null;
}

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
  /*
   * The language, for anything this process says outside the window.
   *
   * main.js applies it too, and earlier -- it has to, because the theme and
   * the first paint depend on it. This is the safety net for every other way
   * into these handlers: a test harness, or whatever the next entry point
   * turns out to be. Without it, tray.apply() runs here and the disk-space
   * notification comes out in English no matter what the user chose, which is
   * how a smoke test once told its own developer their disk was filling up in
   * the wrong language.
   */
  services()
    .settings.get()
    .then((settings) => language.apply(settings.appearance.language))
    .catch(() => {});

  // Started here rather than in main.js because it is part of the same job as
  // the handlers below: keeping the renderer's view of the app true. The
  // scheduled cleanup writes its result from a separate process, and without
  // this an open window shows whatever was true when it launched.
  //
  // The headless run never calls register(), so it never starts a watch it has
  // no window to notify.
  watcher.start();

  /* ---- folder picker --------------------------------------------------- */

  ipcMain.handle('dialog:pickFolder', (event) =>
    guard(async () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win, {
        title: t('dialog.chooseFolder', 'Choose a folder to analyse'),
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
            buttons: [t('dialog.moveToBin', 'Move to Recycle Bin'), t('app.cancel', 'Cancel')],
            defaultId: 1,
            cancelId: 1,
            title: t('dialog.confirmDelete.title', 'Confirm delete'),
            message: t('dialog.confirmDelete.message', 'Move {n} item(s) to the Recycle Bin?', {
              n: count.toLocaleString(language.current()),
            }),
            detail:
              t(
                'dialog.confirmDelete.detail',
                'This frees {size}. Items stay recoverable from the Recycle Bin.',
                { size: formatBytes(planned.totalBytes) }
              ) +
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
      // The Task Scheduler entries and the tray are both derived state, never a
      // second source of truth: whatever the settings say, the OS and the
      // running process are made to match on every save.
      //
      // `settingsExisted: true` is not an assumption -- patch() has just
      // written the file, so the user's intent is on disk by the time this runs.
      const reconciled = await tasks.reconcile(settings, { settingsExisted: true });
      tray.apply(settings);
      // Without this, switching update checks on in the UI would not start the
      // checker until the next launch -- and switching them off would leave a
      // timer running that the user believes they stopped.
      updater.apply(settings);
      const state = await readState();
      return { ...state, reconciled };
    })
  );

  /**
   * The OS's own account of the tasks: last run, next run, and the exit code
   * of the last run.
   *
   * Separate from `settings:get` because it costs a PowerShell call per task
   * (~1s), and the settings screen refreshes itself whenever a background run
   * writes a file. The renderer asks for this when the tab is opened or the
   * Check button is pressed, not on every repaint.
   */
  ipcMain.handle('tasks:status', (event, options = {}) =>
    guard(async () => {
      const store = services().settings;
      const settings = await store.load();
      // `fresh` skips the short cache in front of the PowerShell call. The tab
      // opening does not need to; the Check button, which the user pressed
      // precisely to get a current answer, does.
      return tasks.status(settings, {
        withOsInfo: true,
        fresh: options.fresh === true,
        settingsExisted: store.exists,
      });
    })
  );

  /** Re-check and repair, on demand, and report what changed. */
  ipcMain.handle('tasks:reconcile', () =>
    guard(async () => {
      const store = services().settings;
      const settings = await store.load();
      const reconciled = await tasks.reconcile(settings, { settingsExisted: store.exists });
      return { reconciled, state: await readState() };
    })
  );

  /**
   * Start a registered task now, through Task Scheduler itself.
   *
   * This is the button that answers "will it actually run when I am not
   * looking": the app does not do the work here, Windows starts the same
   * headless process the schedule would, and the result appears in the run log
   * the same way. Running the job in-process would prove nothing about the
   * registration.
   */
  ipcMain.handle('tasks:runNow', (event, which = 'cleanup') =>
    guard(async () => {
      const taskPath = which === 'sampler' ? scheduler.sampleTaskPath() : scheduler.cleanupTaskPath();
      if (!(await scheduler.isInstalled(taskPath))) {
        throw new Error(t('task.error.notRegistered', 'No task is registered with Windows yet — save the settings first.'));
      }
      const started = await scheduler.runNow(taskPath);
      if (!started.ok) {
        throw new Error(started.error || t('task.error.refusedStart', 'Task Scheduler refused to start the task'));
      }
      return { started: true, taskPath };
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
        buttons: [t('dialog.purge.confirm', 'Delete permanently'), t('app.cancel', 'Cancel')],
        defaultId: 1,
        cancelId: 1,
        title: t('dialog.purge.title', 'Permanently delete recycled items'),
        message: t('dialog.purge.message', 'Permanently delete {n} item(s) from the Recycle Bin?', {
          n: preview.purged.length.toLocaleString(language.current()),
        }),
        detail:
          t('dialog.purge.detail', 'This frees {size} and cannot be undone.', {
            size: formatBytes(preview.freedBytes),
          }) +
          '\n\n' +
          t(
            'dialog.purge.scope',
            'Only items CleanDrive moved there itself, more than {days} day(s) ago, are affected. ' +
              'Anything you deleted yourself stays in the Recycle Bin.',
            { days: settings.purge.afterDays }
          ),
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

  /**
   * Change the language.
   *
   * The main process changes with it, which is the part that would be easy to
   * forget: the tray menu is already built, and the confirmation dialog in
   * front of the next deletion is composed here, not in the window. A window
   * that switched to Vietnamese while the dialog asking "may I delete 2,431
   * files?" stayed English would leave the one sentence that must be
   * understood in the language the user just turned off.
   */
  ipcMain.handle('language:set', (event, preference) =>
    guard(async () => {
      const { settings } = await services().settings.patch({ appearance: { language: preference } });
      const code = language.apply(settings.appearance.language);

      // Rebuilt rather than relabelled: the menu is constructed from strings
      // when it is created, so it holds whatever language was current then.
      tray.apply(settings);

      return { preference: settings.appearance.language, language: code };
    })
  );

  /** What the window needs to draw the language control. */
  ipcMain.handle('language:get', () =>
    guard(async () => {
      const settings = await services().settings.load();
      return {
        preference: settings.appearance.language,
        language: language.current(),
        available: language.LANGUAGES,
        system: language.systemLanguages(),
      };
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

  ipcMain.handle('update:install', () => guard(async () => updater.install()));

  ipcMain.handle('update:acknowledge', () => guard(async () => {
    updater.acknowledgeUpdate();
    return updater.snapshot();
  }));

  /* ---- trends ----------------------------------------------------------- */

  ipcMain.handle('history:get', (event, options = {}) =>
    guard(async () => {
      const { history, settings: store } = services();
      await history.load();
      const settings = await store.load();

      // The chart's own answer to "how do I get data in here": what is
      // measuring the disk, when it last did, and when it will next. Without
      // this the tab could only say "no measurements yet" and leave the user to
      // guess what would produce one.
      const taskStatus = await tasks.status(settings, { withOsInfo: false, settingsExisted: store.exists });

      return {
        ...historyLib.report(history, { volumeRoot: options.volume }),
        sampling: {
          dailySample: settings.trends.dailySample,
          sampleTime: settings.trends.sampleTime,
          taskInstalled: taskStatus.sampler.installed,
          taskVerified: taskStatus.sampler.verified,
          taskProblems: taskStatus.sampler.problems || [],
          nextSampleAt: taskStatus.sampler.expectedNextRunAt,
          supported: taskStatus.supported,
          monitorRunning: tray.status().running,
        },
      };
    })
  );

  /**
   * Measure the disk now.
   *
   * The button exists so that "the chart needs measurements" is something the
   * user can act on immediately rather than a week of waiting. The history
   * store still collapses two measurements taken within half an hour of each
   * other, so pressing it repeatedly cannot manufacture a trend -- and the
   * reply says when that has happened rather than pretending a point was added.
   */
  ipcMain.handle('trends:sample', () =>
    guard(async () => {
      const { history, settings: store } = services();
      await history.load();
      const settings = await store.load();

      const result = await sample({
        history,
        settings,
        source: 'manual',
        extraTargets: [app.getPath('userData')],
      });
      if (!result.ok) throw new Error(result.error || t('trends.error.measure', 'The disk could not be measured'));

      return { ...result, snapshots: history.snapshots.length };
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
        title: t('dialog.exportHistory', 'Export storage history'),
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

    // The scanned volume plus every volume the sampler would take, so a scan
    // extends the same series the daily measurement is building rather than
    // starting a parallel one with a different set of drives in it.
    const settings = await store.get();
    const targets = volumeTargets({
      settings,
      history,
      extraTargets: result ? [result.root] : [app.getPath('userData')],
    });
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

  // The cheap half of the task status: existence and whether the registered
  // definition matches, both read from Task Scheduler. The expensive half (the
  // OS's last/next run times) is a separate call the renderer makes when the
  // tab is open.
  const taskStatus = await tasks.status(settings, { withOsInfo: false, settingsExisted: store.exists });

  const reconciliation = lastReconciliation;
  lastReconciliation = null;

  return {
    settings,
    warnings: store.warnings,
    settingsExisted: store.exists,
    settingsPath: services().settingsPath,
    // So the form can put the real floor on its own input rather than letting
    // the user type 1, save, and be quietly given 5.
    limits: { minMinutes: store.minMinutes },
    tasks: taskStatus,
    // Kept for the tab's existing wiring: the schedule the app itself would
    // compute, which is all that can be known before a task exists.
    scheduler: {
      supported: taskStatus.supported,
      installed: taskStatus.cleanup.installed,
      verified: taskStatus.cleanup.verified,
      nextRunAt: taskStatus.cleanup.expectedNextRunAt,
      description: taskStatus.cleanup.description,
    },
    reconciliation,
    lastRun: runLog.latest(),
    history: runLog.runs.slice(0, 20),
  };
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
    buttons: [t('dialog.moveToBin', 'Move to Recycle Bin'), t('app.cancel', 'Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.confirmAuto.title', 'Confirm automatic cleanup'),
    message: t('dialog.confirmAuto.message', 'Move {n} file(s) to the Recycle Bin?', {
      n: selection.files.toLocaleString(language.current()),
    }),
    detail:
      t(
        'dialog.confirmAuto.detail',
        'These are files in the enabled categories, untouched for at least {days} days. Total {size}.',
        { days: settings.autoClean.minAgeDays, size: formatBytes(selection.bytes) }
      ) +
      `\n\n${t('dialog.forExample', 'For example:')}\n${names}${selection.files > 5 ? '\n  …' : ''}\n\n` +
      (settings.purge.enabled
        ? t(
            'dialog.confirmAuto.withPurge',
            'They stay recoverable for {days} day(s), after which CleanDrive removes its own items ' +
              'permanently and the space is freed.',
            { days: settings.purge.afterDays }
          )
        : t(
            'dialog.confirmAuto.withoutPurge',
            'They stay in the Recycle Bin. Note that this frees no disk space until the bin is emptied.'
          )),
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
      t(
        'dialog.skipped.needsAdmin',
        '{n} file(s) belong to an installed program and need administrator permission — they are ' +
          'skipped, not deleted.',
        { n: planned.needsAdmin.length.toLocaleString(language.current()) }
      )
    );
  }
  if (planned.inUse && planned.inUse.length) {
    parts.push(
      t('dialog.skipped.inUse', '{n} file(s) are open in another program and are skipped.', {
        n: planned.inUse.length.toLocaleString(language.current()),
      })
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

module.exports = { register, cancelAll, noteReconciliation };
