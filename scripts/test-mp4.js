#!/usr/bin/env node
'use strict';

// Taking an MP4 apart and putting one together (E3).
//
//   node scripts/test-mp4.js
//
// ## Why the fixtures are built by hand here too
//
// `test-media-format.js` gives the reason this project generates its fixtures
// rather than committing them, and it applies unchanged. There is a second
// reason specific to this file, and it is the more important one: the obvious
// way to test a muxer is to mux something and demux it again, and that proves
// nothing at all if both halves share a misreading. So the demuxer is tested
// against tables **written out by hand below**, byte by byte, with the offsets
// stated in the test rather than computed by the code under test.
//
// What this file cannot prove is that Windows and Chromium accept the result.
// That needs a real encoder, so it is checked where a real encoder exists:
// `scripts/shoot-e3.js` writes a copy with the app's own pipeline and then asks
// the Windows shell for a thumbnail of it and a `<video>` element to play it.

const demuxer = require('../src/main/lib/media/mp4/demux');
const mux = require('../src/main/lib/media/mp4/mux');
const encode = require('../src/main/lib/media/mp4/encode');
const bmff = require('../src/main/lib/media/bmff');
const fs = require('node:fs');

/** Checks that cannot answer synchronously. Awaited before the summary. */
const pending = [];

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
}

function full(type, version, flags, ...parts) {
  const head = Buffer.alloc(4);
  head[0] = version;
  head.writeUIntBE(flags, 1, 3);
  return box(type, head, ...parts);
}

/* -------------------------------------------------------------------------- */
/* a track, written out with every table stated rather than derived            */
/* -------------------------------------------------------------------------- */

/** A plausible `avcC`: version, profile, compatibility, level, then the rest. */
const AVCC = Buffer.from([0x01, 0x4d, 0x40, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x4d, 0x40, 0x1f, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);

function videoTrak(options = {}) {
  const {
    chunkOffsets = [1000, 2000],
    samplesPerChunk = [{ firstChunk: 1, perChunk: 3 }],
    sizes = [10, 20, 30, 40, 50, 60],
    deltas = [{ count: 6, value: 3000 }],
    syncSamples = [1, 4],
    composition = null,
    timescale = 90000,
    width = 1920,
    height = 1080,
    use64 = false,
    matrix = null,
  } = options;

  // VisualSampleEntry: 8 bytes of SampleEntry, then 70 of its own, then the
  // configuration box. Width and height sit 24 bytes into the specific part.
  const visual = box(
    'avc1',
    Buffer.alloc(6), u16(1),
    u16(0), u16(0), Buffer.alloc(12),
    u16(width), u16(height),
    u32(0x00480000), u32(0x00480000),
    u32(0), u16(1),
    Buffer.alloc(32),
    u16(0x0018), u16(0xffff),
    box('avcC', AVCC)
  );

  const tables = [
    full('stsd', 0, 0, u32(1), visual),
    full('stts', 0, 0, u32(deltas.length), ...deltas.flatMap((d) => [u32(d.count), u32(d.value)])),
  ];
  if (composition) {
    tables.push(full('ctts', 1, 0, u32(composition.length), ...composition.flatMap((c) => [u32(c.count), i32(c.value)])));
  }
  if (syncSamples) tables.push(full('stss', 0, 0, u32(syncSamples.length), ...syncSamples.map(u32)));
  tables.push(full('stsc', 0, 0, u32(samplesPerChunk.length),
    ...samplesPerChunk.flatMap((r) => [u32(r.firstChunk), u32(r.perChunk), u32(1)])));
  tables.push(
    Array.isArray(sizes)
      ? full('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32))
      : full('stsz', 0, 0, u32(sizes.uniform), u32(sizes.count))
  );
  if (use64) {
    tables.push(full('co64', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map((o) => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64BE(BigInt(o));
      return b;
    })));
  } else {
    tables.push(full('stco', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map(u32)));
  }

  const tkhd = full('tkhd', 0, 3,
    u32(0), u32(0), u32(1), u32(0), u32(1000),
    Buffer.alloc(8), u16(0), u16(0), u16(0), u16(0),
    matrix || Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]),
    u32(width * 65536), u32(height * 65536));

  return box('trak', tkhd, box('mdia',
    full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(18000), u16(0x55c4), u16(0)),
    full('hdlr', 0, 0, u32(0), Buffer.from('vide', 'latin1'), Buffer.alloc(12), Buffer.from('v\0', 'latin1')),
    box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), box('stbl', ...tables))));
}

