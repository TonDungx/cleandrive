#!/usr/bin/env node
'use strict';

// One walk, two sources (A2).
//
//   node scripts/test-mftwalk.js
//
// The spec asks that a fast scan "pass the same filters as the ordinary
// scanner, so the two give the same answer". The way that is made true is
// that there is one walk: `lib/scanner.js` decides everything, and a source
// answers three questions for it -- list a folder, say what an entry is,
// measure a file. This checks that the `$MFT` source answers them the way the
// filesystem does, by building a real folder tree, describing that same tree
// in a synthetic `$MFT`, and scanning it both ways.
//
// What that proves and what it does not: it proves the plumbing and the
// filters, not the parsing of a real `$MFT` -- the table here is one this
// harness wrote. The parsing is covered by test-ntfs.js and test-mft.js, and
// the real disk by `npm run verify:mft`, which needs administrator.
//
// **Built on D:, not under os.tmpdir().** The system temp folder is inside
// AppData, which the scan's own rules refuse, and a fixture there would make
// every check below pass for the wrong reason.

const fs = require('node:fs');

const fsp = fs.promises;
const path = require('node:path');

const ntfs = require('../src/main/system/ntfs');
const mft = require('../src/main/system/mft');
const { mftSource } = require('../src/main/system/mft-walk');
const wire = require('../src/main/system/mft-wire');
const { scan } = require('../src/main/lib/scanner');
const { isProtectedPath } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const SECTOR = 512;
const CLUSTER = 4096;
const RECORD = 1024;
const MB = 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* a real tree                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every kind of thing the walk treats differently, so that a source which got
 * one of them wrong would show here rather than on somebody's disk.
 */
const TREE = [
  // Ordinary files of different sizes, in nested folders.
  { path: 'work\\report.docx', size: 3 * MB },
  { path: 'work\\notes.txt', size: 1024 },
  { path: 'work\\archive\\backup.iso', size: 40 * MB },
  { path: 'work\\archive\\old\\notes-2019.txt', size: 2048 },
  // A project, with the build folder its .gitignore declares (C5).
  { path: 'code\\app\\package.json', content: '{"name":"app"}' },
  { path: 'code\\app\\.gitignore', content: 'node_modules/\ndist/\n' },
  { path: 'code\\app\\src\\index.js', size: 4096 },
  { path: 'code\\app\\dist\\bundle.js', size: 6 * MB },
  // A dependency folder, which the walk skips by name.
  { path: 'code\\app\\node_modules\\left-pad\\index.js', size: 5 * MB },
  // A hidden folder, which the walk skips.
  { path: '.hidden\\secret.dat', size: 7 * MB },
  // An installed application: its out\ is its product, not scratch.
  { path: 'Editor\\Editor.exe', size: 2 * MB },
  { path: 'Editor\\unins000.exe', size: 1024 },
  { path: 'Editor\\resources\\app\\package.json', content: '{}' },
  { path: 'Editor\\resources\\app\\out\\main.js', size: 8 * MB },
  // Temp and cache, which the advisor has opinions about.
  { path: 'Temp\\leftover.tmp', size: 9 * MB },
  { path: 'AppLike\\Cache\\blob.bin', size: 11 * MB },
  // An ordinary folder and an ordinary file on this disk -- but the table
  // below gives them a cloud provider's reparse tag, which is what OneDrive's
  // sync root and its placeholder files carry. Both scanners must walk
  // straight into them. See CLOUD_TAGGED.
  { path: 'CloudLike\\photo.jpg', size: 12 * MB },
  { path: 'CloudLike\\sub\\report.pdf', size: 3 * MB },
];

/**
 * Paths the table marks as a reparse point that is *not* a link.
 *
 * A real one cannot be made by a test: only the sync engine creates a cloud
 * placeholder, and it needs OneDrive to be running and the folder to be its.
 * So these two are ordinary items on the disk, tagged only in the synthetic
 * table -- which is exactly the case that matters, because it makes the two
 * sources disagree the moment the source decides by the attribute bit rather
 * than by the tag.
 */
const CLOUD_TAGGED = new Map([
  ['CloudLike', 0x9000001a],
  ['CloudLike\\photo.jpg', 0x9000701a],
]);

/** A real junction. Both sources must refuse it, for the same reason. */
const JUNCTION = { path: 'work\\shortcut-to-archive', target: 'work\\archive' };

