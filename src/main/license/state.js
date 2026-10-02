'use strict';

/**
 * The licence this process is running under.
 *
 * There is no licence storage yet -- activation, trials and `license.dat` are
 * Phase 6. Until then a release build has **Pro open to everyone**: decided on
 * 2026-09-24, before the first Pro feature (the snapshot comparison) shipped,
 * over locking it behind a purchase that cannot yet be made. Pro·Dev and
 * Business stay closed; whether they open too is still to be decided. Phase 6
 * has to take this back, and must say so to whoever has been using it.
 *
 * A checkout is different: it opens every feature by default, so a developer
 * sees the whole app, and can narrow it to one tier (`dev-overrides.js`). That
 * module is not in a release build at all, and is only ever loaded here, on
 * the `dev` channel -- so a release has no way to be told a tier by its
 * environment.
 */

const { BUILD_CHANNEL } = require('../build-info');
const entitlements = require('./entitlements');

/**
 * What a release build runs under until licences exist (see above).
 *
 * The `dev` add-on joined it when the Developer Pack was built, decided
 * 2026-09-26 along with the rest of Phase 2: the same reasoning as Pro, since
 * there is still no way to buy either. Whether Pro·Dev stays an add-on or
 * becomes part of Pro is a Phase 6 question, and the key stays separate so
 * that question is still open.
 */
const OPEN_PRO = Object.freeze({ state: 'active', tier: 'pro', addons: ['dev'] });

/**
 * The developer's choice, on the `dev` channel only. A dev channel without
 * the module (it cannot happen in a checkout; it would mean a build that
 * mislabels itself) gets nothing rather than everything.
 */
function devLicence(env) {
  let overrides = null;
  try {
    // eslint-disable-next-line global-require
    overrides = require('./dev-overrides');
  } catch {
    return Object.freeze({ ...entitlements.FREE, source: 'dev' });
  }
  return overrides.fromEnv(env);
}

/**
 * @param {object} [options]  injectable, for the harness
 * @param {string} [options.channel]
 * @param {object} [options.env]
 */
function currentLicense({ channel = BUILD_CHANNEL, env = process.env } = {}) {
  if (channel === 'dev') return devLicence(env);
  return Object.freeze({ ...OPEN_PRO, source: 'open' });
}

/** A `can` bound to the current licence, for the registry and the pipeline. */
function canNow(options) {
  const lic = currentLicense(options);
  return (feature) => entitlements.can(lic, feature);
}

module.exports = { currentLicense, canNow, OPEN_PRO };
