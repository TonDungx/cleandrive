'use strict';

/**
 * "Did the developer already say this folder is scratch?"
 *
 * A folder called `dist` is not evidence of anything. Every vendored library
 * ships one, and a vendored library's `dist` is the product -- the file the
 * page loads. Measured on this machine (2026-09-26): a scan of
 * `D:\fda\fdaplus\frontend\app\base\static\vendors` classified **774 files,
 * 43.7 MB** as build output, among them `bootstrap.min.css.map`,
 * `echarts.min.js` and `Chart.js`, every one of them committed to git. The
 * rule that produced that was the obvious one -- a project file sits beside
 * the folder -- and it is wrong five times in thirteen, because a vendored
 * library always has a `package.json` beside it.
 *
 * What is not wrong is the developer's own `.gitignore`. A line saying
 * `dist/` is a person stating, in writing, that the folder is regenerated and
 * not worth keeping. Measured against the same thirteen folders, it was right
 * thirteen times, and across every build folder on D:\ it costs 112 ms and
 * 263 file reads -- because the walk only opens a `.gitignore` when the
 * listing it already holds shows one.
 *
 * It also earns the row a sentence that is true and checkable: *"your
 * .gitignore lists `dist/`"*. Nothing else here can say that.
 *
 * **This is deliberately not a git implementation.** It recognises folder
 * names, which is the entire question being asked, and nothing else:
 *
 *   dist         a folder of that name, at any depth below
 *   dist/        the same -- the trailing slash only means "a folder"
 *   /dist        that folder, directly in this one
 *   build/out/   that exact path below this one
 *   !dist        cancels an inherited rule for that name
 *
 * Globs (`*.log`, `build-*`), `**` and per-file rules are ignored rather than
 * half-understood: a pattern this cannot read makes a folder `review`, which
 * is the answer it would have given anyway without a `.gitignore`.
 */

const path = require('node:path');

const { fsp } = require('./real-fs');

/** Nothing declared anywhere above. Shared, because most folders get this. */
const EMPTY = Object.freeze({ floating: new Set(), negated: new Set(), anchored: new Set() });

/** A `.gitignore` bigger than this is not describing a build folder. */
const MAX_BYTES = 256 * 1024;

const key = (p) => p.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');

/**
 * One `.gitignore`'s lines, split into what they can mean for a folder.
 *
 * @param {string} text  the file
 * @param {string} dir   the folder it sits in
 */
function parse(text, dir) {
  const floating = [];
  const negated = [];
  const anchored = [];

  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // A trailing backslash escapes nothing useful here, and a pattern with a
    // glob in it is not a folder name this can be sure about.
    if (/[*?[\]]/.test(line)) continue;

    const neg = line.startsWith('!');
    if (neg) line = line.slice(1).trim();
    line = line.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!line || line === '.') continue;

    // Git's own rule: a slash anywhere but the end anchors the pattern to the
    // folder holding the file. Otherwise it matches at any depth below.
    const isAnchored = line.includes('/');
    if (isAnchored) {
      const resolved = path.resolve(dir, line.replace(/^\/+/, ''));
      // A pattern that climbs out of its own folder is not one of ours.
      if (key(resolved).startsWith(key(dir))) anchored.push({ path: key(resolved), neg, line: raw.trim() });
      continue;
    }
    (neg ? negated : floating).push({ name: line.toLowerCase(), line: raw.trim() });
  }

  return { floating, negated, anchored };
}

/**
 * Read the `.gitignore` in a folder and fold it into what was declared above.
 *
 * Only called when the listing already in hand shows the file, so a folder
 * without one costs nothing at all.
 *
 * @param {object} scope   what applies here, from the folder above
 * @param {string} dir     the folder whose `.gitignore` to read
 * @param {Function} [read]
 * @returns {Promise<object>}  the scope for everything below `dir`
 */
async function extend(scope, dir, read = fsp.readFile) {
  let text;
  try {
    const buf = await read(path.join(dir, '.gitignore'), 'utf8');
    text = String(buf).slice(0, MAX_BYTES);
  } catch {
    return scope;
  }

  const parsed = parse(text, dir);
  if (parsed.floating.length === 0 && parsed.negated.length === 0 && parsed.anchored.length === 0) return scope;

  const floating = new Map();
  for (const f of scope.floating) floating.set(f.name, f);
  const negated = new Map();
  for (const n of scope.negated) negated.set(n.name, n);
  const anchored = new Map();
  for (const a of scope.anchored) anchored.set(a.path, a);

  // Later files win over earlier ones, which is git's own order: the nearest
  // `.gitignore` to a folder is the one that decides.
  for (const f of parsed.floating) {
    floating.set(f.name, f);
    negated.delete(f.name);
  }
  for (const n of parsed.negated) {
    negated.set(n.name, n);
    floating.delete(n.name);
  }
  for (const a of parsed.anchored) anchored.set(a.path, a);

  return {
    floating: new Set(floating.values()),
    negated: new Set(negated.values()),
    anchored: new Set(anchored.values()),
  };
}

/**
 * Does anything above say this folder is scratch?
 *
 * @param {object} scope
 * @param {string} full   the folder's path
 * @param {string} name   its own name
 * @returns {{ignored: boolean, line: string|null}}
 */
function lookup(scope, full, name) {
  if (!scope) return { ignored: false, line: null };
  const k = key(full);
  for (const a of scope.anchored) {
    if (a.path === k) return { ignored: !a.neg, line: a.line };
  }
  const lower = String(name).toLowerCase();
  for (const n of scope.negated) {
    if (n.name === lower) return { ignored: false, line: n.line };
  }
  for (const f of scope.floating) {
    if (f.name === lower) return { ignored: true, line: f.line };
  }
  return { ignored: false, line: null };
}

/**
 * Stop a rule from one project reaching into a different project inside it.
 *
 * A pattern without a slash matches at any depth below the file that declared
 * it, which is git's rule and not a problem for git: git ignores nothing it is
 * already tracking, so a vendored library committed to the repository stays
 * put whatever the root `.gitignore` says. Reading the file alone cannot know
 * that, and the difference is not academic. `D:\fda\fdaplus` has a bare `bin`
 * in its `.gitignore` and a tree of vendored libraries under
 * `frontend\app\base\static\vendors`, every one of them committed; its author
 * had to comment out `#dist` and `#build` to keep them.
 *
 * So a floating rule stops at the edge of a nested project -- a folder holding
 * its own `package.json`, `Cargo.toml` and so on. Anchored rules survive,
 * because those name one exact path and cannot wander.
 *
 * This is narrower than git, deliberately. It means missing some real build
 * output inside a monorepo, which costs a little space, rather than offering
 * a library somebody committed, which costs their afternoon.
 */
function atNestedProject(scope) {
  if (!scope || scope.floating.size === 0) return scope;
  return { floating: new Set(), negated: scope.negated, anchored: scope.anchored };
}

/** True when the listing in hand holds a `.gitignore`, so it is worth a read. */
function listingHasIgnoreFile(entries) {
  for (const entry of entries) {
    if (entry.name === '.gitignore' && (typeof entry.isFile !== 'function' || entry.isFile())) return true;
  }
  return false;
}

/**
 * Every rule from a folder up to its repository root, for a caller that
 * arrives at one folder rather than walking down to it (the Developer
 * screen's project list). Folders are read outermost first, so the nearest
 * `.gitignore` still wins.
 *
 * @param {string} dir
 * @param {object} [options]
 * @param {Map} [options.cache]  shared across a scan, keyed by folder
 */
async function scopeFor(dir, { cache = null, read = fsp.readFile, stat = fsp.stat, limit = 24 } = {}) {
  const chain = [];
  let at = path.resolve(dir);
  for (let i = 0; i < limit; i++) {
    chain.unshift(at);
    let isRepo = false;
    try {
      isRepo = (await stat(path.join(at, '.git'))).isDirectory();
    } catch {
      /* not a repository root */
    }
    const parent = path.dirname(at);
    if (isRepo || parent === at) break;
    at = parent;
  }

  let scope = EMPTY;
  for (const folder of chain) {
    if (cache && cache.has(key(folder))) {
      scope = cache.get(key(folder));
      continue;
    }
    scope = await extend(scope, folder, read);
    if (cache) cache.set(key(folder), scope);
  }
  return scope;
}

module.exports = { EMPTY, parse, extend, lookup, listingHasIgnoreFile, atNestedProject, scopeFor, MAX_BYTES };
