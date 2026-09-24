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
 * sees the whole app, and `CLEANDRIVE_ENTITLEMENTS` narrows it to test one
 * tier. A release build ignores that variable entirely. Honouring it there
 * would make "set an environment variable" a way round paying, and more to the
 * point would make the build that users run depend on an input nobody chose.
 *
 *   CLEANDRIVE_ENTITLEMENTS = all | free | pro | pro+dev | business
 */

const { BUILD_CHANNEL } = require('../build-info');
const entitlements = require('./entitlements');

const PRESETS = Object.freeze({
  all: { state: 'active', tier: 'business', addons: ['dev'] },
  business: { state: 'active', tier: 'business', addons: [] },
  'pro+dev': { state: 'active', tier: 'pro', addons: ['dev'] },
  pro: { state: 'active', tier: 'pro', addons: [] },
  free: { state: 'free' },
});

/** What a release build runs under until licences exist (see above). */
const OPEN_PRO = Object.freeze({ state: 'active', tier: 'pro', addons: [] });

/**
 * @param {object} [options]  injectable, for the harness
 * @param {string} [options.channel]
 * @param {object} [options.env]
 */
function currentLicense({ channel = BUILD_CHANNEL, env = process.env } = {}) {
  if (channel === 'dev') {
    const wanted = String(env.CLEANDRIVE_ENTITLEMENTS || 'all').trim().toLowerCase();
    const preset = PRESETS[wanted] || PRESETS.all;
    return Object.freeze({ ...preset, source: 'dev' });
  }
  return Object.freeze({ ...OPEN_PRO, source: 'open' });
}

/** A `can` bound to the current licence, for the registry and the pipeline. */
function canNow(options) {
  const lic = currentLicense(options);
  return (feature) => entitlements.can(lic, feature);
}

module.exports = { currentLicense, canNow, PRESETS, OPEN_PRO };
