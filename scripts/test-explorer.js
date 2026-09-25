'use strict';

// Settings → Right-click menu in Explorer, and what the menu asks the window
// for (I3), in the real window over the real IPC.
//
//   npx electron scripts/test-explorer.js
//
// The registry is scripts/fake-reg.js (constructed) handed to the IPC layer:
// what real reg.exe does is verify-contextmenu.js's question, and what the
// real main.js does with a command line is verify-launch-target.js's. This
// checks the rest -- the card says what the registry has, the box and the keys
// never disagree, a change of language relabels the entries, a refusal leaves
// everything as it was, the window cannot switch the menu through a settings
// save -- and that both screens pass axe.
//
// Isolation: throwaway userData, suffixed task names, a folder of its own for
// the copies search; all checked first.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow } = require('electron');

app.setName(require('../package.json').name);
const PRODUCTION_USER_DATA = app.getPath('userData');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-explorer-userdata-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'explorer';
require('../src/main/lib/preview/serve').registerScheme();

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const { createFakeReg } = require('./fake-reg');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  console.log('\nIsolation:');
  check('userData is a throwaway directory', app.getPath('userData') === SANDBOX && SANDBOX !== PRODUCTION_USER_DATA, SANDBOX);
  check('scheduled-task names are suffixed', Boolean(process.env.CLEANDRIVE_TASK_SUFFIX), process.env.CLEANDRIVE_TASK_SUFFIX);
  const realSettings = path.join(PRODUCTION_USER_DATA, 'settings.json');
  const realBefore = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  const { services } = require('../src/main/services');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-explorer-fixture-'));
  const body = crypto.randomBytes(150 * 1024);
  fs.mkdirSync(path.join(work, 'Docs'));
  fs.mkdirSync(path.join(work, 'Backup'));
  const report = path.join(work, 'Docs', 'report.pdf');
  fs.writeFileSync(report, body);
  fs.writeFileSync(path.join(work, 'Backup', 'report (1).pdf'), body);
  const lonely = path.join(work, 'Docs', 'lonely.txt');
  fs.writeFileSync(lonely, crypto.randomBytes(999));
  ipc.setCopiesScopeForHarness(work);

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const level = typeof args[1] === 'object' ? args[1].level : args[1];
    const message = typeof args[1] === 'object' ? args[1].message : args[2];
    if (level === 3 || level === 'error') errors.push(message);
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'en' } });
  await wait(500);
  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  const until = async (expr, ms = 20000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await js(`return Boolean(${expr})`)) return true;
      await wait(150);
    }
    return false;
  };
  await js(AXE);
  const axe = () => js(`return axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
    .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')))`);
  const card = () => js(`return { checked: document.getElementById('explorer-menu').checked, disabled: document.getElementById('explorer-menu').disabled,
    line: document.getElementById('explorer-status').textContent }`);

  /* ---- a checkout ---- */

  console.log('\nIn a checkout (not the installed app):');
  await js(`document.querySelector('.tab[data-tab="settings"]').click();`);
  await until(`document.getElementById('explorer-status').textContent`);
  let at = await card();
  check('the box is off and cannot be switched on', !at.checked && at.disabled);
  check('and the card says why', /Only the installed app/.test(at.line), at.line);

  /* ---- an installed app (the registry faked) ---- */

  console.log('\nInstalled, with a stand-in for reg.exe:');
  const fake = createFakeReg();
  ipc.setContextMenuForHarness({ exe: 'C:\\Program Files\\CleanDrive\\CleanDrive.exe', deps: fake });
  await js(`document.querySelector('.tab[data-tab="usage"]').click(); document.querySelector('.tab[data-tab="settings"]').click();`);
  await until(`!document.getElementById('explorer-menu').disabled`);
  at = await card();
  check('it can be switched on, and says it is not in the menu', !at.checked && !at.disabled && /Not in Explorer’s menu/.test(at.line), at.line);
  let found = await axe();
  check('Settings has no violations', found.length === 0, found.join(' || '));

  await js(`document.getElementById('explorer-menu').click();`);
  await until(`/In Explorer’s menu/.test(document.getElementById('explorer-status').textContent)`);
  at = await card();
  const keyNames = [...fake.keys.keys()];
  check('switched on: the four entries and their commands are written', fake.keys.size === 8 && keyNames.filter((k) => k.endsWith('\\command')).length === 4, `${fake.keys.size} keys`);
  check('the card reads them back', at.checked && /In Explorer’s menu: 4 entries/.test(at.line), at.line);
  check('and the setting is saved', (await services().settings.get()).explorer.contextMenu === true);

  await js(`await window.cleandrive.saveSettings({ explorer: { contextMenu: false } });`);
  check('a settings save from the window cannot switch it off behind the registry’s back', (await services().settings.get()).explorer.contextMenu === true);

  await js(`document.querySelector('[data-language-choice="vi"]').click();`);
  await until(`document.documentElement.lang === 'vi'`);
  const relabelled = async () => {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const labels = [...fake.keys.values()].map((v) => v.MUIVerb).filter(Boolean);
      if (labels.length === 4 && labels.every((l) => /bằng CleanDrive$/.test(l))) return labels;
      await wait(150);
    }
    return [...fake.keys.values()].map((v) => v.MUIVerb).filter(Boolean);
  };
  const labels = await relabelled();
  check('a change of language relabels the entries', labels.includes('Phân tích bằng CleanDrive') && labels.includes('Tìm bản trùng bằng CleanDrive'), labels.join(', '));
  await js(`document.querySelector('[data-language-choice="en"]').click();`);
  await until(`document.documentElement.lang === 'en'`);
  await wait(800);

  await js(`document.getElementById('explorer-menu').click();`);
  await until(`/Not in Explorer’s menu/.test(document.getElementById('explorer-status').textContent)`);
  at = await card();
  check('switched off: every key is gone, and the setting with it', fake.keys.size === 0 && !at.checked && (await services().settings.get()).explorer.contextMenu === false, `${fake.keys.size} keys`);

  const refusing = createFakeReg({ failImport: true });
  ipc.setContextMenuForHarness({ exe: 'C:\\Program Files\\CleanDrive\\CleanDrive.exe', deps: refusing });
  await js(`document.getElementById('explorer-menu').click();`);
  await until(`!document.getElementById('toast').hidden`);
  at = await card();
  const toastText = await js(`return document.getElementById('toast').textContent`);
  check('when Windows refuses, it says so', /Windows did not take the change/.test(toastText), toastText);
  check('and the box goes back to what is really there, the setting unchanged',
    !at.checked && (await services().settings.get()).explorer.contextMenu === false, JSON.stringify(at));

  /* ---- what the menu asks for ---- */

  console.log('\nWhat the menu asks the window for:');
  win.webContents.send('app:target', { kind: 'duplicates', path: report });
  await until(`document.querySelector('.panel.is-active').id === 'panel-dupes' && document.getElementById('dupes-stats').hidden === false`);
  at = await js(`return { status: document.getElementById('dupes-status').textContent, rows: document.querySelectorAll('#dupe-groups .file-row').length,
    ticked: document.querySelectorAll('#dupe-groups input:checked').length }`);
  check('copies of a file: the file and its copy, nothing ticked', /report\.pdf: 1 other copy in /.test(at.status) && at.rows === 2 && at.ticked === 0, at.status);
  found = await axe();
  check('the result has no violations', found.length === 0, found.join(' || '));

  win.webContents.send('app:target', { kind: 'duplicates', path: lonely });
  await until(`/no other copy/.test(document.getElementById('dupes-status').textContent)`);
  // A beat later, so a progress frame that arrives after the answer would
  // have had its chance to write over it (it did, before the window learnt to
  // ignore frames once a search is over).
  await wait(600);
  at = await js(`return { status: document.getElementById('dupes-status').textContent, empty: document.getElementById('dupes-empty').textContent }`);
  check('a file with no copy says so, and where it looked', /lonely\.txt: no other copy in /.test(at.status) && /No other copy of this file/.test(at.empty), `${at.status} | ${at.empty}`);

  const gone = await js(`return window.cleandrive.findCopies(${JSON.stringify(path.join(work, 'gone.pdf'))})`);
  check('a file that is not there is refused by the main process', gone.ok === false && gone.code === 'ENOENT', gone.error);

  win.webContents.send('app:target', { kind: 'analyze', path: work });
  await until(`document.querySelector('.panel.is-active').id === 'panel-usage' && document.getElementById('scan-stats').hidden === false && !document.getElementById('run-scan').disabled`);
  at = await js(`return { folder: document.getElementById('target-path').title, files: document.getElementById('stat-files').textContent }`);
  check('a folder to analyse is scanned', at.folder === work && at.files === '3', JSON.stringify(at));

  console.log('\nConsole:');
  check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const realAfter = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;
  check('the real settings file was not touched', realAfter === realBefore);

  win.destroy();
  fs.rmSync(work, { recursive: true, force: true });
  setTimeout(() => {
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${SANDBOX})`);
    }
    console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
    app.exit(failures === 0 ? 0 : 1);
  }, 500);
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
