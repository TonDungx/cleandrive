'use strict';

/**
 * A licence as text, and what it is worth to this build.
 *
 * ## The format (ROADMAP §7.5)
 *
 *   base64url(payload JSON) "." base64url(Ed25519 signature of those bytes)
 *
 *   { v: 1, kid, id, plan, tier: 'pro'|'business', addons: ['dev'], seats,
 *     emailHash, orderId, issuedAt, expires: ISO | null, trial: boolean }
 *
 * The payload names a **tier and its add-ons, never a list of features**, so
 * whatever a later version adds to Pro opens for everyone holding Pro
 * (decided 2026-10-02).
 *
 * No email in it. The token is shown, copied and saved to a file by the
 * person it belongs to, and `license.dat` is read by every process the app
 * has -- so it carries a salted hash of the address, enough to tie it to an
 * order, and the address itself is kept apart, encrypted (`store.js`).
 *
 * ## Which keys are believed
 *
 * Phase 6 has one: the mock issuer's (`mock-issuer.js`), believed on every
 * channel, because until real payment exists "Pay" succeeds everywhere
 * (decided 2026-10-02). Phase 7 adds the production key and stops believing
 * this one on `stable` -- the Plans & licence screen says so in advance.
 *
 * ## What a licence is worth here (§7.6)
 *
 * - **Annual**, past `expires`: this build keeps it if it was released on or
 *   before that day -- Pro stays for good on the versions released while it
 *   was paid for. A checkout has no release date and counts as newer than any.
 * - **Lifetime** (`expires: null`): every version, later ones included
 *   (decided 2026-10-02: no major-version ceiling).
 * - **Business** and **trials**: no fallback. Past `expires` is expired.
 */

const crypto = require('node:crypto');

const VERSION = 1;

const KEYS = Object.freeze({
  'mock-2026-10': Object.freeze({
    channels: Object.freeze(['dev', 'beta', 'stable']),
    mock: true,
    pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAaXw/lOmR3SRuXsc984cmFTLffdXJZd5I7ynzg6jrl/k=\n-----END PUBLIC KEY-----\n',
  }),
});

const TIERS = ['pro', 'business'];
const ADDONS = ['dev'];
const MAX_TOKEN = 4096;

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** The salted hash a token carries instead of an address. */
function emailHash(email) {
  return crypto.createHash('sha256').update(`cleandrive.licence-email/1:${String(email).trim().toLowerCase()}`).digest('hex');
}

/** payload + signature, given the signer's private key. For the issuer. */
function encode(payload, privateKey) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return `${b64(bytes)}.${b64(crypto.sign(null, bytes, privateKey))}`;
}

const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** Whether a parsed payload has the shape this build understands. */
function wellFormed(p) {
  return Boolean(
    p && p.v === VERSION && typeof p.kid === 'string' && typeof p.id === 'string' && /^[a-z0-9_-]{4,64}$/i.test(p.id) &&
      TIERS.includes(p.tier) && Array.isArray(p.addons) && p.addons.every((a) => ADDONS.includes(a)) &&
      Number.isInteger(p.seats) && p.seats >= 1 && p.seats <= 1000 &&
      typeof p.plan === 'string' && isIso(p.issuedAt) && (p.expires === null || isIso(p.expires)) &&
      typeof p.trial === 'boolean' && (!p.trial || p.expires !== null)
  );
}

/**
 * The payload of a token whose signature holds, or why not.
 *
 * @param {string} token
 * @param {object} options
 * @param {string} options.channel   which keys this build believes
 * @param {object} [options.keys]    for the harness
 * @returns {{ ok: true, payload: object } | { ok: false, reason: string }}
 */
function verifyToken(token, { channel, keys = KEYS }) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN) return { ok: false, reason: 'malformed' };
  const parts = token.trim().split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return { ok: false, reason: 'malformed' };
  }
  const bytes = Buffer.from(parts[0], 'base64url');
  let payload;
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const key = payload && typeof payload.kid === 'string' && Object.prototype.hasOwnProperty.call(keys, payload.kid) ? keys[payload.kid] : null;
  if (!key || !key.channels.includes(channel)) return { ok: false, reason: 'unknownKey' };
  let good = false;
  try {
    good = crypto.verify(null, bytes, crypto.createPublicKey(key.pem), Buffer.from(parts[1], 'base64url'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'badSignature' };
  if (!wellFormed(payload)) return { ok: false, reason: 'malformed' };
  return { ok: true, payload: { ...payload, mock: key.mock === true } };
}

/**
 * The licence a payload amounts to in this build, at this moment.
 *
 * @param {object} p           a verified payload
 * @param {object} build
 * @param {number} build.now
 * @param {string|null} build.releaseDate   null: a checkout, newer than any expiry
 */
function effective(p, { now, releaseDate }) {
  const base = {
    tier: p.tier,
    addons: [...p.addons],
    id: p.id,
    plan: p.plan,
    seats: p.seats,
    orderId: typeof p.orderId === 'string' ? p.orderId : null,
    issuedAt: p.issuedAt,
    expires: p.expires,
    trial: p.trial,
    mock: p.mock === true,
    fallback: false,
  };
  if (p.expires === null || now <= Date.parse(p.expires)) return { ...base, state: p.trial ? 'trial' : 'active' };
  if (p.trial || p.tier === 'business') return { ...base, state: 'expired' };
  const released = releaseDate && isIso(releaseDate) ? Date.parse(releaseDate) : now;
  if (released <= Date.parse(p.expires)) return { ...base, state: 'active', fallback: true };
  return { ...base, state: 'expired' };
}

module.exports = { VERSION, KEYS, emailHash, encode, verifyToken, effective, wellFormed };
