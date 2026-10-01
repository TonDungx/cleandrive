'use strict';

/**
 * `cleandrive scan <folder...> [--mft] [--snapshot]` -- what is in the folders.
 *
 * The scan is scan-session.js, the one the window runs. Read-only: without
 * `--snapshot` nothing is written anywhere, not even a point on the Trends
 * chart -- a script that scans every hour would otherwise draw the chart.
 *
 * `--mft` is stricter than the window's "Fast scan" switch, which walks a
 * folder it cannot read from the catalogue and says so on the status line. A
 * script that asked for the catalogue is told it cannot have it, before
 * anything is read: a folder that is not a whole NTFS drive is refused (2),
 * a terminal without administrator rights is refused (4), and no UAC prompt
 * is ever raised.
 */

const path = require('node:path');

const scanSession = require('../../scan-session');
const scanRoots = require('../../analyzers/scan-roots');
const { EXIT, CliError } = require('../codes');
const f = require('../format');
const { idOf } = require('./snapshots');
const { pathKey } = require('../../lib/util');

const NOT_FAST = Object.freeze({
  notWholeDrive: 'is not a whole drive; --mft reads a drive\'s own catalogue, so name the drive itself (for example D:\\)',
  network: 'is on the network, and a network drive has no catalogue this app can read',
  readOnly: 'is on a drive this app only reads',
  notNtfs: 'is not on an NTFS drive (FAT, exFAT and ReFS keep no $MFT)',
  unreadable: 'could not be read from its catalogue',
  helper: 'could not be read: the helper did not start',
  notElevated: 'could not be read: the helper started without administrator rights',
  locked: 'needs CleanDrive Pro for --mft',
});

const SAY_REFUSED = Object.freeze({ notAbsolute: 'is not a full path', missing: 'is not there', notFolder: 'is not a folder' });

/**
 * Prepare and scan, for `scan` and `suggest` alike.
 *
 * @returns {Promise<{prepared: object, parts: object[], snapshots: object[], joined: object}>}
 */
async function scanFolders(args, ctx, { mft = false, snapshot = false } = {}) {
  const folders = args.positional.map((p) => ctx.resolve(p));
  if (mft) {
    if (!ctx.can('pro.scan.mft')) throw new CliError(EXIT.LICENCE, ctx.licenceSentence('pro.scan.mft', '--mft'), { feature: 'pro.scan.mft' });
    if (!(await ctx.elevated())) {
      throw new CliError(EXIT.ADMIN, '--mft reads the drive\'s own catalogue, which needs administrator rights. Run this from an elevated terminal. Nothing was scanned.');
    }
  }

  const prepared = await scanSession.prepare(folders, { can: ctx.can });
  for (const r of prepared.refused) ctx.out.note(`skipped: ${r.root} ${SAY_REFUSED[r.reason] || r.reason}`);
  for (const m of prepared.merged) ctx.out.note(`folded: ${m.root} is inside ${m.into}, which is scanned already`);

  let plan;
  if (mft) {
    const refusals = prepared.roots.map((info) => [info.root, scanRoots.whyNotFast(info)]).filter(([, why]) => why);
    if (refusals.length > 0) {
      throw new CliError(EXIT.REFUSED, refusals.map(([root, why]) => `${root} ${NOT_FAST[why] || why}.`).join(' ') + ' Nothing was scanned.');
    }
    plan = await scanSession.fastSources(prepared.roots, {
      can: ctx.can,
      token: ctx.token,
      helperClient: ctx.helperClient,
      onProgress: (p) => p.phase === 'mft' && p.of && p.records === p.of && ctx.out.note(`read the catalogue of ${p.root}: ${f.count(p.of)} records`),
    });
    const missing = prepared.roots.filter((info) => !plan.sources.has(pathKey(info.root)));
    if (missing.length > 0) {
      const why = (info) => NOT_FAST[(plan.reasons && plan.reasons.get(pathKey(info.root))) || plan.refused] || plan.refused;
      // The helper's own words after the app's: "could not be read" alone is
      // a sentence nobody can act on.
      const detail = (info) => (plan.errors && plan.errors.get(pathKey(info.root)) ? ` (${plan.errors.get(pathKey(info.root))})` : '');
      throw new CliError(EXIT.ERROR, missing.map((info) => `${info.root} ${why(info)}${detail(info)}.`).join(' ') + ' Nothing was scanned.', {
        reasons: Object.fromEntries(missing.map((info) => [info.root, plan.errors && plan.errors.get(pathKey(info.root)) || null])),
      });
    }
  }

  const saved = [];
  let lastRoot = null;
  const { parts } = await scanSession.scanPrepared(prepared, {
    fast: mft,
    plan: mft ? plan : null,
    collectTree: snapshot,
    can: ctx.can,
    token: ctx.token,
    helperClient: ctx.helperClient,
    onProgress: (p) => {
      if (p.root !== lastRoot) {
        lastRoot = p.root;
        ctx.out.note(`scanning ${p.root}${p.roots > 1 ? ` (${p.rootIndex + 1} of ${p.roots})` : ''}...`);
      }
    },
    afterCollect: async ({ summary, tree }) => {
      if (snapshot && tree) {
        const entry = await ctx.services().snapshots.save({ ...summary, tree });
        saved.push({ root: summary.root, id: idOf(summary.root, entry.file), takenAt: entry.takenAt, complete: entry.complete });
      }
    },
  });
  return { prepared, parts, snapshots: saved, joined: scanSession.joined(prepared, parts) };
}

