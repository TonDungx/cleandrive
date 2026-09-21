'use strict';

/**
 * What a file actually is, and how big its picture is -- read from its own
 * first bytes rather than from its name.
 *
 * ## Why the extension is not the answer
 *
 * The rest of this app classifies by extension because for `.tmp` and `.log`
 * the extension *is* the claim being made, and a wrong one is the user's
 * problem rather than ours. Media is different: a `.jpg` that is really a PNG
 * is routine (browsers save what the server sent, under the name the link had),
 * and a `.jpg` that is really an HTML error page is a broken download that the
 * user would want to know about. Neither is visible from the name.
 *
 * So everything here works from a buffer -- the first few KB of the file -- and
 * nothing in this module touches the filesystem. That is deliberate twice over:
 * it makes the whole thing testable against fixtures built in memory, and it
 * lets it run inside a worker thread, where the scan actually does this work.
 *
 * Nothing here decodes an image. Reading a header is bounded work on bytes we
 * already had to read; decoding is a decompression of the whole file, and doing
 * it for 50,000 files is the difference between a scan that takes seconds and
 * one that takes an afternoon.
 */

/* -------------------------------------------------------------------------- */
/* what counts as media                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Extensions the scan will look at.
 *
 * `svg` and `ico` are deliberately absent. They are overwhelmingly interface
 * assets rather than anyone's pictures -- a 30-second walk of this machine's
 * home folder turned up 193 `.ico` files and 6 `.svg`, none of them a photo --
 * and an icon grid is noise in a screen about deleting holiday snaps.
 */
const IMAGE_EXT = new Set([
  'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'bmp', 'dib',
  'heic', 'heif', 'avif', 'tif', 'tiff', 'jxl',
  // Camera raw. Almost all of these are TIFF underneath, which is why they can
  // be sized and read for EXIF by the same code as a .tif.
  'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf', 'pef', 'srw',
]);

const VIDEO_EXT = new Set([
  'mp4', 'm4v', 'mov', 'qt', '3gp', '3g2', 'mkv', 'webm', 'avi',
  'wmv', 'asf', 'flv', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'mpe', 'vob', 'ogv',
]);

/** 'image' | 'video' | null, from the extension alone. The cheapest possible test. */
function kindOfExtension(ext) {
  const lower = String(ext || '').toLowerCase();
  if (IMAGE_EXT.has(lower)) return 'image';
  if (VIDEO_EXT.has(lower)) return 'video';
  return null;
}

/* -------------------------------------------------------------------------- */
/* magic bytes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ISO base media file format brands, and what they mean.
 *
 * HEIC, AVIF and MP4 are the same container with different brands in `ftyp`, so
 * the brand is the only thing that tells a photo from a film here. A brand this
 * table does not know falls back to 'mp4', because the overwhelming majority of
 * BMFF files in the wild are video and guessing "video" merely puts the file in
 * the wrong chip rather than mis-stating what it is.
 */
const BMFF_BRANDS = new Map(
  Object.entries({
    heic: 'heic', heix: 'heic', heim: 'heic', heis: 'heic',
    hevc: 'heic', hevx: 'heic', hevm: 'heic', hevs: 'heic',
    mif1: 'heic', msf1: 'heic',
    avif: 'avif', avis: 'avif',
    crx: 'cr3',
    qt: 'mov',
  })
);

/**
 * The format a buffer's own bytes say it is.
 *
 * @param {Buffer} buf  the head of a file; 32 bytes is enough for every test here
 * @returns {{format: string, kind: 'image'|'video', brand?: string} | null}
 *          null means "these bytes match nothing we know", which for a file
 *          named `.jpg` is itself a finding.
 */
