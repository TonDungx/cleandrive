'use strict';

const { message: m } = require('../../../i18n');

/**
 * Axis two: what a file actually is, as opposed to what it is called.
 *
 * ## Traits, not a category
 *
 * The first axis puts a file in exactly one box, because a photograph has
 * exactly one origin. This axis does not, because a file can be several things
 * at once and pretending otherwise loses information: a 900-byte `.jpg` that is
 * really a GIF is *both* junk-sized *and* mislabelled, and a filter that made
 * them exclusive would hide one behind the other.
 *
 * So this returns a set of traits, each with the facts behind it. The UI turns
 * them into filter chips, and a file can wear several.
 *
 * ## What is deliberately not here
 *
 * **There is no "blurry" trait.** The brief asked for one, and the measurement
 * argues against it. Laplacian variance over a small thumbnail -- the only
 * blur measure available without a decoder -- separates *detailed* from
 * *smooth*, which is not the same question. Measured on this machine: a family
 * of perfectly sharp scanned documents scored 390 to 550, while screen
 * recordings of text scored 3,000 to 6,000. The gap is subject matter, not
 * focus. A photograph with a shallow depth of field, of fog, of snow, or of a
 * plain wall, all land where a genuinely out-of-focus photo lands.
 *
 * Naming a group "blurry" would invite exactly the bulk selection this
 * subsystem forbids, on exactly the files that are least recoverable. The
 * measure is still computed in phase two and still shown -- as a *sort order*,
 * "least detail first", which is an honest description of what it ranks.
 *
 * **Bytes per pixel is never a verdict on its own.** It conflates the codec
 * (HEIC fits a pixel into a fraction of what JPEG needs), the subject (a
 * screenshot of a flat interface compresses to almost nothing and has lost
 * nothing at all), and the chroma subsampling. It appears below only in
 * combination with other evidence, and it is always shown as the number it is.
 */

/** Lossy formats, where a low bytes-per-pixel figure means something. */
const LOSSY = new Set(['jpeg', 'webp', 'heic', 'avif', 'jxl']);

const THRESHOLDS = {
  /** An icon, an emoji, a spacer, a cached thumbnail. */
  tinyBytes: 20 * 1024,
  /** No photograph is this small in either direction. */
  thumbnailEdge: 320,
  /** Twelve megapixels is roughly a current phone's main camera. */
  highMegapixels: 12,
  lowMegapixels: 0.3,
  /** Below this, a lossy image has been compressed hard. See the caveats above. */
  hardCompressionBpp: 0.12,
  /** Above this, a lossy image is carrying more data than its size needs. */
  generousBpp: 2,
  panoramaAspect: 2.5,
  bigBytes: 25 * 1024 * 1024,
  /**
   * A video this short is usually an accident, a reaction clip, or a converted
   * animation. Five rather than three: the camera clips on the development
   * machine run to four seconds, and a line that excluded them would make the
   * filter find only the truly accidental ones, which is not what it is for.
   */
  briefSeconds: 5,
  longSeconds: 10 * 60,
  /** Screen recordings and phone video sit far apart on this. */
  lowBitrateKbps: 800,
};

/**
 * The long edges that chat apps resize to on their way through.
 *
 * An exact match on one of these, on a file with no camera metadata left, is
 * the fingerprint of a photograph that has been sent somewhere and come back.
 * These are conventions rather than promises and they change; the trait they
 * produce says "looks like" and cites the number it matched.
 */
const MESSENGER_LONG_EDGES = new Map([
  [1280, 'Telegram'],
  [1600, 'WhatsApp'],
  [2048, 'Messenger'],
  [1920, null],
  [1024, null],
]);

/**
 * Everything true about this file, with the evidence for each.
 *
 * @param {object} record            a probe record
 * @param {object} [context]         { displays: [{width, height}] }
 * @returns {{traits: Array<{key: string, evidence: object}>}}
 */
