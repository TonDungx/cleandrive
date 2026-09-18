'use strict';

const os = require('node:os');

const { usageByVolume } = require('./disk');

/**
 * One dated measurement of the disk.
 *
 * ## Why this file exists
 *
 * The Trends tab was drawing a chart of nothing, and the reason was not a bug
 * in the chart. Snapshots were only ever recorded when the user ran a scan,
 * ran a cleanup, or emptied part of the Recycle Bin — all things a person does
 * when they feel like it. A series built from those is a record of the user's
 * mood, not of the disk, and if they never enable automatic cleanup and only
 * scan when something feels slow, the series is three points in six hours.
 *
 * Fitting a line needs measurements taken on a timetable, by something that
 * does not depend on anyone opening a window. So a measurement is taken:
 *
 *   - once a day by its own Task Scheduler entry, whether or not the app is
 *     running (`--sample-only`, ~150ms, no window, no Chromium, deletes
 *     nothing);
 *   - when the app starts;
 *   - on each disk-monitor tick, for people who leave monitoring on;
 *   - when the user presses "Measure now".
 *
 * All four paths call this one function, so there is a single definition of
 * what a measurement is. The history store itself collapses samples taken
 * within half an hour of each other, so the dense paths cannot flood the
 * series.
 */

/**
 * Which volumes get measured.
 *
 * Deliberately *not* "every drive letter". Probing A: through Z: would spin up
 * optical and removable media and would add a row to the user's chart for a
 * USB stick they plugged in once. The set is instead everything the app has a
 * reason to know about: where the user's files are, what they configured for
 * cleanup, what they asked to be warned about, and anything already in the
 * history — so the series a chart is drawn from keeps being extended rather
 * than restarted.
 *
 * @returns {string[]} paths, one per volume; `usageByVolume` collapses them
 */
function volumeTargets({ settings, history, extraTargets = [] } = {}) {
  const targets = [...extraTargets, os.homedir()];

  if (settings) {
    if (settings.monitor && Array.isArray(settings.monitor.volumes)) targets.push(...settings.monitor.volumes);
    if (settings.autoClean && Array.isArray(settings.autoClean.roots)) targets.push(...settings.autoClean.roots);
  }

  // Keeps a drive in the series after it has been removed from the settings.
  // Dropping it would leave a chart that silently stops half way along.
  if (history && typeof history.volumeRoots === 'function') targets.push(...history.volumeRoots());

  return targets.filter((target) => typeof target === 'string' && target.trim() !== '');
}

/**
 * Measure and record.
 *
 * Never throws: a measurement is a nicety, and the two callers that matter
 * (app start and the daily task) must not fail because a drive was unplugged.
 *
 * @param {object} options
 * @param {import('./history').History} options.history
 * @param {object} [options.settings]
 * @param {string} [options.source]  'launch' | 'daily' | 'monitor' | 'manual'
 * @param {string[]} [options.extraTargets]
 * @returns {Promise<{ok: boolean, recorded: boolean, volumes: object,
 *   at: number|null, coalesced: boolean, error?: string}>}
 */
async function sample({ history, settings, source = 'launch', extraTargets = [] }) {
  try {
    await history.ensureLoaded();

    const before = history.snapshots.length;
    const volumes = {};
    for (const [key, usage] of await usageByVolume(volumeTargets({ settings, history, extraTargets }))) {
      if (usage && usage.ok) volumes[key] = usage;
    }

    if (Object.keys(volumes).length === 0) {
      return { ok: false, recorded: false, volumes: {}, at: null, coalesced: false, error: 'No volume could be read' };
    }

    const entry = await history.addSnapshot({ volumes, source, scan: null });

    return {
      ok: true,
      recorded: entry !== null,
      volumes,
      at: entry ? entry.at : null,
      // The store replaced the previous point instead of appending, because
      // that one is less than half an hour old. Worth reporting rather than
      // hiding: a user pressing "Measure now" twice should be told why the
      // count did not move.
      coalesced: entry !== null && history.snapshots.length === before,
    };
  } catch (err) {
    return { ok: false, recorded: false, volumes: {}, at: null, coalesced: false, error: err.message };
  }
}

module.exports = { sample, volumeTargets };
