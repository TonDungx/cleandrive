'use strict';

/**
 * Copying a whole folder somewhere else, and proving every file arrived.
 *
 * Written for B2 (move a folder to another drive) and deliberately knowing
 * nothing about drives, the Recycle Bin, or what should happen afterwards --
 * B5 packs a folder into an archive and E2 backs one up before deleting, and
 * both want this and none of that.
 *
 * What "faithful" means here, in the order the questions came up:
 *
 *   - **Every file, verified.** Copied through `verified-copy`, hashed on the
 *     way out and read back before it counts. A folder move that loses one
 *     file in a thousand is worse than one that refuses.
 *   - **Empty folders too.** A folder with nothing in it is still something
 *     somebody made, and a "move" that quietly drops it is not a move.
 *   - **Alternate data streams.** Enumerated in one pass for the whole tree
 *     and copied per file; `lib/ads.js` says why this matters more than it
 *     sounds. When they cannot be enumerated at all, that is reported as not
 *     knowing rather than as none.
 *   - **Times and the read-only bit**, set after the body and the streams,
 *     because writing either moves the modification time back to now.
 *   - **Nothing is followed.** A junction or symlink inside the tree is
 *     recorded and stepped over, never walked into and never recreated. Both
 *     of the other choices are wrong: following one copies somebody else's
 *     folder into this one, and recreating it produces a link whose target
 *     may be on the drive the files just left.
 *
 * Nothing in this file deletes anything, and nothing in it touches the source
 * beyond reading. The caller decides what the original's fate is once this has
 * said the copy is good.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const ads = require('./ads');
const { CancelToken, throttle } = require('./util');
const {
  longPath,
  plainPath,
  hashFile,
  copyHashed,
  copyMetadata,
  removeQuietly,
} = require('./verified-copy');

/** A copy still being written. Given its real name only once it is proved. */
const PARTIAL = '.cleandrive-partial';

/* -------------------------------------------------------------------------- */
/* reading the tree                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything under `root`, without following anything.
 *
 * Returns folders as well as files, relative to the root, so an empty one
 * survives the copy. `skipped` holds what was found and deliberately not
 * taken: links, and anything that could not be read.
 *
 * @returns {Promise<{files: object[], dirs: string[], totalBytes: number,
 *                    skipped: object[], cancelled: boolean}>}
 */
async function walk(root, { token = new CancelToken(), onProgress = null } = {}) {
  const files = [];
  const dirs = [];
  const skipped = [];
  let totalBytes = 0;

  const report = throttle(() => {
    if (onProgress) onProgress({ phase: 'reading', done: files.length, totalBytes });
  }, 150);

  const queue = [''];
  while (queue.length > 0) {
    if (token.cancelled) return { files, dirs, totalBytes, skipped, cancelled: true };
    const rel = queue.shift();
    const here = rel === '' ? root : path.join(root, rel);

    let entries;
    try {
      entries = await fsp.readdir(longPath(here), { withFileTypes: true });
    } catch (err) {
      skipped.push({ rel, reason: 'unreadable', error: err.message });
      continue;
    }

    for (const entry of entries) {
      if (token.cancelled) return { files, dirs, totalBytes, skipped, cancelled: true };
      const childRel = rel === '' ? entry.name : path.join(rel, entry.name);
      const childAbs = path.join(root, childRel);

      // A junction reports itself as a directory, so the link test comes first.
      if (entry.isSymbolicLink()) {
        skipped.push({ rel: childRel, reason: 'link' });
        continue;
      }

      let st;
      try {
        st = await fsp.lstat(longPath(childAbs));
      } catch (err) {
        skipped.push({ rel: childRel, reason: 'unreadable', error: err.message });
        continue;
      }

      // FILE_ATTRIBUTE_REPARSE_POINT: a junction, or a OneDrive placeholder
      // that has been dehydrated. `isSymbolicLink` misses junctions on some
      // Node versions, so the directory case is checked again here.
      if (st.isDirectory()) {
        dirs.push(childRel);
        queue.push(childRel);
        continue;
      }
      if (!st.isFile()) {
        skipped.push({ rel: childRel, reason: 'special' });
        continue;
      }

      files.push({ rel: childRel, abs: childAbs, size: st.size, mtime: st.mtime, atime: st.atime, mode: st.mode });
      totalBytes += st.size;
      report();
    }
  }

  if (onProgress) onProgress({ phase: 'reading', done: files.length, totalBytes });
  return { files, dirs, totalBytes, skipped, cancelled: false };
}

/* -------------------------------------------------------------------------- */
/* writing it somewhere else                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Copy a tree that `walk` has already read, verifying every file.
 *
 * `dest` must not exist: this creates it. That is a deliberate refusal to
 * merge into somewhere that already has things in it, because a merge cannot
 * be undone by deleting what was written.
 *
 * @param {object} tree           what `walk` returned
 * @param {string} root           the folder it was read from
 * @param {string} dest           where to put a copy of it
 * @returns {Promise<object>}     { ok, files, failed, bytes, streams, cancelled }
 */
