'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { renameRetrying } = require('../atomic');

/**
 * What the last scan learned about each file, so the next one need not read it
 * again.
 *
 * Same discipline as the duplicate finder's hash cache, and for the same
 * reason: the expensive part of a scan is opening 50,000 files and reading the
 * head of each, and almost none of them changed since yesterday. Measured, a
 * 64 KB head read runs at about 1,500 files per second on one thread; a cache
 * hit is a `Map` lookup.
 *
 * ## The key is the whole correctness argument
 *
 * `path | size | mtime`. A file whose contents changed has a new mtime, and one
 * that was replaced wholesale has a new size as well, so a cached record can
 * only ever describe the bytes it was made from. Keying on the path alone --
 * which is the obvious thing, and wrong -- would show yesterday's dimensions
 * for a photo the user re-exported this morning.
 *
 * ## Why the version number is checked rather than merely written
 *
 * `hash-cache.json` writes a `version` field and never reads it, which is
 * harmless there because a SHA-256 of a file is a SHA-256 of a file forever.
 * Here the cached value is a *record*, and the day a field is added to that
 * record every cached entry becomes an entry that is missing it -- silently,
 * and only for people who had run the app before. So the version is part of
 * the load: a file written by a different version of this record shape is
 * discarded rather than half-trusted.
 */

/**
 * Bump this whenever the shape of a probe record changes.
 *
 * It is cheaper than any migration and it cannot be got subtly wrong: the worst
 * case is that everybody's first scan after an update is a cold one.
 */
const RECORD_VERSION = 1;

/** Beyond this the file is trimmed, oldest insertion first, as the hash cache does. */
const MAX_ENTRIES = 120000;

class MediaCache {
  /** @param {string} filePath */
  constructor(filePath) {
    this.file = filePath;
    this.map = new Map();
    this.dirty = false;
    this.hits = 0;
    this.misses = 0;
    this.discardedVersion = false;
  }

  /**
   * The cache key for a file the walk has already stat'd.
   *
   * mtime is rounded: some filesystems report sub-millisecond precision and
   * some do not, and a key that changes because the same file was stat'd by a
   * different code path would make the cache miss every time without ever
   * looking wrong.
   */
  static keyOf(file) {
    return `${file.path}|${file.size}|${Math.round(file.mtimeMs)}`;
  }

  /** Never throws: a missing, corrupt or stale cache is an empty cache. */
  async load() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.entries) {
        if (parsed.version === RECORD_VERSION) {
          this.map = new Map(Object.entries(parsed.entries));
        } else {
          // Not an error, and worth saying out loud in the scan's own stats:
          // the first scan after an update being slow is otherwise a mystery.
          this.discardedVersion = true;
          this.map = new Map();
        }
      }
    } catch {
      this.map = new Map();
    }
    return this;
  }

  get(key) {
    const hit = this.map.get(key);
    if (hit) this.hits += 1;
    else this.misses += 1;
    return hit;
  }

  set(key, record) {
    this.map.set(key, record);
    this.dirty = true;
  }

  /**
   * Drop entries for files that are no longer there.
   *
   * Without this the cache only ever grows: a folder of 20,000 photos that the
   * user moves to another drive leaves 20,000 dead entries behind, and the trim
   * below would eventually evict *live* entries to make room for them.
   *
   * @param {Set<string>} liveKeys keys seen during the scan just finished
   */
  prune(liveKeys) {
    if (!liveKeys || liveKeys.size === 0) return 0;
    let removed = 0;
    for (const key of this.map.keys()) {
      if (!liveKeys.has(key)) {
        this.map.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) this.dirty = true;
    return removed;
  }

  async save(maxEntries = MAX_ENTRIES) {
    if (!this.dirty) return false;
    try {
      // Map preserves insertion order, so slicing from the end keeps whatever
      // was written most recently.
      let entries = [...this.map.entries()];
      if (entries.length > maxEntries) entries = entries.slice(entries.length - maxEntries);

      await fsp.mkdir(path.dirname(this.file), { recursive: true });

      // Written to a temporary file and renamed. The ledger does this and the
      // hash cache does not, and the difference matters more here: this file is
      // measured in megabytes, so the window in which a half-written one exists
      // is long enough to actually be interrupted by a quit.
      const temp = `${this.file}.${process.pid}.tmp`;
      await fsp.writeFile(
        temp,
        JSON.stringify({ version: RECORD_VERSION, entries: Object.fromEntries(entries) }),
        'utf8'
      );
      await renameRetrying(temp, this.file);

      this.dirty = false;
      return true;
    } catch {
      // A cache that cannot be written is a lost optimisation, not a failure.
      // The scan it came from is complete and correct either way.
      return false;
    }
  }

  get stats() {
    return {
      entries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      discardedVersion: this.discardedVersion,
    };
  }
}

module.exports = { MediaCache, RECORD_VERSION, MAX_ENTRIES };
