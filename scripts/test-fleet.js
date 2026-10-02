#!/usr/bin/env node
'use strict';

// The machine report and the console (H3), under plain Node.
//   node scripts/test-fleet.js
//
// What it proves, in the order the spec asks:
//   1. the report names no file and no folder -- written from inputs full of
//      them, then searched for every one;
//   2. its numbers are the Trends tab's, not a second calculation, and a
//      forecast that refuses itself travels as its reason;
//   3. it is ASCII, versioned, and what `cleandrive report --json` prints is
//      the same bytes;
//   4. a file on the share is untrusted: hostile ones are rebuilt or refused;
//   5. it reaches a real share -- this machine's own admin share through the
//      SMB client and server (\\localhost\D$), the closest thing to a second
//      machine there is here -- whole, never half, and nothing is created
//      where no folder was;
//   6. the console's judgement, including the one thing it exists for that
//      the seal cannot do: H4's two THE LIMIT attacks, run for real on a real
//      sealed journal, are invisible on the machine and caught by the console;
//   7. the CSV defuses formulas.
//
// Fixtures: a temp folder for journals, and D:\cleandrive-fleet-test-* for the
// share (os.tmpdir() is in AppData on C:, and a share test wants a plain
// folder). Both removed on exit; nothing outside them is touched.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const report = require('../src/main/fleet/report');
const collect = require('../src/main/fleet/collect');
const share = require('../src/main/fleet/share');
const model = require('../src/main/fleet/console-model');
const { ConsoleService } = require('../src/main/fleet/console');
const { ConsoleMemory } = require('../src/main/fleet/console-state');
const consoleArgs = require('../src/main/fleet/console-args');
const { History } = require('../src/main/lib/history');
const historyLib = require('../src/main/lib/history');
const { ActionJournal } = require('../src/main/journal/journal');
const { Sealer, verifyJournal, hashLine, canonical } = require('../src/main/journal/seal');
const { SealKey } = require('../src/main/journal/seal-key');
const { main: cliMain } = require('../src/main/cli');
const i18n = require('../src/i18n');

const DAY = 24 * 60 * 60 * 1000;

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const isAscii = (text) => /^[\x00-\x7e]*$/.test(text);

/* ---- fixtures ---------------------------------------------------------------- */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-fleet-'));
const SHARE_DIR = path.join('D:', path.sep, `cleandrive-fleet-test-${crypto.randomBytes(3).toString('hex')}`);

/** Remove a fixture this harness made, refusing anything that is a link to elsewhere. */
function removeFixture(dir) {
  try {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink()) throw new Error(`${dir} is a link; not following it`);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`  could not remove ${dir}: ${err.message}`);
  }
}
process.on('exit', () => {
  removeFixture(TMP);
  removeFixture(SHARE_DIR);
});

/** XOR behind a tag, as in test-journal-seal.js: a stand-in for DPAPI. */
function fakeDpapi() {
  const tag = Buffer.from('FAKEDPAPI:');
  const xor = (bytes) => Buffer.from(Uint8Array.from(bytes, (b) => b ^ 0x5a));
  return {
    SCOPE: 'CurrentUser',
    async protect(data) {
      return Buffer.concat([tag, xor(data)]);
    },
    async unprotect(blob) {
      return xor(blob.subarray(tag.length));
    },
  };
}

function sealedJournal(dir) {
  const keyFile = path.join(TMP, `${path.basename(dir)}-key.json`);
  const key = new SealKey(keyFile, { dpapi: fakeDpapi() });
  const journal = new ActionJournal(dir, { sealer: new Sealer({ key, lockFile: path.join(dir, '.seal.lock') }) });
  return { journal, key, keyFile };
}

async function session(journal, n, tag) {
  const s = await journal.begin('recycle', { count: n, bytes: n * 10 }, { source: 'scheduled' });
  for (let i = 0; i < n; i++) await journal.record(s, { path: `C:\\Users\\Lan Nguyễn\\${tag}\\${i}.bin`, size: 10, trashedAt: Date.now() });
  await journal.end(s, { done: n, movedBytes: n * 10 });
  return s;
}

const monthFile = (dir) => path.join(dir, fs.readdirSync(dir).find((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)));
function editLines(file, fn) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const trailing = lines[lines.length - 1] === '' ? lines.pop() : null;
  fn(lines);
  fs.writeFileSync(file, lines.join('\n') + (trailing === '' ? '\n' : ''), 'utf8');
}

