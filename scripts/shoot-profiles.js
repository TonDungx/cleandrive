'use strict';

// Screenshots of G4: several automatic profiles, each its own policy, and the
// controls that decide what a profile does with what it picks -- in both
// themes, in Vietnamese and narrow.
//
//   npx electron scripts/shoot-profiles.js [outputDir]
//
// Throwaway userData, a suffixed task name, and no Windows task registered:
// every profile here is left switched off, which is how a new one starts
// anyway. The profiles are written through the real IPC and drawn by the real
// screen.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootprofiles-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootprofiles';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-profiles.js'))
  || path.join(os.tmpdir(), 'cd-profiles-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');

  // Folders the profiles point at. Real ones, on D:, so the rows are not empty
  // and nothing here reaches a folder anybody cares about.
  const base = fs.mkdtempSync(path.join('D:\\', 'cleandrive-shoot-profiles-'));
  for (const name of ['Downloads', 'Builds', 'Caches']) {
    fs.mkdirSync(path.join(base, name), { recursive: true });
    fs.writeFileSync(path.join(base, name, 'old.tmp'), Buffer.alloc(64 * 1024));
  }

  try {
    require('../src/main/lib/preview/serve').serve();
    require('../src/main/ipc').register();
    fs.mkdirSync(OUT, { recursive: true });
    console.log(`\nfixture: ${base}\noutput:  ${OUT}\n`);

    const win = new BrowserWindow({
      width: 1180,
      height: 940,
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

    // Three profiles, of the kinds the spec suggests. Written through the real
    // channels, each left switched off -- so nothing is registered with
    // Windows and nothing here is ever going to run.
    const at = (name) => JSON.stringify(path.join(base, name));
    await js(`
      document.querySelector('.tab[data-tab="auto"]').click();
      await new Promise((r) => setTimeout(r, 400));

      const first = (await window.cleandrive.getSettings()).data.settings.autoClean.profiles[0];
      await window.cleandrive.saveAutoProfile({
        ...first, name: 'Weekly caches', roots: [${at('Caches')}], minAgeDays: 7,
        schedule: { ...first.schedule, kind: 'weekly', time: '02:00', weekday: 0 },
      });

      // Not the spec's "monthly installers": \`installer\` is not on the
      // unattended whitelist in automatic/allowed-categories.js, so a profile
      // naming it would have no categories left and match nothing.
      const second = (await window.cleandrive.addAutoProfile({})).data.settings.autoClean.profiles[1];
      await window.cleandrive.saveAutoProfile({
        ...second, name: 'Monthly crash dumps', roots: [${at('Downloads')}], minAgeDays: 30,
        categories: ['crashdump', 'log'],
        schedule: { ...second.schedule, kind: 'monthly', time: '03:00', day: 1 },
      });

      const third = (await window.cleandrive.addAutoProfile({})).data.settings.autoClean.profiles[2];
      const saved = await window.cleandrive.saveAutoProfile({
        ...third, name: 'Build output, to the other drive', roots: [${at('Builds')}],
        minAgeDays: 60, action: 'quarantine', categories: ['buildoutput'],
        schedule: { ...third.schedule, kind: 'monthly', time: '04:00', day: 1 },
      });
      applyAutoState(saved.data);
    `);
    await wait(700);

    const state = await win.webContents.executeJavaScript(`({
      chips: [...document.querySelectorAll('#auto-profiles .profile-chip')].map((c) => c.textContent),
    })`);
    console.log(`  profiles on screen: ${state.chips.join(' | ')}\n`);
    if (state.chips.length !== 3) throw new Error(`expected three profiles, got ${state.chips.length}`);

    // The panel scrolls under its own sticky bar, so the top of the page is
    // the only framing that shows the whole profile row.
    const toTop = `document.querySelector('#panel-auto').scrollTop = 0; document.querySelector('main').scrollTop = 0; window.scrollTo(0, 0);`;
    await js(toTop);
    await shoot('profiles-light');
    await theme('dark');
    await shoot('profiles-dark');
    await theme('light');

    // The third profile moves files to another drive and keeps the originals,
    // which frees nothing -- and the note under the control says exactly that.
    // Reached by clicking its chip, which is also what proves the chips switch
    // what the form below is editing.
    await js(`
      document.querySelectorAll('#auto-profiles .profile-chip')[2].click();
      await new Promise((r) => setTimeout(r, 500));
      document.getElementById('auto-action').scrollIntoView({ block: 'center' });
    `);
    await shoot('action-quarantine-light');
    await theme('dark');
    await shoot('action-quarantine-dark');
    await theme('light');

    // Back to the first, which is the ordinary one.
    await js(`
      document.querySelector('#auto-profiles .profile-chip').click();
      await new Promise((r) => setTimeout(r, 500));
      document.getElementById('auto-action').scrollIntoView({ block: 'center' });
    `);
    await shoot('action-recycle-light');

    // Narrow: the chips wrap rather than overflow.
    win.setBounds({ width: 860, height: 940 });
    await wait(500);
    await js(toTop);
    await shoot('profiles-narrow');
    win.setBounds({ width: 1180, height: 940 });
    await wait(500);

    // Vietnamese, where the labels are longest.
    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="vi"]').click();
    `);
    await wait(800);
    await js(`
      document.querySelector('.tab[data-tab="auto"]').click();
      await new Promise((r) => setTimeout(r, 500));
      document.querySelector('#panel-auto').scrollTop = 0; window.scrollTo(0, 0);
    `);
    await shoot('profiles-vi');
    await js(`
      document.querySelectorAll('#auto-profiles .profile-chip')[2].click();
      await new Promise((r) => setTimeout(r, 400));
      document.getElementById('auto-action').scrollIntoView({ block: 'center' });
    `);
    await shoot('action-quarantine-vi');

    if (errors.length) console.log(`\n  renderer errors: ${errors.length}\n${errors.map((e) => `    ${e}`).join('\n')}`);
    else console.log('\n  no renderer errors');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    app.quit();
  }
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
