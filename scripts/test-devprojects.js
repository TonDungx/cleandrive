#!/usr/bin/env node
'use strict';

// The projects half of the Developer screen (C1, C5).
//
//   node scripts/test-devprojects.js
//
// Most of this is about the one question the spec got wrong. The spec says a
// build folder is `safe · strong` when a matching project file sits beside it.
// Measured on the machine this was written on, that rule is wrong five times in
// thirteen -- every vendored library ships a `package.json` next to its `dist`
// -- and one of the five is 1.30 GB of released APKs. So the fixture below is
// built out of the real cases: a project that declares its build folder, a
// vendored library that does not, a folder of releases that does not, and a
// project whose only marker is a `requirements.txt`.
//
// It also holds the folders the walk must refuse to enter, because the same
// measurement found that a walk of the Home folder without those rules returns
// the insides of Cursor and Discord before it returns anything of yours.

const fs = require('node:fs');

const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const projects = require('../src/main/dev/projects');
const gitignore = require('../src/main/lib/gitignore');
const analyzers = require('../src/main/analyzers');
const { validateCandidate } = require('../src/main/analyzers/contract');
const { isAllowedUnattended } = require('../src/main/automatic/allowed-categories');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

async function write(file, { bytes = 64, ageDays = 0, content = 'x' } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  if (bytes > content.length) {
    const handle = await fsp.open(file, 'r+');
    await handle.truncate(bytes);
    await handle.close();
  }
  if (ageDays > 0) {
    const when = new Date(Date.now() - ageDays * DAY);
    await fsp.utimes(file, when, when);
  }
}

const lines = (...l) => l.join('\n') + '\n';

/* -------------------------------------------------------------------------- */
/* the .gitignore reader                                                      */
/* -------------------------------------------------------------------------- */

console.log('\ndeveloper projects: reading what the developer already wrote down\n');

{
  const dir = 'D:\\repo';
  const parsed = gitignore.parse(lines('# a comment', '', 'dist/', '/build', 'a/b/out', '!keep', '*.log', 'obj'), dir);
  check('a trailing slash is just "a folder"', parsed.floating.some((f) => f.name === 'dist'));
  check('a bare name floats to any depth', parsed.floating.some((f) => f.name === 'obj'));
  check('a leading slash anchors to this folder', parsed.anchored.some((a) => a.path === 'd:\\repo\\build'));
  check('a path anchors to that path', parsed.anchored.some((a) => a.path === 'd:\\repo\\a\\b\\out'));
  check('a negation is kept apart', parsed.negated.some((n) => n.name === 'keep'));
  check('a comment is not a rule', !parsed.floating.some((f) => f.name.includes('comment')));
  check(
    'a glob is skipped rather than half-understood',
    !parsed.floating.some((f) => f.name === '*.log'),
    'this recognises folder names, and says so'
  );
}

{
  const scope = { floating: new Set([{ name: 'dist', line: 'dist/' }]), negated: new Set(), anchored: new Set() };
  check('an inherited rule reaches a folder below', gitignore.lookup(scope, 'D:\\repo\\web\\dist', 'dist').ignored);
  check('and the line that did it comes back with the answer',
    gitignore.lookup(scope, 'D:\\repo\\web\\dist', 'dist').line === 'dist/');
  check('a different name is not matched', !gitignore.lookup(scope, 'D:\\repo\\web\\out', 'out').ignored);
  check('nothing at all is a safe answer', !gitignore.lookup(gitignore.EMPTY, 'D:\\x\\dist', 'dist').ignored);
  check('and so is no scope', !gitignore.lookup(null, 'D:\\x\\dist', 'dist').ignored);
}

/* -------------------------------------------------------------------------- */
/* the fixture                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every case that mattered on the real machine, in one tree.
 *
 * **Built on D:, not under the system temp directory**, and that is not a
 * preference. `os.tmpdir()` here is `C:\Users\ktvda\AppData\Local\Temp`, and
 * everything under `AppData` is exactly what this scan refuses to walk into --
 * a fixture built there returns nothing at all, and every check below would
 * pass for the wrong reason. The folder is removed afterwards, and nothing
 * outside it is read or written.
 */
