#!/usr/bin/env node
'use strict';

// The command line (H1), under plain Node.
//
//   node scripts/test-cli.js
//
// Every command runs here against the real modules it uses -- the scan, the
// advisor, the snapshot store, the journal, runAutoClean, the restore handler
// -- with only the Electron-shaped parts of its context replaced: where the
// data lives (a throwaway folder), whether this process is elevated, and the
// licence. What only a real process can show -- that the exit code reaches the
// shell, that a console sees the output, that the batch file waits -- is
// scripts/verify-cli.js.
//
// The fixture is on D:, never under os.tmpdir(): that is inside AppData on
// this machine, and a scan that refuses AppData would make "nothing was
// found" pass for the wrong reason. The harness proves it is not there.
//
// Nothing here can delete a file. The only live run it starts is refused by
// its own gates, and the one restore it asks for is a dry run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { parse, wanted, tokensOf, COMMANDS, UsageError } = require('../src/main/cli/args');
const { asciiJson, Output } = require('../src/main/cli/output');
const { EXIT } = require('../src/main/cli/codes');
const { main } = require('../src/main/cli');
const { shimText } = require('../src/main/cli/shim');
const { exitFor } = require('../src/main/cli/commands/run');
const { changed } = require('../src/main/cli/commands/journal');
const { LABELS } = require('../src/main/cli/commands/system');

const { SettingsStore, coerceSettings } = require('../src/main/lib/settings');
const { TrashLedger } = require('../src/main/lib/ledger');
const { RunLog } = require('../src/main/lib/autoclean');
const { History } = require('../src/main/lib/history');
const { ActionJournal } = require('../src/main/journal/journal');
const { SealKey } = require('../src/main/journal/seal-key');
const { SnapshotStore } = require('../src/main/snapshots/store');
const { CancelToken, skipReason, isProtectedPath } = require('../src/main/lib/util');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-test-cli-data-'));
const FIXTURE = path.join('D:', path.sep, `cleandrive-test-cli-${crypto.randomBytes(4).toString('hex')}`);
process.on('exit', () => {
  for (const dir of [SANDBOX, FIXTURE]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* left behind; it is the harness's own folder */
    }
  }
});

/** A stream that keeps what was written. */
function sink() {
  return {
    text: '',
    write(chunk, cb) {
      this.text += String(chunk);
      if (cb) cb();
      return true;
    },
  };
}

/** The real stores, in the throwaway folder. */
function realServices(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const journal = new ActionJournal(path.join(dir, 'journal'));
  return {
    dir,
    settings: new SettingsStore(path.join(dir, 'settings.json')),
    journal,
    ledger: new TrashLedger(path.join(dir, 'trash-ledger.json'), { journal }),
    runLog: new RunLog(path.join(dir, 'autoclean-log.json')),
    history: new History(path.join(dir, 'history.json')),
    snapshots: new SnapshotStore(path.join(dir, 'snapshots')),
    sealKey: new SealKey(path.join(dir, 'seal-key.json'), { dpapi: { protect: async () => { throw new Error('no DPAPI in this harness'); }, unprotect: async () => { throw new Error('no DPAPI in this harness'); } } }),
    sealer: null,
    runLockPath: path.join(dir, 'autoclean.lock'),
  };
}

const BUSINESS = () => true;
const PRO_ONLY = (f) => !f.startsWith('biz.');
const NOTHING = (f) => f === 'free';

function context({ can = BUSINESS, expired = false, elevated = false, services = null, extra = {} } = {}) {
  return {
    services: () => {
      if (!services) throw new Error('a command touched the services it should never have reached');
      return services;
    },
    can,
    reasonFor: (f) => (can(f) ? null : expired ? 'expired' : f.startsWith('biz.') ? 'needsBusiness' : 'needsPro'),
    licence: {},
    elevated: async () => elevated,
    helperClient: () => {
      throw new Error('the helper was asked for');
    },
    token: new CancelToken(),
    cwd: FIXTURE,
    now: () => Date.now(),
    app: { version: '0.0.0-test', channel: 'test', dataDir: services ? services.dir : SANDBOX, exe: process.execPath, packaged: false, electron: null, node: process.versions.node },
    resolve: (p) => path.resolve(FIXTURE, p),
    ...extra,
  };
}

