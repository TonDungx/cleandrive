#!/usr/bin/env node
'use strict';

/**
 * Joining duplicate copies into one file (F4).
 *
 *   node scripts/test-hardlink.js
 *
 * ## Real links, on a real volume
 *
 * Almost everything here runs against `fs.link` on an actual NTFS drive
 * rather than against a fake. The reason is that the whole feature is about a
 * property of the filesystem -- "these two names are one file" -- and a stub
 * that answers questions about it is a stub that agrees with whatever this
 * code already believes. The two measurements the design rests on (Office
 * replaces the file; a rename breaks a link, a write in place does not) are
 * reproduced here as tests, minus the Office half, which needs Word.
 *
 * The fixture is on `D:` and not `os.tmpdir()`: on this machine the temp
 * directory is inside `AppData` on `C:`, and a test about what happens on one
 * volume that silently runs on a different volume from the one being reasoned
 * about is a test that passes for the wrong reason.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const hardlink = require('../src/main/lib/hardlink');
const handler = require('../src/main/actions/hardlink');
const { execute } = require('../src/main/actions/execute');
const { findDuplicates } = require('../src/main/lib/duplicate');
const settings = require('../src/main/lib/settings');
const restore = require('../src/main/actions/restore');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const ALWAYS = { acknowledged: true };

/* -------------------------------------------------------------------------- */

