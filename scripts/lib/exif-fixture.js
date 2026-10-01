'use strict';

/**
 * JPEGs with real EXIF in them, for the harnesses that need one.
 *
 * `test-media-format.js` has had its own EXIF writer since the photo subsystem
 * was built, and it is the right shape for what it does: one block at a time,
 * poked at tag by tag, to prove the reader survives odd input. E4 needs
 * something different -- whole files, with a capture date and sometimes a
 * position, enough of them to fill a timeline and a map -- and two harnesses
 * plus a screenshot script need the same thing. So it lives here rather than
 * being copied three times and drifting.
 *
 * The one piece neither existing writer had: a **RATIONAL with three
 * components**. A latitude is degrees, minutes and seconds, and a writer that
 * emits one rational produces a file whose position reads as the degrees
 * alone -- which would make a map test pass while pointing at the wrong place.
 */

const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

/** EXIF's own date format. Local time, no zone -- which is what cameras write. */
function exifDate(when) {
  const d = when instanceof Date ? when : new Date(when);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Decimal degrees as the three rationals EXIF stores, and the hemisphere
 * letter that goes in the separate ref tag.
 */
function dms(value, positive, negative) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFull = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFull);
  const seconds = (minutesFull - minutes) * 60;
  return {
    ref: value < 0 ? negative : positive,
    // Seconds to four decimal places, which is far finer than any receiver.
    parts: [[degrees, 1], [minutes, 1], [Math.round(seconds * 10000), 10000]],
  };
}

/**
 * A TIFF block: IFD0, an Exif sub-IFD, and a GPS IFD.
 *
 * Values are written inline when they fit in the four bytes an entry has for
 * them and pooled after the directories when they do not, which is what the
 * format requires and what makes the offsets worth laying out first.
 */
function tiff({ ifd0 = {}, exif = {}, gps = {} }) {
  const overflow = [];
  const ifdBytes = (count) => 2 + count * 12 + 4;

  const ifd0Entries = Object.entries(ifd0).map(([tag, value]) => ({ tag: Number(tag), value }));
  const exifEntries = Object.entries(exif).map(([tag, value]) => ({ tag: Number(tag), value }));
  const gpsEntries = Object.entries(gps).map(([tag, value]) => ({ tag: Number(tag), value }));

  const ifd0Count = ifd0Entries.length + (exifEntries.length ? 1 : 0) + (gpsEntries.length ? 1 : 0);
  const ifd0At = 8;
  const exifAt = ifd0At + ifdBytes(ifd0Count);
  const gpsAt = exifAt + (exifEntries.length ? ifdBytes(exifEntries.length) : 0);
  const overflowBase = gpsAt + (gpsEntries.length ? ifdBytes(gpsEntries.length) : 0);

  const pool = (bytes) => {
    const at = overflowBase + overflow.reduce((n, b) => n + b.length, 0);
    overflow.push(bytes);
    return at;
  };

  const entry = (tag, value) => {
    if (typeof value === 'string') {
      const bytes = Buffer.from(`${value}\0`, 'latin1');
      if (bytes.length <= 4) {
        const inline = Buffer.alloc(4);
        bytes.copy(inline);
        return Buffer.concat([u16le(tag), u16le(2), u32le(bytes.length), inline]);
      }
      return Buffer.concat([u16le(tag), u16le(2), u32le(bytes.length), u32le(pool(bytes))]);
    }
    if (Array.isArray(value)) {
      // RATIONAL[n]: eight bytes each, never inline, because even one is too
      // big for the four bytes an entry carries.
      const bytes = Buffer.concat(value.map(([num, den]) => Buffer.concat([u32le(num), u32le(den)])));
      return Buffer.concat([u16le(tag), u16le(5), u32le(value.length), u32le(pool(bytes))]);
    }
    const inline = Buffer.alloc(4);
    inline.writeUInt16LE(value, 0);
    return Buffer.concat([u16le(tag), u16le(3), u32le(1), inline]);
  };

  const ifd0Body = ifd0Entries.map(({ tag, value }) => entry(tag, value));
  if (exifEntries.length) ifd0Body.push(Buffer.concat([u16le(0x8769), u16le(4), u32le(1), u32le(exifAt)]));
  if (gpsEntries.length) ifd0Body.push(Buffer.concat([u16le(0x8825), u16le(4), u32le(1), u32le(gpsAt)]));

  const exifBody = exifEntries.map(({ tag, value }) => entry(tag, value));
  const gpsBody = gpsEntries.map(({ tag, value }) => entry(tag, value));

  return Buffer.concat([
    Buffer.from('II', 'latin1'),
    u16le(42),
    u32le(ifd0At),
    u16le(ifd0Body.length), ...ifd0Body, u32le(0),
    ...(exifEntries.length ? [u16le(exifBody.length), ...exifBody, u32le(0)] : []),
    ...(gpsEntries.length ? [u16le(gpsBody.length), ...gpsBody, u32le(0)] : []),
    ...overflow,
  ]);
}

/**
 * A whole JPEG: APP1 with the EXIF block, a real SOF0 so the dimensions are
 * read from the header rather than guessed, and padding to whatever size the
 * caller wants the file to be.
 *
 * @param {object} options
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {number} [options.padTo]     total file size to pad out to
 * @param {string} [options.make]
 * @param {string} [options.model]
 * @param {Date|number} [options.takenAt]
 * @param {number} [options.lat]       decimal degrees, south negative
 * @param {number} [options.lon]       decimal degrees, west negative
 */
function jpegWithExif({
  width = 4032,
  height = 3024,
  padTo = 0,
  make = null,
  model = null,
  takenAt = null,
  lat = null,
  lon = null,
} = {}) {
  const ifd0 = {};
  const exif = {};
  const gps = {};

  if (make) ifd0[0x010f] = make;
  if (model) ifd0[0x0110] = model;
  if (takenAt) {
    ifd0[0x0132] = exifDate(takenAt);
    exif[0x9003] = exifDate(takenAt);
  }
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const la = dms(lat, 'N', 'S');
    const lo = dms(lon, 'E', 'W');
    gps[0x0001] = la.ref;
    gps[0x0002] = la.parts;
    gps[0x0003] = lo.ref;
    gps[0x0004] = lo.parts;
  }

  const segments = [Buffer.from([0xff, 0xd8])];

  if (Object.keys(ifd0).length || Object.keys(exif).length || Object.keys(gps).length) {
    const block = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff({ ifd0, exif, gps })]);
    segments.push(Buffer.from([0xff, 0xe1]), u16be(block.length + 2), block);
  }

  // SOF0: precision, height, width, three components.
  const sof = Buffer.concat([
    Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3]),
    Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  ]);
  segments.push(Buffer.from([0xff, 0xc0]), u16be(sof.length + 2), sof);

  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  segments.push(Buffer.from([0xff, 0xda]), u16be(sos.length + 2), sos);

  const head = Buffer.concat(segments);
  const tail = Buffer.from([0xff, 0xd9]);
  const padding = Math.max(0, padTo - head.length - tail.length);
  // 0x7f rather than 0x00: a run of zeroes is what several "is this file
  // empty" checks look for, and this is meant to read as a real file.
  return Buffer.concat([head, Buffer.alloc(padding, 0x7f), tail]);
}

module.exports = { jpegWithExif, tiff, exifDate, dms };
