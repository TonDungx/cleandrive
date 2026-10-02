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
  // Pro and the dev add-on were open to everyone on a release build from
  // 2026-09-24 until Phase 6, while there was nothing to buy. Closed again
  // 2026-10-02: a release build is Free until license.dat says otherwise
  // (test-license.js covers the file), and no variable changes that.
  const stable = currentLicense({ channel: 'stable', env: { CLEANDRIVE_ENTITLEMENTS: 'all' }, file: null });
  const beta = currentLicense({ channel: 'beta', env: { CLEANDRIVE_ENTITLEMENTS: 'business' }, file: null });
  check('a release build with no licence is Free, whatever the override says',
    stable.state === 'free' && stable.source === 'none' && beta.state === 'free', `${stable.state} ${stable.source}`);
  const onStable = canNow({ channel: 'stable', env: { CLEANDRIVE_ENTITLEMENTS: 'all' }, file: null });
  check('so nothing paid runs there without one',
    !onStable('pro.diff') && !onStable('pro.quarantine') && !onStable('pro.dev') && !onStable('biz.cli') && onStable('free'));
  check('and the dev add-on is its own key, not folded into Pro (decided 2026-10-02: a separate add-on)',
    FEATURES['pro.dev'].addon === 'dev' && !can({ state: 'active', tier: 'pro', addons: [] }, 'pro.dev'));
}
// The games library (D2) was the first analyzer behind a feature key; the chat
// apps (D3) made `pro.chat` the second key in use -- it had been declared in
// `entitlements.js` and reached by nothing at all until that screen existed.
// Every other analyzer is free.
{
  const paid = registry.list().filter((a) => a.feature !== 'free');
  check('the analyzers behind a feature key are the games library, the chat apps and the Developer Pack',
    paid.length === 4 && paid.some((a) => a.id === 'games' && a.feature === 'pro.games') &&
      paid.some((a) => a.id === 'chat' && a.feature === 'pro.chat') &&
      paid.some((a) => a.id === 'dev' && a.feature === 'pro.dev') &&
      // The Developer screen has two of them: its own tools, and the projects
      // on whatever folders were chosen. One key covers both (C1, C5).
      paid.some((a) => a.id === 'devProjects' && a.feature === 'pro.dev'),
    paid.map((a) => `${a.id}:${a.feature}`).join(', ') || 'none');
  check('every analyzer names a feature that exists',
    registry.list().every((a) => a.feature === 'free' || FEATURES[a.feature]),
    registry.list().map((a) => a.feature).join(', '));
  const free = canNow({ channel: 'stable', env: {}, file: null });
  check('and on a release build with no licence only the free ones run',
    registry.list().every((a) => free(a.feature) === (a.feature === 'free')));
}

