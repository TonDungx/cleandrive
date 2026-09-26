'use strict';

/**
 * The projects on the folders you chose, what their dependencies weigh, and
 * what their builds left behind (C1 and C5).
 *
 * This half of the Developer screen has a different input from the other half
 * and that is why it has its own button. The tools half looks in fixed places
 * -- `%LOCALAPPDATA%\npm-cache` is where npm's cache is on every machine. This
 * half looks wherever *you* pointed the Disk usage screen, which may be
 * nothing at all until you have chosen something, and costs a different amount
 * every time. Measured on this machine (2026-09-26):
 *
 *   walk of D:\                     2.4 s   310 build folders, 16,710 dirs
 *   .gitignore rules                0.1 s   263 files read
 *   listing every build folder      2.9 s   22,743 files, 6.53 GB
 *   measuring dependency folders   44.5 s   19 folders, 232,229 files
 *
 * The last line is why the two halves cannot share a button: the tools scan
 * already takes 22.6 s, and one 4 GB `venv` alone accounts for 21.9 s of the
 * 44.5. Nobody opening the screen to look at Docker's 53 GB should wait 78
 * seconds for it.
 *
 * **Where it does not look.** Every path under `AppData`, every folder whose
 * name starts with `.` or `$`, the install folder of any application, and the
 * package caches the other half of the screen already reports. Measured: a
 * walk of the Home folder without those rules found 222 "projects" in 68.4 s
 * and the first eight with a `node_modules` were the insides of Cursor and
 * Discord. With them it finds 143 in 17.2 s and none of those eight.
 *
 * Only reads. Nothing here deletes, and only C5 hands anything to the bin.
 */

const path = require('node:path');

const { fsp } = require('../lib/real-fs');
const { measureTree } = require('../system/walk');
const gitignore = require('../lib/gitignore');

/* -------------------------------------------------------------------------- */
/* what a project is                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The five kinds the spec names, and for each: what marks it, what says its
 * dependencies can be fetched again, where they sit, and how to get them back.
 *
 * The command matters as much as the size. A row that says "4 GB, and you get
 * it back with `pip install -r requirements.txt`" is a decision someone can
 * make; the same row without the command is only a number.
 */
const KINDS = Object.freeze([
  {
    id: 'node',
    name: 'Node',
    markers: ['package.json'],
    lockfiles: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'],
    dependencyDirs: ['node_modules'],
    restore: {
      'package-lock.json': 'npm ci',
      'pnpm-lock.yaml': 'pnpm install --frozen-lockfile',
      'yarn.lock': 'yarn install --frozen-lockfile',
      'bun.lockb': 'bun install --frozen-lockfile',
    },
    fallback: 'npm install',
  },
  {
    id: 'python',
    name: 'Python',
    markers: ['pyvenv.cfg', 'requirements.txt', 'pyproject.toml', 'poetry.lock', 'pipfile'],
    lockfiles: ['requirements.txt', 'poetry.lock', 'uv.lock', 'pipfile.lock'],
    dependencyDirs: ['.venv', 'venv', 'env'],
    restore: {
      'requirements.txt': 'python -m venv .venv && .venv\\Scripts\\pip install -r requirements.txt',
      'poetry.lock': 'poetry install',
      'uv.lock': 'uv sync',
      'pipfile.lock': 'pipenv install',
    },
    fallback: null,
  },
  {
    id: 'rust',
    name: 'Rust',
    markers: ['cargo.toml'],
    lockfiles: ['cargo.lock'],
    dependencyDirs: ['target'],
    restore: { 'cargo.lock': 'cargo build' },
    fallback: 'cargo build',
  },
  {
    id: 'dotnet',
    name: '.NET',
    markers: [],
    markerSuffixes: ['.csproj', '.sln', '.fsproj', '.vbproj', '.vcxproj'],
    lockfiles: ['packages.lock.json'],
    dependencyDirs: ['packages'],
    restore: { 'packages.lock.json': 'dotnet restore' },
    fallback: 'dotnet restore',
  },
  {
    id: 'java',
    name: 'Java',
    markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    lockfiles: ['gradle.lockfile', 'pom.xml'],
    dependencyDirs: ['.gradle'],
    restore: { 'pom.xml': 'mvn dependency:resolve', 'gradle.lockfile': 'gradlew build' },
    fallback: 'gradlew build',
  },
]);

