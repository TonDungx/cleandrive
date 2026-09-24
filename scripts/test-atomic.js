#!/usr/bin/env node
'use strict';

// Saving over a file that something else has open for a moment.
//
//   node scripts/test-atomic.js
//
// Every settings, history, log and snapshot write ends with a rename over the
// real file, and on Windows that rename fails with EPERM while another process
// holds the file without FILE_SHARE_DELETE -- a virus scanner, the indexer. It
// happened once in seven end-to-end runs here. The helper retries; this checks
// it retries the right errors, gives up on the rest, and -- on Windows -- that
// a real settings save survives a real lock taken by another process.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { renameRetrying, ATTEMPTS } = require('../src/main/lib/atomic');
const { SettingsStore } = require('../src/main/lib/settings');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const failing = (codes) => {
  const calls = { n: 0 };
  const rename = async () => {
    const code = codes[calls.n];
    calls.n += 1;
    if (code) throw Object.assign(new Error(code), { code });
  };
  return { calls, rename };
};

/**
 * Another process opens `file` for reading while refusing to share delete --
 * the way a scanner does -- holds it for `ms`, and lets go.
 */
function holdOpen(file, ms) {
  const script = [
    `$f = [System.IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'Read', 'Read')`,
    "[Console]::Out.WriteLine('held')",
    `Start-Sleep -Milliseconds ${ms}`,
    '$f.Close()',
  ].join('; ');
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  const held = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      if (/held/.test(String(d))) resolve();
    });
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
  const done = new Promise((resolve) => child.once('exit', resolve));
  return { held, done };
}

(async () => {
  console.log('\nThe helper:');
  {
    const twice = failing(['EPERM', 'EPERM']);
    const r = await renameRetrying('a', 'b', { rename: twice.rename, stepMs: 1 });
    check('EPERM twice, then it goes through', r.attempts === 3 && twice.calls.n === 3);
    const busy = failing(['EBUSY', 'EACCES']);
    await renameRetrying('a', 'b', { rename: busy.rename, stepMs: 1 });
    check('EBUSY and EACCES are waited out the same way', busy.calls.n === 3);
    const never = failing(Array(20).fill('EPERM'));
    let threw = null;
    try {
      await renameRetrying('a', 'b', { rename: never.rename, stepMs: 1 });
    } catch (err) {
      threw = err;
    }
    check(`a lock that never lets go fails after ${ATTEMPTS} tries, with the real error`, threw && threw.code === 'EPERM' && never.calls.n === ATTEMPTS);
    const missing = failing(['ENOENT']);
    let gone = null;
    try {
      await renameRetrying('a', 'b', { rename: missing.rename, stepMs: 1 });
    } catch (err) {
      gone = err;
    }
    check('any other error is thrown at once, not retried', gone && gone.code === 'ENOENT' && missing.calls.n === 1);
  }

  if (process.platform !== 'win32') {
    console.log('\n(not Windows; the real lock is skipped)');
  } else {
    console.log('\nA real save, while another process holds the file:');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-atomic-'));
    try {
      const file = path.join(dir, 'settings.json');
      const store = new SettingsStore(file);
      await store.save({});
      const plain = await fsp.rename(path.join(dir, 'x'), file).catch((e) => e);
      check('(the setup: a rename of a missing file fails, as it should)', plain && plain.code === 'ENOENT');

      // Without the retry, this is what the save would meet.
      const lock1 = holdOpen(file, 400);
      await lock1.held;
      const raw = await fsp.writeFile(`${file}.probe`, '{}').then(() => fsp.rename(`${file}.probe`, file)).catch((e) => e);
      await lock1.done;
      check('a plain rename over the held file fails -- this is the error that was seen', raw && raw.code === 'EPERM', raw && raw.code);

      const lock2 = holdOpen(file, 200);
      await lock2.held;
      const t0 = Date.now();
      const saved = await store.save({ appearance: { theme: 'dark' } }).then(() => true, (e) => e);
      const ms = Date.now() - t0;
      await lock2.done;
      const back = JSON.parse(await fsp.readFile(file, 'utf8'));
      check('the settings save waits for it and succeeds', saved === true && back.appearance.theme === 'dark',
        saved === true ? `${ms} ms` : String(saved && saved.code));
      const leftovers = (await fsp.readdir(dir)).filter((n) => n.endsWith('.tmp'));
      check('and leaves no temporary file behind', leftovers.length === 0, leftovers.join(', '));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
