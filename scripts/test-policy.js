#!/usr/bin/env node
'use strict';

// The organisation's policy (H2), under plain Node.
//
//   node scripts/test-policy.js
//
// What it proves, in the order a policy travels:
//
//   1. the registry is read the way it was measured to need (reg.exe export,
//      /reg:64, absent told apart from unreadable, PowerShell when reg.exe is
//      refused) -- with reg.exe and PowerShell replaced, so nothing is read;
//   2. every value is applied, refused with its reason, or reported as needing
//      Business -- never replaced by a default when it is there but wrong;
//   3. the policy wins on screen and never reaches settings.json, and when it
//      is lifted the person's own choices are where they left them;
//   4. view only stops every door that changes a file -- the pipeline, the
//      unattended run, the purge, the restore's "replace" -- and lets restore
//      and a handoff through;
//   5. the ADMX and ADML in the repository are what the code writes, and every
//      value they write is one the reader reads;
//   6. `cleandrive policy validate|apply`, with the exit codes and --json.
//
// What it cannot prove is in scripts/verify-policy.js (a real registry key, a
// real Electron process, a real Windows task) and the rest is [Unverified]:
// that the files load in the Group Policy editor, which this machine (Windows
// 11 Home) does not have.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const schema = require('../src/main/policy/schema');
const { readPolicy, readRegFile, isHarnessKey, MACHINE_KEY, treeOf } = require('../src/main/policy/read');
const { interpret, expandEnv } = require('../src/main/policy/interpret');
const { effective, toFile } = require('../src/main/policy/effective');
const { PolicySource } = require('../src/main/policy/source');
const { ManagedSettingsStore } = require('../src/main/policy/store');
const admx = require('../src/main/policy/admx');
const settingsLib = require('../src/main/lib/settings');
const { SettingsStore, coerceSettings, DEFAULT_CATEGORIES, SAFE_CATEGORIES } = settingsLib;
const { execute } = require('../src/main/actions/execute');
const restoreHandler = require('../src/main/actions/restore');
const { runAutoClean } = require('../src/main/lib/autoclean');
const { main } = require('../src/main/cli');
const { EXIT } = require('../src/main/cli/codes');
const { isSystemAccount } = require('../src/main/cli/commands/policy');
const { message: m } = require('../src/i18n');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;
const VI = 'Thư mục của tôi — Ảnh';

// On D:, never under os.tmpdir(): that is inside AppData on this machine, and
// a run that refused AppData would make "nothing was selected" pass for the
// wrong reason.
const FIXTURE = path.join('D:', path.sep, `cleandrive-test-policy-${crypto.randomBytes(4).toString('hex')}`);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-test-policy-data-'));
process.on('exit', () => {
  for (const dir of [FIXTURE, DATA]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the harness's own folder */
    }
  }
});

/* ------------------------------------------------------------ helpers */

/** A .reg file's text for the policy key, as reg.exe exports it. */
function regText(sections, key = MACHINE_KEY) {
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
  return lines.join('\r\n');
}

