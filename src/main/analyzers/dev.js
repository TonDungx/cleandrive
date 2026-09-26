'use strict';

/**
 * The analyzer behind the Developer screen (C2 and C4): the caches a
 * developer's tools fill the disk with.
 *
 * The screen has two halves and they behave differently on purpose.
 *
 * **A package cache is explained, not deleted.** One row for the whole cache,
 * with the command its own tool uses to clear it, shown to copy. The app does
 * not touch it. Two reasons, both measured: listing npm's cache took 13.8 s
 * here and Gradle's 21.8 s, so offering a file list would make the screen slow
 * for something nobody wants file by file; and `npm cache clean --force` knows
 * which entries are still referenced, which a walk of the folder does not. The
 * row is `review`, never `safe` -- the app is not the one deciding.
 *
 * **An IDE's own cache is a file list, and it may go to the bin.** These are
 * small (2.4 s to list all of them), they are named as caches by the tools
 * that write them, and the editor rebuilds them. `safe · strong` while that
 * editor is closed; `keep` the moment it is open, or when the process list
 * could not be read at all -- the same rule the known apps' caches use, and
 * for the same reason.
 *
 * Nothing here is `unattendedEligible` yet. The spec puts IDE caches and C5's
 * build outputs on the unattended list together, off by default, and the
 * automatic run's whitelist is keyed on the advisor's own category names;
 * both land together with C5 rather than half now.
 */

const path = require('node:path');

const { message: m } = require('../../i18n');
const { formatBytes } = require('../lib/util');
const { candidateId, evidence } = require('./contract');

const ID = 'dev';

const n = (v) => Number(v || 0).toLocaleString('en-US');

/** What each kind of tool is, in one sentence. */
const WHAT = {
  npm: () => m('evidence.dev.what.npm', 'Packages npm has downloaded, kept so the next install does not fetch them again'),
  pip: () => m('evidence.dev.what.pip', 'Python packages pip has downloaded, kept so the next install does not fetch them again'),
  maven: () => m('evidence.dev.what.maven', 'Every Java dependency Maven has downloaded, for every project on this machine'),
  gradle: () => m('evidence.dev.what.gradle', 'Gradle’s downloaded dependencies and build caches, plus the Gradle versions themselves that projects asked for'),
  nuget: () => m('evidence.dev.what.nuget', '.NET packages restored for projects on this machine'),
  'android-sdk': () => m('evidence.dev.what.androidSdk', 'Android platforms, build tools, the NDK and emulator images'),
  'dotnet-sdk': () => m('evidence.dev.what.dotnetSdk', 'Every version of the .NET SDK installed, including the ones nothing builds against any more'),
  vscode: () => m('evidence.dev.what.vscode', 'Code’s compiled-ahead data for the version it is running, and the extension packages it downloaded to install'),
  cursor: () => m('evidence.dev.what.cursor', 'Cursor’s compiled-ahead data for the version it is running, and the extension packages it downloaded to install'),
  jetbrains: () => m('evidence.dev.what.jetbrains', 'The indexes and logs a JetBrains IDE writes per project — rebuilt, slowly, the next time you open one'),
  visualstudio: () => m('evidence.dev.what.visualstudio', 'Visual Studio’s own cache folders. Its settings backups and file backups sit beside these and are never touched'),
};

/** How a tool's own cache is cleared, said properly. */
function commandEvidence(tool) {
  if (tool.command) {
    return m('evidence.dev.command', 'Its own tool clears it with “{command}”, which knows what is still needed. The app shows that command and never runs it', {
      command: tool.command,
    });
  }
  return m('evidence.dev.noCommand', 'It ships no command to clear it. Removing the folder makes the tool download what it needs again on the next build');
}