/** An `esds` with a two-byte AudioSpecificConfig, lengths written minimally. */
function esds(config) {
  const descriptor = (tag, body) => {
    const out = [];
    let value = body.length;
    do { out.unshift(value & 0x7f); value >>= 7; } while (value > 0);
    for (let i = 0; i < out.length - 1; i += 1) out[i] |= 0x80;
    return Buffer.concat([Buffer.from([tag]), Buffer.from(out), body]);
  };
  const dsi = descriptor(0x05, config);
  const dcd = descriptor(0x04, Buffer.concat([
    Buffer.from([0x40, 0x15, 0, 0, 0]), u32(0), u32(0), dsi,
  ]));
  const sl = descriptor(0x06, Buffer.from([0x02]));
  return full('esds', 0, 0, descriptor(0x03, Buffer.concat([u16(1), Buffer.from([0]), dcd, sl])));
}

function audioTrak() {
  const entry = box('mp4a',
    Buffer.alloc(6), u16(1),
    Buffer.alloc(8),
    u16(2), u16(16), u16(0), u16(0),
    u32(48000 << 16),
    esds(Buffer.from([0x11, 0x90])));

  return box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(1000),
      Buffer.alloc(8), u16(0), u16(0), u16(0x0100), u16(0),
      Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]),
      u32(0), u32(0)),
    box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(48000), u32(48000), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), Buffer.from('soun', 'latin1'), Buffer.alloc(12), Buffer.from('a\0', 'latin1')),
      box('minf', full('smhd', 0, 0, u16(0), u16(0)),
        box('stbl',
          full('stsd', 0, 0, u32(1), entry),
          full('stts', 0, 0, u32(1), u32(4), u32(1024)),
          full('stsc', 0, 0, u32(1), u32(1), u32(4), u32(1)),
          full('stsz', 0, 0, u32(0), u32(4), u32(7), u32(8), u32(9), u32(10)),
          full('stco', 0, 0, u32(1), u32(5000))))));
}

const moovOf = (...traks) => Buffer.concat(traks.map((t) => t)).length
  ? box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(1000), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
      Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]),
      Buffer.alloc(24), u32(3)), ...traks)
  : null;

/** The body of a `moov` box, which is what `demux` takes. */
function bodyOfMoov(moovBox) {
  return moovBox.subarray(8);
}

/* -------------------------------------------------------------------------- */

console.log('\nmp4: the sample tables, against offsets stated by hand\n');

{
  const moov = bodyOfMoov(moovOf(videoTrak()));
  const { video } = demuxer.demux(moov);

  check('a video track is found', Boolean(video));
  check('with its codec string built from avcC', video.codec === 'avc1.4d401f', video && video.codec);
  check('and its dimensions off the sample entry', video.width === 1920 && video.height === 1080);
  check('every sample is accounted for', video.samples.length === 6, String(video.samples.length));

  // Chunk one holds samples 0-2 at 1000, chunk two holds 3-5 at 2000. The
  // offsets are written out here rather than derived, so a wrong `stsc` reading
  // fails this line instead of agreeing with itself.
  const offsets = video.samples.map((s) => s.offset);
  check('the first chunk lays its samples end to end',
    String(offsets.slice(0, 3)) === String([1000, 1010, 1030]), String(offsets.slice(0, 3)));
  check('and the second starts again at its own offset',
    String(offsets.slice(3)) === String([2000, 2040, 2090]), String(offsets.slice(3)));
  check('sizes come from stsz, in order',
    String(video.samples.map((s) => s.size)) === String([10, 20, 30, 40, 50, 60]));

  // 3000 ticks at 90 kHz is a thirtieth of a second.
  check('times are scaled by the media timescale',
    video.samples[1].timestamp === 33333, String(video.samples[1].timestamp));
  check('and so are durations', video.samples[0].duration === 33333, String(video.samples[0].duration));

  // `stss` is one-based: samples 1 and 4 means indexes 0 and 3.
  const keys = video.samples.filter((s) => s.key).map((s) => s.index);
  check('sync samples are read one-based', String(keys) === String([0, 3]), String(keys));
}

