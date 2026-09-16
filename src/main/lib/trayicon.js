'use strict';

const zlib = require('node:zlib');

/**
 * The tray icon, drawn at runtime.
 *
 * An icon that shows a fixed logo says nothing; the whole point of sitting in
 * the tray is to answer "how full is the disk" without being clicked. So the
 * icon is a gauge, generated as a PNG each time the reading changes, rather
 * than a static asset committed to the repo.
 *
 * That means encoding a PNG by hand. It is less work than it sounds -- a
 * truecolour-with-alpha PNG is a header, one zlib stream of filtered scanlines
 * and a terminator -- and it keeps the app at zero dependencies, which is worth
 * more than the forty lines it costs.
 *
 * Contrast is the other reason for drawing it here. The Windows tray sits on a
 * background the user chooses, and can be near-white or near-black. A light
 * icon disappears on one, a dark icon on the other. The gauge therefore has a
 * dark body *and* a bright fill: the body carries it on a light taskbar, the
 * fill carries it on a dark one, and the fill colour is the actual message.
 */

/* -------------------------------------------------------------------------- */
/* PNG encoding                                                                */
/* -------------------------------------------------------------------------- */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Node gained zlib.crc32 in 20.15; this app runs on whatever Electron ships, so
// the table is built here rather than assumed.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode RGBA pixels as a PNG.
 *
 * @param {Buffer} rgba   width * height * 4 bytes
 * @param {number} width
 * @param {number} height
 */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Every scanline is prefixed with its filter type. Filter 0 (none) costs a
  // few bytes at this size and keeps the encoder trivial.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* the gauge                                                                   */
/* -------------------------------------------------------------------------- */

// Matched to the palette in styles.css so the tray and the window agree.
const COLOURS = {
  ok: [70, 167, 88, 255], // --good
  warn: [224, 160, 47, 255], // --warn
  critical: [229, 72, 77, 255], // --danger
  body: [28, 31, 38, 255], // --surface
  outline: [16, 19, 24, 255], // near-black, for light taskbars
  unknown: [153, 161, 179, 255], // --text-dim
};

function levelFor(usedPercent, warnPercent, criticalPercent) {
  if (!Number.isFinite(usedPercent)) return 'unknown';
  if (usedPercent >= criticalPercent) return 'critical';
  if (usedPercent >= warnPercent) return 'warn';
  return 'ok';
}

/**
 * Draw a drive-shaped gauge filled from the bottom.
 *
 * @param {object} options
 * @param {number} options.usedPercent
 * @param {number} [options.warnPercent=85]
 * @param {number} [options.criticalPercent=95]
 * @param {number} [options.size=32]
 * @returns {{png: Buffer, level: string, size: number}}
 */
function renderGauge({ usedPercent, warnPercent = 85, criticalPercent = 95, size = 32 } = {}) {
  const level = levelFor(usedPercent, warnPercent, criticalPercent);
  const fill = COLOURS[level];

  const rgba = Buffer.alloc(size * size * 4); // transparent
  const inset = Math.max(1, Math.round(size / 10));
  const border = Math.max(1, Math.round(size / 16));
  const radius = Math.max(1, Math.round(size / 8));

  const left = inset;
  const right = size - inset - 1;
  const top = inset;
  const bottom = size - inset - 1;

  const innerLeft = left + border;
  const innerRight = right - border;
  const innerTop = top + border;
  const innerBottom = bottom - border;
  const innerHeight = innerBottom - innerTop + 1;

  const fraction = Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, usedPercent)) / 100 : 0;
  // At least one row once there is any usage at all, so "nearly empty" still
  // reads as a gauge rather than an empty box.
  const fillRows = fraction > 0 ? Math.max(1, Math.round(innerHeight * fraction)) : 0;
  const fillTop = innerBottom - fillRows + 1;

  const put = (x, y, colour) => {
    const offset = (y * size + x) * 4;
    rgba[offset] = colour[0];
    rgba[offset + 1] = colour[1];
    rgba[offset + 2] = colour[2];
    rgba[offset + 3] = colour[3];
  };

  // Corners are cut rather than curved: at 16 logical pixels an anti-aliased
  // arc turns to mush, and a chamfer reads as "rounded" all the same.
  const cut = (x, y) => {
    const dx = Math.min(x - left, right - x);
    const dy = Math.min(y - top, bottom - y);
    return dx < radius && dy < radius && dx + dy < radius;
  };

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (cut(x, y)) continue;

      const onBorder = x < innerLeft || x > innerRight || y < innerTop || y > innerBottom;
      if (onBorder) {
        put(x, y, COLOURS.outline);
      } else if (level === 'unknown') {
        put(x, y, COLOURS.body);
      } else if (y >= fillTop) {
        put(x, y, fill);
      } else {
        put(x, y, COLOURS.body);
      }
    }
  }

  return { png: encodePng(rgba, size, size), level, size };
}

/* -------------------------------------------------------------------------- */
/* the application icon                                                        */
/* -------------------------------------------------------------------------- */

// The brand mark, matching `.brand-mark` in styles.css: a blue rounded square
// with a gauge glyph. Drawn here rather than committed as a .ico so the icon in
// the taskbar, the icon in the title bar and the mark in the window's own
// header cannot drift apart -- and so the repo keeps no binary assets.
const APP_COLOURS = {
  top: [111, 155, 255],
  bottom: [63, 111, 216],
  glyphFull: [255, 255, 255, 242],
  glyphFaint: [255, 255, 255, 71],
};

