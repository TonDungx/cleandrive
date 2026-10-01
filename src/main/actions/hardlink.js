'use strict';

/**
 * Making two identical copies into one file (F4).
 *
 * The highest-risk action in the app, and the only one that changes what a
 * file *is* rather than where it lives. Everything else here either moves
 * bytes somewhere recoverable or asks Windows to store them differently; this
 * one takes two names that happen to hold the same thing and makes them hold
 * the same thing *necessarily*, for as long as both names exist.
 *
 * `lib/hardlink.js` holds what was measured and why the exclusions are what
 * they are. This file is the pipeline's share of it: vet, re-verify, link,
 * record, and know how to take it apart again.
 *
 * ## Three gates, and none of them is in the window
 *
 *   1. `pro.dev`, like the rest of the Developer Pack. `execute` checks it.
 *   2. A hidden switch in Settings -> Developer, off out of the box. `ipc.js`
 *      checks it, because it is a setting and this file has no business
 *      reading settings.
 *   3. `options.acknowledged`, which only the scrolled-to-the-end
 *      confirmation sets. `apply` refuses without it, so a caller that skips
 *      the dialog links nothing -- including a future caller nobody has
 *      written yet.
 *
 * ## It never trusts the window about what is identical
 *
 * The window sends pairs -- this copy, that keeper -- because the Duplicates
 * screen is what knows about groups. But a hash from a scan minutes old is a
 * claim about a file as it was, and linking on a stale claim *destroys* the
 * copy: its bytes are dropped and replaced by the keeper's. So `plan` reads
 * both files and hashes them here, immediately before the link, and a pair
 * that does not agree is refused rather than linked.
 *
 * ## What it refuses, beyond the usual
 *
 * The usual is what every handler refuses: system locations, installed
 * programs, drive roots and home folders, the network. On top of that:
 *
 *   - anything not on the same volume, because a hard link cannot cross one;
 *   - anything not on NTFS, asked by reading the volume rather than assumed;
 *   - documents whose programs save by replacing the file (measured -- see
 *     `lib/hardlink.js`);
 *   - anything inside a sync folder, because the service will see a file it
 *     did not write and may copy, replace or conflict-rename it;
 *   - anything inside the photo roots, which is where E1 through E5 send
 *     people to delete things, and where a "delete this copy" that frees
 *     nothing would be at its most confusing.
 */

const os = require('node:os');
const path = require('node:path');

const i18n = require('../../i18n');
const hardlink = require('../lib/hardlink');
const cloud = require('../lib/media/cloud');
const volumes = require('../lib/volumes');
const mediaRoots = require('../lib/media/roots');
const {
  CancelToken,
  isProtectedPath,
  isProgramInstallPath,
  isRootOrHome,
  isNetworkPath,
  pathKey,
} = require('../lib/util');

const say = {
  notThere: () => i18n.t('hardlink.why.notThere', 'That file is no longer there'),
  notAFile: () => i18n.t('hardlink.why.notAFile', 'This joins files, and that is not one'),
  noKeeper: () => i18n.t('hardlink.why.noKeeper', 'No copy was named to keep, so there is nothing to join this to'),
  keeperGone: () => i18n.t('hardlink.why.keeperGone', 'The copy being kept is no longer there'),
  itself: () => i18n.t('hardlink.why.itself', 'That is the copy being kept'),
  already: () => i18n.t('hardlink.why.already', 'These two names are already one file'),
  otherVolume: () =>
    i18n.t('hardlink.why.otherVolume', 'The two copies are on different drives, and a hard link cannot cross one'),
  notNtfs: (fs) =>
    i18n.t('hardlink.why.notNtfs', 'This drive is {fs}, and only NTFS can give one file two names', { fs }),
  office: () =>
    i18n.t(
      'hardlink.why.office',
      'Word, Excel and the like save by writing a new file over the old one, which breaks the join without saying so'
    ),
  synced: (service) =>
    i18n.t('hardlink.why.synced', 'This is inside {service}, which would see a file it did not write', { service }),
  photos: () => i18n.t('hardlink.why.photos', 'This is inside a folder the Photos screen manages'),
  system: () => i18n.t('hardlink.why.system', 'This is a Windows system location'),
  program: () => i18n.t('hardlink.why.program', 'This belongs to an installed program, so it is left alone'),
  network: () => i18n.t('hardlink.why.network', 'A file on the network is left alone'),
  root: () => i18n.t('hardlink.why.root', 'A drive root or your home folder is not something to join'),
  differs: () =>
    i18n.t(
      'hardlink.why.differs',
      'Read again just now, the two copies are no longer identical — so joining them would destroy this one'
    ),
  unreadable: (error) => i18n.t('hardlink.why.unreadable', 'It could not be read ({error})', { error }),
  notAcknowledged: () =>
    i18n.t('hardlink.why.notAcknowledged', 'The warning was not confirmed, so nothing was joined'),
};

