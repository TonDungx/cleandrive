'use strict';

/**
 * `cleandrive snapshots [<folder>]` -- every scan the app kept, by an id that
 * `diff` takes.
 *
 * The spec's `diff <snapshotA> <snapshotB>` had no way to learn either name,
 * so this lists them. An id is the folder's key in the store and the
 * snapshot's own file name: `3f0c9a1e2b4d5c6f:2026-10-01T09-12-33-120Z`. It
 * is read back only through the store's own index, never turned into a path,
 * so an id names a snapshot the store holds or nothing at all.
 */

const path = require('node:path');

const { rootHash } = require('../../snapshots/store');
const { defaultPair } = require('../../snapshots/diff');
const { EXIT, CliError } = require('../codes');
const f = require('../format');
const { pathKey } = require('../../lib/util');

const ID = /^([0-9a-f]{16}):([0-9TZ-]+)$/;

const idOf = (root, file) => `${rootHash(root)}:${file.replace(/\.json\.gz$/, '')}`;

/** The folder and file an id names, if the store holds it. */
async function resolve(store, id) {
  const m = ID.exec(String(id || ''));
  if (!m) throw new CliError(EXIT.USAGE, `"${id}" is not a snapshot id. "cleandrive snapshots" lists them.`);
  const root = (await store.roots()).find((r) => rootHash(r) === m[1]);
  const file = `${m[2]}.json.gz`;
  const listed = root ? (await store.list(root)).find((s) => s.file === file) : null;
  if (!listed) throw new CliError(EXIT.USAGE, `No snapshot ${id}. "cleandrive snapshots" lists them.`);
  return { root, file, entry: listed };
}

async function run(args, ctx) {
  const store = ctx.services().snapshots;
  const wanted = args.positional[0] ? ctx.resolve(args.positional[0]) : null;
  const roots = (await store.roots()).filter((r) => !wanted || pathKey(r) === pathKey(wanted));
  if (wanted && roots.length === 0) {
    throw new CliError(EXIT.USAGE, `No snapshots of ${wanted}. "cleandrive scan --snapshot ${wanted}" keeps one.`);
  }

  const folders = [];
  for (const root of roots.sort()) {
    const list = await store.list(root);
    const pair = defaultPair(list);
    folders.push({
      root,
      volume: path.parse(root).root,
      snapshots: list
        .map((s) => ({
          id: idOf(root, s.file),
          takenAt: s.takenAt,
          complete: s.complete,
          scanner: s.scanner || 'walk',
          totals: s.totals,
        }))
        .sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt)),
      // The two a comparison opens on in the window: the newest, and the one
      // nearest a week before it that can be compared with it.
      suggested: pair.ok ? { older: idOf(root, pair.older), newer: idOf(root, pair.newer), days: pair.days } : { reason: pair.reason },
    });
  }

  ctx.out.document({ schema: 'cleandrive.snapshots/1', generatedAt: f.iso(ctx.now()), folders });
  if (folders.length === 0) ctx.out.line('No snapshots yet. "cleandrive scan --snapshot <folder>" keeps one.');
  for (const folder of folders) {
    ctx.out.line(folder.root);
    for (const s of folder.snapshots) {
      ctx.out.line(`  ${s.id}  ${f.when(s.takenAt)}  ${f.pad(f.bytes(s.totals.bytes), 9)}  ${f.files(s.totals.files)}${s.complete ? '' : '  (stopped early)'}`);
    }
    if (folder.suggested.older) ctx.out.line(`  compare: cleandrive diff ${folder.suggested.older} ${folder.suggested.newer}`);
    ctx.out.line('');
  }
  return EXIT.OK;
}

module.exports = { run, idOf, resolve, ID };
