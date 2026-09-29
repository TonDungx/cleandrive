#!/usr/bin/env node
'use strict';

// The games library (D2): the KeyValues parser, what Steam's files are read
// to mean, the handoff that hands a game to Steam, and the rows the screen is
// drawn from.
//
//   node scripts/test-games.js
//
// The fixtures in scripts/fixtures/games/ are Steam's own files from this
// machine, taken by capture-games.js: the library list, every appmanifest, and
// one account's play records with nothing else from that file. The account
// name and the Steam IDs are blanked. Where a test needs something this
// machine does not have -- a folder no manifest claims, a library on a drive
// that was unplugged -- it is built here and the test says so in its name.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const vdf = require('../src/main/games/vdf');
const steam = require('../src/main/games/steam');
const gamesMeasure = require('../src/main/games/measure');
const gamesAnalyzer = require('../src/main/analyzers/games');
const analyzers = require('../src/main/analyzers');
const handoff = require('../src/main/actions/handoff');
const { validateCandidate } = require('../src/main/analyzers/contract');
const { isAllowedUnattended } = require('../src/main/automatic/allowed-categories');
const { can } = require('../src/main/license/entitlements');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const FIXTURES = path.join(__dirname, 'fixtures', 'games');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const DAY = 86400000;
const BS = String.fromCharCode(92);

/* -------------------------------------------------------------------------- */
/* the KeyValues parser                                                       */
/* -------------------------------------------------------------------------- */

console.log('\ngames: reading the format every Steam file is written in\n');

{
  const doc = vdf.parse(read('libraryfolders.vdf'));
  const libs = vdf.section(doc, 'libraryfolders');
  check('the real library list parses', libs && Object.keys(libs).length >= 2, libs ? Object.keys(libs).join(', ') : 'none');

  const paths = Object.values(libs).map((l) => vdf.str(l, 'path'));
  check('each library gives a path', paths.length >= 2 && paths.every((p) => /^[A-Za-z]:/.test(p)), paths.join(' | '));
  check('a path with doubled backslashes comes back as a real one',
    paths.some((p) => p.includes(`${BS}Program Files`)) && !paths.some((p) => p.includes(`${BS}${BS}`)),
    JSON.stringify(paths[0]));
  check('the apps block inside a library is read as a block, not a value',
    Object.values(libs).some((l) => typeof vdf.get(l, 'apps') === 'object'));
}

{
  const state = vdf.section(vdf.parse(read('appmanifest_1274570.acf')), 'AppState');
  check('a real manifest parses', Boolean(state));
  check('it names the game', vdf.str(state, 'name') === 'DEVOUR', vdf.str(state, 'name'));
  check('numbers are numbers, not strings', vdf.num(state, 'SizeOnDisk') > 1e9, String(vdf.num(state, 'SizeOnDisk')));
  check('the nested depot block is nested', typeof vdf.get(state, 'InstalledDepots') === 'object');
  check('a key is found whatever its case', vdf.num(state, 'sizeondisk') === vdf.num(state, 'SizeOnDisk'));
}

{
  // Built by hand: this machine's files happen not to use every part of the
  // format at once.
  const text = [
    '"root"',
    '{',
    '  // a comment, which is not a key',
    `  "escaped"  "back${BS}${BS}slash"`,
    `  "quoted"   "say ${BS}"hi${BS}""`,
    `  "undoubled" "C:${BS}Users${BS}x"`,
    '  "conditional" "yes" [$WIN32]',
    '  "after"    "kept"',
    '  bare       token',
    '  "block" { "inner" "1" }',
    '}',
  ].join('\n');
  const out = vdf.section(vdf.parse(text), 'root');
  check('(built by hand) a doubled backslash becomes one', out.escaped === `back${BS}slash`, JSON.stringify(out.escaped));
  check('(built by hand) an escaped quote survives', out.quoted === 'say "hi"', JSON.stringify(out.quoted));
  check('(built by hand) a path whose backslashes were not doubled is left alone',
    out.undoubled === `C:${BS}Users${BS}x`, JSON.stringify(out.undoubled));
  check('(built by hand) a [$WIN32] condition is not read as the next key',
    out.conditional === 'yes' && out.after === 'kept', JSON.stringify({ conditional: out.conditional, after: out.after }));
  check('(built by hand) an unquoted token is read', out.bare === 'token', JSON.stringify(out.bare));
  check('(built by hand) a comment is not a key', !('//' in out) && out.block && out.block.inner === '1');
  check('(built by hand) a file that stops mid-string does not throw',
    (() => {
      try {
        vdf.parse('"a" "unterminated');
        return true;
      } catch {
        return false;
      }
    })());
  check('(built by hand) a file nested past the limit is refused, not followed',
    (() => {
      const deep = '"a"{'.repeat(200);
      try {
        vdf.parse(deep);
        return false;
      } catch (err) {
        return /too deep/.test(err.message);
      }
    })());
}

