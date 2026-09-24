'use strict';

/**
 * Putting back what the app did: the engine behind the Restore Center.
 *
 * Two jobs.
 *
 * `inspect` answers "where is everything the app acted on, now?". The journal
 * says what the app did; only the disk says what is true today. A file the
 * journal records moving to the Recycle Bin may since have been put back in
 * Explorer, emptied out of the bin by Storage Sense, purged by the app itself,
 * or restored from here -- and each of those is a different sentence, only one
 * of which is "you can still put this back". The record is a claim and the disk
 * is the evidence, which is the same rule the purge follows.
 *
 * The handler is the second job. Putting a file back is an action like any
 * other, so it goes through the one pipeline -- plan, confirm, journal, apply --
 * and is recorded as a session of its own. That record is also what stops the
 * purge from ever treating the item as the app's again (see `ledger.js`).
 *
 * This is the one action no licence can refuse (roadmap rule 4): an expired
 * licence may make a feature read-only, never make something the app did
 * impossible to undo. Nothing here, and nothing that calls it, loads the
 * licence module; `scripts/test-entitlements.js` reads the files to check.
 *
 * An item is `${sessionId}:${index}` -- its place in an append-only journal,
 * so the same item has the same id for as long as its month file is kept. The
 * window names items by id and never by path: it can ask for something the
 * app did to be undone, and nothing else.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const i18n = require('../../i18n');
const { planTrash, executeTrash } = require('../lib/trash');
const { isProtectedPath, isProgramInstallPath, pathKey, CancelToken, throttle } = require('../lib/util');

/** Kinds whose sessions can be undone: those whose handler carries an `undo`. */
function undoFor(kind) {
  // Required here rather than at the top: the handler table includes this file.
  const handlers = require('./handlers');
  const handler = Object.prototype.hasOwnProperty.call(handlers, kind) ? handlers[kind] : null;
  return handler && handler.undo ? handler.undo : null;
}

const settledKey = (filePath, at) => `${pathKey(filePath)}|${Math.trunc(at)}`;

const exists = (p) => fsp.lstat(p).then(() => true, () => false);

/**
 * Where everything the journal records is now.
 *
 * @param {object} journal   an ActionJournal
 * @param {object} [options]
 * @param {Set<string>} [options.only]  item ids to look at; all of them when absent
 * @param {object} [options.deps]       passed to each kind's `undo.locate`
 * @returns {Promise<{sessions: object[], records: object[], status: Map<string, object>}>}
 */
async function inspect(journal, { only = null, deps = {} } = {}) {
  const sessions = await journal.sessions();

  // Items the app has since purged or put back, by path and first-recycled
  // moment -- the same key the ledger uses.
  const settled = new Map();
  for (const session of sessions) {
    if (session.kind !== 'purge' && session.kind !== 'restore') continue;
    for (const line of session.items) {
      const at = Date.parse(line.recycledAt);
      if (!Number.isFinite(at)) continue;
      settled.set(settledKey(line.from, at), { kind: session.kind, at: Date.parse(line.t), to: line.to || null });
    }
  }

  const records = [];
  for (const session of sessions) {
    if (!undoFor(session.kind)) continue;
    session.items.forEach((line, index) => {
      const id = `${session.id}:${index}`;
      if (only && !only.has(id)) return;
      records.push({
        id,
        session: session.id,
        kind: session.kind,
        path: path.resolve(line.from),
        size: Number.isFinite(line.bytes) ? line.bytes : 0,
        trashedAt: Date.parse(line.t),
        mtimeMs: line.mtime ? Date.parse(line.mtime) : null,
      });
    });
  }

  const status = new Map();
  const open = new Map(); // kind -> records still to locate
  for (const record of records) {
    const done = Number.isFinite(record.trashedAt) ? settled.get(settledKey(record.path, record.trashedAt)) : null;
    if (done && done.kind === 'purge') {
      status.set(record.id, { state: 'purged', at: done.at });
    } else if (done) {
      status.set(record.id, { state: 'restored', at: done.at, to: done.to, stillThere: done.to ? await exists(done.to) : false });
    } else {
      if (!open.has(record.kind)) open.set(record.kind, []);
      open.get(record.kind).push(record);
    }
  }

  for (const [kind, list] of open) {
    const located = await undoFor(kind).locate(list, deps);
    for (const record of list) status.set(record.id, located.get(record) || { state: 'gone', existsAtOrigin: false });
  }

  return { sessions, records, status };
}

const STATES = ['inBin', 'restored', 'purged', 'gone', 'unavailable'];

