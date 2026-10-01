'use strict';

/**
 * Writing an MP4 (E3).
 *
 * ## Why this exists at all
 *
 * The roadmap approved ffmpeg for this item because all three of the spec's
 * options looked like they broke a rule. Measured afterwards, the third one
 * does not: Chromium 130 has `VideoDecoder` and `VideoEncoder`, they are
 * available from the `file://` origin the window already loads from, and on
 * this machine they run at 660 frames a second decoding and 109 encoding at
 * 1080p. What Chromium will *not* do is put the result in a file. `MediaRecorder`
 * does emit `video/mp4`, and the bytes are real -- this project's own `bmff.js`
 * reads them -- but it is tied to real time: three hundred frames pushed
 * through a `MediaStreamTrackGenerator` in 74 ms came back as **zero bytes**,
 * because a recorder samples a track at the rate a camera would produce it.
 *
 * So the encoder is free and the muxer is not. This is the muxer. It is the
 * same trade `lib/archive-zip.js` made for B5: a well-specified container
 * written by hand costs a few hundred lines once, and a dependency costs
 * forever.
 *
 * ## Layout: `moov` first
 *
 * `ftyp`, `moov`, `mdat` -- metadata before media. Eleven of eleven videos on
 * this machine are written the other way round, because a recorder cannot know
 * the duration until it stops, and `bmff.js` carries the measurement and the
 * hop-by-hop search that copes with it. Nothing here has that excuse: the whole
 * file is known before a byte is written, so it is written in the order that
 * lets a player start without seeking to the end.
 *
 * That costs one awkwardness. `stco` holds absolute file offsets, so `moov`
 * cannot be written until its own length is known. The fix is to build it once
 * with zeroed offsets, measure it, and build it again -- the length cannot
 * change between the two passes because every offset field is fixed-width.
 *
 * ## What it refuses to carry
 *
 * **Location.** A video's `moov` can hold coordinates, and `analyzers/media.js`
 * reads them. Writing them into a copy would be writing coordinates to a file
 * this app creates, which is the exact thing `test-media-map.js` reads the
 * source of `report/`, `snapshots/` and `journal.js` to forbid. The rotation
 * and the capture date survive a re-encode; the position deliberately does not,
 * and the screen says so rather than letting someone assume it was kept.
 */

/** Seconds between the BMFF epoch (1904-01-01) and the Unix epoch. */
const EPOCH_OFFSET_SEC = 2082844800;

/** The movie timescale. Milliseconds, which every player handles. */
const MOVIE_TIMESCALE = 1000;

/**
 * The media timescale for a re-encoded track.
 *
 * 90 kHz is the usual choice and it is not arbitrary: it divides exactly by
 * 24, 25, 30, 50 and 60, so none of the common frame rates accumulates a
 * rounding drift across a long recording.
 */
const VIDEO_TIMESCALE = 90000;

/* -------------------------------------------------------------------------- */
/* box plumbing                                                                */
/* -------------------------------------------------------------------------- */

function box(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
}

/** A FullBox: the same thing with a version and three flag bytes in front. */
function fullBox(type, version, flags, ...parts) {
  const head = Buffer.alloc(4);
  head[0] = version;
  head.writeUIntBE(flags, 1, 3);
  return box(type, head, ...parts);
}

const u8 = (n) => Buffer.from([n & 0xff]);

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n >>> 0, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function i32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n | 0, 0);
  return b;
}

function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.max(0, Math.round(n))), 0);
  return b;
}

/** 16.16 fixed point, which is how this format stores every dimension. */
const fixed16 = (n) => u32(Math.round(n * 65536));

/** The identity transform, which every `tkhd` and `mvhd` carries. */
const MATRIX = Buffer.concat([
  u32(0x00010000), u32(0), u32(0),
  u32(0), u32(0x00010000), u32(0),
  u32(0), u32(0), u32(0x40000000),
]);

