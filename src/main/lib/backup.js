'use strict';

/**
 * A copy kept somewhere else, made before anything is deleted (E2).
 *
 * The roadmap calls this "back up before deleting" and specifies the order
 * exactly: copy, hash, write a manifest, and only then let the originals go to
 * the bin. The order is the whole feature. A backup written after the delete,
 * or trusted without being read back, is a backup nobody can rely on at the
 * one moment they need it.
 *
 * ## What this is not
 *
 * It is not the quarantine (B1). The quarantine owns its folder, names it
 * after a session, tracks it in the journal, expires it and can put it back;
 * its copy is the *only* copy once the original is gone. This writes into a
 * folder the user chose and then forgets it: the copy is a second copy, the
 * original still goes to the Recycle Bin, and nothing here is reversible
 * because nothing here needs to be. Restore Center does not list these.
 *
 * It is not `tree-copy.js` either, which the plan for this item assumed. That
 * module copies one folder to a destination that must not exist yet, from a
 * single root. What arrives here is a list of loose files chosen on the Photos
 * screen, from any number of folders and possibly more than one drive, into a
 * destination that usually already exists and is meant to be written to again
 * next week. The shared part -- the hashed copy itself -- is
 * `verified-copy.js`, which both use.
 *
 * ## Where a file lands
 *
 * `manifest.json` at the top, and under it the original path with the volume
 * as the first folder:
 *
 *     C:\Users\me\Pictures\trip\a.jpg   ->   <dest>\C\Users\me\Pictures\trip\a.jpg
 *     \\nas\photos\2019\b.jpg           ->   <dest>\UNC\nas\photos\2019\b.jpg
 *
 * The volume has to be in there. A selection on the Photos screen can span
 * drives -- this machine has pictures on C: and on D: -- and without it
 * `C:\photos\a.jpg` and `D:\photos\a.jpg` are the same destination, which
 * would mean a backup that silently kept one of the two.
 *
 * Nothing here ever overwrites. A destination that already holds a file with
 * the same contents is left alone and counted as already backed up; one that
 * holds something different gets ` (2)` and so on.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const ads = require('./ads');
const { t } = require('../../i18n');
const { CancelToken, throttle } = require('./util');
const {
  copyHashed,
  copyMetadata,
  hashFile,
  longPath,
  plainPath,
  removeQuietly,
} = require('./verified-copy');

/** The file at the top of the destination, named by the spec. */
const MANIFEST_NAME = 'manifest.json';

/** Bumped only if the shape below changes in a way a reader would trip over. */
const MANIFEST_VERSION = 1;

/** How many ` (2)`, ` (3)` … are tried before a file is reported as refused. */
const MAX_SUFFIX = 99;

/**
 * The volume a path is on, as one folder name.
 *
 * `path.parse` is not used for this: on Windows it returns `C:` for a drive
 * and a bare `\\` for a UNC path, so every server would collapse into one
 * folder called nothing. Measured, not assumed -- that is what it returns.
 */
function volumeFolder(target) {
  const value = String(target || '');

  const unc = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(value);
  if (unc) return { folder: path.join('UNC', unc[1], unc[2]), rest: value.slice(unc[0].length) };

  const drive = /^([A-Za-z]):[\\/]+/.exec(value);
  if (drive) return { folder: drive[1].toUpperCase(), rest: value.slice(drive[0].length) };

  return null;
}

/**
 * Where one original belongs under the destination, relative to it.
 *
 * Returns null for anything that is not an absolute local or UNC path. The
 * caller refuses those rather than inventing a place for them.
 */
function relativeFor(source) {
  const value = String(source || '');
  // Checked before `path.resolve`, not after. `path.resolve('')` is the
  // process's working directory, so resolving first turns an empty path --
  // or a null, or a number -- into a real folder and would have this quietly
  // back up the app's own directory. The harness caught exactly that.
  if (!path.isAbsolute(value)) return null;

  const parsed = volumeFolder(path.resolve(value));
  if (!parsed) return null;
  const rest = parsed.rest.replace(/^[\\/]+/, '');
  if (rest === '') return null;
  return path.join(parsed.folder, rest);
}

/** `a.jpg` and 2 -> `a (2).jpg`. The suffix goes before the extension. */
function withSuffix(target, n) {
  const ext = path.extname(target);
  return `${target.slice(0, target.length - ext.length)} (${n})${ext}`;
}

/**
 * A free name for this file, and whether the copy is already there.
 *
 * "Already there" means same size and same hash. Same name and same size is
 * not enough: two photos out of one burst are routinely the same length, and
 * treating one as a backup of the other is the failure this whole item exists
 * to avoid.
 */
