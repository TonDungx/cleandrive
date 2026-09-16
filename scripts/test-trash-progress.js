#!/usr/bin/env node
'use strict';

// Progress reporting and cancellation for the delete pipeline.
// Uses a fake `shell` with a small delay, so nothing real is deleted.
//   node scripts/test-trash-progress.js

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planTrash, executeTrash, moveToTrash } = require('../src/main/lib/trash');
const { CancelToken } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeFiles(dir, count, bytes = 2048) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  const paths = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `file-${i}.bin`);
    await fsp.writeFile(file, 'x'.repeat(bytes));
    paths.push(file);
  }
  return paths;
}

(async () => {
  const dir = path.join(os.tmpdir(), 'cleandrive-progress-test');

  /* ---------------------------------------------------------------- run 1 */
  console.log('Progress events over 30 files:\n');

  const paths = await makeFiles(dir, 30);
  const events = [];
  const trashed = [];
  const slowShell = { trashItem: async (p) => { await sleep(4); trashed.push(p); } };

  const result = await moveToTrash(paths, { shell: slowShell }, {
    onProgress: (p) => events.push({ ...p }),
  });

  const checking = events.filter((e) => e.phase === 'checking');
  const deleting = events.filter((e) => e.phase === 'deleting');
  const last = deleting[deleting.length - 1];

  console.log(`  ${events.length} events (${checking.length} checking, ${deleting.length} deleting)`);
  console.log(`  final: ${last.done}/${last.total}, ${last.freedBytes}/${last.totalBytes} bytes, ` +
    `${last.ratePerSec.toFixed(0)} files/s, eta ${last.etaMs}ms`);

  check('progress events were emitted', deleting.length > 0, `${deleting.length} deleting events`);
  check('final event reports every file', last.done === 30 && last.total === 30, `${last.done}/${last.total}`);
  check('done never goes backwards',
    deleting.every((e, i) => i === 0 || e.done >= deleting[i - 1].done));
  check('freed bytes reach the total', last.freedBytes === last.totalBytes && last.totalBytes === 30 * 2048,
    `${last.freedBytes} of ${last.totalBytes}`);
  check('a rate is reported', last.ratePerSec > 0, `${last.ratePerSec.toFixed(1)} files/s`);
  check('eta reaches zero at the end', last.etaMs === 0, `${last.etaMs}ms`);
  check('an eta was available mid-run',
    deleting.some((e) => e.done > 0 && e.done < e.total && e.etaMs > 0));
  check('current path is reported', deleting.some((e) => typeof e.currentPath === 'string'));
  check('all 30 actually went to the fake bin', trashed.length === 30 && result.moved.length === 30);

  /* ---------------------------------------------------------------- run 2 */
  console.log('\nCancellation part-way through 40 files:\n');

  const paths2 = await makeFiles(dir, 40);
  const token = new CancelToken();
  const trashed2 = [];
  const cancelAfter = 8;
  const cancellingShell = {
    trashItem: async (p) => {
      await sleep(2);
      trashed2.push(p);
      if (trashed2.length === cancelAfter) token.cancel();
    },
  };

  const planned = await planTrash(paths2, {}, { token });
  const run = await executeTrash(planned.plan, { shell: cancellingShell }, { token });

  console.log(`  moved ${run.moved.length}, remaining ${run.remaining}, cancelled ${run.cancelled}`);

  check('stops promptly after cancel', run.moved.length === cancelAfter, `${run.moved.length} moved`);
  check('reports how many were left', run.remaining === 40 - cancelAfter, `${run.remaining} remaining`);
  check('flagged as cancelled', run.cancelled === true);
  // The fake shell records calls rather than deleting, so "untouched" means
  // the path was never handed to the shell at all.
  check('nothing past the cancel point reached the shell',
    trashed2.length === cancelAfter,
    `${trashed2.length} shell calls for ${paths2.length} paths`);
  check('the files it stopped before are still on disk',
    paths2.filter((p) => fs.existsSync(p)).length === 40,
    'fake shell deletes nothing, so all 40 must remain');
  check('already-moved files are counted as freed', run.freedBytes === cancelAfter * 2048);

  /* ---------------------------------------------------------------- run 3 */
  console.log('\nPlan phase:\n');

  const paths3 = await makeFiles(dir, 12);
  const planEvents = [];
  const planned3 = await planTrash(
    [...paths3, 'C:\\Windows\\System32\\kernel32.dll', path.join(dir, 'ghost.bin')],
    {},
    { onProgress: (p) => planEvents.push({ ...p }) }
  );

  console.log(`  plan ${planned3.plan.length}, refused ${planned3.failed.length}, ` +
    `estimate ${(planned3.estimatedMs / 1000).toFixed(1)}s`);

  check('plan holds only allowed paths', planned3.plan.length === 12, `${planned3.plan.length}`);
  check('refusals are separated out', planned3.failed.length === 2, `${planned3.failed.length}`);
  check('plan totals the bytes', planned3.totalBytes === 12 * 2048);
  check('an up-front estimate is given', planned3.estimatedMs > 0, `${planned3.estimatedMs}ms`);
  check('checking phase reported progress', planEvents.every((e) => e.phase === 'checking'));

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
