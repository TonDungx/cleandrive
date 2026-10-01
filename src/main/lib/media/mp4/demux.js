'use strict';

/**
 * Taking an MP4 apart into the samples a decoder can be fed (E3).
 *
 * ## Why this is not in `bmff.js`
 *
 * `bmff.js` answers "what is this file" from a few boxes near the top of
 * `moov`: a duration, a resolution, a camera name. It never needs to know where
 * a single frame lives. This file needs exactly that and nothing else, and the
 * tables it reads -- `stts`, `stsz`, `stsc`, `stco`, `stss`, `ctts` -- are
 * large, awkward and used by one feature. Keeping them apart means the scan,
 * which runs over eleven thousand files, does not carry the cost of a parser
 * only ten of them will ever reach.
 *
 * It does use `bmff.js` for the box walk, because there is exactly one correct
 * way to walk boxes and that file already got the awkward parts right.
 *
 * ## The four tables, and why all four are needed
 *
 * A sample's position is not stored anywhere. It is reconstructed:
 *
 *   `stco` says where each *chunk* starts.
 *   `stsc` says how many samples are in each chunk, as runs rather than a list.
 *   `stsz` says how big each sample is.
 *
 * So the offset of sample *n* is its chunk's offset plus the sizes of the
 * samples before it in that chunk. Get `stsc` wrong -- it is the one stored as
 * runs, and its `first_chunk` is **one-based** -- and every offset after the
 * first chunk is wrong, which does not throw: it feeds the decoder garbage that
 * happens to be the right length.
 *
 * `stts` then gives durations, also as runs, and `ctts` gives the gap between
 * decode order and presentation order. A file with B-frames stores frames out
 * of order, and a decoder handed decode-order timestamps emits a video that
 * stutters backwards. Measured on this machine's library: the nine screen
 * recordings have no `ctts` at all, and the camera clips do.
 *
 * ## No I/O
 *
 * Like `bmff.js`, this takes bytes rather than a path. The sample index it
 * returns holds offsets into the original file, so the caller decides whether
 * to read them all at once or a batch at a time.
 */

const bmff = require('../bmff');

/** A sample entry's child boxes start this far into the box, by kind. */
const VISUAL_SAMPLE_ENTRY = 8 + 78;
const AUDIO_SAMPLE_ENTRY = 8 + 28;

/**
 * Codec four-character codes this can describe.
 *
 * Anything else is reported by name and left alone: saying "this file holds
 * MPEG-4 Part 2 and I cannot re-encode it" is a fact about the file, and it is
 * better than a parser that half-understands it.
 */
const VIDEO_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09']);
const AUDIO_CODECS = new Set(['mp4a', 'Opus', 'opus', 'alac', 'lpcm', 'sowt', 'twos']);

function childBox(body, type) {
  for (const box of bmff.boxes(body)) {
    if (box.type === type) return bmff.bodyOf(body, box);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* the tables                                                                  */
/* -------------------------------------------------------------------------- */

/** `stsz`: one size each, or a single size for all of them. */
function readSizes(stsz) {
  const uniform = stsz.readUInt32BE(4);
  const count = stsz.readUInt32BE(8);
  if (uniform) return { count, sizes: null, uniform };
  const sizes = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 4;
    if (at + 4 > stsz.length) break;
    sizes[i] = stsz.readUInt32BE(at);
  }
  return { count, sizes, uniform: 0 };
}

/** `stco` is 32-bit, `co64` is 64-bit; a file over 4 GB has the second. */
function readOffsets(stco, co64) {
  const out = [];
  if (co64) {
    const n = co64.readUInt32BE(4);
    for (let i = 0; i < n; i += 1) {
      const at = 8 + i * 8;
      if (at + 8 > co64.length) break;
      out.push(Number(co64.readBigUInt64BE(at)));
    }
    return out;
  }
  const n = stco.readUInt32BE(4);
  for (let i = 0; i < n; i += 1) {
    const at = 8 + i * 4;
    if (at + 4 > stco.length) break;
    out.push(stco.readUInt32BE(at));
  }
  return out;
}

/**
 * `stsc`, as runs. `first_chunk` is one-based, which is the single most
 * expensive off-by-one in this format.
 */
function readChunkRuns(stsc) {
  const n = stsc.readUInt32BE(4);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const at = 8 + i * 12;
    if (at + 12 > stsc.length) break;
    out.push({ firstChunk: stsc.readUInt32BE(at), perChunk: stsc.readUInt32BE(at + 4) });
  }
  return out;
}

