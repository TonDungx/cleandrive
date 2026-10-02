'use strict';

// Screenshots of A4: three folders chosen (one inside another, one on a
// network drive), the drive dialog, a whole drive's map with the tile for what
// the scan did not count, and the Free tier's hint -- in both themes, in
// Vietnamese and in a narrow window.
//
//   npx electron scripts/shoot-multiroot.js [outputDir]
//
// Throwaway userData, suffixed task names, folders of its own. The whole
// drive is a `subst` letter over one of them and the network folder is one of
// them on D: read through this machine's LAN address, as in test-multiroot.js;
// both are removed at the end.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootmultiroot-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootmultiroot';
require('../src/main/lib/preview/serve').registerScheme();

const SUBST = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'subst.exe');
const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-multiroot.js'))
  || path.join(os.tmpdir(), 'cd-multiroot-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function write(file, bytes, ageDays = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crypto.randomBytes(bytes));
  if (ageDays) fs.utimesSync(file, new Date(Date.now() - ageDays * 86400000), new Date(Date.now() - ageDays * 86400000));
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  const cleanups = [];
  try {
    require('../src/main/lib/preview/serve').serve();
    const ipc = require('../src/main/ipc');
    ipc.register();
    const picks = [];
    ipc.setScanHarness({ pick: async () => picks.shift() || null });
    fs.mkdirSync(OUT, { recursive: true });

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootmultiroot-fixture-'));
    cleanups.push(() => fs.rmSync(work, { recursive: true, force: true }));
    const photos = path.join(work, 'Ảnh gia đình');
    const projects = path.join(work, 'Dự án');
    write(path.join(photos, '2024', 'Đà Lạt.mp4'), 9 * 1024 * 1024);
    write(path.join(photos, '2025', 'Tết.mov'), 6 * 1024 * 1024);
    write(path.join(projects, 'Bản vẽ', 'nhà mới.dwg'), 4 * 1024 * 1024);
    write(path.join(projects, 'Temp', 'render.tmp'), 3 * 1024 * 1024, 60);

    const wholeDir = path.join(work, 'Ổ trò chơi');
    write(path.join(wholeDir, 'Games', 'save.dat'), 2 * 1024 * 1024);
    const letter = ['S', 'T', 'U', 'V', 'W', 'X', 'Y'].find((l) => !fs.existsSync(`${l}:\\`));
    let whole = null;
    if (letter) {
      execFileSync(SUBST, [`${letter}:`, wholeDir]);
      cleanups.unshift(() => execFileSync(SUBST, [`${letter}:`, '/d']));
      whole = `${letter}:\\`;
    }

    const netDir = path.join('D:\\', `cleandrive-harness-net-${crypto.randomBytes(4).toString('hex')}`);
    write(path.join(netDir, 'Tài liệu chung', 'báo cáo.pptx'), 2 * 1024 * 1024);
    cleanups.push(() => fs.rmSync(netDir, { recursive: true, force: true }));
    const ip = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    const unc = ip && fs.existsSync(`\\\\${ip.address}\\D$\\${path.basename(netDir)}`)
      ? `\\\\${ip.address}\\D$\\${path.basename(netDir)}\\Tài liệu chung`
      : null;
    console.log(`\noutput: ${OUT}\nwhole drive: ${whole}\nnetwork: ${unc}\n`);

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
    nativeTheme.themeSource = 'light';
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    const until = async (expr, ms = 60000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await js(`return Boolean(${expr})`)) return true;
        await wait(150);
      }
      return false;
    };
    await wait(600);

    const shoot = async (name) => {
      await wait(400);
      win.webContents.invalidate();
      await win.webContents.capturePage();
      await wait(150);
      let bytes = (await win.webContents.capturePage()).toPNG();
      for (let n = 0; n < 3 && bytes.length === 0; n++) {
        await wait(300);
        bytes = (await win.webContents.capturePage()).toPNG();
      }
      fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
      console.log(`  ${name}.png`);
    };
    const theme = async (mode) => {
      nativeTheme.themeSource = mode;
      await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
      await wait(300);
    };
    const scan = async () => {
      await js(`document.querySelector('.tab[data-tab="usage"]').click(); document.getElementById('scan-stats').hidden = true; document.getElementById('run-scan').click();`);
      await until(`!document.getElementById('scan-stats').hidden && document.getElementById('cancel-scan').hidden`, 120000);
      await js(`document.querySelector('main').scrollTop = 0;`);
    };

    const roots = [photos, projects, path.join(photos, '2025'), ...(unc ? [unc] : [])];
    picks.push(roots[0]);
    await js(`document.getElementById('pick-folder').click();`);
    await wait(300);
    for (const root of roots.slice(1)) {
      picks.push(root);
      await js(`document.getElementById('add-folder').click();`);
      await wait(300);
    }
    await scan();
    await shoot('roots-light');
    await theme('dark');
    await shoot('roots-dark');

    await js(`document.getElementById('pick-drive').click();`);
    await until(`document.getElementById('drives').open && document.querySelectorAll('#drives-list .drive-option').length > 0`);
    await shoot('drives-dark');
    await theme('light');
    await shoot('drives-light');

    if (whole) {
      await js(`[...document.querySelectorAll('#drives-list .drive-option')].find((b) => b.querySelector('.drive-name').textContent.startsWith(${JSON.stringify(whole)})).click();`);
      await until(`!document.getElementById('cancel-scan').hidden`, 5000);
      await until(`!document.getElementById('scan-stats').hidden && document.getElementById('cancel-scan').hidden`, 120000);
      await js(`document.getElementById('spacemap-card').scrollIntoView({ block: 'start' });`);
      await shoot('whole-drive-light');
    } else {
      await js(`document.getElementById('drives').close();`);
    }

    process.env.CLEANDRIVE_ENTITLEMENTS = 'free';
    await js(`setRoots([${JSON.stringify(photos)}]); document.querySelector('main').scrollTop = 0; document.getElementById('add-folder').click();`);
    await until(`!document.getElementById('roots-hint').hidden`, 5000);
    await shoot('free-hint-light');
    process.env.CLEANDRIVE_ENTITLEMENTS = 'all';

    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
    await wait(800);
    await theme('dark');
    await js(`setRoots(${JSON.stringify(roots)});`);
    await scan();
    await shoot('roots-dark-vi');
    await theme('light');
    win.setSize(680, 820);
    await wait(500);
    await shoot('roots-narrow-vi');
    await js(`document.getElementById('pick-drive').click();`);
    await until(`document.getElementById('drives').open`);
    await shoot('drives-narrow-vi');
    await js(`document.getElementById('drives').close();`);

    console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
    win.destroy();
  } catch (err) {
    console.error('\nFailed:', err && err.stack ? err.stack : err);
  } finally {
    for (const undo of cleanups) {
      try { undo(); } catch (err) { console.log(`  (cleanup: ${err.message})`); }
    }
  }
  setTimeout(() => {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* still in use */ }
    app.exit(0);
  }, 500);
});
