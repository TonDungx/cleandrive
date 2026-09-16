#!/usr/bin/env node
'use strict';

// Guard tests for trash.js. Uses a fake `shell` so nothing real is deleted.
//   node scripts/test-trash.js

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { moveToTrash } = require('../src/main/lib/trash');

const trashed = [];
const fakeShell = { trashItem: async (p) => void trashed.push(p) };

let failures = 0;
function check(label, cond) {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

(async () => {
  const dir = path.join(os.tmpdir(), 'cleandrive-trash-test');
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });

  const victim = path.join(dir, 'victim.txt');
  const subdir = path.join(dir, 'subdir');
  await fsp.writeFile(victim, 'delete me');
  await fsp.mkdir(subdir);

  const result = await moveToTrash(
    [
      victim,
      victim, // duplicate in the same request
      path.join(dir, 'missing.txt'),
      subdir,
      'relative/path.txt',
      'C:\\Windows\\System32\\kernel32.dll',
      os.homedir(),
      path.parse(process.cwd()).root,
    ],
    { shell: fakeShell }
  );

  console.log('Guard results:\n');
  for (const m of result.moved) console.log(`  moved   ${m.path}`);
  for (const f of result.failed) console.log(`  refused ${f.path}  -- ${f.error}`);

  console.log('\nAssertions:');
  check('exactly one file trashed', trashed.length === 1 && trashed[0] === victim);
  check('duplicate request collapsed', result.moved.length === 1);
  check('freed bytes counted', result.freedBytes === 9);
  check('missing file refused', result.failed.some((f) => f.error === 'File no longer exists'));
  check('directory refused by default', result.failed.some((f) => f.path === subdir && /folder/.test(f.error)));
  check('relative path refused', result.failed.some((f) => /absolute/.test(f.error)));
  check('system path refused', result.failed.some((f) => /system location/.test(f.error)));
  check('home folder refused', result.failed.some((f) => f.path === os.homedir() && /root or home/.test(f.error)));
  check('drive root refused', result.failed.some((f) => /root or home/.test(f.error) && f.path !== os.homedir()));

  // dryRun must not call the shell at all
  const before = trashed.length;
  const dry = await moveToTrash([subdir], { shell: fakeShell, allowDirectories: true, dryRun: true });
  check('dryRun reports without deleting', trashed.length === before && dry.moved.length === 1);

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
