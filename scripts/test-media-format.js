#!/usr/bin/env node
'use strict';

// The media header parsers, against files this script builds itself.
//
//   node scripts/test-media-format.js
//
// ## Why the fixtures are generated rather than committed
//
// The repository holds no binary assets -- the icon and the tray gauge are both
// drawn in code -- and a photo checked in as a test fixture would be the first
// exception, carrying somebody's camera serial number and possibly their
// location into the git history forever. Every file here is assembled byte by
// byte in memory, which has a second benefit worth more than the first: a
// fixture that is written out by hand states exactly what it contains, so a
// test that fails says which byte was misread rather than "this photo did not
// work".
//
// The one thing generated fixtures cannot prove is that real files look like
// this. That is what the measurements in the plan were for, and the layouts
// below -- particularly `moov` after `mdat` -- are copied from what was
// actually found on disk rather than from what the specification permits.

const format = require('../src/main/lib/media/format');
const exif = require('../src/main/lib/media/exif');
const bmff = require('../src/main/lib/media/bmff');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

/* -------------------------------------------------------------------------- */
/* fixture builders                                                            */
/* -------------------------------------------------------------------------- */

/** A JPEG segment: FF, marker, big-endian length including the length itself. */
function segment(marker, body) {
  return Buffer.concat([Buffer.from([0xff, marker]), u16be(body.length + 2), body]);
}

/**
 * A JPEG, with whatever segments are asked for.
 *
 * `sofMarker` selects the frame type: 0xc0 is baseline, 0xc2 is progressive --
 * which matters because progressive is what a chat app or a CDN re-encodes to,
 * and the classifier uses it as one signal among several.
 */
function makeJpeg({ width, height, exifBlock = null, sofMarker = 0xc0, extraSegments = [] } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];

  // JFIF first, as almost every real encoder writes it -- so the EXIF search
  // has to walk past an APP0 rather than finding APP1 immediately.
  parts.push(segment(0xe0, Buffer.concat([Buffer.from('JFIF\0'), Buffer.from([1, 1, 0]), u16be(72), u16be(72), Buffer.from([0, 0])])));

  if (exifBlock) parts.push(segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), exifBlock])));
  for (const extra of extraSegments) parts.push(extra);

  // SOFn: precision, height, width, component count, then one triple each.
  parts.push(segment(sofMarker, Buffer.concat([
    Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3]),
    Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  ])));

  // A scan whose entropy data is full of FF bytes. A parser that hunts for the
  // next FF instead of following the declared lengths walks straight into this.
  parts.push(segment(0xda, Buffer.concat([Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11]), Buffer.from([0, 63, 0])])));
  parts.push(Buffer.from([0xff, 0xff, 0xd8, 0xff, 0x00, 0xff, 0xc0, 0x12, 0x34]));
  parts.push(Buffer.from([0xff, 0xd9]));

  return Buffer.concat(parts);
}

/**
 * A TIFF/EXIF block.
 *
 * Entries whose value does not fit in four bytes are written after the
 * directory and referenced by offset, exactly as a camera writes them -- which
 * is the case a parser gets wrong if it reads the offset field as a value.
 */
