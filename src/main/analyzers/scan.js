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
const { extOf } = require('../lib/util');
const { message: m } = require('../../i18n');
const { candidateId, evidence } = require('./contract');
const { isAllowedUnattended } = require('../automatic/allowed-categories');
const { all } = require('./categories');
const { streamWhile } = require('./channel');

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
function fileCandidate(file, accessTimes) {
  return file.category && file.verdict !== 'keep'
    ? cleanupCandidate(file, file.category, file.verdict, accessTimes)
    : plainCandidate(file);
}

/**
 * Every file either screen can act on, once each.
 *
 * @returns {{candidates: object[], cleanupIds: Map<string, string[]>, largestIds: string[]}}
 */
function toCandidates(result) {
  const byId = new Map();
  const cleanupIds = new Map();
  const accessTimes = result.accessTimes;

  for (const group of (result.cleanup && result.cleanup.groups) || []) {
    const ids = [];
    for (const file of group.files) {
      const candidate = cleanupCandidate(file, group.category, group.verdict, accessTimes);
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
    if (!byId.has(id)) byId.set(id, fileCandidate(file, accessTimes));
    largestIds.push(id);
  }

  return { candidates: [...byId.values()], cleanupIds, largestIds };
}

/** Everything the two screens draw that is not a row: totals, folders, types. */
function toSummary(result, cleanupIds, largestIds) {
  const { largestFiles, cleanup, ...rest } = result;
  return {
    ...rest,
    largest: largestIds,
    cleanup: {
      ...cleanup,
      groups: cleanup.groups.map(({ files, ...group }) => ({ ...group, ids: cleanupIds.get(group.category) || [] })),
    },
  };
}

const analyzer = {
  id: ID,
  feature: 'free',
  requiresElevation: false,
  categories: all().filter((c) => c.startsWith('cleanup.') || c === 'usage.file'),

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

    const { candidates, cleanupIds, largestIds } = toCandidates(result);
    for (const candidate of candidates) yield { type: 'candidate', candidate };
    yield { type: 'summary', summary: toSummary(result, cleanupIds, largestIds) };
  },
};

module.exports = { analyzer, confidenceFor, toCandidates, fileCandidate, ID };
