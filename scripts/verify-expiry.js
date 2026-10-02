#!/usr/bin/env node
'use strict';

// A licence that runs out, on the real processes (ROADMAP §7.1, §7.9
// "automatic-expiry" and the expiry half of "e2e-commerce").
//
//   node scripts/verify-expiry.js
//
// Starts the real main.js the way Task Scheduler and a terminal do, against a
// throwaway user-data folder holding a license.dat this script signs with the
// mock issuer's key -- the stored licence read as a release reads it
// (CLEANDRIVE_ENTITLEMENTS=stored). The folders cleaned are a fixture of its
// own on D: (the scan refuses %TEMP%, which is inside AppData).
//
//   1. Pro, a year that ended ten days ago: the 02:00 run of the second
//      profile becomes a report, says the licence ran out, and moves
//      nothing; the first profile is unaffected.
//   2. No licence at all: the same profile's report says it is part of Pro,
//      not that something expired.
//   3. Business that ended: the command line is closed (exit 3) except what
//      is never asked -- the journal can be listed and checked.
//
// Nothing is deleted: every run here ends as a report, and the script checks
// that every fixture file is still there. No toast reaches the screen while
// CLEANDRIVE_TASK_SUFFIX is set.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { removeAfterExit } = require('./lib/sandbox');
const issuer = require('../src/main/license/mock-issuer');
const store = require('../src/main/license/store');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const REPO = path.join(__dirname, '..');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');
const DAY = 24 * 60 * 60 * 1000;
const FIXTURE = path.join('D:', path.sep, `cleandrive-verifyexpiry-${crypto.randomBytes(3).toString('hex')}`);

function removeFixture() {
  // A folder of this script's own, made below; refuse anything that is not.
  if (!/^D:\\cleandrive-verifyexpiry-[0-9a-f]{6}$/.test(FIXTURE)) return;
  try {
    const top = fs.lstatSync(FIXTURE);
    if (top.isSymbolicLink() || !top.isDirectory()) return;
    fs.rmSync(FIXTURE, { recursive: true, force: true });
  } catch {
    // not there
  }
}
process.on('exit', removeFixture);

function userData(name, licence) {
  const dir = removeAfterExit(fs.mkdtempSync(path.join(os.tmpdir(), `cleandrive-expiry-${name}-`)));
  const roots = [path.join(FIXTURE, 'Temp')];
  const profile = (id, over) => ({ id, enabled: true, dryRun: false, roots, categories: ['temp'], skipIfRunning: [], minDiskUsedPercent: 0, ...over });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    version: 12,
    trends: { dailySample: false, sampleTime: '12:00' },
    updates: { enabled: false },
    autoClean: { profiles: [profile('main', { dryRun: true }), profile('psecond1', {})] },
  }));
  if (licence) {
    const body = { format: store.FORMAT, version: store.VERSION, token: licence, trial: null, email: null };
    fs.writeFileSync(path.join(dir, 'license.dat'), `${JSON.stringify(body)}\n`);
  }
  return dir;
}

function electron(args, data) {
  const env = { ...process.env, CLEANDRIVE_TASK_SUFFIX: 'verifyexpiry', CLEANDRIVE_ENTITLEMENTS: 'stored' };
  delete env.ELECTRON_RUN_AS_NODE;
  // `--cli` has to come straight after the app's path, or main.js starts the
  // window instead -- which registers tasks of its own (found the hard way).
  const argv = args[0] === '--cli' ? [REPO, '--cli', `--user-data-dir=${data}`, ...args.slice(1)] : [REPO, `--user-data-dir=${data}`, ...args];
  return new Promise((resolve) => {
    const child = spawn(ELECTRON, argv, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (/\[tasks\]/.test(out + err)) check(`${args.join(' ')}: ran headless, not as the window`, false, 'it registered tasks');
      resolve({ code, out, err });
    });
  });
}

const lastRun = (data) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(data, 'autoclean-log.json'), 'utf8')).runs[0] || null;
  } catch {
    return null;
  }
};
const notes = (run) => (run && run.notes ? run.notes.map((n) => (n && n.i18n) || String(n)) : []);
const fixtureIntact = (files) => files.every((f) => fs.existsSync(f));

