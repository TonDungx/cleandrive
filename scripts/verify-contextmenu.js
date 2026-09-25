#!/usr/bin/env node
'use strict';

// Explorer's right-click menu (I3), against the real registry.
//
//   node scripts/verify-contextmenu.js [--capture]
//
// Writes the menu's entries under HKCU\Software\Classes with harness names
// (CleanDrive.harness.Analyze, CleanDrive.harness.Duplicates) -- never the
// real ones -- through the same code the app uses (System32\reg.exe, import
// and export of .reg files), reads them back, asks Windows' Shell whether a
// folder and a file now carry the entries, brings them up to date after a
// change of executable and of language, takes them out, and checks that
// nothing else under those four Classes keys changed. Whatever happens, the
// harness keys are removed in a `finally`, and the run checks they are gone.
//
// --capture writes one real `reg export` of a harness key, converted from
// UTF-16 to UTF-8, to scripts/fixtures/context-menu/ for test-contextmenu.js.

process.env.CLEANDRIVE_TASK_SUFFIX = 'harness';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const menu = require('../src/main/lib/context-menu');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const EXE = 'C:\\Program Files\\CleanDrive Harness\\CleanDrive.exe';
const MOVED = 'D:\\Apps\\CleanDrive Harness (moved)\\CleanDrive.exe';
const VI = { analyze: 'Phân tích bằng CleanDrive (thử)', copies: 'Tìm bản trùng bằng CleanDrive (thử)' };
const EN = { analyze: 'Analyse with CleanDrive (harness)', copies: 'Find duplicates with CleanDrive (harness)' };
const PARENTS = [
  `${menu.CLASSES}\\Directory\\shell`,
  `${menu.CLASSES}\\Directory\\Background\\shell`,
  `${menu.CLASSES}\\Drive\\shell`,
  `${menu.CLASSES}\\*\\shell`,
];

const reg = (args) => menu.runReg(args);

/** The names of a key's own subkeys. `reg query` prints them one a line. */
async function subkeys(parent) {
  const out = await reg(['query', parent]);
  if (!out.ok) return [];
  return out.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.toUpperCase().startsWith(`${parent.toUpperCase()}\\`))
    .map((l) => l.slice(parent.length + 1))
    .sort();
}

