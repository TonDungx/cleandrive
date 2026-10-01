#!/usr/bin/env node
'use strict';

// The organisation's policy (H2), as a real process, against real things.
//
//   node scripts/verify-policy.js              a key of the harness's own, under HKCU
//   node scripts/verify-policy.js --elevated   from an elevated terminal: the real
//                                              HKLM\SOFTWARE\Policies\CleanDrive, its
//                                              permissions, and reg.exe under
//                                              DisableRegistryTools
//
// What scripts/test-policy.js cannot show, because it runs under plain Node
// with reg.exe replaced:
//
//   - System32\reg.exe really exports the key, Vietnamese intact, REG_EXPAND_SZ
//     expanded for this account, through the Electron main process;
//   - `cleandrive policy validate` and `apply` exit with their codes;
//   - `apply` registers a real Windows task for the organisation's profile on a
//     user-data folder with no settings file in it, and removes it again once
//     the policy stops asking;
//   - the organisation's profile, report-only, reports and moves nothing; under
//     view only even a live one moves nothing; switched live, it moves the
//     harness's own file to the real Recycle Bin, and restore puts it back
//     byte for byte.
//
// Isolation, proved first and again at the end: every run has its own
// --user-data-dir (`version --json` must name it), the policy is read from
// HKCU\Software\CleanDrive-Harness\Policy_<random> -- never a `Policies` key, which a
// user cannot write anyway -- and `policy validate` must name that key. Task
// names carry CLEANDRIVE_TASK_SUFFIX. The real HKLM key is only read, and
// must be in the same state before and after. The fixture is on D:. On exit
// the harness key, the fixture and any task left under the suffix are removed.
//
// --elevated writes the real machine key, so it refuses to run when one is
// already there (that would be somebody's policy), and deletes it on exit.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const REPO = path.join(__dirname, '..');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');
const ELEVATED = process.argv.includes('--elevated');
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const REG = path.join(SYSTEM32, 'reg.exe');
const SCHTASKS = path.join(SYSTEM32, 'schtasks.exe');
const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const DAY = 24 * 60 * 60 * 1000;
const VI = 'Thư mục của tôi — Ảnh';

const SUFFIX = 'verifypolicy';
const MACHINE_KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\CleanDrive';
const HARNESS_PARENT = 'HKEY_CURRENT_USER\\Software\\CleanDrive-Harness';
const HARNESS_KEY = `${HARNESS_PARENT}\\Policy_${crypto.randomBytes(4).toString('hex')}`;
const TASK = `CleanDrive\\AutomaticCleanup_policy_${SUFFIX}`;
const DRT_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-verify-policy-'));
const FIXTURE = path.join('D:', path.sep, `cleandrive-verify-policy-${crypto.randomBytes(4).toString('hex')}`);

/* ------------------------------------------------------------ cleanup */

