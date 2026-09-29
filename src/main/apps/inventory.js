'use strict';

/**
 * What the registry and the Store listing actually mean.
 *
 * `registry.js` and `store.js` read; this file decides. Three decisions live
 * here, and each one was measured on the machine this was written on before it
 * was written down.
 *
 * **Which entries are apps.** There are 638 keys under the three Uninstall
 * hives here and 162 programs a person would say they have installed. The
 * difference is not noise to be filtered by taste: Windows' own Installed apps
 * list applies rules, and the same ones are applied here -- an entry needs a
 * `DisplayName`, must not be flagged `SystemComponent` (406 of them are:
 * redistributables, runtimes, driver packages), must not name a `ParentKeyName`
 * (it is then a component of another entry), and must not be an update
 * (`ReleaseType` of `Security Update`, `Update Rollup` and so on; 16 here).
 * The ones left out are counted and said out loud rather than quietly dropped.
 *
 * **What an app's size is.** Two numbers, never one, and never added together:
 *
 *   measured   the install folder walked, the way the System screen walks
 *              anything -- allocation on disk, hard links counted once
 *   declared   `EstimatedSize`, which is whatever the installer wrote there
 *
 * They disagree badly. Of the 36 apps here that have both, only 24 are within
 * a factor of two either way: NVM for Windows declares 19 MB and occupies 482
 * MB, Microsoft Edge declares 3,080 MB and occupies 634 MB. So the declared
 * figure is shown as a declaration, with the installer named as its source, and
 * it is never what a total is built from. Only 69 of the 162 apps name an
 * install folder at all, and 58 of those folders still exist -- so most of this
 * list has no measured size, and the screen says so rather than filling the
 * gap with the installer's claim.
 *
 * **Which folders belong to an app.** An app's own data lives under `AppData`
 * or `ProgramData` in a folder named by whoever wrote the installer. Matching
 * is done against the strings the app gives about itself -- its name, its
 * publisher, the folder it installed into, the executable its uninstaller
 * names -- and a folder that two apps both claim is given to neither. Measured
 * here: 275 folders under the three roots, 58 matched to exactly one app, 9
 * claimed by two or more (`Microsoft`, `Lenovo`, `Lenovo_Group_Ltd`) and
 * refused.
 *
 * Nothing here is ever `safe`, and nothing here is ever acted on: the app's
 * whole part in uninstalling something is opening Windows' list and showing
 * the command the app's own uninstaller registered.
 */

const path = require('node:path');

const { pathKey } = require('../lib/util');

/** Update entries carry one of these; a real program carries none or `Application`. */
const RELEASE_TYPES_HIDDEN = Object.freeze(['Security Update', 'Update Rollup', 'Update', 'Hotfix', 'ServicePack']);

/** Where an app's data folder can be. */
function dataRoots(env = process.env) {
  const home = env.USERPROFILE || '';
  return [
    { key: 'roaming', dir: env.APPDATA || (home ? path.join(home, 'AppData', 'Roaming') : '') },
    { key: 'local', dir: env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '') },
    { key: 'programData', dir: env.ProgramData || 'C:\\ProgramData' },
  ].filter((r) => r.dir);
}

/** Comparable form of a name: case and punctuation carry no meaning here. */
const token = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Executable names too many installers share to identify anything.
 *
 * No folder is called one of these, so leaving them in would cost little
 * directly -- they are named here to make it plain that the uninstaller of
 * an Inno Setup program says nothing about which program it belongs to.
 */
const GENERIC_EXES = new Set(['unins000', 'unins001', 'uninstall', 'uninst', 'uninstaller', 'setup', 'install', 'update', 'msiexec']);