async function buildTree(root) {
  for (const item of TREE) {
    const full = path.join(root, item.path);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const content = item.content === undefined ? 'x' : item.content;
    await fsp.writeFile(full, content);
    if (item.size && item.size > content.length) {
      const handle = await fsp.open(full, 'r+');
      await handle.truncate(item.size);
      await handle.close();
    }
  }
  // Unelevated: libuv makes a junction with FSCTL_SET_REPARSE_POINT, which
  // needs no privilege. A symbolic link would need administrator or developer
  // mode, and carries the other of the two tags that mean "link".
  await fsp.symlink(path.join(root, JUNCTION.target), path.join(root, JUNCTION.path), 'junction');
}

/* -------------------------------------------------------------------------- */
/* the same tree, as a table                                                  */
/* -------------------------------------------------------------------------- */

function residentAttribute(type, value, { name = '' } = {}) {
  const nameBytes = Buffer.from(name, 'utf16le');
  const headerLength = 0x18 + nameBytes.length;
  const buf = Buffer.alloc(Math.ceil((headerLength + value.length) / 8) * 8);
  buf.writeUInt32LE(type, 0x00);
  buf.writeUInt32LE(buf.length, 0x04);
  buf.writeUInt8(name.length, 0x09);
  buf.writeUInt16LE(0x18, 0x0a);
  buf.writeUInt32LE(value.length, 0x10);
  buf.writeUInt16LE(headerLength, 0x14);
  nameBytes.copy(buf, 0x18);
  value.copy(buf, headerLength);
  return buf;
}

function nonResidentData(size, allocated, lcn) {
  const runs = Buffer.from([0x21, Math.max(1, Math.ceil(size / CLUSTER)) & 0xff, lcn & 0xff, (lcn >> 8) & 0xff, 0x00]);
  const buf = Buffer.alloc(Math.ceil((0x40 + runs.length) / 8) * 8);
  buf.writeUInt32LE(ntfs.ATTR.DATA, 0x00);
  buf.writeUInt32LE(buf.length, 0x04);
  buf.writeUInt8(1, 0x08);
  buf.writeUInt16LE(0x40, 0x0a);
  buf.writeUInt16LE(0x40, 0x20);
  buf.writeBigUInt64LE(BigInt(allocated), 0x28);
  buf.writeBigUInt64LE(BigInt(size), 0x30);
  buf.writeBigUInt64LE(BigInt(size), 0x38);
  runs.copy(buf, 0x40);
  return buf;
}

function standardInformation(modifiedMs, attributes) {
  const buf = Buffer.alloc(0x48);
  const ft = (ms) => (BigInt(Math.round(ms)) + 11644473600000n) * 10000n;
  for (const at of [0x00, 0x08, 0x10, 0x18]) buf.writeBigUInt64LE(ft(modifiedMs), at);
  buf.writeUInt32LE(attributes, 0x20);
  return buf;
}

/**
 * A `$REPARSE_POINT` value: the tag, then a length, then whatever that kind of
 * reparse point keeps. Only the first four bytes are read by anything here.
 */
function reparseValue(tag) {
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(tag >>> 0, 0x00);
  buf.writeUInt16LE(8, 0x04);
  return buf;
}

function fileNameValue(parent, name) {
  const nameBytes = Buffer.from(name, 'utf16le');
  const buf = Buffer.alloc(0x42 + nameBytes.length);
  buf.writeBigUInt64LE(BigInt(parent) | (1n << 48n), 0x00);
  buf.writeUInt8(name.length, 0x40);
  buf.writeUInt8(1, 0x41);
  nameBytes.copy(buf, 0x42);
  return buf;
}

function fileRecord(attributes, { isDirectory = false } = {}) {
  const buf = Buffer.alloc(RECORD);
  const sectors = RECORD / SECTOR;
  const usaOffset = 0x30;
  const usaCount = sectors + 1;
  let first = usaOffset + usaCount * 2;
  if (first % 8) first += 8 - (first % 8);

  buf.write('FILE', 0x00, 'latin1');
  buf.writeUInt16LE(usaOffset, 0x04);
  buf.writeUInt16LE(usaCount, 0x06);
  buf.writeUInt16LE(1, 0x10);
  buf.writeUInt16LE(1, 0x12);
  buf.writeUInt16LE(first, 0x14);
  buf.writeUInt16LE(1 | (isDirectory ? 2 : 0), 0x16);

  let at = first;
  for (const a of attributes) {
    a.copy(buf, at);
    at += a.length;
  }
  buf.writeUInt32LE(0xffffffff, at);
  buf.writeUInt32LE(at + 4, 0x18);
  buf.writeUInt32LE(RECORD, 0x1c);

  const mark = 0x4d4d;
  buf.writeUInt16LE(mark, usaOffset);
  for (let i = 0; i < sectors; i++) {
    const tail = (i + 1) * SECTOR - 2;
    buf.writeUInt16LE(buf.readUInt16LE(tail), usaOffset + (i + 1) * 2);
    buf.writeUInt16LE(mark, tail);
  }
  return buf;
}

