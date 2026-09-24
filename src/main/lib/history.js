'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { pathKey } = require('./util');
// Every refusal below is shown in the window, so it is a message the window
// words in its own language rather than an English sentence.
const { message: m } = require('../../i18n');

/**
 * What the disk looked like, over time.
 *
 * The obvious design -- record a snapshot whenever the user runs a scan, then
 * fit a line through the totals -- does not work, and it is worth saying why
 * before reading the rest of this file.
 *
 * A scan covers one folder the user chose at that moment. Scanning Downloads on
 * Monday and Users on Friday produces two numbers that are not two points on
 * any curve; a regression through them describes nothing. Worse, scans happen
 * when somebody feels like it, so the samples are irregular as well as
 * incomparable.
 *
 * So the series that drives every trend here is **volume usage**, taken with
 * `statfs` and recorded on every snapshot regardless of what was scanned, or
 * whether anything was scanned at all. That number means the same thing every
 * time it is taken. Per-folder history is kept too, but it is only ever
 * compared against earlier snapshots of *the same root*, and it is absent from
 * the headline figures rather than faked when there is nothing to compare.
 *
 * The second rule in this file is that a prediction refuses itself. "Your disk
 * fills in 12 weeks" from four noisy points is a number with a straight face
 * and nothing behind it. `predictFull` returns a reason instead whenever the
 * data does not support an answer.
 */

const SCHEMA_VERSION = 1;

/** Roughly a year of daily snapshots. The strategy document suggested 12, which
 *  is not enough points to fit anything through. */
const MAX_SNAPSHOTS = 400;
const MAX_EVENTS = 2000;
const MAX_AGE_DAYS = 400;

/** Snapshots closer together than this are the same observation twice. */
const MIN_SNAPSHOT_GAP_MS = 30 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* the store                                                                   */
/* -------------------------------------------------------------------------- */

