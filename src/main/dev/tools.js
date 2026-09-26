'use strict';

/**
 * The developer tools this build knows about, and what may be said about each.
 *
 * Only tools found on the machine this was written on are here, which is the
 * rule the known apps' caches (D4) already work under: a definition nobody has
 * checked against a real installation is a guess about somebody else's disk.
 * Absent here, and so not shipped: pnpm, yarn, uv, cargo, go and Composer.
 *
 * Three kinds, and they differ in what the app will do, not only in what they
 * hold:
 *
 *   packageCache  Downloaded packages. The tool that made them knows how to
 *                 clear them safely, so the row shows that command to copy and
 *                 the app does not delete anything. That is not timidity: a
 *                 listing of npm's cache alone took 13.8 s here and Gradle's
 *                 21.8 s, against 2.4 s for every IDE cache put together, and
 *                 `npm cache clean` knows what is safe to keep in a way a walk
 *                 of the folder never can.
 *   sdk           Whole toolchains. Removing one is the vendor's own manager's
 *                 job; the row explains and points there.
 *   ideCache      Small, regenerated, and named as caches by the tools that
 *                 write them -- these the app will move to the bin, and only
 *                 while the editor that owns them is closed.
 *
 * **The paths are exact, never a whole product folder.** `%LOCALAPPDATA%\\
 * JetBrains\\PyCharmCE2024.2` holds `caches`, `index` and `log`, and it also
 * holds `LocalHistory` -- PyCharm's record of every edit you have made, which
 * is not a cache and is not backed up anywhere. Visual Studio's folder is the
 * same story with `BackupFiles` and `SettingsBackup_*` beside its caches.
 * Anything not named here is left alone.
 *
 * Sizes measured 2026-09-26 on this machine, for the harness to check against.
 */

const path = require('node:path');

const home = (env) => env.USERPROFILE || '';
const local = (env) => env.LOCALAPPDATA || '';
const roaming = (env) => env.APPDATA || '';

/**
 * Each tool: where it keeps things, what to say, and what may be done.
 *
 *   paths       every folder, in order; a missing one is simply absent
 *   command     the tool's own way of clearing it, shown to copy, never run
 *   processes   for an ideCache, what must not be running
 *   subfolders  for an ideCache, the only names inside a product folder that
 *               may be touched
 */
const TOOLS = Object.freeze([
  {
    id: 'npm',
    name: 'npm',
    kind: 'packageCache',
    paths: [(env) => path.join(local(env), 'npm-cache')],
    command: 'npm cache clean --force',
    measured: '2.62 GB in 33,138 files',
  },
  {
    id: 'pip',
    name: 'pip',
    kind: 'packageCache',
    paths: [(env) => path.join(local(env), 'pip', 'Cache')],
    command: 'pip cache purge',
    measured: '0.37 GB in 1,700 files',
  },
  {
    id: 'maven',
    name: 'Maven',
    kind: 'packageCache',
    paths: [(env) => path.join(home(env), '.m2', 'repository')],
    // Maven ships no cache command; its own documentation says to remove the
    // repository folder, which it rebuilds on the next build.
    command: null,
    measured: '0.00 GB in 233 files',
  },
  {
    id: 'gradle',
    name: 'Gradle',
    kind: 'packageCache',
    paths: [
      (env) => path.join(home(env), '.gradle', 'caches'),
      (env) => path.join(home(env), '.gradle', 'wrapper', 'dists'),
    ],
    command: null,
    measured: '3.65 GB in 36,518 files, plus 0.56 GB of downloaded Gradle versions',
  },
  {
    id: 'nuget',
    name: 'NuGet',
    kind: 'packageCache',
    paths: [(env) => path.join(home(env), '.nuget', 'packages')],
    command: 'dotnet nuget locals all --clear',
    measured: '2.54 GB in 14,231 files',
  },

  {
    id: 'android-sdk',
    name: 'Android SDK',
    kind: 'sdk',
    paths: [(env) => path.join(local(env), 'Android', 'Sdk')],
    command: null,
    // Its own manager is a window inside Android Studio, so there is nothing
    // to hand over to but the folder itself.
    manager: 'androidStudio',
    measured: '4.25 GB in 50,179 files',
  },
  {
    id: 'dotnet-sdk',
    name: '.NET SDKs',
    kind: 'sdk',
    paths: [(env) => path.join(env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'sdk')],
    command: 'dotnet --list-sdks',
    // Old .NET SDKs are removed from Windows' own installed-apps list.
    handoff: 'apps',
    measured: '0.39 GB in 3,533 files',
  },

  {
    id: 'vscode',
    name: 'Visual Studio Code',
    kind: 'ideCache',
    paths: [
      (env) => path.join(roaming(env), 'Code', 'CachedData'),
      (env) => path.join(roaming(env), 'Code', 'CachedExtensionVSIXs'),
    ],
    processes: ['code.exe'],
    measured: '0.06 GB in 93 files, plus 0.17 GB of downloaded extension packages',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'ideCache',
    paths: [
      (env) => path.join(roaming(env), 'Cursor', 'CachedData'),
      (env) => path.join(roaming(env), 'Cursor', 'CachedExtensionVSIXs'),
    ],
    processes: ['cursor.exe'],
    measured: '0.15 GB in 533 files',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains IDEs',
    kind: 'ideCache',
    // One folder per product (`PyCharmCE2024.2`), and only these three names
    // inside it. `LocalHistory`, `plugins` and `projects` are in there too and
    // are never touched.
    productsUnder: (env) => path.join(local(env), 'JetBrains'),
    subfolders: ['caches', 'index', 'log'],
    processes: ['idea64.exe', 'pycharm64.exe', 'webstorm64.exe', 'rider64.exe', 'goland64.exe', 'clion64.exe', 'phpstorm64.exe', 'rubymine64.exe', 'datagrip64.exe', 'studio64.exe'],
    measured: '0.59 GB in 3,453 files across one product (PyCharmCE2024.2)',
  },
  {
    id: 'visualstudio',
    name: 'Visual Studio',
    kind: 'ideCache',
    paths: [
      (env) => path.join(local(env), 'Microsoft', 'VisualStudio', 'CacheService'),
      (env) => path.join(local(env), 'Microsoft', 'VisualStudio', 'WebView2Cache'),
    ],
    processes: ['devenv.exe'],
    measured: '0.34 GB in 1,786 files across the whole VisualStudio folder, of which only these two are caches',
  },
]);

const BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

/** Every tool of one kind. */
function ofKind(kind) {
  return TOOLS.filter((tool) => tool.kind === kind);
}

/** The folders a tool keeps things in, on this machine. */
function pathsOf(tool, env = process.env) {
  if (!tool.paths) return [];
  return tool.paths.map((fn) => fn(env)).filter((dir) => typeof dir === 'string' && dir && path.win32.isAbsolute(dir));
}

/**
 * Every process name that would stop an IDE cache being touched.
 *
 * Lower case, because `tasklist` and this file will not agree on it otherwise.
 */
function watchedProcesses() {
  const names = new Set();
  for (const tool of TOOLS) for (const name of tool.processes || []) names.add(name.toLowerCase());
  return names;
}

module.exports = { TOOLS, BY_ID, ofKind, pathsOf, watchedProcesses };
