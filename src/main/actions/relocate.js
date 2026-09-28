'use strict';

/**
 * Moving a whole folder to another drive (B2).
 *
 * The difference from B1, which moves files, is not size -- it is that a
 * folder is a thing people have arranged. `Videos\2019` is not two hundred
 * files, it is a year. So this moves the arrangement: every file verified,
 * empty folders kept, names, times, the read-only bit and the alternate data
 * streams carried over, and nothing followed into a link. `lib/tree-copy.js`
 * does that part and says why each of those is not optional.
 *
 * The order is B1's, for B1's reason -- nothing happens to the original until
 * the copy has been read back and proved:
 *
 *   1. read the tree, without following anything
 *   2. copy it, hashing on the way out and verifying on the way in
 *   3. if anything at all failed, take the copy back out and stop: a folder
 *      half moved is worse than one not moved
 *   4. optionally leave a `.lnk` where it was -- never a junction, see
 *      `lib/shortcut.js`
 *   5. the original folder to the Recycle Bin, whole
 *   6. the journal line, after the move and not before
 *
 * ## What it refuses, and why each refusal exists
 *
 * **A folder an application owns.** Steam knows where its games are; moving
 * one behind its back gives you a library that cannot launch. The spec calls
 * for a `handoff` and that is what this reports -- Steam's own *Move install
 * folder*, or the app's settings page.
 *
 * **A folder Windows owns.** Documents, Pictures, Downloads and the rest are
 * registered in the shell, and the supported way to move one is
 * Properties -> Location, which updates the registration. Copying the files
 * and binning the folder leaves every program that asks Windows "where are
 * Documents?" pointing at a folder that is now in the Recycle Bin.
 *
 * **A folder inside OneDrive.** The files are not only here. Binning the
 * original is a delete, and a delete in a synced folder is a delete on every
 * device signed into that account.
 *
 * All three are reported as something to do elsewhere, not as an error.
 *
 * ## What "frees" means here
 *
 * Nothing, until the Recycle Bin is emptied -- the bin is on the drive the
 * folder just left. This is the same answer B1 gives, in the same words, and
 * `freesOnVolume` returns true only when the original is deleted outright
 * rather than binned.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const i18n = require('../../i18n');
const treeCopy = require('../lib/tree-copy');
const shortcut = require('../lib/shortcut');
const cloud = require('../lib/media/cloud');
const volumes = require('../lib/volumes');
const { moveToTrash } = require('../lib/trash');
const { CancelToken, isProtectedPath, isProgramInstallPath, isRootOrHome, isNetworkPath } = require('../lib/util');
const { identity, sameFolder, longPath, plainPath } = require('../lib/verified-copy');

/** How much room to leave on the destination beyond what is being copied. */
const MARGIN_BYTES = 256 * 1024 * 1024;

/** Why a folder was not moved, in the language the window is in. */
const say = {
  notThere: () => i18n.t('relocate.why.notThere', 'That folder is no longer there'),
  notAFolder: () => i18n.t('relocate.why.notAFolder', 'This moves folders, and that is not one'),
  root: () => i18n.t('relocate.why.root', 'A drive root or your home folder is not something to move'),
  system: () => i18n.t('relocate.why.system', 'This is a Windows system location'),
  network: () => i18n.t('relocate.why.network', 'A folder on the network is left alone'),
  sameVolume: () => i18n.t('relocate.why.sameVolume', 'That is the same drive, so nothing would be freed'),
  nested: () => i18n.t('relocate.why.nested', 'The destination is inside the folder being moved'),
  destInSource: () => i18n.t('relocate.why.destInSource', 'The folder being moved is inside the destination'),
  occupied: () => i18n.t('relocate.why.occupied', 'There is already something by that name in the destination'),
  full: (drive) => i18n.t('relocate.why.full', 'There is not enough room on {drive}', { drive }),
  noDestination: () => i18n.t('relocate.why.noDestination', 'No destination folder was chosen'),
  destUnusable: () => i18n.t('relocate.why.destUnusable', 'That destination cannot be written to'),
  empty: () => i18n.t('relocate.why.empty', 'There is nothing in that folder to move'),

  handoff: {
    app: (app) =>
      i18n.t('relocate.why.app', '{app} keeps track of where this is. Move it from inside {app} instead.', { app }),
    steam: () =>
      i18n.t('relocate.why.steam', 'Steam keeps track of where this game is — use Steam’s own “Move install folder”'),
    shell: (name) =>
      i18n.t(
        'relocate.why.shell',
        'Windows keeps track of where {name} is. Right-click it, then Properties → Location → Move.',
        { name }
      ),
    onedrive: () =>
      i18n.t(
        'relocate.why.onedrive',
        'This folder is in OneDrive, so its files are on other devices too. Moving it here would delete them there.'
      ),
  },
};

