#!/usr/bin/env node
'use strict';

// Entitlements: what each tier includes, and what no tier can take away.
//   node scripts/test-entitlements.js

const fs = require('node:fs');
const path = require('node:path');

const { FEATURES, can, canRead, forRenderer } = require('../src/main/license/entitlements');
const { currentLicense, canNow } = require('../src/main/license/state');
const { BUILD_INFO } = require('../src/main/build-info');
const registry = require('../src/main/analyzers');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const L = (state, tier, addons = []) => ({ state, tier, addons });

console.log('\nentitlements: the matrix\n');

// Roadmap section 6, as a table the code is held to.
const EXPECT = {
  free: { free: true, pro: true, 'pro+dev': true, business: true },
  pro: { free: false, pro: true, 'pro+dev': true, business: true },
  'pro.dev': { free: false, pro: false, 'pro+dev': true, business: true },
  biz: { free: false, pro: false, 'pro+dev': false, business: true },
};
const LICENCES = {
  free: { state: 'free' },
  pro: L('active', 'pro'),
  'pro+dev': L('active', 'pro', ['dev']),
  business: L('active', 'business'),
};
const shapeOf = (feature) => {
  if (feature === 'free') return 'free';
  if (feature === 'pro.dev') return 'pro.dev';
  if (feature.startsWith('biz.')) return 'biz';
  return 'pro';
};

let cells = 0;
let wrong = [];
for (const feature of Object.keys(FEATURES)) {
  for (const [name, lic] of Object.entries(LICENCES)) {
    cells += 1;
    if (can(lic, feature) !== EXPECT[shapeOf(feature)][name]) wrong.push(`${feature}@${name}`);
  }
}
check(`every feature × tier matches the table (${cells} cells)`, wrong.length === 0, wrong.join(', '));

check('a trial opens what its tier opens', can(L('trial', 'pro'), 'pro.diff') && !can(L('trial', 'pro'), 'biz.cli'));
check('business includes the developer add-on', can(L('active', 'business'), 'pro.dev'));
check('the add-on alone does not make somebody Pro', !can({ state: 'active', tier: undefined, addons: ['dev'] }, 'pro.diff'));

console.log('\nentitlements: running out\n');

const expired = L('expired', 'pro');
check('an expired licence acts on nothing paid', !can(expired, 'pro.quarantine') && !can(expired, 'pro.diff'));
check('but can still read what it made', canRead(expired, 'pro.quarantine') && canRead(expired, 'pro.diff'));
check('and free features never lapse', can(expired, 'free'));
check('a free licence reads nothing paid either', !canRead({ state: 'free' }, 'pro.diff'));

console.log('\nentitlements: mistakes fail loudly\n');

{
  let threw = null;
  try {
    can({ state: 'active', tier: 'pro' }, 'pro.difff');
  } catch (err) {
    threw = err;
  }
  check('a mistyped feature key throws rather than quietly answering no', threw && /unknown feature/.test(threw.message));
  check('every analyzer names a feature that exists',
    registry.list().every((a) => a.feature === 'free' || FEATURES[a.feature]),
    registry.list().map((a) => `${a.id}:${a.feature}`).join(', '));
}

console.log('\nentitlements: where the licence comes from\n');

check('a checkout is the dev channel', BUILD_INFO.channel === 'dev', BUILD_INFO.channel);
check('a checkout opens everything by default', currentLicense({ channel: 'dev', env: {} }).tier === 'business');
check('and the override narrows it for testing a tier',
  currentLicense({ channel: 'dev', env: { CLEANDRIVE_ENTITLEMENTS: 'free' } }).state === 'free' &&
    currentLicense({ channel: 'dev', env: { CLEANDRIVE_ENTITLEMENTS: 'pro' } }).tier === 'pro');
check('a release build ignores the override completely',
  currentLicense({ channel: 'stable', env: { CLEANDRIVE_ENTITLEMENTS: 'all' } }).state === 'free' &&
    currentLicense({ channel: 'beta', env: { CLEANDRIVE_ENTITLEMENTS: 'business' } }).state === 'free');
check('so nothing paid unlocks in a release by setting a variable',
  !canNow({ channel: 'stable', env: { CLEANDRIVE_ENTITLEMENTS: 'all' } })('pro.diff'));
check('and nothing the app does today is paid', registry.list().every((a) => a.feature === 'free'));

console.log('\nentitlements: what the window learns\n');

{
  const rows = forRenderer(L('active', 'pro'));
  const keys = new Set(rows.flatMap((r) => Object.keys(r)));
  check('a yes or no per feature, and a reason when it is no',
    rows.length === Object.keys(FEATURES).length - 1 && [...keys].every((k) => ['feature', 'allowed', 'reason'].includes(k)),
    [...keys].join(', '));
  check('never the licence itself', !JSON.stringify(forRenderer({ state: 'active', tier: 'pro', email: 'a@b.c', key: 'SECRET' }))
    .match(/a@b\.c|SECRET/));
  const reasons = Object.fromEntries(forRenderer({ state: 'free' }).map((r) => [r.feature, r.reason]));
  check('the reason says what would open it',
    reasons['pro.diff'] === 'needsPro' && reasons['pro.dev'] === 'needsAddon' && reasons['biz.cli'] === 'needsBusiness');
  check('and says so differently when it has lapsed', forRenderer(expired).find((r) => r.feature === 'pro.diff').reason === 'expired');
}

console.log('\nentitlements: what never goes through can()\n');

{
  // The confirmation, the warnings in it, the journal and everything that reads
  // the journal must work whatever the licence says -- so they must not even
  // load the module that could say no.
  const ROOT = path.join(__dirname, '..');
  const mustNotGate = [
    'src/main/journal/journal.js',
    'src/main/lib/ledger.js',
    'src/main/lib/recyclebin.js',
    'src/main/lib/trash.js',
    'src/main/actions/recycle.js',
  ];
  const offenders = mustNotGate.filter((rel) => /license\/(entitlements|state)/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  check('the journal, the ledger, the purge and the Recycle Bin never consult a licence', offenders.length === 0,
    offenders.join(', '));

  const ipc = fs.readFileSync(path.join(ROOT, 'src/main/ipc.js'), 'utf8');
  const confirm = ipc.slice(ipc.indexOf('async function confirmAction'), ipc.indexOf('let unconfirmedAllowed'));
  check('nor does the confirmation dialog', confirm.length > 0 && !/can\(|canNow|entitlements/.test(confirm));
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
