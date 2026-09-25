#!/usr/bin/env node
'use strict';

// Record, from this machine, the folders each known app keeps -- the fixtures
// scripts/test-appcaches.js holds the definitions to.
//
//   node scripts/capture-app-caches.js            print what it would write
//   node scripts/capture-app-caches.js --write    write scripts/fixtures/app-caches/<id>.json
//
// Folder names only, never a file, never a size, and never deeper than two
// levels under an app's root -- which is where its cache folders are, and
// above where a browser keeps names that say which sites were visited
// (`IndexedDB\https_...`). A folder that stands in for an account -- the one
// "*" in a definition's path matches, such as Zoom's per-account folder -- is
// written as "account-1", "account-2", so no identifier leaves the machine.
// Reading only; nothing is changed.

const fs = require('node:fs');
const path = require('node:path');

const { DEFINITIONS, matcher } = require('../src/main/analyzers/app-caches');

const WRITE = process.argv.includes('--write');
const OUT = path.join(__dirname, 'fixtures', 'app-caches');

function dirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** Every folder a root pattern names on this machine, with the "*" parts blanked. */
function expand(base, pattern) {
  let found = [{ real: base, shown: [] }];
  let accounts = 0;
  for (const seg of pattern) {
    const next = [];
    for (const at of found) {
      if (seg === '*') {
        for (const name of dirs(at.real)) {
          accounts += 1;
          next.push({ real: path.join(at.real, name), shown: [...at.shown, `account-${accounts}`] });
        }
      } else if (fs.existsSync(path.join(at.real, seg))) {
        next.push({ real: path.join(at.real, seg), shown: [...at.shown, seg] });
      }
    }
    found = next;
  }
  return found;
}

const match = matcher(process.env);
const today = new Date().toISOString().slice(0, 10);

// Also blanked: a site's name (`https_discord.com_0.indexeddb.leveldb`); a
// GUID (`blob_storage\70332780-...`); and a run of sixteen or more lower-case
// letters and digits with a digit in it, which is what an id looks like
// (`WV2Profile_zoomapps_mdrr...`) and what no folder name an app chose does
// (`DawnGraphiteCache` is not blanked). All keep the shape the patterns match on.
let sites = 0;
let ids = 0;
function blank(name) {
  if (/^https?_/i.test(name)) return `site-${(sites += 1)}`;
  return name
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, () => `id${(ids += 1)}`)
    .replace(/(?=[a-z0-9]*[0-9])[a-z0-9]{16,}/g, () => `id${(ids += 1)}`);
}

for (const def of DEFINITIONS) {
  const fixture = { id: def.id, captured: today, note: 'Folder names on the machine the definition was checked on, two levels deep; accounts blanked.', roots: [] };
  for (const root of def.roots) {
    const base = process.env[root.base];
    for (const at of expand(base, root.path)) {
      const folders = [];
      const matched = [];
      for (const first of dirs(at.real)) {
        const one = blank(first);
        folders.push(one);
        if ((match(path.join(at.real, first)) || {}).folder) matched.push(one);
        for (const second of dirs(path.join(at.real, first))) {
          const two = `${one}/${blank(second)}`;
          folders.push(two);
          if ((match(path.join(at.real, first, second)) || {}).folder) matched.push(two);
        }
      }
      fixture.roots.push({ base: root.base, path: at.shown, folders, matched });
    }
  }
  const body = `${JSON.stringify(fixture, null, 2)}\n`;
  const count = fixture.roots.reduce((n, r) => n + r.matched.length, 0);
  console.log(`${def.id}: ${fixture.roots.length} root(s), ${fixture.roots.reduce((n, r) => n + r.folders.length, 0)} folders, ${count} cache folders`);
  if (WRITE) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${def.id}.json`), body);
  }
}
if (!WRITE) console.log('\n(nothing written; pass --write)');
