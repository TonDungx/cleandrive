'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const {
  CancelToken,
  throttle,
  skipReason,
  isHiddenName,
  extOf,
  accessTimesAreTracked,
  isProgramInstallPath,
  isRoamingAppData,
} = require('./util');
const {
  Advisor,
  tagDirectory,
  looksLikeProject,
  looksLikeInstalledApp,
  looksLikeAppData,
} = require('./advisor');

const DEFAULTS = {
  followSymlinks: false,
  ignoreHidden: true,
  excludeSystem: true,
  maxDepth: Infinity,
  concurrency: 16,
  topFilesKept: 200,
  // How many files per cleanup category the advisor hands back. The UI only
  // ever draws the biggest hundred, but an unattended cleanup acts on the list
  // rather than reading it, and a cache folder is tens of thousands of small
  // files -- capped at 100 it would free almost nothing.
  keepPerCategory: 100,
  progressMs: 120,
};

// Backstop against reparse-point loops when maxDepth is unlimited. A real
// user tree never gets this deep; a junction cycle does.
const HARD_DEPTH_CAP = 100;

/**
 * Breadth-first directory walk with bounded concurrency.
 *
 * Calls `onFile(fullPath, stats, topKey, dirTag)` for every regular file,
 * `onDir(fullPath, topKey, depth)` for every directory entered, and
 * `onSkip(fullPath, reason)` for every directory deliberately not entered.
 * Errors on individual entries are collected, not thrown -- a single unreadable
 * folder must not abort the scan.
 *
 * `dirTag` is the advisor's classification of the containing directory. It is
 * computed once when a directory is queued and inherited by everything below
 * it, so per-file classification stays O(1) even on a 500k-file tree.
 *
 * Symlinks and junctions are never followed (see `followSymlinks`), so each
 * file is visited at most once and sizes are not double-counted.
 *
 * @returns {Promise<{errors: Array, cancelled: boolean, dirs: number}>}
 */
function walk(root, options, handlers) {
  const opts = { ...DEFAULTS, ...options };
  const { onFile, onDir, onSkip, onBlocked, token = new CancelToken() } = handlers;

  return new Promise((resolve) => {
    const rootPath = path.resolve(root);
    const queue = [
      {
        dir: rootPath,
        top: null,
        depth: 0,
        tag: tagDirectory(path.basename(rootPath), null),
        blocked: 'none',
      },
    ];
    const errors = [];
    let active = 0;
    let dirs = 0;
    let settled = false;

    const depthLimit = Math.min(opts.maxDepth, HARD_DEPTH_CAP);

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ errors, cancelled: token.cancelled, dirs });
    };

    const recordError = (p, err) => {
      if (errors.length < 500) {
        errors.push({ path: p, code: err.code || 'UNKNOWN', message: err.message });
      }
    };

    async function processDir(task) {
      const { dir, top, depth, tag, blocked } = task;

      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        recordError(dir, err);
        return;
      }

      dirs++;
      if (onDir) onDir(dir, top, depth);

      // Decided once per directory from entries already in hand: it gates
      // whether a child named bin/obj/dist counts as disposable build output
      // or as an installed program's files.
      const isProject = tag ? false : looksLikeProject(entries);

      // Sticky, and it only ever tightens. 'hard' means nothing below may be
      // called safe; 'app' means only machine-generated GPU and crash
      // artifacts may be. Both an app's `out\` and its `Cache\` are
      // load-bearing, and its `Local Storage\...000003.log` is user data
      // that merely looks like a log file.
      let blockedHere = blocked;
      if (blockedHere !== 'hard') {
        let found = null;
        if (looksLikeInstalledApp(entries)) {
          found = { kind: 'hard', reason: 'This is an installed application' };
        } else if (isProgramInstallPath(dir)) {
          found = { kind: 'hard', reason: 'Inside the per-user program installation folder' };
        } else if (isRoamingAppData(dir)) {
          found = { kind: 'hard', reason: 'Roaming application data — settings, accounts and sessions live here' };
        } else if (blockedHere === 'none' && looksLikeAppData(entries)) {
          found = { kind: 'app', reason: "An installed program's data folder" };
        }
        if (found) {
          blockedHere = found.kind;
          if (onBlocked) onBlocked(dir, found.reason);
        }
      }

      for (const entry of entries) {
        if (token.cancelled) return;

        const name = entry.name;
        const full = path.join(dir, name);

        if (entry.isSymbolicLink() && !opts.followSymlinks) continue;

        if (entry.isDirectory()) {
          if (depth + 1 > depthLimit) continue;

          const skip = skipReason(name, full, opts);
          if (skip) {
            if (onSkip) onSkip(full, skip);
            continue;
          }

          // Everything under an immediate child of the root is attributed to
          // that child; files directly in the root carry top === null.
          queue.push({
            dir: full,
            top: depth === 0 ? full : top,
            depth: depth + 1,
            tag: tagDirectory(name, tag, isProject),
            blocked: blockedHere,
          });
          continue;
        }

        if (!entry.isFile()) continue;
        if (opts.ignoreHidden && isHiddenName(name)) continue;

        let stats;
        try {
          stats = await fsp.lstat(full);
        } catch (err) {
          recordError(full, err);
          continue;
        }
        if (!stats.isFile()) continue;

        onFile(full, stats, top, tag, blockedHere);
      }
    }

    function pump() {
      if (settled) return;

      if (token.cancelled) {
        queue.length = 0;
        if (active === 0) finish();
        return;
      }

      while (active < opts.concurrency && queue.length > 0) {
        const task = queue.shift();
        active++;
        processDir(task)
          .catch((err) => recordError(task.dir, err))
          .then(() => {
            active--;
            pump();
          });
      }

      if (active === 0 && queue.length === 0) finish();
    }

    pump();
  });
}

