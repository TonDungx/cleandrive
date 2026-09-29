'use strict';

/**
 * The analyzer behind the projects half of the Developer screen (C1 and C5):
 * what your own projects are holding, on the folders you chose.
 *
 * Separate from `dev.js` because it has a separate input. That one looks in
 * fixed places -- npm's cache is in the same folder on every machine -- while
 * this one looks wherever the Disk usage screen was pointed, which may be
 * nowhere at all. Separate button, separate state, separate analyzer.
 *
 * **Two halves again, and the same split as the tools screen makes.**
 *
 * *A dependency folder is explained, never touched.* Nineteen of them on this
 * machine hold 232,229 files between them, `recycle` refuses folders by
 * design, and `npm ci` knows what the lockfile pins in a way a folder walk
 * never will. The row carries the size, the date and the command, which is
 * everything the decision needs.
 *
 * *A build folder is listed and may go to the bin -- but only when the
 * project's own `.gitignore` says it is regenerated.* Measuring is what
 * settled this. Of 113 build folders under `D:\`, 11 are declared that way
 * and 102 are not, and the 102 include every vendored copy of Bootstrap,
 * echarts and Chart.js -- folders called `dist` sitting next to a
 * `package.json`, committed to git, loaded by the page. They also include
 * `language_mobile_app\dist`: 1.30 GB of released APKs, versions 1.0.3 to
 * 1.2.1, with its `index.html` in git. Rebuilding that project gives you the
 * current version, not the ten that shipped. "A project file sits beside it"
 * would have called all of them safe.
 *
 * **Nothing here is `unattendedEligible`, and nothing needs to be.** Build
 * output already reaches the unattended run by its own road -- the disk scan's
 * `cleanup.buildoutput`, which has been on the hard whitelist and off by
 * default since it was written. What it lacked was this same `.gitignore`
 * test, which is now in `lib/advisor.js`, and without which a run with build
 * output switched on would have taken 400 files of vendored library off this
 * machine. An `unattendedEligible` flag on a candidate here would be read by
 * nobody: the unattended run scans with `lib/scanner.js` and selects from the
 * advisor's own categories, and never runs this analyzer at all.
 */

const { message: m } = require('../../i18n');
const { formatBytes } = require('../lib/util');
const { candidateId, evidence } = require('./contract');

const ID = 'devProjects';

const n = (v) => Number(v || 0).toLocaleString('en-US');

/**
 * A project's dependency folder (C1).
 *
 * **One row per project, and the app does not touch it**, which is the same
 * answer the package caches got and for a measured reason: nineteen dependency
 * folders on this machine hold 232,229 files, and `recycle` refuses folders on
 * purpose, so offering this as something to act on would mean a quarter of a
 * million rows. What a developer wants here is the size, the date, and the one
 * command that brings it back -- and that command is the tool's own, which
 * knows what the lockfile pins where a folder walk does not.
 *
 * `safe` needs a lockfile **and** a project nobody has touched for `staleDays`.
 * Without a lockfile the reinstall may resolve to different versions, which is
 * exactly what `review · likely` is for.
 *
 * The spec's third rule -- `keep` while a process is running in the folder --
 * is not here. Measured: `Win32_Process` gives an executable path and no
 * working directory, so the question cannot be asked on this machine. The spec
 * wrote the fallback itself: drop the condition, lower the confidence, and say
 * so. The last piece of evidence on every row says so.
 */
