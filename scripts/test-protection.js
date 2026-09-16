#!/usr/bin/env node
'use strict';

// "Identical" must not mean "redundant". Two virtualenvs each holding their own
// copy of the same library both need it; deleting one breaks that environment.
// These cases are taken from a real screenshot of the app suggesting exactly
// that.
//   node scripts/test-protection.js

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { programComponentReason } = require('../src/main/lib/advisor');
const { findDuplicates } = require('../src/main/lib/duplicate');
const { formatBytes } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const PROTECTED_CASES = [
  ['D:\\an\\streaming-system\\venv\\Lib\\site-packages\\torch\\lib\\cusparse64_12.dll', 'two venvs, one torch DLL each'],
  ['D:\\plus\\venv\\Lib\\site-packages\\torch\\lib\\cufft64_11.dll', 'the other venv'],
  ['C:\\Users\\me\\proj\\node_modules\\esbuild\\bin\\esbuild.exe', 'node_modules'],
  ['C:\\Users\\me\\.cargo\\registry\\src\\lib.rs', 'cargo registry'],
  ['D:\\Users\\someone\\Adobe\\Adobe 2024\\products\\LIBS\\rti.dll', 'a .dll anywhere'],
  ['C:\\Program Files\\Autodesk\\thing.cfg', 'inside Program Files'],
  ['C:\\apps\\vendor\\lib\\helper.so', 'vendor tree'],
  ['C:\\py\\Lib\\dist-packages\\numpy\\core.pyd', 'dist-packages + .pyd'],
];

const ALLOWED_CASES = [
  ['C:\\Users\\me\\Downloads\\OllamaSetup.exe', 'an installer in Downloads'],
  ['C:\\Users\\me\\Pictures\\holiday.jpg', 'a photo'],
  ['C:\\Users\\me\\Documents\\report.pdf', 'a document'],
  ['C:\\Users\\me\\Downloads\\archive.zip', 'an archive'],
  ['C:\\Users\\me\\Music\\song.mp3', 'music'],
  ['C:\\Users\\me\\projects\\app\\src\\main.py', 'source code outside a dependency tree'],
];

(async () => {
  console.log('Files that must never be bulk-selected:\n');
  for (const [p, why] of PROTECTED_CASES) {
    const reason = programComponentReason(p);
    check(why, reason !== null, reason || 'NOT PROTECTED');
  }

  console.log('\nFiles that must stay freely selectable:\n');
  for (const [p, why] of ALLOWED_CASES) {
    const reason = programComponentReason(p);
    check(why, reason === null, reason || 'ok');
  }

  /* -- end to end through the duplicate finder --------------------------- */
  console.log('\nThrough the duplicate finder:\n');

  const dir = path.join(os.tmpdir(), 'cleandrive-protection-fixture');
  await fsp.rm(dir, { recursive: true, force: true });

  const libBody = 'L'.repeat(8192);
  const photoBody = 'P'.repeat(8192);

  // Two separate virtualenvs, each with its own copy of the same library.
  for (const env of ['project-a', 'project-b']) {
    const libDir = path.join(dir, env, 'venv', 'Lib', 'site-packages', 'torch', 'lib');
    await fsp.mkdir(libDir, { recursive: true });
    await fsp.writeFile(path.join(libDir, 'cusparse64_12.dll'), libBody);
  }

  // Two genuinely redundant copies of a photo.
  await fsp.mkdir(path.join(dir, 'Pictures', 'backup'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'Pictures', 'trip.jpg'), photoBody);
  await fsp.writeFile(path.join(dir, 'Pictures', 'backup', 'trip.jpg'), photoBody);

  const result = await findDuplicates([dir], { useCache: false, minSize: 1024 });

  const dllGroup = result.groups.find((g) => g.files[0].path.endsWith('.dll'));
  const jpgGroup = result.groups.find((g) => g.files[0].path.endsWith('.jpg'));

  console.log(`  groups: ${result.totalGroups}`);
  console.log(`  reclaimable (raw):        ${formatBytes(result.reclaimableBytes)}`);
  console.log(`  selectable (auto-select): ${formatBytes(result.selectableBytes)}`);
  console.log(`  protected copies:         ${result.protectedFiles}`);

  check('both duplicate groups found', result.totalGroups === 2, String(result.totalGroups));
  check('the venv DLL group is flagged', dllGroup && dllGroup.protectedCount === 2,
    dllGroup ? `${dllGroup.protectedCount} flagged` : 'group missing');
  check('nothing in the DLL group is auto-selectable', dllGroup && dllGroup.selectableBytes === 0,
    dllGroup ? String(dllGroup.selectableBytes) : 'n/a');
  check('the photo group is untouched by the guard', jpgGroup && jpgGroup.protectedCount === 0,
    jpgGroup ? `${jpgGroup.protectedCount} flagged` : 'group missing');
  check('the photo is still auto-selectable', jpgGroup && jpgGroup.selectableBytes === 8192,
    jpgGroup ? String(jpgGroup.selectableBytes) : 'n/a');
  check('selectable total excludes the DLLs',
    result.selectableBytes === 8192 && result.reclaimableBytes === 16384,
    `${result.selectableBytes} of ${result.reclaimableBytes}`);
  check('every protected file carries a reason',
    dllGroup && dllGroup.files.every((f) => !f.protected || typeof f.protectionReason === 'string'));
  check('duplicate rows carry an access time',
    result.groups.every((g) => g.files.every((f) => typeof f.atimeMs === 'number')));

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