async function main() {
  // A volume that can hold hard links, and that is not the one the harness's
  // own temp directory lives on. `D:` is where every other two-volume fixture
  // in this suite goes, for the same reason.
  const home = fs.existsSync('D:\\') ? 'D:\\' : os.tmpdir();
  const base = await fsp.mkdtemp(path.join(home, 'cleandrive-f4-'));
  // Unconditional, because the first version was not: a run that threw part
  // way through left its fixture on D: for somebody to find later.
  process.on('exit', () => {
    try {
      fs.rmSync(base, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${base})`);
    }
  });

  check(
    'the fixture is not inside the harness temp directory, so "same volume" means something',
    path.parse(base).root.toUpperCase() !== path.parse(os.tmpdir()).root.toUpperCase() || home === os.tmpdir(),
    `${path.parse(base).root} vs ${path.parse(os.tmpdir()).root}`
  );

  const write = async (name, body) => {
    const p = path.join(base, name);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, body);
    return p;
  };
  const bytesA = Buffer.alloc(200 * 1024, 0x41);
  const bytesB = Buffer.alloc(200 * 1024, 0x42);

  /* ---- what the filesystem does, measured rather than assumed ----------- */

  console.log('\nhardlink: what a link is, and what breaks it\n');

  {
    const one = await write('fs/one.bin', bytesA);
    const two = path.join(base, 'fs', 'two.bin');
    await fsp.link(one, two);

    const [a, b] = [await hardlink.identify(one), await hardlink.identify(two)];
    check('two names, one file', hardlink.sameFile(a, b) && a.nlink === 2, `nlink=${a.nlink}`);
    check('the same key falls out of both', hardlink.fileKey(a) === hardlink.fileKey(b));

    // Measured for F4 and written down in lib/hardlink.js: writing in place
    // keeps the link, replacing the file breaks it. Office does the second.
    await fsp.writeFile(one, Buffer.alloc(200 * 1024, 0x43));
    const afterWrite = await hardlink.identify(two);
    check(
      'writing over a file in place keeps the link, and the other name sees the change',
      afterWrite.nlink === 2 && (await fsp.readFile(two))[0] === 0x43
    );

    const tmp = path.join(base, 'fs', 'scratch.tmp');
    await fsp.writeFile(tmp, Buffer.alloc(200 * 1024, 0x44));
    await fsp.rename(tmp, one);
    const afterRename = await hardlink.identify(two);
    const renamedOne = await hardlink.identify(one);
    check(
      'a temp file renamed over the top breaks the link silently -- what Word does',
      afterRename.nlink === 1 && renamedOne.nlink === 1 && !hardlink.sameFile(afterRename, renamedOne)
    );
    check(
      'and the other name is left holding the old contents',
      (await fsp.readFile(two))[0] === 0x43 && (await fsp.readFile(one))[0] === 0x44
    );
  }

  {
    check('a Word document is refused by extension', hardlink.replacedOnSave('C:\\x\\report.docx'));
    check('so is Excel, and case does not matter', hardlink.replacedOnSave('C:\\x\\Book.XLSX'));
    check('so is OpenDocument', hardlink.replacedOnSave('C:\\x\\notes.odt'));
    check('an ordinary file is not', !hardlink.replacedOnSave('C:\\x\\photo.jpg'));
    check('nor is something with no extension', !hardlink.replacedOnSave('C:\\x\\LICENCE'));
  }

  /* ---- the duplicate engine tells names from files ---------------------- */

  console.log('\nhardlink: the Duplicates screen stops promising space that is not there\n');

  {
    const dir = path.join(base, 'dupes');
    await write('dupes/a1.bin', bytesA);
    await write('dupes/a2.bin', bytesA);
    await write('dupes/a3.bin', bytesA);
    const b1 = await write('dupes/b1.bin', bytesB);
    await fsp.link(b1, path.join(dir, 'b2.bin'));
    await fsp.link(b1, path.join(dir, 'b3.bin'));

    const out = await findDuplicates([dir], { useCache: false, minSize: 1024 });
    const byName = new Map(
      out.groups.map((g) => [g.files.map((f) => path.basename(f.path)).sort().join(','), g])
    );
    const three = byName.get('a1.bin,a2.bin,a3.bin');
    const linked = byName.get('b1.bin,b2.bin,b3.bin');

    check('three separate copies count as three files', three && three.distinctFiles === 3);
    check('and waste two copies worth', three && three.wastedBytes === bytesA.length * 2, three && String(three.wastedBytes));

    check('three names for one file count as one file', linked && linked.distinctFiles === 1);
    check(
      'and waste nothing -- this is the number that used to lie',
      linked && linked.wastedBytes === 0 && linked.selectableBytes === 0
    );
    check('the group says so in one word', linked && linked.allOneFile === true);
    check(
      'each name knows which others it shares a file with',
      linked && linked.files.every((f) => f.sharesWith.length === 2)
    );
    check('and a separate copy shares with nobody', three && three.files.every((f) => f.sharesWith.length === 0));
    check(
      'the reclaimable total counts files, not rows',
      out.groups.reduce((n, g) => n + g.wastedBytes, 0) === bytesA.length * 2
    );
  }

  /* ---- the settings gate ------------------------------------------------ */

  console.log('\nhardlink: the switch in front of it\n');

  {
    const fresh = settings.coerceSettings({});
    check('off out of the box', fresh.settings.developer.hardlink === false);

    const migrated = settings.migrate({ version: 10, explorer: { contextMenu: true } });
    check('a settings file from before F4 migrates to 11', migrated.raw.version === 11);
    check('and lands with the switch off -- a migration is not consent', migrated.raw.developer.hardlink === false);

    const junk = settings.coerceSettings({ version: 11, developer: { hardlink: 'yes' } });
    check('a string where a boolean belongs is not truthy', junk.settings.developer.hardlink === false);
  }

  /* ---- planning refuses more than it accepts ---------------------------- */

  console.log('\nhardlink: what it refuses\n');

  {
    const keeper = await write('plan/keep.bin', bytesA);
    const copy = await write('plan/copy.bin', bytesA);
    const different = await write('plan/other.bin', bytesB);
    const doc = await write('plan/report.docx', bytesA);
    const docKeeper = await write('plan/original.docx', bytesA);

    const planned = await handler.plan(
      [copy, different, doc],
      { keepers: { [copy]: keeper, [different]: keeper, [doc]: docKeeper } },
      { deps: { photoRoots: [] } }
    );

    check('an identical copy is planned', planned.plan.length === 1 && planned.plan[0].path === copy);
    const codes = new Map(planned.failed.map((f) => [f.path, f.code]));
    check('a file that is not identical is refused', codes.get(different) === 'EDIFFERS');
    check('a Word document is refused, whatever its contents', codes.get(doc) === 'EREPLACEDONSAVE');
    check('the plan carries a hash it read itself', /^[0-9a-f]{64}$/.test(planned.plan[0].sha256));
    check('and the freed figure is the copy, not the pair', handler.describe(planned).freedBytes === bytesA.length);

    const noKeeper = await handler.plan([copy], { keepers: {} }, { deps: { photoRoots: [] } });
    check('a copy with no keeper named is refused', noKeeper.failed[0].code === 'ENOKEEPER');

    const itself = await handler.plan([copy], { keepers: { [copy]: copy } }, { deps: { photoRoots: [] } });
    check('joining a file to itself is refused', itself.failed[0].code === 'ESELF');

    const inPhotos = await handler.plan(
      [copy],
      { keepers: { [copy]: keeper } },
      { deps: { photoRoots: [path.join(base, 'plan')] } }
    );
    check('anything inside a photo root is refused', inPhotos.failed[0].code === 'EPHOTOS');

    const inCloud = await handler.plan(
      [copy],
      { keepers: { [copy]: keeper } },
      { deps: { photoRoots: [], cloud: { serviceForPath: () => 'OneDrive' } } }
    );
    check('anything inside a sync folder is refused', inCloud.failed[0].code === 'ESYNCED');

    const notNtfs = await handler.plan(
      [copy],
      { keepers: { [copy]: keeper } },
      { deps: { photoRoots: [], volumes: { describePath: async () => ({ fileSystem: 'exFAT' }) } } }
    );
    check('a volume that is not NTFS is refused -- asked, not assumed', notNtfs.failed[0].code === 'ENOTNTFS');
  }

  /* ---- the gate that is not in the window ------------------------------- */

  console.log('\nhardlink: nothing is joined without the confirmation\n');

  {
    const keeper = await write('gate/keep.bin', bytesA);
    const copy = await write('gate/copy.bin', bytesA);
    const planned = await handler.plan([copy], { keepers: { [copy]: keeper } }, { deps: { photoRoots: [] } });

    const without = await handler.apply(planned, {}, {});
    const after = await hardlink.identify(copy);
    check('apply without the acknowledgement joins nothing', without.moved.length === 0 && after.nlink === 1);
    check('and says why rather than failing quietly', without.failed[0].code === 'EUNCONFIRMED');

    const withIt = await handler.apply(planned, ALWAYS, {});
    const joined = await hardlink.identify(copy);
    check('apply with it joins the copy', withIt.moved.length === 1 && joined.nlink === 2);
    check('the copy and the keeper are now one file', hardlink.sameFile(joined, await hardlink.identify(keeper)));
    check('the bytes are still the copy\u2019s bytes', (await fsp.readFile(copy)).equals(bytesA));
    check('and the freed figure is measured, not declared', withIt.measuredFreedBytes === bytesA.length);
  }

  /* ---- through the pipeline, as the window drives it -------------------- */

  console.log('\nhardlink: through the one pipeline\n');

  {
    const keeper = await write('pipe/keep.bin', bytesA);
    const copy = await write('pipe/copy.bin', bytesA);
    const folder = path.join(base, 'pipe', 'a-folder');
    await fsp.mkdir(folder, { recursive: true });

    const locked = await execute(
      { kind: 'hardlink', items: [copy], options: { keepers: { [copy]: keeper }, ...ALWAYS } },
      { can: () => false, deps: { photoRoots: [] } }
    );
    check('the licence gate answers first', locked.refused === 'locked' && locked.feature === 'pro.dev');

    const withFolder = await execute(
      { kind: 'hardlink', items: [folder], options: { keepers: { [folder]: keeper }, ...ALWAYS } },
      { can: () => true, deps: { photoRoots: [] } }
    );
    check('a folder never reaches the handler', withFolder.refused === 'folders');

    const refused = await execute(
      { kind: 'hardlink', items: [copy], options: { keepers: { [copy]: keeper } } },
      { can: () => true, confirm: async () => false, deps: { photoRoots: [] } }
    );
    check('a confirmation answered "no" joins nothing', refused.cancelled === true && (await hardlink.identify(copy)).nlink === 1);

    const records = [];
    const done = await execute(
      { kind: 'hardlink', items: [copy], options: { keepers: { [copy]: keeper }, ...ALWAYS } },
      {
        can: () => true,
        confirm: async () => true,
        deps: { photoRoots: [] },
        journal: {
          begin: async () => ({ id: 's1' }),
          record: async (_s, item) => records.push(item),
          end: async () => {},
        },
      }
    );
    check('the pipeline joins it', done.moved.length === 1 && (await hardlink.identify(copy)).nlink === 2);
    check('and reports it as freed on the volume', done.freedBytes === bytesA.length && done.freesOnVolume === true);
    check('the journal records the keeper as the destination', records.length === 1 && records[0].to === keeper);
    check('and the hash it verified', /^[0-9a-f]{64}$/.test(records[0].sha256));
  }

  /* ---- undo ------------------------------------------------------------- */

  console.log('\nhardlink: splitting it back apart\n');

  {
    const keeper = await write('undo/keep.bin', bytesA);
    const copy = await write('undo/copy.bin', bytesA);
    const planned = await handler.plan([copy], { keepers: { [copy]: keeper } }, { deps: { photoRoots: [] } });
    await handler.apply(planned, ALWAYS, {});

    const record = { path: copy, sha256: planned.plan[0].sha256, size: bytesA.length };
    const located = await handler.undo.locate([record], {});
    const state = located.get(record);
    check('the Restore Center finds it joined', state.state === 'linked' && state.links === 2);
    check('it knows the undo needs room for a whole copy', state.needsBytes === bytesA.length);
    check('and the state is one the Restore Center will put back', restore.RESTORABLE.has('linked'));
    check('the undo works where the file stands', handler.undo.inPlace === true);

    const back = await handler.undo.putBack(state, copy);
    const split = await hardlink.identify(copy);
    const kept = await hardlink.identify(keeper);
    check('splitting gives the name a file of its own', back.ok === true && split.nlink === 1 && kept.nlink === 1);
    check('and they are no longer the same file', !hardlink.sameFile(split, kept));
    check('with the contents intact on both', (await fsp.readFile(copy)).equals(bytesA) && (await fsp.readFile(keeper)).equals(bytesA));
    check('and it did not claim the contents had changed', back.changed === false);

    const again = await handler.undo.locate([{ path: copy, sha256: record.sha256 }], {});
    check('a name already split reads as put back, not as broken', again.get(again.keys().next().value).state === 'restored');
  }

  {
    // The honest half of undo: it restores separateness, not old contents.
    const keeper = await write('undo2/keep.bin', bytesA);
    const copy = await write('undo2/copy.bin', bytesA);
    const planned = await handler.plan([copy], { keepers: { [copy]: keeper } }, { deps: { photoRoots: [] } });
    await handler.apply(planned, ALWAYS, {});

    // Something writes to the shared file in place, which both names see.
    await fsp.writeFile(keeper, Buffer.alloc(200 * 1024, 0x5a));
    const record = { path: copy, sha256: planned.plan[0].sha256 };
    const located = await handler.undo.locate([record], {});
    const back = await handler.undo.putBack(located.get(record), copy);
    check('undo after an in-place edit still splits the name off', back.ok === true);
    check(
      'and says the contents are not what they were -- it restores separateness, not history',
      back.changed === true && (await fsp.readFile(copy))[0] === 0x5a
    );
  }

  {
    const alone = await write('undo3/plain.bin', bytesA);
    const out = await hardlink.splitOff(alone);
    check('splitting a file that has only one name is refused', out.ok === false && out.code === 'ENOTLINKED');
  }

  /* ---- the analyzer's rows ---------------------------------------------- */

  console.log('\nhardlink: what the rows offer\n');

  {
    const { analyzer } = require('../src/main/analyzers/duplicates');
    const dir = path.join(base, 'rows');
    // Ages set rather than left to chance. Which copy is kept is decided by
    // age and, on a tie, by name -- and three files written in one millisecond
    // tie, which made `copy.bin` the keeper and this block fail at random.
    const k = await write('rows/keep.bin', bytesA);
    const c = await write('rows/copy.bin', bytesA);
    const third = await write('rows/third.bin', bytesA);
    for (const [file, ageDays] of [[k, 90], [c, 10], [third, 5]]) {
      const when = new Date(Date.now() - ageDays * 86400000);
      await fsp.utimes(file, when, when);
    }

    const before = await findDuplicates([dir], { useCache: false, minSize: 1024 });
    const rowsBefore = [];
    for await (const out of analyzer.run({ roots: [dir], deps: { findDuplicates: async () => before } }, { cancelled: false })) {
      if (out.type === 'candidate') rowsBefore.push(out.candidate);
    }
    const copyRow = rowsBefore.find((r) => r.path === c);
    const keepRow = rowsBefore.find((r) => r.path === k);
    check('a copy offers the join', copyRow && copyRow.actions.includes('hardlink'));
    check('and names the copy it would be joined to', copyRow && copyRow.meta.keeperPath === k);
    check('the keeper does not offer it -- there is nothing to join it to', keepRow && !keepRow.actions.includes('hardlink'));

    const planned = await handler.plan([c], { keepers: { [c]: k } }, { deps: { photoRoots: [] } });
    await handler.apply(planned, ALWAYS, {});

    const after = await findDuplicates([dir], { useCache: false, minSize: 1024 });
    const rowsAfter = [];
    for await (const out of analyzer.run({ roots: [dir], deps: { findDuplicates: async () => after } }, { cancelled: false })) {
      if (out.type === 'candidate') rowsAfter.push(out.candidate);
    }
    const joinedRow = rowsAfter.find((r) => r.path === c);
    check('after joining, the row offers nothing at all', joinedRow && joinedRow.actions.length === 0);
    check('and is no longer something to review', joinedRow && joinedRow.verdict === 'keep');
    check(
      'the evidence says it would free nothing',
      joinedRow && joinedRow.evidence.some((e) => JSON.stringify(e).includes('shared'))
    );
    check(
      'and the scan now reclaims one copy less',
      after.groups.reduce((n, g) => n + g.wastedBytes, 0) === bytesA.length,
      String(after.groups.reduce((n, g) => n + g.wastedBytes, 0))
    );
  }

  /* ---- alternate data streams survive the split ------------------------- */

  console.log('\nhardlink: streams\n');

  {
    const keeper = await write('ads/keep.bin', bytesA);
    const copy = await write('ads/copy.bin', bytesA);
    await fsp.writeFile(`${keeper}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n');

    const planned = await handler.plan([copy], { keepers: { [copy]: keeper } }, { deps: { photoRoots: [] } });
    await handler.apply(planned, ALWAYS, {});
    const mark = await fsp.readFile(`${copy}:Zone.Identifier`, 'utf8').catch(() => null);
    check('joining carries the kept file\u2019s streams, because it is that file now', mark && mark.includes('ZoneId=3'));

    const record = { path: copy, sha256: planned.plan[0].sha256 };
    const located = await handler.undo.locate([record], {});
    await handler.undo.putBack(located.get(record), copy);
    const after = await fsp.readFile(`${copy}:Zone.Identifier`, 'utf8').catch(() => null);
    check(
      'and splitting keeps them -- a copy with no zone mark is a silently trusted download',
      after && after.includes('ZoneId=3')
    );
  }

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILURE(S)\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