function makeExif({ little = true, tags = {}, gpsTags = null, exifTags: subTags = null } = {}) {
  const u16 = little ? u16le : u16be;
  const u32 = little ? u32le : u32be;

  // Lay the blocks out first so their offsets are known before anything is
  // written: header(8), IFD0, [ExifIFD], [GPS IFD], then the pooled values.
  const overflow = [];

  // 2 bytes of count, 12 per entry, 4 for the next-IFD pointer.
  const ifdBytes = (count) => 2 + count * 12 + 4;

  const encodeAscii = (text) => Buffer.from(`${text}\0`, 'latin1');

  const ifd0Tags = Object.entries(tags).map(([tag, value]) => ({ tag: Number(tag), value }));
  const subEntries = subTags ? Object.entries(subTags).map(([tag, value]) => ({ tag: Number(tag), value })) : [];
  const gpsEntries = gpsTags ? Object.entries(gpsTags).map(([tag, value]) => ({ tag: Number(tag), value })) : [];

  const ifd0Count = ifd0Tags.length + (subEntries.length ? 1 : 0) + (gpsEntries.length ? 1 : 0);
  const ifd0At = 8;
  const subAt = ifd0At + ifdBytes(ifd0Count);
  const gpsAt = subAt + (subEntries.length ? ifdBytes(subEntries.length) : 0);
  const overflowBase = gpsAt + (gpsEntries.length ? ifdBytes(gpsEntries.length) : 0);

  const writeEntry = (tag, value) => {
    if (typeof value === 'string') {
      const bytes = encodeAscii(value);
      if (bytes.length <= 4) {
        const inline = Buffer.alloc(4);
        bytes.copy(inline);
        return Buffer.concat([u16(tag), u16(2), u32(bytes.length), inline]);
      }
      const at = overflowBase + overflow.reduce((n, b) => n + b.length, 0);
      overflow.push(bytes);
      return Buffer.concat([u16(tag), u16(2), u32(bytes.length), u32(at)]);
    }
    if (Array.isArray(value)) {
      // A RATIONAL: two longs, always out of line.
      const bytes = Buffer.concat([u32(value[0]), u32(value[1])]);
      const at = overflowBase + overflow.reduce((n, b) => n + b.length, 0);
      overflow.push(bytes);
      return Buffer.concat([u16(tag), u16(5), u32(1), u32(at)]);
    }
    // A SHORT lives in the top two bytes of the value field on big-endian
    // files and the bottom two on little-endian ones, which is exactly what
    // writing it as a padded 4-byte field in the file's own order produces.
    const inline = Buffer.alloc(4);
    if (little) inline.writeUInt16LE(value, 0);
    else inline.writeUInt16BE(value, 0);
    return Buffer.concat([u16(tag), u16(3), u32(1), inline]);
  };

  const ifd0Body = [];
  for (const { tag, value } of ifd0Tags) ifd0Body.push(writeEntry(tag, value));
  if (subEntries.length) ifd0Body.push(Buffer.concat([u16(0x8769), u16(4), u32(1), u32(subAt)]));
  if (gpsEntries.length) ifd0Body.push(Buffer.concat([u16(0x8825), u16(4), u32(1), u32(gpsAt)]));

  const subBody = subEntries.map(({ tag, value }) => writeEntry(tag, value));
  const gpsBody = gpsEntries.map(({ tag, value }) => writeEntry(tag, value));

  return Buffer.concat([
    Buffer.from(little ? 'II' : 'MM', 'latin1'),
    u16(42),
    u32(ifd0At),
    u16(ifd0Body.length), ...ifd0Body, u32(0),
    ...(subEntries.length ? [u16(subBody.length), ...subBody, u32(0)] : []),
    ...(gpsEntries.length ? [u16(gpsBody.length), ...gpsBody, u32(0)] : []),
    ...overflow,
  ]);
}

function makePng(width, height) {
  return Buffer.concat([
    Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n', 'latin1'),
    u32be(13), Buffer.from('IHDR', 'latin1'),
    u32be(width), u32be(height),
    Buffer.from([8, 6, 0, 0, 0]), u32be(0),
  ]);
}

function makeGif(width, height) {
  return Buffer.concat([Buffer.from('GIF89a', 'latin1'), u16le(width), u16le(height), Buffer.from([0xf7, 0, 0])]);
}

function makeWebp(kind, width, height) {
  let chunk;
  if (kind === 'VP8 ') {
    chunk = Buffer.concat([
      Buffer.alloc(6), // frame tag + start code
      u16le(width & 0x3fff), u16le(height & 0x3fff),
      Buffer.alloc(8),
    ]);
  } else if (kind === 'VP8L') {
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    chunk = Buffer.concat([Buffer.from([0x2f]), u32le(bits >>> 0), Buffer.alloc(12)]);
  } else {
    const w = width - 1;
    const h = height - 1;
    chunk = Buffer.concat([
      u32le(0), // flags
      Buffer.from([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff]),
      Buffer.from([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]),
      Buffer.alloc(12),
    ]);
  }
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), Buffer.from(kind, 'latin1'), u32le(chunk.length), chunk]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), u32le(body.length), body]);
}

function makeBmp(width, height) {
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'latin1');
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  return header;
}

function makeTiff({ little = true, width, height }) {
  return makeExif({ little, tags: { 0x0100: width, 0x0101: height } });
}

/* ---- ISO base media ------------------------------------------------------ */

function box(type, ...bodies) {
  const body = Buffer.concat(bodies);
  return Buffer.concat([u32be(body.length + 8), Buffer.from(type, 'latin1'), body]);
}

/** A full box: version and flags before the contents. */
function fullBox(type, version, ...bodies) {
  return box(type, Buffer.from([version, 0, 0, 0]), ...bodies);
}

function makeMvhd({ timescale = 1000, durationSec = 12.5, createdAt = null, version = 0 } = {}) {
  const duration = Math.round(durationSec * timescale);
  const created = createdAt === null ? 0 : Math.round(createdAt / 1000) + bmff.EPOCH_OFFSET_SEC;
  const tail = Buffer.concat([
    u32be(0x00010000), u16be(0x0100), Buffer.alloc(10),
    Buffer.concat([u32be(0x00010000), u32be(0), u32be(0), u32be(0), u32be(0x00010000), u32be(0), u32be(0), u32be(0), u32be(0x40000000)]),
    Buffer.alloc(24), u32be(2),
  ]);

  if (version === 1) {
    const created64 = Buffer.alloc(8);
    created64.writeBigUInt64BE(BigInt(created));
    const duration64 = Buffer.alloc(8);
    duration64.writeBigUInt64BE(BigInt(duration));
    return fullBox('mvhd', 1, created64, Buffer.alloc(8), u32be(timescale), duration64, tail);
  }
  return fullBox('mvhd', 0, u32be(created), u32be(0), u32be(timescale), u32be(duration), tail);
}

