'use strict';

const { app, Notification } = require('electron');

const { services } = require('./services');
const { runAutoClean } = require('./lib/autoclean');
const { usageByVolume } = require('./lib/disk');
const { formatBytes } = require('./lib/util');

/**
 * The app when nobody opened it.
 *
 * Task Scheduler starts this process, it does its work with no window, and it
 * exits. There is deliberately no tray icon and no resident timer: a background
 * process that must stay alive to be useful is one the user will eventually
 * close, and the cleanup would then stop happening without ever saying so.
 */

async function runScheduled() {
  const { settings: store, ledger, runLog, history } = services();

  const settings = await store.load();
  await ledger.load();
  await runLog.load();
  await history.load();

  if (store.warnings.length > 0) {
    console.warn('[scheduled] settings warnings:', store.warnings.join('; '));
  }

  const run = await runAutoClean({ settings, ledger });
  run.warnings = store.warnings;
  await runLog.append(run);

  // A scheduled run is the most reliable sampler the app has: it happens on a
  // timetable, whether or not anyone opens the window. Even a run that deleted
  // nothing is a dated measurement of the disk, and those are what the trends
  // are fitted through.
  await recordHistory(history, settings, run);

  console.log(`[scheduled] ${run.outcome}${run.reason ? `: ${run.reason}` : ''}`);

  if (settings.autoClean.notify) notify(run);

  // Give the OS a moment to actually present the toast before the process that
  // owns it disappears; a notification from a dead process is dropped.
  return new Promise((resolve) => setTimeout(resolve, run.outcome === 'skipped' ? 0 : 2500));
}

async function recordHistory(history, settings, run) {
  try {
    const targets = [...settings.autoClean.roots, ...settings.monitor.volumes];
    const volumes = {};
    for (const [key, usage] of await usageByVolume(targets.length > 0 ? targets : [process.cwd()])) {
      volumes[key] = usage;
    }
    await history.addSnapshot({ volumes, source: 'scheduled', scan: null });

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

  if (run.outcome === 'skipped') {
    // Nothing happened and nothing is wrong; do not interrupt for that.
    return;
  } else if (run.outcome === 'dry-run') {
    title = 'CleanDrive: report only';
    body =
      `${run.selected.files.toLocaleString('en-US')} file(s), ${formatBytes(run.selected.bytes)} would be ` +
      'moved to the Recycle Bin. Nothing was deleted — automatic cleanup is still in report-only mode.';
  } else if (run.trashed.files === 0) {
    title = 'CleanDrive: nothing to clean';
    body = run.reason || 'No files matched the cleanup rules.';
  } else {
    title = 'CleanDrive: cleanup finished';
    const moved = `Moved ${run.trashed.files.toLocaleString('en-US')} file(s) (${formatBytes(run.trashed.bytes)}) to the Recycle Bin.`;
    const freed =
      run.purged.files > 0
        ? ` ${formatBytes(run.purged.bytes)} of older items was permanently removed, so that space is now free.`
        : ' No disk space is free yet — the Recycle Bin is on the same disk.';
    body = moved + freed;
  }

  const toast = new Notification({ title, body, silent: false });
  toast.on('click', () => app.focus());
  toast.show();
}

module.exports = { runScheduled };
