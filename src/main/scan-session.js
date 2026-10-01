'use strict';

/**
 * One scan of one or more folders, as the window and the command line both
 * run it.
 *
 * It used to live inside the `scan:run` handler in ipc.js, and the command
 * line (H1) needs the same thing to the letter: the same refusal of a folder
 * that is not there, the same licence check for several folders, the same
 * catalogue read for a fast scan, the same analyzer, the same history point
 * and snapshot. A second copy would have been two scans that disagree the
 * first time either was changed. What stays in ipc.js is what only a window
 * needs -- the progress events and the folder tree it reads a level at a time.
 *
 *   prepare(folders)          which folders, refused ones named, nested ones folded
 *   scanPrepared(prepared)    the walk (or the catalogue) and the analyzer, per folder
 *
 * Split in two so a caller can look at the folders before anything is read:
 * the command line refuses `--mft` up front for a folder that is not a whole
 * NTFS drive, where the window quietly walks it instead.
 */

const analyzers = require('./analyzers');
const scanRoots = require('./analyzers/scan-roots');
const volumes = require('./lib/volumes');
const mftRead = require('./system/mft-read');
const { pathKey } = require('./lib/util');

/**
 * @param {string[]} folders  absolute paths
 * @param {object} options
 * @param {(feature: string) => boolean} options.can
 * @param {object} [options.deps]  `{ volumes }` for a harness
 */
async function prepare(folders, { can, deps = {} } = {}) {
  const listing = await (deps.volumes ? deps.volumes() : volumes.list());
  const prepared = await scanRoots.prepareRoots(folders, { drives: listing.drives });
  if (prepared.roots.length === 0) {
    const why = prepared.refused[0] ? prepared.refused[0].reason : 'missing';
    throw Object.assign(new Error(why === 'notFolder' ? 'That is not a folder' : 'That folder is not there any more'), {
      code: 'ENOENT',
      quiet: true,
      refused: prepared.refused,
    });
  }
  if (prepared.roots.length > 1 && !can('pro.scan.multiroot')) {
    throw Object.assign(new Error('Scanning several folders at once is part of CleanDrive Pro'), {
      code: 'ELOCKED',
      quiet: true,
      feature: 'pro.scan.multiroot',
    });
  }
  return prepared;
}

/**
 * One UAC prompt (or none, for a caller that is already elevated), then one
 * catalogue read per eligible drive.
 *
 * Returns a map from drive root to the source a walk can be run against, plus
 * what to tell the user when there is nothing in it. A refusal here is never
 * fatal to the window: every root falls back to the ordinary walk, and the
 * status line says which scanner answered.
 *
 * @param {object} options
 * @param {() => object} options.helperClient  a HelperClient, not yet started
 */
async function fastSources(roots, { can, token, onProgress = () => {}, helperClient }) {
  if (!can('pro.scan.mft')) return { sources: new Map(), refused: 'locked' };

  const eligible = [];
  const reasons = new Map();
  for (const info of roots) {
    const why = scanRoots.whyNotFast(info);
    if (why) reasons.set(pathKey(info.root), why);
    else if (!eligible.some((e) => pathKey(e.root) === pathKey(info.root))) eligible.push(info);
  }
  if (eligible.length === 0) {
    return { sources: new Map(), reasons, refused: reasons.values().next().value || 'notWholeDrive' };
  }

  const client = helperClient();
  onProgress({ phase: 'prompt' });
  // What went wrong, in the words it went wrong in, by drive. The window says
  // only "could not be read"; the command line has nowhere else to say why,
  // and a script's author cannot act on a reason nobody printed.
  const errors = new Map();
  try {
    await client.start();
  } catch (err) {
    if (err && err.code === 'EDECLINED') return { sources: new Map(), reasons, errors, refused: 'declined' };
    for (const info of eligible) errors.set(pathKey(info.root), err && err.message ? err.message : String(err));
    return { sources: new Map(), reasons, errors, refused: 'helper' };
  }

  const sources = new Map();
  const summaries = [];
  try {
    const ping = await client.request('ping');
    if (!ping || !ping.elevated) return { sources, reasons, refused: 'notElevated' };

    for (const info of eligible) {
      if (token.cancelled) break;
      try {
        const read = await mftRead.readElevated(client, info.volume, {
          onProgress: (p) => onProgress({ phase: 'mft', root: info.root, records: p.records, of: p.of }),
        });
        const built = mftRead.sourceFor(read, info.root);
        sources.set(pathKey(info.root), { source: built.source, summary: read.summary });
        summaries.push(read.summary);
      } catch (err) {
        // One drive's catalogue being unreadable is a reason to walk that
        // drive, not a reason to fail the scan.
        reasons.set(pathKey(info.root), 'unreadable');
        errors.set(pathKey(info.root), err && err.message ? err.message : String(err));
        console.error('[mft]', info.volume, err && err.message);
      }
    }
  } finally {
    // One prompt, one set of answers. Closing the pipe is what makes the
    // helper leave; the table is already in this process.
    client.stop();
  }
  return { sources, reasons, errors, summaries, refused: sources.size === 0 ? 'unreadable' : null };
}

