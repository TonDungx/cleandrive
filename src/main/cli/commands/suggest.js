'use strict';

/**
 * `cleandrive suggest <folder...> [--category <c>] [--verdict safe|review]`
 * -- the files What to delete would offer, each with its evidence.
 *
 * Nothing is selected and nothing is acted on: this is the list a person (or a
 * script that will show it to one) reads before deciding. The only command
 * that deletes is `run --profile`, through a profile's own rules.
 *
 * The advisor keeps the largest hundred files of each category, as the window
 * does; a category with more says `truncated`, and its byte count is the
 * whole category's, not the hundred's.
 */

const { EXIT } = require('../codes');
const f = require('../format');
const { scanFolders, rootFigures, groupFigures } = require('./scan');

async function run(args, ctx) {
  const { parts, snapshots, joined } = await scanFolders(args, ctx);
  // The advisor's names, as a profile's categories use them: `temp`, `log`,
  // `app.chrome`. `cleanup.temp` -- the candidate's own name -- is taken too.
  const category = args.values.category ? args.values.category.replace(/^cleanup\./, '') : null;
  const verdict = args.values.verdict || null;

  const groups = joined.cleanup.groups.filter((g) => (!category || g.category === category) && (!verdict || g.verdict === verdict));
  // Each group names its own rows, which is the only join that holds for app
  // caches and advisor categories alike.
  const wanted = new Set(groups.flatMap((g) => g.ids || []));
  const known = joined.cleanup.groups.map((g) => g.category);
  if (category && !known.includes(category)) {
    ctx.out.note(`nothing in category ${category} here. Found: ${known.join(', ') || 'none'}`);
  }

  const candidates = joined.candidates
    .filter((c) => wanted.has(c.id) && c.verdict !== 'keep' && (!verdict || c.verdict === verdict))
    .sort((a, b) => b.bytes - a.bytes)
    .map((c) => ({
      id: c.id,
      path: c.path,
      bytes: c.bytes,
      category: c.category,
      verdict: c.verdict,
      confidence: c.confidence,
      // What the window could do with it; empty on a drive the app only reads.
      actions: c.actions || [],
      evidence: (c.evidence || []).map((e) => f.text(e)),
    }));

  ctx.out.document({
    schema: 'cleandrive.suggest/1',
    generatedAt: f.iso(ctx.now()),
    roots: parts.map((p) => rootFigures(p, snapshots)),
    filters: { category, verdict },
    groups: groups.map(groupFigures),
    candidates,
    totals: { files: candidates.length, bytes: candidates.reduce((n, c) => n + c.bytes, 0) },
  });

  if (candidates.length === 0) ctx.out.line('Nothing here matches the cleanup rules.');
  for (const g of groups) {
    const mine = new Set(g.ids || []);
    const rows = candidates.filter((c) => mine.has(c.id));
    if (rows.length === 0) continue;
    ctx.out.line(`${g.label} -- ${g.verdict}, ${f.files(g.count)}, ${f.bytes(g.bytes)}${g.truncated ? ` (largest ${rows.length} listed)` : ''}`);
    for (const c of rows) {
      ctx.out.line(`  ${f.pad(f.bytes(c.bytes), 9)}  ${c.path}`);
      if (c.evidence[0]) ctx.out.line(`             ${c.evidence[0]}`);
    }
    ctx.out.line('');
  }
  return EXIT.OK;
}

module.exports = { run };
