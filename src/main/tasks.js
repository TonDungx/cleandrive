'use strict';

const { app } = require('electron');

const scheduler = require('./lib/scheduler');
const { t } = require('../i18n');

/**
 * Keeping Windows Task Scheduler and the settings file in agreement.
 *
 * There used to be two half-owners of this. `main.js` re-registered a task at
 * launch if the executable had moved, and `ipc.js` installed or removed one on
 * every save. Neither checked whether the *schedule* Windows held was the one
 * the settings described, and neither said anything when the task was simply
 * gone — which is how a cleanup configured for 02:00 stopped running for two
 * weeks with the settings screen still displaying its next run time.
 *
 * So reconciliation lives in one place, runs on launch and on every save, and
 * returns what it had to change. The caller shows that to the user; the app no
 * longer repairs things silently.
 *
 * ## The one thing it will not do
 *
 * If the settings file is *missing*, the defaults say automatic cleanup is off.
 * Acting on that would mean deleting a task the user configured because the
 * file recording that decision had vanished — destroying the evidence of the
 * intent and the mechanism carrying it out, in one step. A missing file means
 * "intent unknown": the task is left exactly as it is and the discrepancy is
 * reported instead.
 */

/**
 * @param {object} settings
 * @param {object} [options]
 * @param {boolean} [options.settingsExisted]  false when the settings file was
 *   absent, so `settings` is only the defaults
 * @returns {Promise<{supported: boolean, cleanup: object|null, sampler: object|null,
 *   changes: string[], problems: string[]}>}
 */
async function reconcile(settings, { settingsExisted = true } = {}) {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      cleanup: null,
      sampler: null,
      changes: [],
      problems: [
        t('task.problem.windowsOnlyLong', 'Scheduling is implemented for Windows only. Everything can still be run by hand.'),
      ],
    };
  }

  const changes = [];
  const problems = [];

  // Anything below may rewrite a task, which resets its run history — so the
  // remembered answer from Windows is no longer about the task that now exists.
  osInfoCache = { at: 0, key: '', value: null };

  const cleanupTaskPath = scheduler.cleanupTaskPath();

  if (!settingsExisted && (await scheduler.isInstalled(cleanupTaskPath))) {
    problems.push(
      t(
        'task.problem.orphaned',
        'A CleanDrive task is registered with Windows but this app has no saved settings, so the run ' +
          'would find nothing configured and do nothing. Save your configuration to repair it, or ' +
          'switch automatic cleanup off to remove the task.'
      )
    );
    return {
      supported: true,
      cleanup: { taskPath: cleanupTaskPath, installed: true, wanted: null, ok: false, orphaned: true },
      sampler: await reconcileSampler(settings, changes, problems),
      changes,
      problems,
    };
  }

  const cleanup = await reconcileOne({
    label: t('task.label.cleanup', 'Automatic cleanup'),
    taskPath: cleanupTaskPath,
    wanted: settings.autoClean.enabled,
    schedule: settings.autoClean.schedule,
    invocation: scheduler.selfInvocation(app, '--scheduled-run'),
    create: () => scheduler.install({ schedule: settings.autoClean.schedule, app }),
    changes,
    problems,
  });

  const sampler = await reconcileSampler(settings, changes, problems);

  return { supported: true, cleanup, sampler, changes, problems };
}

function reconcileSampler(settings, changes, problems) {
  const trends = settings.trends || { dailySample: false, sampleTime: '12:00' };
  return reconcileOne({
    label: t('task.label.sampler', 'Daily disk measurement'),
    taskPath: scheduler.sampleTaskPath(),
    wanted: trends.dailySample,
    schedule: { kind: 'daily', time: trends.sampleTime, catchUpAtLogon: true },
    invocation: scheduler.selfInvocation(app, '--sample-only'),
    create: () => scheduler.installSampler({ time: trends.sampleTime, app }),
    changes,
    problems,
  });
}

/**
 * Bring one task into line.
 *
 * The order matters: verify first, and only rewrite when verification found
 * something wrong. Re-registering unconditionally on every launch and every
 * save would reset the task's run history each time, throwing away the
 * `LastRunTime` that is now the app's best evidence that the thing works.
 */
async function reconcileOne({ label, taskPath, wanted, schedule, invocation, create, changes, problems }) {
  if (!wanted) {
    if (!(await scheduler.isInstalled(taskPath))) {
      return { taskPath, wanted: false, installed: false, ok: true };
    }
    const removed = await scheduler.uninstall(taskPath);
    if (removed.ok) changes.push(t('task.change.removed', '{label} is off, so its Windows task was removed.', { label }));
    else {
      problems.push(
        t('task.problem.removeFailed', '{label}: the Windows task could not be removed ({error}).', {
          label,
          error: removed.error,
        })
      );
    }
    return { taskPath, wanted: false, installed: !removed.ok, ok: removed.ok, error: removed.error || null };
  }

  const before = await scheduler.verify({ schedule, invocation, taskPath });
  if (before.ok) {
    return { taskPath, wanted: true, installed: true, ok: true, verification: before };
  }

  const created = await create();
  if (!created.ok) {
    problems.push(
      t('task.problem.refused', '{label}: Windows Task Scheduler refused the task ({error}).', {
        label,
        error: created.error,
      })
    );
    return { taskPath, wanted: true, installed: false, ok: false, error: created.error, verification: before };
  }

  changes.push(`${label}: ${describeRepair(before)}`);


  const after = created.verification || (await scheduler.verify({ schedule, invocation, taskPath }));
  if (!after.ok) problems.push(...after.problems);

  return {
    taskPath,
    wanted: true,
    installed: true,
    repaired: true,
    ok: after.ok,
    verification: after,
  };
}

