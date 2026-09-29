'use strict';

/**
 * The analyzer behind the Games screen (D2): the Steam library, what each game
 * occupies, and when it was last played.
 *
 * **The app never removes a game.** Not because it could not delete the
 * folder, but because deleting it leaves Steam still believing the game is
 * installed -- the library shows it, launching it fails, and repairing that is
 * worse than the space was worth. So a game's only action is a handoff to
 * `steam://uninstall/<appid>`, which is the same command Steam writes into the
 * registry as that game's uninstaller.
 *
 * No game is ever `safe`. A game is `review` when it has not been played for
 * six months, which is longer than the ninety days the installed-apps screen
 * uses: not opening a program for three months usually means you are done with
 * it, and not playing a game for three months usually means it is winter.
 *
 * Two kinds of leftover are not games and are treated differently:
 *
 *   - **A folder in `steamapps\\common` with no manifest** is reported and
 *     nothing more. `recycle` does not take folders -- `planTrash` has an
 *     `allowDirectories` switch that the recycle action deliberately does not
 *     turn on -- and widening that for a case this machine cannot demonstrate
 *     (it has ten folders and ten manifests) is not a trade worth making.
 *   - **What is left in `steamapps\\downloading`** is loose files, and those go
 *     to the bin like any other file: one candidate each, `review`, never
 *     while Steam is running. Measured here: 1.77 GB across 89 files for a
 *     game that is installed and working, the oldest from July 2025.
 */

const path = require('node:path');

const { message: m } = require('../../i18n');
const { formatBytes } = require('../lib/util');
const { candidateId, evidence } = require('./contract');

const ID = 'games';

/** Not played in this long, and the row is worth a look. */
const STALE_DAYS = 180;

/**
 * Steam's own pieces, which sit in the library looking like games.
 *
 * `Steamworks Common Redistributables` is the runtime that other games
 * install into and depend on -- the DirectX, Visual C++ and PhysX installers
 * a game runs on first launch. It is on this machine at 244 MB, it has never
 * been "played", and it would otherwise be the first row a person removed
 * because it is the one they do not recognise. Removing it makes other games
 * fail to start.
 *
 * Only ids seen on this machine are listed. An id not in here is treated as a
 * game, which is the safe direction: a game offers a handoff to Steam, and
 * Steam asks before it removes anything.
 */
const NOT_GAMES = Object.freeze({
  228980: 'redistributables',
});

/** A download leftover older than this is not a download in progress. */
const STALE_DOWNLOAD_DAYS = 30;

/** However many files are in `downloading`, only this many become rows. */
const MAX_DOWNLOAD_FILES = 500;

const DAY = 86400000;
const n = (v) => Number(v || 0).toLocaleString('en-US');
const daysSince = (ms) => Math.floor((Date.now() - ms) / DAY);

function gameEvidence(game, model) {
  const list = [];
  const add = (message) => list.push(evidence(list.length + 1, message));

  if (NOT_GAMES[game.appid] === 'redistributables') {
    add(m('evidence.games.redistributables', 'Not a game: this is the shared runtime Steam installs for other games to use. Removing it stops games that depend on it from starting'));
    add(m('evidence.games.size', 'Steam records it as {size}, and this machine confirmed that figure is exact', {
      size: formatBytes(game.bytes),
    }));
    add(m('evidence.games.library', 'In the Steam library on {library}', { library: game.library }));
    return list;
  }

  if (game.lastPlayedAt) {
    add(m('evidence.games.played', 'Last played {n} days ago', { n: n(daysSince(game.lastPlayedAt)) }));
    add(game.playedSource === 'account'
      ? m('evidence.games.viaAccount', 'From a Steam account’s own record on this machine, which was more recent than the one beside the game')
      : m('evidence.games.viaManifest', 'From the record Steam keeps beside the game'));
  } else {
    add(m('evidence.games.neverPlayed', 'Steam has no record of it being played on this machine'));
  }

  add(m('evidence.games.size', 'Steam records it as {size}, and this machine confirmed that figure is exact', {
    size: formatBytes(game.bytes),
  }));

  if (!game.fullyInstalled) {
    add(m('evidence.games.partial', 'Steam does not have it marked as fully installed, so some of this may be a download that stopped'));
  }
  if (game.stagingBytes > 0) {
    add(m('evidence.games.staging', '{size} more is staged for an update that has not finished', { size: formatBytes(game.stagingBytes) }));
  }

  // When Steam last wrote to it. Worth a line beside "last played" because the
  // two disagree in the way that matters: a game played two years ago but
  // patched last month is one Steam still maintains, and a game never updated
  // since it arrived is one nobody has touched at either end. Neither is a
  // reason to delete it, which is why this is evidence and not a rule.
  //
  // `updatedAt` is already milliseconds -- `steam.js` multiplies Steam's
  // `LastUpdated` seconds by a thousand where it reads the manifest.
  if (Number.isFinite(game.updatedAt) && game.updatedAt > 0) {
    add(m('evidence.games.updated', 'Steam last updated it {n} days ago', {
      n: n(Math.max(0, Math.floor((Date.now() - game.updatedAt) / 86400000))),
    }));
  }

  add(m('evidence.games.library', 'In the Steam library on {library}', { library: game.library }));

  if (game.alsoInAccounts > 1) {
    add(m('evidence.games.accounts', '{n} Steam accounts on this machine have played it', { n: n(game.alsoInAccounts) }));
  }

  add(m('evidence.games.uninstallOnly', 'Only Steam can remove it. Deleting the folder would leave Steam still listing the game, and it would fail to start'));

  if (model.accounts.total > model.accounts.read) {
    add(m('evidence.games.accountsUnread', '{n} of the {total} Steam accounts on this machine could not be read, so a more recent play may not be counted', {
      n: n(model.accounts.total - model.accounts.read), total: n(model.accounts.total),
    }));
  }

  return list;
}

