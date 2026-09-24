#!/usr/bin/env node
'use strict';

// What changed in a folder between two of its scans (A5).
//
//   node scripts/test-snapshot-diff.js
//
// A folder is built, scanned, changed in known ways -- a file deleted, one
// moved, one grown, one shrunk below the cut, one pushed out of its folder's
// ten largest while still sitting there, a folder removed, folders added --
// and scanned again, with the real scanner and the real snapshot store. The
// comparison has to name each change for what it is, and has to refuse to
// name the one it cannot see.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { scan, rulesFingerprint, DEFAULTS, SCANNER_REVISION } = require('../src/main/lib/scanner');
const { SnapshotStore } = require('../src/main/snapshots/store');
const { diffSnapshots, defaultPair } = require('../src/main/snapshots/diff');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const MB = 1024 * 1024;

async function make(file, bytes) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const handle = await fsp.open(file, 'w');
  await handle.truncate(bytes);
  await handle.close();
}

async function resize(file, bytes) {
  const handle = await fsp.open(file, 'r+');
  await handle.truncate(bytes);
  await handle.close();
}

async function snapshotOf(store, root) {
  const result = await scan(root, { collectTree: true });
  const { treeFiles, ...summary } = result;
  const entry = await store.save(summary);
  return { entry, snapshot: await store.load(root, entry.file) };
}

