#!/usr/bin/env node
'use strict';

// The half of the `$MFT` reader that cannot be checked without a UAC prompt:
// opening a real volume, and agreeing with the ordinary walk about what is on
// it (A2's parity requirement).
//
//   Run this from an ADMINISTRATOR terminal:
//     npm run verify:mft -- --drive D
//     npm run verify:mft -- --drive D --subtree "D:\\personal_projects"
//     npm run verify:mft -- --drive C --twice
//
// Without administrator it says so and stops -- opening `\\.\D:` is refused
// with EPERM, measured, both from Node and through a P/Invoke shim.
//
// Read-only from beginning to end: the volume is opened for reading, the
// ordinary scanner is the same one the app runs, and nothing is written
// anywhere. It does not need the app to be closed.
//
// ## What "parity" means here
//
// An earlier version of this compared the raw list of files `$MFT` reports
// against the walk's, and to do that it had to know which of them the walk
// would have skipped -- so it carried its own copy of the exclusion rules.
// That was a third implementation of the thing A2 exists to have only one of,
// and it is gone. Both sides now go through `scan()`: same walk, same
// filters, same advisor, one of them answering out of the filesystem and the
// other out of the table. A difference is a difference in the table, which is
// the only kind worth reporting.
//
// Everything with logic in it is covered without admin by test-ntfs.js,
// test-mft.js and test-mftwalk.js. What is left here is: does a real disk
// look the way those say it should.

const path = require('node:path');

const mft = require('../src/main/system/mft');
const wire = require('../src/main/system/mft-wire');
const { sourceFor } = require('../src/main/system/mft-read');
const { scan } = require('../src/main/lib/scanner');

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
const mb = (n) => `${(Number(n) / 1024 ** 2).toFixed(1)} MB`;
const n = (v) => Number(v).toLocaleString('en-US');
const heap = () => `${(process.memoryUsage().heapUsed / 1024 ** 2).toFixed(0)} MB`;

