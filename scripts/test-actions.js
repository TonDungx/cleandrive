#!/usr/bin/env node
'use strict';

// The action pipeline: plan -> describe -> confirm -> journal -> apply.
//   node scripts/test-actions.js
//
// Runs the real vetting and permission probe over temporary files, with a fake
// Recycle Bin so nothing leaves the fixture. What is being proved is the
// order of things -- nothing moves before the confirmation, nothing is
// reported before it is recorded -- and that a kind with no handler is
// refused rather than approximated.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { execute, handlerFor } = require('../src/main/actions/execute');
const { ACTION_KINDS } = require('../src/main/analyzers/contract');
const { CancelToken } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/** A Recycle Bin that remembers what it was handed and moves nothing. */
function fakeShell({ failOn = null, onTrash = null } = {}) {
  const calls = [];
  return {
    calls,
    trashItem: async (p) => {
      if (onTrash) onTrash(p, calls.length);
      if (failOn && p.endsWith(failOn)) throw new Error('the shell said no');
      calls.push(p);
    },
  };
}

/** A journal that records the order it was called in. */
function fakeJournal(log, { failAt = -1 } = {}) {
  let items = 0;
  return {
    begin: async (kind, description, meta) => {
      log.push({ op: 'begin', kind, description, meta });
      return { id: 's_test' };
    },
    record: async (session, item) => {
      if (items === failAt) throw new Error('disk full');
      items += 1;
      log.push({ op: 'item', path: item.path, size: item.size, trashedAt: item.trashedAt });
    },
    end: async (session, result) => {
      log.push({ op: 'end', result });
    },
  };
}

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-actions-'));
  const files = [];
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, `f${i}.bin`);
    await fsp.writeFile(file, Buffer.alloc(100 * (i + 1)));
    files.push(file);
  }
  await fsp.mkdir(path.join(dir, 'a-folder'));

  console.log('\nactions: what can run\n');

  check('only the Recycle Bin has a handler in this phase',
    ACTION_KINDS.filter((k) => handlerFor(k)).join(',') === 'recycle');

  {
    const shell = fakeShell();
    const result = await execute({ kind: 'quarantine', items: files }, { deps: { shell } });
    check('a kind with no handler is refused, not approximated',
      result.refused === 'unsupported' && shell.calls.length === 0);
  }

  {
    const shell = fakeShell();
    const result = await execute({ kind: 'recycle', items: files }, { can: () => false, deps: { shell } });
    check('a kind the licence does not cover is refused as locked',
      result.refused === 'locked' && result.feature === 'free' && shell.calls.length === 0);
  }

  {
    const shell = fakeShell();
    const result = await execute({ kind: 'recycle', items: [] }, { deps: { shell } });
    check('an empty request moves nothing and says so', result.requested === 0 && result.moved.length === 0);
  }

  console.log('\nactions: nothing moves before the answer\n');

  {
    const shell = fakeShell();
    const log = [];
    const result = await execute(
      { kind: 'recycle', items: files, options: { dryRun: true } },
      { deps: { shell }, journal: fakeJournal(log), confirm: async () => { throw new Error('no dialog for a dry run'); } }
    );
    check('a dry run reports what would go', result.dryRun === true && result.moved.length === 6);
    check('and moves nothing, asks nothing, records nothing', shell.calls.length === 0 && log.length === 0);
  }

  {
    const shell = fakeShell();
    const log = [];
    let asked = null;
    const result = await execute(
      { kind: 'recycle', items: files },
      {
        deps: { shell },
        journal: fakeJournal(log),
        confirm: async (description) => {
          asked = description;
          return false;
        },
      }
    );
    check('the confirmation is shown the real numbers',
      asked && asked.count === 6 && asked.bytes === 2100, asked && `${asked.count} / ${asked.bytes}`);
    check('and is told the Recycle Bin frees nothing', asked && asked.freesOnVolume === false && asked.reversible === 'bin');
    check('saying no moves nothing and records nothing',
      result.cancelled === true && shell.calls.length === 0 && log.length === 0);
  }

  console.log('\nactions: recorded before it is reported\n');

  {
    const events = [];
    const log = [];
    const shell = fakeShell({ onTrash: (p) => events.push(`trash ${path.basename(p)}`) });
    const journal = fakeJournal(log);
    const wrapped = {
      ...journal,
      record: async (session, item) => {
        events.push(`record ${path.basename(item.path)}`);
        return journal.record(session, item);
      },
    };
    const result = await execute(
      { kind: 'recycle', items: files },
      {
        deps: { shell },
        journal: wrapped,
        source: 'manual',
        confirm: async () => true,
        onProgress: (p) => {
          if (p.phase === 'deleting' && p.currentPath) events.push(`report ${path.basename(p.currentPath)}`);
        },
      }
    );

    check('every item moved', result.moved.length === 6 && shell.calls.length === 6);
    check('the session is opened before the first item and closed after the last',
      log[0].op === 'begin' && log[log.length - 1].op === 'end' && log.filter((e) => e.op === 'item').length === 6);
    check('it is opened with where the request came from', log[0].meta.source === 'manual');

    // Each item: trashed, then recorded, then (maybe -- progress is throttled) reported.
    let ordered = true;
    for (const name of files.map((f) => path.basename(f))) {
      const t = events.indexOf(`trash ${name}`);
      const r = events.indexOf(`record ${name}`);
      const p = events.indexOf(`report ${name}`);
      if (!(t !== -1 && r > t && (p === -1 || p > r))) ordered = false;
    }
    check('no item is reported before it is recorded', ordered, events.slice(0, 6).join(', '));
    check('each record carries the size and when it moved',
      log.filter((e) => e.op === 'item').every((e) => e.size > 0 && Number.isFinite(e.trashedAt)));

    check('moved and freed are two figures, and the bin frees nothing',
      result.movedBytes === 2100 && result.freedBytes === 0 && result.freesOnVolume === false,
      `moved ${result.movedBytes}, freed ${result.freedBytes}`);
    const end = log[log.length - 1].result;
    check('the closing record says the same', end.movedBytes === 2100 && end.freedOnSource === 0 && end.done === 6);
  }

  console.log('\nactions: what is refused, and what goes wrong half way\n');

  {
    const shell = fakeShell();
    const system = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'notepad.exe') : '/bin/sh';
    const result = await execute(
      { kind: 'recycle', items: [files[0], system, path.join(dir, 'a-folder'), path.join(dir, 'gone.bin')] },
      { deps: { shell }, confirm: async () => true }
    );
    check('a system file is refused before the shell sees it', !shell.calls.includes(system) &&
      result.failed.some((f) => f.path === system && /system/.test(f.error)));
    check('so is a folder -- this action never takes one',
      result.failed.some((f) => /folder/.test(f.error)));
    check('so is a file that is no longer there', result.failed.some((f) => /no longer exists/.test(f.error)));
    check('and the rest still goes', result.moved.length === 1);
  }

  {
    const log = [];
    const shell = fakeShell();
    const result = await execute(
      { kind: 'recycle', items: files },
      { deps: { shell }, journal: fakeJournal(log, { failAt: 2 }), confirm: async () => true }
    );
    check('when the record cannot be written, the batch stops',
      shell.calls.length === 3 && result.moved.length === 3 && result.remaining === 3,
      `${shell.calls.length} moved, ${result.remaining} left`);
    check('and says why', /disk full/.test(result.recordError || ''), result.recordError);
    check('and the session is still closed, with the error', log[log.length - 1].op === 'end' &&
      /disk full/.test(log[log.length - 1].result.error || ''));
  }

  {
    const log = [];
    const token = new CancelToken();
    const shell = fakeShell({ onTrash: (p, n) => { if (n === 2) token.cancel(); } });
    const result = await execute(
      { kind: 'recycle', items: files },
      { token, deps: { shell }, journal: fakeJournal(log), confirm: async () => true }
    );
    check('stopping half way keeps what already moved', result.cancelled === true && result.moved.length === 3,
      `${result.moved.length} moved`);
    check('and the record says it was stopped', log[log.length - 1].result.cancelled === true &&
      log.filter((e) => e.op === 'item').length === 3);
  }

  {
    const log = [];
    const shell = fakeShell({ failOn: 'f1.bin' });
    const result = await execute(
      { kind: 'recycle', items: files },
      { deps: { shell }, journal: fakeJournal(log), confirm: async () => true }
    );
    check('one item the shell refuses does not stop the batch', result.moved.length === 5 && result.failed.length === 1);
    check('and is not recorded as moved', !log.some((e) => e.op === 'item' && e.path.endsWith('f1.bin')));
  }

  {
    const log = [];
    let threw = null;
    try {
      await execute(
        { kind: 'recycle', items: files },
        {
          deps: { executeTrash: async () => { throw new Error('boom'); } },
          journal: fakeJournal(log),
          confirm: async () => true,
        }
      );
    } catch (err) {
      threw = err;
    }
    check('an apply that throws still closes its session', threw && log[log.length - 1].op === 'end' &&
      log[log.length - 1].result.error === 'apply threw');
  }

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