{
  // `first_chunk` is one-based, and a second run starting at chunk 2 is the
  // case that silently produces garbage when it is read zero-based.
  const moov = bodyOfMoov(moovOf(videoTrak({
    chunkOffsets: [100, 200, 300],
    samplesPerChunk: [{ firstChunk: 1, perChunk: 1 }, { firstChunk: 2, perChunk: 2 }],
    sizes: [5, 6, 7, 8, 9],
    deltas: [{ count: 5, value: 3000 }],
    syncSamples: [1],
  })));
  const { video } = demuxer.demux(moov);
  check('a second stsc run changes samples per chunk from its own chunk on',
    String(video.samples.map((s) => s.offset)) === String([100, 200, 206, 300, 308]),
    String(video.samples.map((s) => s.offset)));
}

{
  const moov = bodyOfMoov(moovOf(videoTrak({ sizes: { uniform: 12, count: 6 } })));
  const { video } = demuxer.demux(moov);
  check('a uniform stsz gives every sample the same size',
    video.samples.every((s) => s.size === 12) && video.samples.length === 6);
  check('and their offsets still step by it',
    video.samples[1].offset === 1012, String(video.samples[1].offset));
}

{
  const moov = bodyOfMoov(moovOf(videoTrak({ use64: true, chunkOffsets: [5_000_000_000, 6_000_000_000] })));
  const { video } = demuxer.demux(moov);
  check('co64 carries an offset past four gigabytes',
    video.samples[0].offset === 5_000_000_000, String(video.samples[0].offset));
}

{
  // A negative composition offset is how a file puts a frame earlier than its
  // decode position. Read unsigned it becomes four billion.
  const moov = bodyOfMoov(moovOf(videoTrak({
    composition: [{ count: 1, value: 0 }, { count: 1, value: -3000 }, { count: 4, value: 3000 }],
  })));
  const { video } = demuxer.demux(moov);
  check('ctts is read, and marked', video.hasCompositionOffsets === true);
  check('a negative composition offset stays negative',
    video.samples[1].timestamp < video.samples[1].decodeTime,
    `${video.samples[1].timestamp} vs ${video.samples[1].decodeTime}`);
  check('and a positive one pushes the frame later',
    video.samples[2].timestamp > video.samples[2].decodeTime);
}

{
  const moov = bodyOfMoov(moovOf(videoTrak(), audioTrak()));
  const { video, audio, tracks } = demuxer.demux(moov);
  check('both tracks are found', tracks.length === 2 && Boolean(video) && Boolean(audio));
  check('the audio codec string comes out of the esds descriptors',
    audio.codec === 'mp4a.40.2', audio && audio.codec);
  check('and its configuration is the two bytes that were written',
    audio.description && audio.description.length === 2 && audio.description[0] === 0x11,
    audio.description ? audio.description.toString('hex') : 'none');
  check('the audio sample rate is read out of the 16.16 field',
    audio.sampleRate === 48000, String(audio.sampleRate));
  check('and the channel count', audio.channels === 2, String(audio.channels));
}

