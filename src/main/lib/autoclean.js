'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { renameRetrying } = require('./atomic');
const { execFile } = require('node:child_process');

const { scan } = require('./scanner');
const { CATEGORIES } = require('./advisor');
const { planTrash, executeTrash } = require('./trash');
const { fullestVolume } = require('./disk');
const { findUserBins, purgeRecorded } = require('./recyclebin');
const { CancelToken, pathKey, isUndeletablePath, IS_WIN } = require('./util');
const { isAllowedUnattended } = require('../automatic/allowed-categories');
const { execute } = require('../actions/execute');
const { message: m } = require('../../i18n');

/**
 * One unattended cleanup.
 *
 * Everything here is written on the assumption that nobody is watching. The
 * interactive app can afford to present a borderline file and let the user
 * decide; this cannot, so every ambiguity resolves towards doing nothing. A run
 * that cleans less than it could is a disappointment. A run that deletes
 * something the user wanted is the end of their trust in the app, and there is
 * no dialog in front of it to catch the mistake.
 *
 * The four gates below are the whole design:
 *
 *   - Only categories the advisor calls 'safe', and only the subset the user
 *     enabled. 'Worth reviewing' means exactly that -- it never runs unattended.
 *   - Only files untouched for longer than the configured age.
 *   - Nothing under a whitelisted folder, and nothing the delete guards refuse.
 *   - Nothing at all while an app the user named is running.
 */

const DAY = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* preconditions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Image names of running processes, lowercased.
 *
 * `tasklist /FO CSV` is used because the image name column is a filename, not a
 * translated string -- the same reasoning that keeps scheduler.js away from
 * parsing localised output. A failure to enumerate returns null rather than an
 * empty set, so the caller can tell "nothing is running" apart from "we could
 * not find out", and treat the second as a reason not to delete anything.
 *
 * @returns {Promise<Set<string>|null>}
 */
function runningProcessNames() {
  if (!IS_WIN) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        const names = new Set();
        for (const line of String(stdout).split(/\r?\n/)) {
          const match = /^"([^"]+)"/.exec(line.trim());
          if (match) names.add(match[1].toLowerCase());
        }
        resolve(names.size > 0 ? names : null);
      }
    );
  });
}

/** Which of the user's named apps are open right now. */
async function blockingApps(skipIfRunning) {
  if (!skipIfRunning || skipIfRunning.length === 0) return { blocked: [], known: true };
  const running = await runningProcessNames();
  if (!running) return { blocked: [], known: false };
  return {
    blocked: skipIfRunning.filter((name) => running.has(String(name).toLowerCase())),
    known: true,
  };
}

/* -------------------------------------------------------------------------- */
/* selection                                                                   */
/* -------------------------------------------------------------------------- */

function isUnderAny(target, roots) {
  if (!roots || roots.length === 0) return false;
  const key = pathKey(target);
  return roots.some((root) => {
    const rootKey = pathKey(root);
    return key === rootKey || key.startsWith(rootKey + path.sep);
  });
}

/**
 * The most recent evidence that anyone cared about a file.
 *
 * Access time is used when the OS tracks it and modification time otherwise,
 * but taking whichever is *later* rather than picking one is what makes the age
 * gate conservative: a file that was written a year ago and opened yesterday is
 * a file in use, and the year-old timestamp must not be the one that decides.
 */
function lastTouched(file) {
  const m = Number(file.mtimeMs) || 0;
  const a = Number(file.atimeMs) || 0;
  return Math.max(m, a);
}

/**
 * Turn a scan's cleanup advice into the list a run may act on.
 *
 * @returns {{files: Array, bytes: number, skipped: object}}
 */
