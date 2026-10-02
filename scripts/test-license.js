#!/usr/bin/env node
'use strict';

// The licence itself: its signature, what it is worth to a build, and the
// file it is kept in (ROADMAP §7.5, §7.6, §7.9 "license-verify").
//   node scripts/test-license.js
//
// Tokens are signed here with the mock issuer's own key, so every check is
// against the key a real build believes. DPAPI is faked except in the last
// section, which makes two real calls to show the email cannot be opened as
// the journal's key.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const token = require('../src/main/license/token');
const store = require('../src/main/license/store');
const licence = require('../src/main/license/state');
const { can } = require('../src/main/license/entitlements');
const dpapi = require('../src/main/lib/dpapi');
const { removeAfterExit } = require('./lib/sandbox');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const KEY = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'license', 'mock-key.pem'), 'utf8'));
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 2, 9, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

function payload(over = {}) {
  return {
    v: 1, kid: 'mock-2026-10', id: 'lic_test0001', plan: 'pro-annual', tier: 'pro', addons: [], seats: 3,
    emailHash: token.emailHash('a@example.com'), orderId: 'mock_test', issuedAt: iso(NOW), expires: iso(NOW + 365 * DAY), trial: false,
    ...over,
  };
}
const sign = (over) => token.encode(payload(over), KEY);

/** A DPAPI that is not: reversible, records the entropy, never spawns PowerShell. */
function fakeDpapi() {
  const calls = [];
  const flip = (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a));
  return {
    LICENCE_EMAIL_ENTROPY: dpapi.LICENCE_EMAIL_ENTROPY,
    calls,
    protect: async (data, options) => { calls.push(['protect', options && options.entropy]); return flip(data); },
    unprotect: async (blob, options) => { calls.push(['unprotect', options && options.entropy]); return flip(blob); },
  };
}

