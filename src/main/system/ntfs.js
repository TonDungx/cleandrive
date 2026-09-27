'use strict';

/**
 * Reading NTFS's own catalogue: the structures inside `$MFT` (A2).
 *
 * Every function here takes a buffer and returns a value. Nothing opens a
 * file, nothing needs a volume, and nothing needs elevation -- which is the
 * point. Opening `\\.\C:` needs administrator; understanding what comes out of
 * it does not, and that is where all the ways to be wrong live. The harness
 * (`scripts/test-ntfs.js`) builds records byte by byte and checks this against
 * them, so the part that cannot be run without a UAC prompt is the part with
 * no logic in it.
 *
 * The layouts below are the on-disk format, which Microsoft has not changed
 * since NTFS 3.1. Offsets are written as hex to match every reference you will
 * find, and each field says what it is for rather than only what it is called.
 *
 * **Sizes come from the unnamed `$DATA` attribute, not from `$FILE_NAME`.**
 * `$FILE_NAME` carries a size too and it is stale: Windows only refreshes it
 * when the directory entry is rewritten, so a file that has grown since its
 * last rename reports its old length there. Tools that read it are the reason
 * "MFT scanners disagree with Explorer" is a familiar complaint.
 */

/* -------------------------------------------------------------------------- */
/* the volume's geometry                                                      */
/* -------------------------------------------------------------------------- */

/** Where the boot sector keeps what the rest of this needs. */
const BOOT = {
  oem: 0x03, // "NTFS    "
  bytesPerSector: 0x0b,
  sectorsPerCluster: 0x0d,
  totalSectors: 0x28,
  mftCluster: 0x30,
  mftMirrorCluster: 0x38,
  clustersPerRecord: 0x40,
  clustersPerIndex: 0x44,
  signature: 0x1fe,
};

/**
 * A negative "clusters per record" is a power of two in bytes, which is how
 * NTFS writes 1024 when a cluster is bigger than a record. The same trick
 * appears for index buffers and for sectors per cluster on huge volumes.
 */
function sizeFromClusterCount(value, clusterBytes) {
  return value < 0 ? 2 ** -value : value * clusterBytes;
}

/**
 * The volume's geometry, or null when this is not an NTFS boot sector.
 *
 * @param {Buffer} buf  at least 512 bytes from offset 0 of the volume
 */
