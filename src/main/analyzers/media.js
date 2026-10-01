'use strict';

/**
 * The analyzer behind Photos & video.
 *
 * Every candidate here is `keep`. That is not a placeholder: this screen's
 * files are the only ones in the app that cannot be got back, so it suggests
 * nothing, selects nothing, and never reaches the automatic run. What it does
 * say, with evidence and a confidence, is where each file came from -- which is
 * what the origin classifier already produced, ranked rather than scored.
 * The contract is a new name for a promise this screen was already keeping.
 */

const { scanMedia } = require('../lib/media/scan');
const { classifyOrigin } = require('../lib/media/origin');
const { describeNature } = require('../lib/media/nature');
const { conversationOf } = require('../chat/known');
const { candidateId } = require('./contract');
const { streamWhile } = require('./channel');

const ID = 'media';

/**
 * A probe record as a candidate.
 *
 * `meta` carries what the grid draws and filters on, cut down from the probe
 * record -- block counts, moov hop counts and EXIF exposure times cross no
 * boundary, because fifty thousand of them is a payload worth trimming.
 */
function toCandidate(record, context) {
  const origin = classifyOrigin(record, context);
  const nature = describeNature(record, context);
  const chat = conversationOf(record.path);

  // When a photograph belongs, in the order the user would mean it:
  // when it was taken, else when it was recorded, else when the file was last
  // written. A file copied off a camera has today's mtime and a capture date
  // from years ago, and filing it under this year would be wrong.
  //
  // `year` used to be sent beside this. E4 replaced the year histogram with a
  // timeline that goes down to the day, which works from `at` directly, and a
  // field nothing reads is a field that goes quietly wrong -- so it was taken
  // out rather than left to look like a feature waiting for a screen.
  const at = record.takenAt || record.recordedAt || record.mtimeMs;

  // Which of those three it turned out to be. The timeline (E4) drills down to
  // a single day, and at that depth the difference matters: measured on this
  // machine, only 4.5% of 11,419 files carry a date from the picture or the
  // video itself, and the rest are dated by the file. A day-level bar built on
  // the second kind is a bar about when files were written, which is a
  // different question -- so the screen says which it is drawing rather than
  // letting both look alike.
  const dateFrom = record.takenAt ? 'taken' : record.recordedAt ? 'recorded' : 'file';

  return {
    id: candidateId(ID, record.path),
    path: record.path,
    kind: 'file',
    bytes: record.size,
    category: record.kind === 'video' ? 'media.video' : 'media.image',
    verdict: 'keep',
    confidence: origin.strength,
    // The classifier lists the deciding fact first and the facts that support
    // it after, so position is rank.
    evidence: origin.evidence.map((sentence, i) => ({ rank: i + 1, ...sentence })),
    actions: ['recycle', 'quarantine'],
    unattendedEligible: false,
    meta: {
      name: record.name,
      ext: record.ext,
      kind: record.kind,
      format: record.format || null,
      width: record.width || 0,
      height: record.height || 0,
      megapixels: record.megapixels || 0,
      bytesPerPixel: record.bytesPerPixel || 0,
      aspect: record.aspect || 0,
      camera: record.camera || null,
      lens: record.lens || null,
      software: record.software || null,
      // Read by `lib/media/probe.js` since the subsystem was written, and
      // dropped here until E1 needed them: the side-by-side comparison is a
      // table of the facts that tell two nearly identical photographs apart,
      // and on a burst from one camera the exposure and the ISO are often the
      // only two that differ at all.
      iso: record.iso ?? null,
      exposureTime: record.exposureTime ?? null,
      durationSec: record.durationSec ?? null,
      bitrateKbps: record.bitrateKbps ?? null,
      title: record.title || null,
      cloudService: record.cloudService || null,
      dehydrated: Boolean(record.dehydrated),
      unread: record.unread || null,
      takenAt: record.takenAt || null,
      mtimeMs: record.mtimeMs,
      at,
      dateFrom,
      origin: origin.origin,
      app: origin.app,
      // Which chat this arrived in, where the folder says so (E5). Read off
      // the path by `chat/known.js`, the same function the Chat screen uses,
      // so the two screens cannot drift into disagreeing about which
      // conversation a file belongs to. `null` for everything else, which is
      // most of a library -- the axis is a card that appears only when there
      // is something to put in it.
      conversation: chat ? chat.conversation : null,
      conversationApp: chat ? chat.app : null,
      traits: nature.traits,
      /*
       * Where it was taken (E4), and the one gate that decides whether a
       * coordinate ever leaves this process.
       *
       * `lib/media/exif.js` and `lib/media/bmff.js` used to refuse to read a
       * position at all, and the comment in each says what that was protecting
       * against: a scan result holding coordinates is one export away from
       * being a location history, and an early run of the video parser printed
       * the author's own home to six decimal places. The user reversed that on
       * 2026-10-01 so the map half of E4 could exist.
       *
       * This line is what replaced it. It is the last thing before the IPC
       * boundary, so it is the whole of the new guarantee:
       *
       *   - with the map off -- which is how it ships -- `lat` and `lon` are
       *     not in the payload at all. Not null, not zero: absent.
       *   - `hasGps` crosses either way, because it has since the subsystem
       *     shipped and it is what the "Records where it was taken" trait is
       *     drawn from.
       *
       * `scripts/test-media-map.js` fails if a coordinate gets past here with
       * the map off, and fails if anything that writes a file is handed one.
       */
      ...(context.coordinates === true && Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
        ? { lat: record.latitude, lon: record.longitude }
        : {}),
      hasGps: Boolean(record.hasGps),
    },
  };
}

const analyzer = {
  id: ID,
  feature: 'free',
  requiresElevation: false,
  categories: ['media.image', 'media.video'],

  /**
   * Candidates are yielded as the scan reads them, so the grid fills while it
   * is still running. Some of those are later found to sit in a folder of a
   * program's artwork and are hidden; the summary's `visibleIds` is the final
   * set, in order, rather than the scan holding everything back until it knows.
   *
   * @param {object} ctx  { roots, options, context: { displays, coordinates }, deps: { scanMedia } }
   */
  async *run(ctx, token) {
    const scan = (ctx.deps && ctx.deps.scanMedia) || scanMedia;
    const context = ctx.context || {};
    const streamed = new Set();

    const result = yield* streamWhile((push) =>
      scan(ctx.roots, ctx.options || {}, {
        token,
        onProgress: (p) => push({ type: 'progress', ...p }),
        onBatch: (batch) => {
          for (const record of batch) {
            const candidate = toCandidate(record, context);
            streamed.add(candidate.id);
            push({ type: 'candidate', candidate });
          }
        },
      })
    );

    // Anything the batches never carried is yielded now, so the final set is
    // complete whatever the scan chose to stream.
    const visibleIds = [];
    for (const record of result.files) {
      const id = candidateId(ID, record.path);
      visibleIds.push(id);
      if (streamed.has(id)) continue;
      streamed.add(id);
      yield { type: 'candidate', candidate: toCandidate(record, context) };
    }

    const { files, ...rest } = result;
    yield { type: 'summary', summary: { ...rest, visibleIds, displays: context.displays || [] } };
  },
};

module.exports = { analyzer, toCandidate, ID };
