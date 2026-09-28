'use strict';

/**
 * The weekly or monthly summary (G3).
 *
 * "September: C: grew 6.2 GB. Biggest: Downloads +1.8 GB." -- one sentence,
 * once a week or once a month, and only when there is something true to say.
 *
 * This file decides *whether* and *what*. It does no I/O, shows nothing and
 * knows nothing about Electron, so every rule below is testable without a
 * window: `scripts/test-recap.js` runs it against constructed histories.
 *
 * ## It refuses more often than it speaks
 *
 * The Trends screen already has rules for when a trend may be asserted -- at
 * least four measurements spanning at least a week -- and this uses the same
 * function rather than a second opinion, so the notification and the chart can
 * never disagree. When the rule refuses, nothing is sent. There is deliberately
 * no "open CleanDrive to see more" notification: a message whose only content
 * is that it wants attention is the thing this app is written against.
 *
 * ## What it can actually say
 *
 * The spec's example names folders inside the profile, which come from
 * comparing two scans of the same folder. That needs scans somebody started by
 * hand; the daily measurement only reads free space. So the summary is built
 * from what is really there:
 *
 *   the volume's growth        from the daily measurements -- always, when due
 *   the folders that grew      from scans of those folders, when there are two
 *
 * and it says only the parts it has.
 */

const historyLib = require('./lib/history');
const { formatBytes, displayPath } = require('./lib/util');
const { message: m } = require('../i18n');

const DAY = 24 * 60 * 60 * 1000;

/** How often, and how long the summary looks back. */
const PERIODS = Object.freeze({
  weekly: { everyMs: 7 * DAY, windowDays: 7 },
  // Not 30: a "monthly" note that arrives on the 1st and then the 31st reads
  // as broken. 28 days is four whole weeks and lands on the same weekday.
  monthly: { everyMs: 28 * DAY, windowDays: 28 },
});

const KINDS = Object.freeze(['off', ...Object.keys(PERIODS)]);

/** Folders that grew by less than this are not worth a sentence. */
const MIN_FOLDER_BYTES = 200 * 1024 * 1024;

/** How many folders the sentence names. */
const NAMED_FOLDERS = 2;

/**
 * Is a summary due, and what would it say?
 *
 * @param {object} options
 * @param {object} options.history     a loaded History
 * @param {object} options.settings    validated settings
 * @param {number} [options.now]
 * @returns {{due: boolean, reason?: object, kind?: string, summary?: object}}
 */
function consider({ history, settings, now = Date.now() }) {
  const trends = (settings && settings.trends) || {};
  const kind = PERIODS[trends.recap] ? trends.recap : 'off';
  if (kind === 'off') return { due: false, reason: m('recap.no.off', 'Periodic summaries are switched off') };

  const period = PERIODS[kind];
  const lastAt = Number.isFinite(trends.recapLastAt) ? trends.recapLastAt : 0;

  // The first one waits a whole period rather than arriving the moment it is
  // switched on: a summary of nothing is not a summary.
  if (lastAt === 0) {
    const first = firstMeasurementAt(history);
    if (!first || now - first < period.everyMs) {
      return { due: false, reason: m('recap.no.tooSoon', 'Not enough time has passed since the first measurement') };
    }
  } else if (now - lastAt < period.everyMs) {
    return { due: false, reason: m('recap.no.notYet', 'The last summary was less than one period ago') };
  }

  const summary = summarise({ history, now, windowDays: period.windowDays });
  if (!summary.ok) return { due: false, reason: summary.reason };

  return { due: true, kind, summary };
}

function firstMeasurementAt(history) {
  const snapshots = history && Array.isArray(history.snapshots) ? history.snapshots : [];
  return snapshots.length > 0 ? Math.min(...snapshots.map((s) => s.at)) : null;
}

/**
 * What the period actually did to the disk, or why that cannot be said.
 *
 * The volume is the one the Trends screen would open on, so the summary and
 * the chart are about the same drive.
 */
