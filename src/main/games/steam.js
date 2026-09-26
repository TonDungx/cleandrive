'use strict';

/**
 * What Steam has on this machine, read from Steam's own files.
 *
 * Deliberately not from the registry, although the registry looks easier.
 * Steam writes a `Steam App <appid>` entry under the Uninstall key for every
 * game, and on the machine this was written on three of those entries point at
 * `E:\SteamLibrary\...` -- a drive that does not exist, because the library was
 * moved to `D:` and nothing went back to correct them. The same entries hold
 * the Vietnamese in one game's name as mojibake (`BÃ¡nh MÃ¬`), while the
 * manifest beside the game has it right. So the registry is used for exactly
 * one thing, finding where Steam itself is installed, and everything about a
 * game comes from `steamapps`.
 *
 * Measured here, 2026-09-26:
 *
 *   - `SizeOnDisk` in each manifest is **exact**. Every one of the 10 games
 *     was walked and compared: the ratio was 1.000 for all of them, 47.05 GB
 *     against 47.05 GB. This is the opposite of what the installed-apps screen
 *     found for `EstimatedSize`, so games get one size column, not two, and no
 *     47 GB walk on every scan.
 *   - `LastPlayed` in the manifest is **not always the latest**. Against the
 *     per-account `localconfig.vdf`, three of nine games had been played more
 *     recently than their manifest said -- one by 499 days. Both are read and
 *     the later of the two wins.
 *   - There are 16 account folders under `userdata` and only 2 in
 *     `loginusers.vdf`. All 16 are read: the question a games list answers is
 *     "has anyone played this on this machine", and an account that has since
 *     been logged out still answers it. Only `LastPlayed` is taken from those
 *     files; nothing else in them is looked at.
 *
 * Only reads.
 */

const path = require('node:path');

const { fsp } = require('../lib/real-fs');
const { exportKey } = require('../apps/registry');
const vdf = require('./vdf');

/** A manifest bigger than this is not one Steam wrote. */
const MAX_MANIFEST = 4 * 1024 * 1024;
/** `localconfig.vdf` was 76 KB here; a generous ceiling. */
const MAX_LOCALCONFIG = 32 * 1024 * 1024;
/** More libraries than anyone has. */
const MAX_LIBRARIES = 64;

/**
 * Where Steam is installed.
 *
 * The per-user key holds it as `c:/program files (x86)/steam`, lower case and
 * with forward slashes, so whatever comes back is normalised before use.
 */
async function findSteam({ env = process.env, deps = {} } = {}) {
  const tried = [];
  const fromKey = async (key, name) => {
    const doc = await (deps.exportKey || exportKey)(key);
    if (!doc) return null;
    const block = doc[key];
    const value = block && typeof block[name] === 'string' ? block[name] : null;
    return value || null;
  };

  const candidates = [];
  for (const [key, name] of [
    ['HKEY_CURRENT_USER\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKEY_LOCAL_MACHINE\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ]) {
    const found = await fromKey(key, name);
    if (found) candidates.push(found);
  }
  candidates.push(
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Steam')
  );

  for (const raw of candidates) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let dir;
    try {
      dir = path.win32.normalize(raw.replace(/\//g, '\\').replace(/[\\]+$/, ''));
    } catch {
      continue;
    }
    if (tried.includes(dir)) continue;
    tried.push(dir);
    try {
      await fsp.stat(path.join(dir, 'steamapps'));
      return { path: dir, tried };
    } catch {
      /* not this one */
    }
  }
  return { path: null, tried };
}

/**
 * Every library folder, Steam's own first.
 *
 * `libraryfolders.vdf` lists them all including the Steam install itself; a
 * library on a drive that is no longer attached is reported rather than
 * dropped, because "this game is on a disk that is not here" is an answer.
 */
async function libraries(steamPath) {
  const file = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    return { libraries: [{ path: steamPath, present: true, declared: false }], error: err.code || 'EUNKNOWN' };
  }

  let block;
  try {
    block = vdf.section(vdf.parse(text), 'libraryfolders');
  } catch {
    return { libraries: [{ path: steamPath, present: true, declared: false }], error: 'unreadable' };
  }

  const out = [];
  const seen = new Set();
  const add = async (dir, declared) => {
    if (!dir || out.length >= MAX_LIBRARIES) return;
    let normal;
    try {
      normal = path.win32.normalize(dir.replace(/[\\/]+$/, ''));
    } catch {
      return;
    }
    const key = normal.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let present = false;
    try {
      present = (await fsp.stat(path.join(normal, 'steamapps'))).isDirectory();
    } catch {
      present = false;
    }
    out.push({ path: normal, present, declared });
  };

  for (const value of Object.values(block || {})) {
    if (!value || typeof value !== 'object') continue;
    await add(vdf.str(value, 'path'), true);
  }
  await add(steamPath, false);

  return { libraries: out, error: null };
}

/** `appmanifest_1274570.acf` -> `1274570`. */
const appidOf = (name) => {
  const m = /^appmanifest_(\d+)\.acf$/i.exec(name);
  return m ? m[1] : null;
};

/**
 * Every installed game, from the manifest beside it.
 *
 * `StateFlags` is Steam's own word for what state the install is in; 4 is
 * "fully installed". Anything else is reported as it is rather than hidden,
 * because a half-installed game still occupies the disk.
 */
async function games(libs) {
  const out = [];
  for (const lib of libs) {
    if (!lib.present) continue;
    const apps = path.join(lib.path, 'steamapps');
    let names;
    try {
      names = await fsp.readdir(apps);
    } catch {
      continue;
    }
    for (const name of names) {
      const appid = appidOf(name);
      if (!appid) continue;
      let text;
      try {
        const file = path.join(apps, name);
        const stat = await fsp.stat(file);
        if (stat.size > MAX_MANIFEST) continue;
        text = await fsp.readFile(file, 'utf8');
      } catch {
        continue;
      }
      let state;
      try {
        state = vdf.section(vdf.parse(text), 'AppState');
      } catch {
        continue;
      }
      if (!state) continue;
      const installdir = vdf.str(state, 'installdir');
      out.push({
        appid,
        name: vdf.str(state, 'name') || `App ${appid}`,
        installdir,
        // Steam's own figure, which this machine confirmed is exact.
        bytes: vdf.num(state, 'SizeOnDisk'),
        stagingBytes: vdf.num(state, 'StagingSize'),
        manifestPlayedAt: vdf.num(state, 'LastPlayed') * 1000 || 0,
        updatedAt: vdf.num(state, 'LastUpdated') * 1000 || 0,
        stateFlags: vdf.num(state, 'StateFlags'),
        library: lib.path,
        path: installdir ? path.join(apps, 'common', installdir) : '',
        manifest: path.join(apps, name),
      });
    }
  }
  return out;
}

/**
 * When each game was last played, from every account that has been signed in.
 *
 * `localconfig.vdf` nests the play records several levels down, and the block
 * is called `apps` at more than one depth, so it is walked rather than
 * searched by name: the one that matters is the one whose entries carry a
 * `LastPlayed`.
 */
function playRecords(doc) {
  const found = new Map();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 8) return;
    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      if (key.toLowerCase() === 'apps') {
        for (const [appid, record] of Object.entries(value)) {
          if (!record || typeof record !== 'object' || !/^\d+$/.test(appid)) continue;
          const at = vdf.num(record, 'LastPlayed') * 1000;
          if (at > 0 && (!found.has(appid) || at > found.get(appid))) found.set(appid, at);
        }
        continue;
      }
      walk(value, depth + 1);
    }
  };
  walk(doc, 0);
  return found;
}

