'use strict';

/**
 * EXIF, read from a JPEG's APP1 segment (or a TIFF/raw file's own header).
 *
 * ## Why this is written out rather than pulled in
 *
 * This app has one runtime dependency and adding a second for this would be a
 * poor trade: EXIF is a TIFF directory, TIFF directories are a fixed-size entry
 * table with an offset field, and the whole of what this subsystem needs from
 * it is nine tags. What follows is about two hundred lines, all of it in the
 * repository where it can be read, and it never runs on anything but bytes the
 * scan had already read.
 *
 * ## Treat every offset as hostile
 *
 * An EXIF block is attacker-controlled data in the ordinary sense -- it arrives
 * with files from the internet, and a photo that crashes or hangs the scanner
 * is a photo that stops the user cleaning their disk. Every offset here is
 * bounds-checked against the buffer, every loop has a ceiling, and an IFD
 * offset that has already been visited is refused, because `IFD0 -> ExifIFD ->
 * IFD0` is a two-entry file that would otherwise recurse forever.
 *
 * Nothing in here throws. A malformed block yields fewer tags, or none.
 */

/** Tags worth carrying out of IFD0. */
const TAG = {
  MAKE: 0x010f,
  MODEL: 0x0110,
  ORIENTATION: 0x0112,
  SOFTWARE: 0x0131,
  DATETIME: 0x0132,
  ARTIST: 0x013b,
  EXIF_IFD: 0x8769,
  GPS_IFD: 0x8825,

  /* ExifIFD */
  DATETIME_ORIGINAL: 0x9003,
  DATETIME_DIGITIZED: 0x9004,
  EXPOSURE_TIME: 0x829a,
  ISO: 0x8827,
  PIXEL_X: 0xa002,
  PIXEL_Y: 0xa003,
  FOCAL_LENGTH: 0x920a,
  LENS_MAKE: 0xa433,
  LENS_MODEL: 0xa434,
  USER_COMMENT: 0x9286,
};

/** Bytes per component, by TIFF type code. Unknown types are treated as 1. */
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/** Entries per IFD, and IFDs per block. Both are far above anything real. */
const MAX_ENTRIES = 512;
const MAX_IFDS = 8;

/**
 * Find the Exif APP1 inside a JPEG.
 *
 * APP1 is also where XMP lives, under a different identifier, so the payload
 * has to be checked rather than the marker alone -- a photo edited by Lightroom
 * carries both, and taking the first APP1 finds the wrong one about half the
 * time.
 *
 * @param {Array<{marker: number, at: number, length: number}>} segments from `jpegSegments`
 * @returns {{at: number, length: number} | null}  offset of the TIFF header
 */
function findExifSegment(buf, segments) {
  for (const segment of segments) {
    if (segment.marker !== 0xe1) continue;
    if (segment.at + 6 > buf.length) continue;
    if (buf.toString('latin1', segment.at, segment.at + 4) !== 'Exif') continue;
    // "Exif\0\0", then the TIFF header proper.
    return { at: segment.at + 6, length: Math.max(0, segment.length - 6) };
  }
  return null;
}

/**
 * Read a TIFF header and the directories hanging off it.
 *
 * @param {Buffer} buf
 * @param {number} tiffStart  offset of the "II"/"MM" byte-order mark
 * @returns {object | null}   see `shape` below; null when this is not TIFF
 */
