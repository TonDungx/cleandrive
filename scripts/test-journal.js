#!/usr/bin/env node
'use strict';

// The Action Journal, the ledger that is now a view of it, and the import of
// the old ledger file.
//   node scripts/test-journal.js
//
// Two of these checks are measurements rather than assertions about code: that
// two processes appending to one file interleave whole lines, and that the old
// file-backed ledger really did lose a concurrent writer's entries.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { ActionJournal, monthOf } = require('../src/main/journal/journal');
const { TrashLedger } = require('../src/main/lib/ledger');
const { execute } = require('../src/main/actions/execute');
const { purgeRecorded, encodeMeta } = require('../src/main/lib/recyclebin');

const DAY = 24 * 60 * 60 * 1000;

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const fakeShell = () => ({ calls: [], async trashItem(p) { this.calls.push(p); } });

async function fixtureFiles(dir, n) {
  const files = [];
  for (let i = 0; i < n; i++) {
    const file = path.join(dir, `item-${i}.bin`);
    await fsp.writeFile(file, Buffer.alloc(10 * (i + 1)));
    files.push(file);
  }
  return files;
}

function appendInChild(file, tag, count) {
  // Each child is a separate process appending through the journal's own
  // method, so what is measured is what the window and the 02:00 run do.
  const script = `
    const { ActionJournal } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'main', 'journal', 'journal.js'))});
    const j = new ActionJournal(${JSON.stringify(path.dirname(file))});
    (async () => {
      const session = await j.begin('recycle', { count: ${count} }, { source: ${JSON.stringify(tag)} });
      for (let i = 0; i < ${count}; i++) {
        await j.record(session, { path: 'C:\\\\fixture\\\\${tag}\\\\' + i + '-' + 'x'.repeat(200) + '.bin', size: i });
      }
      await j.end(session, { done: ${count} });
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child ${tag} exited ${code}`))));
  });
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-journal-'));

  console.log('\njournal: a session, line by line\n');

  {
    const dir = path.join(root, 'basic');
    const journal = new ActionJournal(dir);
    const session = await journal.begin('recycle', { count: 2, bytes: 30, freesOnVolume: false, reversible: 'bin' }, { source: 'manual' });
    await journal.record(session, { path: path.join(dir, 'a.bin'), size: 10, trashedAt: Date.now(), mtimeMs: Date.now() - DAY });
    await journal.record(session, { path: path.join(dir, 'b.bin'), size: 20, trashedAt: Date.now() });
    await journal.end(session, { done: 2, movedBytes: 30, freedOnSource: 0 });

    const files = await journal.files();
    check('one file, named for the month', files.length === 1 && path.basename(files[0]) === `${monthOf(Date.now())}.jsonl`,
      files.map((f) => path.basename(f)).join(', '));

    const text = await fsp.readFile(files[0], 'utf8');
    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    check('four lines: begin, two items, end', lines.map((l) => l.op).join(',') === 'begin,item,item,end');
    check('every line carries a version, a time and its session',
      lines.every((l) => l.v === 1 && !Number.isNaN(Date.parse(l.t)) && l.session === session.id));
    check('the begin line says the bin frees nothing', lines[0].freesOnVolume === false && lines[0].reversible === 'bin');
    check('an item says where it came from and how big it was',
      lines[1].from === path.join(dir, 'a.bin') && lines[1].bytes === 10 && lines[1].to === null && lines[1].mtime);
    check('the end line keeps moved and freed apart', lines[3].movedBytes === 30 && lines[3].freedOnSource === 0);

    const sessions = await journal.sessions();
    check('read back as one complete session with its items',
      sessions.length === 1 && sessions[0].complete && sessions[0].items.length === 2 && sessions[0].kind === 'recycle');

    let threw = false;
    try {
      await journal.begin('shred', {});
    } catch {
      threw = true;
    }
    check('a kind that is not an action is refused', threw);
  }

  {
    const dir = path.join(root, 'torn');
    const journal = new ActionJournal(dir);
    const session = await journal.begin('recycle', { count: 1 });
    await journal.record(session, { path: path.join(dir, 'a.bin'), size: 1 });
    // The process died here: no end line. And somebody hand-edited the file.
    await fsp.appendFile(journal.fileFor(Date.now()), '{"v":1,"t":"2026-09-01T00:00:00Z","sess\n');

    const { lines, malformed } = await journal.read();
    check('a torn line is skipped and counted, not fatal', malformed === 1 && lines.length === 2);
    const sessions = await journal.sessions();
    check('a session with no end reads as incomplete', sessions.length === 1 && sessions[0].complete === false);
  }

  console.log('\njournal: two processes, one file\n');

  {
    const dir = path.join(root, 'concurrent');
    await fsp.mkdir(dir, { recursive: true });
    const file = new ActionJournal(dir).fileFor(Date.now());
    const started = Date.now();
    await Promise.all([appendInChild(file, 'window', 2000), appendInChild(file, 'scheduled', 2000)]);
    const tookMs = Date.now() - started;

    const { lines, malformed } = await new ActionJournal(dir).read();
    const items = lines.filter((l) => l.op === 'item');
    const bySource = new Map();
    const sessions = await new ActionJournal(dir).sessions();
    for (const s of sessions) bySource.set(s.source, s.items.length);

    check('every line from both writers parses', malformed === 0 && lines.length === 4004,
      `${lines.length} lines, ${malformed} malformed`);
    check('and neither lost any', bySource.get('window') === 2000 && bySource.get('scheduled') === 2000,
      `${bySource.get('window')} + ${bySource.get('scheduled')}`);
    const interleaved = items.some((l, i) => i > 0 && l.session !== items[i - 1].session);
    console.log(`    ${items.length} items from two processes in ${tookMs} ms; interleaved: ${interleaved}`);
  }

  console.log('\njournal: retention\n');

  {
    const dir = path.join(root, 'prune');
    await fsp.mkdir(dir, { recursive: true });
    for (const name of ['2024-01.jsonl', '2025-08.jsonl', '2025-09.jsonl', '2026-09.jsonl', 'notes.txt']) {
      await fsp.writeFile(path.join(dir, name), '');
    }
    const journal = new ActionJournal(dir, { now: () => Date.UTC(2026, 8, 24) });
    const removed = await journal.prune();
    const left = (await fsp.readdir(dir)).sort();
    check('whole month files older than thirteen months are dropped', removed === 2 &&
      JSON.stringify(left) === JSON.stringify(['2025-09.jsonl', '2026-09.jsonl', 'notes.txt']), left.join(', '));
  }

  console.log('\nledger: a view of the journal\n');

  {
    const dir = path.join(root, 'ledger');
    const files = await fixtureFiles(await fsp.mkdtemp(path.join(root, 'files-')), 4);
    const journal = new ActionJournal(path.join(dir, 'journal'));
    const ledger = new TrashLedger(path.join(dir, 'trash-ledger.json'), { journal });

    const shell = fakeShell();
    const result = await execute({ kind: 'recycle', items: files }, { deps: { shell }, journal, confirm: async () => true });
    check('a delete through the pipeline is recorded item by item', result.moved.length === 4 &&
      (await journal.sessions())[0].items.length === 4);

    await ledger.load();
    check('the ledger sees what the journal holds', ledger.entries.length === 4, String(ledger.entries.length));
    check('each at the moment it moved, not the moment the batch finished',
      ledger.entries.every((e) => Number.isFinite(e.trashedAt)) &&
        new Set(ledger.entries.map((e) => e.trashedAt)).size >= 1);

    await ledger.forget(ledger.entries.slice(0, 1), { freedBytes: 10 });
    const sessions = await journal.sessions();
    const purge = sessions.find((s) => s.kind === 'purge');
    check('a purge is itself recorded, with what it freed', purge && purge.items.length === 1 &&
      purge.end.freedOnSource === 10 && purge.items[0].recycledAt);

    const reread = new TrashLedger(path.join(dir, 'trash-ledger.json'), { journal: new ActionJournal(path.join(dir, 'journal')) });
    await reread.load();
    check('and the next load leaves the purged item out', reread.entries.length === 3, String(reread.entries.length));
    check('the ledger in journal mode writes no file of its own',
      !(await fsp.stat(path.join(dir, 'trash-ledger.json')).catch(() => null)));
  }

  console.log('\nledger: the bug the journal fixes\n');

  {
    // The old file-backed ledger, as the window used it: loaded once at
    // launch, then written back whole on the next delete.
    const file = path.join(root, 'old-ledger.json');
    const window = new TrashLedger(file);
    await window.load();
    const scheduled = new TrashLedger(file);
    await scheduled.load();
    await scheduled.record([{ path: 'C:\\x\\overnight.tmp', size: 1 }], { runId: 'run-0200' });
    await window.record([{ path: 'C:\\x\\morning.tmp', size: 1 }], { runId: 'manual' });
    const after = new TrashLedger(file);
    await after.load();
    check('measured: the file ledger loses the 02:00 run’s entry to a window left open',
      after.entries.length === 1 && after.entries[0].runId === 'manual', after.entries.map((e) => e.runId).join(', '));

    const dir = path.join(root, 'fixed');
    const windowJ = new TrashLedger(path.join(dir, 'l.json'), { journal: new ActionJournal(path.join(dir, 'journal')) });
    await windowJ.load();
    const scheduledJ = new TrashLedger(path.join(dir, 'l.json'), { journal: new ActionJournal(path.join(dir, 'journal')) });
    await scheduledJ.load();
    await scheduledJ.record([{ path: 'C:\\x\\overnight.tmp', size: 1 }], { runId: 'run-0200' });
    await windowJ.record([{ path: 'C:\\x\\morning.tmp', size: 1 }], { runId: 'manual' });
    const afterJ = new TrashLedger(path.join(dir, 'l.json'), { journal: new ActionJournal(path.join(dir, 'journal')) });
    await afterJ.load();
    check('the journal keeps both', afterJ.entries.length === 2, afterJ.entries.map((e) => e.runId).join(', '));
  }

  console.log('\nledger: importing the old file, once\n');

  {
    const dir = path.join(root, 'import');
    await fsp.mkdir(dir, { recursive: true });
    const legacy = path.join(dir, 'trash-ledger.json');
    const now = Date.now();
    await fsp.writeFile(legacy, JSON.stringify({
      version: 1,
      entries: [
        { path: 'C:\\x\\a.tmp', size: 1, trashedAt: now - 3 * DAY, runId: 'manual' },
        { path: 'C:\\x\\b.tmp', size: 2, trashedAt: now - 2 * DAY, runId: 'run-1' },
        { path: 'C:\\x\\c.tmp', size: 3, trashedAt: now - 1 * DAY, runId: 'run-1' },
      ],
    }));

    // The window and the scheduled run start at the same moment.
    const a = new TrashLedger(legacy, { journal: new ActionJournal(path.join(dir, 'journal')) });
    const b = new TrashLedger(legacy, { journal: new ActionJournal(path.join(dir, 'journal')) });
    await Promise.all([a.load(), b.load()]);

    const fresh = new TrashLedger(legacy, { journal: new ActionJournal(path.join(dir, 'journal')) });
    await fresh.load();
    check('every old entry arrives in the journal', fresh.entries.length === 3, String(fresh.entries.length));
    check('exactly once, even when two loads start at the same moment',
      (await new ActionJournal(path.join(dir, 'journal')).sessions()).filter((s) => s.source === 'migrated').length === 1);
    check('with the times they were recycled, which the purge matches on',
      fresh.entries.map((e) => e.trashedAt).sort().join() === [now - 3 * DAY, now - 2 * DAY, now - DAY].join());
    check('the old file is kept as .migrated, not deleted',
      Boolean(await fsp.stat(`${legacy}.migrated`).catch(() => null)) && !(await fsp.stat(legacy).catch(() => null)));

    // A failed import puts the file back.
    const dir2 = path.join(root, 'import-fails');
    await fsp.mkdir(dir2, { recursive: true });
    const legacy2 = path.join(dir2, 'trash-ledger.json');
    await fsp.writeFile(legacy2, JSON.stringify({ version: 1, entries: [{ path: 'C:\\x\\a.tmp', size: 1, trashedAt: now }] }));
    const broken = new ActionJournal(path.join(dir2, 'journal'));
    broken.appendSession = async () => { throw new Error('disk full'); };
    let threw = null;
    try {
      await new TrashLedger(legacy2, { journal: broken }).load();
    } catch (err) {
      threw = err;
    }
    check('an import that cannot be written leaves the old file where it was',
      threw && Boolean(await fsp.stat(legacy2).catch(() => null)));
  }

  console.log('\nledger: from the attacker’s side\n');

  if (process.platform !== 'win32') {
    console.log('  (skipped: the purge is Windows-only)');
  } else {
    const dir = path.join(root, 'attack');
    const bin = path.join(dir, '$Recycle.Bin', 'S-1-5-21-test');
    await fsp.mkdir(bin, { recursive: true });
    const precious = 'C:\\Users\\me\\thesis.docx';
    const long = Date.now() - 30 * DAY;

    // A real bin item for some other file, recycled by the user.
    await fsp.writeFile(path.join(bin, '$RUSER01.docx'), 'user data');
    await fsp.writeFile(path.join(bin, '$IUSER01.docx'), encodeMeta({ originalPath: 'C:\\Users\\me\\other.docx', size: 9, deletedAt: long }));
    // The same path the journal is about to claim, but recycled at another time.
    await fsp.writeFile(path.join(bin, '$RUSER02.docx'), 'user data');
    await fsp.writeFile(path.join(bin, '$IUSER02.docx'), encodeMeta({ originalPath: precious, size: 9, deletedAt: long - 3 * DAY }));

    // A hand-written journal line claiming the thesis was ours.
    const journal = new ActionJournal(path.join(dir, 'journal'));
    await journal.appendSession('recycle', [{ path: precious, size: 9, trashedAt: long }], { source: 'manual' });
    const ledger = new TrashLedger(path.join(dir, 'l.json'), { journal });
    await ledger.load();

    const result = await purgeRecorded({ entries: ledger.expired(7), binDirs: [bin], afterDays: 7 });
    check('a forged journal line purges nothing the bin does not corroborate', result.purged.length === 0,
      `${result.purged.length} purged of ${result.examined} examined`);
    check('both of the user’s own items are still there',
      Boolean(await fsp.stat(path.join(bin, '$RUSER01.docx')).catch(() => null)) &&
        Boolean(await fsp.stat(path.join(bin, '$RUSER02.docx')).catch(() => null)));
  }

  await fsp.rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
