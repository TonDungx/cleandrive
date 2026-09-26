'use strict';

/**
 * One pass of the Apps screen: read the lists, then measure what can be
 * measured.
 *
 * Timed on the machine this was written on, 2026-09-26, nothing elevated:
 *
 *   the three Uninstall hives        0.26 s   638 keys
 *   Get-AppxPackage                  1.5 s    147 packages
 *   58 install folders              13.6 s    47.72 GB, 180,901 files, 0 refused
 *   147 Store packages              10.6 s    14.32 GB,  53,760 files, 0 refused
 *                                   ------
 *                                   ~26 s
 *
 * So the whole thing runs on a click with a progress bar and a stop button,
 * the way the System screen's walk does, and needs no administrator rights.
 * The one thing that does is Prefetch, and that stays behind its own button.
 *
 * Only reads.
 */

const path = require('node:path');

const { fsp } = require('../lib/real-fs');
const { measureTree } = require('../system/walk');
const { pathKey } = require('../lib/util');

const registry = require('./registry');
const store = require('./store');
const inventory = require('./inventory');
const lastused = require('./lastused');

/**
 * A folder no app gets to claim as its install location.
 *
 * An installer that writes `InstallLocation=C:\` -- or `C:\Program Files`,
 * which two here do -- would otherwise have the whole of it walked and
 * attributed to one program.
 */
function tooBroad(dir, env = process.env) {
  if (!dir) return true;
  if (/^[A-Za-z]:\\?$/.test(dir)) return true;
  const roots = [
    env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData,
    env.SystemRoot, env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA,
    env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData') : '',
  ].filter(Boolean);
  return roots.some((root) => pathKey(dir) === pathKey(root));
}

/** Is there a folder there? */
async function exists(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Every folder directly under AppData\Roaming, AppData\Local and ProgramData. */
async function listDataFolders(env = process.env) {
  const folders = [];
  for (const { key, dir } of inventory.dataRoots(env)) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      folders.push({ root: key, name: entry.name, path: path.join(dir, entry.name) });
    }
  }
  return folders;
}

/**
 * The record of an app being started, from whichever source saw it last.
 *
 * Each source records a different subset of launches -- Prefetch sees every
 * start, UserAssist only what Explorer and the Start menu began -- so the
 * latest of them is the answer, and the one it came from is named beside it.
 * They are not scored against each other and nothing is added up.
 *
 * How well a record matches its app is what the confidence is about:
 *
 *   strong   a UserAssist entry whose path is inside the app's install folder
 *   likely   an executable name that matches one the app names for itself.
 *            Two programs can install an `updater.exe`, and Prefetch records
 *            the name without the path, so this is as far as it goes.
 */
function lastUsedFor(app, { userAssist, prefetch }) {
  const found = [];
  const identifiers = inventory.identifiersOf(app).strong;

  for (const entry of userAssist.entries) {
    if (entry.fullPath && app.installLocation && inventory.isInside(entry.fullPath, app.installLocation)) {
      found.push({ at: entry.lastRunMs, source: entry.kind === 'shortcut' ? 'shortcut' : 'userAssist', confidence: 'strong', runs: entry.runs });
      continue;
    }
    const base = entry.fullPath ? path.win32.basename(entry.fullPath) : entry.name.split('\\').pop();
    const name = inventory.token(String(base).replace(/\.(exe|lnk)(\.\d+)?$/i, ''));
    if (name && identifiers.has(name)) {
      found.push({ at: entry.lastRunMs, source: entry.kind === 'shortcut' ? 'shortcut' : 'userAssist', confidence: 'likely', runs: entry.runs });
    }
  }

  if (prefetch && prefetch.available) {
    for (const name of identifiers) {
      for (const [exe, record] of prefetch.byExe) {
        if (inventory.token(exe.replace(/\.exe$/i, '')) !== name) continue;
        found.push({ at: record.lastRunMs, source: 'prefetch', confidence: 'likely' });
      }
    }
  }

  if (found.length === 0) return null;
  found.sort((a, b) => b.at - a.at);
  const best = found[0];
  return { ...best, sources: [...new Set(found.map((f) => f.source))] };
}

/**
 * Walk each folder once, however many apps point at it.
 *
 * `C:\Program Files\Gpg4win` and `C:\Program Files\Gpg4win\..\GnuPG` are two
 * entries in the registry here; the second normalises into a different folder,
 * but two entries naming the same one is common enough (a program registered
 * both per machine and per user) to be worth not measuring twice.
 */
async function measureAll(dirs, { token = null, onProgress = () => {} }) {
  const sizes = new Map();
  let done = 0;
  for (const dir of dirs) {
    if (token && token.cancelled) break;
    const key = pathKey(dir);
    if (sizes.has(key)) continue;
    onProgress({ phase: 'measuring', done, total: dirs.length, current: dir });
    // `measureTree` defaults its own token; handing it an explicit `null`
    // replaces that default with null and the walk throws on the first
    // cancellation check.
    const out = await measureTree(dir, token ? { token } : {});
    const all = out.buckets.all || { allocated: 0, logical: 0, files: 0 };
    sizes.set(key, { bytes: all.allocated, logical: all.logical, files: all.files, refused: out.deniedCount });
    done++;
  }
  return sizes;
}

/**
 * Everything the Apps screen is drawn from.
 *
 * @param {object} [options]
 * @param {{cancelled: boolean}} [options.token]
 * @param {(p: object) => void} [options.onProgress]
 * @param {object} [options.prefetch]  a `prefetch.list` reply, when one was asked for
 */
