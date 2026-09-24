'use strict';

/**
 * What changed between two snapshots of one folder: "why is the disk filling?"
 *
 * Trends can say a disk grew 6 GB in a month. It cannot say where, because it
 * measures the volume. Two snapshots of a folder can, within what a snapshot
 * keeps -- every folder's own total, and its ten largest files of 10 MB or
 * more -- and this module is careful to say no more than that.
 *
 * ## Where the growth went
 *
 * Listing every folder that grew answers the question badly: `Users`,
 * `Users\a`, `Users\a\AppData` and `Users\a\AppData\Local\Docker` each "grew
 * 3 GB", which is one fact printed four times. So the change is split into
 * places that do not overlap. Start at the folder that was scanned; while the
 * biggest change on the list is mostly explained by the folders inside it,
 * replace it with them, and keep what they do not explain as "elsewhere in"
 * that folder. The result is a short list whose entries can be added up, each
 * named at the deepest folder that still holds its change.
 *
 * ## What can be said about a file
 *
 * A snapshot names only a folder's ten largest files of 10 MB or more. A file
 * missing from the later list may have been deleted, moved, shrunk below the
 * cut -- or merely pushed out of the ten by bigger files, still sitting there.
 * So a file is only called gone when the later scan would have listed it had
 * it still been there at that size: its folder held no files at all, or named
 * fewer than ten, or named one smaller than it. The rule for a file that
 * appeared is the same, read the other way. Anything else is counted as
 * "could not tell", with its size, and never listed as a change.
 *
 * A file that is gone from one folder and has appeared in another with the
 * same name, size and modification time is reported once, as moved.
 */

const path = require('node:path');

const { comparable } = require('./store');

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const MIB = 1024 * 1024;

const LIMITS = Object.freeze({ places: 12, files: 40, minPlaceBytes: MIB });

const ZERO = Object.freeze({ bytes: 0, files: 0 });

function parentOf(rel) {
  if (rel === '') return null;
  const up = path.dirname(rel);
  return up === '.' ? '' : up;
}

/** rel -> { bytes, files } for every folder, including the ones that hold only folders. */
function subtreeTotals(rows) {
  const out = new Map([['', { bytes: 0, files: 0 }]]);
  for (const [rel, bytes, files] of rows) {
    for (let at = rel; at !== null; at = parentOf(at)) {
      let node = out.get(at);
      if (!node) out.set(at, (node = { bytes: 0, files: 0 }));
      node.bytes += bytes;
      node.files += files;
    }
  }
  return out;
}

function childrenOf(...maps) {
  const kids = new Map();
  const seen = new Set();
  for (const map of maps) {
    for (const rel of map.keys()) {
      if (rel === '' || seen.has(rel)) continue;
      seen.add(rel);
      const up = parentOf(rel);
      if (!kids.has(up)) kids.set(up, []);
      kids.get(up).push(rel);
    }
  }
  return kids;
}

/**
 * The change, split into places that do not overlap, biggest first.
 *
 * Built from what each folder holds *itself*, not from its totals. A file
 * moved from `Documents` into `Documents\Archive` leaves `Documents`'s total
 * where it was, and a list built from totals would never show that
 * `Documents` lost it. So each side counts only its own sign: what grew is
 * the sum of the folders whose own files grew, what shrank the sum of those
 * whose own files shrank -- and the two lists together add up to the net
 * change, exactly, down to the ones too small to name.
 *
 * @param {Map} ownBefore  rel -> bytes held directly in that folder
 * @param {Map} ownAfter
 * @param {number} sign    1 for what grew, -1 for what shrank
 */
