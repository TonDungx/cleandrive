'use strict';

/**
 * NTFS compression, as the file system does it (B4).
 *
 * Nothing here compresses anything itself: NTFS does, and `compact.exe` is
 * how Windows is asked. The file keeps its name, its size as programs see it,
 * and its contents; what changes is how many clusters it occupies, which is
 * the number this whole feature is about.
 *
 * ## LZNT1 only, and the measurement that decided it
 *
 * `compact` offers a second family -- WOF, with XPRESS and LZX -- and it
 * compresses harder. Measured on this machine, 6.1 MB of source: LZNT1 leaves
 * 765,952 bytes on disk (87.5% saved), LZX leaves 221,184 (96.4%).
 *
 * The spec suspected, and marked `[Unverified]`, that a WOF-compressed file
 * "returns to uncompressed when rewritten". It is worse than that. Measured:
 * an LZX-compressed 3.3 MB log sat at 90,112 bytes on disk; **one 40-byte
 * write in place** took it straight back to 3,348,890. Not a rewrite -- a
 * write. LZNT1 survived both that and replacing the file wholesale.
 *
 * So this ships LZNT1 and nothing else. Nine more points of ratio are not
 * worth a compression that evaporates the first time anything touches the
 * file, when the app cannot know that nothing will.
 *
 * ## Nothing here parses what `compact` prints
 *
 * On this machine it says "The compression ratio is 1,9 to 1" -- a comma,
 * because the locale says so. `lib/scheduler.js` explains at length why this
 * project does not read localised output, and the same applies. Sizes come
 * from the file system: `stat().blocks * 512`, which Node reports correctly
 * on Windows for a compressed file (measured: 4,321,280 before, 540,672
 * after). Success comes from an exit code.
 *
 * ## The volume has to be able to
 *
 * NTFS compression needs a cluster of 4 KB or less, and the spec does not
 * mention it. Rather than asking Windows for the cluster size and reasoning
 * about it, this writes a small block of obviously compressible bytes into
 * the place in question, asks NTFS to compress it, and looks. A volume that
 * cannot do it says so by not doing it, which is a fact rather than an
 * inference, and it costs one file of 64 KB.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { IS_WIN } = require('./util');
const { longPath } = require('./verified-copy');

const compactExe = () =>
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'compact.exe');

/** Bytes that compress by a great deal on any algorithm, for the capability probe. */
const PROBE_BYTES = Buffer.from('cleandrive compression probe 0123456789\n'.repeat(1600));

/** How much of a folder is sampled to estimate what compressing it would give. */
const SAMPLE_FILES = 12;
const SAMPLE_BYTES = 24 * 1024 * 1024;

/** Extensions whose contents are already compressed; sampling them is a waste. */
const ALREADY_COMPRESSED = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.avif',
  '.mp4', '.mov', '.mkv', '.avi', '.wmv', '.webm',
  '.mp3', '.aac', '.m4a', '.ogg', '.opus', '.flac',
  '.zip', '.7z', '.rar', '.gz', '.bz2', '.xz', '.zst', '.cab',
  '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.epub', '.jar', '.apk',
  '.pdf',
]);

function run(args, cwd) {
  return new Promise((resolve) => {
    execFile(compactExe(), args, { cwd, windowsHide: true, timeout: 30 * 60 * 1000 }, (err) => {
      resolve({ ok: !err, code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0, error: err ? err.message : null });
    });
  });
}

/** What this file takes on the disk right now. */
async function sizeOnDisk(file) {
  try {
    const st = await fsp.lstat(longPath(file));
    return Number.isFinite(st.blocks) ? st.blocks * 512 : st.size;
  } catch {
    return null;
  }
}

/** Whether a file is already taking less room than its length -- compressed, or sparse. */
async function looksCompressed(file) {
  const st = await fsp.lstat(longPath(file)).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return false;
  const disk = Number.isFinite(st.blocks) ? st.blocks * 512 : st.size;
  // One cluster of slack either way; a file under a cluster can never show it.
  return st.size > 8192 && disk < st.size * 0.95;
}

