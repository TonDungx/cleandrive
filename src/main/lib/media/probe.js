'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const format = require('./format');
const exif = require('./exif');
const bmff = require('./bmff');
const cloud = require('./cloud');

/**
 * Everything one file will say about itself for the price of one open.
 *
 * This is the whole of phase one's per-file work, and the budget it has to fit
 * inside is severe: fifty thousand files, a usable list in seconds. So the rule
 * is one `open`, one read of the head, and -- for video only -- a handful of
 * sixteen-byte seeks. Nothing is decoded. Nothing is decompressed. The pixels
 * are phase two's problem and phase two only ever runs on what is on screen.
 *
 * Measured against this machine's real files: 600 files fully parsed in 408 ms
 * on one thread, which is about 1,470 per second before any worker pool.
 *
 * Deliberately free of Electron and of the app's own state, because this is the
 * code that runs inside the worker threads.
 */

/** How much of the front of a file to read. Enough for EXIF in every real JPEG. */
const HEAD_BYTES = 64 * 1024;

/**
 * Below this a "photo" is an interface asset: an emoji, a bullet, a spacer, a
 * favicon someone saved. Not excluded -- the user may want exactly these gone
 * -- but recorded, because it is the difference between a folder of memories
 * and a folder of sprites.
 */
const TINY_BYTES = 20 * 1024;

/**
 * Read a file's head and say what is in it.
 *
 * @param {string} filePath
 * @param {import('node:fs').Stats} stats  from the walk, so it is not stat'd twice
 * @returns {Promise<object>} a record; never throws
 */
async function probeFile(filePath, stats) {
  const ext = extensionOf(filePath);
  const record = {
    path: filePath,
    name: path.basename(filePath),
    ext,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    atimeMs: stats.atimeMs,
    birthtimeMs: Number.isFinite(stats.birthtimeMs) ? stats.birthtimeMs : null,
    kind: format.kindOfExtension(ext),
    tiny: stats.size <= TINY_BYTES,
  };

  const service = cloud.serviceForPath(filePath);
  if (service) record.cloudService = service;

  // A placeholder has a name, a size and no bytes. Reading one downloads it,
  // which on a synced Pictures folder means downloading the folder -- so the
  // file is described from what `stat` already told us and left alone.
  if (cloud.looksDehydrated(stats)) {
    record.dehydrated = true;
    record.unread = 'dehydrated';
    return record;
  }

  let handle;
  try {
    handle = await fsp.open(filePath, 'r');
  } catch (err) {
    record.unread = err.code === 'EBUSY' ? 'busy' : 'unreadable';
    record.error = err.code || 'EOPEN';
    return record;
  }

  try {
    const head = await readAt(handle, 0, Math.min(HEAD_BYTES, stats.size));
    if (head.length === 0) {
      record.unread = 'empty';
      return record;
    }

    const detected = format.detectFormat(head);
    if (!detected) {
      // The bytes match nothing known. For a file named `.jpg` that is a
      // finding in its own right -- a failed download saved under the name the
      // link had, or a rename that was never what it claimed.
      record.unread = 'unrecognised';
      return record;
    }

    record.format = detected.format;
    record.kind = detected.kind;
    if (detected.brand) record.brand = detected.brand;
    record.formatMismatch = !format.extensionMatches(ext, detected.format);

    if (detected.kind === 'image') {
      await describeImage(record, head, detected, handle, stats);
    } else {
      await describeVideo(record, head, handle, stats);
    }

    // The strongest "where did this come from" signal Windows offers, and it
    // costs one more open. Skipped when EXIF has already named the camera:
    // nothing a download record could add would change that answer, and half
    // the files in a photo library are camera photos.
    if (!record.camera) {
      const zone = await readZoneIdentifier(filePath);
      if (zone) record.zone = zone;
    }
  } catch (err) {
    record.unread = 'unreadable';
    record.error = err.code || 'EREAD';
  } finally {
    await handle.close().catch(() => {});
  }

  return record;
}