function parseBootSector(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 512) return null;
  if (buf.toString('latin1', BOOT.oem, BOOT.oem + 8) !== 'NTFS    ') return null;
  if (buf.readUInt16LE(BOOT.signature) !== 0xaa55) return null;

  const bytesPerSector = buf.readUInt16LE(BOOT.bytesPerSector);
  if (![512, 1024, 2048, 4096].includes(bytesPerSector)) return null;

  const rawSectorsPerCluster = buf.readInt8(BOOT.sectorsPerCluster);
  const sectorsPerCluster = rawSectorsPerCluster < 0 ? 2 ** -rawSectorsPerCluster : rawSectorsPerCluster;
  if (sectorsPerCluster < 1 || sectorsPerCluster > 0x10000) return null;

  const clusterBytes = bytesPerSector * sectorsPerCluster;
  const recordBytes = sizeFromClusterCount(buf.readInt8(BOOT.clustersPerRecord), clusterBytes);
  // A FILE record is 1024 bytes on every volume anyone has; refusing the
  // absurd is cheaper than carrying a buffer size that came off the disk.
  if (recordBytes < 256 || recordBytes > 64 * 1024) return null;

  return {
    bytesPerSector,
    sectorsPerCluster,
    clusterBytes,
    totalSectors: buf.readBigUInt64LE(BOOT.totalSectors),
    mftCluster: buf.readBigUInt64LE(BOOT.mftCluster),
    mftMirrorCluster: buf.readBigUInt64LE(BOOT.mftMirrorCluster),
    recordBytes,
    indexBytes: sizeFromClusterCount(buf.readInt8(BOOT.clustersPerIndex), clusterBytes),
    get mftOffset() {
      return this.mftCluster * BigInt(this.clusterBytes);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* the update sequence, which has to be undone before anything can be read     */
/* -------------------------------------------------------------------------- */

/**
 * Put back the last two bytes of every sector.
 *
 * NTFS writes the same two-byte number over the end of each sector of a record
 * and keeps the real values in an array in the header. That is how it detects
 * a write that was torn halfway: if the marks do not all match, the record was
 * only partly written.
 *
 * **Everything downstream is wrong if this is skipped**, and wrong quietly --
 * the corruption lands two bytes at a time, 510 bytes apart, so most records
 * still look plausible. It reads as a rare, unexplainable wrong file size.
 *
 * @param {Buffer} record   modified in place
 * @param {number} bytesPerSector
 * @param {number} arrayOffset  from the record header
 * @param {number} arrayCount   entries, the first of which is the mark itself
 * @returns {boolean}  false when the record is torn or the header is nonsense
 */
function applyFixups(record, bytesPerSector, arrayOffset, arrayCount) {
  if (arrayCount < 1) return false;
  const end = arrayOffset + arrayCount * 2;
  if (arrayOffset < 0 || end > record.length) return false;

  const sectors = arrayCount - 1;
  if (sectors * bytesPerSector > record.length) return false;

  const mark = record.readUInt16LE(arrayOffset);
  for (let i = 0; i < sectors; i++) {
    const at = (i + 1) * bytesPerSector - 2;
    if (at + 2 > record.length) return false;
    // A sector whose tail does not carry the mark was not written with the
    // rest of this record.
    if (record.readUInt16LE(at) !== mark) return false;
    record.writeUInt16LE(record.readUInt16LE(arrayOffset + (i + 1) * 2), at);
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* a FILE record                                                              */
/* -------------------------------------------------------------------------- */

const RECORD = {
  magic: 0x00, // "FILE"
  usaOffset: 0x04,
  usaCount: 0x06,
  logSequence: 0x08,
  sequenceNumber: 0x10,
  hardLinkCount: 0x12,
  firstAttribute: 0x14,
  flags: 0x16,
  usedSize: 0x18,
  allocatedSize: 0x1c,
  baseReference: 0x20,
  nextAttributeId: 0x28,
  recordNumber: 0x2c, // NTFS 3.1 and later
};

const RECORD_FLAGS = { inUse: 0x01, directory: 0x02 };

/** Attribute types this cares about. The rest are stepped over by length. */
const ATTR = Object.freeze({
  STANDARD_INFORMATION: 0x10,
  ATTRIBUTE_LIST: 0x20,
  FILE_NAME: 0x30,
  DATA: 0x80,
  INDEX_ROOT: 0x90,
  REPARSE_POINT: 0xc0,
  END: 0xffffffff,
});

/**
 * The reparse tags that make a folder or a file a *link*.
 *
 * The attribute bit alone does not: a reparse point is an extension point,
 * and Windows hangs several unrelated things off it. OneDrive's sync root is
 * one, every OneDrive placeholder file is another, Phone Link's `CrossDevice`
 * folders are a third. Only a symbolic link and a junction redirect a path
 * somewhere else, and only those two must not be walked into.
 *
 * This is the same rule libuv applies (`uv_fs_lstat` reports a symlink for
 * exactly these two tags and a plain file or folder for every other), which
 * is why the ordinary walk and this agree: `lib/real-fs.js` gets the answer by
 * asking `lstat` a second time, and this gets it by reading the tag `$MFT`
 * already holds. Measured consequence of getting it wrong, written down in
 * `real-fs.js`: a scan that trusted the bit lost the whole of OneDrive, and
 * on this machine that is Documents, Pictures and the Desktop.
 */
const REPARSE_TAG = Object.freeze({
  MOUNT_POINT: 0xa0000003,
  SYMLINK: 0xa000000c,
});

/** True for a tag a walk must refuse to follow. */
function isLinkTag(tag) {
  return tag === REPARSE_TAG.MOUNT_POINT || tag === REPARSE_TAG.SYMLINK;
}

/** The namespace a `$FILE_NAME` is written in. */
const NAMESPACE = Object.freeze({ POSIX: 0, WIN32: 1, DOS: 2, WIN32_AND_DOS: 3 });

/**
 * A 64-bit MFT reference: 48 bits of record number, 16 of sequence number.
 * The sequence number is what makes a stale reference detectable, and it is
 * dropped here -- every caller wants the record.
 */
function referenceToRecord(value) {
  return Number(BigInt(value) & 0xffffffffffffn);
}

/** Windows FILETIME (100 ns since 1601) as a JavaScript timestamp. */
function fileTimeToMs(value) {
  if (value === 0n || value === undefined || value === null) return null;
  const ms = value / 10000n - 11644473600000n;
  const n = Number(ms);
  // A timestamp outside what a Date can mean is a misread, not a date.
  return Number.isFinite(n) && n > -62135596800000 && n < 253402300799999 ? n : null;
}

/**
 * Split a record into its attributes, without interpreting any of them.
 *
 * Stops at the end marker, at the record's used size, or at the first length
 * that does not move forward -- a zero or backwards length in a damaged record
 * is an infinite loop, and this is parsing bytes that came off a disk.
 *
 * @param {Buffer} record   after fixups
 * @param {number} from     offset of the first attribute
 * @param {number} limit    used size of the record
 */
function parseAttributes(record, from, limit) {
  const out = [];
  let at = from;
  const end = Math.min(limit, record.length);

  while (at + 4 <= end) {
    const type = record.readUInt32LE(at);
    if (type === ATTR.END) break;
    if (at + 8 > end) break;

    const length = record.readUInt32LE(at + 4);
    if (length < 16 || at + length > end) break;

    const nonResident = record.readUInt8(at + 0x08) !== 0;
    const nameLength = record.readUInt8(at + 0x09);
    const nameOffset = record.readUInt16LE(at + 0x0a);
    const flags = record.readUInt16LE(at + 0x0c);
    const name = nameLength > 0 && at + nameOffset + nameLength * 2 <= at + length
      ? record.toString('utf16le', at + nameOffset, at + nameOffset + nameLength * 2)
      : '';

    const attribute = {
      type,
      name,
      nonResident,
      compressed: (flags & 0x0001) !== 0,
      encrypted: (flags & 0x4000) !== 0,
      sparse: (flags & 0x8000) !== 0,
      id: record.readUInt16LE(at + 0x0e),
    };

    if (!nonResident) {
      const valueLength = record.readUInt32LE(at + 0x10);
      const valueOffset = record.readUInt16LE(at + 0x14);
      const start = at + valueOffset;
      if (start + valueLength <= at + length && valueLength >= 0) {
        attribute.value = record.subarray(start, start + valueLength);
        attribute.size = valueLength;
        attribute.allocated = valueLength;
      } else {
        attribute.value = Buffer.alloc(0);
        attribute.size = 0;
        attribute.allocated = 0;
      }
    } else {
      attribute.startVcn = record.readBigUInt64LE(at + 0x10);
      attribute.lastVcn = record.readBigUInt64LE(at + 0x18);
      attribute.runsOffset = record.readUInt16LE(at + 0x20);
      attribute.allocated = record.readBigUInt64LE(at + 0x28);
      attribute.size = record.readBigUInt64LE(at + 0x30);
      attribute.initialised = record.readBigUInt64LE(at + 0x38);
      attribute.runsAt = at + attribute.runsOffset;
      attribute.attributeEnd = at + length;
    }

    out.push(attribute);
    at += length;
  }

  return out;
}

/**
 * One FILE record, fixed up and split into attributes.
 *
 * @param {Buffer} record   modified in place by the fixups
 * @param {number} bytesPerSector
 * @returns {object|null}  null when it is not a record, or is torn
 */
function parseRecord(record, bytesPerSector) {
  if (!Buffer.isBuffer(record) || record.length < 48) return null;
  if (record.toString('latin1', 0, 4) !== 'FILE') return null;

  const usaOffset = record.readUInt16LE(RECORD.usaOffset);
  const usaCount = record.readUInt16LE(RECORD.usaCount);
  if (!applyFixups(record, bytesPerSector, usaOffset, usaCount)) return null;

  const flags = record.readUInt16LE(RECORD.flags);
  const usedSize = record.readUInt32LE(RECORD.usedSize);
  const firstAttribute = record.readUInt16LE(RECORD.firstAttribute);
  if (firstAttribute < 42 || firstAttribute >= record.length) return null;

  return {
    recordNumber: record.readUInt32LE(RECORD.recordNumber),
    sequenceNumber: record.readUInt16LE(RECORD.sequenceNumber),
    hardLinkCount: record.readUInt16LE(RECORD.hardLinkCount),
    inUse: (flags & RECORD_FLAGS.inUse) !== 0,
    isDirectory: (flags & RECORD_FLAGS.directory) !== 0,
    baseRecord: referenceToRecord(record.readBigUInt64LE(RECORD.baseReference)),
    attributes: parseAttributes(record, firstAttribute, Math.min(usedSize || record.length, record.length)),
  };
}

/* -------------------------------------------------------------------------- */
/* the attributes that matter                                                 */
/* -------------------------------------------------------------------------- */

/** `$STANDARD_INFORMATION`: the timestamps Explorer shows, and the flags. */
function parseStandardInformation(value) {
  if (!Buffer.isBuffer(value) || value.length < 0x24) return null;
  return {
    createdMs: fileTimeToMs(value.readBigUInt64LE(0x00)),
    modifiedMs: fileTimeToMs(value.readBigUInt64LE(0x08)),
    recordChangedMs: fileTimeToMs(value.readBigUInt64LE(0x10)),
    accessedMs: fileTimeToMs(value.readBigUInt64LE(0x18)),
    attributes: value.readUInt32LE(0x20),
  };
}

/**
 * `$FILE_NAME`: one name this record is known by, and the folder it is in.
 *
 * A record has one of these per hard link, plus a second for the short 8.3
 * name where one exists. The sizes in here are deliberately not returned: see
 * the note at the top of the file.
 */
function parseFileName(value) {
  if (!Buffer.isBuffer(value) || value.length < 0x42) return null;
  const nameLength = value.readUInt8(0x40);
  const end = 0x42 + nameLength * 2;
  if (end > value.length) return null;
  return {
    parent: referenceToRecord(value.readBigUInt64LE(0x00)),
    namespace: value.readUInt8(0x41),
    flags: value.readUInt32LE(0x38),
    name: value.toString('utf16le', 0x42, end),
  };
}

/**
 * The extents of a non-resident attribute, as (cluster, count) pairs.
 *
 * Each run is a header byte saying how many bytes hold the length and how many
 * hold the offset, then those bytes. The offset is *signed* and *relative to
 * the previous run* -- a file written backwards across the disk has negative
 * deltas, and reading them as unsigned sends the reader to a cluster number
 * near 2^64. A run with no offset bytes at all is a sparse hole.
 *
 * @param {Buffer} buf
 * @param {number} at     first run header
 * @param {number} end    not read past here
 * @returns {Array<{lcn: bigint|null, clusters: bigint}>}  lcn null means sparse
 */
function parseDataRuns(buf, at, end = buf.length) {
  const runs = [];
  let offset = at;
  let lcn = 0n;

  while (offset < end) {
    const header = buf.readUInt8(offset);
    if (header === 0) break;
    const lengthBytes = header & 0x0f;
    const offsetBytes = (header >> 4) & 0x0f;
    if (lengthBytes === 0 || lengthBytes > 8 || offsetBytes > 8) break;
    offset += 1;
    if (offset + lengthBytes + offsetBytes > end) break;

    let clusters = 0n;
    for (let i = lengthBytes - 1; i >= 0; i--) clusters = (clusters << 8n) | BigInt(buf.readUInt8(offset + i));
    offset += lengthBytes;

    if (offsetBytes === 0) {
      // Sparse: the run occupies no clusters on the disk at all.
      runs.push({ lcn: null, clusters });
      continue;
    }

    // Sign-extend from the top byte of the delta.
    let delta = 0n;
    for (let i = offsetBytes - 1; i >= 0; i--) delta = (delta << 8n) | BigInt(buf.readUInt8(offset + i));
    const signBit = 1n << BigInt(offsetBytes * 8 - 1);
    if (delta & signBit) delta -= 1n << BigInt(offsetBytes * 8);
    offset += offsetBytes;

    lcn += delta;
    if (lcn < 0n) break;
    runs.push({ lcn, clusters });
  }

  return runs;
}

/** Every byte range a set of runs covers, in order, ignoring sparse holes. */
function runsToExtents(runs, clusterBytes) {
  const extents = [];
  let vcn = 0n;
  for (const run of runs) {
    if (run.lcn !== null) {
      extents.push({
        offset: run.lcn * BigInt(clusterBytes),
        length: run.clusters * BigInt(clusterBytes),
        vcn,
      });
    }
    vcn += run.clusters;
  }
  return extents;
}

/* -------------------------------------------------------------------------- */
/* what a record says about one file                                          */
/* -------------------------------------------------------------------------- */

/** The `$DATA` attribute a file's size comes from: the one with no name. */
function unnamedData(attributes) {
  return attributes.find((a) => a.type === ATTR.DATA && a.name === '') || null;
}

/** Does this record's attributes continue in other records? */
function hasAttributeList(attributes) {
  return Array.isArray(attributes) && attributes.some((a) => a.type === ATTR.ATTRIBUTE_LIST);
}

/**
 * Which kind of reparse point this is, or 0 when it is not one.
 *
 * The tag is the first four bytes of `$REPARSE_POINT`'s value. The attribute
 * is small and always resident, so it is in the base record whenever the
 * record has one at all -- but a record whose attributes spilled can carry it
 * in an extension, and `system/mft.js` puts those back together before asking.
 */
function reparseTagOf(attributes) {
  if (!Array.isArray(attributes)) return 0;
  const found = attributes.find((a) => a.type === ATTR.REPARSE_POINT && a.value && a.value.length >= 4);
  return found ? found.value.readUInt32LE(0) : 0;
}

/**
 * The size facts of one `$DATA` attribute, or null when it has none to give.
 *
 * **A non-resident attribute only carries its sizes in the piece that starts
 * at VCN 0.** When a file is fragmented enough that its run list will not fit
 * in one record, NTFS splits `$DATA` across several -- and every piece after
 * the first has its size fields zeroed, because they describe the whole
 * attribute and only one copy can. Reading a later piece gives a large file a
 * size of nothing, which is exactly how 124 GB went missing from this
 * machine's C: before attribute lists were followed.
 */
function dataFacts(attribute) {
  if (!attribute) return null;
  if (!attribute.nonResident) {
    return {
      size: attribute.size,
      allocated: attribute.size,
      sparse: false,
      compressed: false,
      resident: true,
    };
  }
  if (attribute.startVcn !== 0n) return null;
  return {
    size: Number(attribute.size),
    allocated: Number(attribute.allocated),
    sparse: Boolean(attribute.sparse),
    compressed: Boolean(attribute.compressed),
    resident: false,
  };
}

/**
 * An `$ATTRIBUTE_LIST`: which other records hold the rest of this file.
 *
 * A file gets one when its attributes outgrow a single 1 KB record -- a heavily
 * fragmented virtual disk, a file with many hard links, a folder with a large
 * index. The base record then holds this list and possibly nothing else of
 * interest, so a reader that stops at the base record loses that file's size,
 * or its name, or both.
 *
 * @param {Buffer} value
 * @returns {Array<{type: number, name: string, startVcn: bigint, record: number}>}
 */
function parseAttributeList(value) {
  const out = [];
  if (!Buffer.isBuffer(value)) return out;
  let at = 0;

  while (at + 0x1a <= value.length) {
    const type = value.readUInt32LE(at);
    if (type === ATTR.END) break;
    const length = value.readUInt16LE(at + 0x04);
    if (length < 0x18 || at + length > value.length) break;

    const nameLength = value.readUInt8(at + 0x06);
    const nameOffset = value.readUInt8(at + 0x07);
    const name = nameLength > 0 && at + nameOffset + nameLength * 2 <= at + length
      ? value.toString('utf16le', at + nameOffset, at + nameOffset + nameLength * 2)
      : '';

    out.push({
      type,
      name,
      startVcn: value.readBigUInt64LE(at + 0x08),
      record: referenceToRecord(value.readBigUInt64LE(at + 0x10)),
      id: value.readUInt16LE(at + 0x18),
    });
    at += length;
  }

  return out;
}

/**
 * Every name this record carries, best first.
 *
 * A record has a `$FILE_NAME` per hard link and often a second one holding the
 * 8.3 short name. The short one is never what to show: `PROGRA~1` is not a
 * folder anybody has. Win32 and POSIX names come first, DOS names last.
 */
function namesOf(attributes) {
  const names = [];
  for (const attribute of attributes) {
    if (attribute.type !== ATTR.FILE_NAME || !attribute.value) continue;
    const parsed = parseFileName(attribute.value);
    if (parsed) names.push(parsed);
  }
  return sortNames(names);
}

/** Put the names a person would recognise first; 8.3 short names last. */
function sortNames(names) {
  // Most records have exactly one name, and at a million records a copy and a
  // sort per record is a million of each for nothing.
  if (names.length <= 1) return names;
  return [...names].sort((a, b) => rankNamespace(a.namespace) - rankNamespace(b.namespace));
}

function rankNamespace(namespace) {
  if (namespace === NAMESPACE.WIN32 || namespace === NAMESPACE.WIN32_AND_DOS) return 0;
  if (namespace === NAMESPACE.POSIX) return 1;
  return 2;
}

/**
 * What the scan needs from one record, or null when there is nothing to say.
 *
 * `size` is the logical length and `allocated` what it occupies; for a sparse
 * or compressed file those differ, and the second is the one that is really on
 * the disk. A resident file -- small enough to live inside its own MFT record
 * -- occupies no clusters at all, and its allocated size is reported as its
 * length rather than as zero, because "this file takes no space" is a worse
 * answer than a rounding error of under a kilobyte.
 *
 * @param {object} record  from parseRecord
 */
function describeRecord(record) {
  if (!record || !record.inUse) return null;
  // An extension record's attributes belong to its base; it is not a file.
  if (record.baseRecord !== 0) return null;

  const names = namesOf(record.attributes);
  const facts = record.isDirectory ? null : dataFacts(unnamedData(record.attributes));
  return describeFrom(record, names, facts);
}

/**
 * The same description, built from names and sizes gathered anywhere.
 *
 * Split out because a record's attributes are not always all in it: when an
 * `$ATTRIBUTE_LIST` says otherwise, the caller collects the pieces from the
 * extension records first and hands the result here (see `system/mft.js`).
 *
 * @param {object} record  the base record
 * @param {Array}  names   every `$FILE_NAME`, best first
 * @param {object|null} facts  from `dataFacts`
 * @param {object} [extra]
 * @param {number} [extra.reparseTag]  when `$REPARSE_POINT` was in an
 *   extension record rather than in the base
 */
function describeFrom(record, names, facts, extra = {}) {
  if (!names || names.length === 0) return null;
  const best = names[0];

  const info = record.attributes.find((a) => a.type === ATTR.STANDARD_INFORMATION);
  const standard = info && info.value ? parseStandardInformation(info.value) : null;

  const size = facts ? facts.size : 0;
  const allocated = facts ? facts.allocated : 0;

  return {
    recordNumber: record.recordNumber,
    parent: best.parent,
    name: best.name,
    // Every name it answers to, so a hard link in another folder is not
    // mistaken for a missing file.
    links: names.map((n) => ({ parent: n.parent, name: n.name })),
    hardLinkCount: record.hardLinkCount,
    isDirectory: record.isDirectory,
    size,
    allocated,
    sparse: Boolean(facts && facts.sparse),
    compressed: Boolean(facts && facts.compressed),
    resident: Boolean(facts && facts.resident),
    attributes: standard ? standard.attributes : 0,
    // 0 for almost everything. Non-zero says which kind of reparse point this
    // is, and only two kinds are links (`isLinkTag`).
    reparseTag: extra.reparseTag || reparseTagOf(record.attributes),
    modifiedMs: standard ? standard.modifiedMs : null,
    accessedMs: standard ? standard.accessedMs : null,
    createdMs: standard ? standard.createdMs : null,
  };
}

/** Windows' own file attribute bits, for the ones the scan filters on. */
const FILE_ATTRIBUTE = Object.freeze({
  READONLY: 0x0001,
  HIDDEN: 0x0002,
  SYSTEM: 0x0004,
  DIRECTORY: 0x0010,
  ARCHIVE: 0x0020,
  TEMPORARY: 0x0100,
  SPARSE: 0x0200,
  REPARSE_POINT: 0x0400,
  COMPRESSED: 0x0800,
  OFFLINE: 0x1000,
  NOT_CONTENT_INDEXED: 0x2000,
  ENCRYPTED: 0x4000,
  RECALL_ON_OPEN: 0x00040000,
  RECALL_ON_DATA_ACCESS: 0x00400000,
});

/**
 * The record numbers NTFS reserves for its own files, which are not anybody's
 * data and are never reported. 0-15 are the metadata files ($MFT, $LogFile,
 * $Bitmap and the rest); 5 is the root directory, which is a real folder and
 * is where every path ends.
 */
const ROOT_RECORD = 5;
const FIRST_USER_RECORD = 16;

module.exports = {
  parseBootSector,
  describeFrom,
  dataFacts,
  parseAttributeList,
  hasAttributeList,
  reparseTagOf,
  isLinkTag,
  sortNames,
  applyFixups,
  parseRecord,
  parseAttributes,
  parseStandardInformation,
  parseFileName,
  parseDataRuns,
  runsToExtents,
  describeRecord,
  namesOf,
  unnamedData,
  referenceToRecord,
  fileTimeToMs,
  ATTR,
  NAMESPACE,
  RECORD,
  RECORD_FLAGS,
  BOOT,
  FILE_ATTRIBUTE,
  REPARSE_TAG,
  ROOT_RECORD,
  FIRST_USER_RECORD,
};
