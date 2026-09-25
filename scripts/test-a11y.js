'use strict';

// Accessibility, checked on the real app (I2).
//
//   npx electron scripts/test-a11y.js
//
// Boots the real window (real preload, real IPC, real renderer) on fixture
// folders this script writes, fills every screen, and then asks five
// different questions of it:
//
//   1. axe-core (a pinned devDependency, never shipped) on every screen, in
//      the light and the dark theme, in English and in Vietnamese: the
//      general rules -- names, roles, contrast, ARIA that means something;
//   2. Chromium's own accessibility tree (CDP Accessibility.getFullAXTree),
//      which is what it hands a screen reader: the tabs say which is
//      selected, the progress bar has a value, every focusable thing has a
//      name, the live regions are live;
//   3. the keyboard: Tab from the top of each screen reaches every control
//      that is meant to be a Tab stop, and every control that is not one sits
//      in a container the arrow keys move through; the keys the ? list names
//      do what it says;
//   4. Windows contrast themes, emulated through CDP (it forces the palette,
//      not just the media query -- measured before this was written): every
//      selected or pressed thing still looks different from the rest, every
//      bar still shows its fill, the map is drawn in the system's colours --
//      and the user's own colours win over them, as the user chose;
//   5. the colour editor through the real IPC: a palette that fails a rule
//      cannot be used, one that passes is saved and drawn, import refuses
//      what it must, export writes what import reads back.
//
// axe cannot answer 3-5, and nothing automated here can answer "does
// Narrator read it well": Windows UI Automation from outside the process sees
// only "Chrome Legacy Window" in Electron 33 (measured). That part is a
// checklist a person runs; see the ROADMAP note for I2.
//
// Isolation: userData is a throwaway directory, task names are suffixed, and
// both are checked before anything runs. The theme editor's file dialogs are
// replaced with ones that answer from this script's own folder.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme, dialog } = require('electron');

app.setName(require('../package.json').name);
const PRODUCTION_USER_DATA = app.getPath('userData');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-a11y-userdata-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'a11y';

require('../src/main/lib/preview/serve').registerScheme();

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_VERSION = require('axe-core/package.json').version;
const T = require('../src/shared/theme-palette');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------ fixtures */

function make(file, bytes, ageDays = 0, fill = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof bytes === 'string' ? bytes : Buffer.alloc(bytes, fill));
  if (ageDays) {
    const when = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(file, when, when);
  }
}

/** The list screens' tree: a cache, an installer, a big file, a duplicate group. */
function buildFixture(root) {
  const MB = 1024 * 1024;
  make(path.join(root, 'Temp', 'session-cache.dat'), 6 * MB);
  make(path.join(root, 'Temp', 'old-upload.tmp'), 2 * MB);
  make(path.join(root, 'Tool', 'Cache', 'index.bin'), 4 * MB);
  make(path.join(root, 'logs', 'service.log'), 2 * MB, 40);
  make(path.join(root, 'Downloads', 'setup-4.2.exe'), 30 * MB, 90);
  make(path.join(root, 'Videos', 'holiday.mkv'), 24 * MB);
  make(path.join(root, 'Reports', 'q3.pdf'), 3 * MB, 30, 7);
  make(path.join(root, 'Reports', 'copy of q3.pdf'), 3 * MB, 10, 7);
  make(path.join(root, 'Archive', 'q3.pdf'), 3 * MB, 5, 7);
  make(path.join(root, 'notes.txt'), 'Meeting notes.\nNothing here needs deleting.\n');
}

/** Real PNG headers, a few hundred bytes each: enough for the photo scan. */
function buildPhotos(root) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const png = (w, h) => Buffer.concat([
    Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n', 'latin1'),
    u32(13), Buffer.from('IHDR', 'latin1'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0]), u32(0),
    u32(200), Buffer.from('tEXt', 'latin1'), Buffer.alloc(200), u32(0),
  ]);
  for (let i = 1; i <= 40; i++) {
    const file = path.join(root, `IMG_${String(i).padStart(4, '0')}.png`);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(file, png(1600 + i, 1200));
  }
}

/* ------------------------------------------------------------ the run */

