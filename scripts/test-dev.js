#!/usr/bin/env node
'use strict';

// The Developer Pack (C2, C4): which tools are known, what the definitions are
// allowed to touch, and the rows the screen is drawn from.
//
//   node scripts/test-dev.js
//
// The definitions name exact folders, so most of this is about what they must
// NOT reach: a JetBrains product folder holds `LocalHistory` -- every edit you
// have made, backed up nowhere -- beside its caches, and Visual Studio's holds
// `BackupFiles` and `SettingsBackup_*`. A folder tree is built here with those
// beside the caches, and the scan has to walk past them.
//
// Where a check needs the real machine it says so; the sizes in tools.js were
// measured on it and this harness checks the shape, not those numbers.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const tools = require('../src/main/dev/tools');
const devMeasure = require('../src/main/dev/measure');
const devAnalyzer = require('../src/main/analyzers/dev');
const containers = require('../src/main/dev/containers');
const analyzers = require('../src/main/analyzers');
const { validateCandidate } = require('../src/main/analyzers/contract');
const { isAllowedUnattended } = require('../src/main/automatic/allowed-categories');
const { can } = require('../src/main/license/entitlements');
const { currentLicense } = require('../src/main/license/state');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/* -------------------------------------------------------------------------- */
/* the definitions                                                            */
/* -------------------------------------------------------------------------- */

console.log('\ndeveloper: what this build claims to know\n');

{
  check('every tool has an id, a name and a kind',
    tools.TOOLS.every((tool) => tool.id && tool.name && ['packageCache', 'sdk', 'ideCache'].includes(tool.kind)),
    tools.TOOLS.map((tool) => `${tool.id}:${tool.kind}`).join(', '));
  check('no two tools share an id', new Set(tools.TOOLS.map((tool) => tool.id)).size === tools.TOOLS.length);
  check('every tool says what it measured on the machine it was written on',
    tools.TOOLS.every((tool) => typeof tool.measured === 'string' && tool.measured.length > 4));

  // D4's rule: a definition nobody has checked against a real installation is
  // a guess about somebody else's disk.
  const shipped = new Set(tools.TOOLS.map((tool) => tool.id));
  for (const absent of ['pnpm', 'yarn', 'uv', 'cargo', 'go', 'composer']) {
    check(`${absent} is not shipped, since this machine has none to check against`, !shipped.has(absent));
  }

  check('every editor cache names the processes that must be closed',
    tools.ofKind('ideCache').every((tool) => Array.isArray(tool.processes) && tool.processes.length > 0),
    tools.ofKind('ideCache').map((tool) => `${tool.id}:${(tool.processes || []).length}`).join(', '));
  check('and those names are lower case, which is how the process list arrives',
    [...tools.watchedProcesses()].every((name) => name === name.toLowerCase()));
  check('no package cache or SDK claims to be closable by closing something',
    tools.TOOLS.filter((tool) => tool.kind !== 'ideCache').every((tool) => !tool.processes));

  // A command that is shown to be copied is a command somebody may run.
  const commands = tools.TOOLS.map((tool) => tool.command).filter(Boolean);
  check('every command shown is one of the tools\u2019 own documented ones',
    commands.every((command) => /^(npm|pip|dotnet|pnpm|yarn|go|cargo) /.test(command)), commands.join(' | '));
  check('and none of them removes anything by path',
    !commands.some((command) => /[\\/]|rm |del |rmdir/i.test(command)), commands.join(' | '));
}

{
  // The paths are absolute and come from the environment, never from a scan.
  const env = { USERPROFILE: 'C:\\Users\\X', LOCALAPPDATA: 'C:\\Users\\X\\AppData\\Local', APPDATA: 'C:\\Users\\X\\AppData\\Roaming', ProgramFiles: 'C:\\Program Files' };
  for (const tool of tools.TOOLS) {
    if (!tool.paths) continue;
    const dirs = tools.pathsOf(tool, env);
    check(`${tool.id}: every folder is absolute and inside the given environment`,
      dirs.length > 0 && dirs.every((dir) => path.win32.isAbsolute(dir) && (dir.startsWith('C:\\Users\\X') || dir.startsWith('C:\\Program Files'))),
      dirs.join(' | '));
  }
  check('an empty environment yields no folders rather than relative ones',
    tools.TOOLS.filter((tool) => tool.paths).every((tool) => tools.pathsOf(tool, {}).every((dir) => path.win32.isAbsolute(dir))));
}

