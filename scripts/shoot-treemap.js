'use strict';

// Screenshots of the map of the folder on Disk usage, drawn from a real scan:
// both themes, a level further down with the tooltip up, the menu, the list
// view, keyboard focus, a narrow window, and Vietnamese.
//
//   npx electron scripts/shoot-treemap.js [folder] [outputDir]
//
// The folder defaults to the home folder. The pictures name folders and files
// on this machine, so they go to the output folder only, never into the
// repository.

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shoottreemap-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shoottreemap';

require('../src/main/lib/preview/serve').registerScheme();

const args = process.argv.filter((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-treemap.js'));
const FOLDER = path.resolve(args[0] || os.homedir());
const OUT = args[1] || path.join(os.tmpdir(), 'cd-treemap-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated: userData was not moved');
  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();

  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    // Painting continues when the window is behind others; without this a
    // capture returned the frame before the last change.
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (...a) => {
    const level = typeof a[1] === 'object' ? a[1].level : a[1];
    const message = typeof a[1] === 'object' ? a[1].message : a[2];
    if (level === 3 || level === 'error') errors.push(message);
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (expr) => win.webContents.executeJavaScript(expr);
  await wait(500);

  const shoot = async (name) => {
    // A fresh frame: ask for a repaint, and let one go by before keeping one.
    win.webContents.invalidate();
    await wait(350);
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let n = 0; n < 3 && bytes.length === 0; n++) {
      await wait(400);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };
  const until = async (expr, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(expr)) return true;
      await wait(500);
    }
    return false;
  };
  const theme = async (name) => {
    nativeTheme.themeSource = name;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(name)})`);
    await wait(500);
  };
  const toMap = () => js(`document.getElementById('spacemap-card').scrollIntoView({ block: 'start' })`);

  console.log(`scanning ${FOLDER} ...`);
  await js(`setFolder(${JSON.stringify(FOLDER)}); document.getElementById('run-scan').click()`);
  await until(`document.getElementById('run-scan').disabled === false && window.SpaceMap.debug().tiles.length > 0`, 10 * 60000);
  await wait(800);

  await theme('light');
  await toMap();
  await shoot('map-light');
  await theme('dark');
  await shoot('map-dark');

  // Into the biggest folder, with the pointer on a tile.
  await js(`(() => { const el = document.querySelector('#spacemap-tree > .spacemap-item.is-folder'); if (el) el.click(); })()`);
  await wait(900);
  await toMap();
  const point = await js(`(() => {
    const el = document.querySelector('#spacemap-tree .spacemap-group .spacemap-item') || document.querySelector('#spacemap-tree .spacemap-item');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 60)), y: Math.round(r.top + Math.min(r.height / 2, 40)) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  await wait(400);
  await shoot('map-deeper-tooltip-dark');

  // The menu on a file, if this level has one; on a folder otherwise.
  await theme('light');
  const target = await js(`(() => {
    const el = document.querySelector('#spacemap-tree .spacemap-item.is-file') || document.querySelector('#spacemap-tree .spacemap-item.is-folder');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + Math.min(r.height / 2, 30)) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: target.x, y: target.y, button: 'right', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: target.x, y: target.y, button: 'right', clickCount: 1 });
  await wait(500);
  await shoot('map-menu-light');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(300);

  // Keyboard focus, reached with real key presses so it is drawn as keyboard
  // focus. The window needs the system's focus for any of that to show.
  win.focus();
  win.webContents.focus();
  await wait(300);
  await js(`document.querySelector('#spacemap-tree .spacemap-item[tabindex="0"]').focus()`);
  for (const key of ['Down', 'Right']) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
    await wait(250);
  }
  await wait(300);
  const focused = await js(`(() => {
    const el = document.activeElement;
    return { label: el && el.getAttribute('aria-label'), visible: Boolean(el && el.matches(':focus-visible')), hasFocus: document.hasFocus() };
  })()`);
  console.log(`  keyboard focus on "${focused.label}", focus-visible ${focused.visible}, window focused ${focused.hasFocus}`);
  await shoot('map-keyboard-light');

  // Back to the top, as a list.
  await js(`(() => { const b = document.querySelector('#spacemap-crumbs button'); if (b) b.click(); })()`);
  await wait(700);
  await js(`document.querySelector('[data-map-view="list"]').click()`);
  await wait(500);
  await toMap();
  await shoot('list-light');
  await theme('dark');
  await shoot('list-dark');
  await js(`document.querySelector('[data-map-view="map"]').click()`);
  await wait(500);

  // Vietnamese.
  await theme('light');
  await js(`document.querySelector('[data-language-choice="vi"]').click()`);
  await wait(900);
  await toMap();
  await shoot('map-vi-light');
  await js(`(() => { const el = document.querySelector('#spacemap-tree > .spacemap-item.is-folder'); if (el) el.click(); })()`);
  await wait(900);
  await toMap();
  const rest = await js(`(() => {
    const el = document.querySelector('#spacemap-tree .spacemap-item.is-rest') || document.querySelector('#spacemap-tree .spacemap-item');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round(r.top + Math.min(r.height / 2, 20)) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: rest.x, y: rest.y });
  await wait(400);
  await shoot('map-vi-deeper-light');
  await js(`document.querySelector('[data-map-view="list"]').click()`);
  await wait(500);
  await shoot('list-vi-light');
  await js(`document.querySelector('[data-map-view="map"]').click()`);
  await js(`document.querySelector('[data-language-choice="en"]').click()`);
  await wait(700);

  // Narrow.
  await theme('dark');
  win.setSize(700, 800);
  await wait(900);
  await toMap();
  await shoot('map-narrow-dark');
  await js(`document.querySelector('[data-map-view="list"]').click()`);
  await wait(500);
  await shoot('list-narrow-dark');

  console.log(`\nwritten to ${OUT}`);
  console.log(errors.length ? `renderer errors: ${errors.slice(0, 4).join(' | ')}` : 'no renderer errors');
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
