'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { CancelToken, pool, throttle } = require('./util');
const { collectFiles } = require('./scanner');
const { programComponentReason } = require('./advisor');

const DEFAULTS = {
  minSize: 1024, // ignore anything under 1 KB -- not worth the syscalls
  partialBytes: 64 * 1024, // cheap discriminator read from the head of the file
  hashConcurrency: 4, // disk-bound; more threads makes HDDs slower, not faster
  algorithm: 'sha256',
  progressMs: 120,
  useCache: true,
  cacheMaxEntries: 50000,
};

/* -------------------------------------------------------------------------- */
/* hash cache                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Persistent path -> hash cache. A cached hash is only trusted when the file's
 * size AND mtime both still match, so an edited file is always re-hashed.
 */
class HashCache {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    this.dirty = false;
    this.hits = 0;
  }

  static keyOf(record, kind) {
    return `${kind}:${record.path}|${record.size}|${Math.round(record.mtimeMs)}`;
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.entries) {
        this.map = new Map(Object.entries(parsed.entries));
      }
    } catch {
      // Missing or corrupt cache is not an error -- start empty.
      this.map = new Map();
    }
    return this;
  }

  get(key) {
    const hit = this.map.get(key);
    if (hit) this.hits++;
    return hit;
  }

  set(key, hash) {
    this.map.set(key, hash);
    this.dirty = true;
  }

  async save(maxEntries) {
    if (!this.dirty) return;
    try {
      // Oldest insertions are dropped first (Map preserves insertion order).
      let entries = [...this.map.entries()];
      if (entries.length > maxEntries) entries = entries.slice(entries.length - maxEntries);

      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(
        this.file,
        JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }),
        'utf8'
      );
      this.dirty = false;
    } catch {
      // A cache we cannot persist is a lost optimisation, not a failure.
    }
  }
}

function defaultCachePath() {
  return path.join(os.homedir(), '.cleandrive', 'hash-cache.json');
}

/* -------------------------------------------------------------------------- */
/* hashing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Stream a file through a hash. With `limitBytes` set, only the first
 * `limitBytes` are read (used for the cheap partial-hash pass).
 *
 * @returns {Promise<string>} hex digest
 */