function gameCandidate(game, model) {
  // Steam's own runtime is never something to suggest removing, however long
  // it has sat there unplayed.
  const notAGame = Boolean(NOT_GAMES[game.appid]);
  const stale = !notAGame && game.lastPlayedAt !== null && daysSince(game.lastPlayedAt) >= STALE_DAYS;
  return {
    id: candidateId(ID, `steam:${game.appid}`),
    path: game.path || `${game.library}\\steamapps\\appmanifest_${game.appid}.acf`,
    kind: game.path ? 'folder' : 'virtual',
    bytes: Math.max(0, Math.round(game.bytes)),
    category: 'games.steam',
    verdict: notAGame ? 'protected' : stale || !game.fullyInstalled ? 'review' : 'keep',
    // Steam's own figure, and this machine measured it as exact -- but it is
    // still Steam's bookkeeping rather than something this scan counted.
    confidence: notAGame || game.fullyInstalled ? 'strong' : 'likely',
    evidence: gameEvidence(game, model),
    actions: notAGame ? ['none'] : ['handoff'],
    unattendedEligible: false,
    meta: {
      kind: 'game',
      appid: game.appid,
      name: game.name,
      library: game.library,
      lastPlayedAt: game.lastPlayedAt,
      playedSource: game.playedSource,
      fullyInstalled: game.fullyInstalled,
      stagingBytes: game.stagingBytes,
      updatedAt: game.updatedAt,
      accounts: game.alsoInAccounts,
      notAGame: notAGame ? NOT_GAMES[game.appid] : null,
      handoff: notAGame ? null : `steamUninstall:${game.appid}`,
      staleDays: STALE_DAYS,
    },
  };
}

function orphanCandidate(orphan) {
  return {
    id: candidateId(ID, orphan.path),
    path: orphan.path,
    kind: 'folder',
    bytes: Math.max(0, Math.round(orphan.bytes || 0)),
    category: 'games.orphan',
    verdict: 'review',
    confidence: 'likely',
    evidence: [
      evidence(1, m('evidence.games.orphan', 'A folder in Steam’s games folder that no installed game claims — usually what an interrupted uninstall leaves behind')),
      evidence(2, m('evidence.games.orphanSize', '{size} in {files} files', { size: formatBytes(orphan.bytes || 0), files: n(orphan.files || 0) })),
      evidence(3, m('evidence.games.orphanCheck', 'Check it in Steam first: a game that is installed but whose manifest is missing would look exactly like this')),
      evidence(4, m('evidence.games.orphanNoAction', 'The app will not delete a folder. Open it and remove it yourself once you are sure')),
    ],
    // No action, on purpose: see the note at the top of this file.
    actions: ['none'],
    unattendedEligible: false,
    meta: { kind: 'orphan', name: orphan.name, library: orphan.library, files: orphan.files || 0, refused: orphan.refused || 0 },
  };
}

