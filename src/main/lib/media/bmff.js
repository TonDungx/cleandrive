'use strict';

/**
 * The ISO base media file format: MP4, MOV, 3GP, and also HEIC and AVIF.
 *
 * ## The finding that shaped this file
 *
 * The plan for this subsystem assumed a video's `moov` box -- which is where
 * the duration, the resolution and the device name live -- would be inside the
 * first 64 KB, along with everything else read in the cheap first pass. It is
 * not. Measured against every MP4 on the development machine: **eleven of
 * eleven** are laid out `ftyp, [uuid], mdat, … moov`, with the metadata after
 * the media data. That is what a recorder writes when it cannot know the final
 * duration until it stops, so it is the normal case rather than an oddity;
 * files with `moov` first have usually been through a "web optimise" pass.
 *
 * Reading the head therefore finds nothing at all, and reading the *tail* is
 * only a guess about how big `moov` is. What works is neither: the top-level
 * boxes form a linked list, each header declaring its own length, so the file
 * can be hopped header to header until `moov` turns up. Each hop is a 16-byte
 * read. Measured over the same files: three to four hops each, and 480 videos
 * per second single-threaded.
 *
 * ## No I/O here
 *
 * `locateMoov` takes a `read(offset, length)` function rather than a path, so
 * this module never opens a file. That keeps it runnable inside a worker, and
 * it lets the tests drive it from a Buffer without writing anything to disk.
 */

/**
 * Seconds between the BMFF epoch (1904-01-01) and the Unix epoch.
 *
 * Getting this wrong does not throw -- it produces a creation date 66 years out,
 * which looks like a plausible timestamp and would quietly file every video
 * under the wrong year.
 */
const EPOCH_OFFSET_SEC = 2082844800;

/** Boxes that hold other boxes. Anything else is a leaf and is not descended into. */
const CONTAINERS = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'ilst', 'moof', 'traf',
  'mvex', 'dinf', 'stsd', 'iprp', 'ipco', 'iref', 'dref',
]);

/** Containers that carry a 4-byte version/flags field before their children. */
const FULL_CONTAINERS = new Set(['meta']);

/** A box header is 8 bytes, or 16 when the size field escapes to 64-bit. */
const MIN_HEADER = 8;

/**
 * What a box type may look like.
 *
 * Four printable ASCII characters -- plus `\xa9`, which is the copyright sign
 * QuickTime puts in front of every one of its metadata tags (`©mak`, `©mod`,
 * `©swr`). Leaving it out of this set does not merely skip those tags: the walk
 * treats the first one as the end of the box structure and stops, so a video
 * with a device name loses everything after it.
 */
const BOX_TYPE = /^[\x20-\x7e\xa9]{4}$/;

/**
 * The boxes at one level of a buffer.
 *
 * @param {Buffer} buf
 * @param {number} [limit]  stop after this many boxes; a corrupt length field
 *                          would otherwise be followed in a tight loop
 * @returns {Array<{type: string, at: number, size: number, header: number, body: number, end: number}>}
 */
function boxes(buf, limit = 256) {
  const out = [];
  if (!buf) return out;
  let i = 0;

  while (i + MIN_HEADER <= buf.length && out.length < limit) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);

    // Anything that is not a box type means the walk has wandered out of the
    // box structure -- into media data, or into a file that is not really BMFF
    // -- and continuing would produce invented boxes.
    if (!BOX_TYPE.test(type)) break;

    let header = MIN_HEADER;
    if (size === 1) {
      if (i + 16 > buf.length) break;
      const large = buf.readBigUInt64BE(i + 8);
      // Beyond 2^53 a JS number stops being exact, and no real box is that big.
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      // Size 0 means "to the end of the file", which for the last box is legal.
      size = buf.length - i;
    }

    if (size < header) break;

    const end = Math.min(i + size, buf.length);
    out.push({ type, at: i, size, header, body: i + header, end });
    i += size;
  }

  return out;
}

/** The body of a box, as a subarray. Never copies. */
function bodyOf(buf, box) {
  return buf.subarray(box.body, box.end);
}