function hashFile(filePath, { algorithm = 'sha256', limitBytes = null, token } = {}) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath, {
      highWaterMark: 1024 * 1024,
      ...(limitBytes ? { start: 0, end: limitBytes - 1 } : {}),
    });

    stream.on('data', (chunk) => {
      if (token && token.cancelled) {
        stream.destroy();
        return;
      }
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('close', () => {
      if (token && token.cancelled) {
        reject(Object.assign(new Error('Operation cancelled'), { code: 'ECANCELLED' }));
      }
    });
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Group an array into a Map keyed by `keyFn`, keeping only buckets of 2+. */
function groupBySharedKey(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  for (const [key, bucket] of map) {
    if (bucket.length < 2) map.delete(key);
  }
  return map;
}

/** Windows paths name the same file whatever their case. */
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/* -------------------------------------------------------------------------- */
/* main entry point                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Find groups of byte-identical files under one or more root folders.
 *
 * Three passes, each cheaper than the one it feeds:
 *   1. group by exact size      -- no file reads at all
 *   2. hash the first 64 KB     -- eliminates same-size-different-content
 *   3. full SHA256              -- only for survivors of pass 2
 *
 * @param {string[]} roots
 * @param {object}   [options]
 * @param {object}   [handlers]  { onProgress, token }
 */
async function findDuplicates(roots, options = {}, handlers = {}) {
  const opts = { ...DEFAULTS, ...options };
  const token = handlers.token || new CancelToken();
  const started = Date.now();

  const rootList = Array.isArray(roots) ? roots : [roots];

  // `copiesOf`: the one file whose copies are wanted. Measured before anything
  // is walked; a file that is not there, or is not a file, is an answer of
  // its own rather than a search of the whole folder for nothing.
  let target = null;
  if (opts.copiesOf) {
    const st = await fsp.stat(opts.copiesOf);
    if (!st.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOTFILE' });
    target = { path: path.resolve(opts.copiesOf), size: st.size, mtimeMs: st.mtimeMs, atimeMs: st.atimeMs };
    // A copy of a small file is still a copy; the usual floor would hide it.
    opts.minSize = Math.min(opts.minSize, Math.max(1, st.size));
  }

  const cache = opts.useCache ? await new HashCache(opts.cachePath || defaultCachePath()).load() : null;

  const stats = {
    indexedFiles: 0,
    candidatesBySize: 0,
    candidatesAfterPartial: 0,
    filesHashed: 0,
    bytesHashed: 0,
    cacheHits: 0,
  };
  const errors = [];

  const report = (phase, extra = {}) => {
    if (handlers.onProgress) {
      handlers.onProgress({ phase, elapsedMs: Date.now() - started, ...stats, ...extra });
    }
  };

  /* --- pass 0: index ----------------------------------------------------- */

  const { files, errors: walkErrors, cancelled: walkCancelled } = await collectFiles(
    rootList,
    opts,
    { token, onProgress: handlers.onProgress }
  );
  errors.push(...walkErrors);
  stats.indexedFiles = files.length;

  if (token.cancelled || walkCancelled) return finish(true);

  /* --- pass 1: group by size -------------------------------------------- */

  report('grouping');
  let candidates;
  if (target) {
    // Copies of one file (I3, "Find duplicates of this file"): only the files
    // of its exact size can be copies of it, so only those are ever read.
    // The file itself goes in even if the walk left its folder out (a hidden
    // one, say) -- it is the one thing the person asked about.
    const same = files.filter((f) => f.size === target.size);
    if (!same.some((f) => samePath(f.path, target.path))) same.push(target);
    candidates = same.length > 1 ? [same] : [];
  } else {
    candidates = [...groupBySharedKey(files, (f) => f.size).values()];
  }
  stats.candidatesBySize = candidates.reduce((n, g) => n + g.length, 0);

  if (candidates.length === 0) return finish(false, []);

  /* --- pass 2: partial hash --------------------------------------------- */

  const emitHash = throttle(
    (phase) => report(phase, { total: stats.candidatesBySize }),
    opts.progressMs
  );

  const partialSurvivors = [];
  for (const group of candidates) {
    if (token.cancelled) return finish(true);

    // Below 2x the partial window a partial hash reads (almost) the whole file
    // anyway -- skip straight to the full hash.
    if (group[0].size <= opts.partialBytes * 2) {
      partialSurvivors.push(group);
      continue;
    }

    const tagged = await pool(group, opts.hashConcurrency, async (file) => {
      if (token.cancelled) return null;
      const key = HashCache.keyOf(file, `p${opts.partialBytes}`);
      const cached = cache && cache.get(key);
      if (cached) {
        stats.cacheHits = cache.hits;
        return { ...file, partial: cached };
      }
      try {
        const digest = await hashFile(file.path, {
          algorithm: opts.algorithm,
          limitBytes: opts.partialBytes,
          token,
        });
        stats.filesHashed++;
        stats.bytesHashed += Math.min(file.size, opts.partialBytes);
        if (cache) cache.set(key, digest);
        emitHash('hashing-partial');
        return { ...file, partial: digest };
      } catch (err) {
        if (err.code !== 'ECANCELLED') errors.push({ path: file.path, code: err.code || 'EHASH', message: err.message });
        return null;
      }
    });

    const usable = tagged.filter(Boolean);
    for (const bucket of groupBySharedKey(usable, (f) => f.partial).values()) {
      partialSurvivors.push(bucket);
    }
  }

  if (token.cancelled) return finish(true);
  stats.candidatesAfterPartial = partialSurvivors.reduce((n, g) => n + g.length, 0);

  /* --- pass 3: full hash ------------------------------------------------- */

  const groups = [];
  for (const group of partialSurvivors) {
    if (token.cancelled) return finish(true);

    const tagged = await pool(group, opts.hashConcurrency, async (file) => {
      if (token.cancelled) return null;
      const key = HashCache.keyOf(file, `f${opts.algorithm}`);
      const cached = cache && cache.get(key);
      if (cached) {
        stats.cacheHits = cache.hits;
        return { ...file, hash: cached };
      }
      try {
        const digest = await hashFile(file.path, { algorithm: opts.algorithm, token });
        stats.filesHashed++;
        stats.bytesHashed += file.size;
        if (cache) cache.set(key, digest);
        emitHash('hashing-full');
        return { ...file, hash: digest };
      } catch (err) {
        if (err.code !== 'ECANCELLED') errors.push({ path: file.path, code: err.code || 'EHASH', message: err.message });
        return null;
      }
    });

    const usable = tagged.filter(Boolean);
    for (const [hash, bucket] of groupBySharedKey(usable, (f) => f.hash)) {
      // Copies of one file: the group it is in, and no other group of files
      // that merely happen to share its size with each other.
      if (target && !bucket.some((f) => samePath(f.path, target.path))) continue;
      // Oldest copy first -- that is the one suggested as the keeper.
      bucket.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));

      const groupFiles = bucket.map((f, i) => {
        // "Identical" does not mean "redundant". Two virtualenvs each holding
        // their own copy of the same library both need it; deleting one breaks
        // that environment. Such files stay visible but are never auto-selected.
        const protectionReason = programComponentReason(f.path);
        return {
          path: f.path,
          size: f.size,
          mtimeMs: f.mtimeMs,
          atimeMs: f.atimeMs,
          keeper: i === 0,
          protected: protectionReason !== null,
          protectionReason,
        };
      });

      const protectedCount = groupFiles.filter((f) => f.protected).length;
      const removable = groupFiles.filter((f) => !f.keeper && !f.protected);
      // Copies that "select all but the oldest" would have picked but skipped.
      // The keeper is excluded -- it was never going to be deleted anyway, so
      // counting it would overstate what the guard actually held back.
      const withheldCount = groupFiles.filter((f) => f.protected && !f.keeper).length;

      groups.push({
        hash,
        size: bucket[0].size,
        count: bucket.length,
        wastedBytes: bucket[0].size * (bucket.length - 1),
        // What "select all but the oldest copy" would actually reclaim here.
        selectableBytes: bucket[0].size * removable.length,
        protectedCount,
        withheldCount,
        allProtected: protectedCount === groupFiles.length,
        files: groupFiles,
      });
    }
  }

  groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
  return finish(token.cancelled, groups);

  /* ----------------------------------------------------------------------- */

  async function finish(cancelled, resultGroups = []) {
    if (cache) await cache.save(opts.cacheMaxEntries);
    if (cache) stats.cacheHits = cache.hits;

    return {
      roots: rootList,
      copiesOf: target ? target.path : null,
      groups: resultGroups,
      totalGroups: resultGroups.length,
      totalDuplicateFiles: resultGroups.reduce((n, g) => n + g.count - 1, 0),
      reclaimableBytes: resultGroups.reduce((n, g) => n + g.wastedBytes, 0),
      // What is actually safe to auto-select, once program components are
      // excluded. The gap between this and reclaimableBytes is the space the
      // app deliberately refuses to suggest.
      selectableBytes: resultGroups.reduce((n, g) => n + (g.selectableBytes || 0), 0),
      withheldFiles: resultGroups.reduce((n, g) => n + (g.withheldCount || 0), 0),
      ...stats,
      errors,
      errorCount: errors.length,
      cancelled,
      durationMs: Date.now() - started,
    };
  }
}

module.exports = { findDuplicates, hashFile, HashCache, defaultCachePath, DEFAULTS };