{
  // A descriptor length of 200 needs two bytes with a continuation bit, which
  // is the case a fixed-width read gets wrong.
  const long = Buffer.alloc(200, 0x11);
  const parsed = demuxer.parseEsds(esds(long).subarray(8));
  check('a multi-byte descriptor length is followed',
    parsed && parsed.specific && parsed.specific.length === 200,
    parsed && parsed.specific ? String(parsed.specific.length) : 'none');
}

console.log('\nmp4: writing one, and reading it back\n');

const chunkBytes = (n, fill) => Buffer.alloc(n, fill);

{
  const samples = [
    { data: chunkBytes(120, 1), timestamp: 0, duration: 33333, key: true },
    { data: chunkBytes(40, 2), timestamp: 33333, duration: 33333, key: false },
    { data: chunkBytes(45, 3), timestamp: 66666, duration: 33333, key: false },
    { data: chunkBytes(130, 4), timestamp: 99999, duration: 33333, key: true },
  ];
  const built = mux.build({
    video: { fourcc: 'avc1', codecConfig: AVCC, width: 640, height: 360, framerate: 30, samples },
  });

  const top = bmff.boxes(built).map((b) => b.type);
  check('the file opens with ftyp', top[0] === 'ftyp', top.join(','));
  check('and metadata comes before media', top.indexOf('moov') < top.indexOf('mdat'), top.join(','));
  check('with nothing else at the top level', top.length === 3, top.join(','));

  const moovBox = bmff.boxes(built).find((b) => b.type === 'moov');
  const { video } = demuxer.demux(bmff.bodyOf(built, moovBox));
  check('the copy declares the frames that went in',
    video.samples.length === 4, String(video.samples.length));
  check('and its dimensions', video.width === 640 && video.height === 360);

  // The real test of the offsets: follow them into the file and compare bytes.
  let identical = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const at = video.samples[i];
    if (at.size === samples[i].data.length
        && built.subarray(at.offset, at.offset + at.size).equals(samples[i].data)) identical += 1;
  }
  check('every chunk offset lands on the bytes that were written',
    identical === 4, `${identical}/4`);

  const keys = video.samples.filter((s) => s.key).map((s) => s.index);
  check('key frames survive as sync samples', String(keys) === String([0, 3]), String(keys));
  check('monotonic timestamps need no ctts at all',
    video.hasCompositionOffsets === false);
}

{
  // Out-of-order presentation stamps are what B-frames look like coming out of
  // an encoder, and writing them as decode times plays the video backwards in
  // bursts.
  const samples = [
    { data: chunkBytes(50, 1), timestamp: 0, duration: 33333, key: true },
    { data: chunkBytes(50, 2), timestamp: 99999, duration: 33333, key: false },
    { data: chunkBytes(50, 3), timestamp: 33333, duration: 33333, key: false },
    { data: chunkBytes(50, 4), timestamp: 66666, duration: 33333, key: false },
  ];
  const built = mux.build({
    video: { fourcc: 'avc1', codecConfig: AVCC, width: 320, height: 240, framerate: 30, samples },
  });
  const moovBox = bmff.boxes(built).find((b) => b.type === 'moov');
  const { video } = demuxer.demux(bmff.bodyOf(built, moovBox));
  check('out-of-order stamps produce a ctts', video.hasCompositionOffsets === true);
  const presented = video.samples.map((s) => s.timestamp);
  check('and the presentation order is restored through it',
    presented[1] > presented[2] && presented[2] > presented[3] === false,
    String(presented));
}