class History {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.snapshots = [];
    this.events = [];
    this.loaded = false;
    this._writeChain = Promise.resolve();
  }

  /** Never throws. A corrupt history is an empty history, not a crash. */
  async load() {
    this.loaded = true;
    this.snapshots = [];
    this.events = [];

    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
    } catch {
      return this;
    }

    const cutoff = Date.now() - MAX_AGE_DAYS * DAY;
    if (Array.isArray(parsed && parsed.snapshots)) {
      this.snapshots = parsed.snapshots.filter((s) => s && Number.isFinite(s.at) && s.at >= cutoff);
    }
    if (Array.isArray(parsed && parsed.events)) {
      this.events = parsed.events.filter((e) => e && Number.isFinite(e.at) && e.at >= cutoff);
    }

    this.snapshots.sort((a, b) => a.at - b.at);
    this.events.sort((a, b) => a.at - b.at);
    return this;
  }

  async ensureLoaded() {
    if (!this.loaded) await this.load();
    return this;
  }

  /**
   * Take in whatever another process has written since this one loaded.
   *
   * Three processes write this file and none of them coordinate: the window,
   * the scheduled cleanup, and the daily sampler. Each loaded the file once,
   * kept its own copy, and `flush()` writes that whole copy back -- so the
   * last one to write erased everything the others had recorded since. An open
   * window wiped the daily measurement as a matter of course; the Trends tab
   * was missing points for a reason that had nothing to do with the disk.
   *
   * Reading the file back immediately before each change closes that window
   * from "as long as the app stays open" to the milliseconds between this read
   * and the rename inside writeAtomic. Two processes can still collide inside
   * that gap, and nothing here pretends otherwise -- it is a lock-free store,
   * not a transactional one. What it no longer does is lose an hour of
   * measurements to a window somebody left open.
   */
  async refresh() {
    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
    } catch {
      // No file yet, or one we cannot read: memory is all there is, and the
      // next flush will write it. A corrupt history is an empty history.
      return this;
    }

    const cutoff = Date.now() - MAX_AGE_DAYS * DAY;
    this.snapshots = mergeSeries(parsed && parsed.snapshots, this.snapshots, cutoff);
    this.events = mergeSeries(parsed && parsed.events, this.events, cutoff);
    return this;
  }

  /**
   * Record one observation.
   *
   * @param {object}  snapshot
   * @param {object}  snapshot.volumes  { volumeRoot: {totalBytes, freeBytes, usedBytes, usedPercent} }
   * @param {object}  [snapshot.scan]   { root, totalBytes, totalFiles, byCategory, topFolders }
   * @param {string}  [snapshot.source] where the measurement came from:
   *   'daily' (the sampling task), 'launch', 'monitor', 'manual', 'scan',
   *   'scheduled', 'cleanup' or 'purge'
   */
  async addSnapshot(snapshot) {
    await this.ensureLoaded();
    await this.refresh();

    const at = Number.isFinite(snapshot.at) ? snapshot.at : Date.now();
    const volumes = {};
    for (const [root, usage] of Object.entries(snapshot.volumes || {})) {
      if (!usage || usage.ok === false || !Number.isFinite(usage.totalBytes) || usage.totalBytes <= 0) continue;
      volumes[pathKey(root)] = {
        totalBytes: usage.totalBytes,
        freeBytes: usage.freeBytes,
        usedBytes: usage.usedBytes,
        usedPercent: usage.usedPercent,
      };
    }

    // A snapshot with no readable volume tells us nothing we can plot.
    if (Object.keys(volumes).length === 0 && !snapshot.scan) return null;

    const entry = { at, source: snapshot.source || 'scan', volumes, scan: normaliseScan(snapshot.scan) };

    // Two observations half an hour apart are one observation. Replace rather
    // than append, so opening the app repeatedly does not flatten the series
    // with a cluster of identical points.
    //
    // The neighbour is found by time rather than by position, because the
    // refresh above can have brought in a point another process recorded
    // *after* this one -- the sampler and a scheduled cleanup land within a
    // minute of each other on every reboot. Taking the last entry would let
    // this one overwrite a newer reading.
    let near = -1;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (Math.abs(this.snapshots[i].at - at) < MIN_SNAPSHOT_GAP_MS) {
        near = i;
        break;
      }
    }

    if (near !== -1 && !(entry.scan && !this.snapshots[near].scan)) {
      const previous = this.snapshots[near];
      this.snapshots[near] = { ...previous, ...entry, scan: entry.scan || previous.scan };
    } else {
      this.snapshots.push(entry);
    }

    this.snapshots.sort((a, b) => a.at - b.at);

    this.trim();
    await this.flush();
    return entry;
  }

  /**
   * Record space that changed hands.
   *
   * `movedBytes` went to the Recycle Bin and is still on the disk.
   * `freedBytes` was permanently removed and is genuinely back.
   * Keeping these apart is the whole point of recording them at all.
   */
  async addEvent({ at = Date.now(), movedBytes = 0, freedBytes = 0, files = 0, source = 'manual' }) {
    await this.ensureLoaded();
    if (movedBytes <= 0 && freedBytes <= 0) return null;
    await this.refresh();

    const event = { at, movedBytes, freedBytes, files, source };
    this.events.push(event);
    this.events.sort((a, b) => a.at - b.at);
    this.trim();
    await this.flush();
    return event;
  }

  trim() {
    const cutoff = Date.now() - MAX_AGE_DAYS * DAY;
    this.snapshots = this.snapshots.filter((s) => s.at >= cutoff);
    this.events = this.events.filter((e) => e.at >= cutoff);
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(this.snapshots.length - MAX_SNAPSHOTS);
    }
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(this.events.length - MAX_EVENTS);
    }
  }

  async flush() {
    const payload = { version: SCHEMA_VERSION, snapshots: this.snapshots, events: this.events };
    this._writeChain = this._writeChain.then(() => writeAtomic(this.filePath, payload)).catch(() => {});
    await this._writeChain;
  }

  /* ---- series ---------------------------------------------------------- */

  /** Every volume that appears anywhere in the history. */
  volumeRoots() {
    const roots = new Set();
    for (const snapshot of this.snapshots) {
      for (const root of Object.keys(snapshot.volumes)) roots.add(root);
    }
    return [...roots].sort();
  }

  /** Usage over time for one volume: the only series that is safe to fit. */
  volumeSeries(root) {
    const key = pathKey(root);
    const series = [];
    for (const snapshot of this.snapshots) {
      const usage = snapshot.volumes[key];
      if (usage) series.push({ at: snapshot.at, ...usage });
    }
    return series;
  }

  /**
   * Size over time for one scanned folder.
   *
   * Only snapshots of this exact root are returned. A folder scanned once has a
   * one-point series, and one point is not a trend -- callers must check the
   * length rather than assume.
   */
  folderSeries(root) {
    const key = pathKey(root);
    const series = [];
    for (const snapshot of this.snapshots) {
      if (snapshot.scan && pathKey(snapshot.scan.root) === key) {
        series.push({ at: snapshot.at, bytes: snapshot.scan.totalBytes, files: snapshot.scan.totalFiles });
      }
    }
    return series;
  }

  /** Roots that have been scanned, most recently first. */
  scannedRoots() {
    const seen = new Map();
    for (const snapshot of this.snapshots) {
      if (!snapshot.scan) continue;
      seen.set(pathKey(snapshot.scan.root), { root: snapshot.scan.root, at: snapshot.at });
    }
    return [...seen.values()].sort((a, b) => b.at - a.at);
  }
}

