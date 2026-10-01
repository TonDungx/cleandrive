'use strict';

/**
 * `cleandrive restore <session> [--dry-run]` -- put back what one journal
 * session moved.
 *
 * Never behind a licence (ROADMAP rule 4: restoring is there at every tier),
 * and this file does not load the module that holds one. The work is the
 * `restore` handler through `execute()`, the pipeline the Restore Center's
 * button uses, with one difference that is the whole of the command line's
 * caution: **a file in the way is always skipped.** The window asks what to
 * do about one -- keep both, skip, replace -- because a person is there to
 * answer. Nobody is here, so nothing is ever overwritten or renamed, and a
 * skipped item makes the exit code 2 so a script knows it was not all put
 * back. `--dry-run` says what would happen and touches nothing.
 */

const { execute } = require('../../actions/execute');
const restoreEngine = require('../../actions/restore');
const { EXIT, CliError } = require('../codes');
const f = require('../format');
const { SESSION_ID } = require('./journal');

async function run(args, ctx) {
  const id = args.positional[0];
  if (!SESSION_ID.test(id)) throw new CliError(EXIT.USAGE, `"${id}" is not a session id. "cleandrive journal list" lists them.`);
  const svc = ctx.services();
  const retentionDays = (await svc.settings.load()).quarantine.retentionDays;
  const items = await restoreEngine.listItems(svc.journal, id, { deps: { retentionDays } });
  if (!items) throw new CliError(EXIT.USAGE, `No session ${id} in the journal. "cleandrive journal list" lists them.`);

  const dryRun = Boolean(args.flags['dry-run']);
  const result = await execute(
    { kind: 'restore', items: items.map((i) => i.id), options: { onConflict: 'skip', dryRun } },
    { token: ctx.token, journal: svc.journal, deps: { journal: svc.journal, retentionDays }, source: 'cli', runId: 'cli' }
  );

  // In a dry run the plan is the answer: what is in the way is still in it.
  const planned = result.moved || [];
  const inTheWay = dryRun
    ? planned.filter((p) => p.conflict).map((p) => ({ path: p.path, conflict: p.conflict }))
    : result.failed.filter((x) => x.code === 'EEXIST').map((x) => ({ path: x.path }));
  const putBack = dryRun ? planned.filter((p) => !p.conflict) : planned;
  const refused = result.failed.filter((x) => x.code === 'EREFUSED').map((x) => ({ path: x.path, reason: f.text(x.error) }));
  const notRecoverable = result.failed
    .filter((x) => x.code !== 'EEXIST' && x.code !== 'EREFUSED')
    .map((x) => ({ path: x.path, state: x.code, reason: f.text(x.error) }));

  const stoppedShort = Boolean(result.recordError) || Boolean(result.cancelled);
  const code = stoppedShort
    ? EXIT.STOPPED
    : inTheWay.length > 0 || refused.length > 0 || putBack.length === 0
      ? EXIT.REFUSED
      : EXIT.OK;

  ctx.out.document({
    schema: 'cleandrive.restore/1',
    generatedAt: f.iso(ctx.now()),
    exitCode: code,
    session: id,
    dryRun,
    putBack: putBack.map((p) => ({ path: p.path, bytes: p.size })),
    inTheWay,
    refused,
    notRecoverable,
    restoreSession: result.session || null,
    recordError: result.recordError || null,
  });

  const verb = dryRun ? 'would put back' : 'put back';
  ctx.out.line(`${id}: ${verb} ${f.count(putBack.length)} item(s), ${f.bytes(putBack.reduce((n, p) => n + (p.size || 0), 0))}`);
  for (const p of putBack) ctx.out.line(`  ${f.pad(f.bytes(p.size), 9)}  ${p.path}`);
  if (inTheWay.length > 0) {
    ctx.out.line(`${f.count(inTheWay.length)} ${dryRun ? 'would be' : 'were'} skipped: something else is at the old path now, and the command line never overwrites. Use the Restore Center to choose.`);
    for (const p of inTheWay) ctx.out.line(`  ${p.path}`);
  }
  for (const r of refused) ctx.out.line(`refused: ${r.path} -- ${r.reason}`);
  if (notRecoverable.length > 0) {
    ctx.out.line(`${f.count(notRecoverable.length)} cannot be put back:`);
    for (const n of notRecoverable) ctx.out.line(`  ${n.path} -- ${n.reason}`);
  }
  if (result.recordError) ctx.out.line(`stopped early: the record of what was put back could not be written (${result.recordError})`);
  return code;
}

module.exports = { run };
