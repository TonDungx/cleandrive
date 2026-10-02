'use strict';

/**
 * The licence this process is running under, and the only code that changes it.
 *
 * ## Free until a licence says otherwise
 *
 * From 0.6.0 an installed copy is Free unless `license.dat` holds a licence
 * whose signature this build believes (`token.js`). Pro and the developer
 * add-on had been open to everyone since 2026-09-24, while there was nothing
 * to buy; they are closed again now there is a Plans & licence screen
 * (decided 2026-10-02), and that screen says so to whoever used them.
 *
 * ## Asked often, read cheaply
 *
 * `can()` is asked on almost every IPC call. The file is re-read only when
 * its size or time changes, and its signature checked only then (124 µs,
 * measured for H4) -- so another process activating a licence is seen at the
 * next question, and an unchanged file costs one `stat`.
 *
 * ## A licence can change under a running app
 *
 * Activating, deactivating and a trial or year running out all happen while
 * the window is open, and what they open must open at once (§7.2.4).
 * `onChange` is how: `services.js` asks again for the seal and the policy's
 * acting half, and the window reloads its entitlements. A timer fires at the
 * next expiry, so an ending trial is not noticed only at the next launch.
 *
 * ## A checkout
 *
 * Opens every feature by default, so a developer sees the whole app, and can
 * narrow it to one tier or ask for the stored licence (`dev-overrides.js`).
 * That module is in no release build, and is only ever loaded here, on the
 * `dev` channel.
 */

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { BUILD_INFO } = require('../build-info');
const entitlements = require('./entitlements');
const store = require('./store');
const token = require('./token');

let fileForHarness = null;
let cached = null;

/** Where this account's licence lives: beside the settings, in userData. */
function licenceFile() {
  if (fileForHarness) return fileForHarness;
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return path.join(app.getPath('userData'), 'license.dat');
  } catch {
    // plain Node: no app, so no stored licence
  }
  return null;
}

/** For the harness: a licence file of its own, and nothing cached from before. */
function setFileForHarness(file) {
  fileForHarness = file || null;
  cached = null;
}