/** A tree as read.js hands it to interpret(), straight from a .reg text. */
const treeFrom = (sections) => readRegFile(Buffer.from(`\uFEFF${regText(sections)}`, 'utf16le')).tree;
const read = (sections) => ({ status: 'present', key: MACHINE_KEY, via: 'test', tree: treeFrom(sections), error: null });
const entryOf = (policy, name) => policy.entries.find((e) => e.policy === name) || null;
const ENV = { USERPROFILE: 'C:\\Users\\tester', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local', SystemRoot: 'C:\\Windows' };

/** A fake reg.exe: `answers` maps an exported key to its .reg text, or null for exit 1. */
function fakeReg(answers, calls) {
  return {
    run: async (args) => {
      calls.push(args);
      const [, key, file] = args;
      const text = Object.prototype.hasOwnProperty.call(answers, key) ? answers[key] : null;
      if (text === null) return { ok: false, code: 1, stderr: 'ERROR: The system was unable to find the specified registry key or value.' };
      fs.writeFileSync(file, Buffer.from(`\uFEFF${text}`, 'utf16le'));
      return { ok: true, code: 0, stderr: '' };
    },
    scratch: async () => fs.mkdtempSync(path.join(DATA, 'reg-')),
  };
}

(async () => {
  fs.mkdirSync(FIXTURE, { recursive: true });
  check('the fixture is on D: and outside AppData', /^D:\\/i.test(FIXTURE) && !FIXTURE.toLowerCase().includes('appdata'), FIXTURE);

  /* ==================================================================== 1 */
  console.log('\npolicy: reading the registry\n');

  {
    const calls = [];
    const got = await readPolicy({ deps: fakeReg({ [MACHINE_KEY]: regText({ '': { ViewOnly: 1, QuarantineFolder: `D:\\${VI}` } }) }, calls) });
    check('a key that is there is read with one export', got.status === 'present' && calls.length === 1 && got.via === 'reg.exe');
    check('through reg.exe export, into a file, with /reg:64', calls[0][0] === 'export' && calls[0][1] === MACHINE_KEY && calls[0].includes('/reg:64') && calls[0].includes('/y'));
    check('a Vietnamese folder name arrives intact', got.tree[''].quarantinefolder.value === `D:\\${VI}`, JSON.stringify(got.tree[''].quarantinefolder));
    check('and a DWORD as a number', got.tree[''].viewonly.value === 1);
  }
  {
    const calls = [];
    const parent = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies';
    const got = await readPolicy({ deps: fakeReg({ [MACHINE_KEY]: null, [parent]: regText({ '': { x: 1 } }, `${parent}\\Adobe`) }, calls) });
    check('a key that is not there: the parent is asked, and it is "none"', got.status === 'none' && calls.length === 2 && calls[1][1] === parent, JSON.stringify(calls.map((c) => c[1])));
    check('both exports used /reg:64', calls.every((c) => c.includes('/reg:64')));
  }
  {
    const calls = [];
    const ps = [];
    const got = await readPolicy({
      deps: {
        ...fakeReg({}, calls),
        powershell: async (key) => {
          ps.push(key);
          return { ok: true, stdout: JSON.stringify({ exists: true, keys: { '.': { ViewOnly: 1 }, 'ProtectedFolders': { 1: `C:\\${VI}` } } }) };
        },
      },
    });
    check('reg.exe refused for the key and its parent: PowerShell reads it', got.status === 'present' && got.via === 'powershell' && ps[0] === MACHINE_KEY);
    check('and its answer has the same shape', got.tree[''].viewonly.value === 1 && got.tree.protectedfolders['1'].value === `C:\\${VI}`);
  }
  {
    const got = await readPolicy({ deps: { ...fakeReg({}, []), powershell: async () => ({ ok: true, stdout: '{"exists":false}' }) } });
    check('PowerShell says the key is not there: "none"', got.status === 'none' && got.via === 'powershell');
  }
  {
    const got = await readPolicy({ deps: { ...fakeReg({}, []), powershell: async () => ({ ok: false, error: 'blocked by policy' }) } });
    check('nothing can read it: "unreadable", with both reasons', got.status === 'unreadable' && /reg\.exe/.test(got.error) && /blocked by policy/.test(got.error), got.error);
    const p = interpret(got, { acting: true, env: ENV });
    check('and an unreadable policy applies nothing (decided: fail open, said out loud)',
      !p.viewOnly && p.automatic === null && p.entries.length === 1 && p.entries[0].state === 'unreadable');
  }
  {
    const calls = [];
    const got = await readPolicy({ key: null, deps: fakeReg({}, calls) });
    check('no key (an isolated harness): no policy, and nothing is started', got.status === 'none' && calls.length === 0);
  }
  {
    const utf16 = readRegFile(Buffer.from(`\uFEFF${regText({ '': { ViewOnly: 1 } })}`, 'utf16le'));
    const utf8 = readRegFile(Buffer.from(regText({ '': { ViewOnly: 1 } }), 'utf8'));
    const other = readRegFile(Buffer.from(regText({ '': { x: 1 } }, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Other'), 'utf8'));
    check('a .reg file is read whether reg.exe wrote it (UTF-16) or a person did (UTF-8)', utf16.tree[''].viewonly.value === 1 && utf8.tree[''].viewonly.value === 1);
    check('and one with nothing under the key says so', other.tree === null && other.keys.length === 1);
    const tree = treeOf({ [MACHINE_KEY.toLowerCase()]: { A: 1 }, [`${MACHINE_KEY}\\AUTOMATIC`]: { B: 2 } }, MACHINE_KEY);
    check('key and value names are not case-sensitive', tree[''].a.value === 1 && tree.automatic.b.value === 2);
  }
  {
    check('a harness key is under the harness prefix only',
      isHarnessKey('HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\Policy_test') &&
        !isHarnessKey(MACHINE_KEY) &&
        !isHarnessKey('HKEY_CURRENT_USER\\Software\\Policies\\CleanDrive') &&
        !isHarnessKey('HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\..\\Microsoft') &&
        !isHarnessKey('HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\'));
    const { policyKeyFor } = loadServicesKeyRule();
    check('an installed copy reads the organisation\'s key whatever the environment says',
      policyKeyFor({ packaged: true, defaultUserData: false, env: { CLEANDRIVE_POLICY_KEY: 'HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\X' } }) === MACHINE_KEY);
    check('a checkout with the real userData reads it too', policyKeyFor({ packaged: false, defaultUserData: true, env: {} }) === MACHINE_KEY);
    check('a harness with its own userData reads no policy at all', policyKeyFor({ packaged: false, defaultUserData: false, env: {} }) === null);
    check('unless it names a harness key, and only a harness key',
      policyKeyFor({ packaged: false, defaultUserData: false, env: { CLEANDRIVE_POLICY_KEY: 'HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\X' } }) ===
        'HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\X' &&
        policyKeyFor({ packaged: false, defaultUserData: true, env: { CLEANDRIVE_POLICY_KEY: MACHINE_KEY } }) === null);
    check('and "machine" for the elevated harness, which reads the real key from a userData of its own',
      policyKeyFor({ packaged: false, defaultUserData: false, env: { CLEANDRIVE_POLICY_KEY: 'machine' } }) === MACHINE_KEY);
  }

  {
    // A policy that disappears is read twice before it is believed.
    const answers = [
      { status: 'present', key: MACHINE_KEY, tree: treeFrom({ '': { ViewOnly: 1 } }) },
      { status: 'none', key: MACHINE_KEY, tree: {} },
      { status: 'present', key: MACHINE_KEY, tree: treeFrom({ '': { ViewOnly: 1 } }) },
      { status: 'none', key: MACHINE_KEY, tree: {} },
      { status: 'none', key: MACHINE_KEY, tree: {} },
    ];
    let i = 0;
    const source = new PolicySource({ key: MACHINE_KEY, env: ENV, settleMs: 5, read: async () => answers[i++] });
    await source.refresh();
    const blip = await source.refresh();
    check('a read that finds the key gone while it is being rewritten is read again, and the policy holds', blip.viewOnly === true && i === 3);
    const gone = await source.refresh();
    check('gone on the second look too: then it is gone', gone.viewOnly === false && gone.status === 'none' && i === 5);
  }

  /* ==================================================================== 2 */
  console.log('\npolicy: what each value means\n');

  {
    const none = interpret({ status: 'none', tree: {} }, { acting: true, env: ENV });
    check('no policy: nothing applied, nothing said', none.entries.length === 0 && !none.viewOnly && none.automatic === null && none.categories === null);
  }
  {
    const on = interpret(read({ '': { ViewOnly: 1 } }), { acting: false, env: ENV });
    check('ViewOnly 1 applies, without Business (it only takes away)', on.viewOnly === true && entryOf(on, 'ViewOnly').state === 'applied');
    const off = interpret(read({ '': { ViewOnly: 0 } }), { env: ENV });
    check('ViewOnly 0 is the same as not set', off.viewOnly === false && off.entries.length === 0);
    const two = interpret(read({ '': { ViewOnly: 2 } }), { env: ENV });
    check('ViewOnly 2 is refused, not read as "on"', two.viewOnly === false && entryOf(two, 'ViewOnly').state === 'refused');
    const text = interpret(read({ '': { ViewOnly: '1' } }), { env: ENV });
    check('a ViewOnly written as text is refused for its type', text.viewOnly === false && entryOf(text, 'ViewOnly').state === 'refused');
  }
  {
    const off = interpret(read({ '': { AutomaticCleanup: 0 } }), { acting: false, env: ENV });
    check('AutomaticCleanup 0 switches every profile off, without Business', off.automatic === 'off' && entryOf(off, 'AutomaticCleanup').state === 'applied');
  }
  const fullProfile = {
    '': { AutomaticCleanup: 1 },
    Automatic: { Schedule: 'daily', Time: '03:30', Weekday: 2, Day: 5, ReportOnly: 1, Action: 'recycle', MinAgeDays: 30, MinDiskUsedPercent: 80 },
    'Automatic\\Folders': { 1: { expand: '%USERPROFILE%\\Downloads' }, 2: 'D:\\Scratch' },
  };
  {
    const without = interpret(read(fullProfile), { acting: false, env: ENV });
    check('AutomaticCleanup 1 without Business: not applied, and said', without.automatic === null && without.profile === null && entryOf(without, 'AutomaticCleanup').state === 'needsBusiness');
    const p = interpret(read(fullProfile), { acting: true, env: ENV });
    const prof = p.profile;
    check('with Business: the organisation\'s profile, under its own id', p.automatic === 'on' && prof && prof.id === schema.PROFILE_ID && prof.managed === true);
    check('%USERPROFILE% is expanded for whoever is running', prof.roots[0] === 'C:\\Users\\tester\\Downloads' && prof.roots[1] === 'D:\\Scratch', prof.roots.join(' | '));
    check('every value as the organisation set it', prof.schedule.kind === 'daily' && prof.schedule.time === '03:30' && prof.minAgeDays === 30 && prof.minDiskUsedPercent === 80);
    check('report only, notifications on, always enabled', prof.dryRun === true && prof.notify === true && prof.enabled === true);
    check('the categories are the defaults when no list is set', prof.categories.join() === DEFAULT_CATEGORIES.join());
    const live = interpret(read({ ...fullProfile, Automatic: { ...fullProfile.Automatic, ReportOnly: 0 } }), { acting: true, env: ENV });
    check('only ReportOnly 0, written out, makes it act', live.profile.dryRun === false);
    const missing = interpret(read({ '': { AutomaticCleanup: 1 }, 'Automatic\\Folders': { 1: 'D:\\Scratch' } }), { acting: true, env: ENV });
    check('a value that is absent takes its default -- and the default is report only', missing.profile.dryRun === true && missing.profile.schedule.kind === 'weekly' && missing.profile.schedule.time === '02:00');
  }
  {
    const bad = (patch, folders = { 1: 'D:\\Scratch' }) =>
      interpret(read({ '': { AutomaticCleanup: 1 }, Automatic: patch, 'Automatic\\Folders': folders }), { acting: true, env: ENV });
    const time = bad({ Time: '2:00am' });
    check('a bad value refuses the whole profile rather than defaulting it', time.profile === null && time.automatic === null && entryOf(time, 'AutomaticCleanup').state === 'refused');
    check('and says which value', entryOf(time, 'AutomaticCleanup').problems.some((x) => x.i18n === 'policy.problem.time'));
    check('a weekday of 9 is refused', bad({ Weekday: 9 }).profile === null);
    check('a schedule of "hourly" is refused', bad({ Schedule: 'hourly' }).profile === null);
    check('an action that is not recycle or quarantine is refused', bad({ Action: 'delete' }).profile === null);
    check('an age under the seven-day floor is refused', bad({ MinAgeDays: 1 }).profile === null);
    check('a relative folder is refused', bad({}, { 1: 'Downloads' }).profile === null);
    check('a folder on the network is refused (network drives are only read)', bad({}, { 1: '\\\\server\\share' }).profile === null);
    check('a variable this account does not have is refused', bad({}, { 1: { expand: '%NOT_SET_ANYWHERE%\\x' } }).profile === null);
    check('no folders at all is refused', bad({}, {}).profile === null);
    const vo = interpret(read({ ...fullProfile, '': { AutomaticCleanup: 1, ViewOnly: 1 } }), { acting: true, env: ENV });
    check('with view only as well, the profile is kept but said to only ever report', vo.profile && entryOf(vo, 'AutomaticCleanup').problems.some((x) => x.i18n === 'policy.automatic.viewOnly'));
  }
  {
    const p = interpret(read({ '': { AllowedCategories: 1 }, AllowedCategories: { temp: 1, cache: 0, log: 1, photos: 1, installer: 1 } }), { acting: false, env: ENV });
    check('the category list is a ceiling, in the advisor\'s order', p.categories.join() === 'temp,log', String(p.categories));
    check('names automatic cleanup can never use are refused by name', entryOf(p, 'AllowedCategories').problems.filter((x) => x.i18n === 'policy.problem.category').length === 2);
    check('so nothing outside the hard list can ever be allowed', p.categories.every((c) => SAFE_CATEGORIES.includes(c)));
    const withProfile = interpret(read({ ...fullProfile, '': { AutomaticCleanup: 1, AllowedCategories: 1 }, AllowedCategories: { temp: 1 } }), { acting: true, env: ENV });
    check('the organisation\'s profile uses exactly the allowed categories', withProfile.profile.categories.join() === 'temp');
    const empty = interpret(read({ '': { AllowedCategories: 1 } }), { env: ENV });
    check('on with nothing ticked: nothing is allowed, and that is said', Array.isArray(empty.categories) && empty.categories.length === 0 && entryOf(empty, 'AllowedCategories').message.i18n === 'policy.categories.none');
  }
  {
    const p = interpret(read({ '': { ProtectedFolders: 1 }, ProtectedFolders: { 1: { expand: '%USERPROFILE%\\Documents' }, 2: '\\\\nas\\team', 3: 'relative' } }), { env: ENV });
    check('protected folders are expanded, and a share is accepted (it only protects)', p.protectedFolders.join(' | ') === 'C:\\Users\\tester\\Documents | \\\\nas\\team', p.protectedFolders.join(' | '));
    check('a relative one is refused by name', entryOf(p, 'ProtectedFolders').problems.length === 1);
    const empty = interpret(read({ '': { ProtectedFolders: 1 } }), { env: ENV });
    check('on with an empty list is refused, not "applied to nothing"', entryOf(empty, 'ProtectedFolders').state === 'refused');
  }
  {
    const p = interpret(read({ '': { DisableUpdateCheck: 1 } }), { acting: false, env: ENV });
    check('DisableUpdateCheck applies without Business', p.updatesOff === true);
    const q = interpret(read({ '': { QuarantineFolder: 'E:\\Kept' } }), { acting: false, env: ENV });
    check('QuarantineFolder needs Business', q.quarantineFolder === null && entryOf(q, 'QuarantineFolder').state === 'needsBusiness');
    const qa = interpret(read({ '': { QuarantineFolder: 'E:\\Kept' } }), { acting: true, env: ENV });
    check('with it, the folder is the organisation\'s', qa.quarantineFolder === 'E:\\Kept');
    const qn = interpret(read({ '': { QuarantineFolder: '\\\\nas\\q' } }), { acting: true, env: ENV });
    check('and one on the network is refused', qn.quarantineFolder === null && entryOf(qn, 'QuarantineFolder').state === 'refused');
  }
  {
    // H3: the folder each machine writes its report to.
    const r = interpret(read({ '': { ReportFolder: '\\\\srv\\cleandrive\\' } }), { acting: false, env: ENV });
    check('MachineReport needs Business, and says so', r.report === null && entryOf(r, 'MachineReport').state === 'needsBusiness');
    const ra = interpret(read({ '': { ReportFolder: '\\\\srv\\cleandrive\\' } }), { acting: true, env: ENV });
    check('with it, a share is accepted -- the point of this one -- and the folder names are off by default',
      ra.report && ra.report.folder === '\\\\srv\\cleandrive' && ra.report.topFolders === false && entryOf(ra, 'MachineReport').state === 'applied', JSON.stringify(ra.report));
    const rt = interpret(read({ '': { ReportFolder: { expand: '%USERPROFILE%\\Reports' }, ReportTopFolders: 1 } }), { acting: true, env: ENV });
    check('a local folder works too, %VARIABLES% expanded, and the folder names only when ticked',
      rt.report && rt.report.folder === 'C:\\Users\\tester\\Reports' && rt.report.topFolders === true && entryOf(rt, 'MachineReport').message.i18n === 'policy.report.appliedTop');
    const rr = interpret(read({ '': { ReportFolder: 'relative\\x' } }), { acting: true, env: ENV });
    check('a relative folder is refused, never guessed at', rr.report === null && entryOf(rr, 'MachineReport').state === 'refused');
    const rb = interpret(read({ '': { ReportFolder: 'E:\\R', ReportTopFolders: 3 } }), { acting: true, env: ENV });
    check('a wrong ReportTopFolders sends no folder names, and says why', rb.report && rb.report.topFolders === false && entryOf(rb, 'MachineReport').problems.length === 1);
    const ro = interpret(read({ '': { ReportTopFolders: 1 } }), { acting: true, env: ENV });
    check('ReportTopFolders with no folder writes nothing, and says so', ro.report === null && entryOf(ro, 'MachineReport').state === 'refused');
  }
  {
    const p = interpret(read({ '': { ViewOnyl: 1 }, Extra: { a: 1 } }), { env: ENV });
    check('a misspelt value is reported, never guessed at', p.entries.some((e) => e.state === 'unknown' && e.message.i18n === 'policy.unknown.value') && !p.viewOnly);
    check('and so is a subkey this version does not read', p.entries.some((e) => e.state === 'unknown' && e.message.i18n === 'policy.unknown.key'));
    check('environment names are not case-sensitive, as on Windows', expandEnv('%userprofile%\\x', ENV).text === 'C:\\Users\\tester\\x');
  }

  /* ==================================================================== 3 */
  console.log('\npolicy: it wins on screen and never reaches the file\n');

  const policyOf = (sections, acting = true) => interpret(read(sections), { acting, env: ENV });
  const fileSettings = coerceSettings({
    version: settingsLib.SCHEMA_VERSION,
    autoClean: {
      profiles: [
        { id: 'main', enabled: true, dryRun: false, roots: ['D:\\Mine'], whitelist: ['D:\\Mine\\keep'], categories: ['temp', 'cache', 'log'] },
        { id: 'pabcdef', enabled: true, dryRun: true, roots: ['D:\\Other'], categories: ['temp'] },
      ],
    },
    updates: { enabled: true },
    quarantine: { zone: 'E:\\CleanDrive Quarantine' },
  }).settings;

  {
    const policy = policyOf({ '': { AutomaticCleanup: 0 } }, false);
    const view = effective(fileSettings, policy);
    check('forced off: every profile is off on screen', settingsLib.profilesOf(view).every((p) => p.enabled === false));
    const back = toFile(view, fileSettings, policy);
    check('and saving that view writes the person\'s own "on" back', settingsLib.profilesOf(back).every((p) => p.enabled === true));
    const renamed = toFile({ ...view, autoClean: { profiles: settingsLib.profilesOf(view).map((p) => (p.id === 'main' ? { ...p, name: 'Mine' } : p)) } }, fileSettings, policy);
    check('a rename made while it was forced off keeps the rename, and the "on"', settingsLib.profilesOf(renamed)[0].name === 'Mine' && settingsLib.profilesOf(renamed)[0].enabled === true);
    check('the section that says what is managed never reaches the file', !('managed' in back) && view.managed && view.managed.automatic === 'off');
  }
  {
    const policy = policyOf({ '': { AllowedCategories: 1 }, AllowedCategories: { temp: 1, log: 1 } }, false);
    const view = effective(fileSettings, policy);
    check('the ceiling: on screen only the allowed ones are ticked', settingsLib.profilesOf(view)[0].categories.join() === 'temp,log');
    const untick = { ...view, autoClean: { profiles: settingsLib.profilesOf(view).map((p) => (p.id === 'main' ? { ...p, categories: ['temp'] } : p)) } };
    const back = toFile(untick, fileSettings, policy);
    check('unticking an allowed one is saved; the hidden one comes back with it', settingsLib.profilesOf(back)[0].categories.join() === 'temp,cache', settingsLib.profilesOf(back)[0].categories.join());
  }
  {
    const policy = policyOf({ '': { ProtectedFolders: 1 }, ProtectedFolders: { 1: 'D:\\Mine\\keep', 2: 'D:\\Org' } }, false);
    const view = effective(fileSettings, policy);
    check('protected folders join every profile on screen', settingsLib.profilesOf(view).every((p) => p.whitelist.some((w) => w === 'D:\\Org')));
    const back = toFile(view, fileSettings, policy);
    check('and leave again on save, except one the person had listed themselves',
      settingsLib.profilesOf(back)[0].whitelist.join() === 'D:\\Mine\\keep' && settingsLib.profilesOf(back)[1].whitelist.length === 0);
  }
  {
    const policy = policyOf(fullProfile, true);
    const shadow = { ...fileSettings, autoClean: { profiles: [...settingsLib.profilesOf(fileSettings), { ...settingsLib.defaultProfile('policy'), roots: ['D:\\Hand'] }] } };
    const view = effective(shadow, policy);
    const ids = settingsLib.profilesOf(view).map((p) => p.id);
    check('the organisation\'s profile is listed last, once', ids.join() === 'main,pabcdef,policy' && settingsLib.profilesOf(view)[2].managed === true);
    const back = toFile(view, shadow, policy);
    check('it is never written; a hand-made "policy" profile it shadowed stays in the file',
      settingsLib.profilesOf(back).filter((p) => p.id === 'policy').length === 1 && settingsLib.profilesOf(back).find((p) => p.id === 'policy').roots[0] === 'D:\\Hand');
    const smuggled = toFile({ ...view, autoClean: { profiles: [...settingsLib.profilesOf(fileSettings), { ...settingsLib.profilesOf(view)[2], id: 'pzzzzzz' }] } }, fileSettings, policy);
    check('nor is anything that says it is managed', settingsLib.profilesOf(smuggled).every((p) => p.managed !== true));
  }
  {
    const policy = policyOf({ '': { DisableUpdateCheck: 1, QuarantineFolder: 'F:\\Org' } }, true);
    const view = effective(fileSettings, policy);
    check('updates off on screen; the organisation\'s quarantine folder in place', view.updates.enabled === false && view.quarantine.zone === 'F:\\Org\\CleanDrive Quarantine');
    const back = toFile(view, fileSettings, policy);
    check('and neither reaches the file', back.updates.enabled === true && back.quarantine.zone === 'E:\\CleanDrive Quarantine');
  }
  {
    // H3: the report rides on the daily measurement, so the policy keeps it on.
    const off = { ...fileSettings, trends: { ...fileSettings.trends, dailySample: false } };
    const policy = policyOf({ '': { ReportFolder: '\\\\srv\\r' } }, true);
    const view = effective(off, policy);
    check('a report policy keeps the daily measurement on, and says where the report goes',
      view.trends.dailySample === true && view.managed.report && view.managed.report.folder === '\\\\srv\\r' && view.managed.active === true);
    const back = toFile(view, off, policy);
    check('and the person\'s own "off" is what reaches the file', back.trends.dailySample === false);
    const timeChanged = toFile({ ...view, trends: { ...view.trends, sampleTime: '09:30' } }, off, policy);
    check('a time chosen while it is held is kept, with the "off"', timeChanged.trends.sampleTime === '09:30' && timeChanged.trends.dailySample === false);
    const noBusiness = effective(off, policyOf({ '': { ReportFolder: '\\\\srv\\r' } }, false));
    check('without Business nothing is forced and nothing is sent', noBusiness.trends.dailySample === false && noBusiness.managed.report === null && noBusiness.managed.notApplied.includes('MachineReport'));
  }
  {
    const spoof = coerceSettings({ version: settingsLib.SCHEMA_VERSION, managed: { viewOnly: false, active: true }, autoClean: { profiles: [{ id: 'main', managed: true, roots: ['D:\\x'] }] } }).settings;
    check('a settings file cannot claim to be managed', !('managed' in spoof) && settingsLib.profilesOf(spoof)[0].managed === undefined);
  }
  {
    // The store, on a real file.
    const file = path.join(DATA, 'settings.json');
    const inner = new SettingsStore(file);
    await inner.save(fileSettings);
    const before = fs.readFileSync(file, 'utf8');
    let current = policyOf({ '': { AutomaticCleanup: 0, DisableUpdateCheck: 1 } }, false);
    let reads = 0;
    const source = new PolicySource({ key: MACHINE_KEY, read: async () => { reads += 1; return { status: 'present', tree: {} }; } });
    source.refresh = async () => { reads += 1; source._value = current; return current; };
    const store = new ManagedSettingsStore(inner, () => source);
    const seen = await store.load();
    check('the store hands out the effective view', settingsLib.profilesOf(seen).every((p) => !p.enabled) && seen.updates.enabled === false && seen.managed.automatic === 'off');
    check('and reading it wrote nothing', fs.readFileSync(file, 'utf8') === before);
    await store.patch({ updates: { lastVersion: '9.9.9' } });
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('a patch of another field leaves the locked ones as the person had them',
      onDisk.updates.enabled === true && onDisk.updates.lastVersion === '9.9.9' && onDisk.autoClean.profiles.every((p) => p.enabled === true) && !('managed' in onDisk));
    await store.patch({ autoClean: { profiles: settingsLib.profilesOf(await store.get()) } });
    check('saving the whole profile list as shown changes nothing that was locked', JSON.parse(fs.readFileSync(file, 'utf8')).autoClean.profiles.every((p) => p.enabled === true));
    current = policyOf({}, false);
    const lifted = await store.load();
    check('lifted: the person\'s own choices are exactly where they were', settingsLib.profilesOf(lifted).every((p) => p.enabled === true) && lifted.updates.enabled === true && lifted.managed.active === false);
    const readsBefore = reads;
    await store.load({ policy: false });
    check('a process that does not need the policy does not read it (the daily sampler)', reads === readsBefore);
  }

  /* ==================================================================== 4 */
  console.log('\npolicy: view only, at every door\n');

  {
    const victim = path.join(FIXTURE, 'keep-me.tmp');
    fs.writeFileSync(victim, 'still here');
    for (const kind of ['recycle', 'quarantine', 'relocate', 'archive', 'compress', 'dehydrate', 'hardlink']) {
      const result = await execute({ kind, items: [victim] }, { viewOnly: true, can: () => true });
      check(`the pipeline refuses ${kind} under view only, and says whose decision it is`,
        result.refused === 'managed' && result.failed.length === 1 && result.failed[0].code === 'EMANAGED');
    }
    check('and the file was not touched', fs.existsSync(victim) && fs.readFileSync(victim, 'utf8') === 'still here');
    const handoff = await execute({ kind: 'handoff', items: ['nothing-in-the-table'] }, { viewOnly: true, can: () => true });
    check('a handoff is let through (it opens a Windows tool and changes nothing)', handoff.refused !== 'managed');
  }
  {
    // A restore that would replace what is in the way: the handler is stubbed
    // so the pipeline reaches the point where the dialog's answer is read.
    const saved = { plan: restoreHandler.plan, describe: restoreHandler.describe, apply: restoreHandler.apply };
    let applied = 0;
    restoreHandler.plan = async () => ({ plan: [{ path: 'x', size: 1 }], failed: [], totalBytes: 1 });
    restoreHandler.describe = () => ({ kind: 'restore', count: 1, bytes: 1, freesOnVolume: false });
    restoreHandler.apply = async () => {
      applied += 1;
      return { moved: [], failed: [], freedBytes: 0 };
    };
    try {
      const replace = await execute({ kind: 'restore', items: ['s_00000000:1'] }, { viewOnly: true, confirm: async () => ({ approved: true, options: { onConflict: 'replace' } }) });
      check('a restore that would replace what is in the way is refused whole under view only', replace.refused === 'managed' && applied === 0);
      const keep = await execute({ kind: 'restore', items: ['s_00000000:1'] }, { viewOnly: true, confirm: async () => ({ approved: true, options: { onConflict: 'rename' } }) });
      check('putting back with "keep both" goes through (rule 4)', keep.refused === undefined && applied === 1);
    } finally {
      Object.assign(restoreHandler, saved);
    }
  }
  {
    // The unattended run, with its scan replaced: the gates are what is tested.
    const root = path.join(FIXTURE, 'root');
    const kept = path.join(root, 'org-protected');
    fs.mkdirSync(kept, { recursive: true });
    const old = Date.now() - 400 * DAY;
    const files = {
      temp: [path.join(root, 'a.tmp'), path.join(kept, 'b.tmp')],
      cache: [path.join(root, 'c.cache')],
    };
    for (const list of Object.values(files)) for (const f of list) fs.writeFileSync(f, 'x');
    let scans = 0;
    const deps = {
      scan: async () => {
        scans += 1;
        return {
          totalFiles: 3,
          totalSize: 3,
          cleanup: {
            groups: Object.entries(files).map(([category, list]) => ({
              category,
              verdict: 'safe',
              count: list.length,
              files: list.map((p) => ({ path: p, size: 1, mtimeMs: old, atimeMs: old })),
            })),
          },
        };
      },
      runningProcessNames: async () => new Set(),
      executeTrash: async () => {
        throw new Error('the run tried to move a file');
      },
    };
    const profile = { ...settingsLib.defaultProfile('main'), enabled: true, dryRun: false, roots: [root], categories: ['temp', 'cache'], skipIfRunning: [], minAgeDays: 7 };
    const base = coerceSettings({ version: settingsLib.SCHEMA_VERSION }).settings;
    const managedOf = (policy) => effective(base, policy).managed;

    const vo = await runAutoClean({ settings: { ...base, managed: managedOf(policyOf({ '': { ViewOnly: 1 } })) }, profile, deps });
    check('the 02:00 run under view only stops before it scans, and says why', vo.outcome === 'skipped' && vo.reason.i18n === 'run.viewOnlyByPolicy' && scans === 0);
    const voReport = await runAutoClean({ settings: { ...base, managed: managedOf(policyOf({ '': { ViewOnly: 1 } })) }, profile: { ...profile, dryRun: true }, deps });
    check('a report under view only still runs: it moves nothing', voReport.outcome === 'dry-run' && scans === 1);

    const offManaged = managedOf(policyOf({ '': { AutomaticCleanup: 0 } }, false));
    const off = await runAutoClean({ settings: { ...base, managed: offManaged }, profile: { ...profile, enabled: false }, deps });
    check('forced off: the scheduled run is skipped in the organisation\'s words', off.outcome === 'skipped' && off.reason.i18n === 'run.automaticOffByPolicy');
    const offLive = await runAutoClean({ settings: { ...base, managed: offManaged }, profile, deps });
    check('and the button cannot run it live either', offLive.outcome === 'skipped' && offLive.reason.i18n === 'run.automaticOffByPolicy');
    const offReport = await runAutoClean({ settings: { ...base, managed: offManaged }, profile: { ...profile, dryRun: true }, deps });
    check('but its report still runs', offReport.outcome === 'dry-run');

    const ceiling = managedOf(policyOf({ '': { AllowedCategories: 1, ProtectedFolders: 1 }, AllowedCategories: { temp: 1 }, ProtectedFolders: { 1: kept } }, false));
    const limited = await runAutoClean({ settings: { ...base, managed: ceiling }, profile: { ...profile, dryRun: true }, deps });
    check('the ceiling and the protected folder hold where files are chosen, even for a profile built elsewhere',
      limited.selected.files === 1 && limited.sample[0].path === files.temp[0] && limited.skipped.whitelisted === 1 && limited.skipped.category >= 1,
      JSON.stringify({ selected: limited.selected, skipped: limited.skipped }));
    const smuggled = { ...ceiling, categories: ['temp', 'installer'] };
    const hard = await runAutoClean({ settings: { ...base, managed: smuggled }, profile: { ...profile, dryRun: true, categories: ['temp', 'installer'] }, deps });
    check('and no list can open a category the hard whitelist does not have', hard.sample.every((s) => s.category === 'temp'));
  }
  {
    // Every call into the pipeline says whether view only is in force.
    const calls = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.js')) {
          const src = fs.readFileSync(full, 'utf8');
          // recycle.js names its own trash engine `execute`; that is not the pipeline.
          if (/\bconst execute = /.test(src)) continue;
          for (const call of executeCalls(src)) calls.push({ file: path.relative(ROOT, full), text: call });
        }
      }
    };
    walk(path.join(ROOT, 'src', 'main'));
    const silent = calls.filter((c) => !/\bviewOnly\b/.test(c.text));
    check('there are calls into the pipeline to look at', calls.length >= 5, String(calls.length));
    check('every one of them passes viewOnly', silent.length === 0, silent.map((c) => c.file).join(', '));

    const ipc = fs.readFileSync(path.join(ROOT, 'src/main/ipc.js'), 'utf8');
    const purge = ipc.slice(ipc.indexOf("handle('recyclebin:purge'"), ipc.indexOf("handle('recyclebin:purge'") + 1500);
    check('the purge button is refused under view only before anything is matched', purge.indexOf('managed.viewOnly') > 0 && purge.indexOf('managed.viewOnly') < purge.indexOf('purgeRecorded'));
    const button = ipc.slice(ipc.indexOf("handle('autoclean:run'"), ipc.indexOf("handle('autoclean:cancel'"));
    check('the Run-now button refuses a live run that the policy rules out', /managed\.viewOnly/.test(button) && /managed\.automatic === 'off'/.test(button) && button.indexOf('managedRefusal') < button.indexOf('runAutoClean('));
    const choose = ipc.slice(ipc.indexOf("handle('quarantine:choose'"), ipc.indexOf("handle('quarantine:choose'") + 600);
    check('choosing a quarantine folder is refused when the organisation chose one', /quarantineZone/.test(choose) && /managedRefusal/.test(choose));
    const updater = fs.readFileSync(path.join(ROOT, 'src/main/updater.js'), 'utf8');
    const checkFn = updater.slice(updater.indexOf('async function check('), updater.indexOf('async function download('));
    check('the update check returns before any request when the organisation switched it off -- the manual button too',
      checkFn.indexOf('if (state.managed)') > 0 && checkFn.indexOf('if (state.managed)') < checkFn.indexOf('checkForUpdates'));
    const sampler = fs.readFileSync(path.join(ROOT, 'src/main/sample-only.js'), 'utf8');
    // H2 kept the sampler off the policy ("a reg.exe process a day for
    // nothing"). H3 gave it something to read it for -- the report -- and
    // made the report the last thing it does, after the measurement and the
    // summary, because a dead share holds a write for ~42 s (measured).
    check('the daily sampler reads the policy (H3: it says whether and where to write the report)',
      /store\.load\(\)/.test(sampler) && !/policy: false/.test(sampler));
    const order = ['await maybeRecap(', 'await maybeReport('].map((s) => sampler.indexOf(s));
    check('and writes the report last, after the measurement and the summary',
      order.every((i) => i > 0) && order[0] < order[1] && sampler.indexOf('await sample(') < order[0]);
  }

  {
    // The Windows tasks, with Task Scheduler replaced: tasks.js loads Electron
    // for one call, so a stand-in is put where `require('electron')` looks.
    const electronPath = require.resolve('electron');
    const savedElectron = require.cache[electronPath];
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app: { isPackaged: false, getAppPath: () => ROOT } } };
    const scheduler = require('../src/main/lib/scheduler');
    const saved = {};
    const registered = new Set();
    const removed = [];
    const fake = {
      isInstalled: async (taskPath) => registered.has(taskPath),
      install: async ({ taskPath }) => {
        registered.add(taskPath);
        return { ok: true, taskPath };
      },
      installSampler: async () => {
        registered.add(scheduler.sampleTaskPath());
        return { ok: true };
      },
      uninstall: async (taskPath) => {
        registered.delete(taskPath);
        removed.push(taskPath);
        return { ok: true };
      },
      verify: async ({ taskPath }) => ({ ok: registered.has(taskPath), installed: registered.has(taskPath), problems: [] }),
      listCleanupTasks: async () => ({ ok: true, names: [...registered].map((p) => p.split('\\').pop()) }),
    };
    for (const [k, v] of Object.entries(fake)) {
      saved[k] = scheduler[k];
      scheduler[k] = v;
    }
    try {
      delete require.cache[require.resolve('../src/main/tasks')];
      const tasks = require('../src/main/tasks');
      const base = coerceSettings({ version: settingsLib.SCHEMA_VERSION }).settings;
      const managedPolicy = policyOf(fullProfile, true);
      const policyTask = scheduler.cleanupTaskPath('policy');

      const fresh = await tasks.reconcile(effective(base, managedPolicy), { settingsExisted: false, sweep: true, sampler: false });
      check('no settings file, the organisation\'s profile: its task is registered (the person\'s intent is unknown, the organisation\'s is not)',
        registered.has(policyTask) && fresh.profiles.some((p) => p.profileId === 'policy' && p.installed));
      check('and the daily measurement is left alone when asked to', !registered.has(scheduler.sampleTaskPath()) && fresh.sampler === null);

      registered.add(scheduler.cleanupTaskPath('main'));
      const orphan = await tasks.reconcile(effective(base, managedPolicy), { settingsExisted: false, sweep: true, sampler: false });
      check('a task with no settings behind it is still left alone -- and the organisation\'s still reconciled beside it',
        orphan.cleanup.orphaned === true && registered.has(scheduler.cleanupTaskPath('main')) && orphan.profiles.some((p) => p.profileId === 'policy'));
      registered.delete(scheduler.cleanupTaskPath('main'));

      const kept = await tasks.reconcile(effective(base, managedPolicy), { settingsExisted: true, sweep: true, sampler: false });
      check('with a settings file, the sweep for deleted profiles keeps the organisation\'s task', registered.has(policyTask) && !removed.includes(policyTask) && kept.problems.length === 0);

      const lifted = await tasks.reconcile(effective(base, policyOf({}, true)), { settingsExisted: false, sweep: true, sampler: false });
      check('the policy lifted, still no settings file: the organisation\'s task is removed, and said',
        !registered.has(policyTask) && lifted.changes.some((c) => /no longer runs a cleanup profile/.test(c)));

      registered.add(scheduler.cleanupTaskPath('main'));
      const off = effective({ ...base, autoClean: { profiles: [{ ...settingsLib.profilesOf(base)[0], enabled: true, roots: ['D:\\x'] }] } }, policyOf({ '': { AutomaticCleanup: 0 } }, false));
      await tasks.reconcile(off, { settingsExisted: true, sampler: false });
      check('forced off: the person\'s own task is removed', !registered.has(scheduler.cleanupTaskPath('main')));
    } finally {
      Object.assign(scheduler, saved);
      if (savedElectron) require.cache[electronPath] = savedElectron;
      else delete require.cache[electronPath];
      delete require.cache[require.resolve('../src/main/tasks')];
    }
  }

  /* ==================================================================== 5 */
  console.log('\npolicy: the ADMX and ADML\n');

  const generated = admx.files();
  {
    const mismatched = [];
    for (const [rel, text] of Object.entries(generated)) {
      const file = path.join(ROOT, 'policy', ...rel.split('/'));
      const disk = fs.existsSync(file) ? fs.readFileSync(file) : null;
      if (!disk || !disk.equals(Buffer.from(text, 'utf8'))) mismatched.push(rel);
    }
    check('the files in policy/ are byte for byte what the code writes (npm run policy:files)', mismatched.length === 0, mismatched.join(', '));
    check('three of them: the ADMX, and the ADML in English and Vietnamese',
      Object.keys(generated).sort().join() === ['CleanDrive.admx', 'en-US/CleanDrive.adml', 'vi-VN/CleanDrive.adml'].sort().join());
    check('UTF-8 with a byte-order mark and CRLF, as Microsoft ships theirs',
      Object.values(generated).every((t) => t.startsWith('\uFEFF<?xml') && t.includes('\r\n') && !/[^\r]\n/.test(t)));
    const attrs = fs.existsSync(path.join(ROOT, '.gitattributes')) ? fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8') : '';
    check('and git keeps those bytes as they are', /^policy\/\*\* -text$/m.test(attrs));
  }
  const ADMX = generated['CleanDrive.admx'];
  const EN = generated['en-US/CleanDrive.adml'];
  const VIADML = generated['vi-VN/CleanDrive.adml'];
  {
    // Every (key, value) the ADMX writes, against every one the reader reads.
    const written = new Set();
    const policyKey = /<policy name="(\w+)"[^>]*\bkey="([^"]+)"(?:[^>]*\bvalueName="([^"]+)")?/g;
    for (const [, , key, valueName] of ADMX.matchAll(policyKey)) if (valueName) written.add(`${key.toLowerCase()}|${valueName.toLowerCase()}`);
    const element = /<(decimal|text|enum|boolean|list) id="(\w+)" key="([^"]+)"(?: valueName="([^"]+)")?/g;
    for (const [, kind, , key, valueName] of ADMX.matchAll(element)) written.add(`${key.toLowerCase()}|${kind === 'list' ? '*list*' : (valueName || '').toLowerCase()}`);
    const readKeys = new Set();
    for (const spec of Object.values(schema.VALUES)) {
      const key = (spec.key ? `${schema.KEY}\\${spec.key}` : schema.KEY).toLowerCase();
      if (spec.list) readKeys.add(`${key}|*list*`);
      else if (spec.perCategory) for (const c of schema.CATEGORIES) readKeys.add(`${key}|${c}`);
      else readKeys.add(`${key}|${spec.valueName.toLowerCase()}`);
    }
    const onlyWritten = [...written].filter((x) => !readKeys.has(x));
    const onlyRead = [...readKeys].filter((x) => !written.has(x));
    check('every value the ADMX writes is one the app reads', onlyWritten.length === 0, onlyWritten.join(' ; '));
    check('and every value the app reads has a switch in the ADMX', onlyRead.length === 0, onlyRead.join(' ; '));
    check('everything is under HKLM\\Software\\Policies\\CleanDrive, machine class',
      [...ADMX.matchAll(/key="([^"]+)"/g)].every((x) => x[1].startsWith('Software\\Policies\\CleanDrive')) && !/class="(User|Both)"/.test(ADMX));
  }
  {
    const refs = [...ADMX.matchAll(/\$\(string\.(\w+)\)/g)].map((x) => x[1]);
    const ids = (adml) => new Set([...adml.matchAll(/<string id="(\w+)">/g)].map((x) => x[1]));
    const en = ids(EN);
    const vi = ids(VIADML);
    check('every string the ADMX names is in the English ADML', refs.every((r) => en.has(r)), refs.filter((r) => !en.has(r)).join(', '));
    check('and the two ADMLs have the same ids', en.size === vi.size && [...en].every((id) => vi.has(id)));
    const presentations = [...ADMX.matchAll(/\$\(presentation\.(\w+)\)/g)].map((x) => x[1]);
    check('every presentation the ADMX names is in the ADML', presentations.every((p) => EN.includes(`<presentation id="${p}">`) && VIADML.includes(`<presentation id="${p}">`)));
    const elementIds = new Set([...ADMX.matchAll(/<(?:decimal|text|enum|boolean|list) id="(\w+)"/g)].map((x) => x[1]));
    const refIds = [...EN.matchAll(/refId="(\w+)"/g)].map((x) => x[1]);
    check('every control in the ADML points at an element in the ADMX, and every element has one',
      refIds.every((r) => elementIds.has(r)) && [...elementIds].every((id) => refIds.includes(id)));
    check('the Vietnamese ADML is translated, with its marks', /Chỉ cho xem/.test(VIADML) && /Do tổ chức|tổ chức/.test(VIADML) && !VIADML.includes('View only: change no files'));
    check('a checkbox for every category automatic cleanup may use, ticked where the app ticks it',
      schema.CATEGORIES.every((c) => EN.includes(`refId="Category_${admx.idOf(c)}" defaultChecked="${DEFAULT_CATEGORIES.includes(c)}"`)));
  }
  {
    // What Group Policy would write with every policy switched on, read back.
    const sections = {};
    const put = (key, name, value) => {
      const rel = key === schema.KEY ? '' : key.slice(schema.KEY.length + 1);
      (sections[rel] = sections[rel] || {})[name] = value;
    };
    for (const [, , key, valueName] of ADMX.matchAll(/<policy name="(\w+)"[^>]*\bkey="([^"]+)"(?:[^>]*\bvalueName="([^"]+)")?/g)) if (valueName) put(key, valueName, 1);
    for (const [, kind, id, key, valueName] of ADMX.matchAll(/<(decimal|text|enum|boolean|list) id="(\w+)" key="([^"]+)"(?: valueName="([^"]+)")?([^>]*)/g)) {
      if (kind === 'list') put(key, '1', { expand: id === 'AutomaticFolders' ? 'D:\\Data' : '%USERPROFILE%\\Documents' });
      else if (kind === 'boolean') put(key, valueName, 1);
      else if (kind === 'decimal') put(key, valueName, Number(/minValue="(\d+)"/.exec(ADMX.slice(ADMX.indexOf(`id="${id}"`)))[1]));
      else if (kind === 'text') put(key, valueName, id === 'Time' ? '02:00' : 'E:\\Org');
      else if (kind === 'enum') {
        const block = ADMX.slice(ADMX.indexOf(`<enum id="${id}"`), ADMX.indexOf('</enum>', ADMX.indexOf(`<enum id="${id}"`)));
        const first = /<string>([^<]+)<\/string>|<decimal value="(\d+)" \/>/.exec(block);
        put(key, valueName, first[1] !== undefined ? first[1] : Number(first[2]));
      }
    }
    // Weekly is the dropdown's default; daily is first. Either is valid.
    const all = interpret(read(sections), { acting: true, env: ENV });
    const states = Object.fromEntries(all.entries.map((e) => [e.policy, e.state]));
    check('every policy the ADMX can switch on is read back as applied',
      schema.POLICIES.every((p) => states[p.name] === 'applied') && !all.entries.some((e) => e.state !== 'applied'),
      JSON.stringify(all.entries.map((e) => [e.policy, e.state, (e.problems || []).map((x) => x.en || x)])));
  }
  {
    // A real XML parser, where there is one: .NET's, through PowerShell.
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const dir = path.join(ROOT, 'policy');
    if (process.platform === 'win32' && fs.existsSync(ps)) {
      const script = `$ErrorActionPreference='Stop'; foreach ($f in @('${dir}\\CleanDrive.admx','${dir}\\en-US\\CleanDrive.adml','${dir}\\vi-VN\\CleanDrive.adml')) { $x = New-Object System.Xml.XmlDocument; $x.Load($f); $x.DocumentElement.LocalName + '|' + $x.DocumentElement.NamespaceURI }`;
      let out = '';
      try {
        out = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
      } catch (err) {
        out = String(err.stdout || err.message);
      }
      const lines = out.trim().split(/\r?\n/);
      check('the three files load in .NET\'s XML parser', lines.length === 3 && lines[0].startsWith('policyDefinitions|') && lines[1].startsWith('policyDefinitionResources|'), out.trim().slice(0, 200));
      // Microsoft's own files do not agree with each other: on this machine
      // most use one namespace and two an older one. Ours must be the one
      // most of theirs use, for the ADMX and the ADML alike.
      const ms = path.join(process.env.SystemRoot || 'C:\\Windows', 'PolicyDefinitions');
      if (fs.existsSync(ms)) {
        const count = {};
        for (const f of fs.readdirSync(ms).filter((x) => x.endsWith('.admx'))) {
          const ns = /<policyDefinitions\b[^>]*?\sxmlns="([^"]+)"/s.exec(fs.readFileSync(path.join(ms, f), 'utf8'));
          if (ns) count[ns[1]] = (count[ns[1]] || 0) + 1;
        }
        const usual = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
        check(`with the namespace most of Microsoft's own ADMX use (${usual ? `${usual[1]} of ${Object.values(count).reduce((a, b) => a + b, 0)}` : 'none'})`,
          usual && lines[0] === `policyDefinitions|${usual[0]}` && lines[1] === `policyDefinitionResources|${usual[0]}` && lines[2] === lines[1],
          JSON.stringify(count));
      }
    } else {
      console.log('  (no PowerShell here: the XML parse is left to Windows)');
    }
  }

  /* ==================================================================== 6 */
  console.log('\npolicy: the command line\n');

  const run = async (tokens, ctxExtra = {}) => {
    const out = { text: '', write(c, cb) { this.text += String(c); if (cb) cb(); return true; } };
    const err = { text: '', write(c, cb) { this.text += String(c); if (cb) cb(); return true; } };
    const code = await main(tokens, { context: cliContext(ctxExtra), stdout: out, stderr: err });
    let json = null;
    try {
      json = JSON.parse(out.text);
    } catch {
      /* not --json */
    }
    return { code, out: out.text, err: err.text, json };
  };
  const sourceWith = (sections, { acting = true, status } = {}) => {
    const s = new PolicySource({ key: MACHINE_KEY, acting });
    s.refresh = async () => {
      s._value = status === 'unreadable'
        ? interpret({ status: 'unreadable', key: MACHINE_KEY, tree: {}, error: 'reg.exe: refused; PowerShell: blocked' }, { acting, env: ENV })
        : sections === null
          ? interpret({ status: 'none', key: MACHINE_KEY, tree: {} }, { acting, env: ENV })
          : interpret(read(sections), { acting, env: ENV });
      return s._value;
    };
    return s;
  };
  let reconciled = null;
  function cliContext({ source = sourceWith(null), system = false, file = null, problems = [] } = {}) {
    const inner = new SettingsStore(file || path.join(DATA, `cli-${crypto.randomBytes(3).toString('hex')}.json`));
    const store = new ManagedSettingsStore(inner, () => source);
    return {
      services: () => ({ policy: source, settings: store }),
      can: () => true,
      reasonFor: () => null,
      now: () => Date.now(),
      resolve: (p) => path.resolve(FIXTURE, p),
      isSystemAccount: () => system,
      prepareZone: async (zone) => ({ ok: true, zone }),
      reconcileTasks: async (settings, options) => {
        reconciled = { settings, options };
        return { profiles: settingsLib.profilesOf(settings).map((p) => ({ profileId: p.id, taskPath: `CleanDrive\\AutomaticCleanup_${p.id}`, wanted: p.enabled, installed: p.enabled, ok: true })), changes: ['changed one'], problems };
      },
    };
  }

  {
    const none = await run(['policy', 'validate', '--json']);
    check('validate with no policy: 0, and the schema', none.code === EXIT.OK && none.json && none.json.schema === 'cleandrive.policy-validate/1' && none.json.status === 'none');
    const ok = await run(['policy', 'validate', '--json'], { source: sourceWith({ '': { ViewOnly: 1 } }) });
    check('a clean policy: 0, each value with its state', ok.code === EXIT.OK && ok.json.policies[0].policy === 'ViewOnly' && ok.json.policies[0].state === 'applied' && ok.json.effective.viewOnly === true);
    const bad = await run(['policy', 'validate'], { source: sourceWith({ '': { ViewOnly: 7 } }) });
    check('a refused value: 2, and the reason in words', bad.code === EXIT.REFUSED && /ViewOnly is 7, outside 0–1/.test(bad.out), bad.out.slice(0, 200));
    const biz = await run(['policy', 'validate', '--json'], { source: sourceWith(fullProfile, { acting: false }) });
    check('set but needing Business: 3, said as such', biz.code === EXIT.LICENCE && biz.json.businessIncluded === false && biz.json.policies[0].state === 'needsBusiness');
    const unread = await run(['policy', 'validate', '--json'], { source: sourceWith(null, { status: 'unreadable' }) });
    check('unreadable: 1', unread.code === EXIT.ERROR && unread.json.status === 'unreadable');
  }
  {
    const reg = path.join(FIXTURE, 'org-policy.reg');
    fs.writeFileSync(reg, Buffer.from(`\uFEFF${regText({ '': { ProtectedFolders: 1 }, ProtectedFolders: { 1: `D:\\${VI}` } })}`, 'utf16le'));
    const fromFile = await run(['policy', 'validate', reg, '--json']);
    check('validate <file.reg>: read from the file, the registry untouched', fromFile.code === EXIT.OK && fromFile.json.source.kind === 'file' && fromFile.json.effective.protectedFolders[0] === `D:\\${VI}`);
    check('and the --json is ASCII, with the Vietnamese escaped', /^[\x00-\x7e]*$/.test(fromFile.out) && fromFile.out.includes('\\u1ea2'));
    const other = path.join(FIXTURE, 'other.reg');
    fs.writeFileSync(other, regText({ '': { x: 1 } }, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Other'));
    const nothing = await run(['policy', 'validate', other]);
    check('a file with nothing for CleanDrive in it: 64', nothing.code === EXIT.USAGE && /holds nothing under/.test(nothing.err));
    const missing = await run(['policy', 'validate', path.join(FIXTURE, 'nope.reg')]);
    check('a file that is not there: 64', missing.code === EXIT.USAGE);
  }
  {
    reconciled = null;
    const asSystem = await run(['policy', 'apply'], { system: true, source: sourceWith(fullProfile) });
    check('apply as SYSTEM is refused (2) and touches no task', asSystem.code === EXIT.REFUSED && reconciled === null && /SYSTEM account/.test(asSystem.err));
    const unread = await run(['policy', 'apply'], { source: sourceWith(null, { status: 'unreadable' }) });
    check('apply when the policy cannot be read changes nothing (1)', unread.code === EXIT.ERROR && reconciled === null);
    const applied = await run(['policy', 'apply', '--json'], { source: sourceWith(fullProfile) });
    check('apply: the tasks are brought into line with the organisation\'s profile in them',
      applied.code === EXIT.OK && reconciled && settingsLib.profilesOf(reconciled.settings).some((p) => p.id === 'policy' && p.managed) && reconciled.options.sweep === true);
    check('even with no settings file on this machine', reconciled.options.settingsExisted === false && applied.json.settingsFound === false);
    check('and only the cleanup tasks: the daily measurement is not the policy\'s to register', reconciled.options.sampler === false);
    check('with its own schema', applied.json.schema === 'cleandrive.policy-apply/1' && applied.json.tasks.some((t) => t.profileId === 'policy'));
    const trouble = await run(['policy', 'apply'], { source: sourceWith(fullProfile), problems: ['Task Scheduler refused it'] });
    check('a task Windows refused: 2', trouble.code === EXIT.REFUSED && /problem: Task Scheduler refused it/.test(trouble.out));
    check('a startup script\'s account is recognised as SYSTEM',
      isSystemAccount({ username: 'SYSTEM', home: 'C:\\x', envUser: 'x' }) &&
        isSystemAccount({ username: 'x', home: 'C:\\Windows\\System32\\config\\systemprofile', envUser: 'x' }) &&
        isSystemAccount({ username: 'x', home: 'C:\\x', envUser: 'DESKTOP-1$' }) &&
        !isSystemAccount({ username: 'ktvda', home: 'C:\\Users\\ktvda', envUser: 'ktvda' }));
  }
  {
    const help = await run(['help', 'policy']);
    check('help knows the command', help.code === EXIT.OK && /policy validate \[<file\.reg>\] \| apply/.test(help.out));
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

/* ------------------------------------------------------------ static helpers */

/**
 * services.js's key rule, without Electron: the function is pure, but the file
 * requires electron at the top, so it is lifted out of the source and run.
 */
function loadServicesKeyRule() {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/services.js'), 'utf8');
  const start = src.indexOf('function policyKeyFor(');
  const close = /\r?\n\}\r?\n/.exec(src.slice(start));
  if (start < 0 || !close) throw new Error('policyKeyFor was not found in services.js');
  const body = src.slice(start, start + close.index + close[0].length).replace("require('./policy/read')", 'readModule');
  // eslint-disable-next-line no-new-func
  const make = new Function('readModule', `${body}; return policyKeyFor;`);
  return { policyKeyFor: make(require('../src/main/policy/read')) };
}

/**
 * The text of every call to `execute(` in a source file, from the name to its
 * closing parenthesis, skipping strings and comments so a bracket in a
 * sentence does not end the call early.
 */
function executeCalls(src) {
  const out = [];
  const re = /(?<![\w.])execute\(/g;
  let match;
  while ((match = re.exec(src))) {
    const before = src.slice(Math.max(0, match.index - 20), match.index);
    if (/function\s+$/.test(before)) continue;
    const lineStart = src.lastIndexOf('\n', match.index) + 1;
    const lineHead = src.slice(lineStart, match.index);
    if (/^\s*(\*|\/\/)/.test(lineHead) || /\/\/.*$/.test(lineHead)) continue;
    let depth = 0;
    let i = match.index + 'execute'.length;
    let quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i);
      else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i) + 1;
      else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(match.index, i + 1));
  }
  return out;
}
