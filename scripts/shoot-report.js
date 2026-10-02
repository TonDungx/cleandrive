'use strict';

// G2: the report dialog, and the report itself.
//
//   npx electron scripts/shoot-report.js [outputDir]
//
// Two things are captured. The dialog, in both themes and in Vietnamese, from
// the real window. And the report file, opened in a second window and
// photographed -- which is also the only way to find out whether the thing
// actually renders, since it is a file nothing in this app draws.
//
// Throwaway userData with a history and a journal built here, so the report
// has something in every section and the pictures do not depend on what the
// tester's own disk happens to hold.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootreport-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootreport';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-report.js'))
  || path.join(os.tmpdir(), 'cd-report-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;
const GB = 1024 * MB;
const DAY = 24 * 60 * 60 * 1000;

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  fs.mkdirSync(OUT, { recursive: true });

  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();
  const { services } = require('../src/main/services');

  // Readings across a month, so the chart has a line and a growth figure.
  const { history, journal } = services();
  await history.load();
  const now = Date.now();
  for (let i = 30; i >= 0; i -= 3) {
    const used = 84 + (30 - i) * 0.26;
    await history.addSnapshot({
      at: now - i * DAY,
      volumes: {
        // Every field the real sampler supplies, including `usedPercent` --
        // the chart is plotted from that one, not from the byte counts.
        'c:\\': {
          root: 'C:\\',
          totalBytes: 476 * GB,
          freeBytes: Math.round(476 * GB * (1 - used / 100)),
          usedBytes: Math.round(476 * GB * (used / 100)),
          usedPercent: used,
        },
      },
      source: i === 0 ? 'scan' : 'monitor',
      scan: i % 9 === 0
        ? { root: 'D:\\personal_projects', totalBytes: (6 + (30 - i) * 0.05) * GB, totalFiles: 15518, byCategory: {}, topFolders: [] }
        : null,
    });
  }
  await history.addEvent({ at: now - 2 * DAY, movedBytes: 3 * GB, freedBytes: 1 * GB, files: 812, source: 'autoclean' });

  // A couple of sessions in the journal, so "what CleanDrive did" has rows.
  await journal.appendSession(
    'recycle',
    [
      { path: 'C:\\Users\\somebody\\Downloads\\setup-4.2.exe', size: 30 * MB, mtimeMs: now - 90 * DAY, trashedAt: now - 3 * DAY },
      { path: "C:\\Users\\somebody\\Downloads\\Tom & Jerry's plan.txt", size: 2 * MB, mtimeMs: now - 40 * DAY, trashedAt: now - 3 * DAY },
    ],
    { startedAt: now - 3 * DAY }
  );
  await journal.appendSession(
    'quarantine',
    [{ path: 'C:\\Users\\somebody\\Videos\\holiday.mkv', size: 4 * GB, mtimeMs: now - 200 * DAY, trashedAt: now - 1 * DAY }],
    { startedAt: now - 1 * DAY, freedOnSource: 4 * GB }
  );

  const win = new BrowserWindow({
    width: 1180,
    height: 900,
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
  nativeTheme.themeSource = 'light';
  win.focus();
  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  await wait(900);

  const shotOf = (target) => async (name) => {
    await wait(400);
    target.webContents.invalidate();
    await target.webContents.capturePage();
    await wait(150);
    let bytes = (await target.webContents.capturePage()).toPNG();
    for (let k = 0; k < 3 && bytes.length === 0; k++) {
      await wait(300);
      bytes = (await target.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };
  const shoot = shotOf(win);
  const theme = async (mode) => {
    nativeTheme.themeSource = mode;
    await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
    await wait(300);
  };

  console.log(`\noutput: ${OUT}\n`);

  await js(`
    document.querySelector('.tab[data-tab="trends"]').click();
    await new Promise((r) => setTimeout(r, 900));
    await window.ReportDialog.open();
    await new Promise((r) => setTimeout(r, 400));
  `);

  const dialogState = await win.webContents.executeJavaScript(`({
    open: document.getElementById('report').open,
    sections: [...document.querySelectorAll('#report-sections .report-section')].map((l) => ({
      text: l.textContent.replace(/\\s+/g, ' ').trim().slice(0, 70),
      on: l.querySelector('input').checked,
      off: l.querySelector('input').disabled,
    })),
    private: document.getElementById('report-private').checked,
    note: document.getElementById('report-private-note').textContent,
  })`);
  console.log(`  dialog open: ${dialogState.open}, private default: ${dialogState.private}`);
  for (const s of dialogState.sections) console.log(`    [${s.on ? 'x' : s.off ? '-' : ' '}] ${s.text}`);
  console.log('');

  await shoot('dialog-light');
  await theme('dark');
  await shoot('dialog-dark');
  await theme('light');

  // Private off, so the warning line shows.
  await js(`
    const box = document.getElementById('report-private');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
  `);
  await shoot('dialog-private-off');

  await js(`
    document.querySelector('.tab[data-tab="settings"]').click();
    document.querySelector('[data-language-choice="vi"]').click();
  `);
  await wait(700);
  await js(`
    document.querySelector('.tab[data-tab="trends"]').click();
    await new Promise((r) => setTimeout(r, 500));
    document.getElementById('report').close();
    await window.ReportDialog.open();
    await new Promise((r) => setTimeout(r, 400));
  `);
  await shoot('dialog-vi');
  await js(`
    document.querySelector('.tab[data-tab="settings"]').click();
    document.querySelector('[data-language-choice="en"]').click();
  `);
  await wait(700);
  await js(`document.getElementById('report').close();`);

  /* -- the report itself ------------------------------------------------- */

  const reportCollect = require('../src/main/report/collect');
  const reportHtml = require('../src/main/report/html');
  const reportRedact = require('../src/main/report/redact');
  const volumes = require('../src/main/lib/volumes');
  const { t } = require('../src/i18n');

  // The words the app actually writes, from  itself.
  const ipcModule = require('../src/main/ipc');
  const sections = ['volumes', 'folders', 'trends', 'actions'];
  const data = await reportCollect.collect({
    sections,
    services: services(),
    deps: { volumes },
    app: 'CleanDrive',
    version: require('../package.json').version,
    lang: 'en',
  });

  const T = ipcModule.reportWords();
  for (const [name, payload] of [
    ['open', reportHtml.buildReport(data, T)],
    ['private', reportHtml.buildReport(reportRedact.redact(data, T.pseudonyms), T)],
  ]) {
    const file = path.join(OUT, `report-${name}.html`);
    fs.writeFileSync(file, payload, 'utf8');
    console.log(`  report-${name}.html  ${(payload.length / 1024).toFixed(0)} KB`);

    const viewer = new BrowserWindow({ width: 1000, height: 1100, show: true, webPreferences: { sandbox: true } });
    await viewer.loadFile(file);
    await wait(700);
    const shotViewer = shotOf(viewer);
    nativeTheme.themeSource = 'light';
    await wait(300);
    await shotViewer(`report-${name}-light`);
    nativeTheme.themeSource = 'dark';
    await wait(400);
    await shotViewer(`report-${name}-dark`);
    nativeTheme.themeSource = 'light';
    // Further down, where the chart and the tables are.
    await viewer.webContents.executeJavaScript(`window.scrollTo(0, 700)`);
    await wait(300);
    await shotViewer(`report-${name}-lower`);
    viewer.destroy();
  }

  if (errors.length) console.log(`\n  renderer errors: ${errors.length}\n${errors.map((e) => `    ${e}`).join('\n')}`);
  else console.log('\n  no renderer errors');
  app.quit();
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});

