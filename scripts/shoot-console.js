'use strict';

// Screenshots of the console (H3) and of what the report policy changes in the
// main window -- both themes, Vietnamese (and one English), 1180, 720 and 560
// wide.
//
//   npx electron scripts/shoot-console.js [outputDir]
//
// The console's real window, preload, handlers and service (console-main.js)
// over a folder of nine machine reports written by the real report builder,
// one of them caught by the console's seal memory, and a file that is not a
// report. Then the main window with a policy of the harness's own asking for a
// report: the line at the top, and the daily measurement held on Trends.
//
// Throwaway userData, a suffixed task name, a policy key under
// HKCU\Software\CleanDrive-Harness, a share folder on D: -- all removed on
// exit. Every state is checked on screen before it is shot; a shot of the
// wrong state throws instead of being saved, and so does anything that sticks
// out sideways.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow, nativeTheme } = require('electron');

const REG = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
const KEY = `HKEY_CURRENT_USER\\Software\\CleanDrive-Harness\\Policy_shootconsole_${crypto.randomBytes(3).toString('hex')}`;
process.env.CLEANDRIVE_POLICY_KEY = KEY;
process.env.CLEANDRIVE_ENTITLEMENTS = 'all';

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootconsole-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootconsole';
const SHARE = path.join('D:', path.sep, `cleandrive-shootconsole-${crypto.randomBytes(3).toString('hex')}`);
process.on('exit', () => {
  spawnSync(REG, ['delete', KEY, '/f', '/reg:64'], { windowsHide: true });
  for (const dir of [SANDBOX, SHARE]) {
    try {
      if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) continue;
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // nothing useful to do while exiting
    }
  }
});
require('../src/main/lib/preview/serve').registerScheme();

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-console.js')) || path.join(os.tmpdir(), 'cd-console-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------ the share */

const report = require('../src/main/fleet/report');
const model = require('../src/main/fleet/console-model');
const m = (key, en, params) => (params ? { i18n: key, en, params } : { i18n: key, en });

function machine(host, o = {}) {
  const now = Date.now();
  const at = o.at || now - 2 * 3600 * 1000;
  const vol = (root, pct, total, extra = {}) => ({
    root,
    latest: { at, totalBytes: total, usedBytes: total * (pct / 100), freeBytes: total * (1 - pct / 100), usedPercent: pct },
    growth: extra.growth || { ok: true, bytesPerDay: 2.1e8, r2: 0.93, n: 30, spanDays: 29 },
    prediction: extra.prediction || { ok: true, days: 180, at: now + 180 * DAY, bytesPerDay: 2.1e8, r2: 0.93, n: 30 },
  });
  const profile = (id, over = {}) => ({
    profileId: id,
    wanted: true,
    dryRun: false,
    action: 'recycle',
    installed: true,
    verified: true,
    os: { lastRunAt: now - DAY + 2 * 3600 * 1000, nextRunAt: now + 6 * DAY, lastResult: 0, state: 'ready', missedRuns: 0 },
    ...over,
  });
  return report.build({
    host,
    now: at,
    app: { version: o.version || '0.5.0', channel: 'stable' },
    volumes: o.volumes || [vol('c:\\', 62, 512e9)],
    lastScan: o.scan === null ? null : {
      root: 'C:\\',
      at: now - 5 * DAY,
      totalBytes: 210e9,
      totalFiles: 412345,
      byCategory: { temp: 3.2e9, cache: 1.8e9, log: 4.1e8, crashdump: 1.2e9 },
      topFolders: [{ name: 'Users', size: 120e9 }, { name: 'Program Files', size: 40e9 }],
    },
    topFolders: o.topFolders === true,
    tasks: { supported: true, profiles: o.profiles || [profile('main')], sampler: { installed: true, verified: true, os: { lastRunAt: at, lastResult: 0 } } },
    runs: o.runs || [{ profileId: 'main', startedAt: now - DAY + 2 * 3600 * 1000, finishedAt: now - DAY + 2 * 3600 * 1000 + 40000, outcome: 'ok', dryRun: false, selected: { files: 132, bytes: 1.3e9 }, trashed: { files: 128, bytes: 1.2e9, failed: 0, freedBytes: 0 } }],
    journal: o.journal === undefined
      ? { counts: { sealed: 14, altered: 0, unsealed: 0, legacy: 2, incomplete: 0 }, missingCount: 0, seals: { count: 14, last: 14, lastAt: now - DAY, lastHash: crypto.createHash('sha256').update(host).digest('hex'), lastKey: 'a'.repeat(64) } }
      : o.journal,
    managed: { status: 'present', applied: ['MachineReport', 'AutomaticCleanup'], notApplied: o.notApplied || [], refused: [] },
  });
}