function selectFiles(cleanup, settings, now = Date.now()) {
  const wanted = new Set(settings.categories);
  const minAge = settings.minAgeDays * DAY;
  const skipped = { category: 0, tooRecent: 0, whitelisted: 0, guarded: 0 };
  const chosen = [];

  for (const group of (cleanup && cleanup.groups) || []) {
    // Belt and braces. coerceSettings already refuses non-safe categories, but
    // this is the gate that actually deletes, so it re-checks the verdict here
    // rather than trusting a list that reached it through a JSON file.
    if (group.verdict !== 'safe' || !wanted.has(group.category)) {
      skipped.category += group.count || 0;
      continue;
    }

    // And the category name itself is checked against the advisor's own table,
    // rather than only the verdict attached to it.
    //
    // Until this was written, a group could name any category at all and get
    // through on the strength of `verdict: 'safe'` and a matching entry in the
    // settings file. Nothing produced such a group -- the advisor's table is
    // fixed and every category in it is one of these -- so the guarantee held
    // by arrangement rather than by construction. That is a poor way to hold a
    // guarantee that photographs can never be deleted by a task running at two
    // in the morning, so it is now checked where the deleting happens.
    const known = CATEGORIES[group.category];
    if (!known || known.verdict !== 'safe') {
      skipped.category += group.count || 0;
      continue;
    }

    // And against the hard whitelist, which no analyzer and no settings file
    // can extend. A category the advisor one day calls safe is still not
    // something that runs at 2am until it is added there by hand.
    if (!isAllowedUnattended(`cleanup.${group.category}`)) {
      skipped.category += group.count || 0;
      continue;
    }

    for (const file of group.files) {
      if (now - lastTouched(file) < minAge) {
        skipped.tooRecent += 1;
        continue;
      }
      if (isUnderAny(file.path, settings.whitelist)) {
        skipped.whitelisted += 1;
        continue;
      }
      if (isUndeletablePath(file.path)) {
        skipped.guarded += 1;
        continue;
      }
      chosen.push({ path: file.path, size: file.size, category: group.category, reason: file.reason });
    }
  }

  // Largest first: the per-run cap should buy back as much space as it can.
  chosen.sort((a, b) => b.size - a.size);
  const capped = chosen.slice(0, settings.maxItemsPerRun);

  return {
    files: capped,
    bytes: capped.reduce((n, f) => n + f.size, 0),
    truncated: chosen.length > capped.length,
    considered: chosen.length,
    skipped,
  };
}

/* -------------------------------------------------------------------------- */
/* the run                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @param {object}  options
 * @param {object}  options.settings   validated settings (see settings.js)
 * @param {object}  [options.ledger]   TrashLedger, so a purge can find these later
 * @param {object}  [options.deps]     injectable { scan, planTrash, executeTrash, shell }
 * @param {CancelToken} [options.token]
 * @param {(stage: object) => void} [options.onStage]
 */