/** One session as the Restore Center lists it: what happened, and where it all is now. */
function summarise(session, records, status) {
  const tally = Object.fromEntries(STATES.map((s) => [s, 0]));
  let restorableBytes = 0;
  let bytes = 0;
  for (const record of records) {
    const st = status.get(record.id);
    if (st) tally[st.state] = (tally[st.state] || 0) + 1;
    if (st && st.state === 'inBin') restorableBytes += record.size;
    bytes += record.size;
  }
  const end = session.end || null;
  return {
    id: session.id,
    kind: session.kind,
    source: session.source,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    complete: session.complete,
    cancelled: end ? Boolean(end.cancelled) : false,
    count: session.items.length,
    bytes: records.length ? bytes : session.items.reduce((n, line) => n + (Number.isFinite(line.bytes) ? line.bytes : 0), 0),
    freedOnSource: end ? end.freedOnSource || 0 : 0,
    undoable: Boolean(undoFor(session.kind)),
    tally: records.length ? tally : null,
    restorable: { count: tally.inBin, bytes: restorableBytes },
  };
}

/** Every session, newest first, each with its tally. For `journal:sessions`. */
async function listSessions(journal, { deps } = {}) {
  const { sessions, records, status } = await inspect(journal, { deps });
  const bySession = new Map();
  for (const record of records) {
    if (!bySession.has(record.session)) bySession.set(record.session, []);
    bySession.get(record.session).push(record);
  }
  // A handoff opened a Windows page and touched no file: nothing to put back.
  return sessions.filter((s) => s.kind !== 'handoff').map((s) => summarise(s, bySession.get(s.id) || [], status));
}