/* -------------------------------------------------------------------------- */
/* images                                                                      */
/* -------------------------------------------------------------------------- */

async function describeImage(record, head, detected, handle, stats) {
  let size = format.readImageSize(head, detected.format);

  // HEIC and AVIF keep their size in a `meta` box rather than in a header, so
  // the container has to be walked for it.
  if (!size && (detected.format === 'heic' || detected.format === 'avif' || detected.format === 'cr3')) {
    size = bmff.parseIspe(head);
  }

  let tags = null;
  if (detected.format === 'jpeg') {
    const segments = format.jpegSegments(head);
    tags = exif.fromJpeg(head, segments);
    const frame = format.readJpegFrame(head);
    if (frame) record.progressive = frame.progressive;
  } else if (detected.format === 'tiff') {
    tags = exif.fromTiff(head);
  }

  if (tags) applyExif(record, tags);

  // A camera writes the *sensor* dimensions and an orientation tag saying which
  // way up it was held. A portrait photo from a phone is stored 4032x3024 with
  // orientation 6, and reporting that is reporting the wrong shape -- it would
  // put every portrait photo in the landscape aspect group, and make the
  // screenshot test compare a rotated image against the screen's resolution.
  if (size && size.width > 0 && size.height > 0) {
    record.storedWidth = size.width;
    record.storedHeight = size.height;

    const turned = exif.appliesQuarterTurn(record.orientation || 1);
    record.width = turned ? size.height : size.width;
    record.height = turned ? size.width : size.height;
    if (turned) record.rotated = true;

    applyPixelMetrics(record, stats.size);
  }
}

function applyExif(record, tags) {
  if (tags.camera) record.camera = tags.camera;
  if (tags.make) record.make = tags.make;
  if (tags.model) record.model = tags.model;
  if (tags.software) record.software = tags.software;
  if (tags.lens) record.lens = tags.lens;
  if (tags.takenAt) record.takenAt = tags.takenAt;
  if (tags.orientation) record.orientation = tags.orientation;
  if (tags.iso) record.iso = tags.iso;
  if (tags.focalLength) record.focalLength = tags.focalLength;
  if (tags.exposureTime) record.exposureTime = tags.exposureTime;
  // Whether a position was recorded, never the position itself. See `exif.js`.
  if (tags.hasGps) record.hasGps = true;
  record.hasExif = true;
}

/**
 * The numbers that describe an image as an image rather than as a file.
 *
 * `bytesPerPixel` is reported and never judged on its own. It conflates three
 * different things -- the format (HEIC packs a pixel into a fraction of what
 * JPEG needs), the content (a screenshot of a flat interface compresses to
 * almost nothing and has lost nothing), and the chroma subsampling -- so a low
 * figure is evidence towards "this was recompressed" only alongside other
 * evidence, never by itself.
 */
function applyPixelMetrics(record, bytes) {
  const pixels = record.width * record.height;
  if (pixels <= 0) return;
  record.megapixels = Math.round((pixels / 1e6) * 10) / 10;
  record.bytesPerPixel = Math.round((bytes / pixels) * 1000) / 1000;
  record.aspect = Math.round((record.width / record.height) * 1000) / 1000;
}

/* -------------------------------------------------------------------------- */
/* video                                                                       */
/* -------------------------------------------------------------------------- */