async function placeFor(target, source, sourceStats) {
  for (let n = 0; n <= MAX_SUFFIX; n++) {
    const candidate = n === 0 ? target : withSuffix(target, n + 1);
    let stats;
    try {
      stats = await fsp.lstat(longPath(candidate));
    } catch (err) {
      if (err.code === 'ENOENT') return { target: candidate, already: false };
      throw err;
    }
    if (stats.isFile() && stats.size === sourceStats.size) {
      const [there, here] = await Promise.all([hashFile(candidate), hashFile(source)]);
      if (there === here) return { target: candidate, already: true, sha256: there };
    }
  }
  return null;
}

/**
 * Copy one file and prove it arrived.
 *
 * Three facts have to agree before this returns ok: what was read while
 * writing, what the destination holds when it is read back, and how long it
 * is. A copy that fails any of them is deleted again -- leaving half a photo
 * next to a manifest that claims it is whole is worse than not copying it.
 */
async function backupOne(item, destRoot, ctx = {}) {
  const token = ctx.token || new CancelToken();
  const onBytes = ctx.onBytes || (() => {});
  const source = item.path;

  const relative = relativeFor(source);
  if (!relative) {
    return { ok: false, error: t('backup.error.path', 'Not a path that can be backed up'), code: 'EPATH' };
  }
  const wanted = path.join(destRoot, relative);

  let stats;
  try {
    stats = await fsp.stat(longPath(source));
  } catch (err) {
    return { ok: false, error: err.message, code: err.code || 'ESTAT' };
  }

  await fsp.mkdir(longPath(path.dirname(wanted)), { recursive: true });

  const place = await placeFor(wanted, source, stats).catch((err) => ({ error: err }));
  if (!place) {
    return { ok: false, error: t('backup.error.names', 'Too many files of this name are already here'), code: 'EEXIST' };
  }
  if (place.error) return { ok: false, error: place.error.message, code: place.error.code || 'ESTAT' };

  // Already backed up, byte for byte. Counted as saved, because for the
  // question this answers -- may the original go? -- it is.
  if (place.already) {
    return {
      ok: true,
      already: true,
      target: place.target,
      relative: path.relative(destRoot, place.target),
      bytes: stats.size,
      sha256: place.sha256,
      mtimeMs: stats.mtimeMs,
      streams: [],
    };
  }

  let copied;
  try {
    copied = await copyHashed(source, place.target, { token, onBytes, write: ctx.write || null });
  } catch (err) {
    await removeQuietly(place.target);
    if (err.code === 'ECANCELLED') return { ok: false, cancelled: true };
    return { ok: false, error: err.message, code: err.code || 'ECOPY' };
  }

  if (copied.bytes !== stats.size) {
    await removeQuietly(place.target);
    return {
      ok: false,
      error: t('backup.error.length', 'The copy is a different length from the original'),
      code: 'EVERIFY',
    };
  }

  // Read back from the destination, not from the buffer that wrote it. A drive
  // that accepts a write and returns something else is exactly what this is
  // for, and only a second read can tell.
  let readBack;
  try {
    readBack = await hashFile(place.target);
  } catch (err) {
    await removeQuietly(place.target);
    return { ok: false, error: err.message, code: err.code || 'EVERIFY' };
  }
  if (readBack !== copied.sha256) {
    await removeQuietly(place.target);
    return {
      ok: false,
      error: t('backup.error.hash', 'The copy does not match the original'),
      code: 'EVERIFY',
    };
  }

  /* -- the streams, then the times, in that order ------------------------- */
  // Writing a stream touches the file's modification time, so the times go on
  // last. `verified-copy.js` says the same thing where it sets them.
  const streams = (ctx.streams && ctx.streams.get(source)) || [];
  const streamsCopied = [];
  const streamsFailed = [];
  if (streams.length > 0) {
    const out = await ads.copy(source, place.target, streams).catch(() => null);
    if (out) {
      streamsCopied.push(...out.copied);
      streamsFailed.push(...out.failed);
    }
  }

  const metaProblems = await copyMetadata(source, place.target, stats).catch(() => []);

  return {
    ok: true,
    already: false,
    target: place.target,
    relative: path.relative(destRoot, place.target),
    bytes: copied.bytes,
    sha256: copied.sha256,
    mtimeMs: stats.mtimeMs,
    streams: streamsCopied,
    streamsFailed,
    metaProblems,
  };
}

/**
 * Read the manifest that is already there, if it is one.
 *
 * A destination folder is the user's, and anything may be in it. A
 * `manifest.json` that does not parse, or that is not this app's, is left
 * exactly where it is and a new manifest is written beside it under another
 * name -- overwriting somebody's file because it had the name we wanted is not
 * a thing this app does.
 */
async function readManifest(destRoot) {
  const at = path.join(destRoot, MANIFEST_NAME);
  let text;
  try {
    text = await fsp.readFile(longPath(at), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { at, manifest: null, foreign: false };
    return { at, manifest: null, foreign: true, error: err.message };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.app === 'CleanDrive' && Array.isArray(parsed.backups)) {
      return { at, manifest: parsed, foreign: false };
    }
    return { at, manifest: null, foreign: true };
  } catch {
    return { at, manifest: null, foreign: true };
  }
}