function readStored(file) {
  if (!file) return store.EMPTY;
  let key;
  try {
    const stat = fs.statSync(file);
    key = `${file}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    key = `${file}|none`;
  }
  if (cached && cached.key === key) return cached.data;
  const data = store.readSync(file);
  cached = { key, data };
  return data;
}

/** On the dev channel, the developer's choice; null for "the stored licence". */
function devForced(env) {
  let overrides = null;
  try {
    // eslint-disable-next-line global-require
    overrides = require('./dev-overrides');
  } catch {
    return null;
  }
  return overrides.fromEnv(env);
}

/**
 * @param {object} [options]  injectable, for the harness
 * @param {string} [options.channel]
 * @param {object} [options.env]
 * @param {number} [options.now]
 * @param {string|null} [options.releaseDate]
 * @param {string|null} [options.file]
 */
function currentLicense(options = {}) {
  if ((options.channel || BUILD_INFO.channel) === 'dev') {
    const forced = devForced(options.env || process.env);
    if (forced) return forced;
  }
  return storedLicence(options);
}

/**
 * The licence `license.dat` holds, as this build values it -- whatever a
 * developer's override says. What the Plans & licence screen describes, and
 * what activation, the email and the expiry timer are about.
 */
function storedLicence({
  channel = BUILD_INFO.channel,
  now = Date.now(),
  releaseDate = BUILD_INFO.releaseDate,
  file = licenceFile(),
} = {}) {
  const data = readStored(file);
  const trialUsed = Boolean(data.trial);
  if (!data.token) return Object.freeze({ ...entitlements.FREE, source: 'none', trialUsed });
  const verified = token.verifyToken(data.token, { channel });
  if (!verified.ok) return Object.freeze({ ...entitlements.FREE, source: 'invalid', reason: verified.reason, trialUsed });
  return Object.freeze({ ...token.effective(verified.payload, { now, releaseDate }), source: 'stored', trialUsed });
}

/** A `can` bound to the current licence, for the registry and the pipeline. */
function canNow(options) {
  const lic = currentLicense(options);
  return (feature) => entitlements.can(lic, feature);
}

/* ------------------------------------------------------------------ change */

const changes = new EventEmitter();
changes.setMaxListeners(20);
let expiryTimer = null;

/** The longest delay setTimeout takes; a later expiry is approached in steps. */
const MAX_DELAY = 2 ** 31 - 1;

function armExpiry() {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (changes.listenerCount('change') === 0) return;
  const lic = storedLicence();
  if (!lic.expires || lic.state === 'expired' || lic.fallback) return;
  const due = Date.parse(lic.expires) - Date.now() + 1000;
  if (!(due > 0)) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (Date.parse(lic.expires) <= Date.now()) changed();
    else armExpiry();
  }, Math.min(due, MAX_DELAY));
  if (typeof expiryTimer.unref === 'function') expiryTimer.unref();
}

function changed() {
  cached = null;
  // The stored licence, which is what changed; listeners ask `canNow()` for
  // what applies, so a checkout's override still wins there.
  changes.emit('change', storedLicence());
  armExpiry();
}

/** Called with the new licence whenever it changes. Returns the unsubscribe. */
function onChange(listener) {
  changes.on('change', listener);
  armExpiry();
  return () => {
    changes.off('change', listener);
    armExpiry();
  };
}

/* -------------------------------------------------------------- activation */

/**
 * Make `text` this account's licence.
 *
 * Refused, with nothing written, when the signature does not hold, the key is
 * not one this build believes, or it is a trial and this copy has had one.
 * An expired licence is accepted: it is still the person's, and it may keep
 * Pro on this version (§7.6).
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.email]  the address it was bought with, kept encrypted
 * @param {object} [options.dpapi]  for the harness
 * @param {string} [options.channel]
 * @returns {Promise<{ ok: boolean, reason?: string, licence?: object }>}
 */
async function activate(text, { email = null, dpapi = null, channel = BUILD_INFO.channel } = {}) {
  const file = licenceFile();
  if (!file) return { ok: false, reason: 'noStore' };
  const clean = String(text || '').trim();
  const verified = token.verifyToken(clean, { channel });
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const before = store.readSync(file);
  const p = verified.payload;
  if (p.trial && before.trial && before.trial !== clean) return { ok: false, reason: 'trialUsed' };

  let sealed = before.email && before.email.for === p.id ? before.email : null;
  if (email) {
    try {
      // eslint-disable-next-line global-require
      sealed = await store.sealEmail(email, p.id, dpapi || require('../lib/dpapi'));
    } catch {
      // DPAPI refused, or PowerShell would not start: the licence is kept
      // without the address rather than not at all.
      sealed = null;
    }
  }
  await store.write(file, { token: clean, trial: p.trial ? clean : before.trial, email: sealed });
  changed();
  return { ok: true, licence: storedLicence({ channel }) };
}

/** No licence on this computer any more. The trial mark stays. */
async function deactivate() {
  const file = licenceFile();
  if (!file) return { ok: false, reason: 'noStore' };
  const before = store.readSync(file);
  await store.write(file, { token: null, trial: before.trial, email: null });
  changed();
  return { ok: true, licence: storedLicence() };
}

/** The current licence's email, opened for the screen that shows it; null when there is none. */
async function emailOfCurrent({ dpapi = null } = {}) {
  const file = licenceFile();
  const lic = storedLicence();
  if (!file || !lic.id) return null;
  // eslint-disable-next-line global-require
  return store.openEmail(store.readSync(file).email, lic.id, dpapi || require('../lib/dpapi'));
}

/** The token text, for the screen's copy and save buttons. */
function currentToken() {
  const file = licenceFile();
  const lic = storedLicence();
  return file && lic.id ? store.readSync(file).token : null;
}

module.exports = {
  currentLicense,
  storedLicence,
  canNow,
  onChange,
  activate,
  deactivate,
  emailOfCurrent,
  currentToken,
  licenceFile,
  setFileForHarness,
};
