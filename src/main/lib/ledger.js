'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

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
 */

const SCHEMA_VERSION = 1;

/** Beyond this the file is trimmed oldest-first. A purge only reads recent entries. */
const MAX_ENTRIES = 200000;

/** Entries older than this are dropped: whatever they described is long gone. */
const MAX_AGE_DAYS = 365;

const DAY = 24 * 60 * 60 * 1000;

class TrashLedger {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.entries = [];
    this.loaded = false;
    this._writeChain = Promise.resolve();
  }

  /** Never throws: a missing or corrupt ledger is an empty ledger. */
  async load() {
    this.entries = [];
    this.loaded = true;

    let text;
    try {
      text = await fsp.readFile(this.filePath, 'utf8');
    } catch {
      return this.entries;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return this.entries;
    }

    const list = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
    const cutoff = Date.now() - MAX_AGE_DAYS * DAY;

    for (const raw of list) {
      const entry = coerceEntry(raw);
      if (entry && entry.trashedAt >= cutoff) this.entries.push(entry);
    }

    return this.entries;
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

    let added = 0;
    for (const item of Array.isArray(items) ? items : [items]) {
      const target = typeof item === 'string' ? { path: item } : item;
      if (!target || typeof target.path !== 'string' || target.path.trim() === '') continue;
      this.entries.push({
        path: path.resolve(target.path),
        size: Number.isFinite(target.size) ? target.size : 0,
        trashedAt,
        runId,
      });
      added += 1;
    }

    if (added > 0) await this.flush();
    return added;
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

  /** Drop entries by identity, e.g. after they were purged from the bin. */
  async forget(entries) {
    if (!entries || entries.length === 0) return 0;
    const doomed = new Set(entries);
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => !doomed.has(e));
    const removed = before - this.entries.length;
    if (removed > 0) await this.flush();
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
  await fsp.rename(temp, filePath);
}

module.exports = { TrashLedger, SCHEMA_VERSION, MAX_ENTRIES, MAX_AGE_DAYS };