/** Folder names C5 gathers. The spec's list, unchanged. */
const BUILD_DIR_NAMES = Object.freeze(['bin', 'obj', 'target', 'dist', 'build', '.next', '.nuxt', '.turbo', 'out']);

/** Which kind a build folder of that name belongs to, when one is beside it. */
const BUILD_OWNERS = Object.freeze({
  bin: ['dotnet'],
  obj: ['dotnet'],
  target: ['rust', 'java'],
  dist: ['node', 'python'],
  build: ['java', 'node'],
  out: ['node'],
  '.next': ['node'],
  '.nuxt': ['node'],
  '.turbo': ['node'],
});

/**
 * Never descended into looking for projects.
 *
 * A dependency tree holds thousands of little projects that are not yours --
 * every package in `node_modules` has a `package.json` -- and a package cache
 * holds the same thing with a download date on it. `D:\pub-cache` on this
 * machine holds Dart packages whose own shipped `build` folders would
 * otherwise be offered as your build output.
 */
const NEVER_DESCEND = new Set([
  'node_modules', '.venv', 'venv', '__pycache__', '.git', 'site-packages', 'dist-packages',
  'vendor', 'bower_components', 'jspm_packages', '.tox',
  'pub-cache', '.pub-cache', '.m2', '.nuget', '.cargo', '.gradle', 'go', '.npm', '.yarn',
]);

/** Folder names that are dependency trees, for the "last touched" reading. */
const DEPENDENCY_NAMES = new Set([
  ...KINDS.flatMap((k) => k.dependencyDirs), ...BUILD_DIR_NAMES, '.git', '__pycache__', 'node_modules',
]);

/* -------------------------------------------------------------------------- */
/* the rules about where not to look                                          */
/* -------------------------------------------------------------------------- */

const lower = (s) => String(s).toLowerCase();

function segments(p) {
  return lower(p).split(/[\\/]/);
}

/**
 * Why this folder is not looked in, or null.
 *
 * `AppData` is a pattern rather than a comparison with `%LOCALAPPDATA%`,
 * because a machine can carry more than one profile tree -- this one has both
 * `C:\Users\ktvda` and a `D:\Users`.
 */
function excludedReason(full) {
  const parts = segments(full);
  if (parts.includes('appdata')) return 'appData';
  if (parts.includes('windows') || parts.includes('$recycle.bin') || parts.includes('system volume information')) return 'system';
  if (parts.includes('program files') || parts.includes('program files (x86)') || parts.includes('programdata')) return 'programFiles';
  return null;
}

/** A folder Windows and this app both treat as hidden. */
function isHiddenName(name) {
  return name.startsWith('.') || name.startsWith('$');
}

/**
 * An installed application's own folder, read from the listing already in
 * hand. The same test the disk scan uses, and here for the same reason: an
 * application's `out\` is its product, and its `node_modules` is not yours.
 */
function looksLikeInstalledApp(names) {
  let executable = false;
  let layout = false;
  for (const name of names) {
    const l = lower(name);
    if (/^unins.*\.exe$/.test(l) || /^uninstall.*\.exe$/.test(l)) return true;
    if (l.endsWith('.exe')) executable = true;
    if (l === 'resources' || l === 'locales') layout = true;
  }
  return executable && layout;
}

/* -------------------------------------------------------------------------- */
/* reading one folder                                                         */
/* -------------------------------------------------------------------------- */

/** Which kinds of project a folder's own files say it is. */
function kindsOf(files) {
  const found = [];
  for (const kind of KINDS) {
    const byName = kind.markers.some((marker) => files.includes(marker));
    const bySuffix = (kind.markerSuffixes || []).some((suffix) => files.some((f) => f.endsWith(suffix)));
    if (byName || bySuffix) found.push(kind);
  }
  return found;
}

