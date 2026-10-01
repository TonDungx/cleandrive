'use strict';

/**
 * Making a smaller copy of a video (E3) -- the half that lives in the main
 * process.
 *
 * ## The split, and why it is where it is
 *
 * `VideoDecoder` and `VideoEncoder` are web APIs. They exist in the window and
 * not here, and they are not available from a `data:` URL -- measured: absent
 * there, present from the `file://` origin `main.js` already loads. So the
 * pixels are the window's job and everything else is this file's: finding the
 * samples, deciding what to aim for, writing the result, and proving the result
 * is readable before telling anybody it worked.
 *
 * This is the opposite split from `thumbs.js`, which is main-process-only
 * because `nativeImage` is. Between them they cover both halves of "this app
 * can see inside a video", and neither one can do the other's job.
 *
 * ## What it will not do
 *
 * **Touch the original.** Nothing here opens the source for writing, and there
 * is no code path that deletes it. The copy lands beside it under a new name
 * and the original goes to the Recycle Bin the ordinary way, by someone
 * pressing the ordinary button, if they decide to.
 *
 * **Carry coordinates.** A video's `moov` can hold a position and
 * `analyzers/media.js` reads one. Writing it into the copy would be writing
 * coordinates into a file this app creates -- the thing `test-media-map.js`
 * reads the source of `report/`, `snapshots/` and `journal.js` to forbid. The
 * rotation and the capture date are carried through; the position is dropped,
 * and the screen says so rather than leaving it to be assumed.
 *
 * **Guess at the size.** The estimate comes from encoding the first ten
 * seconds for real and multiplying, which is what the roadmap asked for. A
 * number derived from a bitrate table would be free and would be wrong on
 * exactly the files people care about: measured on this machine, the nine
 * screen recordings run at 8,006-10,094 kbps for content that is mostly a
 * still page, and no table predicts how far that falls.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const bmff = require('../bmff');
const { demux } = require('./demux');
const mux = require('./mux');

/** What the copy is called. Deliberately not a name any camera would produce. */
const SUFFIX = '.cleandrive.mp4';

/** How much of the file is encoded to produce an estimate. The roadmap's number. */
const TRIAL_SECONDS = 10;

/**
 * Bits per pixel per second, by level.
 *
 * Not plucked from the air and not a promise: these only set where the trial
 * encode starts, and the trial is what the screen actually reports. Measured
 * on this machine's library, a 1080p30 screen recording at 0.045 comes out
 * around 2.8 Mbps against a source of 8-10 Mbps.
 */
const LEVELS = {
  balanced: {
    bitsPerPixel: 0.045,
    /** Never above this share of what the source already uses. */
    ceilingOfSource: 0.8,
    maxEdge: 0,
  },
  smallest: {
    bitsPerPixel: 0.025,
    ceilingOfSource: 0.5,
    /** The long edge, after which a phone video stops being worth its bytes. */
    maxEdge: 1280,
  },
};

/* -------------------------------------------------------------------------- */
/* reading the source                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Everything needed to re-encode one file, or the reason there is nothing to
 * be done with it.
 *
 * A refusal is a fact about the file, not an error: a `.mkv` this cannot open
 * and a cloud placeholder that is not on the disk are both ordinary, and both
 * get said out loud rather than thrown.
 */
