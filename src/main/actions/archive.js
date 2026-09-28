'use strict';

/**
 * Packing a folder into one file you can put somewhere and forget (B5).
 *
 * The order is B1's and B2's, for the same reason -- nothing happens to the
 * original until what replaced it has been read back off the disk and proved:
 *
 *   1. read the tree, without following anything
 *   2. write the `.zip`, hashing each file from the same read that feeds the
 *      compressor
 *   3. put a `manifest.json` inside it naming every file with its hash
 *   4. reopen the archive and check every member -- its CRC, its length, and
 *      its hash against the manifest
 *   5. only then, the original folder to the Recycle Bin
 *   6. the journal line
 *
 * Step 4 is the whole point of the feature and is not optional. An archive
 * that cannot be opened is not a backup, it is a folder that has been deleted.
 *
 * ## Compressed only where compression does something
 *
 * `lib/archive-zip.js` decides per file, on a 64 KB sample, and the numbers
 * behind that are in its header. What matters here is that the two examples
 * in the spec pull opposite ways: an old source project gives back 68%, and a
 * folder of photos and video gives back nothing at all. For the second the
 * value of this feature is that ten thousand files become one, not that it
 * shrinks -- and the confirmation says which of the two is about to happen,
 * with a figure, rather than letting somebody find out afterwards.
 *
 * ## The archive may live on the same drive
 *
 * B1 and B2 refuse that, because for them it would mean moving nothing
 * anywhere. Here it is the ordinary case for a source project -- packing one
 * in place is where compression earns the most -- so it is allowed, and the
 * confirmation states what will actually come back once the Recycle Bin is
 * emptied. For photos that figure is close to zero and says so.
 *
 * ## Getting it back
 *
 * A `.zip` opens in Explorer, so the way back exists whatever this app does.
 * But Explorer will not restore the timestamps and will not check anything, so
 * the Restore Center puts the folder back itself: every member extracted,
 * every CRC checked, every modification time set, and the manifest's hashes
 * compared. That is what `undo` below is.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const i18n = require('../../i18n');
const zip = require('../lib/archive-zip');
const treeCopy = require('../lib/tree-copy');
const volumes = require('../lib/volumes');
const { moveToTrash } = require('../lib/trash');
const { CancelToken } = require('../lib/util');
const { identity, sameFolder, longPath, plainPath } = require('../lib/verified-copy');
const relocate = require('./relocate');

/** The member that says what went in. Read by `undo`, and by a person. */
const MANIFEST = 'manifest.json';

/** Room left on the destination beyond the archive itself. */
const MARGIN_BYTES = 128 * 1024 * 1024;

/** How many files are sampled to guess the archive's size before writing it. */
const SAMPLE_FILES = 40;

const exists = (p) => fsp.stat(longPath(p)).then(() => true, () => false);

const say = {
  notThere: () => i18n.t('archive.why.notThere', 'That folder is no longer there'),
  notAFolder: () => i18n.t('archive.why.notAFolder', 'This packs folders, and that is not one'),
  root: () => i18n.t('archive.why.root', 'A drive root or your home folder is not something to pack away'),
  system: () => i18n.t('archive.why.system', 'This is a Windows system location'),
  network: () => i18n.t('archive.why.network', 'A folder on the network is left alone'),
  empty: () => i18n.t('archive.why.empty', 'There is nothing in that folder to pack'),
  occupied: () => i18n.t('archive.why.occupied', 'There is already a file by that name where the archive would go'),
  inside: () => i18n.t('archive.why.inside', 'The archive would be written inside the folder being packed'),
  full: (drive) => i18n.t('archive.why.full', 'There is not enough room on {drive}', { drive }),
  noDestination: () => i18n.t('archive.why.noDestination', 'No folder was chosen for the archive'),
  destUnusable: () => i18n.t('archive.why.destUnusable', 'That destination cannot be written to'),
  writeFailed: (error) =>
    i18n.t('archive.why.writeFailed', 'The archive could not be finished, so nothing was changed ({error})', { error }),
  verifyFailed: (n) =>
    i18n.t(
      'archive.why.verifyFailed',
      'The archive was written but {n} file(s) did not read back correctly, so the folder was left alone and the archive removed',
      { n }
    ),
  binFailed: (error) =>
    i18n.t('archive.why.binFailed', 'The archive is good, but the folder could not be moved ({error}), so nothing was changed', {
      error,
    }),
};