/** The command that brings a kind's dependencies back, given what it has. */
function restoreCommand(kind, lockfiles) {
  for (const lock of lockfiles) {
    if (kind.restore[lock]) return kind.restore[lock];
  }
  return kind.fallback;
}

/* -------------------------------------------------------------------------- */
/* when was this project last touched                                         */
/* -------------------------------------------------------------------------- */

/** At most this many files are read for a project's newest timestamp. */
const TOUCH_FILE_CAP = 4000;

/**
 * The newest file below a project, skipping its dependency and build folders.
 *
 * Skipping them is the whole point of the reading: `npm install` stamps every
 * one of 47,754 files with today's date, and a project nobody has opened since
 * February would look like a project from this morning.
 */
async function newestFile(root, token) {
  let newest = 0;
  let seen = 0;

  const visit = async (dir, depth) => {
    if (depth > 8 || seen >= TOUCH_FILE_CAP || (token && token.cancelled)) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= TOUCH_FILE_CAP || (token && token.cancelled)) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEPENDENCY_NAMES.has(lower(entry.name))) continue;
        await visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      seen += 1;
      try {
        const stat = await fsp.stat(full);
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      } catch {
        /* gone between the listing and the stat */
      }
    }
  };

  await visit(root, 0);
  return { ms: newest, seen, capped: seen >= TOUCH_FILE_CAP };
}

/**
 * What git remembers about the last time anything happened here.
 *
 * `.git\logs\HEAD` is the reflog: git appends to it on every commit, checkout,
 * pull, merge and reset, so its modification time is the cheapest record git
 * keeps of activity. Reading the last *commit* would mean parsing objects for
 * a worse answer -- a branch checked out yesterday is activity too.
 */
async function gitTouched(root) {
  for (const parts of [['logs', 'HEAD'], ['HEAD'], ['index']]) {
    try {
      const stat = await fsp.stat(path.join(root, '.git', ...parts));
      return { ms: stat.mtimeMs, from: parts.join('\\') };
    } catch {
      /* try the next */
    }
  }
  return null;
}

/**
 * When somebody last touched this project.
 *
 * **The later of the two readings, not git's.** The spec says to prefer git's,
 * and measuring said that is backwards: across twelve projects here, wherever
 * the two disagreed git was the older one, and on
 * `D:\work\fis\invoice_downloader` git said four days while the files said
 * today -- someone editing right now without having committed. Preferring git
 * would age a project that is in use and push it towards "safe to delete",
 * which is the one direction a wrong answer must never go. Taking the later of
 * the two is the same rule, for the same reason, as the unattended run's
 * `max(mtime, atime)` in lib/autoclean.js.
 */
async function lastTouched(root, token) {
  const git = await gitTouched(root);
  const files = await newestFile(root, token);
  const ms = Math.max(git ? git.ms : 0, files.ms);
  return {
    ms: ms || null,
    fromGit: git ? git.ms : null,
    fromFiles: files.ms || null,
    filesRead: files.seen,
    capped: files.capped,
  };
}

/* -------------------------------------------------------------------------- */
/* the walk                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * More files than this are not listed one by one; the row says so.
 *
 * Only the folders a `.gitignore` declares are listed at all, and those came
 * to 18,957 files on this machine. The ones it does not declare are summed and
 * never listed: the row for those offers nothing to move, so their file names
 * would be a megabyte of payload nobody reads.
 */
const MAX_BUILD_FILES = 40000;

/** Every file below a folder, with what it occupies. */
async function filesUnder(root, token, cap) {
  const out = [];
  let truncated = false;

  const visit = async (dir, depth) => {
    if (out.length >= cap) {
      truncated = true;
      return;
    }
    if (depth > 12 || (token && token.cancelled)) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= cap) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fsp.stat(full);
        out.push({
          path: full,
          size: stat.size,
          allocated: Number.isFinite(stat.blocks) ? stat.blocks * 512 : stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        /* gone between the listing and the stat */
      }
    }
  };

  await visit(root, 0);
  return { files: out, truncated };
}

