'use strict';

/**
 * The payment provider until real payment exists (ROADMAP §7.4).
 *
 * "Pay" succeeds, on every channel, stable included (decided 2026-10-02):
 * the screens are built as production, and the one thing this does not do is
 * take money. On the `dev` channel a harness can ask for any other outcome
 * (`dev-overrides.js`), so every screen the real provider could lead to is
 * built and tested now:
 *
 *   succeeded | failed:card_declined | failed:network | failed:timeout | cancelled | pending
 *
 * A `pending` order (a bank transfer not yet confirmed) and a `timeout` (no
 * answer, but the money may have gone) both turn into a licence the next time
 * `status()` is asked -- the confirmation arriving late, which is what the
 * "Check again" button is for.
 *
 * Orders are kept in `orders.json` beside the settings, so the invoices on
 * the Plans & licence screen survive a restart. They name the plan, the
 * price and the method -- never the email address.
 */

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { PaymentProvider, METHODS } = require('./provider');
const { PLANS, quote } = require('./quote');
const issuer = require('../license/mock-issuer');
const { renameRetrying } = require('../lib/atomic');

const OUTCOMES = Object.freeze(['succeeded', 'failed:card_declined', 'failed:network', 'failed:timeout', 'cancelled', 'pending']);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;
const YEAR = 365 * 24 * 60 * 60 * 1000;
const MAX_ORDERS = 200;

function aborted() {
  return Object.assign(new Error('The payment was stopped.'), { name: 'AbortError' });
}

const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(aborted());
      return;
    }
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(aborted());
      }, { once: true });
    }
  });

class MockPaymentProvider extends PaymentProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.outcome]
   * @param {number} [options.latencyMs]
   * @param {string|null} [options.ordersFile]   null keeps orders in memory only
   * @param {() => number} [options.now]
   */
  constructor({ outcome = 'succeeded', latencyMs = 1200, ordersFile = null, now = () => Date.now() } = {}) {
    super();
    this.outcome = OUTCOMES.includes(outcome) ? outcome : 'succeeded';
    this.latencyMs = latencyMs;
    this.ordersFile = ordersFile;
    this.now = now;
    this._orders = null;
  }

  async plans() {
    return PLANS;
  }

  async coupon(code, planId) {
    if (!PLANS.plans.some((p) => p.id === planId)) return { valid: false, reason: 'coupon.unknownPlan' };
    if (String(code || '').trim().toUpperCase() === 'TEST10') return { valid: true, discount: 0.1 };
    return { valid: false, reason: 'coupon.notFound' };
  }

  async _load() {
    if (this._orders) return this._orders;
    this._orders = [];
    if (!this.ordersFile) return this._orders;
    try {
      const data = JSON.parse(await fsp.readFile(this.ordersFile, 'utf8'));
      if (data && data.format === 'cleandrive.orders' && Array.isArray(data.orders)) this._orders = data.orders;
    } catch {
      this._orders = [];
    }
    return this._orders;
  }

  async _save() {
    if (!this.ordersFile) return;
    const orders = this._orders.slice(0, MAX_ORDERS);
    await fsp.mkdir(path.dirname(this.ordersFile), { recursive: true });
    const temp = `${this.ordersFile}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify({ format: 'cleandrive.orders', version: 1, orders }, null, 2)}\n`, 'utf8');
    await renameRetrying(temp, this.ordersFile);
  }

  _licenceFor(order, email) {
    const at = this.now();
    return issuer.issue({
      plan: order.planId,
      tier: order.tier,
      addons: order.tier === 'business' ? [] : order.addons,
      seats: order.seats,
      email,
      orderId: order.orderId,
      expires: order.period === 'lifetime' ? null : new Date(at + YEAR).toISOString(),
      now: at,
    }).token;
  }

  /** @param {import('./provider').CheckoutRequest} req */
  async checkout(req, { signal } = {}) {
    const q = quote({ planId: req.planId, addons: req.addons, seats: req.seats, discount: req.discount || 0 });
    if (!q.ok || !EMAIL.test(String(req.email || '')) || !METHODS.includes(req.method) || req.currency !== PLANS.currency ||
        (Number.isFinite(req.total) && req.total !== q.total)) {
      return { status: 'failed', errorCode: 'invalid_request' };
    }
    await delay(this.latencyMs, signal);

    const orders = await this._load();
    const orderId = `mock_${this.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const [status, errorCode] = this.outcome.split(':');
    const order = {
      orderId,
      planId: q.planId,
      tier: q.tier,
      period: q.period,
      addons: q.addons,
      seats: q.seats,
      total: q.total,
      currency: q.currency,
      method: req.method,
      machineId: req.machineId || null,
      createdAt: new Date(this.now()).toISOString(),
      status,
      ...(errorCode ? { errorCode } : {}),
    };
    // Only what can still become a licence is kept: a card refused or a
    // checkout cancelled charged nothing and has nothing to show later.
    if (status === 'pending' || errorCode === 'timeout') {
      orders.unshift(order);
      // Held in memory for the late licence, never written to the file.
      this._pendingEmail = { ...(this._pendingEmail || {}), [orderId]: req.email };
      await this._save();
      return { status, orderId, ...(errorCode ? { errorCode } : {}) };
    }
    if (status !== 'succeeded') return { status, orderId, ...(errorCode ? { errorCode } : {}) };

    const licenseToken = this._licenceFor(order, req.email);
    order.paidAt = order.createdAt;
    orders.unshift(order);
    await this._save();
    return { status: 'succeeded', orderId, licenseToken };
  }

  async status(orderId) {
    const orders = await this._load();
    const order = orders.find((o) => o.orderId === orderId);
    if (!order) return { status: 'failed', errorCode: 'order.notFound' };
    if (order.status === 'succeeded') return { status: 'succeeded', orderId, alreadyActivated: true };
    if (order.status === 'pending' || order.errorCode === 'timeout') {
      // The confirmation arrives: the money did go, and the licence is issued now.
      const email = (this._pendingEmail || {})[orderId] || null;
      const licenseToken = this._licenceFor(order, email);
      order.status = 'succeeded';
      delete order.errorCode;
      order.paidAt = new Date(this.now()).toISOString();
      await this._save();
      return { status: 'succeeded', orderId, licenseToken, email };
    }
    return { status: order.status, orderId, ...(order.errorCode ? { errorCode: order.errorCode } : {}) };
  }

  async invoices() {
    const orders = await this._load();
    return orders
      .filter((o) => o.status === 'succeeded')
      .map((o) => ({
        orderId: o.orderId, planId: o.planId, addons: o.addons, seats: o.seats, total: o.total,
        currency: o.currency, method: o.method, paidAt: o.paidAt || o.createdAt, url: null,
      }));
  }
}

module.exports = { MockPaymentProvider, OUTCOMES, EMAIL };