/**
 * Read the real tree back off the disk and write a `$MFT` that says the same
 * thing. Reading it back rather than generating from `TREE` matters: the sizes
 * and timestamps then come from the filesystem, so a disagreement between the
 * two scans is the source's fault and not the fixture's.
 */
async function tableFor(root) {
  const records = [];
  const numberOf = new Map([[root.toLowerCase(), ntfs.ROOT_RECORD]]);
  let next = 16;

  const visit = async (dir) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const parent = numberOf.get(dir.toLowerCase());
      const stat = await fsp.lstat(full);
      const number = next++;
      numberOf.set(full.toLowerCase(), number);

      const relative = full.slice(root.length + 1);
      // A junction on the disk gets the tag Windows gave it; the two cloud
      // items get one the disk does not have (CLOUD_TAGGED).
      const cloudTag = CLOUD_TAGGED.get(relative) || 0;
      const junction = entry.isSymbolicLink();
      const tag = junction ? ntfs.REPARSE_TAG.MOUNT_POINT : cloudTag;
      const reparse = tag
        ? [residentAttribute(ntfs.ATTR.REPARSE_POINT, reparseValue(tag))]
        : [];
      const reparseBit = tag ? ntfs.FILE_ATTRIBUTE.REPARSE_POINT : 0;

      if (junction) {
        // A junction is a directory record with a reparse point and no index
        // of its own. Nothing below it: it is the same folder twice.
        records[number] = fileRecord([
          residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(stat.mtimeMs, 0x10 | reparseBit)),
          residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(parent, entry.name)),
          ...reparse,
        ], { isDirectory: true });
        continue;
      }

      if (entry.isDirectory()) {
        records[number] = fileRecord([
          residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(stat.mtimeMs, 0x10 | reparseBit)),
          residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(parent, entry.name)),
          residentAttribute(ntfs.ATTR.INDEX_ROOT, Buffer.alloc(32), { name: '$I30' }),
          ...reparse,
        ], { isDirectory: true });
        await visit(full);
        continue;
      }
      records[number] = fileRecord([
        residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(stat.mtimeMs, 0x20 | reparseBit)),
        residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(parent, entry.name)),
        stat.size > 700
          ? nonResidentData(stat.size, Math.ceil(stat.size / CLUSTER) * CLUSTER, 60 + number)
          : residentAttribute(ntfs.ATTR.DATA, Buffer.alloc(stat.size, 0x61)),
        ...reparse,
      ]);
    }
  };
  await visit(root);

  const total = Math.max(64, Math.ceil((next + 8) / 4) * 4);
  const clusters = Math.ceil((total * RECORD) / CLUSTER);
  const volume = Buffer.alloc((10 + clusters + 4) * CLUSTER);

  volume.write('NTFS    ', 0x03, 'latin1');
  volume.writeUInt16LE(SECTOR, 0x0b);
  volume.writeInt8(CLUSTER / SECTOR, 0x0d);
  volume.writeBigUInt64LE(10n, 0x30);
  volume.writeInt8(-10, 0x40);
  volume.writeInt8(1, 0x44);
  volume.writeUInt16LE(0xaa55, 0x1fe);

  const runs = Buffer.from([0x21, clusters & 0xff, 10, 0, 0x00]);
  records[0] = fileRecord([
    residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(Date.now(), 0x06)),
    residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(5, '$MFT')),
    (() => {
      const d = nonResidentData(total * RECORD, clusters * CLUSTER, 10);
      runs.copy(d, 0x40);
      return d;
    })(),
  ]);
  records[ntfs.ROOT_RECORD] = fileRecord([
    residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(Date.now(), 0x10)),
    residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(5, '.')),
  ], { isDirectory: true });

  for (let i = 0; i < total; i++) {
    (records[i] || Buffer.alloc(RECORD)).copy(volume, 10 * CLUSTER + i * RECORD);
  }
  return volume;
}

