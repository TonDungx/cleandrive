'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');

const { walk } = require('../scanner');
const { CancelToken, throttle, pool, pathKey } = require('../util');
const { message: m } = require('../../../i18n');

const format = require('./format');
const probe = require('./probe');
const roots = require('./roots');
const { MediaCache } = require('./cache');

/**
 * Phase one: find every photograph and video, and say what each one is, fast
 * enough that the list is usable rather than waited for.
 *
 * ## Why there are no worker threads here
 *
 * The plan called for a worker pool the size of the CPU count, and that was
 * the reasonable guess. It was measured instead, on 6,000 real files:
 *
 * | approach                      | throughput      |
 * | ----------------------------- | --------------- |
 * | one file at a time            |    539 files/s  |
 * | main thread, 8 concurrent     |  2,622 files/s  |
 * | main thread, 16 concurrent    | 17,751 files/s  |
 * | main thread, 32 concurrent    | 16,304 files/s  |
 * | 8 worker threads × 4          | 26,201 files/s  |
 *
 * The workers *are* faster -- about one and a half times. They are also not
 * needed: the main thread alone puts fifty thousand files at **2.8 seconds**,
 * which is the budget. What the extra second would have cost is a second copy
 * of this module's dependencies in each of eight threads (roughly 240 MB of
 * resident memory on an app that measures its own footprint in single digits),
 * a serialisation boundary for every record, cancellation that has to cross
 * thread boundaries, and a file that cannot be tested the way everything else
 * here is.
 *
 * The cliff between 8 and 16 is the real lesson in that table, and it is not
 * about threads at all: `main.js` raises `UV_THREADPOOL_SIZE` to 16, and
 * anything below that simply leaves libuv's I/O threads idle. The concurrency
 * below is chosen to saturate them.
 *
 * If a machine is ever found where this misses the budget, the table above is
 * the argument for revisiting it, and `probe.js` is already written to run
 * inside a worker -- it requires neither Electron nor any of the app's state.
 *
 * ## Where the time actually went
 *
 * `npm run bench:media` projects the whole of this onto fifty thousand files.
 * Two rounds of that moved the number a long way, and both moves came from the
 * measurement rather than from reading the code:
 *
 * | change                                          | cold  | already scanned |
 * | ----------------------------------------------- | ----- | --------------- |
 * | first working version                           | 11.8s |            6.6s |
 * | stat in the probe pool, not in the walk         |  8.7s |            0.4s |
 * | concurrency 48 rather than 24                   |  5.3s |            0.4s |
 *
 * The first was the surprise. `walk` stats files one at a time *within* a
 * directory, so a single folder holding 3,343 screenshots -- a real folder on
 * the machine this was written on -- pinned one worker for six seconds while
 * fifteen others had nothing to do. Handing the walk `statFiles: false` and
 * doing it in the pool below spread the same syscalls across all of them, and
 * took the walk from 6.6 seconds to 0.4.
 */

const DEFAULTS = {
  /**
   * Forty-eight, measured, on a machine whose `UV_THREADPOOL_SIZE` is 16.
   *
   * Three times the thread count sounds wrong and is not: each file costs four
   * syscalls -- stat, open, read the head, read the alternate data stream --
   * and a request only occupies a thread while it is actually in the kernel.
   * Measured: 7,689 files/s at 16-way, 9,045 at 24, 10,055 at 48, 9,980 at 96.
   * The optimum moved up from 24 when the stat moved into this pool, which is
   * exactly the shape you would expect and exactly why it is measured.
   */
  concurrency: 48,

  /**
   * How often a batch of finished records is handed to the UI. Small enough
   * that a grid starts filling almost immediately, large enough that the IPC
   * cost stays in the noise.
   */
  batchSize: 256,

  progressMs: 120,
  useCache: true,
  cachePath: null,

  /** Filter out folders that are plainly unpacked archives of interface assets. */
  hideAssetFolders: true,
};

/**
 * @param {string[]} rootPaths
 * @param {object} [options]
 * @param {object} [handlers]  { onProgress, onBatch, token }
 */
