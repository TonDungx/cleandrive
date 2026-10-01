'use strict';

// Screenshots of what the command line (H1) leaves in the window: a Restore
// Center session "from the command line", and the Automatic tab's last run
// marked the same way -- in both themes, at 1180, 720 and 560 wide, in English
// and Vietnamese.
//
//   npx electron scripts/shoot-cli.js [outputDir]
//
// The data is made by the command line itself, not drawn: a profile is
// written into a throwaway user-data folder, and `cleandrive run --profile`
// is started as a real child process against it, moving two files of this
// script's own (on D:) to the real Recycle Bin. At the end `cleandrive
// restore` puts both back, and the folder is removed -- nothing of anybody
// else's is touched, and nothing is left in the bin.
//
// Every element is found by the words it should say; a picture of a screen
// that does not say them is not taken, the script throws.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootcli-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootcli';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-cli.js')) || path.join(os.tmpdir(), 'cd-cli-shots');
const FIXTURE = path.join('D:', path.sep, `cleandrive-shoot-cli-${crypto.randomBytes(4).toString('hex')}`);
const REPO = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

app.on('window-all-closed', () => {});

/** The command line, as a separate process on the same data. */
function cli(tokens) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REPO, '--cli', `--user-data-dir=${SANDBOX}`, ...tokens], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  let session = null;
  try {
    // The command line's own data folder must be this one too.
    const v = await cli(['version', '--json']);
    const reported = JSON.parse(v.out).dataDir;
    if (path.resolve(reported).toLowerCase() !== path.resolve(SANDBOX).toLowerCase()) throw new Error(`the command line is not isolated: ${reported}`);

    const old = Date.now() - 60 * DAY;
    for (const rel of ['work\\left-behind.tmp', 'Tải về\\half-downloaded.crdownload']) {
      const file = path.join(FIXTURE, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, crypto.randomBytes(180000));
      fs.utimesSync(file, new Date(old), new Date(old));
    }
    fs.writeFileSync(path.join(SANDBOX, 'settings.json'), JSON.stringify({
      version: 12,
      trends: { dailySample: false, sampleTime: '12:00' },
      monitor: { enabled: false },
      purge: { enabled: false },
      autoClean: { profiles: [{ id: 'main', enabled: true, dryRun: false, roots: [FIXTURE], categories: ['temp'], minAgeDays: 7, minDiskUsedPercent: 0, skipIfRunning: [] }] },
    }));
    const run = await cli(['run', '--profile', 'main', '--json']);
    const doc = JSON.parse(run.out);
    session = doc.session;
    if (run.code !== 0 || !session || doc.moved.files !== 2) throw new Error(`the command line's run did not move the two files: ${run.code} ${run.err}`);
    console.log(`\nfiles:   ${FIXTURE}\nsession: ${session}\noutput:  ${OUT}\n`);

    require('../src/main/lib/preview/serve').serve();
    require('../src/main/ipc').register();
    fs.mkdirSync(OUT, { recursive: true });

    const win = new BrowserWindow({
      width: 1180, height: 820, show: true,
      webPreferences: { preload: path.join(REPO, 'src', 'main', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    const errors = [];
    win.webContents.on('console-message', (...args) => {
      const level = typeof args[1] === 'object' ? args[1].level : args[1];
      const message = typeof args[1] === 'object' ? args[1].message : args[2];
      if (level === 3 || level === 'error') errors.push(message);
    });
    await win.loadFile(path.join(REPO, 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'en' } });
    nativeTheme.themeSource = 'light';
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    const until = async (expr, ms = 20000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await js(`return Boolean(${expr})`)) return true;
        await wait(200);
      }
      return false;
    };
    await wait(600);

    const shoot = async (name) => {
      await wait(400);
      let bytes = (await win.webContents.capturePage()).toPNG();
      for (let n = 0; n < 3 && bytes.length === 0; n++) {
        await wait(300);
        bytes = (await win.webContents.capturePage()).toPNG();
      }
      fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
      console.log(`  ${name}.png`);
    };
    // The whole page on the asked palette before anything is captured: the
    // half-switched page is the trap §11 item 9 describes.
    const theme = async (mode) => {
      nativeTheme.themeSource = mode;
      await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
      const want = mode === 'dark' ? 'rgb(233, 236, 243)' : 'rgb(17, 21, 28)';
      if (!(await until(`getComputedStyle(document.body).color === ${JSON.stringify(want)} && getComputedStyle(document.querySelector('.brand-name')).color === ${JSON.stringify(want)}`, 8000))) {
        throw new Error(`the ${mode} palette never arrived`);
      }
    };
    /** The element whose text says `words`, scrolled into view -- or a throw. */
    const find = async (selector, words) => {
      const ok = await until(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((el) => el.offsetParent !== null && el.textContent.includes(${JSON.stringify(words)}))`);
      if (!ok) throw new Error(`nothing matching ${selector} says "${words}"`);
      await js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.offsetParent !== null && el.textContent.includes(${JSON.stringify(words)})).scrollIntoView({ block: 'center' });`);
    };
    const tab = async (name) => {
      await js(`document.querySelector('.tab[data-tab="${name}"]').click();`);
      await wait(500);
    };
    const language = async (code) => {
      await tab('settings');
      await js(`document.querySelector('[data-language-choice="${code}"]').click();`);
      await wait(900);
    };

    const pair = async (suffix, words) => {
      await tab('restore');
      await find('.restore-session', words.restore);
      await shoot(`restore-${suffix}`);
      await tab('auto');
      await find('#auto-result', words.auto);
      await shoot(`auto-${suffix}`);
    };

    const en = { restore: 'from the command line', auto: '(from the command line)' };
    const vi = { restore: 'từ dòng lệnh', auto: '(chạy từ dòng lệnh)' };
    await theme('light');
    await pair('light', en);
    await theme('dark');
    await pair('dark', en);

    await language('vi');
    for (const width of [720, 560]) {
      win.setSize(width, 820);
      await wait(500);
      for (const mode of ['light', 'dark']) {
        await theme(mode);
        await pair(`vi-${width}-${mode}`, vi);
      }
    }
    win.setSize(1180, 820);
    await language('en');
    console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  } catch (err) {
    console.error('\nFailed:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (session) {
      const back = await cli(['restore', session, '--json']);
      console.log(back.code === 0 ? `put back: ${JSON.parse(back.out).putBack.length} file(s)` : `restore exited ${back.code}: ${back.err.trim()}`);
      if (back.code !== 0) process.exitCode = 1;
    }
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
    for (const dir of [FIXTURE, SANDBOX]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        console.log(`    (left behind, still in use: ${dir})`);
      }
    }
    app.exit(process.exitCode || 0);
  }
});
