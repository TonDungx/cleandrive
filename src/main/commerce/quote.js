'use strict';

/**
 * What a choice of plan costs, worked out in one place.
 *
 * The checkout screen shows it and the provider is asked for exactly it, so
 * the number on the Pay button and the number on the order cannot differ.
 * Prices come from `plans.json` and are **sample data** (§7.2.3: real prices
 * need market research; decided 2026-10-02 to keep the sample, in VND only).
 * Every amount is a whole number of đồng.
 */

const PLANS = require('./plans.json');

/** The plan by id, or null. */
function planOf(id, plans = PLANS) {
  return plans.plans.find((p) => p.id === id) || null;
}

/**
 * @param {object} choice
 * @param {string} choice.planId
 * @param {string[]} [choice.addons]
 * @param {number} [choice.seats]
 * @param {number} [choice.discount]   0..1, from a coupon the provider accepted
 * @returns {{ ok: true, planId, tier, period, seats, addons, lines, discount, total, currency } | { ok: false, reason: string }}
 */
function quote({ planId, addons = [], seats, discount = 0 }, plans = PLANS) {
  const plan = planOf(planId, plans);
  if (!plan) return { ok: false, reason: 'unknownPlan' };
  const n = seats === undefined ? plan.defaultSeats : seats;
  const tier = plan.seats.find((s) => s.n === n);
  if (!tier) return { ok: false, reason: 'unknownSeats' };
  const wanted = [...new Set(addons)];
  if (wanted.some((a) => !Object.prototype.hasOwnProperty.call(plan.addons, a))) return { ok: false, reason: 'unknownAddon' };
  if (!(discount >= 0 && discount < 1)) return { ok: false, reason: 'badDiscount' };

  const lines = [{ item: 'plan', id: plan.id, amount: tier.price }];
  for (const a of wanted) lines.push({ item: 'addon', id: a, amount: plan.addons[a] });
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const off = Math.round(subtotal * discount);
  return {
    ok: true,
    planId: plan.id,
    tier: plan.tier,
    period: plan.period,
    seats: n,
    addons: wanted,
    lines,
    discount: off,
    total: subtotal - off,
    currency: plans.currency,
  };
}

module.exports = { PLANS, planOf, quote };
