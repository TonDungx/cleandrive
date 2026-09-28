'use strict';

// G3: the control for the weekly or monthly summary, and the three things it
// says about itself.
//
//   npx electron scripts/shoot-recap.js [outputDir]
//
// The notification itself cannot be photographed -- it is a Windows toast, and
// `lib/notify.js` suppresses every toast while CLEANDRIVE_TASK_SUFFIX is set,
// which is exactly the guard that stops a harness shouting at whoever is using
// the machine. So what is captured is the control and its note, which is where
// the promises are made.
//
// Throwaway userData with a month of measurements built here, so the Trends
// card around it is not empty.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootrecap-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootrecap';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-recap.js'))
  || path.join(os.tmpdir(), 'cd-recap-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GB = 1024 ** 3;
const DAY = 24 * 60 * 60 * 1000;

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  fs.mkdirSync(OUT, { recursive: true });

  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();
  const { services } = require('../src/main/services');

  const { history } = services();
  await history.load();
  const now = Date.now();
  for (let i = 30; i >= 0; i--) {
    const used = 300 * GB + (30 - i) * 0.21 * GB;
    await history.addSnapshot({
      at: now - i * DAY,
      source: 'daily',
      volumes: {
        'c:\\': { totalBytes: 500 * GB, freeBytes: 500 * GB - used, usedBytes: used, usedPercent: (used / (500 * GB)) * 100 },
      },
      scan: i % 15 === 0 ? { root: 'D:\\Downloads', totalBytes: (4 + (30 - i) * 0.08) * GB, totalFiles: 900, byCategory: {}, topFolders: [] } : null,
    });
  }

  const win = new BrowserWindow({
    width: 1180, height: 900, show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
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
  const intoView = `document.getElementById('trend-recap-row').scrollIntoView({ block: 'center' });`;
  const set = (value, daily = true) => js(`
    document.getElementById('trend-daily').checked = ${daily};
    document.getElementById('trend-daily').dispatchEvent(new Event('change'));
    document.getElementById('trend-recap').value = ${JSON.stringify(value)};
    document.getElementById('trend-recap').dispatchEvent(new Event('change'));
    ${intoView}
  `);

  console.log(`\noutput: ${OUT}\n`);
  await js(`document.querySelector('.tab[data-tab="trends"]').click();`);
  await wait(800);

  await set('off');
  await shoot('recap-off-light');

  await set('monthly');
  await shoot('recap-on-light');
  await theme('dark');
  await shoot('recap-on-dark');
  await theme('light');

  // On, but with the measurement it rides on switched off: the note has to say
  // it would never fire.
  await set('monthly', false);
  await shoot('recap-needs-daily');

  win.setBounds({ width: 860, height: 900 });
  await wait(500);
  await set('weekly');
  await shoot('recap-narrow');
  win.setBounds({ width: 1180, height: 900 });
  await wait(500);

  await js(`
    document.querySelector('.tab[data-tab="settings"]').click();
    document.querySelector('[data-language-choice="vi"]').click();
  `);
  await wait(800);
  await js(`document.querySelector('.tab[data-tab="trends"]').click();`);
  await wait(600);
  await set('monthly');
  await shoot('recap-vi');

  // What the sentence itself would say, printed rather than photographed --
  // the toast is suppressed here, and this is the text that would be in it.
  const recap = require('../src/main/recap');
  const language = require('../src/main/language');
  const settings = await services().settings.get();
  const decision = recap.consider({
    history,
    settings: { ...settings, trends: { ...settings.trends, recap: 'monthly', recapLastAt: 0 } },
  });
  console.log('\n  the sentence it would show:');
  if (decision.due) {
    const w = recap.wording(decision.summary);
    console.log(`    ${language.render(w.title)}`);
    console.log(`    ${language.render(w.body)}${w.named ? ` ${language.render(w.named)}` : ''}`);
  } else {
    console.log(`    (nothing: ${language.render(decision.reason)})`);
  }

  if (errors.length) console.log(`\n  renderer errors: ${errors.length}\n${errors.map((e) => `    ${e}`).join('\n')}`);
  else console.log('\n  no renderer errors');
  app.quit();
}).catch((err) => {
  console.error('FAILED:', err);
  app.exit(1);
});
