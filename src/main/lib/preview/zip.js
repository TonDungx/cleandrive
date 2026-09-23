'use strict';

const zlib = require('node:zlib');

/**
 * Reading a ZIP file, because every Office format is one.
 *
 * ## Why this is written out rather than installed
 *
 * A `.docx` is a ZIP holding XML. So is a `.xlsx`, a `.pptx`, an `.epub`, a
 * `.jar` and an `.apk`. Node already ships the hard half -- `zlib` does the
 * decompression -- and what is missing is only the directory structure that
 * says where each member starts. That is about a hundred lines of offsets,
 * documented since 1989 and unchanged since, and it is the same hundred lines
 * whether it arrives from a package or from here.
 *
 * ## Reading the central directory, not the front of the file
 *
 * A ZIP can be read two ways: walk the local headers from the start, or read
 * the index at the end. Only the index is authoritative. The local headers may
 * carry zeroes for the sizes -- the streaming case, where the writer did not
 * know the length until it had finished -- and a file produced that way is
 * unreadable from the front. Word does not write them that way, but plenty of
 * things that produce `.docx` files do, and the index costs nothing.
 *
 * ## The sizes are not trusted
 *
 * A ZIP states how big a member will be once expanded, and a hostile file
 * states whatever it likes: forty-two kilobytes claiming to be four petabytes
 * is a real and very old trick. So the stated size is treated as a claim,
 * checked against a ceiling before anything is allocated, and the running total
 * across the whole archive is capped as well -- a thousand members of a
 * megabyte each is the same attack with the numbers moved around.
 */

const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;

/** The comment at the end of a ZIP is a 16-bit length, so the record cannot be further back than this. */
const MAX_COMMENT = 0xffff;

/** One member, expanded. Larger than any document; smaller than a denial of service. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** And everything this reader expands from one archive, together. */
const MAX_TOTAL_BYTES = 192 * 1024 * 1024;

const STORED = 0;
const DEFLATED = 8;

/**
 * Open an archive that is already in memory.
 *
 * @param {Buffer} buf
 * @returns {{entries: object[], read: (name: string) => Buffer|null, has: (name: string) => boolean}}
 * @throws {Error} with `code` 'NOT_A_ZIP' or 'ZIP_TRUNCATED' -- callers turn
 *         these into a sentence for the window rather than a stack trace
 */
function open(buf) {
  const eocd = findEocd(buf);
  const { entries } = readCentralDirectory(buf, eocd);

  const byName = new Map();
  for (const entry of entries) {
    // A ZIP may legally hold the same name twice. The last one wins, which is
    // what every unpacker does and therefore what the file's author saw.
    byName.set(entry.name, entry);
  }

  let spent = 0;
  const cache = new Map();

  function read(name) {
    if (cache.has(name)) return cache.get(name);
    const entry = byName.get(name);
    if (!entry) return null;

    const out = expand(buf, entry, spent);
    spent += out.length;
    cache.set(name, out);
    return out;
  }

  return {
    entries,
    read,
    has: (name) => byName.has(name),
    /** Members whose name matches, in directory order. */
    find: (re) => entries.filter((e) => !e.directory && re.test(e.name)),
  };
}

/* -------------------------------------------------------------------------- */
/* the index at the end                                                        */
/* -------------------------------------------------------------------------- */

function findEocd(buf) {
  if (buf.length < 22) throw fail('NOT_A_ZIP', 'too short to be an archive');

  /*
   * Scanned backwards, and deliberately not searched for anywhere else.
   *
   * The signature is four bytes and compressed data is effectively random, so
   * it turns up inside the archive's own contents fairly often. Starting from
   * the end and taking the first hit is what makes it the *end* record rather
   * than a coincidence.
   */
  const floor = Math.max(0, buf.length - MAX_COMMENT - 22);
  for (let at = buf.length - 22; at >= floor; at--) {
    if (buf.readUInt32LE(at) !== EOCD_SIG) continue;
    const commentLength = buf.readUInt16LE(at + 20);
    // The record has to end exactly where the file does, or the signature was
    // a coincidence after all.
    if (at + 22 + commentLength !== buf.length) continue;

    const eocd = {
      count: buf.readUInt16LE(at + 10),
      size: buf.readUInt32LE(at + 12),
      offset: buf.readUInt32LE(at + 16),
    };
    return needsZip64(eocd) ? readZip64(buf, at, eocd) : eocd;
  }
  throw fail('NOT_A_ZIP', 'no end-of-archive record');
}

/** 0xFFFF / 0xFFFFFFFF is ZIP's way of saying "the real number is in the ZIP64 record". */
function needsZip64(eocd) {
  return eocd.count === 0xffff || eocd.size === 0xffffffff || eocd.offset === 0xffffffff;
}

function readZip64(buf, eocdAt, fallback) {
  const locAt = eocdAt - 20;
  if (locAt < 0 || buf.readUInt32LE(locAt) !== EOCD64_LOC_SIG) return fallback;

  const at = Number(buf.readBigUInt64LE(locAt + 8));
  if (!Number.isSafeInteger(at) || at < 0 || at + 56 > buf.length) return fallback;
  if (buf.readUInt32LE(at) !== EOCD64_SIG) return fallback;

  return {
    count: Number(buf.readBigUInt64LE(at + 32)),
    size: Number(buf.readBigUInt64LE(at + 40)),
    offset: Number(buf.readBigUInt64LE(at + 48)),
  };
}

