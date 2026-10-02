'use strict';

/**
 * `cleandrive run --profile <id> [--report-only]` -- one automatic cleanup,
 * now, through every gate the 02:00 run passes.
 *
 * This is the only command that deletes anything, and it deletes nothing a
 * profile would not: `runAutoClean` is the same function the scheduled run
 * calls, with the same categories, whitelist, age, disk threshold, open-app
 * check and delete guards. Nothing here relaxes any of them:
 *
 * - a profile that is **switched off** is refused (2), not run anyway. The
 *   window's "Run now" button may run one, because pressing it is a person's
 *   consent there and then; a command line can be a script.
 * - a profile in **report-only** stays report-only. `--report-only` can make a
 *   live profile report; nothing can make a report-only profile act.
 *
 * It takes the same lock as the scheduled run and waits for it the same 90
 * seconds, and the run is written to the same run log -- marked `via: 'cli'`,
 * so the Automatic tab does not call it a scheduled cleanup -- because a run
 * from a script is still a run somebody may later need to account for.
 */

const { profileById, profilesOf } = require('../../lib/settings');
const { runAutoClean, emptyRun } = require('../../lib/autoclean');
const runlock = require('../../lib/runlock');
const { message: m } = require('../../../i18n');
const { EXIT, CliError } = require('../codes');
const f = require('../format');
const { nameOf } = require('./profiles');

const STAGES = Object.freeze({
  checking: () => 'checking the disk and the programs that are open ...',
  scanning: (s) => `scanning ${s.root} ...`,
  deleting: (s) => `moving ${f.files(s.total)} ...`,
  purging: () => 'removing this app\'s own items that have been in the Recycle Bin long enough ...',
});

/** What a finished run returns to the shell. */
function exitFor(run) {
  if (run.outcome === 'skipped') return EXIT.REFUSED;
  if (run.outcome === 'cancelled') return EXIT.STOPPED;
  if ((run.notes || []).some((n) => n && n.i18n === 'run.note.recordFailed')) return EXIT.STOPPED;
  if (run.reason && run.reason.i18n === 'run.allRefused') return EXIT.REFUSED;
  return EXIT.OK;
}

