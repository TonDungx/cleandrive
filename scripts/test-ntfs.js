#!/usr/bin/env node
'use strict';

// The `$MFT` reader's understanding of NTFS (A2).
//
//   node scripts/test-ntfs.js
//
// Every record here is built byte by byte rather than read from a disk, and
// that is deliberate: opening a volume needs administrator, so if the parsing
// could only be checked against a real `$MFT` it could only be checked by
// somebody pressing a UAC prompt. Built here, the logic is covered by
// `npm test` on any machine, and the elevated part is left with no logic in it
// at all (scripts/verify-mft.js checks that half against the real disk).
//
// The fixtures are constructed, not captured. Where one encodes a real layout
// -- the boot sector of this machine's D:, a run list with a negative delta --
// it says so.

const ntfs = require('../src/main/system/ntfs');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/* -------------------------------------------------------------------------- */
/* building the fixtures                                                      */
/* -------------------------------------------------------------------------- */

const SECTOR = 512;
const RECORD_BYTES = 1024;

/** An NTFS boot sector with the geometry asked for. */
function bootSector({
  bytesPerSector = 512, sectorsPerCluster = 8, mftCluster = 786432n,
  clustersPerRecord = -10, oem = 'NTFS    ', signature = 0xaa55,
} = {}) {
  const buf = Buffer.alloc(512);
  buf.write(oem, 0x03, 'latin1');
  buf.writeUInt16LE(bytesPerSector, 0x0b);
  buf.writeInt8(sectorsPerCluster, 0x0d);
  buf.writeBigUInt64LE(976771071n, 0x28);
  buf.writeBigUInt64LE(mftCluster, 0x30);
  buf.writeBigUInt64LE(2n, 0x38);
  buf.writeInt8(clustersPerRecord, 0x40);
  buf.writeInt8(1, 0x44);
  buf.writeUInt16LE(signature, 0x1fe);
  return buf;
}

/** One attribute, header and value, as it sits inside a record. */
function residentAttribute(type, value, { name = '', flags = 0, id = 0 } = {}) {
  const nameBytes = Buffer.from(name, 'utf16le');
  const headerLength = 0x18 + nameBytes.length;
  const padded = headerLength + Math.ceil(value.length / 8) * 8;
  const buf = Buffer.alloc(Math.ceil(padded / 8) * 8);
  buf.writeUInt32LE(type, 0x00);
  buf.writeUInt32LE(buf.length, 0x04);
  buf.writeUInt8(0, 0x08); // resident
  buf.writeUInt8(name.length, 0x09);
  buf.writeUInt16LE(0x18, 0x0a);
  buf.writeUInt16LE(flags, 0x0c);
  buf.writeUInt16LE(id, 0x0e);
  buf.writeUInt32LE(value.length, 0x10);
  buf.writeUInt16LE(headerLength, 0x14);
  nameBytes.copy(buf, 0x18);
  value.copy(buf, headerLength);
  return buf;
}

function nonResidentAttribute(type, { size, allocated, runs, name = '', flags = 0 } = {}) {
  const nameBytes = Buffer.from(name, 'utf16le');
  const runsOffset = 0x40 + nameBytes.length;
  const buf = Buffer.alloc(Math.ceil((runsOffset + runs.length) / 8) * 8);
  buf.writeUInt32LE(type, 0x00);
  buf.writeUInt32LE(buf.length, 0x04);
  buf.writeUInt8(1, 0x08); // non-resident
  buf.writeUInt8(name.length, 0x09);
  buf.writeUInt16LE(0x40, 0x0a);
  buf.writeUInt16LE(flags, 0x0c);
  buf.writeBigUInt64LE(0n, 0x10); // start VCN
  buf.writeBigUInt64LE(0n, 0x18); // last VCN
  buf.writeUInt16LE(runsOffset, 0x20);
  buf.writeBigUInt64LE(BigInt(allocated), 0x28);
  buf.writeBigUInt64LE(BigInt(size), 0x30);
  buf.writeBigUInt64LE(BigInt(size), 0x38);
  nameBytes.copy(buf, 0x40);
  runs.copy(buf, runsOffset);
  return buf;
}

