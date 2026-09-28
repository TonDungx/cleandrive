#!/usr/bin/env node
'use strict';

// Letting NTFS hold a folder in less room (B4).
//   node scripts/test-compress.js
//
// Everything here is real: real folders, real `compact.exe`, real sizes read
// from the file system. Nothing is stood in for -- there is no Recycle Bin in
// this feature and nothing is deleted, so there is nothing to substitute.
// `compact` needs no administrator rights for files the user owns, which this
// checks rather than assumes.
//
// The fixture is on D:. `os.tmpdir()` is inside AppData on C: on this
// machine, and while both volumes happen to be NTFS with 4 KB clusters, a
// fixture that assumed that would be passing for the wrong reason.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const compress = require('../src/main/actions/compress');
const ntfs = require('../src/main/lib/ntfs-compress');
const treeCopy = require('../src/main/lib/tree-copy');
const { execute } = require('../src/main/actions/execute');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const LP = '\\\\?\\';
const exists = (p) => fs.existsSync(p.length > 240 ? LP + p : p);

function secondVolume() {
  const home = path.parse(os.homedir()).root;
  for (const letter of 'DEFGH') {
    const root = `${letter}:\\`;
    try {
      if (fs.statSync(root).dev !== fs.statSync(home).dev) return root;
    } catch {
      // not there
    }
  }
  return null;
}

