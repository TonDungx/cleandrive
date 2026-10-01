'use strict';

const { app } = require('electron');

const scheduler = require('./lib/scheduler');
const { profilesOf } = require('./lib/settings');
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
 * @param {boolean} [options.sweep]  also look for Windows tasks belonging to
 *   profiles that no longer exist (G4). Off by default because asking Windows
 *   for the list costs a PowerShell process of about three seconds, and a save
 *   happens every time somebody touches the Automatic screen. It is passed at
 *   launch and after a profile is removed, which is every way a task can be
 *   orphaned; see `sweepOrphans`.
 * @param {boolean} [options.sampler]  also the daily measurement's task. Off
 *   only for `cleandrive policy apply` (H2), which is about the cleanup tasks
 *   a policy decides: a logon script run on a machine where nobody has opened
 *   the app must not register a second task the policy never mentioned.
 */
async function reconcile(settings, { settingsExisted = true, sweep = false, sampler = true } = {}) {
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
      profiles: await reconcileManaged(settings, { sweep }, changes, problems),
      sampler: sampler ? await reconcileSampler(settings, changes, problems) : null,
      changes,
      problems,
    };
  }

  // One task per profile (G4). Each carries its own id on the command line, so
  // the process Windows starts knows which policy it is there to run without
  // having to guess from the clock.
  const profiles = [];
  for (const profile of profilesOf(settings)) {
    profiles.push(await reconcileProfile(profile, changes, problems));
  }

  // Only now, with every wanted task accounted for, is it safe to ask what
  // else is registered: a task for a profile that is gone would otherwise run
  // for ever on a timetable nobody can see any more.
  if (sweep && settingsExisted) await sweepOrphans(settings, changes, problems);
  else if (sweep) await sweepManaged(settings, changes, problems);

  const samplerState = sampler ? await reconcileSampler(settings, changes, problems) : null;

  // `cleanup` is the first profile, kept under its old name because the
  // Automatic screen, the tray and three harnesses read it.
  const cleanup = profiles[0] || { taskPath: cleanupTaskPath, wanted: false, installed: false, ok: true };

  return { supported: true, cleanup, profiles, sampler: samplerState, changes, problems };
}

function reconcileProfile(profile, changes, problems) {
  const taskPath = scheduler.cleanupTaskPath(profile.id);
  const flag = `--scheduled-run --profile=${profile.id}`;
  return reconcileOne({
    label: profileLabel(profile),
    taskPath,
    wanted: profile.enabled,
    schedule: profile.schedule,
    invocation: scheduler.selfInvocation(app, flag),
    create: () => scheduler.install({ schedule: profile.schedule, app, taskPath, invocation: scheduler.selfInvocation(app, flag) }),
    changes,
    problems,
  }).then((result) => ({ ...result, profileId: profile.id, name: profileLabel(profile) }));
}

function profileLabel(profile) {
  if (profile.managed) return t('task.label.managed', 'Your organisation’s cleanup');
  return profile.name || t('task.label.cleanup', 'Automatic cleanup');
}

/**
 * The organisation's profile (H2), whatever state the user's file is in.
 *
 * The rule above -- a missing settings file means intent unknown, so touch
 * nothing -- is about the *user's* intent. The organisation's is not in that
 * file; it is in the policy, which says what it wants in so many words. So its
 * profile is registered on a machine where nobody has ever opened the app,
 * which is the machine Group Policy is most often pushed to.
 */
async function reconcileManaged(settings, { sweep = false } = {}, changes, problems) {
  const managed = profilesOf(settings).filter((p) => p.managed);
  const out = [];
  for (const profile of managed) out.push(await reconcileProfile(profile, changes, problems));
  if (sweep && managed.length === 0) await sweepManaged(settings, changes, problems);
  return out;
}

/**
 * The organisation's task, once its policy no longer asks for a profile.
 *
 * `sweepOrphans` already does this when the settings file exists. Without one
 * it does nothing at all -- rightly, for the user's tasks -- and the
 * organisation's would otherwise run on, every night, finding a profile that
 * is not there. Its id is the policy's own (schema.js), so there is nothing to
 * guess.
 */
async function sweepManaged(settings, changes, problems) {
  const { PROFILE_ID } = require('./policy/schema');
  if (profilesOf(settings).some((p) => p.id === PROFILE_ID)) return;
  const taskPath = scheduler.cleanupTaskPath(PROFILE_ID);
  if (!(await scheduler.isInstalled(taskPath))) return;
  const removed = await scheduler.uninstall(taskPath);
  if (removed.ok) {
    changes.push(t('task.change.managedRemoved', 'Your organisation no longer runs a cleanup profile here, so its Windows task was removed.'));
  } else {
    problems.push(
      t('task.problem.orphanRemoveFailed', 'A Windows task from a deleted profile ({task}) could not be removed ({error}); it will keep running.', {
        task: taskPath,
        error: removed.error,
      })
    );
  }
}