/**
 * Scan what `prepare` kept, one folder at a time.
 *
 * Each folder is scanned on its own, as one always was, and keeps its own
 * point in the history and its own snapshot -- that is `afterCollect`'s job,
 * handed the summary and the tree of each folder as soon as it is read.
 *
 * @param {object} prepared  from `prepare`
 * @param {object} options
 * @param {boolean} [options.fast]           read whole NTFS drives from their catalogue (A2)
 * @param {object} [options.plan]            a `fastSources` answer already in hand, so a caller
 *   can refuse before anything is walked rather than after
 * @param {boolean} [options.collectTree]    keep the folder tree (the map, and snapshots)
 * @param {(feature: string) => boolean} options.can
 * @param {import('./lib/util').CancelToken} options.token
 * @param {(payload: object) => void} [options.onProgress]  per-folder progress, with the folder named
 * @param {(payload: object) => void} [options.onFastProgress]  the catalogue read's own progress
 * @param {() => object} [options.helperClient]
 * @param {(part: {summary: object, tree: any[]|undefined}) => Promise<void>} [options.afterCollect]
 * @param {object} [options.deps]  harness seams: `{ statfs, cloud, appCacheEnv, runningProcessNames }`
 * @returns {Promise<{plan: object|null, parts: object[]}>}
 */
async function scanPrepared(prepared, options) {
  const {
    fast = false,
    collectTree = true,
    can,
    token,
    onProgress = () => {},
    onFastProgress = () => {},
    helperClient,
    afterCollect = async () => {},
    deps = {},
  } = options;

  // Asked for before any folder is scanned: one UAC prompt covers every
  // drive in the list, and a refusal only means the ordinary walk runs.
  const plan = options.plan !== undefined
    ? options.plan
    : fast === true ? await fastSources(prepared.roots, { can, token, onProgress: onFastProgress, helperClient }) : null;

  const parts = [];
  for (const [index, info] of prepared.roots.entries()) {
    if (token.cancelled) break;
    const send = (payload) => onProgress({ ...payload, root: info.root, rootIndex: index, roots: prepared.roots.length });
    const fromTable = plan ? plan.sources.get(pathKey(info.root)) : null;
    const collected = await analyzers.collect(
      'scan',
      // cloudFiles: which OneDrive files could be made online-only (B3).
      {
        root: info.root,
        options: {
          collectTree,
          cloudFiles: info.readOnly === null,
          // The one option that changes where the walk's answers come
          // from rather than what it does with them (A2). Unset, and
          // the walk is exactly the walk it was.
          ...(fromTable ? { source: fromTable.source } : {}),
          ...(deps.appCacheEnv ? { appCacheEnv: deps.appCacheEnv } : {}),
        },
        deps: {
          ...(deps.cloud ? { cloud: deps.cloud } : {}),
          ...(deps.runningProcessNames ? { runningProcessNames: deps.runningProcessNames } : {}),
        },
      },
      { token, onProgress: send, can }
    );
    // The tree stays in this process: the snapshot store keeps it, and the
    // window reads it a level at a time through scan:children.
    const { tree, treeFiles, ...summary } = collected.summary;
    await afterCollect({ summary, tree });

    const candidates = info.readOnly
      ? collected.candidates.map((c) => scanRoots.readOnlyCandidate(c, info.readOnly))
      : collected.candidates;
    const unscanned = await scanRoots.unscannedOnDrive(info, summary, deps.statfs ? { statfs: deps.statfs } : {});
    // Which scanner answered for this folder, and -- when the fast one
    // was asked for and did not -- why not. The window says so on the
    // status line: a measurement nobody can attribute is a measurement
    // nobody can check.
    const scanner = fromTable
      ? {
        scanner: 'mft',
        mft: {
          bytes: fromTable.summary.mftBytes,
          records: fromTable.summary.recordsRead,
          files: fromTable.summary.fileCount,
          folders: fromTable.summary.folderCount,
          torn: fromTable.summary.torn,
          ms: fromTable.summary.ms,
        },
      }
      : { scanner: 'walk', ...(plan ? { fastRefused: plan.reasons.get(pathKey(info.root)) || plan.refused } : {}) };
    parts.push({ info: { ...info, unscanned, ...scanner }, summary, candidates, tree, treeFiles });
  }
  return { plan, parts };
}

/** The reply's figures for several folders joined, or the one folder's own. */
function joined(prepared, parts) {
  const summary = parts.length === 1 ? parts[0].summary : scanRoots.mergeScans(parts);
  return {
    ...summary,
    // A stop between two folders leaves the rest unscanned; say so.
    cancelled: summary.cancelled || parts.length < prepared.roots.length,
    roots: parts.map((p) => p.info),
    notScanned: prepared.roots.slice(parts.length).map((r) => r.root),
    merged: prepared.merged,
    refused: prepared.refused,
    candidates: parts.flatMap((p) => p.candidates),
  };
}

module.exports = { prepare, scanPrepared, fastSources, joined };