async function scan({ token = null, onProgress = () => {}, prefetch = null, env = process.env, deps = {} } = {}) {
  const started = Date.now();

  onProgress({ phase: 'registry' });
  const { entries, hives } = await (deps.readUninstallEntries || registry.readUninstallEntries)();

  onProgress({ phase: 'store' });
  const packages = await (deps.listPackages || store.listPackages)({}, deps);

  onProgress({ phase: 'folders' });
  const dataFolders = await (deps.listDataFolders || listDataFolders)(env);
  const userAssist = await (deps.readUserAssist || lastused.readUserAssist)();

  const { apps, counts } = inventory.build({
    registryEntries: entries,
    packages: packages.packages,
    dataFolders,
    env,
    readableName: store.readableName,
  });

  const prefetchRecords = prefetch ? lastused.fromPrefetchListing(prefetch.files) : null;
  for (const app of apps) app.lastUsed = lastUsedFor(app, { userAssist, prefetch: prefetchRecords });

  // What is worth walking: each app's install folder, and the data folders it
  // was matched to. A location that is a whole drive or a shared root is
  // dropped here and the app keeps `installLocation` for showing, with
  // `locationTooBroad` saying why nothing was measured.
  // An install folder that is not there is the commonest thing in this list
  // after one that was never recorded: an uninstaller that removed the folder
  // and left the registry key. It is checked before the walk, because a walk
  // of a folder that does not exist comes back as a refusal, which reads as
  // "something is in there we could not see".
  const toMeasure = [];
  for (const app of apps) {
    // A Steam game's folder is whatever Steam's own files say, not what its
    // registry entry said when it was installed. Measuring the stale path
    // would report "the folder is gone" about a game that is sitting there.
    if (app.steamAppId) {
      app.locationFromSteam = true;
    } else if (app.installLocation) {
      if (tooBroad(app.installLocation, env)) app.locationTooBroad = true;
      else if (!(await exists(app.installLocation))) app.locationMissing = true;
      else toMeasure.push(app.installLocation);
    }
    for (const folder of app.dataFolders) toMeasure.push(folder.path);
  }

  const sizes = await measureAll(toMeasure, { token, onProgress });

  for (const app of apps) {
    const measurable = app.installLocation && !app.locationTooBroad && !app.locationMissing && !app.locationFromSteam;
    const install = measurable ? sizes.get(pathKey(app.installLocation)) : null;
    app.measured = install ? { bytes: install.bytes, files: install.files, refused: install.refused } : null;

    let dataBytes = 0;
    let dataRefused = 0;
    for (const folder of app.dataFolders) {
      const size = sizes.get(pathKey(folder.path));
      folder.bytes = size ? size.bytes : 0;
      folder.refused = size ? size.refused : 0;
      dataBytes += folder.bytes;
      dataRefused += folder.refused;
    }
    app.dataBytes = dataBytes;
    app.dataRefused = dataRefused;
  }

  // Several programs can install into one folder -- Microsoft 365 registers
  // itself once per language here, and all four entries point at the same
  // 4.5 GB. Each row is allowed to show that folder's size, because that is
  // what the folder holds; what is not allowed is a total that counts those
  // bytes four times. So every row says how many others share its folder, and
  // the total is built from the folders, each counted once.
  const sharers = new Map();
  for (const app of apps) {
    if (!app.measured) continue;
    const key = pathKey(app.installLocation);
    sharers.set(key, (sharers.get(key) || 0) + 1);
  }
  for (const app of apps) {
    app.sharesLocationWith = app.measured ? Math.max(0, (sharers.get(pathKey(app.installLocation)) || 1) - 1) : 0;
  }

  // Each measured folder once, whoever claims it.
  let distinctBytes = 0;
  for (const size of sizes.values()) distinctBytes += size ? size.bytes : 0;

  const cancelled = Boolean(token && token.cancelled);
  return {
    at: Date.now(),
    apps,
    counts: {
      ...counts,
      measured: apps.filter((a) => a.measured).length,
      withLastUsed: apps.filter((a) => a.lastUsed).length,
      dataFoldersSeen: dataFolders.length,
      dataFoldersMatched: apps.reduce((n, a) => n + a.dataFolders.length, 0),
    },
    hives,
    // Every folder that was walked, each counted once. Not the sum of the
    // rows: four rows sharing one folder are four honest rows and one folder.
    distinctBytes,
    storeAvailable: packages.ok,
    userAssist: {
      available: userAssist.available,
      entries: userAssist.entries.length,
      oldestMs: userAssist.oldestMs,
      newestMs: userAssist.newestMs,
    },
    prefetch: prefetchRecords
      ? { available: prefetchRecords.available, programs: prefetchRecords.byExe.size, oldestMs: prefetchRecords.oldestMs, newestMs: prefetchRecords.newestMs }
      : null,
    cancelled,
    durationMs: Date.now() - started,
  };
}

/**
 * The elevated pass: one UAC prompt, one listing of the Prefetch folder.
 *
 * @param {object} options
 * @param {object} options.client  a HelperClient that has not been started
 */
async function elevate({ client, onProgress = () => {} }) {
  onProgress({ phase: 'prompt' });
  try {
    await client.start();
  } catch (err) {
    if (err && err.code === 'EDECLINED') return { declined: true };
    throw err;
  }
  try {
    const ping = await client.request('ping');
    if (!ping || !ping.elevated) throw new Error('The helper started without administrator rights');
    onProgress({ phase: 'prefetch' });
    return await client.request('prefetch.list', {}, { timeoutMs: 120000 });
  } finally {
    client.stop();
  }
}

module.exports = { scan, elevate, listDataFolders, lastUsedFor, measureAll, tooBroad };
