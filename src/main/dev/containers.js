'use strict';

/**
 * WSL distributions and Docker Desktop's data disk (C3).
 *
 * These are the biggest single things on a developer's machine and the app
 * touches none of them: 91 GB between them here. Everything this file produces
 * is a command for the person to read and run themselves, because each of
 * these commands deletes data that never reaches the Recycle Bin.
 *
 * **The distro list comes from the registry, not from `wsl.exe`.** Windows
 * keeps every installed distribution under
 * `HKCU\\…\\Lxss\\{guid}` with its name, its version, where its disk is and
 * what that disk is called. Reading it starts nothing. The spec's route --
 * `wsl --list --verbose` -- works (71 ms here, and it did not start the
 * virtual machine) but it is a process where a registry read will do.
 *
 * **The spec's path guess is wrong on this machine, which is why the registry
 * matters.** It expects a distro under `%LOCALAPPDATA%\\Packages`; Ubuntu here
 * lives at `%LOCALAPPDATA%\\wsl\\{e0b47061-…}`, the location newer WSL builds
 * use. `BasePath` says so and no guess has to.
 *
 * **Docker's data disk is not a WSL distro's disk.** The `docker-desktop`
 * distribution's own `ext4.vhdx` is 0.10 GB here; the 57.65 GB is
 * `Docker\\wsl\\disk\\docker_data.vhdx`, which is where images and volumes
 * live. Telling somebody to make the distro's disk sparse would shrink the
 * wrong file by nothing. They are separate rows with separate advice.
 *
 * Measured 2026-09-26 on this machine: Ubuntu 33.47 GB, docker-desktop
 * 0.10 GB, Docker data 57.65 GB -- and every one of them **100% allocated**,
 * so those are real occupied bytes rather than a sparse file's claim.
 *
 * Only reads.
 */

const path = require('node:path');
const { execFile } = require('node:child_process');

const { fsp } = require('../lib/real-fs');
const { exportKey } = require('../apps/registry');

const LXSS = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss';

/** By absolute path, with fixed arguments, and only ever to ask a question. */
const wslExe = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');

/** `--set-sparse` arrived in WSL 2; older builds need a different answer. */
const SPARSE_FROM_MAJOR = 2;

/**
 * Which WSL is installed, if any.
 *
 * The one process this file starts, and it only prints version numbers.
 * Needed because the advice depends on it: `wsl --manage <distro>
 * --set-sparse true` exists on 2.x and does not on 1.x, and recommending a
 * command that does not exist is worse than recommending nothing.
 */
function wslVersion(deps = {}) {
  if (deps.wslVersion) return Promise.resolve(deps.wslVersion());
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(wslExe(), ['--version'], { windowsHide: true, timeout: 20000, encoding: 'buffer', maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      // wsl.exe writes UTF-16LE.
      const text = (stdout || Buffer.alloc(0)).toString('utf16le').replace(/\0/g, '');
      const match = /WSL\s*version:\s*([\d.]+)/i.exec(text);
      resolve(match ? match[1] : null);
    });
  });
}

/** A `\\?\C:\x` path as `C:\x`. */
const plain = (value) => String(value || '').replace(/^\\\\\?\\/, '');

/**
 * Every installed distribution, from the registry.
 *
 * @returns {Promise<object[]>}
 */
async function readDistros(deps = {}) {
  const keys = await (deps.exportKey || exportKey)(LXSS);
  if (!keys) return [];

  const out = [];
  for (const [keyPath, values] of Object.entries(keys)) {
    const guid = keyPath.slice(keyPath.lastIndexOf('\\') + 1);
    if (!/^\{[0-9a-fA-F-]{36}\}$/.test(guid)) continue;
    const name = typeof values.DistributionName === 'string' ? values.DistributionName : null;
    const base = plain(values.BasePath);
    if (!name || !base) continue;
    out.push({
      guid,
      name,
      version: typeof values.Version === 'number' ? values.Version : 0,
      basePath: base,
      vhdName: typeof values.VhdFileName === 'string' && values.VhdFileName ? values.VhdFileName : 'ext4.vhdx',
      // Docker installs its own distribution; unregistering it is not a
      // disk-space decision, it is uninstalling Docker's engine.
      belongsToDocker: /^docker-desktop/i.test(name),
    });
  }
  return out;
}

/** What a virtual disk claims and what it occupies. */
async function diskFacts(file) {
  try {
    const stat = await fsp.stat(file);
    return {
      path: file,
      bytes: Number.isFinite(stat.blocks) ? stat.blocks * 512 : stat.size,
      claimedBytes: stat.size,
      // When the disk was last written, which is the closest thing to "last
      // used" that can be read without starting the distribution. It is not
      // the last boot and the screen does not call it one.
      writtenMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * Docker Desktop's own data disk, which is not any distribution's disk.
 */
async function dockerDisk(env = process.env) {
  const local = env.LOCALAPPDATA || '';
  if (!local) return null;
  for (const relative of [
    ['Docker', 'wsl', 'disk', 'docker_data.vhdx'],
    ['Docker', 'wsl', 'data', 'ext4.vhdx'],
  ]) {
    const facts = await diskFacts(path.join(local, ...relative));
    if (facts) return facts;
  }
  return null;
}

/**
 * The steps for a distribution, in the order they have to happen.
 *
 * Every one of these is shown to be read and copied. The app runs none of
 * them: each deletes something that does not go to the Recycle Bin.
 */
function stepsFor(distro, { wslMajor }) {
  const steps = [];
  const quoted = /\s/.test(distro.name) ? `"${distro.name}"` : distro.name;

  steps.push({ id: 'shutdown', command: 'wsl --shutdown' });
  if (wslMajor >= SPARSE_FROM_MAJOR) {
    steps.push({ id: 'sparse', command: `wsl --manage ${quoted} --set-sparse true` });
  }
  if (!distro.belongsToDocker) {
    steps.push({ id: 'unregister', command: `wsl --unregister ${quoted}`, destroys: true });
  }
  return steps;
}

/** What Docker's own data disk needs, which is Docker's own commands. */
function dockerSteps() {
  return [
    { id: 'df', command: 'docker system df' },
    { id: 'prune', command: 'docker system prune -a --volumes', destroys: true },
  ];
}

/**
 * Everything C3 is drawn from.
 */
async function scan({ env = process.env, deps = {} } = {}) {
  const version = await wslVersion(deps);
  const wslMajor = version ? Number(version.split('.')[0]) || 0 : 0;

  const distros = [];
  for (const distro of await readDistros(deps)) {
    const facts = await diskFacts(path.join(distro.basePath, distro.vhdName));
    distros.push({
      ...distro,
      disk: facts,
      bytes: facts ? facts.bytes : 0,
      steps: stepsFor(distro, { wslMajor }),
    });
  }

  const docker = await dockerDisk(env);

  return {
    wslVersion: version,
    wslMajor,
    sparseSupported: wslMajor >= SPARSE_FROM_MAJOR,
    distros,
    docker: docker ? { ...docker, steps: dockerSteps() } : null,
    totalBytes: distros.reduce((sum, d) => sum + d.bytes, 0) + (docker ? docker.bytes : 0),
  };
}

module.exports = { scan, readDistros, dockerDisk, diskFacts, wslVersion, stepsFor, dockerSteps, LXSS, SPARSE_FROM_MAJOR };