function normaliseScan(scan) {
  if (!scan || typeof scan.root !== 'string') return null;
  return {
    root: path.resolve(scan.root),
    totalBytes: Number(scan.totalBytes) || 0,
    totalFiles: Number(scan.totalFiles) || 0,
    byCategory: scan.byCategory && typeof scan.byCategory === 'object' ? scan.byCategory : {},
    // Capped: a snapshot is a summary, not a second copy of the scan result.
    topFolders: Array.isArray(scan.topFolders)
      ? scan.topFolders.slice(0, 12).map((f) => ({ name: String(f.name), size: Number(f.size) || 0 }))
      : [],
  };
}

/**
 * Two versions of the same series, as one.
 *
 * Entries are identified by when they were taken and where they came from: two
 * processes recording at the same millisecond from the same source is the same
 * observation written twice, and anything else is two observations. Entries
 * held in memory win over the copy on disk, because they are this process's
 * own edit -- the half-hour replacement rule above rewrites an entry in place,
 * and the version on disk is the one it is replacing.
 */
function mergeSeries(onDisk, inMemory, cutoff) {
  const byKey = new Map();

  for (const entry of [...(Array.isArray(onDisk) ? onDisk : []), ...inMemory]) {
    if (!entry || !Number.isFinite(entry.at) || entry.at < cutoff) continue;
    byKey.set(`${entry.at}|${entry.source || ''}`, entry);
  }

  return [...byKey.values()].sort((a, b) => a.at - b.at);
}

async function writeAtomic(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await fsp.open(temp, 'w');
    await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
  await fsp.rename(temp, filePath);
}

/* -------------------------------------------------------------------------- */
/* analysis                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Least-squares fit of `y` against time in days.
 *
 * `r2` comes back with the slope because the slope on its own is not evidence.
 * A line through points that scatter badly has a slope too, and every caller
 * here has to decide whether to believe it.
 *
 * @returns {{slopePerDay: number, intercept: number, r2: number, n: number,
 *   spanDays: number} | null}
 */
function fitLine(points, valueOf) {
  const n = points.length;
  if (n < 2) return null;

  const t0 = points[0].at;
  const xs = points.map((p) => (p.at - t0) / DAY);
  const ys = points.map(valueOf);

  const spanDays = xs[xs.length - 1] - xs[0];
  if (spanDays <= 0) return null;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  if (sxx === 0) return null;

  const slopePerDay = sxy / sxx;
  // A perfectly flat series has no variance to explain; calling that r2 = 0
  // would read as "unreliable" when it is the opposite.
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);

  return { slopePerDay, intercept: meanY - slopePerDay * meanX, r2, n, spanDays };
}

