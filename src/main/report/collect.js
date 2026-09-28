'use strict';

/**
 * What goes into a report (G2).
 *
 * Everything here comes from what the app has already measured and written
 * down: the history file, the snapshot store, the journal, and -- if the
 * System screen was used in this session -- the breakdown it produced. The one
 * thing measured on the spot is the list of drives, which is a `statfs` per
 * volume and costs nothing.
 *
 * ## It never starts work of its own
 *
 * A "Save report" button that scans a drive, or raises a UAC prompt to read
 * `$MFT`, is a button nobody presses twice. So a section with nothing behind
 * it is not computed: it comes back as `null` with a reason, and the report
 * prints a line saying which screen would fill it in. A gap that says what it
 * is beats a number that was invented to fill it.
 *
 * ## The shape is the JSON
 *
 * What this returns is embedded in the report verbatim, so it is arranged to
 * be read by somebody who opens the file rather than to suit the renderer:
 * flat rows, absolute numbers, and no keys that only make sense next to the
 * code that drew them.
 */

const os = require('node:os');

const historyLib = require('../lib/history');
const snapshotDiff = require('../snapshots/diff');

/** Every section a report can hold, in the order the page puts them. */
const SECTIONS = Object.freeze(['volumes', 'system', 'folders', 'trends', 'diff', 'actions']);

/**
 * The sections that name individual files.
 *
 * These are what makes private mode default to on: a list of folder sizes
 * describes a disk, but a list of files describes a person.
 */
const FILE_LISTING_SECTIONS = Object.freeze(['diff', 'actions']);

/** Whether a chosen set of sections would put file names in the report. */
function namesFiles(sections) {
  return (sections || []).some((s) => FILE_LISTING_SECTIONS.includes(s));
}

/* -------------------------------------------------------------------------- */

async function collectVolumes(deps) {
  try {
    const listing = await deps.volumes.list();
    return (listing.drives || [])
      .filter((d) => Number.isFinite(d.totalBytes) && d.totalBytes > 0)
      .map((d) => ({
        root: d.root,
        label: d.label || null,
        fileSystem: d.fileSystem || null,
        type: d.type || null,
        totalBytes: d.totalBytes,
        freeBytes: d.freeBytes,
        usedPercent: d.totalBytes > 0 ? ((d.totalBytes - d.freeBytes) / d.totalBytes) * 100 : 0,
      }));
  } catch {
    return [];
  }
}

/**
 * The System screen's breakdown, if it has been produced in this session.
 *
 * Two things make this section different from every other one, and both are
 * why the window hands it over rather than this file fetching it.
 *
 * It is never written down: measuring it walks the whole drive and some of its
 * rows need administrator rights, so it lives in the main process's memory
 * until the app closes. Nothing can reconstruct it later, and a report button
 * must not start a drive walk or raise a UAC prompt to fill a section in.
 *
 * And its row titles -- "Your profile", "In your profile, left out of the
 * other scans" -- exist only in `renderer/system.js`, where `test:i18n` can
 * see them as literal keys. Copying twenty of them into the main process to
 * render a report would put the app's vocabulary in two places, and the second
 * copy is the one that goes stale.
 *
 * So the window sends the rows it is already showing. Every value is escaped
 * on the way into the page like any other, and when nobody has opened the
 * System screen the honest answer is that nobody has.
 */
function collectSystem(sent) {
  if (!sent || !Array.isArray(sent.rows) || sent.rows.length === 0) return null;
  const rows = sent.rows
    .filter((r) => r && typeof r.label === 'string')
    .map((r) => ({
      key: typeof r.key === 'string' ? r.key : '',
      label: r.label,
      bytes: Number.isFinite(r.bytes) ? r.bytes : 0,
      path: typeof r.path === 'string' ? r.path : null,
      note: typeof r.note === 'string' ? r.note : null,
    }));
  if (rows.length === 0) return null;
  return {
    drive: typeof sent.drive === 'string' ? sent.drive : '',
    at: Number.isFinite(sent.at) ? sent.at : Date.now(),
    elevated: sent.elevated === true,
    totalBytes: Number.isFinite(sent.totalBytes) ? sent.totalBytes : 0,
    rows,
  };
}