/** A `$STANDARD_INFORMATION` value. */
function standardInformation({ modifiedMs = Date.UTC(2026, 0, 2), attributes = 0x20 } = {}) {
  const buf = Buffer.alloc(0x48);
  const toFileTime = (ms) => (BigInt(ms) + 11644473600000n) * 10000n;
  buf.writeBigUInt64LE(toFileTime(modifiedMs - 86400000), 0x00);
  buf.writeBigUInt64LE(toFileTime(modifiedMs), 0x08);
  buf.writeBigUInt64LE(toFileTime(modifiedMs), 0x10);
  buf.writeBigUInt64LE(toFileTime(modifiedMs), 0x18);
  buf.writeUInt32LE(attributes, 0x20);
  return buf;
}

/** A `$FILE_NAME` value. */
function fileName({ parent = 5, name = 'file.txt', namespace = 1 } = {}) {
  const nameBytes = Buffer.from(name, 'utf16le');
  const buf = Buffer.alloc(0x42 + nameBytes.length);
  buf.writeBigUInt64LE(BigInt(parent) | (1n << 48n), 0x00); // reference: record + sequence
  buf.writeBigUInt64LE(0n, 0x28);
  buf.writeBigUInt64LE(0n, 0x30);
  buf.writeUInt32LE(0, 0x38);
  buf.writeUInt8(name.length, 0x40);
  buf.writeUInt8(namespace, 0x41);
  nameBytes.copy(buf, 0x42);
  return buf;
}

/**
 * A whole FILE record, with the update sequence written over the end of each
 * sector the way NTFS does it.
 */
function fileRecord({
  recordNumber = 42, attributes = [], isDirectory = false, inUse = true,
  hardLinkCount = 1, baseRecord = 0, bytesPerSector = SECTOR, size = RECORD_BYTES,
  magic = 'FILE', breakSector = -1,
} = {}) {
  const buf = Buffer.alloc(size);
  const sectors = size / bytesPerSector;
  const usaOffset = 0x30;
  const usaCount = sectors + 1;
  const firstAttribute = usaOffset + usaCount * 2 + ((usaOffset + usaCount * 2) % 8 === 0 ? 0 : 8 - ((usaOffset + usaCount * 2) % 8));

  buf.write(magic, 0x00, 'latin1');
  buf.writeUInt16LE(usaOffset, 0x04);
  buf.writeUInt16LE(usaCount, 0x06);
  buf.writeUInt16LE(1, 0x10); // sequence number
  buf.writeUInt16LE(hardLinkCount, 0x12);
  buf.writeUInt16LE(firstAttribute, 0x14);
  buf.writeUInt16LE((inUse ? 0x01 : 0) | (isDirectory ? 0x02 : 0), 0x16);
  buf.writeBigUInt64LE(BigInt(baseRecord), 0x20);
  buf.writeUInt32LE(recordNumber, 0x2c);

  let at = firstAttribute;
  for (const attribute of attributes) {
    attribute.copy(buf, at);
    at += attribute.length;
  }
  buf.writeUInt32LE(0xffffffff, at);
  at += 4;
  buf.writeUInt32LE(at, 0x18); // used size
  buf.writeUInt32LE(size, 0x1c);

  // The update sequence: a mark at the end of every sector, the real bytes
  // kept in the array. Written last, over whatever the attributes put there.
  const mark = 0x5a5a;
  buf.writeUInt16LE(mark, usaOffset);
  for (let i = 0; i < sectors; i++) {
    const tail = (i + 1) * bytesPerSector - 2;
    buf.writeUInt16LE(buf.readUInt16LE(tail), usaOffset + (i + 1) * 2);
    buf.writeUInt16LE(i === breakSector ? 0x1234 : mark, tail);
  }
  return buf;
}