(async () => {
  console.log('\nlicence: the signature\n');

  {
    const good = sign();
    for (const channel of ['dev', 'beta', 'stable']) {
      const v = token.verifyToken(good, { channel });
      check(`a mock-issued token holds on ${channel} (Phase 6: "Pay" succeeds everywhere)`, v.ok && v.payload.tier === 'pro' && v.payload.mock === true);
    }
    const [p, s] = good.split('.');
    const altered = Buffer.from(p, 'base64url').toString('utf8').replace('"tier":"pro"', '"tier":"business"');
    check('a payload altered by one word fails its signature',
      token.verifyToken(`${Buffer.from(altered).toString('base64url')}.${s}`, { channel: 'stable' }).reason === 'badSignature');
    const sig = Buffer.from(s, 'base64url');
    sig[0] ^= 1;
    check('a signature altered by one bit fails', token.verifyToken(`${p}.${sig.toString('base64url')}`, { channel: 'stable' }).reason === 'badSignature');
    check('a token cut short fails', !token.verifyToken(good.slice(0, good.length - 10), { channel: 'stable' }).ok);
    check('half a token is malformed', token.verifyToken(p, { channel: 'stable' }).reason === 'malformed');
    check('garbage is malformed', token.verifyToken('not a licence', { channel: 'stable' }).reason === 'malformed');
    check('nothing at all is malformed', token.verifyToken('', { channel: 'stable' }).reason === 'malformed' &&
      token.verifyToken(null, { channel: 'stable' }).reason === 'malformed');
    check('a megabyte of base64 is refused before it is decoded', token.verifyToken(`${'A'.repeat(1e6)}.A`, { channel: 'stable' }).reason === 'malformed');
    check('surrounding whitespace from a paste is forgiven', token.verifyToken(`  ${good}\r\n`, { channel: 'stable' }).ok);

    const stranger = crypto.generateKeyPairSync('ed25519').privateKey;
    check('a key id nobody knows is refused', token.verifyToken(token.encode(payload({ kid: 'prod-1999' }), stranger), { channel: 'stable' }).reason === 'unknownKey');
    check('the mock key id signed by another key fails its signature',
      token.verifyToken(token.encode(payload(), stranger), { channel: 'stable' }).reason === 'badSignature');
    check('a key id borrowed from Object.prototype is not a key', token.verifyToken(token.encode(payload({ kid: '__proto__' }), KEY), { channel: 'stable' }).reason === 'unknownKey' &&
      token.verifyToken(token.encode(payload({ kid: 'constructor' }), KEY), { channel: 'stable' }).reason === 'unknownKey');
    const devOnly = { 'mock-2026-10': { ...token.KEYS['mock-2026-10'], channels: ['dev'] } };
    check('a key a channel does not believe is refused there (Phase 7 for stable)',
      token.verifyToken(good, { channel: 'stable', keys: devOnly }).reason === 'unknownKey' && token.verifyToken(good, { channel: 'dev', keys: devOnly }).ok);

    const shapes = [
      ['an unknown tier', { tier: 'enterprise' }],
      ['an unknown add-on', { addons: ['ai'] }],
      ['no seats', { seats: 0 }],
      ['a trial that never ends', { trial: true, expires: null }],
      ['an expiry that is not a date', { expires: 'soon' }],
      ['another format version', { v: 2 }],
      ['an id with a path in it', { id: '..\\x' }],
    ];
    for (const [label, over] of shapes) {
      check(`signed, but ${label}: malformed`, token.verifyToken(sign(over), { channel: 'stable' }).reason === 'malformed');
    }
    check('the token names a tier, never a list of features', !/"features"/.test(Buffer.from(good.split('.')[0], 'base64url').toString('utf8')));
    check('and carries no email address, only its hash', !good.includes('example') &&
      !Buffer.from(good.split('.')[0], 'base64url').toString('utf8').includes('@'));
    check('the hash ignores case and spaces', token.emailHash(' A@Example.com ') === token.emailHash('a@example.com'));
  }

  console.log('\nlicence: what it is worth to this build (§7.6)\n');

  {
    const v = (over) => token.verifyToken(sign(over), { channel: 'stable' }).payload;
    const at = (p, now, releaseDate) => token.effective(p, { now, releaseDate });
    const annual = v();
    check('an annual licence is active within its year', at(annual, NOW + DAY, iso(NOW)).state === 'active');
    check('a trial is "trial" while it runs', at(v({ trial: true, plan: 'pro-trial', expires: iso(NOW + 14 * DAY) }), NOW + DAY, iso(NOW)).state === 'trial');
    const after = NOW + 400 * DAY;
    const kept = at(annual, after, iso(NOW + 100 * DAY));
    check('past its year, a build released within it keeps Pro for good', kept.state === 'active' && kept.fallback === true);
    check('a build released after the year does not', at(annual, after, iso(NOW + 366 * DAY)).state === 'expired');
    check('released on the very day it ends: kept', at(annual, after, annual.expires).fallback === true);
    check('a checkout has no release date, and counts as newer than any', at(annual, after, null).state === 'expired');
    check('Business has no fallback', at(v({ tier: 'business', plan: 'business-annual' }), after, iso(NOW)).state === 'expired');
    check('nor does a trial', at(v({ trial: true, plan: 'pro-trial', expires: iso(NOW + 14 * DAY) }), after, iso(NOW)).state === 'expired');
    const life = at(v({ plan: 'pro-lifetime', expires: null }), Date.UTC(2100, 0, 1), iso(Date.UTC(2099, 0, 1)));
    check('lifetime covers every later version (decided 2026-10-02)', life.state === 'active' && life.fallback === false);
    check('the add-on travels with the licence', can(at(v({ addons: ['dev'] }), NOW, iso(NOW)), 'pro.dev') &&
      !can(at(annual, NOW, iso(NOW)), 'pro.dev'));
    check('an expired licence opens nothing', !can(at(annual, after, iso(NOW + 366 * DAY)), 'pro.diff'));
  }

  console.log('\nlicence: the file, and the licence a build runs under\n');

  const dir = removeAfterExit(fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-licence-')));
  const file = path.join(dir, 'license.dat');
  licence.setFileForHarness(file);
  check('isolated: the licence file is the harness\'s own', licence.licenceFile() === file && file.startsWith(os.tmpdir()));
  const stable = (env = {}) => licence.currentLicense({ channel: 'stable', env, now: NOW, releaseDate: iso(NOW) });

  {
    check('no file: Free, and it says why', stable().state === 'free' && stable().source === 'none');
    check('an installed copy is Free whatever the override says', stable({ CLEANDRIVE_ENTITLEMENTS: 'all' }).state === 'free');
    check('a checkout still opens everything by default', licence.currentLicense({ channel: 'dev', env: {} }).tier === 'business');
    check('and reads the stored licence when asked to, as a release would',
      licence.currentLicense({ channel: 'dev', env: { CLEANDRIVE_ENTITLEMENTS: 'stored' } }).state === 'free');

    fs.writeFileSync(file, 'not json');
    check('a file that is not JSON reads as no licence', stable().state === 'free');
    fs.writeFileSync(file, JSON.stringify({ format: 'something-else', version: 1, token: sign() }));
    check('nor does a file of another format', stable().state === 'free');
    fs.writeFileSync(file, JSON.stringify({ format: store.FORMAT, version: 1, token: 'forged.token' }));
    check('a forged token: Free, and the reason kept for the screen', stable().state === 'free' && stable().source === 'invalid');
    fs.rmSync(file);
  }

  {
    const heard = [];
    const off = licence.onChange((lic) => heard.push(lic.state));
    const fake = fakeDpapi();

    const refused = await licence.activate('nonsense', { channel: 'stable', dpapi: fake });
    check('a bad key is refused with nothing written', !refused.ok && refused.reason === 'malformed' && !fs.existsSync(file));

    const trialToken = sign({ id: 'lic_trial001', plan: 'pro-trial', trial: true, expires: iso(Date.now() + 14 * DAY) });
    const trial = await licence.activate(trialToken, { channel: 'stable', dpapi: fake });
    check('a trial activates', trial.ok && trial.licence.state === 'trial', JSON.stringify(trial.licence && trial.licence.state));
    check('and the window would have been told', heard.at(-1) === 'trial', heard.join(','));
    const second = await licence.activate(sign({ id: 'lic_trial002', plan: 'pro-trial', trial: true, expires: iso(Date.now() + 14 * DAY) }),
      { channel: 'stable', dpapi: fake });
    check('a second trial on the same copy is refused', !second.ok && second.reason === 'trialUsed');

    const bought = sign({ id: 'lic_bought01', addons: ['dev'], expires: iso(Date.now() + 365 * DAY) });
    const ok = await licence.activate(bought, { channel: 'stable', email: 'person@example.vn', dpapi: fake });
    check('a purchase replaces the trial', ok.ok && ok.licence.state === 'active' && ok.licence.id === 'lic_bought01');
    const onDisk = fs.readFileSync(file, 'utf8');
    check('license.dat holds no email address in the clear', !onDisk.includes('person@example.vn') && !onDisk.includes('example.vn'));
    check('the address was sealed with the licence\'s own entropy', fake.calls.some(([op, e]) => op === 'protect' && e === dpapi.LICENCE_EMAIL_ENTROPY) &&
      dpapi.LICENCE_EMAIL_ENTROPY !== dpapi.ENTROPY);
    check('and opens again for the screen that shows it', (await licence.emailOfCurrent({ dpapi: fake })) === 'person@example.vn');
    check('the trial mark stays after a purchase', JSON.parse(onDisk).trial === trialToken && licence.currentLicense({ channel: 'stable' }).trialUsed === true);
    check('the token is there for the copy button', licence.currentToken() === bought);

    // Another process (or a person) replacing the file is seen at the next question.
    const other = sign({ id: 'lic_other001', tier: 'business', plan: 'business-annual', expires: iso(Date.now() + 365 * DAY) });
    const data = JSON.parse(onDisk);
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(file, JSON.stringify({ ...data, token: other }));
    check('a file changed by another process is read again', licence.currentLicense({ channel: 'stable' }).tier === 'business');
    check('and the address kept for the old licence is not shown for the new one', (await licence.emailOfCurrent({ dpapi: fake })) === null);

    const gone = await licence.deactivate();
    check('deactivating leaves Free', gone.ok && gone.licence.state === 'free' && heard.at(-1) === 'free');
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('and keeps only the trial mark', after.token === null && after.email === null && after.trial === trialToken);
    off();

    // An ending trial is noticed while the app runs, not at the next launch.
    fs.rmSync(file);
    const short = sign({ id: 'lic_short001', plan: 'pro-trial', trial: true, expires: iso(Date.now() + 300) });
    await licence.activate(short, { channel: 'stable', dpapi: fake });
    const ended = await new Promise((resolve) => {
      const stop = licence.onChange((lic) => { stop(); resolve(lic); });
      setTimeout(() => { stop(); resolve(null); }, 5000);
    });
    check('a trial ending under a running app is announced', ended && ended.state === 'expired', ended ? ended.state : 'nothing within 5 s');
  }

  console.log('\nlicence: the email, through real DPAPI\n');

  {
    const t0 = Date.now();
    const blob = await dpapi.protect(Buffer.from('person@example.vn'), { entropy: dpapi.LICENCE_EMAIL_ENTROPY });
    const back = await dpapi.unprotect(blob, { entropy: dpapi.LICENCE_EMAIL_ENTROPY });
    check('sealed and opened for this account', back.toString('utf8') === 'person@example.vn', `${Date.now() - t0} ms for two calls`);
    let refused = null;
    try {
      await dpapi.unprotect(blob);
    } catch (err) {
      refused = err;
    }
    check('it cannot be opened as the journal\'s key (other entropy)', refused && refused.refused === true);
  }

  licence.setFileForHarness(null);
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