async function scanMedia(rootPaths, options = {}, handlers = {}) {
  const opts = { ...DEFAULTS, ...options };
  const token = handlers.token || new CancelToken();
  const started = Date.now();

  const list = independentRoots(Array.isArray(rootPaths) ? rootPaths : [rootPaths]);
  const cache = opts.useCache && opts.cachePath ? await new MediaCache(opts.cachePath).load() : null;

  /** Every media file the walk found, before anything is read. */
  const candidates = [];
  const excluded = [];
  const excludedKeys = new Set();
  const errors = [];
  let walkedFiles = 0;

  // Declared here rather than beside the probe loop they belong to, because
  // `finish` closes over them and a cancel during the *walk* reaches `finish`
  // before that loop has been entered. With the declarations further down, a
  // scan stopped in its first second threw `Cannot access 'records' before
  // initialization` -- which the user would have seen as the scan failing
  // rather than as the scan stopping, which is what they asked for.
  const records = [];
  const liveKeys = new Set();
  let batch = [];

  const stats = {
    walkedFiles: 0,
    mediaFiles: 0,
    probed: 0,
    fromCache: 0,
    unreadable: 0,
    dehydrated: 0,
    walkMs: 0,
    probeMs: 0,
  };

  const emit = throttle((phase) => {
    if (!handlers.onProgress) return;
    handlers.onProgress({
      phase,
      walked: stats.walkedFiles,
      media: stats.mediaFiles,
      probed: stats.probed,
      fromCache: stats.fromCache,
      elapsedMs: Date.now() - started,
    });
  }, opts.progressMs);

  /**
   * Folders the walk refused, grouped by why.
   *
   * Listed individually this is useless: a first run reported two hundred rows
   * and the first eight of them all said `__pycache__`. What the user wants to
   * know is "which kinds of place did you not look, and how many were there",
   * with enough examples to recognise one. So the reason is the row and the
   * paths are examples underneath it.
   */
  const noteExcluded = (dir, reason) => {
    const key = dir.toLowerCase();
    if (excludedKeys.has(key)) return;
    excludedKeys.add(key);

    const reasonKey = reason && reason.i18n ? reason.i18n : String(reason);
    let group = excluded.find((g) => g.key === reasonKey);
    if (!group) {
      group = { key: reasonKey, reason, count: 0, examples: [] };
      excluded.push(group);
    }
    group.count += 1;
    if (group.examples.length < 5) group.examples.push({ path: dir, name: path.basename(dir) });
  };

  /* -- the walk ---------------------------------------------------------- */

  const walkStarted = Date.now();

  for (const root of list) {
    if (token.cancelled) break;

    const result = await walk(
      root,
      {
        ...opts,
        // Photographs live in folders whose names people chose, and a folder
        // beginning with a dot is a program's. The disk-usage scan skips hidden
        // entries for the same reason and this one keeps that.
        ignoreHidden: true,
        excludeSystem: true,
        excludeDir: roots.excludeDir,

        // The walk hands over names, not measurements. Two reasons, and the
        // second is the one that showed up in the benchmark:
        //
        //   - the extension decides whether a file is media at all, and on this
        //     machine only a quarter of what is walked survives that test, so
        //     stat'ing first spends three syscalls in four on files about to be
        //     discarded;
        //   - `walk` stats sequentially within a directory, so one folder of
        //     3,343 screenshots pinned a single worker while the rest idled.
        //     Doing it in the probe pool below spreads the same work over
        //     twenty-four.
        statFiles: false,
      },
      {
        token,
        onSkip: (full, reason) => noteExcluded(full, reason.reason),
        onFile: (full) => {
          walkedFiles += 1;
          stats.walkedFiles = walkedFiles;

          const ext = extensionOf(full);
          if (!format.kindOfExtension(ext)) return;

          candidates.push(full);
          stats.mediaFiles = candidates.length;
          emit('walking');
        },
      }
    );

    errors.push(...result.errors);
    if (result.cancelled) break;
  }

  stats.walkMs = Date.now() - walkStarted;

  if (token.cancelled) {
    return finish(true);
  }

  /* -- the probe --------------------------------------------------------- */

  const probeStarted = Date.now();

  const flushBatch = () => {
    if (batch.length === 0) return;
    if (handlers.onBatch) handlers.onBatch(batch);
    batch = [];
  };

  await pool(candidates, opts.concurrency, async (filePath) => {
    if (token.cancelled) return null;

    // Measured here rather than during the walk, so the stats for fifty
    // thousand files are taken twenty-four at a time instead of one at a time
    // inside whichever directory happens to hold most of them.
    let file;
    try {
      const fileStats = await fsp.lstat(filePath);
      if (!fileStats.isFile()) return null;
      file = {
        path: filePath,
        size: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
        atimeMs: fileStats.atimeMs,
        birthtimeMs: fileStats.birthtimeMs,
        // Carried because it is the only evidence Node gives that a file's
        // bytes are not actually on this disk. See `cloud.js`.
        blocks: fileStats.blocks,
      };
    } catch (err) {
      if (errors.length < 500) {
        errors.push({ path: filePath, code: err.code || 'ESTAT', message: err.message });
      }
      return null;
    }

    const key = MediaCache.keyOf(file);
    liveKeys.add(key);

    let record = cache ? cache.get(key) : null;
    if (record) {
      stats.fromCache += 1;
    } else {
      record = await probe.probeFile(file.path, file);
      if (cache) cache.set(key, record);
    }

    stats.probed += 1;
    if (record.unread) stats.unreadable += 1;
    if (record.dehydrated) stats.dehydrated += 1;

    records.push(record);
    batch.push(record);
    if (batch.length >= opts.batchSize) flushBatch();

    emit('reading');
    return record;
  });

  flushBatch();
  stats.probeMs = Date.now() - probeStarted;

  return finish(token.cancelled);

  /* ----------------------------------------------------------------------- */

  async function finish(cancelled) {
    // A cancelled scan still saves what it learned. The cache is keyed on
    // content, so a half-finished scan's entries are exactly as valid as a
    // finished one's -- and throwing them away would make "stop, then start
    // again" slower than never having stopped.
    if (cache) {
      if (!cancelled) cache.prune(liveKeys);
      await cache.save();
    }

    const folders = groupByFolder(records);
    const assetFolders = opts.hideAssetFolders ? findAssetFolders(folders) : new Map();

    for (const [dir, reason] of assetFolders) noteExcluded(dir, reason);

    const visible = records.filter((r) => !assetFolders.has(path.dirname(r.path).toLowerCase()));

    // Most refused folders first: "1,847 dependency folders" is the useful
    // sentence, and it is the one that would otherwise be buried.
    excluded.sort((a, b) => b.count - a.count);

    return {
      roots: list,
      files: visible,
      hidden: records.length - visible.length,
      excluded,
      folders: folders.size,
      errors,
      errorCount: errors.length,
      cancelled,
      stats: { ...stats, cache: cache ? cache.stats : null },
      totalBytes: visible.reduce((n, r) => n + r.size, 0),
      durationMs: Date.now() - started,
      scannedAt: started,
    };
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Drop roots that sit inside another root.
 *
 * The default list offers `Pictures` and `Pictures\Saved Pictures` as separate
 * switches, because they are separate ideas to a person choosing what to scan.
 * To the walk they are not: with both turned on, every file under Saved
 * Pictures was walked twice, appeared twice, and was counted twice in the
 * totals. The benchmark is what made it visible -- 4,110 files walked to find
 * 4,061 media in a tree that holds fewer than that.
 *
 * The comparison is on the normalised path with a separator appended, so
 * `…\Pictures2` is not read as being inside `…\Pictures`.
 */
function independentRoots(paths) {
  const resolved = [];
  const seen = new Set();

  for (const raw of paths) {
    if (!raw) continue;
    const full = path.resolve(raw);
    const key = pathKey(full);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ full, key });
  }

  // Shortest first, so a parent is always considered before its children.
  resolved.sort((a, b) => a.key.length - b.key.length);

  const kept = [];
  for (const candidate of resolved) {
    const inside = kept.some((parent) => candidate.key.startsWith(parent.key + path.sep));
    if (!inside) kept.push(candidate);
  }
  return kept.map((entry) => entry.full);
}

function groupByFolder(records) {
  const folders = new Map();
  for (const record of records) {
    const dir = path.dirname(record.path).toLowerCase();
    const bucket = folders.get(dir);
    if (bucket) bucket.push(record);
    else folders.set(dir, [record]);
  }
  return folders;
}

/**
 * Folders whose contents are an application's pictures rather than a person's.
 *
 * @returns {Map<string, object>} lowercased directory -> the reason, for display
 */
function findAssetFolders(folders) {
  const found = new Map();
  for (const [dir, records] of folders) {
    if (!roots.looksLikeAssetDump(records)) continue;
    found.set(
      dir,
      m('media.skip.assetDump', '{n} images here, almost all of them tiny — this is a program’s artwork, not a photo album', {
        n: records.length,
      })
    );
  }
  return found;
}

function extensionOf(filePath) {
  const ext = path.extname(filePath);
  return ext ? ext.slice(1).toLowerCase() : '';
}

module.exports = { scanMedia, DEFAULTS };
