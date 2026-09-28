'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { CancelToken, pool, throttle, pathKey, isHiddenName, NOISE_DIR_NAMES } = require('./util');
const { collectFiles } = require('./scanner');
const { programComponentReason } = require('./advisor');
const folderDupes = require('./folder-dupes');
const docVersions = require('./doc-versions');

const DEFAULTS = {
  minSize: 1024, // ignore anything under 1 KB -- not worth the syscalls
  partialBytes: 64 * 1024, // cheap discriminator read from the head of the file
  hashConcurrency: 4, // disk-bound; more threads makes HDDs slower, not faster
  algorithm: 'sha256',
  progressMs: 120,
  useCache: true,
  cacheMaxEntries: 50000,
  // Whole folders that hold the same thing (F2). Off unless asked for: it
  // widens the walk to everything, which is a cost nobody should pay for a
  // search they did not ask for.
  folders: false,
  // Documents that look like versions of one another (F3). Reads names and
  // nothing else, so it is free once the walk has run -- measured on this
  // machine, grouping 3,833 documents took 0.01s.
  versions: false,
};

/**
 * Whether the ordinary file search would have seen this file (F2).
 *
 * When the folder pass is on, the walk is widened to everything -- hidden
 * names, `node_modules`, `.git` -- because "these two folders are identical"
 * is a claim about the real folder and not about the part of it the scan
 * likes to look at. The *file* half of the screen has to go on showing what
 * it always showed, so its list is filtered back out of the wide one rather
 * than the disk being walked a second time.
 */
