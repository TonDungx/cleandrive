'use strict';

/**
 * `cleandrive journal list | show <session> | verify` -- what the app did, and
 * whether the record of it is still as it was written.
 *
 * Never behind a licence, and this file does not load the module that holds
 * one (`scripts/test-entitlements.js` reads it to check). A lapsed licence
 * stops new seals; every old one stays checkable, and everything the app did
 * stays listable, exactly as in the Restore Center.
 *
 * `verify` is `verifyJournal` from journal/seal.js -- the function the Restore
 * Center calls -- and its report is printed as it is, `"schema":
 * "cleandrive.journal-verify/1"` included. It exits 6 when a sealed session
 * was changed, removed or duplicated; a session that was never sealed is not
 * a finding, because it never claimed anything.
 */

const restoreEngine = require('../../actions/restore');
const { verifyJournal } = require('../../journal/seal');
const { EXIT, CliError } = require('../codes');
const f = require('../format');

const SESSION_ID = /^s_[0-9a-f]{8}$/;

const SOURCE = Object.freeze({
  manual: 'from a screen',
  autoclean: 'automatic cleanup, started by hand',
  scheduled: 'scheduled cleanup',
  cli: 'from the command line',
  migrated: 'from the older record',
  purge: 'Recycle Bin purge',
  restore: 'moved aside for a file being put back',
});

const STATE = Object.freeze({
  inBin: 'in the Recycle Bin',
  inQuarantine: 'in the quarantine folder',
  inArchive: 'in the archive',
  linked: 'joined to its copies',
  restored: 'put back',
  purged: 'permanently removed by the purge',
  gone: 'no longer in the Recycle Bin',
  unavailable: 'on a drive that is not connected',
});

const SEAL = Object.freeze({
  sealed: 'sealed',
  altered: 'CHANGED AFTER SEALING',
  unsealed: 'not sealed',
  legacy: 'from before sealing',
  incomplete: 'not finished',
});

async function report(svc) {
  return verifyJournal(await svc.journal.readRaw(), await svc.sealKey.publicKeys());
}

/** Whether `verify` found something, as the Restore Center counts it. */
function changed(r) {
  return r.counts.altered > 0 || r.missingCount > 0 || Boolean(r.oldestMissing) || r.duplicates.length > 0;
}

async function retention(svc) {
  return { retentionDays: (await svc.settings.load()).quarantine.retentionDays };
}

async function list(ctx) {
  const svc = ctx.services();
  const sessions = await restoreEngine.listSessions(svc.journal, { deps: await retention(svc) });
  const seals = await report(svc);
  const rows = sessions.map((s) => ({ ...s, startedAt: f.iso(s.startedAt), endedAt: f.iso(s.endedAt), seal: seals.sessions[s.id] ? seals.sessions[s.id].state : null }));
  ctx.out.document({ schema: 'cleandrive.journal-list/1', generatedAt: f.iso(ctx.now()), sessions: rows });
  if (rows.length === 0) ctx.out.line('The journal is empty: the app has not moved anything yet.');
  for (const s of rows) {
    ctx.out.line(`${s.id}  ${f.when(s.startedAt)}  ${s.kind.padEnd(10)} ${f.pad(f.count(s.count), 6)} item(s)  ${f.pad(f.bytes(s.bytes), 9)}  ${SOURCE[s.source] || s.source || ''}`);
    const back = s.restorable.count > 0 ? `${f.count(s.restorable.count)} can be put back` : 'nothing to put back';
    ctx.out.line(`            ${back}; ${SEAL[s.seal] || 'not checked'}${s.complete ? '' : '; did not finish'}`);
  }
  return EXIT.OK;
}