/* -------------------------------------------------------------------------- */
/* play records                                                               */
/* -------------------------------------------------------------------------- */

console.log('\ngames: when Steam says a game was last played\n');

{
  const records = steam.playRecords(vdf.parse(read('localconfig-play.vdf')));
  check('one account\u2019s play records are found, however deep they sit', records.size >= 5, `${records.size} games`);
  check('every one is a time that has already happened',
    [...records.values()].every((at) => at > 0 && at <= Date.now()), String(records.size));
  check('they are keyed by app id', [...records.keys()].every((id) => /^\d+$/.test(id)));
}

{
  // Built by hand: `apps` is the name of more than one block in the real file,
  // and only the one whose entries carry a LastPlayed is the right one.
  const text = [
    '"UserLocalConfigStore"', '{',
    '  "apps" { "notes" { "colour" "blue" } }',
    '  "Software" { "Valve" { "Steam" { "apps" {',
    '      "480" { "LastPlayed" "1735753185" "playtime" "985" }',
    '      "notanid" { "LastPlayed" "1735753185" }',
    '  } } } }',
    '}',
  ].join('\n');
  const records = steam.playRecords(vdf.parse(text));
  check('(built by hand) the apps block that holds play records is the one used',
    records.size === 1 && records.has('480'), [...records.keys()].join(', '));
  check('(built by hand) an entry whose key is not an app id is skipped', !records.has('notanid'));
}

/* -------------------------------------------------------------------------- */
/* the handoff that hands a game back to Steam                                */
/* -------------------------------------------------------------------------- */

console.log('\ngames: the only thing the app does about a game\n');

{
  check('a game\u2019s key opens Steam\u2019s own uninstall for that game',
    handoff.has('steamUninstall:1274570') && handoff.describeTarget('steamUninstall:1274570') === 'steam://uninstall/1274570',
    handoff.describeTarget('steamUninstall:1274570'));

  // The first handoff target that takes an argument, so the guard is the
  // thing under test.
  for (const bad of [
    'steamUninstall:', 'steamUninstall', 'steamUninstall:abc', 'steamUninstall:12345678901',
    `steamUninstall:12${BS}..${BS}x`, 'steamUninstall:1 2', 'steamUninstall:-1', 'steamUninstall:1e3',
    'steamUninstall:1274570 ', 'steamUninstall:1274570/../evil', 'steamUninstall:0x10',
  ]) {
    check(`and refuses ${JSON.stringify(bad)}`, !handoff.has(bad));
  }
  check('a target that takes no argument refuses one', !handoff.has('apps:evil') && handoff.has('apps'));
  check('an unknown key opens nothing', !handoff.has('nope') && !handoff.has('steamUninstallX:1'));

  const planned = handoff.plan(['steamUninstall:1274570', 'steamUninstall:oops']);
  check('a plan keeps the good one and refuses the bad one',
    planned.plan.length === 1 && planned.failed.length === 1 && planned.plan[0].path === 'steam://uninstall/1274570',
    JSON.stringify(planned.failed[0]));

  let opened = null;
  handoff.apply(handoff.plan(['steamUninstall:1274570']), {}, { deps: { openExternal: (uri) => { opened = uri; } } })
    .then(() => {
      check('applying it opens exactly that URI and nothing else', opened === 'steam://uninstall/1274570', String(opened));
      check('and it frees nothing by itself, because Steam does the removing', handoff.freesOnVolume() === false);
    });
}