function projectCandidate(project, staleDays) {
  const hasLock = project.lockfiles.length > 0;
  const stale = project.stale === true;
  const safe = hasLock && stale;

  const list = [
    evidence(1, m('evidence.dev.projectWhat', 'The dependencies of {name}, downloaded by its own tools: {size} in {files} files', {
      name: project.name, size: formatBytes(project.bytes), files: n(project.fileCount),
    })),
  ];

  list.push(evidence(2, hasLock
    ? m('evidence.dev.projectLock', 'It has {lock}, which pins every version — reinstalling brings back exactly what is there now', {
      lock: project.lockfiles.join(', '),
    })
    : m('evidence.dev.projectNoLock', 'There is no lockfile, so reinstalling may fetch different versions than the ones here')));

  if (project.idleDays === null) {
    list.push(evidence(3, m('evidence.dev.projectUnknownAge', 'Nothing here could be dated, so how long it has been left alone is not known')));
  } else if (stale) {
    list.push(evidence(3, m('evidence.dev.projectStale', 'Nothing outside the dependency folder has changed for {days} days', {
      days: n(project.idleDays),
    })));
  } else {
    list.push(evidence(3, m('evidence.dev.projectRecent', 'Something here changed {days} days ago, so this is a project in use', {
      days: n(project.idleDays),
    })));
  }

  if (project.touched && project.touched.fromGit && project.touched.fromFiles
    && project.touched.fromFiles > project.touched.fromGit) {
    list.push(evidence(list.length + 1, m('evidence.dev.projectUncommitted', 'Its files are newer than anything git has recorded — there is work here that was never committed')));
  }

  if (project.restore) {
    list.push(evidence(list.length + 1, m('evidence.dev.projectRestore', 'It comes back with “{command}”, which the app shows and never runs', {
      command: project.restore,
    })));
  }

  if (project.refused > 0) {
    list.push(evidence(list.length + 1, m('evidence.dev.refused', '{n} folders in it could not be read, so it holds at least this much', { n: n(project.refused) })));
  }

  // Said only when it is absent, because that is the half that changes what
  // somebody should do. A project under git has a history to fall back on if
  // the wrong thing goes; a folder with no repository has nothing but the
  // Recycle Bin. `hasGit` was measured from the first version of this scan and
  // had never once reached a screen.
  if (project.hasGit === false) {
    list.push(evidence(list.length + 1, m('evidence.dev.projectNoGit', 'No git repository in this folder, so nothing here has a history to fall back on')));
  }

  // Said on every row, because it is the one thing the app cannot check.
  list.push(evidence(list.length + 1, m('evidence.dev.projectNoProcess', 'Whether a program is running inside this folder was not checked: Windows reports where a process was started from, not which folder it is working in')));

  return {
    id: candidateId(ID, project.path),
    path: project.path,
    kind: 'folder',
    bytes: Math.max(0, Math.round(project.bytes)),
    category: 'dev.dependencies',
    verdict: safe ? 'safe' : 'review',
    // Never `certain` and never `strong` without a lockfile: see the note
    // about the running-process check above.
    confidence: safe ? 'strong' : 'likely',
    evidence: list,
    // Nothing to act on: `recycle` refuses folders, and the files below are a
    // quarter of a million on this machine.
    actions: ['none'],
    unattendedEligible: false,
    meta: {
      kind: 'project',
      name: project.name,
      kinds: project.kinds,
      kindNames: project.kindNames,
      lockfiles: project.lockfiles,
      restore: project.restore,
      idleDays: project.idleDays,
      staleDays,
      stale,
      hasGit: project.hasGit,
      touched: project.touched,
      fileCount: project.fileCount,
      dependencyDirs: project.dependencyDirs.map((d) => ({ name: d.name, path: d.path, bytes: d.bytes, files: d.files })),
    },
  };
}

/**
 * One file inside a build folder the project's own `.gitignore` declares (C5).
 *
 * Only the declared folders reach this. The rest are summed and explained,
 * never listed, because the row for those offers nothing to move.
 */
function buildFileCandidate(file, build) {
  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: Math.max(0, Math.round(file.size || 0)),
    bytesOnDisk: Math.max(0, Math.round(Number.isFinite(file.allocated) ? file.allocated : file.size || 0)),
    category: 'dev.buildOutput',
    verdict: 'safe',
    confidence: 'strong',
    evidence: [
      evidence(1, m('evidence.dev.buildWhat', 'Inside {folder}, which {project} builds and rebuilds', {
        folder: build.name, project: build.projectName || build.parent,
      })),
      evidence(2, m('evidence.dev.buildDeclared', 'The project’s own .gitignore has the line “{line}” — whoever wrote it said this folder is regenerated', {
        line: build.declaredBy,
      })),
    ],
    actions: ['recycle'],
    // See the note at the top of the file: nothing on this screen reaches the
    // unattended run, and build output already does so by another road.
    unattendedEligible: false,
    meta: { kind: 'buildFile', folder: build.path, project: build.project },
  };
}

/**
 * A build folder nobody declared (C5's `review · guess`).
 *
 * One row, no file list, nothing offered. The spec calls this `guess` because
 * a folder named `build` proves nothing, and measuring on this machine showed
 * how right that is: 102 of the 113 folders found are this, and among them are
 * every vendored copy of Bootstrap and echarts -- and `language_mobile_app\
 * dist`, which is 1.30 GB of released APKs from versions 1.0.3 to 1.2.1, with
 * its `index.html` committed to git. Rebuilding that project gives you the
 * current version, not the ten that shipped.
 */