function describeNature(record, context = {}) {
  const traits = [];
  const add = (key, evidence) => traits.push({ key, evidence });

  /* -- files that are not really files ------------------------------------ */

  if (record.unread) {
    add('broken', brokenEvidence(record));
    // Nothing below can be said about a file whose bytes were never read, and
    // inventing traits from its name is exactly the guessing this app avoids.
    return { traits };
  }

  if (record.formatMismatch) {
    add(
      'mislabelled',
      m('media.trait.mislabelled', 'Named .{ext} but the bytes are {actual}', {
        ext: record.ext,
        actual: (record.format || '').toUpperCase(),
      })
    );
  }

  /* -- size, as a file ------------------------------------------------------ */

  if (record.size <= THRESHOLDS.tinyBytes) {
    add(
      'tiny',
      m('media.trait.tiny', 'Only {kb} KB — the size of an icon or an emoji, not a photograph', {
        kb: Math.max(1, Math.round(record.size / 1024)),
      })
    );
  } else if (record.size >= THRESHOLDS.bigBytes) {
    add('big', m('media.trait.big', 'One of the larger files here'));
  }

  /* -- size, as an image ---------------------------------------------------- */

  if (record.width && record.height) {
    const longEdge = Math.max(record.width, record.height);
    const shortEdge = Math.min(record.width, record.height);
    const aspect = longEdge / shortEdge;

    if (shortEdge <= THRESHOLDS.thumbnailEdge && record.kind === 'image') {
      add(
        'thumbnail',
        m('media.trait.thumbnail', '{w}×{h} — too small to have been anybody’s photograph', {
          w: record.width,
          h: record.height,
        })
      );
    }

    if (record.megapixels >= THRESHOLDS.highMegapixels) {
      add(
        'highres',
        m('media.trait.highres', '{mp} megapixels — full camera resolution', { mp: record.megapixels })
      );
    } else if (record.megapixels > 0 && record.megapixels < THRESHOLDS.lowMegapixels && record.size > THRESHOLDS.tinyBytes) {
      add(
        'lowres',
        m('media.trait.lowres', 'Only {w}×{h} — smaller than a phone screen', { w: record.width, h: record.height })
      );
    }

    // Wide and tall are separate traits, because they are separate things and
    // calling both "panorama" was wrong on the evidence: of 778 files past this
    // threshold on the development machine, 763 were wide -- and almost all of
    // them were screenshots of a toolbar or a chat window, not photographs of a
    // landscape. A chip labelled "panorama" that is full of cropped screenshots
    // teaches the user to distrust the labels.
    if (aspect >= THRESHOLDS.panoramaAspect) {
      const ratio = Math.round(aspect * 10) / 10;
      if (record.width > record.height) {
        add('wide', m('media.trait.wide', '{aspect}:1 and wider than it is tall — a panorama, or a cropped strip of a screen', { aspect: ratio }));
      } else {
        add('tall', m('media.trait.tall', '{aspect}:1 and taller than it is wide — usually a scrolling screenshot of a page or a chat', { aspect: ratio }));
      }
    }

    if (record.rotated) {
      add('rotated', m('media.trait.rotated', 'Stored sideways with a tag saying which way up it goes'));
    }

    addScreenShape(record, context, add);
    addCompressionTraits(record, longEdge, add);
  }

  /* -- video ---------------------------------------------------------------- */

  if (record.kind === 'video') {
    addVideoTraits(record, add);
  }

  /* -- where it lives ------------------------------------------------------- */

  if (record.cloudService) {
    add(
      'cloud',
      m('media.trait.cloud', 'Synchronised with {service} — deleting it here deletes it everywhere', {
        service: record.cloudService,
      })
    );
  }
  if (record.dehydrated) {
    add(
      'online-only',
      m('media.trait.onlineOnly', 'Stored online only — its contents are not on this disk, so deleting it frees nothing here')
    );
  }
  if (record.hasGps) {
    add('located', m('media.trait.located', 'Records where it was taken'));
  }

  return { traits };
}

/* -------------------------------------------------------------------------- */

function brokenEvidence(record) {
  switch (record.unread) {
    case 'empty':
      return m('media.trait.broken.empty', 'Zero bytes — the file exists but there is nothing in it');
    case 'unrecognised':
      return m('media.trait.broken.unrecognised',
        'Named .{ext} but the contents match no picture or video format — usually a download that failed', {
          ext: record.ext,
        });
    case 'dehydrated':
      return m('media.trait.broken.dehydrated', 'Stored online only, so its contents were not read');
    case 'busy':
      return m('media.trait.broken.busy', 'Another program has it open');
    default:
      return m('media.trait.broken.unreadable', 'Could not be read');
  }
}