function packageCacheCandidate(tool) {
  const list = [evidence(1, WHAT[tool.id] ? WHAT[tool.id]() : m('evidence.dev.what.generic', 'A cache one of your development tools keeps'))];
  list.push(evidence(2, m('evidence.dev.measured', '{size} in {files} files, measured by reading every folder in it', {
    size: formatBytes(tool.bytes), files: n(tool.fileCount),
  })));
  list.push(evidence(3, commandEvidence(tool)));
  if (tool.places.length > 1) {
    list.push(evidence(4, m('evidence.dev.places', 'Across {n} folders: {list}', {
      n: n(tool.places.length), list: tool.places.map((p) => p.dir).join(', '),
    })));
  }
  if (tool.refused > 0) {
    list.push(evidence(list.length + 1, m('evidence.dev.refused', '{n} folders in it could not be read, so it holds at least this much', { n: n(tool.refused) })));
  }

  return {
    id: candidateId(ID, `tool:${tool.id}`),
    path: tool.places[0].dir,
    kind: 'folder',
    bytes: Math.max(0, Math.round(tool.bytes)),
    category: 'dev.packageCache',
    // Never `safe`: the app is not the one deciding, and it does not act.
    verdict: 'review',
    confidence: 'strong',
    evidence: list,
    actions: ['none'],
    unattendedEligible: false,
    meta: {
      kind: 'packageCache',
      toolId: tool.id,
      name: tool.name,
      places: tool.places.map((p) => ({ dir: p.dir, bytes: p.bytes, files: p.files })),
      command: tool.command,
      fileCount: tool.fileCount,
    },
  };
}

function sdkCandidate(tool) {
  const list = [evidence(1, WHAT[tool.id] ? WHAT[tool.id]() : m('evidence.dev.what.generic', 'A cache one of your development tools keeps'))];
  list.push(evidence(2, m('evidence.dev.measured', '{size} in {files} files, measured by reading every folder in it', {
    size: formatBytes(tool.bytes), files: n(tool.fileCount),
  })));
  list.push(evidence(3, tool.manager === 'androidStudio'
    ? m('evidence.dev.androidManager', 'Remove components from Android Studio’s own SDK Manager, which knows which ones a project still needs. Taking folders out by hand leaves it believing they are there')
    : m('evidence.dev.sdkManager', 'Remove old versions the way they were installed, from Windows’ list of installed apps')));
  if (tool.command) {
    list.push(evidence(4, m('evidence.dev.listCommand', '“{command}” lists what is installed, so you can see which versions are old', { command: tool.command })));
  }

  return {
    id: candidateId(ID, `tool:${tool.id}`),
    path: tool.places[0].dir,
    kind: 'folder',
    bytes: Math.max(0, Math.round(tool.bytes)),
    category: 'dev.sdk',
    verdict: 'review',
    confidence: 'strong',
    evidence: list,
    actions: tool.handoff ? ['handoff'] : ['none'],
    unattendedEligible: false,
    meta: {
      kind: 'sdk',
      toolId: tool.id,
      name: tool.name,
      places: tool.places.map((p) => ({ dir: p.dir, bytes: p.bytes, files: p.files })),
      command: tool.command,
      handoff: tool.handoff || null,
      manager: tool.manager || null,
      fileCount: tool.fileCount,
    },
  };
}

function ideCacheCandidate(file, tool) {
  const closed = tool.isOpen === false;
  const list = [evidence(1, WHAT[tool.id] ? WHAT[tool.id]() : m('evidence.dev.what.generic', 'A cache one of your development tools keeps'))];
  list.push(evidence(2, m('evidence.dev.rebuilt', '{name} writes this again when it needs it', { name: tool.name })));
  if (tool.isOpen === true) {
    list.push(evidence(3, m('evidence.dev.ideOpen', '{name} is open — close it and scan again', { name: tool.name })));
  } else if (tool.isOpen === null) {
    list.push(evidence(3, m('evidence.dev.processesUnknown', 'Whether {name} is running could not be checked, so nothing here is offered', { name: tool.name })));
  }

  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: Math.max(0, Math.round(file.size || 0)),
    bytesOnDisk: Math.max(0, Math.round(Number.isFinite(file.allocated) ? file.allocated : file.size || 0)),
    category: 'dev.ideCache',
    verdict: closed ? 'safe' : 'keep',
    confidence: closed ? 'strong' : 'certain',
    evidence: list,
    actions: closed ? ['recycle'] : ['none'],
    // See the note at the top: the unattended half lands with C5.
    unattendedEligible: false,
    meta: {
      kind: 'ideCache',
      toolId: tool.id,
      name: tool.name,
      isOpen: tool.isOpen,
      openProcesses: tool.openProcesses,
    },
  };
}

