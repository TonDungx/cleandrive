'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { pathKey } = require('./util');

/**
 * Volume-level free space.
 *
 * Every scan this app has ever done answers "how big is this folder". That is
 * not the same question as "how full is the disk", and the second one is the
 * one an automatic cleanup has to answer before it decides to run: cleaning a
 * 200 MB Downloads folder on a drive with 300 GB free is work nobody asked for.
 *
 * `fs.statfs` is used rather than a native module or a PowerShell call. It has
 * been in Node since 18.15 and Electron 33 ships Node 20, so it is available;
 * the capability check below exists for the case where this file is required
 * by an older runtime, in which case callers get `{ ok: false }` and degrade
 * instead of crashing a scheduled run.
 */

const HAS_STATFS = typeof fsp.statfs === 'function';

/** The volume a path lives on -- `C:\` on Windows, `/` on POSIX. */
function volumeRoot(target) {
  return path.parse(path.resolve(target)).root;
}

/**
 * Free and total bytes for the volume containing `target`.
 *
 * Two different notions of "free" come back from the OS and they are not
 * interchangeable:
 *
 *   - `freeBytes` is what this user may actually write (quotas applied). It is
 *     the honest number to show someone.
 *   - `usedPercent` is computed from the volume's own free count, because a
 *     "disk is 90% full" threshold is a property of the volume, not of the
 *     account looking at it.
 *
 * Never throws. An unreadable or non-existent volume comes back `ok: false`.
 *
 * @returns {Promise<{ok: boolean, path: string, root: string, totalBytes: number,
 *   freeBytes: number, usedBytes: number, usedPercent: number, error?: string}>}
 */
async function diskUsage(target) {
  const resolved = path.resolve(target);
  const root = volumeRoot(resolved);
  const empty = {
    ok: false,
    path: resolved,
    root,
    totalBytes: 0,
    freeBytes: 0,
    usedBytes: 0,
    usedPercent: 0,
  };

  if (!HAS_STATFS) {
    return { ...empty, error: 'fs.statfs is not available in this runtime' };
  }

  // Ask about the path itself first: on POSIX a subdirectory can be a separate
  // mount, and the volume root would then answer about the wrong filesystem.
  // Windows has no such case, but the fallback covers a path that has since
  // been deleted.
  let stats;
  try {
    stats = await fsp.statfs(resolved);
  } catch {
    try {
      stats = await fsp.statfs(root);
    } catch (err) {
      return { ...empty, error: err.message || 'Could not read volume information' };
    }
  }

  const blockSize = Number(stats.bsize);
  const total = Number(stats.blocks) * blockSize;
  const volumeFree = Number(stats.bfree) * blockSize;
  const userFree = Number(stats.bavail) * blockSize;

  if (!Number.isFinite(total) || total <= 0) {
    return { ...empty, error: 'Volume reported a size of zero' };
  }

  const used = total - volumeFree;

  return {
    ok: true,
    path: resolved,
    root,
    totalBytes: total,
    freeBytes: Number.isFinite(userFree) && userFree >= 0 ? userFree : volumeFree,
    usedBytes: used,
    usedPercent: Math.max(0, Math.min(100, (used / total) * 100)),
  };
}

/**
 * Usage for every distinct volume the given paths sit on, keyed by volume root.
 * Several cleanup roots usually share one drive; this reports it once.
 *
 * @param {string[]} targets
 * @returns {Promise<Map<string, object>>}
 */
async function usageByVolume(targets) {
  const byRoot = new Map();
  for (const target of Array.isArray(targets) ? targets : [targets]) {
    if (typeof target !== 'string' || target.trim() === '') continue;
    const key = pathKey(volumeRoot(target));
    if (!byRoot.has(key)) byRoot.set(key, target);
  }

  const out = new Map();
  for (const [key, sample] of byRoot) {
    out.set(key, await diskUsage(sample));
  }
  return out;
}

/**
 * The fullest volume among `targets`, or null if none could be read. This is
 * what a "only clean when the disk is above N%" gate compares against: if any
 * one of the configured drives is under pressure, the run is worth doing.
 */
async function fullestVolume(targets) {
  const usages = [...(await usageByVolume(targets)).values()].filter((u) => u.ok);
  if (usages.length === 0) return null;
  return usages.reduce((worst, u) => (u.usedPercent > worst.usedPercent ? u : worst));
}

module.exports = { diskUsage, usageByVolume, fullestVolume, volumeRoot, HAS_STATFS };