/** The folders that have been scanned, newest measurement of each. */
function collectFolders(history) {
  const out = [];
  for (const { root } of history.scannedRoots()) {
    const series = history.folderSeries(root);
    const last = series[series.length - 1];
    if (!last) continue;
    out.push({ root, bytes: last.bytes, files: last.files || 0, at: last.at, samples: series.length });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/**
 * A drive root as a person writes it.
 *
 * The history keys volumes by `pathKey`, which lowercases -- fine for
 * comparing, wrong in a document. `c:\` in a report somebody sends to a repair
 * shop just looks like a mistake.
 */
function driveLabel(root) {
  const text = String(root || '');
  return /^[a-z]:/.test(text) ? text[0].toUpperCase() + text.slice(1) : text;
}

function collectTrends(history, volume) {
  const model = historyLib.report(history, { volumeRoot: volume });
  if (!model.series || model.series.length === 0) return null;

  // What took each reading -- a scan somebody started, the tray watcher, the
  // daily task. `volumeSeries` spreads the volume's own fields and the source
  // is on the snapshot around it, so it is looked up here rather than left as
  // an empty column in the report.
  const sourceAt = new Map(history.snapshots.map((s) => [s.at, s.source || null]));

  return {
    volume: driveLabel(model.volume),
    volumes: (model.volumes || []).map(driveLabel),
    series: model.series.map((p) => ({
      at: p.at,
      usedPercent: p.usedPercent,
      freeBytes: p.freeBytes,
      totalBytes: p.totalBytes,
      source: p.source || sourceAt.get(p.at) || null,
    })),
    growth: model.growth,
    prediction: model.prediction,
    folders: model.folders,
    savings: model.savings,
  };
}

/**
 * The newest comparable pair of snapshots, flattened.
 *
 * The same pair the Trends screen opens on, chosen by the same rule, so the
 * report and the screen never disagree about which two scans are being
 * compared.
 */
async function collectDiff(store) {
  const roots = await store.roots();
  let best = null;

  for (const root of roots) {
    const listed = await store.list(root);
    const pair = snapshotDiff.defaultPair(listed);
    if (!pair.ok) continue;
    const [a, b] = await Promise.all([store.load(root, pair.older), store.load(root, pair.newer)]);
    const diff = snapshotDiff.diffSnapshots(a, b, { files: [pair.older, pair.newer] });
    if (!diff.ok) continue;
    // The one with the most movement: a report has room for one comparison,
    // and the interesting one is where the disk actually changed.
    const size = Math.abs(diff.total.change);
    if (!best || size > best.size) best = { size, diff };
  }
  if (!best) return null;

  const d = best.diff;
  // `grew` and `shrank` are each `{ places, more }`, and a place's amount is
  // `change` -- already signed, so the two lists can simply be joined.
  const places = [...((d.grew && d.grew.places) || []), ...((d.shrank && d.shrank.places) || [])]
    .filter((p) => p.path)
    .map((p) => ({ path: p.path, deltaBytes: p.change, beforeBytes: p.before, afterBytes: p.after }))
    .sort((a, b) => Math.abs(b.deltaBytes) - Math.abs(a.deltaBytes));

  // Four lists of files, each `{ items, total, bytes }`, flattened into one
  // with the kind said rather than implied by which list it came from.
  const files = [];
  for (const kind of ['grew', 'shrank', 'appeared', 'vanished']) {
    for (const f of (d.files && d.files[kind] && d.files[kind].items) || []) {
      files.push({ path: f.path, kind, bytes: Number.isFinite(f.change) ? f.change : f.size || 0 });
    }
  }
  for (const f of (d.files && d.files.moved && d.files.moved.items) || []) {
    files.push({ path: f.from, kind: 'moved', bytes: f.size || 0, to: f.to });
  }
  files.sort((a, b) => Math.abs(b.bytes) - Math.abs(a.bytes));

  return {
    root: d.root,
    fromAt: d.from ? Date.parse(d.from.takenAt) : 0,
    toAt: d.to ? Date.parse(d.to.takenAt) : 0,
    days: d.days,
    confidence: d.confidence,
    beforeBytes: d.total.before,
    afterBytes: d.total.after,
    deltaBytes: d.total.change,
    places,
    files,
    filesRefused: d.filesRefused,
  };
}

/** What the app has done, from the journal that records every action. */
async function collectActions(journal, { limit = 25 } = {}) {
  const sessions = await journal.sessions();
  if (!sessions || sessions.length === 0) return null;
  return {
    sessions: sessions.slice(0, limit).map((s) => ({
      id: s.id,
      kind: s.kind,
      at: s.startedAt || s.at || 0,
      source: s.source || null,
      count: (s.items || []).length,
      bytes: (s.items || []).reduce((n, i) => n + (i.size || 0), 0),
      freedOnSource: s.end ? s.end.freedOnSource || 0 : 0,
      items: (s.items || []).map((i) => ({ path: i.path, size: i.size || 0, to: i.to || null })),
    })),
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Gather everything the chosen sections need.
 *
 * @param {object} options
 * @param {string[]} options.sections   which of `SECTIONS` to include
 * @param {object} options.services     { history, snapshots, journal }
 * @param {object} options.deps         { volumes }
 * @param {object} [options.system]     the System screen's model, if measured
 * @param {string} [options.volume]     which volume the trends chart is of
 * @returns {Promise<object>} the report's data
 */
async function collect(options) {
  const wanted = (options.sections || []).filter((s) => SECTIONS.includes(s));
  const { history, snapshots, journal } = options.services;
  await history.load();

  const data = {
    app: options.app || 'CleanDrive',
    version: options.version || '',
    at: Date.now(),
    machine: options.machine === false ? null : os.hostname(),
    lang: options.lang || 'en',
    private: false,
    sections: wanted,
    volumes: [],
    system: null,
    folders: [],
    trends: null,
    diff: null,
    actions: null,
  };

  if (wanted.includes('volumes')) data.volumes = await collectVolumes(options.deps);
  if (wanted.includes('system')) data.system = collectSystem(options.system);
  if (wanted.includes('folders')) data.folders = collectFolders(history);
  if (wanted.includes('trends')) data.trends = collectTrends(history, options.volume);
  if (wanted.includes('diff')) data.diff = await collectDiff(snapshots);
  if (wanted.includes('actions')) data.actions = await collectActions(journal);

  return data;
}

module.exports = { collect, driveLabel, SECTIONS, FILE_LISTING_SECTIONS, namesFiles, collectVolumes, collectSystem, collectFolders, collectTrends, collectDiff, collectActions };
