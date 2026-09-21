'use strict';

const path = require('node:path');

const { message: m } = require('../../../i18n');

/**
 * Where to look for photographs, and where not to.
 *
 * ## The measurement this file exists because of
 *
 * The first plan was "scan the whole drive, then filter out the junk". A
 * thirty-second walk of the development machine's home folder found 10,185
 * files with a picture extension. Of those:
 *
 *   - **97% were under 20 KB** -- sprites, icons, spacers, avatars;
 *   - **9,676 of them sat in two folders**, both the unpacked contents of an
 *     archive somebody downloaded, full of a web application's interface
 *     assets;
 *   - the whole scan turned up **71 JPEGs and 11 videos** that were anybody's
 *     actual media;
 *   - and it was still 41,925 directories from finishing.
 *
 * So "scan everything and filter" is not a slower version of the right answer,
 * it is the wrong answer arrived at slowly. A screen meant for deciding which
 * holiday photographs to delete, that opens on ten thousand interface sprites,
 * has failed before the user has done anything.
 *
 * What is scanned instead is a short list of places pictures actually live,
 * every one of which the user can see and change, plus anything they add. The
 * cost of being wrong in this direction is a folder somebody has to add by
 * hand; the cost of being wrong in the other is a feature nobody can use.
 *
 * ## Downloads is opt-in, on its own
 *
 * It is where the 9,676 were, and it is also where a real photograph somebody
 * was sent ends up. So it is offered, off by default, as its own switch rather
 * than being quietly folded in or quietly left out.
 */

/* -------------------------------------------------------------------------- */
/* the default roots                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Folders under the home directory that hold media, by their English names.
 *
 * Windows localises the *display* name of a known folder but not the path, with
 * one large exception: when the folder is redirected into OneDrive, the folder
 * on disk is genuinely called `Hình ảnh` on this machine. That is why Pictures
 * and Videos come from Electron's own `getPath` and only the rest are names.
 */
const HOME_FOLDERS = [
  {
    name: 'Camera Roll',
    relative: ['Pictures', 'Camera Roll'],
    why: m('media.root.cameraRoll', 'Where Windows puts photos imported from a camera or phone'),
  },
  {
    name: 'Screenshots',
    relative: ['Pictures', 'Screenshots'],
    why: m('media.root.screenshots', 'Where the Windows screenshot key saves to'),
  },
  {
    name: 'Saved Pictures',
    relative: ['Pictures', 'Saved Pictures'],
    why: m('media.root.savedPictures', 'Pictures saved from apps'),
  },
  {
    name: 'Captures',
    relative: ['Videos', 'Captures'],
    why: m('media.root.captures', 'Where the Windows game bar records gameplay'),
  },
  {
    name: 'CrossDevice',
    relative: ['CrossDevice'],
    why: m('media.root.crossDevice', 'Photos that Phone Link copied over from a phone'),
  },
  {
    name: 'Zalo Received Files',
    relative: ['Documents', 'Zalo Received Files'],
    why: m('media.root.zalo', 'Files received in Zalo'),
  },
  {
    name: 'ZaloPC Received Files',
    relative: ['Documents', 'ZaloPC Received Files'],
    why: m('media.root.zalo', 'Files received in Zalo'),
  },
];

/**
 * Media folders belonging to messaging apps, under the roaming or local profile.
 *
 * These are read-only as far as this app is concerned in one specific sense:
 * `advisor.js` refuses to call anything inside `AppData\Roaming` disposable,
 * and that guard stays. A photo somebody was sent is still the user's to
 * delete, but it is never *suggested*, and the reason shown says where it is.
 */
const APP_FOLDERS = [
  {
    name: 'Telegram Desktop',
    env: 'APPDATA',
    relative: ['Telegram Desktop', 'tdata', 'user_data', 'media_cache'],
    why: m('media.root.telegram', 'Media cached by Telegram Desktop'),
  },
  {
    name: 'WhatsApp Media',
    env: 'USERPROFILE',
    relative: ['Documents', 'WhatsApp', 'Media'],
    why: m('media.root.whatsapp', 'Media received in WhatsApp'),
  },
  {
    name: 'Viber Downloads',
    env: 'USERPROFILE',
    relative: ['Documents', 'ViberDownloads'],
    why: m('media.root.viber', 'Files received in Viber'),
  },
];

/**
 * Build the list of candidate roots for this machine.
 *
 * `known` is Electron's answer to `app.getPath` -- injected rather than
 * imported, so this module stays testable and stays runnable outside Electron.
 * Every entry the caller gets back says where it is, why it is there, and
 * whether it is on by default; nothing is scanned that the user cannot see
 * listed.
 *
 * @param {{pictures: string|null, videos: string|null, downloads: string|null, home: string}} known
 * @param {(p: string) => boolean} exists
 * @returns {Array<{path: string, name: string, why: object, defaultOn: boolean}>}
 */