(async () => {
  console.log('\ncompress: can this machine do it at all\n');

  const other = secondVolume();
  check('there is a second volume to build the fixture on', other !== null, other || 'only one');
  if (!other) {
    console.log('\n1 FAILURE(S)\n');
    process.exit(1);
  }

  const base = await fsp.mkdtemp(path.join(other, 'cleandrive-compress-'));

  const able = await ntfs.canCompress(base);
  check('the volume is asked by trying, not by reasoning about cluster sizes',
    able.ok === true, JSON.stringify(able));
  if (!able.ok) {
    await fsp.rm(base, { recursive: true, force: true });
    console.log('\n1 FAILURE(S) -- this volume cannot hold compressed files\n');
    process.exit(1);
  }

  check('and the probe it wrote is cleaned up after itself',
    fs.readdirSync(base).every((n) => !n.startsWith('.cleandrive-compress-')), fs.readdirSync(base).join(', '));

  /* -- a folder that compresses, and one that does not --------------------- */
  console.log('\ncompress: measuring before promising\n');

  const project = path.join(base, 'Dự án cũ');
  await fsp.mkdir(path.join(project, 'src'), { recursive: true });
  const text = Buffer.from('const value = 1; // a line of ordinary source code\n'.repeat(12000));
  for (let n = 0; n < 16; n++) await fsp.writeFile(path.join(project, 'src', `mod${n}.js`), text);
  await fsp.writeFile(path.join(project, 'server.log'), Buffer.from('2026-09-28 INFO request handled in 12ms\n'.repeat(30000)));
  await fsp.mkdir(path.join(project, 'nothing in here'), { recursive: true });
  await fsp.writeFile(path.join(project, 'tên tiếng việt.txt'), text.subarray(0, 100000));

  const photos = path.join(base, 'Ảnh 2015');
  await fsp.mkdir(photos, { recursive: true });
  for (let n = 0; n < 8; n++) await fsp.writeFile(path.join(photos, `DSC0${n}.jpg`), crypto.randomBytes(700000));

  const plan = (items, options = {}, extra = {}) => compress.plan(items, options, { deps: extra });

  const projectPlan = await plan([project]);
  check('the folder is planned', projectPlan.plan.length === 1, JSON.stringify(projectPlan.failed));
  const projectDesc = compress.describe(projectPlan);
  check('it sampled real files rather than guessing', projectDesc.sampled > 0, `${projectDesc.sampled} samples`);
  check('and expects a large saving on text',
    projectDesc.estimatedFreedBytes > projectDesc.onDiskBefore * 0.5,
    `${projectDesc.estimatedFreedBytes} of ${projectDesc.onDiskBefore}`);
  check('this is the one action here that frees space with nothing in the way',
    projectDesc.freesOnVolume === true && projectDesc.reversible === 'manual');

  const photoPlan = await plan([photos]);
  const photoDesc = compress.describe(photoPlan);
  check('a folder of already-compressed files is not sampled at all',
    photoDesc.sampled === 0 && photoDesc.alreadyCompressed === 8,
    `${photoDesc.sampled} sampled, ${photoDesc.alreadyCompressed} already compressed`);
  check('and is promised almost nothing rather than a hopeful percentage',
    photoDesc.estimatedFreedBytes < photoDesc.onDiskBefore * 0.05,
    `${photoDesc.estimatedFreedBytes} of ${photoDesc.onDiskBefore}`);

  /* -- and doing it -------------------------------------------------------- */
  console.log('\ncompress: the folder actually gets smaller on the disk\n');

  const beforeTree = await treeCopy.walk(project);
  const before = await ntfs.measure(beforeTree.files);
  const logHashBefore = crypto
    .createHash('sha256')
    .update(await fsp.readFile(path.join(project, 'server.log')))
    .digest('hex');
  const done = await compress.apply(projectPlan, {}, {});
  check('it ran', done.moved.length === 1, JSON.stringify(done.failed));
  check('and needed no administrator rights', done.failed.length === 0);

  const after = await ntfs.measure(beforeTree.files);
  check('the folder takes less room on the disk than it did',
    after.disk < before.disk * 0.5, `${before.disk} -> ${after.disk}`);
  check('but every file still has the length it always had',
    after.logical === before.logical, `${before.logical} vs ${after.logical}`);
  check('the receipt reports what was measured, not what was estimated',
    done.moved[0].onDiskAfter === after.disk && done.moved[0].onDiskBefore === before.disk,
    `${done.moved[0].onDiskBefore} -> ${done.moved[0].onDiskAfter}`);
  check('freed is the real difference, and it is not zero',
    done.freedBytes === before.disk - after.disk && done.freedBytes > 0, String(done.freedBytes));

  const estimated = projectDesc.estimatedBytes;
  const actual = after.disk;
  const off = Math.abs(estimated - actual) / Math.max(1, before.disk);
  check('the estimate was close to what happened, which is why it is sampled',
    off < 0.1, `estimated ${estimated}, actual ${actual} (off by ${(off * 100).toFixed(1)} points)`);

  const oneFile = path.join(project, 'server.log');
  check('a compressed file reads as compressed', (await ntfs.looksCompressed(oneFile)) === true);
  // Compared against what was hashed before anything was compressed: the
  // whole promise of this feature is that only the clusters change.
  const bodyNow = crypto.createHash('sha256').update(await fsp.readFile(oneFile)).digest('hex');
  check('and reads back byte for byte the same as before it was compressed',
    bodyNow === logHashBefore, bodyNow === logHashBefore ? '' : `${logHashBefore} -> ${bodyNow}`);
  check('the Vietnamese name survived', exists(path.join(project, 'tên tiếng việt.txt')));

  /* -- and undoing it ------------------------------------------------------ */
  console.log('\ncompress: stopping again\n');

  const undoPlan = await compress.plan([project], { uncompress: true }, { deps: {} });
  check('undoing needs no sample, because there is nothing to estimate',
    undoPlan.sampled === 0 && undoPlan.uncompress === true);
  const undoDesc = compress.describe(undoPlan);
  check('and it does not claim to free anything',
    undoDesc.freesOnVolume === false && undoDesc.estimatedFreedBytes === 0);

  const undone = await compress.apply(undoPlan, {}, {});
  check('it ran', undone.moved.length === 1, JSON.stringify(undone.failed));
  const back = await ntfs.measure(beforeTree.files);
  check('the folder takes its full room again', back.disk >= before.disk * 0.95, `${after.disk} -> ${back.disk}`);
  check('and the receipt says it gave space back rather than taking it',
    undone.moved[0].changedBytes < 0 && undone.measuredFreedBytes === 0, String(undone.moved[0].changedBytes));
  check('no file is compressed any more', (await ntfs.looksCompressed(oneFile)) === false);

  /* -- what it refuses ----------------------------------------------------- */
  console.log('\ncompress: what it refuses\n');

  const aFile = await plan([path.join(project, 'server.log')]);
  check('a file is refused: this compresses folders', aFile.failed[0] && aFile.failed[0].code === 'ENOTDIR');

  const gone = await plan([path.join(base, 'not here')]);
  check('a folder that is not there is refused', gone.failed[0] && gone.failed[0].code === 'ENOENT');

  const root = await plan([path.parse(base).root]);
  check('a drive root is refused', root.failed[0] && root.failed[0].code === 'EROOT');

  const windows = await plan([process.env.SystemRoot || 'C:\\Windows']);
  check('the Windows folder is refused, and the reason names CompactOS rather than just saying no',
    windows.failed[0] && windows.failed[0].code === 'ESYSTEM' && /CompactOS/.test(windows.failed[0].error),
    windows.failed[0] ? windows.failed[0].error : 'not refused');

  const emptyDir = path.join(base, 'Rỗng');
  await fsp.mkdir(emptyDir, { recursive: true });
  const nothing = await plan([emptyDir]);
  check('a folder with no files in it is refused', nothing.failed[0] && nothing.failed[0].code === 'EEMPTY');

  const steamish = path.join(base, 'Steam', 'steamapps', 'common', 'A Game');
  await fsp.mkdir(steamish, { recursive: true });
  await fsp.writeFile(path.join(steamish, 'game.dat'), text.subarray(0, 50000));
  const handed = await plan([steamish]);
  check('a Steam game is handed off, by the same code B2 and B5 use',
    handed.failed[0] && handed.failed[0].code === 'EHANDOFF', handed.failed[0] ? handed.failed[0].code : 'none');

  /* -- the OneDrive refusal, which the spec does not mention --------------- */
  console.log('\ncompress: a folder whose files are only on OneDrive\n');

  const cloudy = path.join(base, 'OneDrive-ish');
  await fsp.mkdir(cloudy, { recursive: true });
  const onDisk = path.join(cloudy, 'here.txt');
  const onlineOnly = path.join(cloudy, 'up there.txt');
  await fsp.writeFile(onDisk, text.subarray(0, 60000));
  await fsp.writeFile(onlineOnly, text.subarray(0, 60000));

  const fakeCloud = (states) => ({
    serviceForPath: (p) => (p.toLowerCase().startsWith(cloudy.toLowerCase()) ? 'OneDrive' : null),
    query: async (paths) => ({
      ok: true,
      states: new Map(paths.map((p) => [p, states[path.basename(p)] || { onDisk: true, inSync: true }])),
    }),
  });

  const refused = await plan([cloudy], {}, { cloud: fakeCloud({ 'up there.txt': { onDisk: false, inSync: true } }) });
  check('a folder with an online-only file in it is refused',
    refused.failed[0] && refused.failed[0].code === 'EONLINEONLY', refused.failed[0] ? refused.failed[0].code : 'none');
  check('and the reason says compressing would download it, which is B3 undone',
    refused.failed[0] && /download/i.test(refused.failed[0].error), refused.failed[0] ? refused.failed[0].error : '');

  const allowed = await plan([cloudy], {}, { cloud: fakeCloud({}) });
  check('a OneDrive folder whose files are all here is allowed',
    allowed.plan.length === 1, JSON.stringify(allowed.failed));

  const blind = await plan([cloudy], {}, {
    cloud: { serviceForPath: () => 'OneDrive', query: async () => ({ ok: false }) },
  });
  check('and when Windows cannot be asked, it goes ahead rather than refusing every OneDrive folder',
    blind.plan.length === 1, JSON.stringify(blind.failed));

  /* -- the pipeline -------------------------------------------------------- */
  console.log('\ncompress: through the pipeline\n');

  const another = path.join(base, 'Tài liệu');
  await fsp.mkdir(another, { recursive: true });
  await fsp.writeFile(path.join(another, 'notes.txt'), text);

  const locked = await execute({ kind: 'compress', items: [another] }, { can: (f) => f !== 'pro.compress' });
  check('without the licence it is refused out loud',
    locked.refused === 'locked' && locked.feature === 'pro.compress');

  const through = await execute({ kind: 'compress', items: [another] }, { can: () => true, confirm: async () => true });
  check('and it goes all the way through', through.moved.length === 1, JSON.stringify(through.failed));
  check('the pipeline reports it freed space, with no bin involved',
    through.freedBytes > 0 && through.freesOnVolume === true, `${through.freedBytes} freed`);

  const asFile = await execute({ kind: 'recycle', items: [another] }, { can: () => true, deps: { shell: { trashItem: async () => {} } } });
  check('and a folder still never reaches a handler that has not declared it takes one',
    asFile.refused === 'folders', String(asFile.refused));

  await fsp.rm(LP + base, { recursive: true, force: true }).catch(() => {});
  console.log(`\n  (fixture removed: ${!fs.existsSync(base)})`);

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
