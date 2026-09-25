'use strict';

/**
 * The analyzer behind two screens: Disk usage and What to delete.
 *
 * One analyzer, not two, because they are two readings of one walk. Walking a
 * home folder twice to produce the largest files and the cleanup groups
 * separately would double the one wait the user can see; so the walk runs once
 * and every file either list can act on becomes one candidate. The screens are
 * views over those candidates -- "the fifty largest" and "grouped by category"
 * -- and a file that is in both is the same candidate in both, with the same
 * verdict.
 */

const path = require('node:path');

const { scan } = require('../lib/scanner');
const { extOf, pathKey } = require('../lib/util');
const { message: m } = require('../../i18n');
const { candidateId, evidence } = require('./contract');
const { isAllowedUnattended } = require('../automatic/allowed-categories');
const { all } = require('./categories');
const { streamWhile } = require('./channel');
const cloudState = require('../lib/cloud-state');
const appCaches = require('./app-caches');
const { runningProcessNames } = require('../lib/processes');

const ID = 'scan';

/**
 * How sure the app is that a file is what its category says.
 *
 * The advisor never had to say: it produced a verdict and a reason. The
 * contract asks for one of four words, so here they are, decided per rule and
 * pitched low wherever the rule is weaker than its verdict sounds:
 *
 *   folder called Temp / tmp                    strong
 *   .tmp .crdownload .part and the like         strong
 *   .bak                                        likely  -- can be somebody's only backup
 *   editor lock file (~$report.docx)            strong
 *   folder called Cache                         likely  -- whatever the app decided to put there
 *   GPU / shader / compiled-code cache          strong  -- machine-generated, rebuilt on launch
 *   crash dump, by folder or by extension       strong
 *   log untouched for a week                    strong
 *   bin/obj/out beside a project file           likely  -- nothing checks the project is idle
 *   installer in Downloads, a month old         likely  -- an .exe there can be a portable app
 *   large archive or disk image                 strong  -- that it is one; what is inside, unknown
 *   large and untouched, access times tracked   strong
 *   large and untouched, access times NOT       guess   -- "untouched" is then only "unmodified"
 *   cache inside an installed program's data    likely
 *
 * `certain` is never used for a cleanup verdict. Nothing about a file's name
 * or place makes its disposability certain; the word is kept for what the app
 * has actually verified, like two files hashing the same.
 */
function confidenceFor(category, source, filePath, accessTimes) {
  switch (category) {
    case 'temp':
      if (source === 'ext' && extOf(filePath) === 'bak') return 'likely';
      return 'strong';
    case 'cache':
      return 'likely';
    case 'gpucache':
    case 'crashdump':
    case 'log':
      return 'strong';
    case 'buildoutput':
      return 'likely';
    case 'installer':
      return 'likely';
    case 'archive':
      return 'strong';
    case 'stale':
      return accessTimes && accessTimes.tracked === true ? 'strong' : 'guess';
    case 'appcache':
      return 'likely';
    default:
      return 'guess';
  }
}

const NO_RULE = m('evidence.noRule', 'No cleanup rule matched this file, so the app has no reason to suggest removing it');

const ATIME_UNTRACKED = m(
  'evidence.atimeUntracked',
  'Windows is not recording when files are opened here, so this age is when it was last modified'
);

/* ---- known apps' caches (D4) ---------------------------------------------- */

/**
 * Which known apps are open, as the scan ends: a Set of ids, or null when the
 * process list could not be read.
 */
async function openAppsNow(deps = {}) {
  const list = deps.runningProcessNames || runningProcessNames;
  return appCaches.openApps(await list());
}

const appOf = (category) => (typeof category === 'string' && category.startsWith('app.') ? appCaches.byId(category.slice(4)) : null);

/**
 * A known app's cache file, as a candidate.
 *
 * Safe while the app is closed. While it is open -- or when there was no way
 * to tell -- the file is `keep` with no action at all, and the first reason
 * says why and what to do: an app's cache is not a thing to take out from
 * under it.
 */