async function describeVideo(record, head, handle, stats) {
  // Only the ISO base media family can be read without a decoder. Matroska,
  // AVI and ASF are recognised and sized by their container, and their duration
  // is left null rather than guessed at -- an EBML parser is a second parser
  // for a format this machine has no examples of, and a made-up duration is
  // worse than an absent one.
  if (record.format !== 'mp4' && record.format !== 'mov' && record.format !== '3gp') return;

  const read = (offset, length) => readAt(handle, offset, length);
  const found = await bmff.locateMoov(read, stats.size, head);
  if (!found) {
    record.noMetadata = true;
    return;
  }

  record.moovHops = found.hops;
  const moov = bmff.parseMoov(found.moov);

  if (moov.durationSec !== null && moov.durationSec > 0) {
    record.durationSec = Math.round(moov.durationSec * 10) / 10;
    // Overall bitrate, which is what "is this worth its size" actually asks.
    record.bitrateKbps = Math.round((stats.size * 8) / moov.durationSec / 1000);
  }
  if (moov.width > 0 && moov.height > 0) {
    record.width = moov.width;
    record.height = moov.height;
    record.aspect = Math.round((moov.width / moov.height) * 1000) / 1000;
  }
  if (moov.createdAt) record.recordedAt = moov.createdAt;
  record.hasVideoTrack = moov.hasVideo;
  record.hasAudioTrack = moov.hasAudio;
  record.tracks = moov.tracks;

  const tags = moov.tags || {};
  if (tags.make || tags.model) {
    record.camera = [tags.make, tags.model].filter(Boolean).join(' ').trim();
    record.make = tags.make || null;
    record.model = tags.model || null;
  }
  if (tags.software || tags.encoder) record.software = tags.software || tags.encoder;
  // A screen recorder writes the window's title here, which is both the
  // strongest evidence of what it is and the most legible thing to show.
  if (tags.title) record.title = tags.title;
  if (tags.hasLocation) record.hasGps = true;
}

/* -------------------------------------------------------------------------- */
/* where a file came from, according to Windows                                */
/* -------------------------------------------------------------------------- */

/**
 * The NTFS alternate data stream Windows attaches to anything downloaded.
 *
 * Measured on this machine: 260 of 400 files in Downloads carry one, 235 of
 * those name the host it came from, and reading them all costs about half a
 * millisecond each. That makes it the cheapest strong provenance signal
 * available -- better than a filename pattern, because nothing but the browser
 * writes it.
 *
 * **Only the hostname is kept.** The full `HostUrl` is a real URL with a real
 * path, and on this machine one of them reads
 * `https://<host>/room/68905a7e42429ced04296d6f/98b02d02-…` -- a chat room
 * identifier belonging to a private conversation. "Downloaded from
 * example.com" is the whole of what the classifier needs and the whole of what
 * is useful to show; the rest is somebody's browsing history, and this app has
 * no business carrying it around in a scan result.
 *
 * @returns {Promise<{host: string|null, referrerHost: string|null, zoneId: number|null} | null>}
 */
async function readZoneIdentifier(filePath) {
  let text;
  try {
    text = await fsp.readFile(`${filePath}:Zone.Identifier`, 'utf8');
  } catch {
    // ENOENT is the ordinary answer: the file was not downloaded. Anything else
    // (a filesystem without streams, a permission problem) means the same thing
    // for our purposes, which is that there is nothing to learn here.
    return null;
  }

  const zoneId = Number(/^ZoneId=(\d+)/m.exec(text)?.[1]);
  const host = hostOf(/^HostUrl=(.*)$/m.exec(text)?.[1]);
  const referrerHost = hostOf(/^ReferrerUrl=(.*)$/m.exec(text)?.[1]);

  if (!host && !referrerHost && !Number.isFinite(zoneId)) return null;
  return {
    host,
    referrerHost,
    zoneId: Number.isFinite(zoneId) ? zoneId : null,
  };
}

function hostOf(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const { hostname } = new URL(trimmed);
    return hostname || null;
  } catch {
    // Windows also writes `about:internet` and bare file paths here.
    return null;
  }
}

/* -------------------------------------------------------------------------- */

async function readAt(handle, offset, length) {
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buf, 0, length, offset);
  return buf.subarray(0, bytesRead);
}

function extensionOf(filePath) {
  const ext = path.extname(filePath);
  return ext ? ext.slice(1).toLowerCase() : '';
}

module.exports = { probeFile, readZoneIdentifier, HEAD_BYTES, TINY_BYTES };
