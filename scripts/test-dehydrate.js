#!/usr/bin/env node
'use strict';

// OneDrive "free up space" (B3): which files it offers, what it refuses, and
// what it counts as freed.
//
//   node scripts/test-dehydrate.js
//
// OneDrive itself is stood in for -- what Windows says about each file, whether
// OneDrive is running, what `attrib` does, and what a file takes on the disk
// afterwards -- so every refusal and every race can be staged. The files, the
// pipeline, the journal and the analyzer are the real ones. One check at the
// end asks the real Windows about a plain temporary file, reading only.
//
// Nothing here touches a real OneDrive; `verify-dehydrate.js` does, and only
// when asked.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const cloudState = require('../src/main/lib/cloud-state');
const cloud = require('../src/main/lib/media/cloud');
const handler = require('../src/main/actions/dehydrate');
const { execute } = require('../src/main/actions/execute');
const { ActionJournal } = require('../src/main/journal/journal');
const restore = require('../src/main/actions/restore');
const { cloudFindings } = require('../src/main/analyzers/scan');
const { validateCandidate } = require('../src/main/analyzers/contract');
const analyzers = require('../src/main/analyzers');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const MB = 1024 * 1024;
const { STATE, ATTR } = cloudState;
const S = {
  inSync: cloudState.describe(0x20 | ATTR.REPARSE_POINT, STATE.PLACEHOLDER | STATE.IN_SYNC),
  pinned: cloudState.describe(0x20 | ATTR.REPARSE_POINT | ATTR.PINNED, STATE.PLACEHOLDER | STATE.IN_SYNC),
  notSynced: cloudState.describe(0x20, 0),
  pending: cloudState.describe(0x20 | ATTR.REPARSE_POINT, STATE.PLACEHOLDER),
  onlineOnly: cloudState.describe(0x401620, 0x39),
};

async function make(file, bytes) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const handle = await fsp.open(file, 'w');
  await handle.truncate(bytes);
  await handle.close();
}

/** A stand-in OneDrive: states by path, running or not, and a disk that empties when told. */
function fakeOneDrive(root, states, { running = true } = {}) {
  const calls = { query: 0, made: [] };
  const allocation = new Map();
  const fake = {
    calls,
    states,
    running,
    // How many watch rounds before OneDrive takes a file; Infinity never.
    delay: new Map(),
    deps: null,
  };
  fake.deps = {
    roots: () => [{ root, key: root.toLowerCase(), service: 'OneDrive' }],
    running: async () => fake.running,
    query: async (paths) => {
      calls.query += 1;
      if (fake.unavailable) return { ok: false, reason: 'unavailable' };
      return { ok: true, states: new Map(paths.map((p) => [p, fake.states.get(p) || S.notSynced])) };
    },
    makeOnlineOnly: async (file) => {
      if (fake.failFor === file) throw new Error('Access denied - ' + file);
      calls.made.push(file);
      allocation.set(file, { rounds: 0 });
    },
    allocated: async (file) => {
      const st = await fsp.lstat(file);
      const entry = allocation.get(file);
      if (!entry) return st.size;
      entry.rounds += 1;
      const wait = fake.delay.has(file) ? fake.delay.get(file) : 1;
      return entry.rounds > wait ? 0 : st.size;
    },
    watchMs: 400,
    stepMs: 20,
  };
  return fake;
}

