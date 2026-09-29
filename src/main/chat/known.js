'use strict';

/**
 * "Is this file something a chat app downloaded?"
 *
 * Asked in one place that matters and will be asked in more: the confirmation
 * in front of a delete. The roadmap requires a specific sentence there --
 * *deleting these does not delete them from the conversation* -- and the
 * honest way to make that sentence appear is to recognise the files, not to
 * have whichever screen asked for the delete remember to request it. A photo
 * from a Zalo chat reached through Photos & video deserves the same warning as
 * one reached through the Chat screen.
 *
 * Deliberately narrow. This answers for the folders where downloads land, not
 * for the whole of either app's data: a `Local Storage` file is also "Zalo's",
 * and it is not something anybody deletes a photograph's worth of.
 */

const path = require('node:path');

const { pathKey } = require('../lib/util');

const zalo = require('./zalo');
const telegram = require('./telegram');

/**
 * The folders each app downloads into, as prefixes.
 *
 * Zalo's is the account's `media` folder, which holds both `ZaloDownloads`
 * and `sticker`. Telegram's is `tdata`, which holds every account's caches;
 * `tupdates` is in the list too, because deleting the staged update is a
 * delete somebody should be warned about for a different reason and the same
 * note names it.
 */
function downloadRoots(env = process.env) {
  const out = [];
  const zaloRoot = zalo.dataRoot(env);
  if (zaloRoot) out.push({ app: 'zalo', path: path.join(zaloRoot, 'media') });
  const telegramRoot = telegram.dataRoot(env);
  if (telegramRoot) {
    out.push({ app: 'telegram', path: path.join(telegramRoot, 'tdata') });
    out.push({ app: 'telegram', path: path.join(telegramRoot, 'tupdates') });
  }
  return out;
}

/**
 * Which app a path belongs to, or null.
 *
 * Compared with `pathKey`, which is how the rest of the app compares paths on
 * Windows, and with a separator on the end so that `…\media` does not claim
 * `…\mediaplayer`.
 */
function ownsPath(filePath, env = process.env) {
  if (typeof filePath !== 'string' || filePath === '') return null;
  const key = pathKey(path.resolve(filePath));
  for (const root of downloadRoots(env)) {
    const prefix = pathKey(root.path);
    if (key === prefix || key.startsWith(`${prefix}\\`) || key.startsWith(`${prefix}/`)) return root.app;
  }
  return null;
}

/** How many of a list of paths belong to each app. */
function countByApp(paths, env = process.env) {
  const counts = new Map();
  for (const filePath of paths || []) {
    const app = ownsPath(filePath, env);
    if (app) counts.set(app, (counts.get(app) || 0) + 1);
  }
  return counts;
}

module.exports = { ownsPath, countByApp, downloadRoots };
