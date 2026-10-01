#!/usr/bin/env node
'use strict';

// The command line (H1), as a real process, against real things.
//
//   node scripts/verify-cli.js                      a checkout: electron.exe <repo> --cli
//   node scripts/verify-cli.js --packaged <dir>     a built win-unpacked folder and its bin\cleandrive.cmd
//   node scripts/verify-cli.js --elevated           from an elevated terminal: system, scan --mft
//
// What test-cli.js cannot show, because it runs under plain Node:
//
//   - the exit code reaches the process that started it (app.exit, not app.quit);
//   - --json down a pipe is ASCII and parses, a Vietnamese folder name included;
//   - a live run moves the harness's own files to the real Recycle Bin, the
//     journal records and seals it, `journal verify` finds a line changed by
//     hand (6), and `restore` puts every file back byte for byte -- skipping,
//     and saying so (2), one that has something else at its old path;
//   - an open window does not stop the command line (no single-instance lock);
//   - in a real console, the batch file waits: output before the next prompt,
//     and the exit code in $LASTEXITCODE and in cmd's errorlevel.
//
// Isolation, proved before anything else: every run is given its own
// user-data folder with --user-data-dir, and `cleandrive version` must name
// that folder or the harness stops. Task names carry a suffix. The fixture is
// on D: (os.tmpdir() is inside AppData here), removed on exit, and every file
// the live run sends to the Recycle Bin is put back by the restore it tests --
// so the harness leaves nothing in the bin.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const REPO = path.join(__dirname, '..');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');
const argv = process.argv.slice(2);
const at = argv.indexOf('--packaged');
const PACKAGED = at >= 0 ? path.resolve(argv[at + 1] || '') : null;
const ELEVATED = argv.includes('--elevated');
const DAY = 24 * 60 * 60 * 1000;
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-verify-cli-'));
const FIXTURE = path.join('D:', path.sep, `cleandrive-verify-cli-${crypto.randomBytes(4).toString('hex')}`);
const children = [];
process.on('exit', () => {
  for (const child of children) {
    try {
      if (child.exitCode === null) execFileSync(path.join(SYSTEM32, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  for (const dir of [SANDBOX, FIXTURE]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind: ${dir})`);
    }
  }
});

const env = (over = {}) => {
  const out = { ...process.env, CLEANDRIVE_TASK_SUFFIX: 'verifycli', ...over };
  delete out.ELECTRON_RUN_AS_NODE;
  for (const [k, v] of Object.entries(over)) if (v === null) delete out[k];
  return out;
};

const userData = (name) => {
  const dir = path.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** How the command line is started: a checkout, or a built folder. */
function command(dataDir) {
  return PACKAGED
    ? { exe: path.join(PACKAGED, 'CleanDrive.exe'), pre: ['--cli', `--user-data-dir=${dataDir}`] }
    : { exe: ELECTRON, pre: [REPO, '--cli', `--user-data-dir=${dataDir}`] };
}

function cli(dataDir, tokens, { entitlements = null } = {}) {
  const { exe, pre } = command(dataDir);
  return new Promise((resolve) => {
    const child = spawn(exe, [...pre, ...tokens], {
      env: env(entitlements ? { CLEANDRIVE_ENTITLEMENTS: entitlements } : { CLEANDRIVE_ENTITLEMENTS: null }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const bytes = Buffer.concat(out);
      let json = null;
      if (tokens.includes('--json')) {
        try {
          json = JSON.parse(bytes.toString('utf8'));
        } catch {
          json = undefined;
        }
      }
      resolve({ code, bytes, out: bytes.toString('utf8'), err, json });
    });
  });
}

const ascii = (buf) => buf.every((b) => b < 0x7f);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

async function integrity() {
  try {
    const out = execFileSync(path.join(SYSTEM32, 'whoami.exe'), ['/groups', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    return out.includes('S-1-16-12288') || out.includes('S-1-16-16384') ? 'high' : 'medium';
  } catch {
    return 'unknown';
  }
}

(async () => {
  const elevated = (await integrity()) === 'high';
  console.log(`\ncli, real process: ${PACKAGED ? `packaged (${PACKAGED})` : 'checkout'}${elevated ? ', elevated' : ''}\n`);
  if (PACKAGED && !fs.existsSync(path.join(PACKAGED, 'CleanDrive.exe'))) throw new Error(`no CleanDrive.exe in ${PACKAGED}`);
  if (ELEVATED && !elevated) throw new Error('--elevated needs this script itself to run from an elevated terminal');

  /* ---- isolation, first ---------------------------------------------------- */
  const main = userData('main');
  const v = await cli(main, ['version', '--json']);
  if (!v.json || !sameDir(v.json.dataDir, main)) {
    throw new Error(`not isolated: the command line reports ${v.json && v.json.dataDir}, not ${main}. Stopping before anything is read.`);
  }
  check('isolated: the command line names the throwaway folder as its data', true, v.json.dataDir);
  const channel = v.json.channel;
  const business = v.json.commands.scan === true;
  check(`the build says which it is: ${channel}${business ? ', Business commands open' : ', Business commands closed'}`, Boolean(channel));

  /* ---- codes, out of a real process -------------------------------------------- */
  console.log('\nexit codes reach the shell\n');
  check('help: 0', (await cli(main, ['help'])).code === 0);
  const bogus = await cli(main, ['frobnicate']);
  check('an unknown command: 64, and the reason on stderr', bogus.code === 64 && /no command called "frobnicate"/.test(bogus.err), bogus.err.trim());
  check('a wrong flag: 64', (await cli(main, ['scan', FIXTURE, '--nope'])).code === 64);

  if (!PACKAGED) {
    const pro = await cli(main, ['scan', 'D:\\', '--json'], { entitlements: 'pro' });
    check('without Business, scan: 3, said on stderr and as cleandrive.error/1', pro.code === 3 && /part of CleanDrive Business/.test(pro.err) && pro.json && pro.json.error === 'licence', pro.err.trim());
    const free = await cli(main, ['journal', 'list'], { entitlements: 'free' });
    check('with no licence at all, journal list still runs: 0', free.code === 0, free.err.trim());
  } else if (!business) {
    const closed = await cli(main, ['scan', 'D:\\']);
    check('this build has Business closed, so scan: 3, and says so', closed.code === 3 && /part of CleanDrive Business/.test(closed.err), closed.err.trim());
    check('and journal list still runs: 0', (await cli(main, ['journal', 'list'])).code === 0);
  }
  if (!elevated) {
    const sys = await cli(main, ['system']);
    check(business ? 'system, not elevated: 4, and no UAC prompt' : 'system: 3 here, the licence asked before anything else', sys.code === (business ? 4 : 3), sys.err.trim());
  }

  /* ---- the fixture ---------------------------------------------------------- */
  const old = Date.now() - 60 * DAY;
  const hashes = new Map();
  // Hashed from the bytes written, not read back: reading a file can move its
  // last-access time, and the run picks files by how long they were left alone.
  const put = (rel, bytes, mtime = old) => {
    const file = path.join(FIXTURE, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = crypto.randomBytes(bytes);
    fs.writeFileSync(file, body);
    fs.utimesSync(file, new Date(mtime), new Date(mtime));
    hashes.set(file, crypto.createHash('sha256').update(body).digest('hex'));
    return file;
  };
  const temps = [put(path.join('work', 'left-behind.tmp'), 50000), put(path.join('Ảnh của tôi', 'half-downloaded.crdownload'), 70000)];
  put(path.join('Ảnh của tôi', 'beach.jpg'), 120000);
  for (let i = 0; i < 150; i++) put(path.join('many', `cache-${String(i).padStart(3, '0')}.tmp`), 512);

  if (business) {
    console.log('\n--json down a pipe\n');
    const scan = await cli(main, ['scan', FIXTURE, '--json']);
    check('scan: 0', scan.code === 0, scan.err.trim().split('\n').pop());
    check('every byte on stdout is ASCII', ascii(scan.bytes), `${scan.bytes.length} bytes`);
    check('it parses, and the Vietnamese folder name comes back exact', scan.json && scan.json.topFolders.some((t) => path.basename(t.path) === 'Ảnh của tôi'));
    check('and the counts are the fixture\'s', scan.json && scan.json.roots[0].files === 153, scan.json && String(scan.json.roots[0].files));
    const many = await cli(main, ['suggest', FIXTURE, '--json']);
    const group = many.json && many.json.groups.find((g) => g.category === 'temp');
    check('suggest: the advisor keeps its hundred largest and says it trimmed', group && group.files === 152 && group.truncated === true && many.json.candidates.length > 0, group && `${group.files} files, ${many.json.candidates.length} listed`);
    check('the readable report goes to stdout, the progress to stderr', /Largest folders/.test((await cli(main, ['scan', FIXTURE])).out) && /scanning/.test(scan.err));

    /* ---- a live run, the real Recycle Bin, and back -------------------------- */
    console.log('\nrun --profile, the real Recycle Bin, and restore\n');
    fs.writeFileSync(
      path.join(main, 'settings.json'),
      JSON.stringify({
        version: 12,
        trends: { dailySample: false, sampleTime: '12:00' },
        monitor: { enabled: false },
        autoClean: { profiles: [{ id: 'main', enabled: true, dryRun: false, roots: [path.join(FIXTURE, 'work'), path.join(FIXTURE, 'Ảnh của tôi')], categories: ['temp'], minAgeDays: 7, minDiskUsedPercent: 0, skipIfRunning: [] }] },
        purge: { enabled: false },
      })
    );
    const report = await cli(main, ['run', '--profile', 'main', '--report-only', '--json']);
    check('--report-only: 0, the two files named, both still there', report.code === 0 && report.json.outcome === 'dry-run' && report.json.wouldMove.length === 2 && temps.every((f) => fs.existsSync(f)), report.err.trim().split('\n').pop());

    const live = await cli(main, ['run', '--profile', 'main', '--json']);
    const session = live.json && live.json.session;
    check('a live run: 0, two files moved, and the session named', live.code === 0 && live.json.moved.files === 2 && /^s_[0-9a-f]{8}$/.test(session || ''), live.json && `${live.json.outcome} ${live.json.moved.files} ${session}`);
    check('moved is not freed: the Recycle Bin is on the same drive', live.json && live.json.freedOnDrive === 0 && live.json.notes.some((n) => /no space is free until the bin is/.test(n)));
    check('the files left their folders', temps.every((f) => !fs.existsSync(f)));
    const show = await cli(main, ['journal', 'show', session, '--json']);
    check('journal show: both in the Recycle Bin', show.code === 0 && show.json.items.length === 2 && show.json.items.every((i) => i.state === 'inBin'), show.json && show.json.items.map((i) => i.state).join(','));
    const listed = await cli(main, ['journal', 'list']);
    check('journal list says where the session came from', /from the command line/.test(listed.out));

    const verify = await cli(main, ['journal', 'verify', '--json']);
    const sealing = verify.json && verify.json.sealing;
    check(`journal verify: 0${sealing ? ', the session sealed' : ', and it says sealing is not on'}`, verify.code === 0 && (sealing ? verify.json.counts.sealed >= 1 : /part of CleanDrive Business/.test((await cli(main, ['journal', 'verify'])).out)), verify.err.trim());
    if (sealing) {
      const dir = path.join(main, 'journal');
      const file = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(dir, n))[0];
      const before = fs.readFileSync(file);
      const text = before.toString('utf8');
      const target = text.split('\n').find((line) => line.includes(`"session":"${session}"`) && line.includes('"op":"item"'));
      const edited = target.replace(/"bytes":(\d+)/, (_all, n) => `"bytes":${Number(n) + 1}`);
      if (edited === target || text.split(target).length !== 2) throw new Error('could not find exactly one item line of the session to change');
      fs.writeFileSync(file, Buffer.from(text.split(target).join(edited), 'utf8'));
      const tampered = await cli(main, ['journal', 'verify', '--json']);
      check('a line changed by hand: verify exits 6 and names the session', tampered.code === 6 && tampered.json.counts.altered === 1 && tampered.json.sessions[session].state === 'altered', tampered.json && JSON.stringify(tampered.json.counts));
      fs.writeFileSync(file, before);
      check('put back byte for byte: 0 again', (await cli(main, ['journal', 'verify'])).code === 0);
    }

    // Something else at one old path: never overwritten, said, and 2.
    fs.writeFileSync(temps[0], 'somebody else\'s file');
    const blocked = await cli(main, ['restore', session, '--json']);
    check('restore with a file in the way: 2, that one skipped and named', blocked.code === 2 && blocked.json.inTheWay.length === 1 && sameDir(blocked.json.inTheWay[0].path, temps[0]), blocked.json && JSON.stringify(blocked.json.inTheWay));
    check('the file in the way is untouched', fs.readFileSync(temps[0], 'utf8') === 'somebody else\'s file');
    check('and the other came back byte for byte', fs.existsSync(temps[1]) && sha(temps[1]) === hashes.get(temps[1]));
    fs.rmSync(temps[0]);
    const dry = await cli(main, ['restore', session, '--dry-run', '--json']);
    check('--dry-run, once the way is clear: 0, one would come back', dry.code === 0 && dry.json.putBack.length === 1 && dry.json.dryRun, dry.err.trim());
    const back = await cli(main, ['restore', session, '--json']);
    check('restore: 0, and the last one back byte for byte', back.code === 0 && fs.existsSync(temps[0]) && sha(temps[0]) === hashes.get(temps[0]), back.err.trim());
    const after = await cli(main, ['journal', 'show', session, '--json']);
    check('nothing of the harness is left in the Recycle Bin', after.json && after.json.items.every((i) => i.state === 'restored'), after.json && after.json.items.map((i) => i.state).join(','));
    const restores = await cli(main, ['journal', 'list', '--json']);
    check('the restores are sessions of their own, from the command line', restores.json && restores.json.sessions.filter((s) => s.kind === 'restore' && s.source === 'cli').length === 2);
  }

  /* ---- beside an open window -------------------------------------------------- */
  // A checkout's window only. A built one runs the updater -- a network check,
  // and possibly a download -- which a harness has no business starting. The
  // branch that decides is the same main.js either way.
  if (!PACKAGED) {
    console.log('\nbeside an open window\n');
    const windowData = userData('window');
    fs.writeFileSync(path.join(windowData, 'settings.json'), JSON.stringify({ version: 12, trends: { dailySample: false, sampleTime: '12:00' }, monitor: { enabled: false } }));
    const { exe } = command(windowData);
    const window = spawn(exe, PACKAGED ? [`--user-data-dir=${windowData}`] : [REPO, `--user-data-dir=${windowData}`], { env: env(), stdio: 'ignore', windowsHide: false });
    children.push(window);
    await new Promise((r) => setTimeout(r, 6000));
    const beside = await cli(windowData, ['version', '--json']);
    check('the window is up, and the command line still answers: 0', window.exitCode === null && beside.code === 0 && sameDir(beside.json.dataDir, windowData));
    check('and the window was not touched by it', window.exitCode === null);
    execFileSync(path.join(SYSTEM32, 'taskkill.exe'), ['/PID', String(window.pid), '/T', '/F'], { stdio: 'ignore' });
  }

  /* ---- a real console ------------------------------------------------------------- */
  console.log('\nin a real console, through the batch file\n');
  {
    const consoleData = userData('console');
    let shim;
    if (PACKAGED) {
      // The shipped file, untouched; the data folder rides along as an argument.
      const real = path.join(PACKAGED, 'bin', 'cleandrive.cmd');
      check('the build has bin\\cleandrive.cmd', fs.existsSync(real));
      shim = path.join(SANDBOX, 'cleandrive-wrap.cmd');
      fs.writeFileSync(shim, `@echo off\r\ncall "${real}" --user-data-dir=${consoleData} %*\r\nexit /b %errorlevel%\r\n`);
    } else {
      // The shipped text, pointed at a checkout instead of CleanDrive.exe:
      // exactly one line changes, counted before it is changed.
      const shipped = require('../src/main/cli/shim').shimText();
      const LINE = '"%~dp0..\\CleanDrive.exe" --cli %*';
      const matches = shipped.split(LINE).length - 1;
      const text = shipped.replace(LINE, () => `"${ELECTRON}" "${REPO}" --cli --user-data-dir=${consoleData} %*`);
      shim = path.join(SANDBOX, 'cleandrive.cmd');
      fs.writeFileSync(shim, text);
      check('the checkout\'s batch file is the shipped one with one line changed', matches === 1 && text.includes(`"${REPO}" --cli`));
    }
    const dump = path.join(SANDBOX, 'console.txt');
    const ps = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const driver = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Start-Process -FilePath '${ps}' -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','"${path.join(__dirname, 'lib', 'cli-console.ps1')}"','-Shim','"${shim}"','-Folder','"${FIXTURE}"','-Dump','"${dump}"')`], { env: env(), stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => driver.on('exit', resolve));
    const screen = fs.existsSync(dump) ? fs.readFileSync(dump, 'utf8') : '';
    const lines = screen.split(/\r?\n/);
    const idx = (re) => lines.findIndex((l) => re.test(l));
    check('the console was read back', idx(/^=== END$/) > 0, screen.startsWith('DRIVER ERROR') ? screen.slice(0, 200) : `${lines.length} lines`);
    check('typed in PowerShell: the output is on screen before the prompt comes back', idx(/^CleanDrive \d/) > idx(/^=== A typed/) && idx(/^CleanDrive \d/) < idx(/^=== A returned/));
    check('and $LASTEXITCODE is 0', idx(/^=== A returned 0$/) > 0);
    const parsed = lines.find((l) => l.startsWith('=== B parsed')) || '';
    if (business) {
      const want = `=== B name ${[...'Ảnh của tôi'].map((c) => c.codePointAt(0)).join(',')}`;
      check('captured by PowerShell: --json parses, and the Vietnamese name is exact', parsed.includes('schema=cleandrive.scan/1') && lines.includes(want), lines.filter((l) => l.startsWith('=== B')).join(' | ').slice(0, 200));
    } else {
      // Business closed: the refusal is the answer, and it too is JSON a script can read.
      check('captured by PowerShell, refused: 3, and the refusal parses as cleandrive.error/1', idx(/^=== B returned 3$/) > 0 && parsed.includes('schema=cleandrive.error/1'), parsed);
    }
    check('a wrong command: $LASTEXITCODE is 64', idx(/^=== C returned 64$/) > 0);
    check('through cmd: errorlevel is 64', idx(/^D errorlevel=64$/) > 0);
  }

  /* ---- elevated --------------------------------------------------------------------- */
  if (ELEVATED && business) {
    console.log('\nelevated\n');
    const elevatedData = userData('elevated');
    const sys = await cli(elevatedData, ['system', '--json']);
    check('system: 0, with the drive explained', sys.code === 0 && sys.json && sys.json.rows.length > 5 && sys.json.elevated, sys.err.trim().split('\n').pop());
    if (sys.json) {
      const share = sys.json.unexplainedBytes / Math.max(1, sys.json.volume.usedBytes);
      check('and "not explained" within the 1% Phase 1 set', share <= 0.01, `${(share * 100).toFixed(2)}% of ${(sys.json.volume.usedBytes / 2 ** 30).toFixed(1)} GiB`);
    }
    const mft = await cli(elevatedData, ['scan', 'D:\\', '--mft', '--json']);
    check('scan D:\\ --mft: 0, read from the catalogue, no prompt', mft.code === 0 && mft.json && mft.json.roots[0].scanner === 'mft', mft.code === 0 ? mft.err.trim().split('\n').pop() : mft.err.trim().replace(/\s*\n\s*/g, ' | '));
    const notDrive = await cli(elevatedData, ['scan', FIXTURE, '--mft']);
    check('scan --mft of a folder that is not a whole drive: 2, nothing scanned', notDrive.code === 2 && /not a whole drive/.test(notDrive.err), notDrive.err.trim());
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