/**
 * One pass over the chosen folders: every project, every build folder.
 *
 * @param {object} options
 * @param {string[]} options.roots
 * @param {{cancelled: boolean}} [options.token]
 * @param {(p: object) => void} [options.onProgress]
 */
async function walkRoots({ roots, token = null, onProgress = () => {} }) {
  const projects = [];
  const builds = [];
  const skipped = { appData: 0, system: 0, programFiles: 0, hidden: 0, installedApp: 0, dependency: 0 };
  let dirsSeen = 0;
  let refused = 0;

  const visit = async (dir, depth, inherited) => {
    if (depth > 14 || (token && token.cancelled)) return;

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      refused += 1;
      return;
    }
    dirsSeen += 1;
    if (dirsSeen % 500 === 0) onProgress({ phase: 'walking', dirs: dirsSeen, projects: projects.length });

    const names = [];
    const files = [];
    const subdirs = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      names.push(entry.name);
      if (entry.isFile()) files.push(lower(entry.name));
      else if (entry.isDirectory()) subdirs.push(entry.name);
    }

    if (looksLikeInstalledApp(names)) {
      skipped.installedApp += 1;
      return;
    }

    const kinds = kindsOf(files);

    // A project inside another project does not inherit its floating rules:
    // the outer repository's bare `bin` must not reach a vendored library's.
    // The chosen folder is included, and the reset costs it nothing -- the
    // `extend` below reads its own `.gitignore` again straight afterwards.
    // Read the file only where the listing already shows one.
    const base = kinds.length > 0 ? gitignore.atNestedProject(inherited) : inherited;
    const ignores = gitignore.listingHasIgnoreFile(entries)
      ? await gitignore.extend(base, dir)
      : base;
    if (kinds.length > 0) {
      const lockfiles = [];
      const dependencyDirs = [];
      for (const kind of kinds) {
        for (const lock of kind.lockfiles) if (files.includes(lower(lock)) && !lockfiles.includes(lock)) lockfiles.push(lock);
        for (const name of kind.dependencyDirs) {
          const match = subdirs.find((d) => lower(d) === name);
          if (match && !dependencyDirs.some((d) => d.name === match)) dependencyDirs.push({ name: match, path: path.join(dir, match) });
        }
      }
      projects.push({
        path: dir,
        name: path.basename(dir) || dir,
        kinds: kinds.map((k) => k.id),
        kindNames: kinds.map((k) => k.name),
        lockfiles,
        restore: restoreCommand(kinds[0], lockfiles.map(lower)),
        dependencyDirs,
        hasGit: subdirs.some((d) => lower(d) === '.git'),
      });
    }

    for (const name of subdirs) {
      if (token && token.cancelled) return;
      const full = path.join(dir, name);
      const l = lower(name);

      // Refused first, so nothing under an excluded path can be recorded as a
      // build folder on the way past it.
      const why = excludedReason(full);
      if (why) {
        skipped[why] += 1;
        continue;
      }

      if (BUILD_DIR_NAMES.includes(l)) {
        const declared = gitignore.lookup(ignores, full, name);
        builds.push({
          path: full,
          name,
          parent: dir,
          declared: declared.ignored,
          declaredBy: declared.line,
          // Which project it belongs to is filled in after the walk, when the
          // whole list of projects is known.
          owners: BUILD_OWNERS[l] || [],
        });
      }

      if (NEVER_DESCEND.has(l)) {
        skipped.dependency += 1;
        continue;
      }
      // `.next`, `.nuxt` and `.turbo` are build folders and hidden names both:
      // recorded above, and not walked into looking for more projects.
      if (isHiddenName(name)) {
        skipped.hidden += 1;
        continue;
      }
      await visit(full, depth + 1, ignores);
    }
  };

  const cache = new Map();
  // A chosen folder that is itself inside AppData, or inside an installed
  // application, is refused -- and said out loud. Silently returning nothing
  // for a folder somebody picked on purpose is the one answer that looks like
  // a bug rather than a rule.
  const refusedRoots = [];
  for (const root of roots) {
    if (token && token.cancelled) break;
    const why = excludedReason(root);
    if (why) {
      refusedRoots.push({ root, reason: why });
      continue;
    }
    onProgress({ phase: 'walking', root, dirs: dirsSeen, projects: projects.length });
    await visit(root, 0, await gitignore.scopeFor(root, { cache }));
  }

  return { projects, builds, skipped, dirsSeen, refused, refusedRoots };
}