const undo = [];
process.on('exit', () => {
  for (const step of undo.reverse()) {
    try {
      step();
    } catch {
      /* best effort; each step says what it leaves */
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

function reg(args) {
  const r = spawnSync(REG, args, { windowsHide: true });
  return { status: r.status, stderr: (r.stderr || Buffer.alloc(0)).toString('latin1').trim() };
}

/** `reg export` into a file of ours: 0 when the key is there and readable. */
function exportStatus(key) {
  const file = path.join(SANDBOX, `x-${crypto.randomBytes(3).toString('hex')}.reg`);
  const r = reg(['export', key, file, '/y', '/reg:64']);
  const text = fs.existsSync(file) ? fs.readFileSync(file).toString('utf16le') : '';
  fs.rmSync(file, { force: true });
  return { ...r, text };
}

/** A .reg file, UTF-16 with its mark, the way reg.exe writes one; values typed by shape. */
function regFile(key, sections) {
  const lines = ['Windows Registry Editor Version 5.00', ''];
  for (const [rel, values] of Object.entries(sections)) {
    lines.push(`[${rel ? `${key}\\${rel}` : key}]`);
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === 'number') lines.push(`"${name}"=dword:${value.toString(16).padStart(8, '0')}`);
      else if (value && value.expand) {
        const hex = [...Buffer.from(`${value.expand}\0`, 'utf16le')].map((b) => b.toString(16).padStart(2, '0')).join(',');
        lines.push(`"${name}"=hex(2):${hex}`);
      } else lines.push(`"${name}"="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
    lines.push('');
  }
  const file = path.join(SANDBOX, `import-${crypto.randomBytes(3).toString('hex')}.reg`);
  fs.writeFileSync(file, Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf16le'));
  return file;
}

function importInto(key, sections) {
  const file = regFile(key, sections);
  const r = reg(['import', file, '/reg:64']);
  fs.rmSync(file, { force: true });
  return r.status === 0;
}

const taskThere = (taskPath) => spawnSync(SCHTASKS, ['/Query', '/TN', taskPath], { windowsHide: true }).status === 0;

function powershell(script) {
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true,
    encoding: 'utf8',
  });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/* ------------------------------------------------------------ the CLI */

const env = (over = {}) => {
  const out = { ...process.env, CLEANDRIVE_TASK_SUFFIX: SUFFIX, ...over };
  delete out.ELECTRON_RUN_AS_NODE;
  for (const [k, v] of Object.entries(over)) if (v === null) delete out[k];
  return out;
};

function cli(dataDir, tokens, over = {}) {
  return new Promise((resolve) => {
    const child = spawn(ELECTRON, [REPO, '--cli', `--user-data-dir=${dataDir}`, ...tokens], {
      env: env(over),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
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

const userData = (name) => {
  const dir = path.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const ascii = (buf) => buf.every((b) => b < 0x7f);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const states = (json) => Object.fromEntries(((json && json.policies) || []).filter((p) => p.policy).map((p) => [p.policy, p.state]));
const last = (r) => r.err.trim().split('\n').pop();

/** Which programs on the app's default skip list are open now. */
function runningSkipList() {
  const { DEFAULT_SKIP_PROCESSES } = require('../src/main/lib/settings');
  let out = '';
  try {
    out = execFileSync(path.join(SYSTEM32, 'tasklist.exe'), ['/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  } catch {
    return [];
  }
  const names = new Set(out.split(/\r?\n/).map((line) => (/^"([^"]+)"/.exec(line) || [])[1]).filter(Boolean).map((n) => n.toLowerCase()));
  return DEFAULT_SKIP_PROCESSES.filter((p) => names.has(p.toLowerCase()));
}

function integrity() {
  try {
    const out = execFileSync(path.join(SYSTEM32, 'whoami.exe'), ['/groups', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    return out.includes('S-1-16-12288') || out.includes('S-1-16-16384') ? 'high' : 'medium';
  } catch {
    return 'unknown';
  }
}

/* ------------------------------------------------------------ the runs */

async function unelevated() {
  console.log('\npolicy, real process: isolation first\n');
  const machineBefore = exportStatus(MACHINE_KEY);
  console.log(`  (the real machine key: ${machineBefore.status === 0 ? 'present' : 'absent'}; it is only read here)`);
  check('the harness key does not exist yet', exportStatus(HARNESS_KEY).status !== 0, HARNESS_KEY);
  undo.push(() => reg(['delete', HARNESS_KEY, '/f', '/reg:64']));
  undo.push(() => {
    // The parent only if nothing else of a harness is under it.
    const left = exportStatus(HARNESS_PARENT);
    if (left.status === 0 && !/\[HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\/i.test(left.text)) reg(['delete', HARNESS_PARENT, '/f', '/reg:64']);
  });
  undo.push(() => {
    if (taskThere(TASK)) spawnSync(SCHTASKS, ['/Delete', '/TN', TASK, '/F'], { windowsHide: true });
  });

  const data = userData('main');
  const version = await cli(data, ['version', '--json']);
  check('the command line uses the harness\'s own user-data folder', version.code === 0 && version.json && path.resolve(version.json.dataDir).toLowerCase() === data.toLowerCase(), version.json && version.json.dataDir);
  if (failures > 0) throw new Error('not isolated; stopping before anything is written');

  const isolated = await cli(data, ['policy', 'validate', '--json'], { CLEANDRIVE_POLICY_KEY: null });
  check('with its own userData and no key named, a checkout reads no policy at all', isolated.code === 0 && isolated.json && isolated.json.source.key === null && isolated.json.status === 'none', isolated.json && JSON.stringify(isolated.json.source));
  const refusedKey = await cli(data, ['policy', 'validate', '--json'], { CLEANDRIVE_POLICY_KEY: 'HKEY_CURRENT_USER\\Software\\Policies\\Anything' });
  check('and a key outside the harness prefix is not read either', refusedKey.json && refusedKey.json.source.key === null);

  /* ---- a policy, through the real reg.exe -------------------------------- */
  console.log('\npolicy validate, through the real reg.exe\n');
  const old = Date.now() - 60 * DAY;
  const root = path.join(FIXTURE, VI);
  fs.mkdirSync(root, { recursive: true });
  const victim = path.join(root, 'left-behind.tmp');
  const body = crypto.randomBytes(40000);
  fs.writeFileSync(victim, body);
  fs.utimesSync(victim, new Date(old), new Date(old));
  const victimHash = sha(victim);
  // The folder the policy names for the quarantine must exist: the app makes
  // the zone inside it, as it does for a folder somebody picks, never the
  // folder itself.
  fs.mkdirSync(path.join(FIXTURE, 'q'), { recursive: true });

  const policy = {
    '': { ViewOnly: 1, AutomaticCleanup: 1, AllowedCategories: 1, ProtectedFolders: 1, DisableUpdateCheck: 1, QuarantineFolder: { expand: `${FIXTURE}\\q` }, ViewOnyl: 1 },
    Automatic: { Schedule: 'weekly', Time: '02:00', Weekday: 0, Day: 1, ReportOnly: 1, Action: 'recycle', MinAgeDays: 7, MinDiskUsedPercent: 0 },
    'Automatic\\Folders': { 1: root },
    AllowedCategories: { temp: 1, log: 1 },
    ProtectedFolders: { 1: { expand: `%USERPROFILE%\\${VI}` }, 2: `D:\\${VI}` },
  };
  check('the harness key is written (HKCU, no administrator)', importInto(HARNESS_KEY, policy));
  const keyed = { CLEANDRIVE_POLICY_KEY: HARNESS_KEY, CLEANDRIVE_ENTITLEMENTS: 'business' };
  const v1 = await cli(data, ['policy', 'validate', '--json'], keyed);
  check('validate names the harness key, read with reg.exe', v1.json && v1.json.source.key === HARNESS_KEY && v1.json.source.via === 'reg.exe' && v1.json.status === 'present', v1.json && JSON.stringify(v1.json.source));
  const s1 = states(v1.json);
  check('every policy applied with Business', ['ViewOnly', 'AutomaticCleanup', 'AllowedCategories', 'ProtectedFolders', 'DisableUpdateCheck', 'QuarantineFolder'].every((p) => s1[p] === 'applied'), JSON.stringify(s1));
  check('the misspelt value is reported, and it makes the exit code 2', v1.code === 2 && v1.json.policies.some((p) => p.state === 'unknown' && /ViewOnyl/.test(p.message)));
  check('--json is ASCII down the pipe', ascii(v1.bytes));
  const expected = path.join(os.homedir(), VI);
  check('REG_EXPAND_SZ expanded for this account, and the Vietnamese exact', v1.json && v1.json.effective.protectedFolders[0].toLowerCase() === expected.toLowerCase() && v1.json.effective.protectedFolders[1] === `D:\\${VI}`, v1.json && v1.json.effective.protectedFolders.join(' | '));
  check('the organisation\'s profile: report only, the allowed categories, the protected folders', v1.json && v1.json.policies.find((p) => p.policy === 'AutomaticCleanup').profile.reportOnly === true &&
    v1.json.policies.find((p) => p.policy === 'AutomaticCleanup').profile.categories.join() === 'temp,log');

  reg(['delete', HARNESS_KEY, '/v', 'ViewOnyl', '/f', '/reg:64']);
  const v2 = await cli(data, ['policy', 'validate', '--json'], keyed);
  check('fixed: 0', v2.code === 0, last(v2));
  const v3 = await cli(data, ['policy', 'validate', '--json'], { CLEANDRIVE_POLICY_KEY: HARNESS_KEY, CLEANDRIVE_ENTITLEMENTS: 'pro' });
  const s3 = states(v3.json);
  check('without Business: the acting half is not applied, the tightening half is, and the code is 3',
    v3.code === 3 && s3.AutomaticCleanup === 'needsBusiness' && s3.QuarantineFolder === 'needsBusiness' && s3.ViewOnly === 'applied' && s3.ProtectedFolders === 'applied', JSON.stringify(s3));

  const file = regFile(MACHINE_KEY, { '': { ViewOnly: 1 }, ProtectedFolders: {} });
  const v4 = await cli(data, ['policy', 'validate', file, '--json'], keyed);
  check('validate <file.reg> reads the file (UTF-16, as reg.exe writes one)', v4.code === 0 && v4.json && v4.json.source.kind === 'file' && v4.json.effective.viewOnly === true, last(v4));

  /* ---- apply: a real task, with no settings file ------------------------- */
  console.log('\npolicy apply, and a real Windows task\n');
  check('there is no settings file in this user-data folder', !fs.existsSync(path.join(data, 'settings.json')));
  check('and no task under the suffix yet', !taskThere(TASK), TASK);
  // A task registered under CLEANDRIVE_TASK_SUFFIX is removed by the process
  // that made it when it exits (scheduler.js, ROADMAP §11 item 13), so the
  // proof that Windows holds it is the one taken inside that process: the
  // reconciliation reads the registered definition back from Task Scheduler
  // and compares the command line and the schedule with the profile's.
  const a1 = await cli(data, ['policy', 'apply', '--json'], keyed);
  const task = a1.json && a1.json.tasks.find((t) => t.profileId === 'policy');
  check('apply: 0, and Task Scheduler read back the organisation\'s task as registered', a1.code === 0 && task && task.installed && task.ok && task.taskPath === TASK, last(a1));
  check('said as a change, in the organisation\'s name', a1.json && a1.json.changes.some((c) => /organisation’s cleanup: no Windows task was registered/.test(c)), a1.json && a1.json.changes.join(' | '));
  check('the quarantine zone inside the organisation\'s folder is made', a1.json && a1.json.quarantineZone && a1.json.quarantineZone.ok && fs.existsSync(path.join(FIXTURE, 'q', 'CleanDrive Quarantine')));
  check('and the harness\'s own task is gone once that process has exited', !taskThere(TASK));
  check('apply registered nothing else: no daily measurement', !taskThere(`CleanDrive\\DiskSample_${SUFFIX}`));
  check('apply wrote no settings file', !fs.existsSync(path.join(data, 'settings.json')));

  /* ---- the organisation's profile, run ------------------------------------ */
  console.log('\nrun --profile policy\n');
  // The organisation's profile skips while a program on the app's default
  // list is open, as every profile does. On a developer's machine that is
  // usually Code.exe; then that gate is what is shown, and the run past it is
  // left to verify-cli, which runs the same function on a profile of its own.
  const open = runningSkipList();
  if (open.length > 0) console.log(`  (open now: ${open.join(', ')} -- the profile is expected to stop at that gate)`);
  const r1 = await cli(data, ['run', '--profile', 'policy', '--json'], keyed);
  if (open.length > 0) {
    check('report only, with a program on the skip list open: skipped, saying which, nothing moved',
      r1.code === 2 && r1.json.outcome === 'skipped' && open.some((p) => String(r1.json.reason).includes(p)) && fs.existsSync(victim), r1.json && r1.json.reason);
  } else {
    check('report only: 0, the file named, nothing moved', r1.code === 0 && r1.json.outcome === 'dry-run' && r1.json.selected.files === 1 && fs.existsSync(victim), r1.json && `${r1.json.outcome} ${r1.json.selected.files}`);
  }
  reg(['add', `${HARNESS_KEY}\\Automatic`, '/v', 'ReportOnly', '/t', 'REG_DWORD', '/d', '0', '/f', '/reg:64']);
  const r2 = await cli(data, ['run', '--profile', 'policy', '--json'], keyed);
  check('switched live but view only still set: 2, said in the organisation\'s words, nothing moved',
    r2.code === 2 && r2.json.outcome === 'skipped' && /view only/.test(r2.json.reason) && fs.existsSync(victim) && sha(victim) === victimHash, r2.json && `${r2.json.outcome} ${r2.json.reason}`);
  reg(['delete', HARNESS_KEY, '/v', 'ViewOnly', '/f', '/reg:64']);
  const r3 = await cli(data, ['run', '--profile', 'policy', '--json'], keyed);
  if (open.length > 0) {
    check('view only lifted, live, a program on the skip list open: skipped, nothing moved',
      r3.code === 2 && r3.json.outcome === 'skipped' && fs.existsSync(victim) && sha(victim) === victimHash, r3.json && r3.json.reason);
    console.log('  (the live move and its restore need those programs closed; run this again without them to see it)');
  } else {
    const session = r3.json && r3.json.session;
    check('view only lifted: the organisation\'s profile moves the file to the Recycle Bin', r3.code === 0 && r3.json.moved.files === 1 && !fs.existsSync(victim) && /^s_[0-9a-f]{8}$/.test(session || ''), r3.json && `${r3.json.outcome} ${r3.json.moved.files}`);
    if (session) {
      const back = await cli(data, ['restore', session, '--json'], keyed);
      check('and restore puts it back byte for byte', back.code === 0 && fs.existsSync(victim) && sha(victim) === victimHash, last(back));
    }
  }

  /* ---- the policy stops asking ------------------------------------------ */
  console.log('\nthe policy lifted\n');
  reg(['delete', HARNESS_KEY, '/v', 'AutomaticCleanup', '/f', '/reg:64']);
  const a3 = await cli(data, ['policy', 'apply', '--json'], keyed);
  check('lifted: apply no longer lists the organisation\'s profile, and nothing is registered', a3.code === 0 && !a3.json.tasks.some((t) => t.profileId === 'policy') && !taskThere(TASK), a3.json && JSON.stringify(a3.json.tasks));
  const r4 = await cli(data, ['run', '--profile', 'policy'], keyed);
  check('and with no settings file there is no profile to run: 2, said', r4.code === 2 && /No settings file was found/.test(r4.err), last(r4));

  reg(['delete', HARNESS_KEY, '/f', '/reg:64']);
  check('the harness key is removed', exportStatus(HARNESS_KEY).status !== 0);
  const machineAfter = exportStatus(MACHINE_KEY);
  check('the real machine key is as it was', machineAfter.status === machineBefore.status && machineAfter.text === machineBefore.text);
}

async function elevated() {
  console.log('\npolicy, elevated: the real machine key\n');
  if (integrity() !== 'high') throw new Error('--elevated needs this script itself to run from an elevated terminal');
  const before = exportStatus(MACHINE_KEY);
  if (before.status === 0) throw new Error(`${MACHINE_KEY} already exists on this machine. It is somebody's policy, so this harness will not touch it.`);
  undo.push(() => reg(['delete', MACHINE_KEY, '/f', '/reg:64']));

  const data = userData('elevated');
  const machine = { CLEANDRIVE_POLICY_KEY: 'machine', CLEANDRIVE_ENTITLEMENTS: 'pro' };
  check('the real key is written', importInto(MACHINE_KEY, { '': { ViewOnly: 1, ProtectedFolders: 1, DisableUpdateCheck: 1 }, ProtectedFolders: { 1: `D:\\${VI}` } }));
  const v = await cli(data, ['policy', 'validate', '--json'], machine);
  check('validate reads HKLM\\SOFTWARE\\Policies\\CleanDrive with reg.exe', v.code === 0 && v.json && v.json.source.key === MACHINE_KEY && v.json.source.via === 'reg.exe', v.json && JSON.stringify(v.json.source));
  check('the tightening half applies without Business', v.json && v.json.effective.viewOnly === true && v.json.effective.updatesOff === true && v.json.effective.protectedFolders[0] === `D:\\${VI}`);

  // Through the key object: in Windows PowerShell 5.1, `Get-Acl -LiteralPath`
  // answers "cannot find path" for a registry key that is there (measured
  // 2026-10-02, on the first elevated run). And the entry that lets a person
  // without administrator rights read `Policies` on this machine is
  // Authenticated Users (S-1-5-11), not BUILTIN\Users -- either counts.
  const acl = powershell(
    "$k = Get-Item -LiteralPath 'HKLM:\\SOFTWARE\\Policies\\CleanDrive'; $k.GetAccessControl().Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value + '|' + $_.RegistryRights + '|' + $_.IsInherited + '|' + $_.AccessControlType }"
  );
  const readers = acl.out.split(/\r?\n/).filter((line) => /^S-1-5-(11|32-545)\|/.test(line) && /ReadKey|FullControl/.test(line) && /\|Allow$/.test(line));
  check('a person without administrator rights may read the key (Authenticated Users or Users, inherited from Policies)', readers.length > 0, readers.join(' ; ') || acl.out || acl.err);

  // reg.exe under DisableRegistryTools: measured here, and the fallback with it.
  const drtBefore = powershell(`$v=(Get-ItemProperty -LiteralPath '${DRT_KEY}' -Name DisableRegistryTools -ErrorAction SilentlyContinue).DisableRegistryTools; if ($null -eq $v) { 'none' } else { [string]$v }`);
  if (drtBefore.out !== 'none') {
    console.log(`  (DisableRegistryTools is already ${drtBefore.out} for this account; not touched, not measured)`);
  } else {
    const createdKey = powershell(`if (Test-Path -LiteralPath '${DRT_KEY}') { 'had' } else { 'made' }`).out === 'made';
    const restore = () =>
      powershell(createdKey ? `Remove-Item -LiteralPath '${DRT_KEY}' -Recurse -Force` : `Remove-ItemProperty -LiteralPath '${DRT_KEY}' -Name DisableRegistryTools -Force`);
    undo.push(restore);
    console.log(`  (if this is interrupted: ${createdKey ? `Remove-Item -LiteralPath '${DRT_KEY}' -Recurse -Force` : `Remove-ItemProperty -LiteralPath '${DRT_KEY}' -Name DisableRegistryTools`})`);
    for (const value of [1, 2]) {
      const set = powershell(`if (-not (Test-Path -LiteralPath '${DRT_KEY}')) { New-Item -Path '${DRT_KEY}' -Force | Out-Null }; New-ItemProperty -LiteralPath '${DRT_KEY}' -Name DisableRegistryTools -PropertyType DWord -Value ${value} -Force | Out-Null; 'ok'`);
      if (set.out !== 'ok') {
        check(`DisableRegistryTools=${value} could be set`, false, set.err);
        continue;
      }
      const raw = exportStatus(MACHINE_KEY);
      console.log(`  measured: DisableRegistryTools=${value}: reg export exit ${raw.status}${raw.stderr ? ` ("${raw.stderr}")` : ''}`);
      const under = await cli(data, ['policy', 'validate', '--json'], machine);
      check(`under DisableRegistryTools=${value} the policy is still read (via ${under.json ? under.json.source.via : '?'})`,
        under.json && under.json.status === 'present' && under.json.effective.viewOnly === true, under.json && JSON.stringify(under.json.source));
    }
    restore();
    const drtAfter = powershell(`$v=(Get-ItemProperty -LiteralPath '${DRT_KEY}' -Name DisableRegistryTools -ErrorAction SilentlyContinue).DisableRegistryTools; if ($null -eq $v) { 'none' } else { [string]$v }`);
    check('DisableRegistryTools is gone again', drtAfter.out === 'none', drtAfter.out);
  }

  reg(['delete', MACHINE_KEY, '/f', '/reg:64']);
  check('the machine key is removed again', exportStatus(MACHINE_KEY).status !== 0);
}

(async () => {
  if (ELEVATED) await elevated();
  else await unelevated();
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err.message || err);
  process.exit(1);
});