/* -------------------------------------------------------------------------- */
/* sample tables                                                               */
/* -------------------------------------------------------------------------- */

/** `stts`, from one duration per sample, collapsed back into runs. */
function stts(durations) {
  const runs = [];
  for (const d of durations) {
    const last = runs[runs.length - 1];
    if (last && last.value === d) last.count += 1;
    else runs.push({ count: 1, value: d });
  }
  return fullBox('stts', 0, 0, u32(runs.length), ...runs.flatMap((r) => [u32(r.count), u32(r.value)]));
}

/** `ctts`, written only when decode order and presentation order differ. */
function ctts(offsets) {
  const runs = [];
  for (const o of offsets) {
    const last = runs[runs.length - 1];
    if (last && last.value === o) last.count += 1;
    else runs.push({ count: 1, value: o });
  }
  // Version 1, so a frame can sit earlier than its decode position without the
  // offset wrapping to four billion.
  return fullBox('ctts', 1, 0, u32(runs.length), ...runs.flatMap((r) => [u32(r.count), i32(r.value)]));
}

/** `stss`, omitted entirely when every sample is a sync sample. */
function stss(keyIndexes) {
  return fullBox('stss', 0, 0, u32(keyIndexes.length), ...keyIndexes.map((i) => u32(i + 1)));
}

/**
 * `stsc`. One sample per chunk, which makes this table a single run and every
 * sample's offset its own chunk offset -- the simplest arrangement that is
 * still correct, and the one that costs nothing to get right.
 */
function stsc() {
  return fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1));
}