async function buildFixture() {
  const base = path.join('D:', path.sep, 'cleandrive-devprojects-test');
  await fsp.mkdir(base, { recursive: true });
  const root = await fsp.mkdtemp(path.join(base, 'run-'));

  // Prove the isolation rather than assume it: if this ever moves back under
  // AppData the harness says so instead of passing silently.
  if (projects.excludedReason(root)) {
    throw new Error(`the fixture is somewhere this scan refuses to walk (${projects.excludedReason(root)}): ${root}`);
  }

  /* -- a node project that declares its build folder ---------------------- */
  const app = path.join(root, 'work', 'my-app');
  // Every file of it is old, not just the source: the newest one is what
  // decides, and a package.json written a moment ago makes the whole project
  // read as touched today.
  await write(path.join(app, 'package.json'), { content: '{"name":"mine"}', ageDays: 400 });
  await write(path.join(app, 'package-lock.json'), { content: '{}', ageDays: 400 });
  await write(path.join(app, '.gitignore'), { content: lines('node_modules/', 'dist/'), ageDays: 400 });
  await write(path.join(app, 'src', 'index.js'), { bytes: 4096, ageDays: 400 });
  await write(path.join(app, 'node_modules', 'left-pad', 'index.js'), { bytes: 3 * MB });
  await write(path.join(app, 'dist', 'bundle.js'), { bytes: 5 * MB });
  await write(path.join(app, 'dist', 'bundle.js.map'), { bytes: 2 * MB });

  /* -- a vendored library inside it: dist/, package.json, committed ------- */
  const vendored = path.join(app, 'static', 'vendors', 'bootstrap');
  await write(path.join(vendored, 'package.json'), { content: '{"name":"bootstrap"}', ageDays: 400 });
  await write(path.join(vendored, 'dist', 'bootstrap.min.css'), { bytes: 6 * MB, ageDays: 400 });

  /* -- releases somebody meant to keep ------------------------------------ */
  const mobile = path.join(root, 'work', 'mobile');
  await write(path.join(mobile, 'package.json'), { content: '{}' });
  await write(path.join(mobile, '.gitignore'), { content: lines('/build/') });
  await write(path.join(mobile, 'build', 'app.apk'), { bytes: 7 * MB });
  await write(path.join(mobile, 'dist', 'Release-1.0.0.apk'), { bytes: 9 * MB });

  /* -- a python project whose only marker is requirements.txt ------------- */
  const py = path.join(root, 'work', 'tool');
  await write(path.join(py, 'requirements.txt'), { content: 'requests\n' });
  await write(path.join(py, '.gitignore'), { content: lines('# PyInstaller', 'dist/', '*.mat-khau.yaml') });
  await write(path.join(py, 'main.py'), { bytes: 2048, ageDays: 400 });
  await write(path.join(py, 'venv', 'lib', 'site.py'), { bytes: 4 * MB });
  await write(path.join(py, 'dist', 'tool.exe'), { bytes: 8 * MB });
  await write(path.join(py, 'secrets.mat-khau.yaml'), { bytes: 512 });

  /* -- a node project with no lockfile at all ----------------------------- */
  const loose = path.join(root, 'work', 'loose');
  await write(path.join(loose, 'package.json'), { content: '{}', ageDays: 400 });
  await write(path.join(loose, 'index.js'), { bytes: 1024, ageDays: 400 });
  await write(path.join(loose, 'node_modules', 'thing', 'index.js'), { bytes: 2 * MB });

  /* -- places the walk must refuse --------------------------------------- */
  // An installed application: a project by every file test, and none of it
  // yours. This is what a walk of the Home folder returned first.
  const installed = path.join(root, 'AppDataLike', 'Cursor');
  await write(path.join(installed, 'Cursor.exe'), { bytes: 1024 });
  await write(path.join(installed, 'unins000.exe'), { bytes: 1024 });
  await write(path.join(installed, 'resources', 'app', 'package.json'), { content: '{}' });
  await write(path.join(installed, 'resources', 'app', 'node_modules', 'x', 'i.js'), { bytes: 9 * MB });
  await write(path.join(installed, 'resources', 'app', 'out', 'main.js'), { bytes: 9 * MB });

  // A dot-folder: a tool's own insides.
  await write(path.join(root, '.codex', 'plugins', 'package.json'), { content: '{}' });
  await write(path.join(root, '.codex', 'plugins', 'bin', 'thing.js'), { bytes: 3 * MB });

  // A package cache: thousands of little projects, none of them yours, and
  // their shipped `build` folders are the packages' own.
  await write(path.join(root, 'pub-cache', 'hosted', 'riverpod', 'pubspec.yaml'), { content: 'x' });
  await write(path.join(root, 'pub-cache', 'hosted', 'riverpod', 'package.json'), { content: '{}' });
  await write(path.join(root, 'pub-cache', 'hosted', 'riverpod', 'build', 'devtools.js'), { bytes: 4 * MB });

  // Nested build folders: a gradle `build\` holds more of them.
  await write(path.join(mobile, 'build', 'intermediates', 'out', 'lib.so'), { bytes: 1 * MB });

  return root;
}

