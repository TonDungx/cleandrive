'use strict';

// With nobody touching the window, does it leave you where you were?
//
//   npx electron scripts/test-idle.js
//
// The disk monitor writes history.json at every reading -- once a minute by
// default -- and the file watcher tells the window. Measured on 0.1.16 with the
// monitor on: Automatic and Trends redrew themselves at every reading. A tick
// box with the keyboard on it was taken out of the page, focus fell to the
// document (Narrator then read from a place the screen showed as empty), and
// the saved values were put back over whatever had been typed but not saved.
//
// This takes readings the way the monitor does (lib/sampler.js with source
// 'monitor', through the real watcher) and checks that on every screen focus
// stays, nothing on screen is rebuilt, nothing new speaks, and unsaved edits
// survive -- and that the live updates all this redrawing was for still
// arrive: settings written by another process, a run the scheduled task
// finished, the chart's newest reading.
//
// Constructed data, said here as the convention asks: one history point six
// hours back (the store keeps one point per half hour, and a line needs two),
// and one run record appended to the run log as the scheduled task would.
// Every other reading is a real one of this machine's disks.
//
// Isolation: throwaway userData, suffixed task names, a fixture folder of its
// own; all checked first, the real settings checked untouched at the end.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow } = require('electron');

app.setName(require('../package.json').name);
const PRODUCTION_USER_DATA = app.getPath('userData');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-idle-userdata-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'idle';
require('../src/main/lib/preview/serve').registerScheme();

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chromium holds its own files in userData until this process has exited, so
 * the throwaway directory is removed by a small Node process that waits for
 * that. (The other harnesses try once and say "left behind".)
 */