function stsz(sizes) {
  return fullBox('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map((s) => u32(s)));
}

function chunkOffsets(offsets, use64) {
  return use64
    ? fullBox('co64', 0, 0, u32(offsets.length), ...offsets.map((o) => u64(o)))
    : fullBox('stco', 0, 0, u32(offsets.length), ...offsets.map((o) => u32(o)));
}

/* -------------------------------------------------------------------------- */
/* sample entries                                                              */
/* -------------------------------------------------------------------------- */

function visualSampleEntry(fourcc, width, height, configType, config) {
  return box(
    fourcc,
    Buffer.alloc(6), u16(1),                    // reserved, data_reference_index
    u16(0), u16(0), Buffer.alloc(12),           // pre_defined, reserved, pre_defined[3]
    u16(width), u16(height),
    fixed16(72), fixed16(72),                   // 72 dpi, the format's default
    u32(0), u16(1),                             // reserved, frame_count
    Buffer.alloc(32),                           // compressorname, left empty
    u16(0x0018), u16(0xffff),                   // depth, pre_defined
    box(configType, config)
  );
}

/** The MPEG-4 descriptor length encoding: seven bits a byte, high bit to continue. */
function descriptorLength(n) {
  const out = [];
  let value = n;
  do {
    out.unshift(value & 0x7f);
    value >>= 7;
  } while (value > 0);
  for (let i = 0; i < out.length - 1; i += 1) out[i] |= 0x80;
  return Buffer.from(out);
}

function descriptor(tag, body) {
  return Buffer.concat([u8(tag), descriptorLength(body.length), body]);
}

/**
 * `esds`, which is where AAC hides its configuration.
 *
 * The audio is copied through rather than re-encoded, so the configuration
 * written here is the one read out of the original file, byte for byte. That
 * is the whole reason passthrough is worth the extra parsing: a re-encode of
 * the audio would lose quality to save roughly a twentieth of the bytes.
 */
function esdsBox(trackId, config, maxBitrate, avgBitrate) {
  const decoderSpecific = config && config.length ? descriptor(0x05, config) : Buffer.alloc(0);
  const decoderConfig = descriptor(0x04, Buffer.concat([
    u8(0x40),                 // objectTypeIndication: MPEG-4 Audio
    u8(0x15),                 // streamType 5 (audio), not upstream
    Buffer.from([0, 0, 0]),   // bufferSizeDB
    u32(maxBitrate || 0),
    u32(avgBitrate || 0),
    decoderSpecific,
  ]));
  const sl = descriptor(0x06, u8(0x02));
  const es = descriptor(0x03, Buffer.concat([u16(trackId), u8(0), decoderConfig, sl]));
  return fullBox('esds', 0, 0, es);
}

function audioSampleEntry(fourcc, channels, sampleRate, extra) {
  return box(
    fourcc,
    Buffer.alloc(6), u16(1),
    Buffer.alloc(8),                    // version, revision, vendor
    u16(channels || 2), u16(16),        // channelcount, samplesize
    u16(0), u16(0),                     // pre_defined, reserved
    // The sample rate is 16.16 fixed point, and rates above 65535 do not fit.
    // Everything this will meet is 44100 or 48000.
    u32(((sampleRate || 48000) & 0xffff) << 16),
    extra || Buffer.alloc(0)
  );
}

/* -------------------------------------------------------------------------- */
/* a track                                                                     */
/* -------------------------------------------------------------------------- */

function trak(track, offsets, use64, created) {
  const isVideo = track.kind === 'video';
  const durationTicks = track.durations.reduce((a, b) => a + b, 0);
  const movieDuration = Math.round((durationTicks / track.timescale) * MOVIE_TIMESCALE);

  const tkhd = fullBox(
    'tkhd', 0, 0x000003,                // enabled, in movie
    u32(created), u32(created),
    u32(track.id), u32(0), u32(movieDuration),
    Buffer.alloc(8), u16(0), u16(0),    // reserved, layer, alternate_group
    u16(isVideo ? 0 : 0x0100), u16(0),  // volume, reserved
    // The source's transform, carried through rather than reset. A phone
    // stores a portrait video as landscape pixels plus a quarter turn here,
    // and a decoder hands back the landscape pixels -- so an identity matrix
    // in the copy is a video lying on its side. `probe.js` already had to
    // learn this about `orientation` for photographs; it is the same trap.
    track.matrix && track.matrix.length === 36 ? track.matrix : MATRIX,
    fixed16(isVideo ? track.width : 0),
    fixed16(isVideo ? track.height : 0)
  );

  const mdhd = fullBox(
    'mdhd', 0, 0,
    u32(created), u32(created),
    u32(track.timescale), u32(durationTicks),
    // 'und': three five-bit letters, offset from 0x60, packed into 16 bits.
    u16(0x55c4), u16(0)
  );

  const hdlr = fullBox(
    'hdlr', 0, 0,
    u32(0),
    Buffer.from(isVideo ? 'vide' : 'soun', 'latin1'),
    Buffer.alloc(12),
    Buffer.from(isVideo ? 'VideoHandler\0' : 'SoundHandler\0', 'latin1')
  );

  const header = isVideo
    ? fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0))
    : fullBox('smhd', 0, 0, u16(0), u16(0));

  // `dref` with a single self-referencing `url ` is how a file says its media
  // is inside itself. Flag 1 on the entry means exactly that, and the entry
  // then carries no actual URL.
  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));

  const entry = isVideo
    ? visualSampleEntry(track.fourcc, track.width, track.height, track.configType, track.config)
    : audioSampleEntry(
        track.fourcc,
        track.channels,
        track.sampleRate,
        track.fourcc === 'mp4a'
          ? esdsBox(track.id, track.config, track.maxBitrate, track.avgBitrate)
          : (track.config ? box('dOps', track.config) : null)
      );

  const tables = [
    fullBox('stsd', 0, 0, u32(1), entry),
    stts(track.durations),
  ];
  if (track.compositionOffsets) tables.push(ctts(track.compositionOffsets));
  if (track.keyIndexes && track.keyIndexes.length !== track.durations.length) {
    tables.push(stss(track.keyIndexes));
  }
  tables.push(stsc(), stsz(track.sizes), chunkOffsets(offsets, use64));

  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', header, dinf, box('stbl', ...tables))));
}

