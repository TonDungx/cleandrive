#!/usr/bin/env node
'use strict';

// The map of the folder on Disk usage: where its tiles go, and what the main
// process lets the window have of the scan's tree.
//
//   node scripts/test-treemap.js
//
// Two halves. The layout is pure arithmetic and is checked on random input:
// the tiles cover the rectangle, never overlap, and each has the area its
// bytes are owed. The tree half scans a folder this harness builds -- with the
// real scanner, so the rows are the ones a snapshot would keep -- and then
// asks the questions the window would, including the ones a window should not
// be able to get an answer to.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const Layout = require('../src/renderer/treemap-layout');
const { scan } = require('../src/main/lib/scanner');
const { ScanTree, LIMITS } = require('../src/main/analyzers/scan-tree');
const { validateCandidate } = require('../src/main/analyzers/contract');
const { SnapshotStore } = require('../src/main/snapshots/store');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const MB = 1024 * 1024;

async function make(file, bytes) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const handle = await fsp.open(file, 'w');
  await handle.truncate(bytes);
  await handle.close();
}

/** A small deterministic generator, so a failure can be run again as it was. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Every node a level reply carries, with how far below the asked folder it is. */
function flatten(level) {
  const out = [];
  const walk = (folder, depth) => {
    for (const item of folder.children || []) {
      out.push({ item, depth });
      if (item.kind === 'folder') walk(item, depth + 1);
    }
  };
  walk(level, 1);
  return out;
}

function layoutChecks() {
  console.log('\nLayout -- squarified:');

  const random = rng(20260924);
  let covered = true;
  let proportional = true;
  let disjoint = true;
  let inside = true;
  let worstSeen = 0;
  for (let trial = 0; trial < 300; trial++) {
    const n = 1 + Math.floor(random() * 60);
    // Sizes spread over six orders of magnitude, like a real folder.
    const items = Array.from({ length: n }, (_, i) => ({ value: Math.floor(10 ** (random() * 6)) + 1, i }))
      .sort((a, b) => b.value - a.value);
    const rect = { x: random() * 50, y: random() * 50, w: 50 + random() * 900, h: 50 + random() * 600 };
    const tiles = Layout.squarify(items, rect);
    const total = items.reduce((s, it) => s + it.value, 0);
    const area = rect.w * rect.h;

    const sum = tiles.reduce((s, tile) => s + tile.w * tile.h, 0);
    if (Math.abs(sum - area) > area * 1e-9 || tiles.length !== n) covered = false;
    for (const tile of tiles) {
      const owed = (tile.item.value / total) * area;
      if (Math.abs(tile.w * tile.h - owed) > area * 1e-9) proportional = false;
      if (tile.x < rect.x - 1e-6 || tile.y < rect.y - 1e-6 ||
          tile.x + tile.w > rect.x + rect.w + 1e-6 || tile.y + tile.h > rect.y + rect.h + 1e-6) inside = false;
    }
    for (let a = 0; a < tiles.length; a++) {
      for (let b = a + 1; b < tiles.length; b++) {
        if (overlap(tiles[a], tiles[b]) > area * 1e-9) disjoint = false;
      }
    }
    worstSeen = Math.max(worstSeen, ...tiles.map((tile) => Math.max(tile.w / tile.h, tile.h / tile.w)));
  }
  check('300 random folders: the tiles cover the rectangle exactly, one per item', covered);
  check('each tile has exactly the area its bytes are owed', proportional);
  check('no tile leaves the rectangle', inside);
  check('no two tiles overlap', disjoint);
  // Large on purpose: a millionth-size item in a big rectangle can only be a
  // sliver. The map folds those away (groupSmall, below) rather than draw them.
  console.log(`    (worst aspect ratio over all of them: ${worstSeen.toFixed(1)}, from items a millionth the size of the largest)`);

  const equal = Array.from({ length: 36 }, () => ({ value: 1 }));
  const grid = Layout.squarify(equal, { x: 0, y: 0, w: 600, h: 600 });
  const worstGrid = Math.max(...grid.map((tile) => Math.max(tile.w / tile.h, tile.h / tile.w)));
  // Slice-and-dice would give 36:1 slivers here.
  check('36 equal items in a square come out square, not as slivers', worstGrid <= 1.5, worstGrid.toFixed(2));

  const odd = Layout.squarify(
    [{ value: 5 }, { value: 0 }, { value: -3 }, { value: Number.NaN }, { value: 1 }],
    { x: 0, y: 0, w: 100, h: 100 }
  );
  check('an item of no size, negative size or no number gets no tile', odd.length === 2);
  const one = Layout.squarify([{ value: 7 }], { x: 10, y: 20, w: 300, h: 40 });
  check('a single item fills the rectangle', one.length === 1 && one[0].x === 10 && one[0].y === 20 && one[0].w === 300 && one[0].h === 40);
  check('an empty rectangle gets no tiles', Layout.squarify([{ value: 1 }], { x: 0, y: 0, w: 0, h: 10 }).length === 0);

  console.log('\nLayout -- tiles too small to see:');
  const many = [{ value: 1000 }, { value: 500 }, ...Array.from({ length: 40 }, () => ({ value: 1 }))];
  const grouped = Layout.groupSmall(many, 100 * 100, 40, (folded) => ({ folded: folded.length }));
  const group = grouped[grouped.length - 1];
  check('the forty tiny ones are folded into one tile', grouped.length === 3 && group.folded === 40, `${grouped.length} tiles`);
  check('which keeps every byte', grouped.reduce((n, it) => n + it.value, 0) === 1540);
  const loneSmall = Layout.groupSmall([{ value: 1000 }, { value: 1 }], 100 * 100, 40, () => ({ folded: true }));
  check('one small item on its own keeps its own tile', loneSmall.length === 2 && !loneSmall[1].folded);
  const allBig = Layout.groupSmall([{ value: 3 }, { value: 2 }, { value: 1 }], 1e6, 40, () => ({ folded: true }));
  check('nothing is folded when every tile is big enough', allBig.length === 3);
}

