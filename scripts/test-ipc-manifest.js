#!/usr/bin/env node
'use strict';

// The window can reach exactly what ipc-manifest.js lists, and nothing else.
//   node scripts/test-ipc-manifest.js
//
// Read from the source rather than by booting the app: the preload runs
// sandboxed and cannot require the manifest, so the only way to hold it to the
// list is to read what it invokes. `ipc.js` enforces the same list at runtime.

const fs = require('node:fs');
const path = require('node:path');

const { INVOKE, EVENTS } = require('../src/main/ipc-manifest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const all = (text, re) => [...text.matchAll(re)].map((match) => match[1]);
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const diff = (a, b) => a.filter((x) => !b.includes(x));

function mainSources(dir = 'src/main') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mainSources(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

console.log('\nipc: the manifest\n');

check('no channel is listed twice', new Set(INVOKE).size === INVOKE.length && new Set(EVENTS).size === EVENTS.length);
check('every name is area:verb', [...INVOKE, ...EVENTS].every((c) => /^[a-z]+:[a-zA-Z-]+$/.test(c)),
  [...INVOKE, ...EVENTS].filter((c) => !/^[a-z]+:[a-zA-Z-]+$/.test(c)).join(', '));
console.log(`    ${INVOKE.length} operations, ${EVENTS.length} events`);

console.log('\nipc: the preload asks for nothing else\n');

const preload = read('src/main/preload.js');
const invoked = [...new Set(all(preload, /ipcRenderer\.invoke\('([^']+)'/g))];
const subscribed = [...new Set(all(preload, /subscribe\('([^']+)'/g))];

check('every operation the preload invokes is in the manifest', diff(invoked, INVOKE).length === 0,
  diff(invoked, INVOKE).join(', '));
check('and every operation in the manifest is reachable from it', diff(INVOKE, invoked).length === 0,
  diff(INVOKE, invoked).join(', '));
check('every event it listens for is in the manifest', diff(subscribed, EVENTS).length === 0,
  diff(subscribed, EVENTS).join(', '));
check('it never sends, or listens outside subscribe()',
  !/ipcRenderer\.(send|sendSync|sendTo|postMessage)\(/.test(preload) &&
    (preload.match(/ipcRenderer\.on\(/g) || []).length === 1);
check('it never invokes a channel it computed', !/ipcRenderer\.invoke\((?!')/.test(preload));
check('and it exposes one object, once', (preload.match(/exposeInMainWorld\(/g) || []).length === 1);

console.log('\nipc: the main process answers exactly that\n');

const ipcSource = read('src/main/ipc.js');
const handled = all(ipcSource, /\n\s+handle\('([^']+)'/g);
check('ipc.js handles every operation in the manifest, once each',
  same(handled, INVOKE) && new Set(handled).size === handled.length,
  `missing: ${diff(INVOKE, handled).join(', ') || '-'}; extra: ${diff(handled, INVOKE).join(', ') || '-'}`);
check('and registers nothing directly, around the manifest check',
  (ipcSource.match(/ipcMain\.handle\(/g) || []).length === 1);

const sources = mainSources();
const strays = [];
for (const rel of sources) {
  if (rel.endsWith('ipc.js')) continue;
  if (/ipcMain\.(handle|on)\(/.test(read(rel))) strays.push(rel);
}
check('no other file in the main process registers a handler', strays.length === 0, strays.join(', '));

const sent = new Set();
for (const rel of sources) {
  for (const channel of all(read(rel), /\.send\('([^']+)'/g)) sent.add(channel);
  for (const channel of all(read(rel), /send\('([a-z]+:[a-zA-Z-]+)'/g)) sent.add(channel);
}
check('every event the main process sends is in the manifest', diff([...sent], EVENTS).length === 0,
  diff([...sent], EVENTS).join(', '));

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
