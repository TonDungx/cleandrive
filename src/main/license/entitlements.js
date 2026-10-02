'use strict';

/**
 * What each tier includes, and the one function that answers "may this run".
 *
 * `can()` runs in the main process only. The window is told `{ feature,
 * allowed, reason }` for drawing, and never holds the licence itself.
 *
 * Three things never pass through here, whatever the licence says: the
 * confirmation in front of an action, the warnings in it, and the Action
 * Journal with everything that reads it -- the Restore Center above all. A
 * lapsed licence can make a feature read-only; it can never make something the
 * app did impossible to undo. `scripts/test-entitlements.js` checks those
 * modules do not even load this file.
 *
 * One Business feature lives inside the journal all the same -- the seal at
 * the end of each session (H4, `biz.audit`) -- and it keeps to that rule by
 * never asking: `services.js` asks, and hands the journal a sealer or none.
 * Checking the seals is reading, so it is never gated.
 *
 * @typedef License
 * @property {'free'|'trial'|'active'|'expired'} state
 * @property {'pro'|'business'} [tier]
 * @property {string[]} [addons]      ['dev']
 */

const FEATURES = Object.freeze({
  free: { tier: 'free' },
  'pro.scan.multiroot': { tier: 'pro' },
  'pro.scan.mft': { tier: 'pro' },
  'pro.diff': { tier: 'pro' },
  'pro.planner': { tier: 'pro' },
  'pro.quarantine': { tier: 'pro' },
  'pro.relocate': { tier: 'pro' },
  'pro.compress': { tier: 'pro' },
  'pro.archive': { tier: 'pro' },
  'pro.apps.lastused': { tier: 'pro' },
  'pro.games': { tier: 'pro' },
  'pro.chat': { tier: 'pro' },
  // No `pro.photos`: nothing ever asked for it. The Photos screen and E1-E5
  // were each decided free when they were built, and a key nobody checks is a
  // promise of a lock that does not exist (removed in Phase 6).
  'pro.dupes.advanced': { tier: 'pro' },
  'pro.reports': { tier: 'pro' },
  'pro.automatic.profiles': { tier: 'pro' },
  'pro.dev': { tier: 'pro', addon: 'dev' },
  'biz.cli': { tier: 'business' },
  'biz.policy': { tier: 'business' },
  'biz.console': { tier: 'business' },
  'biz.audit': { tier: 'business' },
});

const FREE = Object.freeze({ state: 'free' });

/**
 * @param {License} lic
 * @param {string} feature
 */
function can(lic, feature) {
  if (feature === 'free') return true;
  const f = FEATURES[feature];
  // A mistyped key fails loudly rather than quietly answering "no": a feature
  // that silently never unlocks is a bug nobody reports.
  if (!f) throw new Error(`unknown feature ${feature}`);
  const license = lic || FREE;

  if (license.state === 'trial' || license.state === 'active') {
    if (f.tier === 'business') return license.tier === 'business';
    if (f.addon) return (Array.isArray(license.addons) && license.addons.includes(f.addon)) || license.tier === 'business';
    return license.tier === 'pro' || license.tier === 'business';
  }
  return false;
}

/**
 * What an expired licence may still *look at*: the Pro data that was made
 * while it was valid (decided 2026-10-02, option A). Today that is one
 * thing -- comparing the scans already taken. Everything else a lapsed
 * licence leaves behind is reachable without asking at all: Restore and the
 * journal never ask, what is in quarantine is in Restore, a report is a file.
 *
 * Deliberately not "every Pro analysis keeps running": a 14-day trial ends as
 * `expired` too, and that reading would make every trial permanent Pro.
 */
const READ_AFTER_EXPIRY = Object.freeze(['pro.diff']);

function canRead(lic, feature) {
  return can(lic, feature) || Boolean(lic && lic.state === 'expired' && READ_AFTER_EXPIRY.includes(feature));
}

/**
 * Whether data made at these moments may be read: always while `feature` is
 * included, and when it has expired only data made before it did.
 *
 * @param {License} lic
 * @param {string} feature
 * @param {string[]} madeAt   ISO times
 */
function canReadMadeAt(lic, feature, madeAt) {
  if (can(lic, feature)) return true;
  if (!canRead(lic, feature) || !lic.expires) return false;
  const end = Date.parse(lic.expires);
  return madeAt.length > 0 && madeAt.every((at) => Date.parse(at) <= end);
}

/** Why a feature is not available, as a key the window can word. */
function reasonFor(lic, feature) {
  if (can(lic, feature)) return null;
  const f = FEATURES[feature];
  const license = lic || FREE;
  if (license.state === 'expired') return 'expired';
  if (f.tier === 'business') return 'needsBusiness';
  if (f.addon) return 'needsAddon';
  return 'needsPro';
}

/**
 * What the window is allowed to know: per feature, yes or no and why not.
 * Never the licence, its email, its key or its expiry.
 */
function forRenderer(lic) {
  return Object.keys(FEATURES)
    .filter((feature) => feature !== 'free')
    .map((feature) => ({ feature, allowed: can(lic, feature), reason: reasonFor(lic, feature) }));
}

module.exports = { FEATURES, FREE, READ_AFTER_EXPIRY, can, canRead, canReadMadeAt, reasonFor, forRenderer };
