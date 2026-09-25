'use strict';

/**
 * Moving a file to another drive, as an action (B1).
 *
 * The Recycle Bin frees nothing: it is on the same drive. Deleting for good
 * frees everything and keeps nothing. This is the third choice -- the file
 * leaves the full drive and stays on the computer, and can be put back.
 *
 * For each file, in this order, and nothing is done to the original until the
 * copy has been proved:
 *
 *   1. copy it into the zone on the other drive, hashing as it goes, under a
 *      `.partial` name
 *   2. check the original did not change while it was being copied
 *   3. read the copy back and check it has the same SHA-256 -- and only then
 *      give it its name, so a copy cut off by a drive pulled out never looks
 *      like one (measured: the half-written file is still there when the
 *      drive comes back; the next batch takes it out)
 *   4. write which original it is into the session's manifest, on that drive
 *   5. check once more that the path is still the file that was copied --
 *      a folder on the way there can have been swapped for a junction
 *   6. the original to the Recycle Bin -- or, if the person switched it on in
 *      Settings, deleted for good, which is the only way this frees the space
 *   7. the journal line, before the window hears of it
 *
 * Any step that fails leaves the original exactly as it was and takes the
 * copy back out. The journal line comes after the original moved, not before
 * as the roadmap first had it, because a line is only ever written for what
 * happened: a crash between 6 and 7 leaves an original in the bin and a copy
 * the manifest still names, and a crash anywhere before 6 leaves the original
 * where it was.
 *
 * What a batch frees is counted per item, from what actually happened to each
 * original: nothing for the ones in the bin, their size for the ones deleted.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const i18n = require('../../i18n');
const { planTrash, executeTrash } = require('../lib/trash');
const zones = require('../lib/quarantine-zone');
const cloud = require('../lib/media/cloud');
const cloudState = require('../lib/cloud-state');
const { leaveOpenApps } = require('./recycle');
const { CancelToken, throttle } = require('../lib/util');

const exists = (p) => fsp.lstat(p).then(() => true, () => false);

/** Why a file was not moved, in the language the window is in. */
const say = {
  zone: (reason) => {
    switch (reason) {
      case 'none': return i18n.t('quarantine.why.none', 'No quarantine folder is set up — choose one in Settings');
      case 'unavailable': return i18n.t('quarantine.why.unavailable', 'The quarantine drive is not connected');
      case 'missing': return i18n.t('quarantine.why.missing', 'The quarantine folder is no longer there');
      case 'moved': return i18n.t('quarantine.why.moved', 'The quarantine folder has become a link to somewhere else, so it was not used');
      case 'notAZone': return i18n.t('quarantine.why.notAZone', 'That folder is not a CleanDrive quarantine folder');
      case 'network': return i18n.t('quarantine.why.network', 'A network drive cannot hold the quarantine folder');
      case 'synced': return i18n.t('quarantine.why.synced', 'The quarantine folder may not be inside a folder a cloud service syncs');
      default: return i18n.t('quarantine.why.place', 'The quarantine folder is in a place the app does not write to');
    }
  },
  sameVolume: () => i18n.t('quarantine.why.sameVolume', 'Already on the drive the quarantine folder is on — moving it there would free nothing'),
  inZone: () => i18n.t('quarantine.why.inZone', 'Already in the quarantine folder'),
  link: () => i18n.t('quarantine.why.link', 'A link, not a file'),
  onlineOnly: () => i18n.t('quarantine.why.onlineOnly', 'Only in the cloud — there is nothing on this drive to free'),
  full: (drive) => i18n.t('quarantine.why.full', 'Not enough room on {drive} for all of it, with a gigabyte to spare', { drive }),
  overLimit: () => i18n.t('quarantine.why.overLimit', 'It would take the quarantine folder past the size set for it in Settings'),
  changed: () => i18n.t('quarantine.why.changed', 'It changed while it was being copied, or since it was chosen, so it was left alone'),
  hash: () => i18n.t('quarantine.why.hash', 'The copy did not match the original, so the original was left alone'),
  lost: () => i18n.t('quarantine.why.lost', 'The quarantine drive stopped answering, so the rest was left alone'),
  fullNow: () => i18n.t('quarantine.why.fullNow', 'The quarantine drive filled up, so the rest was left alone'),
  stuck: () => i18n.t('quarantine.why.stuck', 'Copied, but the original could not be moved to the Recycle Bin, so the copy was taken back out'),
  copyFailed: () => i18n.t('quarantine.why.copyFailed', 'It could not be copied'),
};

