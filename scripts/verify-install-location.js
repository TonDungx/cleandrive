#!/usr/bin/env node
'use strict';

// Proves the property that makes "install it wherever you like" safe.
//
//   node scripts/verify-install-location.js [targetDir]
//
// A Windows scheduled task stores an absolute path to the executable it
// launches. Installing the app to D:\Tools instead of C:\Program Files, or
// moving it afterwards, would therefore leave a task pointing at somewhere the
// app no longer is — failing every week, in the background, while the settings
// screen goes on reporting a next run time. The app defends against that by
// reading the registered command back on every launch and re-registering when
// it no longer matches.
//
// This test builds the situation deliberately: it registers a task pointing at
// a path that does not exist, starts the app from a *different* drive, and
// checks the task now points at the copy that actually ran.
//
// Run `npm run build -- dir` first; this needs dist/win-unpacked.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Both set before the scheduler is required and before the child is started,
// so the harness and the app under test agree on a name that is not the real
// one. This script used to register, and then unregister, the very task a real
// user had configured -- the same mistake that cost this project a working
// 02:00 cleanup. See "The schedule stopped running, and nothing noticed" in the
// README.
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'verifymove';

const scheduler = require('../src/main/lib/scheduler');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = path.join(__dirname, '..');
const UNPACKED = path.join(ROOT, 'dist', 'win-unpacked');

// Somewhere that is not the project, and ideally not the same drive.
const TARGET = process.argv[2] || path.join('D:', path.sep, 'cleandrive-location-test', 'CleanDrive');

// The child app is a separate packaged process, so it cannot be redirected with
// `app.setPath` the way the in-process harnesses are. Electron honours
// Chromium's `--user-data-dir`, which does the same job from the outside: the
// app under test reads and writes a throwaway directory, and the real
// settings.json, history.json and run log are never opened.
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-loc-userdata-'));
const SETTINGS = path.join(USER_DATA, 'settings.json');

(async () => {
  if (!fs.existsSync(path.join(UNPACKED, 'CleanDrive.exe'))) {
    console.error(`\nNo build to test. Run:  npm run build -- dir\n(expected ${UNPACKED})\n`);
    process.exit(1);
  }

  console.log(`\nverify: running the app from ${TARGET}\n`);

  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-loc-'));

  try {
    /* ---- 1. put a copy somewhere else ----------------------------------- */
    fs.rmSync(path.dirname(TARGET), { recursive: true, force: true });
    fs.mkdirSync(TARGET, { recursive: true });
    fs.cpSync(UNPACKED, TARGET, { recursive: true });

    const movedExe = path.join(TARGET, 'CleanDrive.exe');
    check('the app copies to another location intact', fs.existsSync(movedExe), movedExe);
    check('and lands outside the project it was built in',
      !movedExe.toLowerCase().startsWith(ROOT.toLowerCase()), movedExe);

    /* ---- 2. a schedule that is switched on -------------------------------- */
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(SETTINGS, `${JSON.stringify({
      version: 1,
      autoClean: {
        enabled: true,
        dryRun: true,
        roots: [scanRoot],
        schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1 },
      },
    }, null, 2)}\n`, 'utf8');

    /* ---- 3. a task pointing somewhere the app is not ---------------------- */
    const stalePath = path.join('C:', path.sep, 'Program Files', 'Somewhere Else', 'CleanDrive.exe');
    const registered = await scheduler.install({
      schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1 },
      invocation: { command: stalePath, args: '--scheduled-run', workingDirectory: path.dirname(stalePath) },
    });
    check('a task can be registered pointing at a stale path', registered.ok === true, registered.error || '');

    const before = await scheduler.installedInvocation();
    check('and it really does point there', before && before.command === stalePath,
      before ? before.command : 'null');

    /* ---- 4. start the app from its new home ------------------------------- */
    console.log('\n  starting the moved copy (a window will appear briefly)…\n');

    // ELECTRON_RUN_AS_NODE must not reach the child. If it is set in this
    // shell, the app starts as a bare Node process instead of an Electron one:
    // no window, no startup work, and a test that reports the feature broken
    // when it is the harness that is.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    // stdio is inherited rather than discarded: the app logs what it did to the
    // task, and a test that cannot see that is guessing.
    const child = spawn(movedExe, [`--user-data-dir=${USER_DATA}`], { stdio: 'inherit', env });

    let started = false;
    child.on('spawn', () => { started = true; });
    child.on('error', (err) => console.log(`  (could not start: ${err.message})`));

    // Long enough for app.whenReady, the settings read, and two schtasks calls
    // that each spawn a process of their own.
    await wait(12000);
    check('the moved copy actually started', started === true);

    child.kill();
    await wait(1500);

    /* ---- 5. did it notice? ------------------------------------------------ */
    const after = await scheduler.installedInvocation();
    check('the task no longer points at the stale path',
      after !== null && after.command.toLowerCase() !== stalePath.toLowerCase(),
      after ? after.command : 'null');
    check('it points at the copy that actually ran',
      after !== null && after.command.toLowerCase() === movedExe.toLowerCase(),
      after ? after.command : 'null');
    check('and a packaged build passes only the flag, with no project path',
      after !== null && after.args === '--scheduled-run', after ? after.args : 'null');
  } finally {
    // Only ever the suffixed task and two temp directories: there is nothing of
    // the tester's to put back.
    await scheduler.uninstall(scheduler.cleanupTaskPath()).catch(() => {});
    await scheduler.uninstall(scheduler.sampleTaskPath()).catch(() => {});
    fs.rmSync(path.dirname(TARGET), { recursive: true, force: true });
    fs.rmSync(scanRoot, { recursive: true, force: true });
    try {
      fs.rmSync(USER_DATA, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${USER_DATA})`);
    }
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
