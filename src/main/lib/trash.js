'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  isProtectedPath,
  isProgramInstallPath,
  isRootOrHome,
  pathKey,
  CancelToken,
  throttle,
  pool,
} = require('./util');

/**
 * Measured on Windows 11 with Electron 33: shell.trashItem moves roughly 28
 * files per second and barely improves under concurrency, because the shell
 * serialises the operation internally. Used only to estimate a duration before
 * the work starts; once it is running the real rate takes over.
 */
const ESTIMATED_FILES_PER_SEC = 28;

/**
 * Reasons a path is refused before any deletion is attempted. Each check runs
 * on every path; nothing is sent to the OS until it passes all of them.
 *
 * Returns the lstat result alongside the verdict so the caller does not have to
 * stat the same file twice.
 */
async function vet(target, opts) {
  if (typeof target !== 'string' || target.trim() === '') {
    return { error: 'Not a valid path' };
  }
  if (!path.isAbsolute(target)) {
    return { error: 'Path must be absolute' };
  }
  if (isRootOrHome(target)) {
    return { error: 'Refusing to delete a drive root or home folder' };
  }
  if (isProtectedPath(target)) {
    return { error: 'Refusing to delete a system location' };
  }
  // Per-user installs (AppData\Local\Programs) are program files too. Deleting
  // from here is what broke a VS Code installation.
  if (isProgramInstallPath(target)) {
    return { error: 'Refusing to delete from an installed application' };
  }

  let stats;
  try {
    stats = await fsp.lstat(target);
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'File no longer exists' : `Cannot read: ${err.message}` };
  }

  if (stats.isDirectory() && !opts.allowDirectories) {
    return { error: 'Refusing to delete a folder (allowDirectories is off)' };
  }

  return { stats };
}

/* -------------------------------------------------------------------------- */
/* permission probe                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The read-only ATTRIBUTE (write bit clear) does not stop a file being
 * recycled -- Explorer moves read-only files to the bin without complaint. Only
 * an ACL denial does, and Node's `fs.access(W_OK)` cannot see ACLs on Windows:
 * it reports success for a file whose ACL denies everything. Opening the file
 * for write is what actually consults the ACL.
 */
function hasReadOnlyAttribute(stats) {
  return (stats.mode & 0o200) === 0;
}

/**
 * Would deleting this file raise Windows' "you'll need to provide administrator
 * permission" prompt, or fail because something has it open?
 *
 * Without this check the shell raises that prompt *per file*, modally, in the
 * middle of a long batch -- which is what it does today for files belonging to
 * installed programs. Detecting it here costs one open/close (~5,000 files/s)
 * and means those paths are reported up front instead of interrupting the run.
 *
 * Note this probe opens for write, which can advance the file's access time.
 * That only happens for files that pass, and those are the ones about to be
 * deleted anyway.
 *
 * @returns {Promise<{error: string, code: string} | null>}
 */
async function probePermission(target, stats) {
  if (hasReadOnlyAttribute(stats)) return null;

  let handle;
  try {
    handle = await fsp.open(target, 'r+');
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      return { error: 'Needs administrator permission', code: 'EPERM_ADMIN' };
    }
    if (err.code === 'EBUSY') {
      return { error: 'In use by another program', code: 'EBUSY' };
    }
    // Anything else (ENOENT from a race, odd filesystems) is not our call to
    // make here -- let the actual delete decide.
    return null;
  }

  await handle.close();
  return null;
}

/* -------------------------------------------------------------------------- */
/* phase 1 -- plan                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Vet every path and work out what would actually move. One lstat per path,
 * no deletion. Reports progress because vetting 200k paths is itself slow
 * enough to look like a freeze.
 *
 * @returns {Promise<{plan: Array, failed: Array, totalBytes: number, cancelled: boolean}>}
 */
async function planTrash(targets, options = {}, handlers = {}) {
  const opts = { allowDirectories: false, checkPermissions: true, checkConcurrency: 8, ...options };
  const token = handlers.token || new CancelToken();
  const started = Date.now();

  const list = Array.isArray(targets) ? targets : [targets];
  const plan = [];
  const failed = [];
  const seen = new Set();
  let totalBytes = 0;
  let checked = 0;

  const emit = throttle(() => {
    if (handlers.onProgress) {
      handlers.onProgress({
        phase: 'checking',
        done: checked,
        total: list.length,
        bytes: totalBytes,
        elapsedMs: Date.now() - started,
      });
    }
  }, 120);

  /* -- stage 1: string checks and de-duplication, no I/O ------------------ */

  const candidates = [];
  for (const raw of list) {
    // These two run against the caller's string, before resolve() -- resolving
    // first would turn a relative path into an absolute one and the
    // isAbsolute guard could never fire.
    if (typeof raw !== 'string' || raw.trim() === '') {
      failed.push({ path: raw, error: 'Not a valid path' });
      continue;
    }
    if (!path.isAbsolute(raw)) {
      failed.push({ path: raw, error: 'Path must be absolute' });
      continue;
    }

    const target = path.resolve(raw);

    // Silently collapse duplicates in the request rather than failing the
    // second copy with "no longer exists".
    const key = pathKey(target);
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push(target);
  }

  /* -- stage 2: guards and permission probe, concurrent ------------------- */

  const vetted = await pool(candidates, opts.checkConcurrency, async (target) => {
    if (token.cancelled) return null;

    const { error, stats } = await vet(target, opts);
    checked++;
    if (error) return { path: target, error };

    if (opts.checkPermissions !== false) {
      const denied = await probePermission(target, stats);
      if (denied) return { path: target, ...denied };
    }

    emit();
    return { path: target, size: stats.size };
  });

  for (const entry of vetted) {
    if (!entry) continue;
    if (entry.error) {
      failed.push(entry);
      continue;
    }
    totalBytes += entry.size;
    plan.push({ path: entry.path, size: entry.size });
  }

  const needsAdmin = failed.filter((f) => f.code === 'EPERM_ADMIN');
  const inUse = failed.filter((f) => f.code === 'EBUSY');

  return {
    plan,
    failed,
    needsAdmin,
    inUse,
    totalBytes,
    cancelled: token.cancelled,
    estimatedMs: Math.round((plan.length / ESTIMATED_FILES_PER_SEC) * 1000),
  };
}