/** One folder's figures, as both `scan` and `suggest` put them in JSON. */
function rootFigures(part, saved) {
  const s = part.summary;
  const snap = saved.find((x) => x.root === s.root) || null;
  return {
    root: s.root,
    volume: part.info.volume || path.parse(s.root).root,
    fileSystem: part.info.fileSystem || null,
    readOnly: part.info.readOnly || null,
    scanner: part.info.scanner,
    ...(part.info.mft ? { mft: part.info.mft } : {}),
    files: s.totalFiles,
    folders: s.totalDirs,
    bytes: s.totalSize,
    errors: s.errorCount,
    excludedSystemLocations: s.excluded || 0,
    cancelled: Boolean(s.cancelled),
    durationMs: s.durationMs,
    scannedAt: f.iso(s.scannedAt),
    notInThisScan: part.info.unscanned || null,
    snapshot: snap ? snap.id : null,
  };
}

const groupFigures = (g) => ({ category: g.category, label: g.label, verdict: g.verdict, bytes: g.bytes, files: g.count, truncated: Boolean(g.truncated) });

async function run(args, ctx) {
  const { prepared, parts, snapshots, joined } = await scanFolders(args, ctx, { mft: Boolean(args.flags.mft), snapshot: Boolean(args.flags.snapshot) });

  const document = {
    schema: 'cleandrive.scan/1',
    generatedAt: f.iso(ctx.now()),
    roots: parts.map((p) => rootFigures(p, snapshots)),
    refused: prepared.refused,
    merged: prepared.merged,
    totals: { files: joined.totalFiles, folders: joined.totalDirs, bytes: joined.totalSize, errors: joined.errorCount },
    cancelled: Boolean(joined.cancelled),
    topFolders: (joined.topFolders || []).map((t) => ({ path: t.path, bytes: t.size, files: t.fileCount, percent: Number(t.percent.toFixed(2)), loose: Boolean(t.isLoose) })),
    byType: (joined.byType || []).map((t) => ({ ext: t.none ? null : t.ext, bytes: t.size, files: t.count })),
    cleanup: {
      safeBytes: joined.cleanup.safeBytes,
      reviewBytes: joined.cleanup.reviewBytes,
      groups: joined.cleanup.groups.map(groupFigures),
    },
  };
  ctx.out.document(document);

  for (const r of document.roots) {
    ctx.out.line(`${r.root}  ${f.files(r.files)}, ${f.bytes(r.bytes)}, ${f.seconds(r.durationMs)} (${r.scanner === 'mft' ? 'read from the drive\'s catalogue' : 'walked'})${r.cancelled ? '  STOPPED EARLY' : ''}`);
    if (r.errors > 0) ctx.out.line(`  ${f.count(r.errors)} item(s) could not be read`);
    if (r.notInThisScan && r.notInThisScan.bytes > 0) ctx.out.line(`  about ${f.bytes(r.notInThisScan.bytes)} in use on ${r.volume} is not in this scan ("cleandrive system" says what it is)`);
  }
  ctx.out.line('');
  ctx.out.line('Largest folders');
  for (const t of document.topFolders.slice(0, 15)) ctx.out.line(`  ${f.pad(f.bytes(t.bytes), 9)} ${f.pad(`${t.percent.toFixed(1)}%`, 6)}  ${t.loose ? `${t.path} (files directly in it)` : t.path}`);
  ctx.out.line('');
  ctx.out.line(`Could be cleaned: ${f.bytes(document.cleanup.safeBytes)} safe, ${f.bytes(document.cleanup.reviewBytes)} to review ("cleandrive suggest" lists the files)`);
  for (const g of document.cleanup.groups) ctx.out.line(`  ${f.pad(f.bytes(g.bytes), 9)}  ${g.verdict.padEnd(6)}  ${g.label} (${f.files(g.files)})`);
  for (const s of snapshots) {
    ctx.out.line('');
    ctx.out.line(`Snapshot kept: ${s.id}${s.complete ? '' : ' (stopped early, so a comparison with it is a guess)'}`);
  }
  return joined.cancelled ? EXIT.STOPPED : EXIT.OK;
}

module.exports = { run, scanFolders, rootFigures, groupFigures };
