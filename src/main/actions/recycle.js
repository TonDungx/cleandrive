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
const appCaches = require('../analyzers/app-caches');
const { runningProcessNames } = require('../lib/processes');

const exists = (p) => fsp.lstat(p).then(() => true, () => false);

/**
 * A known app's folder, checked again at the last moment (D4).
 *
 * The scan said the app was closed -- or the file was picked from another
 * list -- but it may have been opened since, and nothing is taken from under
 * an app that is open now. Its files are refused as in use, which the dialog
 * and the receipt already say. When the process list cannot be read they are
 * refused too, the scan's rule. The list is read once, and only when some
 * item is in such a folder.
 */
async function leaveOpenApps(planned, deps = {}) {
  const match = appCaches.matcher(deps.appCacheEnv || process.env);
  const owners = new Map();
  for (const item of planned.plan) {
    const hit = match(item.path);
    if (hit) owners.set(item, hit.def);
  }
  if (owners.size === 0) return planned;

  const open = appCaches.openApps(await (deps.runningProcessNames || runningProcessNames)());
  const plan = [];
  const refused = [];
  for (const item of planned.plan) {
    const def = owners.get(item);
    if (!def || (open && !open.has(def.id))) plan.push(item);
    else if (open) refused.push({ path: item.path, error: `${def.name} is open`, code: 'EBUSY' });
    else refused.push({ path: item.path, error: `Could not tell whether ${def.name} is open` });
  }
  if (refused.length === 0) return planned;
  return {
    ...planned,
    plan,
    failed: [...planned.failed, ...refused],
    inUse: [...(planned.inUse || []), ...refused.filter((r) => r.code === 'EBUSY')],
    totalBytes: plan.reduce((n, item) => n + item.size, 0),
    estimatedMs: Math.round((planned.estimatedMs || 0) * (plan.length / planned.plan.length)),
  };
}

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
  async plan(items, options, ctx) {
    const plan = (ctx.deps && ctx.deps.planTrash) || planTrash;
    const planned = await plan(items, { ...options, allowDirectories: false }, { token: ctx.token, onProgress: ctx.onProgress });
    return leaveOpenApps(planned, ctx.deps || {});
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