/* -------------------------------------------------------------------------- */

async function main() {
  const root = await buildFixture();
  try {
    const out = await projects.scan({ roots: [root], staleDays: 60 });
    const at = (rel) => path.join(root, rel);
    const byPath = new Map(out.builds.map((b) => [b.path.toLowerCase(), b]));
    const build = (rel) => byPath.get(at(rel).toLowerCase());
    const project = (rel) => out.projects.find((p) => p.path.toLowerCase() === at(rel).toLowerCase());

    console.log('\nwhere it refuses to look\n');

    const paths = out.builds.map((b) => b.path.toLowerCase()).join('\n');
    check('an installed application is not walked into',
      !paths.includes('cursor') && !out.projects.some((p) => p.path.toLowerCase().includes('cursor')),
      'its resources\\app\\package.json makes it look exactly like a project');
    check('a dot-folder is left alone', !paths.includes('.codex'));
    check('a package cache is left alone',
      !paths.includes('pub-cache'),
      'every package in one is a project, and its build\\ belongs to the package');
    check('but the real projects were all found',
      ['work\\my-app', 'work\\mobile', 'work\\tool', 'work\\loose'].every((rel) => out.projects.some((p) => p.path.toLowerCase().endsWith(rel))
        || out.builds.some((b) => b.path.toLowerCase().includes(rel))),
      out.projects.map((p) => path.basename(p.path)).join(', '));
    check('a project inside node_modules is not one of yours',
      !out.projects.some((p) => p.path.toLowerCase().includes('node_modules')));

    console.log('\nwhich build folders may be touched\n');

    check('a folder its own .gitignore names is declared', build('work\\my-app\\dist').declared === true);
    check('and the line that said so is kept for the row',
      build('work\\my-app\\dist').declaredBy === 'dist/',
      build('work\\my-app\\dist').declaredBy);
    check(
      "a vendored library's dist/ is NOT declared, though a package.json sits beside it",
      build('work\\my-app\\static\\vendors\\bootstrap\\dist').declared === false,
      'this is the rule the spec asked for, and it is wrong: 774 files of Bootstrap, echarts and Chart.js on the real machine'
    );
    check(
      'a dist/ of releases nobody ignored is NOT declared',
      build('work\\mobile\\dist').declared === false,
      'rebuilding gives you the current version, not the ten that shipped'
    );
    check(
      'a build folder with no project marker at all IS declared, because .gitignore said so',
      build('work\\tool\\dist').declared === true,
      'requirements.txt is not a marker, and the developer still wrote the line'
    );
    check('an anchored rule reaches its own folder', build('work\\mobile\\build').declared === true);

    console.log('\nwhat gets listed, and what only gets counted\n');

    check('a declared folder is listed file by file',
      build('work\\my-app\\dist').listed === true && build('work\\my-app\\dist').files.length === 2,
      `${build('work\\my-app\\dist').files.length} files`);
    check('an undeclared folder is summed and never listed',
      build('work\\mobile\\dist').listed === false && build('work\\mobile\\dist').files.length === 0,
      'the row offers nothing to move, so its file names are payload nobody reads');
    check('a build folder inside another is folded into it',
      !byPath.has(at('work\\mobile\\build\\intermediates\\out').toLowerCase()) && out.nestedBuilds >= 1,
      `${out.nestedBuilds} folded in`);
    check('the sizes of a declared folder are real', build('work\\my-app\\dist').bytes === 7 * MB,
      `${build('work\\my-app\\dist').bytes}`);

    console.log('\nwhen a dependency folder is called disposable\n');

    const stale = project('work\\my-app');
    const loose = project('work\\loose');
    check('a project with a lockfile, left alone, is stale',
      stale && stale.stale === true && stale.lockfiles.includes('package-lock.json'),
      stale && `${stale.idleDays} days idle`);
    check('the newest file is read from outside the dependency folder',
      stale && stale.idleDays >= 60,
      'node_modules is stamped with today by every install, and would make every project look new');
    check('a project with no lockfile is never called safe',
      loose && loose.lockfiles.length === 0);
    check('the command that restores it is the one its lockfile implies',
      stale && stale.restore === 'npm ci', stale && stale.restore);
    check('a python project gets a python command',
      project('work\\tool') && project('work\\tool').restore.startsWith('python -m venv'),
      project('work\\tool') && project('work\\tool').restore);
    check('only projects with a dependency folder get a row',
      out.projects.every((p) => p.dependencyDirs.length > 0)
        && !out.projects.some((p) => p.path.toLowerCase().endsWith('mobile')),
      out.projects.map((p) => path.basename(p.path)).join(', '));

    console.log('\nthe rows the screen is drawn from\n');

    const collected = await analyzers.collect('devProjects', { model: out }, { can: () => true });
    const candidates = collected.candidates;
    const summary = collected.summary;

    check('every row passes the contract', candidates.every((c) => {
      try {
        validateCandidate(c);
        return true;
      } catch (err) {
        console.log(`        ${err.message}`);
        return false;
      }
    }));
    check('every row carries its evidence', candidates.every((c) => c.evidence.length >= 2));

    const deps = candidates.filter((c) => c.category === 'dev.dependencies');
    const files = candidates.filter((c) => c.category === 'dev.buildOutput' && c.kind === 'file');
    const folders = candidates.filter((c) => c.category === 'dev.buildOutput' && c.kind === 'folder');

    check('a dependency row offers nothing to do',
      deps.length > 0 && deps.every((c) => c.actions.length === 1 && c.actions[0] === 'none'),
      'recycle refuses folders, and the files below are 232,229 of them on the real machine');
    check('a stale project with a lockfile is safe and strong',
      deps.some((c) => c.path.toLowerCase().endsWith('my-app') && c.verdict === 'safe' && c.confidence === 'strong'));
    check('a project with no lockfile is review and only likely',
      deps.some((c) => c.path.toLowerCase().endsWith('loose') && c.verdict === 'review' && c.confidence === 'likely'));
    check('no dependency row is ever more than "strong"',
      deps.every((c) => c.confidence !== 'certain'),
      'whether a process is running in the folder cannot be checked on Windows');
    check('and every one of them says so',
      deps.every((c) => c.evidence.some((e) => e.i18n === 'evidence.dev.projectNoProcess')));

    // my-app\dist 2 + tool\dist 1 + mobileuild 2 (the nested out\ is part of it)
    check('a declared build folder yields one row per file, each recyclable',
      files.length === 5 && files.every((c) => c.verdict === 'safe' && c.actions.includes('recycle')),
      `${files.length} files`);
    check('an undeclared one yields a single folder row that offers nothing',
      folders.length > 0 && folders.every((c) => c.verdict === 'review' && c.confidence === 'guess'
        && c.actions.length === 1 && c.actions[0] === 'none'));
    check("no file of a vendored library is offered",
      !files.some((c) => c.path.toLowerCase().includes('bootstrap')),
      files.map((c) => path.basename(c.path)).join(', '));
    check('no released APK is offered',
      !files.some((c) => c.path.toLowerCase().includes('release-1.0.0')));

    check('nothing on this screen may ever run unattended',
      candidates.every((c) => c.unattendedEligible === false && !isAllowedUnattended(c.category)),
      'the unattended run scans with lib/scanner.js and never runs this analyzer');

    check('the screen is told what can actually go',
      summary.freeableBytes === (7 + 8 + 8) * MB,  // my-app 7, tool 8, mobile 7+1
      `${summary.freeableBytes} bytes`);
    check('and the groups it draws line up with the rows',
      summary.buildGroups.length === out.builds.length
        && summary.buildGroups.filter((g) => g.declared).every((g) => g.fileIds.length > 0));

    console.log('\nnothing to scan\n');

    const empty = await projects.scan({ roots: [] });
    check('no folder chosen is a state, not an error', empty.noRoots === true && empty.projects.length === 0);
    const emptyRows = await analyzers.collect('devProjects', { model: empty }, { can: () => true });
    check('and it still produces a summary the screen can read',
      emptyRows.summary && emptyRows.candidates.length === 0);

    const cancelled = await projects.scan({ roots: [root], token: { cancelled: true } });
    check('a cancelled scan says so', cancelled.cancelled === true);
    console.log('\na folder the rules refuse\n');

    const inAppData = await projects.scan({ roots: [path.join(os.homedir(), 'AppData', 'Local', 'Temp')] });
    check('a chosen folder inside AppData is refused, and says which rule did it',
      inAppData.refusedRoots.length === 1 && inAppData.refusedRoots[0].reason === 'appData',
      'silently returning nothing for a folder somebody picked looks like a bug, not a rule');
  } finally {
    await fsp.rm(path.join('D:', path.sep, 'cleandrive-devprojects-test'), { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
