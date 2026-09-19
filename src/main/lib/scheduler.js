'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { IS_WIN } = require('./util');
const { t } = require('../../i18n');

/**
 * Windows Task Scheduler registration.
 *
 * The app does not keep a timer running. A background process that has to stay
 * alive to be useful is a process the user will eventually kill, and then the
 * cleanup silently stops happening. The OS already owns a scheduler that
 * survives reboots, so the app registers a task there and exits.
 *
 * Registration goes through a task XML document rather than `schtasks` command
 * flags, for one reason that matters: `StartWhenAvailable`. A cleanup set for
 * 02:00 on a laptop that is asleep at 02:00 would, with the flag form, simply
 * never run and never say so. The XML form runs it at the next opportunity.
 *
 * Nothing here parses `schtasks` *table* output. That output is localised -- on
 * this machine Windows renders times as "9:45 SA" -- and a feature that breaks
 * on a Vietnamese install because it was looking for the word "Next" is not a
 * feature. Existence comes from a process exit code, the registered definition
 * comes from the XML form (element names are not translated), and last/next run
 * times come from the `Schedule.Service` COM object, whose property names are
 * not translated either.
 *
 * ## Why this file gained a verification pass
 *
 * The first version registered a task and trusted that it stayed registered.
 * It did not: anything that removed the task -- another tool, a test harness of
 * this project's own, a user tidying up Task Scheduler -- left the settings
 * screen cheerfully reporting a next run time for a task that no longer
 * existed. So `verify()` now asks the OS what it actually holds and compares it
 * against what the app asked for, field by field, and the UI shows that answer
 * rather than the app's own intention.
 */

const TASK_FOLDER = 'CleanDrive';
const TASK_NAME = 'AutomaticCleanup';
const SAMPLE_TASK_NAME = 'DiskSample';

// The XML element names, which are a Windows schema and never translated.
const WEEKDAY_ELEMENTS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The same days as prose, which is translated. */
const WEEKDAY_KEYS = [
  ['day.sunday', 'Sunday'],
  ['day.monday', 'Monday'],
  ['day.tuesday', 'Tuesday'],
  ['day.wednesday', 'Wednesday'],
  ['day.thursday', 'Thursday'],
  ['day.friday', 'Friday'],
  ['day.saturday', 'Saturday'],
];

function weekdayName(index) {
  const entry = WEEKDAY_KEYS[index] || WEEKDAY_KEYS[0];
  return t(entry[0], entry[1]);
}

const MONTH_ELEMENTS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** How long after logging on a catch-up run starts. Long enough to be out of
 *  the way of everything else a desktop does at logon. */
const LOGON_DELAY_MINUTES = 2;
const SAMPLE_LOGON_DELAY_MINUTES = 3;

/**
 * A suffix for the registered task names, for tests.
 *
 * `npm run test:scheduler -- --live` used to register, inspect and then delete
 * the real task -- the one a user had configured -- because it used the same
 * name the app does. That is how a test destroys the thing it is testing, and
 * it is the reason a schedule configured on this machine stopped running. A
 * suffixed name means a live test cannot reach the real entry at all.
 */
