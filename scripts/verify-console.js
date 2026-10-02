#!/usr/bin/env node
'use strict';

// The machine report and the console (H3), as real processes.
//
//   node scripts/verify-console.js               everything below
//   node scripts/verify-console.js --skip-dead   without the dead-share run (~45 s)
//
// What scripts/test-fleet.js cannot show under plain Node:
//
//   - the daily measurement (`--sample-only`), started the way Task Scheduler
//     starts it, reads the organisation's policy through the real reg.exe and
//     writes this machine's report to a share through the real SMB client and
//     server -- \\localhost\D$, this machine's own admin share, the nearest
//     thing to a second machine there is here (ROADMAP §11 row 12);
//   - without CleanDrive Business it writes nothing, and says so;
//   - `cleandrive policy apply` registers the measurement's task and writes a
//     report at once; `cleandrive report --json` prints the same document;
//   - a share that does not answer leaves the measurement, and the exit code,
//     alone -- measured, it holds the process for the ~42 s Windows gives up
//     after, and that is reported rather than hidden;
//   - `CleanDrive --console <share>` opens its own window and draws the
//     machine from the share (read over Chromium's debugging port), and with
//     no Business it reads nothing.
//
// Isolation, proved first: every run has its own --user-data-dir (`version
// --json` must name it), the policy is read from
// HKCU\Software\CleanDrive-Harness\Policy_<random>, tasks carry
// CLEANDRIVE_TASK_SUFFIX, the share is a fresh folder on D:. All removed on exit.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const report = require('../src/main/fleet/report');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const REPO = path.join(__dirname, '..');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const REG = path.join(SYSTEM32, 'reg.exe');
const SCHTASKS = path.join(SYSTEM32, 'schtasks.exe');
const SKIP_DEAD = process.argv.includes('--skip-dead');

const SUFFIX = 'verifyconsole';
const HARNESS_PARENT = 'HKEY_CURRENT_USER\\Software\\CleanDrive-Harness';
const HARNESS_KEY = `${HARNESS_PARENT}\\Policy_${crypto.randomBytes(4).toString('hex')}`;
const SAMPLER_TASK = `CleanDrive\\DiskSample_${SUFFIX}`;

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-verify-console-'));
const SHARE_DIR = path.join('D:', path.sep, `cleandrive-verify-console-${crypto.randomBytes(4).toString('hex')}`);
const SHARE = `\\\\localhost\\D$\\${path.basename(SHARE_DIR)}`;

