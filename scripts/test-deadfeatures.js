#!/usr/bin/env node
'use strict';

// Nothing the app can do is unreachable.
//   node scripts/test-deadfeatures.js
//
// ## Why this exists
//
// E1 found `media:similar` wired end to end -- a perceptual hash, a grouping
// pass, an IPC channel, an entry in preload -- and called by no window, ever.
// `perceptual.js` even computed a `spread` with a comment saying it was there
// "so the UI can say how alike these actually are", for a screen that had
// never been written. It had been dead since the photo subsystem shipped and
// nothing complained, because nothing was looking.
//
// This looks. A capability that cannot be reached from a window is either a
// feature somebody is owed or code somebody should delete, and either way the
// suite should say so rather than leaving it to be noticed by eye.
//
// Four ways for something to be stranded, each its own check:
//
//   1. an API exposed in preload that no renderer file calls
//   2. an IPC channel with a handler that no preload API reaches
//   3. an event the main process sends that no preload subscribe receives
//   4. a subscribe helper in preload that no renderer wires up
//
// Deliberate exceptions go in ALLOWED below, each with the reason written out.
// An empty reason is not an exception, it is a to-do somebody hid.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/**
 * Things that look unreachable and are not, or are unreachable on purpose.
 *
 * Every entry needs a reason a person can check. This list is meant to stay
 * short: the honest answer to "nothing calls it" is almost always to wire it
 * up or take it out.
 */
const ALLOWED = {
  api: {
    // None today. E2 briefly added `backupClear` here and it was removed
    // instead: the toggle covers "not this time" and "Change folder" covers
    // "wrong folder", so nothing needed a third way to say it.
  },
  channel: {},
  event: {},
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const rendererFiles = walk(path.join(SRC, 'renderer'));
const rendererText = rendererFiles.map(read).join('\n');

const preload = read(path.join(SRC, 'main/preload.js'));
const ipc = read(path.join(SRC, 'main/ipc.js'));

/**
 * Whether a window reaches this name on the bridge.
 *
 * Three spellings, because the bridge has three: `api.x` in most files,
 * `window.cleandrive.x` in `theme.js` and `language.js` (they load before
 * `app.js` shortens it), and either of those split across lines by the
 * formatter -- which is real: `language.js` writes `window.cleandrive` and
 * `.getLanguage()` on separate lines, and a checker that missed it would
 * report a live call as dead.
 */
function reachedFromRenderer(name) {
  return new RegExp(`\\b(?:api|cleandrive)\\s*\\.\\s*${name}\\b`).test(rendererText);
}

console.log('\ndead features: what a window can and cannot reach\n');

/* -- 1. preload APIs nobody calls ----------------------------------------- */

const apis = [...preload.matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1]);
check('preload exposes a believable number of APIs', apis.length > 80, String(apis.length));

const unusedApis = apis.filter((name) => !reachedFromRenderer(name) && !(name in ALLOWED.api));
check('every API in preload is called by some renderer file', unusedApis.length === 0, unusedApis.join(', '));

/* -- 2. channels no preload API reaches ------------------------------------ */

const handled = [...ipc.matchAll(/\bhandle\(\s*'([^']+)'/g)].map((m) => m[1]);
check('ipc.js answers a believable number of channels', handled.length > 60, String(handled.length));

const unreachable = handled.filter((ch) => !preload.includes(`'${ch}'`) && !(ch in ALLOWED.channel));
check('every channel with a handler is reachable through preload', unreachable.length === 0, unreachable.join(', '));

/* -- 3. events nobody receives --------------------------------------------- */

const sent = [...new Set([...ipc.matchAll(/\.send\(\s*'([^']+)'/g)].map((m) => m[1]))];
const subscribed = new Set([...preload.matchAll(/subscribe\(\s*'([^']+)'/g)].map((m) => m[1]));
const unheard = sent.filter((ch) => !subscribed.has(ch) && !(ch in ALLOWED.event));
check('every event the main process sends has a subscriber in preload', unheard.length === 0, unheard.join(', '));

/* -- 4. subscribe helpers nobody wires up ---------------------------------- */

const helpers = [...preload.matchAll(/^\s{2}(on\w+):\s*\(cb\)/gm)].map((m) => m[1]);
const unwired = helpers.filter((name) => !reachedFromRenderer(name) && !(name in ALLOWED.api));
check('every subscribe helper is wired up by a renderer file', unwired.length === 0, unwired.join(', '));

/* -- 5. action kinds with no way in ---------------------------------------- */

const handlers = read(path.join(SRC, 'main/actions/handlers.js'));
const kinds = [...handlers.matchAll(/require\('\.\/([\w-]+)'\)/g)].map((m) => m[1]);
check('there are action kinds registered', kinds.length > 4, String(kinds.length));

const strandedKinds = kinds.filter((kind) => {
  const file = path.join(SRC, 'main/actions', `${kind}.js`);
  const body = fs.existsSync(file) ? read(file) : '';
  // From `module.exports`, not the first `kind:` in the file. `relocate.js`
  // says `kind: 'steam'` thirty lines earlier, describing a *handoff* kind --
  // a different vocabulary that happens to share the word -- and reading that
  // one made this check ask whether the window could reach an action called
  // steam. It could not, so relocate was reported dead while it was working.
  const exported = /module\.exports\s*=\s*\{[\s\S]*?\bkind:\s*'([^']+)'/.exec(body);
  const declared = exported ? exported[1] : kind;
  // Two ways in, and both count. Some kinds are named as a string in an
  // `action:execute` request (`{ kind: 'recycle' }`); others have a preload
  // API of the same name that fills the kind in for the window, which is how
  // relocate, compress and handoff are reached. A check that knew only about
  // the first called all three of those dead.
  const namedInRenderer = new RegExp(`['"\`]${declared}['"\`]`).test(rendererText);
  const viaApi = apis.includes(declared) && reachedFromRenderer(declared);
  return !namedInRenderer && !viaApi;
});
check('every action kind can be reached from a window', strandedKinds.length === 0, strandedKinds.join(', '));

/* -- 6. panels and tabs ----------------------------------------------------- */

const html = read(path.join(SRC, 'renderer/index.html'));
const tabs = [...new Set([...html.matchAll(/data-tab="([\w-]+)"/g)].map((m) => m[1]))];
const panels = [...new Set([...html.matchAll(/id="panel-([\w-]+)"/g)].map((m) => m[1]))];
check('every panel has a tab that opens it', panels.every((p) => tabs.includes(p)),
  panels.filter((p) => !tabs.includes(p)).join(', '));
check('every tab has a panel behind it', tabs.every((t) => panels.includes(t)),
  tabs.filter((t) => !panels.includes(t)).join(', '));

/* -- 7. exceptions carry their reason --------------------------------------- */

const badExceptions = [];
for (const [group, entries] of Object.entries(ALLOWED)) {
  for (const [name, why] of Object.entries(entries)) {
    if (typeof why !== 'string' || why.trim().length < 20) badExceptions.push(`${group}.${name}`);
  }
}
check('every deliberate exception says why, in a sentence', badExceptions.length === 0, badExceptions.join(', '));

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