(async () => {
  // Old temporary files a cleanup would take, on D:.
  fs.mkdirSync(path.join(FIXTURE, 'Temp'), { recursive: true });
  const old = new Date(Date.now() - 400 * DAY);
  const files = [];
  for (let i = 0; i < 4; i += 1) {
    const f = path.join(FIXTURE, 'Temp', `old-${i}.tmp`);
    fs.writeFileSync(f, crypto.randomBytes(4096));
    fs.utimesSync(f, old, old);
    files.push(f);
  }

  console.log('\nexpiry: Pro, a year that ended ten days ago\n');
  const ended = issuer.issue({ plan: 'pro-annual', tier: 'pro', seats: 3, expires: new Date(Date.now() - 10 * DAY).toISOString() }).token;
  const proData = userData('pro', ended);
  const second = await electron(['--scheduled-run', '--profile=psecond1'], proData);
  const r2 = lastRun(proData);
  check('the scheduled run exits 0', second.code === 0, `exit ${second.code} ${second.err.slice(0, 200)}`);
  check('the second profile ran as a report', r2 && r2.profileId === 'psecond1' && r2.outcome === 'dry-run' && r2.dryRun === true,
    r2 ? `${r2.profileId} ${r2.outcome}` : 'no run logged');
  check('saying the licence ran out, not just "part of Pro" (§7.1)', notes(r2).includes('run.note.licenceExpired') && !notes(r2).includes('run.note.licenceProfiles'),
    notes(r2).join(', '));
  check('and naming what it lacked', r2 && JSON.stringify(r2.lacking) === '["pro.automatic.profiles"]', r2 && JSON.stringify(r2.lacking));
  check('it still counted what it would have taken', r2 && r2.selected && r2.selected.files === files.length, r2 && JSON.stringify(r2.selected));
  check('nothing moved', fixtureIntact(files) && r2 && r2.trashed.files === 0);

  const first = await electron(['--scheduled-run', '--profile=main'], proData);
  const r1 = lastRun(proData);
  check('the first profile is untouched by the licence', first.code === 0 && r1 && r1.profileId === 'main' && !r1.lacking &&
    !notes(r1).some((n) => /^run\.note\.licence/.test(n)), r1 ? notes(r1).join(', ') : 'no run');

  console.log('\nexpiry: no licence at all\n');
  const freeData = userData('free', null);
  await electron(['--scheduled-run', '--profile=psecond1'], freeData);
  const rf = lastRun(freeData);
  check('a profile beyond the first reports, as part of Pro', rf && rf.outcome === 'dry-run' && notes(rf).includes('run.note.licenceProfiles') &&
    !notes(rf).includes('run.note.licenceExpired'), rf ? notes(rf).join(', ') : 'no run');
  check('nothing moved', fixtureIntact(files));

  console.log('\nexpiry: Business that ended\n');
  const biz = issuer.issue({ plan: 'business-annual', tier: 'business', seats: 5, expires: new Date(Date.now() - 10 * DAY).toISOString() }).token;
  const bizData = userData('business', biz);
  const version = await electron(['--cli', 'version', '--json'], bizData);
  let doc = null;
  try {
    doc = JSON.parse(version.out);
  } catch {
    doc = null;
  }
  check('the command line knows which commands are closed', doc && doc.commands && doc.commands.scan === false && doc.commands.run === false &&
    doc.commands.journal === true && doc.commands.restore === true, doc ? JSON.stringify(doc.commands) : version.out.slice(0, 200));
  const run = await electron(['--cli', 'run', '--profile', 'psecond1'], bizData);
  check('a gated command exits 3 and says the licence lapsed', run.code === 3 && /licence has lapsed/.test(run.err), `exit ${run.code} ${run.err.trim().slice(0, 160)}`);
  const list = await electron(['--cli', 'journal', 'list'], bizData);
  check('the journal is listed whatever the licence says (rule 4)', list.code === 0, `exit ${list.code} ${list.err.slice(0, 160)}`);
  const verify = await electron(['--cli', 'journal', 'verify'], bizData);
  check('and checked', verify.code === 0, `exit ${verify.code} ${verify.err.slice(0, 160)}`);

  check('every fixture file is still there', fixtureIntact(files));
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