function makeTkhd(width, height) {
  // The transform matrix, whose last cell is 0x40000000 -- the value that an
  // off-by-four read reports as a width of 16384.
  const matrix = Buffer.concat([
    u32be(0x00010000), u32be(0), u32be(0),
    u32be(0), u32be(0x00010000), u32be(0),
    u32be(0), u32be(0), u32be(0x40000000),
  ]);
  return fullBox(
    'tkhd', 0,
    u32be(0), u32be(0), u32be(1), u32be(0), u32be(1000),
    Buffer.alloc(8), u16be(0), u16be(0), u16be(0), u16be(0),
    matrix,
    u32be(width * 65536), u32be(height * 65536)
  );
}

function makeTrak(width, height, handler) {
  return box('trak', makeTkhd(width, height), box('mdia', fullBox('hdlr', 0, u32be(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12))));
}

function makeMoov({ width = 1920, height = 1080, durationSec = 12.5, tags = {}, version = 0, audio = true } = {}) {
  const parts = [makeMvhd({ durationSec, version, createdAt: Date.UTC(2024, 5, 1) })];
  parts.push(makeTrak(width, height, 'vide'));
  if (audio) parts.push(makeTrak(0, 0, 'soun'));

  const udtaParts = [];
  for (const [key, value] of Object.entries(tags)) {
    // QuickTime writes a 2-byte length and a 2-byte language before the text.
    udtaParts.push(box(key, u16be(value.length), u16be(0), Buffer.from(value, 'utf8')));
  }
  if (udtaParts.length) parts.push(box('udta', ...udtaParts));

  return box('moov', ...parts);
}

/**
 * An MP4 laid out the way a recorder writes one: media data first, metadata
 * after it. `mdatBytes` is set above 64 KB on purpose, so a parser that only
 * reads the head of the file cannot find `moov` at all.
 */
function makeMp4TrailingMoov({ mdatBytes = 200 * 1024, brand = 'isom', ...moovOptions } = {}) {
  return Buffer.concat([
    box('ftyp', Buffer.from(brand, 'latin1'), u32be(512), Buffer.from('isomiso2avc1mp41', 'latin1')),
    box('uuid', Buffer.alloc(16)),
    box('mdat', Buffer.alloc(mdatBytes)),
    makeMoov(moovOptions),
  ]);
}

function makeMp4LeadingMoov(moovOptions = {}) {
  return Buffer.concat([
    box('ftyp', Buffer.from('isom', 'latin1'), u32be(512), Buffer.from('isomavc1', 'latin1')),
    makeMoov(moovOptions),
    box('mdat', Buffer.alloc(4096)),
  ]);
}

function makeHeic(width, height, extra = []) {
  const ispes = [box('ispe', Buffer.from([0, 0, 0, 0]), u32be(width), u32be(height))];
  for (const [w, h] of extra) ispes.push(box('ispe', Buffer.from([0, 0, 0, 0]), u32be(w), u32be(h)));
  return Buffer.concat([
    box('ftyp', Buffer.from('heic', 'latin1'), u32be(0), Buffer.from('mif1heic', 'latin1')),
    fullBox('meta', 0, fullBox('hdlr', 0, u32be(0), Buffer.from('pict', 'latin1'), Buffer.alloc(12)), box('iprp', box('ipco', ...ispes))),
  ]);
}

function makeMatroska(docType) {
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from([0x9f, 0x42, 0x86, 0x81, 0x01]),
    Buffer.from([0x42, 0x82, 0x88]), Buffer.from(docType, 'latin1'),
    Buffer.alloc(32),
  ]);
}

/** A reader over a Buffer, standing in for the file handle `locateMoov` expects. */
function readerFor(buffer) {
  let reads = 0;
  const read = async (offset, length) => {
    reads += 1;
    return buffer.subarray(offset, Math.min(offset + length, buffer.length));
  };
  read.count = () => reads;
  return read;
}

/* -------------------------------------------------------------------------- */
/* format detection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `locateMoov` is the only asynchronous thing here, because it is the only
 * thing that reads -- and it reads through an injected function rather than a
 * file handle, which is what lets these fixtures stay in memory. One async
 * wrapper for the whole file keeps the assertions readable in order.
 */