function readTiff(buf, tiffStart = 0) {
  if (!buf || tiffStart + 8 > buf.length) return null;

  const order = buf.toString('latin1', tiffStart, tiffStart + 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';

  const u16 = (o) => (o + 2 <= buf.length ? (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : 0);
  const u32 = (o) => (o + 4 <= buf.length ? (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : 0);
  const i32 = (o) => (o + 4 <= buf.length ? (little ? buf.readInt32LE(o) : buf.readInt32BE(o)) : 0);

  if (u16(tiffStart + 2) !== 42) return null;

  const tags = new Map();
  const gps = new Map();
  const visited = new Set();
  let ifdCount = 0;

  /**
   * Read one directory into `into`.
   *
   * All offsets inside an EXIF block are relative to the start of the TIFF
   * header, never to the start of the file. Getting that wrong yields tags that
   * look almost right on files where the APP1 happens to sit near the front,
   * which is the worst kind of bug: it passes a casual test.
   */
  const readIfd = (offset, into, depth) => {
    if (depth > 3 || ifdCount++ > MAX_IFDS) return;
    const base = tiffStart + offset;
    if (offset <= 0 || base + 2 > buf.length) return;
    if (visited.has(base)) return;
    visited.add(base);

    const count = u16(base);
    if (count === 0 || count > MAX_ENTRIES) return;

    for (let n = 0; n < count; n++) {
      const entry = base + 2 + n * 12;
      if (entry + 12 > buf.length) return;

      const tag = u16(entry);
      const type = u16(entry + 2);
      const components = u32(entry + 4);
      const unit = TYPE_SIZE[type] || 1;
      const bytes = components * unit;

      // Up to four bytes live in the entry itself; anything larger is an
      // offset. Reversing this test reads the offset as a value and vice versa.
      const valueAt = bytes <= 4 ? entry + 8 : tiffStart + u32(entry + 8);

      // A pointer into another directory. Followed before the value is read,
      // because these carry an offset rather than anything displayable.
      if (tag === TAG.EXIF_IFD && into === tags) {
        readIfd(u32(entry + 8), tags, depth + 1);
        continue;
      }
      if (tag === TAG.GPS_IFD && into === tags) {
        readIfd(u32(entry + 8), gps, depth + 1);
        continue;
      }

      if (valueAt < 0 || valueAt + Math.min(bytes, 1) > buf.length) continue;

      const value = readValue(buf, valueAt, type, components, { u16, u32, i32 });
      if (value !== null && value !== undefined && value !== '') into.set(tag, value);
    }
  };

  readIfd(u32(tiffStart + 4), tags, 0);

  return shape(tags, gps);
}

/**
 * One tag's value.
 *
 * ASCII is capped at 128 bytes: the string tags this reads are camera names and
 * dates, and a 40 MB "Software" field is a file trying to make the scan
 * expensive rather than a camera with a long name.
 */
function readValue(buf, at, type, components, read) {
  switch (type) {
    case 2: {
      const length = Math.min(components, 128);
      if (at + length > buf.length) return null;
      // latin1 rather than utf8: the spec says ASCII, and a byte sequence that
      // is not valid UTF-8 would come back as replacement characters, which
      // reads as a corrupt camera name rather than as the odd encoding it is.
      return buf.toString('latin1', at, at + length).replace(/\0[\s\S]*$/, '').trim();
    }
    case 1:
    case 6:
    case 7:
      return buf[at];
    case 3:
    case 8:
      return read.u16(at);
    case 4:
    case 9:
      return read.u32(at);
    case 5:
    case 10: {
      // A rational is two longs. Division by zero is a legal encoding for
      // "unset" in several fields, so it yields null rather than Infinity.
      const numerator = type === 5 ? read.u32(at) : read.i32(at);
      const denominator = type === 5 ? read.u32(at + 4) : read.i32(at + 4);
      return denominator === 0 ? null : numerator / denominator;
    }
    default:
      return null;
  }
}

/** `2024:03:17 14:05:09` is EXIF's own format, and it is local time with no zone. */
function parseExifDate(text) {
  if (typeof text !== 'string') return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  // A camera with a flat battery writes 1980:01:01. Dates before digital
  // photography existed are the clock being wrong, not the photo being old.
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const at = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * The tag map, as the rest of the subsystem wants to read it.
 *
 * Every field is either a real value or null. A caller asking "was this taken
 * by a camera" should not have to know that the answer is tag 0x010F.
 */
function shape(tags, gps) {
  const text = (tag) => {
    const value = tags.get(tag);
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const number = (tag) => {
    const value = tags.get(tag);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const make = text(TAG.MAKE);
  const model = text(TAG.MODEL);

  return {
    make,
    model,
    // Most cameras repeat the maker in the model ("Canon" + "Canon EOS R6"),
    // and printing both would read as a stutter in the detail panel.
    camera: joinCamera(make, model),
    software: text(TAG.SOFTWARE),
    artist: text(TAG.ARTIST),
    lens: text(TAG.LENS_MODEL) || text(TAG.LENS_MAKE),
    orientation: number(TAG.ORIENTATION),
    takenAt:
      parseExifDate(text(TAG.DATETIME_ORIGINAL)) ||
      parseExifDate(text(TAG.DATETIME_DIGITIZED)) ||
      parseExifDate(text(TAG.DATETIME)),
    exposureTime: number(TAG.EXPOSURE_TIME),
    iso: number(TAG.ISO),
    focalLength: number(TAG.FOCAL_LENGTH),
    pixelX: number(TAG.PIXEL_X),
    pixelY: number(TAG.PIXEL_Y),
    // Only whether a position was recorded, never the position. This app has no
    // reason to know where a photo was taken, and a scan result that carried
    // coordinates would be one export away from being a location history.
    hasGps: gps.size > 0,
    tagCount: tags.size,
  };
}

function joinCamera(make, model) {
  if (!make && !model) return null;
  if (!model) return make;
  if (!make) return model;
  const first = make.split(/\s+/)[0];
  return model.toLowerCase().startsWith(first.toLowerCase()) ? model : `${make} ${model}`;
}

/**
 * Orientations 5 to 8 rotate by a quarter turn, so the stored pixel dimensions
 * are the wrong way round for anything the user will see. A screenshot check
 * that compares against the screen's resolution gets the wrong answer without
 * this, and so does the aspect-ratio grouping.
 */
function appliesQuarterTurn(orientation) {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Read EXIF from a JPEG head, given the segments already walked.
 * Returns null when the file simply has none, which is itself a signal.
 */
function fromJpeg(buf, segments) {
  const segment = findExifSegment(buf, segments);
  if (!segment) return null;
  return readTiff(buf, segment.at);
}

/** Read EXIF from a TIFF or camera raw file, where the header is the file. */
function fromTiff(buf) {
  return readTiff(buf, 0);
}

module.exports = {
  fromJpeg,
  fromTiff,
  readTiff,
  findExifSegment,
  parseExifDate,
  appliesQuarterTurn,
  joinCamera,
  TAG,
};