async function open(filePath) {
  let stats;
  try {
    stats = await fsp.stat(filePath);
  } catch (err) {
    return { ok: false, reason: 'unreadable', detail: err.code || 'ESTAT' };
  }

  // A placeholder has a name, a size and no blocks. Reading one downloads it,
  // and on this machine 308 of the 381 videos in the default roots are exactly
  // that -- 4,591.8 MB that would come down the wire to save nothing, because
  // they occupy nothing. Counted and refused, the way E1 refused them hashing.
  if (stats.blocks === 0 && stats.size > 0) {
    return { ok: false, reason: 'dehydrated', size: stats.size };
  }

  const handle = await fsp.open(filePath, 'r').catch(() => null);
  if (!handle) return { ok: false, reason: 'unreadable', detail: 'EOPEN' };

  try {
    const read = async (offset, length) => {
      const buf = Buffer.alloc(Math.max(0, length));
      const { bytesRead } = await handle.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead);
    };
    const head = await read(0, Math.min(64 * 1024, stats.size));
    const found = await bmff.locateMoov(read, stats.size, head);
    if (!found) return { ok: false, reason: 'notBmff' };

    const tracks = demux(found.moov);

    // A fragmented file keeps its sample positions in `moof` boxes scattered
    // through the file rather than in the tables inside `moov`, and announces
    // itself with `mvex`. `demux` reads the tables, finds them empty, and
    // reports no video track -- which is true of the tables and false about the
    // file, so it is said properly instead.
    //
    // Measured: **none** of the 73 readable videos on this machine is
    // fragmented, which is why there is no second reader. But Chromium's own
    // `MediaRecorder` writes this layout, so anything captured in a browser
    // arrives looking like this.
    if (!tracks.video && bmff.boxes(found.moov).some((b) => b.type === 'mvex')) {
      return { ok: false, reason: 'fragmented' };
    }
    if (!tracks.video) return { ok: false, reason: 'noVideoTrack' };
    if (!tracks.video.supported) {
      return { ok: false, reason: 'codec', detail: tracks.video.fourcc };
    }
    if (!tracks.video.description) {
      // Without the configuration record there is nothing to configure a
      // decoder with. `avc3` keeps its parameter sets in the stream instead;
      // saying so beats failing later with a decoder error.
      return { ok: false, reason: 'noCodecConfig', detail: tracks.video.fourcc };
    }
    if (!tracks.video.samples.length) return { ok: false, reason: 'noSamples' };

    const moovParsed = bmff.parseMoov(found.moov);
    const durationSec = tracks.video.durationSec
      || (tracks.video.samples[tracks.video.samples.length - 1].timestamp / 1e6);

    return {
      ok: true,
      path: filePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      durationSec,
      createdAt: moovParsed.createdAt || null,
      video: tracks.video,
      // Audio is copied through untouched, so an audio codec this cannot
      // describe is a reason to drop the sound, not a reason to refuse the
      // file -- and the screen says which it is.
      audio: tracks.audio && tracks.audio.fourcc === 'mp4a' && tracks.audio.description
        ? tracks.audio
        : null,
      audioDropped: Boolean(tracks.audio) && !(tracks.audio.fourcc === 'mp4a' && tracks.audio.description),
      audioCodec: tracks.audio ? tracks.audio.fourcc : null,
    };
  } catch (err) {
    return { ok: false, reason: 'unreadable', detail: err.message };
  } finally {
    await handle.close().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* what to aim for                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The encoder settings for one source at one level.
 *
 * Two rules do most of the work here, and both exist to stop the app offering
 * to make a file bigger:
 *
 *   - the target never goes above a share of what the source already spends,
 *     so a chat video already at 2 Mbps is not "improved" up to 2.8;
 *   - scaling only ever shrinks. A 640x480 clip at the *smallest* level keeps
 *     its size rather than being stretched to 1280.
 */
function settings(source, levelName) {
  const level = LEVELS[levelName] || LEVELS.balanced;
  const { width, height, samples, durationSec } = source.video;

  let outWidth = width;
  let outHeight = height;
  if (level.maxEdge) {
    const longest = Math.max(width, height);
    if (longest > level.maxEdge) {
      const scale = level.maxEdge / longest;
      // Both dimensions even: an odd one is not representable in the 4:2:0
      // chroma layout every one of these encoders uses.
      outWidth = Math.max(2, Math.round((width * scale) / 2) * 2);
      outHeight = Math.max(2, Math.round((height * scale) / 2) * 2);
    }
  }

  const seconds = durationSec || (samples.length / 30);
  const framerate = seconds > 0 ? Math.min(120, Math.max(1, samples.length / seconds)) : 30;
  const sourceBitrate = seconds > 0 ? (source.size * 8) / seconds : 0;

  const byPixels = outWidth * outHeight * framerate * level.bitsPerPixel;
  const ceiling = sourceBitrate * level.ceilingOfSource;
  const bitrate = Math.round(Math.max(120000, Math.min(byPixels, ceiling || byPixels)));

  return {
    level: levelName,
    width: outWidth,
    height: outHeight,
    scaled: outWidth !== width || outHeight !== height,
    framerate: Math.round(framerate * 100) / 100,
    bitrate,
    sourceBitrate: Math.round(sourceBitrate),
  };
}

/**
 * How many of the leading samples cover the trial.
 *
 * Whole groups of pictures, not a flat count. A key frame costs several times
 * what the frames after it cost, so a trial that stops in the middle of a group
 * has paid for a fresh start and not collected the cheap frames that follow —
 * and the estimate it produces reads high. This stops on the **last** key frame
 * inside the window, which means the trial is always a whole number of groups
 * and never longer than it was asked for.
 */
function trialSampleCount(samples, seconds) {
  const limit = seconds * 1e6;
  let last = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (!samples[i].key || samples[i].timestamp <= 0) continue;
    if (samples[i].timestamp > limit) break;
    last = i;
  }
  if (last) return last;

  // No key frame at all inside the window — one long group of pictures, which
  // a screen recorder of a still page will happily produce. Whole seconds
  // instead, so the trial is still bounded.
  let n = 0;
  while (n < samples.length && samples[n].timestamp <= limit) n += 1;
  return Math.max(1, n);
}