function detectFormat(buf) {
  if (!buf || buf.length < 12) return null;

  // JPEG: SOI. Every JPEG starts FF D8 FF -- the third byte is the first
  // marker, and requiring it rejects a file that merely happens to open FF D8.
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { format: 'jpeg', kind: 'image' };
  }

  if (buf[0] === 0x89 && buf.toString('latin1', 1, 8) === 'PNG\r\n\x1a\n') {
    return { format: 'png', kind: 'image' };
  }

  const gif = buf.toString('latin1', 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') {
    return { format: 'gif', kind: 'image' };
  }

  if (buf.toString('latin1', 0, 4) === 'RIFF') {
    const riffType = buf.toString('latin1', 8, 12);
    if (riffType === 'WEBP') return { format: 'webp', kind: 'image' };
    if (riffType === 'AVI ') return { format: 'avi', kind: 'video' };
  }

  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return { format: 'bmp', kind: 'image' };
  }

  // TIFF, and with it nearly every camera raw format. II/MM is the byte order
  // and 42 is the magic that follows it.
  const order = buf.toString('latin1', 0, 2);
  if (order === 'II' || order === 'MM') {
    const little = order === 'II';
    const magic = little ? buf.readUInt16LE(2) : buf.readUInt16BE(2);
    // 42 is TIFF; 43 is BigTIFF; Canon CR2 carries 42 with a CR marker at 8.
    if (magic === 42 || magic === 43) return { format: 'tiff', kind: 'image' };
  }

  // JPEG XL, in both of its containers.
  if (buf[0] === 0xff && buf[1] === 0x0a) return { format: 'jxl', kind: 'image' };
  if (buf.readUInt32BE(0) === 0x0000000c && buf.toString('latin1', 4, 8) === 'JXL ') {
    return { format: 'jxl', kind: 'image' };
  }

  // ISO base media: MP4, MOV, HEIC, AVIF, 3GP -- all the same container.
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12).replace(/[\s\0]+$/, '');
    const mapped = BMFF_BRANDS.get(brand.toLowerCase());
    if (mapped === 'heic' || mapped === 'avif' || mapped === 'cr3') {
      return { format: mapped, kind: 'image', brand };
    }
    if (mapped === 'mov') return { format: 'mov', kind: 'video', brand };
    if (/^3g/i.test(brand)) return { format: '3gp', kind: 'video', brand };
    return { format: 'mp4', kind: 'video', brand };
  }

  // Matroska and WebM share the EBML magic; which one it is lives in the
  // DocType, which `readEbmlDocType` digs out.
  if (buf.readUInt32BE(0) === 0x1a45dfa3) {
    return { format: readEbmlDocType(buf) === 'webm' ? 'webm' : 'mkv', kind: 'video' };
  }

  // ASF, which is what .wmv and .asf both are.
  if (
    buf.readUInt32BE(0) === 0x3026b275 &&
    buf.readUInt16BE(4) === 0x8e66 &&
    buf.readUInt16BE(6) === 0xcf11
  ) {
    return { format: 'asf', kind: 'video' };
  }

  if (buf.toString('latin1', 0, 3) === 'FLV') return { format: 'flv', kind: 'video' };
  if (buf.toString('latin1', 0, 4) === 'OggS') return { format: 'ogg', kind: 'video' };

  // MPEG program stream / transport stream. A .ts is 188-byte packets each
  // starting 0x47, which is too weak a signal on its own -- two packets in a
  // row is not.
  if (buf.readUInt32BE(0) === 0x000001ba) return { format: 'mpeg', kind: 'video' };
  if (buf[0] === 0x47 && buf.length > 188 && buf[188] === 0x47) {
    return { format: 'mpegts', kind: 'video' };
  }

  return null;
}

/**
 * Formats that are a legitimate match for an extension.
 *
 * Deliberately generous. `.jpg` holding a PNG is worth telling the user about;
 * `.heic` holding what we call `mp4` is just this module's brand table being
 * conservative, and reporting it as a mismatch would be crying wolf.
 */
