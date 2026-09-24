'use strict';

/**
 * The Recycle Bin, as an action.
 *
 * Nothing about deleting changes here: the vetting, the permission probe and
 * the one-at-a-time move are `trash.js`, exactly as measured and tested. This
 * file only describes that machinery in the terms every action shares, so the
 * pipeline can put the same confirmation, progress and journal around it that
 * it will put around quarantine, relocation and the rest.
 *
 * `freesOnVolume` is false, and it is the most important line in the file. The
 * bin sits on the same volume as the file, so moving a file there frees
 * nothing until the bin is emptied. Every figure downstream -- the dialog, the
 * receipt, the Trends column -- reads this rather than assuming.
 */

const { planTrash, executeTrash } = require('../lib/trash');

module.exports = {
  kind: 'recycle',
  feature: 'free',
  allowsFolders: false,
  reversible: 'bin',

  freesOnVolume() {
    return false;
  },

  /** Vet and probe: the only I/O before the user has said yes. */
  plan(items, options, ctx) {
    const plan = (ctx.deps && ctx.deps.planTrash) || planTrash;
    return plan(items, { ...options, allowDirectories: false }, { token: ctx.token, onProgress: ctx.onProgress });
  },

  /** What the confirmation says, before anything has moved. */
  describe(planned) {
    const needsAdmin = planned.needsAdmin ? planned.needsAdmin.length : 0;
    const inUse = planned.inUse ? planned.inUse.length : 0;
    return {
      kind: 'recycle',
      count: planned.plan.length,
      bytes: planned.totalBytes,
      freesOnVolume: false,
      reversible: 'bin',
      etaMs: planned.estimatedMs,
      needsAdmin,
      inUse,
      refused: planned.failed.length - needsAdmin - inUse,
    };
  },

  /**
   * Move each vetted item, reporting after every one.
   *
   * `onItem` is awaited before the progress report that follows it, so the
   * journal holds an item before the window is told it happened.
   */
  apply(planned, options, ctx) {
    const execute = (ctx.deps && ctx.deps.executeTrash) || executeTrash;
    // One immediate frame so the bar appears at 0 rather than after the first
    // throttled tick.
    if (ctx.onProgress) {
      ctx.onProgress({
        phase: 'deleting',
        done: 0,
        total: planned.plan.length,
        freedBytes: 0,
        totalBytes: planned.totalBytes,
        etaMs: planned.estimatedMs,
        ratePerSec: 0,
        elapsedMs: 0,
      });
    }
    return execute(
      planned.plan,
      ctx.deps && ctx.deps.shell ? { shell: ctx.deps.shell } : {},
      { token: ctx.token, onProgress: ctx.onProgress, onItem: ctx.onItem }
    );
  },
};
