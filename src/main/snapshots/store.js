'use strict';

/**
 * A compressed picture of a folder tree, kept after every scan.
 *
 * Trends can say that a disk is filling and how fast. It cannot say *what* is
 * filling it, because a scan's result is thrown away when the next one
 * arrives. A snapshot keeps enough of each scan -- every folder's own total,
 * and the large files in it -- that two of them can later be compared (A5),
 * and a plan built from what is actually there (G1).
 *
 *   snapshots/<rootHash>/index.json
 *   snapshots/<rootHash>/2026-09-24T09-00-00-000Z.json.gz
 *
 *   { v: 1, root, volume, takenAt, scanner: 'walk', complete, rules, excluded,
 *     totals: { bytes, files, dirs },
 *     bigFileBytes, bigPerDir,
 *     tree: [[relativePath, bytes, files, [[name, size, mtimeMs], …]], …] }
 *
 * A row's bytes are what that folder holds itself; a folder's total with
 * everything under it is the sum over its descendants, so nothing is stored
 * twice. Only folders that hold files have rows.
 *
 * Snapshots name files, so they are as private as the disk they describe.
 * They never leave the machine; nothing here has a network in it.
 */

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const { renameRetrying } = require('../lib/atomic');
const { pathKey } = require('../lib/util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const VERSION = 1;

const RETENTION = Object.freeze({ keepRecent: 12, keepMonthly: 12 });

function rootHash(root) {
  return crypto.createHash('sha1').update(pathKey(root)).digest('hex').slice(0, 16);
}

/** A filename that sorts by time and is legal on Windows. */
function fileNameFor(takenAt) {
  return `${new Date(takenAt).toISOString().replace(/:/g, '-').replace(/\./g, '-')}.json.gz`;
}

async function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, data);
  await renameRetrying(temp, file);
}

class SnapshotStore {
  /**
   * @param {string} dir
   * @param {object} [options]
   * @param {() => ({keepRecent: number, keepMonthly: number} | Promise<object>)} [options.retention]
   *   read at every save, so a change in Settings applies to the next scan
   */
  constructor(dir, { retention = () => RETENTION } = {}) {
    this.dir = path.resolve(dir);
    this.retention = retention;
  }

  dirFor(root) {
    return path.join(this.dir, rootHash(root));
  }

