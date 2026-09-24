'use strict';

/**
 * A size-only walk: how much of the disk a tree actually occupies.
 *
 * Not the scanner in `lib/scanner.js`, on purpose. That one answers "what is
 * in this folder and what should go", so it skips what nobody can act on --
 * hidden folders, `node_modules`, protected locations -- and it adds up file
 * sizes. This one answers "where did the space go", which is a different
 * sum:
 *
 *   - Nothing is skipped for being uninteresting. A home folder's `.ollama`
 *     was 15 GB on the machine this was written on, and the scanner never
 *     looks at it.
 *   - It adds up *allocated* bytes (`blocks * 512`), which is what the volume's
 *     free-space figure is made of: a OneDrive file that is only in the cloud
 *     has a size and no allocation, and a small file stored inside its MFT
 *     record has neither.
 *   - A file with several hard links is counted once. Windows keeps most of
 *     `System32` as hard links into `WinSxS`; counting each name would count
 *     the same bytes two or three times (measured: 57,969 extra names on a
 *     1.1-million-file system drive).
 *   - Links and junctions are never followed, so nothing is visited twice.
 *   - A folder that cannot be read is recorded by path, so a second pass with
 *     administrator rights can measure exactly those and nothing else.
 *
 * Measured on a 510 GB system drive, not elevated, plain Node with its default
 * four I/O threads: 1,106,588 files in 525,475 folders in 133.8 s, 8,269 files
 * a second at 32-way concurrency; 152 folders refused.
 *
 * Only reads. The elevated helper runs this same file, and
 * `scripts/test-helper.js` reads it to check nothing in it writes.
 *
 * Deliberately free of Electron.
 */

const path = require('node:path');

// Not `node:fs`: inside Electron that one calls an `.asar` archive a folder,
// and a directory entry calls OneDrive's folder a link (see real-fs.js).
const { fsp, entryKind } = require('../lib/real-fs');

/** Denied folders beyond this are counted but not listed. */
const DENIED_LIMIT = 5000;

/**
 * @param {string} root
 * @param {object} [options]
 * @param {(parts: string[]) => string} [options.bucketOf]
 *   Which total a file belongs to, from its folder's path below `root` as
 *   segments. Everything goes in one bucket when absent.
 * @param {{cancelled: boolean}} [options.token]
 * @param {(p: object) => void} [options.onProgress]
 * @param {number} [options.concurrency]
 * @param {boolean} [options.countFolders]  add each folder's own allocation (default on)
 * @returns {Promise<{buckets: Object<string, {allocated: number, logical: number, files: number}>,
 *   denied: string[], deniedCount: number, deniedBuckets: Object<string, number>, files: number, dirs: number,
 *   links: number, hardlinkRepeats: number, unreadableFiles: string[], cancelled: boolean, durationMs: number}>}
 */
function measureTree(
  root,
  { bucketOf = () => 'all', token = { cancelled: false }, onProgress = null, concurrency = 32, countFolders = true } = {}
) {
  const started = Date.now();
  const buckets = Object.create(null);
  const deniedBuckets = Object.create(null);
  const denied = [];
  const unreadableFiles = [];
  const seen = new Set();
  let deniedCount = 0;
  let files = 0;
  let dirs = 0;
  let links = 0;
  let hardlinkRepeats = 0;
  let lastReport = 0;

  const add = (key, allocated, logical) => {
    const b = buckets[key] || (buckets[key] = { allocated: 0, logical: 0, files: 0 });
    b.allocated += allocated;
    b.logical += logical;
    b.files += 1;
  };

  const report = (force) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastReport < 150) return;
    lastReport = now;
    onProgress({ phase: 'walking', files, dirs, elapsedMs: now - started, denied: deniedCount });
  };

  async function visit(dir, parts) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      deniedCount += 1;
      const key = bucketOf(parts);
      deniedBuckets[key] = (deniedBuckets[key] || 0) + 1;
      if (denied.length < DENIED_LIMIT) denied.push(dir);
      return [];
    }
    dirs += 1;
    const key = bucketOf(parts);
    // A folder occupies space of its own: its index of names. Measured over a
    // whole system drive that was 0.88 GB across 525,670 folders -- WinSxS's
    // Manifests folder alone is 29 MB -- and leaving it out leaves it in
    // "not explained".
    if (countFolders) {
      try {
        const own = await fsp.lstat(dir, { bigint: true });
        const b = buckets[key] || (buckets[key] = { allocated: 0, logical: 0, files: 0 });
        b.allocated += Number(own.blocks) * 512;
      } catch {
        // The listing worked and the folder's own size did not; it is small.
      }
    }
    const next = [];
    for (const entry of entries) {
      if (token.cancelled) break;
      const full = path.join(dir, entry.name);
      const kind = await entryKind(entry, full);
      if (kind === 'link') {
        links += 1;
        continue;
      }
      if (kind === 'dir') {
        next.push({ dir: full, parts: [...parts, entry.name] });
        continue;
      }
      if (kind !== 'file') continue;
      let st;
      try {
        st = await fsp.lstat(full, { bigint: true });
      } catch {
        // A file the system holds open exclusively -- `hiberfil.sys` is one.
        // Its size has to come from elsewhere; say which one it was.
        if (unreadableFiles.length < 200) unreadableFiles.push(full);
        continue;
      }
      if (st.isSymbolicLink()) {
        links += 1;
        continue;
      }
      if (st.nlink > 1n) {
        const id = `${st.dev}:${st.ino}`;
        if (seen.has(id)) {
          hardlinkRepeats += 1;
          continue;
        }
        seen.add(id);
      }
      files += 1;
      add(key, Number(st.blocks) * 512, Number(st.size));
    }
    report(false);
    return next;
  }

  return new Promise((resolve) => {
    const queue = [{ dir: path.resolve(root), parts: [] }];
    let active = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      report(true);
      resolve({
        buckets,
        denied,
        deniedCount,
        deniedBuckets,
        files,
        dirs,
        links,
        hardlinkRepeats,
        unreadableFiles,
        cancelled: Boolean(token.cancelled),
        durationMs: Date.now() - started,
      });
    };
    const pump = () => {
      while (!token.cancelled && active < concurrency && queue.length > 0) {
        // Depth first from the end of the queue keeps the queue short.
        const task = queue.pop();
        active += 1;
        visit(task.dir, task.parts)
          .then((children) => {
            for (const child of children) queue.push(child);
          })
          .catch(() => {})
          .finally(() => {
            active -= 1;
            if ((queue.length === 0 || token.cancelled) && active === 0) finish();
            else pump();
          });
      }
      if (active === 0 && (queue.length === 0 || token.cancelled)) finish();
    };
    pump();
  });
}

module.exports = { measureTree, DENIED_LIMIT };