function taskSuffix() {
  const raw = process.env.CLEANDRIVE_TASK_SUFFIX;
  if (!raw) return '';
  const safe = String(raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  return safe ? `_${safe}` : '';
}

/** The cleanup task's path, as Task Scheduler names it. */
function cleanupTaskPath() {
  return `${TASK_FOLDER}\\${TASK_NAME}${taskSuffix()}`;
}

/**
 * The sampler's path.
 *
 * Deliberately a second task rather than more work inside the first. Trends
 * need a measurement on a timetable; cleanup needs consent to delete things.
 * Tying them together would mean "I want a chart of my disk" required
 * "and you may delete my files unattended", which is not a trade anyone should
 * have to make.
 */
function sampleTaskPath() {
  return `${TASK_FOLDER}\\${SAMPLE_TASK_NAME}${taskSuffix()}`;
}

/** XML text escaping. Paths legitimately contain `&`, and one is enough to break the document. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Task Scheduler wants a local wall-clock stamp with no timezone suffix. */
function startBoundary(time, reference = new Date()) {
  const [hour, minute] = String(time).split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${reference.getFullYear()}-${pad(reference.getMonth() + 1)}-${pad(reference.getDate())}` +
    `T${pad(hour)}:${pad(minute)}:00`
  );
}

/** Minutes as an ISO 8601 duration: 90 -> PT1H30M, which is what the schema wants. */
function isoDuration(minutes) {
  const total = Math.max(1, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `PT${mins}M`;
  return mins === 0 ? `PT${hours}H` : `PT${hours}H${mins}M`;
}

function clampMinutes(value, fallback = 15) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1440, Math.max(1, n));
}

/* -------------------------------------------------------------------------- */
/* the document                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The recurrence element, and for an interval schedule the repetition that
 * turns one daily appointment into a loop.
 *
 * Element order here is not a style choice. This schema is a sequence, and the
 * order used is the one Windows itself writes when it exports a task:
 * StartBoundary, Enabled, Repetition, then the ScheduleBy* element.
 *
 * A `<Repetition>` with an `<Interval>` and *no* `<Duration>` repeats
 * indefinitely. That is the shape several of Windows' own tasks use
 * (OneDrive's updater, the certificate store check), and it is what makes an
 * interval schedule survive a reboot: the daily trigger re-arms at midnight
 * and the repetition runs through the day.
 */
function calendarTrigger(schedule, reference) {
  const interval =
    schedule.kind === 'minutes'
      ? `      <Repetition><Interval>${isoDuration(clampMinutes(schedule.everyMinutes))}</Interval></Repetition>`
      : null;

  // An interval schedule starts at midnight so the repetition covers the whole
  // day; the configured time is meaningless for it and is left alone in the
  // settings rather than silently rewritten.
  const boundaryTime = schedule.kind === 'minutes' ? '00:00' : schedule.time;

  let recurrence;
  switch (schedule.kind) {
    case 'minutes':
    case 'daily':
      recurrence = '<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>';
      break;
    case 'monthly':
      recurrence =
        '<ScheduleByMonth>' +
        `<DaysOfMonth><Day>${Number(schedule.day)}</Day></DaysOfMonth>` +
        `<Months>${MONTH_ELEMENTS.map((m) => `<${m} />`).join('')}</Months>` +
        '</ScheduleByMonth>';
      break;
    case 'weekly':
    default:
      recurrence =
        '<ScheduleByWeek>' +
        `<DaysOfWeek><${WEEKDAY_ELEMENTS[Number(schedule.weekday) || 0]} /></DaysOfWeek>` +
        '<WeeksInterval>1</WeeksInterval>' +
        '</ScheduleByWeek>';
      break;
  }

  return [
    '    <CalendarTrigger>',
    `      <StartBoundary>${startBoundary(boundaryTime, reference)}</StartBoundary>`,
    '      <Enabled>true</Enabled>',
    interval,
    `      ${recurrence}`,
    '    </CalendarTrigger>',
  ].filter((line) => line !== null);
}

/**
 * "Run shortly after logging on."
 *
 * This is what makes "it still runs after you restart the machine" a claim
 * somebody can check in two minutes instead of a claim they have to take on
 * faith. `StartWhenAvailable` already re-runs a missed appointment, but it does
 * so on Windows' own timetable and only for occurrences it considers missed,
 * which is not something a user can observe.
 */
function logonTrigger(userId, delayMinutes) {
  return [
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    `      <UserId>${escapeXml(userId)}</UserId>`,
    `      <Delay>${isoDuration(delayMinutes)}</Delay>`,
    '    </LogonTrigger>',
  ];
}

/**
 * The task definition.
 *
 * `InteractiveToken` means the task runs as the logged-on user and only while
 * somebody is logged on. The alternative would be storing a password or running
 * as SYSTEM; a disk cleaner that deletes a user's files does not need, and
 * should not have, a service account. It is also why there is no `BootTrigger`
 * anywhere in this file: a boot trigger fires before anybody has logged on, so
 * an interactive-token task could not start, and a task that appears to be
 * configured and cannot run is the failure this whole file is written against.
 *
 * Battery settings are both left off deliberately. The default Task Scheduler
 * behaviour is to refuse to start on battery, which on a laptop means the
 * cleanup quietly never runs -- the exact failure this feature exists to avoid.
 */
function buildTaskXml(config) {
  const {
    schedule,
    command,
    args = '',
    workingDirectory,
    userId,
    taskPath = cleanupTaskPath(),
    description = 'CleanDrive automatic cleanup. Created by the CleanDrive app; safe to delete.',
    reference,
    executionTimeLimit = 'PT2H',
    logonDelayMinutes = LOGON_DELAY_MINUTES,
  } = config;

  const triggers = [
    ...calendarTrigger(schedule, reference),
    ...(schedule.catchUpAtLogon ? logonTrigger(userId, logonDelayMinutes) : []),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${escapeXml(description)}</Description>`,
    `    <URI>\\${escapeXml(taskPath)}</URI>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    ...triggers,
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    `      <UserId>${escapeXml(userId)}</UserId>`,
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <IdleSettings>',
    '      <StopOnIdleEnd>false</StopOnIdleEnd>',
    '      <RestartOnIdle>false</RestartOnIdle>',
    '    </IdleSettings>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
    '    <WakeToRun>false</WakeToRun>',
    `    <ExecutionTimeLimit>${executionTimeLimit}</ExecutionTimeLimit>`,
    '    <Priority>7</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${escapeXml(command)}</Command>`,
    args ? `      <Arguments>${escapeXml(args)}</Arguments>` : null,
    workingDirectory ? `      <WorkingDirectory>${escapeXml(workingDirectory)}</WorkingDirectory>` : null,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
  ]
    .filter((line) => line !== null)
    .join('\r\n');

  return body;
}

