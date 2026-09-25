'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { renameRetrying } = require('./atomic');

const { pathKey } = require('./util');

/**
 * A record of what this app moved to the Recycle Bin.
 *
 * It exists for exactly one reason: the Recycle Bin is shared. Everything the
 * user deleted in Explorer sits in the same place as everything CleanDrive
 * deleted, and the app is about to gain the ability to empty part of it. With
 * no record, "empty the old stuff" means "empty things somebody else put there
 * for reasons we know nothing about". With this record, the purge can be
 * limited to items this app created, at a time this app can name.
 *
 * An entry is only ever a claim about the past. It is matched against the bin's
 * own metadata before anything is removed -- see recyclebin.js -- so a stale or
 * hand-edited ledger cannot cause a deletion that the bin does not corroborate.
 *
 * ## Two modes
 *
 * Given a journal (`journal/journal.js`), which is how the app now builds it,
 * the ledger keeps no file of its own and is a view of the journal: what was
 * recycled, less what has been purged. Without one it is the file it always
 * was, which is what the harnesses that predate the journal still exercise.
 *
 * The journal also fixes two things the file got wrong. It was rewritten whole
 * from the process's own copy, so a window open overnight overwrote whatever
 * the 02:00 run had added. And it stamped a whole batch with the one moment
 * it was recorded, so for a delete that ran longer than the purge's five-minute
 * tolerance the bin's own timestamp stopped matching and those items could
 * never be purged. The journal records each item at the moment it moved.
 */

const SCHEMA_VERSION = 1;

/** Beyond this the file is trimmed oldest-first. A purge only reads recent entries. */
const MAX_ENTRIES = 200000;

/** Entries older than this are dropped: whatever they described is long gone. */
const MAX_AGE_DAYS = 365;

const DAY = 24 * 60 * 60 * 1000;

/** A migration lock older than this belonged to a process that died. */
const LOCK_STALE_MS = 10 * 60 * 1000;

class TrashLedger {
  /**
   * @param {string} filePath  the ledger file -- in journal mode, the old one
   *   to import once and then leave alone
   * @param {object} [options]
   * @param {object} [options.journal]  an ActionJournal. With one, the ledger
   *   keeps no file of its own: it is a view of the journal's recycle sessions,
   *   less whatever a purge session has since removed.
   */
  constructor(filePath, { journal = null } = {}) {
    this.filePath = path.resolve(filePath);
    this.journal = journal;
    this.entries = [];
    this.loaded = false;
    this._writeChain = Promise.resolve();
  }

  /** Never throws: a missing or corrupt ledger is an empty ledger. */
  async load() {
    if (this.journal) return this._loadFromJournal();
    this.entries = await this._readFile(this.filePath);
    this.loaded = true;
    return this.entries;
  }

  /**
   * What the journal says is in the Recycle Bin on the app's behalf.
   *
   * Every item of every recycle session, minus every item a purge session has
   * since removed or a restore session has put back, matched on path and the
   * moment it was recycled. The old ledger file, if one is still there, is
   * imported first -- once.
   */
  async _loadFromJournal() {
    await this._importLegacy();

    const { lines } = await this.journal.read();
    const kinds = new Map();
    for (const line of lines) {
      if (line.op === 'begin') kinds.set(line.session, { kind: line.kind, runId: line.runId || null });
    }

    // What is no longer in the bin on the app's behalf: what it purged, and
    // what it put back. Leaving a restored item in would be a trap -- restore
    // a file at 10:02 that the app recycled at 10:00, delete it yourself in
    // Explorer at 10:03, and the bin's deletion time is inside the purge's
    // five-minute tolerance of the app's record. After the grace period the
    // purge would have removed, permanently, a delete that was yours.
    const settled = new Set();
    const recycled = [];
    for (const line of lines) {
      if (line.op !== 'item') continue;
      const session = kinds.get(line.session);
      if (!session) continue;
      if (session.kind === 'purge' || session.kind === 'restore') {
        settled.add(entryKey(line.from, Date.parse(line.recycledAt)));
      } else if (session.kind === 'recycle' || (session.kind === 'quarantine' && line.original === 'bin')) {
        // A quarantined file's original goes to the bin like any other, and
        // leaves it the same way: through the four-condition purge (B1).
        recycled.push({
          path: path.resolve(line.from),
          size: Number.isFinite(line.bytes) ? line.bytes : 0,
          trashedAt: Date.parse(line.t),
          runId: session.runId,
        });
      }
    }

    const cutoff = Date.now() - MAX_AGE_DAYS * DAY;
    const seen = new Set();
    this.entries = [];
    for (const entry of recycled) {
      if (!Number.isFinite(entry.trashedAt) || entry.trashedAt < cutoff) continue;
      const key = entryKey(entry.path, entry.trashedAt);
      if (settled.has(key) || seen.has(key)) continue;
      seen.add(key);
      this.entries.push(entry);
    }
    this.loaded = true;
    return this.entries;
  }