function summarise({ history, now, windowDays }) {
  // The pieces, not `historyLib.report()`: that also fits a disk-full
  // prediction and totals up every cleanup the app has ever done, and a
  // sentence about the last four weeks needs neither.
  const roots = history.volumeRoots();
  const volume = historyLib.defaultVolume(history, roots);
  const series = volume ? history.volumeSeries(volume) : [];
  if (!volume || series.length === 0) {
    return { ok: false, reason: m('recap.no.noReadings', 'Nothing has measured this disk yet') };
  }

  // The same rule the chart holds itself to: four measurements over a week.
  const trend = historyLib.growth(series);
  if (!trend.ok) return { ok: false, reason: trend.reason };

  const since = now - windowDays * DAY;
  const inWindow = series.filter((p) => p.at >= since);
  if (inWindow.length < 2) {
    return { ok: false, reason: m('recap.no.thinWindow', 'Too few measurements in this period to compare') };
  }

  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const changeBytes = (last.usedBytes || 0) - (first.usedBytes || 0);

  // Folders that grew, from scans somebody started. Shrinking ones are left
  // out: this is a note about where the space went. `ok` is `folderTrends`'
  // own refusal -- a folder scanned once, or twice on the same day, has no
  // trend and is never named as though it had.
  const folders = historyLib
    .folderTrends(history)
    .filter((f) => f.ok && f.changeBytes >= MIN_FOLDER_BYTES)
    .sort((a, b) => b.changeBytes - a.changeBytes)
    .slice(0, NAMED_FOLDERS)
    .map((f) => ({ root: f.root, changeBytes: f.changeBytes }));

  return {
    ok: true,
    volume,
    from: first.at,
    to: last.at,
    days: Math.max(1, Math.round((last.at - first.at) / DAY)),
    changeBytes,
    usedPercent: last.usedPercent,
    freeBytes: last.freeBytes,
    readings: inWindow.length,
    folders,
  };
}

/**
 * The sentence, as messages the notification renders.
 *
 * Two parts, and the second is left out when there is nothing to put in it --
 * rather than saying "biggest: none", which reads as a fault.
 *
 * Nothing here ever mentions a feature the reader does not have. A summary
 * that arrives once a month and tries to sell something is a summary people
 * switch off, and then the one that mattered never arrives either.
 */
function wording(summary) {
  // Every number is formatted here, because `render()` substitutes what it is
  // given: a raw `6012954214.400024` would go on somebody's screen exactly as
  // it is. The folder is the display spelling for the same reason -- `c:\` in
  // a notification looks like a fault.
  const volume = displayPath(summary.volume);
  const grew = summary.changeBytes >= 0;

  const title = m('recap.title', 'CleanDrive: the last {days} days on {volume}', {
    days: summary.days,
    volume,
  });

  const shared = { volume, percent: summary.usedPercent.toFixed(1), free: formatBytes(summary.freeBytes) };
  const body = grew
    ? m('recap.grew', '{volume} grew by {size}. It is {percent}% full, with {free} left.', {
        ...shared,
        size: formatBytes(summary.changeBytes),
      })
    : m('recap.shrank', '{volume} went down by {size}. It is {percent}% full, with {free} left.', {
        ...shared,
        size: formatBytes(-summary.changeBytes),
      });

  const named = summary.folders.length > 0
    ? summary.folders.length === 1
      ? m('recap.biggest.one', 'Biggest: {a} is up {an}.', {
          a: displayPath(summary.folders[0].root),
          an: formatBytes(summary.folders[0].changeBytes),
        })
      : m('recap.biggest.two', 'Biggest: {a} is up {an}, then {b} up {bn}.', {
          a: displayPath(summary.folders[0].root),
          an: formatBytes(summary.folders[0].changeBytes),
          b: displayPath(summary.folders[1].root),
          bn: formatBytes(summary.folders[1].changeBytes),
        })
    : null;

  return { title, body, named };
}

/** The settings to write once a summary has actually been shown. */
function recordSent(now) {
  return { trends: { recapLastAt: now } };
}

module.exports = { consider, summarise, wording, recordSent, PERIODS, KINDS, MIN_FOLDER_BYTES, NAMED_FOLDERS };