/* -------------------------------------------------------------------------- */
/* reading sample bytes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A batch of encoded samples, as bytes.
 *
 * Batched rather than handed over whole because the window is the other side of
 * a structured clone: one 62 MB message is a stall, and sixteen 4 MB ones are
 * not.
 */
async function readSamples(filePath, samples, from, count) {
  const wanted = samples.slice(from, from + count);
  if (!wanted.length) return [];

  const handle = await fsp.open(filePath, 'r');
  try {
    const out = [];
    for (const sample of wanted) {
      const buf = Buffer.alloc(sample.size);
      const { bytesRead } = await handle.read(buf, 0, sample.size, sample.offset);
      out.push({
        data: buf.subarray(0, bytesRead),
        timestamp: sample.timestamp,
        duration: sample.duration,
        key: sample.key,
      });
    }
    return out;
  } finally {
    await handle.close().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* writing the copy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Where the copy goes.
 *
 * Beside the original, which is the roadmap's word and the right one: a copy
 * in some other folder is a copy nobody finds when they come to compare the
 * two. A name already taken gets a number rather than being overwritten --
 * the same rule E2 settled on for backups, and for the same reason.
 */
async function destinationFor(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  let candidate = path.join(dir, `${base}${SUFFIX}`);
  for (let n = 2; n < 1000; n += 1) {
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${base} (${n})${SUFFIX}`);
  }
  throw new Error('no free name beside the original');
}

/**
 * Write the copy, then read it back and prove it is a video.
 *
 * Verification is not optional and it is not a formality. The one thing worse
 * than failing to shrink a file is producing a smaller file that nothing can
 * open -- which is exactly the shape of the `.jxl` finding in E5, where the
 * smaller copy of a photograph was the copy no decoder on this machine would
 * draw. So the copy is parsed back with the app's own reader before anybody is
 * told it exists, and a copy that does not parse is deleted rather than left on
 * the disk looking like a result.
 */
async function write(source, spec, destination) {
  const bytes = mux.build(spec);
  await fsp.writeFile(destination, bytes);

  let verified = null;
  try {
    const stats = await fsp.stat(destination);
    const handle = await fsp.open(destination, 'r');
    try {
      const read = async (offset, length) => {
        const buf = Buffer.alloc(Math.max(0, length));
        const { bytesRead } = await handle.read(buf, 0, buf.length, offset);
        return buf.subarray(0, bytesRead);
      };
      const head = await read(0, Math.min(64 * 1024, stats.size));
      const found = await bmff.locateMoov(read, stats.size, head);
      if (!found) throw new Error('the copy has no moov');
      const back = demux(found.moov);
      if (!back.video || !back.video.samples.length) throw new Error('the copy has no video track');
      if (back.video.samples.length !== spec.video.samples.length) {
        throw new Error(`the copy holds ${back.video.samples.length} frames, not ${spec.video.samples.length}`);
      }
      verified = {
        size: stats.size,
        codec: back.video.codec,
        width: back.video.width,
        height: back.video.height,
        frames: back.video.samples.length,
        hasAudio: Boolean(back.audio),
        durationSec: Math.round(back.video.durationSec * 10) / 10,
      };
    } finally {
      await handle.close().catch(() => {});
    }
  } catch (err) {
    await fsp.rm(destination, { force: true }).catch(() => {});
    throw new Error(`the copy could not be read back: ${err.message}`);
  }

  // The copy takes the original's timestamps. It is the same recording, and a
  // file dated today would sort to the top of a library ordered by date -- in
  // front of the thing it is a copy of.
  if (source.mtimeMs) {
    const when = new Date(source.mtimeMs);
    await fsp.utimes(destination, when, when).catch(() => {});
  }

  return verified;
}

module.exports = {
  open,
  settings,
  trialSampleCount,
  readSamples,
  destinationFor,
  write,
  LEVELS,
  SUFFIX,
  TRIAL_SECONDS,
};
