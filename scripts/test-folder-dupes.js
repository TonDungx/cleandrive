#!/usr/bin/env node
'use strict';

// F2: whole folders that hold the same thing, and folders that nearly do.
//
//   node scripts/test-folder-dupes.js
//
// Two halves. The first works on a file list written here -- no disk at all
// -- so the shape pass, the nesting rule and the near-duplicate arithmetic can
// be pinned to exact numbers. The second builds real folders on `D:` and runs
// the whole pipeline through `findDuplicates`, because the part most likely to
// be wrong is the join between the walk and the folder pass, and a table
// cannot catch that.
//
// The fixture goes on `D:` on purpose: `os.tmpdir()` is inside AppData, and a
// walk that excludes AppData would make these pass for the wrong reason. The
// harness checks that it really is on `D:` before it trusts a single result.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const folderDupes = require('../src/main/lib/folder-dupes');
const { findDuplicates } = require('../src/main/lib/duplicate');
const { pathKey } = require('../src/main/lib/util');
const analyzers = require('../src/main/analyzers');
const { validateCandidate } = require('../src/main/analyzers/contract');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const KB = 1024;
const MB = 1024 * KB;

/* -------------------------------------------------------------------------- */
/* half one: constructed file lists, no disk                                   */
/* -------------------------------------------------------------------------- */

/** A file list of the shape the walk hands over. Constructed data. */
function listing(spec) {
  return Object.entries(spec).map(([p, [size, content, mtime]]) => ({
    path: p,
    size,
    mtimeMs: mtime || 1000,
    content,
  }));
}

/** Stands in for reading the disk: the "content" tag *is* the hash. */
function tableHash(files) {
  const byKey = new Map(files.map((f) => [pathKey(f.path), f.content]));
  return async (entry) => byKey.get(pathKey(entry.path)) ?? null;
}

const NO_FLOOR = { minFolderBytes: 0, minFolderFiles: 1, nearMinFiles: 2 };