/* -------------------------------------------------------------------------- */
/* a whole library, built from the fixtures                                   */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log('\ngames: a library read end to end\n');

  // A real library rebuilt from the real fixtures, in a folder of this
  // harness's own. The manifests, the library list and the play records are
  // Steam's; the game folders are empty, so what is checked is the reading.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-games-'));
  try {
    const steamDir = path.join(root, 'Steam');
    const apps = path.join(steamDir, 'steamapps');
    await fsp.mkdir(path.join(apps, 'common'), { recursive: true });

    const manifests = fs.readdirSync(FIXTURES).filter((n) => steam.appidOf(n));
    const installdirs = [];
    for (const name of manifests) {
      const text = read(name);
      await fsp.writeFile(path.join(apps, name), text, 'utf8');
      const state = vdf.section(vdf.parse(text), 'AppState');
      const dir = vdf.str(state, 'installdir');
      if (dir) {
        await fsp.mkdir(path.join(apps, 'common', dir), { recursive: true });
        installdirs.push(dir);
      }
    }

    // A library list pointing at this folder, plus one on a drive that is not
    // here -- built by hand, because both libraries on this machine exist.
    await fsp.writeFile(
      path.join(apps, 'libraryfolders.vdf'),
      ['"libraryfolders"', '{', '\t"0"', '\t{', `\t\t"path"\t\t"${steamDir.replace(/\\/g, '\\\\')}"`, '\t}',
        '\t"1"', '\t{', '\t\t"path"\t\t"Z:\\\\GoneLibrary"', '\t}', '}', ''].join('\n'),
      'utf8'
    );

    // One account's play records, as Steam lays them out.
    const account = path.join(steamDir, 'userdata', '1051847155', 'config');
    await fsp.mkdir(account, { recursive: true });
    await fsp.writeFile(path.join(account, 'localconfig.vdf'), read('localconfig-play.vdf'), 'utf8');

    const found = await steam.findSteam({ deps: { exportKey: async () => ({ 'HKEY_CURRENT_USER\\Software\\Valve\\Steam': { SteamPath: steamDir } }) } });
    check('Steam is found where the registry says it is', found.path === steamDir, `${found.path}`);

    const libs = await steam.libraries(steamDir);
    check('both libraries are listed, and the missing one is marked missing',
      libs.libraries.length === 2 && libs.libraries.filter((l) => l.present).length === 1,
      libs.libraries.map((l) => `${l.path}:${l.present}`).join(' | '));

    const installed = await steam.games(libs.libraries);
    check('every manifest became a game', installed.length === manifests.length, `${installed.length} of ${manifests.length}`);
    check('each one has an app id, a name and a size',
      installed.every((g) => /^\d+$/.test(g.appid) && g.name && g.bytes >= 0));
    check('a game with a Vietnamese name keeps it',
      installed.some((g) => /[\u00C0-\u1EF9]/.test(g.name)), installed.map((g) => g.name).find((n) => /[\u00C0-\u1EF9]/.test(n)) || 'none');

    const played = await steam.lastPlayed(steamDir);
    check('the account\u2019s play records are read', played.read === 1 && played.byApp.size >= 5,
      `${played.read} accounts, ${played.byApp.size} games`);

    // A folder in `common` that no manifest claims. There are none on this
    // machine -- ten folders, ten manifests -- so one is made here.
    await fsp.mkdir(path.join(apps, 'common', 'AbandonedGame'), { recursive: true });
    await fsp.writeFile(path.join(apps, 'common', 'AbandonedGame', 'data.bin'), Buffer.alloc(4096, 7));
    const orphans = await steam.orphans(libs.libraries, installed);
    check('(built by hand) a folder with no manifest is found', orphans.length === 1 && orphans[0].name === 'AbandonedGame',
      orphans.map((o) => o.name).join(', '));
    check('(built by hand) and every folder that has one is not', installdirs.length >= 5 && orphans.length === 1);

    // Leftovers, including a file Steam set aside and wrote nothing into.
    const downloading = path.join(apps, 'downloading');
    await fsp.mkdir(downloading, { recursive: true });
    await fsp.writeFile(path.join(downloading, 'depot_1_2.delta'), Buffer.alloc(64 * 1024, 3));
    const old = new Date(Date.now() - 300 * DAY);
    await fsp.utimes(path.join(downloading, 'depot_1_2.delta'), old, old);

    const model = await gamesMeasure.scan({
      env: {},
      deps: {
        exportKey: async () => ({ 'HKEY_CURRENT_USER\\Software\\Valve\\Steam': { SteamPath: steamDir } }),
        runningProcessNames: async () => new Set(['explorer.exe']),
      },
    });

    check('the scan finds Steam, its games and its leftovers',
      model.installed && model.games.length === manifests.length && model.orphans.length === 1 && model.downloads.length === 1,
      `games=${model.games.length} orphans=${model.orphans.length} downloads=${model.downloads.length}`);
    check('and notices Steam is not running', model.steamRunning === false);
    check('a library on a drive that is not attached is reported, not counted',
      model.libraries.some((l) => !l.present), model.libraries.map((l) => l.path).join(' | '));

    // Where the two records disagree, the later one wins.
    const disagreeing = model.games.filter((g) => g.playedSource === 'account');
    check('where an account played a game more recently than the manifest says, the account wins',
      model.games.every((g) => !g.lastPlayedAt || g.lastPlayedAt >= g.manifestPlayedAt),
      `${disagreeing.length} games took the account\u2019s date`);

    /* ---- the rows ---- */

    console.log('\ngames: the rows the screen is drawn from\n');

    const out = await analyzers.collect('games', { model }, { strict: true, can: () => true });
    for (const c of out.candidates) validateCandidate(c);
    check('every row validates as a candidate', out.summary.rejected === 0 && out.candidates.length > manifests.length,
      `${out.candidates.length} rows`);
    check('no game is ever safe', out.candidates.every((c) => c.verdict !== 'safe'),
      [...new Set(out.candidates.map((c) => c.verdict))].join(', '));
    check('nothing here is ever part of an unattended run',
      out.candidates.every((c) => c.unattendedEligible === false && !isAllowedUnattended(c.category)));

    const gameRows = out.candidates.filter((c) => c.meta.kind === 'game');
    const realGames = gameRows.filter((c) => !c.meta.notAGame);
    check('a game\u2019s only action is handing it to Steam',
      realGames.every((c) => c.actions.length === 1 && c.actions[0] === 'handoff'));
    check('and the handoff names that game',
      realGames.every((c) => c.meta.handoff === `steamUninstall:${c.meta.appid}` && handoff.has(c.meta.handoff)));
    check('a game is never offered to the bin',
      gameRows.every((c) => !c.actions.includes('recycle') && !c.actions.includes('quarantine')));
    check('and every game row says why the app will not remove it',
      realGames.every((c) => c.evidence.some((e) => e.i18n === 'evidence.games.uninstallOnly')));

    // When Steam last patched it. Read from the manifest since D2 shipped and
    // shown nowhere until the dead-feature sweep -- it disagrees with "last
    // played" in the way that matters: a game played two years ago but patched
    // last month is one Steam still maintains.
    {
      const withUpdate = gameRows.filter((c) => c.evidence.some((e) => e.i18n === 'evidence.games.updated'));
      check('a game whose manifest records an update says how long ago that was',
        withUpdate.length > 0, `${withUpdate.length} of ${gameRows.length} rows`);
      check('and the number is days, not a raw timestamp',
        withUpdate.every((c) => {
          const line = c.evidence.find((e) => e.i18n === 'evidence.games.updated');
          return Number(String(line.params.n).replace(/[^\d]/g, '')) < 40000;
        }),
        withUpdate.map((c) => c.evidence.find((e) => e.i18n === 'evidence.games.updated').params.n).slice(0, 4).join(', '));
    }

    // Steam's own shared runtime sits in the library looking like a game, has
    // never been played, and breaks other games if it goes. A screenshot
    // caught it being offered for uninstall before this existed.
    const redist = gameRows.find((c) => c.meta.appid === '228980');
    check('Steam\u2019s shared runtime is protected, not offered for removal',
      redist && redist.verdict === 'protected' && redist.actions.join() === 'none' && redist.meta.handoff === null,
      redist ? `${redist.verdict}/${redist.actions.join()}/${redist.meta.handoff}` : 'not in the fixtures');
    check('and it says what it is rather than that nobody has played it',
      redist && redist.evidence.some((e) => e.i18n === 'evidence.games.redistributables') &&
        !redist.evidence.some((e) => e.i18n === 'evidence.games.neverPlayed'),
      redist ? redist.evidence.map((e) => e.i18n).join(', ') : '-');
    check('and it is the only row treated that way',
      gameRows.filter((c) => c.meta.notAGame).length === 1,
      gameRows.filter((c) => c.meta.notAGame).map((c) => c.meta.name).join(', '));

    const orphanRows = out.candidates.filter((c) => c.meta.kind === 'orphan');
    check('(built by hand) a folder with no manifest is review, with nothing to click',
      orphanRows.length === 1 && orphanRows[0].verdict === 'review' && orphanRows[0].actions.join() === 'none',
      orphanRows.map((c) => `${c.verdict}/${c.actions.join()}`).join(', '));
    check('(built by hand) and it says to check Steam before removing it',
      orphanRows[0].evidence.some((e) => e.i18n === 'evidence.games.orphanCheck'));

    const downloadRows = out.candidates.filter((c) => c.meta.kind === 'download');
    check('(built by hand) a leftover download file may go to the bin, Steam being closed',
      downloadRows.length === 1 && downloadRows[0].actions.join() === 'recycle',
      downloadRows.map((c) => c.actions.join()).join(', '));
    check('(built by hand) an old one is likely rather than a guess', downloadRows[0].confidence === 'likely');

    /* ---- Steam running, and unreadable ---- */

    for (const [label, names, expected] of [
      ['running', new Set(['steam.exe']), true],
      ['not readable', null, null],
    ]) {
      const other = await gamesMeasure.scan({
        env: {},
        deps: {
          exportKey: async () => ({ 'HKEY_CURRENT_USER\\Software\\Valve\\Steam': { SteamPath: steamDir } }),
          runningProcessNames: async () => names,
        },
      });
      check(`Steam ${label} is noticed`, other.steamRunning === expected, String(other.steamRunning));
      const rows = await analyzers.collect('games', { model: other }, { strict: true, can: () => true });
      const leftovers = rows.candidates.filter((c) => c.meta.kind === 'download');
      check(`and with Steam ${label}, nothing is offered to the bin`,
        leftovers.every((c) => c.actions.join() === 'none'), leftovers.map((c) => c.actions.join()).join(', '));
    }

    /* ---- a file Steam set aside and wrote nothing into ---- */

    {
      // Built by hand: a sparse file cannot be made portably, so the shape is
      // handed straight to the row builder. The real thing is measured --
      // `steamapps\downloading` here claims 11.07 GB and occupies 1.77 GB,
      // with one 7.6 GB file holding nothing.
      const row = gamesAnalyzer.downloadCandidate(
        { path: 'D:\\x\\big.resS', size: 7.6e9, allocated: 0, mtimeMs: Date.now() - 100 * DAY },
        { path: 'D:\\x', library: 'D:\\' },
        { steamRunning: false }
      );
      check('(built by hand) a row shows what a file occupies, not what it claims',
        row.bytesOnDisk === 0 && row.bytes === 7.6e9, `${row.bytes} claimed, ${row.bytesOnDisk} on disk`);
      check('(built by hand) and says so in as many words',
        row.evidence.some((e) => e.i18n === 'evidence.games.downloadSparse'));
      const partial = gamesAnalyzer.downloadCandidate(
        { path: 'D:\\x\\part.resS', size: 1000, allocated: 1000, mtimeMs: Date.now() },
        { path: 'D:\\x', library: 'D:\\' },
        { steamRunning: false }
      );
      check('(built by hand) a file that is all there does not claim to be sparse',
        !partial.evidence.some((e) => e.i18n === 'evidence.games.downloadSparse'));
    }

    /* ---- the licence ---- */

    console.log('\ngames: who gets this screen\n');

    const free = await analyzers.collect('games', { model }, { can: (f) => can({ state: 'free' }, f) });
    check('Free gets no rows at all, and is told which feature it is',
      free.candidates.length === 0 && free.locked === 'pro.games', `${free.candidates.length} rows, locked=${free.locked}`);
    check('Pro gets the screen', can({ state: 'active', tier: 'pro' }, 'pro.games'));
    check('the analyzer declares the feature the roadmap named', gamesAnalyzer.analyzer.feature === 'pro.games');

    /* ---- no Steam at all ---- */

    // Both variables, not one: `findSteam` falls back to the usual absolute
    // paths when a variable is missing, and this machine really does have
    // Steam at one of them.
    const nowhere = path.join(root, 'nowhere');
    const nothing = await gamesMeasure.scan({
      env: { ProgramFiles: nowhere, 'ProgramFiles(x86)': nowhere },
      deps: { exportKey: async () => null, runningProcessNames: async () => new Set() },
    });
    check('a machine with no Steam says so rather than failing',
      nothing.installed === false && nothing.games.length === 0 && Array.isArray(nothing.triedPaths),
      `tried ${nothing.triedPaths.length} places`);
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