function readCentralDirectory(buf, eocd) {
  const entries = [];
  let at = eocd.offset;
  if (at < 0 || at >= buf.length) throw fail('ZIP_TRUNCATED', 'the index points outside the file');

  // Bounded by the count the archive states *and* by the buffer, so a corrupt
  // count cannot spin here.
  for (let n = 0; n < eocd.count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== CENTRAL_SIG) break;

    const flags = buf.readUInt16LE(at + 8);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const nameAt = at + 46;
    if (nameAt + nameLength > buf.length) break;

    const entry = {
      name: decodeName(buf.subarray(nameAt, nameAt + nameLength), flags),
      method: buf.readUInt16LE(at + 10),
      crc: buf.readUInt32LE(at + 16),
      compressedSize: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      localOffset: buf.readUInt32LE(at + 42),
      mtimeMs: dosTimeToMs(buf.readUInt16LE(at + 12), buf.readUInt16LE(at + 14)),
      encrypted: (flags & 0x1) !== 0,
    };
    // A name ending in a slash is a folder; so is a zero-length member with
    // the directory bit in the external attributes.
    entry.directory = entry.name.endsWith('/') || (buf.readUInt32LE(at + 38) & 0x10) !== 0;

    if (entry.size === 0xffffffff || entry.compressedSize === 0xffffffff || entry.localOffset === 0xffffffff) {
      applyZip64Extra(buf.subarray(nameAt + nameLength, nameAt + nameLength + extraLength), entry);
    }

    entries.push(entry);
    at = nameAt + nameLength + extraLength + commentLength;
  }
  return { entries };
}

/** The 0x0001 extra field carries whichever of the three values overflowed, in order. */
function applyZip64Extra(extra, entry) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      let cursor = at + 4;
      const take = () => {
        const value = Number(extra.readBigUInt64LE(cursor));
        cursor += 8;
        return value;
      };
      if (entry.size === 0xffffffff && cursor + 8 <= at + 4 + length) entry.size = take();
      if (entry.compressedSize === 0xffffffff && cursor + 8 <= at + 4 + length) entry.compressedSize = take();
      if (entry.localOffset === 0xffffffff && cursor + 8 <= at + 4 + length) entry.localOffset = take();
      return;
    }
    at += 4 + length;
  }
}

/*
 * Bit 11 of the flags means the name is UTF-8. Without it the name is CP437 by
 * the letter of the specification, which nothing has actually written since
 * about 2005 -- but it does mean a Vietnamese filename from an old archiver is
 * a guess either way. UTF-8 is tried first and the bytes are kept as Latin-1
 * if that fails, which at least leaves the ASCII part legible instead of a row
 * of replacement characters.
 */
function decodeName(bytes, flags) {
  if (flags & 0x800) return bytes.toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

function dosTimeToMs(time, date) {
  if (!date) return 0;
  const year = 1980 + ((date >> 9) & 0x7f);
  const month = ((date >> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  const ms = new Date(year, month, day, hour, minute, second).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/* -------------------------------------------------------------------------- */
/* getting one member back out                                                 */
/* -------------------------------------------------------------------------- */

function expand(buf, entry, alreadySpent) {
  if (entry.encrypted) throw fail('ZIP_ENCRYPTED', `${entry.name} is encrypted`);
  if (entry.size > MAX_ENTRY_BYTES) throw fail('ZIP_TOO_BIG', `${entry.name} claims ${entry.size} bytes`);
  if (alreadySpent + entry.size > MAX_TOTAL_BYTES) throw fail('ZIP_TOO_BIG', 'the archive expands too far');

  /*
   * The local header is read even though the central directory already has
   * everything, because only the local header knows how long *its* extra field
   * is -- and that is what says where the bytes actually begin. The two extra
   * fields are allowed to differ in length, and in files written by Windows
   * they routinely do.
   */
  const at = entry.localOffset;
  if (at < 0 || at + 30 > buf.length) throw fail('ZIP_TRUNCATED', `${entry.name} starts past the end`);
  const nameLength = buf.readUInt16LE(at + 26);
  const extraLength = buf.readUInt16LE(at + 28);
  const from = at + 30 + nameLength + extraLength;
  const to = from + entry.compressedSize;
  if (to > buf.length) throw fail('ZIP_TRUNCATED', `${entry.name} runs past the end`);

  const raw = buf.subarray(from, to);
  if (entry.method === STORED) return raw;
  if (entry.method !== DEFLATED) throw fail('ZIP_METHOD', `${entry.name} uses compression method ${entry.method}`);

  // `maxOutputLength` is the ceiling enforced by zlib itself, so a member that
  // lies about its size is stopped inside the decompressor rather than after
  // it has already allocated the memory.
  return zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
}

function fail(code, detail) {
  const err = new Error(`zip: ${detail}`);
  err.code = code;
  return err;
}

module.exports = { open, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES };
