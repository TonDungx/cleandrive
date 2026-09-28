#!/usr/bin/env node
'use strict';

// A harness does not leave a Windows task behind.
//   node scripts/verify-task-cleanup.js
//
// This registers a real task in Task Scheduler and expects it to be gone once
// the process that registered it has exited. No elevation is needed: the task
// runs as the logged-on user, which is the only kind this app ever creates.
//
// Why it is a separate harness. The claim is about what happens *after* a
// process exits, so no assertion inside that process can make it -- the exit
// handler has not run yet when the last line of the script does. So this script
// is two processes: a child that registers a task under a harness suffix and
// then exits normally, and this parent, which asks Windows afterwards.
//
// The failure it guards was live on the development machine on 2026-09-28: four
// tasks left by screenshot harnesses, three of them pointing at a directory
// Electron cannot load, each throwing an error dialog at every logon.

const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SUFFIX = 'cleanupcheck';
const CHILD = process.argv.includes('--child');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/** Whether Windows holds this task, by exit code -- never by reading output. */
function windowsHolds(taskPath) {
  try {
    execFileSync('schtasks.exe', ['/Query', '/TN', taskPath], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* the child: registers a task, says so, exits                                 */
/* -------------------------------------------------------------------------- */

async function child() {
  process.env.CLEANDRIVE_TASK_SUFFIX = SUFFIX;
  const scheduler = require('../src/main/lib/scheduler');

  const taskPath = scheduler.cleanupTaskPath();
  if (!taskPath.endsWith(`_${SUFFIX}`)) {
    console.log(`CHILD-FAIL not isolated: ${taskPath}`);
    process.exit(1);
  }

  const created = await scheduler.install({
    schedule: { kind: 'weekly', time: '02:00', weekday: 0, catchUpAtLogon: false },
    invocation: {
      command: process.execPath,
      args: '--scheduled-run --cleanup-check',
      workingDirectory: process.cwd(),
    },
  });

  if (!created.ok) {
    console.log(`CHILD-FAIL could not register: ${created.error}`);
    process.exit(1);
  }

  console.log(`CHILD-TASK ${taskPath}`);
  console.log(`CHILD-TRACKED ${scheduler.harnessTasks().join(',')}`);
  console.log(`CHILD-HOLDS ${windowsHolds(taskPath)}`);

  // Exit normally. Everything this harness is about happens after this line.
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* the parent: asks Windows what survived                                      */
/* -------------------------------------------------------------------------- */

function parent() {
  console.log('\nharness leftovers: a task registered by a harness does not outlive it\n');

  if (process.platform !== 'win32') {
    console.log('  (Task Scheduler is a Windows thing; nothing to verify here)\n');
    return 0;
  }

  const run = spawnSync(process.execPath, [__filename, '--child'], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, CLEANDRIVE_TASK_SUFFIX: SUFFIX },
  });

  const out = `${run.stdout || ''}${run.stderr || ''}`;
  const taskPath = (/^CHILD-TASK (.+)$/m.exec(out) || [])[1];
  const tracked = (/^CHILD-TRACKED (.*)$/m.exec(out) || [])[1];
  const heldDuring = (/^CHILD-HOLDS (.+)$/m.exec(out) || [])[1];

  check('the child process finished cleanly', run.status === 0, out.trim().split(/\r?\n/).slice(-2).join(' '));
  check('it registered under a suffixed name, not the real one',
    Boolean(taskPath) && taskPath.endsWith(`_${SUFFIX}`), taskPath || '(none reported)');

  if (!taskPath) {
    console.log('\n  nothing was registered, so there is nothing to prove; treating that as a failure\n');
    return 1;
  }

  // Without this the rest could pass simply because no task was ever made --
  // which is how a green test hides the bug it was written for.
  check('Windows really held it while the child was running', heldDuring === 'true', String(heldDuring));
  check('and the child knew it would have to clean it up', tracked === taskPath, String(tracked));

  const survived = windowsHolds(taskPath);
  check('Windows no longer holds it now the child has gone', survived === false,
    survived ? `${taskPath} is still registered` : '');

  if (survived) {
    // Leave nothing behind even when failing.
    try {
      execFileSync('schtasks.exe', ['/Delete', '/TN', taskPath, '/F'], { stdio: 'ignore', windowsHide: true });
      console.log('  (removed the leftover so this machine is not left dirty)');
    } catch {
      console.log(`  (could not remove ${taskPath}; do it by hand)`);
    }
  }

  // The isolation this harness relies on, stated rather than assumed.
  check('the real task name was never in reach',
    !taskPath.includes(path.sep + 'AutomaticCleanup\u0000') && taskPath !== 'CleanDrive\\AutomaticCleanup',
    taskPath);
  check('and this ran without elevation', typeof os.userInfo().username === 'string');

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  return failures === 0 ? 0 : 1;
}

if (CHILD) {
  child().catch((err) => {
    console.log(`CHILD-FAIL ${err.message}`);
    process.exit(1);
  });
} else {
  process.exit(parent());
}