function downloadCandidate(file, group, model) {
  const age = daysSince(file.mtimeMs);
  const onDisk = Number.isFinite(file.allocated) ? file.allocated : file.size;
  const list = [
    evidence(1, m('evidence.games.download', 'Part of a Steam download that did not finish, left in steamapps\\downloading')),
    evidence(2, m('evidence.games.downloadAge', 'Last written {n} days ago', { n: n(age) })),
    evidence(3, m('evidence.games.downloadRefetch', 'Steam downloads it again if it turns out to still be needed; nothing installed depends on it')),
  ];
  // Steam makes the file its finished size straight away and fills it in as
  // the download arrives, so the two figures are not the same thing and the
  // row leads with the one that is on the disk.
  if (onDisk < file.size * 0.9) {
    list.push(evidence(list.length + 1, m('evidence.games.downloadSparse', 'It is set aside at {claimed} but only {actual} of it has been written, so that is all removing it gives back', {
      claimed: formatBytes(file.size), actual: formatBytes(onDisk),
    })));
  }
  if (model.steamRunning === true) {
    list.push(evidence(list.length + 1, m('evidence.games.steamOpen', 'Steam is open — close it before removing these, in case one is a download in progress')));
  } else if (model.steamRunning === null) {
    list.push(evidence(list.length + 1, m('evidence.games.steamUnknown', 'Whether Steam is running could not be checked, so these are not offered')));
  }

  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    // `bytes` is the logical size the contract asks for; `bytesOnDisk` is what
    // the volume would get back, and it is what the screen shows and totals.
    bytes: Math.max(0, Math.round(file.size || 0)),
    bytesOnDisk: Math.max(0, Math.round(onDisk)),
    category: 'games.downloading',
    verdict: 'review',
    confidence: age >= STALE_DOWNLOAD_DAYS ? 'likely' : 'guess',
    evidence: list,
    // Offered only when Steam is known to be closed. Running, or unreadable,
    // and the row is there to look at and nothing else -- the same rule the
    // known apps' caches use.
    actions: model.steamRunning === false ? ['recycle'] : ['none'],
    unattendedEligible: false,
    meta: {
      kind: 'download',
      name: path.basename(file.path),
      library: group.library,
      group: group.path,
      ageDays: age,
      claimedBytes: Math.max(0, Math.round(file.size || 0)),
      onDiskBytes: Math.max(0, Math.round(onDisk)),
      steamRunning: model.steamRunning,
    },
  };
}

const analyzer = {
  id: ID,
  feature: 'pro.games',
  requiresElevation: false,
  categories: ['games.steam', 'games.orphan', 'games.downloading'],

  /** @param {object} ctx  { model } from games/measure.js */
  async *run(ctx, token) {
    const model = ctx.model;
    const games = [];
    const orphans = [];
    const downloads = [];

    for (const game of model.games) {
      if (token && token.cancelled) break;
      const candidate = gameCandidate(game, model);
      games.push(candidate.id);
      yield { type: 'candidate', candidate };
    }

    for (const orphan of model.orphans) {
      if (token && token.cancelled) break;
      const candidate = orphanCandidate(orphan);
      orphans.push(candidate.id);
      yield { type: 'candidate', candidate };
    }

    let emptyReservations = 0;
    for (const group of model.downloads) {
      for (const file of (group.files || []).slice(0, MAX_DOWNLOAD_FILES)) {
        if (token && token.cancelled) break;
        // A file Steam has set aside but written nothing into occupies
        // nothing, so removing it gives nothing back. Counted, not listed.
        const onDisk = Number.isFinite(file.allocated) ? file.allocated : file.size;
        if (onDisk <= 0) {
          emptyReservations++;
          continue;
        }
        const candidate = downloadCandidate(file, group, model);
        downloads.push(candidate.id);
        yield { type: 'candidate', candidate };
      }
    }

    const { games: _g, orphans: _o, downloads: _d, ...rest } = model;
    yield {
      type: 'summary',
      summary: {
        ...rest,
        rows: { games, orphans, downloads },
        staleDays: STALE_DAYS,
        totalGameBytes: model.games.reduce((sum, g) => sum + (g.bytes || 0), 0),
        totalOrphanBytes: model.orphans.reduce((sum, o) => sum + (o.bytes || 0), 0),
        totalDownloadBytes: model.downloads.reduce((sum, d) => sum + (d.bytes || 0), 0),
        downloadClaimedBytes: model.downloads.reduce(
          (sum, d) => sum + (d.files || []).reduce((inner, f) => inner + (f.size || 0), 0),
          0
        ),
        emptyReservations,
        downloadFiles: model.downloads.reduce((sum, d) => sum + (d.fileCount || 0), 0),
        librariesPresent: model.libraries.filter((l) => l.present).length,
        librariesMissing: model.libraries.filter((l) => !l.present).map((l) => l.path),
      },
    };
  },
};

module.exports = {
  analyzer,
  ID,
  gameCandidate,
  orphanCandidate,
  downloadCandidate,
  STALE_DAYS,
  STALE_DOWNLOAD_DAYS,
  NOT_GAMES,
  MAX_DOWNLOAD_FILES,
};
