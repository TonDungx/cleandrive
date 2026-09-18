#!/usr/bin/env node
'use strict';

// The XML is checked offline; registering a real task is opt-in, because a
// test suite should not leave entries in the user's Task Scheduler.
//   node scripts/test-scheduler.js           (offline only)
//   node scripts/test-scheduler.js --live    (also registers and removes a task)
//
// The live half registers under a *suffixed* name. It used to use the real one,
// which meant running it deleted whatever schedule the person running it had
// configured -- and that is exactly how a 02:00 cleanup on this machine stopped
// running. The suffix is set before the module is required, because the task
// names are derived from it.
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'selftest';

const {
  buildTaskXml,
  nextRunAt,
  escapeXml,
  startBoundary,
  isoDuration,
  durationToMinutes,
  parseSchedule,
  sameSchedule,
  install,
  uninstall,
  isInstalled,
  selfInvocation,
  installedInvocation,
  installedSchedule,
  isStale,
  verify,
  describeTaskResult,
  describeSchedule,
  cleanupTaskPath,
  sampleTaskPath,
} = require('../src/main/lib/scheduler');

const TASK_PATH = cleanupTaskPath();

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

  console.log('\nscheduler: an interval, so the schedule can be watched working\n');

  {
    const every5 = buildTaskXml({
      ...BASE,
      schedule: { kind: 'minutes', everyMinutes: 5, time: '02:00', catchUpAtLogon: true },
    });

    check('an interval schedule repeats', every5.includes('<Repetition><Interval>PT5M</Interval></Repetition>'));
    // Windows' own tasks (OneDrive's updater, the certificate store check) use
    // a Repetition with no Duration. With one, the repeating stops part way
    // through the day and the schedule quietly half-works.
    check('the repetition has no end, so it runs all day', !/<Repetition>[\s\S]*?<Duration>/.test(every5));
    check('it hangs off a daily trigger, so it re-arms after a reboot', every5.includes('<ScheduleByDay>'));
    check('it starts at midnight, so the whole day is covered', every5.includes('T00:00:00'));
    check('a logon trigger makes a restart observable', every5.includes('<LogonTrigger>'));
    check('the logon run is delayed, not immediate', every5.includes('<Delay>PT2M</Delay>'));
    check('the logon trigger names the user', every5.includes(`<UserId>HOST${SEP}user</UserId>`));
    // An interactive-token task cannot start before anyone has logged on, so a
    // boot trigger would be a trigger that never fires.
    check('there is no boot trigger to promise something it cannot do', !every5.includes('<BootTrigger>'));

    const noCatchUp = buildTaskXml({
      ...BASE,
      schedule: { kind: 'weekly', time: '02:00', weekday: 0, catchUpAtLogon: false },
    });
    check('an appointment schedule gets no logon trigger unless asked', !noCatchUp.includes('<LogonTrigger>'));

    check('minutes become an ISO duration',
      isoDuration(5) === 'PT5M' && isoDuration(90) === 'PT1H30M' && isoDuration(60) === 'PT1H',
      `${isoDuration(5)} ${isoDuration(90)} ${isoDuration(60)}`);
    check('and back again',
      durationToMinutes('PT5M') === 5 && durationToMinutes('PT1H30M') === 90 && durationToMinutes('P1D') === 1440);
    check('a duration that is not a duration is refused', durationToMinutes('every so often') === null);
  }

  console.log('\nscheduler: reading a registered task back\n');

  {
    // This is what the app compares against the settings. Getting it wrong
    // means the screen describes one schedule while Windows runs another --
    // which happened, and was invisible, because only the command was checked.
    const cases = [
      { kind: 'minutes', everyMinutes: 15, time: '02:00', weekday: 0, day: 1, catchUpAtLogon: true },
      { kind: 'daily', time: '03:30', weekday: 0, day: 1, catchUpAtLogon: false },
      { kind: 'weekly', time: '02:00', weekday: 3, day: 1, catchUpAtLogon: false },
      { kind: 'monthly', time: '23:15', weekday: 0, day: 28, catchUpAtLogon: true },
    ];

    for (const schedule of cases) {
      const parsed = parseSchedule(buildTaskXml({ ...BASE, schedule }));
      check(`a ${schedule.kind} schedule survives the round trip`,
        sameSchedule(parsed, schedule), `${describeSchedule(parsed)} vs ${describeSchedule(schedule)}`);
    }

    const weekly = parseSchedule(buildTaskXml({
      ...BASE, schedule: { kind: 'weekly', time: '02:00', weekday: 3, catchUpAtLogon: false },
    }));
    check('a different weekday is not the same schedule',
      !sameSchedule(weekly, { kind: 'weekly', time: '02:00', weekday: 4, catchUpAtLogon: false }));
    check('a different interval is not the same schedule',
      !sameSchedule({ kind: 'minutes', everyMinutes: 5, catchUpAtLogon: true },
        { kind: 'minutes', everyMinutes: 10, catchUpAtLogon: true }));
    check('an interval is never the same as an appointment',
      !sameSchedule({ kind: 'minutes', everyMinutes: 5 }, { kind: 'daily', time: '02:00' }));
    // The time field is carried in the settings for every kind, but an interval
    // repeats from midnight, so comparing it would report drift that is not there.
    check('an interval ignores the unused time field',
      sameSchedule({ kind: 'minutes', everyMinutes: 5, time: '02:00', catchUpAtLogon: false },
        { kind: 'minutes', everyMinutes: 5, time: '19:45', catchUpAtLogon: false }));

    const bounded = buildTaskXml({ ...BASE, schedule: { kind: 'minutes', everyMinutes: 5 } })
      .replace('<Interval>PT5M</Interval>', '<Interval>PT5M</Interval><Duration>PT1H</Duration>');
    check('a repetition with an end is reported as bounded', parseSchedule(bounded).repetitionBounded === true);
  }

  console.log('\nscheduler: what Windows says about a run\n');

  {
    check('a successful run is described', /successfully/.test(describeTaskResult(0)));
    check('a missing executable is described as the app having moved',
      /moved/.test(describeTaskResult(0x80070002)), describeTaskResult(0x80070002));
    check('a task that never ran says so', /never/.test(describeTaskResult(0x41303)));
    check('an unknown code is reported as a code, not guessed at',
      /0x/.test(describeTaskResult(0x1234)), describeTaskResult(0x1234));
    check('no code means no claim', describeTaskResult(null) === null);
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

    // The slots are counted from midnight because that is where Task Scheduler
    // re-arms the daily trigger the repetition hangs off. Counting from "now"
    // would put the app's displayed next run a few minutes away from the real one.
    const at1007 = new Date(2026, 0, 12, 10, 7, 30);
    const every5 = nextRunAt({ kind: 'minutes', everyMinutes: 5 }, at1007);
    check('an interval lands on the next slot counted from midnight',
      every5.getHours() === 10 && every5.getMinutes() === 10 && every5.getSeconds() === 0, every5.toString());

    const every90 = nextRunAt({ kind: 'minutes', everyMinutes: 90 }, at1007);
    check('a 90-minute interval counts in the same way',
      every90.getHours() === 10 && every90.getMinutes() === 30, every90.toString());

    const lateNight = nextRunAt({ kind: 'minutes', everyMinutes: 30 }, new Date(2026, 0, 12, 23, 45, 0));
    check('the last slot of the day rolls into the next day',
      lateNight.getDate() === 13 && lateNight.getHours() === 0 && lateNight.getMinutes() === 0,
      lateNight.toString());

    const exactly = nextRunAt({ kind: 'minutes', everyMinutes: 10 }, new Date(2026, 0, 12, 10, 0, 0));
    check('a slot boundary means the next slot, not this one',
      exactly.getMinutes() === 10, exactly.toString());
  }

  console.log('\nscheduler: the test suite cannot reach the real task\n');

  {
    // The bug this guards is not hypothetical: the live test and the smoke test
    // both used the real names, so running the suite unregistered the user's
    // own schedule and deleted the settings file describing it.
    check('the cleanup task is registered under a suffixed name while testing',
      /_selftest$/.test(cleanupTaskPath()), cleanupTaskPath());
    check('and so is the sampler', /_selftest$/.test(sampleTaskPath()), sampleTaskPath());
    check('the two tasks are not the same entry', cleanupTaskPath() !== sampleTaskPath());
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

    // The schedule half of the same question. A task that launches the right
    // executable on the wrong timetable used to pass every check the app made.
    const readSchedule = await installedSchedule();
    check('the registered schedule can be read back',
      readSchedule !== null && readSchedule.kind === 'weekly' && readSchedule.weekday === 0,
      readSchedule ? describeSchedule(readSchedule) : 'null');

    const good = await verify({
      schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1, catchUpAtLogon: false },
      invocation: { command: process.execPath, args: '--scheduled-run --self-test' },
    });
    check('verification passes when Windows holds what was asked for', good.ok === true, good.problems.join(' '));

    const wrongDay = await verify({
      schedule: { kind: 'weekly', time: '02:00', weekday: 4, day: 1, catchUpAtLogon: false },
      invocation: { command: process.execPath, args: '--scheduled-run --self-test' },
    });
    check('and fails when the registered schedule is a different one',
      wrongDay.ok === false && wrongDay.scheduleMatches === false, wrongDay.problems.join(' '));

    const interval = await install({
      schedule: { kind: 'minutes', everyMinutes: 5, time: '02:00', catchUpAtLogon: true },
      invocation: { command: process.execPath, args: '--scheduled-run --self-test', workingDirectory: process.cwd() },
    });
    check('Task Scheduler accepts an indefinite five-minute repetition',
      interval.ok === true, interval.error || '');
    check('and the app can verify it end to end', interval.verified === true,
      interval.verification ? interval.verification.problems.join(' ') : '');
    const intervalBack = await installedSchedule();
    check('Windows reports it back as an interval schedule',
      intervalBack !== null && intervalBack.kind === 'minutes' && intervalBack.everyMinutes === 5,
      intervalBack ? describeSchedule(intervalBack) : 'null');
    check('with a repetition that does not expire',
      intervalBack !== null && intervalBack.repetitionBounded === false);
    check('and the logon catch-up recorded',
      intervalBack !== null && intervalBack.catchUpAtLogon === true);

    // Back to the weekly task the rest of this section expects.
    await install({
      schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1, catchUpAtLogon: false },
      invocation: { command: process.execPath, args: '--scheduled-run --self-test', workingDirectory: process.cwd() },
    });

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
