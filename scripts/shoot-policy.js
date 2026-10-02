'use strict';

// Screenshots of the organisation's policy (H2): the line at the top of every
// screen, the padlocks on the Automatic screen (the organisation's own profile,
// and a person's profile under its category ceiling, protected folders and
// view only), automatic cleanup forced off, the Settings cards for updates
// and the quarantine folder, and an action bar held by view only -- in both
// themes, in Vietnamese and English, at 1180, 720 and 560 wide.
//
//   npx electron scripts/shoot-policy.js [outputDir]
//
// Throwaway userData, a suffixed task name, and a policy key of the harness's
// own under HKCU\Software\CleanDrive-Harness (written with reg.exe, removed on
// exit) -- never a real Policies key. Every state is checked by what is on
// screen before it is shot, and a shot of the wrong state throws instead of
// being saved.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow, nativeTheme } = require('electron');

const REG = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
const KEY = `HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\Policy_shoot_${crypto.randomBytes(3).toString('hex')}`;
process.env.CLEANDRIVE_POLICY_KEY = KEY;
process.env.CLEANDRIVE_ENTITLEMENTS = 'all';

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootpolicy-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootpolicy';
// On D:, so the scan sees it (os.tmpdir() is inside AppData, which it refuses).
const FIXTURE = path.join('D:', path.sep, `cleandrive-shootpolicy-${crypto.randomBytes(3).toString('hex')}`);
process.on('exit', () => {
  spawnSync(REG, ['delete', KEY, '/f', '/reg:64'], { windowsHide: true });
  for (const dir of [SANDBOX, FIXTURE]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // nothing useful to do while exiting
    }
  }
});
require('../src/main/lib/preview/serve').registerScheme();

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-policy.js')) ||
  path.join(os.tmpdir(), 'cd-policy-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

/** The policy key, written whole each time: `sections` as `{ subkey: { name: value } }`. */
function writePolicy(sections) {
  spawnSync(REG, ['delete', KEY, '/f', '/reg:64'], { windowsHide: true });
  const lines = ['Windows Registry Editor Version 5.00', ''];
  for (const [rel, values] of Object.entries(sections)) {
    lines.push(`[${rel ? `${KEY}\\${rel}` : KEY}]`);
    for (const [name, value] of Object.entries(values)) {
      lines.push(typeof value === 'number' ? `"${name}"=dword:${value.toString(16).padStart(8, '0')}` : `"${name}"="${String(value).replace(/\\/g, '\\\\')}"`);
    }
    lines.push('');
  }
  const file = path.join(SANDBOX, 'policy.reg');
  fs.writeFileSync(file, Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf16le'));
  const r = spawnSync(REG, ['import', file, '/reg:64'], { windowsHide: true });
  if (r.status !== 0) throw new Error(`reg import failed: ${String(r.stderr)}`);
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  const { services } = require('../src/main/services');
  if (services().policy.key !== KEY) throw new Error(`the policy would be read from ${services().policy.key}, not the harness key`);

  // A person's own profile, and a folder for the scan.
  fs.mkdirSync(path.join(FIXTURE, 'Temp'), { recursive: true });
  const old = Date.now() - 400 * DAY;
  for (let i = 0; i < 6; i += 1) {
    const f = path.join(FIXTURE, 'Temp', `render-${i}.tmp`);
    fs.writeFileSync(f, crypto.randomBytes(200000 + i * 50000));
    fs.utimesSync(f, new Date(old), new Date(old));
  }
  fs.writeFileSync(
    path.join(SANDBOX, 'settings.json'),
    JSON.stringify({
      version: 12,
      trends: { dailySample: false, sampleTime: '12:00' },
      autoClean: {
        profiles: [{ id: 'main', enabled: true, dryRun: false, roots: [FIXTURE, 'D:\\Downloads'], whitelist: ['D:\\Downloads\\keep'], categories: ['temp', 'cache', 'log', 'gpucache', 'buildoutput'], skipIfRunning: [] }],
      },
      updates: { enabled: true },
    })
  );
  const ORG = {
    '': { ViewOnly: 1, AutomaticCleanup: 1, AllowedCategories: 1, ProtectedFolders: 1, DisableUpdateCheck: 1, QuarantineFolder: path.join(FIXTURE, 'Org') },
    Automatic: { Schedule: 'weekly', Time: '02:00', Weekday: 0, ReportOnly: 1, Action: 'recycle', MinAgeDays: 30 },
    'Automatic\\Folders': { 1: 'D:\\Shared\\Scratch', 2: path.join(FIXTURE, 'Temp') },
    AllowedCategories: { temp: 1, cache: 1, log: 1 },
    ProtectedFolders: { 1: 'D:\\Projects\\Contracts' },
  };
  fs.mkdirSync(path.join(FIXTURE, 'Org'), { recursive: true });
  writePolicy(ORG);

  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();
  // What a launch does: the tasks brought into line with the settings and the
  // policy, so the screen is not showing "no task is registered" for a state
  // only this script is in. Suffixed, and removed when this process exits.
  await require('../src/main/tasks').reconcile(await services().settings.load(), { settingsExisted: true, sampler: false });
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`\noutput: ${OUT}\npolicy key: ${KEY}\n`);

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
  // What main.js does at launch: the update checker's state goes to the
  // window as it changes, so a policy that switches checks off shows at once.
  require('../src/main/updater').apply(await services().settings.get(), {
    onEvent: (payload) => {
      if (!win.isDestroyed()) win.webContents.send('update:state', payload);
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
  const until = async (expr, ms = 30000, what = expr) => {
    const start = Date.now();
    while (!(await read(expr))) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for: ${what}`);
      await wait(150);
    }
  };
  await wait(800);

  /** §11 item 9: the palette has to have reached every ink before anything is shot. */
  const paletteSettled = async (mode, ms = 8000) => {
    const sample = () =>
      read(`(() => {
        const rgb = (v) => (String(v).match(/[\\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
        const lum = (c) => {
          const [r, g, b] = rgb(c).map((n) => { const x = n / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const inks = ['body', '.brand-name', '.tab .tab-label', '.managed-banner-text'].map((s) => (s === 'body' ? document.body : document.querySelector(s))).filter(Boolean).map((el) => lum(getComputedStyle(el).color));
        return { inks, background: lum(getComputedStyle(document.body).backgroundColor) };
      })()`);
    const start = Date.now();
    let last = null;
    while (Date.now() - start < ms) {
      const s = await sample();
      const dark = mode === 'dark';
      const right = dark ? s.background < 0.1 && s.inks.every((n) => n > 0.2) : s.background > 0.7 && s.inks.every((n) => n < 0.4);
      const key = JSON.stringify(s);
      if (right && key === last) return true;
      last = key;
      await wait(200);
    }
    throw new Error(`the ${mode} palette did not settle`);
  };

  const shoot = async (name) => {
    await wait(300);
    win.webContents.invalidate();
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
    await paletteSettled(mode);
  };
  const language = async (code) => {
    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="${code}"]').click();
    `);
    await wait(1000);
  };
  const tab = async (name) => {
    await js(`document.querySelector('.tab[data-tab="${name}"]').click(); document.querySelector('main').scrollTop = 0;`);
    await wait(700);
  };
  const reloadPolicy = async () => {
    await js(`await Managed.load(); if (typeof refreshAutoState === 'function') await refreshAutoState();`);
    await wait(600);
  };

  /** What the policy put on screen. */
  const state = () =>
    read(`(() => {
      const shown = (sel) => [...document.querySelectorAll(sel)].filter((el) => !el.hidden && el.offsetParent !== null);
      const held = (id) => { const el = document.getElementById(id); return Boolean(el && el.disabled && el.classList.contains('is-managed')); };
      return {
        banner: document.getElementById('managed-banner').hidden ? null : document.getElementById('managed-banner').textContent.replace(/\\s+/g, ' ').trim(),
        marks: shown('.managed-mark[data-managed]').map((m) => m.dataset.managed),
        barMarks: shown('.managed-mark-bar').length,
        chips: [...document.querySelectorAll('.profile-chip')].map((c) => (c.classList.contains('is-managed-profile') ? '🔒' : '') + c.textContent.trim()),
        heldRun: held('auto-run'),
        heldEnabled: held('auto-enabled'),
        heldDryRun: held('auto-dryrun'),
        heldPurge: held('purge-now'),
        heldUpdate: held('update-enabled') && held('update-check'),
        heldChoose: held('quarantine-choose'),
        heldCategories: [...document.querySelectorAll('#auto-categories input.is-managed')].map((b) => b.dataset.category),
        lockedRows: [...document.querySelectorAll('#auto-whitelist .path-row.is-managed-row .path-text')].map((t) => t.title),
        heldDelete: held('delete-cleanup'),
      };
    })()`);
  const expect = async (label, test) => {
    const s = await state();
    if (!test(s)) throw new Error(`${label}: not on screen\n${JSON.stringify(s, null, 2)}`);
    return s;
  };
  const overflow = async (label, panel) => {
    const o = await read(`(() => {
      const main = document.querySelector('main');
      // The content edge, not the box: the box includes the scrollbar, and a
      // child reaching under the scrollbar is what makes the page scroll sideways.
      const edge = main.getBoundingClientRect().left + main.clientWidth + 1;
      // A panel bar is drawn edge to edge on purpose (its negative margins) and
      // <main> clips it; at the narrow widths the panel's padding shrinks and the
      // bar's margins do not, so it reaches 6-10px past -- clipped, and found
      // there before H2. What it holds is still checked.
      const wide = [...document.querySelectorAll('main *, #managed-banner *')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > edge && !el.classList.contains('panel-bar'); });
      const scrollable = getComputedStyle(main).overflowX !== 'hidden';
      return { scroll: scrollable ? main.scrollWidth - main.clientWidth : 0, clipped: main.scrollWidth - main.clientWidth, wide: wide.slice(0, 4).map((el) => el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 40) + ' +' + Math.round(el.getBoundingClientRect().right - edge) + 'px "' + (el.textContent || '').trim().slice(0, 30) + '"') };
    })()`);
    console.log(`    ${label}: scrolls sideways ${o.scroll}px (clipped: ${o.clipped}px)${o.wide.length ? `, past the edge: ${o.wide.join(', ')}` : ''}`);
    if (o.scroll > 0 || o.wide.length > 0) throw new Error(`${label}: something sticks out`);
  };
  const selectProfile = async (id) => {
    await js(`document.querySelector('.profile-chip[data-profile-id="${id}"]').click();`);
    await wait(700);
  };

  /* -- 1. the organisation's profile, on the Automatic screen ------------------ */

  await tab('auto');
  await until(`document.querySelectorAll('.profile-chip').length === 2`, 30000, 'two profile chips');
  await selectProfile('policy');
  const theirs = (s) =>
    s.banner && /Your organisation manages some of CleanDrive on this computer: view only/.test(s.banner) &&
    s.chips.some((c) => c.startsWith('🔒') && /Your organisation’s profile/.test(c)) &&
    s.marks.includes('profile') && s.marks.includes('run') && s.heldEnabled && s.heldDryRun && s.heldRun;
  const s1 = await expect('the organisation’s profile', theirs);
  console.log(`    banner: ${s1.banner}`);
  await paletteSettled('light');
  await shoot('policy-auto-theirs-en-light');

  /* -- 2. the person's own profile under the policy ------------------------------- */

  await selectProfile('main');
  const mine = (s) =>
    s.marks.includes('categories') && s.marks.includes('protected') && s.marks.includes('run') && s.marks.includes('viewOnly') &&
    s.heldRun && s.heldPurge && !s.heldEnabled &&
    s.heldCategories.includes('gpucache') && s.heldCategories.includes('buildoutput') && !s.heldCategories.includes('temp') &&
    s.lockedRows.includes('D:\\Projects\\Contracts') && !s.lockedRows.includes('D:\\Downloads\\keep');
  await expect('a person’s profile under the policy', mine);
  const word = await read(`document.getElementById('auto-state').textContent.trim() + ' | ' + document.getElementById('auto-state').classList.contains('is-on')`);
  if (word !== 'Held: view only | false') throw new Error(`a profile held by view only is called "${word}"`);
  await shoot('policy-auto-mine-en-light');
  await js(`document.querySelector('#auto-categories').scrollIntoView({ block: 'center' });`);
  await wait(400);
  await shoot('policy-auto-mine-categories-en-light');

  /* -- Vietnamese, both themes ------------------------------------------------------ */

  await language('vi');
  await tab('auto');
  await selectProfile('policy');
  const theirsVi = (s) =>
    s.banner && /Tổ chức của bạn quản lý một phần CleanDrive trên máy này: chỉ cho xem/.test(s.banner) &&
    s.chips.some((c) => c.startsWith('🔒') && /Hồ sơ của tổ chức bạn/.test(c)) && s.marks.includes('profile') && s.heldRun;
  await expect('the organisation’s profile, in Vietnamese', theirsVi);
  const markText = await read(`document.querySelector('.managed-mark[data-managed="profile"]').textContent.trim()`);
  if (markText !== 'Do tổ chức của bạn quản lý') throw new Error(`the mark says "${markText}"`);
  await shoot('policy-auto-theirs-vi-light');
  await theme('dark');
  await shoot('policy-auto-theirs-vi-dark');
  await selectProfile('main');
  await expect('a person’s profile, in Vietnamese', (s) => s.marks.includes('categories') && s.heldCategories.includes('gpucache'));
  await js(`document.querySelector('#auto-categories').scrollIntoView({ block: 'center' });`);
  await wait(400);
  await shoot('policy-auto-mine-vi-dark');
  await theme('light');
  await shoot('policy-auto-mine-vi-light');

  /* -- 3. automatic cleanup forced off ------------------------------------------------ */

  writePolicy({ '': { AutomaticCleanup: 0 } });
  await reloadPolicy();
  await tab('auto');
  await expect('forced off', (s) => s.banner && /dọn dẹp tự động đang tắt/.test(s.banner) && s.marks.includes('automaticOff') && s.heldEnabled && s.heldRun && s.chips.length === 1);
  await shoot('policy-auto-off-vi-light');
  await theme('dark');
  await shoot('policy-auto-off-vi-dark');
  await theme('light');

  /* -- 4. the Settings cards: updates and the quarantine folder ------------------------ */

  writePolicy(ORG);
  await reloadPolicy();
  await tab('settings');
  await js(`await Quarantine.refresh();`);
  await wait(600);
  await expect('the settings cards', (s) => s.heldUpdate && s.heldChoose && s.marks.includes('updates') && s.marks.includes('quarantine'));
  await js(`document.getElementById('quarantine-card').scrollIntoView({ block: 'start' });`);
  await wait(400);
  await shoot('policy-settings-vi-light');
  await theme('dark');
  await shoot('policy-settings-vi-dark');
  await theme('light');
  await js(`document.getElementById('update-enabled').scrollIntoView({ block: 'center' });`);
  await wait(400);
  const detail = await read(`document.getElementById('update-detail').textContent.trim()`);
  if (!/Tổ chức của bạn đã tắt kiểm tra cập nhật/.test(detail)) throw new Error(`the updates card says "${detail}"`);
  await shoot('policy-updates-vi-light');
  await theme('dark');
  await shoot('policy-updates-vi-dark');
  await theme('light');

  /* -- 5. an action bar held by view only ----------------------------------------------- */

  await js(`setFolder(${JSON.stringify(FIXTURE)}); document.getElementById('run-scan').click();`);
  await until(`document.getElementById('scan-stats').hidden === false && !document.getElementById('run-scan').disabled`, 60000, 'the scan');
  await tab('cleanup');
  await until(`document.querySelectorAll('#panel-cleanup .file-row input[type=checkbox]').length > 0`, 20000, 'cleanup rows');
  await js(`document.querySelector('#panel-cleanup .file-row input[type=checkbox]').click();`);
  await wait(500);
  await expect('the action bar', (s) => s.heldDelete && s.barMarks >= 1);
  const refused = await read(`(async () => (await window.cleandrive.trash([${JSON.stringify(path.join(FIXTURE, 'Temp', 'render-0.tmp'))}], {})).data)()`);
  if (!refused || refused.refused !== 'managed' || !fs.existsSync(path.join(FIXTURE, 'Temp', 'render-0.tmp'))) {
    throw new Error(`the main process did not refuse a delete under view only: ${JSON.stringify(refused)}`);
  }
  console.log('    a delete asked for anyway: refused by the main process, the file is still there');
  await shoot('policy-cleanup-bar-vi-light');
  await theme('dark');
  await shoot('policy-cleanup-bar-vi-dark');
  await theme('light');

  /* -- narrow ----------------------------------------------------------------------------- */

  for (const width of [720, 560]) {
    win.setSize(width, 900);
    await wait(600);
    await tab('auto');
    await selectProfile('main');
    await overflow(`${width} vi, automatic`, 'panel-auto');
    await expect(`${width} vi`, (s) => s.banner && s.marks.includes('categories'));
    await shoot(`policy-${width}-auto-vi-light`);
    await theme('dark');
    await shoot(`policy-${width}-auto-vi-dark`);
    await theme('light');
    await tab('cleanup');
    await overflow(`${width} vi, cleanup`, 'panel-cleanup');
    await shoot(`policy-${width}-cleanup-vi-light`);
  }
  await language('en');
  for (const width of [720, 560]) {
    win.setSize(width, 900);
    await wait(600);
    await tab('auto');
    await selectProfile('policy');
    await expect(`${width} en`, theirs);
    await overflow(`${width} en, automatic`, 'panel-auto');
    await shoot(`policy-${width}-auto-en-light`);
  }

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