// Closing the one window must not end the run before the summary and the
// exit code: Electron's default is to quit the moment the last window goes.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  console.log('\nIsolation:');
  check('userData is a throwaway directory, not the real one',
    app.getPath('userData') === SANDBOX && SANDBOX !== PRODUCTION_USER_DATA && SANDBOX.startsWith(os.tmpdir()), SANDBOX);
  check('scheduled-task names are suffixed', process.env.CLEANDRIVE_TASK_SUFFIX === 'a11y' ||
    Boolean(process.env.CLEANDRIVE_TASK_SUFFIX), process.env.CLEANDRIVE_TASK_SUFFIX);
  const realSettings = path.join(PRODUCTION_USER_DATA, 'settings.json');
  const realBefore = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;

  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  const { services } = require('../src/main/services');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-a11y-fixture-'));
  const tree = path.join(work, 'tree');
  const photos = path.join(work, 'photos');
  buildFixture(tree);
  buildPhotos(photos);

  // Restore has something to list: one session the app never really ran,
  // written through the journal's own code into the throwaway userData.
  // Constructed data; its files never existed, so each row says so.
  await services().journal.appendSession('recycle', [
    { path: path.join(tree, 'gone', 'old-report.pdf'), size: 2 * 1024 * 1024, mtimeMs: Date.now() - 40 * DAY, trashedAt: Date.now() - 2 * DAY },
    { path: path.join(tree, 'gone', 'draft.docx'), size: 512 * 1024, mtimeMs: Date.now() - 10 * DAY, trashedAt: Date.now() - 2 * DAY },
  ], { startedAt: Date.now() - 2 * DAY });

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
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
  const js = (expr) => win.webContents.executeJavaScript(expr);
  const run = (body) => js(`(async () => { ${body} })()`);
  const until = async (expr, ms = 60000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await js(`Boolean(${expr})`)) return true;
      await wait(150);
    }
    return false;
  };
  await wait(400);
  win.focus();
  win.webContents.focus();

  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Accessibility.enable');
  // Reduced motion throughout, so the theme's circular sweep (a View
  // Transition, which applies the new theme a frame or more later) applies at
  // once and a check never reads the colours half way through it. Every call
  // that changes the emulated media has to say it again.
  const emulate = (forced) =>
    dbg.sendCommand('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'forced-colors', value: forced ? 'active' : 'none' },
      ],
    });
  await emulate(false);
  const settle = () => js(`new Promise((resolve) => {
    const done = () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect && a.effect.getTiming().iterations === Infinity);
    const tick = (n) => (done() || n > 40 ? requestAnimationFrame(() => resolve(true)) : setTimeout(() => tick(n + 1), 50));
    tick(0);
  })`);

  const press = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1) win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(60);
  };
  const tab = (name) => run(`document.querySelector('.tab[data-tab="${name}"]').click();`);
  const setTheme = async (mode) => {
    nativeTheme.themeSource = mode;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(mode)})`);
    await wait(250);
  };

  /* ---- fill every screen ---- */

  console.log('\nFilling the screens:');
  await run(`setFolder(${JSON.stringify(tree)}); document.getElementById('run-scan').click();`);
  check('the fixture folder is scanned', await until(`document.getElementById('scan-stats').hidden === false && !document.getElementById('run-scan').disabled`));
  await until(`document.querySelectorAll('#spacemap-tree [role="treeitem"]').length > 0`, 15000);

  await run(`
    document.querySelector('.tab[data-tab="dupes"]').click();
    document.getElementById('min-size').value = '1024';
    document.getElementById('run-dupes').click();`);
  check('duplicates are found', await until(`document.getElementById('dupes-stats').hidden === false && document.querySelectorAll('#dupe-groups .file-row').length > 0`));

  await run(`
    document.querySelector('.tab[data-tab="media"]').click();
    await new Promise((r) => setTimeout(r, 300));
    for (const root of media.roots) root.on = false;
    media.extraRoots = [{ path: ${JSON.stringify(photos)}, name: 'fixture', why: null, on: true }];
    renderRoots();
    document.getElementById('media-scan').click();`);
  check('the photo fixture is found', await until(`document.getElementById('media-cancel').hidden === true && media.files.length >= 40`));

  // Trends: a series drawn by the real chart code, after the tab's own
  // refresh (which would otherwise draw over it with the throwaway userData's
  // empty history). Constructed readings, labelled as such here.
  // selectTab rather than a click: the click starts a refresh of its own,
  // which can land after this one and draw the empty history over the series.
  const openTrends = () => run(`
    selectTab(document.getElementById('tab-trends'));
    await refreshTrends();
    const now = Date.now();
    const series = Array.from({ length: 20 }, (_, i) => ({
      at: now - (19 - i) * 86400000, usedPercent: 60 + i * 0.4,
      usedBytes: (60 + i * 0.4) * 5e9, freeBytes: (40 - i * 0.4) * 5e9, totalBytes: 5e11,
    }));
    renderChart(document.getElementById('trend-chart'), series, { warn: 85, critical: 95 });`);
  await openTrends();
  await tab('restore');
  await until(`document.querySelector('[data-restore-toggle]')`, 15000);
  await run(`document.querySelector('[data-restore-toggle]').click();`);
  check('Restore lists the journal session', await until(`document.querySelectorAll('#restore-sessions .file-row').length >= 2`, 15000));
  await tab('usage');

  /* ---- 1. axe ---- */

  console.log(`\naxe-core ${AXE_VERSION} (WCAG 2.0/2.1/2.2 A and AA):`);
  await js(AXE);
  const hasAxe = await js('typeof axe === "object" && typeof axe.run === "function"');
  check('axe-core loads into the page under its CSP', hasAxe);

  const axeRun = () =>
    js(`axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations', 'incomplete'],
    }).then((r) => ({
      violations: r.violations.map((v) => ({
        id: v.id, impact: v.impact, count: v.nodes.length,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').replace(/\\s+/g, ' ').slice(0, 170)),
      })),
      incomplete: r.incomplete.reduce((n, v) => n + v.nodes.length, 0),
    }))`);

  const SCREENS = ['usage', 'system', 'cleanup', 'media', 'dupes', 'trends', 'restore', 'auto', 'settings'];
  const axeScreens = async (label) => {
    for (const screen of SCREENS) {
      if (screen === 'trends') await openTrends();
      else await tab(screen);
      await wait(250);
      const result = await axeRun();
      const detail = result.violations
        .map((v) => `${v.id} (${v.impact}, ${v.count}): ${v.nodes.join(' | ')}`)
        .join(' || ');
      check(`${label}: ${screen} has no violations`, result.violations.length === 0,
        detail || (result.incomplete ? `${result.incomplete} left for review (gradients, overlaps)` : ''));
    }
  };

  await setTheme('light');
  await axeScreens('light');
  await setTheme('dark');
  await axeScreens('dark');

  // The open states: the evidence under a row, the map's menu, the list of
  // keys, a file in the viewer.
  await setTheme('light');
  await tab('usage');
  await run(`const pill = document.querySelector('#largest-files .badge-button'); if (pill) pill.click();`);
  let open = await axeRun();
  check('with a row’s reasons open, no violations', open.violations.length === 0, open.violations.map((v) => `${v.id}: ${v.nodes.join(' | ')}`).join(' || '));
  await run(`window.Shortcuts.open();`);
  open = await axeRun();
  check('with the list of keys open, no violations', open.violations.length === 0, open.violations.map((v) => `${v.id}: ${v.nodes.join(' | ')}`).join(' || '));
  await run(`document.getElementById('shortcuts').close();`);
  await run(`await openViewer(${JSON.stringify(path.join(tree, 'notes.txt'))});`);
  await until(`document.querySelector('#viewer-body pre, #viewer-body .doc, #viewer-body *')`, 10000);
  await settle();
  open = await axeRun();
  check('with a file open in the viewer, no violations', open.violations.length === 0, open.violations.map((v) => `${v.id}: ${v.nodes.join(' | ')}`).join(' || '));
  await run(`closeViewer();`);

  // Under the pointer and in focus. axe sees the page as it is, and a state
  // that only exists while the pointer rests somewhere was found only when
  // the real pointer happened to rest there (the keeper tag, the View button).
  // So the states are forced through CDP: every kind of control hovered --
  // a row and its button together, as the pointer makes them -- and a row
  // holding focus, then contrast is checked on what that draws.
  console.log('\nHovered and focused (forced through CDP), contrast only:');
  await dbg.sendCommand('DOM.enable');
  await dbg.sendCommand('CSS.enable');
  const HOVERED = ['.file-row', '.file-row .link', '.file-row .badge-button', '.btn', '.tab[data-tab]', '.btn-quick', '.chip', '.segmented-option',
    '.ov-key', '.link', '.keeper-tag', '.group-select', '.spacemap-item', '.media-cell'];
  const contrastUnder = async (states, selectors) => {
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1 });
    const forced = [];
    for (const selector of selectors) {
      const { nodeIds } = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `.panel.is-active ${selector}, .sidebar ${selector}, .topbar ${selector}` });
      for (const nodeId of nodeIds.slice(0, 4)) {
        await dbg.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
        forced.push(nodeId);
      }
    }
    await wait(250);
    const found = await js(`axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } })
      .then((r) => r.violations.flatMap((v) => v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').replace(/\\s+/g, ' ').slice(60, 170))))`);
    for (const nodeId of forced) {
      await dbg.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => {});
    }
    return { found, forced: forced.length };
  };
  {
    // The method, checked: a forced :hover must really change what is drawn.
    await tab('usage');
    const probe = `(() => { const l = document.querySelector('#largest-files .file-row .link'); const s = getComputedStyle(l); return s.backgroundColor + '|' + s.borderTopColor; })()`;
    const before = await js(probe);
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1 });
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#largest-files .file-row .link' });
    await dbg.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    await wait(300);
    const during = await js(probe);
    await dbg.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    check('forcing :hover through CDP really changes what a button draws', before !== during, `${before} -> ${during}`);
  }
  for (const mode of ['light', 'dark']) {
    await setTheme(mode);
    for (const screen of ['usage', 'cleanup', 'dupes', 'media', 'restore', 'settings']) {
      await tab(screen);
      await wait(250);
      const hover = await contrastUnder(['hover'], HOVERED);
      check(`${mode}: ${screen} hovered (${hover.forced} elements)`, hover.found.length === 0, hover.found.join(' || '));
      const focus = await contrastUnder(['focus-within'], ['.file-row', '.segmented', '.actionbar']);
      check(`${mode}: ${screen} with a row focused`, focus.found.length === 0, focus.found.join(' || '));
    }
  }
  await setTheme('light');

  /* ---- 2. what a screen reader is handed ---- */

  console.log('\nChromium’s accessibility tree:');
  const axTree = async () => (await dbg.sendCommand('Accessibility.getFullAXTree')).nodes;
  const prop = (node, name) => {
    const p = (node.properties || []).find((x) => x.name === name);
    return p ? p.value.value : undefined;
  };

  await openTrends();
  await wait(200);
  let nodes = await axTree();
  const tabs = nodes.filter((n) => n.role && n.role.value === 'tab' && !n.ignored);
  const selected = tabs.filter((n) => prop(n, 'selected') === true);
  check('nine tabs, and exactly one says it is selected', tabs.length === 9 && selected.length === 1,
    `${tabs.length} tabs, selected: ${selected.map((n) => n.name && n.name.value).join(', ')}`);
  check('the selected one is the screen on show', selected[0] && /Trends/.test(selected[0].name.value), selected[0] && selected[0].name.value);

  const unnamed = nodes.filter((n) => !n.ignored && prop(n, 'focusable') === true && n.role &&
    !['RootWebArea', 'WebArea', 'Iframe'].includes(n.role.value) && !(n.name && String(n.name.value).trim()));
  check('every focusable thing has a name', unnamed.length === 0,
    unnamed.slice(0, 6).map((n) => `${n.role.value}#${n.backendDOMNodeId}`).join(', '));

  const live = nodes.filter((n) => ['status', 'alert'].includes(n.role && n.role.value) && prop(n, 'live'));
  check('the two announcement regions are live, polite and assertive',
    live.some((n) => prop(n, 'live') === 'polite') && live.some((n) => prop(n, 'live') === 'assertive'),
    live.map((n) => `${n.role.value}:${prop(n, 'live')}`).join(', '));

  const chartTable = nodes.find((n) => !n.ignored && n.role && n.role.value === 'table');
  check('the chart’s readings are a table a screen reader can walk', Boolean(chartTable),
    chartTable && chartTable.name ? chartTable.name.value : 'none');
  const rows = await js(`document.querySelectorAll('#trend-chart table tbody tr').length`);
  check('one row per reading, newest first', rows === 20 &&
    (await js(`document.querySelector('#trend-chart tbody tr td').textContent`)) === '67.6%', `${rows} rows`);

  // The delete progress panel, shown by its own code at 40%.
  await run(`
    progressPanel.show('Moving to Recycle Bin');
    progressPanel.update({ phase: 'deleting', done: 4, total: 10, freedBytes: 4096, totalBytes: 10240, ratePerSec: 2, etaMs: 3000 });`);
  await wait(200);
  nodes = await axTree();
  // CDP puts a range's current value in the node's own `value`; the text
  // form is a property.
  const bars = nodes.filter((n) => !n.ignored && n.role && n.role.value === 'progressbar');
  const bar = bars.find((n) => n.name && /Recycle Bin/.test(n.name.value));
  const barValue = bar && bar.value ? Number(bar.value.value) : undefined;
  check('the delete progress bar has a value, and says it in words', bar && barValue === 40 && Boolean(prop(bar, 'valuetext')),
    bar ? `${barValue} "${prop(bar, 'valuetext')}"` : `progressbars: ${bars.map((n) => JSON.stringify({ name: n.name, value: n.value })).join(' ')}`);
  check('and it is named by the panel’s title', bar && bar.name && bar.name.value === 'Moving to Recycle Bin', bar && bar.name && bar.name.value);
  const phase = await js(`new Promise((r) => requestAnimationFrame(() => r(document.getElementById('sr-polite').textContent)))`);
  check('its phase is announced once, not every tick', /Moving to Recycle Bin/.test(phase), phase);
  await run(`progressPanel.hide();`);

  await run(`toast('3 files moved to the Recycle Bin');`);
  const said = await js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.getElementById('sr-polite').textContent))))`);
  check('a receipt is announced politely', said === '3 files moved to the Recycle Bin', said);
  await run(`toast('Scan: the folder is gone', true);`);
  const alarm = await js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.getElementById('sr-assertive').textContent))))`);
  check('a failure is announced assertively', alarm === 'Scan: the folder is gone', alarm);

  /* ---- 3. the keyboard ---- */

  console.log('\nKeyboard -- every control is a Tab stop, or sits where the arrows reach it:');
  const ROVING = '.file-row, [role="tree"], [role="tablist"], .media-grid, [role="menu"], dialog:not([open]), .viewer[hidden]';
  const reach = async (screen) => {
    await tab(screen);
    await wait(250);
    const want = await js(`(() => {
      const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const scopes = [document.querySelector('.topbar'), document.getElementById('sidebar'), document.getElementById('sidebar-resizer'),
        document.querySelector('.panel.is-active'), ...document.querySelectorAll('.panel.is-active .actionbar:not([hidden])')];
      const sel = 'button, input, select, textarea, a[href], [tabindex]';
      let n = 0;
      const stops = [];
      const off = [];
      for (const el of document.querySelectorAll('[data-a11y]')) delete el.dataset.a11y;
      for (const scope of scopes) {
        if (!scope) continue;
        for (const el of [scope, ...scope.querySelectorAll(sel)]) {
          if (!el.matches(sel) || el.disabled || !visible(el) || el.closest('[inert]')) continue;
          if (el.tabIndex < 0) {
            if (!el.closest(${JSON.stringify(ROVING)})) off.push(el.id || el.className || el.tagName);
            continue;
          }
          if (el.dataset.a11y) continue;
          el.dataset.a11y = String(++n);
          stops.push({ id: n, what: el.id || (el.textContent || '').trim().slice(0, 30) || el.getAttribute('aria-label') || el.tagName });
        }
      }
      document.querySelector('.tab.is-active').focus();
      return { stops, off };
    })()`);
    const reached = new Set();
    for (let i = 0; i < 400; i++) {
      await press('Tab');
      const id = await js(`document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.a11y || '' : ''`);
      if (id) reached.add(Number(id));
      if (reached.size === want.stops.length) break;
    }
    const missed = want.stops.filter((s) => !reached.has(s.id));
    check(`${screen}: Tab reaches all ${want.stops.length} stops`, missed.length === 0, missed.map((s) => s.what).slice(0, 8).join(', '));
    check(`${screen}: nothing is out of the Tab order without an arrow-key way to it`, want.off.length === 0, want.off.slice(0, 8).join(', '));
  };
  for (const screen of SCREENS) await reach(screen);

  console.log('\nKeyboard -- the keys the ? list names do what it says:');
  win.focus();
  win.webContents.focus();
  await tab('usage');
  await run(`document.getElementById('tab-usage').focus();`);
  await press('Down');
  let at = await js(`({ focus: document.activeElement.id, panel: document.querySelector('.panel.is-active').id, sel: document.activeElement.getAttribute('aria-selected'),
    el: document.activeElement.tagName + '.' + document.activeElement.className, hasFocus: document.hasFocus(),
    inert: [...document.querySelectorAll('[inert]')].map((e) => e.className), dialogs: [...document.querySelectorAll('dialog[open]')].length,
    viewer: document.getElementById('viewer').hidden })`);
  check('↓ in the sidebar moves to the next screen and opens it', at.focus === 'tab-system' && at.panel === 'panel-system' && at.sel === 'true', JSON.stringify(at));
  await press('End');
  at = await js(`document.activeElement.id`);
  check('End goes to the last screen', at === 'tab-settings', at);
  await press('Home');
  at = await js(`document.activeElement.id`);
  check('Home goes to the first', at === 'tab-usage', at);

  await run(`document.querySelector('#largest-files .file-row').focus();`);
  await press('Down');
  at = await js(`document.activeElement.dataset.index`);
  check('↓ in a list moves to the next row', at === '1', at);
  await press('Space');
  at = await js(`({ ticked: document.activeElement.querySelector('input').checked, label: document.activeElement.getAttribute('aria-label') })`);
  check('Space ticks the row, and the row says so', at.ticked && /, ticked$/.test(at.label), at.label);
  const selectedSaid = await js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.getElementById('sr-polite').textContent))))`);
  check('and the new total is announced', /1 selected/.test(selectedSaid), selectedSaid);
  await press('Space');
  await press('Tab');
  at = await js(`({ inRow: Boolean(document.activeElement.closest('.file-row[data-index="1"]')), tag: document.activeElement.tagName, text: document.activeElement.textContent })`);
  check('Tab from a row goes to that row’s own buttons', at.inRow && at.tag === 'BUTTON', JSON.stringify(at));
  const rowButtons = [];
  for (let i = 0; i < 4; i++) {
    const text = await js(`document.activeElement.closest('.file-row[data-index="1"]') ? document.activeElement.textContent : ''`);
    if (text) rowButtons.push(text);
    await press('Tab');
  }
  check('Reveal and Open can be reached from the keyboard', rowButtons.includes('Reveal') && rowButtons.includes('Open'), rowButtons.join(' → '));

  await run(`document.querySelector('#largest-files .file-row[data-index="1"]').focus();`);
  await press('Return');
  check('Enter on a row opens the file in the viewer', await until(`!document.getElementById('viewer').hidden`, 5000));
  let trapped = true;
  for (let i = 0; i < 12; i++) {
    await press('Tab');
    if (!(await js(`document.getElementById('viewer').contains(document.activeElement)`))) trapped = false;
  }
  check('while it is open, Tab stays inside it', trapped);
  await press('Escape');
  at = await js(`({ closed: document.getElementById('viewer').hidden, back: document.activeElement.dataset.index })`);
  check('Esc closes it and puts focus back on the row', at.closed && at.back === '1', JSON.stringify(at));

  await press('?');
  check('? opens the list of keys', await js(`document.getElementById('shortcuts').open`));
  const listed = await js(`document.querySelectorAll('#shortcuts-body kbd').length`);
  check('and it lists the keys', listed > 30, `${listed} keys`);
  await press('Escape');
  check('Esc closes it', !(await js(`document.getElementById('shortcuts').open`)));
  await tab('settings');
  await run(`document.getElementById('custom-name').focus();`);
  await press('?');
  const typed = await js(`({ open: document.getElementById('shortcuts').open, value: document.getElementById('custom-name').value })`);
  check('? typed into a text field is a question mark, not a shortcut', !typed.open && typed.value.endsWith('?'), JSON.stringify(typed));
  await run(`if (document.getElementById('shortcuts').open) document.getElementById('shortcuts').close();
    const name = document.getElementById('custom-name'); name.value = name.value.replace(/\\?$/, ''); name.dispatchEvent(new Event('input'));`);

  await tab('usage');
  await until(`document.querySelectorAll('#spacemap-tree [role="treeitem"]').length > 1`, 5000);
  await run(`const item = document.querySelector('#spacemap-tree [role="treeitem"]'); item.focus();`);
  const firstTile = await js(`document.activeElement.getAttribute('aria-label')`);
  await press('Down');
  const secondTile = await js(`document.activeElement.getAttribute('aria-label')`);
  check('↓ in the map moves to the next tile', firstTile && secondTile && firstTile !== secondTile, `${firstTile} → ${secondTile}`);

  await tab('media');
  await run(`document.getElementById('media-grid').focus();`);
  await press('Right');
  await press('Right');
  at = await js(`(() => {
    const grid = document.getElementById('media-grid');
    const id = grid.getAttribute('aria-activedescendant');
    const cell = id && document.getElementById(id);
    return { id, label: cell && cell.getAttribute('aria-label') };
  })()`);
  check('→ in the photo grid points a screen reader at the picture', Boolean(at.id && at.label && /IMG_\d+\.png, photo/.test(at.label)), JSON.stringify(at));

  /* ---- 4. Windows contrast themes ---- */

  console.log('\nWindows contrast theme (emulated):');
  await setTheme('light');
  await emulate(true);
  await wait(300);
  const looksDifferent = (a, b) => `(() => {
    const cs = (el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.backgroundImage, s.color, s.borderTopColor, s.borderLeftColor, s.borderLeftWidth, s.outlineStyle, s.outlineColor, s.textDecorationLine].join('|'); };
    const x = ${a}; const y = ${b};
    return x && y ? cs(x) !== cs(y) : null;
  })()`;
  check('forced colours are really on', await js(`matchMedia('(forced-colors: active)').matches`));
  check('the selected tab looks different from the others',
    await js(looksDifferent(`document.querySelector('.tab.is-active')`, `document.querySelector('.tab:not(.is-active)[data-tab]')`)));
  await tab('settings');
  check('the chosen appearance looks different from the other choices',
    await js(looksDifferent(`document.querySelector('#theme-switch-settings .is-active')`, `document.querySelector('#theme-switch-settings .segmented-option:not(.is-active):not(:disabled)')`)));
  await tab('usage');
  check('the map and list switch shows which is on',
    await js(looksDifferent(`document.querySelector('#spacemap-view [aria-pressed="true"]')`, `document.querySelector('#spacemap-view [aria-pressed="false"]')`)));
  await run(`const box = document.querySelector('#largest-files .file-row input'); if (!box.checked) box.click();`);
  check('a ticked row looks different from one that is not',
    await js(looksDifferent(`document.querySelector('#largest-files .file-row:has(input:checked)')`, `document.querySelector('#largest-files .file-row:has(input:not(:checked))')`)));
  await run(`const box = document.querySelector('#largest-files .file-row input'); if (box.checked) box.click();`);

  await run(`
    progressPanel.show('Moving to Recycle Bin');
    progressPanel.update({ phase: 'deleting', done: 4, total: 10, freedBytes: 4096, totalBytes: 10240 });`);
  await wait(150);
  check('the delete progress bar shows its fill',
    await js(looksDifferent(`document.getElementById('dp-fill')`, `document.getElementById('dp-track')`)));
  await run(`progressPanel.hide();`);

  // The drive's five parts, in the real stylesheet on elements made for the
  // check -- the System screen needs a measured drive to draw its own.
  const parts = await js(`(() => {
    const bar = document.createElement('div');
    bar.className = 'system-bar';
    for (const kind of ['yours', 'programs', 'windows', 'free', 'unexplained']) {
      const seg = document.createElement('span');
      seg.className = 'system-seg system-seg-' + kind;
      bar.appendChild(seg);
    }
    document.getElementById('panel-usage').appendChild(bar);
    const looks = [...bar.children].map((seg) => { const s = getComputedStyle(seg); return s.backgroundColor + '|' + s.backgroundImage; });
    bar.remove();
    return looks;
  })()`);
  check('the drive’s five parts are five different patterns', new Set(parts).size === 5, parts.join(' / ').slice(0, 200));

  await tab('media');
  await run(`
    const cell = document.querySelector('.media-cell');
    if (cell) cell.querySelector('.media-tick').click();`);
  await wait(150);
  check('a ticked photo looks different from one that is not',
    await js(looksDifferent(`document.querySelector('.media-cell.is-selected .media-frame')`, `document.querySelector('.media-cell:not(.is-selected) .media-frame')`)));
  await run(`document.getElementById('media-select-none').click();`);

  await tab('usage');
  await wait(400);
  const ink = await js(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const probe = document.createElement('span');
    probe.style.forcedColorAdjust = 'none';
    document.body.appendChild(probe);
    const rgb = (name) => { probe.style.color = name; return getComputedStyle(probe).color.match(/\\d+/g).slice(0, 3).map(Number); };
    const page = rgb('Canvas');
    const text = rgb('CanvasText');
    probe.remove();
    const c = document.getElementById('spacemap-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let system = 0;
    const total = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const px = [d[i], d[i + 1], d[i + 2]];
      if ((px[0] === page[0] && px[1] === page[1] && px[2] === page[2]) || (px[0] === text[0] && px[1] === text[1] && px[2] === text[2])) system++;
    }
    resolve({ share: system / total, total });
  })))`);
  check('the map is drawn in the system’s own two colours', ink.total > 0 && ink.share > 0.9,
    `${(ink.share * 100).toFixed(1)}% of ${ink.total} pixels`);

  win.focus();
  win.webContents.focus();
  await run(`document.querySelector('#largest-files .file-row').focus();`);
  await press('Down');
  const ring = await js(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; })()`);
  check('a focused row still shows a focus ring', !/^none/.test(ring), ring);

  // The user's own colours, chosen: they win over the Windows theme.
  const mine = { ...T.template('dark', 'Harness'), colors: { ...T.BASES.dark, background: '#101820', accent: '#b48cff' } };
  await run(`ThemeSwitch.setStored(${JSON.stringify(mine)}); ThemeSwitch.adopt('custom');`);
  await wait(300);
  const custom = await js(`({ bg: getComputedStyle(document.body).backgroundColor, adjust: getComputedStyle(document.documentElement).forcedColorAdjust })`);
  check('with Custom chosen, the user’s colours are drawn over the Windows theme',
    custom.bg === 'rgb(16, 24, 32)' && custom.adjust === 'none', JSON.stringify(custom));
  await emulate(false);

  console.log('\nThe user’s own colours, axe over the whole app:');
  await axeScreens('custom');
  await run(`ThemeSwitch.setStored(null); ThemeSwitch.adopt('light');`);
  await settle();

  /* ---- 5. the colour editor, through the real IPC ---- */

  console.log('\nThe colour editor (real IPC; file dialogs answered by this script):');
  await tab('settings');
  await run(`ThemeEditor.load(${JSON.stringify(T.template('light', 'Mine'))});`);
  check('a built-in palette passes, and can be used', await js(`ThemeEditor.verdict().ok && !document.getElementById('custom-use').disabled`));
  await run(`ThemeEditor.set('text', '#b0b5bd');`);
  const refused = await js(`({ ok: ThemeEditor.verdict().ok, use: document.getElementById('custom-use').disabled,
    report: document.querySelectorAll('#custom-report li').length, first: (document.querySelector('#custom-report li') || {}).textContent,
    mark: document.querySelector('.custom-row[data-key="text"] .custom-row-mark').textContent })`);
  check('grey text on white fails, and Use is off', !refused.ok && refused.use && refused.report > 0, `${refused.report}: ${refused.first}`);
  check('the row that caused it says so in words', /to fix/.test(refused.mark), refused.mark);

  // The main process is the authority, whatever the window says.
  const direct = await js(`window.cleandrive.saveCustomTheme(ThemeEditor.draft(), { use: true })`);
  check('the main process refuses that palette too, and saves nothing',
    direct.ok && direct.data.saved === false && direct.data.failures.length > 0 && !(await services().settings.get()).appearance.custom);

  await run(`ThemeEditor.set('text', '#11151c'); ThemeEditor.set('accent', '#6d28d9');`);
  await run(`document.getElementById('custom-use').click();`);
  await until(`document.documentElement.dataset.theme === 'custom'`, 5000);
  await settle();
  const saved = (await services().settings.get()).appearance.custom;
  const drawn = await js(`({ theme: document.documentElement.dataset.theme, base: document.documentElement.dataset.themeBase,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), state: document.getElementById('custom-state').textContent,
    status: document.getElementById('custom-status').textContent, draft: ThemeEditor.draft().colors.accent, ok: ThemeEditor.verdict().ok })`);
  check('Use saves it, switched on, in the throwaway settings', saved && saved.enabled && saved.colors.accent === '#6d28d9',
    saved ? JSON.stringify({ enabled: saved.enabled, accent: saved.colors.accent }) : `nothing saved; ${JSON.stringify(drawn)}`);
  check('and the window is drawn in it at once', drawn.theme === 'custom' && drawn.base === 'light' && drawn.accent === '#6d28d9', JSON.stringify(drawn));
  check('Electron’s own dialogs follow its base', nativeTheme.themeSource === 'light', nativeTheme.themeSource);

  await run(`document.querySelector('#theme-switch-settings [data-theme-choice="dark"]').click();`);
  await wait(400);
  const off = (await services().settings.get()).appearance;
  check('choosing Dark keeps the palette, switched off', off.theme === 'dark' && off.custom && off.custom.enabled === false);
  check('and the Custom choice stays offered', await js(`!document.querySelector('#theme-switch-settings [data-theme-choice="custom"]').disabled`));

  // Import, with the dialog answered from this script's folder.
  const files = path.join(work, 'themes');
  fs.mkdirSync(files, { recursive: true });
  const importing = async (name, body) => {
    const file = path.join(files, name);
    fs.writeFileSync(file, body);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    return js(`window.cleandrive.importTheme()`);
  };
  let r = await importing('partial.json', JSON.stringify({ format: 'cleandrive-theme', version: 1, name: 'Violet', base: 'dark', colors: { accent: '#b48cff' } }));
  check('a file with one colour is read, and the other ten come from its base',
    r.ok && r.data.theme.colors.accent === '#b48cff' && r.data.filled.length === 10 && r.data.failures.length === 0, JSON.stringify(r.data && r.data.filled));
  r = await importing('ugly.json', JSON.stringify({ format: 'cleandrive-theme', version: 1, base: 'light', colors: { text: '#cccccc' } }));
  check('one whose colours fail is read, with its failures, for the editor to show', r.ok && r.data.theme && r.data.failures.length > 0);
  r = await importing('css.json', JSON.stringify({ format: 'cleandrive-theme', version: 1, base: 'light', colors: { background: 'url(https://example.com/a.png)' } }));
  check('one that tries to put anything but #rrggbb into the stylesheet is refused', r.ok && r.data.refused === true);
  r = await importing('huge.json', `{"format":"cleandrive-theme","version":1,"base":"light","colors":{},"pad":"${'x'.repeat(T.MAX_BYTES)}"}`);
  check('one over 32 KB is refused by its size', r.ok && r.data.refused === true && r.data.errors[0].i18n === 'theme.err.size');
  r = await importing('broken.json', '{ "format": ');
  check('one that is not JSON is refused', r.ok && r.data.refused === true && r.data.errors[0].i18n === 'theme.err.json');
  const afterImport = (await services().settings.get()).appearance.custom;
  check('importing saves nothing', Boolean(afterImport) && afterImport.colors.accent === '#6d28d9');

  const exported = path.join(files, 'out.cleandrive-theme.json');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
  r = await js(`window.cleandrive.exportTheme(ThemeEditor.draft())`);
  const back = r.ok && fs.existsSync(exported) ? T.parse(fs.readFileSync(exported, 'utf8')) : null;
  check('export writes a file that import reads back, colour for colour',
    back && back.ok && back.theme.colors.accent === '#6d28d9' && back.theme.name === 'Mine', r.ok ? '' : r.error);

  await run(`document.querySelector('#theme-switch-settings [data-theme-choice="custom"]').click();`);
  await wait(300);
  await run(`document.getElementById('custom-forget').click();`);
  await wait(400);
  const forgotten = (await services().settings.get()).appearance;
  check('Forget removes the palette, and the window goes back to the theme under it',
    forgotten.custom === null && (await js(`document.documentElement.dataset.theme`)) === 'dark', JSON.stringify(forgotten));

  /* ---- Vietnamese ---- */

  console.log('\nIn Vietnamese:');
  // Through the Settings control, as a person would: the window translates
  // itself as well as telling the main process.
  await tab('settings');
  await run(`document.querySelector('[data-language-choice="vi"]').click();`);
  await until(`document.documentElement.lang === 'vi'`, 5000);
  await wait(300);
  await setTheme('light');
  for (const screen of ['usage', 'settings', 'media']) {
    await tab(screen);
    await wait(250);
    const result = await axeRun();
    check(`vi: ${screen} has no violations`, result.violations.length === 0, result.violations.map((v) => `${v.id}: ${v.nodes.join(' | ')}`).join(' || '));
  }
  check('the page says it is Vietnamese, for the screen reader’s voice', (await js(`document.documentElement.lang`)) === 'vi');
  await run(`window.Shortcuts.open();`);
  const title = await js(`document.getElementById('shortcuts-title').textContent`);
  check('the list of keys is in Vietnamese', title === 'Phím tắt', title);
  await run(`document.getElementById('shortcuts').close();`);

  /* ---- the end ---- */

  console.log('\nConsole:');
  check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const realAfter = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;
  check('the real settings file was not touched', realAfter === realBefore);

  dbg.detach();
  win.destroy();
  fs.rmSync(work, { recursive: true, force: true });
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
