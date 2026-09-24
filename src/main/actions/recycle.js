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

const fsp = require('node:fs/promises');
const path = require('node:path');

const { planTrash, executeTrash } = require('../lib/trash');
const { findUserBins, listItems, matchRecorded, putBack } = require('../lib/recyclebin');
const { pool } = require('../lib/util');

const exists = (p) => fsp.lstat(p).then(() => true, () => false);

/**
 * The way back, for the Restore Center.
 *
 * `locate` says where each recorded item is now, and it asks the disk rather
 * than the journal. An item counts as still in the bin only when the bin's own
 * metadata names the same path at the same moment the app recorded -- the
 * purge's corroboration, used the other way round -- *and* the data half is
 * still there: Windows can leave a `$I` behind with no `$R` beside it.
 *
 * `putBack` is `recyclebin.putBack`, which never overwrites.
 */
const undo = {
  /**
   * @param {Array<{path: string, trashedAt: number}>} records
   * @param {object} [deps]  `binDirs` replaces the real bins, for the harness
   * @returns {Promise<Map<object, {state: 'inBin'|'gone'|'unavailable', binItem?: object, existsAtOrigin?: boolean}>>}
   */
  async locate(records, deps = {}) {
    const out = new Map();
    const roots = [...new Set(records.map((r) => path.parse(path.resolve(r.path)).root.toLowerCase()))];
    const reachable = new Set();
    for (const root of roots) {
      if (await exists(root)) reachable.add(root);
    }

    const here = [];
    for (const record of records) {
      if (reachable.has(path.parse(path.resolve(record.path)).root.toLowerCase())) here.push(record);
      // The drive it was on is not connected: nothing can be said about it,
      // which is different from saying it is gone.
      else out.set(record, { state: 'unavailable' });
    }
    if (here.length === 0) return out;

    const bins = Array.isArray(deps.binDirs) ? deps.binDirs : await findUserBins([...reachable]);
    const matched = matchRecorded(here, await listItems(bins));

    await pool(here, 16, async (record) => {
      const binItem = matched.get(record);
      if (binItem && (await exists(binItem.dataPath))) {
        out.set(record, { state: 'inBin', binItem });
        return;
      }
      out.set(record, { state: 'gone', existsAtOrigin: await exists(record.path) });
    });
    return out;
  },

  /** Whether the data is still in the bin, checked at the last moment. */
  ready(located) {
    return located && located.binItem ? exists(located.binItem.dataPath) : Promise.resolve(false);
  },

  putBack(located, target) {
    return putBack(located.binItem, target);
  },
};

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

  undo,
};
