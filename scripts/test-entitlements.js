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
{
  // Decided 2026-09-24: until licences exist (Phase 6) a release build has Pro
  // open to everyone. The `dev` add-on joined it on 2026-09-26 when the
  // Developer Pack was built, for the same reason -- there is still no way to
  // buy either. Business stays closed, and the keys stay separate so Phase 6
  // can still take each back on its own.
  const stable = currentLicense({ channel: 'stable', env: { CLEANDRIVE_ENTITLEMENTS: 'all' } });
  const beta = currentLicense({ channel: 'beta', env: { CLEANDRIVE_ENTITLEMENTS: 'free' } });
  check('a release build has Pro open, whatever the override says',
    stable.state === 'active' && stable.tier === 'pro' && stable.source === 'open' &&
      beta.tier === 'pro' && beta.state === 'active', `${stable.state} ${stable.tier}`);
  check('and the dev add-on with it, as its own key rather than folded into Pro',
    stable.addons.length === 1 && stable.addons[0] === 'dev' && FEATURES['pro.dev'].addon === 'dev',
    JSON.stringify(stable.addons));
  const onStable = canNow({ channel: 'stable', env: { CLEANDRIVE_ENTITLEMENTS: 'all' } });
  check('so the snapshot comparison runs there', onStable('pro.diff') && onStable('pro.quarantine'));
  check('and so does the Developer Pack', onStable('pro.dev'));
  check('but Business does not unlock in a release by setting a variable',
    !onStable('biz.cli') && !onStable('biz.audit') && !onStable('biz.console') && !onStable('biz.policy'));
  // The add-on is only open because this build says so, not because the
  // entitlement rules stopped distinguishing it.
  check('and a Pro licence without the add-on still does not include it',
    !can({ state: 'active', tier: 'pro', addons: [] }, 'pro.dev'));
}
// The games library (D2) is the first analyzer behind a feature key. Every
// other one is free, and that one still runs today because a release build has
// Pro open until Phase 6 -- which is what this checks, rather than that no
// analyzer is ever gated.
{
  const paid = registry.list().filter((a) => a.feature !== 'free');
  check('the analyzers behind a feature key are the games library and the Developer Pack',
    paid.length === 3 && paid.some((a) => a.id === 'games' && a.feature === 'pro.games') &&
      paid.some((a) => a.id === 'dev' && a.feature === 'pro.dev') &&
      // The Developer screen has two of them: its own tools, and the projects
      // on whatever folders were chosen. One key covers both (C1, C5).
      paid.some((a) => a.id === 'devProjects' && a.feature === 'pro.dev'),
    paid.map((a) => `${a.id}:${a.feature}`).join(', ') || 'none');
  check('every analyzer names a feature that exists',
    registry.list().every((a) => a.feature === 'free' || FEATURES[a.feature]),
    registry.list().map((a) => a.feature).join(', '));
  const open = canNow({ channel: 'stable', env: {} });
  check('and on a release build today it still runs for everyone',
    registry.list().every((a) => open(a.feature)));
}

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
    'src/main/actions/restore.js',
    'src/main/actions/execute.js',
  ];
  const offenders = mustNotGate.filter((rel) => /license\/(entitlements|state)/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  check('the journal, the ledger, the purge and the Recycle Bin never consult a licence', offenders.length === 0,
    offenders.join(', '));

  const ipc = fs.readFileSync(path.join(ROOT, 'src/main/ipc.js'), 'utf8');
  const confirm = ipc.slice(ipc.indexOf('async function confirmAction'), ipc.indexOf('let unconfirmedAllowed'));
  check('nor does the confirmation dialog', confirm.length > 0 && !/can\(|canNow|entitlements/.test(confirm));

  // The Restore Center's handlers, from the first to the last: none of them is
  // handed a licence check, so an expired one cannot stop a file coming back.
  const restoreBlock = ipc.slice(ipc.indexOf("handle('journal:sessions'"), ipc.indexOf('/* ---- automatic cleanup'));
  check('nor do the Restore Center\'s handlers', restoreBlock.includes("handle('journal:restore'") &&
    !/\bcan\s*:|canNow|entitlements|licenseState/.test(restoreBlock));
  check('and the restore action asks for no paid feature', require('../src/main/actions/restore').feature === 'free');
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