  /**
   * Bring the old ledger file into the journal, once.
   *
   * The window and the scheduled run can start at the same moment, so one of
   * them has to win. The claim is an exclusive create of a lock file, which
   * Windows grants to exactly one caller. Renaming the ledger out of the way
   * was tried first and does not work: measured here, two concurrent renames of
   * the same file *both* succeed, because each opens the file and then renames
   * the handle -- the second rename moves the first one's result.
   *
   * The file ends as `.migrated`, kept rather than deleted. A lock left behind
   * by a process that died half way is broken after ten minutes; if that
   * process had already written the journal, the second import only repeats
   * lines the ledger view de-duplicates anyway.
   */
  async _importLegacy() {
    try {
      await fsp.access(this.filePath);
    } catch {
      return 0; // nothing to import -- the common case, and it costs one stat
    }

    const lock = `${this.filePath}.migrating`;
    let handle = null;
    for (let attempt = 0; attempt < 2 && !handle; attempt++) {
      try {
        handle = await fsp.open(lock, 'wx');
      } catch (err) {
        if (err.code !== 'EEXIST') return 0;
        const stats = await fsp.stat(lock).catch(() => null);
        if (!stats || Date.now() - stats.mtimeMs < LOCK_STALE_MS) return 0; // somebody else is importing
        await fsp.rm(lock, { force: true }).catch(() => {});
      }
    }
    if (!handle) return 0;

    try {
      // Read under the lock: another process may have finished the import
      // between the check above and the lock, in which case there is nothing.
      const entries = await this._readFile(this.filePath, { keepAll: true });
      if (entries.length > 0) {
        await this.journal.appendSession(
          'recycle',
          entries.map((e) => ({ path: e.path, size: e.size, trashedAt: e.trashedAt })),
          { source: 'migrated', runId: 'trash-ledger.json' }
        );
      }
      // Only after the journal holds it. If the write above failed, the file
      // stays where it is and the next launch tries again.
      await fsp.rename(this.filePath, `${this.filePath}.migrated`).catch(() => {});
      return entries.length;
    } finally {
      await handle.close().catch(() => {});
      await fsp.rm(lock, { force: true }).catch(() => {});
    }
  }

  /** Entries from a ledger file on disk; a missing or corrupt file is none. */
  async _readFile(filePath, { keepAll = false } = {}) {
    const out = [];
    let text;
    try {
      text = await fsp.readFile(filePath, 'utf8');
    } catch {
      return out;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return out;
    }

    const list = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
    const cutoff = Date.now() - MAX_AGE_DAYS * DAY;

    for (const raw of list) {
      const entry = coerceEntry(raw);
      if (entry && (keepAll || entry.trashedAt >= cutoff)) out.push(entry);
    }

    return out;
  }

  async ensureLoaded() {
    if (!this.loaded) await this.load();
    return this.entries;
  }