/**
 * A WSL distribution's virtual disk (C3).
 *
 * Nothing about it is a `safe`, and nothing about it is acted on. Every one of
 * the commands on this row deletes something that does not go to the Recycle
 * Bin, so the row is a set of steps to read, in the order they have to happen.
 */
function distroCandidate(distro, machines) {
  const list = [
    evidence(1, m('evidence.dev.wslWhat', 'The virtual disk of the {name} Linux distribution. Everything installed inside it lives in this one file', {
      name: distro.name,
    })),
  ];
  if (distro.disk) {
    list.push(evidence(2, m('evidence.dev.wslSize', '{size}, and all of it is really on the disk — this is not a file that claims more than it uses', {
      size: formatBytes(distro.disk.bytes),
    })));
    list.push(evidence(3, m('evidence.dev.wslWritten', 'Last written to {when}. That is when the disk changed, not when you last started the distribution — there is no way to read that without starting it', {
      when: new Date(distro.disk.writtenMs).toISOString().slice(0, 10),
    })));
  } else {
    list.push(evidence(2, m('evidence.dev.wslNoDisk', 'Its disk file is not where the registry says it is, so nothing about its size can be said')));
  }
  if (distro.belongsToDocker) {
    list.push(evidence(list.length + 1, m('evidence.dev.wslDocker', 'Docker Desktop installed this one and runs in it. Removing it uninstalls Docker’s engine, and it is not where Docker’s images are kept')));
  }
  if (machines.sparseSupported) {
    list.push(evidence(list.length + 1, m('evidence.dev.wslSparse', 'WSL {version} can make this disk give space back as it is freed inside. It has to be shut down first, and the app never runs either command', {
      version: machines.wslVersion,
    })));
  } else {
    list.push(evidence(list.length + 1, m('evidence.dev.wslOld', 'This WSL is too old to make the disk give space back on its own, so the file only ever grows')));
  }

  return {
    id: candidateId(ID, `wsl:${distro.guid}`),
    path: distro.disk ? distro.disk.path : `${distro.basePath}\\${distro.vhdName}`,
    kind: distro.disk ? 'file' : 'virtual',
    bytes: Math.max(0, Math.round(distro.bytes)),
    category: 'dev.wslDistro',
    verdict: 'review',
    confidence: distro.disk ? 'strong' : 'guess',
    evidence: list,
    actions: ['none'],
    unattendedEligible: false,
    meta: {
      kind: 'wsl',
      name: distro.name,
      version: distro.version,
      belongsToDocker: distro.belongsToDocker,
      basePath: distro.basePath,
      claimedBytes: distro.disk ? distro.disk.claimedBytes : 0,
      writtenMs: distro.disk ? distro.disk.writtenMs : null,
      steps: distro.steps,
    },
  };
}

/** Docker Desktop's data disk, which is where images and volumes live. */
function dockerCandidate(docker) {
  return {
    id: candidateId(ID, docker.path),
    path: docker.path,
    kind: 'file',
    bytes: Math.max(0, Math.round(docker.bytes)),
    category: 'dev.dockerDisk',
    verdict: 'review',
    confidence: 'strong',
    evidence: [
      evidence(1, m('evidence.dev.dockerWhat', 'Docker Desktop’s data disk: every image you have pulled, every volume, and every container that was ever built')),
      evidence(2, m('evidence.dev.dockerSize', '{size}, all of it really on the disk', { size: formatBytes(docker.bytes) })),
      evidence(3, m('evidence.dev.dockerSeparate', 'This is not the docker-desktop distribution’s own disk, which is a tenth of a gigabyte. Making that one sparse would shrink nothing here')),
      evidence(4, m('evidence.dev.dockerPrune', 'Docker clears it with its own commands. “docker system df” shows what is in it first, and the prune below removes images, volumes and stopped containers for good — none of it goes to the Recycle Bin')),
    ],
    actions: ['none'],
    unattendedEligible: false,
    meta: {
      kind: 'docker',
      name: 'Docker Desktop',
      claimedBytes: docker.claimedBytes,
      writtenMs: docker.writtenMs,
      steps: docker.steps,
    },
  };
}

