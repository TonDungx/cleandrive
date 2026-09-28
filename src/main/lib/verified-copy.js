'use strict';

/**
 * Copying a file and being able to prove it arrived.
 *
 * This was written inside the quarantine action (B1) and lived there alone
 * until B2 needed the same thing for a whole folder. It is here, rather than
 * copied, for the reason `actions/execute.js` gives about actions in general:
 * the danger is not that any one of them is hard, it is that each grows its
 * own slightly different version. There is exactly one hashed copy in this
 * app, and three features use it -- move to another drive (B1), relocate a
 * folder (B2), and back up before deleting (E2).
 *
 * Nothing here decides anything. It copies, it hashes, it reports; what to do
 * about a mismatch belongs to the action.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

/**
 * A path Windows will accept however long it is.
 *
 * `MAX_PATH` is 260 characters and the APIs behind Node still enforce it
 * unless the path is prefixed with `\\?\`, which turns off parsing -- so the
 * prefixed form must already be absolute and fully resolved, with no `.` or
 * `..` left in it, and forward slashes are not accepted.
 *
 * Applied only when it is needed. `\\?\` paths leak into error messages and
 * into anything built from them, and a user reading "could not copy
 * \\?\D:\photos\x.jpg" is being shown an implementation detail.
 */
function longPath(target) {
  const value = String(target || '');
  if (process.platform !== 'win32') return value;
  if (value.length < 250 || value.startsWith('\\\\?\\')) return value;
  if (value.startsWith('\\\\')) return `\\\\?\\UNC\\${value.slice(2)}`;
  return path.isAbsolute(value) ? `\\\\?\\${path.resolve(value)}` : value;
}

/** A `\\?\C:\x` path as `C:\x`, for anything a person will read. */
const plainPath = (target) =>
  String(target || '').replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '');

/**
 * What makes this path this file: its identity on the disk, its size and
 * modification time, and where its folder really is. Compared, never trusted.
 */
async function identity(p) {
  try {
    const st = await fsp.lstat(longPath(p), { bigint: true });
    return {
      file: st.isFile() && !st.isSymbolicLink(),
      dir: st.isDirectory() && !st.isSymbolicLink(),
      dev: String(st.dev),
      ino: String(st.ino),
      size: Number(st.size),
      mtime: String(st.mtimeNs),
      parent: await fsp.realpath(path.dirname(p)),
    };
  } catch {
    return null;
  }
}

const sameFile = (a, b) =>
  Boolean(a && b) && a.file && b.file && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtime === b.mtime &&
  a.parent.toLowerCase() === b.parent.toLowerCase();

/** The same question for a folder, which has no size worth comparing. */
const sameFolder = (a, b) =>
  Boolean(a && b) && a.dir && b.dir && a.dev === b.dev && a.ino === b.ino &&
  a.parent.toLowerCase() === b.parent.toLowerCase();

/** SHA-256 of a file, read through. */
async function hashFile(p) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(longPath(p), { highWaterMark: 1 << 20 })) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Copy `from` to `to`, which must not exist yet, hashing what was read.
 *
 * `write` stands in for the write, so a harness can fail it part way through
 * -- a full disk, a drive pulled out -- without a real one.
 */
async function copyHashed(from, to, { token = null, onBytes = () => {}, write = null } = {}) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const handle = await fsp.open(longPath(to), 'wx');
  try {
    for await (const chunk of fs.createReadStream(longPath(from), { highWaterMark: 1 << 20 })) {
      if (token && token.cancelled) throw Object.assign(new Error('cancelled'), { code: 'ECANCELLED' });
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const part = chunk.subarray(offset);
        const { bytesWritten } = write ? await write(handle, part, bytes + offset) : await handle.write(part);
        if (!bytesWritten) throw Object.assign(new Error('nothing written'), { code: 'EIO' });
        offset += bytesWritten;
      }
      bytes += chunk.length;
      onBytes(chunk.length);
    }
    // Before the copy is read back and before the original is touched: a copy
    // still in a cache is not a copy that survives a power cut.
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest('hex'), bytes };
}

const removeQuietly = (p) => fsp.rm(longPath(p), { force: true }).catch(() => {});

/**
 * Give the copy the original's timestamps and read-only bit.
 *
 * Times are set last by every caller, because writing to a file is what moves
 * its modification time in the first place -- set them before the streams are
 * copied and the stream write undoes it.
 *
 * The creation time is deliberately not touched. Node cannot set it, and
 * reaching for another PowerShell process per file to do so would cost more
 * than the fact is worth: what "moved this folder in March" means for a photo
 * is the date it was taken, which lives in the file, and the modification
 * time, which is kept.
 */
async function copyMetadata(from, to, stats = null) {
  const st = stats || (await fsp.stat(longPath(from)));
  const problems = [];

  try {
    await fsp.chmod(longPath(to), st.mode);
  } catch (err) {
    problems.push({ what: 'attributes', error: err.message });
  }
  try {
    await fsp.utimes(longPath(to), st.atime, st.mtime);
  } catch (err) {
    problems.push({ what: 'times', error: err.message });
  }

  return problems;
}

module.exports = {
  longPath,
  plainPath,
  identity,
  sameFile,
  sameFolder,
  hashFile,
  copyHashed,
  copyMetadata,
  removeQuietly,
};
