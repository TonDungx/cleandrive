#!/usr/bin/env node
'use strict';

// A4: several folders in one scan, whole drives, and drives the app only reads.
//
//   node scripts/test-roots.js
//
// The guards first: every spelling of a system folder that Windows accepts
// is a system folder, which was not true before (measured 2026-09-26). Then
// the drive listing, parsed from this machine's real output
// (scripts/fixtures/volumes/cim-nvme-and-card-reader.txt: two NVMe disks and
// an empty card reader), plus three rows written by hand -- a USB disk, a
// mapped share and a DVD drive -- because this machine has none of them; they
// are marked as constructed where they are used. Then two real scans of
// folders this harness builds, joined; the map of both; a whole drive's
// unscanned tile, with a stand-in for statfs; and the delete vetting, which
// refuses a share whatever the window says.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const util = require('../src/main/lib/util');
const volumes = require('../src/main/lib/volumes');
const scanRoots = require('../src/main/analyzers/scan-roots');
const analyzers = require('../src/main/analyzers');
const { ScanTree, MultiScanTree } = require('../src/main/analyzers/scan-tree');
const { validateCandidate } = require('../src/main/analyzers/contract');
const { planTrash: vetPaths } = require('../src/main/lib/trash');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

async function make(file, bytes, ageDays = 0) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const handle = await fsp.open(file, 'w');
  await handle.truncate(bytes);
  await handle.close();
  if (ageDays) {
    const when = new Date(Date.now() - ageDays * DAY);
    await fsp.utimes(file, when, when);
  }
}

