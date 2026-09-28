'use strict';

/**
 * Writing a ZIP, and reading one back without holding it in memory (B5).
 *
 * `lib/preview/zip.js` already reads archives -- every Office file is one --
 * and this does not repeat it. What it cannot do is this job: it takes a
 * `Buffer`, and it caps one member at 64 MB and a whole archive at 192 MB,
 * which are the right limits for showing somebody a document and the wrong
 * ones for a folder of holiday video. So the *index* is parsed by that module
 * (given the offset the buffer starts at) and everything else here works
 * against a file handle.
 *
 * ## Compressed only where compression does something
 *
 * Measured on this machine, deflating real files: this project's `src/` saves
 * **68.1%**, the Documents folder **10.0%**, Downloads **6.9%**. Per type it
 * splits cleanly -- `.js` 67%, `.xls` 70%, `.html` 41%, against `.docx`
 * **1.0%**, `.zip` 0.8%, `.png` 1.5%, and `.mp4` **-0.0%**, which is to say it
 * got bigger. Deflating a folder of video costs minutes of processor to save
 * nothing at all.
 *
 * So each file is tried on its first 64 KB, and one that does not shrink by at
 * least 5% is written with method 0 (STORED) instead. The archive says which
 * it did, per file, and the screen says both numbers.
 *
 * ## Written forwards, then patched
 *
 * A local header states the CRC and both sizes, and none of the three is known
 * until the data has been through. The usual answer is a data descriptor after
 * the member, with zeroes in the header; this writes to a real file instead,
 * so it writes the header with zeroes, streams the data, then seeks back and
 * fills them in. The result reads correctly from the front as well as from the
 * index, which matters because the thing that will most often open one of
 * these is Windows Explorer.
 *
 * ## ZIP64
 *
 * Reached for per entry rather than globally: a member is given the 0x0001
 * extra field when its size will not fit in 32 bits, or when it starts beyond
 * 4 GB into the archive; the end record gains its ZIP64 form when the archive
 * passes 4 GB or 65,534 members. The space for the extra field has to be
 * reserved before the data is written, which is why the decision is made from
 * the size on disk rather than from what compression turns out to give.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const zlib = require('node:zlib');

const preview = require('./preview/zip');
const { CancelToken, throttle } = require('./util');
const { longPath } = require('./verified-copy');

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;

const STORED = 0;
const DEFLATED = 8;

/** Bit 11: the name is UTF-8. Always set -- a Vietnamese filename is the point. */
const FLAG_UTF8 = 0x800;

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** How much of a file is tried before deciding whether to compress it. */
const SNIFF_BYTES = 64 * 1024;

/** Below this saving, compressing is work for nothing. */
const WORTH_COMPRESSING = 0.05;

/** Read and write in megabyte pieces. */
const CHUNK = 1 << 20;

/* -------------------------------------------------------------------------- */
/* small pieces of the format                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A date as ZIP records one: DOS time, two seconds' resolution, from 1980.
 *
 * Anything before 1980 cannot be said at all, so it is clamped rather than
 * wrapped -- a file dated 1970 keeps a wrong-but-sane 1980 instead of a
 * wrong-and-strange 2044.
 */
function toDosTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f),
  };
}

/** ZIP names always use forward slashes, whatever the platform calls them. */
const toZipName = (rel) => String(rel).split(path.sep).join('/');

/** And back again, refusing anything that would climb out of the target. */
function fromZipName(name) {
  const parts = String(name)
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..');
  return parts.length === 0 ? null : path.join(...parts);
}

/**
 * Is this file worth deflating?
 *
 * Decided on the first 64 KB, which is enough to tell text from an already
 * compressed container and costs about a millisecond. A file too small to
 * sample is compressed: the cost is nothing either way, and the saving on a
 * folder of small text files is the whole point.
 */
