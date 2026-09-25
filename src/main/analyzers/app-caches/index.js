'use strict';

/**
 * The apps whose caches the scan knows by name (D4).
 *
 * Without this the scan judges a cache by its folder's name and by where it
 * sits, and an application's data folder makes it cautious, rightly: a folder
 * called Cache inside a program's data is "whatever that program decided to
 * put there", so it is only ever `review`, and anything under Roaming is left
 * alone altogether. That caution is wrong for a handful of apps whose layout is
 * known, and it was wrong the other way too: Chrome's and Edge's compiled-code
 * caches were `safe` and on the automatic whitelist with nothing checking
 * whether the browser was open.
 *
 * Each JSON file here names one app: its process, and, for each place it keeps
 * data, exactly which folders are cache. Everything else in those places is
 * not touched -- `Service Worker` and `IndexedDB` are sites' own data (one
 * Edge profile here held 608 MB and 560 MB of them), not cache, and are not on
 * any list. Only apps whose folders and process were checked on a real machine
 * are shipped; `verified` says when. Each has a fixture in
 * `scripts/fixtures/app-caches/`, a listing of its real folders, that the
 * harness holds the definition to.
 *
 * A definition's root:
 *
 *   base        LOCALAPPDATA or APPDATA
 *   path        segments under it; "*" matches any one folder
 *   profiles    a pattern for profile folders, if the app has them
 *   inProfile   cache folders inside each profile
 *   atRoot      cache folders directly in the root
 */

const path = require('node:path');

const FILES = Object.freeze(['chrome', 'edge', 'teams', 'discord', 'zoom', 'figma']);
const BASES = Object.freeze(['LOCALAPPDATA', 'APPDATA']);

function fail(file, what) {
  throw new Error(`app-caches/${file}.json: ${what}`);
}

const plainName = (s) => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && !/[\\/:*?"<>|]/.test(s);

/** Refuse a definition that could reach further than a cache folder. */
function validate(def, file) {
  if (!def || typeof def !== 'object') fail(file, 'not an object');
  if (def.id !== file || !/^[a-z0-9-]+$/.test(def.id)) fail(file, `id must be "${file}"`);
  if (typeof def.name !== 'string' || !def.name) fail(file, 'no name');
  if (typeof def.hint !== 'string' || !def.hint) fail(file, 'no hint');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(def.verified || '')) fail(file, 'no verified date');
  if (!Array.isArray(def.processes) || def.processes.length === 0) fail(file, 'no processes');
  for (const p of def.processes) if (!/^[A-Za-z0-9 ._-]+\.exe$/.test(p)) fail(file, `process "${p}" is not an .exe name`);
  if (!Array.isArray(def.roots) || def.roots.length === 0) fail(file, 'no roots');
  for (const root of def.roots) {
    if (!BASES.includes(root.base)) fail(file, `base "${root.base}"`);
    if (!Array.isArray(root.path) || root.path.length === 0) fail(file, 'empty path');
    for (const seg of root.path) if (seg !== '*' && !plainName(seg)) fail(file, `path segment "${seg}"`);
    if (root.path[0] === '*') fail(file, 'a path may not start with "*"');
    const inProfile = root.inProfile || [];
    const atRoot = root.atRoot || [];
    if (inProfile.length === 0 && atRoot.length === 0) fail(file, 'names no cache folder');
    for (const n of [...inProfile, ...atRoot]) if (!plainName(n)) fail(file, `cache folder "${n}"`);
    if (inProfile.length > 0 && typeof root.profiles !== 'string') fail(file, 'inProfile without a profiles pattern');
    if (root.profiles !== undefined) {
      if (!/^\^.*\$$/.test(root.profiles)) fail(file, 'profiles must be anchored with ^ and $');
      new RegExp(root.profiles); // throws on a bad pattern
    }
  }
  return def;
}

const DEFINITIONS = Object.freeze(
  FILES.map((file) => Object.freeze(validate(require(`./${file}.json`), file)))
);

const byId = (id) => DEFINITIONS.find((d) => d.id === id) || null;

const segmentsOf = (p) => path.resolve(p).toLowerCase().split(/[\\/]+/).filter(Boolean);

/**
 * A function that says whether a folder is one of these caches -- or inside
 * one of these apps without being one.
 *
 * `{ def, folder }` is a cache folder itself -- `...\Default\Cache`, not
 * `...\Default\Cache\Cache_Data`; the walk carries the match down to
 * everything inside it. `{ def, folder: null }` is anywhere else under the
 * app's root: the spec's rule is that everything off the list is `keep`, and
 * that is also what stops the generic rules from calling a folder there "GPU
 * cache, safe" and handing it to the 2am run without asking whether the app
 * is open.
 *
 * @param {object} [env]  where LOCALAPPDATA and APPDATA are; a harness passes its own
 * @returns {(dir: string) => ({def: object, folder: string|null} | null)}
 */
function matcher(env = process.env) {
  const specs = [];
  for (const def of DEFINITIONS) {
    for (const root of def.roots) {
      const base = env[root.base];
      if (typeof base !== 'string' || !path.isAbsolute(base)) continue;
      specs.push({
        def,
        prefix: [...segmentsOf(base), ...root.path.map((s) => s.toLowerCase())],
        profiles: root.profiles ? new RegExp(root.profiles, 'i') : null,
        inProfile: new Set((root.inProfile || []).map((n) => n.toLowerCase())),
        atRoot: new Set((root.atRoot || []).map((n) => n.toLowerCase())),
      });
    }
  }
  return function match(dir) {
    if (specs.length === 0 || typeof dir !== 'string') return null;
    const segs = segmentsOf(dir);
    let owner = null;
    for (const spec of specs) {
      const rest = segs.length - spec.prefix.length;
      if (rest < 0) continue;
      let inside = true;
      for (let i = 0; i < spec.prefix.length; i++) {
        if (spec.prefix[i] !== '*' && spec.prefix[i] !== segs[i]) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      const tail = segs.slice(spec.prefix.length);
      if (rest === 1 && spec.atRoot.has(tail[0])) return { def: spec.def, folder: tail[0] };
      if (rest === 2 && spec.profiles && spec.profiles.test(tail[0]) && spec.inProfile.has(tail[1])) {
        return { def: spec.def, folder: tail[1] };
      }
      if (!owner) owner = { def: spec.def, folder: null };
    }
    return owner;
  };
}

/** Every process name any definition waits for, lowercased. */
function processNames() {
  return [...new Set(DEFINITIONS.flatMap((d) => d.processes.map((p) => p.toLowerCase())))];
}

/** Which apps, of these, have a process in `running` (a Set of lowercased image names). */
function openApps(running) {
  const out = new Set();
  if (!running) return null;
  for (const def of DEFINITIONS) {
    if (def.processes.some((p) => running.has(p.toLowerCase()))) out.add(def.id);
  }
  return out;
}

module.exports = { DEFINITIONS, FILES, byId, matcher, processNames, openApps, validate };