function places(root, { before, after, ownBefore, ownAfter }, kids, sign, { limit = LIMITS.places, min = LIMITS.minPlaceBytes } = {}) {
  const own = (rel) => Math.max(0, ((ownAfter.get(rel) || 0) - (ownBefore.get(rel) || 0)) * sign);

  // This side's change in a folder and everything under it.
  const totals = new Map();
  const total = (rel) => {
    if (totals.has(rel)) return totals.get(rel);
    let value = own(rel);
    for (const kid of kids.get(rel) || []) value += total(kid);
    totals.set(rel, value);
    return value;
  };

  const place = (rel, amount, elsewhere = false) => ({
    rel,
    path: rel === '' ? root : path.join(root, rel),
    change: amount * sign,
    before: (before.get(rel) || ZERO).bytes,
    after: (after.get(rel) || ZERO).bytes,
    appeared: !before.has(rel),
    vanished: !after.has(rel),
    elsewhere,
  });

  const out = [];
  const frontier = [''];
  // Enough to go several levels down on each of the biggest changes; the
  // list is cut to `limit` afterwards.
  let expansions = limit * 4;
  while (frontier.length > 0 && expansions > 0) {
    frontier.sort((a, b) => total(b) - total(a));
    const rel = frontier.shift();
    const amount = total(rel);
    if (amount < min) break;
    const inside = (kids.get(rel) || []).filter((k) => total(k) >= min);
    const explained = inside.reduce((n, k) => n + total(k), 0);
    if (inside.length > 0 && explained >= amount / 2) {
      // Mostly the folders inside it: go down, and keep what they do not
      // explain -- its own files, and folders too small to list -- here.
      expansions -= 1;
      frontier.push(...inside);
      if (amount - explained >= min) out.push(place(rel, amount - explained, true));
    } else {
      out.push(place(rel, amount));
    }
  }
  for (const rel of frontier) if (total(rel) >= min) out.push(place(rel, total(rel)));

  out.sort((a, b) => (b.change - a.change) * sign);
  const listed = out.slice(0, limit);
  const rest = out.slice(limit);
  return {
    places: listed,
    more: { count: rest.length, bytes: rest.reduce((n, p) => n + p.change, 0) },
  };
}

const nameKey = (name) => name.normalize('NFC').toLowerCase();

/**
 * The large files that changed, and the ones about which nothing can be said.
 */
function fileChanges(root, older, newer, { limit = LIMITS.files } = {}) {
  const rowsA = new Map(older.tree.map((row) => [row[0], row]));
  const rowsB = new Map(newer.tree.map((row) => [row[0], row]));
  const perA = older.bigPerDir || 10;
  const perB = newer.bigPerDir || 10;

  const grew = [];
  const shrank = [];
  let appeared = [];
  let vanished = [];
  const unknown = { count: 0, bytes: 0 };

  const smallest = (row) => (row[3].length ? Math.min(...row[3].map((f) => f[1])) : Infinity);
  const at = (rel, name) => (rel === '' ? path.join(root, name) : path.join(root, rel, name));

  const rels = new Set([...rowsA.keys(), ...rowsB.keys()]);
  for (const rel of rels) {
    const a = rowsA.get(rel);
    const b = rowsB.get(rel);
    const inA = new Map((a ? a[3] : []).map((f) => [nameKey(f[0]), f]));
    const inB = new Map((b ? b[3] : []).map((f) => [nameKey(f[0]), f]));

    for (const [key, fa] of inA) {
      const fb = inB.get(key);
      if (fb) {
        const entry = { path: at(rel, fb[0]), rel, name: fb[0], before: fa[1], after: fb[1], change: fb[1] - fa[1], mtimeMs: fb[2] };
        if (fb[1] > fa[1]) grew.push(entry);
        else if (fb[1] < fa[1]) shrank.push(entry);
        continue;
      }
      // Would the later scan have named it, had it still been here at this size?
      const certain = !b || b[3].length < perB || fa[1] > smallest(b);
      if (certain) vanished.push({ path: at(rel, fa[0]), rel, name: fa[0], size: fa[1], mtimeMs: fa[2], folderEmpty: !b });
      else {
        unknown.count += 1;
        unknown.bytes += fa[1];
      }
    }

    for (const [key, fb] of inB) {
      if (inA.has(key)) continue;
      const certain = !a || a[3].length < perA || fb[1] > smallest(a);
      if (certain) appeared.push({ path: at(rel, fb[0]), rel, name: fb[0], size: fb[1], mtimeMs: fb[2], folderWasEmpty: !a });
      else {
        unknown.count += 1;
        unknown.bytes += fb[1];
      }
    }
  }

  // The same file, gone from one place and arrived in another.
  const moved = [];
  const arrivals = new Map();
  for (const file of appeared) {
    const key = `${nameKey(file.name)}|${file.size}|${Math.round(file.mtimeMs)}`;
    if (!arrivals.has(key)) arrivals.set(key, []);
    arrivals.get(key).push(file);
  }
  const takenArrivals = new Set();
  const takenDepartures = new Set();
  for (const file of vanished) {
    const key = `${nameKey(file.name)}|${file.size}|${Math.round(file.mtimeMs)}`;
    const match = (arrivals.get(key) || []).find((f) => !takenArrivals.has(f));
    if (!match) continue;
    takenArrivals.add(match);
    takenDepartures.add(file);
    moved.push({ from: file.path, to: match.path, fromRel: file.rel, toRel: match.rel, name: match.name, size: match.size });
  }
  appeared = appeared.filter((f) => !takenArrivals.has(f));
  vanished = vanished.filter((f) => !takenDepartures.has(f));

  const top = (list, by) => {
    const sorted = [...list].sort((x, y) => by(y) - by(x));
    return { items: sorted.slice(0, limit), total: sorted.length, bytes: sorted.reduce((n, f) => n + Math.abs(by(f)), 0) };
  };
  return {
    grew: top(grew, (f) => f.change),
    shrank: top(shrank, (f) => -f.change),
    appeared: top(appeared, (f) => f.size),
    vanished: top(vanished, (f) => f.size),
    moved: top(moved, (f) => f.size),
    unknown,
    bigFileBytes: newer.bigFileBytes || null,
    bigPerDir: perB,
  };
}

