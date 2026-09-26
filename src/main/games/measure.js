'use strict';

/**
 * One pass of the Games screen: find Steam, read what it has, and size the
 * two things Steam's own files do not account for.
 *
 * Fast, because almost nothing has to be walked. Steam records each game's
 * size exactly (checked against a real walk of all 47 GB here: ratio 1.000),
 * so a game costs one small file read. What does get walked is what Steam
 * keeps no figure for -- a folder no manifest claims, and whatever is sitting
 * in `steamapps\downloading`.
 *
 * Only reads.
 */

const path = require('node:path');

const { measureTree } = require('../system/walk');
const { runningProcessNames } = require('../lib/processes');

const steam = require('./steam');

/** Steam's `StateFlags`: 4 is a game that is fully installed. */
const STATE_FULLY_INSTALLED = 4;

/** The processes that mean Steam is doing something with these files. */
const STEAM_PROCESSES = Object.freeze(['steam.exe', 'steamwebhelper.exe', 'steamservice.exe']);

/**
 * Is Steam running?
 *
 * `null` when the process list could not be read, which is not the same as
 * "no" -- the screen holds back a delete rather than guessing, the way the
 * known-apps caches do.
 */
async function steamIsRunning(deps = {}) {
  const names = await (deps.runningProcessNames || runningProcessNames)();
  if (!names) return null;
  return STEAM_PROCESSES.some((name) => names.has(name));
}

/**
 * Every file below a folder: what it claims, what it occupies, and when it was
 * last written.
 *
 * Both sizes, because for these they are wildly different. Steam creates a
 * file at its finished size and fills it in as the download arrives, so
 * `size` is what the file will be and `blocks * 512` is what is on the disk
 * now. Measured in `steamapps\\downloading` here: 11.07 GB claimed against
 * 1.77 GB occupied, with one 7.6 GB file holding nothing at all. A screen
 * that offered to recover the claimed figure would be out by six times.
 *
 * Bounded: a `downloading` folder that has gone wrong could hold a great many
 * files, and the screen would be no more useful for listing all of them.
 */
const MAX_LEFTOVER_FILES = 2000;

async function filesUnder(root, token) {
  const { fsp } = require('../lib/real-fs');
  const out = [];
  const visit = async (dir, depth) => {
    if (out.length >= MAX_LEFTOVER_FILES || depth > 6) return;
    if (token && token.cancelled) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_LEFTOVER_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
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
          // What the volume's free-space figure is actually made of.
          allocated: Number.isFinite(stat.blocks) ? stat.blocks * 512 : stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        /* gone between the listing and the stat */
      }
    }
  };
  await visit(root, 0);
  return out;
}

/**
 * Everything the Games screen is drawn from.
 *
 * @param {object} [options]
 * @param {{cancelled: boolean}} [options.token]
 * @param {(p: object) => void} [options.onProgress]
 */
async function scan({ token = null, onProgress = () => {}, env = process.env, deps = {} } = {}) {
  const started = Date.now();

  onProgress({ phase: 'finding' });
  const found = await steam.findSteam({ env, deps });
  if (!found.path) {
    return {
      at: Date.now(),
      installed: false,
      triedPaths: found.tried,
      steamPath: null,
      libraries: [],
      games: [],
      orphans: [],
      downloads: [],
      accounts: { total: 0, read: 0 },
      steamRunning: await steamIsRunning(deps),
      cancelled: false,
      durationMs: Date.now() - started,
    };
  }

  onProgress({ phase: 'libraries' });
  const libs = await steam.libraries(found.path);

  onProgress({ phase: 'manifests' });
  const installed = await steam.games(libs.libraries);

  onProgress({ phase: 'played' });
  const played = await steam.lastPlayed(found.path);

  // The later of the two records wins. The manifest is what Steam wrote when
  // it last touched the install; the per-account file is what it wrote when
  // somebody last played. Neither is reliably the newer one.
  for (const game of installed) {
    const record = played.byApp.get(game.appid);
    const fromAccounts = record ? record.at : 0;
    const at = Math.max(game.manifestPlayedAt, fromAccounts);
    game.lastPlayedAt = at > 0 ? at : null;
    game.playedSource = at === 0 ? null : at === fromAccounts && at !== game.manifestPlayedAt ? 'account' : 'manifest';
    game.alsoInAccounts = record ? record.accounts : 0;
    game.fullyInstalled = game.stateFlags === STATE_FULLY_INSTALLED;
  }

  onProgress({ phase: 'leftovers' });
  const orphanDirs = await steam.orphans(libs.libraries, installed);
  const downloadDirs = await steam.downloads(libs.libraries);

  // The only walking this screen does.
  const walk = async (dir) => {
    if (token && token.cancelled) return null;
    try {
      const out = await measureTree(dir, token ? { token } : {});
      const all = out.buckets.all || { allocated: 0, files: 0 };
      return { bytes: all.allocated, files: all.files, refused: out.deniedCount };
    } catch {
      return null;
    }
  };

  for (const orphan of orphanDirs) {
    const size = await walk(orphan.path);
    orphan.bytes = size ? size.bytes : 0;
    orphan.files = size ? size.files : 0;
    orphan.refused = size ? size.refused : 0;
  }

  for (const download of downloadDirs) {
    const size = await walk(download.path);
    download.bytes = size ? size.bytes : 0;
    download.fileCount = size ? size.files : 0;
    download.refused = size ? size.refused : 0;
    // Every file in there, because the bin takes files and not folders: the
    // screen groups them, and each one is a row the pipeline can act on.
    download.files = await filesUnder(download.path, token);
    download.newestMs = download.files.reduce((newest, f) => Math.max(newest, f.mtimeMs), 0);
    download.oldestMs = download.files.reduce((oldest, f) => (oldest === 0 ? f.mtimeMs : Math.min(oldest, f.mtimeMs)), 0);
  }

  return {
    at: Date.now(),
    installed: true,
    steamPath: found.path,
    triedPaths: found.tried,
    libraries: libs.libraries,
    librariesError: libs.error,
    games: installed,
    orphans: orphanDirs,
    downloads: downloadDirs,
    accounts: { total: played.accounts, read: played.read },
    steamRunning: await steamIsRunning(deps),
    cancelled: Boolean(token && token.cancelled),
    durationMs: Date.now() - started,
  };
}

module.exports = { scan, steamIsRunning, filesUnder, STEAM_PROCESSES, STATE_FULLY_INSTALLED, MAX_LEFTOVER_FILES };
