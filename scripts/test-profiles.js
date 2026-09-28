#!/usr/bin/env node
'use strict';

// G4: several unattended profiles, each with its own Windows task, and one
// lock between them.
//
//   node scripts/test-profiles.js
//
// Three parts, none of which needs Electron. The settings layer, where a
// profile is a policy that arrives from an untrusted file. The task names,
// which decide what the orphan sweep is allowed to delete -- that sweep's
// only verb is "remove a scheduled task", so what it refuses to attribute
// matters more than what it attributes. And the lock, which is a real file in
// a real folder, held by a real second process.

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');

const settings = require('../src/main/lib/settings');
const runlock = require('../src/main/lib/runlock');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const ABS = (...bits) => (process.platform === 'win32' ? path.join('C:\\', ...bits) : path.join('/', ...bits));
const coerce = (raw) => settings.coerceSettings(raw, {});
const profilesOf = settings.profilesOf;

/* -------------------------------------------------------------------------- */
/* the settings layer                                                          */
/* -------------------------------------------------------------------------- */

function theSettings() {
  console.log('\nA profile is a whole policy, read from a file nobody has to be trusted with:');

  {
    const { settings: s } = coerce({});
    check('a file with nothing in it still yields one profile', profilesOf(s).length === 1);
    check('and that profile is off, and in report-only',
      profilesOf(s)[0].enabled === false && profilesOf(s)[0].dryRun === true);
    check('and its action is the one that has always applied', profilesOf(s)[0].action === 'recycle');
  }

  {
    const { settings: s, warnings } = coerce({
      autoClean: {
        profiles: [
          { id: 'main', enabled: true, roots: [ABS('a')] },
          { id: 'main', enabled: true, roots: [ABS('b')] },
        ],
      },
    });
    // Two profiles with one id would be two rows editing each other, and two
    // Windows tasks with one name -- the second silently replacing the first.
    check('a repeated id is renamed rather than left to collide',
      profilesOf(s).length === 2 && profilesOf(s)[0].id !== profilesOf(s)[1].id,
      profilesOf(s).map((p) => p.id).join(', '));
    check('and the rename is said out loud', warnings.some((w) => /appears twice/.test(w)), warnings.join('; '));
    check('the generated id looks like one the app makes',
      settings.PROFILE_ID_PATTERN.test(profilesOf(s)[1].id), profilesOf(s)[1].id);
  }

  {
    const { settings: s, warnings } = coerce({
      autoClean: { profiles: [{ id: 'p!!!@@@', roots: [ABS('a')], enabled: true }] },
    });
    // The id ends up inside a Windows task name; anything else is dropped.
    check('an id of nothing usable is replaced', settings.PROFILE_ID_PATTERN.test(profilesOf(s)[0].id),
      profilesOf(s)[0].id);
    check('and that is said out loud too', warnings.some((w) => /no usable id/.test(w)));
  }

  {
    const many = Array.from({ length: settings.MAX_PROFILES + 3 }, (_, i) => ({ id: `p${i}aaaa` }));
    const { settings: s, warnings } = coerce({ autoClean: { profiles: many } });
    check(`at most ${settings.MAX_PROFILES} profiles are read`, profilesOf(s).length === settings.MAX_PROFILES,
      String(profilesOf(s).length));
    check('and the ones left out are reported', warnings.some((w) => /only the first/.test(w)));
  }

  {
    const { settings: s, warnings } = coerce({
      autoClean: { profiles: [{ id: 'main', action: 'shred', roots: [ABS('a')] }] },
    });
    // An action with no handler must never reach the run.
    check('an action this build cannot carry out falls back to the bin', profilesOf(s)[0].action === 'recycle');
    check('and the file is told why', warnings.some((w) => /is not one of/.test(w)), warnings.join('; '));
    check('the actions offered are the two that have handlers',
      settings.AUTO_ACTIONS.join(',') === 'recycle,quarantine', settings.AUTO_ACTIONS.join(','));
  }

  {
    const { settings: s } = coerce({
      autoClean: { profiles: [{ id: 'main', enabled: true, roots: [] }] },
    });
    check('a profile switched on with no folders is left off, as one always was',
      profilesOf(s)[0].enabled === false);
  }

  {
    // Each profile is clamped on its own: one bad number does not reach
    // another profile's policy.
    const { settings: s } = coerce({
      autoClean: {
        profiles: [
          { id: 'main', minAgeDays: 999999, roots: [ABS('a')] },
          { id: 'paaaaa', minAgeDays: 30, roots: [ABS('b')] },
        ],
      },
    });
    check('one profile’s clamped value leaves the other alone',
      profilesOf(s)[0].minAgeDays === settings.LIMITS.minAgeDays.max && profilesOf(s)[1].minAgeDays === 30,
      profilesOf(s).map((p) => p.minAgeDays).join(', '));
  }

  {
    // Per profile, and deliberately not the global `quarantine.deleteOriginal`
    // that the button on the screen uses (decided 2026-09-28).
    const { settings: s } = coerce({
      autoClean: { profiles: [{ id: 'main', action: 'quarantine', deleteOriginal: true, roots: [ABS('a')] }] },
      quarantine: { deleteOriginal: false },
    });
    check('a profile carries its own “delete the original”, apart from the screen’s',
      profilesOf(s)[0].deleteOriginal === true && s.quarantine.deleteOriginal === false);
  }
}

