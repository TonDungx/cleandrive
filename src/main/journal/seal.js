'use strict';

/**
 * Sealing the journal, and checking the seals (H4).
 *
 * ## A chain per session, not per file
 *
 * The spec asked for every line to carry the hash of "the line before". Read
 * as the line before *in the file*, that cannot be built here: the window and
 * the scheduled run are two processes appending to the same month file, and
 * the run lock is deliberately never held against the window (`runlock.js`);
 * a restore opens a second session for whatever is in the way while its own
 * is still open (`actions/restore.js`); and a session that runs past midnight
 * at the end of a month keeps writing to the month it began in. A chain
 * through the file would need a lock across processes around every single
 * item, and would call every power cut an edit, because `read()` skips the
 * torn line a power cut leaves.
 *
 * So `prev` is the hash of the line before *in the same session*. The writer
 * keeps it in memory; nothing is read back, and no lock is taken per line.
 *
 * ## The seal
 *
 * A session ends with one more line, written in the same append as its `end`:
 *
 *   {"op":"seal","n":12,"prev":"<hash of end>","after":"<hash of seal 11>",
 *    "lines":5,"key":"<fingerprint>","sig":"<ed25519>"}
 *
 * `n` numbers the seals across the whole journal and `after` ties each to the
 * one before, so a session removed whole -- begin, items, end and seal -- is a
 * number missing between two that are there. Only this step takes a lock, a
 * file beside the journal held for the few milliseconds of the write.
 *
 * ## What it cannot see
 *
 * The newest sessions, removed from the end: nothing comes after them to
 * notice. And the computer's own user, who can open the key the unattended run
 * opens and so sign whatever they like (see `seal-key.js`). Both need a copy
 * kept off the machine.
 *
 * Coordinates never reach a seal: it carries hashes, counts, a time and a
 * fingerprint, and `test-media-map.js` reads this file to keep it that way.
 */

const crypto = require('node:crypto');

const runlock = require('../lib/runlock');

const SCHEMA = 'cleandrive.journal-verify/1';
const SEAL_FORMAT = 'cleandrive.journal-seal/1';

const hashLine = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** What is signed: every field that means anything, in an order fixed here. */
function canonical(seal) {
  return [
    SEAL_FORMAT,
    `session=${seal.session}`,
    `n=${seal.n}`,
    `t=${seal.t}`,
    `prev=${seal.prev}`,
    `after=${seal.after || '-'}`,
    `lines=${seal.lines}`,
    `key=${seal.key}`,
  ].join('\n');
}

function signatureHolds(seal, keys) {
  const key = keys.get(seal.key);
  if (!key || typeof seal.sig !== 'string') return false;
  try {
    return crypto.verify(null, Buffer.from(canonical(seal), 'utf8'), key, Buffer.from(seal.sig, 'base64'));
  } catch {
    return false;
  }
}

class Sealer {
  /**
   * @param {object} options
   * @param {import('./seal-key').SealKey} options.key
   * @param {string} options.lockFile
   * @param {number} [options.lockWaitMs]
   */
  constructor({ key, lockFile, lockWaitMs = 15_000 }) {
    this.key = key;
    this.lockFile = lockFile;
    this.lockWaitMs = lockWaitMs;
  }

  /**
   * Take the seal lock, open the key and find the newest genuine seal.
   *
   * Throws when any of that fails; the journal then writes the session's
   * last lines without a seal, never not at all. A session that cannot be
   * sealed reads as unsealed, which is true. A session missing from the
   * Restore Center would be a lie.
   *
   * @param {(isGenuine: (line: object) => boolean) => Promise<{n: number, hash: string|null}>} lastSeal
   */
  async open(lastSeal) {
    const lock = await runlock.acquire(this.lockFile, {
      waitMs: this.lockWaitMs,
      pollMs: 20,
      staleAfterMs: 60_000,
      holder: 'journal-seal',
    });
    if (!lock.ok) throw Object.assign(new Error('the journal seal lock is busy'), { code: 'EBUSY' });
    try {
      const signing = await this.key.signing();
      const { keys } = await this.key.publicKeys();
      // Only a seal that checks may set the next number: one hand-written
      // line claiming `n: 1e9` must not make every later seal look as though
      // a billion sessions had been removed before it.
      const last = await lastSeal((line) => signatureHolds(line, keys));
      return {
        seal: ({ session, prev, lines, t }) => {
          const line = { v: 1, t, session, op: 'seal', n: last.n + 1, prev, after: last.hash, lines, key: signing.fingerprint };
          line.sig = crypto.sign(null, Buffer.from(canonical(line), 'utf8'), signing.privateKey).toString('base64');
          return line;
        },
        close: () => lock.release(),
      };
    } catch (err) {
      await lock.release();
      throw err;
    }
  }
}

/* ---- checking ------------------------------------------------------------ */

const hasPrev = (entry) => Object.prototype.hasOwnProperty.call(entry.line, 'prev');
const prevOf = (entry) => (typeof entry.line.prev === 'string' ? entry.line.prev : null);