/** `Dự án cũ` -> `Dự án cũ.zip`, and `… (2).zip` if that is taken. */
async function freeName(destination, folder) {
  const stem = path.basename(folder).replace(/[\\/:*?"<>|]/g, '_');
  let candidate = path.join(destination, `${stem}.zip`);
  for (let n = 2; n < 100 && (await exists(candidate)); n++) {
    candidate = path.join(destination, `${stem} (${n}).zip`);
  }
  return candidate;
}

/**
 * Roughly how big the archive will be, before writing it.
 *
 * Sampled rather than computed: forty files, spread through the list, tried
 * on their first 64 KB. It is a guess and is labelled one on screen -- the
 * point is to tell a folder that will halve from a folder that will not
 * shrink at all, and forty files answers that.
 */
async function estimate(files) {
  if (files.length === 0) return { ratio: 1, sampled: 0 };
  const step = Math.max(1, Math.floor(files.length / SAMPLE_FILES));
  let raw = 0;
  let packed = 0;
  let sampled = 0;

  for (let at = 0; at < files.length && sampled < SAMPLE_FILES; at += step) {
    const file = files[at];
    let handle;
    try {
      handle = await fsp.open(longPath(file.abs), 'r');
      const worth = await zip.worthCompressing(handle, file.size);
      raw += file.size;
      // A file that is not worth compressing is stored, so it costs its size.
      packed += worth ? file.size * 0.45 : file.size;
      sampled += 1;
    } catch {
      // A file that cannot be opened now will be reported when it is packed.
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  return { ratio: raw > 0 ? Math.min(1, packed / raw) : 1, sampled };
}

/* -------------------------------------------------------------------------- */
/* getting it back                                                             */
/* -------------------------------------------------------------------------- */

const undo = {
  async locate(records, deps = {}) {
    const out = new Map();
    const reachable = new Map();

    for (const record of records) {
      if (!record.stored) {
        out.set(record, { state: 'gone', existsAtOrigin: await exists(record.path) });
        continue;
      }
      const root = path.parse(record.stored).root.toLowerCase();
      if (!reachable.has(root)) reachable.set(root, await exists(root));
      if (!reachable.get(root)) {
        out.set(record, { state: 'unavailable' });
        continue;
      }

      const st = await fsp.stat(longPath(record.stored)).catch(() => null);
      const existsAtOrigin = await exists(record.path);
      if (!st || !st.isFile()) {
        out.set(record, { state: 'gone', existsAtOrigin });
        continue;
      }

      // The index is read, not the contents: it is what says whether this is
      // still an archive this app can open, and it costs one seek.
      let entries = null;
      try {
        const read = deps.readIndex ? await deps.readIndex(record.stored) : await zip.index(record.stored);
        entries = read.entries.filter((entry) => !entry.directory && entry.name !== MANIFEST).length;
      } catch {
        out.set(record, { state: 'gone', existsAtOrigin, unreadable: true });
        continue;
      }

      out.set(record, {
        state: 'inArchive',
        stored: record.stored,
        archiveBytes: st.size,
        entries,
        existsAtOrigin,
      });
    }

    return out;
  },

  ready(located) {
    return located && located.stored ? exists(located.stored) : Promise.resolve(false);
  },

  /**
   * Unpack it where it came from.
   *
   * Never over anything: the Restore Center has already decided the target,
   * and an archive whose contents would land on files that exist is a
   * conflict it has to answer for, not something to resolve here. The archive
   * itself is left where it is -- unlike a quarantine, where the copy in the
   * zone is the only one and moving it back is the whole operation, here the
   * archive is a thing somebody chose to keep.
   */
  async putBack(located, target, ctx = {}) {
    if (!located || !located.stored) return { ok: false, code: 'ENOENT' };

    const out = await zip.extract(located.stored, target, {
      token: ctx.token || null,
      onProgress: ctx.onProgress || null,
      overwrite: false,
      // The manifest is this app's record of the archive, not a file that was
      // ever in the folder. Putting it back would hand somebody a file they
      // never had.
      skip: (entry) => entry.name === MANIFEST,
    });

    if (!out.ok) {
      // What was written before it went wrong is this app's, and taking it
      // back out is what keeps "nothing half done" true here too.
      if (out.written.length > 0) await fsp.rm(longPath(target), { recursive: true, force: true }).catch(() => {});
      const first = out.failed[0];
      return { ok: false, code: first ? first.code : 'EEXTRACT', detail: out.failed.slice(0, 5) };
    }

    return { ok: true, target, via: 'archive', files: out.written.length };
  },
};

/* -------------------------------------------------------------------------- */
/* the handler                                                                 */
/* -------------------------------------------------------------------------- */

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
  kind: 'archive',
  feature: 'pro.archive',
  allowsFolders: true,

  /** The archive is the way back, and the Restore Center knows how to use it. */
  reversible: 'journal',
  undo,

  MANIFEST,

  /**
   * In the Recycle Bin the folder is still on its drive, so nothing is freed
   * until the bin is emptied -- and when it is, what comes back is the
   * folder's size less the archive's, if the archive is on the same drive.
   */
  freesOnVolume(item, options) {
    return Boolean(options && options.deleteOriginal);
  },

  async plan(items, options = {}, ctx = {}) {
    const deps = ctx.deps || {};
    const token = ctx.token || new CancelToken();
    const list = (items || []).filter((p) => typeof p === 'string' && p !== '');
    const destination = options.destination || deps.destination || null;

    if (!destination) return refuseAll(list, say.noDestination(), 'ENODEST');
    if (!(await fsp.stat(longPath(destination)).then((s) => s.isDirectory(), () => false))) {
      return refuseAll(list, say.destUnusable(), 'EDEST');
    }

    const destDrive = await (deps.describePath || volumes.describePath)(destination).catch(() => null);
    const destId = await identity(destination);

    const plan = [];
    const failed = [];
    const handoffs = [];
    let totalBytes = 0;
    let totalFiles = 0;
    let estimatedArchiveBytes = 0;
    let skippedLinks = 0;

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

      // The same three owners B2 refuses, decided by the same code so the two
      // features can never disagree about whose folder this is.
      const handoff = relocate.handoffFor(folder, deps);
      if (handoff) {
        handoffs.push({ path: folder, ...handoff });
        refuse(handoff.message, 'EHANDOFF');
        continue;
      }

      const { isRootOrHome, isProtectedPath, isNetworkPath } = require('../lib/util');
      if (isRootOrHome(folder)) {
        refuse(say.root(), 'EROOT');
        continue;
      }
      if (isProtectedPath(folder)) {
        refuse(say.system(), 'ESYSTEM');
        continue;
      }
      if (isNetworkPath(folder) || isNetworkPath(destination)) {
        refuse(say.network(), 'ENETWORK');
        continue;
      }

      // Writing the archive into the folder it is packing would either eat its
      // own tail or leave a stray file behind in the bin.
      const destLower = `${destination.replace(/\\+$/, '').toLowerCase()}\\`;
      const folderLower = `${folder.replace(/\\+$/, '').toLowerCase()}\\`;
      if (destLower.startsWith(folderLower)) {
        refuse(say.inside(), 'EINSIDE');
        continue;
      }

      const tree = await treeCopy.walk(folder, { token, onProgress: ctx.onProgress });
      if (tree.cancelled) break;
      if (tree.files.length === 0) {
        refuse(say.empty(), 'EEMPTY');
        continue;
      }

      const target = options.target || (await freeName(destination, folder));
      if (await exists(target)) {
        refuse(say.occupied(), 'EOCCUPIED');
        continue;
      }

      const guess = await estimate(tree.files);
      const archiveBytes = Math.round(tree.totalBytes * guess.ratio);

      skippedLinks += tree.skipped.filter((s) => s.reason === 'link').length;
      totalBytes += tree.totalBytes;
      totalFiles += tree.files.length;
      estimatedArchiveBytes += archiveBytes;
      plan.push({
        path: folder,
        target,
        identity: id,
        tree,
        size: tree.totalBytes,
        files: tree.files.length,
        estimatedArchiveBytes: archiveBytes,
        sampled: guess.sampled,
        sameVolume: Boolean(destId && id.dev === destId.dev),
      });
    }

    if (plan.length > 0 && destDrive && Number.isFinite(destDrive.freeBytes)) {
      if (estimatedArchiveBytes + MARGIN_BYTES > destDrive.freeBytes) {
        const drive = plainPath(destDrive.root || destination);
        return {
          plan: [],
          failed: [...failed, ...plan.map((e) => ({ path: e.path, error: say.full(drive), code: 'EFULL' }))],
          needsAdmin: [],
          inUse: [],
          totalBytes: 0,
          destination,
          handoffs,
        };
      }
    }

    const sameVolume = plan.length > 0 && plan.every((e) => e.sameVolume);

    return {
      plan,
      failed,
      needsAdmin: [],
      inUse: [],
      totalBytes,
      totalFiles,
      estimatedArchiveBytes,
      // What emptying the bin would give back on the folder's own drive. When
      // the archive sits on that same drive it has to be paid for out of it.
      estimatedFreedBytes: sameVolume ? Math.max(0, totalBytes - estimatedArchiveBytes) : totalBytes,
      sameVolume,
      skippedLinks,
      handoffs,
      destination,
      destinationDrive: destDrive ? plainPath(destDrive.root || destination) : null,
      deleteOriginal: options.deleteOriginal === true,
      cancelled: token.cancelled,
    };
  },

  describe(planned, options = {}) {
    return {
      kind: 'archive',
      count: planned.plan.length,
      files: planned.totalFiles || 0,
      bytes: planned.totalBytes || 0,
      estimatedArchiveBytes: planned.estimatedArchiveBytes || 0,
      estimatedFreedBytes: planned.estimatedFreedBytes || 0,
      sameVolume: planned.sameVolume === true,
      freesOnVolume: planned.deleteOriginal === true,
      deleteOriginal: planned.deleteOriginal === true,
      reversible: planned.deleteOriginal === true ? 'journal' : 'bin',
      etaMs: 0,
      needsAdmin: 0,
      inUse: 0,
      refused: planned.failed ? planned.failed.length : 0,
      destination: planned.destination || null,
      destinationDrive: planned.destinationDrive || null,
      skippedLinks: planned.skippedLinks || 0,
      handoffs: (planned.handoffs || []).map((h) => ({ path: h.path, kind: h.kind, message: h.message })),
      folders: planned.plan.map((e) => ({
        path: e.path,
        target: e.target,
        bytes: e.size,
        files: e.files,
        estimatedArchiveBytes: e.estimatedArchiveBytes,
      })),
      ...(options.dryRun ? { dryRun: true } : {}),
    };
  },

  async apply(planned, options = {}, ctx = {}) {
    const deps = ctx.deps || {};
    const token = ctx.token || new CancelToken();
    const started = Date.now();
    const moved = [];
    const failed = [];
    const trash = deps.moveToTrash || moveToTrash;
    const deleteOriginal = planned.deleteOriginal === true || options.deleteOriginal === true;

    let recordError = null;
    let packedBytes = 0;
    let storedFiles = 0;
    let deflatedFiles = 0;

    for (const item of planned.plan) {
      if (token.cancelled) break;

      if (!sameFolder(await identity(item.path), item.identity)) {
        failed.push({ path: item.path, error: say.notThere(), code: 'ECHANGED' });
        continue;
      }

      /* -- write it, hashing on the way through -------------------------- */
      let written;
      try {
        written = await zip.write(item.target, item.tree.files, item.tree.dirs, {
          token,
          onProgress: ctx.onProgress,
          sha256: () => crypto.createHash('sha256'),
          // The manifest can only be written once everything it names has been.
          extra: (entries) => [
            {
              name: MANIFEST,
              body: JSON.stringify(
                {
                  tool: 'CleanDrive',
                  packedAt: new Date().toISOString(),
                  from: item.path,
                  files: entries.map((e) => ({ name: e.name, bytes: e.size, sha256: e.sha256, method: e.method })),
                },
                null,
                2
              ),
            },
          ],
        });
      } catch (err) {
        await fsp.rm(longPath(item.target), { force: true }).catch(() => {});
        if (err.code === 'ECANCELLED') break;
        failed.push({ path: item.path, error: say.writeFailed(err.message), code: 'EWRITE' });
        continue;
      }

      if (!written.ok) {
        await fsp.rm(longPath(item.target), { force: true }).catch(() => {});
        if (written.cancelled) break;
        const first = written.failed[0];
        failed.push({
          path: item.path,
          error: say.writeFailed(first ? first.error : 'unknown'),
          code: 'EWRITE',
          detail: written.failed.slice(0, 5),
        });
        continue;
      }

      /* -- read it back, which is the point ------------------------------ */
      const hashes = new Map();
      for (const entry of written.entries) {
        if (entry.sha256) hashes.set(entry.name, entry.sha256);
      }

      const checked = await zip.verify(item.target, {
        token,
        onProgress: ctx.onProgress,
        hashes,
        sha256: () => crypto.createHash('sha256'),
      });

      if (!checked.ok) {
        await fsp.rm(longPath(item.target), { force: true }).catch(() => {});
        if (checked.cancelled) break;
        failed.push({
          path: item.path,
          error: say.verifyFailed(checked.bad.length),
          code: 'EVERIFY',
          detail: checked.bad.slice(0, 5),
        });
        continue;
      }

      /* -- and only now the original ------------------------------------- */
      const binned = await trash([item.path], { allowDirectories: true, shell: deps.shell }, { token });
      if (binned.failed.length > 0 || binned.moved.length === 0) {
        await fsp.rm(longPath(item.target), { force: true }).catch(() => {});
        const why = binned.failed[0] ? binned.failed[0].error : say.notThere();
        failed.push({ path: item.path, error: say.binFailed(why), code: 'EBIN' });
        continue;
      }

      const archiveBytes = written.archiveBytes;
      packedBytes += archiveBytes;
      storedFiles += written.entries.filter((e) => e.method === 'store').length;
      deflatedFiles += written.entries.filter((e) => e.method === 'deflate').length;

      const record = {
        path: item.path,
        to: item.target,
        size: item.size,
        // The person's files. The manifest is the app's own bookkeeping and
        // counting it would make every receipt one out.
        files: written.entries.filter((e) => e.name !== MANIFEST).length,
        archiveBytes,
        checked: checked.checked,
        zip64: written.zip64,
      };
      moved.push(record);

      if (ctx.onItem) {
        try {
          await ctx.onItem(record);
        } catch (err) {
          recordError = err.message || String(err);
          break;
        }
      }
    }

    const packedFrom = moved.reduce((n, m) => n + m.size, 0);

    return {
      moved,
      failed,
      freedBytes: packedFrom,
      // What the drive actually gets back, which is not the folder's size when
      // the archive is sitting next to where it used to be.
      measuredFreedBytes: deleteOriginal ? Math.max(0, packedFrom - (planned.sameVolume ? packedBytes : 0)) : 0,
      archive: { bytes: packedBytes, stored: storedFiles, deflated: deflatedFiles },
      cancelled: token.cancelled,
      remaining: Math.max(0, planned.plan.length - moved.length - failed.length),
      durationMs: Date.now() - started,
      ...(recordError ? { recordError } : {}),
    };
  },
};