async function main() {

console.log('\nmedia: the bytes say what the file is\n');

{
  const cases = [
    ['JPEG', makeJpeg({ width: 4032, height: 3024 }), 'jpeg', 'image'],
    ['PNG', makePng(1920, 1080), 'png', 'image'],
    ['GIF', makeGif(480, 270), 'gif', 'image'],
    ['WebP', makeWebp('VP8 ', 800, 600), 'webp', 'image'],
    ['BMP', makeBmp(64, 64), 'bmp', 'image'],
    ['TIFF little-endian', makeTiff({ little: true, width: 100, height: 50 }), 'tiff', 'image'],
    ['TIFF big-endian', makeTiff({ little: false, width: 100, height: 50 }), 'tiff', 'image'],
    ['MP4', makeMp4LeadingMoov(), 'mp4', 'video'],
    ['HEIC', makeHeic(4032, 3024), 'heic', 'image'],
    ['Matroska', makeMatroska('matroska'), 'mkv', 'video'],
    ['WebM', makeMatroska('webm'), 'webm', 'video'],
  ];

  for (const [label, buf, wantFormat, wantKind] of cases) {
    const got = format.detectFormat(buf);
    check(`${label} is recognised`, got && got.format === wantFormat && got.kind === wantKind,
      got ? `${got.format}/${got.kind}` : 'not recognised');
  }

  // HEIC, AVIF and MP4 are one container; only the brand separates them, and
  // getting that wrong files somebody's photos under "videos".
  const avif = Buffer.concat([
    Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp', 'latin1'),
    Buffer.from('avif', 'latin1'), Buffer.alloc(4), Buffer.from('avifmif1', 'latin1'),
  ]);
  check('AVIF is an image, not a video',
    format.detectFormat(avif) && format.detectFormat(avif).format === 'avif');

  check('an empty buffer is not a format', format.detectFormat(Buffer.alloc(0)) === null);
  check('random bytes are not a format', format.detectFormat(Buffer.alloc(64, 0x5a)) === null);
  // The check that finds a broken download: a server error saved under the name
  // the link had. The extension says JPEG and the bytes say nothing at all.
  check('an HTML error page saved as .jpg matches nothing',
    format.detectFormat(Buffer.from('<!DOCTYPE html><html><head><title>404', 'latin1')) === null);
}

console.log('\nmedia: a name that disagrees with the bytes\n');

{
  check('.jpg holding a JPEG is fine', format.extensionMatches('jpg', 'jpeg'));
  check('.jpeg holding a JPEG is fine', format.extensionMatches('jpeg', 'jpeg'));
  check('.jpg holding a PNG is a mismatch', !format.extensionMatches('jpg', 'png'));
  check('.png holding a JPEG is a mismatch', !format.extensionMatches('png', 'jpeg'));
  // Deliberately tolerated: these really are the same container, and reporting
  // it would be this module's brand table crying wolf.
  check('.mov holding an MP4 is not reported', format.extensionMatches('mov', 'mp4'));
  check('.heic holding AVIF is not reported', format.extensionMatches('heic', 'avif'));
  check('.dng holding TIFF is not reported', format.extensionMatches('dng', 'tiff'));
  check('an unknown extension is never a mismatch', format.extensionMatches('xyz', 'png'));
  check('bytes we could not read are not a mismatch either', !format.extensionMatches('jpg', null));
}

console.log('\nmedia: pixel dimensions from the header\n');

{
  const sizes = [
    ['JPEG', makeJpeg({ width: 4032, height: 3024 }), 'jpeg', 4032, 3024],
    ['PNG', makePng(1920, 1080), 'png', 1920, 1080],
    ['GIF', makeGif(480, 270), 'gif', 480, 270],
    ['WebP lossy', makeWebp('VP8 ', 800, 600), 'webp', 800, 600],
    ['WebP lossless', makeWebp('VP8L', 1024, 768), 'webp', 1024, 768],
    ['WebP extended', makeWebp('VP8X', 3000, 2000), 'webp', 3000, 2000],
    ['BMP', makeBmp(64, 48), 'bmp', 64, 48],
    ['TIFF little-endian', makeTiff({ little: true, width: 6000, height: 4000 }), 'tiff', 6000, 4000],
    ['TIFF big-endian', makeTiff({ little: false, width: 6000, height: 4000 }), 'tiff', 6000, 4000],
  ];

  for (const [label, buf, fmt, w, h] of sizes) {
    const size = format.readImageSize(buf, fmt);
    check(`${label} measures ${w}x${h}`, size && size.width === w && size.height === h,
      size ? `${size.width}x${size.height}` : 'no size');
  }

  // A BMP stored top-down records a negative height. Reported as -1080 it would
  // make every aspect-ratio and megapixel figure derived from it nonsense.
  const topDown = makeBmp(1920, 1080);
  topDown.writeInt32LE(-1080, 22);
  const flipped = format.readImageSize(topDown, 'bmp');
  check('a top-down BMP still has a positive height', flipped && flipped.height === 1080,
    flipped ? String(flipped.height) : 'no size');

  // The entropy-coded scan in these fixtures contains FF D8 and FF C0 bytes. A
  // parser that scans for markers instead of following the declared segment
  // lengths reads a frame header out of the compressed data.
  const frame = format.readJpegFrame(makeJpeg({ width: 1234, height: 567 }));
  check('JPEG segment lengths are followed, not guessed at',
    frame && frame.width === 1234 && frame.height === 567,
    frame ? `${frame.width}x${frame.height}` : 'no frame');

  const progressive = format.readJpegFrame(makeJpeg({ width: 800, height: 600, sofMarker: 0xc2 }));
  check('a progressive JPEG is recognised as progressive',
    progressive && progressive.progressive === true && progressive.width === 800);
  check('a baseline JPEG is not', format.readJpegFrame(makeJpeg({ width: 8, height: 8 })).progressive === false);

  // 0xC4 is a Huffman table and sits in the same numeric range as the frame
  // markers. Treating it as a frame reads the table's contents as a size.
  const withHuffman = makeJpeg({
    width: 640, height: 480,
    extraSegments: [segment(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(28, 0x11)]))],
  });
  const afterHuffman = format.readJpegFrame(withHuffman);
  check('a Huffman table is not mistaken for a frame',
    afterHuffman && afterHuffman.width === 640 && afterHuffman.height === 480,
    afterHuffman ? `${afterHuffman.width}x${afterHuffman.height}` : 'no frame');
}

