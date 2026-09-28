'use strict';

/**
 * "I need 30 GB on C:" -- and where it would come from (G1).
 *
 * Everything the app has measured arrives here as candidates, in the one
 * shape every analyzer already produces: a path, a size, a category, a
 * verdict, and the actions that may be taken on it. This file sorts them into
 * steps by risk, adds up what each step would actually give back, and says at
 * which step the goal is met -- or that it is not.
 *
 * It does no I/O and takes no decisions about what to do. There is no
 * "carry out the plan": every step is a link to the screen that already
 * offers it, where the user ticks and confirms exactly as they would have.
 *
 * ## The number that is not the size of the files
 *
 * The heart of this is that **moving a file to the Recycle Bin frees nothing**.
 * The bin is on the same volume. `actions/recycle.js` says so in
 * `freesOnVolume()` and calls it the most important line in the file, and
 * every figure downstream reads it rather than assuming.
 *
 * The spec for this screen asked each step to show "what it actually frees on
 * the volume, from `freesOnVolume`". Taken at its word that is zero for five
 * of the eight steps it lists, and the planner could never reach a target. So
 * a step carries three numbers instead of one, and each says how the space
 * comes back:
 *
 *   freesNow     gone the moment the action finishes  (dehydrate; quarantine
 *                to another drive with the original deleted)
 *   afterBin     in the bin, and real once the bin is emptied  (recycle)
 *   viaWindows   a Windows tool would free it, if the user goes and does it
 *                (handoff: hiberfil, Windows.old, restore points, uninstall)
 *
 * The running total counts each of those where it genuinely lands, which is
 * why a bin step appears in the middle of the plan: everything above it that
 * went to the bin becomes real there, and not before.
 */

/**
 * Which actions give the volume its space back, and when.
 *
 * `scripts/test-planner.js` checks this against the handlers themselves, so
 * it cannot quietly disagree with `actions/*.js`.
 */
const WHEN = Object.freeze({
  dehydrate: 'now',
  compress: 'now',
  archive: 'now',
  // Into the bin, on the same volume. Real when the bin is emptied.
  recycle: 'bin',
  // Quarantine copies elsewhere; whether the original goes depends on a
  // setting, and when it does go, it goes to the bin.
  quarantine: 'bin',
  // Relocate was written here as 'now' before B2 existed, on the assumption
  // that moving a folder off a drive frees it at once. Building the handler
  // showed the assumption was the one this app is written against: the
  // original goes to the Recycle Bin, and the bin is on the drive it just
  // left. Same shape as quarantine, same answer, and only the "delete the
  // original" setting makes it 'now'.
  relocate: 'bin',
  // The app hands the user to a Windows tool and counts nothing itself.
  handoff: 'windows',
  hardlink: 'now',
  none: 'never',
});

const APP_CACHE = /^cleanup\.app\./;

/**
 * The steps, in the order the spec puts them: rising risk.
 *
 * `compress` (B4) is Phase 4 and has no step here yet.
 *
 * `relocate` (B2) is built and still has no step, which is not an oversight.
 * A step is matched against *candidates*, and every candidate in this app is
 * a file an analyzer decided something about. Relocate acts on a folder the
 * person picked off the treemap, because nothing here can honestly rank
 * "which of your folders should live on another drive" -- that depends on
 * what you open, not on what the disk can see. Giving it a step would mean
 * inventing that judgement, and a plan built on an invented judgement is
 * worse than a plan with one fewer step.
 * Quarantine is not a step either -- it is an action offered on files the
 * "large and untouched" step already lists, so giving it a step of its own
 * would count the same bytes twice.
 */
const STEPS = Object.freeze([
  {
    id: 'caches',
    risk: 1,
    screen: 'cleanup',
    verdicts: ['safe'],
    categories: ['cleanup.temp', 'cleanup.cache', 'cleanup.gpucache', 'cleanup.crashdump', 'cleanup.log', 'cleanup.appcache'],
    alsoAppCaches: true,
  },
  {
    id: 'cloud',
    risk: 2,
    screen: 'cleanup',
    verdicts: ['safe', 'review'],
    categories: ['cloud.dehydrate'],
  },
  {
    id: 'buildoutput',
    risk: 3,
    screen: 'cleanup',
    verdicts: ['safe'],
    categories: ['cleanup.buildoutput'],
  },
  {
    id: 'devtools',
    risk: 3,
    screen: 'dev',
    verdicts: ['safe', 'review'],
    categories: ['dev.packageCache', 'dev.ideCache', 'dev.buildOutput', 'dev.dependencies', 'dev.sdk', 'dev.wslDistro', 'dev.dockerDisk'],
  },
  {
    id: 'system',
    risk: 6,
    screen: 'system',
    verdicts: ['safe', 'review'],
    categories: [
      'system.hiberfil', 'system.windowsOld', 'system.restorePoints', 'system.updateCache',
      'system.deliveryOptimization', 'system.recovery', 'system.upgrade', 'system.installer',
      'system.recycleBin',
    ],
  },
  {
    id: 'review',
    risk: 7,
    screen: 'cleanup',
    verdicts: ['review'],
    categories: ['cleanup.installer', 'cleanup.archive', 'cleanup.stale'],
  },
  {
    id: 'dupes',
    risk: 7,
    screen: 'dupes',
    verdicts: ['safe', 'review'],
    categories: ['dupes.copy'],
  },
  {
    id: 'apps',
    risk: 8,
    screen: 'apps',
    verdicts: ['review'],
    categories: ['apps.installed', 'apps.store'],
  },
  {
    id: 'games',
    risk: 8,
    screen: 'games',
    verdicts: ['review'],
    categories: ['games.steam', 'games.orphan', 'games.downloading'],
  },
]);