/** Thresholds below which this file declines to draw a conclusion. */
const CONFIDENCE = {
  minPoints: 4,
  minSpanDays: 7,
  minR2: 0.5,
  // Past this the answer is "not soon", which is more useful than a number
  // nobody would act on.
  maxHorizonDays: 365 * 2,
};

/**
 * Growth of a volume, or a reason there is no answer yet.
 *
 * @returns {{ok: boolean, bytesPerDay?: number, bytesPerMonth?: number,
 *   r2?: number, n: number, spanDays: number, reason?: string}}
 */
function growth(series) {
  const n = series.length;
  if (n < 2) {
    return {
      ok: false,
      n,
      spanDays: 0,
      reason: m('trends.reason.one', 'Only one measurement so far — trends need at least two.'),
    };
  }

  const fit = fitLine(series, (p) => p.usedBytes);
  if (!fit) {
    return {
      ok: false,
      n,
      spanDays: 0,
      reason: m('trends.reason.sameMoment', 'All measurements were taken at the same moment.'),
    };
  }

  if (fit.n < CONFIDENCE.minPoints || fit.spanDays < CONFIDENCE.minSpanDays) {
    return {
      ok: false,
      n: fit.n,
      spanDays: fit.spanDays,
      bytesPerDay: fit.slopePerDay,
      r2: fit.r2,
      reason: m(
        'trends.reason.tooLittle',
        'Too little history to be worth reporting: {n} measurement(s) over {days} day(s). A week of data is the minimum.',
        { n: fit.n, days: fit.spanDays.toFixed(1) }
      ),
    };
  }

  return {
    ok: true,
    bytesPerDay: fit.slopePerDay,
    bytesPerMonth: fit.slopePerDay * 30,
    r2: fit.r2,
    n: fit.n,
    spanDays: fit.spanDays,
  };
}

/**
 * When a volume runs out, or why that cannot be said.
 *
 * Every branch that returns `ok: false` is a place the strategy document would
 * have printed a number.
 */
function predictFull(series) {
  const trend = growth(series);
  const latest = series[series.length - 1];

  if (!trend.ok) return { ok: false, reason: trend.reason, n: trend.n };

  if (trend.bytesPerDay <= 0) {
    return {
      ok: false,
      n: trend.n,
      reason: m('trends.reason.flat', 'Usage is flat or falling, so there is nothing to extrapolate.'),
      bytesPerDay: trend.bytesPerDay,
    };
  }

  if (trend.r2 < CONFIDENCE.minR2) {
    return {
      ok: false,
      n: trend.n,
      reason: m(
        'trends.reason.erratic',
        'Usage moves too erratically to extrapolate (the trend explains only {pct}% of the variation).',
        { pct: Math.round(trend.r2 * 100) }
      ),
      bytesPerDay: trend.bytesPerDay,
    };
  }

  const days = latest.freeBytes / trend.bytesPerDay;
  if (!Number.isFinite(days) || days <= 0) {
    return { ok: false, n: trend.n, reason: m('trends.reason.full', 'The volume already reports no free space.') };
  }

  if (days > CONFIDENCE.maxHorizonDays) {
    return {
      ok: false,
      n: trend.n,
      beyondHorizon: true,
      reason: m('trends.reason.notSoon', 'At this rate the disk does not fill within two years.'),
      bytesPerDay: trend.bytesPerDay,
    };
  }

  return {
    ok: true,
    days,
    at: latest.at + days * DAY,
    bytesPerDay: trend.bytesPerDay,
    r2: trend.r2,
    n: trend.n,
  };
}

/**
 * Which scanned folders are growing, by comparing each root against its own
 * earlier snapshots. Roots seen only once are reported as such rather than
 * given a rate of zero.
 */
