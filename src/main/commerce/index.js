'use strict';

/**
 * The one way the app reaches a payment provider, and what happens around it.
 *
 * Phase 6: the mock, on every channel (decided 2026-10-02). On `dev` a
 * harness may choose its outcome and latency (`dev-overrides.js`); a
 * release build cannot be told either, the same rule as the entitlements.
 * Phase 7 returns the real provider here and nothing else changes (§8.3).
 *
 * Renderer requests never reach the network directly (§7.7): the window asks
 * over IPC, this module asks the provider, and a licence that comes back is
 * activated here before the window hears that it succeeded.
 */

const path = require('node:path');

const { BUILD_INFO } = require('../build-info');
const { MockPaymentProvider } = require('./mock-provider');
const { PLANS, quote } = require('./quote');
const licence = require('../license/state');
const issuer = require('../license/mock-issuer');
const { machineId } = require('../license/machine');

const DAY = 24 * 60 * 60 * 1000;

function devMockOptions(channel, env) {
  if (channel !== 'dev') return {};
  try {
    // eslint-disable-next-line global-require
    return require('../license/dev-overrides').mockOptions(env);
  } catch {
    return {};
  }
}

let provider = null;
let providerDir = null;

/**
 * @param {object} options
 * @param {string} options.dir      userData, where `orders.json` lives
 * @param {string} [options.channel]
 * @param {object} [options.env]
 */
function getProvider({ dir, channel = BUILD_INFO.channel, env = process.env }) {
  if (!provider || providerDir !== dir) {
    provider = new MockPaymentProvider({ ordersFile: path.join(dir, 'orders.json'), ...devMockOptions(channel, env) });
    providerDir = dir;
  }
  return provider;
}

/** For the harness: forget the provider so the next call reads the options again. */
function resetForHarness() {
  provider = null;
  providerDir = null;
}

/**
 * Pay, and activate what comes back.
 *
 * @param {object} req   CheckoutRequest without machineId, which is added here
 * @param {object} ctx   { dir, signal, dpapi }
 * @returns {Promise<object>} the provider's result, with `licence` when one was activated
 */
async function checkout(req, { dir, signal, dpapi } = {}) {
  const p = getProvider({ dir });
  const coupon = req.coupon ? await p.coupon(req.coupon, req.planId) : null;
  if (req.coupon && !(coupon && coupon.valid)) return { status: 'failed', errorCode: 'coupon_invalid' };
  const q = quote({ planId: req.planId, addons: req.addons, seats: req.seats, discount: coupon ? coupon.discount : 0 });
  if (!q.ok) return { status: 'failed', errorCode: 'invalid_request' };

  const result = await p.checkout({
    planId: q.planId,
    addons: q.addons,
    seats: q.seats,
    currency: q.currency,
    method: req.method,
    email: req.email,
    coupon: req.coupon || undefined,
    discount: coupon ? coupon.discount : 0,
    total: q.total,
    machineId: await machineId(),
  }, { signal });
  return settle(result, { email: req.email, dpapi });
}

/** A late confirmation (pending transfer, timeout): ask the provider again. */
async function status(orderId, { dir, dpapi } = {}) {
  const result = await getProvider({ dir }).status(orderId);
  return settle(result, { email: result.email || null, dpapi });
}

async function settle(result, { email, dpapi }) {
  const { email: _ignored, licenseToken, ...rest } = result;
  if (result.status !== 'succeeded' || !licenseToken) return rest;
  const activated = await licence.activate(licenseToken, { email, dpapi });
  if (!activated.ok) return { status: 'failed', orderId: result.orderId, errorCode: `licence.${activated.reason}` };
  return { ...rest, licence: activated.licence, token: licenseToken };
}

/** The 14-day Pro trial, once per copy. */
async function startTrial({ dpapi, now = Date.now() } = {}) {
  if (licence.storedLicence().trialUsed) return { ok: false, reason: 'trialUsed' };
  const { token } = issuer.issue({
    plan: PLANS.trial.plan,
    tier: PLANS.trial.tier,
    seats: 1,
    expires: new Date(now + PLANS.trial.days * DAY).toISOString(),
    trial: true,
    now,
  });
  return licence.activate(token, { dpapi });
}

module.exports = { getProvider, resetForHarness, checkout, status, startTrial, quote, PLANS };