async function treeChecks() {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-treemap-'));
  const root = path.join(base, 'home');
  try {
    await make(path.join(root, 'loose.bin'), 5);
    // Seven levels deep, with nothing of its own until the bottom: none of
    // Deep, Deep\a ... Deep\a\b\c\d\e has a row in the snapshot.
    await make(path.join(root, 'Deep', 'a', 'b', 'c', 'd', 'e', 'f', 'deep.bin'), 1024);
    // More folders than a level carries.
    for (let i = 0; i < 320; i++) {
      await make(path.join(root, 'Wide', `w${String(i).padStart(3, '0')}`, 'x.bin'), (i + 1) * 10);
    }
    // More big files than a folder names, and some small ones beside them.
    for (let i = 0; i < 12; i++) await make(path.join(root, 'Big', `big${i}.bin`), 10 * MB + i * 1000);
    for (let i = 0; i < 3; i++) await make(path.join(root, 'Big', `small${i}.txt`), 100 + i);
    // A file the advisor has an opinion about.
    await make(path.join(root, 'Temp', 'cache.tmp'), 11 * MB);
    await fsp.mkdir(path.join(root, 'Empty'), { recursive: true });
    await make(path.join(root, 'ZeroFiles', 'z.txt'), 0);

    const result = await scan(root, { collectTree: true });
    const tree = new ScanTree({
      root,
      rows: result.tree,
      files: result.treeFiles,
      complete: !result.cancelled,
      scannedAt: result.scannedAt,
      accessTimes: result.accessTimes,
    });

    console.log('\nWhat the snapshot keeps is unchanged:');
    check('named files in the snapshot rows are still [name, size, mtime]',
      result.tree.every((row) => row[3].every((file) => file.length === 3)));
    check('the verdicts are kept beside the rows, not in them', result.treeFiles instanceof Map && result.treeFiles.size === 11,
      `${result.treeFiles.size} named files`);
    {
      const store = new SnapshotStore(path.join(base, 'snapshots'));
      const { treeFiles, ...summary } = result;
      const entry = await store.save(summary);
      const back = await store.load(root, entry.file);
      check('and a saved snapshot holds no verdict', !('treeFiles' in back) && !JSON.stringify(back).includes('cleanup.temp'));
    }

    console.log('\nThe tree the main process keeps:');
    check('the root adds up to the scan, in bytes and in files',
      tree.nodes.get('').bytes === result.totalSize && tree.nodes.get('').files === result.totalFiles,
      `${tree.nodes.get('').bytes} of ${result.totalSize}, ${tree.nodes.get('').files} of ${result.totalFiles}`);
    const deepRel = path.join('Deep', 'a', 'b');
    check('a folder that holds only folders is in it, though the snapshot has no row for it',
      tree.nodes.has(deepRel) && !result.tree.some((row) => row[0] === deepRel) && tree.nodes.get(deepRel).bytes === 1024);
    check('an empty folder takes no tile', !(tree.level('').children || []).some((item) => item.name === 'Empty'));

    const top = tree.level('');
    const flat = flatten(top);
    const deepest = Math.max(...flat.map((n) => n.depth));
    console.log(`\nOne level, as the window gets it (${flat.length} nodes, ${JSON.stringify(top).length.toLocaleString('en-US')} bytes):`);
    check(`never more than ${LIMITS.depth} levels below the folder asked for`, deepest <= LIMITS.depth, `deepest ${deepest}`);
    check('so the seven-deep file is not in it',
      !flat.some((n) => n.item.kind === 'folder' && n.item.rel.endsWith(path.join('e', 'f'))));
    check(`never more than ${LIMITS.maxNodes} nodes`, flat.length <= LIMITS.maxNodes);
    check('the folder asked for carries its own total', top.bytes === result.totalSize && top.kind === 'folder' && top.rel === '');

    const wide = top.children.find((item) => item.name === 'Wide');
    const others = wide && (wide.children || []).find((item) => item.kind === 'others');
    const expectOthers = Array.from({ length: 20 }, (_, i) => (i + 1) * 10).reduce((a, b) => a + b, 0);
    check(`a folder with 320 folders in it sends ${LIMITS.maxChildren} and one tile for the rest`,
      wide && wide.children.filter((item) => item.kind === 'folder').length === LIMITS.maxChildren && others && others.count === 20,
      others ? `${others.count} folders in "others"` : 'none');
    check('and that tile holds exactly the twenty smallest', others && others.bytes === expectOthers && others.files === 20,
      others ? String(others.bytes) : '');

    const big = top.children.find((item) => item.name === 'Big');
    const named = (big.children || []).filter((item) => item.kind === 'file');
    const rest = (big.children || []).find((item) => item.kind === 'rest');
    check('a folder of twelve big files names ten of them', named.length === 10);
    check('and counts the other five files as one tile, bytes included',
      rest && rest.files === 5 && rest.bytes === 10 * MB + 10 * MB + 1000 + 100 + 101 + 102,
      rest ? `${rest.files} files, ${rest.bytes} bytes` : 'none');
    check('the tiles of a folder add up to the folder',
      big.children.reduce((n, item) => n + item.bytes, 0) === big.bytes);

    const rootRest = top.children.find((item) => item.kind === 'rest');
    check('files loose in the folder itself are a tile of their own', rootRest && rootRest.files === 1 && rootRest.bytes === 5);

    const every = flat.filter((n) => n.item.kind === 'file').map((n) => n.item.candidate);
    let valid = every.length > 0;
    for (const candidate of every) {
      try {
        validateCandidate(candidate);
      } catch {
        valid = false;
      }
    }
    check('every file tile is a candidate that passes the contract', valid, `${every.length} candidates`);
    const temp = flat.find((n) => n.item.kind === 'file' && n.item.name === 'cache.tmp');
    check('with the verdict the advisor gave it -- a file in a Temp folder is safe, on strong evidence',
      temp && temp.item.candidate.verdict === 'safe' && temp.item.candidate.confidence === 'strong' &&
        temp.item.candidate.category === 'cleanup.temp' && temp.item.candidate.evidence.length >= 1,
      temp ? `${temp.item.candidate.verdict} · ${temp.item.candidate.confidence}` : 'missing');
    const plain = named[0].candidate;
    check('and a file no rule matched says so, as a keep', plain.verdict === 'keep' && plain.category === 'usage.file');

    const small = tree.level('', { maxNodes: 40 });
    const smallFlat = flatten(small);
    const smallWide = small.children.find((item) => item.name === 'Wide');
    const smallBig = small.children.find((item) => item.name === 'Big');
    check('a smaller budget stops where it runs out, deepest first',
      smallFlat.length <= small.children.length + 40 && smallWide.children === undefined && Array.isArray(smallBig.children),
      `${smallFlat.length} nodes; Wide ${smallWide.children ? 'expanded' : 'left for later'}`);

    const crumbs = tree.level(deepRel).crumbs.map((c) => c.name);
    check('a level names the path back up to the scanned folder', JSON.stringify(crumbs) === JSON.stringify(['home', 'Deep', 'a', 'b']),
      crumbs.join(' > '));

    console.log('\nWhat the window cannot ask for:');
    check('a folder the scan never saw', tree.level('Nowhere') === null);
    check('a way out of the scanned folder', tree.level('..') === null && tree.level(path.join('Wide', '..', '..')) === null);
    check('an absolute path, even to a folder that is in the scan', tree.level(path.join(root, 'Big')) === null);
    check('the name of an object property', tree.level('__proto__') === null && tree.level('constructor') === null);
    check('something that is not a string', tree.level(42) === null && tree.level(null) === null && tree.level({}) === null);

    console.log('\nWhen files leave their folder:');
    const biggest = named[0];
    const before = { big: tree.nodes.get('Big').bytes, root: tree.nodes.get('').bytes, files: tree.nodes.get('').files };
    const taken = tree.remove([{ path: biggest.candidate.path, size: biggest.bytes }]);
    const afterBig = tree.level('Big');
    check('a named file that moved is no longer a tile', taken === 1 && !afterBig.children.some((item) => item.name === biggest.name));
    check('and its folder and every folder above it are smaller by exactly its size',
      tree.nodes.get('Big').bytes === before.big - biggest.bytes && tree.nodes.get('').bytes === before.root - biggest.bytes &&
        tree.nodes.get('').files === before.files - 1);
    check('the level says how much has moved since the scan',
      afterBig.removed.files === 1 && afterBig.removed.bytes === biggest.bytes);
    check('the same file reported twice is taken out once',
      tree.remove([{ path: biggest.candidate.path, size: biggest.bytes }]) === 0 && tree.nodes.get('Big').bytes === before.big - biggest.bytes);
    check('a file outside the scanned folder changes nothing',
      tree.remove([{ path: path.join(base, 'elsewhere.bin'), size: 999 }, { path: path.join(root + '-sibling', 'x'), size: 9 }]) === 0);
    const smallFile = path.join(root, 'Big', 'small0.txt');
    const restBefore = afterBig.children.find((item) => item.kind === 'rest');
    tree.remove([{ path: smallFile, size: 100 }]);
    const restAfter = tree.level('Big').children.find((item) => item.kind === 'rest');
    check('an unnamed file comes out of its folder\'s "smaller files" tile',
      restAfter.files === restBefore.files - 1 && restAfter.bytes === restBefore.bytes - 100);
    tree.remove([{ path: path.join(root, 'loose.bin'), size: 10 ** 9 }]);
    check('a size bigger than the folder ever held cannot take it below zero',
      tree.nodes.get('').ownBytes === 0 && tree.nodes.get('').bytes >= 0);
    check('a folder whose files have all gone takes no tile',
      !tree.level('').children.some((item) => item.kind === 'rest'));
  } finally {
    await fsp.rm(base, { recursive: true, force: true });
  }
}

(async () => {
  layoutChecks();
  await treeChecks();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