/* -------------------------------------------------------------------------- */
/* task names, and what the sweep may touch                                    */
/* -------------------------------------------------------------------------- */

function taskNames() {
  console.log('\nWhich Windows task belongs to which profile:');

  // Loaded per case, because the answer depends on this process's own suffix
  // and the module reads it at call time.
  const withSuffix = (suffix, fn) => {
    const had = process.env.CLEANDRIVE_TASK_SUFFIX;
    if (suffix === null) delete process.env.CLEANDRIVE_TASK_SUFFIX;
    else process.env.CLEANDRIVE_TASK_SUFFIX = suffix;
    try {
      fn(require('../src/main/lib/scheduler'));
    } finally {
      if (had === undefined) delete process.env.CLEANDRIVE_TASK_SUFFIX;
      else process.env.CLEANDRIVE_TASK_SUFFIX = had;
    }
  };

  withSuffix(null, (scheduler) => {
    check('the first profile keeps the name a configured machine already has',
      scheduler.cleanupTaskPath('main') === scheduler.cleanupTaskPath() &&
        scheduler.cleanupTaskPath() === 'CleanDrive\\AutomaticCleanup',
      scheduler.cleanupTaskPath('main'));
    check('every other profile gets a name of its own',
      scheduler.cleanupTaskPath('pa1b2c3') === 'CleanDrive\\AutomaticCleanup_pa1b2c3',
      scheduler.cleanupTaskPath('pa1b2c3'));

    check('and the name reads back as the profile it names',
      scheduler.profileOfTaskName('AutomaticCleanup') === 'main' &&
        scheduler.profileOfTaskName('AutomaticCleanup_pa1b2c3') === 'pa1b2c3');

    /*
     * The two refusals, which are what makes the sweep safe. Its only verb is
     * "remove a scheduled task", so a name it cannot attribute with certainty
     * has to come back as nothing at all.
     */
    check('a harness’s own task is not attributed to any profile',
      scheduler.profileOfTaskName('AutomaticCleanup_dev') === null,
      'suffix "dev" and a profile called "dev" are the same name');
    check('nor is another feature’s task', scheduler.profileOfTaskName('DiskSample_dev') === null);
    check('nor one somebody made by hand', scheduler.profileOfTaskName('AutomaticCleanup_MyOwnThing') === null);
  });

  withSuffix('dev', (scheduler) => {
    check('under a harness suffix, the real machine’s task is invisible',
      scheduler.profileOfTaskName('AutomaticCleanup') === null,
      'this is what stops a test deleting a configured schedule');
    check('and the harness’s own tasks are the ones it can see',
      scheduler.profileOfTaskName('AutomaticCleanup_dev') === 'main' &&
        scheduler.profileOfTaskName('AutomaticCleanup_pa1b2c3_dev') === 'pa1b2c3');
    check('a task from another suffix stays invisible',
      scheduler.profileOfTaskName('AutomaticCleanup_pa1b2c3_other') === null);
  });
}

/* -------------------------------------------------------------------------- */
/* the lock                                                                    */
/* -------------------------------------------------------------------------- */

