'use strict';

const crypto = require('node:crypto');
// Not `node:fs`: inside Electron that one calls every `.asar` archive a folder,
// and this scan used to skip them all as "not a file"; and a directory entry
// calls OneDrive's folder a link, so a scan of the home folder skipped all of
// OneDrive. See real-fs.js.
const { fs, fsp, entryKind } = require('./real-fs');
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
  SYSTEM_DIR_NAMES,
  NOISE_DIR_NAMES,
} = require('./util');
const {
  Advisor,
  tagDirectory,
  looksLikeProject,
  looksLikeInstalledApp,
  looksLikeAppData,
} = require('./advisor');
const { message: m } = require('../../i18n');

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
  // The per-folder tree a snapshot is made of. Off unless asked for: the
  // unattended cleanup scans the same way and has no use for it.
  collectTree: false,
  // Files at least this big are named in the tree, up to this many per folder.
  // Everything else is only counted, so a snapshot of a home folder stays a
  // few hundred kilobytes rather than a list of every file in it.
  treeBigFileBytes: 10 * 1024 * 1024,
  treeBigPerDir: 10,
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
          found = {
            kind: 'hard',
            reason: m('blocked.roaming', 'Roaming application data — settings, accounts and sessions live here'),
          };
        } else if (blockedHere === 'none' && looksLikeAppData(entries)) {
          found = { kind: 'app', reason: m('blocked.appData', "An installed program's data folder") };
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

        // What the entry is, asked of the file when the entry says "link":
        // OneDrive's folder is a reparse point that is not a link.
        const kind = await entryKind(entry, full);
        if (kind === 'link' && !opts.followSymlinks) continue;

        if (kind === 'dir') {
          if (depth + 1 > depthLimit) continue;

          const skip = skipReason(name, full, opts);
          if (skip) {
            if (onSkip) onSkip(full, skip);
            continue;
          }

          // An extra refusal the caller supplies, on top of the built-in ones.
          // The media scan uses it to stay out of AppData and out of the
          // thousand-icon asset folders that an extracted archive leaves in
          // Downloads -- exclusions that would be wrong for a disk-usage scan,
          // whose whole job is to report where the space went. Unset by every
          // existing caller, so their behaviour is exactly what it was.
          if (opts.excludeDir) {
            const refused = opts.excludeDir(name, full, entries);
            if (refused) {
              if (onSkip) onSkip(full, refused);
              continue;
            }
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

        if (kind !== 'file') continue;
        if (opts.ignoreHidden && isHiddenName(name)) continue;

        // `statFiles: false` hands the entry over unmeasured.
        //
        // The disk-usage scan needs the size of every file and takes it here,
        // one at a time, which is right when the work that follows is a running
        // total. The media scan does not: it filters on the extension first and
        // then opens the survivors anyway, so a stat taken here is a syscall
        // spent on files it is about to discard -- and, worse, spent in a loop
        // that is sequential *within a directory*. A folder of 3,343
        // screenshots, which is a real folder on the machine this was written
        // on, is therefore 3,343 stats deep on one worker while fifteen others
        // have nothing to do.
        if (opts.statFiles === false) {
          onFile(full, null, top, tag, blockedHere);
          continue;
        }

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

  // dir -> { bytes, files, big } -- what each folder holds directly. Totals
  // for a folder and everything under it are sums over this, so they are not
  // stored twice.
  const tree = opts.collectTree ? new Map() : null;
  let excluded = 0;

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

    if (tree) {
      const dir = path.dirname(full);
      let row = tree.get(dir);
      if (!row) {
        row = { bytes: 0, files: 0, big: null };
        tree.set(dir, row);
      }
      row.bytes += size;
      row.files++;
      if (size >= opts.treeBigFileBytes) {
        if (!row.big) row.big = [];
        // The access time and the verdict ride along for the window's map of
        // the folder, where a file is a tile somebody can select, and so has
        // to arrive as a candidate. The snapshot drops both (treeRows): it is
        // a record of what was on the disk, not of what this version of the
        // rules thought of it.
        row.big.push([path.basename(full), size, stats.mtimeMs, stats.atimeMs, verdict]);
        if (row.big.length > opts.treeBigPerDir * 4) trimBig(row, opts.treeBigPerDir);
      }
    }

    largest.push({
      path: full,
      size,
      mtimeMs: stats.mtimeMs,
      atimeMs: stats.atimeMs,
      verdict: verdict ? verdict.verdict : 'keep',
      reason: verdict ? verdict.reason : null,
      category: verdict ? verdict.category : null,
      source: verdict ? verdict.source : null,
    });
    if (largest.length >= keep * 4) trimLargest();

    emit();
  };

  const onSkip = (full, reason) => {
    if (reason.kind === 'system') {
      excluded++;
      advisor.addProtected(full, reason.reason);
    }
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
    // `none` so the window can say "(no extension)" in the reader's language;
    // `ext` keeps the English, which is what the history file has always held.
    .map(([ext, v]) => ({ ext: ext || '(no extension)', none: !ext, size: v.size, count: v.count }))
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
    // How many system locations were refused, and a fingerprint of the rules
    // that refused them -- two snapshots are only comparable if both match.
    excluded,
    rules: rulesFingerprint(opts),
    ...(tree ? treeResult(root, tree, opts) : {}),
  };
}

function trimBig(row, keep) {
  row.big.sort((a, b) => b[1] - a[1]);
  row.big.length = Math.min(row.big.length, keep);
}

/**
 * The tree, twice over.
 *
 * `tree` is what a snapshot stores: one row per folder that holds files,
 * `[relativePath, bytes, files, [[name, size, mtimeMs], …]]`, largest first.
 *
 * `treeFiles` is what only this process keeps: for every file named in
 * `tree`, the access time and the advisor's verdict, by full path. The map of
 * the folder needs them to offer a tile as a candidate; a snapshot has no use
 * for an opinion the next version of the rules may not share.
 */
function treeResult(root, tree, opts) {
  const rows = [];
  const files = new Map();
  for (const [dir, row] of tree) {
    if (row.big) trimBig(row, opts.treeBigPerDir);
    const big = [];
    for (const [name, size, mtimeMs, atimeMs, verdict] of row.big || []) {
      big.push([name, size, mtimeMs]);
      files.set(path.join(dir, name), {
        atimeMs,
        verdict: verdict ? verdict.verdict : 'keep',
        reason: verdict ? verdict.reason : null,
        category: verdict ? verdict.category : null,
        source: verdict ? verdict.source : null,
      });
    }
    rows.push([path.relative(root, dir), row.bytes, row.files, big]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  return { tree: rows, treeFiles: files, bigFileBytes: opts.treeBigFileBytes, bigPerDir: opts.treeBigPerDir };
}

/**
 * What the walk was told to skip, as a short hash.
 *
 * A scan that skipped hidden folders and one that did not measure different
 * things, and so do two versions of the app with different lists of noise
 * folders. A snapshot carries this so a comparison between two such scans can
 * refuse itself instead of reporting the difference in rules as growth.
 */
function rulesFingerprint(opts) {
  const basis = JSON.stringify({
    followSymlinks: Boolean(opts.followSymlinks),
    ignoreHidden: Boolean(opts.ignoreHidden),
    excludeSystem: Boolean(opts.excludeSystem),
    maxDepth: Number.isFinite(opts.maxDepth) ? opts.maxDepth : 'none',
    system: [...SYSTEM_DIR_NAMES].sort(),
    noise: [...NOISE_DIR_NAMES].sort(),
  });
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12);
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