(async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-dehydrate-'));
  const od = path.join(base, 'OneDrive');
  const J = (...p) => path.join(od, ...p);
  try {
    await make(J('Docs', 'report.pdf'), 3 * MB);
    await make(J('Docs', 'kept.pdf'), 2 * MB);
    await make(J('Video', 'trip.mp4'), 5 * MB);
    await make(J('Never', 'disk.vmdk'), 4 * MB);
    await make(J('Busy', 'draft.docx'), 1 * MB);
    await make(J('Cloud', 'old.zip'), 2 * MB);
    await make(path.join(base, 'Elsewhere', 'x.bin'), 1 * MB);
    const states = new Map([
      [J('Docs', 'report.pdf'), S.inSync],
      [J('Docs', 'kept.pdf'), S.pinned],
      [J('Video', 'trip.mp4'), S.inSync],
      [J('Never', 'disk.vmdk'), S.notSynced],
      [J('Busy', 'draft.docx'), S.pending],
      [J('Cloud', 'old.zip'), S.onlineOnly],
    ]);

    console.log('\nWhat Windows says, read back:');
    {
      const paths = ['C:\\a.bin', 'C:\\b.bin', 'C:\\c.bin'];
      const parsed = cloudState.parseReply(paths, `0 32 0\r\n1 4200992 57\nnoise\n2 4294967295 0\n7 1 1\n`);
      const a = parsed.get('C:\\a.bin');
      const b = parsed.get('C:\\b.bin');
      check('a plain file is not a placeholder', a && !a.placeholder && !a.inSync);
      check('0x401620 / 0x39 is a placeholder in sync whose contents are not on the disk',
        b && b.placeholder && b.inSync && !b.onDisk);
      check('a path Windows could not find says so, and stray lines are ignored',
        parsed.get('C:\\c.bin').missing === true && parsed.size === 3);
      check('pinned and unpinned are read from the attributes',
        S.pinned.pinned === true && cloudState.describe(ATTR.UNPINNED, 1).unpinned === true && S.inSync.pinned === false);
      const odd = await cloudState.query(['C:\\has\na newline.bin', 'relative\\path.bin']);
      check('a path that could split a line, or is not absolute, is never sent', odd.ok && odd.states.size === 0);
    }

    console.log('\nThe programs it runs:');
    {
      const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32').toLowerCase();
      const all = Object.values(cloudState.programs).map((f) => f());
      check('every one by absolute path under System32', all.every((p) => path.isAbsolute(p) && p.toLowerCase().startsWith(system32)),
        all.map((p) => path.basename(p)).join(', '));
      check('the script reads the paths from its input and never has one written into it',
        /\[Console\]::In\.ReadLine\(\)/.test(cloudState.SCRIPT) && !/\$args|\$input\b|Invoke-Expression|iex\b/i.test(cloudState.SCRIPT));
      check('and it only reads a directory entry -- it never opens a file',
        /FindFirstFileW/.test(cloudState.SCRIPT) && !/CreateFile|OpenRead|ReadAllBytes|Get-Content/i.test(cloudState.SCRIPT));
    }

    console.log('\nWhere OneDrive is:');
    {
      const roots = [{ root: od, key: od.toLowerCase(), service: 'OneDrive' }];
      check('a file in it', cloudState.oneDriveRootOf(J('Docs', 'report.pdf'), roots) === od);
      check('not a folder whose name only starts the same way', cloudState.oneDriveRootOf(`${od}X\\f.bin`, roots) === null);
      check('not a relative path, nor the folder itself', cloudState.oneDriveRootOf('Docs\\report.pdf', roots) === null &&
        cloudState.oneDriveRootOf(od, roots) === null);
    }

    console.log('\nWhat it offers (the analyzer):');
    {
      const onDisk = [...states.keys()].map((p) => ({ path: p, size: 3 * MB, allocated: 3 * MB, mtimeMs: Date.now() - 40 * 86400000, atimeMs: Date.now() - 40 * 86400000 }));
      const fake = fakeOneDrive(od, states);
      const found = await cloudFindings({ onDisk, onlineOnly: { count: 2, bytes: 4 * MB } }, { tracked: true }, Date.now(), fake.deps);
      const offered = found.candidates.map((c) => path.basename(c.path)).sort();
      check('only files in sync with their contents on the disk', JSON.stringify(offered) === JSON.stringify(['kept.pdf', 'report.pdf', 'trip.mp4']),
        offered.join(', '));
      let valid = true;
      for (const c of found.candidates) {
        try {
          validateCandidate(c);
        } catch {
          valid = false;
        }
      }
      check('each a candidate that passes the contract', valid);
      check('whose only action is making it online-only -- never the Recycle Bin, never unattended',
        found.candidates.every((c) => c.actions.length === 1 && c.actions[0] === 'dehydrate' && c.unattendedEligible === false &&
          c.category === 'cloud.dehydrate'));
      const kept = found.candidates.find((c) => path.basename(c.path) === 'kept.pdf');
      const report = found.candidates.find((c) => path.basename(c.path) === 'report.pdf');
      check('in sync is safe, on strong evidence', report.verdict === 'safe' && report.confidence === 'strong');
      check('"always keep on this device" is somebody\'s choice: review, likely, and says so first',
        kept.verdict === 'review' && kept.confidence === 'likely' && /Always keep/.test(kept.evidence[0].en));
      check('what is not offered is counted, for the screen to say',
        found.summary.notSynced.count === 1 && found.summary.pending.count === 1 && found.summary.onlineOnly.count === 3,
        JSON.stringify({ notSynced: found.summary.notSynced.count, pending: found.summary.pending.count, onlineOnly: found.summary.onlineOnly.count }));
      fake.unavailable = true;
      const blind = await cloudFindings({ onDisk, onlineOnly: { count: 0, bytes: 0 } }, { tracked: true }, Date.now(), fake.deps);
      check('when Windows cannot be asked, nothing is offered and the screen is told why',
        blind.candidates.length === 0 && blind.summary.unavailable === 'unavailable');
    }

    console.log('\nThrough the real scan:');
    {
      const saved = process.env.OneDrive;
      process.env.OneDrive = od;
      cloud.reset();
      try {
        const fake = fakeOneDrive(od, states);
        const collected = await analyzers.collect(
          'scan',
          { root: base, options: { collectTree: true, cloudFiles: true }, deps: { cloud: fake.deps } },
          { strict: true }
        );
        const summary = collected.summary;
        const cloudIds = new Set(summary.cloud.ids);
        const inGroups = summary.cleanup.groups.some((g) => g.ids.some((id) => cloudIds.has(id)));
        const inLargest = summary.largest.some((id) => cloudIds.has(id));
        check('the scan finds them and asks once', summary.cloud.ids.length === 3 && fake.calls.query === 1, `${summary.cloud.ids.length} offered`);
        check('they are in no delete group and not in the largest list, even for the same file',
          !inGroups && !inLargest && collected.candidates.filter((c) => c.path === J('Docs', 'report.pdf')).length === 2);
        const plain = collected.candidates.find((c) => c.path === J('Docs', 'report.pdf') && c.category !== 'cloud.dehydrate');
        const outside = collected.candidates.find((c) => c.path === path.join(base, 'Elsewhere', 'x.bin'));
        check('where the same file is offered for the Recycle Bin, its reasons point to the way that deletes nothing',
          plain && plain.evidence.some((e) => e.i18n === 'evidence.cloud.alsoInCloud') && plain.evidence[0].i18n !== 'evidence.cloud.alsoInCloud' &&
            !(outside && outside.evidence.some((e) => e.i18n === 'evidence.cloud.alsoInCloud')));
        check('and not in the "safe to delete" total', summary.cleanup.safeBytes === summary.cleanup.groups
          .filter((g) => g.verdict === 'safe').reduce((n, g) => n + g.bytes, 0));
        check('a file outside OneDrive is never asked about', !collected.candidates.some((c) => c.category === 'cloud.dehydrate' && c.path.includes('Elsewhere')));
      } finally {
        if (saved === undefined) delete process.env.OneDrive;
        else process.env.OneDrive = saved;
        cloud.reset();
      }
    }

    console.log('\nWhat it refuses (the plan):');
    {
      const fake = fakeOneDrive(od, states);
      const planned = await handler.plan(
        [J('Docs', 'report.pdf'), J('Docs', 'kept.pdf'), J('Never', 'disk.vmdk'), J('Busy', 'draft.docx'), J('Cloud', 'old.zip'),
          path.join(base, 'Elsewhere', 'x.bin'), J('Docs'), J('Docs', 'gone.pdf'), 'relative.bin', 42],
        {},
        { deps: fake.deps }
      );
      const reasons = Object.fromEntries(planned.failed.map((f) => [path.basename(String(f.path)), f.reason]));
      check('in sync and on the disk go ahead', planned.plan.map((p) => path.basename(p.path)).sort().join(',') === 'kept.pdf,report.pdf');
      check('never uploaded, waiting to sync, already online-only: each refused by name',
        reasons['disk.vmdk'] === 'notSynced' && reasons['draft.docx'] === 'pending' && reasons['old.zip'] === 'onlineOnly', JSON.stringify(reasons));
      check('outside OneDrive, a folder, a missing file, a relative path, not a path', reasons['x.bin'] === 'notInOneDrive' &&
        reasons.Docs === 'notAFile' && reasons['gone.pdf'] === 'missing' && reasons['relative.bin'] === 'invalid' && reasons['42'] === 'invalid');
      const d = handler.describe(planned);
      check('the description says it frees the space, measured, and how much is on the disk now',
        d.freesOnVolume === true && d.measured === true && d.onDiskBytes === 5 * MB && d.pinned === 1);

      const off = fakeOneDrive(od, states, { running: false });
      const refused = await handler.plan([J('Docs', 'report.pdf')], {}, { deps: off.deps });
      check('OneDrive not running: everything refused, and Windows is not even asked',
        refused.plan.length === 0 && refused.failed[0].reason === 'oneDriveOff' && off.calls.query === 0);
      const blind = fakeOneDrive(od, states);
      blind.unavailable = true;
      const unchecked = await handler.plan([J('Docs', 'report.pdf')], {}, { deps: blind.deps });
      check('Windows cannot be asked: everything refused', unchecked.plan.length === 0 && unchecked.failed[0].reason === 'cannotCheck');
    }

    console.log('\nThrough the pipeline:');
    {
      const journal = new ActionJournal(path.join(base, 'journal'));
      const fake = fakeOneDrive(od, states);
      fake.delay.set(J('Video', 'trip.mp4'), Infinity); // OneDrive never gets to this one
      let asked = null;
      const result = await execute(
        { kind: 'dehydrate', items: [J('Docs', 'report.pdf'), J('Docs', 'kept.pdf'), J('Video', 'trip.mp4')] },
        { deps: fake.deps, journal, confirm: async (description) => ((asked = description), true) }
      );
      check('the confirmation is asked, as a dehydrate of three files', asked && asked.kind === 'dehydrate' && asked.count === 3);
      check('all three are handed to OneDrive', result.moved.length === 3 && fake.calls.made.length === 3);
      check('freed is what the disk shows, not what was asked for: the one OneDrive never took counts nothing',
        result.freedBytes === 3 * MB + 2 * MB && result.movedBytes === 10 * MB && result.pendingCount === 1,
        `freed ${result.freedBytes / MB} MB of ${result.movedBytes / MB} MB handed over`);
      const sessions = await journal.sessions();
      const mine = sessions.find((s) => s.kind === 'dehydrate');
      check('the journal has each file, and the measured figure as freed',
        mine && mine.items.length === 3 && mine.end.freedOnSource === 5 * MB);
      const listed = await restore.listSessions(journal);
      check('and the Restore tab leaves it out: the files never moved', !listed.some((s) => s.kind === 'dehydrate'));

      const declined = fakeOneDrive(od, states);
      await execute({ kind: 'dehydrate', items: [J('Docs', 'report.pdf')] }, { deps: declined.deps, confirm: async () => false });
      check('a declined confirmation changes nothing', declined.calls.made.length === 0);

      const off = fakeOneDrive(od, states, { running: false });
      let offered = false;
      const none = await execute({ kind: 'dehydrate', items: [J('Docs', 'report.pdf')] }, { deps: off.deps, confirm: async () => ((offered = true), true) });
      check('OneDrive off: no dialog, nothing changed, and the reason comes back',
        !offered && off.calls.made.length === 0 && none.failed[0].reason === 'oneDriveOff');
    }

    console.log('\nBetween the plan and the act:');
    {
      const fake = fakeOneDrive(od, new Map(states));
      const planned = await handler.plan([J('Docs', 'report.pdf'), J('Docs', 'kept.pdf'), J('Video', 'trip.mp4')], {}, { deps: fake.deps });
      // Edited after the plan: no longer in sync.
      fake.states.set(J('Docs', 'report.pdf'), S.pending);
      // Grown after the plan.
      await make(J('Video', 'trip.mp4'), 6 * MB);
      const result = await handler.apply(planned, {}, { deps: fake.deps });
      const why = Object.fromEntries(result.failed.map((f) => [path.basename(f.path), f.reason]));
      check('a file that fell out of sync is left alone', why['report.pdf'] === 'pending');
      check('so is one whose size changed', why['trip.mp4'] === 'changed');
      check('only the unchanged one was touched', fake.calls.made.length === 1 && path.basename(fake.calls.made[0]) === 'kept.pdf');

      const stopped = fakeOneDrive(od, states);
      const plan2 = await handler.plan([J('Docs', 'kept.pdf')], {}, { deps: stopped.deps });
      stopped.running = false;
      const r2 = await handler.apply(plan2, {}, { deps: stopped.deps });
      check('OneDrive closed in between: nothing touched', stopped.calls.made.length === 0 && r2.failed[0].reason === 'oneDriveOff');

      const broken = fakeOneDrive(od, states);
      broken.failFor = J('Docs', 'kept.pdf');
      const plan3 = await handler.plan([J('Docs', 'kept.pdf')], {}, { deps: broken.deps });
      const r3 = await handler.apply(plan3, {}, { deps: broken.deps });
      check('attrib failing is reported, and nothing is counted as freed', r3.failed[0].reason === 'failed' && r3.measuredFreedBytes === 0);
    }

    console.log('\nThe real Windows, reading only:');
    if (process.platform === 'win32') {
      const plain = path.join(base, 'Elsewhere', 'x.bin');
      const reply = await cloudState.query([plain, path.join(base, 'no-such-file.bin')]);
      check('a plain temporary file is not a OneDrive placeholder, and a missing one is missing',
        reply.ok && reply.states.get(plain).placeholder === false && reply.states.get(path.join(base, 'no-such-file.bin')).missing === true,
        reply.ok ? '' : reply.reason);
      const size = (await fsp.stat(plain)).size;
      check('and asking did not change it', size === 1 * MB);
    } else {
      console.log('    (not Windows; skipped)');
    }
  } finally {
    await fsp.rm(base, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