function writeShare() {
  fs.mkdirSync(SHARE);
  const now = Date.now();
  const put = (r, name = report.fileNameFor(r.host)) => fs.writeFileSync(path.join(SHARE, name), report.serialize(r));
  put(machine('KETOAN-01', { topFolders: true }));
  put(machine('KETOAN-02', { volumes: [{ root: 'c:\\', latest: { at: now - 3600e3, totalBytes: 256e9, usedBytes: 233e9, freeBytes: 23e9, usedPercent: 91 }, growth: { ok: true, bytesPerDay: 1.9e9, r2: 0.97, n: 28, spanDays: 27 }, prediction: { ok: true, days: 12, at: now + 12 * DAY } }] }));
  put(machine('NHANSU-LAPTOP-03', { at: now - 4 * DAY - 3600e3 }));
  put(machine('KINHDOANH-04', {
    profiles: [
      { profileId: 'main', wanted: true, dryRun: false, action: 'recycle', installed: true, verified: false, os: { lastRunAt: now - 2 * DAY, lastResult: 0x80070002, state: 'ready' } },
      { profileId: 'policy', wanted: true, dryRun: true, action: 'recycle', installed: false, verified: false, os: null },
    ],
    runs: [{ profileId: 'main', startedAt: now - 9 * DAY, outcome: 'skipped', reason: m('run.appsRunning', 'Skipped because these are running: {apps}', { apps: 'secret.exe' }), trashed: { files: 0, bytes: 0 } }],
  }));
  put(machine('DEV-05', {
    volumes: [
      { root: 'c:\\', latest: { at: now - 3600e3, totalBytes: 1e12, usedBytes: 9.7e11, freeBytes: 3e10, usedPercent: 97 }, growth: { ok: true, bytesPerDay: 1e7, r2: 0.2, n: 30, spanDays: 29 }, prediction: { ok: false, reason: m('trends.reason.erratic', 'Usage moves too erratically to extrapolate (the trend explains only {pct}% of the variation).', { pct: 20 }) } },
      { root: 'd:\\', latest: { at: now - 3600e3, totalBytes: 2e12, usedBytes: 6e11, freeBytes: 1.4e12, usedPercent: 30 }, growth: { ok: true, bytesPerDay: 1e8, r2: 0.8, n: 30, spanDays: 29 }, prediction: { ok: false, beyondHorizon: true, reason: m('trends.reason.notSoon', 'At this rate the disk does not fill within two years.') } },
    ],
  }));
  put(machine('KIEMTOAN-06', {
    journal: { counts: { sealed: 37, altered: 0, unsealed: 0, legacy: 0, incomplete: 0 }, missingCount: 0, seals: { count: 37, last: 37, lastAt: now - DAY, lastHash: 'b'.repeat(64), lastKey: 'c'.repeat(64) } },
  }));
  put(machine('MOI-07', {
    volumes: [{ root: 'c:\\', latest: { at: now - 3600e3, totalBytes: 512e9, usedBytes: 2e11, freeBytes: 3.12e11, usedPercent: 39 }, growth: { ok: false, n: 2, spanDays: 1, reason: m('trends.reason.tooLittle', 'Too little history to be worth reporting: {n} measurement(s) over {days} day(s). A week of data is the minimum.', { n: 2, days: '1.0' }) }, prediction: { ok: false, reason: m('trends.reason.tooLittle', 'Too little history to be worth reporting: {n} measurement(s) over {days} day(s). A week of data is the minimum.', { n: 2, days: '1.0' }) } }],
    profiles: [],
    runs: [],
    scan: null,
    journal: null,
    notApplied: ['QuarantineFolder'],
  }));
  put(machine('LETAN-08', {
    volumes: [{ root: 'c:\\', latest: { at: now - 3600e3, totalBytes: 256e9, usedBytes: 1.1e11, freeBytes: 1.46e11, usedPercent: 43 }, growth: { ok: true, bytesPerDay: -3e6, r2: 0.6, n: 30, spanDays: 29 }, prediction: { ok: false, reason: m('trends.reason.flat', 'Usage is flat or falling, so there is nothing to extrapolate.') } }],
    profiles: [],
    runs: [],
  }));
  fs.writeFileSync(path.join(SHARE, 'ghichu.cleandrive.json'), 'không phải JSON');

  // The console has read KIEMTOAN-06 before, up to seal 40: today's 37 is a step back.
  const seen = { version: 1, shares: { [model.shareKey(SHARE)]: { 'kiemtoan-06': { seals: { 40: 'd'.repeat(64), 37: 'b'.repeat(64) }, maxN: 40, key: 'c'.repeat(64), lastGeneratedAt: now - 2 * DAY } } } };
  fs.writeFileSync(path.join(SANDBOX, 'console-seen.json'), JSON.stringify(seen));
}

