#!/usr/bin/env node
'use strict';

// Explorer's right-click menu (I3), without touching the registry.
//
//   node scripts/test-contextmenu.js
//
//   - which keys the app writes, and that a harness's are never the user's;
//   - the .reg file it imports, and the parser that reads `reg export` back,
//     held to a real export captured by verify-contextmenu.js --capture;
//   - reconcile: writes only when something differs, and reg.exe is only
//     ever asked to import, export or query, by its absolute path;
//   - the uninstaller removes exactly the keys the app writes;
//   - the command line Explorer starts the app with, read as untrusted input;
//   - "Find duplicates with CleanDrive": copies of one file, and only those.
//
// The registry here is scripts/fake-reg.js (constructed); the real one is
// verify-contextmenu.js's job.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

delete process.env.CLEANDRIVE_TASK_SUFFIX;
const menu = require('../src/main/lib/context-menu');
const launch = require('../src/main/launch-target');
const { findDuplicates } = require('../src/main/lib/duplicate');
const { createFakeReg } = require('./fake-reg');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const EXE = 'C:\\Program Files\\CleanDrive\\CleanDrive.exe';
const LABELS = { analyze: 'Analyse with CleanDrive', copies: 'Find duplicates with CleanDrive' };

(async () => {
  /* ---------------------------------------------------------------- keys */
  console.log('\nmenu: the keys\n');

  const real = menu.entries({ exe: EXE, labels: LABELS });
  check('four entries: folder, inside a folder, drive, file', real.length === 4 &&
    /\\Directory\\shell\\CleanDrive\.Analyze$/.test(real[0].key) &&
    /\\Directory\\Background\\shell\\CleanDrive\.Analyze$/.test(real[1].key) &&
    /\\Drive\\shell\\CleanDrive\.Analyze$/.test(real[2].key) &&
    /\\\*\\shell\\CleanDrive\.Duplicates$/.test(real[3].key), real.map((e) => e.key.split('\\').slice(-3).join('\\')).join(', '));
  check('all under HKCU\\Software\\Classes -- per user, no administrator', real.every((e) => e.key.startsWith('HKEY_CURRENT_USER\\Software\\Classes\\')));
  check('the command names the exe in quotes and passes the item as one token',
    real[0].command === `"${EXE}" --analyze="%1"` && real[1].command === `"${EXE}" --analyze="%V"` && real[3].command === `"${EXE}" --duplicates-of="%1"`, real[0].command);
  check('offered for a single item only, with the app’s icon',
    real.every((e) => e.values.MultiSelectModel === 'Single' && e.values.Icon === `"${EXE}",0`));

  const harness = menu.entries({ exe: EXE, labels: LABELS, suffix: 'smoke' });
  check('a harness’s keys carry its suffix, and are never the user’s',
    harness.every((e, i) => /CleanDrive\.smoke\.(Analyze|Duplicates)$/.test(e.key) && e.key !== real[i].key));
  process.env.CLEANDRIVE_TASK_SUFFIX = 'fromenv';
  check('CLEANDRIVE_TASK_SUFFIX picks the suffix when none is given', /CleanDrive\.fromenv\.Analyze$/.test(menu.entries({ exe: EXE, labels: LABELS })[0].key));
  const evil = menu.entries({ exe: EXE, labels: LABELS, suffix: '..\\evil' })[0].key;
  check('and a suffix cannot smuggle a path in', /\\Directory\\shell\\CleanDrive\.evil\.Analyze$/.test(evil) && !evil.includes('..'), evil.split('\\').slice(-2).join('\\'));
  delete process.env.CLEANDRIVE_TASK_SUFFIX;
  check('reg.exe is System32’s, by absolute path', path.isAbsolute(menu.REG) && /\\System32\\reg\.exe$/i.test(menu.REG), menu.REG);

  /* ---------------------------------------------------------------- .reg */
  console.log('\nmenu: the .reg file, and reading an export back\n');

  const file = menu.regFile(real);
  check('it is a version 5 .reg file', file.startsWith('Windows Registry Editor Version 5.00\r\n'));
  check('quotes and backslashes in the command are .reg escapes', file.includes(`@="\\"C:\\\\Program Files\\\\CleanDrive\\\\CleanDrive.exe\\" --analyze=\\"%1\\""`));
  const removal = menu.regFile(real, { remove: true });
  check('taking them out is a [-key] per entry, and nothing else', removal.split('\r\n').filter((l) => l.startsWith('[')).every((l) => l.startsWith('[-')) &&
    (removal.match(/^\[-/gm) || []).length === 4);

  const captured = fs.readFileSync(path.join(__dirname, 'fixtures', 'context-menu', 'export-directory.reg.txt'), 'utf8');
  const parsed = menu.parseExport(captured);
  const key = 'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\CleanDrive.harness.Analyze';
  check('a real reg export parses: the Vietnamese label', parsed[key] && parsed[key].MUIVerb === 'Phân tích bằng CleanDrive (thử)', parsed[key] && parsed[key].MUIVerb);
  check('the icon, unescaped', parsed[key] && parsed[key].Icon === '"C:\\Program Files\\CleanDrive Harness\\CleanDrive.exe",0');
  check('and the command subkey’s default value', parsed[`${key}\\command`] && parsed[`${key}\\command`][''] === '"C:\\Program Files\\CleanDrive Harness\\CleanDrive.exe" --analyze="%1"');
  const round = menu.parseExport(file);
  check('what the app writes, its parser reads back', real.every((e) => round[e.key].MUIVerb === e.label && round[`${e.key}\\command`][''] === e.command));

  /* ---------------------------------------------------------------- reconcile */
  console.log('\nmenu: install, status, reconcile, uninstall (a fake reg.exe)\n');

  const fake = createFakeReg();
  const options = { exe: EXE, labels: LABELS };
  let now = await menu.status(options, fake);
  check('nothing there to begin with', now.present === 0 && !now.current && now.stale.length === 4);
  const off = await menu.reconcile({ enabled: false, ...options }, fake);
  check('switched off with nothing there, nothing is written', !off.changed && !fake.calls.some((c) => c[0] === 'import'));
  const on = await menu.reconcile({ enabled: true, ...options }, fake);
  check('switched on, all four are written and read back', on.changed && on.status.current && on.status.present === 4);
  check('reg.exe is only asked to import, export and query', fake.calls.every((c) => ['import', 'export', 'query'].includes(c[0])), [...new Set(fake.calls.map((c) => c[0]))].join(', '));
  check('an import names a file in the temp folder, and the file is gone after', fake.calls.filter((c) => c[0] === 'import').every((c) => c[1].startsWith(os.tmpdir()) && !fs.existsSync(c[1])));
  const importsBefore = fake.calls.filter((c) => c[0] === 'import').length;
  const same = await menu.reconcile({ enabled: true, ...options }, fake);
  check('switched on again, nothing is written', !same.changed && fake.calls.filter((c) => c[0] === 'import').length === importsBefore);
  now = await menu.status({ exe: 'D:\\Moved\\CleanDrive.exe', labels: LABELS }, fake);
  check('after the app moves, all four read as out of date', now.present === 4 && now.stale.length === 4);
  const moved = await menu.reconcile({ enabled: true, exe: 'D:\\Moved\\CleanDrive.exe', labels: LABELS }, fake);
  check('and reconcile points them at the new place', moved.changed && moved.status.current);
  const relabel = await menu.reconcile({ enabled: true, exe: 'D:\\Moved\\CleanDrive.exe', labels: { analyze: 'Phân tích bằng CleanDrive', copies: 'Tìm bản trùng bằng CleanDrive' } }, fake);
  check('a change of language rewrites the labels', relabel.changed && relabel.status.current);
  const gone = await menu.reconcile({ enabled: false, exe: 'D:\\Moved\\CleanDrive.exe', labels: LABELS }, fake);
  check('switched off, every key and its command subkey are gone', gone.changed && gone.status.present === 0 && fake.keys.size === 0, `${fake.keys.size} keys left`);

  const refusing = createFakeReg({ failImport: true });
  let refused = null;
  try {
    await menu.install(options, refusing);
  } catch (err) {
    refused = err;
  }
  check('a refused import is an error, not a success', refused && refused.code === 'EREG', refused && refused.message);

  /* ---------------------------------------------------------------- uninstaller */
  console.log('\nmenu: the uninstaller\n');

  process.env.CLEANDRIVE_TASK_SUFFIX = 'harness';
  const nsh = menu.uninstallerScript();
  delete process.env.CLEANDRIVE_TASK_SUFFIX;
  const deleted = [...nsh.matchAll(/DeleteRegKey HKCU "([^"]+)"/g)].map((m) => m[1]);
  const written = menu.entries({ exe: EXE, labels: LABELS, suffix: '' }).map((e) => e.key.replace(/^HKEY_CURRENT_USER\\/, ''));
  check('it removes exactly the keys the app writes', JSON.stringify(deleted) === JSON.stringify(written), deleted.join(' | '));
  check('the real names, even when a harness suffix is set', deleted.every((k) => !/harness/.test(k)));
  check('and not during an update (the old version’s uninstaller runs then too)', /\$\{ifNot\} \$\{isUpdated\}[\s\S]*DeleteRegKey[\s\S]*\$\{endIf\}/.test(nsh));
  const build = fs.readFileSync(path.join(__dirname, 'build.js'), 'utf8');
  check('the build writes it and hands it to NSIS', /uninstallerScript\(\)/.test(build) && /include: nshPath/.test(build));

  /* ---------------------------------------------------------------- argv */
  console.log('\nlaunch: the command line Explorer starts the app with\n');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-menu-test-'));
  const folder = path.join(tmp, 'A folder');
  const aFile = path.join(folder, 'a file.txt');
  fs.mkdirSync(folder);
  fs.writeFileSync(aFile, 'x');

  const exe = 'C:\\Program Files\\CleanDrive\\CleanDrive.exe';
  check('--analyze="<folder>" as one token', JSON.stringify(launch.parse([exe, `--analyze=${folder}`])) === JSON.stringify({ kind: 'analyze', path: folder }));
  check('--analyze <folder> as two words', launch.parse([exe, '--analyze', folder]).path === folder);
  check('--duplicates-of="<file>"', launch.parse([exe, `--duplicates-of=${aFile}`]).kind === 'duplicates');
  const root = path.parse(tmp).root;
  check('a drive root that the quoting turned into C:" comes back as C:\\', launch.parse([exe, `--analyze=${root.slice(0, 2)}"`]).path === root, launch.parse([exe, `--analyze=${root.slice(0, 2)}"`]).path);
  check('a relative path is refused', launch.parse([exe, '--analyze=Documents']) === null);
  check('a path that is not there is refused', launch.parse([exe, `--analyze=${path.join(tmp, 'nowhere')}`]) === null);
  check('a file where a folder is wanted is refused', launch.parse([exe, `--analyze=${aFile}`]) === null);
  check('a folder where a file is wanted is refused', launch.parse([exe, `--duplicates-of=${folder}`]) === null);
  check('a flag where a path should be is refused', launch.parse([exe, '--analyze', '--dev']) === null);
  check('a NUL in the path is refused', launch.parse([exe, `--analyze=${folder}\0x`]) === null);
  check('no flag, nothing asked', launch.parse([exe, '--dev']) === null);
  check('what another process handed over is checked again', launch.validate({ kind: 'analyze', path: aFile }) === null &&
    launch.validate({ kind: 'delete', path: folder }) === null && launch.validate(null) === null &&
    launch.validate({ kind: 'analyze', path: folder }).path === folder);

  /* ---------------------------------------------------------------- copies */
  console.log('\ncopies: every copy of one file, and nothing else\n');

  const body = crypto.randomBytes(200 * 1024);
  const put = (rel, bytes) => {
    const f = path.join(tmp, 'home', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, bytes);
    return f;
  };
  const target = put('Docs\\report.pdf', body);
  put('Backup\\report copy.pdf', body);
  put('Old\\Deep\\report (2).pdf', body);
  put('Old\\same size.pdf', crypto.randomBytes(200 * 1024));
  const pairA = crypto.randomBytes(200 * 1024);
  put('Other\\x.bin', pairA);
  put('Other\\y.bin', pairA);
  const home = path.join(tmp, 'home');
  const found = await findDuplicates([home], { copiesOf: target, useCache: false });
  const names = found.groups.length ? found.groups[0].files.map((f) => path.basename(f.path)).sort() : [];
  check('one group: the file and both its copies', found.totalGroups === 1 && JSON.stringify(names) === JSON.stringify(['report (2).pdf', 'report copy.pdf', 'report.pdf']), names.join(', '));
  check('a same-sized file with other bytes is not among them', !names.includes('same size.pdf'));
  check('and a pair of copies of something else is not reported', !found.groups.some((g) => g.files.some((f) => f.path.endsWith('x.bin'))));
  check('the answer says which file it was about', found.copiesOf === target);

  const small = put('tiny\\note.txt', 'hello');
  put('tiny\\note again.txt', 'hello');
  const tiny = await findDuplicates([path.join(home, 'tiny')], { copiesOf: small, useCache: false });
  check('a copy of a file under the usual 1 KB floor is still found', tiny.totalGroups === 1 && tiny.groups[0].count === 2);

  const lonely = put('solo\\only.dat', crypto.randomBytes(1234));
  const none = await findDuplicates([home], { copiesOf: lonely, useCache: false });
  check('a file with no copy gives no group', none.totalGroups === 0 && none.copiesOf === lonely);

  const hidden = put('.hidden\\secret.pdf', body);
  const fromOutside = await findDuplicates([home], { copiesOf: target, useCache: false });
  check('(the walk does leave a dot-folder out: a search from outside it does not see it)',
    fromOutside.totalGroups === 1 && !fromOutside.groups[0].files.some((f) => f.path === hidden), String(fromOutside.groups[0] && fromOutside.groups[0].count));
  const fromHidden = await findDuplicates([home], { copiesOf: hidden, useCache: false });
  check('the file itself is compared even where the walk would not have gone', fromHidden.totalGroups === 1 &&
    fromHidden.groups[0].files.some((f) => f.path === hidden), fromHidden.groups[0] && fromHidden.groups[0].count);

  let missing = null;
  try {
    await findDuplicates([home], { copiesOf: path.join(home, 'nope.pdf'), useCache: false });
  } catch (err) {
    missing = err;
  }
  check('a file that is not there is an error, not a search for nothing', missing && missing.code === 'ENOENT');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