/* -------------------------------------------------------------------------- */
/* EXIF                                                                        */
/* -------------------------------------------------------------------------- */

console.log('\nmedia: EXIF, from a JPEG that also carries JFIF and XMP\n');

{
  const block = makeExif({
    tags: {
      0x010f: 'Apple',
      0x0110: 'iPhone 15 Pro',
      0x0112: 1,
      0x0131: 'Photos 9.0',
    },
    exifTags: {
      0x9003: '2024:06:14 18:42:07',
      0x8827: 400,
      0xa002: 4032,
      0xa003: 3024,
      0x829a: [1, 125],
    },
    gpsTags: { 0x0001: 'N' },
  });

  // XMP also lives in APP1. Placed first, so taking the first APP1 finds the
  // wrong segment -- which is what a first pass at this did.
  const xmp = segment(0xe1, Buffer.concat([
    Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'),
    Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>', 'latin1'),
  ]));

  const jpeg = makeJpeg({ width: 4032, height: 3024, exifBlock: block, extraSegments: [xmp] });
  const tags = exif.fromJpeg(jpeg, format.jpegSegments(jpeg));

  check('EXIF is found past JFIF and XMP', tags !== null);
  check('the maker is read', tags && tags.make === 'Apple', tags && tags.make);
  check('the model is read', tags && tags.model === 'iPhone 15 Pro', tags && tags.model);
  // "Apple" + "Apple iPhone" would read as a stutter in the detail panel.
  check('the camera name does not repeat the maker', tags && tags.camera === 'Apple iPhone 15 Pro', tags && tags.camera);
  check('the editing software is read', tags && tags.software === 'Photos 9.0', tags && tags.software);
  check('the capture date is parsed', tags && tags.takenAt === new Date(2024, 5, 14, 18, 42, 7).getTime(),
    tags && tags.takenAt ? new Date(tags.takenAt).toISOString() : 'none');
  check('a SHORT value is read as a SHORT', tags && tags.iso === 400, tags && String(tags.iso));
  check('the stored pixel size is read', tags && tags.pixelX === 4032 && tags.pixelY === 3024);
  check('a RATIONAL becomes a number', tags && Math.abs(tags.exposureTime - 1 / 125) < 1e-9,
    tags && String(tags.exposureTime));
  check('that a position was recorded is reported', tags && tags.hasGps === true);

  const bigEndian = makeExif({ little: false, tags: { 0x010f: 'NIKON CORPORATION', 0x0110: 'NIKON Z 6', 0x0112: 6 } });
  const beJpeg = makeJpeg({ width: 100, height: 100, exifBlock: bigEndian });
  const beTags = exif.fromJpeg(beJpeg, format.jpegSegments(beJpeg));
  check('a big-endian EXIF block reads the same', beTags && beTags.model === 'NIKON Z 6', beTags && beTags.model);
  check('a big-endian SHORT is not byte-swapped', beTags && beTags.orientation === 6, beTags && String(beTags.orientation));
  check('the maker is not repeated for Nikon either', beTags && beTags.camera === 'NIKON Z 6', beTags && beTags.camera);

  const bare = makeJpeg({ width: 800, height: 600 });
  check('a JPEG with no EXIF reports none', exif.fromJpeg(bare, format.jpegSegments(bare)) === null);
}

console.log('\nmedia: orientation, and the dates a camera makes up\n');