/* -------------------------------------------------------------------------- */
/* a tree built to look like a developer's machine                            */
/* -------------------------------------------------------------------------- */

const file = async (full, bytes) => {
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, Buffer.alloc(bytes, 7));
};

async function main() {
  console.log('\ndeveloper: what the scan reaches, and what it walks past\n');

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-dev-'));
  try {
    const local = path.join(root, 'AppData', 'Local');
    const roaming = path.join(root, 'AppData', 'Roaming');
    const programFiles = path.join(root, 'Program Files');
    const env = { USERPROFILE: root, LOCALAPPDATA: local, APPDATA: roaming, ProgramFiles: programFiles };

    // Package caches.
    await file(path.join(local, 'npm-cache', '_cacache', 'content-v2', 'a.bin'), 4096);
    await file(path.join(root, '.gradle', 'caches', 'modules-2', 'b.jar'), 8192);
    await file(path.join(root, '.nuget', 'packages', 'newtonsoft.json', '13.0.3', 'c.nupkg'), 2048);

    // An SDK.
    await file(path.join(local, 'Android', 'Sdk', 'platforms', 'android-34', 'd.jar'), 16384);

    // An editor cache, with the things that are not caches beside it.
    await file(path.join(roaming, 'Code', 'CachedData', '1a2b3c', 'e.code'), 1024);
    await file(path.join(roaming, 'Code', 'CachedExtensionVSIXs', 'ext.vsix'), 2048);
    await file(path.join(roaming, 'Code', 'User', 'settings.json'), 512);
    await file(path.join(roaming, 'Code', 'User', 'globalStorage', 'state.vscdb'), 4096);

    // JetBrains: three folders that may be touched, and three that never are.
    const jb = path.join(local, 'JetBrains', 'PyCharmCE2024.2');
    for (const name of ['caches', 'index', 'log']) await file(path.join(jb, name, 'f.bin'), 1024);
    for (const name of ['LocalHistory', 'plugins', 'projects']) await file(path.join(jb, name, 'precious.bin'), 4096);

    // Visual Studio: two caches, two backups.
    const vs = path.join(local, 'Microsoft', 'VisualStudio');
    await file(path.join(vs, 'CacheService', 'g.bin'), 1024);
    await file(path.join(vs, 'WebView2Cache', 'h.bin'), 1024);
    await file(path.join(vs, 'BackupFiles', 'recovered.cs'), 8192);
    await file(path.join(vs, 'SettingsBackup_9ea411bd', 'settings.vssettings'), 4096);

    // The container half reads the registry and runs `wsl --version`; both are
    // injected so this harness never depends on what is installed here.
    const noMachines = { exportKey: async () => null, wslVersion: async () => null };
    const model = await devMeasure.scan({ env, deps: { runningProcessNames: async () => new Set(['explorer.exe']), ...noMachines } });

    const found = new Set(model.tools.map((tool) => tool.id));
    check('the caches that are there are found',
      ['npm', 'gradle', 'nuget', 'android-sdk', 'vscode', 'jetbrains', 'visualstudio'].every((id) => found.has(id)),
      [...found].join(', '));
    check('and the ones that are not there are reported as looked for, not silently dropped',
      model.missing.some((tool) => tool.id === 'pip') && model.missing.some((tool) => tool.id === 'cursor'),
      model.missing.map((tool) => tool.id).join(', '));

    const listed = model.tools.flatMap((tool) => tool.files.map((f) => f.path));
    check('nothing outside a named cache folder is ever listed',
      !listed.some((p) => /LocalHistory|plugins|projects|BackupFiles|SettingsBackup|settings\.json|globalStorage/.test(p)),
      listed.filter((p) => /LocalHistory|plugins|BackupFiles|settings\.json/.test(p)).join(', ') || 'none');
    check('JetBrains reaches exactly caches, index and log',
      model.tools.find((tool) => tool.id === 'jetbrains').files.length === 3,
      String(model.tools.find((tool) => tool.id === 'jetbrains').files.length));
    check('and it names the product folder it found them under',
      model.tools.find((tool) => tool.id === 'jetbrains').places.every((p) => /PyCharmCE2024\.2\\(caches|index|log)$/.test(p.label) || /PyCharmCE2024\.2/.test(p.dir)),
      model.tools.find((tool) => tool.id === 'jetbrains').places.map((p) => p.label).join(', '));
    check('Visual Studio reaches its two caches and neither backup',
      model.tools.find((tool) => tool.id === 'visualstudio').files.length === 2);

    check('a package cache is measured but never listed',
      model.tools.filter((tool) => tool.kind === 'packageCache').every((tool) => tool.bytes > 0 && tool.files.length === 0),
      model.tools.filter((tool) => tool.kind === 'packageCache').map((tool) => `${tool.id}:${tool.files.length}`).join(', '));
    check('an SDK is measured but never listed',
      model.tools.filter((tool) => tool.kind === 'sdk').every((tool) => tool.bytes > 0 && tool.files.length === 0));
    check('an editor cache is listed, because that is the half the app will move',
      model.tools.filter((tool) => tool.kind === 'ideCache').every((tool) => tool.files.length > 0));

    /* ---- the rows ---- */

    console.log('\ndeveloper: the rows the screen is drawn from\n');

    const out = await analyzers.collect('dev', { model }, { strict: true, can: () => true });
    for (const c of out.candidates) validateCandidate(c);
    check('every row validates as a candidate', out.summary.rejected === 0 && out.candidates.length > 0, `${out.candidates.length} rows`);
    check('the categories are the five this screen declared',
      out.candidates.every((c) => ['dev.packageCache', 'dev.sdk', 'dev.ideCache', 'dev.wslDistro', 'dev.dockerDisk'].includes(c.category)),
      [...new Set(out.candidates.map((c) => c.category))].join(', '));

    const packageRows = out.candidates.filter((c) => c.category === 'dev.packageCache');
    check('a package cache is one row for the whole cache, not one per file',
      packageRows.length === model.tools.filter((tool) => tool.kind === 'packageCache').length, String(packageRows.length));
    check('it is never called safe, because the app is not the one deciding',
      packageRows.every((c) => c.verdict === 'review'), [...new Set(packageRows.map((c) => c.verdict))].join(', '));
    check('and it offers nothing to click that deletes',
      packageRows.every((c) => c.actions.join() === 'none'), [...new Set(packageRows.flatMap((c) => c.actions))].join(', '));
    check('a cache whose tool has a command shows it',
      packageRows.filter((c) => c.meta.command).every((c) => c.evidence.some((e) => e.i18n === 'evidence.dev.command')));
    check('and one whose tool has none says so instead',
      packageRows.filter((c) => !c.meta.command).every((c) => c.evidence.some((e) => e.i18n === 'evidence.dev.noCommand')));

    const ideRows = out.candidates.filter((c) => c.category === 'dev.ideCache');
    check('with the editor closed, its cache is safe and may go to the bin',
      ideRows.length > 0 && ideRows.every((c) => c.verdict === 'safe' && c.actions.join() === 'recycle'),
      `${ideRows.length} rows, ${[...new Set(ideRows.map((c) => c.verdict))].join(', ')}`);
    check('nothing on this screen is ever part of an unattended run',
      out.candidates.every((c) => c.unattendedEligible === false && !isAllowedUnattended(c.category)));

    /* ---- the editor being open, and the process list being unreadable ---- */

    for (const [label, names, verdict, actions] of [
      ['open', new Set(['code.exe']), 'keep', 'none'],
      ['unreadable', null, 'keep', 'none'],
    ]) {
      const other = await devMeasure.scan({ env, deps: { runningProcessNames: async () => names, ...noMachines } });
      const rows = await analyzers.collect('dev', { model: other }, { strict: true, can: () => true });
      const vscode = rows.candidates.filter((c) => c.meta.toolId === 'vscode');
      check(`with the editor ${label}, its cache is ${verdict} and offers ${actions}`,
        vscode.length > 0 && vscode.every((c) => c.verdict === verdict && c.actions.join() === actions),
        vscode.map((c) => `${c.verdict}/${c.actions.join()}`).slice(0, 2).join(', '));
      if (label === 'open') {
        const cursorLike = rows.candidates.filter((c) => c.meta.toolId === 'jetbrains');
        check('and another editor that is closed is unaffected',
          cursorLike.every((c) => c.verdict === 'safe'), [...new Set(cursorLike.map((c) => c.verdict))].join(', '));
      }
      if (label === 'unreadable') {
        check('and the screen is told the list could not be read', other.processesReadable === false);
        check('so nothing at all is offered for removal',
          rows.candidates.filter((c) => c.category === 'dev.ideCache').every((c) => c.actions.join() === 'none'));
      }
    }

    /* ---- a machine with none of it ---- */

    const bare = path.join(root, 'bare');
    await fsp.mkdir(bare, { recursive: true });
    const nothing = await devMeasure.scan({
      env: { USERPROFILE: bare, LOCALAPPDATA: path.join(bare, 'l'), APPDATA: path.join(bare, 'r'), ProgramFiles: path.join(bare, 'p') },
      deps: { runningProcessNames: async () => new Set(), ...noMachines },
    });
    check('a machine with no developer tools says so rather than failing',
      nothing.tools.length === 0 && nothing.missing.length === tools.TOOLS.length,
      `${nothing.tools.length} found, ${nothing.missing.length} looked for`);
    const empty = await analyzers.collect('dev', { model: nothing }, { strict: true, can: () => true });
    check('and produces no rows and a total of zero',
      empty.candidates.length === 0 && empty.summary.totalBytes === 0 && empty.summary.groups.length === 0);

    /* ---- WSL and Docker (C3) ---- */

    console.log('\ndeveloper: Linux and container disks\n');

    {
      // The registry is the source, so a distro is described without starting
      // anything. Its shape here is the real one from this machine, with the
      // paths pointed at the harness's own folders.
      const ubuntuDir = path.join(root, 'wsl', '{e0b47061-d036-4d86-ab46-bdfc443c4c0c}');
      const dockerDir = path.join(root, 'AppData', 'Local', 'Docker', 'wsl', 'main');
      await file(path.join(ubuntuDir, 'ext4.vhdx'), 32768);
      await file(path.join(dockerDir, 'ext4.vhdx'), 4096);
      await file(path.join(root, 'AppData', 'Local', 'Docker', 'wsl', 'disk', 'docker_data.vhdx'), 65536);

      const lxss = {
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss': { DefaultVersion: 2 },
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{e0b47061-d036-4d86-ab46-bdfc443c4c0c}': {
          State: 1, DistributionName: 'Ubuntu', Version: 2, BasePath: ubuntuDir, VhdFileName: 'ext4.vhdx',
        },
        // Docker's own distribution arrives with the `\\?\` prefix, as it does here.
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{6150eddf-6ad2-4f61-8ec3-c559f825026e}': {
          State: 1, DistributionName: 'docker-desktop', Version: 2, BasePath: `\\\\?\\${dockerDir}`, VhdFileName: 'ext4.vhdx',
        },
        // A stray subkey that is not a distribution.
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\AppxInstallerCache': { Something: 1 },
      };
      const withWsl = { exportKey: async () => lxss, wslVersion: async () => '2.7.14.0' };

      const machines = await containers.scan({ env, deps: withWsl });
      check('both distributions are read from the registry, without starting anything',
        machines.distros.length === 2 && machines.distros.some((d) => d.name === 'Ubuntu'),
        machines.distros.map((d) => d.name).join(', '));
      check('a subkey that is not a distribution is skipped',
        !machines.distros.some((d) => /AppxInstallerCache/.test(d.name)));
      check('the \\\\?\\ prefix on a base path is taken off before it is used',
        machines.distros.every((d) => !d.basePath.startsWith('\\\\?\\') && d.disk),
        machines.distros.map((d) => d.basePath).join(' | '));
      check('Docker\u2019s own distribution is recognised as Docker\u2019s',
        machines.distros.find((d) => d.name === 'docker-desktop').belongsToDocker &&
          !machines.distros.find((d) => d.name === 'Ubuntu').belongsToDocker);
      check('Docker\u2019s data disk is found, and it is not the distribution\u2019s disk',
        machines.docker && /docker_data\.vhdx$/.test(machines.docker.path) &&
          machines.docker.bytes > machines.distros.find((d) => d.name === 'docker-desktop').bytes,
        machines.docker ? machines.docker.path : 'not found');

      // The steps, and who gets which.
      const ubuntu = machines.distros.find((d) => d.name === 'Ubuntu');
      const dockerDistro = machines.distros.find((d) => d.name === 'docker-desktop');
      check('a distribution is told to shut down before anything else',
        ubuntu.steps[0].id === 'shutdown' && ubuntu.steps[0].command === 'wsl --shutdown');
      check('and on WSL 2 it is offered the sparse switch this machine really has',
        ubuntu.steps.some((step) => step.command === 'wsl --manage Ubuntu --set-sparse true'),
        ubuntu.steps.map((step) => step.command).join(' | '));
      check('the step that destroys everything is marked as destroying everything',
        ubuntu.steps.find((step) => step.id === 'unregister').destroys === true);
      check('Docker\u2019s own distribution is never offered an unregister',
        !dockerDistro.steps.some((step) => step.id === 'unregister'),
        dockerDistro.steps.map((step) => step.id).join(', '));
      check('and Docker\u2019s data disk is cleared with Docker\u2019s own commands',
        machines.docker.steps.map((step) => step.command).join(' | ') === 'docker system df | docker system prune -a --volumes');

      // An old WSL must not be told to use a switch it does not have.
      const old = await containers.scan({ env, deps: { exportKey: async () => lxss, wslVersion: async () => '1.0.0.0' } });
      check('an older WSL is not told to use a switch it does not have',
        old.sparseSupported === false &&
          !old.distros.some((d) => d.steps.some((step) => step.id === 'sparse')),
        old.distros.flatMap((d) => d.steps.map((step) => step.id)).join(', '));
      const none = await containers.scan({ env, deps: { exportKey: async () => null, wslVersion: async () => null } });
      check('a machine with no WSL at all says so rather than failing',
        none.distros.length === 0 && none.sparseSupported === false && none.totalBytes >= 0);

      const full = await devMeasure.scan({ env, deps: { runningProcessNames: async () => new Set(['explorer.exe']), ...withWsl } });
      const rows = await analyzers.collect('dev', { model: full }, { strict: true, can: () => true });
      const machineRows = rows.candidates.filter((c) => ['dev.wslDistro', 'dev.dockerDisk'].includes(c.category));
      for (const c of machineRows) validateCandidate(c);
      check('every disk becomes a row', machineRows.length === 3, String(machineRows.length));
      check('and not one of them offers anything to click that acts',
        machineRows.every((c) => c.actions.join() === 'none' && c.verdict === 'review' && !c.unattendedEligible),
        [...new Set(machineRows.map((c) => `${c.verdict}/${c.actions.join()}`))].join(', '));
      check('their sizes are in the screen\u2019s total',
        rows.summary.machineBytes > 0 && rows.summary.totalBytes >= rows.summary.machineBytes,
        `${rows.summary.machineBytes} of ${rows.summary.totalBytes}`);
      check('Docker\u2019s row says it is not the distribution\u2019s disk',
        machineRows.find((c) => c.category === 'dev.dockerDisk').evidence.some((e) => e.i18n === 'evidence.dev.dockerSeparate'));
      check('and a distribution\u2019s row does not call the file date a last boot',
        machineRows.filter((c) => c.category === 'dev.wslDistro')
          .every((c) => c.evidence.some((e) => e.i18n === 'evidence.dev.wslWritten')));
    }

    /* ---- the licence ---- */

    console.log('\ndeveloper: who gets this screen\n');

    const free = await analyzers.collect('dev', { model }, { can: (f) => can({ state: 'free' }, f) });
    check('Free gets no rows, and is told which feature it is',
      free.candidates.length === 0 && free.locked === 'pro.dev', `locked=${free.locked}`);
    check('Pro alone is not enough: this is the dev add-on',
      !can({ state: 'active', tier: 'pro', addons: [] }, 'pro.dev') &&
        can({ state: 'active', tier: 'pro', addons: ['dev'] }, 'pro.dev'));
    check('Business includes it without the add-on', can({ state: 'active', tier: 'business' }, 'pro.dev'));
    // Decided 2026-09-26, like Pro before it: open until Phase 6.
    const stable = currentLicense({ channel: 'stable', env: {} });
    check('a release build has the dev add-on open today, and the key still exists to take it back',
      can(stable, 'pro.dev') && stable.addons.includes('dev') && !can(stable, 'biz.cli'),
      JSON.stringify(stable));
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