/**
 * Find a box by a path of types, descending through containers.
 * `find(buf, ['moov', 'udta', 'meta'])`.
 */
function find(buf, pathTypes) {
  let current = buf;
  for (const wanted of pathTypes) {
    const box = boxes(current).find((b) => b.type === wanted);
    if (!box) return null;
    let body = bodyOf(current, box);
    if (FULL_CONTAINERS.has(wanted)) body = skipVersionFlags(body);
    current = body;
  }
  return current;
}

/**
 * `meta` is a FullBox in ISO BMFF and a plain box in QuickTime, and both turn
 * up in files with a `.mov` extension. Rather than branch on the brand -- which
 * is wrong for files that carry a QuickTime layout under an MP4 brand -- look
 * at what follows: if skipping four bytes reveals a box header, skip them.
 */
function skipVersionFlags(body) {
  if (body.length < 12) return body;
  const asFull = body.subarray(4);
  if (looksLikeBoxHeader(asFull)) return asFull;
  if (looksLikeBoxHeader(body)) return body;
  return asFull;
}

function looksLikeBoxHeader(buf) {
  if (buf.length < MIN_HEADER) return false;
  const size = buf.readUInt32BE(0);
  const type = buf.toString('latin1', 4, 8);
  return BOX_TYPE.test(type) && (size === 0 || size === 1 || size >= MIN_HEADER);
}

/* -------------------------------------------------------------------------- */
/* moov                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything worth knowing from a `moov` body.
 *
 * @param {Buffer} moovBody  the contents of the moov box, header already stripped
 * @returns {{durationSec: number|null, width: number, height: number,
 *            createdAt: number|null, tracks: number, hasVideo: boolean,
 *            hasAudio: boolean, tags: object}}
 */
function parseMoov(moovBody) {
  const out = {
    durationSec: null,
    width: 0,
    height: 0,
    createdAt: null,
    tracks: 0,
    hasVideo: false,
    hasAudio: false,
    tags: {},
  };
  if (!moovBody) return out;

  for (const box of boxes(moovBody)) {
    const body = bodyOf(moovBody, box);

    if (box.type === 'mvhd') {
      readMvhd(body, out);
    } else if (box.type === 'trak') {
      out.tracks += 1;
      readTrak(body, out);
    } else if (box.type === 'udta') {
      readUdta(body, out.tags);
    }
  }

  return out;
}

/**
 * Movie header: the timescale and the duration, in that order, at an offset
 * that depends on the version because v1 widened the timestamps to 64 bits.
 */
function readMvhd(body, out) {
  if (body.length < 4) return;
  const version = body[0];

  if (version === 1) {
    if (body.length < 32) return;
    out.createdAt = bmffTime(Number(body.readBigUInt64BE(4)));
    const timescale = body.readUInt32BE(20);
    const duration = Number(body.readBigUInt64BE(24));
    if (timescale > 0) out.durationSec = duration / timescale;
  } else {
    if (body.length < 20) return;
    out.createdAt = bmffTime(body.readUInt32BE(4));
    const timescale = body.readUInt32BE(12);
    const duration = body.readUInt32BE(16);
    // 0xffffffff is the documented "unknown duration" sentinel for fragmented
    // files; treated as a number it reads as 136 years.
    if (timescale > 0 && duration !== 0xffffffff) out.durationSec = duration / timescale;
  }
}

/**
 * One track. The display size is on `tkhd`; what kind of track it is comes from
 * the `hdlr` inside `mdia`, which is the only way to tell a video track from
 * album art -- a music file with a cover picture has two tracks and only one of
 * them has a duration worth reporting.
 */
function readTrak(trakBody, out) {
  for (const box of boxes(trakBody)) {
    const body = bodyOf(trakBody, box);

    if (box.type === 'tkhd') {
      readTkhd(body, out);
    } else if (box.type === 'mdia') {
      for (const inner of boxes(body)) {
        if (inner.type !== 'hdlr') continue;
        const hdlr = bodyOf(body, inner);
        // version+flags(4), pre_defined(4), then the four-character type.
        if (hdlr.length < 12) continue;
        const handler = hdlr.toString('latin1', 8, 12);
        if (handler === 'vide') out.hasVideo = true;
        if (handler === 'soun') out.hasAudio = true;
      }
    }
  }
}