(async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-diff-'));
  const home = path.join(base, 'home');
  const store = new SnapshotStore(path.join(base, 'snapshots'));
  const J = (...parts) => path.join(home, ...parts);

  try {
    /* -- the folder as it was --------------------------------------------- */
    await make(J('Downloads', 'big.iso'), 40 * MB);
    await make(J('Downloads', 'note.txt'), 100);
    await make(J('Downloads', 'setup', 'installer.exe'), 12 * MB);
    await make(J('Videos', '2019', 'a.mp4'), 20 * MB);
    for (let i = 0; i < 10; i++) await make(J('Pile', `f${i}.bin`), 10 * MB + i * 1000);
    await make(J('Gone', 'old.bin'), 15 * MB);
    await make(J('Docker', 'wsl', 'disk.vhdx'), 50 * MB);
    await make(J('Shrink', 'log.bin'), 20 * MB);
    await make(J('Documents', 'thesis.docx'), 12 * MB);

    const first = await snapshotOf(store, home);
    await new Promise((r) => setTimeout(r, 20));

    /* -- what happened to it ---------------------------------------------- */
    await fsp.rm(J('Downloads', 'big.iso'));
    await fsp.mkdir(J('Archive'), { recursive: true });
    await fsp.rename(J('Downloads', 'setup', 'installer.exe'), J('Archive', 'installer.exe'));
    await resize(J('Videos', '2019', 'a.mp4'), 35 * MB);
    await make(J('Pile', 'f10.bin'), 30 * MB); // pushes f0 out of the ten, though f0 is still there
    await fsp.rm(J('Gone'), { recursive: true });
    await resize(J('Docker', 'wsl', 'disk.vhdx'), 80 * MB);
    await resize(J('Shrink', 'log.bin'), 5 * MB);
    await make(J('New', 'fresh.bin'), 25 * MB);
    for (let i = 0; i < 100; i++) await make(J('Tiny', `t${i}.dat`), 20 * 1024);
    // Into a folder of its own: Documents' total does not change, but its own files do.
    await fsp.mkdir(J('Documents', 'Archive'), { recursive: true });
    await fsp.rename(J('Documents', 'thesis.docx'), J('Documents', 'Archive', 'thesis.docx'));

    const second = await snapshotOf(store, home);
    const diff = diffSnapshots(second.snapshot, first.snapshot, { files: [second.entry.file, first.entry.file] });

    console.log('\nThe comparison:');
    check('two scans of one folder with one set of rules can be compared', diff.ok === true && diff.confidence === null);
    check('whichever order they are handed over in, earlier comes first',
      diff.from.file === first.entry.file && diff.to.file === second.entry.file);
    check('the totals are the two scans\' own', diff.total.before === first.snapshot.totals.bytes &&
      diff.total.after === second.snapshot.totals.bytes && diff.total.change === diff.total.after - diff.total.before,
      `${diff.total.change} bytes`);

    console.log('\nWhere it grew:');
    const grew = new Map(diff.grew.places.map((p) => [p.rel, p]));
    console.log(`    ${diff.grew.places.map((p) => `${p.rel || '(root)'}${p.elsewhere ? ' [elsewhere]' : ''} ${(p.change / MB).toFixed(1)}`).join(', ')}`);
    check('the disk image growing is named where it is, not as "Docker"',
      grew.has(path.join('Docker', 'wsl')) && !grew.has('Docker') && grew.get(path.join('Docker', 'wsl')).change === 30 * MB);
    check('a folder that grew by one new file', grew.has('Pile') && grew.get('Pile').change === 30 * MB);
    check('a folder that did not exist is marked new', grew.has('New') && grew.get('New').appeared === true);
    check('a folder of a hundred small files is a place too', grew.has('Tiny') && grew.get('Tiny').change === 100 * 20 * 1024);
    check('the growth is named at the deepest folder holding it', grew.has(path.join('Videos', '2019')) && !grew.has('Videos'));
    const rels = diff.grew.places.filter((p) => !p.elsewhere).map((p) => p.rel);
    const nested = rels.some((a) => rels.some((b) => a !== b && b.startsWith(`${a}${path.sep}`)));
    check('no place is listed inside another, so the list can be added up', !nested && !grew.has(''));

    console.log('\nWhere it shrank:');
    const shrank = new Map(diff.shrank.places.map((p) => [p.rel, p]));
    console.log(`    ${diff.shrank.places.map((p) => `${p.rel || '(root)'} ${(p.change / MB).toFixed(1)}`).join(', ')}`);
    check('a folder that went is marked gone', shrank.has('Gone') && shrank.get('Gone').vanished === true && shrank.get('Gone').change === -15 * MB);
    check('a file shrinking shows as its folder shrinking', shrank.has('Shrink') && shrank.get('Shrink').change === -15 * MB);
    check('Downloads lost the ISO and the installer that moved out', shrank.has('Downloads') &&
      shrank.get('Downloads').change === -(40 * MB + 12 * MB));
    check('a file moved into a folder inside its own shows on both sides, though the outer total did not move',
      shrank.has('Documents') && shrank.get('Documents').change === -12 * MB &&
        grew.has(path.join('Documents', 'Archive')) && grew.get(path.join('Documents', 'Archive')).change === 12 * MB);
    {
      const all = diffSnapshots(first.snapshot, second.snapshot, { limits: { minPlaceBytes: 1, places: 1000 } });
      const sum = (list) => list.places.reduce((n, p) => n + p.change, 0);
      check('what grew and what shrank add up to the net change, exactly',
        sum(all.grew) + sum(all.shrank) === all.total.change, `${sum(all.grew)} + ${sum(all.shrank)} vs ${all.total.change}`);
    }

    console.log('\nWhich large files:');
    const f = diff.files;
    const names = (group) => group.items.map((x) => x.name).sort();
    check('grown in place: the video and the disk image', JSON.stringify(names(f.grew)) === JSON.stringify(['a.mp4', 'disk.vhdx']),
      names(f.grew).join(', '));
    check('with what they were and what they are',
      f.grew.items.find((x) => x.name === 'disk.vhdx').before === 50 * MB && f.grew.items.find((x) => x.name === 'disk.vhdx').after === 80 * MB);
    check('new: the file in the new folder, and the one bigger than everything in a full ten',
      JSON.stringify(names(f.appeared)) === JSON.stringify(['f10.bin', 'fresh.bin']), names(f.appeared).join(', '));
    check('gone: the ISO, the file in the folder that went, and the one shrunk below 10 MB',
      JSON.stringify(names(f.vanished)) === JSON.stringify(['big.iso', 'log.bin', 'old.bin']), names(f.vanished).join(', '));
    {
      const installer = f.moved.items.find((x) => x.name === 'installer.exe');
      check('moved, once each, rather than gone from one place and new in another',
        f.moved.total === 2 && JSON.stringify(names(f.moved)) === JSON.stringify(['installer.exe', 'thesis.docx']) &&
          installer.from === J('Downloads', 'setup', 'installer.exe') && installer.to === J('Archive', 'installer.exe') &&
          installer.fromRel === path.join('Downloads', 'setup') && installer.toRel === 'Archive',
        names(f.moved).join(', '));
      check('and neither is also listed as new or gone',
        !f.appeared.items.some((x) => x.name === 'installer.exe' || x.name === 'thesis.docx') &&
          !f.vanished.items.some((x) => x.name === 'installer.exe' || x.name === 'thesis.docx'));
    }
    check('the file pushed out of a full ten is "could not tell" -- it is still there',
      f.unknown.count === 1 && f.unknown.bytes === 10 * MB && !f.vanished.items.some((x) => x.name === 'f0.bin'));

    console.log('\nWhen there is no honest answer:');
    const otherRoot = { ...first.snapshot, root: path.join(base, 'elsewhere') };
    check('two different folders are not compared', diffSnapshots(otherRoot, second.snapshot).reason === 'differentRoot');
    const otherRules = { ...first.snapshot, rules: 'deadbeef0000' };
    check('scans made with different rules are not compared', diffSnapshots(otherRules, second.snapshot).reason === 'differentRules');
    const otherScanner = { ...first.snapshot, scanner: 'mft' };
    check('nor scans made by a different scanner', diffSnapshots(otherScanner, second.snapshot).reason === 'differentScanner');
    const stopped = diffSnapshots({ ...first.snapshot, complete: false }, second.snapshot);
    check('a scan that was stopped early is compared, but only as a guess, and says which',
      stopped.ok && stopped.confidence === 'guess' && stopped.incomplete.length === 1);
    const otherCut = diffSnapshots({ ...first.snapshot, bigFileBytes: 1 * MB }, second.snapshot);
    check('files named by a different cut are not compared, and the folders still are',
      otherCut.ok && otherCut.files === null && otherCut.filesRefused === 'differentFileRule' && otherCut.grew.places.length > 0);
    check('a change in how the walk counts changes the rules the scans carry',
      rulesFingerprint(DEFAULTS, SCANNER_REVISION) !== rulesFingerprint(DEFAULTS, SCANNER_REVISION - 1) &&
        first.snapshot.rules === rulesFingerprint({ ...DEFAULTS, collectTree: true }));

    console.log('\nWhich two it opens on:');
    const DAY = 24 * 3600 * 1000;
    const at = (daysAgo, extra = {}) => ({
      file: `s${daysAgo}`,
      takenAt: new Date(Date.UTC(2026, 8, 24) - daysAgo * DAY).toISOString(),
      complete: true,
      scanner: 'walk',
      rules: 'r1',
      ...extra,
    });
    const week = defaultPair([at(0), at(1), at(6), at(9), at(30)]);
    check('the newest, and the one nearest a week before it', week.ok && week.newer === 's0' && week.older === 's6' && Math.round(week.days) === 6,
      JSON.stringify(week));
    const preferComplete = defaultPair([at(0), at(7, { complete: false }), at(3)]);
    check('a complete scan over a stopped one, even a little further from a week', preferComplete.older === 's3');
    const newestStopped = defaultPair([at(0, { complete: false }), at(2), at(8)]);
    check('and the newest complete scan as the later one', newestStopped.newer === 's2' && newestStopped.older === 's8');
    check('one scan is nothing to compare', defaultPair([at(0)]).ok === false && defaultPair([at(0)]).reason === 'onlyOne');
    check('two scans by different rules are not paired',
      defaultPair([at(0), at(5, { rules: 'r0' })]).reason === 'differentRules');
  } finally {
    await fsp.rm(base, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