function appCandidate(file, def, open) {
  const category = `cleanup.app.${def.id}`;
  const shut = !!open && !open.has(def.id);
  const state = !open
    ? m('evidence.app.unknown', 'Could not tell whether {app} is open, so nothing of it is offered', { app: def.name })
    : shut
      ? m('evidence.app.closed', '{app} was not running when the scan finished', { app: def.name })
      : m('evidence.app.open', '{app} is open — close it and scan again', { app: def.name });
  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: file.size,
    category,
    verdict: shut ? 'safe' : 'keep',
    confidence: shut ? 'strong' : open ? 'certain' : 'likely',
    evidence: shut ? [evidence(1, file.reason), evidence(2, state)] : [evidence(1, state), evidence(2, file.reason)],
    actions: shut ? ['recycle'] : [],
    unattendedEligible: shut && isAllowedUnattended(category),
    meta: { mtimeMs: file.mtimeMs, atimeMs: file.atimeMs },
  };
}

/**
 * The groups, told which apps are open: an open app's group is `keep`, marked
 * `open`, and out of the "safe to delete" total.
 */
function markOpenApps(cleanup, open) {
  if (!cleanup || !Array.isArray(cleanup.groups)) return;
  for (const group of cleanup.groups) {
    const def = appOf(group.category);
    if (!def) continue;
    const shut = !!open && !open.has(def.id);
    group.app ={ id: def.id, name: def.name, open: open ? !shut : null };
    if (!shut) group.verdict = 'keep';
  }
  const total = (verdict) => cleanup.groups.filter((g) => g.verdict === verdict).reduce((n, g) => n + g.bytes, 0);
  cleanup.safeBytes = total('safe');
  cleanup.reviewBytes = total('review');
  const order = { safe: 0, review: 1, protected: 2, keep: 3 };
  cleanup.groups.sort((a, b) => order[a.verdict] - order[b.verdict] || b.bytes - a.bytes);
}

function cleanupCandidate(file, category, verdict, accessTimes) {
  const list = [evidence(1, file.reason)];
  if (category === 'stale' && !(accessTimes && accessTimes.tracked === true)) {
    list.push(evidence(2, ATIME_UNTRACKED));
  }
  const id = `cleanup.${category}`;
  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: file.size,
    category: id,
    verdict,
    confidence: confidenceFor(category, file.source, file.path, accessTimes),
    evidence: list,
    actions: ['recycle'],
    unattendedEligible: verdict === 'safe' && isAllowedUnattended(id),
    meta: { mtimeMs: file.mtimeMs, atimeMs: file.atimeMs },
  };
}

function plainCandidate(file) {
  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: file.size,
    category: 'usage.file',
    verdict: 'keep',
    // Certain of the only thing it claims: that no rule matched.
    confidence: 'certain',
    evidence: [evidence(1, NO_RULE)],
    actions: ['recycle'],
    unattendedEligible: false,
    meta: { mtimeMs: file.mtimeMs, atimeMs: file.atimeMs },
  };
}

/**
 * A file the scan recorded with the advisor's verdict beside it -- a row of
 * the largest list, or a tile on the map of the folder -- as a candidate.
 */
function fileCandidate(file, accessTimes, open = null) {
  const def = appOf(file.category);
  if (def) return appCandidate(file, def, open);
  return file.category && file.verdict !== 'keep'
    ? cleanupCandidate(file, file.category, file.verdict, accessTimes)
    : plainCandidate(file);
}

/**
 * Every file either screen can act on, once each.
 *
 * @returns {{candidates: object[], cleanupIds: Map<string, string[]>, largestIds: string[]}}
 */