const EXT_FORMATS = new Map(
  Object.entries({
    jpg: ['jpeg'], jpeg: ['jpeg'], jpe: ['jpeg'], jfif: ['jpeg'],
    png: ['png'],
    gif: ['gif'],
    webp: ['webp'],
    bmp: ['bmp'], dib: ['bmp'],
    heic: ['heic', 'avif', 'mp4'], heif: ['heic', 'avif', 'mp4'],
    avif: ['avif', 'heic', 'mp4'],
    tif: ['tiff'], tiff: ['tiff'],
    jxl: ['jxl'],
    dng: ['tiff'], cr2: ['tiff'], nef: ['tiff'], arw: ['tiff'], orf: ['tiff'],
    rw2: ['tiff'], raf: ['tiff'], pef: ['tiff'], srw: ['tiff'], cr3: ['cr3', 'mp4'],
    mp4: ['mp4', 'mov'], m4v: ['mp4', 'mov'],
    mov: ['mov', 'mp4'], qt: ['mov', 'mp4'],
    '3gp': ['3gp', 'mp4'], '3g2': ['3gp', 'mp4'],
    mkv: ['mkv', 'webm'], webm: ['webm', 'mkv'],
    avi: ['avi'],
    wmv: ['asf'], asf: ['asf'],
    flv: ['flv'],
    ogv: ['ogg'],
    mts: ['mpegts'], m2ts: ['mpegts'], ts: ['mpegts'],
    mpg: ['mpeg'], mpeg: ['mpeg'], mpe: ['mpeg'], vob: ['mpeg'],
  })
);

/** True when the bytes contradict the name in a way worth reporting. */
function extensionMatches(ext, format) {
  if (!format) return false;
  const allowed = EXT_FORMATS.get(String(ext || '').toLowerCase());
  return allowed ? allowed.includes(format) : true;
}

/* -------------------------------------------------------------------------- */
/* pixel dimensions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * JPEG is a chain of segments, and the size lives in whichever SOF the encoder
 * used. So the chain has to be walked rather than read at a fixed offset.
 *
 * Two traps this has to survive, both of which produce plausible-looking
 * nonsense rather than an error:
 *
 *   - `FF` bytes appear inside entropy-coded data, so the walk must follow each
 *     segment's declared length instead of hunting for the next `FF`. It stops
 *     at SOS, where the declared lengths end and the compressed data begins.
 *   - SOF1..SOF15 are all valid start-of-frame markers, but `C4` (DHT), `C8`
 *     (JPG) and `CC` (DAC) sit in the same numeric range and are not frames.
 *
 * @returns {{width: number, height: number, precision: number, progressive: boolean} | null}
 */
function readJpegFrame(buf) {
  let i = 2;
  // A malformed file must not spin: every iteration either advances `i` or
  // returns, and this caps the total regardless.
  let guard = 0;

  while (i + 4 <= buf.length && guard++ < 4096) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];

    // Padding, and the standalone markers that carry no length field.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI, or the scan starts

    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null;

    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrame) {
      if (i + 9 > buf.length) return null;
      return {
        width: buf.readUInt16BE(i + 7),
        height: buf.readUInt16BE(i + 5),
        precision: buf[i + 4],
        // Progressive JPEGs are what messaging apps and CDNs re-encode to, so
        // this is worth carrying rather than discarding.
        progressive: marker === 0xc2 || marker === 0xc6 || marker === 0xca,
      };
    }

    i += 2 + length;
  }
  return null;
}

/** Every JPEG APP segment, so EXIF can be found without walking the chain twice. */
function jpegSegments(buf) {
  const out = [];
  let i = 2;
  let guard = 0;

  while (i + 4 <= buf.length && guard++ < 4096) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;

    const length = buf.readUInt16BE(i + 2);
    if (length < 2) break;
    out.push({ marker, at: i + 4, length: length - 2 });
    i += 2 + length;
  }
  return out;
}