/** A second process that takes the lock and holds it until told to let go. */
const HOLDER_SOURCE = `
const runlock = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'main', 'lib', 'runlock.js').replace(/\\/g, '/'))});
(async () => {
  const held = await runlock.acquire(process.argv[2], { holder: 'other-process', waitMs: 0 });
  process.send({ got: held.ok });
  process.on('message', async (m) => {
    if (m === 'release') { await held.release(); process.send({ released: true }); process.exit(0); }
    if (m === 'die') process.exit(1);
  });
})();
`;

async function theLock() {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-lock-'));
  const file = path.join(base, 'autoclean.lock');
  const holderJs = path.join(base, 'holder.js');
  await fsp.writeFile(holderJs, HOLDER_SOURCE, 'utf8');

  console.log('\nOne unattended run at a time, across processes:');

  try {
    {
      const first = await runlock.acquire(file, { holder: 'a', waitMs: 0 });
      check('the first caller gets it', first.ok === true);
      const second = await runlock.acquire(file, { holder: 'b', waitMs: 0 });
      check('the second is refused rather than allowed alongside', second.ok === false && second.reason === 'busy');
      check('and is told who has it', second.heldBy && second.heldBy.holder === 'a', JSON.stringify(second.heldBy));
      await first.release();
      const third = await runlock.acquire(file, { holder: 'c', waitMs: 0 });
      check('once it is let go the next caller gets it', third.ok === true);
      await third.release();
    }

    {
      // A real second process, because "across processes" is the whole claim
      // and one process talking to itself cannot test it.
      const child = fork(holderJs, [file], { stdio: 'ignore', serialization: 'json' });
      const got = await new Promise((resolve) => child.once('message', resolve));
      check('another process can take it', got && got.got === true);

      const blocked = await runlock.acquire(file, { holder: 'ours', waitMs: 0 });
      check('and while it holds it, this process is refused', blocked.ok === false);
      check('the lock names the process that has it', blocked.heldBy && blocked.heldBy.pid === child.pid,
        `${blocked.heldBy && blocked.heldBy.pid} vs ${child.pid}`);

      // Waiting: the holder lets go part way through, and the waiter gets in.
      setTimeout(() => child.send('release'), 400);
      const waited = await runlock.acquire(file, { holder: 'ours', waitMs: 8000, pollMs: 100 });
      check('a caller that waits gets in when the other finishes', waited.ok === true);
      check('and it knows it waited', waited.waitedMs >= 200, `${waited.waitedMs}ms`);
      await waited.release();
    }

    {
      // A machine that loses power mid-run leaves the file behind. A lock that
      // can outlive its owner breaks the feature after one bad night.
      const child = fork(holderJs, [file], { stdio: 'ignore', serialization: 'json' });
      await new Promise((resolve) => child.once('message', resolve));
      const gone = new Promise((resolve) => child.once('exit', resolve));
      child.send('die');
      await gone;

      check('the file is still there after the holder dies', fs.existsSync(file));
      const after = await runlock.acquire(file, { holder: 'ours', waitMs: 0 });
      check('but a lock whose process is gone is not a lock', after.ok === true);
      await after.release();
    }

    {
      // And one whose process is still alive but which has been held far too
      // long: a run that started yesterday is not a run.
      await fsp.writeFile(file, JSON.stringify({ pid: process.pid, holder: 'stuck', at: Date.now() - 3 * 60 * 60 * 1000 }));
      const after = await runlock.acquire(file, { holder: 'ours', waitMs: 0, staleAfterMs: 60 * 60 * 1000 });
      check('a lock older than the limit is taken over, even from a live process', after.ok === true);
      await after.release();
    }

    {
      await fsp.writeFile(file, 'not json at all');
      const fresh = await runlock.acquire(file, { holder: 'ours', waitMs: 0 });
      // Unreadable and recent is treated as held: the safe direction is to
      // skip a run, never to run two at once.
      check('a lock file that cannot be read is treated as held', fresh.ok === false);
      const old = await runlock.acquire(file, { holder: 'ours', waitMs: 0, staleAfterMs: -1 });
      check('and only its age can free it', old.ok === true);
      await old.release();
    }

    check('letting go twice is not an error', (await runlock.release(file)) === true || true);
  } finally {
    await fsp.rm(base, { recursive: true, force: true });
  }
}

(async () => {
  theSettings();
  taskNames();
  await theLock();
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
