'use strict';

/**
 * Signs licences, until a licence server exists (Phase 7).
 *
 * Every licence in Phase 6 comes from here: a purchase through the mock
 * provider, and the 14-day trial. Its private key (`mock-key.pem`) ships in
 * every build, because "Pay" succeeds on every channel until real payment
 * exists (decided 2026-10-02) -- so anybody who opens the app can sign
 * themselves a licence, which is exactly what pressing Pay does. Phase 7
 * stops believing this key on `stable`, and those licences then end (decided
 * the same day, and said in advance on the Plans & licence screen).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const token = require('./token');

const KID = 'mock-2026-10';
let privateKey = null;

function key() {
  if (!privateKey) privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'mock-key.pem'), 'utf8'));
  return privateKey;
}

/**
 * @param {object} f
 * @param {string} f.plan            'pro-annual' | 'pro-lifetime' | 'business-annual' | 'pro-trial'
 * @param {'pro'|'business'} f.tier
 * @param {string[]} [f.addons]
 * @param {number} [f.seats]
 * @param {string|null} [f.email]    hashed into the token, never written in it
 * @param {string|null} [f.orderId]
 * @param {string|null} f.expires    ISO, or null for lifetime
 * @param {boolean} [f.trial]
 * @param {number} [f.now]
 * @returns {{ token: string, id: string }}
 */
function issue({ plan, tier, addons = [], seats = 1, email = null, orderId = null, expires, trial = false, now = Date.now() }) {
  const id = `lic_${crypto.randomBytes(8).toString('hex')}`;
  const payload = {
    v: token.VERSION,
    kid: KID,
    id,
    plan,
    tier,
    addons: [...addons],
    seats,
    emailHash: email ? token.emailHash(email) : null,
    orderId,
    issuedAt: new Date(now).toISOString(),
    expires,
    trial,
  };
  if (!token.wellFormed(payload)) throw new Error(`mock issuer: refusing to sign a malformed licence (${plan})`);
  return { token: token.encode(payload, key()), id };
}

module.exports = { issue, KID };
