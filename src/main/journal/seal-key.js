'use strict';

/**
 * The key that seals the journal (H4), kept in `seal-key.json` in userData.
 *
 *   {
 *     "v": 1, "alg": "ed25519", "scope": "CurrentUser",
 *     "current": "<fingerprint>",
 *     "keys": [{ "fingerprint": "…", "publicKey": "<spki, base64>",
 *                "createdAt": "…", "protected": "<DPAPI blob, base64>" }]
 *   }
 *
 * The private half is never written in the clear: only as a DPAPI blob that
 * this user's account can open. The public halves are in the clear, because
 * checking a seal must not need a secret -- and every one is kept, so a
 * session sealed under a key that has since been replaced still checks.
 *
 * ## What this key can and cannot stand for
 *
 * The process that writes the journal runs as the user, unattended, so any key
 * it can use without asking anybody, that user can use too. The seal therefore
 * catches a line changed by hand, a file damaged, a tool that touched it; it
 * does not catch the computer's own user rewriting the journal and signing it
 * again. That needs a copy kept somewhere the user cannot rewrite -- the share
 * of H3 -- and the README says so in those words.
 *
 * ## When the key cannot be opened
 *
 * A DPAPI blob stops opening when the account's protection keys are lost, for
 * one. [Unverified -- one account on the test machine] A local account whose
 * password an administrator resets is the usual way. Then a new key is made,
 * the old one stays listed for checking, and nothing earlier is re-signed.
 *
 * A key file that is not JSON is never overwritten: it is moved aside, because
 * what was in it may be the evidence, and a new one is made. Every seal from
 * before then then names a key this file does not know, and the check says so.
 */

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { renameRetrying } = require('../lib/atomic');

const VERSION = 1;

const fingerprintOf = (spkiDer) => crypto.createHash('sha256').update(spkiDer).digest('hex');

/** `3F2A 9C1B 77D0 E415` -- enough of the fingerprint for a person to compare. */
const shortFingerprint = (fp) =>
  typeof fp === 'string' && /^[0-9a-f]{64}$/.test(fp) ? fp.slice(0, 16).toUpperCase().match(/.{4}/g).join(' ') : null;

class SealKey {
  /**
   * @param {string} file
   * @param {object} [options]
   * @param {{protect: Function, unprotect: Function}} [options.dpapi]  injectable, for the harness
   * @param {() => number} [options.now]
   */
  constructor(file, { dpapi = null, now = Date.now } = {}) {
    this.file = path.resolve(file);
    this.dpapi = dpapi || require('../lib/dpapi');
    this.now = now;
    this._signing = null;
  }

  /** The file as it is, or null when there is none or it is not a key file. */
  async read() {
    let text;
    try {
      text = await fsp.readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.v === VERSION && Array.isArray(parsed.keys)) return parsed;
    } catch {
      // falls through
    }
    return { unreadable: true };
  }

  /**
   * Every public key the file lists, by fingerprint. Needs no secret, and
   * nothing here ever calls DPAPI.
   *
   * @returns {Promise<{keys: Map<string, crypto.KeyObject>, current: string|null}>}
   */
  async publicKeys() {
    const data = await this.read().catch(() => null);
    const keys = new Map();
    if (!data || data.unreadable) return { keys, current: null };
    for (const entry of data.keys) {
      try {
        const der = Buffer.from(String(entry.publicKey), 'base64');
        if (fingerprintOf(der) !== entry.fingerprint) continue;
        keys.set(entry.fingerprint, crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }));
      } catch {
        // a damaged entry checks nothing
      }
    }
    return { keys, current: keys.has(data.current) ? data.current : null };
  }

  /**
   * The key to sign with, made the first time it is asked for. Kept for the
   * life of the process: opening it is a PowerShell call.
   *
   * Called only with the journal's seal lock held, so two processes sealing
   * their first session at the same moment cannot each make a key.
   *
   * @returns {Promise<{fingerprint: string, privateKey: crypto.KeyObject}>}
   */
  async signing() {
    if (this._signing) return this._signing;
    const data = await this.read();
    if (data && !data.unreadable) {
      const entry = data.keys.find((k) => k.fingerprint === data.current);
      if (entry && typeof entry.protected === 'string') {
        try {
          const der = await this.dpapi.unprotect(Buffer.from(entry.protected, 'base64'));
          const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
          const spki = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
          if (fingerprintOf(spki) === entry.fingerprint) {
            this._signing = { fingerprint: entry.fingerprint, privateKey };
            return this._signing;
          }
        } catch (err) {
          // PowerShell that will not run is not a lost key, and making a new
          // one would fix nothing: that failure is the caller's to report.
          // Only a blob DPAPI itself refuses is a key to replace.
          if (!(err && err.refused)) throw err;
        }
      }
    }
    this._signing = await this._create(data);
    return this._signing;
  }

  async _create(previous) {
    if (previous && previous.unreadable) {
      await renameRetrying(this.file, `${this.file}.unreadable-${this.now()}`).catch(() => {});
      previous = null;
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    const fingerprint = fingerprintOf(spki);
    const blob = await this.dpapi.protect(privateKey.export({ format: 'der', type: 'pkcs8' }));
    const at = new Date(this.now()).toISOString();
    const keys = (previous ? previous.keys : []).map((k) =>
      k.fingerprint === previous.current && !k.retiredAt ? { ...k, retiredAt: at } : k
    );
    keys.push({ fingerprint, publicKey: spki.toString('base64'), createdAt: at, protected: blob.toString('base64') });
    const data = { v: VERSION, alg: 'ed25519', scope: this.dpapi.SCOPE || 'CurrentUser', current: fingerprint, keys };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await renameRetrying(tmp, this.file);
    return { fingerprint, privateKey };
  }
}

module.exports = { SealKey, fingerprintOf, shortFingerprint, VERSION };
