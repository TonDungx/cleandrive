'use strict';

/**
 * `license.dat`: the licence this account holds, in the app's data folder.
 *
 *   { "format": "cleandrive.licence", "version": 1,
 *     "token": "<signed token>" | null,
 *     "trial": "<the trial token this copy once had>" | null,
 *     "email": { "for": "<licence id>", "dpapi": "<base64>" } | null }
 *
 * ## What is secret, and what is not
 *
 * Every process reads this file -- the window, the 02:00 run, the daily
 * measurement, each command-line call, the console -- so reading it must cost
 * nothing: no PowerShell, no DPAPI. The token can be in the clear because it
 * holds nothing private (a salted hash of the address, see `token.js`) and
 * cannot be altered without its signature failing. The **email address** is
 * the one private thing, and it is encrypted with DPAPI for this Windows
 * account (`lib/dpapi.js`, its own entropy) and opened only when the Plans &
 * licence screen shows it -- about half a second of PowerShell, once per
 * window (measured for H4). The folder itself is readable by this account,
 * SYSTEM and Administrators only (measured 2026-10-02).
 *
 * ## The trial mark
 *
 * A trial token, once this copy has had one, is kept in `trial` after it has
 * ended or been replaced by a purchase. That is the whole of "this computer
 * has already had its trial" -- no registry mark (decided 2026-10-02): the
 * roadmap accepts that the check is easy to get round (§7.5), and a key
 * outside the data folder would be one more thing the app writes.
 *
 * Nothing here decides what a licence is worth; `state.js` does, from
 * `token.js`. A file that is not JSON, or not this format, reads as holding
 * nothing -- the person is then on Free and can enter their key again.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { renameRetrying } = require('../lib/atomic');

const FORMAT = 'cleandrive.licence';
const VERSION = 1;
const MAX_BYTES = 64 * 1024;

const EMPTY = Object.freeze({ format: FORMAT, version: VERSION, token: null, trial: null, email: null });

/** The file's contents, or EMPTY. Synchronous and cheap: every `can()` may come through here. */
function readSync(file) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) return { ...EMPTY, unreadable: stat.size > MAX_BYTES };
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { ...EMPTY, unreadable: Boolean(err && err.code !== 'ENOENT') };
  }
  try {
    const data = JSON.parse(text);
    if (!data || data.format !== FORMAT || data.version !== VERSION) return { ...EMPTY, unreadable: true };
    return {
      format: FORMAT,
      version: VERSION,
      token: typeof data.token === 'string' ? data.token : null,
      trial: typeof data.trial === 'string' ? data.trial : null,
      email: data.email && typeof data.email.for === 'string' && typeof data.email.dpapi === 'string'
        ? { for: data.email.for, dpapi: data.email.dpapi }
        : null,
    };
  } catch {
    return { ...EMPTY, unreadable: true };
  }
}

/** Whole, or not at all: a temp file beside it, then a rename. */
async function write(file, data) {
  const body = {
    format: FORMAT,
    version: VERSION,
    token: data.token || null,
    trial: data.trial || null,
    email: data.email || null,
  };
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  await renameRetrying(temp, file);
  return body;
}

/**
 * The email for licence `id`, encrypted for this account.
 *
 * @param {string} email
 * @param {string} id
 * @param {object} dpapi   lib/dpapi.js, or a fake in the harness
 */
async function sealEmail(email, id, dpapi) {
  const blob = await dpapi.protect(Buffer.from(email, 'utf8'), { entropy: dpapi.LICENCE_EMAIL_ENTROPY });
  return { for: id, dpapi: blob.toString('base64') };
}

/** The address back, or null when it was kept for another licence or cannot be opened. */
async function openEmail(sealed, id, dpapi) {
  if (!sealed || sealed.for !== id) return null;
  try {
    const out = await dpapi.unprotect(Buffer.from(sealed.dpapi, 'base64'), { entropy: dpapi.LICENCE_EMAIL_ENTROPY });
    return out.toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { FORMAT, VERSION, EMPTY, readSync, write, sealEmail, openEmail };
