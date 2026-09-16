#!/usr/bin/env node
'use strict';

// The XML is checked offline; registering a real task is opt-in, because a
// test suite should not leave entries in the user's Task Scheduler.
//   node scripts/test-scheduler.js           (offline only)
//   node scripts/test-scheduler.js --live    (also registers and removes a task)

const {
  buildTaskXml,
  nextRunAt,
  escapeXml,
  startBoundary,
  install,
  uninstall,
  isInstalled,
  selfInvocation,
  installedInvocation,
  isStale,
  TASK_PATH,
} = require('../src/main/lib/scheduler');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const SEP = String.fromCharCode(92);
const BASE = {
  command: `C:${SEP}Program Files${SEP}App & Co${SEP}app.exe`,
  args: '--scheduled-run',
  workingDirectory: `C:${SEP}app`,
  userId: `HOST${SEP}user`,
  reference: new Date(2026, 0, 15, 12, 0, 0),
};

(async () => {
  console.log('\nscheduler: the task document\n');

  {
    const xml = buildTaskXml({ ...BASE, schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1 } });
    check('a missed run is made up rather than skipped', xml.includes('<StartWhenAvailable>true</StartWhenAvailable>'));
    check('running on battery is allowed, so a laptop still gets cleaned',
      xml.includes('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>'));
    check('the task runs as the logged-on user, not a service account',
      xml.includes('<LogonType>InteractiveToken</LogonType>'));
    check('no elevation is requested', xml.includes('<RunLevel>LeastPrivilege</RunLevel>'));
    check('a run that hangs is capped', xml.includes('<ExecutionTimeLimit>PT2H</ExecutionTimeLimit>'));
    check('a second copy never starts on top of the first',
      xml.includes('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'));
  }

  {
    // A path with an ampersand is ordinary on Windows and would otherwise
    // produce a document Task Scheduler rejects with an unhelpful error.
    const xml = buildTaskXml({ ...BASE, schedule: { kind: 'daily', time: '02:00', weekday: 0, day: 1 } });
    check('an ampersand in the command is escaped', xml.includes('App &amp; Co'));
    check('and the raw ampersand is gone', !/App & Co/.test(xml));
    check('escaping covers the five XML entities',
      escapeXml(`<a href="x" attr='y'>&</a>`) === '&lt;a href=&quot;x&quot; attr=&apos;y&apos;&gt;&amp;&lt;/a&gt;');
  }

  {
    const daily = buildTaskXml({ ...BASE, schedule: { kind: 'daily', time: '03:30', weekday: 0, day: 1 } });
    check('a daily schedule uses ScheduleByDay', daily.includes('<ScheduleByDay>'));
    check('the start boundary carries the configured time', daily.includes('T03:30:00'));

    const weekly = buildTaskXml({ ...BASE, schedule: { kind: 'weekly', time: '02:00', weekday: 3, day: 1 } });
    check('a weekly schedule names the weekday', weekly.includes('<Wednesday />'));

    const monthly = buildTaskXml({ ...BASE, schedule: { kind: 'monthly', time: '02:00', weekday: 0, day: 7 } });
    check('a monthly schedule names the day', monthly.includes('<Day>7</Day>'));
    check('a monthly schedule covers all twelve months', (monthly.match(/<[A-Z][a-z]+ \/>/g) || []).length >= 12);
  }

  {
    check('the start boundary has no timezone suffix, as Task Scheduler expects',
      startBoundary('02:00', BASE.reference) === '2026-01-15T02:00:00');
  }

  console.log('\nscheduler: when the next run falls\n');

  {
    const monday = new Date(2026, 0, 12, 10, 0, 0); // a Monday, 10:00

    const daily = nextRunAt({ kind: 'daily', time: '02:00' }, monday);
    check('a daily time already past today rolls to tomorrow',
      daily.getDate() === 13 && daily.getHours() === 2, daily.toString());

    const laterToday = nextRunAt({ kind: 'daily', time: '23:00' }, monday);
    check('a daily time still ahead stays today', laterToday.getDate() === 12, laterToday.toString());

    const sunday = nextRunAt({ kind: 'weekly', time: '02:00', weekday: 0 }, monday);
    check('a weekly Sunday from a Monday lands six days out',
      sunday.getDay() === 0 && sunday.getDate() === 18, sunday.toString());

    const sameWeekday = nextRunAt({ kind: 'weekly', time: '02:00', weekday: 1 }, monday);
    check('today, but at a time already gone, means next week',
      sameWeekday.getDate() === 19, sameWeekday.toString());

    const monthly = nextRunAt({ kind: 'monthly', time: '02:00', day: 5 }, monday);
    check('a monthly day already past rolls to next month',
      monthly.getMonth() === 1 && monthly.getDate() === 5, monthly.toString());

    const monthlyAhead = nextRunAt({ kind: 'monthly', time: '02:00', day: 28 }, monday);
    check('a monthly day still ahead stays this month',
      monthlyAhead.getMonth() === 0 && monthlyAhead.getDate() === 28, monthlyAhead.toString());
  }

  console.log('\nscheduler: how the app relaunches itself\n');

  {
    const packaged = selfInvocation({ isPackaged: true, getAppPath: () => 'ignored' });
    check('a packaged build passes only the flag', packaged.args === '--scheduled-run', packaged.args);

    const source = selfInvocation({ isPackaged: false, getAppPath: () => `D:${SEP}proj${SEP}cleandrive` });
    check('running from source passes the project directory first',
      source.args === `"D:${SEP}proj${SEP}cleandrive" --scheduled-run`, source.args);
    check('the project path is quoted, so a space in it survives', source.args.startsWith('"'));
  }

  if (process.argv.includes('--live')) {
    console.log('\nscheduler: registering a real task (and removing it again)\n');

    const before = await isInstalled();
    check('no task is registered before the test', before === false, before ? 'one already exists' : '');

    const created = await install({
      schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1 },
      invocation: { command: process.execPath, args: '--scheduled-run --self-test', workingDirectory: process.cwd() },
    });
    check('Task Scheduler accepts the document', created.ok === true, created.error || '');
    check('the task is registered afterwards', (await isInstalled()) === true, TASK_PATH);

    // A scheduled task stores an absolute path. Moving the app, or copying it
    // to another machine, leaves the task pointing at somewhere that no longer
    // exists -- failing every week with nothing on screen to say so.
    const readBack = await installedInvocation();
    check('the registered command can be read back',
      readBack !== null && readBack.command === process.execPath,
      readBack ? readBack.command : 'null');
    check('so can its arguments',
      readBack !== null && readBack.args === '--scheduled-run --self-test',
      readBack ? readBack.args : 'null');

    check('the same invocation is not reported as stale',
      (await isStale({ command: process.execPath, args: '--scheduled-run --self-test' })) === false);
    check('a different executable is reported as stale',
      (await isStale({ command: `D:${SEP}elsewhere${SEP}CleanDrive.exe`, args: '--scheduled-run' })) === true);
    check('path comparison ignores case, as Windows does',
      (await isStale({ command: process.execPath.toUpperCase(), args: '--SCHEDULED-RUN --SELF-TEST' })) === false);

    const removed = await uninstall();
    check('the task can be removed', removed.ok === true, removed.error || '');
    check('and is gone', (await isInstalled()) === false);

    check('reading back a task that is not there yields null',
      (await installedInvocation()) === null);
    check('and nothing is called stale when nothing is registered',
      (await isStale({ command: 'anything', args: '' })) === false);

    const again = await uninstall();
    check('removing a task that is not there is not an error', again.ok === true);
  } else {
    console.log('\n  (skipping live Task Scheduler registration; pass --live to include it)\n');
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