/**
 * Scan a folder and summarise where its disk space went.
 *
 * @param {string} rootPath          absolute folder to scan
 * @param {object} [options]         see DEFAULTS
 * @param {object} [handlers]
 * @param {(p: object) => void} [handlers.onProgress]
 * @param {CancelToken}         [handlers.token]
 */
async function scan(rootPath, options = {}, handlers = {}) {
  const opts = { ...DEFAULTS, ...options };
  const token = handlers.token || new CancelToken();
  const started = Date.now();
  const root = path.resolve(rootPath);

  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) {
    throw Object.assign(new Error(`Not a directory: ${root}`), { code: 'ENOTDIR' });
  }

  let totalSize = 0;
  let totalFiles = 0;
  let rootFilesSize = 0;

  const folders = new Map(); // topKey -> { size, fileCount }
  const types = new Map(); // ext    -> { size, count }
  let largest = [];
  const keep = opts.topFilesKept;

  // All ages in one scan are measured against a single instant, so two files
  // written a millisecond apart cannot land on different sides of a threshold.
  const advisor = new Advisor({ now: started, keepPerCategory: opts.keepPerCategory });

  const emit = throttle(() => {
    if (!handlers.onProgress) return;
    handlers.onProgress({
      phase: 'scanning',
      files: totalFiles,
      bytes: totalSize,
      elapsedMs: Date.now() - started,
    });
  }, opts.progressMs);

  const trimLargest = () => {
    largest.sort((a, b) => b.size - a.size);
    largest.length = Math.min(largest.length, keep);
  };

  const onFile = (full, stats, top, tag, blocked) => {
    const size = stats.size;
    totalSize += size;
    totalFiles++;

    if (top === null) {
      rootFilesSize += size;
    } else {
      const bucket = folders.get(top);
      if (bucket) {
        bucket.size += size;
        bucket.fileCount++;
      } else {
        folders.set(top, { size, fileCount: 1 });
      }
    }

    const ext = extOf(full);
    const t = types.get(ext);
    if (t) {
      t.size += size;
      t.count++;
    } else {
      types.set(ext, { size, count: 1 });
    }

    const record = {
      path: full,
      name: path.basename(full),
      ext,
      size,
      mtimeMs: stats.mtimeMs,
      atimeMs: stats.atimeMs,
    };

    const verdict = advisor.add(record, tag, blocked || 'none');

    largest.push({
      path: full,
      size,
      mtimeMs: stats.mtimeMs,
      atimeMs: stats.atimeMs,
      verdict: verdict ? verdict.verdict : 'keep',
      reason: verdict ? verdict.reason : null,
    });
    if (largest.length >= keep * 4) trimLargest();

    emit();
  };

  const onSkip = (full, reason) => {
    if (reason.kind === 'system') advisor.addProtected(full, reason.reason);
  };

  const onBlocked = (full, reason) => advisor.addAppFolder(full, reason);

  const [{ errors, cancelled, dirs }, accessTimes] = await Promise.all([
    walk(root, opts, { onFile, onSkip, onBlocked, token }),
    accessTimesAreTracked(),
  ]);

  trimLargest();

  const topFolders = [...folders.entries()]
    .map(([full, v]) => ({
      path: full,
      name: path.basename(full),
      size: v.size,
      fileCount: v.fileCount,
      percent: totalSize > 0 ? (v.size / totalSize) * 100 : 0,
    }))
    .sort((a, b) => b.size - a.size);

  if (rootFilesSize > 0) {
    topFolders.push({
      path: root,
      name: '(files in this folder)',
      size: rootFilesSize,
      fileCount: 0,
      percent: totalSize > 0 ? (rootFilesSize / totalSize) * 100 : 0,
      isLoose: true,
    });
    topFolders.sort((a, b) => b.size - a.size);
  }

  const byType = [...types.entries()]
    .map(([ext, v]) => ({ ext: ext || '(no extension)', size: v.size, count: v.count }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 25);

  return {
    root,
    totalSize,
    totalFiles,
    totalDirs: dirs,
    topFolders,
    byType,
    largestFiles: largest.slice(0, 100),
    cleanup: advisor.summary(),
    accessTimes,
    scannedAt: started,
    errors,
    errorCount: errors.length,
    cancelled,
    durationMs: Date.now() - started,
  };
}

/**
 * Collect file records for later processing (used by the duplicate finder).
 * Returns `{ files, errors, cancelled }` where each file is
 * `{ path, size, mtimeMs }`.
 */
async function collectFiles(rootPaths, options = {}, handlers = {}) {
  const opts = { ...DEFAULTS, ...options };
  const token = handlers.token || new CancelToken();
  const minSize = opts.minSize ?? 1;

  const files = [];
  const errors = [];
  let cancelled = false;
  const started = Date.now();

  const emit = throttle(() => {
    if (handlers.onProgress) {
      handlers.onProgress({
        phase: 'indexing',
        files: files.length,
        elapsedMs: Date.now() - started,
      });
    }
  }, opts.progressMs);

  for (const root of rootPaths) {
    if (token.cancelled) break;
    const result = await walk(root, opts, {
      token,
      onFile: (full, stats) => {
        if (stats.size < minSize) return;
        files.push({ path: full, size: stats.size, mtimeMs: stats.mtimeMs, atimeMs: stats.atimeMs });
        emit();
      },
    });
    errors.push(...result.errors);
    cancelled = cancelled || result.cancelled;
  }

  return { files, errors, cancelled };
}

module.exports = { scan, walk, collectFiles, DEFAULTS };