/**
 * Track header, and the one field in this file that has already been got wrong.
 *
 * After version+flags the box holds timestamps, then a reserved block, then a
 * 3x3 transform matrix of nine 32-bit cells, and only then width and height as
 * 16.16 fixed point. Reading four bytes early lands on the matrix's last cell,
 * which is 0x40000000 -- so every video measured 16384 pixels wide, on every
 * file, consistently enough to look like a real answer.
 */
function readTkhd(body, out) {
  if (body.length < 4) return;
  const version = body[0];

  //            version+flags  timestamps          reserved/layer/volume  matrix
  const offset = version === 1 ? 4 + 32 + 16 + 36 : 4 + 20 + 16 + 36;
  if (body.length < offset + 8) return;

  const width = Math.round(body.readUInt32BE(offset) / 65536);
  const height = Math.round(body.readUInt32BE(offset + 4) / 65536);

  // Audio and subtitle tracks carry 0x0; the largest visual track is the one
  // the user would call "the resolution".
  if (width > 0 && height > 0 && width * height > out.width * out.height) {
    out.width = width;
    out.height = height;
  }
}

/**
 * Device and software tags.
 *
 * These are the strongest evidence of where a video came from that costs
 * nothing extra: an iPhone writes `©mak`/`©mod`, a screen recorder usually
 * writes nothing at all, and that absence is itself part of the reasoning the
 * UI shows.
 */
const UDTA_TAGS = new Map(
  Object.entries({
    '©mak': 'make',
    '©mod': 'model',
    '©swr': 'software',
    '©too': 'encoder',
    '©nam': 'title',
    '©xyz': 'location',
  })
);

/**
 * Tags whose presence is recorded but whose value is thrown away.
 *
 * `©xyz` is an ISO 6709 position, and a phone writes it into every video it
 * takes. `exif.js` already refuses to carry GPS coordinates out of a photo --
 * this app has no reason to know where anything was filmed, and a scan result
 * holding coordinates would be one "export" away from being a location history
 * -- so the same rule has to apply here. It did not, at first: a verification
 * run against this machine's own files printed the author's home coordinates to
 * six decimal places, which is how this came to be written down.
 */
const REDACTED_TAGS = new Set(['location']);

function readUdta(udtaBody, into) {
  for (const box of boxes(udtaBody)) {
    const body = bodyOf(udtaBody, box);

    if (box.type === 'meta') {
      const children = skipVersionFlags(body);
      for (const inner of boxes(children)) {
        if (inner.type === 'ilst') readIlst(bodyOf(children, inner), into);
      }
      continue;
    }

    const name = UDTA_TAGS.get(box.type);
    if (!name) continue;
    // A QuickTime udta string is a 2-byte length and a 2-byte language code
    // before the text; the length check keeps a binary blob out of the field.
    const text = cleanText(body.length > 4 ? body.subarray(4) : body);
    if (text) store(into, name, text);
  }
}

/** Keep the fact, drop the value, for anything in REDACTED_TAGS. */
function store(into, name, text) {
  if (REDACTED_TAGS.has(name)) {
    into.hasLocation = true;
    return;
  }
  into[name] = text;
}

/** iTunes-style metadata: each entry is a type box wrapping a `data` box. */
function readIlst(ilstBody, into) {
  for (const entry of boxes(ilstBody)) {
    const name = UDTA_TAGS.get(entry.type);
    if (!name) continue;
    for (const inner of boxes(bodyOf(ilstBody, entry))) {
      if (inner.type !== 'data') continue;
      // version/flags(4) then a reserved locale(4), then the value.
      const value = bodyOf(bodyOf(ilstBody, entry), inner);
      const text = cleanText(value.length > 8 ? value.subarray(8) : value);
      if (text) store(into, name, text);
    }
  }
}