/** A name next to `manifest.json` that is not taken. */
async function freeManifestPath(destRoot) {
  for (let n = 2; n <= MAX_SUFFIX; n++) {
    const candidate = path.join(destRoot, `manifest (${n}).json`);
    const taken = await fsp.lstat(longPath(candidate)).then(() => true, () => false);
    if (!taken) return candidate;
  }
  return null;
}

/**
 * Back up every item, then write the manifest.
 *
 * The manifest is written once, at the end, and it appends to whatever run was
 * recorded before rather than replacing it: a destination is meant to be used
 * again, and a second backup that erased the record of the first would be a
 * trap.
 *
 * It is written *before* this returns, and the caller deletes nothing until it
 * has. The ordering the roadmap asks for -- copy, hash, manifest, then bin --
 * is only true if the manifest is on the disk first.
 *
 * @returns {Promise<{saved: object[], failed: object[], bytes: number,
 *                    manifestPath: string|null, manifestError: string|null,
 *                    cancelled: boolean}>}
 */
async function backupAll(items, destRoot, ctx = {}) {
  const token = ctx.token || new CancelToken();
  const onProgress = ctx.onProgress || (() => {});
  const listStreams = ctx.listStreams || ads.list;
  const root = path.resolve(destRoot);

  const saved = [];
  const failed = [];
  let bytes = 0;
  let cancelled = false;

  const totalBytes = items.reduce((n, item) => n + (item.size || 0), 0);
  const report = throttle((currentPath) => {
    onProgress({
      phase: 'backing-up',
      done: saved.length + failed.length,
      total: items.length,
      bytes,
      totalBytes,
      currentPath,
    });
  }, 150);

  /* -- the streams, once for the batch ------------------------------------ */
  // One process for the whole list rather than one per file. `tree-copy.js`
  // measured that difference as a second against several minutes, and the
  // reason to keep them at all is B2's: losing `Zone.Identifier` quietly
  // removes the warning Windows shows before running a downloaded file.
  let streams = new Map();
  let streamsKnown = true;
  if (ctx.streams instanceof Map) {
    streams = ctx.streams;
  } else {
    const answer = await listStreams(items.map((item) => item.path));
    streams = answer.streams || new Map();
    streamsKnown = answer.ok !== false;
  }

  onProgress({ phase: 'backing-up', done: 0, total: items.length, bytes: 0, totalBytes, currentPath: null });

  for (const item of items) {
    if (token.cancelled) {
      cancelled = true;
      break;
    }
    const out = await backupOne(item, root, {
      token,
      streams,
      write: ctx.write || null,
      onBytes: (n) => {
        bytes += n;
        report(item.path);
      },
    });
    if (out.cancelled) {
      cancelled = true;
      break;
    }
    if (out.ok) {
      if (out.already) bytes += out.bytes;
      saved.push({ ...out, path: item.path });
    } else {
      failed.push({ path: item.path, error: out.error, code: out.code });
    }
    report(item.path);
  }

  /* -- the manifest, before anything is deleted --------------------------- */
  let manifestPath = null;
  let manifestError = null;
  if (saved.length > 0) {
    const existing = await readManifest(root);
    const manifest = existing.manifest || { app: 'CleanDrive', version: MANIFEST_VERSION, backups: [] };
    manifest.backups.push({
      at: new Date().toISOString(),
      session: ctx.sessionId || null,
      count: saved.length,
      bytes: saved.reduce((n, one) => n + one.bytes, 0),
      // What the copies are of, where they went, and the hash that says so.
      // Relative, so the folder can be moved or the drive can get a different
      // letter without the manifest becoming a list of wrong paths.
      files: saved.map((one) => ({
        from: plainPath(one.path),
        to: one.relative.split(path.sep).join('/'),
        bytes: one.bytes,
        sha256: one.sha256,
        mtimeMs: one.mtimeMs,
        ...(one.streams && one.streams.length ? { streams: one.streams } : {}),
        ...(one.already ? { alreadyThere: true } : {}),
      })),
    });

    manifestPath = existing.foreign ? await freeManifestPath(root) : existing.at;
    if (!manifestPath) {
      manifestError = t('backup.error.manifestName', 'No free name for the manifest');
    } else {
      try {
        await fsp.writeFile(longPath(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      } catch (err) {
        manifestError = err.message;
        manifestPath = null;
      }
    }
  }

  return { destination: root, saved, failed, bytes, manifestPath, manifestError, streamsKnown, cancelled };
}

module.exports = {
  backupAll,
  backupOne,
  relativeFor,
  volumeFolder,
  readManifest,
  MANIFEST_NAME,
  MANIFEST_VERSION,
};
