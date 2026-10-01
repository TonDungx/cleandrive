#!/usr/bin/env node
'use strict';

// Reading a whole volume's `$MFT` (A2), against a volume built in memory.
//
//   node scripts/test-mft.js
//
// The volume here is a Buffer with a real NTFS boot sector, a real `$MFT`
// whose record 0 describes its own extents, and real FILE records inside it --
// including a fragmented `$MFT` in two pieces, because that is the case a
// reader gets wrong and no small test disk would ever produce.
//
// Built rather than captured, for the same reason as test-ntfs.js: opening a
// volume needs administrator, and a check that only runs behind a UAC prompt
// is a check that does not run. `scripts/verify-mft.js` covers the four lines
// this cannot: the ones that open a real disk.

const ntfs = require('../src/main/system/ntfs');
const mft = require('../src/main/system/mft');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const {
  SECTOR, CLUSTER, RECORD,
  residentAttribute, nonResidentAttribute, standardInformation, fileNameValue,
  runList, attributeListValue, fileRecord, bufferReader,
} = require('./lib/ntfs-fixture');

/* -------------------------------------------------------------------------- */
/* building a volume                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A whole NTFS volume in a Buffer.
 *
 * `$MFT` is deliberately in **two pieces**, at clusters 10 and 40, because a
 * reader that assumes one contiguous run works perfectly on a fresh disk and
 * silently loses half the files on a used one.
 */