function candidateRoots(known, exists) {
  const out = [];
  const seen = new Set();

  const add = (target, name, why, defaultOn) => {
    if (!target) return;
    const resolved = path.resolve(target);
    const key = resolved.toLowerCase();
    if (seen.has(key)) return;
    if (!exists(resolved)) return;
    seen.add(key);
    out.push({ path: resolved, name, why, defaultOn });
  };

  // The two that matter most, and the two most likely to have been redirected
  // into a cloud folder -- which is exactly why they are asked for by name
  // rather than assembled from the home directory.
  add(known.pictures, 'Pictures', m('media.root.pictures', 'Your Pictures folder'), true);
  add(known.videos, 'Videos', m('media.root.videos', 'Your Videos folder'), true);

  for (const folder of HOME_FOLDERS) {
    // Anchored on the known folder where there is one, so a redirected Pictures
    // takes its children with it.
    const base =
      folder.relative[0] === 'Pictures' && known.pictures ? [known.pictures, ...folder.relative.slice(1)]
        : folder.relative[0] === 'Videos' && known.videos ? [known.videos, ...folder.relative.slice(1)]
          : [known.home, ...folder.relative];
    add(path.join(...base.filter(Boolean)), folder.name, folder.why, true);
  }

  for (const folder of APP_FOLDERS) {
    const base = process.env[folder.env];
    if (!base) continue;
    add(path.join(base, ...folder.relative), folder.name, folder.why, true);
  }

  // Off by default, and on its own, because of the 9,676.
  add(known.downloads, 'Downloads', m('media.root.downloads',
    'Where downloads land — usually the largest source of images that are not yours'), false);

  return out;
}

/* -------------------------------------------------------------------------- */
/* what never gets walked                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Directory names refused outright during a media scan.
 *
 * `walk` already refuses system locations, `.git`, `node_modules` and the rest.
 * These are the ones specific to looking for photographs: places that hold
 * thousands of images, none of which is a photograph.
 */
const REFUSED_DIR_NAMES = new Set([
  'appdata',
  '.cache',
  'cache',
  'cache2',
  'caches',
  'code cache',
  'gpucache',
  'shadercache',
  'thumbnails',
  'thumbs',
  '.thumbnails',
  'temp',
  'tmp',
  'vendor',
  'site-packages',
  'dist-packages',
  'bower_components',
  'jspm_packages',
  '.gradle',
  '.nuget',
  '.cargo',
  '.tox',
  'venv',
  'virtualenv',
  '.next',
  '.nuxt',
  'obj',
  'target',
  // An icon theme is thousands of pictures and none of them is anybody's.
  'icons',
  'emoji',
  'emojis',
  'sprites',
  'favicons',
]);

/**
 * Suffixes that mark a directory as belonging to a program rather than a person.
 */
const REFUSED_DIR_SUFFIXES = ['.app', '.framework', '.lproj', '.bundle'];

/**
 * The refusal a media scan hands to `walk`.
 *
 * Returns the same `{kind, reason}` shape the built-in skips use, so the scan
 * can report every excluded folder with the reason it was excluded -- this app
 * does not hide a decision behind a number.
 *
 * @returns {{kind: string, reason: object} | null}
 */
function excludeDir(name) {
  const lower = name.toLowerCase();

  if (REFUSED_DIR_NAMES.has(lower)) {
    return { kind: 'media-noise', reason: m('media.skip.noise', 'Holds program data, not photographs') };
  }
  for (const suffix of REFUSED_DIR_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return { kind: 'media-noise', reason: m('media.skip.program', 'Part of an installed program') };
    }
  }
  return null;
}

/**
 * A folder that is plainly an unpacked archive of interface assets.
 *
 * This is the other half of the 9,676. The two folders were not named anything
 * recognisable -- `e8Qh34623` and `vLvo67779` -- so no list of names would ever
 * have caught them, and their *shape* alone does not either: "hundreds of
 * images in one folder" describes an album of holiday photographs just as well.
 *
 * What separates them is size. An album is megabytes a picture; an asset dump
 * is kilobytes a picture, because every file in it is a 32-pixel icon. So this
 * runs **after** the probe, on files whose sizes are known, rather than at walk
 * time on a directory listing -- which is where it was first written, and where
 * it would have hidden somebody's photographs.
 *
 * It also only ever *nominates*. The folder is reported with this reason and
 * its files are filtered out of the default view; nothing is deleted and one
 * click puts it back.
 *
 * @param {Array<{size: number}>} records every media file found in one folder
 */
const ASSET_FOLDER_MIN_FILES = 150;
const ASSET_FOLDER_MEDIAN_BYTES = 20 * 1024;

function looksLikeAssetDump(records) {
  if (!records || records.length < ASSET_FOLDER_MIN_FILES) return false;

  // The median rather than the mean: one 8 MB photograph dropped into a folder
  // of 500 icons drags a mean over any threshold, and that is exactly the
  // arrangement a real download folder ends up in.
  const sizes = records.map((r) => r.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  return median < ASSET_FOLDER_MEDIAN_BYTES;
}

module.exports = {
  candidateRoots,
  excludeDir,
  looksLikeAssetDump,
  REFUSED_DIR_NAMES,
  ASSET_FOLDER_MIN_FILES,
  ASSET_FOLDER_MEDIAN_BYTES,
  HOME_FOLDERS,
  APP_FOLDERS,
};