function describeRepair(check) {
  if (!check.installed) {
    return t('task.repair.created', 'no Windows task was registered, so one has been created.');
  }
  if (check.invocationMatches === false) {
    return t('task.repair.repointed', 'the registered task pointed at another copy of the app; it now points here.');
  }
  if (check.scheduleMatches === false) {
    return t('task.repair.rewritten', 'Windows held a different schedule; it has been rewritten to match the settings.');
  }
  return t('task.repair.unusable', 'the registered task was not usable as it stood and has been rewritten.');
}

/**
 * The OS's own account of both tasks, cached briefly.
 *
 * The call behind this is a PowerShell process that spends about five seconds
 * autoloading the ScheduledTasks module. The Automatic tab asks for it when it
 * opens, and the file watcher can refresh that tab several times during a
 * single background run -- so without a short memory, one cleanup finishing
 * would spawn a handful of five-second PowerShell processes to tell the user
 * the same thing. The Check button passes `fresh` and skips it.
 */
const OS_INFO_TTL_MS = 15000;
let osInfoCache = { at: 0, key: '', value: null };

async function osInfoFor(taskPaths, { fresh = false } = {}) {
  const key = taskPaths.join('|');
  const now = Date.now();

  if (!fresh && osInfoCache.value && osInfoCache.key === key && now - osInfoCache.at < OS_INFO_TTL_MS) {
    return osInfoCache.value;
  }

  const value = await scheduler.taskInfo(taskPaths);
  osInfoCache = { at: Date.now(), key, value };
  return value;
}

/**
 * Everything the UI needs to say about the OS side, in one object.
 *
 * `withOsInfo` is the expensive half: the settings screen reads the cheap part
 * (existence and whether the registered definition matches, both from
 * `schtasks`) on every refresh, and asks Windows for its own run times only
 * when the user opens the tab or presses Check.
 */
async function status(settings, { withOsInfo = false, fresh = false, settingsExisted = true } = {}) {
  const supported = process.platform === 'win32';
  const cleanupTaskPath = scheduler.cleanupTaskPath();
  const samplerTaskPath = scheduler.sampleTaskPath();

  if (!supported) {
    return {
      supported: false,
      settingsExisted,
      cleanup: { taskPath: cleanupTaskPath, installed: false, wanted: settings.autoClean.enabled },
      sampler: { taskPath: samplerTaskPath, installed: false, wanted: settings.trends.dailySample },
    };
  }

  const cleanupSchedule = settings.autoClean.schedule;
  const samplerSchedule = { kind: 'daily', time: settings.trends.sampleTime, catchUpAtLogon: true };

  const [cleanupCheck, samplerCheck] = await Promise.all([
    scheduler.verify({
      schedule: cleanupSchedule,
      invocation: scheduler.selfInvocation(app, '--scheduled-run'),
      taskPath: cleanupTaskPath,
    }),
    scheduler.verify({
      schedule: samplerSchedule,
      invocation: scheduler.selfInvocation(app, '--sample-only'),
      taskPath: samplerTaskPath,
    }),
  ]);

  // One PowerShell process for both tasks, not one each.
  const osInfo = withOsInfo ? await osInfoFor([cleanupTaskPath, samplerTaskPath], { fresh }) : null;
  const cleanupInfo = osInfo ? osInfo.get(cleanupTaskPath) || null : null;
  const samplerInfo = osInfo ? osInfo.get(samplerTaskPath) || null : null;

  return {
    supported: true,
    settingsExisted,
    cleanup: {
      taskPath: cleanupTaskPath,
      wanted: settings.autoClean.enabled,
      installed: cleanupCheck.installed,
      verified: cleanupCheck.ok,
      problems: cleanupCheck.problems,
      registered: cleanupCheck.registered || null,
      description: scheduler.describeSchedule(cleanupSchedule),
      // The app's own reckoning, kept because it is available before any task
      // exists; where the OS disagrees, the OS wins on screen.
      expectedNextRunAt: settings.autoClean.enabled ? scheduler.nextRunAt(cleanupSchedule).getTime() : null,
      os: cleanupInfo,
      osResult: cleanupInfo ? scheduler.describeTaskResult(cleanupInfo.lastResult) : null,
    },
    sampler: {
      taskPath: samplerTaskPath,
      wanted: settings.trends.dailySample,
      installed: samplerCheck.installed,
      verified: samplerCheck.ok,
      problems: samplerCheck.problems,
      description: scheduler.describeSchedule(samplerSchedule),
      expectedNextRunAt: settings.trends.dailySample ? scheduler.nextRunAt(samplerSchedule).getTime() : null,
      os: samplerInfo,
      osResult: samplerInfo ? scheduler.describeTaskResult(samplerInfo.lastResult) : null,
    },
  };
}

module.exports = { reconcile, status };
