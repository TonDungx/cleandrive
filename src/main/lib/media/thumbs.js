'use strict';

const { nativeImage } = require('electron');

const perceptual = require('./perceptual');

/**
 * Phase two: a picture of the picture, and the three numbers derived from it.
 *
 * ## Two ways to get pixels, and neither one is enough alone
 *
 * `nativeImage.createThumbnailFromPath` asks the Windows shell, which answers
 * out of the thumbnail cache Explorer already keeps. That is the fast path, and
 * it is the only thing in this app that can produce a frame from a video
 * without a decoder -- verified, not assumed.
 *
 * What it does **not** do is generate a thumbnail that is not already cached.
 * It only reads. A benchmark over a real Pictures folder had it refuse 270 of
 * 400 files with `Failed to get thumbnail from local thumbnail cache
 * reference` -- every one of them a perfectly ordinary JPEG that Explorer had
 * simply never been asked to display. Shipping on that alone would mean a grid
 * two thirds empty, on exactly the folders somebody has not been browsing.
 *
 * So there is a second path: `createFromPath`, which decodes the file with
 * Chromium's own image decoders. Measured on the refused files, it read all 53
 * of 53. On files the shell *would* have drawn it runs at 79 a second against
 * the shell's 91 -- close enough that the fallback is not a cliff.
 *
 * It cannot open a video. Chromium's image decoders are image decoders, and
 * `createFromPath` on an MP4 returns an empty image. A video whose thumbnail
 * the shell refuses therefore has no picture, and the grid says so rather than
 * showing a blank cell.
 *
 * ## One call, not two
 *
 * An earlier version asked for a 256-pixel thumbnail to draw and a 32-pixel one
 * to measure, on the theory that the second would come free from the same cache
 * entry. Measured: 241 ms for one call against 443 ms for two, over the same
 * twenty files. There is no such cache. Both the data URI and the analysis now
 * come from a single image, and `perceptual.analyse` normalises the size
 * itself.
 *
 * ## This is the slow half, and concurrency does not fix it
 *
 * Measured over forty files the shell refused, averaging 2.4 MB each:
 *
 * | step                                      | per file |
 * | ----------------------------------------- | -------- |
 * | read the bytes                            |   5.2 ms |
 * | `createFromPath` (read **and decode**)    |  71.3 ms |
 * | …plus resize, JPEG encode and `getBitmap` |  80.4 ms |
 *
 * So it is the decode, and nothing else. It is decoding at full resolution --
 * a 4608×3456 photograph is sixteen million pixels -- because nothing in
 * `nativeImage` exposes a decode-to-scale. And it is **synchronous**, which the
 * throughput makes plain: 13 a second at one-way, 13 at four, 12 at eight. The
 * shell path is the same shape, 38 a second whether one request is in flight or
 * eight.
 *
 * Three consequences, all of them designed around rather than wished away:
 *
 *   1. Phase two only ever runs on what is on screen. It is not a pass over the
 *      library and must never become one.
 *   2. Every file yields the process between decodes, so a screenful of
 *      thumbnails does not stop the main process answering IPC. Without that,
 *      forty synchronous decodes in a row is two seconds during which nothing
 *      can be cancelled.
 *   3. The numbers derived from the pixels are cached, so grouping and ordering
 *      are paid once per file and never again.
 *
 * ## It is main-process only
 *
 * `require('electron')` does not resolve inside a worker thread, which is why
 * every calculation lives in `perceptual.js` and this file does nothing but
 * fetch pixels and hand them over.
 */

/** What the grid draws. Big enough for a retina cell, small enough to stream. */
const DISPLAY_SIZE = 256;

/**
 * JPEG quality for the data URI.
 *
 * Not `toDataURL()`, which encodes PNG: a 256-pixel thumbnail comes out around
 * 104 KB that way against about 9 KB as JPEG, and three hundred of those on
 * screen is thirty megabytes of base64 crossing the IPC boundary for a grid of
 * postage stamps.
 */
const JPEG_QUALITY = 70;

const SOURCE_SHELL = 'shell';
const SOURCE_DECODER = 'decoder';

/**
 * Draw one thumbnail and measure it.
 *
 * @param {string} filePath
 * @param {{display?: boolean, analyse?: boolean, size?: number, allowDecoder?: boolean}} [options]
 * @returns {Promise<object>} never throws; a file nothing can draw is a fact
 *                            about the file, not a failure of the scan
 */
