#!/usr/bin/env node
'use strict';

// The Restore Center's engine, against a Recycle Bin built by hand.
//
//   node scripts/test-restore.js
//
// Written the way the purge's tests are: each case asks what would have to be
// true for a restore to lose somebody's file, and then makes it true. A file
// already at the original path, a folder turned into a junction, a journal
// edited by hand, a `$I` with no `$R`, a drive that is not connected, and the
// trap the ledger used to leave -- a file put back and then deleted again
// inside the purge's five-minute tolerance.
//
// Nothing here touches the real Recycle Bin; `scripts/verify-restore.js` does
// that, with throwaway files.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { encodeMeta, listItems, matchRecorded, putBack, TIME_TOLERANCE_MS } = require('../src/main/lib/recyclebin');
const { ActionJournal } = require('../src/main/journal/journal');
const { TrashLedger } = require('../src/main/lib/ledger');
const { execute } = require('../src/main/actions/execute');
const restore = require('../src/main/actions/restore');
const { CancelToken } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const MIN = 60 * 1000;
const exists = (p) => fsp.lstat(p).then(() => true, () => false);
const read = (p) => fsp.readFile(p, 'utf8').catch(() => null);

let counter = 0;
/** A `$I`/`$R` pair laid out the way Windows lays one out. */
async function binItem(bin, originalPath, { deletedAt, body, dataToo = true }) {
  const id = `T${String(++counter).padStart(5, '0')}`;
  const ext = path.extname(originalPath);
  const metaPath = path.join(bin, `$I${id}${ext}`);
  const dataPath = path.join(bin, `$R${id}${ext}`);
  const content = body || `${path.basename(originalPath)} ${crypto.randomBytes(8).toString('hex')}\n`;
  await fsp.writeFile(metaPath, encodeMeta({ originalPath, size: Buffer.byteLength(content), deletedAt }));
  if (dataToo) await fsp.writeFile(dataPath, content);
  return { metaPath, dataPath, content };
}

/** A drive letter with nothing behind it, for "the drive is not connected". */
function absentDrive() {
  for (const letter of 'QRSTUVWXYZ') {
    if (!fs.existsSync(`${letter}:\\`)) return `${letter}:\\`;
  }
  return null;
}