function visibleToFileSearch(filePath, roots) {
  const root = roots.find((r) => {
    const key = pathKey(r);
    const here = pathKey(filePath);
    return here === key || here.startsWith(key.endsWith(path.sep) ? key : key + path.sep);
  });
  const rest = root ? filePath.slice(root.length) : filePath;
  for (const part of rest.split(/[\\/]/)) {
    if (part === '') continue;
    if (isHiddenName(part) || NOISE_DIR_NAMES.has(part.toLowerCase())) return false;
  }
  return true;
}

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
  // Every copy ranks the same unless the caller says otherwise, which
  // leaves the oldest-wins rule exactly as it was.
  const keeperRank = typeof opts.keeperRank === 'function' ? opts.keeperRank : () => 0;
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

  // With the folder pass on, one wide walk serves both halves: everything for
  // the folder comparison, and the part the file search has always shown,
  // filtered out of it. Copies-of-one-file (I3) never widens -- it is looking
  // for one file, not comparing folders.
  const wide = Boolean(opts.folders) && !target;
  // The version pass (F3) has a floor of its own, and it is far below the
  // file search's: 4 KB against a default of 100 KB. A Word draft is rarely
  // 100 KB, and a minimum size chosen for "which copies are worth deleting"
  // has no business deciding which documents exist. So the walk goes lower
  // when it is on, and the file half of the screen is filtered back out of
  // the result -- the same trick the folder pass uses, for the same reason.
  const floor = opts.versions && !target ? Math.min(opts.minSize, docVersions.MIN_BYTES) : opts.minSize;
  const walkOpts = wide
    ? { ...opts, minSize: 0, ignoreHidden: false, includeNoiseDirs: true }
    : floor === opts.minSize
      ? opts
      : { ...opts, minSize: floor };

  const { files: walked, errors: walkErrors, cancelled: walkCancelled } = await collectFiles(
    rootList,
    walkOpts,
    { token, onProgress: handlers.onProgress }
  );
  errors.push(...walkErrors);

  const allFiles = wide ? walked : null;
  const files = wide || floor !== opts.minSize
    ? walked.filter((f) => f.size >= opts.minSize && (!wide || visibleToFileSearch(f.path, rootList)))
    : walked;
  // What pass 5 reads names from: everything the walk saw that the file
  // search would have been willing to look at, with only its size floor
  // lifted. Hidden names and `node_modules` stay out either way -- a draft
  // is something a person made, and neither of those holds one.
  const docFiles = wide ? walked.filter((f) => visibleToFileSearch(f.path, rootList)) : walked;
  stats.indexedFiles = files.length;
  if (wide) stats.indexedForFolders = walked.length;

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

  /*
   * No early return here, and that is deliberate.
   *
   * An empty list means no two files share a size, which is a statement about
   * byte-identical copies and about nothing else. Passes 4 and 5 -- whole
   * folders, and documents that look like drafts of one another -- do not
   * depend on a single byte having been hashed, and pass 5 depends on nothing
   * but the names. Returning here used to skip both, so a folder of documents
   * that were all different sizes, which is most folders of documents, found
   * nothing however the search was set up.
   *
   * The two loops below simply do not run when there is nothing in them.
   */

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

  // Every full hash this pass computes, kept for the folder pass so a file
  // that is both a duplicate and part of a duplicate folder is read once.
  const known = new Map();

  const groups = [];
  for (const group of partialSurvivors) {
    if (token.cancelled) return finish(true);

    const tagged = await pool(group, opts.hashConcurrency, async (file) => {
      if (token.cancelled) return null;
      const key = HashCache.keyOf(file, `f${opts.algorithm}`);
      const cached = cache && cache.get(key);
      if (cached) {
        stats.cacheHits = cache.hits;
        known.set(pathKey(file.path), cached);
        return { ...file, hash: cached };
      }
      try {
        const digest = await hashFile(file.path, { algorithm: opts.algorithm, token });
        stats.filesHashed++;
        stats.bytesHashed += file.size;
        if (cache) cache.set(key, digest);
        known.set(pathKey(file.path), digest);
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
      // Which copy to suggest keeping (F1).
      //
      // The oldest, unless the caller ranks them -- it is the original, and
      // the copies are what somebody made of it. A caller that knows what
      // kind of drive each path is on can override that with `keeperRank`:
      // lower wins, and the oldest still breaks a tie. The rank comes from
      // outside because this file knows nothing about drives and should not
      // start to; `ipc.js` builds it from `lib/volumes.js`.
      bucket.sort((a, b) => keeperRank(a) - keeperRank(b) || a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));

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

  /* --- pass 4: whole folders (F2) ---------------------------------------- */

  let folderResult = null;
  if (wide && !token.cancelled) {
    folderResult = await folderDupes.findFolderDuplicates(
      allFiles,
      { ...opts, roots: rootList },
      {
        token,
        onProgress: handlers.onProgress
          ? (p) => handlers.onProgress({ elapsedMs: Date.now() - started, ...stats, ...p })
          : null,
        hashOf: hashForFolder,
      }
    );
  }

  /* --- pass 5: document versions (F3) ------------------------------------ */
  //
  // Names only, over the list the file search already has, so it opens
  // nothing and adds no walk. It runs on the narrow list rather than the wide
  // one: a draft is something a person made, and `node_modules` holds none.

  const versionResult = opts.versions && !target && !token.cancelled
    ? docVersions.findVersions(docFiles, opts)
    : null;

  return finish(token.cancelled, groups, folderResult, versionResult);

  /* ----------------------------------------------------------------------- */

  /**
   * The full hash of one file, for the folder pass.
   *
   * Three places are asked before the disk is: this run's own pass 3, the
   * persistent cache, and only then a read. Returns null rather than throwing
   * when the file cannot be read -- the folder pass treats an unreadable file
   * as a reason not to claim the folder, which is the safe direction.
   */
  async function hashForFolder(file) {
    const already = known.get(pathKey(file.path));
    if (already) return already;

    const key = HashCache.keyOf(file, `f${opts.algorithm}`);
    const cached = cache && cache.get(key);
    if (cached) {
      stats.cacheHits = cache.hits;
      known.set(pathKey(file.path), cached);
      return cached;
    }
    try {
      const digest = await hashFile(file.path, { algorithm: opts.algorithm, token });
      stats.filesHashed++;
      stats.bytesHashed += file.size;
      if (cache) cache.set(key, digest);
      known.set(pathKey(file.path), digest);
      emitHash('hashing-folders');
      return digest;
    } catch (err) {
      if (err.code !== 'ECANCELLED') {
        errors.push({ path: file.path, code: err.code || 'EHASH', message: err.message });
      }
      return null;
    }
  }

  /**
   * The folder pass, as something that can cross an IPC boundary (F2).
   *
   * Its nodes point at their parents, so they are a cycle and not a message.
   * This turns each one into a flat record, and while it is here it settles
   * two things the pass itself has no business deciding:
   *
   *   which copy is kept -- the same `keeperRank` F1 gave the file groups,
   *                         with the oldest breaking a tie, so a folder and
   *                         the files inside it never disagree about it
   *   which files are listed -- only those under a copy that is *not* the
   *                         keeper, because those are the only ones any
   *                         button will ever act on, and listing both sides
   *                         of a big folder doubles the message for nothing
   *
   * `budget` caps how many file records the whole reply may carry. A folder
   * past the cap is still reported, with `truncated` set, so the screen can
   * say "too many files to list here" instead of quietly offering half.
   */
  function projectFolders(result) {
    if (!result) return null;
    let budget = opts.maxFolderFiles ?? 20000;
    let truncatedFolders = 0;

    const order = (a, b) =>
      keeperRank({ path: a.path, size: a.bytes, mtimeMs: a.oldestMs }) -
        keeperRank({ path: b.path, size: b.bytes, mtimeMs: b.oldestMs }) ||
      a.oldestMs - b.oldestMs ||
      a.path.localeCompare(b.path);

    const summarise = (node) => ({
      path: node.path,
      bytes: node.bytes,
      fileCount: node.fileCount,
      newestMs: node.newestMs,
      oldestMs: node.oldestMs,
    });

    const listing = (records) => {
      if (records.length > budget) {
        truncatedFolders++;
        return { files: [], truncated: true };
      }
      budget -= records.length;
      return {
        files: records.map((e) => ({ path: e.path, rel: e.rel, size: e.size, mtimeMs: e.mtimeMs })),
        truncated: false,
      };
    };

    const exact = result.exact
      .map((group) => {
        const members = [...group.members].sort(order);
        return {
          id: group.content.slice(0, 16),
          bytes: members[0].bytes,
          fileCount: members[0].fileCount,
          count: members.length,
          wastedBytes: members[0].bytes * (members.length - 1),
          members: members.map((node, i) => ({
            ...summarise(node),
            keeper: i === 0,
            ...(i === 0 ? { files: [], truncated: false } : listing(folderDupes.entriesOf(node))),
          })),
        };
      })
      .sort((a, b) => b.wastedBytes - a.wastedBytes);

    const near = result.near.map((pair) => {
      const [keep, other] = [pair.a, pair.b].sort(order);
      // `left` is always the `a` side of the comparison; when the keeper came
      // out as `b`, the copy being offered up is the `left` one.
      const flip = keep === pair.b;
      const fromOther = pair.same.map((e) => (flip ? e.left : e.right));
      return {
        id: `${pathKey(keep.path)}|${pathKey(other.path)}`.slice(0, 32),
        ratio: pair.ratio,
        matched: pair.matched,
        differing: pair.differing,
        unreadable: pair.unreadable,
        sameBytes: pair.sameBytes,
        keep: summarise(keep),
        other: { ...summarise(other), ...listing(fromOther) },
        // "Only here" is named from the copy being kept, so the two columns
        // on screen are always in the same order as the two folders above them.
        compare: {
          onlyKeep: flip ? pair.compare.onlyRight : pair.compare.onlyLeft,
          onlyOther: flip ? pair.compare.onlyLeft : pair.compare.onlyRight,
          changed: pair.compare.changed,
          truncated: pair.compare.truncated,
        },
      };
    });

    return {
      exact,
      near,
      totalFolderGroups: exact.length,
      folderReclaimableBytes: exact.reduce((n, g) => n + g.wastedBytes, 0),
      nearReclaimableBytes: near.reduce((n, p) => n + p.sameBytes, 0),
      foldersIndexed: result.folders,
      shapeGroups: result.shapeGroups,
      nearProposed: result.nearProposed,
      nestedDropped: result.nestedDropped,
      unreadableFolders: result.unreadable.length,
      truncatedFolders,
      durationMs: result.durationMs,
    };
  }

  async function finish(cancelled, resultGroups = [], folderResult = null, versionResult = null) {
    if (cache) await cache.save(opts.cacheMaxEntries);
    if (cache) stats.cacheHits = cache.hits;

    return {
      roots: rootList,
      copiesOf: target ? target.path : null,
      folders: projectFolders(folderResult),
      // Documents that look like versions of one another (F3), already flat.
      versions: versionResult,
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
