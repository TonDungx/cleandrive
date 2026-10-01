'use strict';

// NTFS on-disk structures, built in memory, for the harnesses that read
// `$MFT` without a real volume (A2). Moved out of scripts/test-mft.js so that
// scripts/verify-mft-pipe.js can build a volume large enough to need many
// pieces on the wire, from the same record writer the unit test trusts.

const ntfs = require('../../src/main/system/ntfs');

const SECTOR = 512;
const CLUSTER = 4096;
const RECORD = 1024;

function residentAttribute(type, value, { name = '', flags = 0 } = {}) {
  const nameBytes = Buffer.from(name, 'utf16le');
  const headerLength = 0x18 + nameBytes.length;
  const buf = Buffer.alloc(Math.ceil((headerLength + value.length) / 8) * 8);
  buf.writeUInt32LE(type, 0x00);
  buf.writeUInt32LE(buf.length, 0x04);
  buf.writeUInt8(0, 0x08);
  buf.writeUInt8(name.length, 0x09);
  buf.writeUInt16LE(0x18, 0x0a);
  buf.writeUInt16LE(flags, 0x0c);
  buf.writeUInt32LE(value.length, 0x10);
  buf.writeUInt16LE(headerLength, 0x14);
  nameBytes.copy(buf, 0x18);
  value.copy(buf, headerLength);
  return buf;
}

function nonResidentAttribute(type, { size, allocated, runs, name = '', flags = 0 }) {
  const nameBytes = Buffer.from(name, 'utf16le');
  const runsOffset = 0x40 + nameBytes.length;
  const buf = Buffer.alloc(Math.ceil((runsOffset + runs.length) / 8) * 8);
  buf.writeUInt32LE(type, 0x00);
  buf.writeUInt32LE(buf.length, 0x04);
  buf.writeUInt8(1, 0x08);
  buf.writeUInt8(name.length, 0x09);
  buf.writeUInt16LE(0x40, 0x0a);
  buf.writeUInt16LE(flags, 0x0c);
  buf.writeUInt16LE(runsOffset, 0x20);
  buf.writeBigUInt64LE(BigInt(allocated), 0x28);
  buf.writeBigUInt64LE(BigInt(size), 0x30);
  buf.writeBigUInt64LE(BigInt(size), 0x38);
  nameBytes.copy(buf, 0x40);
  runs.copy(buf, runsOffset);
  return buf;
}

function standardInformation(modifiedMs = Date.UTC(2026, 2, 3), attributes = 0x20) {
  const buf = Buffer.alloc(0x48);
  const ft = (ms) => (BigInt(ms) + 11644473600000n) * 10000n;
  buf.writeBigUInt64LE(ft(modifiedMs), 0x00);
  buf.writeBigUInt64LE(ft(modifiedMs), 0x08);
  buf.writeBigUInt64LE(ft(modifiedMs), 0x10);
  buf.writeBigUInt64LE(ft(modifiedMs), 0x18);
  buf.writeUInt32LE(attributes, 0x20);
  return buf;
}

function fileNameValue(parent, name, namespace = 1) {
  const nameBytes = Buffer.from(name, 'utf16le');
  const buf = Buffer.alloc(0x42 + nameBytes.length);
  buf.writeBigUInt64LE(BigInt(parent) | (1n << 48n), 0x00);
  buf.writeUInt8(name.length, 0x40);
  buf.writeUInt8(namespace, 0x41);
  nameBytes.copy(buf, 0x42);
  return buf;
}

