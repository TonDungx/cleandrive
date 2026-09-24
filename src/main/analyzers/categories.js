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

// "Duplicates": one copy in a group of byte-identical files.
declare('dupes.copy', { screen: 'duplicates' });

// "Photos & video".
declare('media.image', { screen: 'media' });
declare('media.video', { screen: 'media' });

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
