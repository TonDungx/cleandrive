#!/usr/bin/env node
'use strict';

// When the introduction (I4) is shown: the first time the app is opened on
// this account, and not to somebody upgrading an app they already use.
//
//   node scripts/test-intro.js
//
// src/main/intro.js answers from what is on disk. Each trace is written by
// something a person who has used the app has done -- launched it (the disk
// measurement at launch writes history.json), changed a setting, deleted a
// file (the journal, or the ledger before it) -- so each one on its own must
// be enough to stay quiet.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const intro = require('../src/main/intro');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-intro-'));

console.log('\nintro: who is introduced to the app\n');

check('an empty data folder is a first run', intro.firstRun(dir) === true);
check('so is one that does not exist yet', intro.firstRun(path.join(dir, 'not-yet')) === true);
// Chromium's own files are there from the first second of the first launch,
// before anybody has seen anything.
fs.mkdirSync(path.join(dir, 'Local Storage'));
fs.writeFileSync(path.join(dir, 'Preferences'), '{}');
check('Chromium’s own files do not count as having used the app', intro.firstRun(dir) === true);

for (const trace of intro.TRACES) {
  const here = fs.mkdtempSync(path.join(dir, 'trace-'));
  const at = path.join(here, trace);
  if (trace === 'journal') fs.mkdirSync(at);
  else fs.writeFileSync(at, '{}');
  check(`${trace} alone means the app has been used here`, intro.firstRun(here) === false);
}

{
  // A folder that cannot be read is not taken for an empty one.
  const broken = { existsSync: () => { throw new Error('EPERM'); } };
  check('an unreadable folder is not taken for a first run', intro.firstRun(dir, broken) === false);
}

check('no folder at all is not a first run', intro.firstRun('') === false);

{
  intro.decide(dir);
  const first = intro.query();
  const again = intro.query();
  check('the first window is told, once', first.intro === '1' && again.intro === undefined, JSON.stringify({ first, again }));
  intro.decide(path.join(dir, fs.readdirSync(dir).find((n) => n.startsWith('trace-'))));
  check('and a returning user’s window is told nothing', JSON.stringify(intro.query()) === '{}');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