/* -------------------------------------------------------------------------- */
/* process plumbing                                                            */
/* -------------------------------------------------------------------------- */

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 30000, ...options }, (err, stdout, stderr) => {
      const binary = Buffer.isBuffer(stdout);
      resolve({
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
        stdout: binary ? '' : String(stdout || ''),
        stdoutBuffer: binary ? stdout : null,
        stderr: Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || ''),
        error: err ? err.message : null,
      });
    });
  });
}

/**
 * How this build of the app relaunches itself without a window.
 *
 * Running from source, `process.execPath` is electron.exe and the project
 * directory has to be passed as its first argument. Packaged, execPath is the
 * app itself and the directory would be read as a file to open.
 */
function selfInvocation(app, flag = '--scheduled-run') {
  if (app && app.isPackaged) {
    return { command: process.execPath, args: flag, workingDirectory: path.dirname(process.execPath) };
  }
  const appPath = app && typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
  return { command: process.execPath, args: `"${appPath}" ${flag}`, workingDirectory: appPath };
}

function currentUserId() {
  const domain = process.env.USERDOMAIN;
  const user = process.env.USERNAME || os.userInfo().username;
  return domain ? `${domain}\\${user}` : user;
}

function cleanMessage(result) {
  const text = `${result.stderr || ''}${result.stdout || ''}`.trim();
  return text ? text.split(/\r?\n/).filter(Boolean).slice(0, 2).join(' ') : result.error;
}

/* -------------------------------------------------------------------------- */
/* registration                                                                */
/* -------------------------------------------------------------------------- */

/** Stage the document and hand it to schtasks. */
async function register({ taskPath, xml, tempDir }) {
  const dir = tempDir || os.tmpdir();
  const xmlPath = path.join(dir, `cleandrive-task-${process.pid}-${Date.now()}.xml`);

  // schtasks reads the definition as UTF-16; a BOM removes any doubt.
  await fsp.writeFile(xmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));

  try {
    const result = await run('schtasks.exe', ['/Create', '/TN', taskPath, '/XML', xmlPath, '/F']);
    if (!result.ok) {
      return { ok: false, error: cleanMessage(result) || 'Task Scheduler refused the task', code: result.code };
    }
    return { ok: true, taskPath };
  } finally {
    await fsp.rm(xmlPath, { force: true }).catch(() => {});
  }
}

/**
 * Create or replace the cleanup task.
 *
 * @param {object} options
 * @param {object} options.schedule   { kind, time, weekday, day, everyMinutes, catchUpAtLogon }
 * @param {object} [options.app]      Electron's app, to work out how to relaunch
 * @param {string} [options.tempDir]  where the XML is staged
 */
async function install(options) {
  if (!IS_WIN) {
    return { ok: false, error: 'Scheduling is implemented for Windows only', unsupported: true };
  }

  const taskPath = options.taskPath || cleanupTaskPath();
  const invocation = options.invocation || selfInvocation(options.app);
  const xml = buildTaskXml({
    schedule: options.schedule,
    userId: options.userId || currentUserId(),
    taskPath,
    ...invocation,
  });

  const created = await register({ taskPath, xml, tempDir: options.tempDir });
  if (!created.ok) return created;

  // Read it straight back. A create that returned success and left nothing
  // behind is rare, but this is the one place in the app where "I assumed it
  // worked" costs the user a feature that fails silently for weeks.
  const check = await verify({ schedule: options.schedule, invocation, taskPath });
  return { ...created, verified: check.ok, verification: check };
}

/**
 * Create or replace the disk-sampling task.
 *
 * Daily plus a logon catch-up, because a measurement missed while the machine
 * was off is worth taking late: one point a day is what the trend is fitted
 * through, and a gap is a gap forever.
 */
async function installSampler(options = {}) {
  if (!IS_WIN) {
    return { ok: false, error: 'Scheduling is implemented for Windows only', unsupported: true };
  }

  const taskPath = options.taskPath || sampleTaskPath();
  const invocation = options.invocation || selfInvocation(options.app, '--sample-only');
  const schedule = { kind: 'daily', time: options.time || '12:00', catchUpAtLogon: true };

  const xml = buildTaskXml({
    schedule,
    userId: options.userId || currentUserId(),
    taskPath,
    description:
      'CleanDrive disk measurement for the Trends tab. Reads free space and writes one ' +
      'line of history; deletes nothing. Created by the CleanDrive app; safe to delete.',
    // A sampler that has not finished in five minutes is stuck, not busy.
    executionTimeLimit: 'PT5M',
    logonDelayMinutes: SAMPLE_LOGON_DELAY_MINUTES,
    reference: options.reference,
  });

  const created = await register({ taskPath, xml, tempDir: options.tempDir });
  if (!created.ok) return created;

  const check = await verify({ schedule, invocation, taskPath });
  return { ...created, verified: check.ok, verification: check };
}

