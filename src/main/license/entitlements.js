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
  'pro.photos': { tier: 'pro' },
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
 * An expired licence keeps everything readable: snapshots, reports, what is in
 * quarantine. Only acting is locked.
 */
function canRead(lic, feature) {
  return can(lic, feature) || Boolean(lic && lic.state === 'expired' && FEATURES[feature]);
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

module.exports = { FEATURES, FREE, can, canRead, reasonFor, forRenderer };
