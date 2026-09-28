'use strict';

/**
 * Whole folders that hold the same thing (F2).
 *
 * The file finder next door answers "are these two files the same bytes?".
 * This one answers a question people actually ask -- "is this whole copy of
 * my project, my photo import, my `node_modules` the same as that one?" --
 * and it has to answer it without reading the disk twice over.
 *
 * ## Three passes, and only the last one reads anything
 *
 *   1. index     the walk's file list becomes a tree of folders. No I/O.
 *   2. shape     every folder gets a signature over the *names and sizes* it
 *                holds, recursively. Two folders can only be identical if
 *                these match, and computing it costs nothing -- the walk
 *                already stat'd every file. Almost every folder is eliminated
 *                here, having been read exactly zero times.
 *   3. content   only the folders whose shapes agree are hashed, and then
 *                the answer is `certain` in the same sense the file screen
 *                means it: a full SHA-256 of every file on both sides.
 *
 * The near-duplicate pass (folders that are ≥ 90% the same) needs a fourth
 * idea, because by definition its folders have *different* shapes so pass 2
 * cannot pair them. It uses a bottom-k sketch -- the k smallest hashes of a
 * folder's `<relative path>|<size>` entries, merged upwards from the leaves
 * -- to *propose* pairs cheaply, and then verifies every proposal by hashing.
 * The sketch may propose a pair that turns out not to be near-identical; it
 * can never make the reported percentage wrong, because the percentage is
 * counted from the verification and not from the sketch.
 *
 * ## What this file does not know
 *
 * It does no I/O of its own: `hashOf` is handed in, so `lib/duplicate.js` can
 * feed it the hashes it already computed and the on-disk cache, and the
 * harness can feed it a table. It also knows nothing about drives, licences,
 * verdicts or actions -- those are `analyzers/duplicates.js` and `ipc.js`.
 *
 * ## Two folders are the same when their *files* are
 *
 * The comparison is over files and their relative paths, which is what the
 * spec asks for. A folder that exists on one side holding nothing at all does
 * not make the two different: it holds no bytes and there is nothing in it to
 * lose. `scripts/test-folder-dupes.js` pins that down rather than leaving it
 * to be discovered.
 */

const crypto = require('node:crypto');
const path = require('node:path');

const { pathKey } = require('./util');

const DEFAULTS = Object.freeze({
  /** Below this a "duplicate folder" is a row nobody wants; see `minFolderBytes` note. */
  minFolderBytes: 1024 * 1024,
  /** A folder of one file is a duplicate *file*, and that screen already has it. */
  minFolderFiles: 2,
  /** How alike two folders must be to be called near-duplicates. */
  nearRatio: 0.9,
  /**
   * The smallest folder a near-duplicate can be, left unset so it is derived
   * from `nearRatio` rather than guessed. See `nearFloor`.
   */
  nearMinFiles: null,
  /** Entries kept in a folder's sketch. Bigger costs memory, not accuracy. */
  sketchSize: 64,
  /** A sketch value in more folders than this says nothing; ignored. */
  sketchMaxFanout: 200,
  /** How many near-duplicate pairs are verified, biggest first. */
  nearMaxPairs: 200,
  /** Per side of a tree comparison, so one pair cannot be a megabyte of JSON. */
  compareLimit: 200,
});

const NUL = '\u0000';

/* -------------------------------------------------------------------------- */
/* pass 1: the tree                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The walk's flat file list, as folders.
 *
 * Only folders that hold at least one file (directly or below) get a node:
 * a folder with nothing in it has no bytes and nothing to act on.
 *
 * @param {Array<{path: string, size: number, mtimeMs: number}>} files
 * @param {string[]} roots  the folders the search was asked for
 * @returns {{byKey: Map<string, object>, nodes: object[]}}
 */
