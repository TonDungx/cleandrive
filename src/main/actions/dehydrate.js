'use strict';

/**
 * OneDrive's "Free up space", as an action: make a synced file online-only.
 *
 * Nothing is deleted. The file keeps its name, size and place; OneDrive takes
 * the local copy of its contents away, and brings it back when the file is
 * opened. That is only true of a file whose contents are already in the
 * cloud, so this handler asks Windows (cloud-state.js) and refuses anything
 * else, by name:
 *
 *   notInOneDrive   outside every OneDrive folder this account has
 *   notSynced       OneDrive has never uploaded it -- nothing would be freed,
 *                   and on the machine this was written on that was 10 GB
 *   pending         changed since it last synced; it waits for the upload
 *   onlineOnly      already is
 *   oneDriveOff     OneDrive is not running, so nothing would be freed now;
 *                   refused outright rather than left for later (decided
 *                   2026-09-25)
 *   cannotCheck     Windows could not be asked; never a guess
 *   changed         different size or date from when it was planned
 *
 * What it frees is measured, never assumed. OneDrive does the work after
 * `attrib +U -P` returns, in its own time, so `apply` watches what each file
 * takes on the disk for a while afterwards and reports the drop it saw. A
 * file OneDrive has not got to yet counts as not freed -- and the receipt
 * says so -- rather than as freed on credit.
 *
 * There is nothing for the Restore Center to put back: the file never moved.
 * Opening it brings its contents back.
 */

const path = require('node:path');

const cloudState = require('../lib/cloud-state');
const { fsp } = require('../lib/real-fs');

/** How long `apply` watches for OneDrive to take the contents, at most. */
const WATCH_MS = 30000;
const WATCH_STEP_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function engine(deps = {}) {
  return {
    query: deps.query || cloudState.query,
    running: deps.running || cloudState.oneDriveRunning,
    makeOnlineOnly: deps.makeOnlineOnly || cloudState.makeOnlineOnly,
    allocated: deps.allocated || cloudState.allocated,
    roots: deps.roots || cloudState.oneDriveRoots,
    lstat: deps.lstat || ((p) => fsp.lstat(p)),
    watchMs: Number.isFinite(deps.watchMs) ? deps.watchMs : WATCH_MS,
    stepMs: Number.isFinite(deps.stepMs) ? deps.stepMs : WATCH_STEP_MS,
  };
}

/** Why a file cannot be made online-only, from what Windows said about it. */
function refusalFor(state) {
  if (!state || state.missing) return 'missing';
  if (!state.placeholder) return 'notSynced';
  if (!state.onDisk) return 'onlineOnly';
  if (!state.inSync) return 'pending';
  return null;
}

async function plan(items, options, ctx = {}) {
  const e = engine(ctx.deps);
  const failed = [];
  const candidates = [];
  const roots = e.roots();

  for (const raw of items) {
    if (typeof raw !== 'string' || !path.isAbsolute(raw)) {
      failed.push({ path: String(raw), error: 'Not an absolute path', reason: 'invalid' });
      continue;
    }
    const file = path.resolve(raw);
    if (!cloudState.oneDriveRootOf(file, roots)) {
      failed.push({ path: file, error: 'Not inside a OneDrive folder', reason: 'notInOneDrive' });
      continue;
    }
    let stats;
    try {
      stats = await e.lstat(file);
    } catch {
      failed.push({ path: file, error: 'No longer there', reason: 'missing' });
      continue;
    }
    if (!stats.isFile()) {
      failed.push({ path: file, error: 'Not a file', reason: 'notAFile' });
      continue;
    }
    candidates.push({ path: file, size: stats.size, mtimeMs: stats.mtimeMs });
  }

  const running = candidates.length > 0 ? await e.running() : false;
  if (candidates.length > 0 && !running) {
    for (const c of candidates) failed.push({ path: c.path, error: 'OneDrive is not running', reason: 'oneDriveOff' });
    return { plan: [], failed, totalBytes: 0, onDiskBytes: 0, running: false };
  }

  const reply = candidates.length > 0 ? await e.query(candidates.map((c) => c.path)) : { ok: true, states: new Map() };
  if (!reply.ok) {
    for (const c of candidates) failed.push({ path: c.path, error: 'Could not ask Windows about OneDrive', reason: 'cannotCheck' });
    return { plan: [], failed, totalBytes: 0, onDiskBytes: 0, running };
  }

  const ready = [];
  for (const c of candidates) {
    const refused = refusalFor(reply.states.get(c.path));
    if (refused) {
      failed.push({ path: c.path, error: refused, reason: refused });
      continue;
    }
    ready.push({ ...c, allocated: await e.allocated(c.path).catch(() => c.size), pinned: reply.states.get(c.path).pinned });
  }
  return {
    plan: ready,
    failed,
    totalBytes: ready.reduce((n, c) => n + c.size, 0),
    onDiskBytes: ready.reduce((n, c) => n + c.allocated, 0),
    running,
  };
}