/** One session's items and where each is now. For `journal:items`. */
async function listItems(journal, sessionId, { deps } = {}) {
  const sessions = await journal.sessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const ids = new Set(session.items.map((_, i) => `${sessionId}:${i}`));
  const { records, status } = await inspect(journal, { only: ids, deps });
  return records.map((record) => {
    const st = status.get(record.id) || { state: 'gone' };
    return {
      id: record.id,
      path: record.path,
      size: record.size,
      trashedAt: record.trashedAt,
      mtimeMs: record.mtimeMs,
      state: st.state,
      at: st.at || null,
      to: st.to || null,
      stillThere: st.stillThere === true,
      existsAtOrigin: st.existsAtOrigin === true,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* guards                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The real path of `target`'s folder, following junctions and links in the
 * part of it that exists.
 *
 * The journal names where a file came from, but the folders on that path may
 * have changed since: a user folder can have become a junction to somewhere
 * the app would never write. Checking the string alone would miss that.
 */
async function realParent(target) {
  let dir = path.dirname(target);
  const rest = [];
  for (;;) {
    try {
      return path.join(await fsp.realpath(dir), ...rest);
    } catch {
      const up = path.dirname(dir);
      if (up === dir) return path.join(dir, ...rest);
      rest.unshift(path.basename(dir));
      dir = up;
    }
  }
}

/**
 * Why an item was not put back, in the language the window is in.
 *
 * These reach the person -- the toast after a restore quotes the first one --
 * so they are sentences in the dictionary rather than English error strings.
 */
const say = {
  unknown: () => i18n.t('restore.why.unknown', 'Not something the app did'),
  restored: () => i18n.t('restore.why.restored', 'Already put back'),
  purged: () => i18n.t('restore.why.purged', 'Permanently removed from the Recycle Bin by the app'),
  gone: () => i18n.t('restore.why.gone', 'No longer in the Recycle Bin'),
  unavailable: () => i18n.t('restore.why.unavailable', 'The drive it was on is not connected'),
  notAbsolute: () => i18n.t('restore.why.notAbsolute', 'Not a full path'),
  system: () => i18n.t('restore.why.system', 'Refusing to write into a system location'),
  program: () => i18n.t('restore.why.program', 'Refusing to write into an installed application'),
  inTheWay: () => i18n.t('restore.why.inTheWay', 'Something is already at that path, so it was left alone'),
  folderInTheWay: () => i18n.t('restore.why.folderInTheWay', 'A folder is in the way, and folders are never moved to the bin'),
  displaceFailed: () => i18n.t('restore.why.displaceFailed', 'The file in the way could not be moved to the Recycle Bin'),
  failed: () => i18n.t('restore.why.failed', 'Could not put it back'),
};

/** The words for a state an item is in, when that state means "cannot be put back". */
const whyNot = (state) => (say[state] || say.gone)();

/** What a failed put-back says, from the code `recyclebin.putBack` returned. */
function putBackError(result) {
  if (result && result.code === 'EEXIST') return say.inTheWay();
  if (result && result.code === 'ENOENT') return say.gone();
  return say.failed();
}

/** Why a path may not be written to, or null. The same places a delete refuses. */
async function refuseTarget(target) {
  if (!path.isAbsolute(target)) return say.notAbsolute();
  const real = await realParent(target);
  if (isProtectedPath(target) || isProtectedPath(real)) return say.system();
  if (isProgramInstallPath(target) || isProgramInstallPath(real)) return say.program();
  return null;
}

/** `report.docx` -> `report (restored).docx`, then `report (restored 2).docx`. */
function renamed(target, n) {
  const ext = path.extname(target);
  const base = target.slice(0, target.length - ext.length);
  const word = i18n.t('restore.fileSuffix', 'restored');
  return `${base} (${n === 1 ? word : `${word} ${n}`})${ext}`;
}

/* -------------------------------------------------------------------------- */
/* the handler                                                                 */
/* -------------------------------------------------------------------------- */

const CONFLICT_CHOICES = ['skip', 'rename', 'replace'];

module.exports = {
  kind: 'restore',
  // Never behind a licence. `execute` is not handed a `can` for this kind at
  // all; this says so in the place a reader would look first.
  feature: 'free',
  allowsFolders: false,
  reversible: 'none',

  /** Putting a file back takes space rather than giving it. */
  freesOnVolume() {
    return false;
  },

  /**
   * Resolve ids against the journal, then against the disk. Touches nothing.
   *
   * @param {string[]} ids
   * @param {object} options
   * @param {object} ctx  `deps.journal` is required
   */
  async plan(ids, options, ctx) {
    const deps = (ctx && ctx.deps) || {};
    if (!deps.journal) throw new Error('restore: no journal to read');
    const token = (ctx && ctx.token) || new CancelToken();
    const wanted = new Set(ids.filter((id) => typeof id === 'string'));
    const { records, status } = await inspect(deps.journal, { only: wanted, deps });

    const plan = [];
    const failed = [];
    const found = new Set(records.map((r) => r.id));
    for (const id of wanted) {
      if (!found.has(id)) failed.push({ path: id, error: say.unknown(), code: 'EUNKNOWN' });
    }

    let totalBytes = 0;
    let conflicts = 0;
    let conflictFolders = 0;
    for (const record of records) {
      if (token.cancelled) break;
      const st = status.get(record.id);
      if (!st || st.state !== 'inBin') {
        const state = st ? st.state : 'gone';
        failed.push({ path: record.path, error: whyNot(state), code: state });
        continue;
      }
      const refusal = await refuseTarget(record.path);
      if (refusal) {
        failed.push({ path: record.path, error: refusal, code: 'EREFUSED' });
        continue;
      }
      let conflict = null;
      try {
        const there = await fsp.lstat(record.path);
        conflict = there.isDirectory() ? 'folder' : 'file';
      } catch {
        conflict = null;
      }
      if (conflict) conflicts += 1;
      if (conflict === 'folder') conflictFolders += 1;
      plan.push({ ...record, located: st, conflict });
      totalBytes += record.size;
    }

    return { plan, failed, conflicts, conflictFolders, totalBytes, cancelled: token.cancelled };
  },

  describe(planned) {
    const unrestorable = {};
    for (const f of planned.failed) unrestorable[f.code] = (unrestorable[f.code] || 0) + 1;
    return {
      kind: 'restore',
      count: planned.plan.length,
      bytes: planned.totalBytes,
      conflicts: planned.conflicts,
      conflictFolders: planned.conflictFolders,
      refused: planned.failed.length,
      unrestorable,
      freesOnVolume: false,
      reversible: 'none',
    };
  },

  /**
   * Put each planned item back, one at a time, journalled as it goes.
   *
   * `options.onConflict` is what the confirmation asked about: `skip` (the
   * default -- nothing is overwritten unless somebody chose it), `rename` (keep
   * both, the restored one under a new name), or `replace` (the file in the
   * way goes to the Recycle Bin first, as a recycle session of its own, so it
   * can be put back too).
   */
  async apply(planned, options, ctx) {
    const deps = (ctx && ctx.deps) || {};
    const token = (ctx && ctx.token) || new CancelToken();
    const onConflict = CONFLICT_CHOICES.includes(options && options.onConflict) ? options.onConflict : 'skip';
    const started = Date.now();
    const moved = [];
    const failed = [];
    let movedBytes = 0;
    let recordError = null;
    const totalBytes = planned.plan.reduce((n, item) => n + item.size, 0);

    const report = (currentPath) => {
      if (!ctx || !ctx.onProgress) return;
      const elapsedMs = Date.now() - started;
      const done = moved.length + failed.length;
      const ratePerSec = elapsedMs > 0 ? (done / elapsedMs) * 1000 : 0;
      ctx.onProgress({
        phase: 'restoring',
        done,
        total: planned.plan.length,
        freedBytes: movedBytes,
        totalBytes,
        currentPath,
        ratePerSec,
        elapsedMs,
        etaMs: ratePerSec > 0 ? Math.round(((planned.plan.length - done) / ratePerSec) * 1000) : null,
      });
    };
    const reportThrottled = throttle(report, 150);
    report(null);

    // Files in the way, when the choice was to replace them. Recycled through
    // the ordinary machinery and recorded as a recycle session, opened only if
    // one is actually needed.
    let displacedSession = null;
    let displacedCount = 0;
    let displacedBytes = 0;
    const displace = async (target) => {
      const vetted = await planTrash([target], {}, { token });
      if (vetted.plan.length === 0) {
        return { ok: false, error: say.displaceFailed() };
      }
      if (!displacedSession && deps.journal) {
        displacedSession = await deps.journal.begin(
          'recycle',
          { count: 0, bytes: 0, freesOnVolume: false, reversible: 'bin' },
          { source: 'restore', runId: null }
        );
      }
      const out = await executeTrash(vetted.plan, deps.shell ? { shell: deps.shell } : {}, {
        token,
        onItem: (rec) => (displacedSession ? deps.journal.record(displacedSession, rec) : null),
      });
      if (out.recordError) return { ok: false, error: out.recordError, fatal: true };
      if (out.moved.length !== 1) {
        return { ok: false, error: say.displaceFailed() };
      }
      displacedCount += 1;
      displacedBytes += out.moved[0].size;
      return { ok: true };
    };

    try {
      for (const item of planned.plan) {
        if (token.cancelled) break;

        // Checked again: the plan can be minutes old if the dialog sat open.
        const refusal = await refuseTarget(item.path);
        if (refusal) {
          failed.push({ path: item.path, error: refusal, code: 'EREFUSED' });
          reportThrottled(item.path);
          continue;
        }

        let target = item.path;
        let conflict = null;
        try {
          conflict = (await fsp.lstat(target)).isDirectory() ? 'folder' : 'file';
        } catch {
          conflict = null;
        }

        if (conflict && onConflict === 'skip') {
          failed.push({ path: item.path, error: say.inTheWay(), code: 'EEXIST' });
          reportThrottled(item.path);
          continue;
        }
        if (conflict === 'folder' && onConflict === 'replace') {
          failed.push({ path: item.path, error: say.folderInTheWay(), code: 'EEXIST' });
          reportThrottled(item.path);
          continue;
        }
        const undo = undoFor(item.kind);
        if (conflict && onConflict === 'replace') {
          // Only once the way back is known to be open: moving somebody's file
          // to the bin and then finding nothing to put in its place would
          // leave them with less than they started with.
          if (!(await undo.ready(item.located))) {
            failed.push({ path: item.path, error: say.gone(), code: 'gone' });
            reportThrottled(item.path);
            continue;
          }
          const out = await displace(target);
          if (out.fatal) {
            recordError = out.error;
            break;
          }
          if (!out.ok) {
            failed.push({ path: item.path, error: out.error, code: 'EDISPLACE' });
            reportThrottled(item.path);
            continue;
          }
        }

        let result = null;
        for (let n = conflict && onConflict === 'rename' ? 1 : 0; n < 100; n++) {
          target = n === 0 ? item.path : renamed(item.path, n);
          if (n > 0 && (await exists(target))) continue;
          result = await undo.putBack(item.located, target);
          // Somebody put a file there between the check and the link: only a
          // rename may move on to the next name. Anything else is a refusal.
          if (!(result.code === 'EEXIST' && onConflict === 'rename')) break;
        }

        if (!result || !result.ok) {
          failed.push({ path: item.path, error: putBackError(result), code: result ? result.code : 'EFAIL' });
          reportThrottled(item.path);
          continue;
        }

        const record = { path: item.path, to: target, size: item.size, mtimeMs: item.mtimeMs, recycledAt: item.trashedAt };
        moved.push(record);
        movedBytes += item.size;

        // The record before the window hears about it, as for every action.
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
    } finally {
      if (displacedSession) {
        await deps.journal
          .end(displacedSession, { done: displacedCount, failed: 0, skipped: 0, movedBytes: displacedBytes, freedOnSource: 0 })
          .catch(() => {});
      }
    }

    report(null);
    return {
      moved,
      failed,
      // `execute` reads this as the bytes the action handled; for a restore it
      // is what came back out of the bin, and it frees nothing.
      freedBytes: movedBytes,
      cancelled: token.cancelled,
      remaining: planned.plan.length - (moved.length + failed.length),
      durationMs: Date.now() - started,
      ...(recordError ? { recordError } : {}),
    };
  },

  // Exposed for the IPC handlers and the harnesses.
  inspect,
  listSessions,
  listItems,
  refuseTarget,
  renamed,
};