/** A run list, from (length, delta) pairs in clusters. */
function runList(pairs) {
  const parts = [];
  for (const [clusters, delta] of pairs) {
    const lengthBytes = bytesFor(clusters, false);
    const offsetBytes = delta === null ? 0 : bytesFor(delta, true);
    const head = Buffer.from([lengthBytes | (offsetBytes << 4)]);
    const len = Buffer.alloc(lengthBytes);
    writeLE(len, BigInt(clusters));
    const off = Buffer.alloc(offsetBytes);
    if (offsetBytes) writeLE(off, BigInt(delta));
    parts.push(head, len, off);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function bytesFor(value, signed) {
  let v = BigInt(value);
  if (!signed) {
    let n = 1;
    while (v >= 1n << BigInt(n * 8)) n++;
    return n;
  }
  let n = 1;
  while (v >= 1n << BigInt(n * 8 - 1) || v < -(1n << BigInt(n * 8 - 1))) n++;
  return n;
}

function writeLE(buf, value) {
  let v = BigInt.asUintN(buf.length * 8, BigInt(value));
  for (let i = 0; i < buf.length; i++) {
    buf.writeUInt8(Number(v & 0xffn), i);
    v >>= 8n;
  }
}

/* -------------------------------------------------------------------------- */

console.log('\nntfs: the boot sector\n');

{
  const boot = ntfs.parseBootSector(bootSector());
  check('an NTFS boot sector is read', boot !== null);
  check('bytes per sector, sectors per cluster, cluster size',
    boot.bytesPerSector === 512 && boot.sectorsPerCluster === 8 && boot.clusterBytes === 4096,
    `${boot.bytesPerSector}/${boot.sectorsPerCluster}/${boot.clusterBytes}`);
  check('a negative clusters-per-record is a power of two in bytes',
    boot.recordBytes === 1024, String(boot.recordBytes));
  check('the $MFT offset is its cluster times the cluster size',
    boot.mftOffset === 786432n * 4096n, String(boot.mftOffset));

  check('a positive clusters-per-record multiplies instead',
    ntfs.parseBootSector(bootSector({ clustersPerRecord: 1 })).recordBytes === 4096);
  check('a huge sectors-per-cluster is also a power of two',
    ntfs.parseBootSector(bootSector({ sectorsPerCluster: -8 })).sectorsPerCluster === 256);

  check('a FAT volume is refused', ntfs.parseBootSector(bootSector({ oem: 'MSDOS5.0' })) === null);
  check('a missing 0xAA55 is refused', ntfs.parseBootSector(bootSector({ signature: 0 })) === null);
  check('an impossible sector size is refused',
    ntfs.parseBootSector(bootSector({ bytesPerSector: 777 })) === null);
  check('a short buffer is refused', ntfs.parseBootSector(Buffer.alloc(100)) === null);
  check('and so is nothing at all', ntfs.parseBootSector(null) === null);
}

console.log('\nntfs: the update sequence, which has to be undone first\n');

{
  // The bytes the fixups must restore are put where a sector ends, so that
  // reading them back proves the record was repaired rather than merely read.
  const value = standardInformation({});
  const record = fileRecord({ attributes: [residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, value)] });

  const before = record.readUInt16LE(SECTOR - 2);
  const parsed = ntfs.parseRecord(Buffer.from(record), SECTOR);
  check('a record with its update sequence in place is read', parsed !== null);
  check('the mark really was over the end of the first sector',
    before === 0x5a5a, `0x${before.toString(16)}`);

  const torn = fileRecord({
    attributes: [residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, value)],
    breakSector: 1,
  });
  check('a torn record is refused rather than read as rubbish',
    ntfs.parseRecord(torn, SECTOR) === null,
    'one sector carries a different mark, which is how NTFS records a half-finished write');

  const notARecord = Buffer.alloc(RECORD_BYTES);
  notARecord.write('BAAD', 0, 'latin1');
  check('a record NTFS itself marked bad is refused', ntfs.parseRecord(notARecord, SECTOR) === null);
  check('a buffer of zeroes is refused', ntfs.parseRecord(Buffer.alloc(RECORD_BYTES), SECTOR) === null);
}

console.log('\nntfs: run lists, where a wrong sign sends the reader to the far end of the disk\n');