function removeAfterExit(dir) {
  const script = `
    const fs = require('node:fs');
    const alive = () => { try { process.kill(${process.pid}, 0); return true; } catch { return false; } };
    let tries = 0;
    const tick = () => {
      if (!alive() || tries > 60) {
        try { fs.rmSync(${JSON.stringify(dir)}, { recursive: true, force: true }); return; } catch {}
      }
      if (++tries < 120) setTimeout(tick, 250);
    };
    tick();`;
  require('node:child_process')
    .spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    .unref();
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  console.log('\nIsolation:');
  check('userData is a throwaway directory', app.getPath('userData') === SANDBOX && SANDBOX !== PRODUCTION_USER_DATA && SANDBOX.startsWith(os.tmpdir()), SANDBOX);
  check('scheduled-task names are suffixed', Boolean(process.env.CLEANDRIVE_TASK_SUFFIX), process.env.CLEANDRIVE_TASK_SUFFIX);
  const realSettings = path.join(PRODUCTION_USER_DATA, 'settings.json');
  const realBefore = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-idle-fixture-'));
  const copy = crypto.randomBytes(300 * 1024);
  for (const [rel, body] of [
    ['Temp/a.tmp', crypto.randomBytes(2 * 1024 * 1024)],
    ['Downloads/setup.exe', crypto.randomBytes(3 * 1024 * 1024)],
    ['Docs/report.pdf', copy],
    ['Backup/report (1).pdf', copy],
  ]) {
    fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    fs.writeFileSync(path.join(work, rel), body);
  }

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  const watcher = require('../src/main/watcher');
  const { services } = require('../src/main/services');
  const { sample } = require('../src/main/lib/sampler');
  const { SettingsStore } = require('../src/main/lib/settings');
  const { RunLog } = require('../src/main/lib/autoclean');
  const { settings: store, history } = services();

  // A folder in the cleanup's list, so that list has a row and a Remove button.
  // The daily measurement off, so that pressing Save below registers no task
  // with the real Task Scheduler, suffixed or not.
  await store.patch({ autoClean: { profiles: [{ id: 'main', roots: [work] }] }, trends: { dailySample: false } });
  const first = await sample({ history, settings: await store.get(), source: 'monitor', extraTargets: [SANDBOX] });
  await history.addSnapshot({ at: Date.now() - 6 * 60 * 60 * 1000, volumes: first.volumes, source: 'monitor', scan: null });

  console.log('\nSetup:');
  check('the file watcher is watching the throwaway userData', watcher.start() && watcher.running());
  check('a real reading of this machine was recorded', first.ok && Object.keys(first.volumes).length > 0, Object.keys(first.volumes).join(' '));

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
  win.focus();
  win.webContents.focus();
  await wait(800);
  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  const until = async (expr, ms = 20000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await js(`return Boolean(${expr})`)) return true;
      await wait(100);
    }
    return false;
  };
  const press = async (keyCode) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await wait(80);
  };
  /** A real click where the element is, as a mouse would. */
  const click = async (selector) => {
    const at = await js(`const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };`);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await wait(80);
  };

  // What changes on screen: elements taken out of anything visible, and status
  // lines put in. Counted from now until the next reset.
  await js(`
    const describe = (el) => el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : 'null';
    window.__idle = { removed: [], spoke: [], changes: 0, last: Date.now() };
    window.cleandrive.onDataChanged(() => { window.__idle.changes++; });
    new MutationObserver((records) => {
      window.__idle.last = Date.now();
      for (const m of records) {
        const gone = [...m.removedNodes].filter((n) => n.nodeType === 1).length;
        if (gone && m.target.isConnected && m.target.getClientRects().length) {
          window.__idle.removed.push(gone + ' in ' + describe(m.target.closest('[id]')));
        }
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          for (const x of [n, ...n.querySelectorAll('[role="status"], [role="alert"], [aria-live]')]) {
            if (x.matches('[role="status"], [role="alert"], [aria-live]') && x.getClientRects().length && x.textContent.trim()) {
              window.__idle.spoke.push(describe(x.closest('[id]')) + ': ' + x.textContent.trim().slice(0, 60));
            }
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    return true;`);
  const resetWatch = () => js(`window.__idle.removed = []; window.__idle.spoke = []; return true;`);
  /** Wait for the window to stop changing after whatever it just did. */
  const quiet = async () => {
    await wait(700);
    await until(`Date.now() - window.__idle.last > 500`, 8000);
  };

  /** One reading, exactly as the tray's monitor records it. */
  const reading = async () => {
    const before = await js(`return window.__idle.changes`);
    await sample({ history, settings: await store.get(), source: 'monitor', extraTargets: [SANDBOX] });
    const told = await until(`window.__idle.changes > ${before}`, 6000);
    await quiet();
    return told;
  };

  const focusOn = (selector) => js(`const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); window.__focused = el; return document.activeElement === el;`);
  const stillFocused = () => js(`return document.activeElement === window.__focused && window.__focused.isConnected;`);
  const where = () => js(`const a = document.activeElement; return a ? a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.className ? '.' + String(a.className).split(' ')[0] : '') : 'none';`);
  const changed = () => js(`return window.__idle;`);

  /* ---- fill the lists ---- */

  await js(`setFolder(${JSON.stringify(work)});
    document.getElementById('run-scan').click();`);
  await until(`!document.getElementById('scan-stats').hidden`);
  await js(`document.querySelector('.tab[data-tab="dupes"]').click();
    document.getElementById('min-size').value = '100';
    document.getElementById('run-dupes').click();`);
  await until(`!document.getElementById('dupes-stats').hidden`);
  await quiet();

  /* ---- every screen, left alone through a reading ---- */

  console.log('\nEvery screen, left alone while the monitor takes a reading:');
  const SCREENS = ['usage', 'system', 'cleanup', 'media', 'dupes', 'trends', 'restore', 'auto', 'settings'];
  for (const screen of SCREENS) {
    await click(`.tab[data-tab="${screen}"]`);
    await quiet();
    if (screen === 'usage') check('a mouse click on a tab leaves focus on that tab', (await where()) === 'button#tab-usage.tab', await where());
    const target = await js(`const panel = document.getElementById('panel-${screen}');
      const el = panel.querySelector('.file-row[tabindex="0"]') ||
        [...panel.querySelectorAll('button, input, select, [tabindex="0"]')].find((x) => !x.disabled && x.getClientRects().length && x.tabIndex >= 0);
      el.focus(); window.__focused = el;
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]);`);
    await resetWatch();
    const told = await reading();
    const seen = await changed();
    check(`${screen}: focus stays on ${target}`, told && (await stillFocused()), told ? `now on ${await where()}` : 'the window was never told of the reading');
    check(`${screen}: nothing on screen is rebuilt, nothing new is announced`, seen.removed.length === 0 && seen.spoke.length === 0,
      [...seen.removed, ...seen.spoke].slice(0, 6).join(' | '));
  }

  /* ---- Automatic: the form ---- */

  console.log('\nAutomatic, the form:');
  await click('.tab[data-tab="auto"]');
  await quiet();

  await focusOn('#auto-categories input[type=checkbox]');
  await resetWatch();
  await reading();
  check('a category tick box with the keyboard on it stays in the page, still focused', await stillFocused(), `now on ${await where()}`);

  const removeButton = await js(`return Boolean(document.querySelector('#auto-roots .path-row button'));`);
  check('the cleanup’s folder list has a row to remove', removeButton);
  if (removeButton) {
    await focusOn('#auto-roots .path-row button');
    await reading();
    check('its Remove button keeps the focus through a reading', await stillFocused(), `now on ${await where()}`);
  }

  const age = await js(`return document.getElementById('auto-age').value;`);
  await focusOn('#auto-age');
  await js(`document.getElementById('auto-age').select(); return true;`);
  win.webContents.insertText('77');
  await wait(100);
  await reading();
  let field = await js(`return { value: document.getElementById('auto-age').value, status: document.getElementById('auto-status').textContent };`);
  check('a number typed and not yet committed survives a reading', field.value === '77', `was ${age}, now ${field.value}`);
  check('and the status still says it is unsaved', field.status === 'Unsaved changes.', field.status);

  await press('Tab');
  await reading();
  field = await js(`return { value: document.getElementById('auto-age').value, status: document.getElementById('auto-status').textContent };`);
  check('committed with Tab, it survives the next reading too', field.value === '77' && field.status === 'Unsaved changes.', `${field.value}, "${field.status}"`);

  // Another process writes the settings: the window hears of it, and still
  // does not put the saved values over an unsaved edit.
  const elsewhere = new SettingsStore(path.join(SANDBOX, 'settings.json'));
  const told = await js(`return window.__idle.changes`);
  await elsewhere.patch({ autoClean: { profiles: [{ id: 'main', minAgeDays: 45, roots: [work] }] } });
  check('the window is told the settings changed', await until(`window.__idle.changes > ${told}`, 6000));
  await quiet();
  field = await js(`return document.getElementById('auto-age').value;`);
  check('settings written by another process do not overwrite the unsaved edit', field === '77', field);

  await click('#auto-save');
  await until(`document.getElementById('auto-status').textContent !== 'Saving…' && document.getElementById('auto-status').textContent !== 'Unsaved changes.'`);
  await quiet();
  const saved = (await new SettingsStore(path.join(SANDBOX, 'settings.json')).load()).autoClean.profiles[0].minAgeDays;
  check('Save stores what was on screen', saved === 77, String(saved));
  check('and the status stops saying unsaved', (await js(`return document.getElementById('auto-status').textContent;`)) !== 'Unsaved changes.',
    await js(`return document.getElementById('auto-status').textContent;`));

  await elsewhere.load();
  await elsewhere.patch({ autoClean: { profiles: [{ id: 'main', minAgeDays: 45, roots: [work] }] } });
  const heard = await until(`document.getElementById('auto-age').value === '45'`, 6000);
  check('with nothing unsaved, a change made by another process still shows up', heard, await js(`return document.getElementById('auto-age').value;`));

  const run = {
    startedAt: Date.now(),
    finishedAt: Date.now() + 1000,
    manual: false,
    dryRun: true,
    outcome: 'dry-run',
    reason: null,
    scanned: { files: 4 },
    selected: { files: 1, bytes: 2 * 1024 * 1024 },
    trashed: { files: 0, bytes: 0 },
    purged: { files: 0, bytes: 0 },
    skipped: {},
    notes: [],
  };
  await new RunLog(path.join(SANDBOX, 'autoclean-log.json')).append(run);
  const landed = await until(`!document.getElementById('auto-result').hidden && /Scheduled report finished/.test(document.getElementById('toast').textContent)`, 6000);
  check('a run the scheduled task finished still appears, with its receipt', landed, await js(`return document.getElementById('toast').textContent;`));

  /* ---- Trends ---- */

  console.log('\nTrends:');
  await click('.tab[data-tab="trends"]');
  await quiet();
  const hasChart = await js(`return document.querySelectorAll('#trend-chart > svg, #trend-chart > table').length === 2;`);
  check('the chart is drawn, with its table of readings', hasChart);
  await js(`window.__chart = { svg: document.querySelector('#trend-chart > svg'), table: document.querySelector('#trend-chart > table'),
    row: document.querySelector('#trend-chart tbody tr'), text: document.querySelector('#trend-chart tbody tr').textContent }; return true;`);
  await focusOn('#trend-export-json');
  await reading();
  const chart = await js(`const now = { svg: document.querySelector('#trend-chart > svg'), table: document.querySelector('#trend-chart > table'),
      row: document.querySelector('#trend-chart tbody tr') };
    return { same: now.svg === window.__chart.svg && now.table === window.__chart.table && now.row === window.__chart.row,
      fresh: now.table.innerHTML === chartTable(state.trends.series).innerHTML,
      label: now.svg.getAttribute('aria-label') };`);
  check('after a reading, the chart, its table and its newest row are the same nodes', chart.same);
  check('and the table reads what a fresh drawing of the new series would', chart.fresh);
  check('Export JSON keeps the focus', await stillFocused(), `now on ${await where()}`);

  await click('#trend-daily');
  const ticked = await js(`return document.getElementById('trend-daily').checked;`);
  check('a click ticks the daily measurement (saved: off)', ticked === true);
  await reading();
  const measuring = await js(`return { checked: document.getElementById('trend-daily').checked, status: document.getElementById('trend-sampling-status').textContent };`);
  check('the unsaved tick survives a reading', measuring.checked === true, String(measuring.checked));
  check('and says it is unsaved', /Unsaved changes to the measuring settings/.test(measuring.status), measuring.status);

  /* ---- a button that opens another screen ---- */

  console.log('\nA button that opens another screen:');
  await click('.tab[data-tab="system"]');
  await quiet();
  await focusOn('#system-measure');
  // What System's "Open Restore" does, and Explorer's menu, and the others.
  await js(`document.querySelector('.tab[data-tab="restore"]').click(); return true;`);
  await wait(200);
  check('the keyboard lands on the new screen’s tab, not on the document', (await where()) === 'button#tab-restore.tab', await where());

  check('no errors in the window’s console', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---- cleanup ---- */

  watcher.stop();
  win.destroy();
  await wait(300);
  const realAfter = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;
  check('the real settings.json was not touched', realBefore === realAfter);
  fs.rmSync(work, { recursive: true, force: true });
  removeAfterExit(SANDBOX);

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
