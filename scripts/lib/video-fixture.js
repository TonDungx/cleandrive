'use strict';

/**
 * Real MP4 files for the harnesses, encoded rather than faked (E3).
 *
 * ## Why these are generated and not copied from the library
 *
 * A harness that reaches into the real Pictures folder is a harness that
 * depends on what happens to be on one machine, and this project has already
 * been bitten by that: a check for "a day with nothing in it" failed because
 * the real library turned out to be too dense. These files are built to order,
 * so a test can say what it expects.
 *
 * They also have to be *real*. `scripts/lib/exif-fixture.js` makes JPEGs with
 * genuine EXIF for the same reason: a fixture that only looks right to the code
 * under test proves nothing. So these are encoded by Chromium's own
 * `VideoEncoder` -- which means this module needs a window, because WebCodecs
 * is a web API and the main process does not have one.
 *
 * ## The one thing to be careful about
 *
 * The muxer under test writes these files, so a harness that only demuxed them
 * again would be agreeing with itself. `scripts/test-mp4.js` closes that by
 * testing the demuxer against tables written out by hand; the shoot script
 * closes the other end by asking the **Windows shell** for a thumbnail and a
 * `<video>` element to play the result, neither of which is this project's
 * code.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow } = require('electron');

const mux = require('../../src/main/lib/media/mp4/mux');

/**
 * The page that owns the encoder.
 *
 * `file://` rather than a `data:` URL, and that is measured rather than
 * stylistic: `VideoEncoder` and `VideoDecoder` are **absent** from a `data:`
 * URL in Electron 33 and present from a file, because they want a secure
 * context. A generator written the obvious way simply reports that this
 * computer has no encoder.
 */
const PAGE = [
  '<!doctype html><meta charset="utf-8"><title>video fixture</title>',
  '<script>',
  'window.encodeClip = async function (spec) {',
  '  const { width, height, seconds, fps, bitrate, seed } = spec;',
  '  const canvas = document.createElement("canvas");',
  '  canvas.width = width; canvas.height = height;',
  '  const ctx = canvas.getContext("2d", { alpha: false });',
  '',
  '  let config = null;',
  '  const chunks = [];',
  '  let failure = null;',
  '',
  '  const encoder = new VideoEncoder({',
  '    output: (chunk, metadata) => {',
  '      if (metadata && metadata.decoderConfig && metadata.decoderConfig.description && !config) {',
  '        config = Array.from(new Uint8Array(metadata.decoderConfig.description));',
  '      }',
  '      const data = new Uint8Array(chunk.byteLength);',
  '      chunk.copyTo(data);',
  '      chunks.push({ data: Array.from(data), timestamp: chunk.timestamp, duration: chunk.duration || 0, key: chunk.type === "key" });',
  '    },',
  '    error: (e) => { failure = failure || (e.name + ": " + e.message); },',
  '  });',
  '',
  '  let chosen = null;',
  '  for (const codec of ["avc1.640028", "avc1.4D401F"]) {',
  '    const cfg = { codec, width, height, bitrate, framerate: fps, avc: { format: "avc" }, latencyMode: "quality" };',
  '    const r = await VideoEncoder.isConfigSupported(cfg);',
  '    if (r && r.supported) { chosen = cfg; break; }',
  '  }',
  '  if (!chosen) return { error: "no encoder" };',
  '  encoder.configure(chosen);',
  '',
  '  const total = Math.round(seconds * fps);',
  '  for (let i = 0; i < total; i += 1) {',
  '    // A moving gradient with large text on it: compressible, so a lower',
  '    // bitrate visibly costs less, which is the whole thing being measured.',
  '    const g = ctx.createLinearGradient(0, 0, width, height);',
  '    g.addColorStop(0, "hsl(" + ((i * 2 + seed * 40) % 360) + ",70%,45%)");',
  '    g.addColorStop(1, "hsl(" + ((i * 2 + seed * 40 + 120) % 360) + ",70%,25%)");',
  '    ctx.fillStyle = g;',
  '    ctx.fillRect(0, 0, width, height);',
  '    ctx.fillStyle = "rgba(255,255,255,0.92)";',
  '    ctx.font = Math.round(height / 7) + "px sans-serif";',
  '    ctx.fillText(String(i).padStart(4, "0"), width * 0.08, height * 0.55);',
  '    ctx.font = Math.round(height / 18) + "px sans-serif";',
  '    ctx.fillText("CleanDrive test clip " + seed, width * 0.08, height * 0.75);',
  '',
  '    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });',
  '    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });',
  '    frame.close();',
  '    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));',
  '    if (failure) break;',
  '  }',
  '',
  '  if (!failure) await encoder.flush();',
  '  encoder.close();',
  '  if (failure) return { error: failure };',
  '  return { config, chunks, codec: chosen.codec };',
  '};',
  '</script>',
].join('\n');

/**
 * A window that can encode. Hidden, and the caller closes it.
 *
 * `backgroundThrottling: false` because a hidden window is throttled by default
 * and a throttled encoder takes minutes instead of seconds.
 */
async function openEncoder(scratchDir) {
  fs.mkdirSync(scratchDir, { recursive: true });
  const pagePath = path.join(scratchDir, 'video-fixture.html');
  fs.writeFileSync(pagePath, PAGE, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(pagePath);
  return win;
}

/**
 * Write one clip.
 *
 * @param {BrowserWindow} win   from `openEncoder`
 * @param {object} spec  {file, width, height, seconds, fps, bitrate, seed, ageDays}
 * @returns {Promise<{file: string, size: number, frames: number}>}
 */
async function writeClip(win, spec) {
  const {
    file,
    width = 1280,
    height = 720,
    seconds = 6,
    fps = 30,
    // Deliberately generous. A fixture encoded at a sensible rate has nothing
    // left to give, and the screen under test would correctly offer nothing.
    bitrate = 12_000_000,
    seed = 1,
    ageDays = 30,
  } = spec;

  const result = await win.webContents.executeJavaScript(
    `window.encodeClip(${JSON.stringify({ width, height, seconds, fps, bitrate, seed })})`
  );
  if (!result || result.error) throw new Error(`fixture encode failed: ${result && result.error}`);

  const samples = result.chunks.map((c) => ({
    data: Buffer.from(c.data),
    timestamp: c.timestamp,
    duration: c.duration,
    key: c.key,
  }));

  const bytes = mux.build({
    // A capture date of its own, so the copy has something to carry over and
    // the timeline has something to place it by.
    createdAt: Date.now() - ageDays * 86400000,
    video: {
      fourcc: 'avc1',
      codecConfig: Buffer.from(result.config),
      width,
      height,
      framerate: fps,
      samples,
    },
  });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);

  // Set explicitly. Several files written inside one millisecond share an
  // mtime, and every rule in this app that picks between them then falls back
  // to sorting by name -- which has already broken two harnesses.
  const when = new Date(Date.now() - ageDays * 86400000);
  fs.utimesSync(file, when, when);

  return { file, size: bytes.length, frames: samples.length, codec: result.codec };
}

module.exports = { openEncoder, writeClip };