function buildVolume(entries) {
  const clusters = 128;
  const volume = Buffer.alloc(clusters * CLUSTER);

  // A boot sector saying where $MFT starts.
  volume.write('NTFS    ', 0x03, 'latin1');
  volume.writeUInt16LE(SECTOR, 0x0b);
  volume.writeInt8(CLUSTER / SECTOR, 0x0d);
  volume.writeBigUInt64LE(BigInt(clusters * CLUSTER / SECTOR), 0x28);
  volume.writeBigUInt64LE(10n, 0x30);
  volume.writeBigUInt64LE(2n, 0x38);
  volume.writeInt8(-10, 0x40); // 2^10 = 1024-byte records
  volume.writeInt8(1, 0x44);
  volume.writeUInt16LE(0xaa55, 0x1fe);

  // Sixteen records fit in a cluster's worth of $MFT... four per 4 KB cluster.
  const perCluster = CLUSTER / RECORD;
  const records = [];

  // 0: $MFT itself. Its $DATA names the two pieces: 4 clusters at 10, then
  // 4 more at 40 (a delta of +30 from the first).
  const mftRuns = runList([[8, 10], [8, 30]]);
  const totalRecords = 16 * perCluster;
  records[0] = fileRecord({
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation()),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(5, '$MFT')),
      nonResidentAttribute(ntfs.ATTR.DATA, {
        size: totalRecords * RECORD, allocated: 16 * CLUSTER, runs: mftRuns,
      }),
    ],
  });

  // 5: the root directory.
  records[5] = fileRecord({
    isDirectory: true,
    attributes: [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(Date.UTC(2026, 0, 1), 0x10)),
      residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(5, '.')),
    ],
  });

  for (const entry of entries) {
    // An extension record: its attributes belong to the base named here, and
    // it is not a file of its own.
    if (entry.extensionOf !== undefined) {
      const spilled = [];
      for (const link of entry.links || []) {
        spilled.push(residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(link.parent, link.name, link.namespace === undefined ? 1 : link.namespace)));
      }
      if (entry.size !== undefined) {
        spilled.push(nonResidentAttribute(ntfs.ATTR.DATA, {
          size: entry.size,
          allocated: entry.allocated === undefined ? Math.ceil(entry.size / CLUSTER) * CLUSTER : entry.allocated,
          runs: runList([[Math.max(1, Math.ceil(entry.size / CLUSTER)), 70 + entry.number]]),
        }));
      }
      records[entry.number] = fileRecord({ attributes: spilled, baseRecord: entry.extensionOf });
      continue;
    }

    const attributes = [
      residentAttribute(ntfs.ATTR.STANDARD_INFORMATION, standardInformation(entry.modifiedMs || Date.UTC(2026, 2, 3), entry.isDirectory ? 0x10 : 0x20)),
    ];
    for (const link of entry.links || [{ parent: entry.parent, name: entry.name }]) {
      attributes.push(residentAttribute(ntfs.ATTR.FILE_NAME, fileNameValue(link.parent, link.name, link.namespace === undefined ? 1 : link.namespace)));
    }
    if (entry.attributeList) {
      attributes.push(residentAttribute(ntfs.ATTR.ATTRIBUTE_LIST, attributeListValue(entry.attributeList)));
    }
    if (entry.isDirectory) {
      attributes.push(residentAttribute(ntfs.ATTR.INDEX_ROOT, Buffer.alloc(32), { name: '$I30' }));
    }
    if (entry.dataAtLaterVcn) {
      // The piece of a split $DATA that does NOT start at VCN 0: NTFS zeroes
      // its size fields, and a reader that trusts them reports no size at all.
      const later = nonResidentAttribute(ntfs.ATTR.DATA, {
        size: 0, allocated: 0, runs: runList([[4, 500]]),
      });
      later.writeBigUInt64LE(BigInt(entry.dataAtLaterVcn), 0x10); // start VCN
      attributes.push(later);
    }
    if (!entry.isDirectory && !entry.attributeList) {
      if (entry.resident) {
        attributes.push(residentAttribute(ntfs.ATTR.DATA, Buffer.alloc(entry.size, 0x61)));
      } else {
        attributes.push(nonResidentAttribute(ntfs.ATTR.DATA, {
          size: entry.size,
          allocated: entry.allocated === undefined ? Math.ceil(entry.size / CLUSTER) * CLUSTER : entry.allocated,
          runs: runList([[Math.max(1, Math.ceil(entry.size / CLUSTER)), 60 + entry.number]]),
          flags: entry.sparse ? 0x8000 : 0,
        }));
      }
    }
    records[entry.number] = fileRecord({
      attributes,
      isDirectory: Boolean(entry.isDirectory),
      inUse: entry.inUse === false ? false : true,
      hardLinkCount: (entry.links || [1]).length,
      baseRecord: entry.baseRecord || 0,
    });
  }

  // Lay the records into the two pieces of $MFT.
  for (let i = 0; i < totalRecords; i++) {
    const record = records[i] || Buffer.alloc(RECORD);
    const piece = i < 8 * perCluster ? 0 : 1;
    const within = piece === 0 ? i : i - 8 * perCluster;
    const base = (piece === 0 ? 10 : 40) * CLUSTER + within * RECORD;
    record.copy(volume, base);
  }

  return volume;
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log('\nmft: opening the volume itself, not its root folder\n');

  {
    // Under Electron 33's Node, `path.toNamespacedPath('\\\\.\\D:')` is
    // `\\\\.\\D:\\` -- the root folder -- and `fs.open` applies it to any
    // string. This runs under the system's Node, where it does not, so the
    // only way to hold the fix here is to see what is handed to `open`.
    let asked = null;
    const fakeOpen = async (p) => {
      asked = p;
      return { read: async () => ({ bytesRead: 0 }), close: async () => {} };
    };
    await mft.openVolume('d', { open: fakeOpen });
    check('openVolume hands open() a Buffer, which no Node rewrites', Buffer.isBuffer(asked), typeof asked);
    check('naming the volume device and nothing after it', Buffer.isBuffer(asked) && asked.toString('utf8') === '\\\\.\\D:', String(asked));
  }

  console.log('\nmft: finding $MFT through its own record\n');

  const entries = [
    { number: 16, name: 'Projects', parent: 5, isDirectory: true },
    { number: 17, name: 'cleandrive', parent: 16, isDirectory: true },
    { number: 18, name: 'README.md', parent: 17, size: 4096 },
    { number: 19, name: 'big.iso', parent: 17, size: 5 * 1024 * 1024, allocated: 5 * 1024 * 1024 },
    { number: 20, name: 'note.txt', parent: 5, size: 40, resident: true },
    { number: 21, name: 'ext4.vhdx', parent: 16, size: 64 * 1024 * 1024, allocated: 8 * 1024 * 1024, sparse: true },
    // Deep enough to prove the parent chain is walked, not guessed.
    { number: 22, name: 'src', parent: 17, isDirectory: true },
    { number: 23, name: 'main', parent: 22, isDirectory: true },
    { number: 24, name: 'index.js', parent: 23, size: 8192 },
    // One file, two names, in two folders.
    { number: 25, name: 'shared.dll', parent: 16, size: 2048, links: [{ parent: 16, name: 'shared.dll' }, { parent: 17, name: 'shared.dll' }] },
    // A deleted record, which must not appear anywhere.
    { number: 26, name: 'gone.tmp', parent: 5, size: 100, inUse: false },
    // A file whose folder does not exist: orphaned, not attached to the root.
    { number: 27, name: 'lost.dat', parent: 900, size: 512 },

    // A file fragmented enough that its attributes did not fit in one record:
    // the base holds an $ATTRIBUTE_LIST and a $DATA piece with no sizes in it,
    // and the real name and size are in record 29. This is the case that made
    // 124 GB of this machine's C: disappear, with the file count still right.
    {
      number: 28,
      parent: 16,
      name: 'PLACEH~1',
      links: [{ parent: 16, name: 'PLACEH~1', namespace: 2 }],
      dataAtLaterVcn: 4,
      attributeList: [
        { type: ntfs.ATTR.STANDARD_INFORMATION, record: 28 },
        { type: ntfs.ATTR.FILE_NAME, record: 28 },
        { type: ntfs.ATTR.FILE_NAME, record: 29 },
        { type: ntfs.ATTR.DATA, record: 29, startVcn: 0 },
        { type: ntfs.ATTR.DATA, record: 28, startVcn: 4 },
      ],
    },
    // A FOLDER whose attributes did not fit either: the base record carries
    // only the 8.3 name and the real one is in record 31. Measured on this
    // machine: `C:\\Users\\...\\Documents\\Virtual Machines` is exactly this,
    // and reading the base record's answer put 9 GB of virtual disks under a
    // path spelled `VIRTUA~1` -- one that resolves, and that nobody would
    // recognise or be able to search for.
    {
      number: 30,
      parent: 5,
      isDirectory: true,
      name: 'VIRTUA~1',
      links: [{ parent: 5, name: 'VIRTUA~1', namespace: 2 }],
      attributeList: [
        { type: ntfs.ATTR.STANDARD_INFORMATION, record: 30 },
        { type: ntfs.ATTR.FILE_NAME, record: 30 },
        { type: ntfs.ATTR.FILE_NAME, record: 31 },
      ],
    },
    {
      number: 31,
      extensionOf: 30,
      links: [{ parent: 5, name: 'Virtual Machines', namespace: 1 }],
    },
    { number: 32, name: 'Ubuntu-s001.vmdk', parent: 30, size: 2048 },

    // A file with a long name and the 8.3 alias NTFS gives it, both in the
    // same folder. That is most files on a real volume -- 850,819 of C:'s
    // 1,196,520 -- and it is not a hard link.
    {
      number: 33,
      parent: 16,
      name: 'Quarterly Report.docx',
      size: 4096,
      links: [
        { parent: 16, name: 'Quarterly Report.docx', namespace: 1 },
        { parent: 16, name: 'QUARTE~1.DOC', namespace: 2 },
      ],
    },

    {
      number: 29,
      extensionOf: 28,
      size: 40 * 1024 * 1024,
      allocated: 40 * 1024 * 1024,
      links: [{ parent: 16, name: 'Ubuntu Server-s002.vmdk', namespace: 1 }],
    },
  ];

  const volume = buildVolume(entries);
  const reader = bufferReader(volume);

  const located = await mft.locateMft(reader);
  check('the boot sector gives the geometry',
    located.boot.clusterBytes === CLUSTER && located.boot.recordBytes === RECORD,
    `${located.boot.clusterBytes} / ${located.boot.recordBytes}`);
  check('$MFT record 0 describes $MFT, in two pieces',
    located.extents.length === 2,
    located.extents.map((e) => `${Number(e.offset) / CLUSTER}+${Number(e.length) / CLUSTER}`).join(', '));
  check('the second piece is where the run list said, not after the first',
    Number(located.extents[1].offset) === 40 * CLUSTER,
    String(Number(located.extents[1].offset) / CLUSTER));

  console.log('\nmft: every record, across both pieces\n');

  const out = await mft.readVolume(reader, 'D:\\');
  const byPath = new Map([...out.files, ...out.dirs].map((f) => [f.path, f]));
  const paths = [...byPath.keys()].sort();

  check('a file in the first piece of $MFT is found',
    byPath.has('D:\\Projects\\cleandrive\\README.md'), paths.slice(0, 3).join(' | '));
  check('a file in the second piece is found too',
    byPath.has('D:\\Projects\\cleandrive\\src\\main\\index.js'),
    'a reader that assumed one contiguous run would lose everything past record 15');
  check('a path is built by walking parents, however deep',
    byPath.get('D:\\Projects\\cleandrive\\src\\main\\index.js').size === 8192);
  check('a file in the root has the root as its parent',
    byPath.has('D:\\note.txt'));

  console.log('\nmft: the sizes\n');

  check('a non-resident file reports its length and its allocation',
    byPath.get('D:\\Projects\\cleandrive\\big.iso').size === 5 * 1024 * 1024
      && byPath.get('D:\\Projects\\cleandrive\\big.iso').allocated === 5 * 1024 * 1024);
  check('a resident file has its length and is marked resident',
    byPath.get('D:\\note.txt').size === 40 && byPath.get('D:\\note.txt').resident === true);
  check('a sparse file reports both numbers, and they differ',
    byPath.get('D:\\Projects\\ext4.vhdx').size === 64 * 1024 * 1024
      && byPath.get('D:\\Projects\\ext4.vhdx').allocated === 8 * 1024 * 1024
      && byPath.get('D:\\Projects\\ext4.vhdx').sparse === true,
    `${byPath.get('D:\\Projects\\ext4.vhdx').allocated} on disk`);

  console.log('\nmft: what must not appear\n');

  check('a deleted record is not a file', !paths.some((p) => p.endsWith('gone.tmp')), paths.join(' | '));
  check('NTFS\u2019s own records are not reported as files',
    !paths.some((p) => p.includes('$MFT')),
    '$LogFile in the root of the drive is a true statement and a useless one');
  check('a file whose folder is gone is left out rather than put in the root',
    !paths.some((p) => p.endsWith('lost.dat')) && out.orphaned >= 1,
    `${out.orphaned} orphaned`);
  check('the root directory itself is not a file', !out.files.some((f) => f.path === 'D:\\'));

  console.log('\nmft: hard links are one file\n');

  const links = [...out.files].filter((f) => f.name === 'shared.dll');
  check('one record with two names is one file, not two',
    links.length === 1, `${links.length} entries for shared.dll`);
  check('and it still knows both names',
    links[0].links.length === 2 && links[0].hardLinkCount === 2,
    links[0].links.map((l) => l.name).join(', '));

  console.log('\nmft: attributes that did not fit in one record\n');

  const spilledFile = [...byPath.values()].find((f) => f.name === 'Ubuntu Server-s002.vmdk');
  check('a file whose $DATA is in an extension record has its real size',
    spilledFile && spilledFile.size === 40 * 1024 * 1024,
    spilledFile ? `${spilledFile.size} bytes` : 'not found at all');
  check('and its real name, not the 8.3 one left in the base record',
    spilledFile && spilledFile.path === 'D:\\Projects\\Ubuntu Server-s002.vmdk',
    spilledFile ? spilledFile.path : '-');
  check('the piece of $DATA that does not start at VCN 0 does not zero the size',
    spilledFile && spilledFile.size > 0,
    'every piece after the first has its size fields blank by design');
  check('the extension record is not counted as a file of its own',
    [...byPath.values()].filter((f) => f.name === 'Ubuntu Server-s002.vmdk').length === 1);
  check('the reader counts extension records, not files with two names',
    out.withList === 2 && out.spilled === 2,
    `${out.withList} with a list, ${out.spilled} spilled -- one file and one folder, and NOT the 8.3 aliases`);

  check('a FOLDER whose real name is in an extension record gets that name',
    byPath.has('D:\\Virtual Machines'),
    [...byPath.keys()].filter((k) => /VIRTUA|Virtual/.test(k)).join(' | ') || 'neither');
  check('and the files under it are reachable by a path a person would type',
    byPath.has('D:\\Virtual Machines\\Ubuntu-s001.vmdk'),
    'a path spelled VIRTUA~1 resolves, and nobody would recognise or search for it');
  check('no 8.3 folder name survives into a path',
    ![...byPath.keys()].some((k) => k.includes('VIRTUA~1')),
    [...byPath.keys()].find((k) => k.includes('VIRTUA~1')) || 'none');

  console.log('\nmft: an 8.3 alias is not a hard link\n');

  const aliased = byPath.get('D:\\Projects\\Quarterly Report.docx');
  check('a file with a long name and its own short one keeps the long one',
    aliased !== undefined,
    [...byPath.keys()].find((k) => /QUARTE|Quarterly/.test(k)) || 'neither');
  check('and is not reported as being in two places',
    aliased && aliased.links.length === 1 && aliased.links[0].parent === aliased.parent,
    aliased ? aliased.links.map((l) => `${l.parent}/${l.name}`).join(' + ') : '-');
  check('while a file that really is in two folders still says so',
    out.files.find((f) => f.name === 'shared.dll').links.length === 2,
    'two names in two folders is a hard link; two names in one folder is a name and its short form');

  console.log('\nmft: counts and totals\n');

  // Six: the deleted one and the orphaned one are correctly not among them.
  check('every file that should be found is found', out.files.length === 9,
    `${out.files.length}: ${out.files.map((f) => f.name).join(', ')}`);
  check('and every directory, with the root itself left out',
    out.dirs.length === 5 && !out.dirs.some((d) => d.name === '.'),
    out.dirs.map((d) => d.name).join(', '));
  check('the empty slots of $MFT are counted as empty, not as damage',
    out.torn === 0 && out.unused > 0,
    `${out.torn} torn, ${out.unused} unused -- a table allocated in whole clusters is always partly empty`);
  check('the total is the sum of the files, counted once each',
    out.files.reduce((n, f) => n + f.size, 0) === 4096 + 5 * 1024 * 1024 + 40 + 64 * 1024 * 1024 + 8192 + 2048 + 40 * 1024 * 1024 + 2048 + 4096,
    String(out.files.reduce((n, f) => n + f.size, 0)));

  console.log('\nmft: refusing what it cannot read\n');

  const notNtfs = Buffer.alloc(CLUSTER * 4);
  notNtfs.write('MSDOS5.0', 0x03, 'latin1');
  notNtfs.writeUInt16LE(0xaa55, 0x1fe);
  let code = null;
  try {
    await mft.locateMft(bufferReader(notNtfs));
  } catch (err) {
    code = err.code;
  }
  check('a volume that is not NTFS is refused by name', code === 'ENOTNTFS', String(code));

  const noMft = Buffer.from(volume);
  noMft.fill(0, 10 * CLUSTER, 10 * CLUSTER + RECORD);
  code = null;
  try {
    await mft.locateMft(bufferReader(noMft));
  } catch (err) {
    code = err.code;
  }
  check('an unreadable $MFT record is refused', code === 'EMFT', String(code));

  const cancelled = await mft.readVolume(bufferReader(volume), 'D:\\', { token: { cancelled: true } });
  check('a cancelled read says so and returns nothing half-built',
    cancelled.cancelled === true && cancelled.files.length === 0,
    `${cancelled.files.length} files`);

  console.log('\nmft: a parent chain that loops is cut, not followed\n');

  const looped = buildVolume([
    { number: 16, name: 'a', parent: 17, isDirectory: true },
    { number: 17, name: 'b', parent: 16, isDirectory: true },
    { number: 18, name: 'trapped.txt', parent: 16, size: 10 },
  ]);
  const loopOut = await mft.readVolume(bufferReader(looped), 'D:\\');
  check('two folders that are each other\u2019s parent do not hang the reader',
    loopOut.files.length === 0 && loopOut.orphaned > 0,
    `${loopOut.orphaned} orphaned, ${loopOut.files.length} files`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