{
  check('orientation 6 is a quarter turn', exif.appliesQuarterTurn(6));
  check('orientation 8 is a quarter turn', exif.appliesQuarterTurn(8));
  check('orientation 1 is not', !exif.appliesQuarterTurn(1));
  check('orientation 3 is a half turn, not a quarter', !exif.appliesQuarterTurn(3));

  check('an EXIF date parses', exif.parseExifDate('2024:06:14 18:42:07') !== null);
  // A camera with a flat battery writes its epoch. That is the clock being
  // wrong, not a photograph from before digital cameras existed.
  check('a flat-battery date is refused', exif.parseExifDate('1980:01:01 00:00:00') === null);
  check('a zeroed date is refused', exif.parseExifDate('0000:00:00 00:00:00') === null);
  check('rubbish is refused', exif.parseExifDate('not a date') === null);
  check('a non-string is refused', exif.parseExifDate(null) === null);
}

console.log('\nmedia: EXIF blocks that are trying to break the scan\n');

{
  // Every one of these arrives with files from the internet, and a photo that
  // hangs or crashes the scanner is a photo that stops somebody cleaning their
  // disk. None of them may throw, and none may take measurable time.
  const started = Date.now();

  const truncated = makeExif({ tags: { 0x010f: 'Canon', 0x0110: 'Canon EOS R6 Mark II' } }).subarray(0, 20);
  check('a truncated EXIF block does not throw', (() => {
    try { exif.readTiff(truncated, 0); return true; } catch { return false; }
  })());

  // An entry count of 65535 in a 30-byte buffer. A parser that trusts the count
  // reads three quarters of a megabyte past the end.
  const lying = makeExif({ tags: { 0x010f: 'X' } });
  lying.writeUInt16LE(0xffff, 8);
  check('an impossible entry count does not throw', (() => {
    try { exif.readTiff(lying, 0); return true; } catch { return false; }
  })());

  // IFD0 pointing at itself through the ExifIFD tag. Without the visited set
  // this recurses until the stack gives out.
  const loop = Buffer.concat([
    Buffer.from('II', 'latin1'), u16le(42), u32le(8),
    u16le(1), Buffer.concat([u16le(0x8769), u16le(4), u32le(1), u32le(8)]), u32le(0),
  ]);
  const loopResult = (() => {
    try { return { ok: true, value: exif.readTiff(loop, 0) }; } catch { return { ok: false }; }
  })();
  check('an IFD that points at itself terminates', loopResult.ok);

  // An ASCII value claiming to be 4 GB long.
  const huge = Buffer.concat([
    Buffer.from('II', 'latin1'), u16le(42), u32le(8),
    u16le(1), Buffer.concat([u16le(0x0131), u16le(2), u32le(0xffffffff), u32le(200)]), u32le(0),
  ]);
  const hugeResult = (() => {
    try { return { ok: true, value: exif.readTiff(huge, 0) }; } catch { return { ok: false }; }
  })();
  check('a value claiming to be four gigabytes does not throw', hugeResult.ok);
  check('and it does not produce a four-gigabyte string',
    !hugeResult.value || !hugeResult.value.software || hugeResult.value.software.length <= 128,
    hugeResult.value && hugeResult.value.software ? String(hugeResult.value.software.length) : 'none');

  // An offset past the end of the buffer, which is what a block truncated by
  // the 64 KB read window looks like from the inside.
  const past = Buffer.concat([
    Buffer.from('II', 'latin1'), u16le(42), u32le(8),
    u16le(1), Buffer.concat([u16le(0x010f), u16le(2), u32le(64), u32le(0x7fffffff)]), u32le(0),
  ]);
  check('an offset past the end of the buffer does not throw', (() => {
    try { exif.readTiff(past, 0); return true; } catch { return false; }
  })());

  check('none of that took measurable time', Date.now() - started < 500, `${Date.now() - started}ms`);
  check('a buffer that is not TIFF at all returns null', exif.readTiff(Buffer.alloc(64, 0x41), 0) === null);
}

/* -------------------------------------------------------------------------- */
/* ISO base media                                                              */
/* -------------------------------------------------------------------------- */

console.log('\nmedia: moov, which is at the end of the file\n');