/* ------------------------------------------------------------ helpers */

function writePolicy(values) {
  spawnSync(REG, ['delete', KEY, '/f', '/reg:64'], { windowsHide: true });
  const lines = ['Windows Registry Editor Version 5.00', '', `[${KEY}]`];
  for (const [name, value] of Object.entries(values)) {
    lines.push(typeof value === 'number' ? `"${name}"=dword:${value.toString(16).padStart(8, '0')}` : `"${name}"="${String(value).replace(/\\/g, '\\\\')}"`);
  }
  lines.push('');
  const file = path.join(SANDBOX, 'policy.reg');
  fs.writeFileSync(file, Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf16le'));
  const r = spawnSync(REG, ['import', file, '/reg:64'], { windowsHide: true });
  if (r.status !== 0) throw new Error(`reg import failed: ${String(r.stderr)}`);
}

function tools(win, inks) {
  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  const read = (expr) => win.webContents.executeJavaScript(expr);
  const until = async (expr, ms = 30000, what = expr) => {
    const start = Date.now();
    while (!(await read(expr))) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for: ${what}`);
      await wait(150);
    }
  };
  /** §11 item 9: the palette has to have reached every ink before anything is shot. */
  const paletteSettled = async (mode, ms = 8000) => {
    const sample = () =>
      read(`(() => {
        const rgb = (v) => (String(v).match(/[\\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
        const lum = (c) => {
          const [r, g, b] = rgb(c).map((n) => { const x = n / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const inks = ${JSON.stringify(inks)}.map((s) => (s === 'body' ? document.body : document.querySelector(s))).filter(Boolean).map((el) => lum(getComputedStyle(el).color));
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
  const theme = async (mode) => {
    nativeTheme.themeSource = mode;
    await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
    await paletteSettled(mode);
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
  /** Nothing past the scroll container's content edge, and no sideways scroll. */
  const overflow = async (label, container) => {
    const o = await read(`(() => {
      const box = document.querySelector(${JSON.stringify(container)});
      const edge = box.getBoundingClientRect().left + box.clientWidth + 1;
      const wide = [...box.querySelectorAll('*')].filter((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.right <= edge || el.classList.contains('panel-bar')) return false;
        // Inside a box that clips or scrolls on its own, past the window's edge is the box's business.
        for (let p = el.parentElement; p && p !== box; p = p.parentElement) { const s = getComputedStyle(p).overflowX; if (s !== 'visible') return p.getBoundingClientRect().right > edge; }
        return true;
      });
      return { scroll: getComputedStyle(box).overflowX !== 'hidden' ? box.scrollWidth - box.clientWidth : 0, wide: wide.slice(0, 4).map((el) => el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 40) + ' +' + Math.round(el.getBoundingClientRect().right - edge) + 'px "' + (el.textContent || '').trim().slice(0, 30) + '"') };
    })()`);
    console.log(`    ${label}: scrolls sideways ${o.scroll}px${o.wide.length ? `, past the edge: ${o.wide.join(', ')}` : ''}`);
    if (o.scroll > 0 || o.wide.length > 0) throw new Error(`${label}: something sticks out`);
  };
  const size = async (w) => {
    win.setContentSize(w, 820);
    await wait(500);
  };
  return { js, read, until, theme, shoot, overflow, size, paletteSettled };
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  const { services } = require('../src/main/services');
  if (services().policy.key !== KEY) throw new Error(`the policy would be read from ${services().policy.key}, not the harness key`);
  fs.mkdirSync(OUT, { recursive: true });
  writeShare();
  writePolicy({ ReportFolder: SHARE });
  fs.writeFileSync(path.join(SANDBOX, 'settings.json'), JSON.stringify({ version: require('../src/main/lib/settings').SCHEMA_VERSION, appearance: { theme: 'light', language: 'vi' } }));

  /* ============================================================ the console */
  const consoleMain = require('../src/main/fleet/console-main');
  const service = await consoleMain.serviceFor({ share: SHARE, allowed: true });
  if (service.share !== SHARE) throw new Error('the console is not pointed at the fixture share');
  let win = null;
  consoleMain.registerHandlers(service, () => win);
  win = consoleMain.createWindow({ width: 1180, height: 820 });
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  const c = tools(win, ['body', '.console-title h1', '.console-sort', '.console-host']);
  await c.until(`document.querySelectorAll('#console-rows tr[data-host]').length === 8`, 30000, 'eight machines drawn');
  if (!(await c.read(`document.documentElement.lang === 'vi'`))) throw new Error('the console is not in Vietnamese');

  const listState = () =>
    c.read(`(() => ({
      rows: [...document.querySelectorAll('#console-rows tr[data-host]')].map((tr) => tr.dataset.host),
      attention: [...document.querySelectorAll('#console-rows tr.is-attention')].map((tr) => tr.dataset.host),
      status: document.getElementById('console-status').textContent,
      unreadable: document.getElementById('console-unreadable').textContent,
      text: document.getElementById('console-table').innerText,
    }))()`);
  const s = await listState();
  const need = [
    [/không báo cáo 4 ngày/, 'the silent laptop'],
    [/C:\\ đầy sau khoảng 12 ngày/, 'the drive filling within 30 days'],
    [/C:\\ đã đầy 97/, 'the nearly full drive'],
    [/lùi từ số 40 về số 37/, 'the seal that went back'],
    [/0x80070002/, 'the task whose program moved'],
    [/Lịch sử còn quá ít/, 'the forecast that refuses itself, in Vietnamese'],
    [/đi ngang hoặc giảm/, 'the flat drive, with the reason Trends gives'],
  ];
  const missingText = need.filter(([re]) => !re.test(s.text)).map(([, what]) => what);
  if (missingText.length > 0) throw new Error(`not on screen: ${missingText.join(', ')}\n${s.text}`);
  if (!/ghichu\.cleandrive\.json/.test(s.unreadable)) throw new Error(`the file that is not a report is not listed: ${s.unreadable}`);
  if (s.attention[0] === 'ketoan-01' || !s.attention.includes('kiemtoan-06')) throw new Error(`order or attention wrong: ${s.attention.join()}`);
  console.log(`    status: ${s.status}`);

  for (const mode of ['light', 'dark']) {
    await c.theme(mode);
    for (const w of [1180, 720, 560]) {
      await c.size(w);
      await c.js(`document.getElementById('console').scrollTop = 0;`);
      await c.overflow(`console list ${mode} ${w}`, '#console');
      await c.shoot(`console-list-vi-${mode}-${w}`);
    }
  }

  // The machine the console caught, opened.
  await c.js(`document.querySelector('#console-rows tr[data-host="kiemtoan-06"] .console-host').click();`);
  await c.until(`!document.getElementById('console-detail').hidden && /KIEMTOAN-06/.test(document.getElementById('console-detail-title').textContent)`, 10000, 'the detail of KIEMTOAN-06');
  const detail = await c.read(`document.getElementById('console-detail').innerText`);
  for (const [re, what] of [[/đã lùi kể từ lần console này đọc trước/, 'the console\'s own check'], [/Bắt đầu lại con dấu/, 'the button that starts it again'], [/không nhận ra người giả mọi báo cáo/, 'the limit, said'], [/Tạm|Bộ nhớ đệm|Tệp tạm/, 'the categories, in Vietnamese']]) {
    if (!re.test(detail)) throw new Error(`detail: ${what} not on screen\n${detail}`);
  }
  for (const mode of ['light', 'dark']) {
    await c.theme(mode);
    for (const w of [720, 560]) {
      await c.size(w);
      await c.js(`document.getElementById('console-detail').scrollIntoView({ block: 'start' });`);
      await c.overflow(`console detail ${mode} ${w}`, '#console');
      await c.shoot(`console-detail-vi-${mode}-${w}`);
    }
  }

  // One machine whose largest folders the policy allows.
  await c.js(`document.querySelector('#console-rows tr[data-host="ketoan-01"] .console-host').click();`);
  await c.until(`/Các thư mục lớn nhất/.test(document.getElementById('console-detail').innerText)`, 10000, 'the largest folders of KETOAN-01');
  await c.theme('light');
  await c.size(720);
  await c.js(`document.getElementById('console-detail').scrollIntoView({ block: 'start' });`);
  await c.overflow('console detail top folders light 720', '#console');
  await c.shoot('console-detail-topfolders-vi-light-720');
  await c.js(`document.getElementById('console-detail-close').click();`);

  // The filter.
  await c.js(`document.querySelector('#console-filters button[data-filter="journal"]').click();`);
  await c.until(`document.querySelectorAll('#console-rows tr[data-host]').length === 1`, 5000, 'one machine under "Nhật ký"');
  await c.size(1180);
  await c.shoot('console-filter-journal-vi-light-1180');
  await c.js(`document.querySelector('#console-filters button[data-filter="all"]').click();`);

  // No Business, and no folder.
  service.allowed = false;
  await c.js(`location.reload();`);
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await c.until(`!document.getElementById('console-gate').hidden && /CleanDrive Business/.test(document.getElementById('console-gate-text').textContent)`, 10000, 'the licence gate');
  await c.theme('dark');
  await c.size(720);
  await c.overflow('console licence gate dark 720', '#console');
  await c.shoot('console-gate-licence-vi-dark-720');
  service.allowed = true;
  service.setShare(null);
  await c.js(`location.reload();`);
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await c.until(`!document.getElementById('console-gate').hidden && !document.getElementById('console-gate-command').hidden && /--console/.test(document.getElementById('console-gate').innerText)`, 10000, 'the no-folder gate');
  await c.theme('light');
  await c.size(560);
  await c.overflow('console no folder light 560', '#console');
  await c.shoot('console-gate-noshare-vi-light-560');
  win.destroy();

  /* ============================================================ the main window: the policy line and the held switch */
  const ipc = require('../src/main/ipc');
  ipc.register();
  const main = new BrowserWindow({
    width: 1180,
    height: 820,
    show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await main.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'vi' } });
  nativeTheme.themeSource = 'light';
  const t = tools(main, ['body', '.brand-name', '.tab .tab-label', '.managed-banner-text']);
  await wait(800);
  await t.js(`document.querySelector('.tab[data-tab="trends"]').click(); document.querySelector('main').scrollTop = 0;`);
  await t.until(`(() => { const b = document.getElementById('trend-daily'); return b && b.disabled && b.checked && b.classList.contains('is-managed'); })()`, 20000, 'the daily measurement held on');
  const banner = await t.read(`document.getElementById('managed-banner').textContent.replace(/\\s+/g, ' ').trim()`);
  if (!banner.includes(SHARE) || !/bản tóm tắt hằng ngày/.test(banner)) throw new Error(`the policy line does not say where the report goes: ${banner}`);
  const markShown = await t.read(`(() => { const m = document.querySelector('.managed-mark[data-managed="report"]'); return Boolean(m && !m.hidden && m.offsetParent !== null); })()`);
  if (!markShown) throw new Error('the padlock beside the daily measurement is not shown');
  console.log(`    banner: ${banner}`);
  for (const mode of ['light', 'dark']) {
    await t.theme(mode);
    for (const w of [720, 560]) {
      await t.size(w);
      await t.js(`document.getElementById('trend-daily').scrollIntoView({ block: 'center' });`);
      await t.overflow(`trends held ${mode} ${w}`, 'main');
      await t.shoot(`console-trends-held-vi-${mode}-${w}`);
    }
  }
  // And the top of the window, where the line is.
  await t.theme('light');
  await t.size(720);
  await t.js(`document.querySelector('main').scrollTop = 0;`);
  await t.shoot('console-banner-vi-light-720');

  console.log(`\nshots in ${OUT}`);
  app.exit(0);
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
