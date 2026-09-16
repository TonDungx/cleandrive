'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { IS_WIN } = require('./util');

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
 * Nothing here parses `schtasks` output. That output is localised -- on this
 * machine Windows renders times as "9:45 SA" -- and a feature that breaks on a
 * Vietnamese install because it was looking for the word "Next" is not a
 * feature. Existence is taken from the process exit code, which is a number in
 * every language, and everything else the UI shows comes from the app's own
 * run log.
 */

const TASK_FOLDER = 'CleanDrive';
const TASK_NAME = 'AutomaticCleanup';
const TASK_PATH = `${TASK_FOLDER}\\${TASK_NAME}`;

const WEEKDAY_ELEMENTS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_ELEMENTS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** XML text escaping. Paths legitimately contain `&`, and one is enough to break the document. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Task Scheduler wants a local wall-clock stamp with no timezone suffix. */
function startBoundary(time, reference = new Date()) {
  const [hour, minute] = time.split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${reference.getFullYear()}-${pad(reference.getMonth() + 1)}-${pad(reference.getDate())}` +
    `T${pad(hour)}:${pad(minute)}:00`
  );
}

function scheduleElement(schedule) {
  switch (schedule.kind) {
    case 'daily':
      return '<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>';
    case 'monthly':
      return (
        '<ScheduleByMonth>' +
        `<DaysOfMonth><Day>${Number(schedule.day)}</Day></DaysOfMonth>` +
        `<Months>${MONTH_ELEMENTS.map((m) => `<${m} />`).join('')}</Months>` +
        '</ScheduleByMonth>'
      );
    case 'weekly':
    default:
      return (
        '<ScheduleByWeek>' +
        `<DaysOfWeek><${WEEKDAY_ELEMENTS[Number(schedule.weekday) || 0]} /></DaysOfWeek>` +
        '<WeeksInterval>1</WeeksInterval>' +
        '</ScheduleByWeek>'
      );
  }
}

/**
 * The task definition.
 *
 * `InteractiveToken` means the task runs as the logged-on user and only while
 * somebody is logged on. The alternative would be storing a password or running
 * as SYSTEM; a disk cleaner that deletes a user's files does not need, and
 * should not have, a service account.
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
    description = 'CleanDrive automatic cleanup. Created by the CleanDrive app; safe to delete.',
    reference,
  } = config;

  const body = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${escapeXml(description)}</Description>`,
    `    <URI>\\${escapeXml(TASK_PATH)}</URI>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <CalendarTrigger>',
    `      <StartBoundary>${startBoundary(schedule.time, reference)}</StartBoundary>`,
    '      <Enabled>true</Enabled>',
    `      ${scheduleElement(schedule)}`,
    '    </CalendarTrigger>',
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
    '    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>',
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
function selfInvocation(app) {
  const flag = '--scheduled-run';
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

/* -------------------------------------------------------------------------- */
/* public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Create or replace the scheduled task.
 *
 * @param {object} options
 * @param {object} options.schedule   { kind, time, weekday, day }
 * @param {object} [options.app]      Electron's app, to work out how to relaunch
 * @param {string} [options.tempDir]  where the XML is staged
 */
async function install(options) {
  if (!IS_WIN) {
    return { ok: false, error: 'Scheduling is implemented for Windows only', unsupported: true };
  }

  const invocation = options.invocation || selfInvocation(options.app);
  const xml = buildTaskXml({
    schedule: options.schedule,
    userId: options.userId || currentUserId(),
    ...invocation,
  });

  const tempDir = options.tempDir || os.tmpdir();
  const xmlPath = path.join(tempDir, `cleandrive-task-${process.pid}-${Date.now()}.xml`);

  // schtasks reads the definition as UTF-16; a BOM removes any doubt.
  await fsp.writeFile(xmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));

  try {
    const result = await run('schtasks.exe', ['/Create', '/TN', TASK_PATH, '/XML', xmlPath, '/F']);
    if (!result.ok) {
      return { ok: false, error: cleanMessage(result) || 'Task Scheduler refused the task', code: result.code };
    }
    return { ok: true, taskPath: TASK_PATH };
  } finally {
    await fsp.rm(xmlPath, { force: true }).catch(() => {});
  }
}

/** Remove the task. A task that was never there is not an error. */
async function uninstall() {
  if (!IS_WIN) return { ok: true, unsupported: true };
  if (!(await isInstalled())) return { ok: true, alreadyGone: true };
  const result = await run('schtasks.exe', ['/Delete', '/TN', TASK_PATH, '/F']);
  return result.ok ? { ok: true } : { ok: false, error: cleanMessage(result) };
}

/** Existence by exit code, never by reading localised output. */
async function isInstalled() {
  if (!IS_WIN) return false;
  const result = await run('schtasks.exe', ['/Query', '/TN', TASK_PATH]);
  return result.ok;
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
 * The XML form is queried rather than the table form: `<Command>` is an element
 * name, not a translated column heading, so this works on a Vietnamese Windows
 * as it does on an English one.
 *
 * @returns {Promise<{command: string, args: string} | null>}
 */
async function installedInvocation() {
  if (!IS_WIN) return null;

  const result = await run('schtasks.exe', ['/Query', '/TN', TASK_PATH, '/XML'], { encoding: 'buffer' });
  if (!result.ok) return null;

  // schtasks writes this document as UTF-16; decoding it as UTF-8 yields a
  // string of interleaved NULs that no pattern will match.
  const raw = Buffer.isBuffer(result.stdoutBuffer) ? result.stdoutBuffer : Buffer.alloc(0);
  const text =
    raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe
      ? raw.slice(2).toString('utf16le')
      : raw.toString('utf8');

  const command = /<Command>([\s\S]*?)<\/Command>/.exec(text);
  if (!command) return null;
  const args = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(text);

  return {
    command: unescapeXml(command[1]).trim(),
    args: args ? unescapeXml(args[1]).trim() : '',
  };
}

/**
 * True when a task exists but would launch something other than this build.
 * Comparison is case-insensitive because Windows paths are.
 */
async function isStale(invocation) {
  const installed = await installedInvocation();
  if (!installed) return false;
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  return !(same(installed.command, invocation.command) && same(installed.args, invocation.args));
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Ask Task Scheduler to run the task now, exactly as it would on schedule. */
async function runNow() {
  if (!IS_WIN) return { ok: false, error: 'Scheduling is implemented for Windows only' };
  const result = await run('schtasks.exe', ['/Run', '/TN', TASK_PATH]);
  return result.ok ? { ok: true } : { ok: false, error: cleanMessage(result) };
}

/**
 * When the schedule says the next run falls.
 *
 * Computed from the app's own settings rather than asked of Task Scheduler,
 * because the answer is needed to draw a settings screen before any task
 * exists, and because parsing the scheduler's localised reply is a bug waiting
 * for a non-English machine.
 */
function nextRunAt(schedule, from = new Date()) {
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

function cleanMessage(result) {
  const text = `${result.stderr || ''}${result.stdout || ''}`.trim();
  return text ? text.split(/\r?\n/).filter(Boolean).slice(0, 2).join(' ') : result.error;
}

module.exports = {
  install,
  uninstall,
  isInstalled,
  installedInvocation,
  isStale,
  runNow,
  nextRunAt,
  buildTaskXml,
  selfInvocation,
  currentUserId,
  escapeXml,
  startBoundary,
  TASK_PATH,
  TASK_NAME,
  TASK_FOLDER,
};