/** The labels Windows' Shell offers on an item's right-click menu. */
function shellVerbs(target) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$p = [Console]::In.ReadLine()',
    '$shell = New-Object -ComObject Shell.Application',
    '$item = $shell.NameSpace((Split-Path -Parent $p)).ParseName((Split-Path -Leaf $p))',
    '$item.Verbs() | ForEach-Object { $_.Name -replace "&", "" }',
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    const child = execFile(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 30000, encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
    child.stdin.end(`${target}\r\n`);
  });
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-menu-'));
  const folder = path.join(work, 'A folder');
  const file = path.join(folder, 'a file.txt');
  fs.mkdirSync(folder);
  fs.writeFileSync(file, 'x');
  const harnessKeys = menu.entries({ exe: EXE, labels: VI }).map((e) => e.key);

  let before = null;

  try {
    console.log('\nIsolation:');
    check('every key this run writes has the harness name', harnessKeys.every((k) => /\\CleanDrive\.harness\.(Analyze|Duplicates)$/.test(k)), harnessKeys[0]);
    check('reg.exe is called by its absolute path in System32', /\\System32\\reg\.exe$/i.test(menu.REG) && path.isAbsolute(menu.REG), menu.REG);

    before = {};
    for (const parent of PARENTS) before[parent] = (await subkeys(parent)).filter((n) => !/^CleanDrive\.harness\./i.test(n));
    const leftovers = await menu.status({ exe: EXE, labels: VI });
    if (leftovers.present) {
      console.log(`    (a previous run left ${leftovers.present} harness keys; taking them out first)`);
      await menu.uninstall({ exe: EXE, labels: VI });
    }
    const realState = await menu.status({ exe: EXE, labels: VI, suffix: '' });
    console.log(`    the real entries: ${realState.present} of ${realState.total} present (only read)`);

    console.log('\nWriting the entries:');
    const t0 = Date.now();
    const written = await menu.install({ exe: EXE, labels: VI });
    check('all four are written and read back exactly', written.current && written.present === 4, `${Date.now() - t0} ms`);

    const exported = path.join(work, 'export.reg');
    const out = await reg(['export', harnessKeys[0], exported, '/y']);
    const text = out.ok ? fs.readFileSync(exported).toString('utf16le') : '';
    const keys = menu.parseExport(text);
    const own = keys[harnessKeys[0]] || {};
    const command = (keys[`${harnessKeys[0]}\\command`] || {})[''];
    check('the Vietnamese label arrives intact', own.MUIVerb === VI.analyze, own.MUIVerb);
    check('the command names the exe in quotes and the folder as one token', command === `"${EXE}" --analyze="%1"`, command);
    check('the icon is the exe’s own', own.Icon === `"${EXE}",0`, own.Icon);
    check('and it is offered for one item at a time', own.MultiSelectModel === 'Single', own.MultiSelectModel);
    const background = (menu.parseExport(await (async () => {
      const f = path.join(work, 'bg.reg');
      const r = await reg(['export', harnessKeys[1], f, '/y']);
      return r.ok ? fs.readFileSync(f).toString('utf16le') : '';
    })())[`${harnessKeys[1]}\\command`] || {})[''];
    check('inside a folder, the folder is %V', background === `"${EXE}" --analyze="%V"`, background);

    if (process.argv.includes('--capture') && text) {
      const dir = path.join(__dirname, 'fixtures', 'context-menu');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'export-directory.reg.txt'), text.replace(/^\uFEFF/, ''), 'utf8');
      console.log('    captured scripts/fixtures/context-menu/export-directory.reg.txt');
    }

    console.log('\nWhat Explorer offers:');
    const onFolder = await shellVerbs(folder);
    const onFile = await shellVerbs(file);
    check('a folder’s menu carries “Analyse”', Boolean(onFolder && onFolder.includes(VI.analyze)), onFolder ? `${onFolder.length} verbs` : 'Shell not asked');
    check('a file’s menu carries “Find duplicates”', Boolean(onFile && onFile.includes(VI.copies)), onFile ? `${onFile.length} verbs` : 'Shell not asked');
    check('and a file’s menu does not carry “Analyse”', Boolean(onFile && !onFile.includes(VI.analyze)));

    console.log('\nKept up to date:');
    const movedState = await menu.status({ exe: MOVED, labels: VI });
    check('after the app moves, every entry reads as out of date', !movedState.current && movedState.stale.length === 4, `${movedState.stale.length} stale`);
    const fixed = await menu.reconcile({ enabled: true, exe: MOVED, labels: VI });
    check('and one reconcile points them all at the new place', fixed.changed && fixed.status.current);
    const relabelled = await menu.reconcile({ enabled: true, exe: MOVED, labels: EN });
    check('a change of language rewrites the labels', relabelled.changed && relabelled.status.current);
    const again = await menu.reconcile({ enabled: true, exe: MOVED, labels: EN });
    check('with nothing to change, nothing is written', again.changed === false && again.status.current);

    console.log('\nTaken out:');
    const off = await menu.reconcile({ enabled: false, exe: MOVED, labels: EN });
    check('switched off, all four are gone', off.changed && off.status.present === 0);
    const gone = await Promise.all(harnessKeys.map((k) => reg(['query', k])));
    check('reg query finds none of them', gone.every((r) => !r.ok));
    const offAgain = await menu.reconcile({ enabled: false, exe: MOVED, labels: EN });
    check('switched off again, nothing is written', offAgain.changed === false);

    const realAfter = await menu.status({ exe: EXE, labels: VI, suffix: '' });
    check('the real entries were not touched', realAfter.present === realState.present, `${realAfter.present} of ${realAfter.total}`);
  } catch (err) {
    check('the run finished', false, err.stack || err.message);
  } finally {
    await menu.uninstall({ exe: EXE, labels: VI }).catch(() => {});
    const left = await Promise.all(harnessKeys.map((k) => reg(['query', k])));
    check('the harness keys are gone at the end', left.every((r) => !r.ok));
    if (before) {
      const changed = [];
      for (const parent of PARENTS) {
        const now = (await subkeys(parent)).filter((n) => !/^CleanDrive\.harness\./i.test(n));
        if (JSON.stringify(now) !== JSON.stringify(before[parent])) changed.push(parent);
      }
      check('nothing else under those Classes keys changed', changed.length === 0, changed.join(', '));
    }
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
