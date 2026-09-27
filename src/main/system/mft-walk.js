'use strict';

/**
 * A folder tree that has already been read, shaped like a filesystem (A2).
 *
 * `lib/scanner.js` walks a tree by asking three things of it: list a folder,
 * say what an entry is, and measure a file. Everything else it does -- the
 * tags it inherits, the folders it refuses, the installed applications it
 * steps around, the `.gitignore` files it reads -- is decided from the answers
 * and belongs to the walk, not to the filesystem.
 *
 * So this is not a second walk. It is a second **source**: the same walk, with
 * its three questions answered out of a `$MFT` read instead of out of
 * `readdir` and `lstat`. The spec asks that the fast scan pass "the same
 * filters as the ordinary scanner, so the two give the same answer", and the
 * only way to be certain of that is for there to be one implementation of the
 * filters. An earlier draft of this file reimplemented the traversal; half of
 * what the walk decides needs a folder's *listing* rather than its name, and
 * that draft was on its way to being a second set of rules that would drift.
 */

const { isLinkTag } = require('./ntfs');

/* -------------------------------------------------------------------------- */
/* the index                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Which folders and which files sit directly inside each folder.
 *
 * Files are counting-sorted into one flat `Int32Array` with a range per
 * folder, rather than an array per folder: one buffer of a million numbers
 * against half a million small arrays, each with an object header of its own.
 *
 * @param {Map<number, object>} folders  from `mft.js`
 * @param {object} files                 the columns from `mft.js`
 */
function buildIndex(folders, files) {
  const childFolders = new Map();
  for (const [number, folder] of folders) {
    const into = childFolders.get(folder.parent);
    if (into) into.push(number);
    else childFolders.set(folder.parent, [number]);
  }

  const counts = new Map();
  for (let i = 0; i < files.length; i++) {
    counts.set(files.parent[i], (counts.get(files.parent[i]) || 0) + 1);
  }
  const ranges = new Map();
  let at = 0;
  for (const [parent, count] of counts) {
    ranges.set(parent, { from: at, to: at + count });
    at += count;
  }
  const order = new Int32Array(files.length);
  const cursor = new Map();
  for (let i = 0; i < files.length; i++) {
    const parent = files.parent[i];
    const start = cursor.has(parent) ? cursor.get(parent) : ranges.get(parent).from;
    order[start] = i;
    cursor.set(parent, start + 1);
  }

  return { childFolders, ranges, order };
}

/* -------------------------------------------------------------------------- */
/* what a listing looks like                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One entry of a folder, shaped the way `readdir(…, {withFileTypes: true})`
 * shapes one.
 *
 * The rules that read a listing -- `looksLikeInstalledApp`,
 * `looksLikeProject`, `looksLikeAppData`, the `.gitignore` check -- take
 * `Dirent`s and ask them questions. Answering the same questions is what lets
 * them be reused rather than rewritten against a different shape, which is
 * where two implementations would begin to disagree.
 */
class MftEntry {
  constructor(name, directory, attributes, reparseTag, at) {
    this.name = name;
    this.directory = directory;
    this.attributes = attributes;
    this.reparseTag = reparseTag;
    // Where to find it again: a record number for a folder, a column index
    // for a file. The source reads this; the walk never looks at it.
    this.at = at;
  }

  isDirectory() {
    return this.directory && !this.isSymbolicLink();
  }

  isFile() {
    return !this.directory && !this.isSymbolicLink();
  }

  /**
   * A symbolic link or a junction -- and nothing else, however many other
   * things Windows builds out of a reparse point.
   *
   * An earlier version of this answered from the attribute bit, which says
   * only that a record *is* a reparse point. That is wrong in a way that
   * costs whole folders: OneDrive's sync root is a reparse point and so is
   * every placeholder file inside it, and a walk that called them links would
   * skip the lot. `lib/real-fs.js` has the measurement -- a scan of the home
   * folder that made this mistake came up about 15 GB short, because Windows
   * had put Documents, Pictures and the Desktop in there.
   *
   * The ordinary walk gets this right by asking `lstat` a second time and
   * letting libuv decide; libuv decides on exactly these two tags. Reading
   * the tag `$MFT` already holds is the same decision without the syscall.
   */
  isSymbolicLink() {
    return isLinkTag(this.reparseTag);
  }
}