/** One command, as main() runs it. */
async function cli(tokens, ctx) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(tokens, { context: ctx, stdout, stderr });
  let json = null;
  if (tokens.includes('--json')) {
    try {
      json = JSON.parse(stdout.text);
    } catch {
      json = undefined;
    }
  }
  return { code, out: stdout.text, err: stderr.text, json };
}

const isAscii = (text) => /^[\x00-\x7e]*$/.test(text);

(async () => {
  /* ---- the command line, read ------------------------------------------- */
  console.log('\ncli: reading the command line\n');

  {
    const p = parse(['scan', 'C:\\A', 'D:\\B c', '--json', '--snapshot']);
    check('a command, its folders and its flags', p.command === 'scan' && p.positional.length === 2 && p.positional[1] === 'D:\\B c' && p.flags.json && p.flags.snapshot);
    const v = parse(['suggest', 'C:\\x', '--category=temp', '--verdict', 'safe']);
    check('a value as --name=value and as --name value', v.values.category === 'temp' && v.values.verdict === 'safe');
    const dash = parse(['scan', '--', '--helper']);
    check('-- ends the flags: a folder may be called --helper', dash.positional[0] === '--helper');
    const chromium = parse(['version', '--user-data-dir=C:\\tmp\\x']);
    check('Chromium\'s own --user-data-dir= is passed over, not refused', chromium.command === 'version');
    check('nothing at all is help', parse([]).command === 'help');
    check('--help on a command is that command\'s help', parse(['run', '--help']).positional[0] === 'run');
    const j = parse(['journal', 'show', 's_1234abcd']);
    check('journal takes list, show and verify', j.sub === 'show' && j.positional[0] === 's_1234abcd');

    const refused = (tokens) => {
      try {
        parse(tokens);
        return false;
      } catch (err) {
        return err instanceof UsageError;
      }
    };
    check('an unknown flag is refused, not ignored -- --report-ony is not --report-only', refused(['run', '--profile', 'main', '--report-ony']));
    check('a flag of another command is refused', refused(['scan', 'C:\\', '--dry-run']));
    check('a value flag without its value is refused', refused(['run', '--profile']));
    check('and one followed by another flag', refused(['run', '--profile', '--json']));
    check('run without --profile is refused', refused(['run']));
    check('a verdict other than safe or review is refused', refused(['suggest', 'C:\\', '--verdict', 'keep']));
    check('scan with no folder is refused', refused(['scan']));
    check('diff takes exactly two', refused(['diff', 'a']) && refused(['diff', 'a', 'b', 'c']));
    check('journal without list, show or verify is refused', refused(['journal']) && refused(['journal', 'delete']));
    check('a value given twice is refused', refused(['suggest', 'C:\\', '--category', 'a', '--category', 'b']));
    // H2 brought it, with no file for `apply` (see commands/policy.js).
    check('policy takes validate with at most one file, and apply with none',
      !refused(['policy', 'validate']) && !refused(['policy', 'validate', 'x.reg']) && !refused(['policy', 'apply']) &&
        refused(['policy', 'validate', 'a.reg', 'b.reg']) && refused(['policy', 'apply', 'x.reg']) && refused(['policy', 'set']) && refused(['policy']));
    check('and no command that deletes a path it is given', !Object.keys(COMMANDS).some((c) => /delete|remove|clean|purge|wipe/.test(c)));
  }

  {
    const packaged = ['C:\\Program Files\\CleanDrive\\CleanDrive.exe', '--cli', 'scan', 'C:\\x'];
    const checkout = ['electron.exe', 'D:\\repo', '--cli', 'scan', 'C:\\x'];
    check('--cli first, packaged', wanted(packaged, true) && tokensOf(packaged, true).join('|') === 'scan|C:\\x');
    check('--cli first, from a checkout', wanted(checkout, false) && tokensOf(checkout, false).join('|') === 'scan|C:\\x');
    check('--cli anywhere else is a folder, not a mode', !wanted(['CleanDrive.exe', '--analyze=C:\\x', '--cli'], true));
    check('and the window\'s own launch is not the command line', !wanted(['CleanDrive.exe'], true) && !wanted(['electron.exe', '.'], false));
  }

  /* ---- what main.js does with it ----------------------------------------- */
  console.log('\ncli: main.js decides first\n');

  {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
    const decided = src.indexOf('const isCli =');
    const modes = ['isDev', 'isScheduledRun', 'isSampleOnly', 'isHelper'].map((name) => src.indexOf(`const ${name} =`));
    check('the command line is decided before every other mode', decided > 0 && modes.every((at) => at > decided));
    check('and every other mode reads modeArgs, which is empty for the command line',
      ['--dev', '--scheduled-run', '--sample-only', '--helper'].every((flag) => src.includes(`modeArgs.includes('${flag}')`)) &&
      !/process\.argv\.includes\(/.test(src));
    check('Explorer\'s --analyze= is not read on the command line', /launchedFor = isCli(?: \|\| isConsole)? \? null :/.test(src));
    // The console (H3) is decided the same way, right after: first argument
    // only, and it empties modeArgs too.
    check('nor in the console, which is decided next and switches the other modes off',
      /const isConsole = !isCli && consoleArgs\.wanted\(/.test(src) && /const modeArgs = isCli \|\| isConsole \? \[\] : process\.argv;/.test(src) &&
        src.indexOf('const isConsole =') < modes.filter((at) => at > 0).reduce((a, b) => Math.min(a, b), Infinity) &&
        /launchedFor = isCli \|\| isConsole \? null :/.test(src));
    const chain = src.slice(src.indexOf('if (isCli) {'), src.indexOf('} else if (isHelper) {'));
    check('its branch comes first, and ends with app.exit(code)', src.indexOf('if (isCli) {') > 0 && /\.then\(\(code\) => app\.exit\(code\)\)/.test(chain));
    check('and it takes no single-instance lock', !/requestSingleInstanceLock/.test(chain));
  }

  /* ---- what it writes ----------------------------------------------------- */
  console.log('\ncli: what goes out\n');

  {
    const value = { path: 'C:\\Users\\Ảnh của tôi\\x.jpg', emoji: '📷', sep: 'a\u2028b', plain: 'abc' };
    const text = asciiJson(value);
    check('--json is ASCII through and through', isAscii(text), text.slice(0, 60));
    check('and reads back exactly, Vietnamese, emoji and U+2028 included', JSON.stringify(JSON.parse(text)) === JSON.stringify(value));
    const out = new Output({ stdout: sink(), stderr: sink(), json: true });
    out.document({ a: 1 });
    let second = false;
    try {
      out.document({ b: 2 });
    } catch {
      second = true;
    }
    check('one JSON document per run, never two', second);
    out.line('a readable line');
    check('and no readable report mixed into it', !out.stdout.text.includes('readable'));
  }

  {
    const shim = shimText();
    check('the batch file is CRLF and ASCII', !/[^\r]\n/.test(shim) && isAscii(shim));
    check('it starts the executable one folder up, with --cli first and every argument passed on', shim.includes('"%~dp0..\\CleanDrive.exe" --cli %*'));
    check('and hands its exit code back', /\r\nexit \/b %errorlevel%\r\n$/.test(shim));
    check('it clears ELECTRON_RUN_AS_NODE, for itself only', shim.indexOf('setlocal') > 0 && shim.indexOf('setlocal') < shim.indexOf('set ELECTRON_RUN_AS_NODE='));
    const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
    check('the build ships it as bin\\cleandrive.cmd, and does not touch PATH', /extraFiles: \[\s*\{ from: binDir, to: 'bin' \}/.test(build) && /cleandrive\.cmd/.test(build) && !/\bPATH\b.*(EnVar|setx|WriteRegExpandStr)/i.test(build));
  }

  /* ---- the licence ---------------------------------------------------------- */
  console.log('\ncli: the licence, said in words\n');

  {
    const gated = Object.entries(COMMANDS).filter(([, spec]) => spec.feature);
    const sample = { scan: ['scan', 'C:\\'], suggest: ['suggest', 'C:\\'], snapshots: ['snapshots'], diff: ['diff', 'a', 'b'], system: ['system'], profiles: ['profiles'], run: ['run', '--profile', 'main'], report: ['report'] };
    let all = true;
    let said = true;
    let touched = false;
    for (const [name] of gated) {
      // No services at all: a refused command that reached for them would throw.
      const r = await cli([...sample[name], '--json'], context({ can: PRO_ONLY }));
      if (r.code !== EXIT.LICENCE) all = false;
      if (!/part of CleanDrive Business, which this copy does not include\. Nothing was done\./.test(r.err)) said = false;
      if (!r.json || r.json.schema !== 'cleandrive.error/1' || r.json.error !== 'licence' || r.json.feature !== 'biz.cli') said = false;
      if (/touched the services/.test(r.err)) touched = true;
    }
    check(`all ${gated.length} Business commands exit 3 without Business`, all);
    check('each says so on stderr, and in --json as cleandrive.error/1', said);
    check('and none of them reached the files it would have read', !touched);

    const lapsed = await cli(['scan', 'C:\\'], context({ can: NOTHING, expired: true }));
    check('a lapsed licence is named as lapsed', lapsed.code === EXIT.LICENCE && /has lapsed/.test(lapsed.err), lapsed.err.trim());

    const services = realServices(path.join(SANDBOX, 'free'));
    const free = context({ can: NOTHING, services });
    const v = await cli(['version', '--json'], free);
    check('version runs with no licence at all, and says which commands this copy has', v.code === 0 && v.json.commands.journal === true && v.json.commands.scan === false);
    const h = await cli(['help'], free);
    check('so does help, with the exit codes in it', h.code === 0 && /64 {2}the command line names nothing/.test(h.out));
    const jl = await cli(['journal', 'list', '--json'], free);
    check('journal list runs with no licence', jl.code === 0 && jl.json.schema === 'cleandrive.journal-list/1');
    const jv = await cli(['journal', 'verify', '--json'], free);
    check('journal verify runs with no licence, and its report is verifyJournal\'s own', jv.code === 0 && jv.json.schema === 'cleandrive.journal-verify/1' && jv.json.sealing === false);
    check('and it says that sealing is Business, rather than leaving it out', /sealing the journal is part of CleanDrive Business/.test((await cli(['journal', 'verify'], free)).out));
    const rs = await cli(['restore', 's_00000000'], free);
    check('restore is never asked about the licence either: an unknown session is a usage error, not 3', rs.code === EXIT.USAGE, rs.err.trim());
  }

  /* ---- the codes ------------------------------------------------------------ */
  console.log('\ncli: exit codes\n');

  {
    const bad = await cli(['frobnicate', '--json'], context());
    check('an unknown command is 64, with the error as JSON', bad.code === EXIT.USAGE && bad.json && bad.json.error === 'usage');
    const wrongFlag = await cli(['scan', 'C:\\', '--nope'], context());
    check('a wrong flag is 64, and the usage line is on stderr', wrongFlag.code === EXIT.USAGE && /usage: cleandrive scan/.test(wrongFlag.err));

    const m = (key) => ({ i18n: key, en: key });
    const base = { outcome: 'ok', reason: null, notes: [] };
    check('a run that did its work is 0', exitFor(base) === EXIT.OK);
    check('a report-only run is 0', exitFor({ ...base, outcome: 'dry-run' }) === EXIT.OK);
    check('a run a gate skipped is 2', exitFor({ ...base, outcome: 'skipped' }) === EXIT.REFUSED);
    check('a run whose every file the delete guards refused is 2', exitFor({ ...base, reason: m('run.allRefused') }) === EXIT.REFUSED);
    check('a run that could not record what it moved, and stopped, is 5', exitFor({ ...base, notes: [m('run.note.recordFailed')] }) === EXIT.STOPPED);
    check('a cancelled run is 5', exitFor({ ...base, outcome: 'cancelled' }) === EXIT.STOPPED);

    const report = (over) => ({ counts: { altered: 0, sealed: 1 }, missingCount: 0, oldestMissing: null, duplicates: [], unreadable: [], ...over });
    check('a journal as sealed is not a finding', !changed(report({})));
    check('a session never sealed is not a finding', !changed(report({ counts: { altered: 0, sealed: 0, unsealed: 4 } })));
    check('a changed, removed or doubled seal is (exit 6)', changed(report({ counts: { altered: 1 } })) && changed(report({ missingCount: 2 })) && changed(report({ oldestMissing: { count: 1 } })) && changed(report({ duplicates: [3] })));
  }

  /* ---- administrator ---------------------------------------------------------- */
  console.log('\ncli: administrator rights, never asked for\n');

  {
    const sys = await cli(['system', '--json'], context({ elevated: false }));
    check('system without an elevated terminal is 4, and nothing is measured', sys.code === EXIT.ADMIN && sys.json.error === 'admin' && !/touched the services/.test(sys.err), sys.err.trim());
    const mft = await cli(['scan', 'D:\\', '--mft'], context({ elevated: false }));
    check('scan --mft without an elevated terminal is 4, before anything is read', mft.code === EXIT.ADMIN && /Nothing was scanned/.test(mft.err));
    const noPro = await cli(['scan', 'D:\\', '--mft'], context({ can: (f) => f !== 'pro.scan.mft', elevated: true }));
    check('scan --mft without Pro is 3, not a quiet walk instead', noPro.code === EXIT.LICENCE && /--mft is part of CleanDrive Pro/.test(noPro.err), noPro.err.trim());
  }

  /* ---- the commands, on a folder of the harness's own ------------------------ */
  console.log('\ncli: the commands, against the real modules\n');

  fs.mkdirSync(path.join(FIXTURE, 'Ảnh của tôi'), { recursive: true });
  fs.mkdirSync(path.join(FIXTURE, 'work'), { recursive: true });
  const old = Date.now() - 60 * DAY;
  const put = (rel, bytes, mtime = old) => {
    const file = path.join(FIXTURE, rel);
    fs.writeFileSync(file, crypto.randomBytes(bytes));
    fs.utimesSync(file, new Date(mtime), new Date(mtime));
    return file;
  };
  const tmp = put(path.join('work', 'left-behind.tmp'), 40000);
  put(path.join('Ảnh của tôi', 'beach.jpg'), 120000);
  put(path.join('work', 'notes.txt'), 3000, Date.now());
  check('the fixture is on D:, outside every folder a scan refuses',
    !skipReason(path.basename(FIXTURE), FIXTURE, { excludeSystem: true }) && !isProtectedPath(FIXTURE) && !FIXTURE.toLowerCase().includes('appdata'), FIXTURE);

  const services = realServices(path.join(SANDBOX, 'business'));
  const ctx = context({ services, extra: { lockWaitMs: 200 } });

  {
    const r = await cli(['scan', '.', '--json'], ctx);
    const root = r.json && r.json.roots[0];
    check('scan: exit 0, and the folder resolved against the working directory', r.code === 0 && root && root.root === FIXTURE, r.err.trim());
    check('scan: the files and bytes are the fixture\'s', root && root.files === 3 && root.bytes === 163000, root && `${root.files} / ${root.bytes}`);
    check('scan: the temp file is in "could be cleaned"', r.json.cleanup.groups.some((g) => g.category === 'temp' && g.verdict === 'safe' && g.files === 1));
    check('scan: a Vietnamese folder name survives the JSON', r.json.topFolders.some((t) => t.path.endsWith('Ảnh của tôi')) && isAscii(r.out));
    check('scan: without --snapshot nothing is written', !fs.existsSync(path.join(services.dir, 'snapshots')) && !fs.existsSync(path.join(services.dir, 'history.json')));

    const human = await cli(['scan', FIXTURE], ctx);
    check('scan: the readable report names the folder and the cleanable group', human.code === 0 && human.out.includes(FIXTURE) && /Temporary files \(1 file\)/.test(human.out));
  }

  let first;
  let second;
  {
    const a = await cli(['scan', FIXTURE, '--snapshot', '--json'], ctx);
    first = a.json && a.json.roots[0].snapshot;
    check('scan --snapshot keeps one, and prints its id', a.code === 0 && /^[0-9a-f]{16}:[0-9TZ-]+$/.test(first || ''), first);
    put(path.join('work', 'big-new.bin'), 3 * 1024 * 1024, Date.now());
    await new Promise((r) => setTimeout(r, 20));
    const b = await cli(['scan', FIXTURE, '--snapshot', '--json'], ctx);
    second = b.json && b.json.roots[0].snapshot;
    const list = await cli(['snapshots', '--json'], ctx);
    const folder = list.json && list.json.folders.find((x) => x.root === FIXTURE);
    check('snapshots lists both, newest first, by the ids scan printed', folder && folder.snapshots.length === 2 && folder.snapshots[0].id === second && folder.snapshots[1].id === first);
    const d = await cli(['diff', first, second, '--json'], ctx);
    check('diff: the folder grew by the new file', d.code === 0 && d.json.ok && d.json.total.change === 3 * 1024 * 1024, d.json && JSON.stringify(d.json.total));
    const noPro = await cli(['diff', first, second], context({ services, can: (f) => f !== 'pro.diff' }));
    check('diff without Pro is 3', noPro.code === EXIT.LICENCE);
    const unknown = await cli(['diff', first, '0000000000000000:2020-01-01T00-00-00-000Z'], ctx);
    check('diff of a snapshot the store does not hold is 64', unknown.code === EXIT.USAGE, unknown.err.trim());
    const made = await cli(['diff', first, '..\\..\\Windows'], ctx);
    check('and an id is never turned into a path', made.code === EXIT.USAGE && /not a snapshot id/.test(made.err));
  }

  {
    const s = await cli(['suggest', FIXTURE, '--json'], ctx);
    const c = s.json && s.json.candidates.find((x) => x.path === tmp);
    check('suggest lists the temp file, with its reason in English', s.code === 0 && c && c.verdict === 'safe' && c.evidence.length > 0 && /[a-z]/.test(c.evidence[0]), c && c.evidence[0]);
    check('suggest: --category takes the profile\'s name for it', (await cli(['suggest', FIXTURE, '--category', 'temp', '--json'], ctx)).json.candidates.length === 1);
    check('suggest: and the candidate\'s', (await cli(['suggest', FIXTURE, '--category', 'cleanup.temp', '--json'], ctx)).json.candidates.length === 1);
    check('suggest: --verdict review leaves the safe file out', (await cli(['suggest', FIXTURE, '--verdict', 'review', '--json'], ctx)).json.candidates.length === 0);
    check('suggest moved nothing', fs.existsSync(tmp));
  }

  /* ---- run --profile ------------------------------------------------------- */
  console.log('\ncli: run --profile, through every gate\n');

  {
    const none = await cli(['run', '--profile', 'main'], ctx);
    check('no settings file: 2, nothing run', none.code === EXIT.REFUSED && /No settings file/.test(none.err));

    const write = (profiles) => {
      const { settings } = coerceSettings({ autoClean: { profiles } });
      fs.writeFileSync(path.join(services.dir, 'settings.json'), JSON.stringify(settings));
      services.settings = new SettingsStore(path.join(services.dir, 'settings.json'));
    };
    const base = { roots: [FIXTURE], categories: ['temp'], minAgeDays: 7, minDiskUsedPercent: 0, skipIfRunning: [] };
    write([{ id: 'main', enabled: false, dryRun: false, ...base }]);

    const unknown = await cli(['run', '--profile', 'nope'], ctx);
    check('a profile id that is not there is 64, and the ids are named', unknown.code === EXIT.USAGE && /This computer has: main/.test(unknown.err));

    const off = await cli(['run', '--profile', 'main', '--json'], ctx);
    check('a profile that is switched off is refused (2), not run anyway', off.code === EXIT.REFUSED && off.json.outcome === 'skipped' && /switched off/.test(off.json.reason));
    check('and the file is where it was', fs.existsSync(tmp));
    const log = JSON.parse(fs.readFileSync(path.join(services.dir, 'autoclean-log.json'), 'utf8'));
    check('the run is in the run log, marked as the command line\'s', log.runs[0] && log.runs[0].via === 'cli' && log.runs[0].profileId === 'main');

    write([{ id: 'main', enabled: true, dryRun: true, ...base }]);
    const report = await cli(['run', '--profile', 'main', '--json'], ctx);
    check('a report-only profile reports (0), and says what would go', report.code === 0 && report.json.outcome === 'dry-run' && report.json.wouldMove && report.json.wouldMove.some((x) => x.path === tmp), report.json && report.json.reason);
    check('and moves nothing', fs.existsSync(tmp) && report.json.moved.files === 0);

    write([{ id: 'main', enabled: true, dryRun: false, ...base }]);
    const asked = await cli(['run', '--profile', 'main', '--report-only', '--json'], ctx);
    check('--report-only makes a live profile report', asked.code === 0 && asked.json.reportOnly === true && asked.json.reportOnlyAsked === true && asked.json.outcome === 'dry-run');
    check('and still moves nothing', fs.existsSync(tmp));

    // Another run holding the lock: this process's own pid, so it is alive.
    fs.writeFileSync(services.runLockPath, JSON.stringify({ pid: process.pid, holder: 'harness', at: Date.now() }));
    const busy = await cli(['run', '--profile', 'main', '--report-only', '--json'], ctx);
    fs.rmSync(services.runLockPath, { force: true });
    check('another run holding the lock: skipped (2) with a reason of its own', busy.code === EXIT.REFUSED && /from the command line was skipped/.test(busy.json.reason), busy.json && busy.json.reason);
    check('and said while waiting', /another automatic cleanup is running; waiting/.test(busy.err));
    check('the profiles command names the ids run takes', /main {2}Automatic cleanup {2}\(on, acts\)/.test((await cli(['profiles'], ctx)).out));
  }

  /* ---- the journal and restore ------------------------------------------------- */
  console.log('\ncli: the journal, and putting back\n');

  {
    const gone = path.join(FIXTURE, 'work', 'was-here.log');
    await services.journal.appendSession('recycle', [{ path: gone, size: 1234, trashedAt: Date.now() - 1000, mtimeMs: old }], { source: 'cli' });
    const list = await cli(['journal', 'list', '--json'], ctx);
    const session = list.json && list.json.sessions[0];
    check('journal list shows the session, from the command line', session && session.source === 'cli' && session.count === 1, session && session.id);
    check('and the readable list says where it came from', /from the command line/.test((await cli(['journal', 'list'], ctx)).out));
    const show = await cli(['journal', 'show', session.id, '--json'], ctx);
    check('journal show names the item and where it is now', show.code === 0 && show.json.items[0].path === gone && show.json.items[0].state === 'gone', show.json && show.json.items[0].state);
    check('journal show of a malformed id is 64', (await cli(['journal', 'show', '..\\x'], ctx)).code === EXIT.USAGE);

    const dry = await cli(['restore', session.id, '--dry-run', '--json'], ctx);
    check('restore --dry-run: nothing can come back, so 2, and it says why', dry.code === EXIT.REFUSED && dry.json.putBack.length === 0 && dry.json.notRecoverable.length === 1 && dry.json.dryRun);
    check('and the dry run wrote no session of its own', (await services.journal.sessions()).length === 1);
  }

  /* ---- held together ------------------------------------------------------------ */
  console.log('\ncli: held together with the window\n');

  {
    const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'system.js'), 'utf8');
    const wrong = Object.entries(LABELS).filter(([key, label]) => !renderer.includes(`t('system.row.${key}', '${label.replace(/'/g, "\\'")}'`));
    check('system\'s English row names are the System screen\'s own', wrong.length === 0, wrong.map(([k]) => k).join(', '));
    const commands = fs.readdirSync(path.join(ROOT, 'src', 'main', 'cli', 'commands')).map((name) => [name, fs.readFileSync(path.join(ROOT, 'src', 'main', 'cli', 'commands', name), 'utf8')]);
    const executes = commands.filter(([, src]) => /\bexecute\(/.test(src)).map(([n]) => n);
    const runs = commands.filter(([, src]) => /\brunAutoClean\(/.test(src)).map(([n]) => n);
    check('only restore calls execute(), and only with kind restore', executes.join() === 'restore.js' && /kind: 'restore'/.test(commands.find(([n]) => n === 'restore.js')[1]));
    check('only run calls runAutoClean()', runs.join() === 'run.js');
    check('the restore never overwrites: a file in the way is always skipped', /onConflict: 'skip'/.test(commands.find(([n]) => n === 'restore.js')[1]) && !/onConflict: '(replace|rename)'/.test(commands.map(([, s]) => s).join('\n')));
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