function toCandidates(result, open = null) {
  const byId = new Map();
  const cleanupIds = new Map();
  const accessTimes = result.accessTimes;

  for (const group of (result.cleanup && result.cleanup.groups) || []) {
    const ids = [];
    for (const file of group.files) {
      const def = appOf(group.category);
      const candidate = def ? appCandidate(file, def, open) : cleanupCandidate(file, group.category, group.verdict, accessTimes);
      byId.set(candidate.id, candidate);
      ids.push(candidate.id);
    }
    cleanupIds.set(group.category, ids);
  }

  // The largest list keeps its own two hundred, and the advisor keeps its own
  // hundred per category, so a big cache file can be in the first and have
  // been trimmed from the second. It still gets the advisor's verdict: the
  // scanner recorded it on the entry.
  const largestIds = [];
  for (const file of result.largestFiles || []) {
    const id = candidateId(ID, file.path);
    if (!byId.has(id)) byId.set(id, fileCandidate(file, accessTimes, open));
    largestIds.push(id);
  }

  return { candidates: [...byId.values()], cleanupIds, largestIds };
}

/** Everything the two screens draw that is not a row: totals, folders, types. */
function toSummary(result, cleanupIds, largestIds, cloudSummary) {
  const { largestFiles, cleanup, cloudFiles, ...rest } = result;
  return {
    ...rest,
    largest: largestIds,
    cleanup: {
      ...cleanup,
      groups: cleanup.groups.map(({ files, ...group }) => ({ ...group, ids: cleanupIds.get(group.category) || [] })),
    },
    ...(cloudSummary ? { cloud: cloudSummary } : {}),
  };
}

/* ---- OneDrive: what "free up space" could free (B3) ------------------------ */

const DAY = 24 * 60 * 60 * 1000;

const IN_SYNC = m(
  'evidence.cloud.inSync',
  'Windows reports it in sync with OneDrive, with its contents on this disk'
);
const ALSO_IN_CLOUD = m(
  'evidence.cloud.alsoInCloud',
  'It is also in OneDrive, in sync: “Keep only in the cloud”, in its own card on What to delete, frees the same space without deleting it on every device'
);
const PINNED = m(
  'evidence.cloud.pinned',
  'Somebody chose “Always keep on this device” for it — making it online-only undoes that choice'
);

/**
 * A OneDrive file that can be made online-only, as a candidate.
 *
 * Its own id space: the same file can be a row in the largest list, where the
 * action is the Recycle Bin, and here, where it is not. Two decisions, two
 * candidates. The only action is `dehydrate`, so no bulk "select everything
 * safe" and no delete button can ever reach it.
 */
function cloudCandidate(file, state, accessTimes, now) {
  const tracked = accessTimes && accessTimes.tracked === true;
  const since = tracked && file.atimeMs ? file.atimeMs : file.mtimeMs;
  const days = Math.max(0, Math.floor((now - since) / DAY));
  const age = tracked
    ? m('evidence.cloud.notOpened', 'Not opened for {days} days', { days })
    : m('evidence.cloud.notChanged', 'Not changed for {days} days (Windows is not recording when files are opened here)', { days });
  const list = state.pinned ? [evidence(1, PINNED), evidence(2, IN_SYNC), evidence(3, age)] : [evidence(1, IN_SYNC), evidence(2, age)];
  return {
    id: candidateId(`${ID}:cloud`, file.path),
    path: file.path,
    kind: 'file',
    bytes: file.size,
    bytesOnDisk: file.allocated,
    category: 'cloud.dehydrate',
    verdict: state.pinned ? 'review' : 'safe',
    confidence: state.pinned ? 'likely' : 'strong',
    evidence: list,
    actions: ['dehydrate'],
    unattendedEligible: false,
    meta: { mtimeMs: file.mtimeMs, atimeMs: file.atimeMs, pinned: state.pinned },
  };
}

/**
 * Ask Windows which of the OneDrive files on this disk are in sync, and make
 * candidates of those. Everything else is counted for the screen to say so:
 * files never uploaded (making them online-only frees nothing), files still
 * waiting to sync, and files already online-only.
 */