  /**
   * Keep one scan. Returns what the index records about it.
   *
   * A stopped scan is kept too, marked incomplete: comparing against it is
   * allowed but can only ever be a guess, and saying so is better than having
   * nothing to compare with.
   */
  async save(result) {
    if (!result || !Array.isArray(result.tree)) throw new Error('snapshot: the scan did not collect a tree');
    const takenAt = Number.isFinite(result.scannedAt) ? result.scannedAt : Date.now();
    const snapshot = {
      v: VERSION,
      root: result.root,
      volume: path.parse(result.root).root,
      takenAt: new Date(takenAt).toISOString(),
      scanner: result.scanner || 'walk',
      complete: !result.cancelled,
      rules: result.rules || null,
      excluded: result.excluded || 0,
      totals: { bytes: result.totalSize || 0, files: result.totalFiles || 0, dirs: result.totalDirs || 0 },
      bigFileBytes: result.bigFileBytes || null,
      bigPerDir: result.bigPerDir || null,
      tree: result.tree,
    };

    const dir = this.dirFor(result.root);
    await fsp.mkdir(dir, { recursive: true });
    const file = fileNameFor(takenAt);
    const body = await gzip(Buffer.from(JSON.stringify(snapshot), 'utf8'));
    await writeAtomic(path.join(dir, file), body);

    const entry = {
      file,
      takenAt: snapshot.takenAt,
      complete: snapshot.complete,
      scanner: snapshot.scanner,
      rules: snapshot.rules,
      totals: snapshot.totals,
      bytesOnDisk: body.length,
    };
    const index = await this._readIndex(dir, result.root);
    index.snapshots = index.snapshots.filter((s) => s.file !== file);
    index.snapshots.push(entry);
    index.snapshots.sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
    await this._prune(dir, index);
    await writeAtomic(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    return { ...entry, root: result.root };
  }

  /** Every snapshot of one root, oldest first -- read from the index, not the files. */
  async list(root) {
    const index = await this._readIndex(this.dirFor(root), root);
    return index.snapshots.map((s) => ({ ...s, root: index.root }));
  }

  /** Every root that has snapshots. */
  async roots() {
    let names;
    try {
      names = await fsp.readdir(this.dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const entry of names) {
      if (!entry.isDirectory()) continue;
      try {
        const index = JSON.parse(await fsp.readFile(path.join(this.dir, entry.name, 'index.json'), 'utf8'));
        if (index && typeof index.root === 'string') out.push(index.root);
      } catch {
        // A folder with no readable index has nothing listable in it.
      }
    }
    return out;
  }

  async load(root, file) {
    if (!/^[0-9TZ-]+\.json\.gz$/.test(file)) throw new Error('snapshot: not a snapshot file name');
    const body = await fsp.readFile(path.join(this.dirFor(root), file));
    return JSON.parse((await gunzip(body)).toString('utf8'));
  }

  /**
   * The index, or a rebuilt one if it is missing or unreadable.
   *
   * The index is a convenience; the files are the record. Rebuilding reads
   * each file's header, which costs a decompress per snapshot and happens only
   * after something went wrong.
   */
  async _readIndex(dir, root) {
    try {
      const index = JSON.parse(await fsp.readFile(path.join(dir, 'index.json'), 'utf8'));
      if (index && index.v === VERSION && Array.isArray(index.snapshots)) return index;
    } catch {
      // fall through to a rebuild
    }

    const index = { v: VERSION, root, snapshots: [] };
    let names = [];
    try {
      names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json.gz')).sort();
    } catch {
      return index;
    }
    for (const file of names) {
      try {
        const body = await fsp.readFile(path.join(dir, file));
        const snap = JSON.parse((await gunzip(body)).toString('utf8'));
        index.snapshots.push({
          file,
          takenAt: snap.takenAt,
          complete: snap.complete,
          scanner: snap.scanner,
          rules: snap.rules,
          totals: snap.totals,
          bytesOnDisk: body.length,
        });
        if (typeof snap.root === 'string') index.root = snap.root;
      } catch {
        // A snapshot that cannot be read is not listed; it is not deleted either.
      }
    }
    // Written back, so the next read -- and the list of roots -- need not
    // decompress everything again.
    if (index.snapshots.length > 0) {
      await writeAtomic(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`).catch(() => {});
    }
    return index;
  }

  /**
   * The newest `keepRecent`, plus the newest of each of the last `keepMonthly`
   * months. Everything else is deleted. With the defaults that is at most 24
   * files per root, whatever the scanning habit.
   */
  async _prune(dir, index) {
    const { keepRecent, keepMonthly } = { ...RETENTION, ...(await this.retention()) };
    const keep = new Set(selectRetained(index.snapshots, { keepRecent, keepMonthly }).map((s) => s.file));
    const doomed = index.snapshots.filter((s) => !keep.has(s.file));
    for (const s of doomed) await fsp.rm(path.join(dir, s.file), { force: true });
    index.snapshots = index.snapshots.filter((s) => keep.has(s.file));
    return doomed.length;
  }
}

/** Which snapshots the retention rule keeps. Pure, for the harness. */
function selectRetained(snapshots, { keepRecent, keepMonthly }) {
  const newestFirst = [...snapshots].sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
  const keep = new Set(newestFirst.slice(0, keepRecent));

  const months = new Map();
  for (const s of newestFirst) {
    const month = s.takenAt.slice(0, 7);
    if (!months.has(month)) months.set(month, s);
  }
  for (const s of [...months.values()].slice(0, keepMonthly)) keep.add(s);

  return newestFirst.filter((s) => keep.has(s));
}

/**
 * Whether two snapshots can be compared, and if not, why not.
 *
 * The rule is the one Trends already follows: a figure is only produced when
 * the data supports it. Two scans of different folders, or made with different
 * rules about what to skip, measure different things, and their difference is
 * not growth.
 *
 * @returns {{ok: boolean, reason: string|null, confidence: string|null}}
 */
function comparable(a, b) {
  if (!a || !b) return { ok: false, reason: 'onlyOne', confidence: null };
  if (pathKey(a.root) !== pathKey(b.root)) return { ok: false, reason: 'differentRoot', confidence: null };
  if (a.scanner !== b.scanner) return { ok: false, reason: 'differentScanner', confidence: null };
  if (!a.rules || a.rules !== b.rules) return { ok: false, reason: 'differentRules', confidence: null };
  if (!a.complete || !b.complete) return { ok: true, reason: 'incomplete', confidence: 'guess' };
  return { ok: true, reason: null, confidence: null };
}

module.exports = { SnapshotStore, comparable, selectRetained, rootHash, fileNameFor, RETENTION, VERSION };
