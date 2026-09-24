'use strict';

// Screenshots of "What changed in a folder" on Trends: a folder this harness
// builds, scanned, changed the way a real one changes in a week -- a disk
// image grows, downloads come and go, photos arrive, a file moves, a big file
// pushes another out of its folder's ten -- and scanned again. Both themes,
// narrow, Vietnamese, the link under the growth figure, and the refusal for a
// folder scanned once.
//
//   npx electron scripts/shoot-changes.js [outputDir]

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootchanges-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootchanges';

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-changes.js'))
  || path.join(os.tmpdir(), 'cd-changes-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

function make(full, bytes) {
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fd = fs.openSync(full, 'w');
  fs.ftruncateSync(fd, bytes);
  fs.closeSync(fd);
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');
  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootchanges-fixture-'));
  const home = path.join(base, 'Minh');
  const once = path.join(base, 'Scanned once');
  const J = (...p) => path.join(home, ...p);

  make(J('AppData', 'Local', 'Docker', 'wsl', 'disk', 'docker_data.vhdx'), 900 * MB);
  make(J('AppData', 'Local', 'Temp', 'setup-cache.tmp'), 60 * MB);
  make(J('Downloads', 'ubuntu-24.04.iso'), 480 * MB);
  make(J('Downloads', 'report-final.pdf'), 14 * MB);
  make(J('Downloads', 'installers', 'zoom-setup.exe'), 95 * MB);
  for (let i = 0; i < 10; i++) make(J('Videos', 'Captures', `clip-${i}.mp4`), (40 + i * 5) * MB);
  make(J('Documents', 'thesis-draft.docx'), 12 * MB);
  make(path.join(once, 'a.bin'), 30 * MB);

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
  await wait(500);

  const shoot = async (name) => {
    win.webContents.invalidate();
    await wait(350);
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let n = 0; n < 3 && bytes.length === 0; n++) {
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

  try {
    await js(`window.cleandrive.scan(${JSON.stringify(home)})`);
    await js(`window.cleandrive.scan(${JSON.stringify(once)})`);

    // A week, compressed.
    fs.truncateSync(J('AppData', 'Local', 'Docker', 'wsl', 'disk', 'docker_data.vhdx'), 1700 * MB);
    fs.rmSync(J('AppData', 'Local', 'Temp', 'setup-cache.tmp'));
    fs.rmSync(J('Downloads', 'ubuntu-24.04.iso'));
    make(J('Downloads', 'fedora-41.iso'), 2100 * MB);
    fs.mkdirSync(J('Documents', 'Archive'), { recursive: true });
    fs.renameSync(J('Documents', 'thesis-draft.docx'), J('Documents', 'Archive', 'thesis-draft.docx'));
    make(J('Videos', 'Captures', 'clip-new.mp4'), 120 * MB); // pushes clip-0 out of the ten
    for (let i = 0; i < 40; i++) make(J('Pictures', 'Zalo', `IMG_${2000 + i}.jpg`), (2 + (i % 5)) * MB);
    make(J('Pictures', 'Zalo', 'VID_2041.mp4'), 180 * MB);
    await wait(50);
    await js(`window.cleandrive.scan(${JSON.stringify(home)})`);

    await js(`document.querySelector('.tab[data-tab="trends"]').click()`);
    await js(`window.Changes.load()`);
    await wait(600);
    await js(`window.Changes.open(${JSON.stringify(home)})`);
    await wait(900);
    // The link under the growth figure, as it reads when the volume is growing.
    const volume = path.parse(home).root.toLowerCase();
    await js(`renderChangesLink({ growth: { ok: true, bytesPerMonth: 6.2 * 1024 ** 3 }, volume: ${JSON.stringify(volume)} })`);

    for (const name of ['light', 'dark']) {
      await theme(name);
      await js(`document.getElementById('changes-card').scrollIntoView({ block: 'start' })`);
      await shoot(`changes-${name}`);
      await js(`document.querySelector('#changes-body .changes-files').scrollIntoView({ block: 'start' })`);
      await shoot(`changes-files-${name}`);
    }

    await theme('light');
    await js(`document.querySelector('main').scrollTop = 0`);
    await shoot('trends-link-light');

    await js(`document.querySelector('[data-language-choice="vi"]').click()`);
    await wait(900);
    await js(`renderChangesLink({ growth: { ok: true, bytesPerMonth: 6.2 * 1024 ** 3 }, volume: ${JSON.stringify(volume)} })`);
    await js(`document.querySelector('main').scrollTop = 0`);
    await shoot('trends-link-vi-light');
    await js(`document.getElementById('changes-card').scrollIntoView({ block: 'start' })`);
    await shoot('changes-vi-light');
    await js(`document.querySelector('#changes-body .changes-files').scrollIntoView({ block: 'start' })`);
    await shoot('changes-files-vi-light');
    await js(`document.querySelector('[data-language-choice="en"]').click()`);
    await wait(700);

    // A folder scanned once.
    await js(`(() => {
      const select = document.getElementById('changes-root');
      select.value = [...select.options].find((o) => o.value.endsWith('Scanned once')).value;
      select.dispatchEvent(new Event('change'));
    })()`);
    await wait(500);
    await js(`document.getElementById('changes-card').scrollIntoView({ block: 'start' })`);
    await shoot('changes-once-light');

    await theme('dark');
    await js(`window.Changes.open(${JSON.stringify(home)})`);
    win.setSize(700, 820);
    await wait(900);
    await js(`document.getElementById('changes-card').scrollIntoView({ block: 'start' })`);
    await shoot('changes-narrow-dark');
    await js(`document.querySelector('#changes-body .changes-files').scrollIntoView({ block: 'start' })`);
    await shoot('changes-files-narrow-dark');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log(`\nwritten to ${OUT}`);
  console.log(errors.length ? `renderer errors: ${errors.slice(0, 4).join(' | ')}` : 'no renderer errors');
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
