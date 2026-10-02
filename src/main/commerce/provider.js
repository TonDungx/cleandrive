'use strict';

/**
 * What any payment provider answers (ROADMAP §7.3).
 *
 * Phase 6 has one, `mock-provider.js`. Phase 7 writes a real one against the
 * same methods and changes no screen (§8.3 step 6): every state the UI can be
 * in is one of the results below, and the mock can produce each of them.
 *
 * @typedef CheckoutRequest
 * @property {string}   planId      'pro-annual' | 'pro-lifetime' | 'business-annual'
 * @property {string[]} addons      ['dev']
 * @property {number}   seats
 * @property {'VND'}    currency    VND only (decided 2026-10-02)
 * @property {'card'|'momo'|'vnpay'|'bank_qr'} method
 * @property {string}   email
 * @property {string}   [coupon]
 * @property {string|null} machineId   salted hash, never the raw MachineGuid (license/machine.js)
 * @property {number}   total       what the screen showed on the Pay button, from quote.js
 *
 * @typedef CheckoutResult
 * @property {'succeeded'|'failed'|'cancelled'|'pending'} status
 * @property {string}  [orderId]
 * @property {string}  [licenseToken]   only when succeeded
 * @property {string}  [errorCode]      'card_declined' | 'network' | 'timeout' | 'invalid_request' | 'order.notFound'
 *
 * @typedef Invoice
 * @property {string} orderId
 * @property {string} planId
 * @property {string[]} addons
 * @property {number} seats
 * @property {number} total
 * @property {string} currency
 * @property {string} method
 * @property {string} paidAt        ISO
 * @property {string|null} url      the provider's copy; none for the mock
 */

const METHODS = Object.freeze(['card', 'momo', 'vnpay', 'bank_qr']);

class PaymentProvider {
  /** @returns {Promise<object>} plans.json's shape */
  async plans() {
    throw new Error('not implemented');
  }

  /** @returns {Promise<{ valid: boolean, discount?: number, reason?: string }>} */
  // eslint-disable-next-line no-unused-vars
  async coupon(code, planId) {
    throw new Error('not implemented');
  }

  /** @returns {Promise<CheckoutResult>} */
  // eslint-disable-next-line no-unused-vars
  async checkout(req, { signal } = {}) {
    throw new Error('not implemented');
  }

  /** @returns {Promise<CheckoutResult>} */
  // eslint-disable-next-line no-unused-vars
  async status(orderId) {
    throw new Error('not implemented');
  }

  /** @returns {Promise<Invoice[]>} */
  async invoices() {
    throw new Error('not implemented');
  }
}

module.exports = { PaymentProvider, METHODS };
