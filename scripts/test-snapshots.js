#!/usr/bin/env node
'use strict';

// The snapshot store: what a scan keeps, how long, and when two of them may be
// compared.
//   node scripts/test-snapshots.js
//   node scripts/test-snapshots.js --measure <folder>   size of a real one
//
// The measure form scans a real folder read-only and reports how big its
// snapshot is, because "a few hundred kilobytes" is a claim until it is.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { scan } = require('../src/main/lib/scanner');
const { SnapshotStore, comparable, selectRetained, fileNameFor } = require('../src/main/snapshots/store');
const { localDataDir } = require('../src/main/services');
const { formatBytes } = require('../src/main/lib/util');

const MB = 1024 * 1024;

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

async function make(file, bytes) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const handle = await fsp.open(file, 'w');
  await handle.truncate(bytes);
  await handle.close();
}

async function measure(folder) {
  const store = new SnapshotStore(await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-snap-measure-')));
  const started = Date.now();
  const plain = await scan(folder, {});
  const plainMs = Date.now() - started;
  const t2 = Date.now();
  const result = await scan(folder, { collectTree: true });
  const treeMs = Date.now() - t2;
  const t3 = Date.now();
  const entry = await store.save(result);
  const saveMs = Date.now() - t3;
  console.log(`\nsnapshot of ${folder}`);
  console.log(`  ${result.totalFiles.toLocaleString('en-US')} files in ${result.totalDirs.toLocaleString('en-US')} folders, ${formatBytes(result.totalSize)}`);
  console.log(`  ${result.tree.length.toLocaleString('en-US')} rows, ${result.tree.reduce((n, r) => n + r[3].length, 0)} large files named`);
  console.log(`  on disk: ${formatBytes(entry.bytesOnDisk)} gzipped`);
  console.log(`  scan ${plainMs} ms without the tree, ${treeMs} ms with it; save ${saveMs} ms`);
  console.log(`  (the two scans ran back to back, so the second had a warm cache: ${plain.totalFiles === result.totalFiles ? 'same file count' : 'file count changed between them'})\n`);
  await fsp.rm(store.dir, { recursive: true, force: true });
}

(async () => {
  const at = process.argv.indexOf('--measure');
  if (at !== -1) {
    await measure(path.resolve(process.argv[at + 1] || os.homedir()));
    return;
  }

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-snapshots-'));
  const tree = path.join(root, 'home');
  await make(path.join(tree, 'Downloads', 'big.iso'), 40 * MB);
  await make(path.join(tree, 'Downloads', 'note.txt'), 100);
  await make(path.join(tree, 'Downloads', 'setup', 'installer.exe'), 12 * MB);
  await make(path.join(tree, 'Videos', '2019', 'a.mp4'), 20 * MB);
  await make(path.join(tree, 'Videos', '2019', 'b.mp4'), 11 * MB);
  for (let i = 0; i < 15; i++) await make(path.join(tree, 'Pile', `f${i}.bin`), 10 * MB + i);
  await make(path.join(tree, 'loose.bin'), 5);

  console.log('\nsnapshots: what a scan keeps\n');

  const result = await scan(tree, { collectTree: true, treeBigPerDir: 10 });
  {
    const rows = result.tree;
    check('one row per folder that holds files', rows.length === 5, rows.map((r) => r[0] || '(root)').join(', '));
    check('the rows add up to the scan’s own total', rows.reduce((n, r) => n + r[1], 0) === result.totalSize,
      `${rows.reduce((n, r) => n + r[1], 0)} vs ${result.totalSize}`);
    check('and to its file count', rows.reduce((n, r) => n + r[2], 0) === result.totalFiles);
    const downloads = rows.find((r) => r[0] === 'Downloads');
    check('large files are named, small ones only counted',
      downloads && downloads[3].length === 1 && downloads[3][0][0] === 'big.iso' && downloads[2] === 2);
    const pile = rows.find((r) => r[0] === 'Pile');
    check('no more than the cap per folder, largest first',
      pile && pile[3].length === 10 && pile[3][0][1] === 10 * MB + 14, pile && `${pile[3].length} named`);
    check('paths are relative to the root', rows.every((r) => !path.isAbsolute(r[0])));
    const plain = await scan(tree, {});
    check('a scan that did not ask for a tree carries none', plain.tree === undefined);
    const hidden = await scan(tree, { ignoreHidden: false });
    check('the rules fingerprint changes with the rules', hidden.rules !== plain.rules && plain.rules === result.rules);
  }

  console.log('\nsnapshots: the store\n');

  const store = new SnapshotStore(path.join(root, 'store'));
  {
    const entry = await store.save(result);
    const listed = await store.list(tree);
    check('a saved snapshot is listed under its root', listed.length === 1 && listed[0].file === entry.file);
    check('the file name is safe on Windows and sorts by time', /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json\.gz$/.test(entry.file), entry.file);
    const back = await store.load(tree, entry.file);
    check('and reads back whole', back.v === 1 && back.tree.length === result.tree.length &&
      back.totals.bytes === result.totalSize && back.complete === true && back.scanner === 'walk');
    check('it is compressed', entry.bytesOnDisk < JSON.stringify(back).length, `${entry.bytesOnDisk} bytes`);

    let threw = false;
    try {
      await store.load(tree, '..\\..\\settings.json');
    } catch {
      threw = true;
    }
    check('a name that is not a snapshot is refused, not read', threw);

    const stopped = await store.save({ ...result, cancelled: true, scannedAt: Date.now() + 1000 });
    check('a stopped scan is kept, and marked incomplete', stopped.complete === false);

    await fsp.rm(path.join(store.dirFor(tree), 'index.json'));
    const rebuilt = await store.list(tree);
    check('a missing index is rebuilt from the files', rebuilt.length === 2 && rebuilt[0].root === tree);
    check('the store knows which roots it holds', JSON.stringify(await store.roots()) === JSON.stringify([tree]));
  }

  console.log('\nsnapshots: how long they are kept\n');

  {
    // Three scans a week for sixteen months.
    const snaps = [];
    const start = Date.UTC(2025, 5, 1);
    for (let t = start; t < Date.UTC(2026, 9, 1); t += 2.3 * 24 * 3600 * 1000) {
      snaps.push({ file: fileNameFor(t), takenAt: new Date(t).toISOString() });
    }
    const kept = selectRetained(snaps, { keepRecent: 12, keepMonthly: 12 });
    const newest = [...snaps].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    const months = new Set(kept.map((s) => s.takenAt.slice(0, 7)));
    check('the twelve newest are always kept', newest.slice(0, 12).every((s) => kept.includes(s)));
    check('plus one for each of the last twelve months', months.size === 12, [...months].sort().join(' '));
    check('and nothing older', kept.every((s) => s.takenAt >= newest[0].takenAt.slice(0, 7).replace(/^(\d{4})-(\d{2})$/, (m, y, mo) => {
      const d = new Date(Date.UTC(Number(y), Number(mo) - 12, 1));
      return d.toISOString().slice(0, 7);
    })));
    check(`${snaps.length} scans leave ${kept.length} snapshots`, kept.length <= 24);

    const pruning = new SnapshotStore(path.join(root, 'prune'), { retention: () => ({ keepRecent: 2, keepMonthly: 1 }) });
    for (let i = 0; i < 5; i++) await pruning.save({ ...result, scannedAt: Date.UTC(2026, 8, 1 + i) });
    const left = (await fsp.readdir(pruning.dirFor(tree))).filter((n) => n.endsWith('.gz'));
    check('the store deletes what the rule does not keep, using the current setting', left.length === 2, left.join(', '));
  }

  console.log('\nsnapshots: when two may be compared\n');

  {
    const a = { root: 'C:\\Users\\a', scanner: 'walk', rules: 'r1', complete: true };
    check('same folder, same scanner, same rules: yes', comparable(a, { ...a }).ok === true);
    if (process.platform === 'win32') {
      check('the case of the path does not matter on Windows', comparable(a, { ...a, root: 'c:\\users\\A' }).ok === true);
    }
    check('a different folder: no, and why', comparable(a, { ...a, root: 'C:\\Users\\b' }).reason === 'differentRoot');
    check('a different scanner: no', comparable(a, { ...a, scanner: 'mft' }).reason === 'differentScanner');
    check('different rules about what to skip: no', comparable(a, { ...a, rules: 'r2' }).reason === 'differentRules');
    check('only one snapshot: no', comparable(a, null).reason === 'onlyOne');
    const partial = comparable(a, { ...a, complete: false });
    check('a stopped scan: yes, but only as a guess', partial.ok === true && partial.confidence === 'guess');
  }

  console.log('\nsnapshots: where they live\n');

  {
    const normal = localDataDir({
      userData: 'C:\\Users\\a\\AppData\\Roaming\\CleanDrive',
      appData: 'C:\\Users\\a\\AppData\\Roaming',
      name: 'CleanDrive',
      localAppData: 'C:\\Users\\a\\AppData\\Local',
    });
    check('in the app, in the machine’s own profile folder rather than the roaming one',
      normal === path.join('C:\\Users\\a\\AppData\\Local', 'CleanDrive'), normal);
    const sandboxed = localDataDir({
      userData: 'C:\\Temp\\cleandrive-smoke-x',
      appData: 'C:\\Users\\a\\AppData\\Roaming',
      name: 'cleandrive',
      localAppData: 'C:\\Users\\a\\AppData\\Local',
    });
    check('under a harness that moved userData, inside that sandbox too', sandboxed === path.join('C:\\Temp\\cleandrive-smoke-x', 'local'), sandboxed);
  }

  await fsp.rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
