#!/usr/bin/env node
'use strict';

// Drives the real Schedule and Trends screens against a real settings file and
// a real Task Scheduler query, and checks what they display.
//
//   npx electron scripts/verify-schedule.js
//
// ## What it deliberately does not do
//
// It never registers a Windows task. Every task name is suffixed, automatic
// cleanup stays switched off, and the daily measurement is switched off in the
// seeded settings -- so the only Task Scheduler calls this makes are queries,
// which read. Registering a task on the machine running a verification script
// is the mistake that cost this project a working schedule once already; see
// "The schedule stopped running, and nothing noticed" in the README.
//
// Proving that a five-minute interval really fires with the app closed needs an
// actual registration and actual waiting, which is `--live` in
// test-scheduler.js, or the app's own Save button.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.setName(require('../package.json').name);

// Before requiring ipc.js (which pulls in the scheduler) and before anything
// asks for a path.
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'verify';
const PRODUCTION_USER_DATA = app.getPath('userData');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-verify-schedule-'));
app.setPath('userData', SANDBOX);

const ipc = require('../src/main/ipc');
const { cleanupTaskPath, sampleTaskPath } = require('../src/main/lib/scheduler');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(win, expression, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await win.webContents.executeJavaScript(expression);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${expression}`);
    await wait(200);
  }
}

app.whenReady().then(async () => {
  ipc.register();

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const rendererErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) rendererErrors.push(message);
  });

  try {
    console.log('\nverify: the schedule screen\n');

    check('the sandbox is not the real data directory', SANDBOX !== PRODUCTION_USER_DATA, SANDBOX);
    check('and the task names cannot collide with the real ones',
      /_verify$/.test(cleanupTaskPath()) && /_verify$/.test(sampleTaskPath()), cleanupTaskPath());

    // Seeded rather than left to the defaults, because the default daily
    // measurement would register a task and this script must not.
    fs.writeFileSync(
      path.join(SANDBOX, 'settings.json'),
      `${JSON.stringify(
        {
          version: 1,
          autoClean: { enabled: false, dryRun: true, roots: [], schedule: { kind: 'weekly', time: '02:00', weekday: 0 } },
          trends: { dailySample: false, sampleTime: '12:00' },
        },
        null,
        2
      )}\n`
    );

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="auto"]').click()`);
    await until(win, `document.getElementById('auto-categories').children.length > 0`);

    /* -- the interval schedule in the form ------------------------------- */

    const kinds = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('#auto-kind option')].map(o => o.value)`
    );
    check('an interval is offered alongside the appointments',
      kinds.join(',') === 'minutes,daily,weekly,monthly', kinds.join(','));

    const rowsForWeekly = await win.webContents.executeJavaScript(`({
      minutes: document.getElementById('auto-minutes-row').hidden,
      time: document.getElementById('auto-time-row').hidden,
      weekday: document.getElementById('auto-weekday-row').hidden,
    })`);
    check('a weekly schedule hides the interval box', rowsForWeekly.minutes === true);
    check('and shows the time and the weekday',
      rowsForWeekly.time === false && rowsForWeekly.weekday === false);

    const rowsForMinutes = await win.webContents.executeJavaScript(`
      (() => {
        const kind = document.getElementById('auto-kind');
        kind.value = 'minutes';
        kind.dispatchEvent(new Event('change'));
        return {
          minutes: document.getElementById('auto-minutes-row').hidden,
          time: document.getElementById('auto-time-row').hidden,
          weekday: document.getElementById('auto-weekday-row').hidden,
          note: document.getElementById('auto-schedule-note').textContent,
        };
      })()
    `);
    check('switching to an interval reveals the interval box', rowsForMinutes.minutes === false);
    // A start time means nothing to a repetition that runs from midnight, so
    // leaving the control on screen would be a knob that changes nothing.
    check('and hides the start time, which an interval does not use', rowsForMinutes.time === true);
    check('the note says it keeps running with the app closed',
      /closed/.test(rowsForMinutes.note) && /restart/.test(rowsForMinutes.note), rowsForMinutes.note);

    /* -- round trip through the real settings file ----------------------- */

    const saved = await win.webContents.executeJavaScript(`
      (async () => {
        const reply = await window.cleandrive.saveSettings({
          autoClean: {
            enabled: false, dryRun: true, roots: [],
            categories: ['cache'], minAgeDays: 180, skipIfRunning: [], maxItemsPerRun: 500,
            schedule: { kind: 'minutes', time: '02:00', weekday: 0, day: 1, everyMinutes: 5, catchUpAtLogon: true },
          },
        });
        return reply;
      })()
    `);
    check('the interval saves through the real IPC path', saved.ok === true, saved.error || '');
    const schedule = saved.ok ? saved.data.settings.autoClean.schedule : {};
    check('the interval comes back', schedule.everyMinutes === 5, String(schedule.everyMinutes));
    check('so does the logon catch-up', schedule.catchUpAtLogon === true);
    check('and the kind', schedule.kind === 'minutes', schedule.kind);

    const onDisk = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'settings.json'), 'utf8'));
    check('it reached the file on disk, which is the whole point',
      onDisk.autoClean.schedule.everyMinutes === 5 && onDisk.autoClean.schedule.kind === 'minutes',
      JSON.stringify(onDisk.autoClean.schedule));

    check('switched off, no task is registered',
      saved.ok && saved.data.tasks.cleanup.installed === false);
    check('and the screen says so rather than showing a next run time',
      saved.ok && saved.data.scheduler.nextRunAt === null);

    /* -- what the task card reports -------------------------------------- */

    const facts = await win.webContents.executeJavaScript(`
      [...document.querySelectorAll('#task-facts .pair-row')].map(r => r.textContent)
    `);
    check('the task card lists what Windows holds', facts.length > 0, String(facts.length));
    check('including the registration state',
      facts.some((f) => /Registered task/.test(f) && /none/.test(f)), facts.join(' | '));
    check('and defers the run times to Windows rather than inventing them',
      facts.some((f) => /Windows says last run/.test(f)), facts.join(' | '));

    // The expensive path: a real trip through the Schedule.Service COM object.
    const started = Date.now();
    const osInfo = await win.webContents.executeJavaScript(
      `window.cleandrive.taskStatus({ fresh: true })`
    );
    const elapsed = Date.now() - started;
    check('Windows can be asked directly', osInfo.ok === true, osInfo.error || '');
    check('and reports nothing registered for a task that is not there',
      osInfo.ok && osInfo.data.cleanup.installed === false);
    // Both tasks in one process. The cmdlet version of this took 5.3s for one
    // task; a button nobody is willing to press is not a button.
    check('asking about both tasks stays under three seconds', elapsed < 3000, `${elapsed}ms`);
    console.log(`    Windows answered about two tasks in ${elapsed}ms`);

    // The card rendered from the OS's answer, rather than from the cheap
    // existence check -- a separate code path, and the one the user reads.
    const withOs = await win.webContents.executeJavaScript(`
      (async () => {
        await refreshTaskStatus({ quiet: true, fresh: true });
        return {
          facts: [...document.querySelectorAll('#task-facts .pair-row')].map(r => r.textContent),
          status: document.getElementById('task-status').textContent,
        };
      })()
    `);
    check('the card says plainly that no task is registered',
      /no CleanDrive cleanup task/.test(withOs.status), withOs.status);
    check('and reports why Windows could not be asked about it, rather than a blank',
      withOs.facts.some((f) => /Could not ask Windows/.test(f)), withOs.facts.join(' | '));
    // No readings at all for a task Windows has never heard of: "last run:
    // never" would be a fact about nothing, dressed as a measurement.
    check('with no run times invented for a task that does not exist',
      !withOs.facts.some((f) => /Windows says last run/.test(f)), withOs.facts.join(' | '));
    // The intention and the OS's answer are separate rows. A single row that
    // fell back to the settings when nothing was registered would present a
    // plan as a confirmation, which is the confusion this card exists to end.
    check('what the settings ask for is a row of its own',
      withOs.facts.some((f) => /These settings ask for/.test(f) && /every 5 minutes/.test(f)),
      withOs.facts.join(' | '));
    check('and what Windows holds says "nothing" rather than echoing the settings',
      withOs.facts.some((f) => /Windows holds/.test(f) && /nothing/.test(f)),
      withOs.facts.join(' | '));

    /* -- the trends measuring card --------------------------------------- */

    console.log('\nverify: where the trend numbers come from\n');

    await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="trends"]').click()`);
    await until(win, `document.querySelectorAll('#trend-sampling .pair-row').length > 0`);

    const sampling = await win.webContents.executeJavaScript(`
      [...document.querySelectorAll('#trend-sampling .pair-row')].map(r => r.textContent)
    `);
    check('the tab names every sampler', sampling.length >= 5, sampling.join(' | '));
    check('including the daily Windows task',
      sampling.some((s) => /Daily Windows task/.test(s)), sampling.join(' | '));
    check('and reports it off, as the seeded settings have it',
      sampling.some((s) => /Daily Windows task/.test(s) && /off/.test(s)), sampling.join(' | '));

    const before = await win.webContents.executeJavaScript(
      `document.getElementById('trend-samples').textContent`
    );

    const measured = await win.webContents.executeJavaScript(`window.cleandrive.sampleNow()`);
    check('a measurement can be taken on demand', measured.ok === true, measured.error || '');
    check('and it records a real volume',
      measured.ok && Object.keys(measured.data.volumes).length > 0,
      measured.ok ? Object.keys(measured.data.volumes).join(', ') : '');

    const repeat = await win.webContents.executeJavaScript(`window.cleandrive.sampleNow()`);
    // Pressing the button twice must not manufacture a trend.
    check('a second measurement within half an hour replaces rather than appends',
      repeat.ok === true && repeat.data.coalesced === true && repeat.data.snapshots === measured.data.snapshots,
      repeat.ok ? `${repeat.data.snapshots} snapshot(s), coalesced=${repeat.data.coalesced}` : '');

    console.log(`    measurement count went from "${before}" to ${measured.data.snapshots}`);

    const history = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'history.json'), 'utf8'));
    check('the measurement is on disk', history.snapshots.length >= 1, String(history.snapshots.length));
    check('with a source that says how it was taken',
      history.snapshots.some((s) => s.source === 'manual' || s.source === 'launch'),
      history.snapshots.map((s) => s.source).join(', '));
    check('and no scan attached, because nothing was scanned',
      history.snapshots.every((s) => s.scan === null));

    console.log('\nverify: console\n');
    check('no renderer errors', rendererErrors.length === 0, rendererErrors.join(' | '));
  } catch (err) {
    failures++;
    console.error('\nVERIFY THREW:', err);
  } finally {
    // Nothing to undo: no task was registered, and the data went to a temp
    // directory. Chromium may still hold its caches open here.
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${SANDBOX})`);
    }
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
});