async function thumbnail(filePath, options = {}) {
  const size = options.size || DISPLAY_SIZE;
  const wantDisplay = options.display !== false;
  const wantAnalysis = options.analyse !== false;

  const result = {
    dataUri: null,
    width: 0,
    height: 0,
    source: null,
    hash: null,
    detail: null,
    brightness: null,
    deviation: null,
    blank: false,
    error: null,
  };

  const image = await loadImage(filePath, size, options.allowDecoder !== false, result);
  if (!image) return result;

  const dimensions = image.getSize();
  result.width = dimensions.width;
  result.height = dimensions.height;

  if (wantDisplay) {
    try {
      result.dataUri = `data:image/jpeg;base64,${image.toJPEG(JPEG_QUALITY).toString('base64')}`;
    } catch (err) {
      result.error = message(err, 'could not encode');
    }
  }

  if (wantAnalysis && dimensions.width >= 3 && dimensions.height >= 3) {
    try {
      // The same image the grid is about to draw. `analyse` normalises the
      // scale internally, so it does not matter that this is 256 pixels here
      // and something else on a file the shell sized differently.
      const measured = perceptual.analyse(image.getBitmap(), dimensions.width, dimensions.height);
      result.hash = measured.hash;
      result.detail = measured.detail;
      result.brightness = measured.brightness;
      result.deviation = measured.deviation;
      result.blank = measured.blank;
    } catch (err) {
      // The picture is still shown; it simply joins no similarity group.
      if (!result.error) result.error = message(err, 'could not measure');
    }
  }

  return result;
}

/**
 * Pixels, from whichever source can produce them.
 *
 * The shell first because it is marginally faster and because it is the only
 * one that opens a video; the decoder second because the shell refuses most of
 * a folder Explorer has not visited.
 */
async function loadImage(filePath, size, allowDecoder, result) {
  try {
    const image = await nativeImage.createThumbnailFromPath(filePath, { width: size, height: size });
    if (!image.isEmpty()) {
      result.source = SOURCE_SHELL;
      return image;
    }
  } catch (err) {
    result.error = message(err, 'shell refused');
  }

  if (!allowDecoder) return null;

  try {
    const full = nativeImage.createFromPath(filePath);
    if (full.isEmpty()) {
      // Reached for every video the shell would not draw, and for image formats
      // Chromium does not decode -- HEIC among them. Saying so is better than a
      // blank cell that looks like the app hanging.
      result.error = result.error || 'no decoder for this format';
      return null;
    }

    // `resize` with both dimensions stretches to fit them, unlike
    // createThumbnailFromPath which preserves the aspect ratio. Passing only
    // the longer edge is what keeps a portrait photograph portrait.
    const from = full.getSize();
    const scaled =
      from.width >= from.height
        ? full.resize({ width: Math.min(size, from.width), quality: 'good' })
        : full.resize({ height: Math.min(size, from.height), quality: 'good' });

    result.source = SOURCE_DECODER;
    result.error = null;
    return scaled;
  } catch (err) {
    result.error = message(err, 'could not be read');
    return null;
  }
}

function message(err, fallback) {
  return err && err.message ? String(err.message).slice(0, 120) : fallback;
}

/**
 * Hand the event loop a turn.
 *
 * `setImmediate` rather than `setTimeout(0)`: it runs after the current poll
 * phase, which is where pending IPC replies are, so a cancel pressed during a
 * long run of decodes is acted on between two files instead of after all of
 * them.
 */
const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Draw a batch.
 *
 * `concurrency` is small on purpose and is not the lever it looks like: the
 * measurement in the header shows both paths running at the same rate whether
 * one request is in flight or eight, because both decode synchronously. Two
 * runners are kept so that a file served from the shell's cache -- which *is*
 * awaited -- can overlap with one being decoded, and no more, because beyond
 * that the only thing extra runners add is more bitmaps alive at once.
 *
 * Cancellable between files. Within one there is nothing to cancel: a decode is
 * a single synchronous call into Chromium.
 *
 * @param {string[]} paths
 * @param {object} [options]
 * @param {{onOne?: Function, token?: object}} [handlers]
 */
async function thumbnails(paths, options = {}, handlers = {}) {
  const concurrency = options.concurrency || 2;
  const token = handlers.token;
  const out = new Map();
  const cache = options.cache || null;

  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= paths.length) return;
      if (token && token.cancelled) return;

      const filePath = paths[index];

      // The pixels are gone as soon as this function returns, but the numbers
      // taken from them are the same for ever -- so grouping and ordering are
      // paid once per file rather than once per look.
      const key = cache && options.keyOf ? options.keyOf(filePath) : null;
      const remembered = key ? cache.get(key) : null;

      let result;
      if (remembered && options.display === false) {
        result = { ...remembered, dataUri: null, fromCache: true };
      } else {
        result = await thumbnail(filePath, options);
        if (key && result.hash) {
          // The data URI is deliberately not stored: it is ten kilobytes a file
          // and the grid asks for it again whenever it needs it.
          const { dataUri, ...numbers } = result;
          cache.set(key, numbers);
        }
      }

      out.set(filePath, result);
      if (handlers.onOne) handlers.onOne(filePath, result);

      // Between files, not within one. A run of forty synchronous decodes is
      // two seconds in which the main process answers nothing at all.
      await yieldToLoop();
    }
  });

  await Promise.all(runners);
  return out;
}

module.exports = {
  thumbnail,
  thumbnails,
  DISPLAY_SIZE,
  JPEG_QUALITY,
  SOURCE_SHELL,
  SOURCE_DECODER,
};