function runList(pairs) {
  const parts = [];
  for (const [clusters, delta] of pairs) {
    const lengthBytes = byteWidth(BigInt(clusters), false);
    const offsetBytes = delta === null ? 0 : byteWidth(BigInt(delta), true);
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

function byteWidth(v, signed) {
  let n = 1;
  if (!signed) {
    while (v >= 1n << BigInt(n * 8)) n++;
    return n;
  }
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

/** An `$ATTRIBUTE_LIST` value: which record holds which attribute. */
function attributeListValue(items) {
  const parts = [];
  for (const item of items) {
    const nameBytes = Buffer.from(item.name || '', 'utf16le');
    const length = Math.ceil((0x1a + nameBytes.length) / 8) * 8;
    const buf = Buffer.alloc(length);
    buf.writeUInt32LE(item.type, 0x00);
    buf.writeUInt16LE(length, 0x04);
    buf.writeUInt8((item.name || '').length, 0x06);
    buf.writeUInt8(0x1a, 0x07);
    buf.writeBigUInt64LE(BigInt(item.startVcn || 0), 0x08);
    buf.writeBigUInt64LE(BigInt(item.record) | (1n << 48n), 0x10);
    nameBytes.copy(buf, 0x1a);
    parts.push(buf);
  }
  return Buffer.concat(parts);
}

/** A FILE record with its update sequence written the way NTFS writes it. */
function fileRecord({ attributes = [], isDirectory = false, inUse = true, hardLinkCount = 1, baseRecord = 0 }) {
  const buf = Buffer.alloc(RECORD);
  const sectors = RECORD / SECTOR;
  const usaOffset = 0x30;
  const usaCount = sectors + 1;
  let first = usaOffset + usaCount * 2;
  if (first % 8) first += 8 - (first % 8);

  buf.write('FILE', 0x00, 'latin1');
  buf.writeUInt16LE(usaOffset, 0x04);
  buf.writeUInt16LE(usaCount, 0x06);
  buf.writeUInt16LE(1, 0x10);
  buf.writeUInt16LE(hardLinkCount, 0x12);
  buf.writeUInt16LE(first, 0x14);
  buf.writeUInt16LE((inUse ? 1 : 0) | (isDirectory ? 2 : 0), 0x16);
  buf.writeBigUInt64LE(BigInt(baseRecord), 0x20);

  let at = first;
  for (const a of attributes) {
    a.copy(buf, at);
    at += a.length;
  }
  buf.writeUInt32LE(0xffffffff, at);
  buf.writeUInt32LE(at + 4, 0x18);
  buf.writeUInt32LE(RECORD, 0x1c);

  const mark = 0x4d4d;
  buf.writeUInt16LE(mark, usaOffset);
  for (let i = 0; i < sectors; i++) {
    const tail = (i + 1) * SECTOR - 2;
    buf.writeUInt16LE(buf.readUInt16LE(tail), usaOffset + (i + 1) * 2);
    buf.writeUInt16LE(mark, tail);
  }
  return buf;
}

/**
 * A reader over a Buffer, with the same shape -- and the same contract -- as
 * openVolume: what it hands back is the caller's to write into.
 *
 * It copies, and that is the point rather than an inefficiency. Repairing a
 * record's update sequence rewrites the buffer in place; a fake that returned
 * a view would let one read corrupt the volume for every read after it, which
 * is how this very test started failing when the copy moved out of mft.js.
 */
function bufferReader(volume) {
  return {
    read: async (offset, length) => Buffer.from(volume.subarray(offset, Math.min(offset + length, volume.length))),
    useSectorSize() {},
    close: async () => {},
  };
}

/**
 * A volume with one contiguous `$MFT` holding `folders` folders under the root
 * and `files` files spread across them -- as many as a harness needs to make
 * the helper send many pieces. Every file has a size of its own, so a total
 * that comes back short or long says so.
 *
 * @returns {{volume: Buffer, expected: {folders: number, files: number, bytes: number, paths: Map<string, number>}}}
 *   `paths` maps a few files' paths below the root to their sizes
 */
function contiguousVolume({ folders = 100, files = 1000, nameOf = (i) => `file-${i}.dat`, folderNameOf = (f) => `folder-${String(f).padStart(4, '0')}` } = {}) {
  const FIRST = 16;
  const perCluster = CLUSTER / RECORD;
  const total = FIRST + folders + files;
  const mftClusters = Math.ceil(total / perCluster);
  const mftAt = 10;
  const clusters = mftAt + mftClusters + 8;
  const volume = Buffer.alloc(clusters * CLUSTER);

  volume.write('NTFS    ', 0x03, 'latin1');
  volume.writeUInt16LE(SECTOR, 0x0b);
  volume.writeInt8(CLUSTER / SECTOR, 0x0d);
  volume.writeBigUInt64LE(BigInt(clusters * CLUSTER / SECTOR), 0x28);
  volume.writeBigUInt64LE(BigInt(mftAt), 0x30);
  volume.writeBigUInt64LE(2n, 0x38);
  volume.writeInt8(-10, 0x40);
  volume.writeInt8(1, 0x44);
  volume.writeUInt16LE(0xaa55, 0x1fe);

  const put = (number, record) => record.copy(volume, mftAt * CLUSTER + number * RECORD);
  put(0, fileRecord({
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation()),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(5, '$MFT')),
      nonResidentAttribute(ntfs.ATTR.DATA, { size: total * RECORD, allocated: mftClusters * CLUSTER, runs: runList([[mftClusters, mftAt]]) }),
    ],
  }));
  put(5, fileRecord({
    isDirectory: true,
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(Date.UTC(2026, 0, 1), 0x10)),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(5, '.')),
    ],
  }));

  for (let f = 0; f < folders; f++) {
    put(FIRST + f, fileRecord({
      isDirectory: true,
      attributes: [
        residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(Date.UTC(2026, 1, 1), 0x10)),
        residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(5, folderNameOf(f))),
        residentAttribute(ntfs.ATTR.INDEX_ROOT, Buffer.alloc(32), { name: '$I30' }),
      ],
    }));
  }

  let bytes = 0;
  const paths = new Map();
  for (let i = 0; i < files; i++) {
    const size = 1000 + i;
    const folder = i % folders;
    bytes += size;
    put(FIRST + folders + i, fileRecord({
      attributes: [
        residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(Date.UTC(2026, 2, 3) + i * 1000)),
        residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(FIRST + folder, nameOf(i))),
        nonResidentAttribute(ntfs.ATTR.DATA, { size, allocated: Math.ceil(size / CLUSTER) * CLUSTER, runs: runList([[1, clusters + 100]]) }),
      ],
    }));
    if (i < 3 || i === files - 1) paths.set(`${folderNameOf(folder)}\\${nameOf(i)}`, size);
  }
  return { volume, expected: { folders, files, bytes, paths } };
}

/**
 * A reader over an image file, with openVolume's shape and contract: what it
 * hands back is the caller's to write into.
 */
async function fileReader(file) {
  const handle = await require('node:fs').promises.open(file, 'r');
  return {
    read: async (offset, length) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, offset);
      return buf.subarray(0, bytesRead);
    },
    useSectorSize() {},
    get sectorSize() {
      return SECTOR;
    },
    close: () => handle.close(),
  };
}

module.exports = {
  SECTOR,
  CLUSTER,
  RECORD,
  residentAttribute,
  nonResidentAttribute,
  standardInformation,
  fileNameValue,
  runList,
  byteWidth,
  writeLE,
  attributeListValue,
  fileRecord,
  bufferReader,
  contiguousVolume,
  fileReader,
};