{
  const turned = Buffer.concat([
    u32(0), u32(0x00010000), u32(0),
    i32(-65536), u32(0), u32(0),
    u32(0), u32(0), u32(0x40000000),
  ]);
  const built = mux.build({
    createdAt: Date.UTC(2021, 4, 17, 9, 30, 0),
    video: {
      fourcc: 'avc1', codecConfig: AVCC, width: 1080, height: 1920, framerate: 30, matrix: turned,
      samples: [{ data: chunkBytes(30, 1), timestamp: 0, duration: 33333, key: true }],
    },
  });
  const moovBox = bmff.boxes(built).find((b) => b.type === 'moov');
  const moovBody = bmff.bodyOf(built, moovBox);
  const { video } = demuxer.demux(moovBody);
  check('a quarter turn is carried into the copy',
    video.matrix && video.matrix.equals(turned),
    video.matrix ? video.matrix.toString('hex').slice(0, 16) : 'none');

  const parsed = bmff.parseMoov(moovBody);
  const when = parsed.createdAt ? new Date(parsed.createdAt).toISOString().slice(0, 10) : 'none';
  check('and so is the capture date, not the date of the copy', when === '2021-05-17', when);
}

{
  const audioSamples = [7, 8, 9, 10].map((n, i) => ({ data: chunkBytes(n, 20 + i), durationTicks: 1024 }));
  const built = mux.build({
    video: {
      fourcc: 'avc1', codecConfig: AVCC, width: 320, height: 240, framerate: 30,
      samples: [{ data: chunkBytes(30, 1), timestamp: 0, duration: 33333, key: true }],
    },
    audio: {
      fourcc: 'mp4a', config: Buffer.from([0x11, 0x90]), channels: 2, sampleRate: 48000,
      timescale: 48000, samples: audioSamples,
    },
  });
  const moovBox = bmff.boxes(built).find((b) => b.type === 'moov');
  const { video, audio } = demuxer.demux(bmff.bodyOf(built, moovBox));
  check('an audio track is written beside the video', Boolean(audio) && Boolean(video));
  check('its codec survives the trip', audio && audio.codec === 'mp4a.40.2', audio && audio.codec);
  let same = 0;
  for (let i = 0; i < audioSamples.length; i += 1) {
    const at = audio.samples[i];
    if (built.subarray(at.offset, at.offset + at.size).equals(audioSamples[i].data)) same += 1;
  }
  check('and every audio sample is byte for byte what went in', same === 4, `${same}/4`);
}

{
  let threw = null;
  try {
    mux.build({ video: { fourcc: 'avc1', codecConfig: AVCC, width: 2, height: 2, samples: [] } });
  } catch (err) {
    threw = err.message;
  }
  check('writing nothing is refused rather than producing an empty file', Boolean(threw), threw || 'no throw');
}

console.log('\nmp4: what to aim for, and where the copy goes\n');

const fakeSource = (over = {}) => ({
  size: over.size || 60 * 1024 * 1024,
  video: {
    width: over.width || 1920,
    height: over.height || 1080,
    durationSec: over.durationSec || 60,
    samples: new Array(over.sampleCount || 1800).fill(0).map((_, i) => ({
      timestamp: Math.round((i / 30) * 1e6),
      key: i % 60 === 0,
      index: i,
    })),
  },
});

{
  const s = encode.settings(fakeSource(), 'balanced');
  check('the balanced level keeps the picture the same size',
    s.width === 1920 && s.height === 1080 && s.scaled === false);
  check('and aims below what the source already spends',
    s.bitrate < s.sourceBitrate, `${s.bitrate} vs ${s.sourceBitrate}`);
}

{
  const s = encode.settings(fakeSource(), 'smallest');
  check('the smallest level brings the long edge down to 1280',
    s.width === 1280 && s.scaled === true, `${s.width}x${s.height}`);
  check('and keeps both dimensions even, for 4:2:0',
    s.width % 2 === 0 && s.height % 2 === 0, `${s.width}x${s.height}`);
  check('it aims lower than the balanced level',
    s.bitrate < encode.settings(fakeSource(), 'balanced').bitrate);
}

{
  // A chat video already at about 2 Mbps. Aiming at a pixel count alone would
  // propose to make it *bigger*, which is the one outcome this must never have.
  const chat = fakeSource({ width: 720, height: 1280, size: 15 * 1024 * 1024, durationSec: 60 });
  const s = encode.settings(chat, 'balanced');
  check('a file already small for its size is never aimed higher',
    s.bitrate < s.sourceBitrate, `${s.bitrate} vs ${s.sourceBitrate}`);
}

