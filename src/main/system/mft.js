'use strict';

/**
 * Reading a whole volume's `$MFT` and turning it into paths and sizes (A2).
 *
 * The layer above `ntfs.js`: that one understands bytes, this one understands
 * a volume. It still does not open anything by itself -- every function here
 * takes a `read(offset, length)` and works through it -- so the whole of it,
 * including finding `$MFT`'s own extents and resolving 380,000 paths, is
 * covered by a harness that hands it a volume made of buffers. Only
 * `openVolume` touches a disk, and that is four lines with no decisions in it.
 *
 * ## Why this exists
 *
 * Measured on this machine, 2026-09-26: a walk of `D:\` reads 194,321 names in
 * 1.2 s and then spends 20.6 s asking the filesystem how big each one is --
 * **91% of the work is the sizes**. `$MFT` already holds every name, every
 * parent and every size in one structure, so reading it replaces both halves
 * rather than only the cheap one. (`FSCTL_ENUM_USN_DATA`, the other half of
 * the spec's suggestion, carries no sizes at all and would replace only the
 * 9%; that is why this route was chosen.)
 *
 * ## What it costs
 *
 * Opening `\\.\D:` needs administrator -- measured, Win32 error 5 without it,
 * both through Node and through a P/Invoke shim. There is no unprivileged way
 * to read `$MFT`; `fsutil usn enumdata` is refused the same way. So this runs
 * in the elevated helper and the window says which scanner answered.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ntfs = require('./ntfs');

/** Raw volume reads must be whole sectors, on sector boundaries. */
const DEFAULT_SECTOR = 512;

/** Read this much of `$MFT` at a time: 1,024 records at 1 KB each. */
const CHUNK_BYTES = 1024 * 1024;

/** A volume with more records than this is not one of ours. */
const MAX_RECORDS = 40_000_000;

/* -------------------------------------------------------------------------- */
/* the one part that touches a disk                                           */
/* -------------------------------------------------------------------------- */

/**
 * A reader over a volume, for a process that is allowed to open one.
 *
 * **`read` must hand back a buffer the caller may write into.** Repairing a
 * record's update sequence rewrites it in place, and doing that to a view of
 * a buffer that will be read again corrupts everything read from it
 * afterwards. This one allocates per call, so it is safe; a substitute that
 * returns a slice of something it keeps is not, and the harness's own fake
 * reader copies for exactly this reason.
 *
 * Windows serves a volume handle only in whole sectors, at sector boundaries,
 * so every request is widened to the sectors around it and the answer trimmed
 * back. Getting that wrong is an EINVAL on the first read rather than a subtle
 * wrong answer, which is the one mercy of this interface.
 *
 * @param {string} letter  a single drive letter
 * @returns {Promise<{read: Function, close: Function, sectorSize: number}>}
 */
async function openVolume(letter, { sectorSize = DEFAULT_SECTOR, open = fsp.open } = {}) {
  if (!/^[A-Za-z]$/.test(String(letter))) throw new Error('not a drive letter');
  // A Buffer, not a string, and that is the whole fix for a bug that kept the
  // fast scan from ever working in the app. `fs.open` passes a string path
  // through `path.toNamespacedPath`, and the Node inside Electron 33 (20.18)
  // turns `\\.\D:` into `\\.\D:\` there -- the drive's root *folder*. Measured
  // 2026-10-01: that opens without administrator rights and every read is
  // EISDIR. Node 24, which verify-mft.js runs under, leaves the string alone,
  // so the reader passed there and failed in the helper. A Buffer is handed
  // to Windows as it is, in both: unelevated it is refused EPERM, which is the
  // volume itself saying no.
  const handle = await open(Buffer.from(`\\\\.\\${letter.toUpperCase()}:`, 'utf8'), 'r');

  let sector = sectorSize;
  const read = async (offset, length) => {
    const start = BigInt(offset);
    const alignedStart = (start / BigInt(sector)) * BigInt(sector);
    const skew = Number(start - alignedStart);
    const span = Math.ceil((skew + length) / sector) * sector;
    const buf = Buffer.allocUnsafe(span);
    // A number, not a BigInt: Node accepts both, and every volume anyone has
    // is far inside what a double counts exactly (9 PB).
    const { bytesRead } = await handle.read(buf, 0, span, Number(alignedStart));
    return buf.subarray(skew, Math.min(skew + length, bytesRead));
  };

  return {
    read,
    /** The boot sector says the real sector size; reads after it use that. */
    useSectorSize(size) {
      sector = size;
    },
    get sectorSize() {
      return sector;
    },
    close: () => handle.close(),
  };
}