function indexFolders(files, roots = []) {
  const byKey = new Map();
  const rootKeys = roots.map((r) => pathKey(r));

  const nodeFor = (dir) => {
    const key = pathKey(dir);
    let node = byKey.get(key);
    if (node) return node;
    node = {
      path: dir,
      key,
      name: path.basename(dir),
      parent: null,
      dirs: [],
      files: [],
      fileCount: 0,
      bytes: 0,
      depth: 0,
      newestMs: 0,
      oldestMs: Infinity,
    };
    byKey.set(key, node);

    // Stop at a root, or where the path stops going up.
    if (!rootKeys.includes(key)) {
      const up = path.dirname(dir);
      if (pathKey(up) !== key) {
        const parent = nodeFor(up);
        node.parent = parent;
        node.depth = parent.depth + 1;
        parent.dirs.push(node);
      }
    }
    return node;
  };

  for (const file of files) {
    const node = nodeFor(path.dirname(file.path));
    node.files.push({
      name: path.basename(file.path),
      path: file.path,
      size: file.size,
      mtimeMs: file.mtimeMs,
    });
  }

  // Totals, rolled up from the leaves so each folder is visited once.
  for (const node of postOrder(byKey)) {
    let count = node.files.length;
    let bytes = 0;
    let newest = 0;
    let oldest = Infinity;
    for (const file of node.files) {
      bytes += file.size;
      if (file.mtimeMs > newest) newest = file.mtimeMs;
      if (file.mtimeMs < oldest) oldest = file.mtimeMs;
    }
    for (const child of node.dirs) {
      count += child.fileCount;
      bytes += child.bytes;
      if (child.newestMs > newest) newest = child.newestMs;
      if (child.oldestMs < oldest) oldest = child.oldestMs;
    }
    node.fileCount = count;
    node.bytes = bytes;
    node.newestMs = newest;
    node.oldestMs = oldest;
    node.files.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    node.dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  return { byKey, nodes: [...byKey.values()] };
}

/**
 * Every node, children before parents.
 *
 * Iterative on purpose: a path can be a couple of hundred levels deep and a
 * recursive roll-up would be a stack overflow rather than a result.
 */
function postOrder(byKey) {
  const roots = [...byKey.values()].filter((n) => !n.parent);
  const out = [];
  const stack = roots.map((n) => ({ node: n, opened: false }));
  while (stack.length) {
    const frame = stack.pop();
    if (frame.opened) {
      out.push(frame.node);
      continue;
    }
    frame.opened = true;
    stack.push(frame);
    for (const child of frame.node.dirs) stack.push({ node: child, opened: false });
  }
  return out;
}

/** True when `node` is somewhere below `ancestor`. */
function isBelow(node, ancestor) {
  for (let up = node.parent; up; up = up.parent) {
    if (up === ancestor) return true;
  }
  return false;
}

/**
 * Every file below a folder, with its path relative to that folder.
 *
 * Relative paths are compared case-insensitively, the way Windows compares
 * them, so `Photos\a.jpg` and `photos\A.JPG` are one entry and not two.
 */
function entriesOf(node) {
  const out = [];
  const stack = [{ node, prefix: '' }];
  while (stack.length) {
    const { node: here, prefix } = stack.pop();
    for (const file of here.files) {
      out.push({ ...file, rel: prefix + file.name, key: (prefix + file.name).toLowerCase() });
    }
    for (const child of here.dirs) stack.push({ node: child, prefix: `${prefix}${child.name}\\` });
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/* -------------------------------------------------------------------------- */
/* pass 2: shape                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A signature over what a folder holds, by name and size, recursively.
 *
 * No file is opened. This is the whole reason the content pass is affordable:
 * two folders whose shapes differ cannot possibly be identical, and on a real
 * disk that is nearly all of them.
 */
function shapeSignatures(index) {
  for (const node of postOrder(index.byKey)) {
    const h = crypto.createHash('sha1');
    for (const file of node.files) h.update(`f${NUL}${file.name.toLowerCase()}${NUL}${file.size}${NUL}`);
    // An empty folder contributes nothing, so a folder that exists on one side
    // and holds nothing does not make the two sides different.
    for (const child of node.dirs) {
      if (child.fileCount === 0) continue;
      h.update(`d${NUL}${child.name.toLowerCase()}${NUL}${child.shape}${NUL}`);
    }
    node.shape = h.digest('hex');
  }

  const byShape = new Map();
  for (const node of index.nodes) {
    if (node.fileCount === 0) continue;
    const bucket = byShape.get(node.shape);
    if (bucket) bucket.push(node);
    else byShape.set(node.shape, [node]);
  }
  for (const [shape, bucket] of byShape) {
    if (bucket.length < 2) byShape.delete(shape);
  }
  return byShape;
}

/* -------------------------------------------------------------------------- */
/* pass 3: content                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Hash the shape-matched folders and keep those that really agree.
 *
 * A shape match is a coincidence of names and sizes; this is the part that
 * makes `certain` true. A file that cannot be read drops its whole folder
 * out rather than being quietly treated as matching -- a folder is claimed
 * identical only when every file in it was read and agreed.
 *
 * @param {Map<string, object[]>} byShape
 * @param {object} handlers  { hashOf, token, onProgress }
 */
async function verifyShapes(byShape, handlers = {}, opts = DEFAULTS) {
  const { hashOf, token } = handlers;
  const groups = [];
  const unreadable = [];

  // Biggest first: if this is cancelled halfway, what it did read was the
  // part worth reading.
  const buckets = [...byShape.values()].sort(
    (a, b) => b[0].bytes * (b.length - 1) - a[0].bytes * (a.length - 1)
  );

  let done = 0;
  for (const bucket of buckets) {
    if (token && token.cancelled) break;
    if (bucket[0].bytes < opts.minFolderBytes || bucket[0].fileCount < opts.minFolderFiles) continue;

    const byContent = new Map();
    for (const node of bucket) {
      if (token && token.cancelled) break;
      const sig = await contentSignature(node, hashOf, token);
      if (sig === null) {
        unreadable.push(node.path);
        continue;
      }
      const had = byContent.get(sig);
      if (had) had.push(node);
      else byContent.set(sig, [node]);
    }

    for (const [content, members] of byContent) {
      if (members.length < 2) continue;
      groups.push({ content, shape: bucket[0].shape, members });
    }

    done++;
    // Every frame names its phase: the window looks the phase up to choose a
    // label, and a frame without one would leave the bar saying nothing.
    if (handlers.onProgress) handlers.onProgress({ phase: 'folders-content', done, total: buckets.length });
  }

  return { groups, unreadable };
}

/**
 * One hash standing for everything in a folder, or null if anything could
 * not be read.
 */
async function contentSignature(node, hashOf, token) {
  const h = crypto.createHash('sha1');
  for (const entry of entriesOf(node)) {
    if (token && token.cancelled) return null;
    const hash = await hashOf(entry);
    if (!hash) return null;
    h.update(`${entry.key}${NUL}${hash}${NUL}`);
  }
  return h.digest('hex');
}

/**
 * Keep only the outermost folder of each nest.
 *
 * When `A\` is a copy of `B\`, so is `A\sub\`, and reporting both says the
 * same space twice -- the plan on the Space Planner screen would add it up
 * twice too. A folder is dropped when some folder above it is already being
 * reported. Dropping can leave a group with one member, and a group of one
 * is not a duplicate, so it goes as well.
 */
function outermostOnly(groups) {
  const reported = new Set();
  for (const group of groups) for (const node of group.members) reported.add(node);

  const survives = (node) => {
    for (let up = node.parent; up; up = up.parent) {
      if (reported.has(up)) return false;
    }
    return true;
  };

  const kept = [];
  let droppedFolders = 0;
  for (const group of groups) {
    const members = group.members.filter(survives);
    droppedFolders += group.members.length - members.length;
    if (members.length >= 2) kept.push({ ...group, members });
    else droppedFolders += members.length;
  }
  return { groups: kept, droppedFolders };
}

/* -------------------------------------------------------------------------- */
/* pass 4: near-duplicates                                                     */
/* -------------------------------------------------------------------------- */

/** A 32-bit value for one entry, cheap and stable. */
function entryValue(key, size) {
  return crypto.createHash('sha1').update(`${key}${NUL}${size}`).digest().readUInt32BE(0);
}

/**
 * The k smallest entry values below each folder, merged up from the leaves.
 *
 * Two folders that share most of their entries share most of their bottom-k
 * values, so this finds candidate pairs without ever materialising a folder's
 * whole entry list. It is a filter and nothing more: every pair it proposes is
 * counted exactly afterwards.
 */
function sketches(index, k) {
  for (const node of postOrder(index.byKey)) {
    const merged = [];
    for (const file of node.files) merged.push(entryValue(file.name.toLowerCase(), file.size));
    for (const child of node.dirs) merged.push(...child.sketch);
    merged.sort((a, b) => a - b);
    // Duplicate values would let one repeated entry fill the sketch.
    const unique = [];
    for (const value of merged) {
      if (unique.length === 0 || unique[unique.length - 1] !== value) unique.push(value);
      if (unique.length >= k) break;
    }
    node.sketch = unique;
  }
}

/**
 * The fewest files a near-duplicate folder can hold, from the ratio alone.
 *
 * At 90%, a pair that is *nearly* the same rather than the same needs a
 * bigger side of at least ten files -- with nine, "90% or more but not all"
 * has no whole number in it -- and so a smaller side of at least nine. Below
 * that the only way to clear the bar is to be identical, and pass 3 has
 * already found those and said so with certainty. Derived rather than picked,
 * so changing the ratio cannot leave a stale number behind.
 */
function nearFloor(nearRatio) {
  const biggest = Math.ceil(1 / (1 - nearRatio));
  return { bigger: biggest, smaller: Math.ceil(nearRatio * biggest) };
}

/**
 * Pairs of folders that look alike enough to be worth counting exactly.
 *
 * A sketch value that turns up in hundreds of folders -- an empty marker file
 * of a common size, say -- distinguishes nothing and would make this quadratic
 * for no gain, so it is dropped.
 */
function proposePairs(candidates, opts) {
  const byValue = new Map();
  for (const node of candidates) {
    for (const value of node.sketch) {
      const bucket = byValue.get(value);
      if (bucket) bucket.push(node);
      else byValue.set(value, [node]);
    }
  }

  const counts = new Map();
  for (const bucket of byValue.values()) {
    if (bucket.length < 2 || bucket.length > opts.sketchMaxFanout) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        // A folder and its own ancestor share everything the child holds, and
        // that is not two copies of anything.
        if (isBelow(a, b) || isBelow(b, a)) continue;
        const id = a.key < b.key ? `${a.key}${NUL}${b.key}` : `${b.key}${NUL}${a.key}`;
        const had = counts.get(id);
        if (had) had.shared++;
        else counts.set(id, { a, b, shared: 1 });
      }
    }
  }

  // Half of the shorter sketch, and deliberately loose: this is a filter, and
  // a filter that is too tight throws away pairs nothing downstream will ever
  // reconsider. A folder small enough that its sketch *is* its whole entry
  // list must not be held to "every entry shared" -- that would be asking for
  // an exact match, which is pass 3's job and not this one's.
  return [...counts.values()]
    .filter((pair) => {
      const shortest = Math.min(pair.a.sketch.length, pair.b.sketch.length);
      return pair.shared >= Math.max(1, Math.floor(shortest * 0.5));
    })
    .sort((x, y) => Math.min(y.a.bytes, y.b.bytes) - Math.min(x.a.bytes, x.b.bytes))
    .slice(0, opts.nearMaxPairs);
}

/**
 * Count one proposed pair exactly, by hashing.
 *
 * "90% the same" is `matched / max(|A|, |B|)` by file count: a hundred extra
 * files on one side pull the figure down, which is the point. A file that is
 * at the same relative path on both sides but holds different bytes counts as
 * matching neither -- it is a difference, and the comparison names it as one.
 */
async function comparePair(a, b, handlers, opts) {
  const { hashOf, token } = handlers;
  const left = entriesOf(a);
  const right = entriesOf(b);
  const rightByKey = new Map(right.map((e) => [e.key, e]));

  const same = [];
  const changed = [];
  const onlyLeft = [];
  let unreadable = 0;

  for (const entry of left) {
    if (token && token.cancelled) return null;
    const other = rightByKey.get(entry.key);
    if (!other) {
      onlyLeft.push(entry);
      continue;
    }
    // Different sizes are different bytes, and nothing has to be read to
    // know it.
    if (other.size !== entry.size) {
      changed.push({ rel: entry.rel, left: entry, right: other });
      continue;
    }
    const [ha, hb] = [await hashOf(entry), await hashOf(other)];
    if (!ha || !hb) {
      unreadable++;
      changed.push({ rel: entry.rel, left: entry, right: other });
      continue;
    }
    if (ha === hb) same.push({ rel: entry.rel, left: entry, right: other });
    else changed.push({ rel: entry.rel, left: entry, right: other });
  }

  const leftKeys = new Set(left.map((e) => e.key));
  const onlyRight = right.filter((e) => !leftKeys.has(e.key));

  const ratio = same.length / Math.max(left.length, right.length);
  const cut = (list) => list.slice(0, opts.compareLimit);
  return {
    a,
    b,
    ratio,
    matched: same.length,
    differing: changed.length,
    onlyLeftCount: onlyLeft.length,
    onlyRightCount: onlyRight.length,
    unreadable,
    sameBytes: same.reduce((n, e) => n + e.left.size, 0),
    same,
    compare: {
      onlyLeft: cut(onlyLeft).map((e) => ({ rel: e.rel, bytes: e.size })),
      onlyRight: cut(onlyRight).map((e) => ({ rel: e.rel, bytes: e.size })),
      changed: cut(changed).map((e) => ({ rel: e.rel, bytes: e.left.size, otherBytes: e.right.size })),
      truncated:
        onlyLeft.length > opts.compareLimit ||
        onlyRight.length > opts.compareLimit ||
        changed.length > opts.compareLimit,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Folders that hold the same thing, and folders that nearly do.
 *
 * @param {Array<{path,size,mtimeMs}>} files  every file under the roots, with
 *        no size floor: a folder is not identical to another if it holds one
 *        extra 40-byte file, and a floor would hide exactly that.
 * @param {object} options
 * @param {object} handlers  { hashOf(entry) -> Promise<string|null>, token, onProgress }
 */
async function findFolderDuplicates(files, options = {}, handlers = {}) {
  const opts = { ...DEFAULTS, ...options };
  const roots = options.roots || [];
  const started = Date.now();
  const token = handlers.token;

  const index = indexFolders(files, roots);
  const report = (phase, extra) => {
    if (handlers.onProgress) handlers.onProgress({ phase, ...extra });
  };

  report('folders-shape', { folders: index.nodes.length });
  const byShape = shapeSignatures(index);

  report('folders-content', { shapeGroups: byShape.size });
  const verified = await verifyShapes(byShape, handlers, opts);
  const { groups: exactGroups, droppedFolders } = outermostOnly(verified.groups);

  /* --- near-duplicates ---------------------------------------------------- */

  // A folder already reported as an identical copy still has something to
  // say: a third folder that is 90% like it is an older version of the same
  // thing, and that is worth seeing. So one member of each identical group
  // stays available as the other half of a near-duplicate -- the same one
  // every time, by path, so two runs agree -- while its twins and everything
  // below any of them drop out, because pairing those would be the same
  // finding over and over.
  const inExact = new Set();
  for (const group of exactGroups) {
    const speaks = [...group.members].sort((a, b) => (a.key < b.key ? -1 : 1))[0];
    for (const node of group.members) {
      if (node !== speaks) inExact.add(node);
      const stack = [...node.dirs];
      while (stack.length) {
        const here = stack.pop();
        inExact.add(here);
        stack.push(...here.dirs);
      }
    }
  }

  let nearGroups = [];
  let nearProposed = 0;
  if (opts.near !== false && !(token && token.cancelled)) {
    const floor = nearFloor(opts.nearRatio);
    const minFiles = opts.nearMinFiles ?? floor.smaller;
    sketches(index, opts.sketchSize);
    const candidates = index.nodes.filter(
      (n) =>
        !inExact.has(n) &&
        n.fileCount >= Math.max(minFiles, opts.minFolderFiles) &&
        n.bytes >= opts.minFolderBytes
    );
    const pairs = proposePairs(candidates, opts);
    nearProposed = pairs.length;
    report('folders-near', { pairs: pairs.length });

    const used = new Set();
    let checked = 0;
    for (const pair of pairs) {
      if (token && token.cancelled) break;
      report('folders-near', { done: checked++, total: pairs.length });
      // One folder belongs to one near-duplicate row. Without this a folder
      // that is 90% like four others fills the screen with the same folder.
      if (used.has(pair.a) || used.has(pair.b)) continue;
      const compared = await comparePair(pair.a, pair.b, handlers, opts);
      if (!compared) break;
      if (compared.ratio < opts.nearRatio || compared.ratio >= 1) continue;
      used.add(pair.a);
      used.add(pair.b);
      nearGroups.push(compared);
    }
    nearGroups.sort((x, y) => y.sameBytes - x.sameBytes);
  }

  return {
    folders: index.nodes.length,
    shapeGroups: byShape.size,
    exact: exactGroups,
    near: nearGroups,
    nearProposed,
    nestedDropped: droppedFolders,
    unreadable: verified.unreadable,
    cancelled: Boolean(token && token.cancelled),
    durationMs: Date.now() - started,
  };
}

module.exports = {
  findFolderDuplicates,
  nearFloor,
  indexFolders,
  shapeSignatures,
  verifyShapes,
  outermostOnly,
  entriesOf,
  comparePair,
  sketches,
  proposePairs,
  isBelow,
  DEFAULTS,
};