/**
 * Remove the tasks of profiles that no longer exist.
 *
 * `tasks.js` has one standing rule about destroying things: when the settings
 * file is *missing*, intent is unknown and nothing is touched. This is the
 * other case. The file is there, it lists the profiles, and a registered task
 * for a profile it does not list is not ambiguous -- that profile was deleted,
 * and the task is what is left of it.
 *
 * `profileOfTaskName` refuses to attribute a name it cannot be sure of, so a
 * task belonging to a harness suffix, or one somebody made by hand, is never
 * even a candidate. Nothing is removed silently: each one is reported.
 */
async function sweepOrphans(settings, changes, problems) {
  const listed = await scheduler.listCleanupTasks();
  if (!listed.ok) {
    // Not being able to ask is worth saying, but it is not a reason to guess.
    problems.push(
      t('task.problem.listFailed', 'The registered CleanDrive tasks could not be listed ({error}), so any left by a deleted profile are still there.', {
        error: listed.error,
      })
    );
    return;
  }

  const known = new Set(profilesOf(settings).map((p) => p.id));
  for (const name of listed.names) {
    const id = scheduler.profileOfTaskName(name);
    if (!id || known.has(id)) continue;

    const taskPath = scheduler.cleanupTaskPath(id);
    const removed = await scheduler.uninstall(taskPath);
    if (removed.ok) {
      changes.push(
        t('task.change.orphanRemoved', 'A Windows task was left over from a profile that no longer exists ({task}); it has been removed.', {
          task: taskPath,
        })
      );
    } else {
      problems.push(
        t('task.problem.orphanRemoveFailed', 'A Windows task from a deleted profile ({task}) could not be removed ({error}); it will keep running.', {
          task: taskPath,
          error: removed.error,
        })
      );
    }
  }
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
  const profiles = profilesOf(settings);
  const first = profiles[0] || null;
  const cleanupTaskPath = scheduler.cleanupTaskPath(first ? first.id : null);
  const samplerTaskPath = scheduler.sampleTaskPath();

  if (!supported) {
    return {
      supported: false,
      settingsExisted,
      cleanup: { taskPath: cleanupTaskPath, installed: false, wanted: Boolean(first && first.enabled) },
      profiles: profiles.map((p) => ({
        profileId: p.id,
        taskPath: scheduler.cleanupTaskPath(p.id),
        installed: false,
        wanted: p.enabled,
      })),
      sampler: { taskPath: samplerTaskPath, installed: false, wanted: settings.trends.dailySample },
    };
  }

  const samplerSchedule = { kind: 'daily', time: settings.trends.sampleTime, catchUpAtLogon: true };

  // Every profile's task is verified, and the whole set is asked about in one
  // PowerShell process rather than one each -- that call is the expensive part
  // (about a second), and eight of them would make the tab unopenable.
  const checks = await Promise.all([
    ...profiles.map((p) =>
      scheduler.verify({
        schedule: p.schedule,
        invocation: scheduler.selfInvocation(app, `--scheduled-run --profile=${p.id}`),
        taskPath: scheduler.cleanupTaskPath(p.id),
      })
    ),
    scheduler.verify({
      schedule: samplerSchedule,
      invocation: scheduler.selfInvocation(app, '--sample-only'),
      taskPath: samplerTaskPath,
    }),
  ]);
  const samplerCheck = checks[checks.length - 1];

  const taskPaths = [...profiles.map((p) => scheduler.cleanupTaskPath(p.id)), samplerTaskPath];
  const osInfo = withOsInfo ? await osInfoFor(taskPaths, { fresh }) : null;
  const samplerInfo = osInfo ? osInfo.get(samplerTaskPath) || null : null;

  const describeProfile = (profile, check) => {
    const taskPath = scheduler.cleanupTaskPath(profile.id);
    const info = osInfo ? osInfo.get(taskPath) || null : null;
    return {
      profileId: profile.id,
      name: profile.name,
      action: profile.action,
      dryRun: profile.dryRun,
      taskPath,
      wanted: profile.enabled,
      installed: check.installed,
      verified: check.ok,
      problems: check.problems,
      registered: check.registered || null,
      description: scheduler.describeSchedule(profile.schedule),
      // The app's own reckoning, kept because it is available before any task
      // exists; where the OS disagrees, the OS wins on screen.
      expectedNextRunAt: profile.enabled ? scheduler.nextRunAt(profile.schedule).getTime() : null,
      os: info,
      osResult: info ? scheduler.describeTaskResult(info.lastResult) : null,
    };
  };

  const profileStates = profiles.map((p, i) => describeProfile(p, checks[i]));

  return {
    supported: true,
    settingsExisted,
    profiles: profileStates,
    // The first profile, under the name the screen, the tray and three
    // harnesses have always read.
    cleanup: profileStates[0] || { taskPath: cleanupTaskPath, wanted: false, installed: false, verified: true, problems: [] },
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