const children = new Set();
const undo = [];
process.on('exit', () => {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* gone */
    }
  }
  for (const step of undo.reverse()) {
    try {
      step();
    } catch {
      /* best effort */
    }
  }
  for (const dir of [SANDBOX, SHARE_DIR]) {
    try {
      if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('a link');
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind: ${dir})`);
    }
  }
});

function reg(args) {
  const r = spawnSync(REG, args, { windowsHide: true });
  return { status: r.status, stderr: (r.stderr || Buffer.alloc(0)).toString('latin1').trim() };
}

function writePolicy(values) {
  reg(['delete', HARNESS_KEY, '/f', '/reg:64']);
  const lines = ['Windows Registry Editor Version 5.00', '', `[${HARNESS_KEY}]`];
  for (const [name, value] of Object.entries(values)) {
    lines.push(typeof value === 'number' ? `"${name}"=dword:${value.toString(16).padStart(8, '0')}` : `"${name}"="${String(value).replace(/\\/g, '\\\\')}"`);
  }
  lines.push('');
  const file = path.join(SANDBOX, `p-${crypto.randomBytes(3).toString('hex')}.reg`);
  fs.writeFileSync(file, Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf16le'));
  const r = reg(['import', file, '/reg:64']);
  fs.rmSync(file, { force: true });
  if (r.status !== 0) throw new Error(`reg import failed: ${r.stderr}`);
}

const env = (over = {}) => {
  const out = { ...process.env, CLEANDRIVE_TASK_SUFFIX: SUFFIX, CLEANDRIVE_POLICY_KEY: HARNESS_KEY, CLEANDRIVE_ENTITLEMENTS: 'business', ...over };
  delete out.ELECTRON_RUN_AS_NODE;
  for (const [k, v] of Object.entries(over)) if (v === null) delete out[k];
  return out;
};

/** One Electron process to the end, with its output and how long it took. */
function run(args, over = {}, { timeoutMs = 3 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(ELECTRON, [REPO, ...args], { env: env(over), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.add(child);
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      children.delete(child);
      const bytes = Buffer.concat(out);
      let json = null;
      if (args.includes('--json')) {
        try {
          json = JSON.parse(bytes.toString('utf8'));
        } catch {
          json = undefined;
        }
      }
      resolve({ code, bytes, out: bytes.toString('utf8'), err, json, ms: Date.now() - started });
    });
  });
}

const cli = (dataDir, tokens, over) => run(['--cli', `--user-data-dir=${dataDir}`, ...tokens], over);
const sampler = (dataDir, over, opts) => run(['--sample-only', `--user-data-dir=${dataDir}`], over, opts);

const userData = (name) => {
  const dir = path.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const reportFile = () => path.join(SHARE_DIR, report.fileNameFor(os.hostname()));
const isAscii = (buf) => buf.every((b) => b < 0x7f);
const taskThere = (taskPath) => spawnSync(SCHTASKS, ['/Query', '/TN', taskPath], { windowsHide: true }).status === 0;

/* ------------------------------------------------------------ the console window, over CDP */

async function consoleWindow(dataDir, share, over = {}) {
  const port = 9300 + Math.floor(Math.random() * 300);
  const child = spawn(ELECTRON, [REPO, '--console', share, `--user-data-dir=${dataDir}`, `--remote-debugging-port=${port}`], {
    env: env(over),
    stdio: 'ignore',
    windowsHide: true,
  });
  children.add(child);
  const deadline = Date.now() + 60000;
  let target = null;
  while (Date.now() < deadline && !target) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && /console\.html/.test(t.url));
    } catch {
      /* not listening yet */
    }
  }
  if (!target) {
    child.kill();
    return { ok: false, why: 'no console page appeared on the debugging port' };
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const evaluate = (expression) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, (msg) => resolve(msg.result && msg.result.result ? msg.result.result.value : undefined));
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  const close = () => {
    try {
      ws.close();
    } catch {
      /* closed */
    }
    child.kill();
  };
  return { ok: true, evaluate, close, url: target.url };
}

async function settle(win, until, ms = 30000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await win.evaluate(`(() => {
      const rows = [...document.querySelectorAll('#console-rows tr[data-host]')].map((tr) => tr.dataset.host);
      return {
        rows,
        status: document.getElementById('console-status').textContent,
        gate: document.getElementById('console-gate').hidden ? null : document.getElementById('console-gate-text').textContent,
        share: document.getElementById('console-share').textContent,
        hidden: document.documentElement.hasAttribute('data-i18n-pending'),
      };
    })()`);
    if (last && until(last)) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}

/* ------------------------------------------------------------ the runs */

(async () => {
  console.log('\nconsole, real process: isolation first\n');
  undo.push(() => reg(['delete', HARNESS_KEY, '/f', '/reg:64']));
  undo.push(() => {
    if (taskThere(SAMPLER_TASK)) spawnSync(SCHTASKS, ['/Delete', '/TN', SAMPLER_TASK, '/F'], { windowsHide: true });
  });
  const main = userData('main');
  const version = await cli(main, ['version', '--json']);
  check('every run uses the harness\'s own user-data folder', version.code === 0 && version.json && path.resolve(version.json.dataDir).toLowerCase() === main.toLowerCase(), version.json && version.json.dataDir);
  fs.mkdirSync(SHARE_DIR);
  let viaSmb = true;
  try {
    fs.accessSync(SHARE);
  } catch {
    viaSmb = false;
  }
  check(`the share is reached through SMB: ${SHARE}`, viaSmb);
  if (failures > 0) throw new Error('not isolated, or no share; stopping before anything is written');

  /* ---- the daily measurement writes the report ---------------------------- */
  console.log('\nthe daily measurement, with a report policy\n');
  writePolicy({ ReportFolder: SHARE });
  const validate = await cli(main, ['policy', 'validate', '--json']);
  const mr = validate.json && validate.json.policies.find((p) => p.policy === 'MachineReport');
  check('validate: MachineReport applied, read with reg.exe from the harness key', validate.code === 0 && mr && mr.state === 'applied' && validate.json.source.key === HARNESS_KEY && validate.json.source.via === 'reg.exe',
    validate.json && JSON.stringify(validate.json.policies));
  const s1 = await sampler(main);
  const written = /report written to (.+) in (\d+) ms/.exec(s1.out);
  check('--sample-only exits 0 and says where the report went', s1.code === 0 && Boolean(written), `${s1.code}; ${s1.out.trim().split('\n').pop()}`);
  console.log(`    (whole process ${s1.ms} ms; the report itself ${written ? written[2] : '?'} ms)`);
  const file = reportFile();
  const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  const parsed = report.parse(bytes.toString('utf8'), { fileName: path.basename(file) });
  check(`the report is on the share, named after this machine (${path.basename(file)})`, parsed.ok && parsed.nameMatches && parsed.report.host === os.hostname(), parsed.why);
  check('ASCII, with the schema', bytes.length > 0 && isAscii(bytes) && JSON.parse(bytes.toString('utf8')).schema === 'cleandrive.machine-report/1');
  check('the measurement happened first: the history file is there', fs.existsSync(path.join(main, 'history.json')));
  const text = bytes.toString('utf8');
  const personal = [os.userInfo().username, os.homedir(), main, SANDBOX].filter((p) => p && p.length > 2);
  const leaked = personal.filter((p) => text.toLowerCase().includes(p.toLowerCase()) || text.includes(JSON.stringify(p).slice(1, -1)));
  check('it names no account, home folder or data folder of this machine', leaked.length === 0, leaked.join(', '));
  check('drives by letter, and a forecast or the reason there is none', parsed.ok && parsed.report.volumes.length > 0 && parsed.report.volumes.every((v) => /^[A-Z]:\\$/.test(v.root) && v.fullIn),
    parsed.ok && parsed.report.volumes.map((v) => `${v.root} ${v.fullIn && v.fullIn.ok ? 'forecast' : v.fullIn && v.fullIn.reason ? v.fullIn.reason.i18n : '?'}`).join('; '));

  /* ---- no Business, no report --------------------------------------------- */
  console.log('\nwithout CleanDrive Business\n');
  fs.rmSync(file, { force: true });
  const noBiz = await cli(main, ['policy', 'validate', '--json'], { CLEANDRIVE_ENTITLEMENTS: 'pro' });
  const mrNo = noBiz.json && noBiz.json.policies.find((p) => p.policy === 'MachineReport');
  check('validate says it needs Business (3)', noBiz.code === 3 && mrNo && mrNo.state === 'needsBusiness');
  const s2 = await sampler(main, { CLEANDRIVE_ENTITLEMENTS: 'pro' });
  check('the measurement still runs (0), and no report is written', s2.code === 0 && !fs.existsSync(file) && !/report written/.test(s2.out));

  /* ---- no folder named, no report ----------------------------------------- */
  writePolicy({ DisableUpdateCheck: 1 });
  const s3 = await sampler(main);
  check('a policy that names no report folder: no report', s3.code === 0 && !fs.existsSync(file));

  /* ---- policy apply, on a machine where nobody opened the app ------------- */
  console.log('\ncleandrive policy apply\n');
  writePolicy({ ReportFolder: SHARE, ReportTopFolders: 1 });
  const fresh = userData('fresh');
  const apply = await cli(fresh, ['policy', 'apply', '--json']);
  check('apply: the daily measurement\'s task registered (no settings file here), and one report written at once',
    apply.code === 0 && apply.json && apply.json.sampler && apply.json.sampler.installed && apply.json.sampler.ok && apply.json.report && apply.json.report.ok,
    apply.json ? JSON.stringify({ sampler: apply.json.sampler, report: apply.json.report, problems: apply.json.problems }) : apply.err.slice(-300));
  check('the report is there', fs.existsSync(file));
  const printed = await cli(fresh, ['report', '--json']);
  check('`cleandrive report --json`: the same kind of document, ASCII', printed.code === 0 && printed.json && printed.json.schema === report.SCHEMA && printed.json.host === os.hostname() && isAscii(printed.bytes));

  /* ---- the console window ------------------------------------------------- */
  console.log('\nCleanDrive --console\n');
  const consoleData = userData('console');
  const win = await consoleWindow(consoleData, SHARE);
  if (!win.ok) check('the console window opens', false, win.why);
  else {
    const seen = await settle(win, (s) => s.rows.length > 0 || /could not be read/.test(s.status));
    check('the console window opens on console.html and draws this machine from the share',
      seen && seen.rows.includes(os.hostname().toLowerCase()) && !seen.hidden, seen && JSON.stringify(seen));
    check('it remembers the seals in its own folder', fs.existsSync(path.join(consoleData, 'console-seen.json')));
    win.close();
  }
  const winNo = await consoleWindow(userData('console-pro'), SHARE, { CLEANDRIVE_ENTITLEMENTS: 'pro' });
  if (!winNo.ok) check('the console window opens without Business too', false, winNo.why);
  else {
    const seen = await settle(winNo, (s) => Boolean(s.gate));
    check('without Business it says so and reads nothing', seen && seen.gate && /Business/.test(seen.gate) && seen.rows.length === 0, seen && JSON.stringify(seen));
    winNo.close();
  }

  /* ---- a share that does not answer --------------------------------------- */
  if (!SKIP_DEAD) {
    console.log('\na share that does not answer (this takes as long as Windows does)\n');
    const dead = `\\\\10.255.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}\\reports`;
    writePolicy({ ReportFolder: dead });
    const beforeHistory = fs.statSync(path.join(main, 'history.json')).mtimeMs;
    const s4 = await sampler(main, {}, { timeoutMs: 4 * 60 * 1000 });
    const afterHistory = fs.statSync(path.join(main, 'history.json')).mtimeMs;
    check(`${dead}: the measurement is recorded and the exit code is 0`, s4.code === 0 && afterHistory > beforeHistory, `code ${s4.code}`);
    check('and the failure is said, not swallowed', /could not be written/.test(s4.err), s4.err.trim().split('\n').pop());
    console.log(`    (the process lived ${(s4.ms / 1000).toFixed(1)} s; the task's limit is 5 min)`);
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