function describe(planned) {
  const by = (reason) => planned.failed.filter((f) => f.reason === reason).length;
  return {
    kind: 'dehydrate',
    count: planned.plan.length,
    bytes: planned.totalBytes,
    onDiskBytes: planned.onDiskBytes,
    freesOnVolume: true,
    // Measured afterwards, never assumed: see apply().
    measured: true,
    reversible: 'none',
    pinned: planned.plan.filter((c) => c.pinned).length,
    oneDriveOff: by('oneDriveOff'),
    notSynced: by('notSynced'),
    pending: by('pending'),
    refused: planned.failed.length,
    etaMs: planned.plan.length * 60,
  };
}

/**
 * Mark each file online-only, then watch the disk for OneDrive doing it.
 *
 * The state is asked again first, all at once: a file edited since the plan
 * is no longer in sync, and making it online-only then would be relying on
 * OneDrive to upload it first. Such a file is skipped, as is one whose size
 * or date has changed.
 */
async function apply(planned, options, ctx = {}) {
  const e = engine(ctx.deps);
  const token = ctx.token;
  const onProgress = ctx.onProgress || (() => {});
  const started = Date.now();
  const total = planned.plan.length;
  const moved = [];
  const failed = [];
  let handedBytes = 0;

  onProgress({ phase: 'dehydrating', done: 0, total, freedBytes: 0, totalBytes: planned.totalBytes, elapsedMs: 0 });

  const again = await e.query(planned.plan.map((c) => c.path));
  const stillRunning = await e.running();

  for (let i = 0; i < planned.plan.length; i++) {
    const item = planned.plan[i];
    if (token && token.cancelled) break;
    let reason = null;
    if (!again.ok) reason = 'cannotCheck';
    else if (!stillRunning) reason = 'oneDriveOff';
    else reason = refusalFor(again.states.get(item.path));
    if (!reason) {
      try {
        const now = await e.lstat(item.path);
        if (now.size !== item.size || Math.round(now.mtimeMs) !== Math.round(item.mtimeMs)) reason = 'changed';
      } catch {
        reason = 'missing';
      }
    }
    if (reason) {
      failed.push({ path: item.path, error: reason, reason });
    } else {
      try {
        await e.makeOnlineOnly(item.path);
        const record = { path: item.path, size: item.size, allocatedBefore: item.allocated };
        // Journalled before the window hears of it, like every action.
        if (ctx.onItem) await ctx.onItem(record);
        moved.push(record);
        handedBytes += item.size;
      } catch (err) {
        failed.push({ path: item.path, error: err.message || 'attrib failed', reason: 'failed' });
      }
    }
    onProgress({
      phase: 'dehydrating',
      done: i + 1,
      total,
      freedBytes: handedBytes,
      totalBytes: planned.totalBytes,
      currentPath: item.path,
      elapsedMs: Date.now() - started,
    });
  }

  // Now what actually came back to the disk. OneDrive works through the
  // files in its own time; the watch ends when every one has gone to the
  // cloud, when the time is up, or when somebody presses Stop.
  const freedOf = new Map();
  const deadline = Date.now() + e.watchMs;
  for (;;) {
    let freed = 0;
    let waiting = 0;
    for (const record of moved) {
      const after = await e.allocated(record.path).catch(() => record.allocatedBefore);
      const drop = Math.max(0, record.allocatedBefore - after);
      freedOf.set(record.path, drop);
      freed += drop;
      if (after > 0) waiting += 1;
    }
    onProgress({ phase: 'waitingForOneDrive', done: moved.length - waiting, total: moved.length, freedBytes: freed, totalBytes: planned.onDiskBytes, elapsedMs: Date.now() - started });
    if (waiting === 0 || Date.now() >= deadline || (token && token.cancelled)) break;
    await sleep(e.stepMs);
  }

  for (const record of moved) record.freed = freedOf.get(record.path) || 0;
  const measuredFreedBytes = moved.reduce((n, r) => n + r.freed, 0);
  return {
    moved,
    failed,
    // What was handed to OneDrive, in the field every handler reports what it moved in.
    freedBytes: handedBytes,
    measuredFreedBytes,
    pendingCount: moved.filter((r) => r.freed < r.allocatedBefore).length,
    cancelled: Boolean(token && token.cancelled),
    remaining: total - moved.length - failed.length,
    durationMs: Date.now() - started,
  };
}

module.exports = {
  kind: 'dehydrate',
  feature: 'free',
  allowsFolders: false,
  reversible: 'none',
  freesOnVolume() {
    return true;
  },
  plan,
  describe,
  apply,
  refusalFor,
  WATCH_MS,
};