/* -------------------------------------------------------------------------- */
/* finding $MFT                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `$MFT` is itself a file in `$MFT`, which is how a filesystem describes its
 * own catalogue without a chicken-and-egg problem: the boot sector says where
 * record 0 is, record 0 is `$MFT`'s own record, and its `$DATA` attribute
 * lists every extent the rest of the table lives in.
 *
 * @returns {Promise<{boot: object, extents: Array, sizeBytes: bigint, records: number}>}
 */
async function locateMft(reader) {
  const bootBytes = await reader.read(0, 512);
  const boot = ntfs.parseBootSector(bootBytes);
  if (!boot) {
    throw Object.assign(new Error('not an NTFS volume'), { code: 'ENOTNTFS' });
  }
  if (reader.useSectorSize) reader.useSectorSize(boot.bytesPerSector);

  // The fixups rewrite the buffer, and the run list is at an offset *into
  // that rewritten buffer* -- so the same copy has to be kept and read from,
  // not the bytes that came off the disk.
  const zeroRecord = Buffer.from(await reader.read(Number(boot.mftOffset), boot.recordBytes));
  const zero = ntfs.parseRecord(zeroRecord, boot.bytesPerSector);
  if (!zero) {
    throw Object.assign(new Error('the $MFT record could not be read'), { code: 'EMFT' });
  }

  const data = ntfs.unnamedData(zero.attributes);
  if (!data || !data.nonResident) {
    throw Object.assign(new Error('$MFT has no extents'), { code: 'EMFT' });
  }

  const runs = ntfs.parseDataRuns(zeroRecord, data.runsAt, data.attributeEnd);
  const extents = ntfs.runsToExtents(runs, boot.clusterBytes);
  if (extents.length === 0) {
    throw Object.assign(new Error('$MFT has no extents'), { code: 'EMFT' });
  }

  const sizeBytes = data.size;
  const records = Number(sizeBytes / BigInt(boot.recordBytes));
  if (records < 1 || records > MAX_RECORDS) {
    throw Object.assign(new Error(`$MFT claims ${records} records`), { code: 'EMFT' });
  }

  return { boot, extents, sizeBytes, records };
}

/**
 * Every FILE record in `$MFT`, in order, read a megabyte at a time.
 *
 * Requires a `reader.read` that returns buffers the caller owns: the fixups
 * are applied in place, over the chunk itself (see `openVolume`).
 *
 * `$MFT` is fragmented on any volume that has been used, so the records are
 * not one run of bytes -- they are however many extents the run list named,
 * and a record never straddles two of them because NTFS allocates `$MFT` in
 * whole clusters.
 *
 * @param {object} reader
 * @param {object} located  from locateMft
 * @param {object} [options]
 * @param {{cancelled: boolean}} [options.token]
 * @param {(p: object) => void} [options.onProgress]
 */