/* -------------------------------------------------------------------------- */
/* what this must not move                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The folders Windows itself has a registered location for.
 *
 * Read from the environment rather than asked of the shell, because the answer
 * only has to be good enough to *refuse*: a folder this misses is still vetted
 * by everything else, and a folder it names wrongly costs a handoff message
 * instead of a move. `deps.knownFolders` replaces the lot in a harness.
 */
function knownFolders(deps = {}) {
  if (Array.isArray(deps.knownFolders)) return deps.knownFolders;
  const home = process.env.USERPROFILE || os.homedir();
  if (!home) return [];
  return ['Documents', 'Pictures', 'Videos', 'Music', 'Downloads', 'Desktop', 'Favorites', 'Links', 'Saved Games'].map(
    (name) => ({ name, path: path.join(home, name) })
  );
}

const samePath = (a, b) => String(a || '').replace(/\\+$/, '').toLowerCase() === String(b || '').replace(/\\+$/, '').toLowerCase();

/** Whether `inner` is `outer` or sits underneath it. */
function inside(outer, inner) {
  const a = `${String(outer || '').replace(/\\+$/, '').toLowerCase()}\\`;
  const b = `${String(inner || '').replace(/\\+$/, '').toLowerCase()}\\`;
  return b.startsWith(a);
}

/**
 * Somebody else's job, and whose.
 *
 * Returns `{ kind, message }` or null. Order matters only in that the most
 * specific owner is named: a Steam game inside OneDrive is Steam's problem
 * first, because that is the tool that can actually move it.
 */
function handoffFor(folder, deps = {}) {
  const lower = String(folder).toLowerCase();

  if (lower.includes('\\steamapps\\common\\') || /\\steamapps\\common$/.test(lower)) {
    return { kind: 'steam', message: say.handoff.steam() };
  }
  if (isProgramInstallPath(folder)) {
    return { kind: 'app', message: say.handoff.app(path.basename(folder)) };
  }
  for (const known of knownFolders(deps)) {
    if (samePath(known.path, folder)) return { kind: 'shell', name: known.name, message: say.handoff.shell(known.name) };
  }
  const service = (deps.cloud && deps.cloud.serviceForPath ? deps.cloud.serviceForPath : cloud.serviceForPath)(folder);
  if (service) return { kind: 'onedrive', service, message: say.handoff.onedrive() };

  return null;
}