/**
 * `fs.Stats`, as far as the scan reads one.
 *
 * `blocks` is what the scan multiplies by 512 to get what a file occupies, so
 * the allocation `$MFT` reports goes back through that same arithmetic rather
 * than around it.
 */
function statsFor(files, i) {
  const modified = files.modified[i] || 0;
  return {
    size: files.size[i],
    blocks: Math.round(files.allocated[i] / 512),
    mtimeMs: modified,
    // NTFS records an access time and Windows stops updating it by default;
    // the scan already knows that and says "modified" where it is not
    // tracked, so handing back the modified time when there is no access time
    // is the same answer the walk gets from `lstat` on the same file.
    atimeMs: files.accessed[i] || modified,
    ctimeMs: files.created[i] || modified,
    birthtimeMs: files.created[i] || modified,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
}

/* -------------------------------------------------------------------------- */
/* the source                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The three questions the walk asks, answered from memory.
 *
 * @param {object} read   what `mft.scanVolume` collected: { folders, files }
 * @param {Map<number, string>} paths  folder paths, from `resolveFolderPaths`
 */
function mftSource(read, paths) {
  const { folders, files } = read;
  const index = buildIndex(folders, files);

  // Paths back to record numbers, so the walk can keep asking by path and
  // this can keep answering by record.
  const byPath = new Map();
  for (const [number, full] of paths) {
    if (full) byPath.set(full.toLowerCase(), number);
  }

  const listFolder = (record) => {
    const entries = [];
    for (const number of index.childFolders.get(record) || []) {
      const folder = folders.get(number);
      if (folder) entries.push(new MftEntry(folder.name, true, folder.attributes || 0, folder.reparseTag || 0, number));
    }
    const range = index.ranges.get(record);
    if (range) {
      for (let k = range.from; k < range.to; k++) {
        const i = index.order[k];
        entries.push(new MftEntry(files.name[i], false, files.attributes[i], files.reparse[i], i));
      }
    }
    return entries;
  };

  return {
    /** Every entry of a folder, or a refusal shaped like `readdir`'s. */
    async list(dir) {
      const record = byPath.get(dir.replace(/\\+$/, '').toLowerCase());
      if (record === undefined) {
        throw Object.assign(new Error(`not in the table: ${dir}`), { code: 'ENOENT' });
      }
      return listFolder(record);
    },

    /** What an entry is. No syscall: `$MFT` said so. */
    async kind(entry) {
      if (entry.isSymbolicLink()) return 'link';
      return entry.directory ? 'dir' : 'file';
    },

    /**
     * A file's size and times, from the columns.
     *
     * By the entry the walk was handed, which is the only way it asks: the
     * entry carries the column it came from, so this is an array lookup.
     *
     * There is deliberately no fallback for a path without an entry. An
     * earlier version answered one from "the folder listed most recently",
     * and that was wrong in a way that would have been very hard to find:
     * the walk runs sixteen folders at once, so "most recently" is whichever
     * worker got there last, and a file would have been given another file's
     * size. A refusal is the safe answer, and nothing asks.
     */
    async stat(full, entry) {
      if (entry && typeof entry.at === 'number' && !entry.directory) return statsFor(files, entry.at);
      throw Object.assign(new Error(`not in the table: ${full}`), { code: 'ENOENT' });
    },

    /** How many folders the table holds, for a progress report. */
    get folderCount() {
      return byPath.size;
    },
  };
}

module.exports = { buildIndex, mftSource, MftEntry, statsFor };