async function copyTree(tree, root, dest, options = {}) {
  const token = options.token || new CancelToken();
  const onProgress = options.onProgress || (() => {});
  const write = options.write || null;
  const listStreams = options.listStreams || ads.list;

  const copied = [];
  const failed = [];
  let bytes = 0;

  const report = throttle((currentPath) => {
    onProgress({
      phase: 'copying',
      done: copied.length + failed.length,
      total: tree.files.length,
      bytes,
      totalBytes: tree.totalBytes,
      currentPath,
    });
  }, 150);

  /* -- the streams, once for the whole tree ------------------------------- */
  // One process for the batch rather than one per file: on this machine that
  // is the difference between a second and several minutes for a tree of any
  // size. `known: false` means the question could not be asked at all, which
  // the caller has to be able to say out loud.
  const answer = await listStreams(tree.files.map((f) => f.abs));
  const streamsOf = answer.ok ? answer.streams : new Map();
  const streamInfo = {
    known: answer.ok,
    error: answer.error || null,
    files: answer.ok ? streamsOf.size : 0,
    unreadable: answer.ok ? answer.unreadable.length : 0,
    copied: 0,
    lost: [],
  };

  /* -- the folders, deepest last so a parent always exists ---------------- */
  try {
    await fsp.mkdir(longPath(dest), { recursive: false });
  } catch (err) {
    return {
      ok: false,
      files: [],
      failed: [{ rel: '', error: err.message, code: err.code || 'EDEST' }],
      bytes: 0,
      streams: streamInfo,
      cancelled: false,
      destError: err.code === 'EEXIST' ? 'exists' : 'create',
    };
  }

  for (const rel of [...tree.dirs].sort((a, b) => a.length - b.length)) {
    try {
      await fsp.mkdir(longPath(path.join(dest, rel)), { recursive: true });
    } catch (err) {
      failed.push({ rel, error: err.message, code: err.code || 'EDIR' });
    }
  }

  /* -- the files ---------------------------------------------------------- */
  for (const file of tree.files) {
    if (token.cancelled) break;

    const target = path.join(dest, file.rel);
    const partial = `${target}${PARTIAL}`;
    const before = bytes;

    let result;
    try {
      result = await copyHashed(file.abs, partial, {
        token,
        write,
        onBytes: (n) => {
          bytes += n;
          report(file.rel);
        },
      });
    } catch (err) {
      bytes = before;
      await removeQuietly(partial);
      if (err.code === 'ECANCELLED') break;
      failed.push({ rel: file.rel, error: err.message, code: err.code || 'ECOPY' });
      report(file.rel);
      continue;
    }

    // Read it back. A write that returned success and produced different bytes
    // is the failure this whole function exists to make impossible.
    const readBack = await hashFile(partial).catch(() => null);
    if (readBack !== result.sha256) {
      bytes = before;
      await removeQuietly(partial);
      failed.push({ rel: file.rel, error: 'the copy did not read back the same', code: 'EVERIFY' });
      report(file.rel);
      continue;
    }

    try {
      await fsp.rename(longPath(partial), longPath(target));
    } catch (err) {
      bytes = before;
      await removeQuietly(partial);
      failed.push({ rel: file.rel, error: err.message, code: err.code || 'ERENAME' });
      report(file.rel);
      continue;
    }

    // Streams before times: writing a stream moves the file's mtime.
    const streams = streamsOf.get(file.abs) || [];
    if (streams.length > 0) {
      const moved = await ads.copy(file.abs, target, streams);
      streamInfo.copied += moved.copied.length;
      for (const miss of moved.failed) streamInfo.lost.push({ rel: file.rel, name: miss.name });
    }

    const metaProblems = await copyMetadata(file.abs, target, file);

    copied.push({
      rel: file.rel,
      bytes: result.bytes,
      sha256: result.sha256,
      streams: streams.map((s) => s.name),
      metaProblems: metaProblems.length > 0 ? metaProblems : undefined,
    });
    report(file.rel);
  }

  onProgress({
    phase: 'copying',
    done: copied.length + failed.length,
    total: tree.files.length,
    bytes,
    totalBytes: tree.totalBytes,
    currentPath: null,
  });

  return {
    ok: failed.length === 0 && !token.cancelled,
    files: copied,
    failed,
    bytes,
    streams: streamInfo,
    cancelled: token.cancelled,
  };
}

/**
 * Take a half-made copy back out.
 *
 * Used when a tree copy failed part way: what was written is this app's and
 * nothing else's, so removing it is safe in a way that removing anything else
 * would not be.
 */
async function discard(dest) {
  try {
    await fsp.rm(longPath(dest), { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message, path: plainPath(dest) };
  }
}

module.exports = { walk, copyTree, discard, PARTIAL };
