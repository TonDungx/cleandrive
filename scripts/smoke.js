'use strict';

// End-to-end smoke test. Boots the real app (real preload, real IPC, real
// renderer), drives the UI by clicking its own buttons, and reads the rendered
// DOM back out. Nothing is deleted -- the trash check runs as a dry run.
//
//   npx electron scripts/smoke.js [folder]

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const ipc = require('../src/main/ipc');

// Running `electron scripts/foo.js` does not read the project's package.json,
// so Electron falls back to the name "Electron" and `getPath('userData')`
// points at %APPDATA%\Electron. The name is set anyway, and then *checked*
// below, so this harness still proves the real app resolves the real directory.
app.setName(require('../package.json').name);

/*
 * The production userData path, recorded before it is redirected.
 *
 * ## Why this harness no longer runs against the real files
 *
 * It used to. It took copies of settings.json, autoclean-log.json,
 * history.json and trash-ledger.json, deleted them so the assertions would see
 * a fresh install, ran, and put them back in a `finally`.
 *
 * That was not enough, and the cost was real: a run interrupted before the
 * `finally` (Ctrl-C, or the harness being killed) left the tester with this
 * harness's leftovers in place of their own data, and the settings file simply
 * gone. Worse, the settings section saves through the real IPC handler, which
 * reconciles Task Scheduler on every save -- so saving `enabled: false` here
 * *deleted the Windows task the tester had configured*, and restoring the JSON
 * afterwards did not bring it back. A 02:00 cleanup on the development machine
 * stopped running for a fortnight because of exactly this.
 *
 * So the app under test is pointed at a throwaway directory instead. Every code
 * path is still exercised for real -- the same store, the same IPC, the same
 * writes -- and the task names are suffixed, so nothing this file does can
 * reach the schedule or the data of whoever is running it.
 */
const PRODUCTION_USER_DATA = app.getPath('userData');
const SANDBOX_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-smoke-userdata-'));
app.setPath('userData', SANDBOX_USER_DATA);

// Read by scheduler.js when it derives the task names. Set before ipc.js is
// required below, because that module requires the scheduler.
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'smoke';

// Which quick-path button to drive: downloads | documents | pictures | ...
const targetArg = process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('smoke.js'));
const TARGET_LABEL = targetArg || 'downloads';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A small photo library, written byte by byte.
 *
 * The repository holds no binary assets, and a real photograph committed as a
 * fixture would carry somebody's camera serial number into the git history for
 * ever. These are real files of real formats with real headers -- enough for
 * the scan to read dimensions from and for the classifier to reach a verdict
 * about -- assembled here and deleted afterwards.
 */
/**
 * Enough files that the grid has to virtualise.
 *
 * The first version of this built nine, which was enough to check the
 * classifier and useless for checking the grid: nine cells fit on screen, so
 * "only what is on screen is drawn" was trivially false and the assertion
 * failed for the right reason. The bulk below are a few hundred bytes each.
 */
const MEDIA_FIXTURE_FILLER = 160;
const MEDIA_FIXTURE_COUNT = 9 + MEDIA_FIXTURE_FILLER;

function buildMediaFixtures(root) {
  const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

  const png = (width, height, padTo) => {
    const head = Buffer.concat([
      Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n', 'latin1'),
      u32be(13), Buffer.from('IHDR', 'latin1'),
      u32be(width), u32be(height), Buffer.from([8, 6, 0, 0, 0]), u32be(0),
    ]);
    const pad = Math.max(0, padTo - head.length - 12);
    return Buffer.concat([head, u32be(pad), Buffer.from('tEXt', 'latin1'), Buffer.alloc(pad), u32be(0)]);
  };

  const jpeg = (width, height, padTo) => {
    const seg = (marker, body) =>
      Buffer.concat([Buffer.from([0xff, marker]), u16be(body.length + 2), body]);
    const head = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      seg(0xc0, Buffer.concat([
        Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3]),
        Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
      ])),
      seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])),
    ]);
    const tail = Buffer.from([0xff, 0xd9]);
    return Buffer.concat([head, Buffer.alloc(Math.max(0, padTo - head.length - tail.length), 0x7f), tail]);
  };

  const write = (relative, bytes) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
  };

  // A folder name the classifier knows, so these come back as camera photos.
  write('Camera Roll/IMG_0001.jpg', jpeg(4032, 3024, 320 * 1024));
  write('Camera Roll/IMG_0002.jpg', jpeg(4032, 3024, 300 * 1024));
  write('Camera Roll/DSC_4410.jpg', jpeg(6000, 4000, 480 * 1024));

  // Named the way every screenshot tool names them.
  write('Screenshots/Screenshot 2025-06-23 163709.png', png(1920, 1080, 260 * 1024));
  write('Screenshots/Screenshot 2025-06-24 161310.png', png(1920, 1080, 240 * 1024));

  // The pattern nothing else on earth writes.
  write('Sent/IMG-20240817-WA0042.jpg', jpeg(1600, 1200, 180 * 1024));

  // Things the "what it is" axis has an opinion about.
  write('Odds/tiny-icon.png', png(32, 32, 1400));
  write('Odds/actually-a-png.jpg', png(800, 600, 40 * 1024));
  write('Odds/broken.png', Buffer.alloc(0));

  // Not media, and must not be counted as such.
  write('Odds/notes.txt', Buffer.from('not a photograph'));

  // The bulk, so the grid has more rows than fit on screen.
  //
  // Sized like photographs rather than like icons, and that is not padding for
  // its own sake. A first attempt wrote 240 files of six hundred bytes into one
  // folder, and the scan correctly filed the lot as a program's artwork and hid
  // them -- which is exactly what that rule is for, and exactly what a folder
  // of 240 tiny images is. The rule is judged on the median size of a folder,
  // so a fixture standing in for an album has to look like one.
  for (let i = 0; i < MEDIA_FIXTURE_FILLER; i++) {
    write(`Album/DSC_${2000 + i}.png`, png(64, 48, 28 * 1024 + i));
  }
}

