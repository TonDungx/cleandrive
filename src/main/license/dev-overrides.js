'use strict';

/**
 * The developer's way to choose a tier, in a checkout and nowhere else.
 *
 * A checkout opens every feature by default, so a developer sees the whole
 * app, and `CLEANDRIVE_ENTITLEMENTS` narrows it to test one tier:
 *
 *   CLEANDRIVE_ENTITLEMENTS = all | free | pro | pro+dev | business | stored
 *
 * `stored` is "as a release would": the licence in `license.dat`, Free when
 * there is none -- how the purchase screens are tried from a checkout.
 *
 * This file is left out of every build that is not the `dev` channel
 * (`scripts/build.js`), and `scripts/release-guard.js` fails such a build if
 * it, or the variable's name, turns up inside it anyway. Honouring the
 * variable in a release would make "set an environment variable" a way round
 * paying, and would make the build people run depend on an input nobody chose.
 */

const PRESETS = Object.freeze({
  all: Object.freeze({ state: 'active', tier: 'business', addons: ['dev'] }),
  business: Object.freeze({ state: 'active', tier: 'business', addons: [] }),
  'pro+dev': Object.freeze({ state: 'active', tier: 'pro', addons: ['dev'] }),
  pro: Object.freeze({ state: 'active', tier: 'pro', addons: [] }),
  free: Object.freeze({ state: 'free' }),
});

/**
 * The licence the variable asks for: null for `stored`, everything when unset
 * or unknown.
 *
 * @param {object} [env]
 */
function fromEnv(env = process.env) {
  const wanted = String(env.CLEANDRIVE_ENTITLEMENTS || 'all').trim().toLowerCase();
  if (wanted === 'stored') return null;
  const preset = PRESETS[wanted] || PRESETS.all;
  return Object.freeze({ ...preset, source: 'dev' });
}

module.exports = { PRESETS, fromEnv };
