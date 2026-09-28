#!/usr/bin/env node
'use strict';

// What this project has left behind in Windows Task Scheduler.
//   npm run tasks:leftovers            (list)
//   npm run tasks:leftovers -- --remove  (list, then remove the leftovers)
//
// Why this exists. A harness registers its task under a name carrying
// CLEANDRIVE_TASK_SUFFIX, and since 2026-09-28 the scheduler removes that task
// when the harness exits. A harness that is *killed* never gets to do so, and
// before that date none of them did at all -- four such tasks were found on the
// development machine, three of them pointing at `<project>\scripts`, a
// directory Electron cannot load. They fired at every logon and each threw an
// "Unable to find Electron app" dialog.
//
// The rule this applies is the one the app itself cannot: a task whose name has
// a suffix that is not a profile id was made by a test, so it is a leftover.
// The app's own sweep (tasks.js) deliberately refuses that judgement, because
// from inside the app "AutomaticCleanup_dev" could equally be a profile called
// "dev". Run from here, with no app to protect, the judgement is safe to make.
//
// Nothing outside the CleanDrive task folder is ever read or touched.

const { execFileSync } = require('node:child_process');

const {
  TASK_FOLDER,
  TASK_NAME,
  SAMPLE_TASK_NAME,
  cleanupTaskPath,
  sampleTaskPath,
  profileOfTaskName,
} = require('../src/main/lib/scheduler');

const REMOVE = process.argv.includes('--remove');

/**
 * The tasks Windows holds in the CleanDrive folder.
 *
 * Read from the COM object rather than `schtasks` table output, for the reason
 * scheduler.js gives at length: that output is localised, and this machine
 * renders times as "9:45 SA".
 */
function listTasks() {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    '$service = New-Object -ComObject Schedule.Service',
    '$service.Connect()',
    `$folder = $service.GetFolder("\\${TASK_FOLDER}")`,
    '$folder.GetTasks(1) | ForEach-Object {',
    '  $action = $_.Definition.Actions | Select-Object -First 1',
    '  "" + $_.Name + "|" + $action.Path + "|" + $action.Arguments',
    '}',
  ].join('; ');

  let out;
  try {
    out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    );
  } catch {
    // No folder means nothing was ever registered, which is not a failure.
    return [];
  }

  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, command = '', args = ''] = line.split('|');
      return { name, command, args };
    });
}

/**
 * Whether a task in this folder was made by a harness.
 *
 * Two names are the app's own and are never leftovers: the bare cleanup and
 * sampler names, plus any cleanup name that resolves to a real profile id.
 * Everything else in this folder carries a suffix no profile would produce.
 */
function isLeftover(name) {
  if (name === TASK_NAME || name === SAMPLE_TASK_NAME) return false;
  if (name.startsWith(TASK_NAME) && profileOfTaskName(name)) return false;
  return true;
}

/** Whether Electron could load what this task points at. */
function looksBroken(args) {
  const quoted = /^"([^"]+)"/.exec(args || '');
  if (!quoted) return false;
  try {
    const manifest = require('node:path').join(quoted[1], 'package.json');
    return typeof JSON.parse(require('node:fs').readFileSync(manifest, 'utf8')).main !== 'string';
  } catch {
    return true;
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.log('\nTask Scheduler is a Windows thing; nothing to list here.\n');
    return 0;
  }

  const tasks = listTasks();
  const leftovers = tasks.filter((task) => isLeftover(task.name));

  console.log(`\nTasks in \\${TASK_FOLDER}: ${tasks.length}\n`);
  for (const task of tasks) {
    const leftover = isLeftover(task.name);
    const broken = leftover && looksBroken(task.args);
    const tag = !leftover ? 'the app' : broken ? 'LEFTOVER, cannot run' : 'leftover';
    console.log(`  [${tag}] ${task.name}`);
    console.log(`      ${task.command} ${task.args}`.trimEnd());
  }

  if (leftovers.length === 0) {
    console.log('\nNo harness leftovers.\n');
    return 0;
  }

  console.log(`\n${leftovers.length} leftover(s) from harness runs.`);
  if (!REMOVE) {
    console.log('Pass --remove to delete them. The app’s own tasks are never touched.\n');
    return 0;
  }

  let failed = 0;
  for (const task of leftovers) {
    const taskPath = `\\${TASK_FOLDER}\\${task.name}`;
    try {
      execFileSync('schtasks.exe', ['/Delete', '/TN', taskPath, '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 15000,
      });
      console.log(`  removed  ${taskPath}`);
    } catch (err) {
      failed++;
      console.log(`  FAILED   ${taskPath}  -- ${err.message}`);
    }
  }

  // Named so the reader can check the two that are meant to survive.
  console.log(`\nThe app's own names, left alone: ${cleanupTaskPath()}, ${sampleTaskPath()}\n`);
  return failed === 0 ? 0 : 1;
}

process.exit(main());