/** Poll `fn` in the renderer until it returns truthy or the deadline passes. */
async function until(win, expression, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await win.webContents.executeJavaScript(expression);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${expression}`);
    await wait(250);
  }
}

app.whenReady().then(async () => {
  ipc.register();

  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const rendererErrors = [];
  win.webContents.on('console-message', (...args) => {
    // Electron <35: (event, level, message, line, source)
    // Electron >=35: (event, details)
    const level = typeof args[1] === 'object' ? args[1].level : args[1];
    const message = typeof args[1] === 'object' ? args[1].message : args[2];
    const isError = level === 3 || level === 'error';
    if (isError) rendererErrors.push(message);
    console.log(`    [renderer:${level}] ${message}`);
  });
  win.webContents.on('preload-error', (_e, file, err) => {
    rendererErrors.push(`preload ${file}: ${err.message}`);
  });

  // The app writes to userData throughout: a scan records a history snapshot,
  // the settings sections save a policy, and the delete-progress section really
  // does move 40 probe files to the Recycle Bin, which the ledger records. All
  // of it lands in the sandbox directory this file created, so there is nothing
  // to back up and nothing to put back.
  const userData = app.getPath('userData');
  const managed = ['settings.json', 'autoclean-log.json', 'history.json', 'trash-ledger.json'].map((name) =>
    path.join(userData, name)
  );

  try {
    console.log(`\nTarget: ${TARGET_LABEL}\n`);

    console.log('Isolation:');
    check('the app resolves the production userData directory',
      /[\\/]cleandrive$/i.test(PRODUCTION_USER_DATA), PRODUCTION_USER_DATA);
    check('but this harness is pointed somewhere disposable',
      userData === SANDBOX_USER_DATA && userData !== PRODUCTION_USER_DATA, userData);
    check('so the tester\'s own settings are not in reach',
      !managed.some((file) => file.startsWith(PRODUCTION_USER_DATA)));
    // The settings save below goes through the real IPC handler, which
    // registers and unregisters Windows tasks. Under a suffix it cannot touch
    // the entry a real user configured.
    const { cleanupTaskPath } = require('../src/main/lib/scheduler');
    check('and neither is their Windows task', /_smoke$/.test(cleanupTaskPath()), cleanupTaskPath());

    // Start from defaults, not from whatever this machine happens to have
    // configured. The assertions below are about what a fresh install shows,
    // and they were failing on a developer's own box purely because that
    // developer had switched automatic cleanup on -- a test whose result
    // depends on the tester is not a test.
    for (const file of managed) fs.rmSync(file, { force: true });

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

    /* -- bridge --------------------------------------------------------- */
    console.log('Preload bridge:');
    const bridge = await win.webContents.executeJavaScript(
      'Object.keys(window.cleandrive || {}).sort()'
    );
    check('window.cleandrive exposed', bridge.length > 0, bridge.join(', '));
    check(
      'no raw node access in renderer',
      await win.webContents.executeJavaScript(
        "typeof require === 'undefined' && typeof process === 'undefined'"
      )
    );

    /* -- the sidebar ------------------------------------------------------ */
    // Driven through the handle itself, because every interesting state of this
    // control is a consequence of where the pointer was let go: the labels go
    // when it is narrow, it shuts when it is dragged into the edge, and what it
    // was left at has to survive the next launch.
    console.log('\nSidebar:');

    const sidebar = await win.webContents.executeJavaScript(`
      (() => {
        const root = document.documentElement;
        const bar = document.getElementById('sidebar');
        const handle = document.getElementById('sidebar-resizer');
        const workspace = document.getElementById('workspace');
        const label = document.querySelector('.tab-label');

        const left = () => workspace.getBoundingClientRect().left;
        const labelled = () => getComputedStyle(label).display !== 'none';
        const drag = (x) => handle.dispatchEvent(
          new PointerEvent('pointermove', { clientX: left() + x, bubbles: true, pointerId: 1 })
        );

        const opened = { state: root.dataset.sidebar, width: bar.getBoundingClientRect().width, labelled: labelled() };

        handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: left() + opened.width, bubbles: true, pointerId: 1 }));

        drag(130);
        const narrow = { width: bar.getBoundingClientRect().width, labelled: labelled() };

        drag(40);
        const shut = { state: root.dataset.sidebar, visible: bar.offsetParent !== null };

        handle.dispatchEvent(new PointerEvent('pointerup', { clientX: left() + 40, bubbles: true, pointerId: 1 }));

        let stored = null;
        try {
          stored = JSON.parse(localStorage.getItem('cleandrive.sidebar') || 'null');
        } catch {
          stored = null;
        }

        document.getElementById('sidebar-open').click();
        const back = { state: root.dataset.sidebar, width: bar.getBoundingClientRect().width, labelled: labelled() };

        return { opened, narrow, shut, stored, back, panelsShowing: document.querySelectorAll('.panel.is-active').length };
      })()
    `);

    check('the sidebar starts open, with its sections named',
      sidebar.opened.state === 'open' && sidebar.opened.labelled === true,
      `${Math.round(sidebar.opened.width)}px`);
    check('dragging it narrow leaves the icons and drops the labels',
      sidebar.narrow.labelled === false && sidebar.narrow.width < sidebar.opened.width,
      `${Math.round(sidebar.narrow.width)}px`);
    check('dragging it into the edge shuts it',
      sidebar.shut.state === 'closed' && sidebar.shut.visible === false);
    check('and that choice is written down for the next launch',
      sidebar.stored !== null && sidebar.stored.closed === true, JSON.stringify(sidebar.stored));
    // A drag to the edge sweeps through every narrow width on the way out;
    // none of them is a choice, so reopening restores what it had before.
    check('the button brings it back at the width it had before the drag',
      sidebar.back.state === 'open' && sidebar.back.labelled === true,
      `${Math.round(sidebar.back.width)}px`);
    // The hide button is drawn as a row like the sections are. It used to be
    // picked up by the tab handler, which switched to a panel that does not
    // exist and left the window blank.
    check('exactly one panel is on screen throughout', sidebar.panelsShowing === 1,
      String(sidebar.panelsShowing));

    /* -- folder selection ------------------------------------------------ */
    // The quick-path buttons run the app's own setFolder(), so the folder is
    // chosen through real UI. Clicking "Choose folder…" would open a native
    // dialog that nothing can dismiss here.
    console.log('\nFolder selection:');
    await until(win, `document.querySelectorAll('#quick-paths button').length > 0`);

    const picked = await win.webContents.executeJavaScript(`
      (() => {
        const buttons = [...document.querySelectorAll('#quick-paths button')];
        const wanted = ${JSON.stringify(TARGET_LABEL)}.toLowerCase();
        const btn = buttons.find(b => b.textContent.toLowerCase() === wanted) || buttons[0];
        btn.click();
        return { label: btn.textContent, path: btn.title, count: buttons.length };
      })()
    `);
    console.log(`    using "${picked.label}" -> ${picked.path}`);
    check('quick-path buttons rendered', picked.count > 0, `${picked.count} buttons`);

    /* -- scan ------------------------------------------------------------ */
    console.log('\nScan:');
    await until(win, `document.getElementById('run-scan').disabled === false`);
    await win.webContents.executeJavaScript(`document.getElementById('run-scan').click()`);

    await until(win, `document.getElementById('scan-stats').hidden === false`);

    const scanUi = await win.webContents.executeJavaScript(`({
      size: document.getElementById('stat-size').textContent,
      files: document.getElementById('stat-files').textContent,
      dirs: document.getElementById('stat-dirs').textContent,
      time: document.getElementById('stat-time').textContent,
      status: document.getElementById('scan-status').textContent,
      topFolders: document.querySelectorAll('#top-folders .bar-row').length,
      types: document.querySelectorAll('#by-type .bar-row').length,
      largest: document.querySelectorAll('#largest-files .file-row').length,
      firstFolder: (document.querySelector('#top-folders .bar-name') || {}).textContent,
      resultsVisible: document.getElementById('scan-results').hidden === false,
    })`);

    console.log(`    ${scanUi.size} · ${scanUi.files} files · ${scanUi.dirs} folders · ${scanUi.time}`);
    console.log(`    status: ${scanUi.status}`);
    check('results section visible', scanUi.resultsVisible);
    check('size rendered', /\d/.test(scanUi.size) && scanUi.size !== '0 B', scanUi.size);
    check('top folders listed', scanUi.topFolders > 0, `${scanUi.topFolders} rows, first "${scanUi.firstFolder}"`);
    check('type breakdown listed', scanUi.types > 0, `${scanUi.types} rows`);
    check('largest files listed', scanUi.largest > 0, `${scanUi.largest} rows`);
    check('spinner hidden after scan', await win.webContents.executeJavaScript(
      `document.getElementById('scan-progress').hidden === true`
    ));

    /* -- cleanup advice --------------------------------------------------- */
    console.log('\nWhat to delete:');
    await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="cleanup"]').click()`);

    const cleanupUi = await win.webContents.executeJavaScript(`({
      safe: document.getElementById('cstat-safe').textContent,
      review: document.getElementById('cstat-review').textContent,
      protectedCount: document.getElementById('cstat-protected').textContent,
      groups: [...document.querySelectorAll('#cleanup-groups .group')].map(g => ({
        category: g.dataset.category,
        badge: g.querySelector('.badge').textContent,
        head: g.querySelector('strong').textContent,
        hint: g.querySelector('.group-hint').textContent,
        rows: g.querySelectorAll('.file-row').length,
        firstReason: (g.querySelector('.file-meta') || {}).textContent,
      })),
      protectedRows: document.querySelectorAll('#protected-list .file-row').length,
      protectedCardShown: document.getElementById('protected-card').hidden === false,
      atimeNoticeShown: document.getElementById('atime-notice').hidden === false,
      atimeNotice: document.getElementById('atime-notice').textContent,
      tabBadge: document.getElementById('cleanup-badge').textContent,
    })`);

    console.log(`    safe ${cleanupUi.safe} · review ${cleanupUi.review} · ${cleanupUi.protectedCount} protected locations`);
    for (const g of cleanupUi.groups) {
      console.log(`      [${g.badge}] ${g.head} (${g.rows} rows)`);
      if (g.firstReason) console.log(`           e.g. ${g.firstReason}`);
    }
    if (cleanupUi.atimeNoticeShown) console.log(`    notice: ${cleanupUi.atimeNotice}`);

    check('cleanup stats rendered', /\d/.test(cleanupUi.safe) && /\d/.test(cleanupUi.review));
    check('every group carries a verdict badge',
      cleanupUi.groups.every((g) => g.badge === 'safe to delete' || g.badge === 'your call'),
      cleanupUi.groups.map((g) => g.badge).join(', '));
    check('every group explains itself', cleanupUi.groups.every((g) => g.hint.length > 10));
    check('file rows carry a reason and an age',
      cleanupUi.groups.every((g) => g.rows === 0 || /·/.test(g.firstReason || '')),
      cleanupUi.groups[0] ? cleanupUi.groups[0].firstReason : 'no groups');

    const selectedSafe = await win.webContents.executeJavaScript(`
      document.getElementById('select-safe').click();
      ({
        status: document.getElementById('cleanup-selection').textContent,
        checked: document.querySelectorAll('#cleanup-groups input:checked').length,
        reviewChecked: [...document.querySelectorAll('#cleanup-groups .group')]
          .filter(g => g.querySelector('.badge').textContent === 'your call')
          .reduce((n, g) => n + g.querySelectorAll('input:checked').length, 0),
      })
    `);
    console.log(`    select-safe -> ${selectedSafe.status}`);
    check('"select everything safe" never selects a review item',
      selectedSafe.reviewChecked === 0, `${selectedSafe.reviewChecked} review rows checked`);

    await win.webContents.executeJavaScript(`document.getElementById('cleanup-select-none').click()`);

    /* -- duplicates ------------------------------------------------------ */
    console.log('\nDuplicates:');
    await win.webContents.executeJavaScript(`
      document.querySelector('.tab[data-tab="dupes"]').click();
      document.getElementById('min-size').value = '102400';
      document.getElementById('run-dupes').click();
    `);
    await until(win, `document.getElementById('dupes-stats').hidden === false`);

    const dupeUi = await win.webContents.executeJavaScript(`({
      groups: document.getElementById('dstat-groups').textContent,
      waste: document.getElementById('dstat-waste').textContent,
      hashed: document.getElementById('dstat-hashed').textContent,
      time: document.getElementById('dstat-time').textContent,
      status: document.getElementById('dupes-status').textContent,
      groupCards: document.querySelectorAll('#dupe-groups .group').length,
      rows: document.querySelectorAll('#dupe-groups .file-row').length,
      keepers: document.querySelectorAll('#dupe-groups .keeper-tag').length,
      toolbarVisible: document.getElementById('dupes-toolbar').hidden === false,
      emptyShown: document.getElementById('dupes-empty').hidden === false,
    })`);

    console.log(`    ${dupeUi.groups} groups · ${dupeUi.waste} reclaimable · ${dupeUi.hashed} hashed · ${dupeUi.time}`);
    console.log(`    status: ${dupeUi.status}`);

    const foundGroups = dupeUi.groupCards > 0;
    check(
      'duplicate result rendered',
      foundGroups || dupeUi.emptyShown,
      foundGroups ? `${dupeUi.groupCards} group cards, ${dupeUi.rows} file rows` : 'empty state shown'
    );

    if (foundGroups) {
      check('one keeper tag per group', dupeUi.keepers === dupeUi.groupCards, `${dupeUi.keepers} tags / ${dupeUi.groupCards} groups`);
      check('toolbar visible', dupeUi.toolbarVisible);

      /* -- selection ---------------------------------------------------- */
      console.log('\nSelection:');
      const selected = await win.webContents.executeJavaScript(`
        document.getElementById('select-extra').click();
        ({
          status: document.getElementById('selection-status').textContent,
          checked: document.querySelectorAll('#dupe-groups input:checked').length,
          deleteEnabled: document.getElementById('delete-dupes').disabled === false,
        })
      `);
      console.log(`    ${selected.status}`);
      check('select-all-but-oldest selects rows', selected.checked > 0, `${selected.checked} checked`);
      check('never selects the keeper', selected.checked === dupeUi.rows - dupeUi.groupCards,
        `${selected.checked} selected of ${dupeUi.rows} rows in ${dupeUi.groupCards} groups`);
      check('delete button enabled', selected.deleteEnabled);

      const cleared = await win.webContents.executeJavaScript(`
        document.getElementById('select-none').click();
        ({ checked: document.querySelectorAll('#dupe-groups input:checked').length,
           disabled: document.getElementById('delete-dupes').disabled })
      `);
      check('clear selection works', cleared.checked === 0 && cleared.disabled);
    }

    /* -- photos and video ------------------------------------------------ */
    //
    // Driven against a tree this harness builds, not against whatever the
    // tester's Pictures folder happens to hold: the assertions below are about
    // counts and shapes, and a test whose result depends on the person running
    // it is not a test. The same reasoning that points `userData` somewhere
    // disposable.
    console.log('\nPhotos & video:');

    const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-smoke-media-'));
    buildMediaFixtures(mediaRoot);

    await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="media"]').click()`);
    check('the photo panel opens',
      await win.webContents.executeJavaScript(
        `document.getElementById('panel-media').classList.contains('is-active')`));

    await until(win, `document.querySelectorAll('#media-roots .check').length > 0`);
    const mediaOffered = await win.webContents.executeJavaScript(`({
      roots: document.querySelectorAll('#media-roots .check').length,
      names: [...document.querySelectorAll('#media-roots strong')].map((e) => e.textContent),
      downloadsOff: [...document.querySelectorAll('#media-roots .check')]
        .filter((r) => r.querySelector('strong').textContent === 'Downloads')
        .every((r) => r.querySelector('input').checked === false),
    })`);
    check('photo folders are offered rather than the whole drive', mediaOffered.roots > 0, mediaOffered.names.join(', '));
    // Downloads held 9,676 of the 10,185 "photos" found in a drive-wide walk of
    // the development machine, nearly all of them interface sprites. It is
    // offered, and it is off.
    check('Downloads is offered but not ticked', mediaOffered.downloadsOff);

    // Point the scan at the fixture tree only.
    await win.webContents.executeJavaScript(`
      for (const root of media.roots) root.on = false;
      media.extraRoots = [{ path: ${JSON.stringify(mediaRoot)}, name: 'fixture', why: null, on: true }];
      renderRoots();
      document.getElementById('media-scan').click();
    `);
    await until(win, `document.getElementById('media-cancel').hidden === true && media.files.length > 0`);

    const mediaUi = await win.webContents.executeJavaScript(`({
      files: media.files.length,
      status: document.getElementById('media-status').textContent,
      cells: document.querySelectorAll('.media-cell').length,
      canvasHeight: parseInt(document.getElementById('media-canvas').style.height, 10),
      chips: document.querySelectorAll('.chip').length,
      chipMeta: [...document.querySelectorAll('.chip .chip-meta')].map((e) => e.textContent),
      origins: [...new Set(media.files.map((f) => f.origin))].sort(),
      selected: media.selected.size,
      deleteDisabled: document.getElementById('media-delete').disabled,
    })`);
    console.log(`    ${mediaUi.status}`);

    check('the fixture photos are found', mediaUi.files === MEDIA_FIXTURE_COUNT,
      `${mediaUi.files} of ${MEDIA_FIXTURE_COUNT}`);

    // The whole reason the grid is virtualised. A folder of twenty thousand
    // photographs rendered in one pass is a renderer that stops responding.
    check('the grid draws only what is on screen', mediaUi.cells < mediaUi.files,
      `${mediaUi.cells} cells for ${mediaUi.files} files`);
    check('but the scrollbar is honest about how much there is', mediaUi.canvasHeight > 0,
      `${mediaUi.canvasHeight}px of canvas`);

    check('the classifier told them apart', mediaUi.origins.length >= 2, mediaUi.origins.join(', '));
    check('every chip says how much it holds',
      mediaUi.chips > 0 && mediaUi.chipMeta.every((text) => /·/.test(text)),
      mediaUi.chipMeta.slice(0, 3).join(' | '));

    // The rule this whole screen is built around.
    check('nothing is selected for the user', mediaUi.selected === 0);
    check('and the delete button is off until they choose', mediaUi.deleteDisabled === true);

    /* -- the evidence behind a verdict ----------------------------------- */

    const mediaDetail = await win.webContents.executeJavaScript(`
      document.querySelector('.media-cell').click();
      ({
        name: document.querySelector('.detail-name').textContent,
        origin: document.querySelector('.detail-origin').textContent,
        strength: document.querySelector('.detail-strength').textContent,
        why: [...document.querySelectorAll('.detail-why li')].map((e) => e.textContent),
        facts: [...document.querySelectorAll('.detail-facts dt')].map((e) => e.textContent),
        selection: document.getElementById('media-selection').textContent,
      })
    `);
    console.log(`    ${mediaDetail.name}: ${mediaDetail.origin} (${mediaDetail.strength})`);
    for (const line of mediaDetail.why) console.log(`      ${line}`);

    // This app's standing rule, on the screen where it matters most.
    check('a verdict never appears without its evidence', mediaDetail.why.length > 0,
      `${mediaDetail.why.length} reasons given`);
    check('and it says how sure it is', mediaDetail.strength.length > 0, mediaDetail.strength);
    check('the facts behind it are listed', mediaDetail.facts.length >= 3, mediaDetail.facts.join(', '));
    check('clicking one picture selects exactly one', /1/.test(mediaDetail.selection), mediaDetail.selection);

    /* -- filtering -------------------------------------------------------- */

    const mediaFiltered = await win.webContents.executeJavaScript(`
      const before = media.shown.length;
      document.querySelector('.chip').click();
      const after = media.shown.length;
      const activeText = document.querySelector('.chip.is-active .chip-name').textContent;
      document.querySelector('.chip.is-active').click();
      ({ before, after, restored: media.shown.length, activeText })
    `);
    check('a chip filters the grid', mediaFiltered.after < mediaFiltered.before,
      `${mediaFiltered.before} -> ${mediaFiltered.after} (${mediaFiltered.activeText})`);
    check('and clicking it again restores everything', mediaFiltered.restored === mediaFiltered.before);

    /* -- selection -------------------------------------------------------- */

    const mediaPicked = await win.webContents.executeJavaScript(`
      document.getElementById('media-select-filtered').click();
      ({
        selected: media.selected.size,
        shown: media.shown.length,
        status: document.getElementById('media-selection').textContent,
        enabled: document.getElementById('media-delete').disabled === false,
      })
    `);
    check('"select everything shown" takes exactly what is shown',
      mediaPicked.selected === mediaPicked.shown, `${mediaPicked.selected} of ${mediaPicked.shown}`);
    check('the total selected is stated', /·/.test(mediaPicked.status), mediaPicked.status);
    check('the delete button turns on', mediaPicked.enabled);

    const mediaCleared = await win.webContents.executeJavaScript(`
      document.getElementById('media-select-none').click();
      ({ selected: media.selected.size, disabled: document.getElementById('media-delete').disabled })
    `);
    check('clearing the selection turns it off again', mediaCleared.selected === 0 && mediaCleared.disabled);

    /* -- the guard that matters most -------------------------------------- */
    //
    // Nothing on this screen may delete without a confirmation, and the
    // confirmation is composed in the main process. Here the delete is a dry
    // run with the dialog switched off, which exercises the same vetting path
    // without putting a modal in front of an unattended test.
    const mediaDry = await win.webContents.executeJavaScript(`
      window.cleandrive.trash(media.files.slice(0, 2).map((f) => f.path),
        { dryRun: true, confirm: false, context: 'media' })
    `);
    check('a photo delete goes through the same guarded path', mediaDry.ok === true,
      JSON.stringify(mediaDry.error || ''));
    check('and a dry run moves nothing', mediaDry.data.dryRun === true &&
      mediaDry.data.moved.every((m) => m.dryRun === true));
    check('the fixture files are all still there',
      fs.readdirSync(path.join(mediaRoot, 'Camera Roll')).length > 0);

    fs.rmSync(mediaRoot, { recursive: true, force: true });

    /* -- trash (dry run) ------------------------------------------------- */
    console.log('\nTrash (dry run -- nothing is deleted):');
    const probe = path.join(os.tmpdir(), 'cleandrive-smoke-probe.txt');
    fs.writeFileSync(probe, 'probe');

    const trashResult = await win.webContents.executeJavaScript(`
      window.cleandrive.trash([${JSON.stringify(probe)}, 'C:\\\\Windows\\\\System32\\\\kernel32.dll'],
        { dryRun: true, confirm: false })
    `);
    check('trash IPC returns ok', trashResult.ok === true, JSON.stringify(trashResult.error || ''));
    check('probe file would move', trashResult.ok && trashResult.data.moved.length === 1);
    check('system file refused', trashResult.ok && trashResult.data.failed.length === 1,
      trashResult.ok ? (trashResult.data.failed[0] || {}).error : '');
    check('probe still on disk (dry run)', fs.existsSync(probe));
    fs.rmSync(probe, { force: true });

    /* -- real delete, watching the progress panel ------------------------- */
    console.log('\nDelete progress (40 throwaway probe files, really deleted):');

    const probeDir = path.join(os.tmpdir(), 'cleandrive-smoke-progress');
    fs.rmSync(probeDir, { recursive: true, force: true });
    fs.mkdirSync(probeDir, { recursive: true });
    const probes = [];
    for (let i = 0; i < 40; i++) {
      const file = path.join(probeDir, `cleandrive-smoke-probe-${i}.bin`);
      fs.writeFileSync(file, 'x'.repeat(4096));
      probes.push(file);
    }

    check('panel hidden before any delete', await win.webContents.executeJavaScript(
      `document.getElementById('delete-progress').hidden === true`));

    const runProgress = await win.webContents.executeJavaScript(`
      (async () => {
        window.__events = [];
        window.__domFrames = [];
        const stop = window.cleandrive.onTrashProgress(p => {
          window.__events.push(p);
          // Sampled after app.js's own handler has written to the DOM.
          queueMicrotask(() => window.__domFrames.push({
            count: document.getElementById('dp-count').textContent,
            width: document.getElementById('dp-fill').style.width,
            eta: document.getElementById('dp-eta').textContent,
            title: document.getElementById('dp-title').textContent,
          }));
        });
        const res = await window.cleandrive.trash(${JSON.stringify(probes)}, { confirm: false });
        // The invoke reply and the final 'done' event are delivered
        // independently, so the reply can win the race. The panel does not
        // depend on 'done' -- it hides when the promise settles -- but give
        // the event a moment to land before we stop listening.
        await new Promise(r => setTimeout(r, 300));
        stop();
        return {
          ok: res.ok,
          moved: res.ok ? res.data.moved.length : 0,
          freed: res.ok ? res.data.freedBytes : 0,
          phases: [...new Set(window.__events.map(e => e.phase))],
          eventCount: window.__events.length,
          deleting: window.__events.filter(e => e.phase === 'deleting').map(e => e.done),
          rates: window.__events.filter(e => e.ratePerSec > 0).length,
          etas: window.__events.filter(e => e.etaMs != null).length,
          domFrames: window.__domFrames.filter(f => /of/.test(f.count)),
        };
      })()
    `);

    console.log(`    ${runProgress.eventCount} progress events, phases: ${runProgress.phases.join(' -> ')}`);
    console.log(`    done sequence: ${runProgress.deleting.slice(0, 12).join(', ')}${runProgress.deleting.length > 12 ? ' …' : ''}`);
    const lastFrame = runProgress.domFrames[runProgress.domFrames.length - 1];
    if (lastFrame) console.log(`    final DOM: "${lastFrame.title}" ${lastFrame.count} (bar ${lastFrame.width}) ${lastFrame.eta}`);

    check('delete succeeded', runProgress.ok && runProgress.moved === 40, `${runProgress.moved} moved`);
    check('progress events reached the renderer', runProgress.eventCount > 0, `${runProgress.eventCount} events`);
    check('both phases reported',
      runProgress.phases.includes('checking') && runProgress.phases.includes('deleting') && runProgress.phases.includes('done'),
      runProgress.phases.join(', '));
    check('done count only moves forward',
      runProgress.deleting.every((d, i) => i === 0 || d >= runProgress.deleting[i - 1]));
    check('reaches the full count', runProgress.deleting[runProgress.deleting.length - 1] === 40,
      String(runProgress.deleting[runProgress.deleting.length - 1]));
    check('a live rate was reported', runProgress.rates > 0, `${runProgress.rates} events with a rate`);
    check('an eta was reported', runProgress.etas > 0, `${runProgress.etas} events with an eta`);
    check('the DOM panel actually updated', runProgress.domFrames.length > 0,
      `${runProgress.domFrames.length} rendered frames`);
    check('progress bar reached 100%', lastFrame && lastFrame.width === '100%',
      lastFrame ? lastFrame.width : 'no frames');
    check('every probe file left the disk', probes.every((p) => !fs.existsSync(p)));
    check('panel hidden again afterwards', await win.webContents.executeJavaScript(
      `document.getElementById('delete-progress').hidden === true`));

    fs.rmSync(probeDir, { recursive: true, force: true });

    /* -- automatic cleanup ------------------------------------------------ */
    // This section writes to the real settings file, so it takes a copy first
    // and puts it back afterwards. It never enables the schedule: registering a
    // Windows task belongs in test-scheduler.js --live, not in a smoke run.
    console.log('\nAutomatic cleanup:');

    const autoDir = path.join(os.tmpdir(), 'cleandrive-smoke-auto', 'Cache');
    fs.rmSync(path.dirname(autoDir), { recursive: true, force: true });
    fs.mkdirSync(autoDir, { recursive: true });
    const oldStamp = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      const f = path.join(autoDir, `stale-${i}.bin`);
      fs.writeFileSync(f, Buffer.alloc(64 * 1024, i));
      fs.utimesSync(f, oldStamp, oldStamp);
    }

    try {
      await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="auto"]').click()`);
      await until(win, `document.getElementById('auto-categories').children.length > 0`);

      const autoUi = await win.webContents.executeJavaScript(`({
        panelVisible: document.getElementById('panel-auto').classList.contains('is-active'),
        categories: document.querySelectorAll('#auto-categories input[type=checkbox]').length,
        checked: [...document.querySelectorAll('#auto-categories input[type=checkbox]')]
          .filter(b => b.checked).map(b => b.dataset.category),
        enabled: document.getElementById('auto-enabled').checked,
        dryRun: document.getElementById('auto-dryrun').checked,
        state: document.getElementById('astat-state').textContent,
        disk: document.getElementById('astat-disk').textContent,
        days: document.getElementById('auto-day').children.length,
        binNote: document.getElementById('auto-bin-note').textContent,
        rootsEmpty: document.querySelectorAll('#auto-roots .path-empty').length,
        status: document.getElementById('auto-status').textContent,
      })`);

      console.log(`    state "${autoUi.state}" · disk ${autoUi.disk} · defaults ${autoUi.checked.join(', ')}`);
      check('the Automatic panel opens', autoUi.panelVisible);
      check('only safe categories are offered', autoUi.categories === 6, String(autoUi.categories));
      check('build output is not enabled by default', !autoUi.checked.includes('buildoutput'),
        autoUi.checked.join(','));
      check('automatic cleanup starts switched off', autoUi.enabled === false);
      check('and in report-only mode', autoUi.dryRun === true);
      check('monthly days stop at 28', autoUi.days === 28, String(autoUi.days));
      check('the Recycle Bin caveat is stated up front',
        /frees no disk space/.test(autoUi.binNote), autoUi.binNote.slice(0, 60));
      check('an empty folder list says the cleanup will not run', autoUi.rootsEmpty === 1);
      check('real disk usage is shown', /%/.test(autoUi.disk), autoUi.disk);

      // Configure through the real IPC path, then confirm the form reflects it.
      const saved = await win.webContents.executeJavaScript(`
        window.cleandrive.saveSettings({
          autoClean: {
            enabled: false, dryRun: true,
            roots: [${JSON.stringify(path.dirname(autoDir))}],
            categories: ['cache'], minAgeDays: 180, skipIfRunning: [], maxItemsPerRun: 500,
            schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1 },
          },
          purge: { enabled: false, afterDays: 7 },
        })
      `);
      check('settings save round-trips through IPC', saved.ok === true, saved.error || '');
      check('the saved folder comes back', saved.ok && saved.data.settings.autoClean.roots.length === 1);
      check('no Windows task is created while it is switched off',
        saved.ok && saved.data.scheduler.installed === false);

      // Unsaved form edits must reach the run: the button saves first. Point the
      // form at a folder that was never saved, then preview through the real UI
      // path and check it looked where the screen says.
      const unsavedFolder = path.dirname(autoDir);
      const usedFormState = await win.webContents.executeJavaScript(`
        (async () => {
          state.autoLists.roots = [${JSON.stringify(unsavedFolder)}, ${JSON.stringify(os.tmpdir())}];
          renderAutoLists();
          await performAutoRun(true);
          const saved = await window.cleandrive.getSettings();
          return {
            savedRoots: saved.ok ? saved.data.settings.autoClean.roots.length : -1,
            resultText: document.getElementById('auto-result-body').textContent,
          };
        })()
      `);
      check('pressing Preview saves what is on screen first',
        usedFormState.savedRoots === 2, String(usedFormState.savedRoots));
      check('and the result reflects it', /Selected/.test(usedFormState.resultText));

      // Put the single-folder configuration back for the assertions below.
      await win.webContents.executeJavaScript(`
        window.cleandrive.saveSettings({
          autoClean: {
            enabled: false, dryRun: true,
            roots: [${JSON.stringify(path.dirname(autoDir))}],
            categories: ['cache'], minAgeDays: 180, skipIfRunning: [], maxItemsPerRun: 500,
            schedule: { kind: 'weekly', time: '02:00', weekday: 0, day: 1 },
          },
          purge: { enabled: false, afterDays: 7 },
        })
      `);

      const previewRun = await win.webContents.executeJavaScript(
        `window.cleandrive.runAutoClean({ dryRun: true })`
      );
      check('a preview run reports through IPC', previewRun.ok === true, previewRun.error || '');
      check('the preview finds the stale files',
        previewRun.ok && previewRun.data.run.selected.files === 5,
        previewRun.ok ? String(previewRun.data.run.selected.files) : '');
      check('the preview deleted nothing',
        fs.readdirSync(autoDir).length === 5, `${fs.readdirSync(autoDir).length} files left`);

      // Render the result the way the UI does, and read it back.
      const rendered = await win.webContents.executeJavaScript(`
        (() => {
          renderRunResult(${JSON.stringify(previewRun.ok ? previewRun.data.run : null)});
          return {
            shown: document.getElementById('auto-result').hidden === false,
            lines: document.querySelectorAll('#auto-result-body .result-line').length,
            text: document.getElementById('auto-result-body').textContent,
          };
        })()
      `);
      check('the result card renders', rendered.shown && rendered.lines >= 3, `${rendered.lines} lines`);
      check('a report-only result never claims anything was deleted',
        !/Moved to Recycle Bin/.test(rendered.text));
    } finally {
      fs.rmSync(path.dirname(autoDir), { recursive: true, force: true });
    }

    /* -- a run that finished in another process ---------------------------- */
    // The regression this guards: the 02:00 scheduled run fired correctly,
    // logged its result and exited, while the window that happened to be open
    // went on displaying the previous evening's figures. The feature worked and
    // the screen said it had not.
    console.log('\nBackground run reaches an open window:');

    {
      const logFile = path.join(userData, 'autoclean-log.json');
      const before = await win.webContents.executeJavaScript(`({
        last: document.getElementById('astat-last').textContent,
        rows: document.querySelectorAll('#auto-history .file-row').length,
      })`);

      const existing = fs.existsSync(logFile)
        ? JSON.parse(fs.readFileSync(logFile, 'utf8'))
        : { version: 1, runs: [] };

      // Two hours back, mirroring the real case: a 02:00 run noticed at 04:00.
      // Not `Date.now()` -- the tile renders to the minute, so a run in the same
      // minute as the previous one produces an identical string and the test
      // cannot tell "did not refresh" from "refreshed to the same text".
      const at = Date.now() - 2 * 60 * 60 * 1000;
      existing.runs.unshift({
        runId: 'smoke-background', startedAt: at, finishedAt: at, dryRun: true,
        outcome: 'dry-run', reason: 'Would move 7 file(s) to the Recycle Bin',
        roots: [], manual: false,
        scanned: { files: 99, bytes: 1024, errors: 0 },
        selected: { files: 7, bytes: 7168, truncated: false },
        trashed: { files: 0, bytes: 0, failed: 0 },
        purged: { files: 0, bytes: 0 },
        skipped: {}, notes: [],
      });

      // Written the way the scheduled run writes it: a temp file renamed into
      // place. A watch on the target path alone would stop firing here.
      fs.writeFileSync(`${logFile}.tmp`, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
      fs.renameSync(`${logFile}.tmp`, logFile);

      await until(win,
        `document.getElementById('astat-last').textContent !== ${JSON.stringify(before.last)}`,
        15000);

      /*
       * Wait for the toast rather than reading whatever is on screen.
       *
       * The tile updates part way through the refresh and the toast is raised
       * at the end of it, after the disk, purge and monitor queries -- about a
       * second later now that the settings read also asks Task Scheduler what
       * it holds. Reading immediately caught the *previous* toast, still
       * visible from the manual run a few checks earlier, and reported it as a
       * failure. Its own timeout is the assertion.
       */
      const toastText = `(document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent)`;
      await until(win, `/Scheduled report finished/.test(${toastText})`, 20000).catch(() => {});

      const after = await win.webContents.executeJavaScript(`({
        last: document.getElementById('astat-last').textContent,
        rows: document.querySelectorAll('#auto-history .file-row').length,
        result: document.getElementById('auto-result-body').textContent,
        toast: ${toastText},
      })`);

      console.log(`    "${before.last}" -> "${after.last}"`);
      check('an open window notices a run that finished elsewhere',
        after.last !== before.last, `${before.last} / ${after.last}`);
      check('the run appears in the recent list', after.rows > before.rows,
        `${before.rows} -> ${after.rows}`);
      check('and in the result card', /7/.test(after.result));
      check('the user is told, since they were not watching that tab',
        /Scheduled report finished/.test(after.toast), after.toast.slice(0, 60));
    }

    /* -- trends ----------------------------------------------------------- */
    // The scan above recorded a snapshot, so there is at least one point.
    console.log('\nTrends:');

    // Clicking the tab kicks off an async refresh; awaiting the same call the
    // click handler makes is what guarantees the DOM read below sees its result
    // rather than whatever was rendered when the window first opened.
    await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="trends"]').click()`);
    await win.webContents.executeJavaScript(`refreshTrends()`);

    const trendUi = await win.webContents.executeJavaScript(`({
      panelVisible: document.getElementById('panel-trends').classList.contains('is-active'),
      samples: document.getElementById('trend-samples').textContent,
      used: document.getElementById('tstat-used').textContent,
      growth: document.getElementById('tstat-growth').textContent,
      growthTitle: document.getElementById('tstat-growth').title,
      full: document.getElementById('tstat-full').textContent,
      fullTitle: document.getElementById('tstat-full').title,
      freed: document.getElementById('tstat-freed').textContent,
      freedTitle: document.getElementById('tstat-freed').title,
      hasSvg: document.querySelectorAll('#trend-chart svg').length,
      emptyNote: (document.querySelector('#trend-chart .chart-empty') || {}).textContent || '',
      volumes: document.getElementById('trend-volume').children.length,
      savingsRows: document.querySelectorAll('#trend-savings .pair-row').length,
    })`);

    console.log(`    ${trendUi.samples} · in use ${trendUi.used} · growth "${trendUi.growth}" · full "${trendUi.full}"`);
    check('the Trends panel opens', trendUi.panelVisible);
    check('at least one measurement was recorded by the scan',
      /[1-9]/.test(trendUi.samples), trendUi.samples);
    check('current usage is a real percentage', /%/.test(trendUi.used), trendUi.used);
    check('a volume is listed', trendUi.volumes >= 1, String(trendUi.volumes));

    // The whole point of this feature: with one or two data points it must
    // refuse to report a trend rather than draw a line through nothing.
    check('with almost no history, growth is not asserted',
      trendUi.growth === 'not yet' || /\/month/.test(trendUi.growth), trendUi.growth);
    if (trendUi.growth === 'not yet') {
      check('and the refusal explains itself', trendUi.growthTitle.length > 10, trendUi.growthTitle);
      check('no disk-full date is invented',
        trendUi.full === 'unknown' || trendUi.full === 'not soon', trendUi.full);
      check('and that refusal explains itself too', trendUi.fullTitle.length > 10, trendUi.fullTitle);
      check('the chart says why it is empty rather than drawing nothing',
        trendUi.hasSvg === 0 && trendUi.emptyNote.length > 10, trendUi.emptyNote.slice(0, 50));
    }

    check('moved and freed are described as different things',
      /Recycle Bin/.test(trendUi.freedTitle) && /genuinely free/.test(trendUi.freedTitle),
      trendUi.freedTitle.slice(0, 70));
    check('the savings table has a header row', trendUi.savingsRows >= 1, String(trendUi.savingsRows));

    // Feed it a real series through the same render path the IPC result uses.
    const plotted = await win.webContents.executeJavaScript(`
      (() => {
        const DAY = 86400000, GB = 1024 ** 3, now = Date.now();
        const series = [];
        // Climbs from 80% to about 87.6%, so the 85% warning guide falls inside
        // the plotted range and must be drawn.
        for (let i = 19; i >= 0; i--) {
          const used = (400 + (19 - i) * 2) * GB;
          series.push({ at: now - i * DAY, totalBytes: 500 * GB, usedBytes: used,
            freeBytes: 500 * GB - used, usedPercent: (used / (500 * GB)) * 100 });
        }
        renderChart(document.getElementById('trend-chart'), series, { warn: 85, critical: 95 });
        const svg = document.querySelector('#trend-chart svg');
        return {
          svgs: document.querySelectorAll('#trend-chart svg').length,
          line: (svg.querySelector('.chart-line') || {}).getAttribute
            ? svg.querySelector('.chart-line').getAttribute('points').split(' ').length : 0,
          area: svg.querySelectorAll('.chart-area').length,
          grid: svg.querySelectorAll('.chart-grid').length,
          warnLine: svg.querySelectorAll('.chart-threshold-warn').length,
          labels: svg.querySelectorAll('.chart-label').length,
        };
      })()
    `);
    console.log(`    plotted 20 points: ${plotted.line} vertices, ${plotted.grid} gridlines, ${plotted.labels} labels`);
    check('a real series draws an SVG chart', plotted.svgs === 1);
    check('every point becomes a vertex', plotted.line === 20, String(plotted.line));
    check('the area under the line is filled', plotted.area === 1);
    check('the axis is labelled', plotted.labels >= 6, String(plotted.labels));
    check('the warning threshold is drawn when it falls inside the plotted range',
      plotted.warnLine === 1, String(plotted.warnLine));

    // The complement: a guide outside the plotted range must not be drawn at
    // the edge, where it would read as "you are at the threshold".
    const outOfRange = await win.webContents.executeJavaScript(`
      (() => {
        const DAY = 86400000, GB = 1024 ** 3, now = Date.now();
        const series = [];
        for (let i = 9; i >= 0; i--) {
          const used = (100 + (9 - i)) * GB;
          series.push({ at: now - i * DAY, totalBytes: 500 * GB, usedBytes: used,
            freeBytes: 500 * GB - used, usedPercent: (used / (500 * GB)) * 100 });
        }
        renderChart(document.getElementById('trend-chart'), series, { warn: 85, critical: 95 });
        const svg = document.querySelector('#trend-chart svg');
        return svg.querySelectorAll('.chart-threshold-warn, .chart-threshold-critical').length;
      })()
    `);
    check('a threshold far outside the range is left off the chart',
      outOfRange === 0, String(outOfRange));

    /* -- disk monitoring --------------------------------------------------- */
    console.log('\nDisk monitoring:');

    const monitorOff = await win.webContents.executeJavaScript(`
      document.querySelector('.tab[data-tab="auto"]').click();
      window.cleandrive.monitorStatus()
    `);
    check('monitoring reports its status', monitorOff.ok === true, monitorOff.error || '');
    check('and is not running by default', monitorOff.ok && monitorOff.data.running === false);

    const beforeMemory = process.memoryUsage().rss;

    const monitorOn = await win.webContents.executeJavaScript(`
      (async () => {
        const saved = await window.cleandrive.saveSettings({
          autoClean: { enabled: false, dryRun: true, roots: [] },
          purge: { enabled: false, afterDays: 7 },
          monitor: { enabled: true, volumes: [], warnPercent: 85, criticalPercent: 95,
                     intervalSeconds: 15, snoozeMinutes: 30, closeToTray: true },
        });
        const status = await window.cleandrive.monitorCheck();
        return { saved: saved.ok, status };
      })()
    `);
    check('monitoring can be switched on', monitorOn.saved === true);
    check('and starts running', monitorOn.status.ok && monitorOn.status.data.running === true);

    const watched = monitorOn.status.ok ? monitorOn.status.data.volumes : [];
    console.log(`    watching ${watched.length} volume(s): ` +
      watched.map((v) => `${v.root} ${v.usage && v.usage.ok ? v.usage.usedPercent.toFixed(1) + '%' : 'unreadable'}`).join(', '));
    check('a volume is watched even with none configured', watched.length >= 1);
    check('it produces a real reading', watched[0] && watched[0].usage && watched[0].usage.ok === true);

    const snoozeCycle = await win.webContents.executeJavaScript(`
      (async () => {
        const on = await window.cleandrive.monitorSnooze(30);
        const off = await window.cleandrive.monitorResume();
        return { snoozed: on.ok && on.data.snoozed, resumed: off.ok && off.data.snoozed };
      })()
    `);
    check('alerts can be snoozed', snoozeCycle.snoozed === true);
    check('and resumed', snoozeCycle.resumed === false);

    // The strategy document promised "under 100MB in the background" without
    // measuring. Report what it actually costs in this process instead.
    const afterMemory = process.memoryUsage().rss;
    console.log(`    main-process RSS ${(beforeMemory / 1024 / 1024).toFixed(0)} MB -> ` +
      `${(afterMemory / 1024 / 1024).toFixed(0)} MB with monitoring on`);

    const monitorBack = await win.webContents.executeJavaScript(`
      (async () => {
        const saved = await window.cleandrive.saveSettings({
          monitor: { enabled: false }, autoClean: { enabled: false }, purge: { enabled: false },
        });
        const status = await window.cleandrive.monitorStatus();
        return { saved: saved.ok, running: status.ok && status.data.running };
      })()
    `);
    check('switching monitoring off stops it', monitorBack.saved && monitorBack.running === false);

    /* -- appearance -------------------------------------------------------- */
    console.log('\nAppearance:');

    const readTheme = () => win.webContents.executeJavaScript(`({
      attr: document.documentElement.getAttribute('data-theme'),
      scheme: getComputedStyle(document.documentElement).colorScheme,
      pageBg: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
      active: (document.querySelector('[data-theme-choice].is-active') || {}).dataset,
      buttons: document.querySelectorAll('#theme-switch [data-theme-choice]').length,
      hosts: document.querySelectorAll('[data-theme-host]').length,
    })`);

    const initial = await readTheme();
    check('the switch offers three modes', initial.buttons === 3, String(initial.buttons));
    // Two copies of it now: the top bar and the Settings tab. Counting every
    // [data-theme-choice] in the document would have counted six.
    check('and the Settings tab carries a second copy', initial.hosts === 2, String(initial.hosts));
    check('one of them is marked active', Boolean(initial.active), JSON.stringify(initial.active));
    check('following the system means no pinned attribute',
      initial.attr === null && initial.scheme === 'light dark',
      `attr=${initial.attr} scheme=${initial.scheme}`);

    /*
     * Waits for the attribute rather than sleeping on it.
     *
     * The theme is applied inside a View Transition callback now, so it lands a
     * frame after the click rather than synchronously -- and on a window that is
     * not on screen, "a frame" can be most of a second. A fixed 120ms sleep read
     * the old theme and reported the palette as not inverting.
     */
    const click = async (mode) => {
      await win.webContents.executeJavaScript(
        `document.querySelector('#theme-switch [data-theme-choice="${mode}"]').click()`
      );
      // "system" is the *absence* of the attribute -- there is no such value for
      // `color-scheme`, which is why the app removes it rather than writing it.
      const settled =
        mode === 'system'
          ? `document.documentElement.getAttribute('data-theme') === null`
          : `document.documentElement.getAttribute('data-theme') === '${mode}'`;
      await until(win, settled, 15000);
      // Let the sweep finish, so the snapshot overlay is not what gets measured.
      await wait(700);
    };

    await click('light');
    const light = await readTheme();
    console.log(`    light: bg ${light.pageBg}, text ${light.text}`);
    check('choosing light pins the scheme',
      light.attr === 'light' && light.scheme === 'light', `${light.attr}/${light.scheme}`);

    await click('dark');
    const dark = await readTheme();
    console.log(`    dark:  bg ${dark.pageBg}, text ${dark.text}`);
    check('choosing dark pins the scheme',
      dark.attr === 'dark' && dark.scheme === 'dark', `${dark.attr}/${dark.scheme}`);

    // The real assertion: the tokens actually re-resolved. light-dark() failing
    // silently would leave both themes identical and every check above green.
    check('the palette genuinely inverts', light.pageBg !== dark.pageBg,
      `${light.pageBg} vs ${dark.pageBg}`);
    check('text colour inverts with it', light.text !== dark.text,
      `${light.text} vs ${dark.text}`);

    const rgb = (value) => (value.match(/\d+/g) || []).map(Number);
    const luminance = (value) => {
      const [r, g, b] = rgb(value);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    check('the light page is actually light and the dark one dark',
      luminance(light.pageBg) > 200 && luminance(dark.pageBg) < 40,
      `${luminance(light.pageBg).toFixed(0)} vs ${luminance(dark.pageBg).toFixed(0)}`);
    check('each theme keeps text contrasting against its own background',
      Math.abs(luminance(light.text) - luminance(light.pageBg)) > 120 &&
        Math.abs(luminance(dark.text) - luminance(dark.pageBg)) > 120);

    const persisted = await win.webContents.executeJavaScript(`window.cleandrive.getSettings()`);
    check('the choice is saved', persisted.ok && persisted.data.settings.appearance.theme === 'dark',
      persisted.ok ? persisted.data.settings.appearance.theme : '');

    // Saving the cleanup form must not take the theme with it -- the form does
    // not carry an appearance section at all.
    const afterFormSave = await win.webContents.executeJavaScript(`
      (async () => {
        await window.cleandrive.saveSettings({ autoClean: { minAgeDays: 120 } });
        const s = await window.cleandrive.getSettings();
        return { theme: s.data.settings.appearance.theme, age: s.data.settings.autoClean.minAgeDays };
      })()
    `);
    check('saving the settings form leaves the theme alone',
      afterFormSave.theme === 'dark', afterFormSave.theme);
    check('and still applies the form change', afterFormSave.age === 120, String(afterFormSave.age));

    await click('system');

    /* -- updates ----------------------------------------------------------- */
    console.log('\nUpdates:');

    await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="auto"]').click()`);

    const updateUi = await win.webContents.executeJavaScript(`
      (async () => {
        applyUpdateState((await window.cleandrive.updateState()).data);
        return {
          badge: document.getElementById('update-badge').textContent,
          detail: document.getElementById('update-detail').textContent,
          enabled: document.getElementById('update-enabled').checked,
          pillHidden: document.getElementById('update-pill').hidden,
          checkDisabled: document.getElementById('update-check').disabled,
          downloadHidden: document.getElementById('update-download').hidden,
          installHidden: document.getElementById('update-install').hidden,
        };
      })()
    `);

    console.log(`    "${updateUi.badge}" — ${updateUi.detail.slice(0, 70)}…`);
    check('update checks are on by default', updateUi.enabled === true);
    check('a development build reports "not applicable", not an error',
      updateUi.badge === 'Not applicable', updateUi.badge);
    check('and explains why rather than showing a bare dash',
      /running from source|no release feed/i.test(updateUi.detail), updateUi.detail.slice(0, 60));
    check('the top-bar pill stays hidden when there is nothing to act on',
      updateUi.pillHidden === true);
    check('no download or install button is offered',
      updateUi.downloadHidden && updateUi.installHidden);
    check('and "check now" is disabled where a check cannot happen',
      updateUi.checkDisabled === true);

    // The setting is the one thing that matters here: switching it off must
    // mean the app makes no network requests at all.
    const updateToggle = await win.webContents.executeJavaScript(`
      (async () => {
        const off = await window.cleandrive.saveSettings({ updates: { enabled: false } });
        const back = await window.cleandrive.getSettings();
        return { saved: off.ok, enabled: back.data.settings.updates.enabled };
      })()
    `);
    check('update checks can be switched off', updateToggle.saved && updateToggle.enabled === false);

    const updateRestore = await win.webContents.executeJavaScript(`
      (async () => {
        await window.cleandrive.saveSettings({ updates: { enabled: true } });
        const s = await window.cleandrive.getSettings();
        return s.data.settings.updates.enabled;
      })()
    `);
    check('and back on', updateRestore === true);

    check('the real settings file was never written to',
      !fs.existsSync(path.join(PRODUCTION_USER_DATA, 'settings.json')) ||
        !fs.readFileSync(path.join(PRODUCTION_USER_DATA, 'settings.json'), 'utf8').includes('cleandrive-smoke-auto'),
      'the harness\'s configuration must not appear in the real file');

    /* -- console cleanliness --------------------------------------------- */
    console.log('\nConsole:');
    check('no renderer errors', rendererErrors.length === 0, rendererErrors.join(' | '));
  } catch (err) {
    failures++;
    console.error('\nSMOKE TEST THREW:', err);
  } finally {
    // Unconditional, and now merely tidy rather than load-bearing: the tester's
    // data was never in reach, so a failure here costs a temp directory.
    // Chromium is still holding its own caches open in this directory at this
    // point, so the removal often cannot finish -- which is a note, not an
    // error, and the OS clears temp anyway.
    try {
      fs.rmSync(SANDBOX_USER_DATA, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${SANDBOX_USER_DATA})`);
    }

    // The suffixed tasks, if the settings section registered any.
    try {
      const { uninstall, cleanupTaskPath, sampleTaskPath } = require('../src/main/lib/scheduler');
      await uninstall(cleanupTaskPath());
      await uninstall(sampleTaskPath());
    } catch (err) {
      console.error('could not remove the smoke test\'s Windows tasks:', err.message);
    }
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
});