/** Is this path inside one of the folders the Photos screen scans? */
function insidePhotoRoot(filePath, roots) {
  const here = pathKey(filePath);
  return roots.some((root) => {
    const key = pathKey(root);
    return here === key || here.startsWith(key.endsWith(path.sep) ? key : key + path.sep);
  });
}

/**
 * The photo folders, when the caller did not say.
 *
 * `roots.candidateRoots` needs Electron's known-folder paths, which a handler
 * has no way to ask for, so `ipc.js` passes the real list in. This is the net
 * underneath that: the same folder names hung off the home directory. It
 * misses a Pictures folder redirected into OneDrive -- and that one is already
 * refused a few lines earlier for being inside a sync folder, which is the
 * only reason a weaker fallback is acceptable here.
 */
function photoRootsFromHome() {
  const home = os.homedir();
  if (!home) return [];
  return [
    path.join(home, 'Pictures'),
    path.join(home, 'Videos'),
    ...mediaRoots.HOME_FOLDERS.map((folder) => path.join(home, ...folder.relative)),
  ];
}

/* -------------------------------------------------------------------------- */
/* undo: every link taken back apart into a file of its own                     */
/* -------------------------------------------------------------------------- */

const undo = {
  /**
   * Unlike every other kind, the file never went anywhere: it is at its
   * original path, and always has been. `restore.js` reads this to skip the
   * "something is already in the way" check, which would otherwise call every
   * single one of these a conflict and skip them all.
   */
  inPlace: true,

  async locate(records, deps = {}) {
    const out = new Map();
    const identify = (deps.hardlink && deps.hardlink.identify) || hardlink.identify;
    for (const record of records) {
      const here = await identify(record.path);
      if (!here || !here.file) {
        out.set(record, { state: 'gone', existsAtOrigin: false });
        continue;
      }
      if (here.nlink <= 1) {
        // Somebody already split it -- an editor that saves by replacing, or
        // this screen on an earlier run. Either way there is nothing to undo.
        out.set(record, { state: 'restored', at: null, to: record.path, stillThere: true });
        continue;
      }
      out.set(record, {
        state: 'linked',
        existsAtOrigin: true,
        links: here.nlink,
        bytes: here.size,
        // Undoing needs room for a whole second copy, and the Restore Center
        // says so before the button is pressed rather than after.
        needsBytes: here.size,
        sha256: record.sha256 || null,
      });
    }
    return out;
  },

  ready(located) {
    return Promise.resolve(Boolean(located && located.state === 'linked'));
  },

  /**
   * Split this name off into a file of its own. `target` is the file's own
   * path: nothing moves, so there is nowhere else for it to go.
   */
  async putBack(located, target) {
    const done = await hardlink.splitOff(target, { sha256: located ? located.sha256 : null });
    if (!done.ok) return { ok: false, code: done.code || 'ESPLIT', error: done.error };
    return { ok: true, to: target, bytes: done.bytes, changed: done.changed, streamsKnown: done.streamsKnown };
  },
};

/* -------------------------------------------------------------------------- */

