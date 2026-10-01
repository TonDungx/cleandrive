#!/usr/bin/env node
'use strict';

// Does a failed scheduled run tell Task Scheduler it failed?
//
//   node scripts/verify-scheduled-exit.js
//
// The Automatic tab shows the code Windows recorded for the last run
// (`describeTaskResult` in lib/scheduler.js), and its "the last run exited with
// an error" line is only ever reached if the process actually exits non-zero.
// Measured on 2026-10-01: `process.exitCode = 1` followed by `app.quit()` exits
// 0 under Electron 33, on electron.exe and on the packaged CleanDrive.exe
// alike -- only `app.exit(code)` carries the code out. The scheduled run had
// ended with `app.quit()` since v0.1.0, so every failure looked like success.
//
// This starts the real main.js with `--scheduled-run`, the way the task does,
// against a throwaway user-data folder, twice:
//
//   1. nothing wrong (no settings file, so the run is skipped)  -> exit 0;
//   2. the run log cannot be written (its path is a folder)     -> exit 1;
//   3. a report-only profile over an empty folder, the one run here that
//      reaches the notification at the end                      -> exit 0.
//
// The third is there because of what fixing the first two exposed: since
// 2026-09-19 `notify()` asked a `Notification` that scheduled-run.js no longer
// imported, so every run that had something to say threw after its log was
// written. With `app.quit()` that was invisible; with `app.exit(code)` it
// would have turned every good run into a failed one.
//
// Nothing is deleted: the first two have no policy to act on and the third is
// report-only over a folder with nothing in it. No toast reaches the screen:
// lib/notify.js refuses while CLEANDRIVE_TASK_SUFFIX is set.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const REPO = path.join(__dirname, '..');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');

const sandboxes = [];
process.on('exit', () => {
  for (const dir of sandboxes) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a temp folder left behind is not a failure */
    }
  }
});

function sandbox(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cleandrive-schedexit-${name}-`));
  sandboxes.push(dir);
  return dir;
}

function run(userData) {
  const env = { ...process.env, CLEANDRIVE_TASK_SUFFIX: 'schedexit' };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(ELECTRON, [REPO, `--user-data-dir=${userData}`, '--scheduled-run'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 90000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Date.now() - started, out });
    });
  });
}

(async () => {
  console.log('\nscheduled run: the exit code reaches the caller\n');

  const quiet = sandbox('ok');
  const ok = await run(quiet);
  // Isolation, proved rather than assumed: the run writes its measurement and
  // its log into the folder it was given, so both must be there.
  check('the run used the throwaway user-data folder', fs.existsSync(path.join(quiet, 'history.json')) && fs.existsSync(path.join(quiet, 'autoclean-log.json')), quiet);
  check('a run with nothing wrong exits 0', ok.code === 0, `exit ${ok.code} after ${ok.ms} ms`);
  check('and nothing threw on the way out', !/run failed/.test(ok.out), (ok.out.match(/run failed[^\n]*/) || [''])[0]);
  const log = JSON.parse(fs.readFileSync(path.join(quiet, 'autoclean-log.json'), 'utf8'));
  check('and it was a skip, so nothing was acted on', log.runs[0] && log.runs[0].outcome === 'skipped', log.runs[0] && log.runs[0].outcome);

  console.log('');
  const told = sandbox('notify');
  const empty = path.join(told, 'empty-folder');
  fs.mkdirSync(empty);
  const { defaults } = require('../src/main/lib/settings');
  const settings = defaults();
  const profile = settings.autoClean.profiles[0];
  Object.assign(profile, { enabled: true, dryRun: true, notify: true, roots: [empty], skipIfRunning: [], minDiskUsedPercent: 0 });
  settings.trends.dailySample = false;
  fs.writeFileSync(path.join(told, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  const said = await run(told);
  const saidLog = JSON.parse(fs.readFileSync(path.join(told, 'autoclean-log.json'), 'utf8'));
  const last = saidLog.runs[0] || {};
  check('a report-only profile over an empty folder ran', last.outcome === 'ok' && last.profileId === profile.id, `${last.outcome} / ${last.profileId}`);
  check('it got as far as the notification without throwing', !/run failed/.test(said.out), (said.out.match(/run failed[^\n]*/) || [''])[0]);
  check('and exits 0', said.code === 0, `exit ${said.code} after ${said.ms} ms`);

  const broken = sandbox('fail');
  // The run log's path taken by a folder: the one failure runScheduled reports
  // with process.exitCode = 1 without needing a broken disk.
  fs.mkdirSync(path.join(broken, 'autoclean-log.json'));
  const bad = await run(broken);
  check('the run used the throwaway user-data folder', fs.existsSync(path.join(broken, 'history.json')), broken);
  check('the failure was the one arranged', /run log could not be written/.test(bad.out), (bad.out.match(/\[scheduled\][^\n]*/g) || []).join(' | '));
  check('a run that could not record itself exits 1, not 0', bad.code === 1, `exit ${bad.code} after ${bad.ms} ms`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