/** What `shell.trashItem` does, for a harness: move the file somewhere we can see. */
function fakeShell(into) {
  const calls = [];
  return {
    calls,
    async trashItem(p) {
      calls.push(p);
      await fsp.rename(p, path.join(into, `${calls.length}-${path.basename(p)}`));
    },
  };
}

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-restore-'));
  const bin = path.join(dir, 'bin');
  const src = path.join(dir, 'src');
  const elsewhere = path.join(dir, 'elsewhere');
  await Promise.all([bin, src, elsewhere].map((d) => fsp.mkdir(d, { recursive: true })));
  const P = (name) => path.join(src, name);

  /* ---------------------------------------------------------------------- */
  console.log('\nrestore: which bin item is which\n');
  {
    const t0 = Date.now() - 60 * MIN;
    const items = [
      { originalPath: P('twice.txt'), deletedAt: t0 },
      { originalPath: P('twice.txt'), deletedAt: t0 + 3 * MIN },
      { originalPath: P('other.txt'), deletedAt: t0 },
    ];
    const a = { path: P('twice.txt'), trashedAt: t0 + 3 * MIN + 20 };
    const b = { path: P('twice.txt'), trashedAt: t0 + 30 };
    const far = { path: P('other.txt'), trashedAt: t0 + TIME_TOLERANCE_MS + 1 };
    const matched = matchRecorded([a, b, far], items);
    check('two records at one path each get the bin item nearest in time',
      matched.get(a) === items[1] && matched.get(b) === items[0]);
    check('one bin item is never claimed by two records', new Set(matched.values()).size === matched.size);
    check('a record further off than the tolerance matches nothing', !matched.has(far));
  }

  /* ---------------------------------------------------------------------- */
  console.log('\nrestore: putting one file back\n');
  {
    const when = Date.now() - 30 * MIN;
    const target = P('back.txt');
    const pair = await binItem(bin, target, { deletedAt: when });
    const old = new Date(Date.now() - 40 * 24 * 60 * MIN);
    await fsp.utimes(pair.dataPath, old, old);
    const [item] = (await listItems([bin])).filter((i) => i.dataPath === pair.dataPath);

    const out = await putBack(item, target);
    check('a file comes back to its path', out.ok && (await read(target)) === pair.content, JSON.stringify(out));
    check('with the time it was last modified', Math.abs((await fsp.stat(target)).mtimeMs - old.getTime()) < 2000);
    check('and both halves leave the bin', !(await exists(pair.dataPath)) && !(await exists(pair.metaPath)));
    check('by hard link, not by rename', out.via === 'link', out.via);

    const deep = path.join(src, 'gone', 'folder', 'deep.txt');
    const pair2 = await binItem(bin, deep, { deletedAt: when });
    const [item2] = (await listItems([bin])).filter((i) => i.dataPath === pair2.dataPath);
    const out2 = await putBack(item2, deep);
    check('a folder that has gone since is made again, as Explorer does', out2.ok && (await read(deep)) === pair2.content);

    const inTheWay = P('taken.txt');
    const pair3 = await binItem(bin, inTheWay, { deletedAt: when });
    await fsp.writeFile(inTheWay, 'somebody made a new one\n');
    const [item3] = (await listItems([bin])).filter((i) => i.dataPath === pair3.dataPath);
    const out3 = await putBack(item3, inTheWay);
    check('a file already at the path is never overwritten', out3.code === 'EEXIST' &&
      (await read(inTheWay)) === 'somebody made a new one\n', JSON.stringify(out3));
    check('and the recycled one stays in the bin', await exists(pair3.dataPath));

    const pair4 = await binItem(bin, P('halfgone.txt'), { deletedAt: when, dataToo: false });
    const [item4] = (await listItems([bin])).filter((i) => i.metaPath === pair4.metaPath);
    const out4 = await putBack(item4, P('halfgone.txt'));
    check('a `$I` with no `$R` beside it restores nothing', !out4.ok && !(await exists(P('halfgone.txt'))), out4.code);
    await fsp.rm(pair3.dataPath, { force: true });
    await fsp.rm(pair3.metaPath, { force: true });
    await fsp.rm(pair4.metaPath, { force: true });
  }

  /* ---------------------------------------------------------------------- */
  console.log('\nrestore: where everything is now\n');

  const journal = new ActionJournal(path.join(dir, 'journal'));
  const t = Date.now() - 20 * MIN;
  const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt'];
  const pairs = {};
  for (const name of names.slice(0, 4)) pairs[name] = await binItem(bin, P(name), { deletedAt: t + 10 });
  // e.txt: only the metadata half is left. f.txt: nothing at all -- emptied.
  pairs['e.txt'] = await binItem(bin, P('e.txt'), { deletedAt: t + 10, dataToo: false });
  await fsp.writeFile(P('f.txt'), 'put back by hand in Explorer\n');
  const drive = absentDrive();
  const offline = drive ? path.join(drive, 'USB', 'z.txt') : null;
  const recycled = await journal.appendSession(
    'recycle',
    [...names, ...(offline ? ['OFFLINE'] : [])].map((name) => ({
      path: name === 'OFFLINE' ? offline : P(name),
      size: 30,
      trashedAt: t,
    })),
    { source: 'manual', runId: 'manual', startedAt: t }
  );
  // The app purged d.txt already.
  await fsp.rm(pairs['d.txt'].dataPath, { force: true });
  await fsp.rm(pairs['d.txt'].metaPath, { force: true });
  await journal.appendSession('purge', [{ path: P('d.txt'), size: 30, recycledAt: t }], { source: 'purge' });

  const deps = { journal, binDirs: [bin] };
  const id = (name) => `${recycled.id}:${names.indexOf(name)}`;
  {
    const items = await restore.listItems(journal, recycled.id, { deps });
    const state = Object.fromEntries(items.map((i) => [path.basename(i.path), i]));
    check('an item whose pair is in the bin at the recorded time is restorable',
      ['a.txt', 'b.txt', 'c.txt'].every((n) => state[n].state === 'inBin'));
    check('an item the app purged says so', state['d.txt'].state === 'purged');
    check('a `$I` whose data is gone is not called restorable', state['e.txt'].state === 'gone', state['e.txt'].state);
    check('an item emptied out of the bin is gone, and a file at its path is noticed',
      state['f.txt'].state === 'gone' && state['f.txt'].existsAtOrigin === true);
    if (offline) {
      check('an item on a drive that is not connected is unavailable, not gone', state['z.txt'].state === 'unavailable',
        state['z.txt'] && state['z.txt'].state);
    }
    const [summary] = (await restore.listSessions(journal, { deps })).filter((s) => s.id === recycled.id);
    check('the session tallies every state', summary && summary.tally.inBin === 3 && summary.tally.purged === 1 &&
      summary.tally.gone === 2 && summary.restorable.count === 3, JSON.stringify(summary && summary.tally));
    check('the purge is listed as a session, and cannot be undone',
      (await restore.listSessions(journal, { deps })).some((s) => s.kind === 'purge' && s.undoable === false));
  }

  /* ---------------------------------------------------------------------- */
  console.log('\nrestore: through the pipeline\n');
  {
    let asked = null;
    const result = await execute(
      { kind: 'restore', items: [id('a.txt'), id('d.txt'), id('f.txt'), 's_00000000:3'] },
      { journal, deps, confirm: async (description) => { asked = description; return { approved: true, options: { onConflict: 'skip' } }; } }
    );
    check('the confirmation is told how many can go back, and how many cannot',
      asked && asked.count === 1 && asked.refused === 3 && asked.freesOnVolume === false, JSON.stringify(asked));
    check('the one that can is back', result.moved.length === 1 && (await read(P('a.txt'))) === pairs['a.txt'].content);
    check('an id the journal never wrote is refused', result.failed.some((f) => f.code === 'EUNKNOWN'));
    check('a purged item is refused with the reason', result.failed.some((f) => f.code === 'purged'));

    const sessions = await journal.sessions();
    const session = sessions.find((s) => s.kind === 'restore');
    check('the restore is a session in the journal, with the item and where it went',
      session && session.items.length === 1 && session.items[0].to === P('a.txt') &&
        Date.parse(session.items[0].recycledAt) === t);
    const after = await restore.listItems(journal, recycled.id, { deps });
    const a = after.find((i) => path.basename(i.path) === 'a.txt');
    check('and the Restore Center then calls it restored, and still there', a.state === 'restored' && a.stillThere === true);
  }

  {
    // b.txt: a new file of the same name has appeared since.
    await fsp.writeFile(P('b.txt'), 'a new b\n');
    const skip = await execute({ kind: 'restore', items: [id('b.txt')] }, { journal, deps, confirm: async () => ({ approved: true, options: { onConflict: 'skip' } }) });
    check('told to skip, a file in the way is left alone and nothing is restored',
      skip.moved.length === 0 && (await read(P('b.txt'))) === 'a new b\n' && (await exists(pairs['b.txt'].dataPath)));

    const keep = await execute({ kind: 'restore', items: [id('b.txt')] }, { journal, deps, confirm: async () => ({ approved: true, options: { onConflict: 'rename' } }) });
    const renamed = restore.renamed(P('b.txt'), 1);
    check('told to keep both, the restored one comes back under a new name',
      keep.moved.length === 1 && keep.moved[0].to === renamed && (await read(renamed)) === pairs['b.txt'].content &&
        (await read(P('b.txt'))) === 'a new b\n', keep.moved[0] && keep.moved[0].to);
    check('named "(restored)" beside the original', path.basename(renamed) === 'b (restored).txt', path.basename(renamed));
  }

  {
    // c.txt, with replace: the file in the way goes to the bin first, and is
    // itself recorded so it can be put back.
    await fsp.writeFile(P('c.txt'), 'a new c\n');
    const shellBin = path.join(dir, 'fake-shell-bin');
    await fsp.mkdir(shellBin);
    const shell = fakeShell(shellBin);
    const out = await execute({ kind: 'restore', items: [id('c.txt')] },
      { journal, deps: { ...deps, shell }, confirm: async () => ({ approved: true, options: { onConflict: 'replace' } }) });
    check('told to replace, the file in the way goes to the Recycle Bin, not away',
      shell.calls.length === 1 && (await read(path.join(shellBin, '1-c.txt'))) === 'a new c\n');
    check('and the restored one takes its place', out.moved.length === 1 && (await read(P('c.txt'))) === pairs['c.txt'].content);
    const displaced = (await journal.sessions()).find((s) => s.kind === 'recycle' && s.source === 'restore');
    check('the displaced file is recorded as a recycle session of its own',
      displaced && displaced.items.length === 1 && displaced.items[0].from === P('c.txt') && displaced.end.done === 1);
  }

  {
    // Nobody said what to do about the file in the way: nothing is overwritten
    // and nothing is renamed. (That the window cannot say "replace" on its own
    // is the IPC handler's rule, and smoke.js checks it against the real app.)
    await fsp.writeFile(P('b.txt'), 'b again\n');
    const b2 = await binItem(bin, P('b.txt'), { deletedAt: Date.now() - 5 * MIN + 10 });
    const s2 = await journal.appendSession('recycle', [{ path: P('b.txt'), size: 10, trashedAt: Date.now() - 5 * MIN }], { source: 'manual' });
    const out = await execute({ kind: 'restore', items: [`${s2.id}:0`] }, { journal, deps });
    check('with no answer about a file in the way, it is skipped',
      out.moved.length === 0 && (await read(P('b.txt'))) === 'b again\n' && (await exists(b2.dataPath)),
      JSON.stringify(out.failed));
  }

  /* ---------------------------------------------------------------------- */
  console.log('\nrestore: places it will not write\n');
  {
    const jdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-restore-j-'));
    const j = new ActionJournal(jdir);
    const winTarget = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cleandrive-restore-test.dll');
    await binItem(bin, winTarget, { deletedAt: t + 5 });

    // A folder that was ordinary when the file left, and is a junction into
    // Windows now.
    const junction = path.join(src, 'was-a-folder');
    let junctionMade = false;
    try {
      await fsp.symlink(path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp'), junction, 'junction');
      junctionMade = true;
    } catch {
      junctionMade = false;
    }
    const viaJunction = path.join(junction, 'cleandrive-restore-test.txt');
    if (junctionMade) await binItem(bin, viaJunction, { deletedAt: t + 5 });

    const s = await j.appendSession('recycle', [
      { path: winTarget, size: 1, trashedAt: t },
      ...(junctionMade ? [{ path: viaJunction, size: 1, trashedAt: t }] : []),
    ], { source: 'manual' });
    const out = await execute({ kind: 'restore', items: [`${s.id}:0`, `${s.id}:1`] },
      { journal: j, deps: { journal: j, binDirs: [bin] }, confirm: async () => true });
    check('a journal that names a file in Windows restores nothing there (hand-edited, or not)',
      out.moved.length === 0 && !(await exists(winTarget)) && out.failed.some((f) => f.code === 'EREFUSED'));
    if (junctionMade) {
      check('a folder swapped for a junction into Windows is followed and refused',
        !(await exists(viaJunction)) && out.failed.filter((f) => f.code === 'EREFUSED').length === 2);
      await fsp.rm(junction, { force: true, recursive: false }).catch(() => fsp.rmdir(junction));
    } else {
      check('a junction could be made for the swap test', false, 'fs.symlink junction failed');
    }
    await fsp.rm(jdir, { recursive: true, force: true });
  }

  /* ---------------------------------------------------------------------- */
  console.log('\nrestore: the purge never takes back what was put back\n');
  {
    const jdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-restore-l-'));
    const j = new ActionJournal(jdir);
    const ledger = new TrashLedger(path.join(jdir, 'no-ledger.json'), { journal: j });
    const at = Date.now() - 2 * 24 * 60 * MIN;
    const target = P('trap.txt');
    const first = await binItem(bin, target, { deletedAt: at + 20 });
    const s = await j.appendSession('recycle', [{ path: target, size: 5, trashedAt: at }], { source: 'manual' });
    await ledger.load();
    check('before: the ledger claims the item', ledger.entries.length === 1);

    await execute({ kind: 'restore', items: [`${s.id}:0`] }, { journal: j, deps: { journal: j, binDirs: [bin] }, confirm: async () => true });
    // Then the user deletes it themselves, two minutes after the app first did.
    const theirs = await binItem(bin, target, { deletedAt: at + 2 * MIN, body: 'their own delete\n' });
    await fsp.rm(target, { force: true });
    await ledger.load();
    check('after putting it back, the ledger no longer claims it', ledger.entries.length === 0, String(ledger.entries.length));
    const { purgeRecorded } = require('../src/main/lib/recyclebin');
    const purge = await purgeRecorded({ entries: ledger.entries, binDirs: [bin], afterDays: 0, force: true });
    check('so a purge leaves the user\'s own delete in the bin, though it is inside the tolerance',
      purge.purged.length === 0 && (await exists(theirs.dataPath)), `${purge.purged.length} purged`);
    await fsp.rm(first.metaPath, { force: true });
    await fsp.rm(jdir, { recursive: true, force: true });
  }

  /* ---------------------------------------------------------------------- */
  console.log('\nrestore: stopping, and a record that cannot be written\n');
  {
    const jdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-restore-s-'));
    const j = new ActionJournal(jdir);
    const when = Date.now() - 10 * MIN;
    const many = [];
    for (let i = 0; i < 5; i++) {
      const target = P(`many-${i}.txt`);
      await binItem(bin, target, { deletedAt: when + 5 });
      many.push({ path: target, size: 3, trashedAt: when });
    }
    const s = await j.appendSession('recycle', many, { source: 'manual' });
    const ids = many.map((_, i) => `${s.id}:${i}`);

    // Stop pressed while the second file is being recorded.
    const token = new CancelToken();
    let recorded = 0;
    const stopping = {
      begin: (...args) => j.begin(...args),
      record: async (session, rec) => {
        await j.record(session, rec);
        recorded += 1;
        if (recorded === 2) token.cancel();
      },
      end: (...args) => j.end(...args),
    };
    const stopped = await execute({ kind: 'restore', items: ids }, {
      journal: stopping,
      token,
      deps: { journal: j, binDirs: [bin] },
      confirm: async () => true,
    });
    const back = await Promise.all(many.map((m) => exists(m.path)));
    check('Stop leaves what was put back in place and the rest in the bin',
      stopped.cancelled && stopped.moved.length === 2 && stopped.remaining === 3 && back.filter(Boolean).length === 2,
      `${stopped.moved.length} moved, ${stopped.remaining} left`);

    const failing = {
      begin: (...args) => j.begin(...args),
      record: async () => { throw new Error('disk full'); },
      end: (...args) => j.end(...args),
    };
    const rest = ids.slice(stopped.moved.length);
    const broken = await execute({ kind: 'restore', items: rest }, { journal: failing, deps: { journal: j, binDirs: [bin] }, confirm: async () => true });
    check('a record that cannot be written stops the batch after one item', broken.moved.length === 1 && broken.recordError === 'disk full',
      `${broken.moved.length} moved, error ${broken.recordError}`);
    await fsp.rm(jdir, { recursive: true, force: true });
  }

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