{
  const small = fakeSource({ width: 640, height: 480 });
  const s = encode.settings(small, 'smallest');
  check('scaling only ever shrinks — a small video is not stretched up',
    s.width === 640 && s.height === 480 && s.scaled === false, `${s.width}x${s.height}`);
}

{
  const samples = fakeSource().video.samples;
  const n = encode.trialSampleCount(samples, 10);
  check('the trial stops on a key frame, not at a flat count',
    samples[n] && samples[n].key === true, String(n));
  check('and covers about the ten seconds it was asked for',
    samples[n].timestamp / 1e6 <= 10 && samples[n].timestamp / 1e6 > 5,
    `${(samples[n].timestamp / 1e6).toFixed(1)}s`);
}

{
  // One long group of pictures: there is no second key frame to stop at, so it
  // falls back to whole seconds rather than returning nothing.
  const allOne = {
    video: {
      samples: new Array(600).fill(0).map((_, i) => ({
        timestamp: Math.round((i / 30) * 1e6), key: i === 0, index: i,
      })),
    },
  };
  const n = encode.trialSampleCount(allOne.video.samples, 10);
  check('a file with one key frame still yields a trial', n > 1 && n <= 301, String(n));
}

console.log('\nmp4: a file this cannot take apart, said properly\n');

{
  // A fragmented file keeps its sample positions in `moof` boxes and says so
  // with `mvex`. Reading the tables inside `moov` finds them empty, which is
  // true of the tables and false about the file -- so the refusal has to name
  // the real reason rather than claim there is no video in it.
  //
  // Chromium's own `MediaRecorder` writes this layout, so this is not a
  // hypothetical: anything captured in a browser arrives looking like this.
  const empty = (type) => full(type, 0, 0, u32(0));
  const fragTrak = box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(0),
      Buffer.alloc(8), u16(0), u16(0), u16(0), u16(0),
      Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]),
      u32(640 * 65536), u32(360 * 65536)),
    box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(90000), u32(0), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), Buffer.from('vide', 'latin1'), Buffer.alloc(12), Buffer.from('v\0', 'latin1')),
      box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
        box('stbl',
          full('stsd', 0, 0, u32(1), box('avc1', Buffer.alloc(6), u16(1), u16(0), u16(0), Buffer.alloc(12),
            u16(640), u16(360), u32(0x00480000), u32(0x00480000), u32(0), u16(1), Buffer.alloc(32),
            u16(0x0018), u16(0xffff), box('avcC', AVCC))),
          empty('stts'), empty('stsc'),
          full('stsz', 0, 0, u32(0), u32(0)), empty('stco')))));

  const moovBox = box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
      Buffer.concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]),
      Buffer.alloc(24), u32(2)),
    box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0))),
    fragTrak);

  const file = Buffer.concat([
    box('ftyp', Buffer.from('iso5', 'latin1'), u32(0x200), Buffer.from('iso6', 'latin1')),
    moovBox,
  ]);

  const os = require('node:os');
  const pathMod = require('node:path');
  const temp = pathMod.join(os.tmpdir(), `cleandrive-test-mp4-frag-${process.pid}.mp4`);
  fs.writeFileSync(temp, file);
  // Removed however this process ends, not at the end of a block that a throw
  // would skip.
  process.on('exit', () => { try { fs.rmSync(temp, { force: true }); } catch { /* exiting */ } });

  const { video } = demuxer.demux(bodyOfMoov(moovBox));
  check('the tables inside a fragmented moov yield no track', video === null || video === undefined,
    video ? `${video.samples.length} samples` : 'none');

  pending.push(encode.open(temp).then((source) => {
    check('and the refusal names fragmentation rather than a missing video track',
      source.ok === false && source.reason === 'fragmented', `${source.ok} / ${source.reason}`);
  }));
}

Promise.all(pending).then(() => {
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
});