/** `"C:\x\setup.exe" /S` -> `setup`. The first executable a command line names. */
function exeToken(command) {
  const match = /([^\\/"'\s]+)\.exe/i.exec(String(command || ''));
  return match ? token(match[1]) : '';
}

/** An install location as written, cleaned of quotes and a trailing slash. */
function cleanLocation(value) {
  const text = String(value || '').trim().replace(/^"(.*)"$/, '$1').trim();
  if (!text || !/^[A-Za-z]:\\/.test(text)) return '';
  const trimmed = text.replace(/[\\/]+$/, '');
  try {
    return path.win32.normalize(trimmed);
  } catch {
    return '';
  }
}

/** Is this path inside that one? */
function isInside(child, parent) {
  if (!child || !parent) return false;
  const a = pathKey(child);
  const b = pathKey(parent);
  return a === b || a.startsWith(b.endsWith('\\') ? b : `${b}\\`);
}

/**
 * When Windows says a program was installed, as a moment rather than a string.
 *
 * `InstallDate` is whatever the installer wrote, and on this machine that is
 * three different things. Counted across the three Uninstall hives: **505 of
 * 581** entries carry it, 87%, almost all as `YYYYMMDD` -- and the rest as
 * `2025/10/06`, as `5/6/2025`, and as `20260928` with trailing spaces. The
 * trim above deals with the last of those; the two slash forms are read here.
 *
 * Anything it cannot read is null, and a null simply means the row says
 * nothing about when it was installed. Guessing a date for a program somebody
 * might uninstall on the strength of it is not worth 13%.
 *
 * @returns {number|null} epoch ms at local midnight, or null
 */
function parseInstallDate(raw) {
  const text = String(raw || '').trim();
  if (text === '') return null;

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  // `YYYY/MM/DD` and `YYYY-MM-DD`: unambiguous, so read as written.
  const iso = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text);
  // `M/D/YYYY`. Ambiguous with `D/M/YYYY` and nothing in the registry says
  // which, so it is read the way Windows itself writes it -- month first --
  // and a value that cannot be a month is refused rather than swapped.
  const short = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);

  let year;
  let month;
  let day;
  if (compact) [, year, month, day] = compact;
  else if (iso) [, year, month, day] = iso;
  else if (short) [, month, day, year] = short;
  else return null;

  year = Number(year);
  month = Number(month);
  day = Number(day);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Windows did not exist before 1980 and a date in the future is a clock
  // that was wrong when the installer ran.
  if (year < 1980 || year > new Date().getFullYear() + 1) return null;

  const at = new Date(year, month - 1, day);
  // Rejects 31 February, which `Date` would roll forward into March.
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) return null;
  return at.getTime();
}

/**
 * One Uninstall entry, read as a program.
 *
 * `hidden` is why Windows would not show it, or null when it would.
 */
function fromRegistryEntry(entry) {
  const v = entry.values || {};
  const str = (name) => (typeof v[name] === 'string' ? v[name].trim() : '');
  const num = (name) => (typeof v[name] === 'number' ? v[name] : 0);

  const name = str('DisplayName');
  const releaseType = str('ReleaseType');

  let hidden = null;
  if (!name) hidden = 'noName';
  else if (num('SystemComponent') === 1) hidden = 'systemComponent';
  else if (str('ParentKeyName')) hidden = 'partOfAnother';
  else if (releaseType && RELEASE_TYPES_HIDDEN.includes(releaseType)) hidden = 'update';

  const location = cleanLocation(str('InstallLocation'));
  const uninstall = str('QuietUninstallString') || str('UninstallString');

  // Steam writes a `Steam App <appid>` entry per game, and what it writes
  // there goes stale: three of them on this machine name `E:\SteamLibrary`,
  // a drive that no longer exists, because the library was moved to D: and
  // nothing went back to fix them. One even holds the game's Vietnamese name
  // as mojibake while the manifest beside the game has it right. So the row
  // is marked as a game and stops claiming anything about where it is; the
  // Games screen reads Steam's own files and knows.
  const steamAppId = /^Steam App (\d+)$/i.exec(entry.id);

  return {
    id: `reg:${entry.hive}:${entry.id}`,
    source: 'registry',
    hive: entry.hive,
    key: entry.id,
    name: name || entry.id,
    publisher: str('Publisher'),
    version: str('DisplayVersion'),
    installDate: str('InstallDate'),
    installedAt: parseInstallDate(str('InstallDate')),
    installLocation: location,
    // The icon is the best name an app gives for itself: Visual Studio Code
    // is registered as "Microsoft Visual Studio Code (User)" and keeps its
    // data in `AppData\Roaming\Code`, and `DisplayIcon` is the only field
    // that says `Code.exe`.
    displayIcon: str('DisplayIcon'),
    // EstimatedSize is in KB, and it is the installer's own claim.
    declaredBytes: num('EstimatedSize') * 1024,
    uninstallCommand: uninstall,
    // Windows' own "this cannot be removed from here" flag.
    noRemove: num('NoRemove') === 1,
    steamAppId: steamAppId ? steamAppId[1] : null,
    windowsInstaller: num('WindowsInstaller') === 1,
    hidden,
  };
}