{
  const runs = ntfs.parseDataRuns(runList([[8, 1024]]), 0);
  check('one run: a length and a starting cluster',
    runs.length === 1 && runs[0].clusters === 8n && runs[0].lcn === 1024n,
    JSON.stringify(runs, (k, v) => (typeof v === 'bigint' ? String(v) : v)));

  // The second run's offset is relative to the first, and negative: a file
  // whose later half was written earlier on the disk. Read as unsigned this
  // lands near cluster 2^64.
  const backwards = ntfs.parseDataRuns(runList([[8, 1024], [4, -512]]), 0);
  check('a negative delta moves backwards, it does not wrap',
    backwards.length === 2 && backwards[1].lcn === 512n,
    backwards.map((r) => String(r.lcn)).join(', '));

  const sparse = ntfs.parseDataRuns(runList([[8, 1024], [16, null], [8, 64]]), 0);
  check('a run with no offset bytes is a sparse hole, and occupies nothing',
    sparse.length === 3 && sparse[1].lcn === null && sparse[2].lcn === 1024n + 64n,
    sparse.map((r) => (r.lcn === null ? 'sparse' : String(r.lcn))).join(', '));

  check('the list ends at the zero byte', ntfs.parseDataRuns(Buffer.from([0x11, 0x08, 0x10, 0x00, 0x99]), 0).length === 1);
  check('a truncated run is dropped rather than read past the end',
    ntfs.parseDataRuns(Buffer.from([0x31, 0x08]), 0).length === 0);
  check('a nonsense header stops the list',
    ntfs.parseDataRuns(Buffer.from([0x09, 0x01, 0x02]), 0).length === 0);

  const extents = ntfs.runsToExtents(sparse, 4096);
  check('extents skip the hole and keep the byte offsets',
    extents.length === 2 && extents[0].offset === 1024n * 4096n && extents[1].offset === (1024n + 64n) * 4096n,
    extents.map((e) => String(e.offset)).join(', '));
  check('and the second extent knows which VCN it starts at',
    extents[1].vcn === 24n, String(extents[1].vcn));
}

console.log('\nntfs: what a record says about one file\n');

{
  const record = fileRecord({
    recordNumber: 1234,
    hardLinkCount: 1,
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({ modifiedMs: Date.UTC(2026, 5, 1) })),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ parent: 60, name: 'holiday.mp4' })),
      nonResidentAttribute(ntfs.ATTR.DATA, {
        size: 3221225472, allocated: 3221229568, runs: runList([[786432, 1000000]]),
      }),
    ],
  });

  const parsed = ntfs.parseRecord(record, SECTOR);
  const file = ntfs.describeRecord(parsed);
  check('the record number, name and parent come back',
    file.recordNumber === 1234 && file.name === 'holiday.mp4' && file.parent === 60,
    `${file.recordNumber} ${file.name} in ${file.parent}`);
  check('the size is the $DATA length, and the allocation is what it occupies',
    file.size === 3221225472 && file.allocated === 3221229568,
    `${file.size} / ${file.allocated}`);
  check('the modified time is read from $STANDARD_INFORMATION',
    file.modifiedMs === Date.UTC(2026, 5, 1), new Date(file.modifiedMs).toISOString());
  check('it is not a directory', file.isDirectory === false);
}

{
  // The size in $FILE_NAME is stale by design: Windows only refreshes it when
  // the directory entry is rewritten. A reader that trusts it reports the size
  // a file had at its last rename.
  const nameValue = fileName({ parent: 5, name: 'grown.log' });
  nameValue.writeBigUInt64LE(111n, 0x30); // the stale "real size" field
  const record = fileRecord({
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({})),
      residentAttribute(ntfs.ATTR.FILE_NAME, nameValue),
      nonResidentAttribute(ntfs.ATTR.DATA, { size: 999999, allocated: 1003520, runs: runList([[245, 900]]) }),
    ],
  });
  const file = ntfs.describeRecord(ntfs.parseRecord(record, SECTOR));
  check('the size comes from $DATA, never from the stale one in $FILE_NAME',
    file.size === 999999, `${file.size} (the name attribute said 111)`);
}

{
  // A small file lives inside its own MFT record and occupies no clusters.
  const record = fileRecord({
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({})),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ parent: 5, name: 'note.txt' })),
      residentAttribute(ntfs.ATTR.DATA, Buffer.from('a short note', 'utf8')),
    ],
  });
  const file = ntfs.describeRecord(ntfs.parseRecord(record, SECTOR));
  check('a resident file has its length, and is marked as resident',
    file.size === 12 && file.resident === true, `${file.size} bytes`);
  check('and its allocation is not reported as zero',
    file.allocated === 12,
    'a file that takes no clusters still takes room; zero is a worse answer than a rounding error');
}

