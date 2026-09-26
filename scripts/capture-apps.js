#!/usr/bin/env node
'use strict';

// Fixtures for D1, taken from this machine. Read-only.
//
//   node scripts/capture-apps.js
//
// Writes three files into scripts/fixtures/apps/:
//
//   uninstall.reg    a real `reg export` of the three Uninstall hives, cut
//                    down to the entries the harness needs -- every shape
//                    that turned up here, including the two that keep their
//                    InstallLocation as hex(2) rather than as a string
//   userassist.reg   a real export of the UserAssist Count keys
//   appx.tsv         a real `Get-AppxPackage` listing
//
// What is blanked: the account name, wherever it appears in a path, becomes
// `USER` -- in plain text and in the ROT13 UserAssist writes its names in,
// where it would otherwise sit in the fixture waiting to be decoded. Nothing
// else is touched -- an app name, a publisher and a version
// are what the parsers are held to, and a fixture nobody can check against
// the machine it came from is not a fixture.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { HIVES, USERASSIST, REG } = require('../src/main/apps/registry');
const store = require('../src/main/apps/store');

const OUT = path.join(__dirname, 'fixtures', 'apps');

const account = path.basename(os.homedir());
const { rot13 } = require('../src/main/apps/lastused');

/**
 * Take the account name out, in both the forms it appears in.
 *
 * UserAssist stores its value names in ROT13, so the account name is in there
 * as `xgiqn` rather than as itself, and blanking only the plain spelling would
 * leave it in the fixture for anybody to decode.
 */
function blank(text) {
  if (!account) return text;
  return text.split(account).join('USER').split(rot13(account)).join(rot13('USER'));
}

function run(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: 120000 }, (err) => (err ? reject(err) : resolve()));
  });
}

/** One hive exported, as text. */
async function exportHive(key) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-capture-'));
  const file = path.join(dir, 'out.reg');
  try {
    await run(REG(), ['export', key, file, '/y']);
    return (await fsp.readFile(file)).toString('utf16le');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The `[key]` … block for each entry, so blocks can be picked out whole. */
function blocks(text) {
  return text.split(/\r?\n(?=\[)/).filter((b) => b.trim().startsWith('['));
}

/**
 * Keep one block of each shape that matters, rather than all 638: a fixture
 * has to be readable by somebody deciding whether it still matches reality.
 */
function interesting(list) {
  const wanted = [
    ['hexLocation', (b) => /"InstallLocation"=hex\(2\)/.test(b)],
    ['plainLocation', (b) => /"InstallLocation"="[A-Za-z]:/.test(b) && /"EstimatedSize"=dword/.test(b)],
    ['emptyLocation', (b) => /"InstallLocation"=""/.test(b) && /"DisplayName"=/.test(b)],
    ['systemComponent', (b) => /"SystemComponent"=dword:00000001/.test(b) && /"DisplayName"=/.test(b)],
    ['parentKey', (b) => /"ParentKeyName"=/.test(b)],
    ['releaseType', (b) => /"ReleaseType"="(?!Application)/.test(b)],
    ['noRemove', (b) => /"NoRemove"=dword:00000001/.test(b) && /"DisplayName"=/.test(b)],
    // Not the hive's own key, which has no DisplayName because it is not an
    // entry at all.
    ['noName', (b) => !/"DisplayName"=/.test(b) && !/^\[[^\]]*\Uninstall\]/.test(b)],
    ['quietUninstall', (b) => /"QuietUninstallString"=/.test(b)],
    ['noUninstaller', (b) => /"DisplayName"=/.test(b) && !/"UninstallString"=/.test(b) && !/"SystemComponent"/.test(b)],
  ];
  const out = [];
  const taken = new Set();
  for (const [label, test] of wanted) {
    const found = list.find((b) => test(b) && !taken.has(b));
    if (!found) {
      console.log(`  (no block on this machine for: ${label})`);
      continue;
    }
    taken.add(found);
    out.push(found);
  }
  return out;
}

async function main() {
  await fsp.mkdir(OUT, { recursive: true });

  const kept = [];
  for (const { hive, key } of HIVES) {
    let text;
    try {
      text = await exportHive(key);
    } catch {
      console.log(`  ${hive}: could not be exported, skipped`);
      continue;
    }
    const list = blocks(text);
    const picked = interesting(list);
    console.log(`  ${hive}: ${list.length} blocks, kept ${picked.length}`);
    kept.push(...picked);
  }
  const header = 'Windows Registry Editor Version 5.00\r\n\r\n';
  await fsp.writeFile(path.join(OUT, 'uninstall.reg'), Buffer.from(blank(header + kept.join('\r\n')), 'utf16le'));

  // UserAssist: the Count keys, with every value kept as exported.
  const ua = await exportHive(USERASSIST).catch(() => null);
  if (ua) {
    const counts = blocks(ua).filter((b) => /\\Count\]/i.test(b));
    // Only the values that decode: 72 bytes, which is one line plus
    // continuations. Keeping every one would be a 200 KB fixture.
    const trimmed = counts.map((block) => {
      const lines = block.split(/\r?\n/);
      const head = lines[0];
      const values = [];
      let current = null;
      for (const line of lines.slice(1)) {
        if (/^"/.test(line)) {
          if (current) values.push(current);
          current = [line];
        } else if (current && current.length) current.push(line);
      }
      if (current) values.push(current);
      return [head, ...values.slice(0, 12).flat()].join('\r\n');
    });
    await fsp.writeFile(path.join(OUT, 'userassist.reg'), Buffer.from(blank(header + trimmed.join('\r\n\r\n')), 'utf16le'));
    console.log(`  UserAssist: ${counts.length} Count keys, up to 12 values each`);
  }

  const packages = await store.listPackages();
  const rows = packages.packages
    .slice(0, 40)
    .map((p) => [p.name, p.fullName, p.familyName, p.publisher, p.signature, p.version, p.location, p.nonRemovable].join('\t'));
  await fsp.writeFile(path.join(OUT, 'appx.tsv'), blank(`${rows.join('\n')}\n`), 'utf8');
  console.log(`  Store: ${packages.packages.length} packages, kept ${rows.length}`);

  console.log(`\nwritten to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
