'use strict';

// Screenshots of G1: a goal, the steps it would take to get there, the bin
// step where the space actually arrives, and what it says when the sources it
// knows are not enough -- in both themes, in Vietnamese and narrow.
//
//   npx electron scripts/shoot-planner.js [outputDir]
//
// Throwaway userData, a suffixed task name, a fixture of its own on D:.
//
// The plan is built by the real `planner/plan.js` from candidates the real
// analyzers produce for a real folder, and drawn by the real screen. What is
// replaced is only the measuring pass: running it for real means a
// whole-drive scan plus the tools, the programs and the games, which is
// minutes and produces a different picture on every machine.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootplanner-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootplanner';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-planner.js'))
  || path.join(os.tmpdir(), 'cd-planner-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GB = 1024 ** 3;

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  const cleanups = [];
  try {
    require('../src/main/lib/preview/serve').serve();
    const ipc = require('../src/main/ipc');
    ipc.register();
    fs.mkdirSync(OUT, { recursive: true });

    const { buildPlan } = require('../src/main/planner/plan');
    const { evidence } = require('../src/main/analyzers/contract');
    const { message: m } = require('../src/i18n');

    let serial = 0;
    const make = (category, bytes, { verdict = 'safe', actions = ['recycle'], kind = 'file' } = {}) => {
      serial += 1;
      return {
        id: `s${serial}`,
        path: kind === 'virtual' ? 'C:\\hiberfil.sys' : `C:\\fixture\\item-${serial}.bin`,
        kind,
        bytes,
        category,
        verdict,
        confidence: 'strong',
        evidence: [evidence(1, m('planner.shoot', 'from the screenshot harness'))],
        actions,
        unattendedEligible: false,
      };
    };
    const spread = (category, total, n, opts) =>
      Array.from({ length: n }, () => make(category, Math.round(total / n), opts));

    // Sizes in the shape a real machine produces: a lot of small cache files,
    // a few large system items, a handful of forgotten installers.
    const candidates = [
      ...spread('cleanup.temp', 3.1 * GB, 420),
      ...spread('cleanup.cache', 5.4 * GB, 980),
      ...spread('cleanup.log', 0.4 * GB, 130),
      ...spread('cleanup.gpucache', 1.2 * GB, 60),
      ...spread('cloud.dehydrate', 6.8 * GB, 74, { actions: ['dehydrate'] }),
      ...spread('cleanup.buildoutput', 2.9 * GB, 210),
      ...spread('dev.packageCache', 4.3 * GB, 12, { verdict: 'review' }),
      ...spread('dev.ideCache', 1.1 * GB, 40),
      make('system.hiberfil', 6.29 * GB, { kind: 'virtual', verdict: 'review', actions: ['handoff'] }),
      make('system.windowsOld', 8.1 * GB, { kind: 'virtual', verdict: 'review', actions: ['handoff'] }),
      make('system.restorePoints', 4.2 * GB, { kind: 'virtual', verdict: 'review', actions: ['handoff'] }),
      ...spread('cleanup.installer', 2.2 * GB, 9, { verdict: 'review' }),
      ...spread('cleanup.archive', 3.6 * GB, 5, { verdict: 'review' }),
      ...spread('apps.installed', 5.5 * GB, 7, { verdict: 'review', actions: ['handoff'] }),
      ...spread('games.steam', 41 * GB, 3, { verdict: 'review', actions: ['handoff'] }),
    ];

    const volume = { root: 'C:\\', totalBytes: 476 * GB, freeBytes: 18 * GB };
    const plans = {
      reached: buildPlan({
        goal: { kind: 'bytes', bytes: 30 * GB },
        volume,
        candidates,
        measured: ['scan', 'dev', 'apps', 'games', 'system'],
        missing: [{ id: 'dupes', reason: 'tooExpensive' }],
      }),
      short: buildPlan({
        goal: { kind: 'bytes', bytes: 120 * GB },
        volume,
        candidates: candidates.filter((c) => !c.category.startsWith('games.') && !c.category.startsWith('system.')),
        measured: ['scan', 'dev', 'apps'],
        missing: [{ id: 'dupes', reason: 'tooExpensive' }, { id: 'system', reason: 'notMeasured' }],
      }),
    };
    console.log(`\noutput: ${OUT}`);
    console.log(`  reached: ${(plans.reached.total / GB).toFixed(1)} GB of ${(plans.reached.target / GB).toFixed(0)} GB, ${plans.reached.steps.length} steps`);
    console.log(`  short:   ${(plans.short.total / GB).toFixed(1)} GB of ${(plans.short.target / GB).toFixed(0)} GB\n`);

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
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    await wait(700);

    const shoot = async (name) => {
      await wait(400);
      win.webContents.invalidate();
      await win.webContents.capturePage();
      await wait(150);
      let bytes = (await win.webContents.capturePage()).toPNG();
      for (let k = 0; k < 3 && bytes.length === 0; k++) {
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
    // Fed the way the running screen is fed -- down the progress channel, as
    // a partial plan -- so the drawing path in these pictures is the drawing
    // path a real run takes.
    const feed = async (which) => {
      await js(`document.querySelector('.tab[data-tab="planner"]').click();`);
      await wait(200);
      win.webContents.send('planner:progress', { phase: 'partial', plan: plans[which] });
      await wait(400);
    };

    await js(`document.querySelector('.tab[data-tab="planner"]').click();`);
    await wait(300);
    await shoot('empty-light');

    await feed('reached');
    await shoot('plan-light');
    await theme('dark');
    await shoot('plan-dark');
    await theme('light');

    // The step the whole screen turns on: where what went to the bin
    // actually leaves the drive.
    await feed('reached');
    await js(`document.querySelector('.plan-step.is-derived').scrollIntoView({ block: 'center' });`);
    await shoot('bin-step-light');

    await feed('short');
    await js(`document.querySelector('main').scrollTop = 0;`);
    await shoot('short-light');

    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
    await wait(800);
    await feed('reached');
    await shoot('plan-vi-light');
    await theme('dark');
    await shoot('plan-vi-dark');
    await theme('light');

    win.setSize(680, 900);
    await wait(500);
    await feed('reached');
    await shoot('plan-vi-narrow');

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
