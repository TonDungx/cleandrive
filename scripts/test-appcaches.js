#!/usr/bin/env node
'use strict';

// Known apps' caches (D4): the definitions, held to what was found on a real
// machine, and what the scan, the screen's candidates and the unattended run
// make of them.
//
//   node scripts/test-appcaches.js
//
// Each definition has a fixture in scripts/fixtures/app-caches/, a listing of
// its real folders taken by capture-app-caches.js. The folders are built again
// here, empty, and the definition has to pick out exactly the cache folders it
// picked out on that machine -- and never one of the folders that hold a
// site's or an app's own data. Every name on a definition's list must have
// been seen in its fixture: a cache folder nobody has looked at is not shipped.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const appCaches = require('../src/main/analyzers/app-caches');
const { scan } = require('../src/main/lib/scanner');
const { selectFiles } = require('../src/main/lib/autoclean');
const analyzers = require('../src/main/analyzers');
const { ALLOWED, isAllowedUnattended } = require('../src/main/automatic/allowed-categories');
const { DEFAULT_CATEGORIES } = require('../src/main/lib/settings');
const { validateCandidate } = require('../src/main/analyzers/contract');
const processes = require('../src/main/lib/processes');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const FIXTURES = path.join(__dirname, 'fixtures', 'app-caches');
const DEFS_DIR = path.join(__dirname, '..', 'src', 'main', 'analyzers', 'app-caches');

/** Folders that hold a site's or an app's own data: never a cache, whatever is inside. */
const NEVER = [
  'service worker', 'indexeddb', 'local storage', 'session storage', 'network', 'extensions', 'file system',
  'webstorage', 'sync data', 'sessions', 'snapshots', 'databases', 'blob_storage', 'shared_proto_db',
  'platform notifications', 'web applications', 'local state', 'preferences', 'cookies',
];

async function make(file, bytes = 1024) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, Buffer.alloc(bytes, 1));
}