/**
 * Follow one sealed session's chain back from its seal, and say where it is
 * broken.
 *
 * Whether a session was changed is exact: every line it had must be found by
 * its hash, and no line may be there that it did not have. *Where* is the best
 * the hashes allow. A line that was edited and a line that was removed both
 * leave the line after it pointing at nothing; the seal's count of lines tells
 * them apart when there is one break, and when there are several that it
 * cannot, the break is reported as "changed or removed" rather than guessed.
 */
function walkSession(body, sealEntry) {
  const seal = sealEntry.line;
  const byHash = new Map();
  for (const entry of body) if (!byHash.has(entry.hash)) byHash.set(entry.hash, entry);
  const referenced = new Set(body.map(prevOf).filter(Boolean));
  referenced.add(seal.prev);

  const unvisited = new Set(body);
  const breaks = [];
  let visited = 0;
  let successor = sealEntry;
  let hash = typeof seal.prev === 'string' ? seal.prev : null;

  while (hash !== null) {
    const found = byHash.get(hash);
    if (found && unvisited.has(found)) {
      unvisited.delete(found);
      visited += 1;
      successor = found;
      hash = prevOf(found);
      continue;
    }
    // The line `successor` points at is not there as it was written. Carry on
    // from the nearest line before it that nothing points at: either the line
    // that was edited, or the one that stood before a line that was removed.
    const resume = [...unvisited]
      .filter((e) => e.index < successor.index && !referenced.has(e.hash))
      .sort((a, b) => b.index - a.index)[0];
    breaks.push({ at: successor, resume: resume || null });
    if (!resume) break;
    unvisited.delete(resume);
    visited += 1;
    successor = resume;
    hash = prevOf(resume);
  }

  const problems = [];
  const missing = Number.isInteger(seal.lines) ? seal.lines - visited : 0;
  const where = (entry) => ({ file: entry.file, line: entry.lineNo });
  for (const b of breaks) {
    if (missing === 0 && b.resume) problems.push({ what: 'modified', ...where(b.resume) });
    else if (missing === breaks.length) problems.push({ what: 'deleted', ...where(b.at) });
    else problems.push({ what: 'changed', ...where(b.at) });
  }
  for (const entry of unvisited) problems.push({ what: 'inserted', ...where(entry) });
  if (breaks.length === 0 && missing !== 0) problems.push({ what: 'count', ...where(sealEntry) });
  return problems;
}