module.exports = {
  kind: 'hardlink',
  feature: 'pro.dev',

  /** A folder cannot be hard linked on Windows, and nothing here pretends. */
  allowsFolders: false,

  /** Undoable: every link can be split back into a file of its own. */
  reversible: 'journal',

  /**
   * True. The copy's blocks are released as the link is made -- no bin, no
   * second step. `planner/plan.js` has said `hardlink: 'now'` since before
   * this handler existed, and `test-planner.js` checks the two agree.
   */
  freesOnVolume() {
    return true;
  },

  async plan(items, options = {}, ctx = {}) {
    const deps = ctx.deps || {};
    const token = ctx.token || new CancelToken();
    const keepers = (options && options.keepers) || {};
    const list = (items || []).filter((p) => typeof p === 'string' && p !== '');
    const identify = (deps.hardlink && deps.hardlink.identify) || hardlink.identify;
    const digest = (deps.hardlink && deps.hardlink.hashOf) || hardlink.hashOf;
    const serviceForPath = (deps.cloud && deps.cloud.serviceForPath) || cloud.serviceForPath;
    const describePath = (deps.volumes && deps.volumes.describePath) || volumes.describePath;
    const photoRoots = Array.isArray(deps.photoRoots) ? deps.photoRoots : photoRootsFromHome();

    const plan = [];
    const failed = [];
    const already = [];
    let totalBytes = 0;

    // One question per volume rather than per file: the answer cannot differ
    // between two files on the same drive, and each one is a Windows call.
    const fileSystems = new Map();
    const fileSystemOf = async (p) => {
      const volume = path.parse(path.resolve(p)).root.toUpperCase();
      if (!fileSystems.has(volume)) {
        const described = await describePath(p).catch(() => null);
        fileSystems.set(volume, described ? described.fileSystem : null);
      }
      return fileSystems.get(volume);
    };

    for (const copyPath of list) {
      if (token.cancelled) break;
      const refuse = (error, code) => failed.push({ path: copyPath, error, code });

      if (!path.isAbsolute(copyPath)) {
        refuse(say.notThere(), 'EPATH');
        continue;
      }
      const keeperPath = keepers[copyPath];
      if (typeof keeperPath !== 'string' || keeperPath === '') {
        refuse(say.noKeeper(), 'ENOKEEPER');
        continue;
      }
      if (pathKey(copyPath) === pathKey(keeperPath)) {
        refuse(say.itself(), 'ESELF');
        continue;
      }

      /* -- the refusals every handler makes ------------------------------- */
      if (isRootOrHome(copyPath) || isRootOrHome(keeperPath)) {
        refuse(say.root(), 'EROOT');
        continue;
      }
      if (isProtectedPath(copyPath) || isProtectedPath(keeperPath)) {
        refuse(say.system(), 'ESYSTEM');
        continue;
      }
      if (isProgramInstallPath(copyPath) || isProgramInstallPath(keeperPath)) {
        refuse(say.program(), 'EPROGRAM');
        continue;
      }
      if (isNetworkPath(copyPath) || isNetworkPath(keeperPath)) {
        refuse(say.network(), 'ENETWORK');
        continue;
      }

      /* -- the refusals only this action makes ---------------------------- */
      if (hardlink.replacedOnSave(copyPath) || hardlink.replacedOnSave(keeperPath)) {
        refuse(say.office(), 'EREPLACEDONSAVE');
        continue;
      }
      const service = serviceForPath(copyPath) || serviceForPath(keeperPath);
      if (service) {
        refuse(say.synced(service), 'ESYNCED');
        continue;
      }
      if (insidePhotoRoot(copyPath, photoRoots) || insidePhotoRoot(keeperPath, photoRoots)) {
        refuse(say.photos(), 'EPHOTOS');
        continue;
      }

      /* -- what the disk says --------------------------------------------- */
      const [here, keeper] = await Promise.all([identify(copyPath), identify(keeperPath)]);
      if (!here) {
        refuse(say.notThere(), 'ENOENT');
        continue;
      }
      if (!here.file) {
        refuse(say.notAFile(), 'ENOTFILE');
        continue;
      }
      if (!keeper || !keeper.file) {
        refuse(say.keeperGone(), 'EKEEPERGONE');
        continue;
      }
      if (hardlink.sameFile(here, keeper)) {
        // Not a failure: it is the state the action was trying to reach. It is
        // counted and reported separately so a second run over the same
        // selection says "already done" rather than "nothing worked".
        already.push({ path: copyPath, keeper: keeperPath, bytes: here.size });
        continue;
      }
      if (here.dev !== keeper.dev) {
        refuse(say.otherVolume(), 'EXDEV');
        continue;
      }
      const fileSystem = await fileSystemOf(copyPath);
      if (fileSystem && fileSystem.toUpperCase() !== 'NTFS') {
        refuse(say.notNtfs(fileSystem), 'ENOTNTFS');
        continue;
      }
      if (here.size !== keeper.size) {
        refuse(say.differs(), 'EDIFFERS');
        continue;
      }

      /* -- read both, now, and only then believe they are the same -------- */
      let hashes;
      try {
        hashes = await Promise.all([digest(copyPath), digest(keeperPath)]);
      } catch (err) {
        refuse(say.unreadable(err.code || err.message), 'EHASH');
        continue;
      }
      if (hashes[0] !== hashes[1]) {
        refuse(say.differs(), 'EDIFFERS');
        continue;
      }

      plan.push({
        path: copyPath,
        keeper: keeperPath,
        size: here.size,
        mtimeMs: here.mtimeMs,
        sha256: hashes[0],
        keeperLinks: keeper.nlink,
      });
      totalBytes += here.size;
    }

    return {
      plan,
      failed,
      already,
      needsAdmin: [],
      inUse: [],
      totalBytes,
      cancelled: token.cancelled,
    };
  },

  describe(planned, options = {}) {
    return {
      kind: 'hardlink',
      count: planned.plan.length,
      bytes: planned.totalBytes || 0,
      // Every byte of every copy joined comes straight back: the copy's blocks
      // are released as its name starts pointing at the keeper's file.
      freedBytes: planned.totalBytes || 0,
      freesOnVolume: true,
      reversible: 'journal',
      alreadyJoined: (planned.already || []).length,
      etaMs: 0,
      needsAdmin: 0,
      inUse: 0,
      refused: planned.failed ? planned.failed.length : 0,
      // Why each refusal happened, counted -- the dialog says "4 left alone:
      // 3 Office documents, 1 in OneDrive" rather than a number on its own.
      refusedBy: (planned.failed || []).reduce((tally, one) => {
        tally[one.code] = (tally[one.code] || 0) + 1;
        return tally;
      }, {}),
      files: planned.plan.map((one) => ({ path: one.path, keeper: one.keeper, bytes: one.size })),
      ...(options.dryRun ? { dryRun: true } : {}),
    };
  },

  async apply(planned, options = {}, ctx = {}) {
    const token = ctx.token || new CancelToken();
    const started = Date.now();
    const deps = ctx.deps || {};
    const join = (deps.hardlink && deps.hardlink.link) || hardlink.link;
    const identify = (deps.hardlink && deps.hardlink.identify) || hardlink.identify;

    // The third gate. Not a belt-and-braces check on the window: it is the one
    // that survives somebody wiring a new caller straight to `execute`.
    if (options.acknowledged !== true) {
      return {
        moved: [],
        failed: planned.plan.map((one) => ({ path: one.path, error: say.notAcknowledged(), code: 'EUNCONFIRMED' })),
        freedBytes: 0,
        cancelled: false,
        remaining: planned.plan.length,
        durationMs: Date.now() - started,
      };
    }

    const moved = [];
    const failed = [];
    let freed = 0;
    let recordError = null;

    for (const item of planned.plan) {
      if (token.cancelled) break;

      // Read both once more. Between the plan and here sits a confirmation
      // dialog somebody may have left open, and this action cannot be wrong.
      const [here, keeper] = await Promise.all([identify(item.path), identify(item.keeper)]);
      if (!here || !here.file || !keeper || !keeper.file) {
        failed.push({ path: item.path, error: say.notThere(), code: 'ECHANGED' });
        continue;
      }
      if (hardlink.sameFile(here, keeper)) continue;
      if (here.size !== item.size || keeper.size !== item.size || here.mtimeMs !== item.mtimeMs) {
        failed.push({ path: item.path, error: say.differs(), code: 'ECHANGED' });
        continue;
      }

      const done = await join(item.path, item.keeper);
      if (!done.ok) {
        failed.push({ path: item.path, error: done.error || done.code, code: done.code || 'ELINK' });
        continue;
      }

      freed += item.size;
      const record = {
        path: item.path,
        // The keeper: what this name now points at, and what the Restore
        // Center needs in order to say what it was joined to.
        to: item.keeper,
        size: item.size,
        mtimeMs: item.mtimeMs,
        sha256: item.sha256,
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
      freedBytes: freed,
      // Measured the same way it is promised: the copy's blocks are gone the
      // moment its name points elsewhere.
      measuredFreedBytes: freed,
      cancelled: token.cancelled,
      remaining: Math.max(0, planned.plan.length - moved.length - failed.length),
      durationMs: Date.now() - started,
      ...(recordError ? { recordError } : {}),
    };
  },

  undo,
};