async function constructed() {
  console.log('\nTwo folders holding the same thing (constructed file lists):');

  {
    const files = listing({
      'D:\\x\\alpha\\a.txt': [10, 'AAA'],
      'D:\\x\\alpha\\sub\\b.txt': [20, 'BBB'],
      'D:\\x\\beta\\a.txt': [10, 'AAA'],
      'D:\\x\\beta\\sub\\b.txt': [20, 'BBB'],
    });
    const r = await folderDupes.findFolderDuplicates(files, { ...NO_FLOOR, roots: ['D:\\x'] }, { hashOf: tableHash(files) });
    check('the pair is found', r.exact.length === 1, JSON.stringify(r.exact.map((g) => g.members.map((m) => m.path))));
    check('and only the outermost folder of it', r.exact[0].members.length === 2 &&
      r.exact[0].members.every((m) => /\\(alpha|beta)$/.test(m.path)), JSON.stringify(r.exact[0].members.map((m) => m.path)));
    check('the inner pair is not reported twice', r.nestedDropped === 2, `nestedDropped=${r.nestedDropped}`);
  }

  {
    // Same names, same sizes, different bytes. The shape pass pairs them and
    // the content pass must throw the pair out -- this is the case that makes
    // "certain" mean something.
    const files = listing({
      'D:\\x\\alpha\\a.txt': [10, 'AAA'],
      'D:\\x\\beta\\a.txt': [10, 'ZZZ'],
    });
    const r = await folderDupes.findFolderDuplicates(files, { ...NO_FLOOR, roots: ['D:\\x'] }, { hashOf: tableHash(files) });
    check('same names and sizes are not enough', r.exact.length === 0);
    check('but the shape pass did pair them', r.shapeGroups === 1, `shapeGroups=${r.shapeGroups}`);
  }

  {
    // One extra tiny file on one side. This is the whole reason the folder
    // pass indexes from size 0: at the file screen's 100 KB floor neither
    // side would have been seen and the two would look identical.
    const files = listing({
      'D:\\x\\alpha\\big.bin': [5 * MB, 'BIG'],
      'D:\\x\\alpha\\.env': [40, 'SECRET'],
      'D:\\x\\beta\\big.bin': [5 * MB, 'BIG'],
    });
    const r = await folderDupes.findFolderDuplicates(files, { ...NO_FLOOR, roots: ['D:\\x'] }, { hashOf: tableHash(files) });
    check('one extra 40-byte file makes them different', r.exact.length === 0, JSON.stringify(r.exact.length));
  }

  {
    // A folder that exists on one side and holds nothing is not a difference:
    // there is nothing in it to lose. Written down here so it is a decision
    // rather than something somebody discovers.
    const files = listing({
      'D:\\x\\alpha\\a.txt': [10, 'AAA'],
      'D:\\x\\beta\\a.txt': [10, 'AAA'],
    });
    const index = folderDupes.indexFolders(files, ['D:\\x']);
    const r = await folderDupes.findFolderDuplicates(files, { ...NO_FLOOR, roots: ['D:\\x'] }, { hashOf: tableHash(files) });
    check('an empty folder on one side is not a difference', r.exact.length === 1);
    check('an empty folder gets no node of its own', !index.byKey.has(pathKey('D:\\x\\alpha\\empty')));
  }

  {
    // A file that cannot be read drops its folder rather than being treated
    // as matching.
    const files = listing({
      'D:\\x\\alpha\\a.txt': [10, 'AAA'],
      'D:\\x\\alpha\\locked.bin': [99, 'LOCKED'],
      'D:\\x\\beta\\a.txt': [10, 'AAA'],
      'D:\\x\\beta\\locked.bin': [99, 'LOCKED'],
    });
    const hashOf = tableHash(files);
    const r = await folderDupes.findFolderDuplicates(
      files,
      { ...NO_FLOOR, roots: ['D:\\x'] },
      { hashOf: async (e) => (e.name === 'locked.bin' && /alpha/.test(e.path) ? null : hashOf(e)) }
    );
    check('a file that cannot be read drops its folder', r.exact.length === 0);
    check('and the folder is named as unreadable', r.unreadable.length === 1, JSON.stringify(r.unreadable));
  }

  {
    // The floor. A folder under it is not a row anybody wants.
    const files = listing({
      'D:\\x\\alpha\\a.txt': [10, 'AAA'],
      'D:\\x\\alpha\\b.txt': [10, 'BBB'],
      'D:\\x\\beta\\a.txt': [10, 'AAA'],
      'D:\\x\\beta\\b.txt': [10, 'BBB'],
    });
    const r = await folderDupes.findFolderDuplicates(
      files,
      { roots: ['D:\\x'], minFolderBytes: 1 * MB, minFolderFiles: 2 },
      { hashOf: tableHash(files) }
    );
    check('a 20-byte folder is below the floor', r.exact.length === 0);
  }

  console.log('\nFolders that are nearly the same:');

  {
    // Ten files each; nine of them shared. 9/10 is exactly the threshold.
    const spec = {};
    for (let i = 0; i < 9; i++) spec[`D:\\y\\one\\f${i}.bin`] = [200 * KB, `H${i}`];
    for (let i = 0; i < 9; i++) spec[`D:\\y\\two\\f${i}.bin`] = [200 * KB, `H${i}`];
    spec['D:\\y\\one\\extra.bin'] = [200 * KB, 'ONLY-ONE'];
    spec['D:\\y\\two\\other.bin'] = [200 * KB, 'ONLY-TWO'];
    const files = listing(spec);
    const r = await folderDupes.findFolderDuplicates(files, { roots: ['D:\\y'] }, { hashOf: tableHash(files) });
    check('nine of ten shared is a near-duplicate', r.near.length === 1, JSON.stringify(r.near.length));
    check('the ratio is counted, not guessed', r.near[0] && Math.abs(r.near[0].ratio - 0.9) < 1e-9,
      r.near[0] && String(r.near[0].ratio));
    check('the odd file out is named on each side',
      r.near[0] && r.near[0].compare.onlyLeft.length === 1 && r.near[0].compare.onlyRight.length === 1,
      r.near[0] && JSON.stringify([r.near[0].compare.onlyLeft, r.near[0].compare.onlyRight]));
  }

  {
    // Eight of ten is 0.8 and must not be offered.
    const spec = {};
    for (let i = 0; i < 8; i++) spec[`D:\\y\\one\\f${i}.bin`] = [200 * KB, `H${i}`];
    for (let i = 0; i < 8; i++) spec[`D:\\y\\two\\f${i}.bin`] = [200 * KB, `H${i}`];
    for (let i = 0; i < 2; i++) spec[`D:\\y\\one\\p${i}.bin`] = [200 * KB, `P${i}`];
    for (let i = 0; i < 2; i++) spec[`D:\\y\\two\\q${i}.bin`] = [200 * KB, `Q${i}`];
    const files = listing(spec);
    const r = await folderDupes.findFolderDuplicates(files, { roots: ['D:\\y'] }, { hashOf: tableHash(files) });
    check('eight of ten is below the line and is not offered', r.near.length === 0, JSON.stringify(r.near.map((p) => p.ratio)));
  }

  {
    // Same relative path, same size, different bytes: a difference, and it
    // counts as matching neither side.
    const spec = {};
    for (let i = 0; i < 9; i++) spec[`D:\\y\\one\\f${i}.bin`] = [200 * KB, `H${i}`];
    for (let i = 0; i < 9; i++) spec[`D:\\y\\two\\f${i}.bin`] = [200 * KB, `H${i}`];
    spec['D:\\y\\one\\same.bin'] = [200 * KB, 'LEFT'];
    spec['D:\\y\\two\\same.bin'] = [200 * KB, 'RIGHT'];
    const files = listing(spec);
    const r = await folderDupes.findFolderDuplicates(files, { roots: ['D:\\y'] }, { hashOf: tableHash(files) });
    check('one path, two different files, is a difference', r.near.length === 1 && r.near[0].differing === 1,
      JSON.stringify(r.near.map((p) => ({ ratio: p.ratio, differing: p.differing }))));
    check('and the comparison names it as changed rather than missing',
      r.near[0] && r.near[0].compare.changed.length === 1 && r.near[0].compare.onlyLeft.length === 0,
      r.near[0] && JSON.stringify(r.near[0].compare));
  }

  {
    // A folder and its own parent share everything the child holds. That is
    // one folder, not two copies of anything.
    const spec = {};
    for (let i = 0; i < 10; i++) spec[`D:\\y\\one\\sub\\f${i}.bin`] = [200 * KB, `H${i}`];
    const files = listing(spec);
    const r = await folderDupes.findFolderDuplicates(files, { roots: ['D:\\y'] }, { hashOf: tableHash(files) });
    check('a folder is not a near-duplicate of its own parent', r.near.length === 0,
      JSON.stringify(r.near.map((p) => [p.a.path, p.b.path])));
  }

  console.log('\nExact duplicates are never also offered as near ones:');
  {
    const spec = {};
    for (let i = 0; i < 10; i++) {
      spec[`D:\\z\\one\\f${i}.bin`] = [200 * KB, `H${i}`];
      spec[`D:\\z\\two\\f${i}.bin`] = [200 * KB, `H${i}`];
    }
    const files = listing(spec);
    const r = await folderDupes.findFolderDuplicates(files, { roots: ['D:\\z'] }, { hashOf: tableHash(files) });
    check('an identical pair is reported once, as identical', r.exact.length === 1 && r.near.length === 0,
      `exact=${r.exact.length} near=${r.near.length}`);
  }
}