/* -------------------------------------------------------------------------- */
/* phase 2 -- execute                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Move a vetted plan to the Recycle Bin, one item at a time, reporting after
 * each one so the UI can show a live count, rate and ETA.
 *
 * Runs sequentially on purpose: measured throughput is 28 files/s sequential
 * versus 33 files/s at eight-way concurrency, and sequential keeps progress
 * ordering, per-file error attribution and instant cancellation.
 *
 * @param {Array<{path: string, size: number}>} plan
 */
async function executeTrash(plan, options = {}, handlers = {}) {
  const opts = { ...options };
  const shell = opts.shell || require('electron').shell;
  const token = handlers.token || new CancelToken();
  const started = Date.now();

  const moved = [];
  const failed = [];
  let freedBytes = 0;

  const totalBytes = plan.reduce((n, item) => n + item.size, 0);

  // Rate over a trailing window rather than the whole run, so the ETA reacts
  // when the disk speeds up or slows down.
  const window = [];
  const WINDOW = 50;

  const report = (currentPath, force) => {
    if (!handlers.onProgress) return;

    const now = Date.now();
    const elapsedMs = now - started;

    let ratePerSec = 0;
    if (window.length >= 2) {
      const span = window[window.length - 1] - window[0];
      if (span > 0) ratePerSec = ((window.length - 1) / span) * 1000;
    } else if (elapsedMs > 0) {
      ratePerSec = (moved.length / elapsedMs) * 1000;
    }

    const remaining = plan.length - (moved.length + failed.length);
    const payload = {
      phase: 'deleting',
      done: moved.length + failed.length,
      moved: moved.length,
      failed: failed.length,
      total: plan.length,
      freedBytes,
      totalBytes,
      currentPath,
      ratePerSec,
      elapsedMs,
      etaMs: ratePerSec > 0 ? Math.round((remaining / ratePerSec) * 1000) : null,
    };

    if (force) emitNow(payload);
    else emitThrottled(payload);
  };

  const emitNow = (payload) => handlers.onProgress(payload);
  const emitThrottled = throttle((payload) => handlers.onProgress(payload), 150);

  for (const item of plan) {
    if (token.cancelled) break;

    if (opts.dryRun) {
      moved.push({ path: item.path, size: item.size, dryRun: true });
      freedBytes += item.size;
      continue;
    }

    try {
      await shell.trashItem(item.path);
      moved.push({ path: item.path, size: item.size });
      freedBytes += item.size;
    } catch (err) {
      failed.push({ path: item.path, error: err.message || 'Trash operation failed' });
    }

    window.push(Date.now());
    if (window.length > WINDOW) window.shift();

    report(item.path, false);
  }

  // Always finish on an exact final figure rather than a throttled one.
  if (handlers.onProgress) report(null, true);

  return {
    moved,
    failed,
    freedBytes,
    cancelled: token.cancelled,
    remaining: plan.length - (moved.length + failed.length),
    durationMs: Date.now() - started,
  };
}

/* -------------------------------------------------------------------------- */
/* combined                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Move paths to the OS trash / Recycle Bin.
 *
 * Deletion is never permanent: every path goes through Electron's
 * `shell.trashItem`, so items stay recoverable from the Recycle Bin. Paths that
 * fail a guard are reported in `failed` and left untouched; one bad path does
 * not stop the rest of the batch.
 *
 * @param {string[]} targets
 * @param {object}   [options]
 * @param {boolean}  [options.allowDirectories=false]
 * @param {boolean}  [options.dryRun=false]  vet and report, delete nothing
 * @param {object}   [options.shell]         injectable for tests
 * @param {object}   [handlers]              { onProgress, token }
 */
async function moveToTrash(targets, options = {}, handlers = {}) {
  const opts = { allowDirectories: false, dryRun: false, ...options };
  const list = Array.isArray(targets) ? targets : [targets];

  const planned = await planTrash(list, opts, handlers);
  const result = await executeTrash(planned.plan, opts, handlers);

  return {
    moved: result.moved,
    failed: [...planned.failed, ...result.failed],
    freedBytes: result.freedBytes,
    requested: list.length,
    dryRun: Boolean(opts.dryRun),
    cancelled: planned.cancelled || result.cancelled,
    remaining: result.remaining,
    durationMs: result.durationMs,
  };
}

module.exports = {
  moveToTrash,
  planTrash,
  executeTrash,
  vet,
  probePermission,
  ESTIMATED_FILES_PER_SEC,
};
