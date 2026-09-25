'use strict';

// The introduction (I4), in the real window.
//
//   npx electron scripts/test-onboarding.js
//
// Boots the real renderer, preload and IPC the way main.js does on a first
// launch (the URL says `intro=1`; when main.js says so is test-intro.js's
// question) and checks that the three screens open by themselves, can be left
// every way they say, remember having been seen, move focus and name
// themselves for a screen reader, pass axe in both themes and in Vietnamese,
// still draw their illustration under a Windows contrast theme, and hold
// still for anyone who asked for less motion -- and that choosing a folder on
// the last screen chooses it and does nothing more.
//
// Isolation: throwaway userData, suffixed task names, both checked first.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const PRODUCTION_USER_DATA = app.getPath('userData');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-onboarding-userdata-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'onboarding';
require('../src/main/lib/preview/serve').registerScheme();

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  console.log('\nIsolation:');
  check('userData is a throwaway directory', app.getPath('userData') === SANDBOX && SANDBOX !== PRODUCTION_USER_DATA, SANDBOX);
  check('scheduled-task names are suffixed', Boolean(process.env.CLEANDRIVE_TASK_SUFFIX), process.env.CLEANDRIVE_TASK_SUFFIX);
  const realSettings = path.join(PRODUCTION_USER_DATA, 'settings.json');
  const realBefore = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;

  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();

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
  const INDEX = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  const dbg = win.webContents.debugger;
  const emulate = (media) => dbg.sendCommand('Emulation.setEmulatedMedia', { features: media });
  const press = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(80);
  };
  const load = async (query) => {
    await win.loadFile(INDEX, { query });
    await wait(500);
    if (!dbg.isAttached()) dbg.attach('1.3');
  };

  /* ---- a first launch ---- */

  console.log('\nA first launch:');
  nativeTheme.themeSource = 'light';
  await load({ theme: 'light', lang: 'en', intro: '1' });
  await emulate([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  win.focus();
  win.webContents.focus();
  let at = await js(`return { open: document.getElementById('intro').open, step: document.getElementById('intro-step').textContent,
    focus: document.activeElement.id, named: document.getElementById('intro').getAttribute('aria-labelledby'),
    back: document.getElementById('intro-back').hidden, page: [...document.querySelectorAll('[data-intro-page]')].filter((p) => !p.hidden).length }`);
  check('the introduction opens by itself', at.open === true);
  check('on the first of three screens, one screen at a time', at.step === 'Step 1 of 3' && at.page === 1, at.step);
  check('focus is on its heading, and the dialog is named by it', at.focus === 'intro-title-1' && at.named === 'intro-title-1', JSON.stringify(at));
  check('there is no Back on the first screen', at.back === true);

  await js(AXE);
  const axe = () => js(`return axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
    .then((r) => r.violations.map((v) => v.id + ' (' + v.nodes.length + '): ' + v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')))`);

  for (const mode of ['light', 'dark']) {
    nativeTheme.themeSource = mode;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(mode)}); Intro.show(0);`);
    for (let page = 1; page <= 3; page++) {
      await wait(200);
      const found = await axe();
      check(`${mode}: screen ${page} has no violations`, found.length === 0, found.join(' || '));
      if (page < 3) await js(`document.getElementById('intro-next').click();`);
    }
  }
  nativeTheme.themeSource = 'light';
  await js(`document.documentElement.setAttribute('data-theme', 'light'); Intro.show(0);`);

  await js(`document.getElementById('intro-next').click();`);
  at = await js(`return { step: document.getElementById('intro-step').textContent, focus: document.activeElement.id, named: document.getElementById('intro').getAttribute('aria-labelledby') }`);
  check('Next goes to the second, and focus follows to its heading', at.step === 'Step 2 of 3' && at.focus === 'intro-title-2' && at.named === 'intro-title-2', JSON.stringify(at));
  await js(`document.getElementById('intro-back').click();`);
  check('Back goes back', (await js(`return document.getElementById('intro-step').textContent`)) === 'Step 1 of 3');

  // Screen 2: the file going into the bin moves only for someone who has not
  // asked for less motion; for someone who has, it is already in there.
  await js(`Intro.show(1);`);
  at = await js(`const f = getComputedStyle(document.querySelector('.intro-file')); return { name: f.animationName, display: f.display }`);
  check('with motion allowed, the file is seen going into the bin', at.name === 'intro-into-bin' && at.display === 'block', JSON.stringify(at));
  await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await wait(150);
  at = await js(`const f = getComputedStyle(document.querySelector('.intro-file')); const can = getComputedStyle(document.querySelector('.intro-bin-can:not(.is-empty)'));
    return { display: f.display, full: can.backgroundImage }`);
  check('with less motion asked for, nothing moves, and the bin is shown holding it', at.display === 'none' && /gradient/.test(at.full), JSON.stringify(at));
  at = await js(`const [a, b] = document.querySelectorAll('.intro-bar-fill'); return { moved: a.getBoundingClientRect().width, emptied: b.getBoundingClientRect().width,
    caption: document.querySelector('[data-intro-page="2"] .intro-caption').textContent }`);
  check('the drive after a move to the bin is fuller than after emptying it', at.moved > at.emptied, `${at.moved.toFixed(0)} vs ${at.emptied.toFixed(0)} px`);
  check('and it says it is an illustration, not the user’s drive', /illustration/i.test(at.caption), at.caption.trim().slice(0, 60));

  // Tab stays inside a modal dialog.
  let inside = true;
  for (let i = 0; i < 10; i++) {
    await press('Tab');
    if (!(await js(`return document.getElementById('intro').contains(document.activeElement)`))) inside = false;
  }
  check('while it is open, Tab stays inside it', inside);

  // Screen 3: a folder is chosen, and only chosen.
  await js(`Intro.show(2);`);
  await wait(300);
  const paths = await js(`return [...document.querySelectorAll('#intro-paths button')].map((b) => ({ text: b.textContent, title: b.title }))`);
  check('the folder shortcuts are offered, each with its real path', paths.length > 0 && paths.every((p) => p.title && p.text), paths.map((p) => p.text).join(', '));
  await js(`document.querySelector('#intro-paths button').click();`);
  await wait(300);
  at = await js(`return { open: document.getElementById('intro').open, folder: document.getElementById('target-path').title,
    tab: document.querySelector('.panel.is-active').id, focus: document.activeElement.id,
    scanning: !document.getElementById('scan-progress').hidden, scanned: !document.getElementById('scan-stats').hidden,
    seen: localStorage.getItem('cleandrive.intro') }`);
  check('choosing one closes the introduction on Disk usage with that folder chosen', !at.open && at.folder === paths[0].title && at.tab === 'panel-usage', JSON.stringify(at));
  check('focus lands on Scan folder', at.focus === 'run-scan', at.focus);
  check('and no scan was started: that is still the person’s to press', !at.scanning && !at.scanned);
  check('the window remembers it has been seen', at.seen === 'seen', at.seen);

  /* ---- later launches ---- */

  console.log('\nLater launches:');
  await load({ theme: 'light', lang: 'en', intro: '1' });
  check('told it is a first launch again, it does not introduce itself twice', !(await js(`return document.getElementById('intro').open`)));
  await js(`localStorage.clear();`);
  await load({ theme: 'light', lang: 'en' });
  check('not told it is a first launch, it stays closed', !(await js(`return document.getElementById('intro').open`)));

  console.log('\nEvery way out, and back in from Settings:');
  await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  win.focus();
  win.webContents.focus();
  await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.getElementById('intro-open').focus(); document.getElementById('intro-open').click();`);
  await wait(200);
  check('Settings opens it again, at the start', await js(`return document.getElementById('intro').open && Intro.index() === 0`));
  await press('Escape');
  await wait(150);
  at = await js(`return { open: document.getElementById('intro').open, focus: document.activeElement.id }`);
  check('Esc closes it, and focus goes back to the button', !at.open && at.focus === 'intro-open', JSON.stringify(at));
  await js(`document.getElementById('intro-open').click();`);
  await js(`document.getElementById('intro-skip').click();`);
  check('Skip closes it', !(await js(`return document.getElementById('intro').open`)));
  await js(`document.getElementById('intro-open').click(); Intro.show(2);`);
  await js(`document.getElementById('intro-next').click();`);
  check('Done on the last screen closes it', !(await js(`return document.getElementById('intro').open`)));
  await js(`document.getElementById('intro-open').click(); Intro.show(2); document.getElementById('intro-system').click();`);
  await wait(200);
  at = await js(`return { open: document.getElementById('intro').open, tab: document.querySelector('.panel.is-active').id, focus: document.activeElement.id }`);
  check('the whole-drive button opens the System screen, focus on its tab', !at.open && at.tab === 'panel-system' && at.focus === 'tab-system', JSON.stringify(at));

  /* ---- Windows contrast theme ---- */

  console.log('\nWindows contrast theme (emulated):');
  await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'forced-colors', value: 'active' }]);
  await js(`document.getElementById('intro-open').click(); Intro.show(1);`);
  await wait(200);
  at = await js(`const fill = getComputedStyle(document.querySelector('.intro-bar-fill')); const bar = getComputedStyle(document.querySelector('.intro-bar'));
    const can = getComputedStyle(document.querySelector('.intro-bin-can:not(.is-empty)')); const empty = getComputedStyle(document.querySelector('.intro-bin-can.is-empty'));
    return { fill: fill.backgroundColor, bar: bar.backgroundColor, can: can.backgroundImage, empty: empty.backgroundImage + '|' + empty.backgroundColor }`);
  check('the drive’s bar still shows how full it is', at.fill !== at.bar, `${at.fill} on ${at.bar}`);
  check('and a full bin still looks different from an empty one', at.can !== at.empty, `${at.can.slice(0, 50)} vs ${at.empty.slice(0, 50)}`);
  await js(`document.getElementById('intro').close();`);
  await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

  /* ---- Vietnamese ---- */

  console.log('\nIn Vietnamese:');
  await js(`document.querySelector('[data-language-choice="vi"]').click();`);
  await wait(600);
  await js(`document.getElementById('intro-open').click();`);
  await wait(300);
  at = await js(`return { step: document.getElementById('intro-step').textContent, title: document.getElementById('intro-title-1').textContent,
    next: document.getElementById('intro-next').textContent, skip: document.getElementById('intro-skip').textContent }`);
  check('it speaks Vietnamese', at.step === 'Bước 1/3' && at.title === 'CleanDrive cho bạn thấy, rồi để bạn quyết định' && at.next === 'Tiếp' && at.skip === 'Bỏ qua', JSON.stringify(at));
  // The page was loaded again since axe went in.
  await js(AXE);
  for (let page = 1; page <= 3; page++) {
    await js(`Intro.show(${page - 1});`);
    await wait(250);
    const found = await axe();
    check(`vi: screen ${page} has no violations`, found.length === 0, found.join(' || '));
  }
  at = await js(`Intro.show(2); await new Promise((r) => setTimeout(r, 300)); return [...document.querySelectorAll('#intro-paths button')].map((b) => b.textContent)`);
  check('its folder shortcuts are named in Vietnamese', at.some((t) => ['Tải xuống', 'Tài liệu', 'Hình ảnh'].includes(t)), at.join(', '));
  await js(`document.getElementById('intro').close();`);

  console.log('\nConsole:');
  check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const realAfter = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;
  check('the real settings file was not touched', realAfter === realBefore);

  dbg.detach();
  win.destroy();
  setTimeout(() => {
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${SANDBOX})`);
    }
    console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
    app.exit(failures === 0 ? 0 : 1);
  }, 500);
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