/** Remove a task. A task that was never there is not an error. */
async function uninstall(taskPath = cleanupTaskPath()) {
  if (!IS_WIN) return { ok: true, unsupported: true };
  if (!(await isInstalled(taskPath))) return { ok: true, alreadyGone: true };
  const result = await run('schtasks.exe', ['/Delete', '/TN', taskPath, '/F']);
  return result.ok ? { ok: true } : { ok: false, error: cleanMessage(result) };
}

/** Existence by exit code, never by reading localised output. */
async function isInstalled(taskPath = cleanupTaskPath()) {
  if (!IS_WIN) return false;
  const result = await run('schtasks.exe', ['/Query', '/TN', taskPath]);
  return result.ok;
}

/**
 * The registered definition, as text.
 *
 * The XML form is queried rather than the table form: every name in it is an
 * element name, not a translated column heading, so this works on a Vietnamese
 * Windows as it does on an English one.
 */
async function readTaskXml(taskPath = cleanupTaskPath()) {
  if (!IS_WIN) return null;

  const result = await run('schtasks.exe', ['/Query', '/TN', taskPath, '/XML'], { encoding: 'buffer' });
  if (!result.ok) return null;

  // schtasks writes this document as UTF-16; decoding it as UTF-8 yields a
  // string of interleaved NULs that no pattern will match.
  const raw = Buffer.isBuffer(result.stdoutBuffer) ? result.stdoutBuffer : Buffer.alloc(0);
  return raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe
    ? raw.slice(2).toString('utf16le')
    : raw.toString('utf8');
}

/**
 * What the registered task actually runs.
 *
 * A scheduled task stores an absolute path. Move the app, reinstall it
 * somewhere else, or copy the folder to another machine, and the task is still
 * pointing at where the executable used to be — so it fails every week, in the
 * background, with nothing on screen to say so. Reading the command back is
 * what lets the app notice and repair itself.
 *
 * @returns {Promise<{command: string, args: string} | null>}
 */
async function installedInvocation(taskPath = cleanupTaskPath()) {
  const text = await readTaskXml(taskPath);
  if (!text) return null;

  const command = /<Command>([\s\S]*?)<\/Command>/.exec(text);
  if (!command) return null;
  const args = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(text);

  return {
    command: unescapeXml(command[1]).trim(),
    args: args ? unescapeXml(args[1]).trim() : '',
  };
}

/**
 * The schedule the OS is holding, read back out of the registered document.
 *
 * This exists because the app used to compare only the *command* when deciding
 * whether the task needed rewriting. A task left over from an earlier
 * configuration -- still weekly when the settings said every five minutes --
 * passed that check, so the screen described one schedule while Windows ran
 * another.
 *
 * @returns {Promise<{kind: string, time: string, weekday: number, day: number,
 *   everyMinutes: number|null, catchUpAtLogon: boolean} | null>}
 */
async function installedSchedule(taskPath = cleanupTaskPath()) {
  const text = await readTaskXml(taskPath);
  if (!text) return null;
  return parseSchedule(text);
}