/** One Store package, read as a program. */
function fromStorePackage(pkg, { readableName }) {
  return {
    id: `store:${pkg.familyName || pkg.fullName}`,
    source: 'store',
    name: readableName(pkg.name),
    packageName: pkg.name,
    publisher: pkg.publisher,
    version: pkg.version,
    installLocation: cleanLocation(pkg.location),
    declaredBytes: 0,
    uninstallCommand: '',
    signature: pkg.signature,
    noRemove: pkg.nonRemovable,
    // A package Windows signed as part of itself is not the person's app.
    hidden: null,
  };
}

/**
 * Is this part of Windows rather than something the person installed?
 *
 * Each reason is a fact from the entry itself, so the screen can say which
 * one it was instead of asserting that the app is "a system app".
 */
function protectionOf(app, { windowsDir }) {
  if (app.source === 'store' && app.signature === 'System') return 'systemPackage';
  if (app.noRemove) return 'noRemove';
  if (app.installLocation && isInside(app.installLocation, windowsDir)) return 'inWindows';
  if (app.source === 'registry' && !app.uninstallCommand) return 'noUninstaller';
  return null;
}

/**
 * Every string an app offers as a name for its own folders.
 *
 * Its display name with a trailing version dropped ("DBeaver 26.1.1" ->
 * "DBeaver"), its publisher, the folder it installed into, and the executable
 * its uninstaller or its icon names -- which is what catches `AppData\Code`
 * for Visual Studio Code, whose display name matches nothing.
 */
function identifiersOf(app) {
  const strong = new Set();
  const weak = new Set();

  if (app.installLocation) strong.add(token(path.win32.basename(app.installLocation)));
  // Both, not the first of the two: an Inno Setup program's uninstaller is
  // always `unins000.exe`, and taking that and stopping would throw away the
  // one distinctive name the entry has.
  for (const exe of [exeToken(app.uninstallCommand), exeToken(app.displayIcon)]) {
    if (exe && !GENERIC_EXES.has(exe)) strong.add(exe);
  }
  if (app.packageName) {
    strong.add(token(app.packageName));
    strong.add(token(String(app.packageName).split('.').pop()));
  }

  if (app.name) {
    weak.add(token(app.name));
    weak.add(token(String(app.name).replace(/\s+\(?[vV]?\d[\d.]*\)?\s*$/, '')));
    weak.add(token(String(app.name).replace(/\s*\((?:User|Machine|x86|x64|64-bit|32-bit)\)\s*$/i, '')));
  }
  if (app.publisher) weak.add(token(app.publisher));

  strong.delete('');
  weak.delete('');
  for (const s of strong) weak.delete(s);
  return { strong, weak };
}