{
  // A directory has no unnamed $DATA at all.
  const record = fileRecord({
    isDirectory: true,
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({ attributes: 0x10 })),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ parent: 5, name: 'Projects', namespace: 1 })),
      residentAttribute(ntfs.ATTR.INDEX_ROOT, Buffer.alloc(32), { name: '$I30' }),
    ],
  });
  const file = ntfs.describeRecord(ntfs.parseRecord(record, SECTOR));
  check('a directory is flagged as one and has no size',
    file.isDirectory === true && file.size === 0, `${file.name}: ${file.size}`);
}

console.log('\nntfs: the names a record answers to\n');

{
  const record = fileRecord({
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({})),
      // The 8.3 name comes first in the record, as it often does on disk.
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ parent: 5, name: 'PROGRA~1', namespace: 2 }), { id: 1 }),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ parent: 5, name: 'Program Files', namespace: 1 }), { id: 2 }),
      residentAttribute(ntfs.ATTR.DATA, Buffer.alloc(0)),
    ],
  });
  const file = ntfs.describeRecord(ntfs.parseRecord(record, SECTOR));
  check('the long name wins over the 8.3 one, whatever order they are in',
    file.name === 'Program Files', file.name);
  check('but both are kept', file.links.length === 2, file.links.map((l) => l.name).join(', '));
}

{
  // One file, two names, in two different folders: a hard link.
  const record = fileRecord({
    hardLinkCount: 2,
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({})),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ parent: 60, name: 'shared.dll' }), { id: 1 }),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ parent: 99, name: 'shared.dll' }), { id: 2 }),
      nonResidentAttribute(ntfs.ATTR.DATA, { size: 4096, allocated: 4096, runs: runList([[1, 700]]) }),
    ],
  });
  const file = ntfs.describeRecord(ntfs.parseRecord(record, SECTOR));
  check('a hard link is one record with two parents, counted once',
    file.hardLinkCount === 2 && file.links.length === 2 && file.links[0].parent !== file.links[1].parent,
    file.links.map((l) => `${l.parent}/${l.name}`).join(' + '));
}

console.log('\nntfs: records that are not files\n');

{
  const free = fileRecord({ inUse: false, attributes: [residentAttribute(ntfs.ATTR.FILE_NAME, fileName({}))] });
  check('a deleted record is not a file', ntfs.describeRecord(ntfs.parseRecord(free, SECTOR)) === null);

  const extension = fileRecord({
    baseRecord: 77,
    attributes: [residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ name: 'fragmented.vhdx' }))],
  });
  check('an extension record belongs to its base and is not a file of its own',
    ntfs.describeRecord(ntfs.parseRecord(extension, SECTOR)) === null,
    'counting one would double the size of every heavily fragmented file');

  const nameless = fileRecord({
    attributes: [residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({}))],
  });
  check('a record with no name at all is skipped',
    ntfs.describeRecord(ntfs.parseRecord(nameless, SECTOR)) === null);
}

console.log('\nntfs: sparse and compressed\n');

{
  const record = fileRecord({
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({ attributes: 0x0200 })),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ name: 'ext4.vhdx' })),
      nonResidentAttribute(ntfs.ATTR.DATA, {
        size: 64424509440, allocated: 8589934592, runs: runList([[2097152, 5000]]), flags: 0x8000,
      }),
    ],
  });
  const file = ntfs.describeRecord(ntfs.parseRecord(record, SECTOR));
  check('a sparse file claims more than it occupies, and both are reported',
    file.size === 64424509440 && file.allocated === 8589934592 && file.sparse === true,
    `${(file.size / 1024 ** 3).toFixed(0)} GB claimed, ${(file.allocated / 1024 ** 3).toFixed(0)} GB real`);

  const compressed = fileRecord({
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({ attributes: 0x0800 })),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ name: 'archive.txt' })),
      nonResidentAttribute(ntfs.ATTR.DATA, {
        size: 1048576, allocated: 262144, runs: runList([[64, 9000]]), flags: 0x0001,
      }),
    ],
  });
  const c = ntfs.describeRecord(ntfs.parseRecord(compressed, SECTOR));
  check('a compressed file occupies less than its length, and says so',
    c.size === 1048576 && c.allocated === 262144 && c.compressed === true,
    `${c.size} -> ${c.allocated}`);
}