async function* readRecords(reader, located, { token = null, onProgress = null } = {}) {
  const { boot, extents } = located;
  const recordBytes = boot.recordBytes;
  let number = 0;
  let lastReport = 0;

  for (const extent of extents) {
    let at = 0n;
    const length = extent.length;

    while (at < length) {
      if (token && token.cancelled) return;

      const want = Number(length - at < BigInt(CHUNK_BYTES) ? length - at : BigInt(CHUNK_BYTES));
      const chunk = await reader.read(Number(extent.offset + at), want);
      if (chunk.length === 0) break;

      for (let off = 0; off + recordBytes <= chunk.length; off += recordBytes) {
        // A view into the chunk, not a copy of it. The fixups do write into
        // this, and that is safe: each record's repairs touch only its own
        // 1,024 bytes, the chunk is freshly allocated by every read, and
        // everything taken out of a record is turned into a string or a
        // number before the next chunk arrives. Copying here instead cost
        // 1.9 million allocations on this machine's C:, which is most of a
        // volume's worth of garbage for no benefit at all.
        const slot = chunk.subarray(off, off + recordBytes);

        // An empty slot and a damaged record are not the same thing, and
        // saying so matters: `$MFT` is allocated in whole clusters and is
        // always partly empty, so counting its spare slots as damage would
        // report every healthy volume as torn. Only something that claims to
        // be a record and then fails is torn.
        const looksLikeRecord = slot.toString('latin1', 0, 4) === 'FILE';
        const record = looksLikeRecord ? ntfs.parseRecord(slot, boot.bytesPerSector) : null;

        // Either way the slot is counted: the numbering has to keep going or
        // every parent reference after it points at the wrong file.
        yield {
          number,
          record,
          state: record ? 'ok' : (looksLikeRecord ? 'torn' : 'unused'),
        };
        number += 1;
      }

      at += BigInt(chunk.length);

      if (onProgress && Date.now() - lastReport > 150) {
        lastReport = Date.now();
        onProgress({ phase: 'mft', records: number, of: located.records });
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* from records to paths                                                      */
/* -------------------------------------------------------------------------- */

/**
 * **One pass, and only the folders held as objects.**
 *
 * Three shapes were measured on this machine before this one was settled on:
 *
 *   everything in a Map      died. 1.2 million files on C: filled a 4 GB heap
 *                            and V8 gave up mid-read -- and before it died it
 *                            was already slower for it, a second read of D:
 *                            taking 25.3 s against the first read's 15.0 s,
 *                            all of it garbage collection.
 *   two passes, folders only  worked and fit in 614 MB, but read `$MFT` twice
 *                            and parsed 3.5 million record headers to use
 *                            1.8 million of them.
 *   one pass, files packed    this. `$MFT` is read once, and a file's fields
 *                            go into number arrays that cost no object header
 *                            and give the collector nothing to walk.
 *
 * Folders stay as objects because there are far fewer of them -- 568,235
 * against 1,196,643 files on C: -- and because a path needs them at random
 * while a file is needed once and then forgotten.
 */

/** Files as columns of numbers rather than a million objects. */
class FileColumns {
  constructor(capacity = 1 << 16) {
    this.length = 0;
    this.capacity = capacity;
    this.record = new Int32Array(capacity);
    this.parent = new Int32Array(capacity);
    this.size = new Float64Array(capacity);
    this.allocated = new Float64Array(capacity);
    this.modified = new Float64Array(capacity);
    this.accessed = new Float64Array(capacity);
    this.created = new Float64Array(capacity);
    this.attributes = new Int32Array(capacity);
    // Which kind of reparse point, and 0 for the overwhelming majority that
    // are not one. It is kept apart from `attributes` because the attribute
    // bit says only *that* a record is a reparse point, and the walk needs to
    // know *which*: a junction must not be entered, OneDrive's folder must.
    this.reparse = new Uint32Array(capacity);
    this.links = new Uint16Array(capacity);
    // 1 sparse, 2 compressed, 4 resident.
    this.flags = new Uint8Array(capacity);
    // The one field that cannot be a number. Short -- a name, never a path.
    this.name = new Array(capacity);
    // Only for the few files that really are in more than one folder. NOT
    // for a file that merely has an 8.3 alias beside its long name, which is
    // most of them: 850,819 of C:'s 1,196,520 files, and holding a pair of
    // objects for each cost 350 MB of heap to say nothing.
    this.hardLinks = new Map();
  }

  grow() {
    const capacity = this.capacity * 2;
    for (const field of ['record', 'parent', 'size', 'allocated', 'modified', 'accessed', 'created', 'attributes', 'reparse', 'links', 'flags']) {
      const bigger = new this[field].constructor(capacity);
      bigger.set(this[field]);
      this[field] = bigger;
    }
    this.name.length = capacity;
    this.capacity = capacity;
  }

  push(number, described) {
    if (this.length === this.capacity) this.grow();
    const i = this.length++;
    this.record[i] = number;
    this.parent[i] = described.parent;
    this.size[i] = described.size;
    this.allocated[i] = described.allocated;
    this.modified[i] = described.modifiedMs === null ? 0 : described.modifiedMs;
    this.accessed[i] = described.accessedMs === null ? 0 : described.accessedMs;
    this.created[i] = described.createdMs === null ? 0 : described.createdMs;
    this.attributes[i] = described.attributes;
    this.reparse[i] = described.reparseTag || 0;
    this.links[i] = described.hardLinkCount;
    this.flags[i] = (described.sparse ? 1 : 0) | (described.compressed ? 2 : 0) | (described.resident ? 4 : 0);
    this.name[i] = described.name;
    // A hard link is the same file in another folder. Two names in the same
    // folder is one name and the short form of it.
    if (described.links.length > 1 && described.links.some((l) => l.parent !== described.parent)) {
      this.hardLinks.set(i, described.links);
    }
  }

  /** Back into the shape the rest of the app reads, one at a time. */
  at(i, path) {
    const flags = this.flags[i];
    return {
      recordNumber: this.record[i],
      parent: this.parent[i],
      name: this.name[i],
      path,
      links: this.hardLinks.get(i) || [{ parent: this.parent[i], name: this.name[i] }],
      hardLinkCount: this.links[i],
      isDirectory: false,
      size: this.size[i],
      allocated: this.allocated[i],
      sparse: (flags & 1) !== 0,
      compressed: (flags & 2) !== 0,
      resident: (flags & 4) !== 0,
      attributes: this.attributes[i],
      reparseTag: this.reparse[i],
      modifiedMs: this.modified[i] || null,
      accessedMs: this.accessed[i] || null,
      createdMs: this.created[i] || null,
    };
  }
}

/**
 * The one pass: folders into a map, files into columns, spilled attributes
 * into a third place to be reunited with their bases afterwards.
 */
async function collect(records, { token = null } = {}) {
  const folders = new Map();
  const spill = new Map();
  // Folders whose names may still be in an extension record, and files whose
  // sizes may be. Both are resolved once the pass is over.
  const pendingFolders = new Map();
  const pendingFiles = [];
  const files = new FileColumns();
  const stats = { torn: 0, unused: 0, skipped: 0, withList: 0 };

  for await (const { number, record, state } of records) {
    if (token && token.cancelled) break;
    if (!record) {
      if (state === 'torn') stats.torn += 1;
      else stats.unused += 1;
      continue;
    }
    if (!record.inUse) {
      stats.skipped += 1;
      continue;
    }

    if (record.baseRecord !== 0) {
      // An extension record is not a file. Its names and sizes belong to the
      // base named here, which may come before or after it in the table.
      const names = ntfs.namesOf(record.attributes);
      const facts = ntfs.dataFacts(ntfs.unnamedData(record.attributes));
      const into = spill.get(record.baseRecord) || { names: [], facts: null, reparseTag: 0 };
      if (names.length) into.names.push(...names);
      // Only the piece starting at VCN 0 carries real sizes; `dataFacts`
      // returns null for the rest, so the first real one wins and a later
      // piece cannot overwrite it with zeroes.
      if (!into.facts && facts) into.facts = facts;
      // `$REPARSE_POINT` is small and normally sits in the base record, but a
      // record whose attributes spilled can carry it out here. Missing it
      // would call a junction an ordinary folder and walk into it twice.
      if (!into.reparseTag) into.reparseTag = ntfs.reparseTagOf(record.attributes);
      spill.set(record.baseRecord, into);
      continue;
    }

    const spilled = ntfs.hasAttributeList(record.attributes);
    if (spilled) stats.withList += 1;

    if (record.isDirectory) {
      const names = ntfs.namesOf(record.attributes);
      // A folder whose attributes did not fit in one record has to wait: the
      // name in the base may be the 8.3 one while the real name is in an
      // extension not yet read. `C:\Users\...\Documents\Virtual Machines` on
      // this machine is exactly that, and taking the base record's answer put
      // 9 GB of virtual disks under `VIRTUA~1\...` -- a path that resolves,
      // and that nobody would recognise or be able to search for.
      const info = record.attributes.find((a) => a.type === ntfs.ATTR.STANDARD_INFORMATION);
      const standard = info && info.value ? ntfs.parseStandardInformation(info.value) : null;
      // The attributes come along because the walk filters on hidden and
      // system; the reparse tag comes along because a junction must not be
      // entered while OneDrive's folder -- a reparse point of another kind
      // entirely -- must be. See `ntfs.REPARSE_TAG`.
      const attributes = standard ? standard.attributes : 0;
      const reparseTag = ntfs.reparseTagOf(record.attributes);
      if (spilled) pendingFolders.set(number, { names, attributes, reparseTag });
      else if (names.length) folders.set(number, { parent: names[0].parent, name: names[0].name, attributes, reparseTag });
      continue;
    }

    if (number < ntfs.FIRST_USER_RECORD) continue;

    const names = ntfs.namesOf(record.attributes);
    const facts = ntfs.dataFacts(ntfs.unnamedData(record.attributes));
    if (spilled) {
      // Held whole until the extensions have been seen. There are few of
      // them -- 54,358 on C: -- so holding the records costs little.
      pendingFiles.push({ number, record, names, facts });
      continue;
    }
    const described = ntfs.describeFrom(record, names, facts);
    if (described) files.push(number, described);
    else stats.skipped += 1;
  }

  // Now that every extension record has been seen, the waiting records can be
  // put back together. This is what makes the sizes right: a file fragmented
  // enough that its run list will not fit in one record keeps its `$DATA` in
  // an extension, and a reader that stops at the base gives it a size of zero
  // -- measured here before it was fixed, 124 GB of C: went missing that way,
  // with the file *count* correct to within 37, which is how it hid.
  for (const [number, held] of pendingFolders) {
    const extra = spill.get(number);
    const all = extra && extra.names.length ? ntfs.sortNames([...held.names, ...extra.names]) : held.names;
    if (all.length) {
      folders.set(number, {
        parent: all[0].parent,
        name: all[0].name,
        attributes: held.attributes,
        reparseTag: held.reparseTag || (extra ? extra.reparseTag : 0) || 0,
      });
    }
  }
  for (const held of pendingFiles) {
    const extra = spill.get(held.number);
    let names = held.names;
    let facts = held.facts;
    let reparseTag = 0;
    if (extra) {
      if (extra.names.length) names = ntfs.sortNames([...names, ...extra.names]);
      if (!facts && extra.facts) facts = extra.facts;
      reparseTag = extra.reparseTag || 0;
    }
    const described = ntfs.describeFrom(held.record, names, facts, { reparseTag });
    if (described) files.push(held.number, described);
    else stats.skipped += 1;
  }

  return { folders, files, spill, stats };
}

/**
 * The full path of every folder, by walking parents to the root.
 *
 * Resolved once, for folders only, and then every file's path is one string
 * join away. A parent that is missing -- a folder deleted while this was
 * reading -- leaves its children orphaned rather than failing the pass, and a
 * chain that loops is cut rather than followed.
 */
function resolveFolderPaths(folders, root) {
  const base = root.endsWith('\\') ? root.slice(0, -1) : root;
  const paths = new Map([[ntfs.ROOT_RECORD, base]]);
  let orphaned = 0;
  let looped = 0;

  const chain = [];
  for (const start of folders.keys()) {
    if (paths.has(start)) continue;
    chain.length = 0;
    let at = start;
    let found = null;
    const seen = new Set();

    for (let depth = 0; depth < 512; depth++) {
      if (paths.has(at)) {
        found = paths.get(at);
        break;
      }
      const folder = folders.get(at);
      if (!folder) break;
      if (seen.has(at)) {
        looped += 1;
        break;
      }
      seen.add(at);
      chain.push({ number: at, name: folder.name });
      at = folder.parent;
    }

    if (found === null) {
      for (const link of chain) paths.set(link.number, null);
      orphaned += chain.length;
      continue;
    }
    let full = found;
    for (let i = chain.length - 1; i >= 0; i--) {
      full = full + '\\' + chain[i].name;
      paths.set(chain[i].number, full);
    }
  }

  return { paths, orphaned, looped };
}

/* -------------------------------------------------------------------------- */
/* the whole thing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Read a volume's catalogue and hand every file to `onFile`, one at a time.
 *
 * `$MFT` is read once. Nothing is accumulated on the caller's behalf: what
 * each file costs is what `onFile` decides to keep of it.
 *
 * @param {object} reader   from openVolume
 * @param {string} root     'D:\'
 * @param {(file: object) => void} onFile
 * @param {object} [options]
 * @returns {Promise<object>}  counts, and nothing that grows with the volume
 */
async function scanVolume(reader, root, onFile, { token = null, onProgress = null, onFolder = null } = {}) {
  const started = Date.now();
  const located = await locateMft(reader);

  const { folders, files, spill, stats } = await collect(
    readRecords(reader, located, { token, onProgress }),
    { token }
  );
  const { paths, orphaned, looped } = resolveFolderPaths(folders, root);

  // The folders, for a caller building a tree out of them. The root is left
  // out: it is where the scan starts, not something found inside it.
  if (onFolder) {
    for (const [number, full] of paths) {
      if (number === ntfs.ROOT_RECORD || !full) continue;
      onFolder({ recordNumber: number, path: full, name: full.slice(full.lastIndexOf('\\') + 1), isDirectory: true });
    }
  }

  let count = 0;
  let bytes = 0;
  let allocated = 0;
  let orphanedFiles = 0;
  for (let i = 0; i < files.length; i++) {
    if (token && token.cancelled) break;
    const folder = paths.get(files.parent[i]);
    if (!folder) {
      // Its folder is not in the table, or is itself orphaned: it was deleted
      // while this was reading. Left out rather than attached to the root,
      // where it would look like a file somebody could find.
      orphanedFiles += 1;
      continue;
    }
    count += 1;
    bytes += files.size[i];
    allocated += files.allocated[i];
    onFile(files.at(i, folder + '\\' + files.name[i]));
  }

  return {
    root,
    boot: {
      bytesPerSector: located.boot.bytesPerSector,
      clusterBytes: located.boot.clusterBytes,
      recordBytes: located.boot.recordBytes,
    },
    mftBytes: Number(located.sizeBytes),
    recordsRead: located.records,
    fileCount: count,
    folderCount: paths.size - 1,
    totalBytes: bytes,
    totalAllocated: allocated,
    torn: stats.torn,
    // Spare slots in a table allocated in whole clusters: normal, not damage.
    unused: stats.unused,
    skipped: stats.skipped,
    // Records whose attributes did not fit in one, and the extension records
    // that carried the rest. Reported because a reader that ignored them
    // would look healthy and be wrong (see `collect`).
    withList: stats.withList,
    // Base records whose attributes continued elsewhere -- not, as an earlier
    // version of this line said, files with more than one name.
    spilled: spill.size,
    // Folders whose own parent is gone, and the files that were inside them.
    orphaned: orphaned + orphanedFiles,
    orphanedFolders: orphaned,
    orphanedFiles,
    looped,
    cancelled: Boolean(token && token.cancelled),
    durationMs: Date.now() - started,
  };
}

/**
 * The same read, collected into arrays.
 *
 * For a volume small enough to hold -- which the harness's is, and a system
 * drive is not. `scanVolume` is what the app uses; this exists so a test can
 * say "and then these files were there" in one expression.
 */
async function readVolume(reader, root, { token = null, onProgress = null } = {}) {
  const files = [];
  const dirs = [];
  const summary = await scanVolume(reader, root, (file) => files.push(file), {
    token,
    onProgress,
    onFolder: (folder) => dirs.push(folder),
  });
  return { ...summary, files, dirs };
}

module.exports = {
  openVolume,
  locateMft,
  readRecords,
  collect,
  resolveFolderPaths,
  FileColumns,
  scanVolume,
  readVolume,
  CHUNK_BYTES,
  MAX_RECORDS,
  DEFAULT_SECTOR,
};
