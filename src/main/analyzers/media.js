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

  // The year a photograph belongs to, in the order the user would mean it:
  // when it was taken, else when it was recorded, else when the file was last
  // written. A file copied off a camera has today's mtime and a capture date
  // from years ago, and filing it under this year would be wrong.
  const at = record.takenAt || record.recordedAt || record.mtimeMs;

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
      durationSec: record.durationSec ?? null,
      bitrateKbps: record.bitrateKbps ?? null,
      title: record.title || null,
      cloudService: record.cloudService || null,
      dehydrated: Boolean(record.dehydrated),
      unread: record.unread || null,
      takenAt: record.takenAt || null,
      mtimeMs: record.mtimeMs,
      at,
      year: at ? new Date(at).getFullYear() : null,
      origin: origin.origin,
      app: origin.app,
      traits: nature.traits,
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
   * @param {object} ctx  { roots, options, context: { displays }, deps: { scanMedia } }
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