/** The trigger half of a task document, as a schedule object. Exported for tests. */
function parseSchedule(text) {
  const boundary = /<StartBoundary>(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  const time = boundary ? `${boundary[4]}:${boundary[5]}` : null;

  const calendar = /<CalendarTrigger>[\s\S]*?<\/CalendarTrigger>/.exec(text);
  const hasLogon = /<LogonTrigger>/.test(text);

  // Scoped to the element: a lazy match against the whole document would find
  // an ExecutionTimeLimit's duration somewhere else and report a bound that
  // the repetition does not have.
  const repetitionBlock = /<Repetition>([\s\S]*?)<\/Repetition>/.exec(calendar ? calendar[0] : '');

  // The repetition only counts as an interval schedule when it is on the
  // calendar trigger; the sampler's logon trigger has none, and a future
  // trigger with one should not be read as "every N minutes".
  const intervalOnCalendar = calendar ? /<Repetition>[\s\S]*?<Interval>([^<]+)<\/Interval>/.exec(calendar[0]) : null;
  const everyMinutes = intervalOnCalendar ? durationToMinutes(intervalOnCalendar[1]) : null;

  let kind = 'weekly';
  let weekday = 0;
  let day = 1;

  if (everyMinutes) {
    kind = 'minutes';
  } else if (/<ScheduleByDay>/.test(text)) {
    kind = 'daily';
  } else if (/<ScheduleByMonth>/.test(text)) {
    kind = 'monthly';
    const found = /<DaysOfMonth>\s*<Day>(\d+)<\/Day>/.exec(text);
    if (found) day = Number(found[1]);
  } else if (/<ScheduleByWeek>/.test(text)) {
    kind = 'weekly';
    const index = WEEKDAY_ELEMENTS.findIndex((name) => new RegExp(`<${name}\\s*/>`).test(text));
    if (index >= 0) weekday = index;
  }

  return {
    kind,
    time: time || '02:00',
    weekday,
    day,
    everyMinutes: everyMinutes || null,
    catchUpAtLogon: hasLogon,
    // Repetition without <Duration> is what makes an interval schedule run all
    // day and survive a restart; a duration would silently stop it.
    repetitionBounded: Boolean(repetitionBlock && /<Duration>/.test(repetitionBlock[1])),
  };
}

/** "PT1H30M" -> 90. Null for anything that is not minutes and hours. */
function durationToMinutes(value) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value).trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match.map((v) => (v === undefined ? 0 : Number(v)));
  const total = days * 1440 + hours * 60 + minutes + (seconds ? seconds / 60 : 0);
  return total > 0 ? Math.round(total) : null;
}

/**
 * True when a task exists but would launch something other than this build.
 * Comparison is case-insensitive because Windows paths are.
 */
async function isStale(invocation, taskPath = cleanupTaskPath()) {
  const installed = await installedInvocation(taskPath);
  if (!installed) return false;
  return !sameInvocation(installed, invocation);
}

function sameInvocation(a, b) {
  const same = (x, y) => String(x).trim().toLowerCase() === String(y).trim().toLowerCase();
  return Boolean(a && b) && same(a.command, b.command) && same(a.args, b.args);
}

/**
 * Do two schedules mean the same timetable?
 *
 * Only the fields that matter for the kind are compared: a weekly schedule's
 * `everyMinutes` is carried in the settings but says nothing about when it
 * runs, and comparing it would report drift that does not exist.
 */
function sameSchedule(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (Boolean(a.catchUpAtLogon) !== Boolean(b.catchUpAtLogon)) return false;

  switch (a.kind) {
    case 'minutes':
      return clampMinutes(a.everyMinutes) === clampMinutes(b.everyMinutes);
    case 'daily':
      return a.time === b.time;
    case 'monthly':
      return a.time === b.time && Number(a.day) === Number(b.day);
    case 'weekly':
    default:
      return a.time === b.time && Number(a.weekday) === Number(b.weekday);
  }
}

/**
 * Compare what the OS holds against what the app asked for.
 *
 * Every field of the answer is read back from Task Scheduler. Nothing here is
 * the app's own opinion, which is the point: the settings screen's old claim
 * ("next run Sunday 02:00") was computed from the settings file and stayed true
 * on screen after the task itself had been deleted.
 */
async function verify({ schedule, invocation, taskPath = cleanupTaskPath() }) {
  if (!IS_WIN) {
    return {
      ok: false,
      supported: false,
      installed: false,
      problems: [t('task.problem.windowsOnly', 'Scheduling is Windows-only for now')],
    };
  }

  const text = await readTaskXml(taskPath);
  if (!text) {
    return {
      ok: false,
      supported: true,
      installed: false,
      problems: [
        t('task.problem.notRegistered', 'No task is registered with Windows Task Scheduler, so nothing will run.'),
      ],
    };
  }

  const registered = parseSchedule(text);
  const command = /<Command>([\s\S]*?)<\/Command>/.exec(text);
  const args = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(text);
  const registeredInvocation = command
    ? { command: unescapeXml(command[1]).trim(), args: args ? unescapeXml(args[1]).trim() : '' }
    : null;

  const problems = [];
  const invocationMatches = invocation ? sameInvocation(registeredInvocation, invocation) : true;
  const scheduleMatches = schedule ? sameSchedule(registered, schedule) : true;

  if (!invocationMatches) {
    problems.push(
      t('task.problem.wrongCommand', 'The registered task launches {command}, which is not this copy of the app.', {
        command: registeredInvocation ? registeredInvocation.command : t('task.nothing', 'nothing'),
      })
    );
  }
  if (!scheduleMatches) {
    problems.push(
      t('task.problem.wrongSchedule', 'Windows holds a {schedule}, not the one saved here.', {
        schedule: describeSchedule(registered),
      })
    );
  }
  if (registered.repetitionBounded) {
    problems.push(
      t('task.problem.bounded', 'The registered repetition has an end, so it would stop part way through the day.')
    );
  }
  if (/<Enabled>false<\/Enabled>/.test(text)) {
    problems.push(t('task.problem.disabled', 'The task is disabled in Task Scheduler.'));
  }

  return {
    ok: problems.length === 0,
    supported: true,
    installed: true,
    invocationMatches,
    scheduleMatches,
    registered,
    registeredInvocation,
    problems,
  };
}