/* -------------------------------------------------------------------------- */

async function main() {
  const base = path.join('D:', path.sep, 'cleandrive-mftwalk-test');
  await fsp.rm(base, { recursive: true, force: true });
  const root = path.join(base, 'volume');
  await fsp.mkdir(root, { recursive: true });

  try {
    if (isProtectedPath(root)) throw new Error(`the fixture is somewhere the scan refuses: ${root}`);
    await buildTree(root);

    console.log('\nmft-walk: one walk, two sources\n');

    // The filesystem.
    const byWalk = await scan(root, { keepPerCategory: 50 });

    // The same tree, through a table that describes it.
    const volume = await tableFor(root);
    const reader = {
      read: async (offset, length) => Buffer.from(volume.subarray(offset, Math.min(offset + length, volume.length))),
      useSectorSize() {},
      close: async () => {},
    };
    const located = await mft.locateMft(reader);
    const collected = await mft.collect(mft.readRecords(reader, located), {});
    const { paths } = mft.resolveFolderPaths(collected.folders, root);
    const source = mftSource(collected, paths);
    const byTable = await scan(root, { keepPerCategory: 50, source });

    check('the table describes the same tree the walk saw',
      collected.files.length >= TREE.length,
      `${collected.files.length} files in the table, ${TREE.length} written`);

    console.log('\nthe two agree on the totals\n');

    check('the same number of files',
      byTable.totalFiles === byWalk.totalFiles,
      `${byTable.totalFiles} vs ${byWalk.totalFiles}`);
    check('the same number of folders',
      byTable.totalDirs === byWalk.totalDirs,
      `${byTable.totalDirs} vs ${byWalk.totalDirs}`);
    check('the same total size, to the byte',
      byTable.totalSize === byWalk.totalSize,
      `${byTable.totalSize} vs ${byWalk.totalSize}`);

    console.log('\nand on what the filters refused\n');

    const names = (result) => (result.largestFiles || []).map((f) => path.basename(f.path)).sort();
    check('the same biggest files, in the same order',
      JSON.stringify(names(byTable)) === JSON.stringify(names(byWalk)),
      `${names(byTable).slice(0, 4).join(', ')} | ${names(byWalk).slice(0, 4).join(', ')}`);

    const all = (result) => (result.largestFiles || []).map((f) => f.path.toLowerCase());
    check('node_modules is skipped by both',
      !all(byTable).some((p) => p.includes('node_modules')) && !all(byWalk).some((p) => p.includes('node_modules')),
      'a dependency folder is noise to a disk-usage scan, whichever source found it');
    check('a hidden folder is skipped by both',
      !all(byTable).some((p) => p.includes('.hidden')) && !all(byWalk).some((p) => p.includes('.hidden')));

    const safe = (result) => new Set(
      result.cleanup.groups.filter((g) => g.verdict === 'safe').flatMap((g) => g.files.map((f) => f.path.toLowerCase()))
    );
    const safeTable = safe(byTable);
    const safeWalk = safe(byWalk);
    check('the same files are called safe to delete',
      safeTable.size === safeWalk.size && [...safeTable].every((p) => safeWalk.has(p)),
      `${safeTable.size} vs ${safeWalk.size}`);
    check("an installed application's out\\ is safe in neither",
      ![...safeTable].some((p) => p.includes('\\editor\\')) && ![...safeWalk].some((p) => p.includes('\\editor\\')),
      'the rule that catches it reads the folder listing, which is why the source has to hand one over');
    check("a project's declared dist\\ is build output in both",
      [...safeTable].some((p) => p.endsWith('bundle.js')) && [...safeWalk].some((p) => p.endsWith('bundle.js')),
      'the .gitignore is read from the disk either way -- $MFT holds no contents');

    console.log('\nand on every byte of every file\n');

    const sizes = (result) => {
      const out = new Map();
      for (const f of result.largestFiles || []) out.set(f.path.toLowerCase(), f.size);
      return out;
    };
    const tableSizes = sizes(byTable);
    const walkSizes = sizes(byWalk);
    const differ = [...walkSizes].filter(([p, size]) => tableSizes.get(p) !== size);
    check('no file differs in size between the two',
      differ.length === 0,
      differ.length ? differ.slice(0, 3).map(([p, s]) => `${path.basename(p)}: ${tableSizes.get(p)} vs ${s}`).join(' | ') : `${walkSizes.size} compared`);

    const types = (result) => (result.byType || []).map((t) => `${t.ext}:${t.size}`).sort().join(',');
    check('the same sizes per file type',
      types(byTable) === types(byWalk),
      types(byTable).slice(0, 60));

    console.log('\nand on which reparse points are links\n');

    // The check that fails the moment a source decides by the attribute bit
    // instead of by the tag. `lib/real-fs.js` records what that cost when the
    // ordinary walk had the same fault: the whole of OneDrive, about 15 GB,
    // because Windows had put Documents, Pictures and the Desktop in there.
    const cloudFiles = (result) => all(result).filter((p) => p.includes('\\cloudlike\\'));
    check('a cloud provider’s reparse point is walked into, by both',
      cloudFiles(byTable).length === 2 && cloudFiles(byWalk).length === 2,
      `$MFT ${cloudFiles(byTable).length}, walk ${cloudFiles(byWalk).length} of 2 -- the tag says cloud, not link`);
    check('and the file inside it keeps its bytes',
      tableSizes.get(path.join(root, 'CloudLike', 'photo.jpg').toLowerCase()) === 12 * MB,
      'a placeholder file carries a reparse tag too');

    const junctionPath = path.join(root, JUNCTION.path).toLowerCase();
    check('a junction is refused by both, so its target is not counted twice',
      !all(byTable).some((p) => p.startsWith(junctionPath)) && !all(byWalk).some((p) => p.startsWith(junctionPath)),
      'a real junction on this disk, tag MOUNT_POINT');
    check('and the folder it points at is still counted once',
      all(byTable).some((p) => p.endsWith('backup.iso')),
      'work\\archive is reached by its own name');

    console.log('\nand after a trip through the pipe\n');

    // The elevated helper does not hand the table over; it sends it in
    // pieces, as JSON, and the app builds its own out of them
    // (`system/mft-wire.js`). That format is where a column could quietly go
    // missing, so the whole table goes through it here -- serialised and
    // parsed exactly as the pipe would, no volume and no prompt -- and the
    // scan is run a third time against what comes out.
    const sink = wire.receiver();
    const pieces = [...wire.chunksOf(collected.folders, collected.files, { maxBytes: 4096, maxRecords: 3 })];
    let widest = 0;
    for (const piece of pieces) {
      const line = JSON.stringify({ id: 1, chunk: piece });
      widest = Math.max(widest, Buffer.byteLength(line, 'utf8'));
      sink.accept(JSON.parse(line).chunk);
    }
    check('the table survives being cut into pieces and put back together',
      sink.files.length === collected.files.length && sink.folders.size === collected.folders.size,
      `${pieces.length} pieces, widest ${widest} B · ${sink.files.length} files, ${sink.folders.size} folders`);

    const { paths: sentPaths } = mft.resolveFolderPaths(sink.folders, root);
    const byPipe = await scan(root, { keepPerCategory: 50, source: mftSource(sink, sentPaths) });
    check('and a scan of what arrived is the scan of what was sent, to the byte',
      byPipe.totalFiles === byWalk.totalFiles && byPipe.totalSize === byWalk.totalSize && byPipe.totalDirs === byWalk.totalDirs,
      `${byPipe.totalFiles} files, ${byPipe.totalSize} bytes, ${byPipe.totalDirs} folders`);

    const pipeSizes = sizes(byPipe);
    const lost = [...walkSizes].filter(([p, size]) => pipeSizes.get(p) !== size);
    check('no file lost a byte on the way',
      lost.length === 0,
      lost.length ? lost.slice(0, 3).map(([p]) => path.basename(p)).join(', ') : `${walkSizes.size} compared`);

    // The columns that do not cross are the ones nothing on this side reads.
    // If that ever stops being true, this is where it shows.
    check('every column the walk reads made the trip',
      wire.COLUMNS.every((c) => sink.files[c] !== undefined) && sink.files.reparse[0] !== undefined,
      wire.COLUMNS.join(', '));
    check('and a cloud tag is still a cloud tag on the other side',
      [...sink.folders.values()].some((f) => f.reparseTag === 0x9000001a),
      'the reparse tag is a column, not something inferred from the attribute bit');

    console.log('\nwhat the source refuses\n');

    let code = null;
    try {
      await source.list(path.join(root, 'nowhere'));
    } catch (err) {
      code = err.code;
    }
    check('a folder that is not in the table is ENOENT, not a wrong answer', code === 'ENOENT', String(code));
  } finally {
    await fsp.rm(base, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