/**
 * Folders under AppData and ProgramData, given to the app that names them.
 *
 * A folder claimed by more than one app goes to none of them: `AppData\Local\
 * Microsoft` holds pieces of a dozen programs, and attributing all of it to
 * whichever app sorted first would be a number somebody might act on.
 *
 * @param {object[]} apps
 * @param {object[]} folders  { root, name, path }
 */
function matchDataFolders(apps, folders) {
  const identifiers = apps.map((app) => ({ app, ...identifiersOf(app) }));
  const matches = new Map();
  let ambiguous = 0;

  for (const folder of folders) {
    const name = token(folder.name);
    if (!name) continue;
    const strong = identifiers.filter((i) => i.strong.has(name));
    const claimants = strong.length > 0 ? strong : identifiers.filter((i) => i.weak.has(name));
    if (claimants.length !== 1) {
      if (claimants.length > 1) ambiguous++;
      continue;
    }
    const { app } = claimants[0];
    // A folder inside the install folder is already counted by the walk.
    if (app.installLocation && isInside(folder.path, app.installLocation)) continue;
    const list = matches.get(app.id) || [];
    list.push({ ...folder, confidence: strong.length > 0 ? 'strong' : 'guess' });
    matches.set(app.id, list);
  }

  return { matches, ambiguous };
}

/**
 * The whole list, from what was read.
 *
 * @param {object} input
 * @param {object[]} input.registryEntries  from registry.js
 * @param {object[]} input.packages         from store.js
 * @param {object[]} input.dataFolders      { root, name, path }
 * @param {object} [input.env]
 */
function build({ registryEntries = [], packages = [], dataFolders = [], env = process.env, readableName }) {
  const windowsDir = env.SystemRoot || 'C:\\Windows';

  const all = registryEntries.map(fromRegistryEntry);
  const hiddenCounts = {};
  for (const app of all) if (app.hidden) hiddenCounts[app.hidden] = (hiddenCounts[app.hidden] || 0) + 1;

  const apps = all.filter((app) => !app.hidden);
  for (const pkg of packages) apps.push(fromStorePackage(pkg, { readableName }));

  for (const app of apps) app.protection = protectionOf(app, { windowsDir });

  const { matches, ambiguous } = matchDataFolders(apps, dataFolders);
  for (const app of apps) app.dataFolders = matches.get(app.id) || [];

  // Two hives can hold the same program -- a 32-bit installer writing to both,
  // or one program registered per machine and per user. Same name, same
  // publisher and the same install folder is the same program; anything less
  // is two entries that happen to share a name, and both are shown.
  const seen = new Map();
  const merged = [];
  for (const app of apps) {
    const key = `${token(app.name)}|${token(app.publisher)}|${pathKey(app.installLocation || app.id)}`;
    const first = seen.get(key);
    if (first) {
      first.alsoIn = first.alsoIn || [];
      first.alsoIn.push(app.hive || app.source);
      if (!first.declaredBytes) first.declaredBytes = app.declaredBytes;
      if (!first.uninstallCommand) first.uninstallCommand = app.uninstallCommand;
      continue;
    }
    seen.set(key, app);
    merged.push(app);
  }

  return {
    apps: merged,
    counts: {
      registryKeys: all.length,
      hidden: hiddenCounts,
      hiddenTotal: all.length - apps.filter((a) => a.source === 'registry').length,
      store: packages.length,
      shown: merged.length,
      withLocation: merged.filter((a) => a.installLocation).length,
      withDeclared: merged.filter((a) => a.declaredBytes > 0).length,
      ambiguousFolders: ambiguous,
    },
  };
}

module.exports = {
  build,
  parseInstallDate,
  fromRegistryEntry,
  fromStorePackage,
  protectionOf,
  identifiersOf,
  matchDataFolders,
  dataRoots,
  cleanLocation,
  isInside,
  token,
  exeToken,
  GENERIC_EXES,
  RELEASE_TYPES_HIDDEN,
};
