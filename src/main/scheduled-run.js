'use strict';

const { app, Notification } = require('electron');

const { services } = require('./services');
const language = require('./language');
const { t } = language;
const { runAutoClean } = require('./lib/autoclean');
const { sample } = require('./lib/sampler');
const { formatBytes } = require('./lib/util');

/**
 * The app when nobody opened it.
 *
 * Task Scheduler starts this process, it does its work with no window, and it
 * exits. There is deliberately no tray icon and no resident timer: a background
 * process that must stay alive to be useful is one the user will eventually
 * close, and the cleanup would then stop happening without ever saying so.
 *
 * ## Every run leaves a trace
 *
 * It used to be possible for this process to fail and leave nothing behind. If
 * anything threw before `runLog.append`, the log kept yesterday's entry, the
 * Automatic tab showed yesterday's figures, and the only record that 02:00 had
 * happened at all was a number in Task Scheduler that the app never read. For
 * an app whose entire promise is not overstating what it did, "it ran and I
 * cannot tell you what happened" is the worst available outcome.
 *
 * So the run log is written on every path through this file, including the
 * failing ones, and a run that could not start is recorded as a run that could
 * not start.
 */

async function runScheduled() {
  const { settings: store, ledger, runLog, history } = services();
  const startedAt = Date.now();

  let settings = null;
  let run = null;

  try {
    settings = await store.load();
    // Before anything can be written or announced: the notification this run
    // may raise at 02:00 is read by the same person who chose the language.
    language.apply(settings.appearance.language);
    await ledger.load();
    await runLog.load();
    await history.load();

    if (store.warnings.length > 0) {
      console.warn('[scheduled] settings warnings:', store.warnings.join('; '));
    }

    if (!store.exists) {
      // Worth its own entry rather than the generic "switched off". The task is
      // registered, so somebody configured this; the file recording *what* they
      // configured is not there, and that is a fact the Automatic tab should be
      // able to show them.
      run = failedRun(
        startedAt,
        t('run.noSettings', 'No settings file was found, so there was no configuration to act on.'),
        'skipped'
      );
      run.notes.push(t('run.expectedAt', 'Expected at {path}', { path: services().settingsPath }));
    } else {
      run = await runAutoClean({ settings, ledger });
      run.warnings = store.warnings;
    }
  } catch (err) {
    console.error('[scheduled] run failed:', err);
    run = failedRun(startedAt, err && err.message ? err.message : String(err), 'error');
    process.exitCode = 1;
  }

  // Outside the try: a failure to record the failure is still worth reporting,
  // but it must not replace the original one.
  try {
    await runLog.append(run);
  } catch (err) {
    console.error('[scheduled] the run log could not be written:', err.message);
    process.exitCode = 1;
  }

  // A scheduled run is a dated measurement of the disk whatever else it did --
  // even one that deleted nothing, even one that failed. Those are the points
  // the trends are fitted through, so it is recorded on every path too.
  await recordHistory(history, settings, run);

  console.log(`[scheduled] ${run.outcome}${run.reason ? `: ${run.reason}` : ''}`);

  if (!settings || settings.autoClean.notify) notify(run);

  // Give the OS a moment to actually present the toast before the process that
  // owns it disappears; a notification from a dead process is dropped.
  return new Promise((resolve) => setTimeout(resolve, run.outcome === 'skipped' ? 0 : 2500));
}

/**
 * A run that never got as far as looking at a file, in the same shape as one
 * that did — so the log, the tab and the history do not each need a special
 * case for it.
 */
function failedRun(startedAt, reason, outcome) {
  return {
    runId: `run-${startedAt.toString(36)}`,
    startedAt,
    finishedAt: Date.now(),
    dryRun: false,
    roots: [],
    outcome,
    reason,
    scanned: { files: 0, bytes: 0, errors: 0 },
    selected: { files: 0, bytes: 0, truncated: false },
    trashed: { files: 0, bytes: 0, failed: 0 },
    purged: { files: 0, bytes: 0 },
    diskBefore: null,
    diskAfter: null,
    skipped: { category: 0, tooRecent: 0, whitelisted: 0, guarded: 0 },
    notes: [],
  };
}

async function recordHistory(history, settings, run) {
  try {
    await sample({
      history,
      settings,
      source: 'scheduled',
      extraTargets: [app.getPath('userData')],
    });

    if (run.trashed.bytes > 0 || run.purged.bytes > 0) {
      await history.addEvent({
        movedBytes: run.trashed.bytes,
        freedBytes: run.purged.bytes,
        files: run.trashed.files,
        source: 'scheduled',
      });
    }
  } catch (err) {
    console.error('[scheduled] history not recorded:', err.message);
  }
}

/**
 * The summary is worded around what is actually true after the run. Reporting
 * "freed 2.3 GB" when the files are sitting in the Recycle Bin on the same disk
 * would be the single most misleading thing this app could say, so the wording
 * distinguishes moved from freed.
 */
function notify(run) {
  if (!Notification.isSupported()) return;

  let title;
  let body;

  if (run.outcome === 'error') {
    // The one skipped-shaped outcome that does interrupt. A cleanup that could
    // not run is exactly the thing the user has no other way of finding out.
    title = t('notify.runFailed.title', 'CleanDrive: the scheduled run failed');
    body = t('notify.runFailed.body', '{reason} Open CleanDrive to see the run log.', { reason: run.reason });
  } else if (run.outcome === 'skipped') {
    // Nothing happened and nothing is wrong; do not interrupt for that.
    return;
  } else if (run.outcome === 'dry-run') {
    title = t('notify.dryRun.title', 'CleanDrive: report only');
    body = t(
      'notify.dryRun.body',
      '{n} file(s), {size} would be moved to the Recycle Bin. Nothing was deleted — automatic cleanup ' +
        'is still in report-only mode.',
      { n: run.selected.files.toLocaleString(language.current()), size: formatBytes(run.selected.bytes) }
    );
  } else if (run.trashed.files === 0) {
    title = t('notify.nothing.title', 'CleanDrive: nothing to clean');
    body = run.reason || t('notify.nothing.body', 'No files matched the cleanup rules.');
  } else {
    title = t('notify.done.title', 'CleanDrive: cleanup finished');
    const moved = t('notify.done.moved', 'Moved {n} file(s) ({size}) to the Recycle Bin.', {
      n: run.trashed.files.toLocaleString(language.current()),
      size: formatBytes(run.trashed.bytes),
    });
    const freed =
      run.purged.files > 0
        ? ' ' +
          t('notify.done.freed', '{size} of older items was permanently removed, so that space is now free.', {
            size: formatBytes(run.purged.bytes),
          })
        : ' ' + t('notify.done.notFreed', 'No disk space is free yet — the Recycle Bin is on the same disk.');
    body = moved + freed;
  }

  const toast = new Notification({ title, body, silent: false });
  toast.on('click', () => app.focus());
  toast.show();
}

module.exports = { runScheduled, failedRun };