function folderTrends(history) {
  const out = [];
  for (const { root } of history.scannedRoots()) {
    const series = history.folderSeries(root);
    const first = series[0];
    const last = series[series.length - 1];

    if (series.length < 2) {
      out.push({ root, bytes: last ? last.bytes : 0, samples: series.length, ok: false,
        reason: m('trends.reason.scannedOnce', 'Scanned once — scan it again later to see a trend.') });
      continue;
    }

    const fit = fitLine(series, (p) => p.bytes);
    out.push({
      root,
      bytes: last.bytes,
      changeBytes: last.bytes - first.bytes,
      samples: series.length,
      spanDays: fit ? fit.spanDays : 0,
      bytesPerMonth: fit ? fit.slopePerDay * 30 : 0,
      ok: Boolean(fit) && fit.spanDays >= 1,
      reason:
        fit && fit.spanDays < 1
          ? m('trends.reason.sameDay', 'All scans of this folder happened on the same day.')
          : undefined,
    });
  }

  return out.sort((a, b) => (b.bytesPerMonth || 0) - (a.bytesPerMonth || 0));
}

/**
 * What cleanup actually achieved, in the two numbers that are not the same.
 *
 * `movedBytes` is what went to the Recycle Bin. It is not a saving; the bytes
 * are still on the disk. `freedBytes` is what was permanently removed. Every
 * competitor reports the first figure and calls it the second.
 */
function savings(history, { since = 0 } = {}) {
  let movedBytes = 0;
  let freedBytes = 0;
  let files = 0;
  const byMonth = new Map();

  for (const event of history.events) {
    if (event.at < since) continue;
    movedBytes += event.movedBytes || 0;
    freedBytes += event.freedBytes || 0;
    files += event.files || 0;

    const date = new Date(event.at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const bucket = byMonth.get(key) || { month: key, movedBytes: 0, freedBytes: 0, files: 0 };
    bucket.movedBytes += event.movedBytes || 0;
    bucket.freedBytes += event.freedBytes || 0;
    bucket.files += event.files || 0;
    byMonth.set(key, bucket);
  }

  return {
    movedBytes,
    freedBytes,
    files,
    events: history.events.length,
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/**
 * Which volume the chart opens on when the user has not picked one.
 *
 * Alphabetical order was the obvious rule and the wrong one. On the machine
 * this was written for it opened on `c:\` -- which had been measured once --
 * while `d:\` had a series worth plotting, so the tab's first impression was
 * "one measurement so far" on a history that had several. The most-measured
 * volume is chosen instead, and ties go to the one measured most recently.
 */
function defaultVolume(history, roots) {
  let best = null;
  for (const root of roots) {
    const series = history.volumeSeries(root);
    if (series.length === 0) continue;
    const candidate = { root, count: series.length, latest: series[series.length - 1].at };
    if (
      !best ||
      candidate.count > best.count ||
      (candidate.count === best.count && candidate.latest > best.latest)
    ) {
      best = candidate;
    }
  }
  return best ? best.root : roots[0] || null;
}

/** Everything the Trends tab draws, in one object. */
function report(history, { volumeRoot } = {}) {
  const roots = history.volumeRoots();
  const chosen =
    volumeRoot && roots.includes(pathKey(volumeRoot)) ? pathKey(volumeRoot) : defaultVolume(history, roots);
  const series = chosen ? history.volumeSeries(chosen) : [];

  return {
    volumes: roots,
    volume: chosen,
    series,
    latest: series.length > 0 ? series[series.length - 1] : null,
    growth: growth(series),
    prediction: predictFull(series),
    folders: folderTrends(history),
    savings: savings(history),
    snapshots: history.snapshots.length,
  };
}

module.exports = {
  History,
  fitLine,
  growth,
  predictFull,
  folderTrends,
  savings,
  report,
  defaultVolume,
  CONFIDENCE,
  MIN_SNAPSHOT_GAP_MS,
  MAX_SNAPSHOTS,
  SCHEMA_VERSION,
};