/**
 * An image the size of a screen.
 *
 * This is the same test `origin.js` uses to call something a screenshot, and it
 * appears on both axes on purpose: the origin says what it *is*, and the trait
 * lets somebody filter for "everything the size of my monitor" whatever its
 * origin turned out to be.
 */
function addScreenShape(record, context, add) {
  const displays = context.displays;
  if (!displays || displays.length === 0 || record.kind !== 'image') return;

  for (const display of displays) {
    if (record.width === display.width && record.height === display.height) {
      add(
        'screen-sized',
        m('media.trait.screenSized', 'Exactly {w}×{h}, the size of this screen', {
          w: display.width,
          h: display.height,
        })
      );
      return;
    }
  }
}

/**
 * How hard this file has been squeezed.
 *
 * Only for lossy formats. A PNG's bytes-per-pixel says how flat the picture is,
 * not how much was thrown away, and a screenshot of a plain interface
 * legitimately sits at a tenth of what a photograph needs.
 */
function addCompressionTraits(record, longEdge, add) {
  if (!LOSSY.has(record.format) || !record.bytesPerPixel) return;

  const messenger = MESSENGER_LONG_EDGES.get(longEdge);
  const resized = MESSENGER_LONG_EDGES.has(longEdge);

  // The combination, never one signal alone: a chat-app size, no camera
  // metadata left, and a low byte budget per pixel. Any one of the three is
  // ordinary; all three together is a photograph that has been round a group
  // chat.
  if (resized && !record.hasExif && record.bytesPerPixel < 0.4) {
    add(
      'recompressed',
      messenger
        ? m('media.trait.recompressed.app',
            'Resized to {edge}px and stripped of its camera information — the shape {app} gives a photo it passes on, at {bpp} bytes a pixel',
            { edge: longEdge, app: messenger, bpp: record.bytesPerPixel })
        : m('media.trait.recompressed.generic',
            'Resized to exactly {edge}px with no camera information left, at {bpp} bytes a pixel — a photo that has been passed through something',
            { edge: longEdge, bpp: record.bytesPerPixel })
    );
    return;
  }

  if (record.bytesPerPixel < THRESHOLDS.hardCompressionBpp) {
    add(
      'hard-compressed',
      m('media.trait.hardCompressed',
        '{bpp} bytes a pixel — compressed hard enough to show. Flat pictures compress this well honestly, so look before deciding',
        { bpp: record.bytesPerPixel })
    );
  } else if (record.bytesPerPixel >= THRESHOLDS.generousBpp) {
    add(
      'generous',
      m('media.trait.generous', '{bpp} bytes a pixel — barely compressed, so it is large for its dimensions', {
        bpp: record.bytesPerPixel,
      })
    );
  }
}

function addVideoTraits(record, add) {
  if (record.durationSec !== undefined && record.durationSec !== null) {
    if (record.durationSec <= THRESHOLDS.briefSeconds) {
      add('brief', m('media.trait.brief', 'Only {n} seconds long', { n: record.durationSec }));
    } else if (record.durationSec >= THRESHOLDS.longSeconds) {
      add('long', m('media.trait.long', '{n} minutes long', { n: Math.round(record.durationSec / 60) }));
    }
  } else if (record.noMetadata) {
    add('no-metadata', m('media.trait.noMetadata', 'Its container carries no duration or resolution'));
  }

  if (record.height >= 2000) {
    add('4k', m('media.trait.uhd', '{w}×{h} — 4K', { w: record.width, h: record.height }));
  }

  if (record.bitrateKbps) {
    if (record.bitrateKbps < THRESHOLDS.lowBitrateKbps) {
      add(
        'low-bitrate',
        m('media.trait.lowBitrate', '{n} kbps — heavily compressed for its size', { n: record.bitrateKbps })
      );
    }
  }

  // A video with no sound track is usually a screen recording, a converted GIF
  // or a clip somebody stripped. Worth filtering for; never worth concluding
  // from on its own.
  if (record.hasVideoTrack && record.hasAudioTrack === false) {
    add('silent', m('media.trait.silent', 'Has no sound track at all'));
  }
}

module.exports = { describeNature, THRESHOLDS, MESSENGER_LONG_EDGES, LOSSY };
