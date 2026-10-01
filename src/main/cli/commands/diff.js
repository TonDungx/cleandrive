'use strict';

/**
 * `cleandrive diff <snapshot> <snapshot>` -- what changed in a folder between
 * two scans of it (A5), by the ids `cleandrive snapshots` prints.
 *
 * The comparison is snapshots/diff.js, the one the Trends card draws. Two
 * scans that cannot be compared -- different folders, or read by different
 * rules -- are refused (2) with the reason, never compared anyway.
 */

const { diffSnapshots } = require('../../snapshots/diff');
const { EXIT, CliError } = require('../codes');
const f = require('../format');
const { resolve, idOf } = require('./snapshots');

const NOT_COMPARABLE = Object.freeze({
  differentRoot: 'they are scans of different folders',
  differentScanner: 'one was walked and the other read from the drive\'s catalogue, and the two count some things differently',
  differentRules: 'they were read by different rules (an older version of the app), so a difference could be the rules rather than the disk',
});

async function run(args, ctx) {
  if (!ctx.can('pro.diff')) throw new CliError(EXIT.LICENCE, ctx.licenceSentence('pro.diff', 'Comparing two scans'), { feature: 'pro.diff' });
  const store = ctx.services().snapshots;
  const [a, b] = await Promise.all(args.positional.map((id) => resolve(store, id)));
  if (a.root !== b.root) throw new CliError(EXIT.REFUSED, `These cannot be compared: ${NOT_COMPARABLE.differentRoot}.`);
  if (a.file === b.file) throw new CliError(EXIT.USAGE, 'That is the same snapshot twice.');

  const [first, second] = await Promise.all([store.load(a.root, a.file), store.load(b.root, b.file)]);
  const result = diffSnapshots(first, second, { files: [a.file, b.file] });
  if (!result.ok) throw new CliError(EXIT.REFUSED, `These cannot be compared: ${NOT_COMPARABLE[result.reason] || result.reason}.`, { reason: result.reason });

  const ids = { from: idOf(result.root, result.from.file || a.file), to: idOf(result.root, result.to.file || b.file) };
  ctx.out.document({ schema: 'cleandrive.diff/1', generatedAt: f.iso(ctx.now()), ids, ...result });

  const sign = (n) => `${n >= 0 ? '+' : '-'}${f.bytes(Math.abs(n))}`;
  ctx.out.line(`${result.root}: ${sign(result.total.change)} in ${result.days.toFixed(1)} days (${f.bytes(result.total.before)} -> ${f.bytes(result.total.after)})`);
  if (result.confidence === 'guess') ctx.out.line('  one of the two scans was stopped early, so this is a guess');
  const placeLines = (title, side) => {
    if (!side || side.places.length === 0) return;
    ctx.out.line('');
    ctx.out.line(title);
    for (const p of side.places) ctx.out.line(`  ${f.pad(sign(p.change), 10)}  ${p.path}`);
    if (side.more.count > 0) ctx.out.line(`  and ${f.count(side.more.count)} smaller change(s), ${sign(side.more.bytes)} together`);
  };
  placeLines('Grew', result.grew);
  placeLines('Shrank', result.shrank);
  if (result.files) {
    const fileLines = (title, side, size) => {
      if (!side || side.items.length === 0) return;
      ctx.out.line('');
      ctx.out.line(`${title} (${f.count(side.total)})`);
      for (const file of side.items.slice(0, 15)) ctx.out.line(`  ${f.pad(size(file), 10)}  ${file.path || `${file.from} -> ${file.to}`}`);
    };
    fileLines('Large files that appeared', result.files.appeared, (x) => f.bytes(x.size));
    fileLines('Large files that grew', result.files.grew, (x) => sign(x.change));
    fileLines('Large files that went', result.files.vanished, (x) => f.bytes(x.size));
    fileLines('Large files that moved', result.files.moved, (x) => f.bytes(x.size));
  }
  return EXIT.OK;
}

module.exports = { run };
