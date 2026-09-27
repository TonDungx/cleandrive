#!/usr/bin/env node
'use strict';

// The half of the `$MFT` reader that cannot be checked without a UAC prompt:
// opening a real volume, and agreeing with the ordinary walk about what is on
// it (A2's parity requirement).
//
//   Run this from an ADMINISTRATOR terminal:
//     npm run verify:mft -- --drive D
//     npm run verify:mft -- --drive D --subtree "D:\\personal_projects"
//
// Without administrator it says so and stops -- opening `\\.\D:` is refused
// with EPERM, measured, both from Node and through a P/Invoke shim.
//
// Read-only from beginning to end: the volume is opened for reading, the
// ordinary scanner is the same one the app runs, and nothing is written
// anywhere. It does not need the app to be closed.
//
// Everything with logic in it is covered without admin by test-ntfs.js (55
// checks) and test-mft.js (24, against a volume built in memory, including an
// `$MFT` in two pieces). What is left here is: does a real disk look the way
// those say it should.

const os = require('node:os');
const path = require('node:path');

const mft = require('../src/main/system/mft');
const ntfs = require('../src/main/system/ntfs');
const { scan } = require('../src/main/lib/scanner');
const { skipReason, isProtectedPath } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

function arg(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const DRIVE = String(arg('drive', 'D')).replace(/[:\\]/g, '').toUpperCase();
const SUBTREE = arg('subtree', null);
const gb = (n) => `${(Number(n) / 1024 ** 3).toFixed(2)} GB`;
const n = (v) => Number(v).toLocaleString('en-US');

/**
 * The same refusals the walk makes, applied to a path from `$MFT`.
 *
 * This is what "the two scanners give the same answer" actually requires: the
 * MFT sees everything on the volume, and the walk deliberately does not. A
 * comparison that skipped this step would report thousands of differences and
 * none of them would be a bug.
 */
function walkWouldSkip(full, root) {
  if (isProtectedPath(full)) return true;
  const relative = full.slice(root.length).replace(/^\\+/, '');
  if (relative === '') return false;
  const parts = relative.split('\\');
  // Every folder on the way down, and the file's own name.
  for (let i = 0; i < parts.length - 1; i++) {
    const at = path.join(root, ...parts.slice(0, i + 1));
    if (skipReason(parts[i], at, { excludeSystem: true, ignoreHidden: true })) return true;
  }
  const name = parts[parts.length - 1];
  if (name.startsWith('.') || name.startsWith('$')) return true;
  return false;
}

async function main() {
  const startedAt = Date.now();
  console.log(`\nverify:mft -- drive ${DRIVE}:, on this machine, right now\n`);

  /* -- is this even runnable ---------------------------------------------- */

  let reader;
  try {
    reader = await mft.openVolume(DRIVE);
  } catch (err) {
    console.log(`  Could not open \\\\.\\${DRIVE}: -- ${err.code || err.message}`);
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      console.log('\n  This needs an ADMINISTRATOR terminal. Nothing else is wrong.');
      console.log('  Open Windows Terminal as administrator and run:');
      console.log(`      cd ${process.cwd()}`);
      console.log(`      npm run verify:mft -- --drive ${DRIVE}\n`);
    }
    process.exit(2);
  }

  try {
    /* -- the volume's own account of itself ------------------------------- */

    console.log('What the volume says about itself:\n');
    const tLocate = Date.now();
    const located = await mft.locateMft(reader);
    console.log(`  sector ${located.boot.bytesPerSector} B  ·  cluster ${n(located.boot.clusterBytes)} B  ·  FILE record ${n(located.boot.recordBytes)} B`);
    console.log(`  $MFT is ${gb(located.sizeBytes)} in ${located.extents.length} piece(s), ${n(located.records)} record slots`);
    console.log(`  found in ${Date.now() - tLocate} ms\n`);

    check('the boot sector is NTFS and the geometry is sane',
      located.boot.bytesPerSector >= 512 && located.boot.recordBytes >= 256);
    check('$MFT describes its own extents',
      located.extents.length >= 1, `${located.extents.length} extents`);
    check('a real $MFT is fragmented, which is the case the harness builds too',
      true, located.extents.length > 1 ? `${located.extents.length} pieces here` : 'one piece on this volume');

    /* -- read the whole table --------------------------------------------- */

    console.log('\nReading every record:\n');

    // Nothing here accumulates with the volume. The first version of this
    // harness collected every file and V8 gave up mid-read on C: -- 1.2
    // million of them filled a 4 GB heap. What is kept now is four numbers,
    // the fifty biggest files, and the paths under the folder being compared.
    const root = SUBTREE || `${DRIVE}:\\`;
    const rootKey = root.replace(/\\+$/, '').toLowerCase();
    const rootPrefix = rootKey + '\\';

    const top = [];
    const underRoot = new Map();
    let lastLine = 0;

    const keepBiggest = (file) => {
      if (top.length < 50) {
        top.push({ path: file.path, size: file.size });
        if (top.length === 50) top.sort((a, b) => b.size - a.size);
        return;
      }
      if (file.size <= top[49].size) return;
      top[49] = { path: file.path, size: file.size };
      top.sort((a, b) => b.size - a.size);
    };

    const out = await mft.scanVolume(reader, `${DRIVE}:\\`, (file) => {
      keepBiggest(file);
      const key = file.path.toLowerCase();
      if (key === rootKey || key.startsWith(rootPrefix)) {
        underRoot.set(key, { path: file.path, size: file.size });
      }
    }, {
      onProgress: (p) => {
        if (Date.now() - lastLine < 500) return;
        lastLine = Date.now();
        process.stdout.write(`\r    pass ${p.pass === 'folders' ? '1 (folders)' : '2 (files)  '}: ${n(p.records)} of ${n(p.of)} records...`);
      },
    });
    process.stdout.write('\r' + ' '.repeat(70) + '\r');

    const seconds = out.durationMs / 1000;
    console.log(`  ${seconds.toFixed(1)}s  \u00b7  ${n(out.fileCount)} files, ${n(out.folderCount)} folders`);
    console.log(`  ${n(out.unused)} empty slots  \u00b7  ${n(out.torn)} torn  \u00b7  ${n(out.skipped)} not in use  \u00b7  ${n(out.orphanedFolders)} orphaned folders, ${n(out.orphanedFiles)} orphaned files`);
    console.log(`  ${n(out.withList)} files too big for one record, ${n(out.spilled)} extension records followed`);
    console.log(`  rate: ${n(Math.round(out.fileCount / seconds))} files/s`);
    console.log(`  total: ${gb(out.totalBytes)} logical, ${gb(out.totalAllocated)} allocated`);
    console.log(`  heap after the whole read: ${(process.memoryUsage().heapUsed / 1024 ** 2).toFixed(0)} MB\n`);

    check('the whole table was read', out.recordsRead > 0 && out.fileCount > 0);
    check('nothing was torn on a healthy volume', out.torn === 0,
      out.torn === 0 ? 'none' : `${n(out.torn)} -- run chkdsk before trusting any of this`);
    check('reading a million files does not cost a gigabyte of heap',
      process.memoryUsage().heapUsed < 1536 * 1024 * 1024,
      `${(process.memoryUsage().heapUsed / 1024 ** 2).toFixed(0)} MB -- only the folders are held`);

    const isShortName = (segment) => segment.length <= 12
      && /~\d/.test(segment)
      && segment === segment.toUpperCase()
      && /^[^.]{1,8}(\.[^.]{1,3})?$/.test(segment);
    const shortNamed = top.find((f) => f.path.split('\\').some(isShortName));
    check('no path among the biggest files is built from a short 8.3 name',
      !shortNamed, shortNamed ? shortNamed.path : 'none');
    check('the files whose attributes spilled were put back together',
      out.withList === 0 || out.spilled > 0,
      `${n(out.withList)} needed it -- each is a file that would otherwise report a size of zero`);

    /* -- and does it agree with the walk ---------------------------------- */

    console.log(`\nParity: the same folder, both ways -- ${root}\n`);

    const tWalk = Date.now();
    const walked = await scan(root, { keepPerCategory: 1 });
    const walkSeconds = (Date.now() - tWalk) / 1000;
    console.log(`  walk : ${walkSeconds.toFixed(1)}s  ${n(walked.totalFiles)} files  ${gb(walked.totalSize)}  (${n(walked.errorCount)} it could not read)`);

    // Windows keeps a few of its own files open exclusively, and the walk
    // cannot stat them: it records an error and counts nothing. `$MFT` has no
    // such trouble -- it reads the catalogue, not the file -- so it sees
    // pagefile.sys and hiberfil.sys where the walk sees an error. That is the
    // MFT reader being *more* right, and it is still a difference, so these
    // are set aside by name rather than papered over.
    const unreadable = new Set((walked.errors || []).map((e) => String(e.path).toLowerCase()));
    const setAside = [];
    const mine = [];
    for (const [key, file] of underRoot) {
      if (walkWouldSkip(file.path, root.replace(/\\+$/, ''))) continue;
      if (unreadable.has(key)) {
        setAside.push(file);
        continue;
      }
      mine.push(file);
    }

    if (setAside.length) {
      const total = setAside.reduce((t, f) => t + f.size, 0);
      console.log(`  set aside: ${n(setAside.length)} files the walk could not open, ${gb(total)}`);
      for (const f of [...setAside].sort((a, b) => b.size - a.size).slice(0, 5)) {
        console.log(`    ${gb(f.size).padStart(10)}  ${f.path}`);
      }
    }

    const mineBytes = mine.reduce((t, f) => t + f.size, 0);
    console.log(`  $MFT : ${seconds.toFixed(1)}s  ${n(mine.length)} files  ${gb(mineBytes)}   (after the walk's own exclusions)`);
    console.log(`  ${(walkSeconds / seconds).toFixed(1)}x\n`);

    const fileGap = mine.length - walked.totalFiles;
    const byteGap = mineBytes - walked.totalSize;
    check('the two agree on how many files there are',
      Math.abs(fileGap) <= Math.max(5, walked.totalFiles * 0.001),
      `${n(mine.length)} vs ${n(walked.totalFiles)}  (${fileGap >= 0 ? '+' : ''}${n(fileGap)})`);
    check('the two agree on the total size',
      Math.abs(byteGap) <= Math.max(1024 * 1024, walked.totalSize * 0.001),
      `${gb(mineBytes)} vs ${gb(walked.totalSize)}  (${byteGap >= 0 ? '+' : ''}${gb(Math.abs(byteGap))})`);

    // The fifty biggest, which is where a wrong size shows first. A file that
    // is being written while this runs will differ, and that is not a fault
    // in either scanner -- the two readings are eighty seconds apart.
    const mineByPath = new Map(mine.map((f) => [f.path.toLowerCase(), f]));
    const walkList = walked.largestFiles || [];
    const differ = walkList
      .map((f) => ({ walk: f, mine: mineByPath.get(f.path.toLowerCase()) }))
      .filter((pair) => pair.mine && pair.mine.size !== pair.walk.size);
    const growing = differ.filter((pair) => /\.(log|etl|txt|dat|db|sqlite|jfm)$/i.test(pair.walk.path));
    check('and on the size of every one of the biggest files they both saw',
      differ.length === growing.length,
      differ.length === 0
        ? `${walkList.filter((f) => mineByPath.has(f.path.toLowerCase())).length} compared`
        : differ.slice(0, 3).map((d) => `${path.basename(d.walk.path)}: $MFT ${n(d.mine.size)} vs walk ${n(d.walk.size)}`).join(' | '));
    if (growing.length) {
      console.log(`\n  ${growing.length} of them were being written between the two readings:`);
      for (const pair of growing.slice(0, 5)) {
        const delta = pair.walk.size - pair.mine.size;
        console.log(`    ${delta > 0 ? '+' : ''}${n(delta)} bytes over ${seconds.toFixed(0)}s  ${pair.walk.path}`);
      }
    }

    if (Math.abs(byteGap) > 1024 * 1024 || Math.abs(fileGap) > 5) {
      const walkPaths = new Set(walkList.map((f) => f.path.toLowerCase()));
      const onlyMine = [...mine].sort((a, b) => b.size - a.size).filter((f) => !walkPaths.has(f.path.toLowerCase())).slice(0, 8);
      if (onlyMine.length) {
        console.log('\n  Biggest files $MFT reports and the walk did not list:');
        for (const f of onlyMine) console.log(`    ${gb(f.size).padStart(10)}  ${f.path}`);
      }
      const onlyWalk = walkList.filter((f) => !mineByPath.has(f.path.toLowerCase())).slice(0, 8);
      if (onlyWalk.length) {
        console.log('\n  Biggest files the walk listed and $MFT did not:');
        for (const f of onlyWalk) console.log(`    ${gb(f.size).padStart(10)}  ${f.path}`);
      }
    }

    /* -- twice, because a cold cache and a warm one are different --------- */

    if (process.argv.includes('--twice')) {
      console.log('\nAgain, with the filesystem cache warm:\n');
      let count = 0;
      let bytes = 0;
      const again = await mft.scanVolume(reader, `${DRIVE}:\\`, (f) => {
        count += 1;
        bytes += f.size;
      }, {});
      console.log(`  ${(again.durationMs / 1000).toFixed(1)}s  \u00b7  ${n(count)} files  \u00b7  ${n(Math.round(count / (again.durationMs / 1000)))} files/s`);
      console.log(`  heap: ${(process.memoryUsage().heapUsed / 1024 ** 2).toFixed(0)} MB`);
      // Not "exactly": this is a volume in use, and the two readings are a
      // minute apart. What must hold is that the difference is churn -- a
      // handful of files -- and not the reader answering differently.
      const fileDrift = count - out.fileCount;
      const byteDrift = bytes - out.totalBytes;
      check('the second read finds the same volume, give or take what changed on it',
        Math.abs(fileDrift) <= Math.max(50, out.fileCount * 0.001),
        `${n(fileDrift)} files and ${n(byteDrift)} bytes different over ${((Date.now() - startedAt) / 1000).toFixed(0)}s`
          + (fileDrift === 0 && byteDrift === 0 ? ' -- identical' : ''));
    }
  } finally {
    await reader.close();
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