{
  // No dead keys: a feature key nothing asks for is a lock that does not exist
  // (`pro.photos` was one until Phase 6). Every key but 'free' must be named
  // somewhere under src/ besides the table itself.
  const SRC = path.join(__dirname, '..', 'src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|html)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const table = path.join(SRC, 'main', 'license', 'entitlements.js');
  const corpus = walk(SRC).filter((f) => f !== table).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const unasked = Object.keys(FEATURES).filter((k) => k !== 'free' && !corpus.includes(`'${k}'`));
  check('every feature key is asked for somewhere', unasked.length === 0, unasked.join(', ') || 'all asked');
  check('pro.photos is gone (E1-E5 were decided free)', !FEATURES['pro.photos']);
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
    // The seal (H4) is written by the journal and checked by the Restore
    // Center, so it is held to the journal's rule: it is told, never asks.
    'src/main/journal/seal.js',
    'src/main/journal/seal-key.js',
    'src/main/lib/dpapi.js',
    'src/main/lib/ledger.js',
    'src/main/lib/recyclebin.js',
    'src/main/lib/trash.js',
    'src/main/actions/recycle.js',
    'src/main/actions/restore.js',
    'src/main/actions/execute.js',
    // The command line's two doors to the same things (H1): `journal` and
    // `restore` are a terminal's Restore Center, held to its rule.
    'src/main/cli/commands/journal.js',
    'src/main/cli/commands/restore.js',
    // The organisation's policy (H2): told which half applies, never asking.
    // A view only that a lapsed licence could switch off would be a safety
    // rail that depends on paying.
    'src/main/policy/schema.js',
    'src/main/policy/read.js',
    'src/main/policy/interpret.js',
    'src/main/policy/effective.js',
    'src/main/policy/source.js',
    'src/main/policy/store.js',
    'src/main/policy/admx.js',
    'src/main/cli/commands/policy.js',
    // The machine report and the console (H3): whether a report is written is
    // the policy's acting half, decided in services.js; whether the console
    // opens is biz.console, decided in main.js. Both handed in.
    'src/main/fleet/report.js',
    'src/main/fleet/collect.js',
    'src/main/fleet/share.js',
    'src/main/fleet/console.js',
    'src/main/fleet/console-model.js',
    'src/main/fleet/console-state.js',
    'src/main/fleet/console-args.js',
    'src/main/fleet/console-main.js',
    'src/main/sample-only.js',
  ];
  const offenders = mustNotGate.filter((rel) => /license\//.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
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

  // H4 is a Business feature inside the one module no licence may touch. It
  // works because the decision is made where the journal is built and handed
  // in: `services.js` asks `biz.audit`, the journal is given a sealer or not.
  const servicesSrc = fs.readFileSync(path.join(ROOT, 'src/main/services.js'), 'utf8');
  // H2, the same split: which half of the policy applies is decided where
  // the policy source is built, from biz.policy, and handed in.
  check('whether the acting half of a policy applies is decided where the policy is read, from biz.policy',
    /acting: canNow\(\)\('biz\.policy'\)/.test(servicesSrc) && /new PolicySource\(/.test(servicesSrc));
  check('whether to seal is decided where the journal is built, from biz.audit',
    /canNow\(\)\('biz\.audit'\)/.test(servicesSrc) && /new ActionJournal\([^)]*sealer/.test(servicesSrc));
  check('and the check of the seals is one of the Restore Center’s handlers, ungated',
    restoreBlock.includes("handle('journal:verify'"));

  // H3: the console is biz.console, asked where the mode starts and handed in
  // -- since Phase 6 as the question, so a licence bought meanwhile counts.
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
  const consoleBranch = mainSrc.slice(mainSrc.indexOf('} else if (isConsole) {'), mainSrc.indexOf('} else if (isHelper) {'));
  check('whether the console opens is decided where its mode starts, from biz.console',
    consoleBranch.length > 0 && /allowed: \(\) => canNow\(\)\('biz\.console'\)/.test(consoleBranch));
  const fleetDir = path.join(ROOT, 'src/main/fleet');
  const listed = fs.readdirSync(fleetDir).filter((f) => f.endsWith('.js')).map((f) => `src/main/fleet/${f}`);
  check('and every module under fleet/ is on the list above', listed.every((rel) => mustNotGate.includes(rel)), listed.filter((rel) => !mustNotGate.includes(rel)).join(', '));

  // And on the command line, the table that decides: everything is behind
  // biz.cli except reading the journal, putting things back, describing the
  // program, and the organisation's policy (H2) -- whose tightening half
  // applies to every copy, and whose other half is decided in services.js.
  const { COMMANDS } = require('../src/main/cli/args');
  const free = Object.entries(COMMANDS).filter(([, spec]) => spec.feature === null).map(([name]) => name).sort();
  const gated = Object.entries(COMMANDS).filter(([, spec]) => spec.feature !== null);
  check('the command line never asks about journal, restore, policy, version or help',
    free.join(',') === 'help,journal,policy,restore,version', free.join(','));
  check('and every other command needs biz.cli', gated.length > 0 && gated.every(([, spec]) => spec.feature === 'biz.cli'),
    gated.map(([name, spec]) => `${name}:${spec.feature}`).join(' '));
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