(async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-appcaches-'));
  try {
    console.log('\nThe definitions:');
    {
      const onDisk = fs.readdirSync(DEFS_DIR).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
      check('every definition file is loaded, and nothing loaded is missing',
        JSON.stringify(onDisk) === JSON.stringify([...appCaches.FILES].sort()), onDisk.join(', '));
      check('the apps checked on this machine, and not Camera Raw',
        appCaches.DEFINITIONS.map((d) => d.id).join(',') === 'chrome,edge,teams,discord,zoom,figma');
      const bad = (patch, why) => {
        let threw = null;
        try {
          appCaches.validate({ ...JSON.parse(fs.readFileSync(path.join(DEFS_DIR, 'chrome.json'), 'utf8')), ...patch }, 'chrome');
        } catch (err) {
          threw = err;
        }
        check(`refused: ${why}`, threw !== null, threw ? threw.message : 'accepted');
      };
      const root = (over) => ({ roots: [{ base: 'LOCALAPPDATA', path: ['Google', 'Chrome', 'User Data'], profiles: '^(Default)$', inProfile: ['Cache'], ...over }] });
      bad(root({ path: ['..', 'Windows'] }), 'a path that climbs out');
      bad(root({ path: ['C:\\Windows'] }), 'a path segment with a separator in it');
      bad(root({ base: 'SystemRoot' }), 'a base other than LOCALAPPDATA or APPDATA');
      bad(root({ path: ['*', 'Chrome'] }), 'a path that starts with a wildcard');
      bad(root({ profiles: 'Default' }), 'a profile pattern that is not anchored');
      bad(root({ inProfile: ['..'] }), 'a cache folder name that is not a folder name');
      bad({ processes: [] }, 'no process to wait for');
      bad({ processes: ['chrome'] }, 'a process that is not an .exe name');
      bad({ id: 'edge' }, 'an id that is not its file name');
    }

    console.log('\nHeld to the real folders (fixtures):');
    for (const def of appCaches.DEFINITIONS) {
      const file = path.join(FIXTURES, `${def.id}.json`);
      if (!fs.existsSync(file)) {
        check(`${def.id} has a fixture`, false);
        continue;
      }
      const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
      const env = {};
      const found = [];
      const expected = [];
      const seen = new Set();
      let never = [];
      for (const [i, root] of fixture.roots.entries()) {
        // Each root rebuilt in a base folder of its own.
        const home = path.join(base, def.id, String(i), root.base);
        env[root.base] = path.join(base, def.id, String(i), root.base);
        const at = path.join(home, ...root.path);
        const match = appCaches.matcher({ ...process.env, [root.base]: home });
        for (const rel of root.folders) await fsp.mkdir(path.join(at, ...rel.split('/')), { recursive: true });
        for (const rel of root.folders) {
          const hit = match(path.join(at, ...rel.split('/')));
          if (hit && hit.folder) {
            found.push(`${i}:${rel}`);
            seen.add(hit.folder);
            if (NEVER.some((n) => rel.toLowerCase().split('/').includes(n))) never.push(rel);
          }
        }
        for (const rel of root.matched) expected.push(`${i}:${rel}`);
      }
      never = [...new Set(never)];
      check(`${def.id}: picks out exactly the ${expected.length} cache folders it did on the real machine`,
        JSON.stringify(found.sort()) === JSON.stringify(expected.sort()) && expected.length > 0,
        found.length === expected.length ? '' : `found ${found.length}`);
      check(`${def.id}: and never a folder of a site's or the app's own data`, never.length === 0, never.join(', '));
      const names = def.roots.flatMap((r) => [...(r.inProfile || []), ...(r.atRoot || [])]).map((n) => n.toLowerCase());
      const unseen = names.filter((n) => !seen.has(n));
      check(`${def.id}: every folder on its list was seen there`, unseen.length === 0, unseen.join(', '));
    }

    // A small tree of its own for the rest: Chrome with a profile, and Discord.
    const L = path.join(base, 'fake', 'Local');
    const R = path.join(base, 'fake', 'Roaming');
    const env = { ...process.env, LOCALAPPDATA: L, APPDATA: R };
    const chrome = path.join(L, 'Google', 'Chrome', 'User Data');
    await make(path.join(chrome, 'Default', 'Cache', 'Cache_Data', 'f_000001'), 40000);
    await make(path.join(chrome, 'Default', 'Code Cache', 'js', 'index'), 30000);
    await make(path.join(chrome, 'Default', 'GPUCache', 'data_0'), 20000);
    await make(path.join(chrome, 'Default', 'IndexedDB', 'https_mail.example_0.indexeddb.leveldb', '000003.log'), 50000);
    await make(path.join(chrome, 'Default', 'Service Worker', 'CacheStorage', 'blob'), 60000);
    await make(path.join(chrome, 'Default', 'Local Storage', 'leveldb', '000005.log'), 5000);
    await make(path.join(chrome, 'GrShaderCache', 'data_1'), 10000);
    await make(path.join(chrome, 'GPUPersistentCache', 'DawnGraphiteCache', 'data_0'), 7000);
    await make(path.join(chrome, 'Local State'), 900);
    const discord = path.join(R, 'discord');
    await make(path.join(discord, 'Cache', 'Cache_Data', 'f_1'), 8000);
    await make(path.join(discord, 'Local Storage', 'leveldb', 'LOG.old'), 3000);

    console.log('\nThe scan:');
    {
      const r = await scan(path.join(base, 'fake'), { appCacheEnv: env });
      const group = (c) => r.cleanup.groups.find((g) => g.category === c);
      const chromeFiles = (group('app.chrome') || { files: [] }).files.map((f) => path.relative(chrome, f.path)).sort();
      check('Chrome\u2019s cache folders become Chrome\u2019s own group, and nothing else of Chrome\u2019s does',
        JSON.stringify(chromeFiles) === JSON.stringify(['Default\\Cache\\Cache_Data\\f_000001', 'Default\\Code Cache\\js\\index', 'Default\\GPUCache\\data_0', 'GrShaderCache\\data_1'].sort()),
        chromeFiles.join(', '));
      const elsewhere = r.cleanup.groups.filter((g) => !g.category.startsWith('app.')).flatMap((g) => g.files.map((f) => f.path));
      check('the rest of Chrome\u2019s folder is left alone -- not "GPU cache", not "log", not anything',
        !elsewhere.some((p) => p.startsWith(chrome)), elsewhere.filter((p) => p.startsWith(chrome)).map((p) => path.relative(chrome, p)).join(', '));
      check('a cache under Roaming is offered for a known app', (group('app.discord') || { count: 0 }).count === 1);
      check('and its other Roaming data is not', !r.cleanup.groups.some((g) => g.files.some((f) => f.path.includes('Local Storage'))));
      const off = await scan(path.join(base, 'fake'), { appCacheEnv: {} });
      check('with no AppData to match, the folders fall back to the ordinary rules', !off.cleanup.groups.some((g) => g.category.startsWith('app.')));
    }

    console.log('\nWhat the screen gets:');
    for (const [label, running, chromeOpen] of [
      ['Chrome open', new Set(['chrome.exe', 'explorer.exe']), true],
      ['Chrome closed', new Set(['explorer.exe']), false],
      ['no process list', null, null],
    ]) {
      const collected = await analyzers.collect(
        'scan',
        { root: path.join(base, 'fake'), options: { appCacheEnv: env }, deps: { runningProcessNames: async () => running } },
        { strict: true }
      );
      const g = collected.summary.cleanup.groups.find((x) => x.category === 'app.chrome');
      const rows = collected.candidates.filter((c) => c.category === 'cleanup.app.chrome');
      let valid = true;
      for (const c of rows) {
        try {
          validateCandidate(c);
        } catch {
          valid = false;
        }
      }
      if (chromeOpen === true) {
        check(`${label}: its group is kept, marked open, and out of the safe total`,
          g.verdict === 'keep' && g.app.open === true && collected.summary.cleanup.safeBytes === collected.summary.cleanup.groups.filter((x) => x.verdict === 'safe').reduce((n, x) => n + x.bytes, 0));
        check(`${label}: every row offers nothing, says why first, and is never for the 2am run`,
          valid && rows.length === 4 && rows.every((c) => c.verdict === 'keep' && c.actions.length === 0 && !c.unattendedEligible &&
            /is open/.test(c.evidence[0].en)));
        const discordRow = collected.candidates.find((c) => c.category === 'cleanup.app.discord');
        check(`${label}: Discord, closed, is still offered`, discordRow && discordRow.verdict === 'safe' && discordRow.actions[0] === 'recycle');
      } else if (chromeOpen === false) {
        check(`${label}: safe, on strong evidence, and says it was not running`,
          valid && g.verdict === 'safe' && rows.every((c) => c.verdict === 'safe' && c.confidence === 'strong' && c.actions[0] === 'recycle' &&
            c.evidence.some((e) => /not running/.test(e.en))));
        check(`${label}: and eligible for the unattended run, which checks again for itself`, rows.every((c) => c.unattendedEligible === true));
      } else {
        check(`${label}: nothing of any known app is offered`,
          valid && collected.summary.cleanup.groups.filter((x) => x.category.startsWith('app.')).every((x) => x.verdict === 'keep' && x.app.open === null) &&
            rows.every((c) => c.actions.length === 0 && /Could not tell/.test(c.evidence[0].en)));
      }
    }

    console.log('\nThe unattended run:');
    {
      const old = Date.now() - 400 * 86400000;
      const cleanup = {
        groups: [
          { category: 'app.chrome', verdict: 'safe', count: 1, files: [{ path: path.join(chrome, 'Default', 'Cache', 'x'), size: 100, mtimeMs: old, atimeMs: old }] },
          { category: 'app.discord', verdict: 'safe', count: 1, files: [{ path: path.join(discord, 'Cache', 'y'), size: 50, mtimeMs: old, atimeMs: old }] },
        ],
      };
      const settings = { categories: ['app.chrome', 'app.discord'], minAgeDays: 1, whitelist: [], maxItemsPerRun: 100 };
      const open = selectFiles(cleanup, settings, Date.now(), new Set(['chrome']));
      check('an open app\u2019s cache is left, and counted as left', open.files.length === 1 && open.files[0].category === 'app.discord' && open.skipped.appOpen === 1);
      const blind = selectFiles(cleanup, settings, Date.now(), null);
      check('not knowing what is running leaves every app\u2019s cache', blind.files.length === 0 && blind.skipped.appOpen === 2);
      const shut = selectFiles(cleanup, settings, Date.now(), new Set());
      check('with both closed, both are taken', shut.files.length === 2);
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'lib', 'autoclean.js'), 'utf8');
      check('and it asks which apps are open after the scan, right before it chooses', /openApps\(await deps\.runningProcessNames\(\)\)[\s\S]{0,120}selectFiles\(result\.cleanup, auto, now, open\)/.test(src));
    }

    console.log('\nRight before anything moves (the Recycle Bin’s plan):');
    {
      const recycle = require('../src/main/actions/recycle');
      const outside = path.join(base, 'elsewhere.bin');
      await make(outside, 500);
      const items = [
        path.join(chrome, 'Default', 'Cache', 'Cache_Data', 'f_000001'),
        path.join(chrome, 'Default', 'IndexedDB', 'https_mail.example_0.indexeddb.leveldb', '000003.log'),
        path.join(discord, 'Cache', 'Cache_Data', 'f_1'),
        outside,
      ];
      let asked = 0;
      const plan = (running, list = items) =>
        recycle.plan(list, {}, {
          deps: {
            appCacheEnv: env,
            runningProcessNames: async () => {
              asked += 1;
              return running;
            },
          },
        });
      const opened = await plan(new Set(['chrome.exe']));
      const planned = opened.plan.map((i) => i.path);
      check('Chrome opened since the scan: its files are refused as in use, with its name',
        opened.inUse.length === 2 && opened.inUse.every((f) => f.code === 'EBUSY' && f.error === 'Google Chrome is open') &&
          !planned.some((p) => p.startsWith(chrome)), opened.inUse.map((f) => f.error).join('; '));
      check('and the rest still go, with the total and the estimate for what is left',
        planned.length === 2 && planned.includes(outside) && opened.totalBytes === 8000 + 500 && recycle.describe(opened).inUse === 2);
      const blind = await plan(null);
      check('no process list: every known app’s file is refused, and not called "in use"',
        blind.plan.length === 1 && blind.plan[0].path === outside && blind.inUse.length === 0 &&
          blind.failed.filter((f) => /Could not tell/.test(f.error)).length === 3 && recycle.describe(blind).refused === 3);
      asked = 0;
      const plain = await plan(new Set(['chrome.exe']), [outside]);
      check('with nothing in a known app’s folder the process list is not read at all', asked === 0 && plain.plan.length === 1);
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'lib', 'autoclean.js'), 'utf8');
      check('the unattended run hands its own process list to that check', /runningProcessNames: deps\.runningProcessNames/.test(src));
    }

    console.log('\nThe lists that must agree:');
    {
      const ids = appCaches.DEFINITIONS.map((d) => `cleanup.app.${d.id}`);
      check('the whitelist names every known app, by hand, and no other', ids.every((c) => ALLOWED.includes(c)) &&
        ALLOWED.filter((c) => c.startsWith('cleanup.app.')).length === ids.length && ids.every((c) => isAllowedUnattended(c)));
      check('the settings switch them on by default', appCaches.DEFINITIONS.every((d) => DEFAULT_CATEGORIES.includes(`app.${d.id}`)));
      const automatic = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'automatic.js'), 'utf8');
      check('the Automatic tab has a label for each', appCaches.DEFINITIONS.every((d) => automatic.includes(`'app.${d.id}': ['category.app.${d.id}'`)));
      require('../src/i18n/vi');
      const i18n = require('../src/i18n');
      const vi = new Set(i18n.keysFor('vi'));
      check('and Vietnamese has a name and a hint for each',
        appCaches.DEFINITIONS.every((d) => vi.has(`category.app.${d.id}`) && vi.has(`category.app.${d.id}.hint`)));
    }

    console.log('\nWhich programs are running:');
    {
      const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32').toLowerCase();
      check('tasklist is run from System32, by its full path', processes.tasklist().toLowerCase() === path.join(system32, 'tasklist.exe'));
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'lib', 'autoclean.js'), 'utf8');
      check('and the unattended run no longer asks the PATH for it', !/'tasklist\.exe'/.test(src));
      if (process.platform === 'win32') {
        const names = await processes.runningProcessNames();
        check('it lists this process among the running ones', names && names.has(path.basename(process.execPath).toLowerCase()), names ? `${names.size} names` : 'none');
      }
    }
  } finally {
    await fsp.rm(base, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