function buildFolderCandidate(build) {
  const list = [
    evidence(1, m('evidence.dev.buildGuessWhat', 'A folder called {name}, holding {size} in {files} files', {
      name: build.name, size: formatBytes(build.bytes), files: n(build.fileCount),
    })),
    evidence(2, m('evidence.dev.buildNotDeclared', 'No .gitignore here calls it regenerated, so CleanDrive will not treat it as build output. A folder with this name can just as easily be a library the project ships, or builds somebody kept on purpose')),
  ];
  if (build.ownedKind) {
    list.push(evidence(3, m('evidence.dev.buildBeside', 'There is a matching project file beside it — which is not enough on its own: every vendored library has one too')));
  }
  if (build.refused > 0) {
    list.push(evidence(list.length + 1, m('evidence.dev.refused', '{n} folders in it could not be read, so it holds at least this much', { n: n(build.refused) })));
  }

  return {
    id: candidateId(ID, build.path),
    path: build.path,
    kind: 'folder',
    bytes: Math.max(0, Math.round(build.bytes)),
    bytesOnDisk: Math.max(0, Math.round(build.bytesOnDisk || build.bytes)),
    category: 'dev.buildOutput',
    verdict: 'review',
    confidence: 'guess',
    evidence: list,
    actions: ['none'],
    unattendedEligible: false,
    meta: {
      kind: 'buildFolder',
      name: build.name,
      project: build.project,
      projectName: build.projectName,
      ownedKind: build.ownedKind,
      fileCount: build.fileCount,
    },
  };
}


const analyzer = {
  id: ID,
  feature: 'pro.dev',
  requiresElevation: false,
  categories: ['dev.dependencies', 'dev.buildOutput'],

  /** @param {object} ctx  { model } from dev/projects.js */
  async *run(ctx, token) {
    const model = ctx.model;
    const rows = { projects: [], builds: [], buildFiles: [] };

    for (const project of model.projects || []) {
      if (token && token.cancelled) break;
      const candidate = projectCandidate(project, model.staleDays);
      rows.projects.push(candidate.id);
      yield { type: 'candidate', candidate };
    }

    // Largest first, so the folder worth looking at is the one on top.
    const builds = [...(model.builds || [])].sort((a, b) => b.bytes - a.bytes);
    const groups = [];
    for (const build of builds) {
      if (token && token.cancelled) break;

      if (!build.declared) {
        const candidate = buildFolderCandidate(build);
        rows.builds.push(candidate.id);
        groups.push({
          path: build.path,
          name: build.name,
          project: build.project,
          projectName: build.projectName,
          declared: false,
          declaredBy: null,
          bytes: build.bytes,
          fileCount: build.fileCount,
          rowId: candidate.id,
          fileIds: [],
          truncated: false,
        });
        yield { type: 'candidate', candidate };
        continue;
      }

      const fileIds = [];
      for (const file of build.files) {
        if (token && token.cancelled) break;
        const candidate = buildFileCandidate(file, build);
        fileIds.push(candidate.id);
        rows.buildFiles.push(candidate.id);
        yield { type: 'candidate', candidate };
      }
      groups.push({
        path: build.path,
        name: build.name,
        project: build.project,
        projectName: build.projectName,
        declared: true,
        declaredBy: build.declaredBy,
        bytes: build.bytes,
        fileCount: build.fileCount,
        rowId: null,
        fileIds,
        truncated: Boolean(build.truncated),
      });
    }

    const { projects, builds: rawBuilds, ...rest } = model;
    yield {
      type: 'summary',
      summary: {
        ...rest,
        rows,
        // One entry per build folder, so the screen can group without holding
        // every file candidate it yielded.
        buildGroups: groups,
        projectRows: (model.projects || []).map((project) => ({
          path: project.path,
          name: project.name,
          kinds: project.kinds,
          kindNames: project.kindNames,
          lockfiles: project.lockfiles,
          restore: project.restore,
          bytes: project.bytes,
          fileCount: project.fileCount,
          idleDays: project.idleDays,
          stale: project.stale,
          hasGit: project.hasGit,
          dependencyDirs: project.dependencyDirs.map((d) => ({ name: d.name, path: d.path, bytes: d.bytes, files: d.files })),
        })),
        // What could actually be moved to the bin: the declared folders only.
        freeableBytes: builds.filter((b) => b.declared).reduce((sum, b) => sum + b.bytes, 0),
        freeableFiles: builds.filter((b) => b.declared).reduce((sum, b) => sum + b.fileCount, 0),
      },
    };
  },
};

module.exports = { analyzer, ID, projectCandidate, buildFileCandidate, buildFolderCandidate };