async function cloudFindings(cloudFiles, accessTimes, now, deps = {}) {
  const query = deps.query || cloudState.query;
  const running = deps.running || cloudState.oneDriveRunning;
  const summary = {
    ids: [],
    bytes: 0,
    onDisk: 0,
    notSynced: { count: 0, bytes: 0 },
    pending: { count: 0, bytes: 0 },
    onlineOnly: { ...cloudFiles.onlineOnly },
    unavailable: null,
    running: false,
  };
  const candidates = [];
  if (cloudFiles.onDisk.length === 0) {
    summary.running = await running();
    return { candidates, summary };
  }
  const [reply, isRunning] = await Promise.all([query(cloudFiles.onDisk.map((f) => f.path)), running()]);
  summary.running = isRunning;
  if (!reply.ok) {
    summary.unavailable = reply.reason || 'unavailable';
    return { candidates, summary };
  }
  for (const file of cloudFiles.onDisk) {
    const state = reply.states.get(file.path);
    if (!state || state.missing) continue;
    if (!state.placeholder) {
      summary.notSynced.count++;
      summary.notSynced.bytes += file.size;
    } else if (!state.onDisk) {
      summary.onlineOnly.count++;
      summary.onlineOnly.bytes += file.size;
    } else if (!state.inSync) {
      summary.pending.count++;
      summary.pending.bytes += file.size;
    } else {
      const candidate = cloudCandidate(file, state, accessTimes, now);
      candidates.push(candidate);
      summary.ids.push(candidate.id);
      summary.bytes += file.size;
      summary.onDisk += file.allocated;
    }
  }
  return { candidates, summary };
}

const analyzer = {
  id: ID,
  feature: 'free',
  requiresElevation: false,
  categories: all().filter((c) => c.startsWith('cleanup.') || c === 'usage.file' || c === 'cloud.dehydrate'),

  /**
   * @param {object} ctx  { root, options, deps: { scan } }
   */
  async *run(ctx, token) {
    const scanFn = (ctx.deps && ctx.deps.scan) || scan;
    const result = yield* streamWhile((push) =>
      scanFn(path.resolve(ctx.root), ctx.options || {}, {
        token,
        onProgress: (p) => push({ type: 'progress', ...p }),
      })
    );

    // Which known apps are open decides what their caches are (D4), so it is
    // asked once the walk is done, and before any candidate is made.
    const open = result.cleanup && result.cleanup.groups.some((g) => appOf(g.category))
      ? await openAppsNow(ctx.deps)
      : new Set();
    markOpenApps(result.cleanup, open);
    const { candidates, cleanupIds, largestIds } = toCandidates(result, open);

    // Only when the folder scanned holds OneDrive files at all: a scan of
    // Downloads has nothing to say about OneDrive, and says nothing.
    let found = null;
    const cloudFiles = result.cloudFiles;
    if (cloudFiles && (cloudFiles.onDisk.length > 0 || cloudFiles.onlineOnly.count > 0) && !token.cancelled) {
      found = await cloudFindings(cloudFiles, result.accessTimes, result.scannedAt || Date.now(), ctx.deps && ctx.deps.cloud);
      // A file offered for the Recycle Bin here -- "large and untouched", say
      // -- that is also a synced OneDrive file says so, where the reasons are:
      // there is a way to get the same space back without deleting it
      // everywhere. Decided 2026-09-25, over dropping it from the groups.
      const inCloud = new Set(found.candidates.map((c) => pathKey(c.path)));
      for (const candidate of candidates) {
        if (inCloud.has(pathKey(candidate.path))) {
          candidate.evidence.push(evidence(candidate.evidence.length + 1, ALSO_IN_CLOUD));
        }
      }
    }
    for (const candidate of candidates) yield { type: 'candidate', candidate };
    if (found) for (const candidate of found.candidates) yield { type: 'candidate', candidate };
    const summary = toSummary(result, cleanupIds, largestIds, found ? found.summary : null);
    // For the map of the folder, whose file tiles are candidates too.
    summary.openApps = open ? [...open] : null;
    yield { type: 'summary', summary };
  },
};

module.exports = { analyzer, confidenceFor, toCandidates, fileCandidate, cloudCandidate, cloudFindings, appCandidate, markOpenApps, ID };