/** Ask Task Scheduler to run the task now, exactly as it would on schedule. */
async function runNow(taskPath = cleanupTaskPath()) {
  if (!IS_WIN) return { ok: false, error: 'Scheduling is implemented for Windows only' };
  const result = await run('schtasks.exe', ['/Run', '/TN', taskPath]);
  return result.ok ? { ok: true } : { ok: false, error: cleanMessage(result) };
}

/* -------------------------------------------------------------------------- */
/* what the OS says happened                                                   */
/* -------------------------------------------------------------------------- */

const EMPTY_INFO = { lastRunAt: null, nextRunAt: null, lastResult: null, missedRuns: null, state: null };

/**
 * Last run, next run, and the exit code of the last run — from Windows, not
 * from the app's own bookkeeping.
 *
 * This is the only PowerShell in the project and it earns its place: it is the
 * difference between "the app believes it is configured" and "Windows ran it at
 * 02:00:34 and it exited 0". `Get-ScheduledTaskInfo` is used rather than
 * `schtasks /Query` because its output is a typed object whose property names
 * are the same on every Windows language, where the table form prints
 * translated headings and localised times.
 *
 * ## Why the COM object rather than the cmdlets
 *
 * `Get-ScheduledTaskInfo` is the obvious way to write this and it was the first
 * one. Measured here: 5.3s for one task and 10.1s for three, of which about
 * three seconds is PowerShell autoloading the ScheduledTasks module and a
 * further 1.2s per cmdlet call. Eight seconds for a button that reports two
 * facts is not a button anyone presses twice.
 *
 * The `Schedule.Service` COM object is the same Task Scheduler API without the
 * module, and `IRegisteredTask` carries every field needed on the object
 * itself. Its property names are not localised either, which is the reason
 * neither version parses `schtasks` table output.
 *
 * If COM is unavailable — a locked-down machine with constrained language mode
 * — this returns an error per task and says so on screen. The facts that
 * matter (whether a task exists and whether it matches the settings) come from
 * `schtasks /Query`, not from here, so the card degrades rather than breaks.
 *
 * Every task is asked about in one process, with a per-task `try`, so a task
 * that is not registered reports itself instead of aborting the answer about
 * the other.
 *
 * Called on demand — when the Automatic tab is opened, or its Check button is
 * pressed — never on a timer.
 *
 * @param {string|string[]} taskPaths
 * @returns {Promise<object|null|Map<string, object>>} one info object for a
 *   single path; a Map keyed by task path when given an array
 */