/** `[3, 4, 5, 9]` -> `[[3, 5], [9, 9]]`. */
function rangesOf(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

/** Overlapping or touching ranges joined, in order. */
function merged(ranges) {
  const out = [];
  for (const [lo, hi] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/**
 * The parts of `from..to` that no range in `covered` accounts for.
 *
 * Arithmetic on the ranges, never a count through them: the numbers come out
 * of a file anybody can edit.
 */
function uncovered(from, to, covered) {
  const out = [];
  let at = from;
  for (const [lo, hi] of merged(covered)) {
    if (hi < at) continue;
    if (lo > to) break;
    if (lo > at) out.push([at, Math.min(lo - 1, to)]);
    at = Math.max(at, hi + 1);
    if (at > to) break;
  }
  if (at <= to) out.push([at, to]);
  return out;
}

/**
 * Check every line the journal holds.
 *
 * @param {{file: string, lineNo: number, index: number, text: string, hash: string, line: object|null}[]} entries
 *   from `ActionJournal.readRaw()`
 * @param {{keys: Map<string, crypto.KeyObject>, current: string|null}} publicKeys
 *   from `SealKey.publicKeys()` -- public halves only; nothing here can sign
 */
function verifyJournal(entries, { keys = new Map(), current = null } = {}) {
  const unreadable = [];
  const bySession = new Map();
  for (const entry of entries) {
    if (!entry.line) {
      unreadable.push({ file: entry.file, line: entry.lineNo });
      continue;
    }
    if (!bySession.has(entry.line.session)) bySession.set(entry.line.session, []);
    bySession.get(entry.line.session).push(entry);
  }

  const sessions = {};
  const counts = { sealed: 0, altered: 0, unsealed: 0, legacy: 0, incomplete: 0 };
  const seals = [];
  const pruned = [];
  const usedKeys = new Set();
  let unknownKey = 0;

  for (const [id, group] of bySession) {
    const sealEntries = group.filter((e) => e.line.op === 'seal');
    const body = group.filter((e) => e.line.op !== 'seal');
    const isPrune = body.some((e) => e.line.op === 'prune');
    const status = { state: null, problems: [] };

    if (sealEntries.length === 0) {
      const chained = body.some(hasPrev);
      const ended = body.some((e) => e.line.op === 'end') || isPrune;
      status.state = !chained ? 'legacy' : ended ? 'unsealed' : 'incomplete';
    } else {
      const sealEntry = sealEntries[0];
      const seal = sealEntry.line;
      for (const extra of sealEntries.slice(1)) status.problems.push({ what: 'inserted', file: extra.file, line: extra.lineNo });
      if (typeof seal.key === 'string') usedKeys.add(seal.key);
      const genuine = keys.has(seal.key) && signatureHolds(seal, keys);
      if (!keys.has(seal.key)) {
        unknownKey += 1;
        status.problems.push({ what: 'unknownKey', file: sealEntry.file, line: sealEntry.lineNo });
      } else if (!genuine) {
        status.problems.push({ what: 'signature', file: sealEntry.file, line: sealEntry.lineNo });
      }
      if (Number.isInteger(seal.n) && seal.n > 0) seals.push({ n: seal.n, entry: sealEntry, session: id, genuine });
      status.problems.push(...walkSession(body, sealEntry));
      status.n = Number.isInteger(seal.n) ? seal.n : null;
      status.state = status.problems.length > 0 ? 'altered' : 'sealed';
      // A prune's word is taken only when its own seal holds; an unsigned line
      // saying "those were removed for age" would excuse any deletion at all.
      if (isPrune && status.state === 'sealed') {
        for (const entry of body) {
          if (entry.line.op !== 'prune' || !Array.isArray(entry.line.removed)) continue;
          for (const r of entry.line.removed) {
            for (const range of Array.isArray(r && r.seals) ? r.seals : []) {
              if (Array.isArray(range) && Number.isInteger(range[0]) && Number.isInteger(range[1])) pruned.push([range[0], range[1]]);
            }
          }
        }
      }
    }
    if (isPrune) status.prune = true;
    else counts[status.state] += 1;
    sessions[id] = status;
  }

  /* -- the seals against each other ----------------------------------------- */

  /*
   * Only a seal whose signature holds may say where the numbering runs. A
   * seal that does not is already its session's problem; it counts as
   * present when it sits inside the genuine run, so one edited seal line is
   * not reported twice, and is ignored outside it, so a forged `n` cannot
   * invent a gap of any size.
   */
  const real = seals.filter((s) => s.genuine).sort((a, b) => a.n - b.n || a.entry.index - b.entry.index);
  const lowest = real.length ? real[0].n : 0;
  const highest = real.length ? real[real.length - 1].n : 0;
  const present = [
    ...real.map((s) => [s.n, s.n]),
    ...seals.filter((s) => !s.genuine && s.n >= lowest && s.n <= highest).map((s) => [s.n, s.n]),
    ...pruned,
  ];
  const missing = [];
  const duplicates = [];
  let oldestMissing = null;
  if (real.length > 0) {
    // Before the oldest seal there is nothing to tell retention from removal,
    // unless a sealed prune record says which it was.
    const before = uncovered(1, lowest - 1, pruned);
    const count = before.reduce((n, [lo, hi]) => n + hi - lo + 1, 0);
    if (count > 0) oldestMissing = { from: before[0][0], to: before[before.length - 1][1], count };
    for (const [lo, hi] of uncovered(lowest, highest, present)) missing.push({ from: lo, to: hi, count: hi - lo + 1 });
  }
  for (let i = 1; i < real.length; i++) {
    const here = real[i];
    const before = real[i - 1];
    if (here.n === before.n) {
      duplicates.push(here.n);
      continue;
    }
    if (here.n === before.n + 1 && here.entry.line.after !== before.entry.hash) {
      // Both seals hold, yet the later one does not name the earlier one's
      // line as written: the earlier seal line was rewritten into something
      // that signs the same -- spacing, key order. Still an edit.
      const s = sessions[before.session];
      s.problems.push({ what: 'modified', file: before.entry.file, line: before.entry.lineNo });
      if (s.state === 'sealed') {
        s.state = 'altered';
        if (!s.prune) {
          counts.sealed -= 1;
          counts.altered += 1;
        }
      }
    }
  }

  const last = real[real.length - 1];
  return {
    schema: SCHEMA,
    lines: entries.length,
    files: new Set(entries.map((e) => e.file)).size,
    sessions,
    counts,
    missing,
    missingCount: missing.reduce((n, m) => n + m.count, 0),
    oldestMissing,
    pruned: merged(pruned),
    duplicates: [...new Set(duplicates)],
    unreadable,
    // The newest genuine seal's line hash and key travel in the machine report
    // (H3), so a console off this machine can notice the two things the seal
    // alone cannot: the newest sessions removed, or the journal re-signed.
    seals: {
      count: real.length,
      first: real.length ? lowest : null,
      last: last ? last.n : null,
      lastAt: last ? last.entry.line.t : null,
      lastHash: last ? last.entry.hash : null,
      lastKey: last && typeof last.entry.line.key === 'string' ? last.entry.line.key : null,
    },
    keys: { current, used: [...usedKeys], unknown: unknownKey },
  };
}

module.exports = { Sealer, verifyJournal, hashLine, canonical, signatureHolds, rangesOf, SCHEMA, SEAL_FORMAT };