{
  // The regression this whole module exists for. Eleven of eleven real MP4s on
  // the development machine are laid out ftyp, uuid, mdat, moov -- so reading
  // the first 64 KB finds no moov at all, and the first plan for this
  // subsystem would have reported every video as having no metadata.
  const trailing = makeMp4TrailingMoov({ width: 1920, height: 1080, durationSec: 17.4 });
  const head = trailing.subarray(0, 64 * 1024);

  check('the file really is bigger than the head window', trailing.length > 64 * 1024,
    `${Math.round(trailing.length / 1024)}KB`);
  check('and moov really is outside it',
    !bmff.boxes(head).some((b) => b.type === 'moov'),
    bmff.boxes(head).map((b) => b.type).join(','));

  const read = readerFor(trailing);
  const located = await bmff.locateMoov(read, trailing.length, head);
  check('hopping the box chain finds it anyway', located !== null);
  check('and it took a handful of tiny reads, not a scan', read.count() <= 6, `${read.count()} reads`);

  const parsed = located ? bmff.parseMoov(located.moov) : null;
  check('the duration is read', parsed && Math.abs(parsed.durationSec - 17.4) < 0.01,
    parsed && String(parsed.durationSec));
  // The off-by-four that made every video 16384 pixels wide, locked down.
  check('the resolution is read from tkhd, not from the transform matrix',
    parsed && parsed.width === 1920 && parsed.height === 1080,
    parsed ? `${parsed.width}x${parsed.height}` : 'none');
  check('it is not 16384 wide', !parsed || parsed.width !== 16384);
  check('the video track is seen', parsed && parsed.hasVideo === true);
  check('the audio track is seen too', parsed && parsed.hasAudio === true);
  check('the creation date is read', parsed && parsed.createdAt !== null,
    parsed && parsed.createdAt ? new Date(parsed.createdAt).toISOString().slice(0, 10) : 'none');

  const leading = makeMp4LeadingMoov({ width: 3840, height: 2160, durationSec: 4 });
  const leadRead = readerFor(leading);
  const leadFound = await bmff.locateMoov(leadRead, leading.length, leading.subarray(0, 64 * 1024));
  const leadParsed = leadFound ? bmff.parseMoov(leadFound.moov) : null;
  check('a web-optimised file with moov first also works',
    leadParsed && leadParsed.width === 3840 && leadParsed.height === 2160,
    leadParsed ? `${leadParsed.width}x${leadParsed.height}` : 'none');
  check('and that case costs no extra reads at all', leadRead.count() === 0, `${leadRead.count()} reads`);

  // Version 1 widens the timestamps to 64 bits and moves every field after
  // them, including the one the duration is computed from.
  const v1 = makeMp4TrailingMoov({ version: 1, durationSec: 3600, width: 1280, height: 720 });
  const v1Found = await bmff.locateMoov(readerFor(v1), v1.length, v1.subarray(0, 64 * 1024));
  const v1Parsed = v1Found ? bmff.parseMoov(v1Found.moov) : null;
  check('a version 1 movie header reads the same',
    v1Parsed && Math.abs(v1Parsed.durationSec - 3600) < 0.01 && v1Parsed.width === 1280,
    v1Parsed ? `${v1Parsed.durationSec}s ${v1Parsed.width}x${v1Parsed.height}` : 'none');

  const tagged = makeMp4TrailingMoov({ tags: { '©mak': 'Apple', '©mod': 'iPhone 15 Pro' } });
  const tagFound = await bmff.locateMoov(readerFor(tagged), tagged.length, tagged.subarray(0, 64 * 1024));
  const tagParsed = tagFound ? bmff.parseMoov(tagFound.moov) : null;
  check('the recording device is read from udta',
    tagParsed && tagParsed.tags.make === 'Apple' && tagParsed.tags.model === 'iPhone 15 Pro',
    tagParsed ? JSON.stringify(tagParsed.tags) : 'none');

  // A screen recorder writes no device tags, and that absence is part of the
  // reasoning the UI shows the user.
  const untagged = makeMp4TrailingMoov({});
  const untagFound = await bmff.locateMoov(readerFor(untagged), untagged.length, untagged.subarray(0, 64 * 1024));
  const untagParsed = untagFound ? bmff.parseMoov(untagFound.moov) : null;
  check('a file with no device tags reports none',
    untagParsed && Object.keys(untagParsed.tags).length === 0);

  // Every phone writes an ISO 6709 position into `©xyz`. A first run of this
  // parser against the development machine's own files printed the author's
  // home to six decimal places -- this app has no reason to know where anything
  // was filmed, and `exif.js` already refuses to carry GPS out of a photo.
  const geotagged = makeMp4TrailingMoov({ tags: { '©xyz': '+21.0967+105.3767/', '©mak': 'samsung' } });
  const locFound = await bmff.locateMoov(readerFor(geotagged), geotagged.length, geotagged.subarray(0, 64 * 1024));
  const locParsed = locFound ? bmff.parseMoov(locFound.moov) : null;
  check('a video that recorded a position says so', locParsed && locParsed.tags.hasLocation === true);
  check('but the coordinates are not carried out of the file',
    locParsed && !JSON.stringify(locParsed.tags).includes('21.0967'),
    locParsed ? JSON.stringify(locParsed.tags) : 'none');
  check('the rest of the tags on the same file survive that',
    locParsed && locParsed.tags.make === 'samsung', locParsed && locParsed.tags.make);
}

console.log('\nmedia: containers that are broken or hostile\n');