async function taskInfo(taskPaths = cleanupTaskPath()) {
  const many = Array.isArray(taskPaths);
  const list = many ? taskPaths : [taskPaths];

  if (!IS_WIN || list.length === 0) return many ? new Map() : null;

  // Single quotes throughout, deliberately. A double quote inside a `-Command`
  // argument has to survive Node's argument quoting *and* PowerShell's own
  // command-line parsing, and the two do not agree about backslash escapes.
  // PowerShell treats single-quoted strings literally, which sidesteps the
  // question -- and a task name cannot reach this point containing one, but it
  // is doubled anyway.
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

  const specs = list.map((taskPath, index) => {
    // Split into folder and leaf. The COM API navigates folders, so the folder
    // is given without a trailing separator -- and the root folder *is* the
    // separator, which is the one case that would otherwise come out empty.
    const full = `\\${taskPath}`;
    const cut = full.lastIndexOf('\\');
    const folder = full.slice(0, cut) || '\\';
    return `@{ key = ${quote(String(index))}; folder = ${quote(folder)}; leaf = ${quote(full.slice(cut + 1))} }`;
  });

  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$svc = New-Object -ComObject Schedule.Service',
    '$svc.Connect()',
    `$specs = @(${specs.join(', ')})`,
    '$out = @()',
    'foreach ($s in $specs) {',
    '  $row = New-Object psobject',
    '  Add-Member -InputObject $row -MemberType NoteProperty -Name key -Value $s.key',
    '  try {',
    '    $task = $svc.GetFolder($s.folder).GetTask($s.leaf)',
    '    $last = $null',
    // A task that has never run reports 1899-12-30 rather than nothing, and
    // "last run: 30 Dec 1899" is a worse answer than "never".
    "    if ($task.LastRunTime -and $task.LastRunTime.Year -gt 2000) { $last = $task.LastRunTime.ToUniversalTime().ToString('o') }",
    '    $next = $null',
    // Reading NextRunTime throws on a task with no future occurrence, which is
    // an answer ("none scheduled"), not a failure.
    "    try { if ($task.NextRunTime -and $task.NextRunTime.Year -gt 2000) { $next = $task.NextRunTime.ToUniversalTime().ToString('o') } } catch { $next = $null }",
    '    Add-Member -InputObject $row -MemberType NoteProperty -Name lastRunAt -Value $last',
    '    Add-Member -InputObject $row -MemberType NoteProperty -Name nextRunAt -Value $next',
    '    Add-Member -InputObject $row -MemberType NoteProperty -Name lastResult -Value $task.LastTaskResult',
    '    Add-Member -InputObject $row -MemberType NoteProperty -Name missedRuns -Value $task.NumberOfMissedRuns',
    '    Add-Member -InputObject $row -MemberType NoteProperty -Name state -Value ([int]$task.State)',
    '    Add-Member -InputObject $row -MemberType NoteProperty -Name enabled -Value ([bool]$task.Enabled)',
    '  } catch {',
    '    Add-Member -InputObject $row -MemberType NoteProperty -Name error -Value $_.Exception.Message',
    '  }',
    '  $out += $row',
    '}',
    '$out | ConvertTo-Json -Compress',
  ].join('\r\n');

  /*
   * Run from a file rather than `-Command`.
   *
   * A multi-statement script passed as `-Command` has to survive two parsers
   * that do not agree: Node's argument quoting and PowerShell's own
   * command-line handling. Joining the statements with spaces produced
   * `$ErrorActionPreference = 'Stop' $specs = @(...)` -- two statements with no
   * separator -- and joining them with semicolons puts one immediately after an
   * opening brace. A file has none of these questions: it is a script, written
   * the way a script is written. The project already stages a temp file for the
   * task XML, so the shape is familiar.
   */
  const scriptPath = path.join(os.tmpdir(), `cleandrive-taskinfo-${process.pid}-${Date.now()}.ps1`);

  let result;
  try {
    await fsp.writeFile(scriptPath, script, 'utf8');
    result = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      // Autoloading the ScheduledTasks module alone takes about five seconds on
      // a cold PowerShell, which is most of this call.
      { timeout: 60000 }
    );
  } catch (err) {
    result = { ok: false, stdout: '', stderr: '', error: err.message };
  } finally {
    await fsp.rm(scriptPath, { force: true }).catch(() => {});
  }

  const failed = (error) => {
    if (!many) return { ...EMPTY_INFO, error };
    const out = new Map();
    for (const taskPath of list) out.set(taskPath, { ...EMPTY_INFO, error });
    return out;
  };

  if (!result.ok) return failed(cleanMessage(result) || 'Windows could not be asked');

  let rows;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    // ConvertTo-Json collapses a one-element array into a bare object.
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    return failed(`unreadable reply: ${err.message}`);
  }

  const at = (value) => {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };

  const byKey = new Map();
  for (const row of rows) {
    if (!row) continue;
    byKey.set(String(row.key), {
      lastRunAt: at(row.lastRunAt),
      nextRunAt: at(row.nextRunAt),
      lastResult: Number.isFinite(Number(row.lastResult)) ? Number(row.lastResult) : null,
      missedRuns: Number.isFinite(Number(row.missedRuns)) ? Number(row.missedRuns) : null,
      state: describeTaskState(row.state, row.enabled),
      ...(row.error ? { error: String(row.error) } : {}),
    });
  }

  const missing = { ...EMPTY_INFO, error: 'Windows returned no answer for this task' };
  if (!many) return byKey.get('0') || missing;

  const out = new Map();
  list.forEach((taskPath, index) => out.set(taskPath, byKey.get(String(index)) || missing));
  return out;
}

/**
 * `TASK_STATE`, in words.
 *
 * The COM API answers with a number, and the numbers are the same on every
 * Windows language — which is why it is asked rather than `schtasks`, whose
 * equivalent column is translated.
 */
function describeTaskState(state, enabled) {
  const value = Number(state);
  if (!Number.isFinite(value)) return null;
  switch (value) {
    case 1: return t('task.state.disabled', 'disabled');
    case 2: return t('task.state.queued', 'queued');
    case 3:
      return enabled === false
        ? t('task.state.readyDisabled', 'ready, but disabled')
        : t('task.state.ready', 'ready');
    case 4: return t('task.state.running', 'running now');
    default: return t('task.state.unknown', 'unknown to Windows');
  }
}

/**
 * Task Scheduler result codes, in words.
 *
 * These are the ones worth saying out loud. 0x80070002 in particular is the
 * silent-failure code this app is built to avoid: the task is registered, it
 * fires on time, and the executable it names is no longer there.
 */
