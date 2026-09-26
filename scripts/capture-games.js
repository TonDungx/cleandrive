#!/usr/bin/env node
'use strict';

// Fixtures for D2, taken from this machine's real Steam install. Read-only.
//
//   node scripts/capture-games.js
//
// Writes into scripts/fixtures/games/:
//
//   libraryfolders.vdf   as Steam wrote it
//   appmanifest_*.acf    one manifest per game, whole
//   localconfig-play.vdf  only the play records: the real file is 76 KB of
//                         one account's settings, and none of the rest of it
//                         is anything this app reads or should keep
//
// What is blanked: the account name and the Steam IDs, which identify a
// person. Game names, app ids, sizes and dates are left as they are -- they
// are what the parsers are held to.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const steam = require('../src/main/games/steam');
const vdf = require('../src/main/games/vdf');

const OUT = path.join(__dirname, 'fixtures', 'games');
const account = path.basename(os.homedir());

/** Steam IDs are 17 digits and name a person; the folder ids are shorter. */
function blank(text) {
  let out = account ? text.split(account).join('USER') : text;
  out = out.replace(/\b7656119\d{10}\b/g, '76561190000000000');
  return out;
}

async function main() {
  await fsp.mkdir(OUT, { recursive: true });

  const found = await steam.findSteam();
  if (!found.path) {
    console.log('no Steam on this machine; nothing captured');
    return;
  }
  console.log(`steam: ${found.path}`);

  const lf = path.join(found.path, 'steamapps', 'libraryfolders.vdf');
  await fsp.writeFile(path.join(OUT, 'libraryfolders.vdf'), blank(await fsp.readFile(lf, 'utf8')), 'utf8');
  console.log('  libraryfolders.vdf');

  const libs = await steam.libraries(found.path);
  let manifests = 0;
  for (const lib of libs.libraries) {
    if (!lib.present) continue;
    const apps = path.join(lib.path, 'steamapps');
    for (const name of await fsp.readdir(apps)) {
      if (!steam.appidOf(name)) continue;
      await fsp.writeFile(path.join(OUT, name), blank(await fsp.readFile(path.join(apps, name), 'utf8')), 'utf8');
      manifests++;
    }
  }
  console.log(`  ${manifests} appmanifest files`);

  // One account's play records, and nothing else from that file.
  const userdata = path.join(found.path, 'userdata');
  const accounts = (await fsp.readdir(userdata, { withFileTypes: true })).filter((d) => d.isDirectory());
  for (const dir of accounts) {
    const file = path.join(userdata, dir.name, 'config', 'localconfig.vdf');
    let text;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const records = steam.playRecords(vdf.parse(text));
    if (records.size < 5) continue;
    const lines = ['"UserLocalConfigStore"', '{', '\t"Software"', '\t{', '\t\t"Valve"', '\t\t{', '\t\t\t"Steam"', '\t\t\t{', '\t\t\t\t"apps"', '\t\t\t\t{'];
    let kept = 0;
    for (const [appid, at] of records) {
      if (kept >= 20) break;
      lines.push(`\t\t\t\t\t"${appid}"`, '\t\t\t\t\t{', `\t\t\t\t\t\t"LastPlayed"\t\t"${Math.floor(at / 1000)}"`, '\t\t\t\t\t}');
      kept++;
    }
    lines.push('\t\t\t\t}', '\t\t\t}', '\t\t}', '\t}', '}', '');
    await fsp.writeFile(path.join(OUT, 'localconfig-play.vdf'), lines.join('\n'), 'utf8');
    console.log(`  localconfig-play.vdf (${kept} play records, from one account)`);
    break;
  }

  console.log(`\nwritten to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
