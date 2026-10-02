'use strict';

/**
 * Gathering a machine report's inputs on a real machine, and writing it (H3).
 *
 * Three callers: the daily measurement (`--sample-only`), which writes one a
 * day when the organisation's policy names a folder; `cleandrive policy
 * apply`, which writes one at once so a logon script makes the machine appear
 * in the console the same morning; and `cleandrive report`, which prints what
 * would be sent and writes nothing.
 *
 * Every number comes from where the window already gets it -- the history
 * (Trends), Task Scheduler and the run log (Automatic), the journal's own
 * check (Restore Center) -- so the console never disagrees with the screen on
 * the machine itself.
 *
 * What it costs (measured 2026-10-02): asking Windows about the tasks is one
 * PowerShell process, 447-523 ms; checking each registered task, 34-67 ms.
 * Checking the journal took 62 ms on a year-sized one (H4). Paid only on a
 * machine whose policy asks for a report.
 *
 * Nothing here asks the licence: whether the report is written at all is the
 * policy's acting half, decided where the policy is read (services.js).
 */

const os = require('node:os');

const report = require('./report');
const historyLib = require('../lib/history');

/** Volumes measured within this long are reported; older ones are a drive that has gone. */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {object} deps
 * @param {object} deps.history      a loaded History
 * @param {object} deps.runLog       a RunLog (loaded here)
 * @param {object} deps.settings     effective settings (with `managed`)
 * @param {() => Promise<object>} deps.taskStatus
 * @param {() => Promise<object|null>} deps.journalReport
 * @param {{version: string, channel: string}} deps.app
 * @param {string} [deps.host]
 * @param {number} [deps.now]
 */
async function gather(deps) {
  const now = deps.now || Date.now();
  const history = deps.history;

  const volumes = [];
  for (const root of history.volumeRoots()) {
    const series = history.volumeSeries(root);
    const latest = series[series.length - 1];
    if (!latest || now - latest.at > RECENT_MS) continue;
    volumes.push({ root, latest, growth: historyLib.growth(series), prediction: historyLib.predictFull(series) });
  }

  let lastScan = null;
  for (let i = history.snapshots.length - 1; i >= 0; i--) {
    const snapshot = history.snapshots[i];
    if (snapshot.scan) {
      lastScan = { ...snapshot.scan, at: snapshot.at };
      break;
    }
  }

  await deps.runLog.load();
  const [tasks, journal] = await Promise.all([safely(deps.taskStatus), safely(deps.journalReport)]);
  const managed = deps.settings.managed || null;

  return {
    host: deps.host || os.hostname(),
    now,
    app: deps.app,
    volumes,
    lastScan,
    topFolders: Boolean(managed && managed.report && managed.report.topFolders),
    tasks,
    runs: deps.runLog.runs,
    journal,
    managed,
  };
}

/** A part that could not be read is left out of the report, never the whole report. */
async function safely(fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn('[report] part of the report could not be read:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * The inputs, from this process's services.
 *
 * @param {object} svc       services()
 * @param {object} settings  effective settings
 * @param {object} appInfo   { version, channel }
 */
function depsFrom(svc, settings, appInfo) {
  return {
    history: svc.history,
    runLog: svc.runLog,
    settings,
    app: appInfo,
    taskStatus: () => require('../tasks').status(settings, { withOsInfo: true, fresh: true, settingsExisted: svc.settings.exists }),
    journalReport: async () => {
      const { verifyJournal } = require('../journal/seal');
      return verifyJournal(await svc.journal.readRaw(), await svc.sealKey.publicKeys());
    },
  };
}

/** The report this machine would send, as an object. */
async function buildFor(svc, settings, appInfo) {
  await svc.history.load();
  return report.build(await gather(depsFrom(svc, settings, appInfo)));
}

/**
 * Write this machine's report to the folder the policy names, if it names one.
 *
 * @returns {Promise<null | {ok: boolean, file: string, ms: number, error?: string, code?: string}>}
 *   null when no policy asks for a report
 */
async function writeIfAsked(svc, settings, appInfo) {
  const asked = settings.managed && settings.managed.report;
  if (!asked) return null;
  const built = await buildFor(svc, settings, appInfo);
  const { writeReport } = require('./share');
  return writeReport(asked.folder, built.host, report.serialize(built));
}

module.exports = { gather, depsFrom, buildFor, writeIfAsked, RECENT_MS };
