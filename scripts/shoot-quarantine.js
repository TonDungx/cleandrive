'use strict';

// Screenshots of moving files to another drive (B1): the Settings card before
// and after a folder is chosen, the action bar with "Move to D:" beside the
// Recycle Bin and what each frees, the same with "delete the original" on,
// and the Restore Center with a quarantine session open. Both themes, narrow,
// Vietnamese.
//
//   npx electron scripts/shoot-quarantine.js [outputDir]
//
// The zone is a folder of the harness's own on the second drive, removed at
// the end; the Recycle Bin is stood in for, so no original goes to the real one.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootq-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootq';

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-quarantine.js'))
  || path.join(os.tmpdir(), 'cd-quarantine-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

function secondRoot() {
  for (const letter of 'DEFGH') {
    const root = `${letter}:\\`;
    try {
      if (fs.statSync(root).dev !== fs.statSync(path.parse(os.tmpdir()).root).dev) return root;
    } catch {
      // not there
    }
  }
  return null;
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');
  const root = secondRoot();
  if (!root) throw new Error('needs a second drive for the zone');
  const far = fs.mkdtempSync(path.join(root, 'cleandrive-harness-'));
  const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootq-fixture-'));
  const BIN = path.join(BASE, '.bin');

  const make = (rel, bytes) => {
    const full = path.join(BASE, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, crypto.randomBytes(bytes));
    const old = Date.now() / 1000 - (200 + rel.length) * 86400;
    fs.utimesSync(full, old, old);
    return full;
  };
  make(path.join('Máy ảo', 'Windows 10 dev.vmdk'), 48 * MB);
  make(path.join('Tải xuống', 'ubuntu-24.04-desktop-amd64.iso'), 36 * MB);
  make(path.join('Tải xuống', 'Ảnh cưới 2019.zip'), 22 * MB);
  make(path.join('Dự án', 'bản ghi âm buổi họp.wav'), 14 * MB);
  make(path.join('Temp', 'setup-cache.tmp'), 2 * MB);

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  ipc.allowUnconfirmedForHarness();
  let n = 0;
  ipc.setQuarantineHarness({
    pick: async () => far,
    driveTypeOf: async () => 'Fixed',
    shell: {
      trashItem: async (p) => {
        fs.mkdirSync(BIN, { recursive: true });
        fs.renameSync(p, path.join(BIN, `${(n += 1)}-${path.basename(p)}`));
      },
    },
  });

  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280,
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
  win.webContents.on('console-message', (...a) => {
    const level = typeof a[1] === 'object' ? a[1].level : a[1];
    const message = typeof a[1] === 'object' ? a[1].message : a[2];
    if (level === 3 || level === 'error') errors.push(message);
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (expr) => win.webContents.executeJavaScript(expr);
  await wait(600);
  const shoot = async (name) => {
    win.webContents.invalidate();
    await wait(350);
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let i = 0; i < 3 && bytes.length === 0; i++) {
      await wait(400);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };
  const theme = async (name) => {
    nativeTheme.themeSource = name;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(name)})`);
    await wait(500);
  };
  const toCard = async () => {
    await js(`document.querySelector('.tab[data-tab="settings"]').click()`);
    await wait(300);
    await js(`document.getElementById('quarantine-card').scrollIntoView({ block: 'center' })`);
    await wait(300);
  };
  const scan = async () => {
    await js(`document.querySelector('.tab[data-tab="usage"]').click()`);
    await js(`setFolder(${JSON.stringify(BASE)}); window.__b = state.scan; document.getElementById('run-scan').click()`);
    for (let i = 0; i < 160 && !(await js(`document.getElementById('run-scan').disabled === false && state.scan !== window.__b`)); i++) await wait(250);
    await wait(400);
  };
  const selectLargest = async (count) => {
    await js(`(() => {
      const rows = [...document.querySelectorAll('#largest-list .file-row, #top-files .file-row, .largest .file-row')];
      rows.slice(0, ${count}).forEach((r) => r.querySelector('input').click());
      const bar = document.getElementById('large-actionbar');
      bar.scrollIntoView({ block: 'end' });
    })()`);
    await wait(400);
  };

  try {
    await toCard();
    await shoot('quarantine-card-none-light');
    await js(`document.getElementById('quarantine-choose').click()`);
    for (let i = 0; i < 40 && !(await js(`window.Quarantine.ready()`)); i++) await wait(150);
    await wait(300);
    for (const name of ['light', 'dark']) {
      await theme(name);
      await toCard();
      await shoot(`quarantine-card-${name}`);
    }

    await theme('light');
    await scan();
    const selector = await js(`(() => {
      const rows = document.querySelectorAll('.file-row');
      return rows.length;
    })()`);
    if (!selector) throw new Error('the scan listed no rows');
    await js(`(() => {
      const list = document.querySelector('#large-actionbar').closest('.panel') || document;
      const rows = [...list.querySelectorAll('.file-row')].filter((r) => /vmdk|iso$/.test(r.dataset.path));
      rows.forEach((r) => r.querySelector('input').click());
      document.getElementById('large-actionbar').scrollIntoView({ block: 'end' });
    })()`);
    await wait(500);
    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`quarantine-bar-${name}`);
    }
    await theme('light');

    await js(`deleteSelected(${JSON.stringify([path.join(BASE, 'Máy ảo', 'Windows 10 dev.vmdk'), path.join(BASE, 'Tải xuống', 'ubuntu-24.04-desktop-amd64.iso')])}, () => {}, { kind: 'quarantine', confirm: false })`);
    for (let i = 0; i < 80 && !(await js(`/Moved 2 items/.test(document.getElementById('toast').textContent)`)); i++) await wait(250);
    await wait(200);
    await shoot('quarantine-receipt-light');

    await js(`document.querySelector('.tab[data-tab="restore"]').click()`);
    for (let i = 0; i < 40 && !(await js(`document.querySelector('.restore-session[data-kind="quarantine"]') !== null`)); i++) await wait(200);
    await js(`document.querySelector('.restore-session[data-kind="quarantine"] [data-restore-toggle]').click()`);
    await wait(900);
    await js(`document.querySelector('.restore-session[data-kind="quarantine"]').scrollIntoView({ block: 'start' })`);
    for (const name of ['light', 'dark']) {
      await theme(name);
      await shoot(`quarantine-restore-${name}`);
    }
    await theme('light');

    // "Delete the original" on: the badge changes with it.
    await toCard();
    await js(`(() => { const b = document.getElementById('quarantine-delete-original'); b.checked = true; b.dispatchEvent(new Event('change')); })()`);
    for (let i = 0; i < 40 && !(await js(`window.Quarantine.deletesOriginals()`)); i++) await wait(150);
    await shoot('quarantine-card-delete-on-light');
    await scan();
    await js(`(() => {
      const rows = [...document.querySelectorAll('.file-row')].filter((r) => /zip$/.test(r.dataset.path));
      rows.slice(0, 1).forEach((r) => r.querySelector('input').click());
      document.getElementById('large-actionbar').scrollIntoView({ block: 'end' });
    })()`);
    await wait(500);
    await shoot('quarantine-bar-delete-on-light');
    await js(`(() => { const b = document.getElementById('quarantine-delete-original'); b.checked = false; b.dispatchEvent(new Event('change')); })()`);
    await wait(500);

    // Vietnamese.
    await js(`document.querySelector('[data-language-choice="vi"]').click()`);
    await wait(900);
    await toCard();
    await shoot('quarantine-vi-card-light');
    await scan();
    await js(`(() => {
      const rows = [...document.querySelectorAll('.file-row')].filter((r) => /zip$|wav$/.test(r.dataset.path));
      rows.forEach((r) => r.querySelector('input').click());
      document.getElementById('large-actionbar').scrollIntoView({ block: 'end' });
    })()`);
    await wait(500);
    await shoot('quarantine-vi-bar-light');
    await js(`document.querySelector('.tab[data-tab="restore"]').click()`);
    await wait(900);
    await js(`(() => { const s = document.querySelector('.restore-session[data-kind="quarantine"]'); const t = s.querySelector('[data-restore-toggle]'); if (t.getAttribute('aria-expanded') !== 'true') t.click(); })()`);
    await wait(900);
    await js(`document.querySelector('.restore-session[data-kind="quarantine"]').scrollIntoView({ block: 'start' })`);
    await shoot('quarantine-vi-restore-light');
    await js(`document.querySelector('[data-language-choice="en"]').click()`);
    await wait(700);

    await theme('dark');
    win.setSize(700, 820);
    await wait(900);
    await toCard();
    await shoot('quarantine-narrow-card-dark');
    await js(`document.querySelector('.tab[data-tab="restore"]').click()`);
    await wait(900);
    await js(`document.querySelector('.restore-session[data-kind="quarantine"]').scrollIntoView({ block: 'start' })`);
    await shoot('quarantine-narrow-restore-dark');
    await scan();
    await js(`(() => {
      const rows = [...document.querySelectorAll('.file-row')].filter((r) => /zip$/.test(r.dataset.path));
      rows.slice(0, 1).forEach((r) => r.querySelector('input').click());
    })()`);
    await wait(500);
    await shoot('quarantine-narrow-bar-dark');
    const overflow = await js(`(() => {
      const bar = document.getElementById('large-actionbar');
      const r = bar.getBoundingClientRect();
      return { barRight: Math.round(r.right), barLeft: Math.round(r.left), width: window.innerWidth, scroll: document.documentElement.scrollWidth };
    })()`);
    console.log(`  narrow bar: ${JSON.stringify(overflow)}`);
  } finally {
    ipc.setQuarantineHarness(null);
    fs.rmSync(far, { recursive: true, force: true });
    fs.rmSync(BASE, { recursive: true, force: true });
  }

  console.log(`\nwritten to ${OUT}`);
  console.log(errors.length ? `renderer errors: ${errors.slice(0, 4).join(' | ')}` : 'no renderer errors');
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