async function runAutoClean(options) {
  const settings = options.settings;
  const auto = settings.autoClean;
  const deps = { scan, planTrash, executeTrash, ...(options.deps || {}) };
  const token = options.token || new CancelToken();
  const onStage = options.onStage || (() => {});
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const startedAt = now;

  const run = {
    runId: `run-${startedAt.toString(36)}`,
    startedAt,
    finishedAt: null,
    dryRun: auto.dryRun === true,
    roots: auto.roots,
    outcome: 'ok',
    reason: null,
    scanned: { files: 0, bytes: 0, errors: 0 },
    selected: { files: 0, bytes: 0, truncated: false },
    trashed: { files: 0, bytes: 0, failed: 0 },
    purged: { files: 0, bytes: 0 },
    diskBefore: null,
    diskAfter: null,
    skipped: { category: 0, tooRecent: 0, whitelisted: 0, guarded: 0 },
    notes: [],
  };

  const finish = (outcome, reason) => {
    run.outcome = outcome;
    run.reason = reason;
    run.finishedAt = Date.now();
    onStage({ stage: 'done', run });
    return run;
  };

  // Every reason below is a message rather than a sentence, because the run log
  // it ends up in is read later -- possibly in a different language, and months
  // after this process exited.
  if (!auto.enabled) return finish('skipped', m('run.switchedOff', 'Automatic cleanup is switched off'));
  if (auto.roots.length === 0) return finish('skipped', m('run.noFolders', 'No folders are configured'));
  if (auto.categories.length === 0) {
    return finish('skipped', m('run.noCategories', 'No cleanup categories are enabled'));
  }

  /* -- gate 1: is the disk even under pressure ---------------------------- */

  onStage({ stage: 'checking' });
  const before = await fullestVolume(auto.roots);
  run.diskBefore = before;

  if (auto.minDiskUsedPercent > 0) {
    if (!before) {
      run.notes.push(
        m('run.note.noDiskUsage', 'Could not read disk usage; the usage threshold was not applied')
      );
    } else if (before.usedPercent < auto.minDiskUsedPercent) {
      return finish(
        'skipped',
        m('run.belowThreshold', 'Disk is {used}% full, below the {threshold}% threshold', {
          used: before.usedPercent.toFixed(1),
          threshold: auto.minDiskUsedPercent,
        })
      );
    }
  }

  /* -- gate 2: is somebody working ---------------------------------------- */

  const apps = await blockingApps(auto.skipIfRunning);
  if (!apps.known && auto.skipIfRunning.length > 0) {
    // We were asked to avoid certain apps and cannot tell whether they are
    // open. Doing nothing is the only answer that honours the instruction.
    return finish('skipped', m('run.noProcessList', 'Could not determine which applications are running'));
  }
  if (apps.blocked.length > 0) {
    return finish('skipped', m('run.appsRunning', 'Skipped because these are running: {apps}', {
      apps: apps.blocked.join(', '),
    }));
  }

  /* -- scan ---------------------------------------------------------------- */

  const selected = [];
  for (const root of auto.roots) {
    if (token.cancelled) return finish('cancelled', 'Cancelled');
    onStage({ stage: 'scanning', root });

    let result;
    try {
      result = await deps.scan(root, { keepPerCategory: auto.maxItemsPerRun }, { token });
    } catch (err) {
      run.notes.push(
        m('run.note.rootFailed', '{root}: {error}', {
          root,
          error: err.message || 'could not be scanned',
        })
      );
      continue;
    }

    run.scanned.files += result.totalFiles || 0;
    run.scanned.bytes += result.totalSize || 0;
    run.scanned.errors += result.errorCount || 0;

    const picked = selectFiles(result.cleanup, auto, now);
    for (const key of Object.keys(run.skipped)) run.skipped[key] += picked.skipped[key] || 0;
    if (picked.truncated) run.selected.truncated = true;
    selected.push(...picked.files);
  }

  if (token.cancelled) return finish('cancelled', 'Cancelled');

  // One root's file can appear under another if the roots overlap.
  const unique = [];
  const seen = new Set();
  for (const file of selected.sort((a, b) => b.size - a.size)) {
    const key = pathKey(file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(file);
    if (unique.length >= auto.maxItemsPerRun) break;
  }

  run.selected.files = unique.length;
  run.selected.bytes = unique.reduce((n, f) => n + f.size, 0);

  if (unique.length === 0) return finish('ok', m('run.nothingMatched', 'Nothing matched the cleanup rules'));

  /* -- dry run stops here --------------------------------------------------- */

  if (run.dryRun) {
    run.sample = unique.slice(0, 50).map((f) => ({ path: f.path, size: f.size, category: f.category }));
    return finish('dry-run', m('run.wouldMove', 'Would move {n} file(s) to the Recycle Bin', {
      n: unique.length,
    }));
  }

  /* -- delete --------------------------------------------------------------- */

  // A scheduled run has nobody to ask and passes no confirm hook. A run the
  // user started from the app does, so the same code path can put a dialog with
  // the real numbers in front of the deletion rather than a guess made earlier.
  if (typeof options.onConfirm === 'function') {
    const approved = await options.onConfirm({
      files: unique.length,
      bytes: run.selected.bytes,
      sample: unique.slice(0, 20),
    });
    if (!approved) return finish('cancelled', m('run.cancelledBefore', 'Cancelled before anything was deleted'));
  }

  onStage({ stage: 'deleting', total: unique.length });

  // Through the same pipeline as a delete from any screen: the same vetting,
  // the same probe, the same record. The only thing this caller leaves out is
  // the dialog, because at 02:00 there is nobody to show it to -- which is why
  // a schedule starts in report-only mode.
  const executed = await execute(
    { kind: 'recycle', items: unique.map((f) => f.path) },
    {
      token,
      journal: options.journal,
      source: options.source || 'autoclean',
      runId: run.runId,
      deps: {
        planTrash: deps.planTrash,
        executeTrash: deps.executeTrash,
        shell: options.deps && options.deps.shell,
      },
    }
  );

  if (executed.moved.length === 0 && !executed.cancelled && executed.failed.length > 0 &&
      executed.description && executed.description.count === 0) {
    run.trashed.failed = executed.failed.length;
    return finish('ok', m('run.allRefused', 'Every candidate was refused by the delete guards'));
  }

  run.trashed.files = executed.moved.length;
  run.trashed.bytes = executed.movedBytes;
  run.trashed.failed = executed.failed.length;
  if (executed.recordError) {
    run.notes.push(
      m('run.note.recordFailed', 'Stopped early: the record of what was moved could not be written ({error})', {
        error: executed.recordError,
      })
    );
  }

  // A caller with a journal has had every item recorded as it moved. One
  // without -- the harnesses -- still gets the old ledger written.
  if (!options.journal && options.ledger && executed.moved.length > 0) {
    await options.ledger.record(executed.moved, { runId: run.runId });
  }

  /* -- purge: the step that actually frees the disk ------------------------ */

  if (settings.purge.enabled && options.ledger) {
    onStage({ stage: 'purging' });
    try {
      const expired = options.ledger.expired(settings.purge.afterDays, now);
      if (expired.length > 0) {
        const bins = options.deps && options.deps.binDirs
          ? options.deps.binDirs
          : await findUserBins(auto.roots);
        const purge = await purgeRecorded({
          entries: expired,
          binDirs: bins,
          afterDays: settings.purge.afterDays,
          now,
        });
        run.purged.files = purge.purged.length;
        run.purged.bytes = purge.freedBytes;
        if (purge.purged.length > 0) {
          await options.ledger.forget(purge.purged.map((p) => p.entry), { freedBytes: purge.freedBytes });
        }
        if (purge.failed.length > 0) {
          run.notes.push(
            m('run.note.purgeFailed', '{n} recycled item(s) could not be removed', { n: purge.failed.length })
          );
        }
      }
    } catch (err) {
      run.notes.push(
        m('run.note.purgeError', 'Recycle Bin purge failed: {error}', {
          error: err.message || 'unknown error',
        })
      );
    }
  } else if (!settings.purge.enabled && run.trashed.files > 0) {
    // Say it plainly rather than reporting bytes that are not actually back.
    run.notes.push(
      m(
        'run.note.stillInBin',
        'Files are in the Recycle Bin, which is on the same disk — no space is free until the bin is ' +
          'emptied. Turn on delayed purge to have CleanDrive empty its own items after a grace period.'
      )
    );
  }

  run.diskAfter = await fullestVolume(auto.roots);
  return finish('ok', null);
}

/* -------------------------------------------------------------------------- */
/* run log                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What happened, kept so the settings screen can show it.
 *
 * The app keeps its own log rather than reading Task Scheduler's history: the
 * scheduler knows whether a process started and what it returned, and that is
 * not the question a user asks. They ask what was deleted.
 */
class RunLog {
  constructor(filePath, { keep = 50 } = {}) {
    this.filePath = path.resolve(filePath);
    this.keep = keep;
    this.runs = [];
    this.loaded = false;
  }

  async load() {
    this.loaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
      this.runs = Array.isArray(parsed && parsed.runs) ? parsed.runs : [];
    } catch {
      this.runs = [];
    }
    return this.runs;
  }

  async append(run) {
    if (!this.loaded) await this.load();
    this.runs.unshift(run);
    if (this.runs.length > this.keep) this.runs.length = this.keep;

    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify({ version: 1, runs: this.runs }, null, 2)}\n`, 'utf8');
    await renameRetrying(temp, this.filePath);
    return run;
  }

  latest() {
    return this.runs.length > 0 ? this.runs[0] : null;
  }
}

module.exports = {
  runAutoClean,
  selectFiles,
  lastTouched,
  blockingApps,
  runningProcessNames,
  RunLog,
};
