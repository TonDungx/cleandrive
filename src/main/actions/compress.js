'use strict';

/**
 * Letting NTFS hold a folder in less room (B4).
 *
 * The odd one out among this phase's actions: nothing moves, nothing is
 * copied, nothing goes to the Recycle Bin. The files stay exactly where they
 * are, keep their names and their contents, and every program that opens one
 * sees what it saw before. What changes is the number of clusters they sit
 * in -- which means this is the only action here that **frees space the
 * moment it finishes**, with no bin to empty afterwards.
 *
 * That also makes it the one with no way back through the Restore Center:
 * there is nothing to restore. `compact /u` puts it back, and the same menu
 * offers it on a folder that is already compressed.
 *
 * ## It measures before it promises
 *
 * The spec asks for an estimate of "30-45%" at `likely` confidence. Both
 * halves of that are wrong for this machine. Measured: source code gives back
 * 87.5% and archived logs 81.2%, while photos and video give back 0.0% -- so
 * a fixed band would be a promise broken in both directions.
 *
 * Instead `lib/ntfs-compress.js` copies a dozen real files from the folder to
 * a scratch directory on the same volume and puts them through NTFS itself.
 * Measured on a 20.7 MB folder of source: the estimate said 87.6% and the
 * real answer was 87.5%, in 361 ms. On a folder of photos it says 0.0% in 31
 * ms without sampling anything, because their extensions already answer it.
 *
 * ## What it will not compress
 *
 * System locations and installed programs, as every action here refuses.
 * A folder with online-only OneDrive files in it, because compressing one
 * would pull it back down -- the exact space B3 had just given back. And a
 * volume that cannot do it, which is asked by trying rather than inferred
 * from the cluster size.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const i18n = require('../../i18n');
const ntfs = require('../lib/ntfs-compress');
const treeCopy = require('../lib/tree-copy');
const cloud = require('../lib/media/cloud');
const cloudState = require('../lib/cloud-state');
const { CancelToken, isProtectedPath, isProgramInstallPath, isRootOrHome, isNetworkPath } = require('../lib/util');
const { identity, sameFolder } = require('../lib/verified-copy');
const relocate = require('./relocate');

const say = {
  notThere: () => i18n.t('compress.why.notThere', 'That folder is no longer there'),
  notAFolder: () => i18n.t('compress.why.notAFolder', 'This compresses folders, and that is not one'),
  root: () => i18n.t('compress.why.root', 'A drive root or your home folder is not something to compress'),
  system: () =>
    i18n.t(
      'compress.why.system',
      'This is a Windows system location — compressing Windows itself is CompactOS, which Windows has its own setting for'
    ),
  program: () => i18n.t('compress.why.program', 'This belongs to an installed program, so it is left alone'),
  network: () => i18n.t('compress.why.network', 'A folder on the network is left alone'),
  empty: () => i18n.t('compress.why.empty', 'There is nothing in that folder to compress'),
  unsupported: () =>
    i18n.t('compress.why.unsupported', 'This drive cannot hold compressed files — NTFS needs clusters of 4 KB or less'),
  noRoom: () => i18n.t('compress.why.noRoom', 'There was nowhere beside the folder to test compression'),
  online: (n) =>
    i18n.t(
      'compress.why.online',
      'This folder has {n} file(s) that are only on OneDrive. Compressing would download them all, which is the space “Keep on cloud only” had just given back.',
      { n }
    ),
  failed: (error) => i18n.t('compress.why.failed', 'Windows would not compress it ({error})', { error }),
};

function refuseAll(items, error, code = 'EREFUSED') {
  return {
    plan: [],
    failed: (items || []).map((p) => ({ path: p, error, code })),
    needsAdmin: [],
    inUse: [],
    totalBytes: 0,
  };
}

module.exports = {
  kind: 'compress',
  feature: 'pro.compress',
  allowsFolders: true,

  /** Nothing moved, so there is nothing for the Restore Center to put back. */
  reversible: 'manual',

  /**
   * True, and it is the only action in this phase for which it is: the space
   * is back when the call returns, with no bin standing in the way.
   */
  freesOnVolume() {
    return true;
  },

  async plan(items, options = {}, ctx = {}) {
    const deps = ctx.deps || {};
    const token = ctx.token || new CancelToken();
    const list = (items || []).filter((p) => typeof p === 'string' && p !== '');
    const undo = options.uncompress === true;

    const plan = [];
    const failed = [];
    const handoffs = [];
    let totalBytes = 0;
    let totalFiles = 0;
    let onDiskBefore = 0;
    let estimatedBytes = 0;
    let alreadyCompressed = 0;
    let sampled = 0;

    for (const folder of list) {
      if (token.cancelled) break;
      const refuse = (error, code) => failed.push({ path: folder, error, code });

      if (!path.isAbsolute(folder)) {
        refuse(say.notThere(), 'EPATH');
        continue;
      }
      const id = await identity(folder);
      if (!id) {
        refuse(say.notThere(), 'ENOENT');
        continue;
      }
      if (!id.dir) {
        refuse(say.notAFolder(), 'ENOTDIR');
        continue;
      }
      if (isRootOrHome(folder)) {
        refuse(say.root(), 'EROOT');
        continue;
      }
      if (isProtectedPath(folder)) {
        refuse(say.system(), 'ESYSTEM');
        continue;
      }
      if (isProgramInstallPath(folder)) {
        refuse(say.program(), 'EPROGRAM');
        continue;
      }
      if (isNetworkPath(folder)) {
        refuse(say.network(), 'ENETWORK');
        continue;
      }

      // A game's folder is Steam's business, exactly as B2 and B5 have it.
      const handoff = relocate.handoffFor(folder, { ...deps, cloud: { serviceForPath: () => null } });
      if (handoff) {
        handoffs.push({ path: folder, ...handoff });
        refuse(handoff.message, 'EHANDOFF');
        continue;
      }

      const tree = await treeCopy.walk(folder, { token, onProgress: ctx.onProgress });
      if (tree.cancelled) break;
      if (tree.files.length === 0) {
        refuse(say.empty(), 'EEMPTY');
        continue;
      }

      /* -- OneDrive: compressing a placeholder would download it ---------- */
      const service = (deps.cloud && deps.cloud.serviceForPath ? deps.cloud.serviceForPath : cloud.serviceForPath)(folder);
      if (service === 'OneDrive') {
        const query = (deps.cloud && deps.cloud.query) || cloudState.query;
        const answer = await query(tree.files.map((f) => f.abs)).catch(() => ({ ok: false }));
        if (answer && answer.ok) {
          let online = 0;
          for (const file of tree.files) {
            const st = answer.states.get(file.abs);
            if (st && !st.missing && !st.onDisk) online += 1;
          }
          if (online > 0) {
            refuse(say.online(online), 'EONLINEONLY');
            continue;
          }
        }
      }

      const before = await ntfs.measure(tree.files);

      // Uncompressing needs no estimate: it is the sizes running backwards.
      let guess = { ok: true, ratio: 1, sampled: 0, alreadyCompressed: 0, reason: null };
      if (!undo) {
        guess = await ntfs.estimate(tree.files, folder, { token });
        if (!guess.ok) {
          refuse(guess.reason === 'noRoom' ? say.noRoom() : say.unsupported(), 'EUNSUPPORTED');
          continue;
        }
      }

      totalBytes += before.logical;
      totalFiles += tree.files.length;
      onDiskBefore += before.disk;
      estimatedBytes += undo ? before.logical : Math.round(before.logical * guess.ratio);
      alreadyCompressed += guess.alreadyCompressed || 0;
      sampled += guess.sampled || 0;

      plan.push({
        path: folder,
        identity: id,
        tree,
        size: before.logical,
        onDisk: before.disk,
        files: tree.files.length,
        estimatedBytes: undo ? before.logical : Math.round(before.logical * guess.ratio),
        ratio: guess.ratio,
        sampled: guess.sampled || 0,
        alreadyCompressed: guess.alreadyCompressed || 0,
      });
    }

    return {
      plan,
      failed,
      needsAdmin: [],
      inUse: [],
      totalBytes,
      totalFiles,
      onDiskBefore,
      estimatedBytes,
      alreadyCompressed,
      sampled,
      handoffs,
      uncompress: undo,
      cancelled: token.cancelled,
    };
  },

  describe(planned, options = {}) {
    const undo = planned.uncompress === true;
    return {
      kind: 'compress',
      uncompress: undo,
      count: planned.plan.length,
      files: planned.totalFiles || 0,
      bytes: planned.totalBytes || 0,
      onDiskBefore: planned.onDiskBefore || 0,
      // What the folder is expected to take on the disk afterwards.
      estimatedBytes: planned.estimatedBytes || 0,
      estimatedFreedBytes: undo ? 0 : Math.max(0, (planned.onDiskBefore || 0) - (planned.estimatedBytes || 0)),
      alreadyCompressed: planned.alreadyCompressed || 0,
      sampled: planned.sampled || 0,
      // Unlike everything else this phase: no bin, so the space is simply back.
      freesOnVolume: !undo,
      reversible: 'manual',
      etaMs: 0,
      needsAdmin: 0,
      inUse: 0,
      refused: planned.failed ? planned.failed.length : 0,
      handoffs: (planned.handoffs || []).map((h) => ({ path: h.path, kind: h.kind, message: h.message })),
      folders: planned.plan.map((e) => ({
        path: e.path,
        bytes: e.size,
        onDisk: e.onDisk,
        files: e.files,
        estimatedBytes: e.estimatedBytes,
      })),
      ...(options.dryRun ? { dryRun: true } : {}),
    };
  },

  async apply(planned, options = {}, ctx = {}) {
    const deps = ctx.deps || {};
    const token = ctx.token || new CancelToken();
    const started = Date.now();
    const undo = planned.uncompress === true || options.uncompress === true;
    const set = deps.setCompression || ntfs.setCompression;

    const moved = [];
    const failed = [];
    let recordError = null;
    let freed = 0;

    for (const item of planned.plan) {
      if (token.cancelled) break;

      if (!sameFolder(await identity(item.path), item.identity)) {
        failed.push({ path: item.path, error: say.notThere(), code: 'ECHANGED' });
        continue;
      }

      const done = await set(item.path, !undo, { token });
      if (!done.ok) {
        failed.push({ path: item.path, error: say.failed(done.error || done.code), code: 'ECOMPACT' });
        continue;
      }

      // The real number, from the file system rather than from what `compact`
      // printed: the whole point of the feature is how much it actually gave.
      const after = await ntfs.measure(item.tree.files);
      const change = item.onDisk - after.disk;
      freed += Math.max(0, change);

      const record = {
        path: item.path,
        size: item.size,
        files: item.files,
        onDiskBefore: item.onDisk,
        onDiskAfter: after.disk,
        // Negative when uncompressing, which is honest: it took space back.
        changedBytes: change,
        estimatedBytes: item.estimatedBytes,
        durationMs: done.durationMs,
        uncompressed: undo,
      };
      moved.push(record);

      if (ctx.onItem) {
        try {
          await ctx.onItem({ ...record, size: Math.max(0, change) });
        } catch (err) {
          recordError = err.message || String(err);
          break;
        }
      }
    }

    return {
      moved,
      failed,
      // Nothing moved anywhere; the figure that matters is what came back.
      freedBytes: freed,
      measuredFreedBytes: undo ? 0 : freed,
      uncompress: undo,
      cancelled: token.cancelled,
      remaining: Math.max(0, planned.plan.length - moved.length - failed.length),
      durationMs: Date.now() - started,
      ...(recordError ? { recordError } : {}),
    };
  },
};