function describe(snapshot, file) {
  return { file, takenAt: snapshot.takenAt, complete: snapshot.complete, totals: snapshot.totals };
}

/**
 * Compare two snapshots of one folder, whichever order they are given in.
 *
 * @returns {object} `{ ok: false, reason }` when they cannot be compared, and
 *   the comparison otherwise, with `confidence: 'guess'` when either scan was
 *   stopped early
 */
function diffSnapshots(first, second, { files: names = [], limits = {} } = {}) {
  const [older, newer, olderFile, newerFile] =
    Date.parse(first.takenAt) <= Date.parse(second.takenAt)
      ? [first, second, names[0], names[1]]
      : [second, first, names[1], names[0]];
  const verdict = comparable(older, newer);
  const base = { from: describe(older, olderFile), to: describe(newer, newerFile), root: newer.root };
  if (!verdict.ok) return { ok: false, reason: verdict.reason, ...base };

  const before = subtreeTotals(older.tree);
  const after = subtreeTotals(newer.tree);
  const kids = childrenOf(before, after);
  const options = { ...LIMITS, ...limits };
  const sides = {
    before,
    after,
    ownBefore: new Map(older.tree.map((row) => [row[0], row[1]])),
    ownAfter: new Map(newer.tree.map((row) => [row[0], row[1]])),
  };

  // Files are only compared when both scans named them by the same rule.
  const sameFileRule = older.bigFileBytes === newer.bigFileBytes && (older.bigPerDir || 10) === (newer.bigPerDir || 10);

  return {
    ok: true,
    ...base,
    confidence: verdict.confidence,
    incomplete: [older, newer].filter((s) => !s.complete).map((s) => s.takenAt),
    days: (Date.parse(newer.takenAt) - Date.parse(older.takenAt)) / DAY,
    total: {
      before: (before.get('') || ZERO).bytes,
      after: (after.get('') || ZERO).bytes,
      change: (after.get('') || ZERO).bytes - (before.get('') || ZERO).bytes,
      filesBefore: (before.get('') || ZERO).files,
      filesAfter: (after.get('') || ZERO).files,
    },
    grew: places(newer.root, sides, kids, 1, { limit: options.places, min: options.minPlaceBytes }),
    shrank: places(newer.root, sides, kids, -1, { limit: options.places, min: options.minPlaceBytes }),
    files: sameFileRule ? fileChanges(newer.root, older, newer, { limit: options.files }) : null,
    filesRefused: sameFileRule ? null : 'differentFileRule',
  };
}

/**
 * Which two snapshots a comparison opens on: the newest, and the one nearest a
 * week before it that can be compared with it.
 *
 * A complete scan is preferred to a stopped one, because comparing against a
 * stopped scan can only ever be a guess. With the default retention -- the
 * newest twelve, and one a month -- somebody who scans several times a day may
 * have nothing from a week ago, so the nearest is taken and the real gap is
 * reported rather than assumed.
 *
 * @param {Array<{file, takenAt, complete, scanner, rules}>} snapshots  from the index
 * @returns {{ok: true, older: string, newer: string, days: number} | {ok: false, reason: string}}
 */
function defaultPair(snapshots) {
  const newestFirst = [...snapshots].sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
  if (newestFirst.length < 2) return { ok: false, reason: 'onlyOne' };
  const newer = newestFirst.find((s) => s.complete) || newestFirst[0];
  const at = Date.parse(newer.takenAt);
  const earlier = newestFirst.filter((s) => s !== newer && Date.parse(s.takenAt) < at);
  if (earlier.length === 0) return { ok: false, reason: 'onlyOne' };
  const usable = earlier.filter((s) => s.scanner === newer.scanner && s.rules && s.rules === newer.rules);
  if (usable.length === 0) return { ok: false, reason: 'differentRules' };
  usable.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    return Math.abs(at - Date.parse(a.takenAt) - WEEK) - Math.abs(at - Date.parse(b.takenAt) - WEEK);
  });
  const older = usable[0];
  return { ok: true, older: older.file, newer: newer.file, days: (at - Date.parse(older.takenAt)) / DAY };
}

module.exports = { diffSnapshots, defaultPair, places, fileChanges, subtreeTotals, LIMITS };