function describeTaskResult(code) {
  if (code === null || code === undefined) return null;
  switch (Number(code) >>> 0) {
    case 0x0: return t('task.result.ok', 'the last run finished successfully');
    case 0x1: return t('task.result.error', 'the last run exited with an error');
    case 0x41300: return t('task.result.notStarted', 'the task is ready and has not started yet');
    case 0x41301: return t('task.result.running', 'the task is running now');
    case 0x41302: return t('task.result.disabled', 'the task is disabled');
    case 0x41303: return t('task.result.never', 'the task has never run');
    case 0x41304: return t('task.result.noFuture', 'there are no future runs scheduled');
    case 0x41306: return t('task.result.stopped', 'the last run was stopped');
    case 0x8007010b: return t('task.result.badWorkingDir', 'the working directory is not valid');
    case 0x80070002:
      return t('task.result.missingProgram', 'the program it launches could not be found — the app has moved');
    case 0x80070003:
      return t('task.result.missingPath', 'the path it launches could not be found — the app has moved');
    case 0x8004131f:
      return t('task.result.alreadyRunning', 'an instance was already running, so this run was skipped');
    default:
      return t('task.result.code', 'the last run reported code 0x{code}', {
        code: (Number(code) >>> 0).toString(16).toUpperCase(),
      });
  }
}

/* -------------------------------------------------------------------------- */
/* the app's own reckoning                                                     */
/* -------------------------------------------------------------------------- */

/**
 * When the schedule says the next run falls.
 *
 * Still computed from the app's own settings, because the answer is needed to
 * draw a settings screen before any task exists. It is no longer the *only*
 * answer the screen shows: `taskInfo()` supplies Windows' own next-run time,
 * and where the two disagree the OS is right.
 */
function nextRunAt(schedule, from = new Date()) {
  if (schedule.kind === 'minutes') {
    // Task Scheduler re-arms the daily trigger at midnight and repeats from
    // there, so the slots are counted from the start of the day rather than
    // from whenever the task happened to be registered.
    const every = clampMinutes(schedule.everyMinutes);
    const dayStart = new Date(from);
    dayStart.setHours(0, 0, 0, 0);
    const minutesSince = Math.floor((from.getTime() - dayStart.getTime()) / 60000);
    const slot = (Math.floor(minutesSince / every) + 1) * every;
    return new Date(dayStart.getTime() + slot * 60000);
  }

  const [hour, minute] = String(schedule.time || '02:00').split(':').map(Number);
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);

  const advanceDays = (days) => next.setDate(next.getDate() + days);

  if (schedule.kind === 'daily') {
    if (next <= from) advanceDays(1);
    return next;
  }

  if (schedule.kind === 'monthly') {
    const day = Math.min(Math.max(Number(schedule.day) || 1, 1), 28);
    next.setDate(day);
    if (next <= from) next.setMonth(next.getMonth() + 1);
    return next;
  }

  const target = Math.min(Math.max(Number(schedule.weekday) || 0, 0), 6);
  let delta = (target - next.getDay() + 7) % 7;
  if (delta === 0 && next <= from) delta = 7;
  advanceDays(delta);
  return next;
}

/** One line of English for a schedule. Used in problem messages and the UI. */
function describeSchedule(schedule) {
  if (!schedule) return t('schedule.none', 'no schedule');
  switch (schedule.kind) {
    case 'minutes': {
      const every = clampMinutes(schedule.everyMinutes);
      return every === 1
        ? t('schedule.runEveryMinute', 'run every minute')
        : t('schedule.runEveryMinutes', 'run every {n} minutes', { n: every });
    }
    case 'daily':
      return t('schedule.dailyRun', 'daily run at {time}', { time: schedule.time });
    case 'monthly':
      return t('schedule.monthlyRun', 'monthly run on day {day} at {time}', {
        day: schedule.day,
        time: schedule.time,
      });
    case 'weekly':
    default:
      return t('schedule.weeklyRun', 'weekly run on {day} at {time}', {
        day: weekdayName(Number(schedule.weekday) || 0),
        time: schedule.time,
      });
  }
}

module.exports = {
  install,
  installSampler,
  uninstall,
  isInstalled,
  readTaskXml,
  installedInvocation,
  installedSchedule,
  parseSchedule,
  durationToMinutes,
  isStale,
  sameInvocation,
  sameSchedule,
  verify,
  runNow,
  taskInfo,
  describeTaskResult,
  describeTaskState,
  nextRunAt,
  describeSchedule,
  buildTaskXml,
  selfInvocation,
  currentUserId,
  escapeXml,
  unescapeXml,
  startBoundary,
  isoDuration,
  cleanupTaskPath,
  sampleTaskPath,
  taskSuffix,
  TASK_NAME,
  SAMPLE_TASK_NAME,
  TASK_FOLDER,
  LOGON_DELAY_MINUTES,
};