const analyzer = {
  id: ID,
  feature: 'pro.dev',
  requiresElevation: false,
  categories: ['dev.packageCache', 'dev.sdk', 'dev.ideCache', 'dev.wslDistro', 'dev.dockerDisk'],

  /** @param {object} ctx  { model } from dev/measure.js */
  async *run(ctx, token) {
    const model = ctx.model;
    const rows = { packageCaches: [], sdks: [], ideCaches: [], machines: [] };

    for (const tool of model.tools) {
      if (token && token.cancelled) break;

      if (tool.kind === 'packageCache') {
        const candidate = packageCacheCandidate(tool);
        rows.packageCaches.push(candidate.id);
        yield { type: 'candidate', candidate };
        continue;
      }

      if (tool.kind === 'sdk') {
        const candidate = sdkCandidate(tool);
        rows.sdks.push(candidate.id);
        yield { type: 'candidate', candidate };
        continue;
      }

      for (const file of tool.files) {
        if (token && token.cancelled) break;
        const candidate = ideCacheCandidate(file, tool);
        rows.ideCaches.push(candidate.id);
        yield { type: 'candidate', candidate };
      }
    }

    const machines = model.machines || { distros: [], docker: null, sparseSupported: false, wslVersion: null, totalBytes: 0 };
    for (const distro of machines.distros) {
      if (token && token.cancelled) break;
      const candidate = distroCandidate(distro, machines);
      rows.machines.push(candidate.id);
      yield { type: 'candidate', candidate };
    }
    if (machines.docker) {
      const candidate = dockerCandidate(machines.docker);
      rows.machines.push(candidate.id);
      yield { type: 'candidate', candidate };
    }

    const { tools: toolList, ...rest } = model;
    const byKind = (kind) => toolList.filter((tool) => tool.kind === kind);
    yield {
      type: 'summary',
      summary: {
        ...rest,
        rows,
        // Per tool, so the screen can group without holding every candidate.
        groups: toolList.map((tool) => ({
          id: tool.id,
          name: tool.name,
          kind: tool.kind,
          bytes: tool.bytes,
          fileCount: tool.fileCount,
          isOpen: tool.isOpen,
          openProcesses: tool.openProcesses,
          command: tool.command,
          places: tool.places.map((p) => ({ dir: p.dir, bytes: p.bytes, files: p.files })),
          truncated: tool.truncated,
        })),
        totalBytes: toolList.reduce((sum, tool) => sum + tool.bytes, 0) + (machines.totalBytes || 0),
        machineBytes: machines.totalBytes || 0,
        wslVersion: machines.wslVersion,
        sparseSupported: machines.sparseSupported,
        packageCacheBytes: byKind('packageCache').reduce((sum, tool) => sum + tool.bytes, 0),
        sdkBytes: byKind('sdk').reduce((sum, tool) => sum + tool.bytes, 0),
        ideCacheBytes: byKind('ideCache').reduce((sum, tool) => sum + tool.bytes, 0),
        // What an unattended run would be allowed to take, which is nothing
        // today; said out loud so the number is not mistaken for a promise.
        freeableBytes: byKind('ideCache')
          .filter((tool) => tool.isOpen === false)
          .reduce((sum, tool) => sum + tool.bytes, 0),
      },
    };
  },
};

module.exports = { analyzer, ID, packageCacheCandidate, sdkCandidate, ideCacheCandidate, distroCandidate, dockerCandidate, WHAT };
