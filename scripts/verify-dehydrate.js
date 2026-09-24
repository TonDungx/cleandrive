#!/usr/bin/env node
'use strict';

// OneDrive "free up space" (B3) against the real OneDrive of whoever runs it.
//
//   node scripts/verify-dehydrate.js            read only: what Windows says about
//                                               this OneDrive's files, and proof
//                                               that asking changes nothing
//   node scripts/verify-dehydrate.js --write    also: make three small files of its
//                                               own online-only, and measure it
//
// The read-only pass looks at every OneDrive file of 1 MB or more, groups them
// the way the What to delete card would, and checks that what each takes on
// the disk is the same after asking as before -- the query must never make a
// placeholder download, or the reverse.
//
// The write pass needs OneDrive running and signed in. It creates a folder of
// its own inside OneDrive, "CleanDrive B3 check <random>", refusing if that
// name is already taken; writes three 2 MB files of random bytes into it; waits
// for OneDrive to upload them; runs them through the app's own pipeline
// (execute -> the dehydrate handler, the real Windows calls, nothing stood in);
// measures what came back to the disk; and deletes the folder again. It never
// acts on a path outside that folder, and says so if asked to. Deleting the
// folder deletes those three files from OneDrive too, which is the point: they
// were only ever the test's.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const cloudState = require('../src/main/lib/cloud-state');
const { execute } = require('../src/main/actions/execute');
const { ActionJournal } = require('../src/main/journal/journal');

const WRITE = process.argv.includes('--write');
const MB = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && st.size >= MB) out.push({ path: full, size: st.size, allocated: st.blocks * 512 });
  }
  return out;
}

async function readOnly(root) {
  console.log(`\nRead only, ${root}:`);
  const files = walk(root, []);
  const t0 = Date.now();
  const reply = await cloudState.query(files.map((f) => f.path));
  const ms = Date.now() - t0;
  check('Windows answers for every file', reply.ok && reply.states.size === files.length,
    reply.ok ? `${reply.states.size} of ${files.length} in ${ms} ms` : reply.reason);
  if (!reply.ok) return;

  const groups = {};
  for (const f of files) {
    const s = reply.states.get(f.path);
    const key = s.missing ? 'missing' : !s.placeholder ? 'never uploaded' : !s.onDisk ? 'online-only already' : !s.inSync ? 'waiting to sync'
      : s.pinned ? 'offered: in sync, always keep' : 'offered: in sync, on this disk';
    groups[key] = groups[key] || { n: 0, bytes: 0 };
    groups[key].n++;
    groups[key].bytes += f.size;
  }
  for (const [k, g] of Object.entries(groups)) console.log(`    ${k.padEnd(32)} ${String(g.n).padStart(5)} files  ${(g.bytes / MB).toFixed(1)} MB`);

  const after = files.map((f) => ({ ...f, now: fs.lstatSync(f.path).blocks * 512 }));
  const changed = after.filter((f) => f.now !== f.allocated);
  check('asking changed what no file takes on the disk', changed.length === 0, changed.length ? `${changed.length} changed` : `${files.length} files`);
  console.log(`    OneDrive running: ${await cloudState.oneDriveRunning()}`);
}

async function write(root) {
  console.log('\nWrite, in a folder of its own:');
  if (!(await cloudState.oneDriveRunning())) {
    check('OneDrive is running', false, 'start OneDrive and sign in first');
    return;
  }
  const folder = path.join(root, `CleanDrive B3 check ${crypto.randomBytes(3).toString('hex')}`);
  if (fs.existsSync(folder)) {
    check('its folder name is free', false, folder);
    return;
  }
  await fsp.mkdir(folder);
  const inside = (p) => path.resolve(p).toLowerCase().startsWith(folder.toLowerCase() + path.sep);
  const files = [];
  try {
    for (let i = 0; i < 3; i++) {
      const file = path.join(folder, `check-${i}.bin`);
      await fsp.writeFile(file, crypto.randomBytes(2 * MB));
      files.push(file);
    }
    console.log(`    ${folder}`);

    // Wait for OneDrive to upload them. A OneDrive just started after a long
    // time off catches up on everything else first; measured here, five
    // minutes was not enough.
    const at = process.argv.indexOf('--wait-minutes');
    const minutes = at !== -1 && Number(process.argv[at + 1]) > 0 ? Number(process.argv[at + 1]) : 15;
    const started = Date.now();
    const deadline = started + minutes * 60 * 1000;
    let states = null;
    let last = '';
    for (;;) {
      const reply = await cloudState.query(files);
      states = reply.ok ? reply.states : null;
      const seen = states
        ? files.map((f) => {
            const s = states.get(f);
            return s.inSync ? 'in sync' : s.placeholder ? 'placeholder, not yet in sync' : 'not yet a placeholder';
          }).join(' / ')
        : `could not ask (${reply.reason})`;
      if (seen !== last) {
        console.log(`    ${Math.round((Date.now() - started) / 1000)} s: ${seen}`);
        last = seen;
      }
      if (states && files.every((f) => states.get(f).inSync && states.get(f).onDisk)) break;
      if (Date.now() > deadline) break;
      await sleep(5000);
    }
    check(`OneDrive uploaded all three within ${minutes} min, and reports them in sync with their contents on the disk`,
      states && files.every((f) => states.get(f).inSync && states.get(f).onDisk), `${Math.round((Date.now() - started) / 1000)} s`);
    if (!(states && files.every((f) => states.get(f).inSync))) return;

    const before = await Promise.all(files.map((f) => cloudState.allocated(f)));
    const journal = new ActionJournal(await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-verify-dehydrate-')));
    const items = files.filter(inside);
    check('it acts only on its own files', items.length === files.length);
    const result = await execute(
      { kind: 'dehydrate', items },
      { journal, confirm: async () => true, deps: { watchMs: 60000, stepMs: 1000 } }
    );
    const after = await Promise.all(files.map((f) => cloudState.allocated(f)));
    const reply = await cloudState.query(files);
    console.log(`    on the disk before: ${before.map((b) => (b / MB).toFixed(2)).join(', ')} MB; after: ${after.map((b) => (b / MB).toFixed(2)).join(', ')} MB`);
    check('all three were handed to OneDrive', result.moved.length === 3, JSON.stringify(result.failed));
    check('OneDrive took their contents: nothing of them left on the disk', after.every((a) => a === 0));
    check('and what the app reported freed is exactly the drop it measured',
      result.freedBytes === before.reduce((n, b) => n + b, 0) - after.reduce((n, a) => n + a, 0), `${(result.freedBytes / MB).toFixed(2)} MB`);
    check('Windows now calls them online-only', reply.ok && files.every((f) => !reply.states.get(f).onDisk && reply.states.get(f).unpinned));
    check('with their names and sizes where they were', files.every((f) => fs.statSync(f).size === 2 * MB));
  } finally {
    await fsp.rm(folder, { recursive: true, force: true });
    check('and its folder is gone again', !fs.existsSync(folder));
  }
}

(async () => {
  const root = process.env.OneDrive;
  if (process.platform !== 'win32' || !root || !fs.existsSync(root)) {
    console.log('No OneDrive folder on this machine; nothing to verify.');
    return;
  }
  await readOnly(root);
  if (WRITE) await write(root);
  else console.log('\n(read only; pass --write to make three files of its own online-only)');
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