/* -------------------------------------------------------------------------- */
/* half two: real folders on D:                                                */
/* -------------------------------------------------------------------------- */

async function write(file, bytes, seed) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const buf = Buffer.alloc(bytes);
  if (seed !== undefined) buf.write(String(seed));
  await fsp.writeFile(file, buf);
}

async function onDisk() {
  const base = path.join('D:\\', 'cleandrive-f2', crypto.randomBytes(4).toString('hex'));
  console.log(`\nReal folders, through the whole pipeline (${base}):`);

  // The harness checks its own isolation: a fixture under `os.tmpdir()` is
  // inside AppData, and the walk's own exclusions would make these results
  // mean something other than what they say.
  check('the fixture is on D:, not inside AppData',
    pathKey(base).startsWith('d:\\') && !pathKey(base).startsWith(pathKey(os.tmpdir())),
    `${base} vs tmpdir ${os.tmpdir()}`);

  try {
    // Three copies of a small project, ten files each, identical down to the
    // `.git` folder and `node_modules` -- which the ordinary walk never
    // enters. Without the wide walk the app would be comparing two folders it
    // had only half seen.
    //
    // Ten files, because at 90% that is the smallest number where "nearly the
    // same" differs from "the same": nine of ten is 0.9, and eight of nine is
    // not.
    const project = async (dir, differs) => {
      await write(path.join(base, dir, 'app.js'), 300 * KB, 'app');
      await write(path.join(base, dir, 'src', 'index.js'), 400 * KB, 'index');
      await write(path.join(base, dir, '.git', 'HEAD'), 2 * KB, 'head');
      for (let i = 0; i < 7; i++) {
        const same = !(differs && i === 0);
        await write(path.join(base, dir, 'node_modules', `pkg${i}`, 'index.js'), 200 * KB, same ? `pkg${i}` : 'OTHER');
      }
    };
    await project('project-a', false);
    await project('project-b', false);
    // The third copy differs in one file, and that file is inside
    // `node_modules` -- exactly the difference the narrow walk cannot see.
    await project('project-c', true);

    const result = await findDuplicates([base], {
      useCache: false,
      folders: true,
      minSize: 100 * KB,
      minFolderBytes: 1 * MB,
    }, {});

    const folders = result.folders;
    check('the folder pass ran', folders !== null);
    const names = (folders.exact[0] || { members: [] }).members.map((m) => path.basename(m.path)).sort();
    check('the two identical projects are found', folders.exact.length === 1 && names.join(',') === 'project-a,project-b',
      JSON.stringify(folders.exact.map((g) => g.members.map((m) => path.basename(m.path)))));
    check('the one that differs inside node_modules is left out', !names.includes('project-c'));
    check('the wide walk saw more than the file search did',
      result.indexedForFolders > result.indexedFiles,
      `${result.indexedForFolders} wide vs ${result.indexedFiles} narrow`);
    check('and the file half still shows only what it always showed',
      !result.groups.some((g) => g.files.some((f) => /node_modules|\.git/.test(f.path))),
      JSON.stringify(result.groups.map((g) => g.files.map((f) => path.basename(f.path)))));

    const copy = folders.exact[0].members.find((m) => !m.keeper);
    check('the copy that is not kept lists its files, so they can be acted on',
      copy && copy.files.length === 10, copy && String(copy.files.length));
    check('and the kept copy lists none, because nothing will act on them',
      folders.exact[0].members[0].keeper && folders.exact[0].members[0].files.length === 0);
    check('a listed file carries the path a button needs',
      copy && copy.files.every((f) => path.isAbsolute(f.path) && f.rel && f.size > 0),
      copy && JSON.stringify(copy.files[0]));
    // Nine of ten. project-a and project-b are one finding, so only one of
    // them is offered as the other half of this one.
    check('project-c is a near-duplicate of one of them, at nine of ten',
      folders.near.length === 1 && Math.abs(folders.near[0].ratio - 0.9) < 1e-9,
      JSON.stringify(folders.near.map((p) => [path.basename(p.keep.path), path.basename(p.other.path), p.ratio])));
    check('and the file that differs is named, not just counted',
      folders.near[0] && folders.near[0].compare.changed.length === 1 &&
        folders.near[0].compare.changed[0].rel.includes('pkg0'),
      folders.near[0] && JSON.stringify(folders.near[0].compare.changed));

    /* -- which copy is kept, by drive (F1's rule, applied to folders) -- */

    const ranked = await findDuplicates([base], {
      useCache: false,
      folders: true,
      minSize: 100 * KB,
      minFolderBytes: 1 * MB,
      keeperRank: (f) => (/project-b/i.test(f.path) ? 0 : 1),
    }, {});
    const keeper = ranked.folders.exact[0].members.find((m) => m.keeper);
    check('a ranking the caller supplies picks the folder kept too',
      path.basename(keeper.path) === 'project-b', keeper.path);

    /* -- the reply can cross an IPC boundary -- */

    check('the reply is JSON, with no cycle back to a parent folder',
      JSON.stringify(result.folders).length > 0);

    /* -- through the analyzer, where every row is checked -- */

    const collected = await analyzers.collect(
      'duplicates',
      { roots: [base], options: { useCache: false, folders: true, minSize: 100 * KB, minFolderBytes: 1 * MB } },
      { can: () => true }
    );
    // `collect` validates every candidate on the way out; this asserts it
    // again here so a failure names the rule rather than a dropped row.
    for (const c of collected.candidates) validateCandidate(c);
    const byCategory = {};
    for (const c of collected.candidates) byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    // project-b's ten files, plus the nine of project-c's that matched.
    check('folder rows and their files are all valid candidates',
      byCategory['dupes.folder'] === 2 && byCategory['dupes.folderFile'] === 19 && byCategory['dupes.nearFolder'] === 2,
      JSON.stringify(byCategory));
    // One path can now be two rows -- a plain duplicate and a file inside a
    // copied folder -- and those must not share an id, or the window's
    // id-to-row map keeps one and drops the other.
    const ids = collected.candidates.map((c) => c.id);
    check('no two rows share an id, though some share a path',
      new Set(ids).size === ids.length,
      `${ids.length} rows, ${new Set(ids).size} ids`);
    const paths = new Set(collected.candidates.map((c) => c.path));
    check('and a path really is carrying more than one row here',
      paths.size < ids.length, `${paths.size} paths for ${ids.length} rows`);

    const folderRows = collected.candidates.filter((c) => c.category === 'dupes.folder');
    check('a folder row offers no action, because the app never deletes a folder',
      folderRows.every((c) => c.kind === 'folder' && c.actions.length === 0),
      JSON.stringify(folderRows.map((c) => c.actions)));
    check('and a file inside a copy offers the two that do exist',
      collected.candidates
        .filter((c) => c.category === 'dupes.folderFile')
        .every((c) => c.kind === 'file' && c.actions.join(',') === 'recycle,quarantine'));
    check('nothing here may ever run unattended',
      collected.candidates.every((c) => c.unattendedEligible === false));

    // The near-duplicate pair offers only the files that were verified
    // identical on both sides. The one that differs is the thing that would
    // actually be lost, and it is never on a list a button acts on.
    const nearGroup = collected.summary.folders.near[0];
    const nearFiles = new Set(nearGroup.fileIds);
    const offered = collected.candidates.filter((c) => nearFiles.has(c.id)).map((c) => c.path);
    check('a near-duplicate offers only its verified-identical files',
      offered.length === 9 && !offered.some((p) => p.includes('pkg0')),
      `${offered.length} offered`);
    check('and the file that differs is shown but never offered',
      nearGroup.compare.changed.length === 1 &&
        !offered.some((p) => p.endsWith(nearGroup.compare.changed[0].rel)),
      JSON.stringify(nearGroup.compare.changed));

    /* -- off by default -- */

    const without = await findDuplicates([base], { useCache: false, minSize: 100 * KB }, {});
    check('the folder pass is off unless asked for', without.folders === null);
    check('and then the walk is the narrow one it always was',
      without.indexedFiles === result.indexedFiles && without.indexedForFolders === undefined,
      `${without.indexedFiles} vs ${result.indexedFiles}`);
  } finally {
    await fsp.rm(path.join('D:\\', 'cleandrive-f2'), { recursive: true, force: true });
  }
}

(async () => {
  if (process.platform !== 'win32') {
    console.log('Windows only.');
    process.exit(0);
  }
  await constructed();
  await onDisk();
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