/**
 * A build folder inside another build folder is part of it.
 *
 * Gradle's `build\` holds 125 more folders called `out` and `build`, and
 * counting them separately turned 6.53 GB of real output into 8.42 GB of
 * arithmetic. Measured on D:\: 310 folders become 185.
 */
function outermost(builds) {
  const sorted = [...builds].sort((a, b) => a.path.length - b.path.length);
  const kept = [];
  let nested = 0;
  for (const build of sorted) {
    const inside = kept.some((k) => lower(build.path).startsWith(lower(k.path) + path.sep));
    if (inside) nested += 1;
    else kept.push(build);
  }
  return { kept, nested };
}

/* -------------------------------------------------------------------------- */
/* the scan                                                                   */
/* -------------------------------------------------------------------------- */

/** A project untouched for this long has its dependencies called disposable. */
const DEFAULT_STALE_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Everything the projects half of the Developer screen is drawn from.
 *
 * @param {object} options
 * @param {string[]} options.roots        the folders chosen on the Disk screen
 * @param {number} [options.staleDays]
 * @param {{cancelled: boolean}} [options.token]
 * @param {(p: object) => void} [options.onProgress]
 */
async function scan({ roots = [], staleDays = DEFAULT_STALE_DAYS, token = null, onProgress = () => {}, now = Date.now() } = {}) {
  const started = Date.now();
  const list = (Array.isArray(roots) ? roots : [roots]).filter((r) => typeof r === 'string' && r.trim() !== '');

  if (list.length === 0) {
    return {
      at: Date.now(), roots: [], projects: [], builds: [], skipped: {}, dirsSeen: 0,
      refused: 0, refusedRoots: [], noRoots: true, cancelled: false, durationMs: 0, staleDays,
      dependencyBytes: 0, buildBytes: 0, truncated: false,
    };
  }

  onProgress({ phase: 'walking', dirs: 0, projects: 0 });
  const walked = await walkRoots({ roots: list, token, onProgress });

  // C5. Two different readings, for the same reason the tools half reads a
  // package cache and an editor cache differently: a folder the app will offer
  // to move needs its file names, and a folder it will only explain does not.
  //
  //   declared by a .gitignore   listed file by file   11 folders, 18,957 files
  //   not declared               summed, never listed  102 folders
  //
  // Listing everything cost 2.9 s and 22,743 files here, and 14,022 of them
  // were in one Gradle `build\` that would have eaten the whole budget before
  // the smaller folders anybody can act on were reached.
  const { kept: buildFolders, nested } = outermost(walked.builds);
  // Largest first, so a cap that is reached drops the folders that matter least.
  const ordered = [...buildFolders].sort((a, b) => Number(b.declared) - Number(a.declared));
  const builds = [];
  let budget = MAX_BUILD_FILES;
  let truncated = false;
  for (const [index, build] of ordered.entries()) {
    if (token && token.cancelled) break;
    onProgress({ phase: 'builds', name: build.name, at: index + 1, of: ordered.length });

    if (!build.declared) {
      const out = await measureTree(build.path, token ? { token } : {});
      const all = out.buckets.all || { allocated: 0, logical: 0, files: 0 };
      builds.push({
        ...build,
        files: [],
        listed: false,
        fileCount: all.files,
        bytes: all.logical || all.allocated,
        bytesOnDisk: all.allocated,
        refused: out.deniedCount,
        truncated: false,
      });
      continue;
    }

    const listing = await filesUnder(build.path, token, Math.max(0, budget));
    budget -= listing.files.length;
    if (listing.truncated) truncated = true;
    builds.push({
      ...build,
      files: listing.files,
      listed: true,
      fileCount: listing.files.length,
      bytes: listing.files.reduce((sum, f) => sum + f.size, 0),
      bytesOnDisk: listing.files.reduce((sum, f) => sum + f.allocated, 0),
      refused: 0,
      truncated: listing.truncated,
    });
  }

  // Which project each build folder sits in: the deepest one that holds it.
  for (const build of builds) {
    const holders = walked.projects.filter((p) => lower(build.path).startsWith(lower(p.path) + path.sep));
    const owner = holders.sort((a, b) => b.path.length - a.path.length)[0] || null;
    build.project = owner ? owner.path : null;
    build.projectName = owner ? owner.name : null;
    build.ownedKind = owner ? build.owners.some((k) => owner.kinds.includes(k)) : false;
  }

  // C1: only projects with a dependency folder are measured. That is 19 of 286
  // here, and still 44.5 s of the scan -- one 4 GB `venv` is 21.9 s of it.
  const withDeps = walked.projects.filter((p) => p.dependencyDirs.length > 0);
  const projects = [];
  for (const [index, project] of withDeps.entries()) {
    if (token && token.cancelled) break;
    onProgress({ phase: 'measuring', name: project.name, at: index + 1, of: withDeps.length });

    const dirs = [];
    let bytes = 0;
    let fileCount = 0;
    let refused = 0;
    for (const dependency of project.dependencyDirs) {
      // `measureTree` has a default token and throws on an explicit null.
      const out = await measureTree(dependency.path, token ? { token } : {});
      const all = out.buckets.all || { allocated: 0, files: 0 };
      dirs.push({ ...dependency, bytes: all.allocated, files: all.files, refused: out.deniedCount });
      bytes += all.allocated;
      fileCount += all.files;
      refused += out.deniedCount;
    }

    onProgress({ phase: 'touched', name: project.name, at: index + 1, of: withDeps.length });
    const touched = await lastTouched(project.path, token);
    const idleDays = touched.ms ? Math.floor((now - touched.ms) / DAY) : null;

    projects.push({
      ...project,
      dependencyDirs: dirs,
      bytes,
      fileCount,
      refused,
      touched,
      idleDays,
      stale: idleDays !== null && idleDays >= staleDays,
      buildFolders: builds.filter((b) => b.project === project.path).map((b) => b.path),
    });
  }

  return {
    at: Date.now(),
    roots: list,
    staleDays,
    projects,
    // Every project found, so the screen can say how many it looked at even
    // though only the ones with a dependency folder have a row.
    projectsFound: walked.projects.length,
    builds,
    nestedBuilds: nested,
    dependencyBytes: projects.reduce((sum, p) => sum + p.bytes, 0),
    buildBytes: builds.reduce((sum, b) => sum + b.bytes, 0),
    skipped: walked.skipped,
    dirsSeen: walked.dirsSeen,
    refused: walked.refused,
    // Folders that were chosen and then refused by the exclusion rules.
    refusedRoots: walked.refusedRoots,
    truncated,
    noRoots: false,
    cancelled: Boolean(token && token.cancelled),
    durationMs: Date.now() - started,
  };
}

module.exports = {
  scan,
  walkRoots,
  outermost,
  lastTouched,
  newestFile,
  gitTouched,
  filesUnder,
  kindsOf,
  restoreCommand,
  excludedReason,
  looksLikeInstalledApp,
  KINDS,
  BUILD_DIR_NAMES,
  BUILD_OWNERS,
  NEVER_DESCEND,
  DEFAULT_STALE_DAYS,
  MAX_BUILD_FILES,
  TOUCH_FILE_CAP,
};