/**
 * Tag values are not always text, and a control-character soup rendered into
 * the detail panel would look like the app had corrupted something. Anything
 * that does not come back as a short readable string is discarded.
 */
function cleanText(buf) {
  if (!buf || buf.length === 0) return null;
  const text = buf.toString('utf8', 0, Math.min(buf.length, 128)).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text.length > 0 && text.length <= 80 ? text : null;
}

/** BMFF counts seconds from 1904; 0 means "not set" rather than that date. */
function bmffTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const at = (seconds - EPOCH_OFFSET_SEC) * 1000;
  // Before 1990 or after 2100 the clock was wrong, not the file old.
  return at > 631152000000 && at < 4102444800000 ? at : null;
}

/* -------------------------------------------------------------------------- */
/* HEIC and AVIF: the picture's size lives in `meta`                            */
/* -------------------------------------------------------------------------- */

/**
 * A still image in a BMFF container states its size in an `ispe` property
 * inside `meta/iprp/ipco`, not in a `moov` -- there is no movie.
 *
 * A HEIC holding a burst has several `ispe` entries, one per image plus one per
 * thumbnail. The largest is the one the user thinks of as the photo; taking the
 * first would report the thumbnail's size for about half of them.
 */
function parseIspe(buf) {
  const ipco = find(buf, ['meta', 'iprp', 'ipco']);
  if (!ipco) return null;

  let best = null;
  for (const box of boxes(ipco)) {
    if (box.type !== 'ispe') continue;
    const body = bodyOf(ipco, box);
    if (body.length < 12) continue;
    const width = body.readUInt32BE(4);
    const height = body.readUInt32BE(8);
    if (width > 0 && height > 0 && (!best || width * height > best.width * best.height)) {
      best = { width, height };
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* finding moov without reading the file                                       */
/* -------------------------------------------------------------------------- */

const MAX_HOPS = 64;
/** Beyond this a `moov` is not metadata, and reading it would cost real memory. */
const MAX_MOOV_BYTES = 8 * 1024 * 1024;

/**
 * Walk the top-level box chain until `moov` turns up, then read it.
 *
 * @param {(offset: number, length: number) => Promise<Buffer>} read
 * @param {number} fileSize
 * @param {Buffer} [head]  bytes already read from the front, to save a syscall
 * @returns {Promise<{moov: Buffer, hops: number, at: number} | null>}
 */
async function locateMoov(read, fileSize, head = null) {
  let offset = 0;
  let hops = 0;

  while (offset >= 0 && offset < fileSize && hops < MAX_HOPS) {
    hops += 1;

    // The head we already have covers the first boxes for free; after that each
    // hop is a 16-byte read, which is one seek rather than one scan.
    let header;
    if (head && offset + 16 <= head.length) {
      header = head.subarray(offset, offset + 16);
    } else {
      header = await read(offset, 16);
      if (!header || header.length < MIN_HEADER) return null;
    }

    let size = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    if (!BOX_TYPE.test(type)) return null;

    let headerBytes = MIN_HEADER;
    if (size === 1) {
      if (header.length < 16) return null;
      const large = header.readBigUInt64BE(8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      headerBytes = 16;
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < headerBytes) return null;

    if (type === 'moov') {
      const at = offset + headerBytes;
      const length = Math.min(size - headerBytes, MAX_MOOV_BYTES);

      // A file that has been through a "web optimise" pass carries moov at the
      // front, so the head already holds all of it. Reading it again would be
      // a second syscall for bytes in hand -- and on a dehydrated cloud
      // placeholder, a second reason for the OS to fetch the file.
      if (head && at + length <= head.length) {
        return { moov: head.subarray(at, at + length), hops, at: offset, fromHead: true };
      }

      const moov = await read(at, length);
      return moov && moov.length > 0 ? { moov, hops, at: offset, fromHead: false } : null;
    }

    offset += size;
  }

  return null;
}

module.exports = {
  boxes,
  bodyOf,
  find,
  parseMoov,
  parseIspe,
  locateMoov,
  bmffTime,
  skipVersionFlags,
  EPOCH_OFFSET_SEC,
  MAX_MOOV_BYTES,
};