/** `stts` and `ctts` share a shape: a list of (count, value) runs. */
function readRuns(table, signed) {
  if (!table) return [];
  const n = table.readUInt32BE(4);
  const version = table[0];
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const at = 8 + i * 8;
    if (at + 8 > table.length) break;
    const count = table.readUInt32BE(at);
    // `ctts` version 1 made the offset signed, which matters: a negative
    // composition offset is how a file puts a frame *earlier* than its decode
    // position, and reading it unsigned turns it into four billion.
    const value = signed && version === 1 ? table.readInt32BE(at + 4) : table.readUInt32BE(at + 4);
    out.push({ count, value });
  }
  return out;
}

/** Flatten (count, value) runs into one value per sample. */
function expand(runs, total, fallback) {
  const out = new Array(total).fill(fallback);
  let i = 0;
  for (const run of runs) {
    for (let k = 0; k < run.count && i < total; k += 1, i += 1) out[i] = run.value;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* codec strings                                                               */
/* -------------------------------------------------------------------------- */

const hex2 = (n) => n.toString(16).padStart(2, '0');

/**
 * The string `VideoDecoder.configure` wants, built from the configuration
 * record rather than guessed.
 *
 * `avc1` alone is not a codec string any WebCodecs implementation accepts; it
 * needs the profile, the constraint byte and the level, which are bytes 1 to 3
 * of `avcC`. Measured on this library: `avc1.4d0029` for the screen
 * recordings, `avc1.640028` and `avc1.4d401f` elsewhere.
 */
function videoCodecString(fourcc, config) {
  if ((fourcc === 'avc1' || fourcc === 'avc3') && config && config.length >= 4) {
    return `${fourcc}.${hex2(config[1])}${hex2(config[2])}${hex2(config[3])}`;
  }
  if ((fourcc === 'hvc1' || fourcc === 'hev1') && config && config.length >= 13) {
    // hvcC: configurationVersion(1), then profile_space(2 bits) / tier(1) /
    // profile_idc(5), then 4 bytes of compatibility flags, 6 of constraints,
    // then the level. Assembled in the shape RFC 6381 asks for.
    const profileSpace = ['', 'A', 'B', 'C'][config[1] >> 6];
    const tier = (config[1] & 0x20) ? 'H' : 'L';
    const profile = config[1] & 0x1f;
    const compat = config.readUInt32BE(2);
    // The compatibility flags go out in reverse bit order, which is the one
    // part of this string that cannot be read off the bytes directly.
    let reversed = 0;
    for (let i = 0; i < 32; i += 1) reversed |= ((compat >> i) & 1) << (31 - i);
    const constraints = [];
    for (let i = 6; i < 12; i += 1) {
      if (config[i]) constraints.push(hex2(config[i]));
    }
    while (constraints.length && constraints[constraints.length - 1] === '00') constraints.pop();
    return [
      `${fourcc}.${profileSpace}${profile}`,
      (reversed >>> 0).toString(16),
      `${tier}${config[12]}`,
      ...constraints,
    ].join('.');
  }
  return fourcc;
}

/**
 * MPEG-4 descriptors, which is how an `esds` box hides the AAC configuration.
 *
 * Lengths are stored seven bits at a time with a continuation bit, so they
 * cannot be read as a fixed-width field.
 */
function parseEsds(esds) {
  if (!esds || esds.length < 5) return null;
  let i = 4; // version and flags

  const readLength = () => {
    let value = 0;
    for (let k = 0; k < 4 && i < esds.length; k += 1) {
      const byte = esds[i];
      i += 1;
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) break;
    }
    return value;
  };

  let objectType = 0;
  let specific = null;

  while (i < esds.length) {
    const tag = esds[i];
    i += 1;
    const length = readLength();
    const end = Math.min(i + length, esds.length);

    if (tag === 0x03) {
      // ES_Descriptor: id(2) then flags(1), with optional extras behind flags.
      if (i + 3 > esds.length) break;
      const flags = esds[i + 2];
      i += 3;
      if (flags & 0x80) i += 2;
      if (flags & 0x40) i += 1 + (esds[i] || 0);
      if (flags & 0x20) i += 2;
      continue; // descend
    }
    if (tag === 0x04) {
      // DecoderConfigDescriptor: objectTypeIndication first.
      objectType = esds[i];
      i += 13;
      continue; // descend
    }
    if (tag === 0x05) {
      specific = Buffer.from(esds.subarray(i, end));
      break;
    }
    i = end;
  }

  return { objectType, specific };
}

/**
 * `mp4a.40.2` and friends. The trailing number is the audio object type, which
 * lives in the top five bits of the AudioSpecificConfig rather than in the box
 * that contains it.
 */
function audioCodecString(fourcc, esds) {
  if (fourcc !== 'mp4a') return fourcc === 'Opus' ? 'opus' : fourcc;
  if (!esds || !esds.objectType) return 'mp4a.40.2';
  const audioObjectType = esds.specific && esds.specific.length ? esds.specific[0] >> 3 : 2;
  return `mp4a.${hex2(esds.objectType)}.${audioObjectType || 2}`;
}

/* -------------------------------------------------------------------------- */
/* one track                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The 3x3 transform on `tkhd`, which is where a quarter turn is recorded.
 *
 * A phone shooting portrait stores landscape pixels and a rotation here, and a
 * decoder hands back the landscape pixels. A copy that drops this matrix is a
 * video on its side -- the same mistake `probe.js` documents for EXIF
 * `orientation`, in the format that invented it.
 */
function readMatrix(tkhd) {
  if (!tkhd) return null;
  const offset = tkhd[0] === 1 ? 4 + 32 + 16 : 4 + 20 + 16;
  if (tkhd.length < offset + 36) return null;
  return Buffer.from(tkhd.subarray(offset, offset + 36));
}

function readTrack(moovBody, trakBody) {
  const mdia = childBox(trakBody, 'mdia');
  if (!mdia) return null;

  const hdlr = childBox(mdia, 'hdlr');
  if (!hdlr || hdlr.length < 12) return null;
  const handler = hdlr.toString('latin1', 8, 12);
  if (handler !== 'vide' && handler !== 'soun') return null;

  const mdhd = childBox(mdia, 'mdhd');
  let timescale = 0;
  let duration = 0;
  if (mdhd && mdhd.length >= 24) {
    if (mdhd[0] === 1) {
      timescale = mdhd.readUInt32BE(20);
      duration = Number(mdhd.readBigUInt64BE(24));
    } else {
      timescale = mdhd.readUInt32BE(12);
      duration = mdhd.readUInt32BE(16);
    }
  }
  if (!timescale) return null;

  const minf = childBox(mdia, 'minf');
  const stbl = minf && childBox(minf, 'stbl');
  if (!stbl) return null;

  const stsd = childBox(stbl, 'stsd');
  const stts = childBox(stbl, 'stts');
  const stsz = childBox(stbl, 'stsz');
  const stsc = childBox(stbl, 'stsc');
  const stco = childBox(stbl, 'stco');
  const co64 = childBox(stbl, 'co64');
  const stss = childBox(stbl, 'stss');
  const ctts = childBox(stbl, 'ctts');
  if (!stsd || !stts || !stsz || !stsc || (!stco && !co64)) return null;

  /* -- the sample entry ---------------------------------------------------- */

  // `stsd` is a full box: version/flags(4), entry_count(4), then the entries.
  // `bmff.js` lists `stsd` as a container, so its body arrives already past the
  // header but not past those eight bytes.
  const entryArea = stsd.subarray(8);
  const first = bmff.boxes(entryArea)[0];
  if (!first) return null;
  const fourcc = first.type;
  const entry = entryArea.subarray(first.at, first.end);

  const track = {
    kind: handler === 'vide' ? 'video' : 'audio',
    fourcc,
    timescale,
    durationSec: duration / timescale,
    supported: handler === 'vide' ? VIDEO_CODECS.has(fourcc) : AUDIO_CODECS.has(fourcc),
    description: null,
    codec: fourcc,
  };

  if (handler === 'vide') {
    if (entry.length >= 36) {
      track.width = entry.readUInt16BE(32);
      track.height = entry.readUInt16BE(34);
    }
    track.matrix = readMatrix(childBox(trakBody, 'tkhd'));
    const children = entry.subarray(VISUAL_SAMPLE_ENTRY);
    for (const b of bmff.boxes(children)) {
      if (b.type === 'avcC' || b.type === 'hvcC' || b.type === 'av1C' || b.type === 'vpcC') {
        track.description = Buffer.from(bmff.bodyOf(children, b));
      }
    }
    track.codec = videoCodecString(fourcc, track.description);
  } else {
    if (entry.length >= 36) {
      track.channels = entry.readUInt16BE(24);
      track.sampleRate = entry.readUInt32BE(32) >>> 16;
    }
    const children = entry.subarray(AUDIO_SAMPLE_ENTRY);
    let esds = null;
    for (const b of bmff.boxes(children)) {
      if (b.type === 'esds') esds = parseEsds(bmff.bodyOf(children, b));
      if (b.type === 'dOps') track.description = Buffer.from(bmff.bodyOf(children, b));
    }
    if (esds && esds.specific) track.description = esds.specific;
    track.codec = audioCodecString(fourcc, esds);
  }

  /* -- rebuild the sample positions ---------------------------------------- */

  const { count, sizes, uniform } = readSizes(stsz);
  const offsets = readOffsets(stco, co64);
  const runs = readChunkRuns(stsc);
  if (!count || !offsets.length || !runs.length) return null;

  const sizeOf = (i) => (sizes ? sizes[i] : uniform);

  const samples = new Array(count);
  let index = 0;
  for (let chunk = 0; chunk < offsets.length && index < count; chunk += 1) {
    // Which run this chunk falls in. `firstChunk` is one-based.
    let perChunk = runs[runs.length - 1].perChunk;
    for (let r = 0; r < runs.length; r += 1) {
      const nextFirst = r + 1 < runs.length ? runs[r + 1].firstChunk : Infinity;
      if (chunk + 1 >= runs[r].firstChunk && chunk + 1 < nextFirst) {
        perChunk = runs[r].perChunk;
        break;
      }
    }
    let at = offsets[chunk];
    for (let k = 0; k < perChunk && index < count; k += 1) {
      const size = sizeOf(index);
      samples[index] = { offset: at, size, index };
      at += size;
      index += 1;
    }
  }
  if (index < count) samples.length = index;

  /* -- and their times ------------------------------------------------------ */

  const deltas = expand(readRuns(stts, false), samples.length, 0);
  const shifts = ctts ? expand(readRuns(ctts, true), samples.length, 0) : null;

  // Sync samples are listed one-based too. With no `stss` every sample is a
  // sync sample, which is what an all-intra file means by omitting the table.
  const keys = new Set();
  if (stss) {
    const n = stss.readUInt32BE(4);
    for (let i = 0; i < n; i += 1) {
      const at = 8 + i * 4;
      if (at + 4 > stss.length) break;
      keys.add(stss.readUInt32BE(at) - 1);
    }
  }

  const toMicro = (ticks) => Math.round((ticks / timescale) * 1e6);

  let decodeTime = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    s.decodeTime = toMicro(decodeTime);
    // Presentation time is where the frame belongs on screen; decode time is
    // where it sits in the file. They differ exactly when `ctts` is present.
    s.timestamp = toMicro(decodeTime + (shifts ? shifts[i] : 0));
    s.duration = toMicro(deltas[i]);
    s.key = stss ? keys.has(i) : true;
    decodeTime += deltas[i];
  }

  track.hasCompositionOffsets = Boolean(ctts);
  track.samples = samples;
  track.bytes = samples.reduce((sum, s) => sum + s.size, 0);
  return track;
}

/* -------------------------------------------------------------------------- */

/**
 * Describe every track in an MP4.
 *
 * @param {Buffer} moovBody  the contents of `moov`, header already stripped --
 *                           the same thing `bmff.locateMoov` hands back, so a
 *                           caller that has already found it does not pay for
 *                           the hops twice
 * @returns {{video: object|null, audio: object|null, tracks: object[]}}
 */
function demux(moovBody) {
  const tracks = [];
  if (!moovBody) return { video: null, audio: null, tracks };

  for (const box of bmff.boxes(moovBody)) {
    if (box.type !== 'trak') continue;
    const track = readTrack(moovBody, bmff.bodyOf(moovBody, box));
    if (track) tracks.push(track);
  }

  // The largest visual track is the one a person would call "the video"; the
  // others are cover art and, on a phone, sometimes a depth map.
  const video = tracks
    .filter((t) => t.kind === 'video')
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0] || null;
  const audio = tracks.find((t) => t.kind === 'audio') || null;

  return { video, audio, tracks };
}

module.exports = {
  demux,
  videoCodecString,
  audioCodecString,
  parseEsds,
  VIDEO_CODECS,
  AUDIO_CODECS,
};