/** A history with `days` daily points on C: growing `perDay` bytes. */
function historyWith({ days, perDay = 1e9, total = 500e9, start = 300e9, now = Date.now(), extraRoots = {} }) {
  const h = new History(path.join(TMP, `history-${crypto.randomBytes(3).toString('hex')}.json`));
  for (let i = days - 1; i >= 0; i--) {
    const used = start + (days - 1 - i) * perDay;
    h.snapshots.push({
      at: now - i * DAY,
      source: 'daily',
      volumes: {
        'c:\\': { totalBytes: total, usedBytes: used, freeBytes: total - used, usedPercent: (used / total) * 100 },
        ...extraRoots,
      },
      scan: null,
    });
  }
  return h;
}

/** A run log with one entry full of things that must not leave the machine. */
function runLogWith(runs) {
  return { runs, async load() {} };
}

const PERSONAL = {
  user: 'Lan Nguyễn',
  profileName: 'Ảnh của Lan',
  root: 'C:\\Users\\Lan Nguyễn\\Downloads',
  zone: 'E:\\Riêng tư\\Kept',
  topFolder: 'Lan Nguyễn',
  app: 'BíMật.exe',
  osError: 'C:\\Users\\Lan Nguyễn\\AppData task path',
};

function personalInputs({ topFolders = false, now = Date.now() } = {}) {
  const history = historyWith({ days: 20, now });
  history.snapshots[history.snapshots.length - 1].scan = {
    root: PERSONAL.root,
    totalBytes: 1e9,
    totalFiles: 1234,
    byCategory: { temp: 5e8, log: 1e8 },
    topFolders: [{ name: PERSONAL.topFolder, size: 7e8 }, { name: 'Projects', size: 2e8 }],
  };
  const runs = [
    {
      runId: 'run-x',
      startedAt: now - DAY,
      finishedAt: now - DAY + 5000,
      profileId: 'main',
      profileName: PERSONAL.profileName,
      roots: [PERSONAL.root],
      dryRun: false,
      outcome: 'skipped',
      reason: { i18n: 'run.zoneAway', en: 'The drive files are moved to is not available: {zone}', params: { zone: PERSONAL.zone } },
      selected: { files: 3, bytes: 300 },
      trashed: { files: 0, bytes: 0, failed: 0, freedBytes: 0 },
    },
    {
      runId: 'run-y',
      startedAt: now - 2 * DAY,
      profileId: 'pabcdef',
      profileName: 'x',
      outcome: 'skipped',
      reason: { i18n: 'run.appsRunning', en: 'Skipped because these are running: {apps}', params: { apps: PERSONAL.app } },
      trashed: { files: 0, bytes: 0 },
    },
  ];
  return {
    host: 'PC-KETOAN-01',
    now,
    app: { version: '0.5.0', channel: 'stable' },
    volumes: history.volumeRoots().map((root) => {
      const s = history.volumeSeries(root);
      return { root, latest: s[s.length - 1], growth: historyLib.growth(s), prediction: historyLib.predictFull(s) };
    }),
    lastScan: { ...history.snapshots[history.snapshots.length - 1].scan, at: now },
    topFolders,
    tasks: {
      supported: true,
      profiles: [
        { profileId: 'main', name: PERSONAL.profileName, wanted: true, dryRun: false, action: 'recycle', installed: true, verified: true, problems: [`registered at \\CleanDrive\\${PERSONAL.user}`], os: { lastRunAt: now - DAY, nextRunAt: now + DAY, lastResult: 1, state: 'ready', missedRuns: 0 } },
        { profileId: 'pabcdef', name: 'x', wanted: true, dryRun: true, action: 'quarantine', installed: false, verified: false, problems: [], os: { lastRunAt: null, lastResult: null, error: PERSONAL.osError } },
      ],
      sampler: { installed: true, verified: true, os: { lastRunAt: now - DAY, lastResult: 0 } },
    },
    runs,
    journal: null,
    managed: { status: 'present', applied: ['MachineReport'], notApplied: [], refused: [], report: { folder: '\\\\srv\\r', topFolders } },
  };
}