/* -------------------------------------------------------------------------- */
/* the file                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What makes this path this file: its identity on the disk, its size and
 * modification time, and where its folder really is. Compared, never trusted.
 */
async function identity(p) {
  try {
    const st = await fsp.lstat(p, { bigint: true });
    return {
      file: st.isFile() && !st.isSymbolicLink(),
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

/** SHA-256 of a file, read through. */
async function hashFile(p) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(p, { highWaterMark: 1 << 20 })) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Copy `from` to `to`, which must not exist yet, hashing what was read.
 *
 * `deps.write` stands in for the write, so the harness can fail it part way
 * through -- a full disk, a drive pulled out -- without a real one.
 */
async function copyHashed(from, to, { token = null, onBytes = () => {}, write = null } = {}) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const handle = await fsp.open(to, 'wx');
  try {
    for await (const chunk of fs.createReadStream(from, { highWaterMark: 1 << 20 })) {
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

const removeQuietly = (p) => fsp.rm(p, { force: true }).catch(() => {});

/* -------------------------------------------------------------------------- */
/* the way back                                                                */
/* -------------------------------------------------------------------------- */

/**
 * For the Restore Center: where each copy is now, asked of the disk.
 *
 * `unavailable` when the drive the zone is on is not connected -- the record
 * is kept, and nothing is said about the file that cannot be checked.
 */
const undo = {
  async locate(records, deps = {}) {
    const out = new Map();
    const reachable = new Map();
    const retentionMs = Number.isFinite(deps.retentionDays) ? deps.retentionDays * 86400000 : null;
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
      const st = await fsp.lstat(record.stored).catch(() => null);
      const existsAtOrigin = await exists(record.path);
      if (st && st.isFile() && st.size === record.size) {
        out.set(record, {
          state: 'inQuarantine',
          stored: record.stored,
          sha256: record.sha256 || null,
          mtimeMs: record.mtimeMs,
          existsAtOrigin,
          expired: retentionMs !== null && Number.isFinite(record.trashedAt) && Date.now() - record.trashedAt > retentionMs,
        });
      } else {
        out.set(record, { state: 'gone', existsAtOrigin });
      }
    }
    return out;
  },

  ready(located) {
    return located && located.stored ? exists(located.stored) : Promise.resolve(false);
  },

  /**
   * Copy it back, check it against the hash the quarantine recorded, and only
   * then take the copy out of the zone. Never over something already there.
   */
  async putBack(located, target) {
    if (!located || !located.stored) return { ok: false, code: 'ENOENT' };
    await fsp.mkdir(path.dirname(target), { recursive: true });
    let copied;
    try {
      copied = await copyHashed(located.stored, target);
    } catch (err) {
      if (err.code !== 'EEXIST') await removeQuietly(target);
      return { ok: false, code: err.code || 'ECOPY' };
    }
    const back = await hashFile(target).catch(() => null);
    if ((located.sha256 && copied.sha256 !== located.sha256) || back !== copied.sha256) {
      await removeQuietly(target);
      return { ok: false, code: 'EHASH' };
    }
    if (Number.isFinite(located.mtimeMs)) {
      await fsp.utimes(target, new Date(), new Date(located.mtimeMs)).catch(() => {});
    }
    // In one place again: where it came from.
    await fsp.rm(located.stored, { force: true }).catch(() => {});
    return { ok: true, target, via: 'copy' };
  },
};

/* -------------------------------------------------------------------------- */
/* the handler                                                                 */
/* -------------------------------------------------------------------------- */

function refuseAll(items, error, extra = {}) {
  return {
    plan: [],
    failed: items.map((p) => ({ path: p, error, code: 'EZONE' })),
    needsAdmin: [],
    inUse: [],
    totalBytes: 0,
    estimatedMs: 0,
    cancelled: false,
    ...extra,
  };
}

module.exports = {
  kind: 'quarantine',
  feature: 'pro.quarantine',
  allowsFolders: false,
  reversible: 'journal',

  /** Only when the original is deleted: in the bin, it is still on the drive. */
  freesOnVolume(item, options) {
    return Boolean(options && options.deleteOriginal);
  },

  /**
   * Vet every file and the zone, touching nothing.
   *
   * `ctx.deps` is where the main process puts what the settings say -- the
   * zone, whether to delete originals, the size limit -- because none of it is
   * the window's to send.
   */
  async plan(items, options, ctx) {
    const deps = (ctx && ctx.deps) || {};
    const token = (ctx && ctx.token) || new CancelToken();
    const zone = await zones.check(deps.zone, deps);
    if (!zone.ok) return refuseAll(items, say.zone(zone.reason), { zoneRefusal: zone.reason });

    const vet = deps.planTrash || planTrash;
    let planned = await vet(items, { allowDirectories: false }, { token, onProgress: ctx && ctx.onProgress });
    planned = await leaveOpenApps(planned, deps);

    const plan = [];
    const failed = [...planned.failed];
    const onedrive = [];
    for (const item of planned.plan) {
      if (zones.inside(zone.zone, item.path)) {
        failed.push({ path: item.path, error: say.inZone(), code: 'EINZONE' });
        continue;
      }
      const id = await identity(item.path);
      if (!id || !id.file) {
        failed.push({ path: item.path, error: say.link(), code: 'ELINK' });
        continue;
      }
      if (id.dev === zone.dev) {
        failed.push({ path: item.path, error: say.sameVolume(), code: 'ESAMEVOLUME' });
        continue;
      }
      const service = cloud.serviceForPath(item.path);
      const entry = { ...item, identity: id, cloud: service ? (service === 'OneDrive' ? 'unknown' : 'other') : null };
      if (service === 'OneDrive') onedrive.push(entry);
      plan.push(entry);
    }

    // OneDrive, by what Windows says about each file (decided 2026-09-25).
    // Online-only: nothing here to free, and reading it would download it.
    // Not in sync: the copy on the other drive is the only complete one.
    // In sync: removing it here removes it from OneDrive everywhere.
    if (onedrive.length > 0) {
      const query = (deps.cloud && deps.cloud.query) || cloudState.query;
      const answer = await query(onedrive.map((e) => e.path)).catch(() => ({ ok: false }));
      if (answer && answer.ok) {
        for (const entry of onedrive) {
          const st = answer.states.get(entry.path);
          if (!st || st.missing) continue;
          if (!st.onDisk) entry.cloud = 'onlineOnly';
          else entry.cloud = st.inSync ? 'synced' : 'unsynced';
        }
      }
    }
    const kept = [];
    for (const entry of plan) {
      if (entry.cloud === 'onlineOnly') failed.push({ path: entry.path, error: say.onlineOnly(), code: 'EONLINEONLY' });
      else kept.push(entry);
    }

    const totalBytes = kept.reduce((n, e) => n + e.size, 0);
    const drive = zone.root.replace(/\\$/, '');
    if (kept.length > 0 && totalBytes + zones.MARGIN_BYTES > zone.freeBytes) {
      return { ...refuseAll(items, say.full(drive), { zoneRefusal: 'full' }), zone };
    }
    const maxBytes = Number(deps.maxBytes) || 0;
    if (kept.length > 0 && maxBytes > 0) {
      const used = await zones.usage(zone.zone);
      if (used.bytes + totalBytes > maxBytes) return { ...refuseAll(items, say.overLimit(), { zoneRefusal: 'overLimit' }), zone };
    }

    const needsAdmin = failed.filter((f) => f.code === 'EPERM_ADMIN');
    const inUse = failed.filter((f) => f.code === 'EBUSY');
    return {
      plan: kept,
      failed,
      needsAdmin,
      inUse,
      totalBytes,
      estimatedMs: 0,
      cancelled: token.cancelled,
      zone,
      deleteOriginal: deps.deleteOriginal === true,
      retentionDays: Number.isFinite(deps.retentionDays) ? deps.retentionDays : null,
    };
  },

  /** What the confirmation says, before anything has been copied. */
  describe(planned) {
    const needsAdmin = planned.needsAdmin ? planned.needsAdmin.length : 0;
    const inUse = planned.inUse ? planned.inUse.length : 0;
    const count = (what) => planned.plan.filter((e) => e.cloud === what).length;
    const zone = planned.zone || null;
    return {
      kind: 'quarantine',
      count: planned.plan.length,
      bytes: planned.totalBytes,
      freesOnVolume: planned.deleteOriginal === true,
      deleteOriginal: planned.deleteOriginal === true,
      reversible: 'journal',
      etaMs: 0,
      needsAdmin,
      inUse,
      refused: planned.failed.length - needsAdmin - inUse,
      zone: zone ? { path: zone.zone, drive: zone.root.replace(/\\$/, ''), type: zone.type, freeBytes: zone.freeBytes } : null,
      zoneRefusal: planned.zoneRefusal || null,
      retentionDays: planned.retentionDays || null,
      cloud: { synced: count('synced'), unsynced: count('unsynced'), unknown: count('unknown'), other: count('other') },
      onlineOnly: planned.failed.filter((f) => f.code === 'EONLINEONLY').length,
      sameVolume: planned.failed.filter((f) => f.code === 'ESAMEVOLUME').length,
    };
  },

  /**
   * Each file in turn, as the header describes. The batch stops if the zone's
   * drive stops answering or fills up: whatever is left stays where it is.
   */
  async apply(planned, options, ctx) {
    const deps = (ctx && ctx.deps) || {};
    const token = (ctx && ctx.token) || new CancelToken();
    const started = Date.now();
    const moved = [];
    const failed = [];
    let movedBytes = 0;
    let freed = 0;
    let copiedSoFar = 0;
    let recordError = null;
    let stopped = null;
    const totalBytes = planned.plan.reduce((n, item) => n + item.size, 0);
    const deleteOriginal = planned.deleteOriginal === true;

    const report = (currentPath) => {
      if (!ctx || !ctx.onProgress) return;
      const elapsedMs = Date.now() - started;
      const bytesPerSec = elapsedMs > 0 ? (copiedSoFar / elapsedMs) * 1000 : 0;
      ctx.onProgress({
        phase: 'copying',
        done: moved.length + failed.length,
        total: planned.plan.length,
        freedBytes: copiedSoFar,
        totalBytes,
        currentPath,
        bytesPerSec,
        elapsedMs,
        etaMs: bytesPerSec > 0 ? Math.round(((totalBytes - copiedSoFar) / bytesPerSec) * 1000) : null,
      });
    };
    const reportThrottled = throttle(report, 150);
    report(null);

    // Asked again: the dialog may have sat open while the drive was pulled out.
    const zone = await zones.check(planned.zone && planned.zone.zone, deps);
    if (!zone.ok) {
      for (const item of planned.plan) failed.push({ path: item.path, error: say.zone(zone.reason), code: 'EZONE' });
      report(null);
      return { moved, failed, freedBytes: 0, measuredFreedBytes: 0, cancelled: false, remaining: 0, durationMs: Date.now() - started, stopped: 'zone' };
    }

    // What an earlier batch never finished -- its drive pulled out, say -- is
    // taken out first. Only the app's own unfinished copies; see PARTIAL.
    await zones.sweepPartials(zone.zone);

    const sessionId = ctx && ctx.sessionId && zones.SESSION_ID.test(ctx.sessionId) ? ctx.sessionId : `h_${crypto.randomBytes(4).toString('hex')}`;
    const dir = zones.sessionDir(zone.zone, sessionId);
    try {
      await fsp.mkdir(dir);
      // A junction planted in the zone would send the copies somewhere else.
      if ((await fsp.realpath(dir)).toLowerCase() !== path.join(zone.zone, sessionId).toLowerCase()) {
        throw Object.assign(new Error('moved'), { code: 'EMOVED' });
      }
    } catch (err) {
      const reason = err.code === 'EMOVED' ? 'moved' : (await exists(zone.zone)) ? 'place' : 'unavailable';
      for (const item of planned.plan) failed.push({ path: item.path, error: say.zone(reason), code: 'EZONE' });
      report(null);
      return { moved, failed, freedBytes: 0, measuredFreedBytes: 0, cancelled: false, remaining: 0, durationMs: Date.now() - started, stopped: 'zone' };
    }

    const zoneAnswers = async () => (await exists(zone.zone)) && (await exists(dir));
    let n = 0;

    for (const item of planned.plan) {
      if (token.cancelled) break;
      n += 1;
      const dest = path.join(dir, zones.storedName(n, item.path));
      // Written under this name, and given `dest` only once it has been proved.
      const partial = `${dest}${zones.PARTIAL}`;
      const skip = (error, code) => {
        failed.push({ path: item.path, error, code });
        reportThrottled(item.path);
      };

      if (!sameFile(await identity(item.path), item.identity)) {
        skip(say.changed(), 'ECHANGED');
        continue;
      }

      // 1. The copy.
      let copied;
      const before = copiedSoFar;
      try {
        copied = await copyHashed(item.path, partial, {
          token,
          write: deps.write || null,
          onBytes: (b) => {
            copiedSoFar += b;
            reportThrottled(item.path);
          },
        });
      } catch (err) {
        copiedSoFar = before;
        await removeQuietly(partial);
        if (err.code === 'ECANCELLED') break;
        if (err.code === 'ENOSPC') {
          stopped = 'full';
          skip(say.fullNow(), 'ENOSPC');
          break;
        }
        if (!(await zoneAnswers())) {
          stopped = 'lost';
          skip(say.lost(), 'EZONELOST');
          break;
        }
        skip(say.copyFailed(), err.code || 'ECOPY');
        continue;
      }
      if (deps.afterCopy) await deps.afterCopy({ from: item.path, to: partial });

      // 2. The original did not change under the copy. 3. The copy reads back the same.
      const after = await identity(item.path);
      if (!sameFile(after, item.identity)) {
        copiedSoFar = before;
        await removeQuietly(partial);
        skip(say.changed(), 'ECHANGED');
        continue;
      }
      const readBack = await hashFile(partial).catch(() => null);
      if (readBack !== copied.sha256) {
        copiedSoFar = before;
        await removeQuietly(partial);
        if (readBack === null && !(await zoneAnswers())) {
          stopped = 'lost';
          skip(say.lost(), 'EZONELOST');
          break;
        }
        skip(say.hash(), 'EHASH');
        continue;
      }
      await fsp.utimes(partial, new Date(), new Date(item.mtimeMs)).catch(() => {});
      try {
        await fsp.rename(partial, dest);
      } catch {
        copiedSoFar = before;
        await removeQuietly(partial);
        if (!(await zoneAnswers())) {
          stopped = 'lost';
          skip(say.lost(), 'EZONELOST');
          break;
        }
        skip(say.copyFailed(), 'ERENAME');
        continue;
      }

      // 4. The drive says which original this is.
      try {
        await zones.appendManifest(dir, {
          file: path.basename(dest),
          from: item.path,
          bytes: item.size,
          sha256: copied.sha256,
          mtime: new Date(item.mtimeMs).toISOString(),
          at: new Date().toISOString(),
        });
      } catch {
        copiedSoFar = before;
        await removeQuietly(dest);
        if (!(await zoneAnswers())) {
          stopped = 'lost';
          skip(say.lost(), 'EZONELOST');
          break;
        }
        skip(say.copyFailed(), 'EMANIFEST');
        continue;
      }

      // 5. Still the file that was copied, at the path about to be acted on.
      if (deps.beforeOriginal) await deps.beforeOriginal({ from: item.path, to: dest });
      if (!sameFile(await identity(item.path), item.identity)) {
        copiedSoFar = before;
        await removeQuietly(dest);
        skip(say.changed(), 'ECHANGED');
        continue;
      }

      // 6. The original.
      let original = null;
      if (deleteOriginal) {
        try {
          await fsp.unlink(item.path);
          original = 'deleted';
        } catch {
          original = null; // a read-only file, say: the bin, rather than forcing it
        }
      }
      if (!original) {
        const out = await executeTrash([item], deps.shell ? { shell: deps.shell } : {}, { token: new CancelToken() });
        if (out.moved.length === 1) original = 'bin';
      }
      if (!original) {
        copiedSoFar = before;
        await removeQuietly(dest);
        skip(say.stuck(), 'ESTUCK');
        continue;
      }

      // 7. The record.
      const record = {
        path: item.path,
        to: dest,
        size: item.size,
        mtimeMs: item.mtimeMs,
        sha256: copied.sha256,
        original,
        trashedAt: Date.now(),
      };
      moved.push(record);
      movedBytes += item.size;
      if (original === 'deleted') freed += item.size;
      if (ctx && ctx.onItem) {
        try {
          await ctx.onItem(record);
        } catch (err) {
          recordError = err.message || String(err);
          break;
        }
      }
      reportThrottled(item.path);
    }

    // A session that copied nothing leaves no empty folder behind.
    if (moved.length === 0) {
      await fsp.rm(path.join(dir, zones.MANIFEST), { force: true }).catch(() => {});
      await fsp.rmdir(dir).catch(() => {});
    }

    report(null);
    return {
      moved,
      failed,
      // What left the drive it was on: in the bin or gone.
      freedBytes: movedBytes,
      // What came back to that drive: only the originals deleted outright.
      measuredFreedBytes: freed,
      cancelled: token.cancelled,
      remaining: planned.plan.length - (moved.length + failed.length),
      durationMs: Date.now() - started,
      stopped,
      ...(recordError ? { recordError } : {}),
    };
  },

  undo,

  /** Why a zone cannot take files, as a sentence -- for the Settings card too. */
  zoneReason: say.zone,

  // For the harnesses.
  copyHashed,
  hashFile,
  identity,
};