/** Files a growing log would explain, when the two readings are a minute apart. */
const CHURNS = /\.(log|etl|txt|dat|db|sqlite|jfm|json|tmp|ldb|pma)$/i;

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
    console.log(`  sector ${located.boot.bytesPerSector} B  \u00b7  cluster ${n(located.boot.clusterBytes)} B  \u00b7  FILE record ${n(located.boot.recordBytes)} B`);
    console.log(`  $MFT is ${gb(located.sizeBytes)} in ${located.extents.length} piece(s), ${n(located.records)} record slots`);
    console.log(`  found in ${Date.now() - tLocate} ms\n`);

    check('the boot sector is NTFS and the geometry is sane',
      located.boot.bytesPerSector >= 512 && located.boot.recordBytes >= 256);
    check('$MFT describes its own extents',
      located.extents.length >= 1, `${located.extents.length} extents`);

    /* -- read the whole table --------------------------------------------- */

    console.log('\nReading every record:\n');

    let lastLine = 0;
    const tRead = Date.now();
    const collected = await mft.collect(
      mft.readRecords(reader, located, {
        onProgress: (p) => {
          if (Date.now() - lastLine < 500) return;
          lastLine = Date.now();
          process.stdout.write(`\r    ${n(p.records)} of ${n(p.of)} records...`);
        },
      }),
      {}
    );
    process.stdout.write('\r' + ' '.repeat(70) + '\r');
    const readMs = Date.now() - tRead;

    const stats = collected.stats;
    const seconds = readMs / 1000;
    // The whole volume, before any of the walk's exclusions. This is what a
    // second read has to agree with; comparing it against the *scan's* total
    // would be comparing 303 GB of disk with 215 GB of scan.
    let tableBytes = 0;
    for (let i = 0; i < collected.files.length; i++) tableBytes += collected.files.size[i];
    console.log(`  ${seconds.toFixed(1)}s  \u00b7  ${n(collected.files.length)} files, ${n(collected.folders.size)} folders`);
    console.log(`  ${n(stats.unused)} empty slots  \u00b7  ${n(stats.torn)} torn  \u00b7  ${n(stats.skipped)} not in use`);
    console.log(`  ${n(stats.withList)} records too big for one, ${n(collected.spill.size)} extension records followed`);
    console.log(`  ${gb(tableBytes)} on the whole volume, before any of the walk's exclusions`);
    console.log(`  rate: ${n(Math.round(collected.files.length / seconds))} files/s  \u00b7  heap: ${heap()}\n`);

    check('the whole table was read', located.records > 0 && collected.files.length > 0);
    check('nothing was torn on a healthy volume', stats.torn === 0,
      stats.torn === 0 ? 'none' : `${n(stats.torn)} -- run chkdsk before trusting any of this`);
    check('the files whose attributes spilled were put back together',
      stats.withList === 0 || collected.spill.size > 0,
      `${n(stats.withList)} needed it -- each is a file that would otherwise report a size of zero`);

    const reparsed = [...collected.folders.values()].filter((f) => f.reparseTag);
    const links = reparsed.filter((f) => f.reparseTag === 0xa0000003 || f.reparseTag === 0xa000000c);
    const others = reparsed.filter((f) => !(f.reparseTag === 0xa0000003 || f.reparseTag === 0xa000000c));
    console.log(`  reparse points: ${n(reparsed.length)} folders -- ${n(links.length)} links (junction or symlink), ${n(others.length)} something else`);
    if (others.length) {
      const tags = [...new Set(others.map((f) => `0x${(f.reparseTag >>> 0).toString(16)}`))].slice(0, 6);
      console.log(`    the others carry ${tags.join(', ')} -- cloud placeholders and the like, which a walk goes into`);
    }
    check('reparse points are told apart by tag, not by the attribute bit',
      reparsed.length === 0 || links.length + others.length === reparsed.length,
      `calling all ${n(reparsed.length)} of them links is what lost the whole of OneDrive once -- see lib/real-fs.js`);

    /* -- the same folder, both ways --------------------------------------- */

    const root = SUBTREE || `${DRIVE}:\\`;
    console.log(`\nParity, both scans through scan() -- ${root}\n`);

    const built = sourceFor(collected, `${DRIVE}:\\`);
    console.log(`  ${n(built.paths.size)} folder paths resolved  \u00b7  ${n(built.orphaned)} orphaned, ${n(built.looped)} in a loop`);

    // No cap on the per-category lists. At the shipped default of 100 the
    // two scans can hold *different* hundreds -- the catalogue sees a few
    // files the walk cannot open, so every capped list shifts by that many
    // and the difference looks like a disagreement when it is a boundary.
    // Asking for all of them makes the comparison mean what it says.
    const UNCAPPED = { keepPerCategory: 1e6 };

    const tTable = Date.now();
    const byTable = await scan(root, { ...UNCAPPED, source: built.source });
    const tableMs = Date.now() - tTable;

    const tWalk = Date.now();
    const byWalk = await scan(root, UNCAPPED);
    const walkMs = Date.now() - tWalk;

    console.log(`  walk : ${(walkMs / 1000).toFixed(1)}s  ${n(byWalk.totalFiles)} files  ${gb(byWalk.totalSize)}  (${n(byWalk.errorCount)} it could not read)`);
    console.log(`  $MFT : ${((readMs + tableMs) / 1000).toFixed(1)}s  ${n(byTable.totalFiles)} files  ${gb(byTable.totalSize)}  (${(readMs / 1000).toFixed(1)}s reading the table, ${(tableMs / 1000).toFixed(1)}s walking it)`);
    console.log(`  heap after both: ${heap()}\n`);
    // Deliberately not a ratio. `$MFT` is steady; the walk is not, and how
    // long it takes depends mostly on how warm the filesystem cache is. What
    // is worth saying is the shape: the worst case of one against the best
    // case of the other.

    // Windows keeps a few of its own files open exclusively, and the walk
    // cannot stat them: it records an error and counts nothing. `$MFT` has no
    // such trouble -- it reads the catalogue, not the file -- so it sees
    // pagefile.sys and hiberfil.sys where the walk sees an error. That is the
    // MFT reader being *more* right, and it is still a difference, so these
    // are set aside by name rather than papered over.
    const unreadable = new Set((byWalk.errors || []).map((e) => String(e.path).toLowerCase()));
    const setAside = (byTable.largestFiles || []).filter((f) => unreadable.has(f.path.toLowerCase()));
    const setAsideBytes = setAside.reduce((t, f) => t + f.size, 0);
    if (setAside.length) {
      console.log(`  set aside: ${n(setAside.length)} files the walk could not open, ${gb(setAsideBytes)}`);
      for (const f of setAside.slice(0, 5)) console.log(`    ${gb(f.size).padStart(10)}  ${f.path}`);
      console.log('');
    }

    const fileGap = byTable.totalFiles - setAside.length - byWalk.totalFiles;
    const byteGap = byTable.totalSize - setAsideBytes - byWalk.totalSize;
    check('the two agree on how many files there are',
      Math.abs(fileGap) <= Math.max(5, byWalk.totalFiles * 0.001),
      `${n(byTable.totalFiles - setAside.length)} vs ${n(byWalk.totalFiles)}  (${fileGap >= 0 ? '+' : ''}${n(fileGap)})`);
    check('and on the total size',
      Math.abs(byteGap) <= Math.max(1024 * 1024, byWalk.totalSize * 0.001),
      `${gb(byTable.totalSize - setAsideBytes)} vs ${gb(byWalk.totalSize)}  (${byteGap >= 0 ? '+' : ''}${gb(Math.abs(byteGap))})`);
    check('and on how many folders they entered',
      Math.abs(byTable.totalDirs - byWalk.totalDirs) <= Math.max(5, byWalk.totalDirs * 0.001),
      `${n(byTable.totalDirs)} vs ${n(byWalk.totalDirs)}`);

    // The biggest files, which is where a wrong size shows first. A file that
    // is being written while this runs will differ, and that is not a fault
    // in either scanner -- the two readings are a minute apart.
    const tableByPath = new Map((byTable.largestFiles || []).map((f) => [f.path.toLowerCase(), f]));
    const walkList = byWalk.largestFiles || [];
    const shared = walkList.filter((f) => tableByPath.has(f.path.toLowerCase()));
    const differ = shared.filter((f) => tableByPath.get(f.path.toLowerCase()).size !== f.size);
    const growing = differ.filter((f) => CHURNS.test(f.path));
    check('and on the size of every one of the biggest files they both saw',
      differ.length === growing.length,
      differ.length === 0
        ? `${shared.length} compared`
        : differ.slice(0, 3).map((f) => `${path.basename(f.path)}: $MFT ${n(tableByPath.get(f.path.toLowerCase()).size)} vs walk ${n(f.size)}`).join(' | '));
    if (growing.length) {
      console.log(`\n  ${growing.length} of them were being written between the two readings:`);
      for (const f of growing.slice(0, 5)) {
        const delta = f.size - tableByPath.get(f.path.toLowerCase()).size;
        console.log(`    ${delta > 0 ? '+' : ''}${n(delta)} bytes  ${f.path}`);
      }
      console.log('');
    }

    // `largestFiles` is the hundred biggest, and the two hundreds do not end
    // in the same place: the catalogue's list also holds the files the walk
    // could not open (pagefile.sys and its kind), so an equal number of small
    // entries drop off the bottom of it. Comparing the lists whole reports
    // those as missing files, which they are not.
    //
    // So the comparison stops at the size where both lists are still
    // complete: the larger of the two smallest entries. Above that line
    // neither list has been cut, and a difference is a real one.
    const floorOf = (list) => (list.length ? Math.min(...list.map((f) => f.size)) : 0);
    const floor = Math.max(floorOf(walkList), floorOf(byTable.largestFiles || []));
    const above = (list) => list.filter((f) => f.size >= floor);
    const missing = above(walkList).filter((f) => !tableByPath.has(f.path.toLowerCase())).slice(0, 8);
    const extra = above(byTable.largestFiles || [])
      .filter((f) => !walkList.some((w) => w.path.toLowerCase() === f.path.toLowerCase()) && !unreadable.has(f.path.toLowerCase()))
      .slice(0, 8);
    check('neither scanner found a large file the other missed',
      missing.length === 0 && extra.length === 0,
      `${missing.length} only the walk saw, ${extra.length} only $MFT saw, down to ${gb(floor)} where both lists are still whole`);
    for (const f of missing) console.log(`    only the walk:  ${gb(f.size).padStart(10)}  ${f.path}`);
    for (const f of extra) console.log(`    only $MFT:      ${gb(f.size).padStart(10)}  ${f.path}`);

    /* -- the advisor, which is the answer anybody actually reads ---------- */

    // `byType` is the twenty-five biggest kinds, and it is cut off the same
    // way for the same reason: hiberfil.sys and swapfile.sys put 6.5 GB into
    // the catalogue's `sys` bucket, which moves the twenty-fifth place. Same
    // remedy -- compare down to where both lists are still whole.
    const byType = (result) => new Map((result.byType || []).map((t) => [t.ext, t.size]));
    const walkTypes = byType(byWalk);
    const tableTypes = byType(byTable);
    const typeFloor = Math.max(
      Math.min(...walkTypes.values(), Infinity),
      Math.min(...tableTypes.values(), Infinity)
    );
    const typeGaps = [...walkTypes].filter(([ext, size]) => {
      if (size < typeFloor) return false;
      const mine = tableTypes.get(ext) || 0;
      return Math.abs(mine - size) > Math.max(1024 * 1024, size * 0.01);
    });
    check('the same bytes under the same file types',
      typeGaps.length === 0,
      typeGaps.length
        ? typeGaps.slice(0, 3).map(([e, s]) => `${e}: ${gb(tableTypes.get(e) || 0)} vs ${gb(s)}`).join(' | ')
        : `${[...walkTypes.values()].filter((s) => s >= typeFloor).length} types compared, down to ${gb(typeFloor)}`);

    const safeOf = (result) => new Set(
      (result.cleanup.groups || [])
        .filter((g) => g.verdict === 'safe')
        .flatMap((g) => g.files.map((f) => f.path.toLowerCase()))
    );
    const safeWalk = safeOf(byWalk);
    const safeTable = safeOf(byTable);
    const onlyTable = [...safeTable].filter((p) => !safeWalk.has(p) && !unreadable.has(p));
    const onlyWalk = [...safeWalk].filter((p) => !safeTable.has(p));
    check('and the same verdicts -- nothing is called safe by one scanner only',
      onlyTable.length + onlyWalk.length <= Math.max(5, safeWalk.size * 0.001),
      `${safeTable.size} vs ${safeWalk.size}; ${onlyTable.length} only $MFT, ${onlyWalk.length} only the walk`);
    for (const p of onlyTable.slice(0, 5)) console.log(`    safe to $MFT only:  ${p}`);
    for (const p of onlyWalk.slice(0, 5)) console.log(`    safe to the walk only:  ${p}`);

    const protectedGap = Math.abs(byTable.cleanup.protectedPaths.length - byWalk.cleanup.protectedPaths.length);
    check('and they refused the same protected folders',
      protectedGap <= 2,
      `${byTable.cleanup.protectedPaths.length} vs ${byWalk.cleanup.protectedPaths.length}`);

    /* -- and it all has to fit down a pipe -------------------------------- */

    console.log('\nThrough the wire the helper actually uses:\n');

    const tWire = Date.now();
    let wireBytes = 0;
    let widest = 0;
    let pieces = 0;
    const sink = wire.receiver();
    for (const piece of wire.chunksOf(collected.folders, collected.files)) {
      const line = JSON.stringify({ id: 1, chunk: piece });
      const size = Buffer.byteLength(line, 'utf8');
      wireBytes += size;
      widest = Math.max(widest, size);
      pieces += 1;
      sink.accept(JSON.parse(line).chunk);
    }
    const wireMs = Date.now() - tWire;
    console.log(`  ${mb(wireBytes)} in ${n(pieces)} pieces, widest ${(widest / 1024).toFixed(0)} KB`);
    console.log(`  ${(wireBytes / collected.files.length).toFixed(1)} bytes per file  \u00b7  ${(wireMs / 1000).toFixed(1)}s to write and read it all back`);
    console.log(`  heap after holding both copies: ${heap()}\n`);

    const { MAX_LINE_BYTES } = require('../src/main/helper/protocol');
    check('no piece is bigger than a line the app will accept',
      widest < MAX_LINE_BYTES,
      `${(widest / 1024).toFixed(0)} KB against a ${(MAX_LINE_BYTES / 1024).toFixed(0)} KB limit`);
    check('the table that arrived is the table that was sent',
      sink.files.length === collected.files.length && sink.folders.size === collected.folders.size,
      `${n(sink.files.length)} files, ${n(sink.folders.size)} folders`);

    const rebuilt = sourceFor(sink, `${DRIVE}:\\`);
    const byPipe = await scan(root, { source: rebuilt.source });
    check('and a scan of it is the same scan, to the byte',
      byPipe.totalFiles === byTable.totalFiles && byPipe.totalSize === byTable.totalSize,
      `${n(byPipe.totalFiles)} files, ${gb(byPipe.totalSize)}`);

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
      // Not "exactly": this is a volume in use, and the two readings are a
      // minute apart. What must hold is that the difference is churn -- a
      // handful of files -- and not the reader answering differently.
      const fileDrift = count - collected.files.length;
      const byteDrift = bytes - tableBytes;
      check('the second read finds the same volume, give or take what changed on it',
        Math.abs(fileDrift) <= Math.max(50, collected.files.length * 0.001)
          && Math.abs(byteDrift) <= Math.max(256 * 1024 * 1024, tableBytes * 0.001),
        `${n(fileDrift)} files and ${gb(byteDrift)} different over ${((Date.now() - startedAt) / 1000).toFixed(0)}s`
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