async function worthCompressing(handle, size) {
  if (size === 0) return false;
  const take = Math.min(size, SNIFF_BYTES);
  const buf = Buffer.allocUnsafe(take);
  const { bytesRead } = await handle.read(buf, 0, take, 0);
  if (bytesRead === 0) return false;
  const sample = buf.subarray(0, bytesRead);
  const packed = zlib.deflateRawSync(sample, { level: 6 });
  return packed.length < sample.length * (1 - WORTH_COMPRESSING);
}

/* -------------------------------------------------------------------------- */
/* writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pack a list of files into a new `.zip`.
 *
 * @param {string} target        the archive to write; must not exist
 * @param {object[]} files       { rel, abs, size, mtime } -- what `tree-copy.walk` returns
 * @param {string[]} [dirs]      folder paths, so an empty one survives
 * @param {object} [options]     { token, onProgress, extra: [{name, body}] }
 * @returns {Promise<object>}    { ok, entries, bytes, packedBytes, failed, cancelled }
 */
async function write(target, files, dirs = [], options = {}) {
  const token = options.token || new CancelToken();
  const onProgress = options.onProgress || (() => {});
  // `extra` may be a function, because the one thing a caller most wants to
  // put inside is a manifest of what went in -- and that is not known until
  // everything has. Called once, after the files and before the index.
  const extraOf = typeof options.extra === 'function' ? options.extra : () => options.extra || [];
  // A digest of the file as it was on disk, made from the same read that
  // feeds the compressor. Hashing separately would mean reading every byte
  // twice, which on a folder of video is minutes.
  const sha256 = options.sha256 || null;

  const handle = await fsp.open(longPath(target), 'wx');
  const central = [];
  const failed = [];
  let at = 0;
  let rawBytes = 0;
  let packedBytes = 0;
  let needsZip64 = false;

  const totalBytes = files.reduce((n, f) => n + (f.size || 0), 0);
  const report = throttle((currentPath) => {
    onProgress({
      phase: 'packing',
      done: central.length,
      total: files.length + dirs.length,
      bytes: rawBytes,
      totalBytes,
      packedBytes,
      currentPath,
    });
  }, 150);

  const writeAll = async (buf) => {
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await handle.write(buf, off, buf.length - off, at);
      if (!bytesWritten) throw Object.assign(new Error('nothing written'), { code: 'EIO' });
      off += bytesWritten;
      at += bytesWritten;
    }
  };

  /** The header, with room for what is not known yet. */
  const putEntry = async ({ name, mtime, size, method, big }) => {
    const nameBuf = Buffer.from(toZipName(name), 'utf8');
    const dos = toDosTime(mtime);
    const extraLen = big ? 20 : 0;
    const head = Buffer.alloc(30);

    head.writeUInt32LE(LOCAL_SIG, 0);
    head.writeUInt16LE(big ? 45 : 20, 4);
    head.writeUInt16LE(FLAG_UTF8, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(dos.time, 10);
    head.writeUInt16LE(dos.date, 12);
    // crc, compressed, uncompressed: patched once the data has gone through.
    head.writeUInt32LE(0, 14);
    head.writeUInt32LE(big ? U32_MAX : 0, 18);
    head.writeUInt32LE(big ? U32_MAX : 0, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(extraLen, 28);

    // Header, then the name, then the extra field -- in that order, which is
    // the whole of the record's layout and is easy to get wrong because the
    // non-ZIP64 case has no extra field to put in the wrong place. It was
    // wrong here first, and only a 5 GB member showed it.
    const extraBuf = Buffer.alloc(extraLen);
    if (big) {
      extraBuf.writeUInt16LE(0x0001, 0);
      extraBuf.writeUInt16LE(16, 2);
      extraBuf.writeBigUInt64LE(BigInt(size), 4);
      extraBuf.writeBigUInt64LE(0n, 12);
    }

    const headerAt = at;
    await writeAll(head);
    await writeAll(nameBuf);
    if (extraLen > 0) await writeAll(extraBuf);
    return { headerAt, nameBuf, dos, extraLen };
  };

  try {
    /* -- the folders, so an empty one is still there afterwards ----------- */
    for (const rel of dirs) {
      if (token.cancelled) break;
      const name = `${toZipName(rel)}/`;
      const placed = await putEntry({ name, mtime: new Date(), size: 0, method: STORED, big: false });
      central.push({
        name,
        nameBuf: placed.nameBuf,
        dos: placed.dos,
        method: STORED,
        crc: 0,
        packed: 0,
        size: 0,
        headerAt: placed.headerAt,
        directory: true,
      });
      report(rel);
    }

    /* -- the files -------------------------------------------------------- */
    for (const file of files) {
      if (token.cancelled) break;

      let source;
      try {
        source = await fsp.open(longPath(file.abs), 'r');
      } catch (err) {
        failed.push({ rel: file.rel, error: err.message, code: err.code || 'EOPEN' });
        report(file.rel);
        continue;
      }

      try {
        const size = file.size || 0;
        // Reserved before the data goes in, so it is decided on what the disk
        // says rather than on what compression turns out to give.
        const big = size >= U32_MAX || at >= U32_MAX;
        if (big) needsZip64 = true;

        const method = (await worthCompressing(source, size)) ? DEFLATED : STORED;
        const placed = await putEntry({ name: file.rel, mtime: file.mtime, size, method, big });
        const dataAt = at;

        let crc = 0;
        let read = 0;
        const digest = sha256 ? sha256() : null;
        const deflate = method === DEFLATED ? zlib.createDeflateRaw({ level: 6 }) : null;
        const pending = [];
        if (deflate) deflate.on('data', (chunk) => pending.push(chunk));

        const drain = async () => {
          while (pending.length > 0) await writeAll(pending.shift());
        };

        const buf = Buffer.allocUnsafe(CHUNK);
        for (;;) {
          if (token.cancelled) throw Object.assign(new Error('cancelled'), { code: 'ECANCELLED' });
          const { bytesRead } = await source.read(buf, 0, CHUNK, read);
          if (bytesRead === 0) break;
          const chunk = buf.subarray(0, bytesRead);
          crc = zlib.crc32(chunk, crc);
          if (digest) digest.update(chunk);
          read += bytesRead;
          rawBytes += bytesRead;

          if (deflate) {
            if (!deflate.write(Buffer.from(chunk))) {
              await new Promise((resolve) => deflate.once('drain', resolve));
            }
            await drain();
          } else {
            await writeAll(chunk);
          }
          report(file.rel);
        }

        if (deflate) {
          await new Promise((resolve, reject) => {
            deflate.on('end', resolve);
            deflate.on('error', reject);
            deflate.end();
            deflate.resume();
          });
          await drain();
        }

        const packed = at - dataAt;
        packedBytes += packed;

        // Back to the header, now that all three are known.
        const patch = Buffer.alloc(12);
        patch.writeUInt32LE(crc >>> 0, 0);
        patch.writeUInt32LE(big ? U32_MAX : packed, 4);
        patch.writeUInt32LE(big ? U32_MAX : read, 8);
        await handle.write(patch, 0, 12, placed.headerAt + 14);
        if (big) {
          const z64 = Buffer.alloc(16);
          z64.writeBigUInt64LE(BigInt(read), 0);
          z64.writeBigUInt64LE(BigInt(packed), 8);
          // Past the header and the name, then past the extra field's own
          // four-byte id and length.
          await handle.write(z64, 0, 16, placed.headerAt + 30 + placed.nameBuf.length + 4);
        }

        central.push({
          name: file.rel,
          nameBuf: placed.nameBuf,
          dos: placed.dos,
          method,
          crc: crc >>> 0,
          packed,
          size: read,
          headerAt: placed.headerAt,
          directory: false,
          sha256: digest ? digest.digest('hex') : null,
        });
        report(file.rel);
      } catch (err) {
        if (err.code === 'ECANCELLED') {
          await source.close().catch(() => {});
          throw err;
        }
        failed.push({ rel: file.rel, error: err.message, code: err.code || 'EPACK' });
      } finally {
        await source.close().catch(() => {});
      }
    }

    /* -- anything the caller wanted inside, such as the manifest ---------- */
    const packedSoFar = central
      .filter((item) => !item.directory)
      .map((item) => ({
        name: toZipName(item.name),
        size: item.size,
        packed: item.packed,
        method: item.method === DEFLATED ? 'deflate' : 'store',
        crc: item.crc,
        sha256: item.sha256,
      }));

    for (const item of extraOf(packedSoFar)) {
      if (token.cancelled) break;
      const body = Buffer.isBuffer(item.body) ? item.body : Buffer.from(String(item.body), 'utf8');
      const packedBody = zlib.deflateRawSync(body, { level: 6 });
      const useDeflate = packedBody.length < body.length;
      const placed = await putEntry({
        name: item.name,
        mtime: new Date(),
        size: body.length,
        method: useDeflate ? DEFLATED : STORED,
        big: false,
      });
      await writeAll(useDeflate ? packedBody : body);

      const patch = Buffer.alloc(12);
      patch.writeUInt32LE(zlib.crc32(body) >>> 0, 0);
      patch.writeUInt32LE(useDeflate ? packedBody.length : body.length, 4);
      patch.writeUInt32LE(body.length, 8);
      await handle.write(patch, 0, 12, placed.headerAt + 14);

      central.push({
        name: item.name,
        nameBuf: placed.nameBuf,
        dos: placed.dos,
        method: useDeflate ? DEFLATED : STORED,
        crc: zlib.crc32(body) >>> 0,
        packed: useDeflate ? packedBody.length : body.length,
        size: body.length,
        headerAt: placed.headerAt,
        directory: false,
      });
    }

    if (token.cancelled) {
      await handle.close();
      return { ok: false, cancelled: true, entries: [], bytes: rawBytes, packedBytes, failed };
    }

    /* -- the index, and the record that points at it ---------------------- */
    const directoryAt = at;
    for (const item of central) {
      const bigSize = item.size >= U32_MAX || item.packed >= U32_MAX;
      const bigOffset = item.headerAt >= U32_MAX;
      const z64 = bigSize || bigOffset;
      if (z64) needsZip64 = true;

      const extraLen = z64 ? 4 + (bigSize ? 16 : 0) + (bigOffset ? 8 : 0) : 0;
      const head = Buffer.alloc(46);
      head.writeUInt32LE(CENTRAL_SIG, 0);
      head.writeUInt16LE(z64 ? 45 : 20, 4);
      head.writeUInt16LE(z64 ? 45 : 20, 6);
      head.writeUInt16LE(FLAG_UTF8, 8);
      head.writeUInt16LE(item.method, 10);
      head.writeUInt16LE(item.dos.time, 12);
      head.writeUInt16LE(item.dos.date, 14);
      head.writeUInt32LE(item.crc, 16);
      head.writeUInt32LE(bigSize ? U32_MAX : item.packed, 20);
      head.writeUInt32LE(bigSize ? U32_MAX : item.size, 24);
      head.writeUInt16LE(item.nameBuf.length, 28);
      head.writeUInt16LE(extraLen, 30);
      head.writeUInt16LE(0, 32);
      head.writeUInt16LE(0, 34);
      head.writeUInt16LE(0, 36);
      head.writeUInt32LE(item.directory ? 0x10 : 0, 38);
      head.writeUInt32LE(bigOffset ? U32_MAX : item.headerAt, 42);
      // Again: fixed part, name, extra. The reader takes the extra field from
      // after the name, so an extra field written before it is read as part
      // of the name and the 64-bit values are never seen.
      const extraBuf = Buffer.alloc(extraLen);
      if (z64) {
        extraBuf.writeUInt16LE(0x0001, 0);
        extraBuf.writeUInt16LE(extraLen - 4, 2);
        let cursor = 4;
        // The order the format fixes: uncompressed, compressed, then offset,
        // and only the ones that overflowed.
        if (bigSize) {
          extraBuf.writeBigUInt64LE(BigInt(item.size), cursor);
          extraBuf.writeBigUInt64LE(BigInt(item.packed), cursor + 8);
          cursor += 16;
        }
        if (bigOffset) extraBuf.writeBigUInt64LE(BigInt(item.headerAt), cursor);
      }
      await writeAll(head);
      await writeAll(item.nameBuf);
      if (extraLen > 0) await writeAll(extraBuf);
    }
    const directorySize = at - directoryAt;

    const manyEntries = central.length > U16_MAX - 1;
    if (manyEntries || directoryAt >= U32_MAX || directorySize >= U32_MAX) needsZip64 = true;

    if (needsZip64) {
      const eocd64At = at;
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(EOCD64_SIG, 0);
      rec.writeBigUInt64LE(44n, 4);
      rec.writeUInt16LE(45, 12);
      rec.writeUInt16LE(45, 14);
      rec.writeUInt32LE(0, 16);
      rec.writeUInt32LE(0, 20);
      rec.writeBigUInt64LE(BigInt(central.length), 24);
      rec.writeBigUInt64LE(BigInt(central.length), 32);
      rec.writeBigUInt64LE(BigInt(directorySize), 40);
      rec.writeBigUInt64LE(BigInt(directoryAt), 48);
      await writeAll(rec);

      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(EOCD64_LOC_SIG, 0);
      loc.writeUInt32LE(0, 4);
      loc.writeBigUInt64LE(BigInt(eocd64At), 8);
      loc.writeUInt32LE(1, 16);
      await writeAll(loc);
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(EOCD_SIG, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(needsZip64 && manyEntries ? U16_MAX : central.length, 8);
    end.writeUInt16LE(needsZip64 && manyEntries ? U16_MAX : central.length, 10);
    end.writeUInt32LE(directorySize >= U32_MAX ? U32_MAX : directorySize, 12);
    end.writeUInt32LE(directoryAt >= U32_MAX ? U32_MAX : directoryAt, 16);
    end.writeUInt16LE(0, 20);
    await writeAll(end);

    // On the disk before it is read back, not merely handed to the cache.
    await handle.sync();
  } finally {
    await handle.close().catch(() => {});
  }

  return {
    ok: failed.length === 0 && !token.cancelled,
    entries: central.filter((item) => !item.directory).map((item) => ({
      name: toZipName(item.name),
      size: item.size,
      packed: item.packed,
      method: item.method === DEFLATED ? 'deflate' : 'store',
      crc: item.crc,
      sha256: item.sha256 || null,
    })),
    directories: central.filter((item) => item.directory).length,
    bytes: rawBytes,
    packedBytes,
    archiveBytes: at,
    failed,
    cancelled: token.cancelled,
    zip64: needsZip64,
  };
}

/* -------------------------------------------------------------------------- */
/* reading it back                                                             */
/* -------------------------------------------------------------------------- */

/** How much of the tail to read while looking for the end record. */
const TAIL_BYTES = 128 * 1024;

/**
 * The index of an archive on disk, without expanding anything.
 *
 * Reads the end of the file, and then the index itself -- about a hundred
 * bytes per member, so a folder of a hundred thousand files costs ten
 * megabytes and nothing else does.
 */
async function index(archive) {
  const handle = await fsp.open(longPath(archive), 'r');
  try {
    const { size } = await handle.stat();
    const tailAt = Math.max(0, size - TAIL_BYTES);
    const tail = Buffer.allocUnsafe(Number(size - tailAt));
    await handle.read(tail, 0, tail.length, tailAt);

    const eocd = preview.findEocd(tail, tailAt);

    // The index may start before the stretch already read; take it exactly.
    let buf = tail;
    let base = tailAt;
    if (eocd.offset < tailAt) {
      base = eocd.offset;
      buf = Buffer.allocUnsafe(Math.max(0, Number(size) - base));
      await handle.read(buf, 0, buf.length, base);
    }

    const { entries } = preview.readCentralDirectory(buf, eocd, base);
    return { entries, archiveBytes: Number(size) };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Read one member, a piece at a time, through whatever is given.
 *
 * Nothing is ever held whole: `onChunk` gets megabyte pieces, and that is how
 * both verification and extraction manage a file larger than memory.
 */
async function readMember(handle, entry, onChunk, token) {
  // The local header's name and extra lengths are the only things it is asked
  // for; the sizes there may be placeholders, and the index is authoritative.
  const head = Buffer.allocUnsafe(30);
  await handle.read(head, 0, 30, entry.localOffset);
  if (head.readUInt32LE(0) !== LOCAL_SIG) {
    throw Object.assign(new Error('a member is not where the index says'), { code: 'EZIPBAD' });
  }
  const dataAt = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);

  const inflate = entry.method === DEFLATED ? zlib.createInflateRaw() : null;
  let crc = 0;
  let plain = 0;

  const take = (chunk) => {
    crc = zlib.crc32(chunk, crc);
    plain += chunk.length;
    return onChunk ? onChunk(chunk) : undefined;
  };

  if (inflate) {
    const pending = [];
    inflate.on('data', (chunk) => pending.push(chunk));
    const drain = async () => {
      while (pending.length > 0) await take(pending.shift());
    };

    const buf = Buffer.allocUnsafe(CHUNK);
    let left = entry.compressedSize;
    while (left > 0) {
      if (token && token.cancelled) throw Object.assign(new Error('cancelled'), { code: 'ECANCELLED' });
      const want = Math.min(CHUNK, left);
      const { bytesRead } = await handle.read(buf, 0, want, dataAt + (entry.compressedSize - left));
      if (bytesRead === 0) break;
      left -= bytesRead;
      if (!inflate.write(Buffer.from(buf.subarray(0, bytesRead)))) {
        await new Promise((resolve) => inflate.once('drain', resolve));
      }
      await drain();
    }
    await new Promise((resolve, reject) => {
      inflate.on('end', resolve);
      inflate.on('error', reject);
      inflate.end();
      inflate.resume();
    });
    await drain();
  } else {
    const buf = Buffer.allocUnsafe(CHUNK);
    let done = 0;
    while (done < entry.compressedSize) {
      if (token && token.cancelled) throw Object.assign(new Error('cancelled'), { code: 'ECANCELLED' });
      const want = Math.min(CHUNK, entry.compressedSize - done);
      const { bytesRead } = await handle.read(buf, 0, want, dataAt + done);
      if (bytesRead === 0) break;
      done += bytesRead;
      await take(buf.subarray(0, bytesRead));
    }
  }

  return { crc: crc >>> 0, bytes: plain };
}

/**
 * Open every member and check it against what the archive claims.
 *
 * This is the step that makes B5 safe to act on: the original folder is not
 * touched until the archive has been read back from disk and every member has
 * produced the CRC and the length its own index states. A `hashes` map, when
 * given, is checked as well -- that is the manifest, which is how a member can
 * be proved to be the file that went in rather than merely a member that
 * decompresses.
 */
async function verify(archive, { token = null, onProgress = null, hashes = null, sha256 = null } = {}) {
  const { entries } = await index(archive);
  const files = entries.filter((entry) => !entry.directory);
  const bad = [];
  let checked = 0;
  let bytes = 0;

  const handle = await fsp.open(longPath(archive), 'r');
  const report = throttle((name) => {
    if (onProgress) onProgress({ phase: 'verifying', done: checked, total: files.length, bytes, currentPath: name });
  }, 150);

  try {
    for (const entry of files) {
      if (token && token.cancelled) return { ok: false, cancelled: true, checked, bad, entries: files.length };

      const digest = sha256 ? sha256() : null;
      let result;
      try {
        result = await readMember(handle, entry, digest ? (chunk) => digest.update(chunk) : null, token);
      } catch (err) {
        if (err.code === 'ECANCELLED') return { ok: false, cancelled: true, checked, bad, entries: files.length };
        bad.push({ name: entry.name, why: 'unreadable', error: err.message });
        checked += 1;
        continue;
      }

      if (result.crc !== entry.crc) bad.push({ name: entry.name, why: 'crc' });
      else if (result.bytes !== entry.size) bad.push({ name: entry.name, why: 'length', got: result.bytes, want: entry.size });
      else if (hashes && hashes.has(entry.name)) {
        const got = digest ? digest.digest('hex') : null;
        if (got !== hashes.get(entry.name)) bad.push({ name: entry.name, why: 'sha256' });
      }

      checked += 1;
      bytes += result.bytes;
      report(entry.name);
    }
  } finally {
    await handle.close().catch(() => {});
  }

  return { ok: bad.length === 0, cancelled: false, checked, bad, entries: files.length, bytes };
}

/**
 * Put an archive's contents back on disk.
 *
 * Folders first so a file never lands before the folder it belongs in, and
 * timestamps last, because writing a file is what moves its modification time.
 * A member whose name would climb out of the target is refused rather than
 * written -- an archive is somebody else's file, even when this app wrote it.
 */
async function extract(archive, into, { token = null, onProgress = null, overwrite = false, skip = null } = {}) {
  const { entries: all } = await index(archive);
  // `skip` is for members the archive carries about itself rather than for
  // the person -- B5's manifest. Unpacking one would leave a file in their
  // folder that was never in it, which is the sort of small dishonesty that
  // makes somebody stop trusting a restore.
  const entries = skip ? all.filter((entry) => !skip(entry)) : all;
  const written = [];
  const failed = [];
  let bytes = 0;

  await fsp.mkdir(longPath(into), { recursive: true });

  for (const entry of entries.filter((e) => e.directory)) {
    const rel = fromZipName(entry.name);
    if (!rel) continue;
    await fsp.mkdir(longPath(path.join(into, rel)), { recursive: true }).catch(() => {});
  }

  const files = entries.filter((entry) => !entry.directory);
  const handle = await fsp.open(longPath(archive), 'r');
  const report = throttle((name) => {
    if (onProgress) onProgress({ phase: 'extracting', done: written.length + failed.length, total: files.length, bytes, currentPath: name });
  }, 150);

  try {
    for (const entry of files) {
      if (token && token.cancelled) break;

      const rel = fromZipName(entry.name);
      if (!rel) {
        failed.push({ name: entry.name, error: 'that name points outside the folder', code: 'EESCAPE' });
        continue;
      }
      const target = path.join(into, rel);

      if (!overwrite && (await fsp.stat(longPath(target)).then(() => true, () => false))) {
        failed.push({ name: entry.name, error: 'something is already there', code: 'EEXIST' });
        continue;
      }

      await fsp.mkdir(longPath(path.dirname(target)), { recursive: true }).catch(() => {});
      let out;
      try {
        out = await fsp.open(longPath(target), overwrite ? 'w' : 'wx');
        const result = await readMember(handle, entry, async (chunk) => {
          await out.write(chunk);
          bytes += chunk.length;
        }, token);
        await out.close();
        out = null;

        if (result.crc !== entry.crc) {
          await fsp.rm(longPath(target), { force: true }).catch(() => {});
          failed.push({ name: entry.name, error: 'it did not come back the same', code: 'ECRC' });
          continue;
        }

        if (Number.isFinite(entry.mtimeMs)) {
          const when = new Date(entry.mtimeMs);
          await fsp.utimes(longPath(target), when, when).catch(() => {});
        }
        written.push({ name: entry.name, path: target, bytes: result.bytes });
      } catch (err) {
        if (out) await out.close().catch(() => {});
        if (err.code === 'ECANCELLED') break;
        failed.push({ name: entry.name, error: err.message, code: err.code || 'EWRITE' });
      }
      report(entry.name);
    }
  } finally {
    await handle.close().catch(() => {});
  }

  return {
    ok: failed.length === 0 && !(token && token.cancelled),
    written,
    failed,
    bytes,
    cancelled: Boolean(token && token.cancelled),
  };
}

module.exports = {
  write,
  index,
  verify,
  extract,
  toZipName,
  fromZipName,
  worthCompressing,
  toDosTime,
  STORED,
  DEFLATED,
  SNIFF_BYTES,
  WORTH_COMPRESSING,
};