async function run(args, ctx) {
  const svc = ctx.services();
  const { settings: store, ledger, runLog, history } = svc;
  const settings = await store.load();
  const id = args.values.profile;
  // The organisation's profile (H2) needs no settings file; any other does.
  const managedId = settings.managed && settings.managed.profileId;
  if (!store.exists && !(managedId && profileById(settings, id) && profileById(settings, id).id === managedId)) {
    throw new CliError(EXIT.REFUSED, 'No settings file was found, so there is no profile to run. Nothing was done.');
  }
  await ledger.load();
  await runLog.load();

  const profile = profileById(settings, id);
  if (!profile) {
    const ids = profilesOf(settings).map((p) => p.id).join(', ');
    throw new CliError(EXIT.USAGE, `No profile with the id "${id}". This computer has: ${ids}. "cleandrive profiles" says which is which.`);
  }
  const index = profilesOf(settings).findIndex((p) => p.id === profile.id);
  const reportOnlyAsked = Boolean(args.flags['report-only']);
  const effective = reportOnlyAsked ? { ...profile, dryRun: true } : profile;

  const startedAt = ctx.now();
  let lock = await runlock.acquire(svc.runLockPath, { holder: `cli:${profile.id}`, waitMs: 0 });
  if (!lock.ok) {
    ctx.out.note('another automatic cleanup is running; waiting for it to finish (at most 90 seconds) ...');
    // The scheduled run's own wait unless a harness shortens it.
    const wait = Number.isFinite(ctx.lockWaitMs) ? { waitMs: ctx.lockWaitMs } : {};
    lock = await runlock.acquire(svc.runLockPath, { holder: `cli:${profile.id}`, ...wait });
  }

  let result;
  if (!lock.ok) {
    result = {
      ...emptyRun(startedAt),
      finishedAt: ctx.now(),
      profileId: profile.id,
      profileName: profile.name || null,
      outcome: 'skipped',
      reason: m('run.cliBusy', 'Another automatic cleanup was still running after 90 seconds, so this run from the command line was skipped.'),
    };
  } else {
    try {
      result = await runAutoClean({
        settings,
        profile: effective,
        ledger,
        journal: svc.journal,
        source: 'cli',
        quarantine: settings.quarantine,
        can: ctx.can,
        token: ctx.token,
        onStage: (s) => STAGES[s.stage] && ctx.out.note(STAGES[s.stage](s)),
      });
    } finally {
      await lock.release();
    }
    if (lock.waitedMs > 1000) {
      result.notes.push(m('run.waitedForLock', 'Waited {s}s for another profile to finish before starting.', { s: Math.round(lock.waitedMs / 1000) }));
    }
  }
  result.via = 'cli';
  await runLog.append(result);
  if (!result.dryRun && (result.trashed.bytes > 0 || result.purged.bytes > 0)) {
    await history
      .addEvent({ movedBytes: result.trashed.bytes, freedBytes: result.purged.bytes, files: result.trashed.files, source: 'cli' })
      .catch(() => {});
  }

  const code = exitFor(result);
  ctx.out.document({
    schema: 'cleandrive.run/1',
    generatedAt: f.iso(ctx.now()),
    exitCode: code,
    profile: { id: profile.id, name: profile.name || null, shownAs: nameOf(profile, index) },
    reportOnly: result.dryRun,
    reportOnlyAsked,
    action: result.action,
    outcome: result.outcome,
    reason: f.text(result.reason) || null,
    notes: (result.notes || []).map((n) => f.text(n)),
    roots: result.roots,
    scanned: result.scanned,
    selected: result.selected,
    // Moved and freed are two figures and never one: for the Recycle Bin the
    // second is what the purge removed, and only that.
    moved: { files: result.trashed.files, bytes: result.trashed.bytes, failed: result.trashed.failed },
    freedOnDrive: (result.trashed.freedBytes || 0) + (result.purged.bytes || 0),
    purged: result.purged,
    skipped: result.skipped,
    diskBefore: result.diskBefore,
    diskAfter: result.diskAfter,
    wouldMove: result.sample || null,
    session: result.session || null,
    runId: result.runId,
    startedAt: f.iso(result.startedAt),
    finishedAt: f.iso(result.finishedAt),
  });

  const label = `${profile.id} (${nameOf(profile, index)})`;
  ctx.out.line(`${label}: ${result.outcome}${result.reason ? ` -- ${f.text(result.reason)}` : ''}`);
  if (result.scanned.files > 0) {
    ctx.out.line(`  scanned ${f.files(result.scanned.files)}, ${f.bytes(result.scanned.bytes)}; selected ${f.count(result.selected.files)}, ${f.bytes(result.selected.bytes)}`);
  }
  if (result.outcome === 'dry-run') {
    ctx.out.line(`  report only: nothing was moved${reportOnlyAsked && !profile.dryRun ? ' (--report-only)' : ''}`);
    for (const s of result.sample || []) ctx.out.line(`  ${f.pad(f.bytes(s.size), 9)}  ${s.path}`);
    if ((result.sample || []).length < result.selected.files) ctx.out.line(`  and ${f.count(result.selected.files - result.sample.length)} more`);
  } else if (result.trashed.files > 0) {
    const where = result.action === 'quarantine' ? 'to the other drive' : 'to the Recycle Bin';
    ctx.out.line(`  moved ${f.files(result.trashed.files)}, ${f.bytes(result.trashed.bytes)}, ${where}${result.trashed.failed ? `; ${f.count(result.trashed.failed)} refused` : ''}`);
    const freed = (result.trashed.freedBytes || 0) + (result.purged.bytes || 0);
    ctx.out.line(`  free again on the drive: ${f.bytes(freed)}`);
    if (result.session) ctx.out.line(`  undo with: cleandrive restore ${result.session}`);
  }
  for (const n of result.notes || []) ctx.out.line(`  note: ${f.text(n)}`);
  return code;
}

module.exports = { run, exitFor };
