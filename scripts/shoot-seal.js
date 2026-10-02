'use strict';

// Screenshots of the seal on the journal (H4), in the Restore Center: a
// licence that does not seal, a journal with one session changed after it was
// sealed, and a licence that stopped sealing -- in both themes, in Vietnamese,
// and at 720 and 560 wide.
//
//   npx electron scripts/shoot-seal.js [outputDir]
//
// Throwaway userData, a suffixed task name. The seals are real: a key made
// through real DPAPI into the sandbox, sessions sealed by the app's own
// journal, and one line then edited the way a person with Notepad would.
// The sessions name files that do not exist, inside the sandbox, so nothing
// anywhere is touched and every card says its files are no longer in the bin.
//
// Every state is checked by its words before it is shot, and a shot of the
// wrong state throws instead of being saved.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

// Read by the services the first time they build the journal, and by the
// window each time it asks what this build may use. Starts as Pro, so the
// app's own journal does not seal.
process.env.CLEANDRIVE_ENTITLEMENTS = 'pro';

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootseal-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootseal';
process.on('exit', () => {
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    // nothing useful to do while exiting
  }
});
require('../src/main/lib/preview/serve').registerScheme();

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-seal.js')) ||
  path.join(os.tmpdir(), 'cd-seal-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();
  const { services } = require('../src/main/services');
  const { ActionJournal } = require('../src/main/journal/journal');
  const { Sealer } = require('../src/main/journal/seal');
  if (!services().journalDir.startsWith(SANDBOX) || !services().sealKeyPath.startsWith(SANDBOX)) throw new Error('journal or key outside the sandbox');
  if (services().sealer !== null) throw new Error('the app’s journal seals under Pro');
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`\noutput: ${OUT}\n`);

  /* -- the journal ------------------------------------------------------------ */

  const files = (folder, names) => names.map((name, i) => ({ path: path.join(SANDBOX, folder, name), size: (i + 1) * 1.3 * MB }));
  const now = Date.now();
  // Before sealing began: written by the app's journal, which does not seal.
  await services().journal.appendSession('recycle', files('Temp', ['render-cache.dat', 'update.tmp', 'old-log.txt']).map((f) => ({ ...f, trashedAt: now - 20 * DAY })), {
    source: 'scheduled',
    startedAt: now - 20 * DAY,
  });

  const win = new BrowserWindow({
    width: 1180,
    height: 860,
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
  const read = (expr) => win.webContents.executeJavaScript(expr);
  await wait(800);

  const shoot = async (name) => {
    await wait(400);
    win.webContents.invalidate();
    // The first frame after a repaint is routinely the one before the change.
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let k = 0; k < 3 && bytes.length === 0; k += 1) {
      await wait(300);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };
  const theme = async (mode) => {
    nativeTheme.themeSource = mode;
    await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
    await wait(400);
  };
  const language = async (code) => {
    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="${code}"]').click();
    `);
    await wait(1000);
  };
  // The tab's own click starts a load, and a second `load()` while that one
  // runs returns at once -- so wait for the one the click started.
  const openRestore = async () => {
    await js(`restoreCenter.view.sessions = null; document.querySelector('.tab[data-tab="restore"]').click();`);
    const start = Date.now();
    while (!(await read(`restoreCenter.view.loading === false && restoreCenter.view.sessions !== null`))) {
      if (Date.now() - start > 60000) throw new Error('the Restore Center did not load');
      await wait(150);
    }
    await js(`document.querySelector('main').scrollTop = 0;`);
    await wait(300);
  };

  /** What the block above the cards says, and what one card says. Throws on the wrong state. */
  const expect = async (label, test) => {
    const seen = await read(`(() => {
      const box = document.getElementById('restore-integrity');
      const cards = [...document.querySelectorAll('.restore-session')];
      return {
        hidden: box.hidden,
        text: [...box.querySelectorAll('p')].map((p) => p.className + ': ' + p.textContent),
        badges: cards.map((c) => (c.querySelector('.badge-seal') || {}).textContent || null),
        notes: [...document.querySelectorAll('.restore-seal-note')].map((p) => p.textContent),
      };
    })()`);
    if (!test(seen)) throw new Error(`${label}: not on screen\n${JSON.stringify(seen, null, 2)}`);
    return seen;
  };
  /** Nothing may stick out of the side at the narrow widths. */
  const overflow = async (label) => {
    const o = await read(`(() => {
      const main = document.querySelector('main');
      const wide = [...document.querySelectorAll('#panel-restore *')].filter((el) => el.getBoundingClientRect().right > main.getBoundingClientRect().right + 1);
      return { scroll: main.scrollWidth - main.clientWidth, wide: wide.slice(0, 3).map((el) => el.className || el.tagName) };
    })()`);
    console.log(`    ${label}: horizontal overflow ${o.scroll}px${o.wide.length ? `, past the edge: ${o.wide.join(', ')}` : ''}`);
    if (o.scroll > 0 || o.wide.length > 0) throw new Error(`${label}: something sticks out`);
  };

  /* -- 1. a licence that does not seal ----------------------------------------- */

  await openRestore();
  await expect('the refusal', (s) => !s.hidden && s.text.length === 1 && /^upgrade-hint: Sealing the journal is part of CleanDrive Business/.test(s.text[0]) &&
    s.badges.every((b) => b === null));
  await shoot('seal-business-off-light');

  /* -- 2. sealed, and one session changed since ---------------------------------- */

  const sealed = new ActionJournal(services().journalDir, {
    sealer: new Sealer({ key: services().sealKey, lockFile: path.join(services().journalDir, '.seal.lock') }),
  });
  await sealed.appendSession('recycle', files('Downloads', ['setup-4.2.exe', 'holiday-2019.mkv', 'invoice-march.pdf', 'scan-0001.jpg']).map((f) => ({ ...f, trashedAt: now - 6 * DAY })), {
    source: 'scheduled',
    startedAt: now - 6 * DAY,
  });
  const changed = await sealed.appendSession('recycle', files('Videos', ['screen-recording-0912.mp4', 'screen-recording-0913.mp4', 'old-export.mov']).map((f) => ({ ...f, trashedAt: now - 2 * DAY })), {
    source: 'manual',
    startedAt: now - 2 * DAY,
  });
  await sealed.appendSession('recycle', files('Documents', ['draft-old.docx', 'budget-2024.xlsx']).map((f) => ({ ...f, trashedAt: now - 3600_000 })), {
    source: 'manual',
    startedAt: now - 3600_000,
  });
  // One number in one line, edited as text.
  const month = fs.readdirSync(services().journalDir).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort().pop();
  const file = path.join(services().journalDir, month);
  const rows = fs.readFileSync(file, 'utf8').split('\n');
  const at = rows.findIndex((raw) => raw.includes(`"session":"${changed.id}"`) && raw.includes('"op":"item"'));
  if (at < 0) throw new Error('no line to edit');
  rows[at] = rows[at].replace(/"bytes":\d+/, '"bytes":1024');
  fs.writeFileSync(file, rows.join('\n'));

  process.env.CLEANDRIVE_ENTITLEMENTS = 'all';
  const isChanged = (s) =>
    !s.hidden && /^restore-integrity-head: Changed after sealing: 1 session · 2 still as sealed · 1 not sealed/.test(s.text[0]) &&
    s.badges.includes('Changed after sealing') && s.badges.includes('Sealed') && s.badges.includes('Not sealed') &&
    s.notes.some((n) => new RegExp(`^Line ${at + 1} of the journal file ${month.replace('.', '\\.')} was changed after it was sealed\\.$`).test(n));
  await openRestore();
  const seen = await expect('one session changed', isChanged);
  console.log(`    says: ${seen.text.map((t) => t.replace(/^[a-z-]+: /, '')).join(' / ')}`);
  await shoot('seal-changed-light');
  await theme('dark');
  await shoot('seal-changed-dark');

  /* -- Vietnamese -------------------------------------------------------------- */

  await language('vi');
  await openRestore();
  await expect('the same, in Vietnamese', (s) => /^restore-integrity-head: Bị sửa sau khi niêm phong: 1 lần · 2 vẫn nguyên như lúc niêm phong/.test(s.text[0]) &&
    s.badges.includes('Bị sửa sau khi niêm phong') && s.notes.some((n) => n.startsWith(`Dòng ${at + 1} của tệp nhật ký`)));
  await shoot('seal-changed-vi-dark');
  await theme('light');
  await shoot('seal-changed-vi-light');

  /* -- narrow --------------------------------------------------------------------- */

  for (const width of [720, 560]) {
    win.setSize(width, 860);
    await wait(500);
    await openRestore();
    await overflow(`${width} vi`);
    await shoot(`seal-${width}-vi-light`);
    await theme('dark');
    await shoot(`seal-${width}-vi-dark`);
    await theme('light');
  }
  await language('en');
  for (const width of [720, 560]) {
    win.setSize(width, 860);
    await wait(500);
    await openRestore();
    await expect(`${width} en`, isChanged);
    await overflow(`${width} en`);
    await shoot(`seal-${width}-en-light`);
  }
  win.setSize(1180, 860);
  await wait(400);

  /* -- 3. a licence that stopped sealing ------------------------------------------- */

  process.env.CLEANDRIVE_ENTITLEMENTS = 'pro';
  await openRestore();
  await expect('stopped', (s) => s.text.some((t) => /^restore-integrity-note: New sessions are not sealed: sealing the journal is part of CleanDrive Business/.test(t)) &&
    s.badges.includes('Changed after sealing'));
  await shoot('seal-stopped-light');

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