(async () => {
  /* ==================================================================== 1 */
  console.log('\nfleet: the report names no file and no folder\n');
  {
    const built = report.build(personalInputs());
    const text = report.serialize(built);
    const plain = JSON.stringify(built);
    const leaks = Object.entries(PERSONAL).filter(([, v]) => plain.includes(v) || text.includes(v)).map(([k]) => k);
    check('nothing personal from the inputs reaches it: user, profile name, folder, quarantine folder, program, top folder, OS error', leaks.length === 0, leaks.join(', '));
    check('the profiles go by id only', built.tasks.profiles.map((p) => p.id).join() === 'main,pabcdef' && built.tasks.profiles.every((p) => !('name' in p) && !('roots' in p)));
    check('the last scan says it was one folder on C:, never which', built.lastScan.rootKind === 'folder' && built.lastScan.drive === 'C:' && !('root' in built.lastScan));
    check('its categories travel, its folder names do not', built.lastScan.categories.temp === 5e8 && built.lastScan.topFolders === null);
    const reason = built.tasks.profiles[0].lastRun.reason;
    check('a run reason keeps its key and English, and its path parameter is blanked', reason.i18n === 'run.zoneAway' && reason.params.zone === '…');
    check('and so are the names of programs that were running', built.tasks.profiles[1].lastRun.reason.params.apps === '…');
    check('Windows\' error text about a task is not sent, only that there was one', built.tasks.profiles[1].os.unreadable === true && !plain.includes('AppData'));
    const withTop = report.build(personalInputs({ topFolders: true }));
    check('with the policy box ticked, the largest folders of the last scan are named', withTop.lastScan.topFolders.length === 2 && withTop.lastScan.topFolders[0].name === PERSONAL.topFolder);
    const unc = report.build({ ...personalInputs(), volumes: [{ root: '\\\\nas\\team\\', latest: { at: Date.now(), totalBytes: 1, freeBytes: 1, usedBytes: 0, usedPercent: 0 } }] });
    check('a network volume is left out: its root names a server', unc.volumes.length === 0);
    const msg = report.outgoingMessage({ i18n: 'trends.reason.tooLittle', en: '{n} over {days}', params: { n: 4, days: '2.5' } });
    check('numeric parameters are kept, numeric strings too', msg.params.n === 4 && msg.params.days === '2.5');
    check('a plain-string reason from an old run log is dropped, not sent', report.outgoingMessage('The folder C:\\Users\\x was not found') === null);
  }

  /* ==================================================================== 2 */
  console.log('\nfleet: the numbers are the Trends tab\'s\n');
  {
    const now = Date.now();
    const history = historyWith({ days: 20, now, extraRoots: {} });
    // A drive measured once, nine days ago, is a drive that has gone.
    history.snapshots[0].volumes['e:\\'] = { totalBytes: 1e12, usedBytes: 1e11, freeBytes: 9e11, usedPercent: 10 };
    const inputs = await collect.gather({
      history,
      runLog: runLogWith([]),
      settings: { managed: null },
      app: { version: '0.5.0', channel: 'dev' },
      host: 'PC-1',
      now,
      taskStatus: async () => ({ supported: true, profiles: [], sampler: null }),
      journalReport: async () => null,
    });
    const series = history.volumeSeries('c:\\');
    const own = historyLib.predictFull(series);
    const built = report.build(inputs);
    const c = built.volumes.find((v) => v.root === 'C:\\');
    check('"when it fills" is history.js\'s own answer, to the day', c && c.fullIn.ok && Math.abs(c.fullIn.days - own.days) < 1e-9, c && `${c.fullIn.days} vs ${own.days}`);
    check('and the growth is its own slope', Math.abs(c.growth.bytesPerDay - historyLib.growth(series).bytesPerDay) < 1e-6);
    check('a drive last measured more than a week ago is left out', !built.volumes.some((v) => v.root === 'E:\\'), built.volumes.map((v) => v.root).join());
    const young = report.build(await collect.gather({
      history: historyWith({ days: 3, now }),
      runLog: runLogWith([]),
      settings: { managed: null },
      app: { version: '0.5.0', channel: 'dev' },
      host: 'PC-2',
      now,
      taskStatus: async () => null,
      journalReport: async () => null,
    }));
    const yc = young.volumes[0];
    check('three days of data: no forecast, and the reason the Trends tab gives', yc.fullIn.ok === false && yc.fullIn.reason.i18n === 'trends.reason.tooLittle' && yc.fullIn.reason.params.n === 3,
      JSON.stringify(yc.fullIn));
    i18n.setLanguage('vi');
    require('../src/i18n/vi');
    const worded = i18n.render(report.parse(report.serialize(young)).report.volumes[0].fullIn.reason);
    i18n.setLanguage('en');
    check('which the console words in its own language after the round trip', /3/.test(worded) && worded !== yc.fullIn.reason.en, worded);
    const broken = await collect.gather({
      history: historyWith({ days: 2, now }),
      runLog: runLogWith([]),
      settings: { managed: null },
      app: { version: '0.5.0', channel: 'dev' },
      now,
      taskStatus: async () => {
        throw new Error('PowerShell refused');
      },
      journalReport: async () => null,
    });
    check('a part that cannot be read is left out, not the whole report', broken.tasks === null && broken.volumes.length === 1);
  }

  /* ==================================================================== 3 */
  console.log('\nfleet: ASCII, versioned, and the same bytes on the command line\n');
  {
    const built = report.build(personalInputs({ topFolders: true }));
    const text = report.serialize(built);
    check('the file is ASCII only, Vietnamese escaped', isAscii(text) && text.includes('\\u1ec5'), text.length);
    check('it says what it is', JSON.parse(text).schema === 'cleandrive.machine-report/1');
    const back = report.parse(text, { fileName: 'PC-KETOAN-01.cleandrive.json' });
    check('and reads back to the same machine, drives, tasks and folder names', back.ok && back.nameMatches && back.report.host === 'PC-KETOAN-01' &&
      back.report.volumes.length === 1 && back.report.tasks.profiles.length === 2 && back.report.lastScan.topFolders[0].name === PERSONAL.topFolder);

    const sink = () => ({ text: '', write(s, cb) { this.text += s; if (cb) cb(); return true; } });
    const stdout = sink();
    const code = await cliMain(['report', '--json'], {
      context: {
        can: () => true,
        reasonFor: () => null,
        services: () => ({ settings: { load: async () => ({ managed: null }) } }),
        buildReport: async () => built,
        now: () => Date.now(),
      },
      stdout,
      stderr: sink(),
    });
    check('`cleandrive report --json` prints the file byte for byte', code === 0 && stdout.text === text, `${stdout.text.length} vs ${text.length}`);
    const stdoutGated = sink();
    const gated = await cliMain(['report', '--json'], { context: { can: () => false, reasonFor: () => 'tier', services: () => ({}), now: () => Date.now() }, stdout: stdoutGated, stderr: sink() });
    check('and it is biz.cli like every command but the journal, restore and policy (3 without it)', gated === 3);
  }

  /* ==================================================================== 4 */
  console.log('\nfleet: a file on the share is untrusted\n');
  {
    const good = report.serialize(report.build(personalInputs()));
    check('not JSON: refused', report.parse('{oops').why === 'notJson');
    check('another program\'s JSON: refused', report.parse('{"a":1}').why === 'notReport');
    check('a newer report: refused, and said to be newer', report.parse(good.replace('machine-report/1', 'machine-report/2')).why === 'newerSchema');
    check('larger than any report: refused before parsing', report.parse(' '.repeat(report.MAX_BYTES + 1)).why === 'tooLarge');
    check('no host or no date: refused', report.parse(JSON.stringify({ schema: report.SCHEMA, generatedAt: new Date().toISOString() })).why === 'notReport');
    const hostile = JSON.parse(good);
    hostile.volumes = Array.from({ length: 500 }, (_, i) => ({ ...hostile.volumes[0], root: `${String.fromCharCode(65 + (i % 26))}:\\` }));
    hostile.volumes.push({ root: '..\\..\\x', totalBytes: 1, usedPercent: 1 }, { root: 'C:\\', totalBytes: 'lots', usedPercent: 900 });
    hostile.lastScan.categories = { __proto__x: 1, 'temp': 5, '<img src=x>': 9, log: -3 };
    hostile.tasks.profiles[0].lastRun.reason = { i18n: 'run.zoneAway"><b>', en: 'x' };
    hostile.extra = { evil: true };
    hostile.app.version = 'x'.repeat(5000);
    const parsed = report.parse(JSON.stringify(hostile));
    check('lists are bounded, rubbish entries dropped', parsed.ok && parsed.report.volumes.length === report.LIMITS.volumes && parsed.report.volumes.every((v) => /^[A-Z]:\\$/.test(v.root) && v.usedPercent <= 100));
    check('only category names a report can have survive, with numbers that make sense', JSON.stringify(Object.keys(parsed.report.lastScan.categories)) === '["temp"]');
    check('a message with a key that is not a key is dropped', parsed.report.tasks.profiles[0].lastRun.reason === null);
    check('fields it does not know are not carried, long text is cut', !('extra' in parsed.report) && parsed.report.app.version.length === 40);
    check('a file named for another machine is noticed', report.parse(good, { fileName: 'OTHER.cleandrive.json' }).nameMatches === false);
    const crafted = report.fileNameFor('..\\..\\Windows\\x');
    check('a host name cannot become a path in a file name', !/[\\/:]/.test(crafted) && !crafted.startsWith('.') && crafted.endsWith('.cleandrive.json') &&
      report.fileNameFor('') === 'unnamed.cleandrive.json' && report.fileNameFor('PC-KETOAN-01') === 'PC-KETOAN-01.cleandrive.json', crafted);
  }

  /* ==================================================================== 5 */
  console.log('\nfleet: a real share\n');
  {
    fs.mkdirSync(SHARE_DIR);
    const loopback = `\\\\localhost\\D$\\${path.basename(SHARE_DIR)}`;
    let viaSmb = false;
    try {
      await fsp.access(loopback);
      viaSmb = true;
    } catch {
      console.log(`  SKIP  ${loopback} is not reachable here; the share checks run on the local path instead`);
    }
    const target = viaSmb ? loopback : SHARE_DIR;
    const body = report.serialize(report.build(personalInputs()));
    const first = await share.writeReport(target, 'PC-KETOAN-01', body);
    check(`written through ${viaSmb ? 'the SMB client and server (\\\\localhost\\D$)' : 'the local path'}, named after the machine`,
      first.ok && path.basename(first.file) === 'PC-KETOAN-01.cleandrive.json' && fs.readFileSync(path.join(SHARE_DIR, 'PC-KETOAN-01.cleandrive.json'), 'utf8') === body, `${first.ms} ms ${first.error || ''}`);
    const second = await share.writeReport(target, 'PC-KETOAN-01', body.replace('0.5.0', '0.5.1'));
    check('written again: replaced whole, no temporary file left beside it',
      second.ok && fs.readdirSync(SHARE_DIR).join() === 'PC-KETOAN-01.cleandrive.json' && fs.readFileSync(path.join(SHARE_DIR, 'PC-KETOAN-01.cleandrive.json'), 'utf8').includes('0.5.1'));
    const missing = await share.writeReport(path.join(target, 'no-such-folder'), 'PC-1', body);
    check('a folder that is not there: refused, and not created', !missing.ok && missing.code === 'ENOENT' && !fs.existsSync(path.join(SHARE_DIR, 'no-such-folder')), missing.code);
    fs.writeFileSync(path.join(SHARE_DIR, 'a-file'), 'x');
    const notDir = await share.writeReport(path.join(target, 'a-file'), 'PC-1', body);
    check('a file where the folder should be: refused', !notDir.ok && notDir.code === 'ENOTDIR');

    // The console reading while a machine writes: never half a file.
    let torn = 0;
    let reads = 0;
    const writer = (async () => {
      for (let i = 0; i < 40; i++) await share.writeReport(target, 'PC-BUSY', body.replace('0.5.0', `0.5.${i}`));
    })();
    const reader = (async () => {
      for (let i = 0; i < 40; i++) {
        const listing = await share.readReports(target);
        for (const f of listing.files.filter((x) => x.name === 'PC-BUSY.cleandrive.json')) {
          reads += 1;
          if (f.error === 'EBUSY' || f.error === 'EPERM') continue;
          if (!report.parse(f.body || '').ok) torn += 1;
        }
      }
    })();
    await Promise.all([writer, reader]);
    check('40 writes while the console reads 40 times: every report it read was whole', torn === 0 && reads > 0, `${reads} read, ${torn} torn`);

    fs.writeFileSync(path.join(SHARE_DIR, 'notes.txt'), 'not a report');
    fs.mkdirSync(path.join(SHARE_DIR, 'sub.cleandrive.json'));
    fs.writeFileSync(path.join(SHARE_DIR, 'HUGE.cleandrive.json'), ' '.repeat(report.MAX_BYTES + 10));
    const listing = await share.readReports(target);
    const names = listing.files.map((f) => f.name).sort();
    check('the console reads only *.cleandrive.json at the top, files only', listing.ok && names.join() === 'HUGE.cleandrive.json,PC-BUSY.cleandrive.json,PC-KETOAN-01.cleandrive.json', names.join());
    check('and does not read a file too large to be a report', listing.files.find((f) => f.name === 'HUGE.cleandrive.json').error === 'tooLarge');
    const gone = await share.readReports(path.join(SHARE_DIR, 'nope'));
    check('a share that is not there is an answer with a code, not a throw', !gone.ok && gone.code === 'ENOENT');
  }

  /* ==================================================================== 6 */
  console.log('\nfleet: the console\'s judgement\n');
  const now = Date.now();
  const fileOf = (built, name = report.fileNameFor(built.host)) => ({ name, body: report.serialize(built) });
  const machine = (host, over = {}) => {
    const b = report.build({ ...personalInputs({ now }), host });
    return { ...b, ...over };
  };
  {
    const ok = machine('PC-OK', {
      tasks: { supported: true, profiles: [{ id: 'main', managed: false, enabled: true, reportOnly: false, installed: true, verified: true, os: { lastRunAt: new Date(now - DAY).toISOString(), lastResult: 0 }, lastRun: null }], sampler: null },
    });
    const stale = machine('PC-OLD', { generatedAt: new Date(now - 3 * DAY).toISOString() });
    const full = machine('PC-FULL');
    full.volumes[0].usedPercent = 97;
    full.volumes[0].fullIn = { ok: false, reason: null };
    const soon = machine('PC-SOON');
    soon.volumes[0].fullIn = { ok: true, days: 12, at: new Date(now + 12 * DAY).toISOString() };
    const files = [fileOf(ok), fileOf(stale), fileOf(full), fileOf(soon), fileOf(machine('PC-NAME'), 'WRONG.cleandrive.json'), { name: 'junk.cleandrive.json', body: '{' }, fileOf(machine('PC-OK'), 'pc-ok-copy.cleandrive.json')];
    const built = model.build(files, model.emptySeen(), '\\\\srv\\r', now);
    const by = Object.fromEntries(built.machines.map((m) => [m.host, m]));
    const codes = (h) => by[h].attention.map((a) => a.code);
    check('a machine with nothing wrong needs no look', codes('PC-OK').length === 0, codes('PC-OK').join());
    check('silent for three days: marked, with the days', codes('PC-OLD').includes('stale') && by['PC-OLD'].attention.find((a) => a.code === 'stale').days === 3);
    check('over 95% full: marked', codes('PC-FULL').includes('nearlyFull'));
    check('filling within 30 days on its own trend: marked', codes('PC-SOON').includes('fillsSoon'));
    check('a task Windows ran and recorded as failed (0x1), and one switched on but not registered: both marked',
      codes('PC-SOON').includes('taskFailed') && codes('PC-SOON').includes('taskMissing'), codes('PC-SOON').join());
    check('a file not named after its machine: marked', codes('PC-NAME').includes('nameMismatch'));
    check('not a report, and a second file for one machine: listed, not drawn',
      built.unreadable.some((u) => u.name === 'junk.cleandrive.json' && u.why === 'notJson') && built.unreadable.some((u) => u.name === 'pc-ok-copy.cleandrive.json' && u.why === 'duplicate') && built.machines.length === 5);
    check('the machines that need a look come first', built.machines[built.machines.length - 1].host === 'PC-OK');
    check('the primary drive is the one that fills first', by['PC-SOON'].primary.root === 'C:\\');
  }

  {
    // H4's THE LIMIT, for real: a sealed journal, attacked the two ways the
    // seal cannot see, and the console reading reports before and after.
    const dir = path.join(TMP, 'journal');
    const { journal, key, keyFile } = sealedJournal(dir);
    for (const tag of ['a', 'b', 'c']) await session(journal, 2, tag);
    const verifyNow = async () => verifyJournal(await new ActionJournal(dir).readRaw(), await key.publicKeys());
    const reportNow = async (at) => report.build({ ...personalInputs({ now: at }), host: 'PC-AUDIT', journal: await verifyNow() });

    const memory = new ConsoleMemory(path.join(TMP, 'console-seen.json'));
    const read = async (built, at) => {
      const seen = await memory.load();
      const out = model.build([fileOf(built)], seen, '\\\\srv\\r', at);
      await memory.save(out.seen);
      return out.machines[0];
    };
    // The inputs carry two broken tasks on purpose; only the journal's words are looked at here.
    const journalWords = (m) => m.attention.filter((a) => /^seal|^journal/.test(a.code));
    const day1 = await read(await reportNow(now), now);
    check('a sealed journal: the report carries its newest seal, the console sees it first',
      day1.journal.seal.n === 3 && /^[0-9a-f]{64}$/.test(day1.journal.seal.hash) && day1.seal.state === 'new' && journalWords(day1).length === 0, JSON.stringify(day1.seal));
    await session(journal, 1, 'd');
    const day2 = await read(await reportNow(now + 1000), now + 1000);
    check('a new session sealed: the number advances, nothing to say', day2.seal.state === 'advanced' && day2.journal.seal.n === 4 && journalWords(day2).length === 0);

    // Attack 1: the newest session removed whole.
    const lines = fs.readFileSync(monthFile(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const newest = lines.filter((l) => l.op === 'seal').sort((a, b) => b.n - a.n)[0].session;
    editLines(monthFile(dir), (ls) => {
      for (let i = ls.length - 1; i >= 0; i--) if (JSON.parse(ls[i]).session === newest) ls.splice(i, 1);
    });
    const onMachine1 = await verifyNow();
    check('THE LIMIT on the machine: the newest session removed whole -- its own check finds nothing', onMachine1.counts.altered === 0 && onMachine1.missing.length === 0 && onMachine1.seals.last === 3);
    const day3 = await read(await reportNow(now + 2000), now + 2000);
    check('the console does: the newest seal went back from no. 4 to no. 3', day3.attention.some((a) => a.code === 'sealBack' && a.from === 4 && a.to === 3), JSON.stringify(day3.attention));

    // Attack 2: the newest remaining session rewritten and signed again with
    // the key the machine's own user can open.
    const keyData = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    const der = await fakeDpapi().unprotect(Buffer.from(keyData.keys[0].protected, 'base64'));
    const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const target = JSON.parse(fs.readFileSync(monthFile(dir), 'utf8').trim().split('\n').filter((l) => JSON.parse(l).op === 'seal').pop()).session;
    editLines(monthFile(dir), (ls) => {
      const mine = ls.map((raw, i) => ({ i, l: JSON.parse(raw) })).filter((x) => x.l.session === target);
      let prev = null;
      for (const x of mine) {
        if (x.l.op === 'item' && typeof x.l.from === 'string') x.l.from = x.l.from.replace('Lan', 'Somebody');
        x.l.prev = prev;
        if (x.l.op === 'seal') {
          delete x.l.sig;
          x.l.sig = crypto.sign(null, Buffer.from(canonical(x.l), 'utf8'), privateKey).toString('base64');
        }
        ls[x.i] = JSON.stringify(x.l);
        prev = hashLine(ls[x.i]);
      }
    });
    const onMachine2 = await verifyNow();
    check('THE LIMIT on the machine: rewritten and signed again -- its own check passes', onMachine2.counts.altered === 0 && onMachine2.seals.last === 3);
    const day4 = await read(await reportNow(now + 3000), now + 3000);
    check('the console does not: seal no. 3 is not the one it first saw', day4.attention.some((a) => a.code === 'sealRewritten' && a.n === 3), JSON.stringify(day4.attention));
    const day5 = await read(await reportNow(now + 4000), now + 4000);
    check('and it keeps saying so: reading the rewrite twice does not make it the reference', day5.attention.some((a) => a.code === 'sealRewritten'));

    const forgotten = model.forget(await memory.load(), '\\\\srv\\r', 'PC-AUDIT');
    await memory.save(forgotten);
    const day6 = await read(await reportNow(now + 5000), now + 5000);
    check('"start again from its next report" makes this report the new reference', day6.seal.state === 'new' && !day6.attention.some((a) => /^seal/.test(a.code)));

    const replay = await reportNow(now - DAY);
    const day7 = await read(replay, now + 6000);
    check('an old report put back in place of a newer one: marked', day7.attention.some((a) => a.code === 'older'));

    const wiped = await read({ ...(await reportNow(now + 7000)), journal: { sessions: { sealed: 0, altered: 0, unsealed: 0, legacy: 0, incomplete: 0 }, missing: 0, seal: null } }, now + 7000);
    check('the journal wiped (no seal at all, where there were some): marked as gone back to nothing', wiped.attention.some((a) => a.code === 'sealBack' && a.to === 0));

    const keyed = model.checkSeal({ seals: { 5: 'a'.repeat(64) }, maxN: 5, key: 'b'.repeat(64) }, { n: 6, hash: 'c'.repeat(64), key: 'd'.repeat(64) });
    check('a new key with numbering going on is a note, not an alarm', keyed.state === 'advanced' && keyed.keyChanged === true);
  }

  {
    const svcMemory = new ConsoleMemory(path.join(TMP, 'svc-seen.json'));
    let calls = 0;
    const svc = new ConsoleService({
      share: '\\\\srv\\r',
      allowed: true,
      memory: svcMemory,
      describeResult: (code) => `code ${code}`,
      readReports: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 50));
        return { ok: true, files: [fileOf(machine('PC-SOON'))] };
      },
    });
    check('nothing to export before the first read', svc.csv() === null);
    const [a, b] = await Promise.all([svc.read(), svc.read()]);
    check('two reads while one is under way share it: one trip to the share', calls === 1 && a === b && a.machines.length === 1);
    check('Task Scheduler codes arrive worded, in the console\'s language', a.machines[0].tasks.profiles[0].os.resultText === 'code 1');
    const refused = new ConsoleService({ share: '\\\\srv\\r', allowed: false, memory: svcMemory, readReports: async () => { calls += 1; return { ok: true, files: [] }; } });
    const r = await refused.read();
    check('without biz.console nothing is read at all', r.allowed === false && calls === 1 && !(await refused.forget('PC-SOON')));
    // Phase 6: handed the question, asked each time -- Business bought in the
    // app's window while the console is open counts at its next read.
    let business = false;
    const asking = new ConsoleService({ share: '\\\\srv\\r', allowed: () => business, memory: svcMemory, readReports: async () => ({ ok: true, files: [] }) });
    const no = await asking.read();
    business = true;
    const yes = await asking.read();
    check('a console handed the question asks it again at each read', no.allowed === false && yes.allowed === true && asking.info().allowed === true);
    const dead = new ConsoleService({ share: '\\\\10.255.255.1\\r', allowed: true, memory: svcMemory, readReports: async () => ({ ok: false, code: 'UNKNOWN', error: 'The network path was not found' }) });
    const d = await dead.read();
    check('a share that does not answer is a result the window can word, with the code', d.ok === false && d.code === 'UNKNOWN');
  }

  {
    check('--console must be the first argument, as --cli is', consoleArgs.wanted(['electron', '.', '--console', '\\\\srv\\r'], false) && !consoleArgs.wanted(['electron', '.', 'x', '--console'], false) && consoleArgs.wanted(['CleanDrive.exe', '--console'], true));
    check('the folder after it, and not a switch Chromium adds', consoleArgs.shareOf(['CleanDrive.exe', '--console', '\\\\srv\\r'], true) === '\\\\srv\\r' && consoleArgs.shareOf(['CleanDrive.exe', '--console', '--no-sandbox'], true) === null);
  }

  /* ==================================================================== 7 */
  console.log('\nfleet: the CSV\n');
  {
    const evil = machine('=HYPERLINK("http://x")');
    const plain = machine('PC-CSV');
    plain.volumes[0].growth = { ok: true, bytesPerDay: -5000, r2: 0.9, n: 9, spanDays: 9 };
    const built = model.build([fileOf(evil, 'x.cleandrive.json'), fileOf(plain)], model.emptySeen(), 's', now);
    const csv = model.toCsv(built.machines, (m) => (m && m.en) || '');
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    check('with a byte-order mark and CRLF, for Excel', csv.startsWith('\uFEFF') && !/[^\r]\n/.test(csv));
    check('one header and a line per machine and drive', lines[0] === model.CSV_COLUMNS.join(',') && lines.length === 3, String(lines.length));
    check('a host that is a formula is defused', lines.some((l) => l.startsWith('"\'=HYPERLINK(""http://x"")"')), lines.find((l) => /HYPERLINK/.test(l)));
    check('a negative growth stays a number', lines.some((l) => l.startsWith('PC-CSV,') && l.includes(',-5000,')));
    check('cells: + - @ defused as text, numbers left alone, quotes doubled', model.cell('+1') === "'+1" && model.cell('@x') === "'@x" && model.cell(-3) === '-3' && model.cell('a"b') === '"a""b"');
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
