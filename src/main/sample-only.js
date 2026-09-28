'use strict';

const { app } = require('electron');

const { services } = require('./services');
const { sample } = require('./lib/sampler');

/**
 * The app as a measuring instrument, and nothing else.
 *
 * Started by its own Task Scheduler entry once a day. It reads free space on
 * the volumes the user has a reason to care about, appends one point to the
 * history, and exits. It never deletes a file, never shows a window, and never
 * checks for an update.
 *
 * The cost was the reason to build it this way. This process deliberately does
 * not wait for `app.whenReady()`: `app.getPath` and `fs.statfs` both work
 * before the Chromium side of Electron is initialised, so there is no browser
 * process, no GPU process and no window.
 *
 * Measured: 124ms from entering this file to exiting it, and 672ms for the
 * whole packaged process from launch to exit. The rest is Electron's own binary
 * starting up, which no mode of this app can avoid. (Run from a checkout via
 * npx it is nearer two seconds, almost all of that npm's module resolution.)
 *
 * That matters because the alternative was making the Trends tab depend on the
 * cleanup task, which would have meant "you may have a chart of your disk once
 * you let the app delete files unattended".
 */
async function runSample() {
  const { settings: store, history } = services();

  // The settings are read only to decide *which* volumes to measure. Nothing
  // here acts on a policy, so a missing or corrupt file is not a problem worth
  // reporting: the defaults measure the home volume, which is the useful
  // answer anyway.
  const settings = await store.load();
  await history.load();

  const result = await sample({
    history,
    settings,
    source: 'daily',
    // Where the app's own data lives is worth a column in the chart: it is the
    // volume that fills up because of everything else on the machine.
    extraTargets: [app.getPath('userData')],
  });

  if (!result.ok) {
    console.error(`[sample] no measurement taken: ${result.error}`);
    return result;
  }

  const roots = Object.keys(result.volumes).join(', ');
  console.log(
    `[sample] ${result.coalesced ? 'updated' : 'recorded'} ${Object.keys(result.volumes).length} volume(s) ` +
      `(${roots}); ${history.snapshots.length} measurement(s) on file`
  );

  await maybeRecap({ store, history, settings });
  return result;
}

/**
 * The weekly or monthly summary (G3), if one is due.
 *
 * ## Why it rides on this process
 *
 * A periodic note has to arrive whether or not anybody opens the app, and
 * there are only two things in this app that run with it closed. The other is
 * the cleanup task, and hanging a summary on that would mean "you may have a
 * monthly note about your disk once you let the app delete files unattended"
 * -- exactly the trade the comment at the top of this file says was refused.
 * A third Task Scheduler entry would be a third thing to register, verify,
 * repair and sweep, for a job with no work of its own: it only reads what this
 * process has just written.
 *
 * ## And why the check comes first
 *
 * Showing a notification needs `app.whenReady()`, which starts Chromium -- a
 * browser process, a GPU process, tens of megabytes -- and this file exists
 * because it does not do that. So the *decision* is made on the Node side out
 * of the history that is already loaded, and Chromium is started only on the
 * one day in seven or twenty-eight when there is actually something to say.
 * Every other day this costs a comparison.
 */
async function maybeRecap({ store, history, settings }) {
  const recap = require('./recap');
  const decision = recap.consider({ history, settings });
  if (!decision.due) {
    console.log(`[sample] no summary: ${require('./language').render(decision.reason)}`);
    return null;
  }

  // Only now.
  await app.whenReady();
  require('./language').apply(settings.appearance.language);

  const words = recap.wording(decision.summary);
  const language = require('./language');
  const body = [language.render(words.body), words.named ? language.render(words.named) : null]
    .filter(Boolean)
    .join(' ');

  const shown = require('./lib/notify').show(
    { title: language.render(words.title), body, silent: true },
    // A click opens the app at the screen that explains the number, and does
    // nothing else. It never starts a cleanup -- the rule every notification
    // in this app is already held to.
    () => openChanges()
  );

  // Written down only when something was actually put on screen, so a run that
  // could not show one tries again tomorrow rather than skipping a period.
  if (shown) {
    await store.patch(recap.recordSent(Date.now()));
    console.log(`[sample] summary shown: ${body}`);
  } else {
    console.log('[sample] a summary was due but notifications are not available here');
  }

  // Long enough for Windows to take the toast; a notification from a process
  // that has exited is dropped.
  await new Promise((resolve) => setTimeout(resolve, shown ? 2500 : 0));
  return shown;
}

/** Start the app on the screen that explains the summary. */
function openChanges() {
  const { spawn } = require('node:child_process');
  const args = app.isPackaged ? ['--changes'] : [app.getAppPath(), '--changes'];
  try {
    spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    console.error('[sample] could not open the app:', err.message);
  }
}

module.exports = { runSample };