/**
 * Signed distance to a rounded rectangle, used for an anti-aliased edge.
 * A chamfer is fine at 16px and looks like a mistake at 256.
 */
function roundedRectDistance(x, y, halfW, halfH, radius) {
  const qx = Math.abs(x) - (halfW - radius);
  const qy = Math.abs(y) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Blend `src` (with alpha 0-255) over `dst`, both [r,g,b]. */
function over(dst, src, alpha) {
  const a = alpha / 255;
  return [
    Math.round(src[0] * a + dst[0] * (1 - a)),
    Math.round(src[1] * a + dst[1] * (1 - a)),
    Math.round(src[2] * a + dst[2] * (1 - a)),
  ];
}

/**
 * The application icon: a rounded blue tile carrying the same drive gauge the
 * tray icon draws — an outlined container with a fill level in it, rather than
 * two stacked blocks, because at 16 pixels the outline is what makes it read as
 * a gauge at all.
 *
 * @returns {Buffer} a PNG at `size` square.
 */
function renderAppIcon(size = 256) {
  const rgba = Buffer.alloc(size * size * 4);
  const half = size / 2;
  const radius = size * 0.22;

  // Glyph geometry, all proportional so every size in the .ico is the same
  // drawing rather than a scaled bitmap.
  const glyphHalfW = size * 0.19;
  const glyphHalfH = size * 0.25;
  const glyphRadius = size * 0.05;
  const stroke = Math.max(1, size * 0.055);
  // Small: the level should look like it has risen to meet the container,
  // not like a square floating inside one.
  const gap = Math.max(1, size * 0.018);

  // Filled to roughly 60% — enough to read as "part full" rather than empty or
  // solid, and it matches the level the tray gauge shows on a typical disk.
  const innerTop = -glyphHalfH + stroke + gap;
  const innerBottom = glyphHalfH - stroke - gap;
  const fillTop = innerBottom - (innerBottom - innerTop) * 0.62;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - half;
      const py = y + 0.5 - half;

      const tile = Math.max(0, Math.min(1, 0.5 - roundedRectDistance(px, py, half, half, radius)));
      if (tile <= 0) continue;

      // Vertical gradient, approximating the 145deg one in the stylesheet.
      const t = y / (size - 1);
      let colour = [
        Math.round(APP_COLOURS.top[0] + (APP_COLOURS.bottom[0] - APP_COLOURS.top[0]) * t),
        Math.round(APP_COLOURS.top[1] + (APP_COLOURS.bottom[1] - APP_COLOURS.top[1]) * t),
        Math.round(APP_COLOURS.top[2] + (APP_COLOURS.bottom[2] - APP_COLOURS.top[2]) * t),
      ];

      const d = roundedRectDistance(px, py, glyphHalfW, glyphHalfH, glyphRadius);

      // The outline is the band straddling the glyph's boundary.
      const outline = Math.max(0, Math.min(1, stroke / 2 - Math.abs(d + stroke / 2) + 0.5));

      // The level inside it, with a soft top edge so the line does not alias.
      const insideGlyph = Math.max(0, Math.min(1, -(d + stroke + gap) + 0.5));
      const belowLevel = Math.max(0, Math.min(1, py - fillTop + 0.5));
      const level = Math.min(insideGlyph, belowLevel);

      const ink = Math.max(outline, level);
      if (ink > 0) colour = over(colour, APP_COLOURS.glyphFull, Math.round(ink * 255));

      const offset = (y * size + x) * 4;
      rgba[offset] = colour[0];
      rgba[offset + 1] = colour[1];
      rgba[offset + 2] = colour[2];
      rgba[offset + 3] = Math.round(tile * 255);
    }
  }

  return encodePng(rgba, size, size);
}

/**
 * Wrap PNGs as a Windows .ico.
 *
 * An icon directory followed by the payloads. PNG payloads are permitted rather
 * than the older BMP form, which halves the work and is understood by every
 * Windows this app targets.
 *
 * @param {Array<{size: number, png: Buffer}>} images
 */
function encodeIco(images) {
  const ordered = [...images].sort((a, b) => a.size - b.size);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(ordered.length, 4);

  const directory = Buffer.alloc(16 * ordered.length);
  let offset = header.length + directory.length;

  ordered.forEach((image, index) => {
    const at = index * 16;
    // 256 is stored as 0; the field is one byte.
    directory[at] = image.size >= 256 ? 0 : image.size;
    directory[at + 1] = image.size >= 256 ? 0 : image.size;
    directory[at + 2] = 0; // palette size
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, directory, ...ordered.map((i) => i.png)]);
}

/** The full set Windows asks for, from the taskbar to the 256px file preview. */
function buildAppIco(sizes = [16, 24, 32, 48, 64, 128, 256]) {
  return encodeIco(sizes.map((size) => ({ size, png: renderAppIcon(size) })));
}

module.exports = {
  renderGauge,
  renderAppIcon,
  encodePng,
  encodeIco,
  buildAppIco,
  crc32,
  levelFor,
  COLOURS,
};