(async () => {
  if (process.platform !== 'win32') {
    console.log('Windows only.');
    process.exit(0);
  }

  /* ---- the guards ---- */

  console.log('\nEvery spelling of a system folder is one:');
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const drive = sysRoot.slice(0, 1);
  const spellings = [
    `${sysRoot}\\System32`,
    `\\\\?\\${sysRoot}\\System32`,
    `\\\\.\\${sysRoot}\\System32`,
    `\\\\localhost\\${drive}$\\Windows\\System32`,
    `\\\\127.0.0.1\\${drive}$\\Program Files`,
    `\\\\?\\UNC\\localhost\\${drive}$\\Windows`,
    `\\\\${os.hostname()}\\${drive}$\\ProgramData`,
  ];
  for (const p of spellings) check(p, util.isProtectedPath(p));
  check('another machine’s Windows, through its admin share, is protected too', util.isProtectedPath('\\\\otherpc\\C$\\Windows\\System32'));
  check('while its users’ folders are not system folders', !util.isProtectedPath('\\\\otherpc\\C$\\Users\\someone\\big.iso'));
  check('a share of this machine’s drive is that drive, not the network',
    !util.isNetworkPath(`\\\\localhost\\${drive}$\\Users`) && util.pathKey(`\\\\localhost\\${drive}$\\Users`) === util.pathKey(`${drive}:\\Users`));
  check('a share elsewhere is the network, however it is spelt',
    util.isNetworkPath('\\\\otherpc\\share\\x') && util.isNetworkPath('\\\\?\\UNC\\otherpc\\share\\x'));
  check('the device-namespace prefix comes off before comparing', util.pathKey('\\\\?\\C:\\Users\\a') === util.pathKey('C:\\Users\\a'));

  /* ---- the drives ---- */

  console.log('\nThe drives, from this machine’s own listing:');
  const real = fs.readFileSync(path.join(__dirname, 'fixtures', 'volumes', 'cim-nvme-and-card-reader.txt'), 'utf8');
  const drives = volumes.parse(real);
  const byLetter = Object.fromEntries(drives.map((d) => [d.letter, d]));
  check('three letters: C, D and E', drives.map((d) => d.letter).join('') === 'CDE');
  check('C: and D: are fixed NTFS disks on NVMe', ['C', 'D'].every((l) => byLetter[l].type === 'fixed' && byLetter[l].fileSystem === 'NTFS' && byLetter[l].bus === 'NVMe'));
  check('E: is removable, with nothing in it', byLetter.E.type === 'removable' && byLetter.E.fileSystem === null && byLetter.E.totalBytes === null);
  check('sizes are numbers', byLetter.C.totalBytes > byLetter.C.freeBytes && byLetter.C.freeBytes > 0);
  check('only a ready drive is offered for a whole-drive scan', volumes.scannable(drives).map((d) => d.letter).join('') === 'CD');

  const c = volumes.describe('C:\\Users', drives);
  check('a folder on C: may be acted on, and is not external', c.readOnly === null && c.external === false && c.volume === 'C:\\');
  check('a folder on the card reader is read only', volumes.describe('E:\\DCIM', drives).readOnly === 'removable');
  check('a share is read only by its shape alone', volumes.describe('\\\\otherpc\\share\\x', []).readOnly === 'network');
  check('a letter Windows did not list is unknown, and not refused', volumes.describe('Q:\\x', drives).kind === 'unknown' && volumes.describe('Q:\\x', drives).readOnly === null);

  // Constructed rows, in the script's own format: none of these exists here.
  const constructed = volumes.parse([
    'drive\tF\t3\tNTFS\t\t7\t1000204886016\t500000000000\tBackup',
    'drive\tZ\t4\tNTFS\t\\\\server\\share\t\t2000000000000\t100000000000\t',
    'drive\tG\t5\tUDF\t\t\t4700000000\t0\tDVD',
  ].join('\r\n'));
  check('(constructed) a USB disk is fixed, and external', volumes.describe('F:\\', constructed).external === true && volumes.describe('F:\\', constructed).readOnly === null);
  check('(constructed) a mapped share is read only', volumes.describe('Z:\\docs', constructed).readOnly === 'network');
  check('(constructed) a disc is read only', volumes.describe('G:\\', constructed).readOnly === 'cdrom');
  check('(constructed) neither a share nor a disc is offered whole', volumes.scannable(constructed).map((d) => d.letter).join('') === 'F');

  /* ---- which drives the fast scan will read (A2) ---- */

  console.log('\nWhich drives can be read from their own catalogue:');

  // Every answer the switch can get, against `volumes.describe` output rather
  // than a hand-built object: it is the shape `prepareRoots` really hands over.
  // FAT, exFAT and ReFS are the rows this machine cannot supply -- there is no
  // such drive here -- so they are constructed, and said to be constructed.
  const odd = volumes.parse([
    'drive\tP\t3\tFAT32\t\t7\t31000000000\t12000000000\tFIXEDFAT',
    'drive\tR\t3\texFAT\t\t7\t500000000000\t400000000000\tPortable',
    'drive\tS\t3\tReFS\t\t8\t2000000000000\t900000000000\tPool',
    'drive\tT\t3\t\t\t8\t1000000000000\t900000000000\tRaw',
    'drive\tU\t2\tFAT32\t\t7\t31000000000\t12000000000\tSTICK',
  ].join('\r\n'));

  check('a whole NTFS drive on this machine: yes',
    scanRoots.whyNotFast(volumes.describe('C:\\', drives)) === null);
  check('a folder on it: no, a catalogue costs the whole drive',
    scanRoots.whyNotFast(volumes.describe('C:\\Users', drives)) === 'notWholeDrive',
    'D: holds 515,940 records where a walk of it lists 191,975');
  check('a share: no',
    scanRoots.whyNotFast(volumes.describe('\\\\otherpc\\share\\x', [])) === 'network');
  check('a mapped share: no',
    scanRoots.whyNotFast(volumes.describe('Z:\\', constructed)) === 'network');
  check('the card reader: no',
    scanRoots.whyNotFast(volumes.describe('E:\\', drives)) === 'readOnly');
  check('a disc: no',
    scanRoots.whyNotFast(volumes.describe('G:\\', constructed)) === 'readOnly');
  check('(constructed) FAT32: no catalogue to read',
    scanRoots.whyNotFast(volumes.describe('P:\\', odd)) === 'notNtfs');
  check('(constructed) exFAT: no catalogue to read',
    scanRoots.whyNotFast(volumes.describe('R:\\', odd)) === 'notNtfs');
  check('(constructed) ReFS: no catalogue to read',
    scanRoots.whyNotFast(volumes.describe('S:\\', odd)) === 'notNtfs',
    'ReFS has no $MFT -- it keeps a B+ tree, and nothing here can read it');
  check('(constructed) a drive whose filesystem Windows would not name: no',
    scanRoots.whyNotFast(volumes.describe('T:\\', odd)) === 'notNtfs');
  check('a letter Windows never listed: no, rather than assumed NTFS',
    scanRoots.whyNotFast(volumes.describe('Q:\\', drives)) === 'notNtfs',
    'an unknown drive is walked, not guessed at');
  check('a whole external NTFS disk: yes -- the bus is not the question',
    scanRoots.whyNotFast(volumes.describe('F:\\', constructed)) === null);
  check('nothing at all: refused rather than thrown',
    scanRoots.whyNotFast(null) === 'notWholeDrive' && scanRoots.whyNotFast({}) === 'notWholeDrive');
  // A removable FAT32 stick is refused twice over. The reason the user is
  // shown is the one that would still be true if the other were fixed, which
  // is the drive being read-only here -- there is nothing to offer on it
  // whatever its filesystem.
  check('(constructed) a removable FAT32 stick says read-only, not "no catalogue"',
    scanRoots.whyNotFast(volumes.describe('U:\\', odd)) === 'readOnly');

  /* ---- the folders asked for ---- */

  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-roots-'));
  const a = path.join(base, 'Alpha');
  const b = path.join(base, 'Beta');
  await make(path.join(a, 'Downloads', 'setup.iso'), 24 * MB);
  await make(path.join(a, 'Temp', 'old.tmp'), 3 * MB, 40);
  await make(path.join(a, 'Inner', 'photo.raw'), 11 * MB);
  await make(path.join(b, 'Temp', 'older.tmp'), 2 * MB, 60);
  await make(path.join(b, 'Videos', 'clip.mkv'), 30 * MB);
  await make(path.join(base, 'loose.txt'), 1000);

  console.log('\nThe folders asked for:');
  const prepared = await scanRoots.prepareRoots(
    [a, path.join(a, 'Inner'), `\\\\?\\${b}`, b, path.join(base, 'loose.txt'), path.join(base, 'gone'), 'relative\\path'],
    { drives }
  );
  check('two folders are left to scan, in the order chosen', prepared.roots.map((r) => r.root).join('|') === [a, b].join('|'), prepared.roots.map((r) => r.root).join('|'));
  check('the one inside another is folded into it, and said so',
    prepared.merged.length === 1 && prepared.merged[0].root === path.join(a, 'Inner') && prepared.merged[0].into === a);
  check('the same folder spelt twice is scanned once', prepared.roots.filter((r) => util.pathKey(r.root) === util.pathKey(b)).length === 1);
  check('a file, a missing folder and a relative path are refused, each with its reason',
    ['notFolder', 'missing', 'notAbsolute'].every((why) => prepared.refused.some((r) => r.reason === why)), JSON.stringify(prepared.refused.map((r) => r.reason)));
  let threw = null;
  try {
    await scanRoots.prepareRoots(Array.from({ length: scanRoots.MAX_ROOTS + 1 }, (_, i) => path.join(base, `f${i}`)));
  } catch (err) {
    threw = err;
  }
  check(`more than ${scanRoots.MAX_ROOTS} folders is refused before anything is read`, threw && threw.code === 'EINVAL');

  /* ---- two scans, joined ---- */

  console.log('\nTwo real scans, joined:');
  const parts = [];
  for (const info of prepared.roots) {
    const collected = await analyzers.collect('scan', { root: info.root, options: { collectTree: true } }, { strict: true });
    const { tree, treeFiles, ...summary } = collected.summary;
    parts.push({ info, summary, candidates: collected.candidates, tree, treeFiles });
  }
  const joined = scanRoots.mergeScans(parts);
  const sum = (key) => parts.reduce((n, p) => n + p.summary[key], 0);
  check('totals are the sums', joined.totalSize === sum('totalSize') && joined.totalFiles === sum('totalFiles') && joined.totalDirs === sum('totalDirs'));
  const byId = new Map(parts.flatMap((p) => p.candidates).map((cand) => [cand.id, cand]));
  const sizes = joined.largest.map((id) => byId.get(id).bytes);
  check('one largest list, biggest first, from both folders',
    sizes.every((s, i) => i === 0 || sizes[i - 1] >= s) && joined.largest.length === parts.reduce((n, p) => n + p.summary.largest.length, 0));
  const temp = joined.cleanup.groups.filter((g) => g.category === 'temp');
  check('a category found in both folders is one group holding both',
    temp.length === 1 && temp[0].count === parts.reduce((n, p) => n + (p.summary.cleanup.groups.find((g) => g.category === 'temp') || { count: 0 }).count, 0),
    JSON.stringify(joined.cleanup.groups.map((g) => [g.category, g.count])));
  check('the safe total is the safe groups’ total', joined.cleanup.safeBytes === joined.cleanup.groups.filter((g) => g.verdict === 'safe').reduce((n, g) => n + g.bytes, 0));
  const types = new Map(joined.byType.map((x) => [x.ext, x.count]));
  check('file types are counted across both', types.get('tmp') === 2, JSON.stringify([...types]));

  /* ---- rows the app only reads ---- */

  console.log('\nRows under a folder the app only reads:');
  const sample = parts[0].candidates.find((cand) => cand.actions.length > 0);
  const readOnly = scanRoots.readOnlyCandidate(sample, 'network');
  let valid = true;
  try {
    validateCandidate(readOnly);
  } catch {
    valid = false;
  }
  check('the verdict stays, the actions go, and it is still a valid candidate', valid && readOnly.verdict === sample.verdict && readOnly.actions.length === 0 && !readOnly.unattendedEligible);
  check('and the last reason says why', readOnly.evidence[readOnly.evidence.length - 1].i18n === 'evidence.readOnly.network');

  /* ---- the map of several folders ---- */

  console.log('\nThe map of both folders:');
  const trees = parts.map((p, i) => new ScanTree({ root: p.summary.root, rows: p.tree, files: p.treeFiles, readOnly: i === 1 ? 'removable' : null }));
  const multi = new MultiScanTree(trees);
  const top = multi.level('');
  check('the top has one tile per folder, and names none of its own', top.roots === 2 && top.children.length === 2 && top.name === '' && top.path === null);
  check('each folder tile is named by its folder, carries its path, and is reached by number',
    top.children.every((ch) => /^\d:$/.test(ch.rel) && ['Alpha', 'Beta'].includes(ch.name) && [a, b].includes(ch.path)));
  const twins = new MultiScanTree([
    new ScanTree({ root: 'C:\\one\\Data', rows: [['', 1, 1, []]] }),
    new ScanTree({ root: 'D:\\two\\Data', rows: [['', 2, 1, []]] }),
    new ScanTree({ root: 'E:\\', rows: [['', 3, 1, []]] }),
  ]).level('').children.map((ch) => ch.name).sort();
  check('two folders of the same name are told apart by their paths; a drive is its letter',
    JSON.stringify(twins) === JSON.stringify(['C:\\one\\Data', 'D:\\two\\Data', 'E:\\']), JSON.stringify(twins));
  check('the top’s size is both folders', top.bytes === trees[0].level('').bytes + trees[1].level('').bytes);
  const alpha = multi.level('0:');
  check('inside one folder, its own contents, rels kept under its number', alpha && alpha.children.every((ch) => ch.kind !== 'folder' || ch.rel.startsWith('0:')));
  check('its crumbs start at the top', alpha.crumbs[0].rel === '' && alpha.crumbs[0].roots === 2 && alpha.crumbs[1].name === 'Alpha');
  const downloads = multi.level('0:Downloads');
  check('a folder inside is found', downloads && downloads.name === 'Downloads' && downloads.crumbs.length === 3);
  check('a folder the window makes up is not', multi.level('7:') === null && multi.level('Downloads') === null && multi.level('0:..\\..') === null);
  const betaFile = multi.level('1:Videos').children.find((ch) => ch.kind === 'file');
  check('a file on the read-only folder offers nothing', betaFile && betaFile.candidate.actions.length === 0);
  const alphaFile = multi.level('0:Downloads').children.find((ch) => ch.kind === 'file');
  check('a file on the other is as before', alphaFile && alphaFile.candidate.actions.length > 0);
  const taken = multi.remove([{ path: path.join(a, 'Downloads', 'setup.iso'), size: 24 * MB }]);
  check('a file sent to the bin leaves the right tree', taken === 1 && multi.removed.files === 1 && multi.level('0:Downloads').bytes === 0);

  /* ---- a whole drive ---- */

  console.log('\nA whole drive’s space the scan did not count:');
  const drv = { root: 'C:\\', volume: 'C:\\', kind: 'fixed', readOnly: null };
  const statfs = async () => ({ bsize: 4096, blocks: 1000000, bfree: 400000 });
  const used = 600000 * 4096;
  const unscanned = await scanRoots.unscannedOnDrive(drv, { totalSize: used - 5 * MB }, { statfs });
  check('in use minus scanned', unscanned && unscanned.bytes === 5 * MB && unscanned.volume === 'C:\\');
  check('nothing for a folder that is not a drive', (await scanRoots.unscannedOnDrive({ ...drv, root: 'C:\\Users' }, { totalSize: 1 }, { statfs })) === null);
  check('nothing when the scan counted more than is in use', (await scanRoots.unscannedOnDrive(drv, { totalSize: used + 1 }, { statfs })) === null);
  check('nothing for a stopped scan', (await scanRoots.unscannedOnDrive(drv, { totalSize: 1, cancelled: true }, { statfs })) === null);
  const whole = new ScanTree({ root: a, rows: parts[0].tree, files: parts[0].treeFiles, unscanned: { volume: 'C:\\', bytes: 50 * MB } });
  const wl = whole.level('');
  const tile = wl.children.find((ch) => ch.kind === 'unscanned');
  check('the drive’s top level has the tile', tile && tile.bytes === 50 * MB && tile.volume === 'C:\\');
  const plain = new ScanTree({ root: a, rows: parts[0].tree, files: parts[0].treeFiles });
  check('and the drive’s size includes it', wl.bytes === plain.level('').bytes + 50 * MB, `${wl.bytes} vs ${plain.level('').bytes}`);
  check('one level down there is no such tile', !(whole.level('Downloads').children || []).some((ch) => ch.kind === 'unscanned'));

  /* ---- the delete, asked anyway ---- */

  console.log('\nThe delete, asked for anyway:');
  const share = await vetPaths(['\\\\otherpc\\share\\big.iso'], {});
  check('a file on a share is refused, before the disk is asked', share.plan.length === 0 && share.failed[0].code === 'ENETWORK', JSON.stringify(share.failed[0]));
  const onCard = await vetPaths([path.join(b, 'Videos', 'clip.mkv')], { describePath: async () => ({ readOnly: 'removable' }) });
  check('a file on a removable drive is refused', onCard.plan.length === 0 && onCard.failed[0].code === 'EREADONLY');
  const fine = await vetPaths([path.join(b, 'Videos', 'clip.mkv')], {});
  check('a file on this machine’s own disk is still planned', fine.plan.length === 1, JSON.stringify(fine.failed));

  await fsp.rm(base, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
