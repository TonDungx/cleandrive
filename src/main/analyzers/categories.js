'use strict';

/**
 * Every category a candidate may carry, declared before anything produces one.
 *
 * Declared up front, rather than being whatever string an analyzer happened to
 * write, so that two things can be known without running a scan: which screen a
 * category belongs to, and whether it is ever allowed near the automatic run.
 * An analyzer that invents a category fails validation instead of inventing a
 * new kind of thing the app might delete.
 *
 * The cleanup categories are the advisor's own table, prefixed, so there is
 * exactly one list of them in the codebase.
 */

const { CATEGORIES: ADVISOR_CATEGORIES } = require('../lib/advisor');

const DECLARED = new Map();

function declare(id, { screen }) {
  if (DECLARED.has(id)) throw new Error(`duplicate category ${id}`);
  DECLARED.set(id, Object.freeze({ id, screen }));
}

// "What to delete": one per advisor category.
for (const name of Object.keys(ADVISOR_CATEGORIES)) declare(`cleanup.${name}`, { screen: 'cleanup' });

// "Disk usage": a large file the advisor had nothing to say about.
declare('usage.file', { screen: 'usage' });

// "What to delete", in a group of its own: a OneDrive file whose contents are
// in the cloud and on this disk, which can be made online-only (B3). Never a
// thing to delete, never on the automatic whitelist.
declare('cloud.dehydrate', { screen: 'cleanup' });

// "Duplicates": one copy in a group of byte-identical files.
declare('dupes.copy', { screen: 'duplicates' });
// A whole folder that holds the same thing as another, and one that nearly
// does (F2). The folder row itself is a heading and carries no action -- the
// interface never deletes a folder -- so what can be acted on is the files
// inside it, which are `dupes.folderFile`. Never on the automatic whitelist:
// nothing about "which copy of a project to keep" is a decision to take while
// nobody is looking.
declare('dupes.folder', { screen: 'duplicates' });
declare('dupes.nearFolder', { screen: 'duplicates' });
declare('dupes.folderFile', { screen: 'duplicates' });
// One document in a set that looks like versions of one another (F3). Never
// better than `likely`, never on the automatic whitelist, and never part of a
// "select all but the newest" -- a name is far too weak a thing to delete on.
declare('dupes.version', { screen: 'duplicates' });

// "Photos & video".
declare('media.image', { screen: 'media' });
declare('media.video', { screen: 'media' });

// "System": one per row of the drive's breakdown (A1). None of them is ever on
// the automatic whitelist; the app only explains these and opens Windows' tools.
for (const key of [
  'profile', 'profileSkipped', 'otherFolders', 'otherAccounts', 'recycleBin', 'programs', 'programData', 'windows',
  'winsxs', 'driverStore', 'installer', 'updateCache', 'deliveryOptimization', 'windowsOld', 'upgrade', 'recovery',
  'systemHidden', 'hiberfil', 'pagefile', 'swapfile', 'restorePoints', 'reservedStorage', 'ntfsMetadata',
]) {
  declare(`system.${key}`, { screen: 'system' });
}

// "Apps": one per installed program (D1). Never `safe`, never on the automatic
// whitelist -- the app's whole part in removing one is opening Windows' own
// list and showing the command the program's uninstaller registered.
declare('apps.installed', { screen: 'apps' });
declare('apps.store', { screen: 'apps' });

// "Games": the Steam library (D2). A game is never `safe` and is never acted
// on by the app -- Steam has to do it, or it stops recognising the game. The
// leftovers Steam keeps no record of are files, and those can go to the bin.
declare('games.steam', { screen: 'games' });
declare('games.orphan', { screen: 'games' });
declare('games.downloading', { screen: 'games' });

// "Developer": the tools a developer's disk fills up with (C2, C4). A package
// cache is explained and handed to the tool that made it; an IDE's own cache
// can go to the bin, and only while that IDE is closed.
declare('dev.packageCache', { screen: 'dev' });
declare('dev.sdk', { screen: 'dev' });
declare('dev.ideCache', { screen: 'dev' });
// A WSL distribution's disk and Docker's data disk (C3). Both are explained
// and never touched: what clears them does not go through the Recycle Bin.
declare('dev.wslDistro', { screen: 'dev' });
declare('dev.dockerDisk', { screen: 'dev' });
// A project's dependency folder (C1) and what its builds left behind (C5).
// The dependency folder is explained and handed back to the tool that fills
// it -- 232,229 files across nineteen folders on this machine is not a list
// anybody picks through. A build folder the project's own `.gitignore`
// declares is listed and can go to the bin.
declare('dev.dependencies', { screen: 'dev' });
declare('dev.buildOutput', { screen: 'dev' });

function isDeclared(id) {
  return DECLARED.has(id);
}

function assertCategoryDeclared(id) {
  if (!DECLARED.has(id)) throw new Error(`category ${id} is not declared in categories.js`);
}

function describe(id) {
  return DECLARED.get(id) || null;
}

function all() {
  return [...DECLARED.keys()];
}

/** `cleanup.temp` -> `temp`, the name the advisor and the settings file use. */
function advisorName(id) {
  return id.startsWith('cleanup.') ? id.slice('cleanup.'.length) : null;
}

module.exports = { isDeclared, assertCategoryDeclared, describe, all, advisorName };