function refuseAll(items, error, extra = {}) {
  return {
    plan: [],
    failed: (items || []).map((p) => ({ path: p, error, code: extra.code || 'EREFUSED' })),
    needsAdmin: [],
    inUse: [],
    totalBytes: 0,
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */
/* the handler                                                                 */
/* -------------------------------------------------------------------------- */

module.exports = {
  kind: 'relocate',
  feature: 'pro.relocate',

  /** The first handler in this app that does: B2 is what folders are for. */
  allowsFolders: true,
  reversible: 'bin',

  /** In the bin it is still on the drive, exactly as B1 says of a file. */
  freesOnVolume(item, options) {
    return Boolean(options && options.deleteOriginal);
  },

  handoffFor,
  knownFolders,

  /**
   * Vet each folder and the destination, read the trees, touch nothing.
   *
   * The walk happens here rather than in `apply` so the confirmation can say
   * how many files and how many bytes, and so "there is not enough room" is
   * answered before anything is copied rather than half way through.
   */
  async plan(items, options = {}, ctx = {}) {
    const deps = ctx.deps || {};
    const token = ctx.token || new CancelToken();
    const list = (items || []).filter((p) => typeof p === 'string' && p !== '');
    const destination = options.destination || deps.destination || null;

    if (!destination) return refuseAll(list, say.noDestination(), { code: 'ENODEST' });

    let destStat;
    try {
      destStat = await fsp.stat(longPath(destination));
      if (!destStat.isDirectory()) return refuseAll(list, say.destUnusable(), { code: 'EDEST' });
    } catch {
      return refuseAll(list, say.destUnusable(), { code: 'EDEST' });
    }

    const destId = await identity(destination);
    const destDrive = await (deps.describePath || volumes.describePath)(destination);

    const plan = [];
    const failed = [];
    const handoffs = [];
    let totalBytes = 0;
    let totalFiles = 0;
    let skippedLinks = 0;
    let streamsUnknown = false;

    for (const folder of list) {
      if (token.cancelled) break;

      const refuse = (error, code) => failed.push({ path: folder, error, code });

      if (!path.isAbsolute(folder)) {
        refuse(say.notThere(), 'EPATH');
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
      if (isNetworkPath(folder) || isNetworkPath(destination)) {
        refuse(say.network(), 'ENETWORK');
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

      const handoff = handoffFor(folder, deps);
      if (handoff) {
        handoffs.push({ path: folder, ...handoff });
        refuse(handoff.message, 'EHANDOFF');
        continue;
      }

      if (inside(folder, destination)) {
        refuse(say.nested(), 'ENESTED');
        continue;
      }
      if (inside(destination, folder)) {
        refuse(say.destInSource(), 'EINDEST');
        continue;
      }
      if (destId && id.dev === destId.dev) {
        refuse(say.sameVolume(), 'ESAMEVOLUME');
        continue;
      }

      const target = path.join(destination, path.basename(folder));
      if (await fsp.stat(longPath(target)).then(() => true, () => false)) {
        refuse(say.occupied(), 'EOCCUPIED');
        continue;
      }

      const tree = await treeCopy.walk(folder, { token, onProgress: ctx.onProgress });
      if (tree.cancelled) break;
      if (tree.files.length === 0 && tree.dirs.length === 0) {
        refuse(say.empty(), 'EEMPTY');
        continue;
      }

      skippedLinks += tree.skipped.filter((s) => s.reason === 'link').length;
      totalBytes += tree.totalBytes;
      totalFiles += tree.files.length;
      plan.push({ path: folder, target, identity: id, tree, size: tree.totalBytes, files: tree.files.length });
    }

    if (plan.length > 0 && destDrive && Number.isFinite(destDrive.freeBytes)) {
      if (totalBytes + MARGIN_BYTES > destDrive.freeBytes) {
        const drive = plainPath(destDrive.root || destination);
        return {
          ...refuseAll(
            plan.map((e) => e.path),
            say.full(drive),
            { code: 'EFULL' }
          ),
          failed: [...failed, ...plan.map((e) => ({ path: e.path, error: say.full(drive), code: 'EFULL' }))],
          destination,
          handoffs,
        };
      }
    }

    return {
      plan,
      failed,
      needsAdmin: [],
      inUse: [],
      totalBytes,
      totalFiles,
      skippedLinks,
      streamsUnknown,
      handoffs,
      destination,
      destinationDrive: destDrive ? plainPath(destDrive.root || destination) : null,
      leaveShortcut: options.leaveShortcut === true,
      deleteOriginal: options.deleteOriginal === true,
      cancelled: token.cancelled,
    };
  },

  /** What the confirmation says, before anything has been copied. */
  describe(planned, options = {}) {
    return {
      kind: 'relocate',
      count: planned.plan.length,
      files: planned.totalFiles || 0,
      bytes: planned.totalBytes || 0,
      freesOnVolume: planned.deleteOriginal === true,
      deleteOriginal: planned.deleteOriginal === true,
      leaveShortcut: planned.leaveShortcut === true,
      reversible: planned.deleteOriginal === true ? 'none' : 'bin',
      etaMs: 0,
      needsAdmin: 0,
      inUse: 0,
      refused: planned.failed ? planned.failed.length : 0,
      destination: planned.destination || null,
      destinationDrive: planned.destinationDrive || null,
      skippedLinks: planned.skippedLinks || 0,
      handoffs: (planned.handoffs || []).map((h) => ({ path: h.path, kind: h.kind, message: h.message })),
      folders: planned.plan.map((e) => ({ path: e.path, target: e.target, bytes: e.size, files: e.files })),
      ...(options.dryRun ? { dryRun: true } : {}),
    };
  },

  /**
   * One folder at a time, and each one all the way or not at all.
   *
   * A folder whose copy failed anywhere is put back to how it was -- the
   * partial copy removed, the original untouched -- and the batch carries on
   * with the next. That is deliberate: folders are independent of one another
   * in a way the files inside one are not.
   */
  async apply(planned, options = {}, ctx = {}) {
    const deps = ctx.deps || {};
    const token = ctx.token || new CancelToken();
    const started = Date.now();
    const moved = [];
    const failed = [...(planned.failed || [])].filter(() => false); // apply reports only its own
    const trash = deps.moveToTrash || moveToTrash;
    const makeShortcut = (deps.shortcut && deps.shortcut.create) || shortcut.create;

    let freedBytes = 0;
    let recordError = null;
    let streamsCopied = 0;
    const streamsLost = [];
    let streamsKnown = true;

    const deleteOriginal = planned.deleteOriginal === true || options.deleteOriginal === true;
    const leaveShortcut = planned.leaveShortcut === true || options.leaveShortcut === true;

    for (const item of planned.plan) {
      if (token.cancelled) break;

      // The dialog may have sat open while something moved underneath it.
      if (!sameFolder(await identity(item.path), item.identity)) {
        failed.push({ path: item.path, error: say.notThere(), code: 'ECHANGED' });
        continue;
      }

      const copied = await treeCopy.copyTree(item.tree, item.path, item.target, {
        token,
        onProgress: ctx.onProgress,
        write: deps.write || null,
        listStreams: deps.listStreams || null,
      });

      if (copied.streams && copied.streams.known === false) streamsKnown = false;
      streamsCopied += copied.streams ? copied.streams.copied : 0;
      for (const lost of (copied.streams && copied.streams.lost) || []) streamsLost.push({ path: item.path, ...lost });

      if (!copied.ok) {
        await treeCopy.discard(item.target);
        if (copied.cancelled) break;
        const first = copied.failed[0];
        failed.push({
          path: item.path,
          error: i18n.t('relocate.why.copyFailed', 'The copy did not finish, so nothing was moved ({error})', {
            error: first ? first.error : 'unknown',
          }),
          code: 'ECOPY',
          detail: copied.failed.slice(0, 5),
        });
        continue;
      }

      // The original goes only now, and as a folder -- which is the one place
      // in this app where `allowDirectories` is turned on, for the one folder
      // that has just been copied and read back.
      const binned = await trash([item.path], { allowDirectories: true, shell: deps.shell }, { token });
      if (binned.failed.length > 0 || binned.moved.length === 0) {
        // The copy is good but the original could not go. Leaving both would
        // be two copies and no word about it, so the copy comes back out.
        await treeCopy.discard(item.target);
        const why = binned.failed[0] ? binned.failed[0].error : say.notThere();
        failed.push({
          path: item.path,
          error: i18n.t('relocate.why.binFailed', 'The copy was fine, but the original could not be moved ({error}), so nothing was changed', {
            error: why,
          }),
          code: 'EBIN',
        });
        continue;
      }

      if (deleteOriginal) freedBytes += item.size;

      let shortcutAt = null;
      if (leaveShortcut) {
        const link = `${item.path}.lnk`;
        const made = await makeShortcut(
          link,
          item.target,
          i18n.t('relocate.shortcut.note', 'Moved to {target} by CleanDrive', { target: item.target })
        );
        if (made.ok) shortcutAt = link;
        else streamsLost.push({ path: item.path, name: null, shortcutError: made.error });
      }

      const record = {
        path: item.path,
        target: item.target,
        size: item.size,
        files: copied.files.length,
        bytes: copied.bytes,
        shortcut: shortcutAt,
        manifest: copied.files.map((f) => ({ rel: f.rel, bytes: f.bytes, sha256: f.sha256 })),
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

    return {
      moved,
      failed,
      freedBytes: moved.reduce((n, m) => n + m.size, 0),
      measuredFreedBytes: deleteOriginal ? freedBytes : 0,
      streams: { known: streamsKnown, copied: streamsCopied, lost: streamsLost },
      cancelled: token.cancelled,
      remaining: Math.max(0, planned.plan.length - moved.length - failed.length),
      durationMs: Date.now() - started,
      ...(recordError ? { recordError } : {}),
    };
  },
};