/** What a candidate occupies, which is allocation where the analyzer knew it. */
function occupies(candidate) {
  const onDisk = candidate.bytesOnDisk;
  return Number.isFinite(onDisk) && onDisk >= 0 ? onDisk : (Number(candidate.bytes) || 0);
}

/** When this candidate's space would come back, from its first offered action. */
function whenFreed(candidate) {
  const actions = Array.isArray(candidate.actions) ? candidate.actions : [];
  for (const action of actions) {
    const when = WHEN[action];
    if (when && when !== 'never') return when;
  }
  return 'never';
}

function matches(step, candidate) {
  if (!step.verdicts.includes(candidate.verdict)) return false;
  if (step.categories.includes(candidate.category)) return true;
  return Boolean(step.alsoAppCaches && APP_CACHE.test(candidate.category));
}

/**
 * How much has to come back, from the goal and the volume as it is now.
 *
 * @param {object} goal    {kind: 'bytes', bytes} or {kind: 'percent', percent}
 * @param {object} volume  {totalBytes, freeBytes}
 * @returns {number} bytes, never below zero
 */
function targetFor(goal, volume) {
  const total = Number(volume && volume.totalBytes) || 0;
  const free = Number(volume && volume.freeBytes) || 0;
  if (!goal) return 0;
  if (goal.kind === 'percent') {
    const percent = Number(goal.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || total <= 0) return 0;
    // Used has to come down to this much of the volume.
    const allowedUsed = total * (percent / 100);
    return Math.max(0, (total - free) - allowedUsed);
  }
  const bytes = Number(goal.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  // Already have some of it free; the goal is "this much free", not "this
  // much more". The window asks for the wording it wants.
  return goal.aboveCurrent === false ? Math.max(0, bytes - free) : bytes;
}

/**
 * The plan.
 *
 * @param {object} input
 * @param {object} input.goal
 * @param {object} input.volume    {root, totalBytes, freeBytes}
 * @param {Array}  input.candidates  every candidate every analyzer produced
 * @param {string[]} [input.measured]  source ids that were actually measured
 * @param {string[]} [input.missing]   sources that were not, with a reason
 * @returns {object}
 */
function buildPlan({ goal, volume, candidates = [], measured = [], missing = [] } = {}) {
  const target = targetFor(goal, volume);
  const used = new Set();

  const steps = [];
  for (const step of STEPS) {
    const mine = [];
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const candidate = candidates[i];
      if (!matches(step, candidate)) continue;
      // One candidate belongs to one step. Without this a file that is both
      // `review` and a duplicate would be counted in both and the plan would
      // promise space twice.
      used.add(i);
      mine.push(candidate);
    }
    if (mine.length === 0) continue;

    const totals = { now: 0, bin: 0, windows: 0 };
    for (const candidate of mine) totals[whenFreed(candidate)] += occupies(candidate);

    steps.push({
      id: step.id,
      risk: step.risk,
      screen: step.screen,
      categories: [...new Set(mine.map((c) => c.category))],
      count: mine.length,
      moves: mine.reduce((sum, c) => sum + occupies(c), 0),
      freesNow: totals.now,
      afterBin: totals.bin,
      viaWindows: totals.windows,
      ids: mine.map((c) => c.id),
    });
  }

  // The bin step: everything above it that went to the bin becomes real here,
  // and nowhere earlier. Placed after the last step that puts anything there,
  // because emptying the bin before that would leave those files behind.
  const lastToBin = steps.reduce((at, step, i) => (step.afterBin > 0 ? i : at), -1);
  if (lastToBin !== -1) {
    const held = steps.slice(0, lastToBin + 1).reduce((sum, s) => sum + s.afterBin, 0);
    steps.splice(lastToBin + 1, 0, {
      id: 'bin',
      risk: steps[lastToBin].risk,
      screen: 'restore',
      categories: [],
      count: 0,
      moves: 0,
      freesNow: held,
      afterBin: 0,
      viaWindows: 0,
      derived: true,
      ids: [],
    });
  }

  // The running total, and where it crosses the target.
  let running = 0;
  let reachedAt = -1;
  for (const [i, step] of steps.entries()) {
    // `afterBin` is deliberately not added here: it is added once, at the bin
    // step, because that is when the volume actually gets it back.
    running += step.freesNow + step.viaWindows;
    step.cumulative = running;
    if (reachedAt === -1 && target > 0 && running >= target) reachedAt = i;
  }

  return {
    goal: goal || null,
    volume: volume || null,
    target,
    steps,
    total: running,
    reached: target > 0 && running >= target,
    reachedAt,
    shortfall: Math.max(0, target - running),
    measured,
    missing,
  };
}

module.exports = { buildPlan, targetFor, whenFreed, occupies, STEPS, WHEN };
