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
  return result;
}

module.exports = { runSample };