/** A scratch folder beside the target, on the same volume, removed afterwards. */
async function scratch(near) {
  const stem = `.cleandrive-compress-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  for (const parent of [path.dirname(near), near]) {
    const dir = path.join(parent, stem);
    try {
      await fsp.mkdir(longPath(dir));
      return dir;
    } catch {
      // try the next place
    }
  }
  return null;
}

/**
 * Can this place hold compressed files at all?
 *
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 *   reason is 'unsupported' (the volume will not), 'noRoom' (nowhere to try),
 *   or null when it can.
 */
async function canCompress(where) {
  if (!IS_WIN) return { ok: false, reason: 'unsupported' };
  const dir = await scratch(where);
  if (!dir) return { ok: false, reason: 'noRoom' };

  try {
    const probe = path.join(dir, 'probe.bin');
    await fsp.writeFile(longPath(probe), PROBE_BYTES);
    const before = await sizeOnDisk(probe);
    const done = await run(['/c', '/i', 'probe.bin'], dir);
    const after = await sizeOnDisk(probe);
    if (!done.ok) return { ok: false, reason: 'unsupported' };
    // Compressible bytes that did not compress mean the volume cannot.
    return after !== null && before !== null && after < before * 0.75
      ? { ok: true, reason: null }
      : { ok: false, reason: 'unsupported' };
  } catch {
    return { ok: false, reason: 'unsupported' };
  } finally {
    await fsp.rm(longPath(dir), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * How much compressing this folder would actually give back.
 *
 * The spec asks for "compress a small sample in memory to estimate the ratio",
 * and in memory is the one place it cannot honestly be done: the only thing
 * Node can compress is deflate, which is stronger than LZNT1 and would
 * therefore promise more than NTFS delivers. Promising more than is delivered
 * is the direction this app is written against, so the sample is copied to a
 * scratch folder on the same volume and put through the real thing.
 *
 * Files whose contents are already compressed are counted at full size
 * without being sampled -- measured, a JPEG saves 0.0% -- so a folder of
 * photos is reported as not worth compressing rather than sampled twelve
 * times to find that out.
 *
 * @returns {Promise<{ok, ratio, sampled, sampledBytes, alreadyCompressed, reason}>}
 */
async function estimate(files, where, { token = null } = {}) {
  const usable = (files || []).filter((f) => f && Number.isFinite(f.size) && f.size > 0);
  if (usable.length === 0) return { ok: true, ratio: 1, sampled: 0, sampledBytes: 0, alreadyCompressed: 0, reason: null };

  const able = await canCompress(where);
  if (!able.ok) return { ok: false, ratio: 1, sampled: 0, sampledBytes: 0, alreadyCompressed: 0, reason: able.reason };

  const skipped = usable.filter((f) => ALREADY_COMPRESSED.has(path.extname(f.abs || f.rel || '').toLowerCase()));
  const worth = usable.filter((f) => !ALREADY_COMPRESSED.has(path.extname(f.abs || f.rel || '').toLowerCase()));
  const skippedBytes = skipped.reduce((n, f) => n + f.size, 0);
  const worthBytes = worth.reduce((n, f) => n + f.size, 0);

  if (worth.length === 0) {
    return { ok: true, ratio: 1, sampled: 0, sampledBytes: 0, alreadyCompressed: skipped.length, reason: null };
  }

  const dir = await scratch(where);
  if (!dir) return { ok: false, ratio: 1, sampled: 0, sampledBytes: 0, alreadyCompressed: skipped.length, reason: 'noRoom' };

  let raw = 0;
  let packed = 0;
  let sampled = 0;

  try {
    const step = Math.max(1, Math.floor(worth.length / SAMPLE_FILES));
    for (let at = 0; at < worth.length && sampled < SAMPLE_FILES && raw < SAMPLE_BYTES; at += step) {
      if (token && token.cancelled) break;
      const file = worth[at];
      const name = `s${sampled}${path.extname(file.abs || '')}`;
      const copy = path.join(dir, name);
      try {
        await fsp.copyFile(longPath(file.abs), longPath(copy));
      } catch {
        continue;
      }
      const before = await sizeOnDisk(copy);
      const done = await run(['/c', '/i', name], dir);
      const after = await sizeOnDisk(copy);
      if (done.ok && before !== null && after !== null && before > 0) {
        raw += before;
        packed += after;
        sampled += 1;
      }
    }
  } finally {
    await fsp.rm(longPath(dir), { recursive: true, force: true }).catch(() => {});
  }

  if (sampled === 0) {
    return { ok: false, ratio: 1, sampled: 0, sampledBytes: 0, alreadyCompressed: skipped.length, reason: 'noSample' };
  }

  // The sample's ratio applies to the files worth compressing; the rest are
  // counted whole, because that is what they will be.
  const sampleRatio = packed / raw;
  const total = worthBytes + skippedBytes;
  const expected = worthBytes * sampleRatio + skippedBytes;

  return {
    ok: true,
    ratio: total > 0 ? expected / total : 1,
    sampleRatio,
    sampled,
    sampledBytes: raw,
    alreadyCompressed: skipped.length,
    reason: null,
  };
}

/**
 * Ask NTFS to compress, or to stop compressing, a folder and everything in it.
 *
 * `/i` carries on past a file it cannot do -- one held open by something else
 * -- rather than stopping the run; those are counted afterwards by looking at
 * the files, not by reading what `compact` said about them.
 */
async function setCompression(folder, on, { token = null } = {}) {
  if (!IS_WIN) return { ok: false, reason: 'unsupported' };
  const args = on ? ['/c', '/i', '/s'] : ['/u', '/i', '/s'];
  const started = Date.now();
  const done = await run(args, folder);
  return {
    ok: done.ok,
    code: done.code,
    error: done.error,
    durationMs: Date.now() - started,
    cancelled: Boolean(token && token.cancelled),
  };
}

/** What a whole tree takes on the disk, and what it would take uncompressed. */
async function measure(files) {
  let logical = 0;
  let disk = 0;
  let missing = 0;
  for (const file of files || []) {
    const st = await fsp.lstat(longPath(file.abs)).catch(() => null);
    if (!st || !st.isFile()) {
      missing += 1;
      continue;
    }
    logical += st.size;
    disk += Number.isFinite(st.blocks) ? st.blocks * 512 : st.size;
  }
  return { logical, disk, missing, saved: Math.max(0, logical - disk) };
}

module.exports = {
  canCompress,
  estimate,
  setCompression,
  measure,
  sizeOnDisk,
  looksCompressed,
  ALREADY_COMPRESSED,
  SAMPLE_FILES,
  compactExe,
};