  /**
   * Append the items a run moved to the Recycle Bin.
   *
   * @param {Array<{path: string, size?: number}>} items
   * @param {{runId?: string, trashedAt?: number}} [meta]
   */
  async record(items, meta = {}) {
    await this.ensureLoaded();
    const trashedAt = Number.isFinite(meta.trashedAt) ? meta.trashedAt : Date.now();
    const runId = typeof meta.runId === 'string' ? meta.runId : null;

    const added = [];
    for (const item of Array.isArray(items) ? items : [items]) {
      const target = typeof item === 'string' ? { path: item } : item;
      if (!target || typeof target.path !== 'string' || target.path.trim() === '') continue;
      added.push({
        path: path.resolve(target.path),
        size: Number.isFinite(target.size) ? target.size : 0,
        trashedAt,
        runId,
      });
    }
    if (added.length === 0) return 0;

    if (this.journal) {
      // In journal mode this is a record made after the fact, in one write.
      // The pipeline journals item by item as it goes and does not come here.
      await this.journal.appendSession('recycle', added, {
        source: runId === 'manual' ? 'manual' : 'autoclean',
        runId,
        startedAt: trashedAt,
      });
      this.entries.push(...added);
      return added.length;
    }

    this.entries.push(...added);
    await this.flush();
    return added.length;
  }

  /**
   * Entries trashed longer ago than `days`, newest first.
   * These are the only things a purge may consider.
   */
  expired(days, now = Date.now()) {
    const cutoff = now - Math.max(0, days) * DAY;
    return this.entries.filter((e) => e.trashedAt <= cutoff);
  }

  /**
   * Index of entries by normalised original path, for matching against Recycle
   * Bin metadata. One path can appear more than once -- deleted, recreated,
   * deleted again -- so each key holds a list.
   *
   * @returns {Map<string, Array<object>>}
   */
  static index(entries) {
    const map = new Map();
    for (const entry of entries) {
      const key = pathKey(entry.path);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }

  /**
   * Drop entries by identity, after they were purged from the bin.
   *
   * In journal mode nothing is removed from anywhere: a purge session is
   * appended naming each item, and the next load leaves them out. That is also
   * the record of the one permanent deletion the app makes, which the old file
   * never kept.
   */
  async forget(entries, { freedBytes = 0 } = {}) {
    if (!entries || entries.length === 0) return 0;
    const doomed = new Set(entries);
    const before = this.entries.length;
    const leaving = this.entries.filter((e) => doomed.has(e));
    this.entries = this.entries.filter((e) => !doomed.has(e));
    const removed = before - this.entries.length;
    if (removed === 0) return 0;

    if (this.journal) {
      await this.journal.appendSession(
        'purge',
        leaving.map((e) => ({ path: e.path, size: e.size, recycledAt: e.trashedAt })),
        { source: 'purge', freedOnSource: freedBytes }
      );
      return removed;
    }

    await this.flush();
    return removed;
  }

  async flush() {
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.sort((a, b) => a.trashedAt - b.trashedAt);
      this.entries = this.entries.slice(this.entries.length - MAX_ENTRIES);
    }

    const payload = { version: SCHEMA_VERSION, entries: this.entries };
    this._writeChain = this._writeChain.then(() => writeAtomic(this.filePath, payload)).catch(() => {});
    await this._writeChain;
  }
}

/** An item in the bin is one path recycled at one moment. */
function entryKey(filePath, trashedAt) {
  return `${pathKey(filePath)}|${Math.trunc(trashedAt)}`;
}

function coerceEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.path !== 'string' || raw.path.trim() === '') return null;
  const trashedAt = Number(raw.trashedAt);
  if (!Number.isFinite(trashedAt)) return null;
  return {
    path: path.resolve(raw.path),
    size: Number.isFinite(Number(raw.size)) ? Number(raw.size) : 0,
    trashedAt,
    runId: typeof raw.runId === 'string' ? raw.runId : null,
  };
}

async function writeAtomic(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await fsp.open(temp, 'w');
    await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
  await renameRetrying(temp, filePath);
}

module.exports = { TrashLedger, SCHEMA_VERSION, MAX_ENTRIES, MAX_AGE_DAYS };