async function show(ctx, id) {
  if (!SESSION_ID.test(id)) throw new CliError(EXIT.USAGE, `"${id}" is not a session id. "cleandrive journal list" lists them.`);
  const svc = ctx.services();
  const deps = await retention(svc);
  const items = await restoreEngine.listItems(svc.journal, id, { deps });
  if (!items) throw new CliError(EXIT.USAGE, `No session ${id} in the journal. "cleandrive journal list" lists them.`);
  const session = (await restoreEngine.listSessions(svc.journal, { deps })).find((s) => s.id === id) || { id };
  ctx.out.document({
    schema: 'cleandrive.journal-show/1',
    generatedAt: f.iso(ctx.now()),
    session: { ...session, startedAt: f.iso(session.startedAt), endedAt: f.iso(session.endedAt) },
    items: items.map((i) => ({ ...i, trashedAt: f.iso(i.trashedAt) })),
  });
  ctx.out.line(`${id}  ${session.kind || ''}  ${f.when(session.startedAt)}  ${SOURCE[session.source] || session.source || ''}`);
  for (const i of items) {
    const extra = i.state === 'restored' ? (i.stillThere ? ', still there' : ', since moved or deleted') : i.existsAtOrigin ? ', and something else is at its old path now' : '';
    ctx.out.line(`  ${f.pad(f.bytes(i.size), 9)}  ${(STATE[i.state] || i.state).padEnd(33)}  ${i.path}${extra}`);
  }
  return EXIT.OK;
}

async function verify(ctx) {
  const svc = ctx.services();
  const r = await report(svc);
  // Asked of the services, which ask the licence; this file never does.
  const sealing = Boolean(svc.sealer);
  ctx.out.document({ ...r, sealing });

  const c = r.counts;
  ctx.out.line(`Journal: ${f.count(r.lines)} line(s) in ${f.files(r.files)}.`);
  if (c.altered > 0) ctx.out.line(`Changed after sealing: ${f.count(c.altered)} session(s).`);
  else if (c.sealed > 0) ctx.out.line(`Sealed: ${f.count(c.sealed)} session(s), none changed since.`);
  else ctx.out.line('No session has been sealed.');
  if (c.altered > 0 && c.sealed > 0) ctx.out.line(`Still as sealed: ${f.count(c.sealed)}.`);
  const unsealed = c.unsealed + c.legacy + c.incomplete;
  if (unsealed > 0) ctx.out.line(`Not sealed: ${f.count(unsealed)} (from before sealing: ${f.count(c.legacy)}; not finished: ${f.count(c.incomplete)}).`);
  if (r.missingCount > 0) ctx.out.line(`Sealed sessions no longer in the journal: ${f.count(r.missingCount)} (${r.missing.map((x) => (x.from === x.to ? `#${x.from}` : `#${x.from}-#${x.to}`)).join(', ')}).`);
  if (r.oldestMissing) ctx.out.line(`Older sealed sessions no longer in the journal, with no record of the app removing them: ${f.count(r.oldestMissing.count)}.`);
  if (r.duplicates.length > 0) ctx.out.line(`Two seals carry the same number: ${r.duplicates.map((n) => `#${n}`).join(', ')}.`);
  if (r.unreadable.length > 0) ctx.out.line(`Lines that could not be read: ${f.count(r.unreadable.length)}.`);
  for (const [id, s] of Object.entries(r.sessions)) {
    if (s.state !== 'altered') continue;
    for (const p of s.problems) ctx.out.line(`  ${id}: ${p.what} at ${p.file} line ${p.line}`);
  }
  if (!sealing) ctx.out.line('New sessions are not sealed: sealing the journal is part of CleanDrive Business. Sessions sealed before are still checked.');
  ctx.out.line('What this cannot see: the newest sessions removed whole, or the journal rewritten and re-signed by this computer\'s own user.');
  return changed(r) ? EXIT.ALTERED : EXIT.OK;
}

async function run(args, ctx) {
  if (args.sub === 'list') return list(ctx);
  if (args.sub === 'show') return show(ctx, args.positional[0]);
  return verify(ctx);
}

module.exports = { run, changed, SESSION_ID, SOURCE };