/* -------------------------------------------------------------------------- */
/* decode order                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Turn the encoder's output into decode times, durations and composition
 * offsets.
 *
 * `VideoEncoder` hands chunks back in **decode** order, stamped with
 * **presentation** times. When there are no B-frames those are the same order
 * and this produces no `ctts` at all. When there are, the presentation stamps
 * arrive out of order, and writing them as if they were decode times would
 * produce a file that plays its frames backwards in short bursts -- which is
 * the kind of bug that looks like a bad encode rather than a bad muxer.
 */
function timeline(samples, timescale, fallbackDurationUs) {
  const toTicks = (us) => Math.round((us / 1e6) * timescale);

  const presentation = samples.map((s, i) => ({ i, pts: s.timestamp })).sort((a, b) => a.pts - b.pts);

  // Durations come from the gaps between neighbouring *presentation* times.
  // The last sample has no neighbour, so it borrows the one before it.
  const durationByIndex = new Array(samples.length).fill(0);
  for (let k = 0; k < presentation.length; k += 1) {
    const here = presentation[k];
    const next = presentation[k + 1];
    const us = next
      ? next.pts - here.pts
      : samples[here.i].duration || (k > 0 ? presentation[k].pts - presentation[k - 1].pts : fallbackDurationUs);
    durationByIndex[here.i] = Math.max(1, toTicks(us));
  }

  // Decode times run in the order the chunks arrived, each the sum of the
  // durations before it.
  const decode = new Array(samples.length).fill(0);
  let running = 0;
  for (let i = 0; i < samples.length; i += 1) {
    decode[i] = running;
    running += durationByIndex[i];
  }

  let offsets = samples.map((s, i) => toTicks(s.timestamp - samples[0].timestamp) - decode[i]);
  const allZero = offsets.every((o) => o === 0);

  return {
    durations: samples.map((_, i) => durationByIndex[i]),
    compositionOffsets: allZero ? null : offsets,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Build an MP4.
 *
 * @param {object} spec
 * @param {object} spec.video  {fourcc, codecConfig, width, height, samples}
 *   where each sample is {data: Buffer, timestamp: µs, duration: µs, key: bool}
 * @param {object} [spec.audio]  {fourcc, config, channels, sampleRate, timescale, samples}
 *   -- copied through untouched, so its samples keep their original timing
 * @returns {Buffer}
 */
function build(spec) {
  if (!spec || !spec.video || !spec.video.samples || !spec.video.samples.length) {
    throw new Error('nothing to write');
  }

  const tracks = [];

  /* -- video --------------------------------------------------------------- */

  const v = spec.video;
  const vTimes = timeline(v.samples, VIDEO_TIMESCALE, Math.round(1e6 / (v.framerate || 30)));
  tracks.push({
    id: 1,
    kind: 'video',
    fourcc: v.fourcc,
    configType: v.fourcc.startsWith('hvc') || v.fourcc.startsWith('hev') ? 'hvcC' : 'avcC',
    config: v.codecConfig,
    width: v.width,
    height: v.height,
    matrix: v.matrix || null,
    timescale: VIDEO_TIMESCALE,
    durations: vTimes.durations,
    compositionOffsets: vTimes.compositionOffsets,
    sizes: v.samples.map((s) => s.data.length),
    keyIndexes: v.samples.map((s, i) => (s.key ? i : -1)).filter((i) => i >= 0),
    data: v.samples.map((s) => s.data),
  });

  /* -- audio, copied rather than re-encoded -------------------------------- */

  if (spec.audio && spec.audio.samples && spec.audio.samples.length) {
    const a = spec.audio;
    const bytes = a.samples.reduce((sum, s) => sum + s.data.length, 0);
    const seconds = a.samples.reduce((sum, s) => sum + s.durationTicks, 0) / a.timescale;
    tracks.push({
      id: 2,
      kind: 'audio',
      fourcc: a.fourcc,
      config: a.config,
      channels: a.channels,
      sampleRate: a.sampleRate,
      timescale: a.timescale,
      durations: a.samples.map((s) => s.durationTicks),
      compositionOffsets: null,
      sizes: a.samples.map((s) => s.data.length),
      keyIndexes: a.samples.map((_, i) => i),
      maxBitrate: a.maxBitrate || 0,
      avgBitrate: seconds > 0 ? Math.round((bytes * 8) / seconds) : 0,
      data: a.samples.map((s) => s.data),
    });
  }

  /* -- the file ------------------------------------------------------------ */

  const mediaBytes = tracks.reduce((sum, t) => sum + t.sizes.reduce((a, b) => a + b, 0), 0);
  // 4 GB is where `stco` stops being able to describe the file. Nothing this
  // will produce comes close, but a format that silently truncates an offset
  // is worse than one that costs eight bytes a sample.
  const use64 = mediaBytes > 0xffffffff - (1 << 20);

  const brands = tracks[0].fourcc.startsWith('hvc') || tracks[0].fourcc.startsWith('hev')
    ? ['isom', 'iso2', 'hvc1', 'mp41']
    : ['isom', 'iso2', 'avc1', 'mp41'];
  const ftyp = box(
    'ftyp',
    Buffer.from('isom', 'latin1'), u32(0x200),
    ...brands.map((b) => Buffer.from(b, 'latin1'))
  );

  const longest = Math.max(
    ...tracks.map((t) => (t.durations.reduce((a, b) => a + b, 0) / t.timescale))
  );
  // When the recording was made, not when the copy was. A copy stamped "now"
  // would file itself under today in the timeline E4 built, and the spec asks
  // for the capture date to survive. Zero when the source had none, which is
  // what this format means by "unknown" and what `bmff.js` reads back as null.
  const created = spec.createdAt
    ? Math.max(0, Math.round(spec.createdAt / 1000) + EPOCH_OFFSET_SEC)
    : 0;

  const mvhd = fullBox(
    'mvhd', 0, 0,
    u32(created), u32(created),
    u32(MOVIE_TIMESCALE), u32(Math.round(longest * MOVIE_TIMESCALE)),
    u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
    MATRIX,
    Buffer.alloc(24),
    u32(tracks.length + 1)
  );

  // `stco` holds absolute offsets, so `moov` has to be measured before it can
  // be written. Both passes produce the same length because every field in it
  // is fixed-width -- that is the property this depends on, and it is why the
  // second pass is an assertion rather than a loop.
  const assemble = (mdatStart) => {
    let at = mdatStart;
    const perTrack = tracks.map((t) => {
      const offsets = [];
      for (const size of t.sizes) {
        offsets.push(at);
        at += size;
      }
      return offsets;
    });
    return box('moov', mvhd, ...tracks.map((t, i) => trak(t, perTrack[i], use64, created)));
  };

  const probe = assemble(0);
  const mdatHeader = mediaBytes + 8 > 0xffffffff ? 16 : 8;
  const mdatStart = ftyp.length + probe.length + mdatHeader;
  const moov = assemble(mdatStart);
  if (moov.length !== probe.length) {
    throw new Error('moov changed length between passes');
  }

  const parts = [ftyp, moov];
  if (mdatHeader === 16) {
    parts.push(Buffer.concat([u32(1), Buffer.from('mdat', 'latin1'), u64(mediaBytes + 16)]));
  } else {
    parts.push(Buffer.concat([u32(mediaBytes + 8), Buffer.from('mdat', 'latin1')]));
  }
  for (const t of tracks) parts.push(...t.data);

  return Buffer.concat(parts);
}

module.exports = {
  build,
  timeline,
  MOVIE_TIMESCALE,
  VIDEO_TIMESCALE,
  EPOCH_OFFSET_SEC,
};