{
  const started = Date.now();

  // A box declaring a size of zero. Followed literally this is an infinite loop.
  const zeroSize = Buffer.concat([u32be(0), Buffer.from('mdat', 'latin1'), Buffer.alloc(32)]);
  const zeroResult = await bmff.locateMoov(readerFor(zeroSize), zeroSize.length, zeroSize);
  check('a zero-length box does not hang the hop', zeroResult === null);

  // A box declaring a size smaller than its own header.
  const tinySize = Buffer.concat([u32be(2), Buffer.from('mdat', 'latin1'), Buffer.alloc(32)]);
  check('a box smaller than its header is refused',
    await bmff.locateMoov(readerFor(tinySize), tinySize.length, tinySize) === null);

  // A 64-bit size field larger than JavaScript can count exactly.
  const absurd = Buffer.concat([u32be(1), Buffer.from('mdat', 'latin1'), Buffer.from('ffffffffffffffff', 'hex'), Buffer.alloc(16)]);
  check('an absurd 64-bit box size is refused',
    await bmff.locateMoov(readerFor(absurd), absurd.length, absurd) === null);

  check('a truncated moov does not throw', (() => {
    try { bmff.parseMoov(makeMoov({}).subarray(8, 40)); return true; } catch { return false; }
  })());
  check('an empty moov does not throw', (() => {
    try { bmff.parseMoov(Buffer.alloc(0)); return true; } catch { return false; }
  })());
  check('parsing random bytes as a moov does not throw', (() => {
    try { bmff.parseMoov(Buffer.alloc(512, 0xa5)); return true; } catch { return false; }
  })());

  // A chain of thousands of tiny boxes with no moov, which is what a file
  // crafted to make the scan expensive looks like.
  const chain = Buffer.concat(Array.from({ length: 4000 }, () => box('free', Buffer.alloc(0))));
  const chainRead = readerFor(chain);
  const chainResult = await bmff.locateMoov(chainRead, chain.length, chain.subarray(0, 64));
  check('a long box chain gives up rather than reading the whole file',
    chainResult === null && chainRead.count() < 100, `${chainRead.count()} reads`);

  check('none of that took measurable time either', Date.now() - started < 500, `${Date.now() - started}ms`);

  // 0xffffffff is the documented sentinel for "duration unknown" in a
  // fragmented file. Divided by the timescale it reads as 136 years.
  const unknownDuration = bmff.parseMoov(
    Buffer.concat([
      Buffer.from([0, 0, 0, 108]), Buffer.from('mvhd', 'latin1'),
      Buffer.from([0, 0, 0, 0]), u32be(0), u32be(0), u32be(1000), u32be(0xffffffff),
      Buffer.alloc(80),
    ])
  );
  check('an unknown duration is reported as unknown, not as 136 years',
    unknownDuration.durationSec === null, String(unknownDuration.durationSec));
}

console.log('\nmedia: HEIC, where the size is in meta rather than moov\n');

{
  // A HEIC holding a burst carries one ispe per image and one per thumbnail.
  // The first is often the thumbnail, so taking it reports a 320x240 photo.
  const heic = makeHeic(4032, 3024, [[320, 240], [1600, 1200]]);
  const size = bmff.parseIspe(heic);
  check('the largest ispe wins, not the first', size && size.width === 4032 && size.height === 3024,
    size ? `${size.width}x${size.height}` : 'none');

  check('an MP4 has no ispe', bmff.parseIspe(makeMp4LeadingMoov()) === null);
  check('rubbish has no ispe', bmff.parseIspe(Buffer.alloc(256, 0x33)) === null);
}

console.log('\nmedia: Matroska declares which of the two it is\n');

{
  check('WebM is told apart from Matroska', format.readEbmlDocType(makeMatroska('webm')) === 'webm');
  check('Matroska is told apart from WebM', format.readEbmlDocType(makeMatroska('matroska')) === 'matroska');
}

console.log('\nmedia: which extensions the scan looks at\n');

{
  check('jpg is an image', format.kindOfExtension('jpg') === 'image');
  check('JPG in capitals is an image too', format.kindOfExtension('JPG') === 'image');
  check('mp4 is a video', format.kindOfExtension('mp4') === 'video');
  check('heic is an image', format.kindOfExtension('heic') === 'image');
  check('dng is an image', format.kindOfExtension('dng') === 'image');
  // 193 .ico files and 6 .svg turned up in a 30-second walk of the development
  // machine's home folder, and not one of them was anybody's photograph. An
  // icon grid is noise on a screen about deleting holiday snaps.
  check('ico is not treated as media', format.kindOfExtension('ico') === null);
  check('svg is not treated as media', format.kindOfExtension('svg') === null);
  check('txt is not media', format.kindOfExtension('txt') === null);
  check('an empty extension is not media', format.kindOfExtension('') === null);
  check('undefined is not media', format.kindOfExtension(undefined) === null);
}

/* -------------------------------------------------------------------------- */

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);

} // main

main().catch((err) => {
  // A throw here is the suite itself being broken, which is a different thing
  // from an assertion failing and must not be reported as one.
  console.error('\nThe suite could not run:', err && err.stack ? err.stack : err);
  process.exit(1);
});