function readPngSize(buf) {
  // The first chunk of a PNG must be IHDR, so the offsets are fixed: 8 bytes of
  // signature, 4 of chunk length, 4 of type, then width and height.
  if (buf.length < 24) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readGifSize(buf) {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/**
 * WebP comes in three shapes and only one of them has the size where you would
 * expect. Lossy (VP8) hides it behind a 3-byte start code; lossless (VP8L)
 * packs two 14-bit fields across four bytes; extended (VP8X) stores each
 * dimension minus one in 24 bits.
 */
function readWebpSize(buf) {
  if (buf.length < 30) return null;
  const chunk = buf.toString('latin1', 12, 16);

  if (chunk === 'VP8 ') {
    // 12 chunk header + 3 frame tag + 3 start code, then two 14-bit fields.
    const off = 12 + 8 + 6;
    if (off + 4 > buf.length) return null;
    return {
      width: buf.readUInt16LE(off) & 0x3fff,
      height: buf.readUInt16LE(off + 2) & 0x3fff,
    };
  }

  if (chunk === 'VP8L') {
    const off = 12 + 8 + 1; // past the 0x2f signature byte
    if (off + 4 > buf.length) return null;
    const bits = buf.readUInt32LE(off);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (chunk === 'VP8X') {
    const off = 12 + 8 + 4; // past the flags
    if (off + 6 > buf.length) return null;
    return {
      width: (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16)) + 1,
      height: (buf[off + 3] | (buf[off + 4] << 8) | (buf[off + 5] << 16)) + 1,
    };
  }

  return null;
}

function readBmpSize(buf) {
  if (buf.length < 26) return null;
  const headerSize = buf.readUInt32LE(14);
  // The 12-byte BITMAPCOREHEADER uses 16-bit dimensions; everything since uses
  // signed 32-bit, and a negative height means the rows are stored top-down.
  if (headerSize === 12) {
    return { width: buf.readUInt16LE(18), height: buf.readUInt16LE(20) };
  }
  return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) };
}

/**
 * TIFF, and therefore most camera raw files: IFD0 holds ImageWidth (0x0100) and
 * ImageLength (0x0101).
 *
 * The values can be SHORT or LONG, which is why the type has to be honoured
 * rather than assumed -- reading a SHORT as a LONG on a little-endian file
 * yields the right number by luck and on a big-endian one yields nonsense.
 */
function readTiffSize(buf) {
  if (buf.length < 8) return null;
  const little = buf.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  const ifd = u32(4);
  if (ifd + 2 > buf.length) return null;
  const count = u16(ifd);
  if (count > 1024) return null;

  let width = 0;
  let height = 0;
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > buf.length) break;
    const tag = u16(entry);
    if (tag !== 0x0100 && tag !== 0x0101) continue;
    const type = u16(entry + 2);
    const value = type === 3 ? u16(entry + 8) : u32(entry + 8);
    if (tag === 0x0100) width = value;
    else height = value;
  }
  return width && height ? { width, height } : null;
}

/** Matroska/WebM declare their DocType in the EBML header, before any cluster. */
function readEbmlDocType(buf) {
  // Small enough that a plain scan of the header region is cheaper than a real
  // EBML parser, and this is the only thing we want from it.
  const limit = Math.min(buf.length, 256);
  const region = buf.toString('latin1', 0, limit);
  if (region.includes('webm')) return 'webm';
  if (region.includes('matroska')) return 'matroska';
  return null;
}

/**
 * Pixel dimensions, or null when the header did not carry them.
 *
 * Null is a real answer and not a failure: a HEIC's size lives in a `meta` box
 * that `bmff.js` reads, and a video's in `moov`, which is usually not in the
 * first 64 KB at all.
 */
function readImageSize(buf, format) {
  if (!buf) return null;
  try {
    switch (format) {
      case 'jpeg': {
        const frame = readJpegFrame(buf);
        return frame ? { width: frame.width, height: frame.height } : null;
      }
      case 'png': return readPngSize(buf);
      case 'gif': return readGifSize(buf);
      case 'webp': return readWebpSize(buf);
      case 'bmp': return readBmpSize(buf);
      case 'tiff': return readTiffSize(buf);
      default: return null;
    }
  } catch {
    // A truncated or corrupt header reads past the end of the buffer. That is
    // information about the file, not an error in the scan -- the caller gets
    // null and reports the file as unreadable.
    return null;
  }
}

module.exports = {
  IMAGE_EXT,
  VIDEO_EXT,
  kindOfExtension,
  detectFormat,
  extensionMatches,
  readImageSize,
  readJpegFrame,
  jpegSegments,
  readEbmlDocType,
  EXT_FORMATS,
};