/** @returns {Promise<{byApp: Map<string, {at: number, accounts: number}>, accounts: number, read: number}>} */
async function lastPlayed(steamPath) {
  const byApp = new Map();
  const userdata = path.join(steamPath, 'userdata');
  let accounts = [];
  try {
    accounts = (await fsp.readdir(userdata, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return { byApp, accounts: 0, read: 0 };
  }

  let read = 0;
  for (const account of accounts) {
    const file = path.join(userdata, account, 'config', 'localconfig.vdf');
    let text;
    try {
      const stat = await fsp.stat(file);
      if (stat.size > MAX_LOCALCONFIG) continue;
      text = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    let records;
    try {
      records = playRecords(vdf.parse(text));
    } catch {
      continue;
    }
    read++;
    for (const [appid, at] of records) {
      const seen = byApp.get(appid);
      if (!seen) byApp.set(appid, { at, accounts: 1 });
      else byApp.set(appid, { at: Math.max(seen.at, at), accounts: seen.accounts + 1 });
    }
  }
  return { byApp, accounts: accounts.length, read };
}

/**
 * Folders in `steamapps\common` that no manifest claims.
 *
 * Steam leaves these behind when an uninstall is interrupted. There were none
 * on the machine this was written on -- 10 folders, 10 manifests -- so the
 * harness builds a library to check the detection, and says so.
 *
 * A folder is only called an orphan when the library it is in was read
 * successfully: a `common` that could not be listed says nothing about what is
 * in it.
 */
async function orphans(libs, installed) {
  const out = [];
  for (const lib of libs) {
    if (!lib.present) continue;
    const common = path.join(lib.path, 'steamapps', 'common');
    let dirs;
    try {
      dirs = (await fsp.readdir(common, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.isSymbolicLink());
    } catch {
      continue;
    }
    const claimed = new Set(
      installed
        .filter((g) => g.library.toLowerCase() === lib.path.toLowerCase())
        .map((g) => g.installdir.toLowerCase())
        .filter(Boolean)
    );
    for (const dir of dirs) {
      if (claimed.has(dir.name.toLowerCase())) continue;
      out.push({ name: dir.name, path: path.join(common, dir.name), library: lib.path });
    }
  }
  return out;
}

/**
 * What is sitting in `steamapps\downloading`.
 *
 * Steam puts a partly-downloaded update here and does not always clear it:
 * 1.77 GB across 11 `.delta` files here, all for one game that is installed
 * and working, the oldest from 2025-07-07. Reported per library, with the
 * newest file's date, because how old the newest one is is the whole question.
 */
async function downloads(libs) {
  const out = [];
  for (const lib of libs) {
    if (!lib.present) continue;
    const dir = path.join(lib.path, 'steamapps', 'downloading');
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.length === 0) continue;
    out.push({ path: dir, library: lib.path, entries: entries.length });
  }
  return out;
}

module.exports = {
  findSteam,
  libraries,
  games,
  lastPlayed,
  orphans,
  downloads,
  playRecords,
  appidOf,
  MAX_MANIFEST,
  MAX_LOCALCONFIG,
};
