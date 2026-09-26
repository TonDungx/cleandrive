'use strict';

// Screenshots of C1 and C5: the projects half of the Developer screen, in both
// themes, in Vietnamese, in a narrow window, with a project's evidence open,
// and with nothing chosen to scan.
//
//   npx electron scripts/shoot-devprojects.js [outputDir]
//
// Throwaway userData and a suffixed task name. The folder it scans is built
// here on D: and removed afterwards -- not under the system temp directory,
// because that is inside AppData and this scan refuses to walk into AppData.
// It writes nothing else outside the output folder.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootproj-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootproj';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-devprojects.js'))
  || path.join(os.tmpdir(), 'cd-devproj-shots');
const FIXTURE = path.join('D:', path.sep, 'cleandrive-shot-projects');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

/**
 * A tree holding every case the screen has to draw: a project whose build
 * folder it may take, a vendored library it must not, and a folder of releases
 * somebody meant to keep.
 */
function buildFixture() {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  const put = (rel, bytes, content) => {
    const full = path.join(FIXTURE, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content === undefined ? 'x' : content);
    if (bytes) {
      const fd = fs.openSync(full, 'r+');
      fs.ftruncateSync(fd, bytes);
      fs.closeSync(fd);
    }
    fs.utimesSync(full, old, old);
  };
  const MB = 1024 * 1024;

  put(path.join('checkout-web', 'package.json'), 0, '{"name":"checkout-web"}');
  put(path.join('checkout-web', 'package-lock.json'), 0, '{}');
  put(path.join('checkout-web', '.gitignore'), 0, 'node_modules/\ndist/\n');
  put(path.join('checkout-web', 'src', 'index.js'), 40 * 1024);
  put(path.join('checkout-web', 'node_modules', 'react', 'index.js'), 412 * MB);
  put(path.join('checkout-web', 'dist', 'bundle.js'), 86 * MB);
  put(path.join('checkout-web', 'dist', 'bundle.js.map'), 31 * MB);
  put(path.join('checkout-web', 'static', 'vendors', 'bootstrap', 'package.json'), 0, '{}');
  put(path.join('checkout-web', 'static', 'vendors', 'bootstrap', 'dist', 'bootstrap.min.css'), 64 * MB);

  put(path.join('invoice-api', 'requirements.txt'), 0, 'fastapi');
  put(path.join('invoice-api', '.gitignore'), 0, '# PyInstaller\ndist/\n');
  put(path.join('invoice-api', 'main.py'), 18 * 1024);
  put(path.join('invoice-api', '.venv', 'Lib', 'site.py'), 274 * MB);
  put(path.join('invoice-api', 'dist', 'invoice-api.exe'), 142 * MB);

  put(path.join('lingua-mobile', 'package.json'), 0, '{}');
  put(path.join('lingua-mobile', 'dist', 'Lingua-1.2.1-universal.apk'), 96 * MB);
  put(path.join('lingua-mobile', 'dist', 'Lingua-1.2.0-universal.apk'), 94 * MB);

  put(path.join('scratch-tool', 'package.json'), 0, '{}');
  put(path.join('scratch-tool', 'node_modules', 'left-pad', 'index.js'), 58 * MB);
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  const projects = require('../src/main/dev/projects');
  if (projects.excludedReason(FIXTURE)) throw new Error('the fixture is where this scan refuses to look');

  try {
    require('../src/main/lib/preview/serve').serve();
    require('../src/main/ipc').register();
    fs.mkdirSync(OUT, { recursive: true });
    buildFixture();
    console.log(`\noutput:  ${OUT}\nfixture: ${FIXTURE}\n`);

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
    const until = async (expr, ms = 180000) => {
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
    /** Bring the projects half into view, past the tools half above it. */
    const toProjects = async () => {
      await js(`
        const title = document.querySelector('.dev-section-title');
        if (title) title.scrollIntoView({ block: 'start' });
      `);
      await wait(400);
    };

    await js(`document.querySelector('.tab[data-tab="dev"]').click();`);
    await wait(300);
    await toProjects();
    await shoot('devproj-nothing-chosen-light');

    await js(`window.setRoots([${JSON.stringify(FIXTURE)}]);`);
    await js(`document.querySelector('.tab[data-tab="dev"]').click();`);
    await toProjects();
    await js(`document.getElementById('devp-scan').click();`);
    await wait(500);
    await toProjects();
    await shoot('devproj-running-light');

    const done = await until(`document.getElementById('devp-cancel').hidden && window.devProjectsScreen.view.result`);
    if (!done) throw new Error('the scan did not finish');
    await toProjects();
    await shoot('devproj-light');
    await theme('dark');
    await shoot('devproj-dark');

    // The two kinds of build folder, side by side: the one its .gitignore
    // declares, and the one that only looks like build output.
    await js(`
      const section = document.querySelector('#devp-groups .dev-group[data-kind="buildDeclared"]');
      if (section) section.scrollIntoView({ block: 'start' });
    `);
    await wait(400);
    await shoot('devproj-builds-dark');

    // A project's evidence, which is where the reasoning is.
    await js(`
      const card = document.querySelector('#devp-groups .dev-tool');
      card.scrollIntoView({ block: 'center' });
      card.querySelector('.badge-button').click();
    `);
    await wait(400);
    await shoot('devproj-evidence-dark');

    // And the evidence of a folder it refuses to act on, which is the one
    // worth reading twice.
    await js(`
      const open = document.querySelector('#devp-groups .badge-button[aria-expanded="true"]');
      if (open) open.click();
      const guess = document.querySelector('#devp-groups .dev-group[data-kind="buildGuess"] .dev-tool');
      guess.scrollIntoView({ block: 'center' });
      guess.querySelector('.badge-button').click();
    `);
    await wait(400);
    await shoot('devproj-guess-evidence-dark');
    await js(`
      const open = document.querySelector('#devp-groups .badge-button[aria-expanded="true"]');
      if (open) open.click();
    `);

    // Vietnamese.
    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
    await wait(800);
    await js(`document.querySelector('.tab[data-tab="dev"]').click();`);
    await toProjects();
    await theme('light');
    await shoot('devproj-vi-light');
    await theme('dark');
    await shoot('devproj-vi-dark');

    win.setSize(720, 820);
    await wait(500);
    await toProjects();
    await shoot('devproj-narrow-vi-dark');
    win.setSize(560, 820);
    await wait(500);
    await toProjects();
    await shoot('devproj-verynarrow-vi-dark');
    win.setSize(1180, 820);
    await wait(400);

    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="en"]').click();`);
    await wait(700);
    await theme('light');
    await js(`document.querySelector('.tab[data-tab="dev"]').click();`);
    await toProjects();

    await js(`
      window.devProjectsScreen.view.result = { candidates: null, summary: null, locked: 'pro.dev' };
      window.devProjectsScreen.render();
    `);
    await wait(400);
    await toProjects();
    await shoot('devproj-locked-light');

    if (errors.length) console.log(`\nconsole errors: ${errors.length}\n  ${errors.slice(0, 5).join('\n  ')}`);
    else console.log('\nno console errors');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await wait(300);
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    fs.rmSync(FIXTURE, { recursive: true, force: true });
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${SANDBOX})`);
    }
    app.quit();
  }
});