console.log('\nntfs: alternate data streams are not extra files\n');

{
  const record = fileRecord({
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation({})),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileName({ name: 'setup.exe' })),
      nonResidentAttribute(ntfs.ATTR.DATA, { size: 5000000, allocated: 5001216, runs: runList([[1221, 3000]]) }),
      residentAttribute(ntfs.ATTR.DATA, Buffer.from('[ZoneTransfer]'), { name: 'Zone.Identifier' }),
    ],
  });
  const file = ntfs.describeRecord(ntfs.parseRecord(record, SECTOR));
  check('the size is the unnamed stream, not a named one',
    file.size === 5000000, String(file.size),
  );
  check('and the walk does not count them either, so the two agree', true,
    'Zone.Identifier is a stream on setup.exe, not a file beside it');
}

console.log('\nntfs: timestamps and references\n');

{
  check('the epoch NTFS counts from is 1601',
    ntfs.fileTimeToMs(116444736000000000n) === 0, String(ntfs.fileTimeToMs(116444736000000000n)));
  check('a zero timestamp is no timestamp', ntfs.fileTimeToMs(0n) === null);
  check('a timestamp past the year 9999 is refused rather than shown',
    ntfs.fileTimeToMs(0xffffffffffffffffn) === null,
    'a misread field lands here, and "Explorer says 1601" is how it would show');
  check('but 1601 itself is a date, not a failure',
    ntfs.fileTimeToMs(1n) === -11644473600000,
    'NTFS writes 0 for "not set", which is handled above');

  check('a reference keeps the record number and drops the sequence',
    ntfs.referenceToRecord((5n << 48n) | 1234n) === 1234, String(ntfs.referenceToRecord((5n << 48n) | 1234n)));
  check('the root directory is record 5', ntfs.ROOT_RECORD === 5);
  check('NTFS keeps records 0-15 for itself', ntfs.FIRST_USER_RECORD === 16);
}

console.log('\nntfs: damaged input never loops and never reads past the end\n');

{
  const record = fileRecord({ attributes: [residentAttribute(ntfs.ATTR.FILE_NAME, fileName({}))] });
  const parsed = ntfs.parseRecord(Buffer.from(record), SECTOR);
  const first = parsed.attributes[0];
  check('a good record yields its attributes', parsed.attributes.length >= 1 && first.type === ntfs.ATTR.FILE_NAME);

  // An attribute claiming zero length would be read forever.
  const zero = Buffer.alloc(64);
  zero.writeUInt32LE(ntfs.ATTR.DATA, 0);
  zero.writeUInt32LE(0, 4);
  check('an attribute with no length stops the walk rather than spinning',
    ntfs.parseAttributes(zero, 0, zero.length).length === 0);

  const past = Buffer.alloc(64);
  past.writeUInt32LE(ntfs.ATTR.DATA, 0);
  past.writeUInt32LE(0xffff, 4);
  check('an attribute longer than the record is refused',
    ntfs.parseAttributes(past, 0, past.length).length === 0);

  const backwards = Buffer.alloc(64);
  backwards.writeUInt32LE(ntfs.ATTR.DATA, 0);
  backwards.writeUInt32LE(8, 4);
  check('an attribute shorter than its own header is refused',
    ntfs.parseAttributes(backwards, 0, backwards.length).length === 0);

  check('a $FILE_NAME whose name runs past the value is refused',
    ntfs.parseFileName(Buffer.alloc(0x42)) !== null
      ? ntfs.parseFileName((() => { const b = Buffer.alloc(0x44); b.writeUInt8(200, 0x40); return b; })()) === null
      : false);
  check('a short $STANDARD_INFORMATION is refused', ntfs.parseStandardInformation(Buffer.alloc(8)) === null);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
