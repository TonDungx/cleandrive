'use strict';

/**
 * The only categories an unattended run may ever act on.
 *
 * Hard-coded, and deliberately not derived from anything an analyzer says.
 * `unattendedEligible` on a candidate is the analyzer's opinion; this list is
 * the rule. The automatic run checks it again for itself, so an analyzer that
 * got it wrong -- or a future one that marks photographs eligible -- is refused
 * at the point where the deleting happens.
 *
 * Every entry is a category the advisor calls `safe`. `buildoutput` is on the
 * list but off by default in the settings: "safe to delete" and "safe to delete
 * at 2am while you are not looking" are different bars, and only the second is
 * the user's call.
 */
const ALLOWED = Object.freeze([
  'cleanup.temp',
  'cleanup.cache',
  'cleanup.crashdump',
  'cleanup.log',
  'cleanup.gpucache',
  'cleanup.buildoutput',
]);

const SET = new Set(ALLOWED);

function isAllowedUnattended(category) {
  return SET.has(category);
}

/** The same list in the advisor's own names, as the settings file stores them. */
const ALLOWED_ADVISOR_NAMES = Object.freeze(ALLOWED.map((id) => id.slice('cleanup.'.length)));

module.exports = { ALLOWED, ALLOWED_ADVISOR_NAMES, isAllowedUnattended };
