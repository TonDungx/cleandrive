'use strict';

/**
 * The one way anything in this app acts on a file.
 *
 * Moving to the Recycle Bin was the first action, and it already had a
 * careful path: vet every path, probe for the permission prompt, confirm with
 * the real numbers, move one at a time with a stop button. The roadmap adds
 * seven more kinds of action, and the risk is not that any one of them is
 * hard but that each grows its own shortcut. So there is one pipeline, and a
 * new action is a handler plugged into it rather than a new path:
 *
 *   plan      vet + probe, touching nothing          handler.plan
 *   describe  what the confirmation will say         handler.describe
 *   confirm   the caller's dialog, or none at all    ctx.confirm
 *   journal   a session opened before the first item ctx.journal
 *   apply     item by item, journalled as it goes    handler.apply
 *
 * The dialog is the caller's because only the caller has a window; the
 * scheduled run passes none, which is why a schedule starts in report-only
 * mode. Everything else is here, and is the same for every kind.
 */

const HANDLERS = require('./handlers');
const { CancelToken } = require('../lib/util');

/** For a caller with nothing to record into -- the test harnesses. */
const NO_JOURNAL = Object.freeze({
  begin: async () => null,
  record: async () => {},
  end: async () => {},
});

function handlerFor(kind) {
  return Object.prototype.hasOwnProperty.call(HANDLERS, kind) ? HANDLERS[kind] : null;
}

/**
 * @param {object} request
 * @param {string} request.kind                 an ActionKind with a handler
 * @param {string[]} request.items              absolute paths
 * @param {object} [request.options]            handler options; `dryRun` stops after the plan
 * @param {object} [ctx]
 * @param {CancelToken} [ctx.token]
 * @param {(p: object) => void} [ctx.onProgress]
 * @param {(feature: string) => boolean} [ctx.can]
 * @param {(description: object, plan: object) => Promise<boolean>} [ctx.confirm]
 * @param {object} [ctx.journal]                begin/record/end
 * @param {string} [ctx.source]                 'manual' | 'autoclean' | 'scheduled'
 * @param {string} [ctx.runId]
 * @param {object} [ctx.deps]                   injected engines, for the harnesses
 */
async function execute(request, ctx = {}) {
  const kind = request && request.kind;
  const handler = handlerFor(kind);
  const list = Array.isArray(request && request.items) ? request.items : [request && request.items];
  const options = (request && request.options) || {};
  const token = ctx.token || new CancelToken();
  const onProgress = ctx.onProgress || (() => {});
  const journal = ctx.journal || NO_JOURNAL;

  const base = {
    kind,
    moved: [],
    failed: [],
    requested: list.length,
    movedBytes: 0,
    freedBytes: 0,
  };

  // A kind that is named in the contract but has no handler yet is refused
  // outright rather than approximated -- quarantine done badly is worse than
  // quarantine not offered.
  if (!handler) return { ...base, refused: 'unsupported' };
  if (ctx.can && !ctx.can(handler.feature)) return { ...base, refused: 'locked', feature: handler.feature };
  if (list.length === 0 || (list.length === 1 && list[0] === undefined)) return { ...base, requested: 0 };

  /* -- plan: vet everything, touch nothing -------------------------------- */
  const planned = await handler.plan(list, options, { token, onProgress, deps: ctx.deps });
  const description = handler.describe(planned, options);

  const withPlan = {
    ...base,
    failed: planned.failed,
    needsAdmin: description.needsAdmin || 0,
    inUse: description.inUse || 0,
    description,
  };

  if (token.cancelled) {
    onProgress({ phase: 'done' });
    return { ...withPlan, cancelled: true };
  }
  if (planned.plan.length === 0) {
    onProgress({ phase: 'done' });
    return withPlan;
  }

  // An explicit dry run stops here -- report what would go, move nothing.
  if (options.dryRun) {
    onProgress({ phase: 'done' });
    return {
      ...withPlan,
      moved: planned.plan.map((item) => ({ ...item, dryRun: true })),
      movedBytes: planned.totalBytes,
      dryRun: true,
    };
  }

  /* -- confirm, with the cost stated up front ------------------------------ */
  // A dialog may answer more than yes: a restore asks what to do about files
  // already in the way. Such an answer is `{ approved, options }`, and its
  // options win over the request's, because the dialog is the main process
  // asking the person and the request is only what the window sent.
  let applyOptions = options;
  if (ctx.confirm) {
    onProgress({ phase: 'confirming', total: description.count, totalBytes: description.bytes });
    const answer = await ctx.confirm(description, planned);
    const approved = answer === true || Boolean(answer && typeof answer === 'object' && answer.approved === true);
    if (!approved) {
      onProgress({ phase: 'done' });
      return { ...withPlan, cancelled: true };
    }
    if (answer && typeof answer === 'object' && answer.options) applyOptions = { ...options, ...answer.options };
  }

  /* -- apply, journalled as it goes --------------------------------------- */
  const session = await journal.begin(kind, description, { source: ctx.source || 'manual', runId: ctx.runId || null });

  let result;
  try {
    result = await handler.apply(planned, applyOptions, {
      token,
      onProgress,
      deps: ctx.deps,
      onItem: (item) => journal.record(session, item),
    });
  } finally {
    // Closed even when apply throws, so a session that died half way reads as
    // one that ended with an error rather than one that is still running.
    await journal.end(session, {
      done: result ? result.moved.length : 0,
      failed: result ? result.failed.length : 0,
      skipped: result ? result.remaining || 0 : planned.plan.length,
      cancelled: result ? Boolean(result.cancelled) : false,
      movedBytes: result ? result.freedBytes : 0,
      freedOnSource: result && description.freesOnVolume ? result.freedBytes : 0,
      error: result ? result.recordError || null : 'apply threw',
    });
  }
  onProgress({ phase: 'done' });

  const movedBytes = result.freedBytes;
  return {
    ...withPlan,
    moved: result.moved,
    failed: [...planned.failed, ...result.failed],
    // Two figures, never summed and never confused: what left the list, and
    // what actually came back to the disk. For the Recycle Bin the second is
    // zero, because the bin is on the same volume.
    movedBytes,
    freedBytes: description.freesOnVolume ? movedBytes : 0,
    freesOnVolume: description.freesOnVolume,
    cancelled: result.cancelled,
    remaining: result.remaining,
    durationMs: result.durationMs,
    recordError: result.recordError || null,
    session: session ? session.id : null,
  };
}

module.exports = { execute, handlerFor };
