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
// The delete-progress check below really deletes forty throwaway files, and a
// native confirmation would stop it dead. The window cannot skip that dialog
// on its own -- only this process can allow it.
ipc.allowUnconfirmedForHarness();

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

// The viewer's scheme has to be privileged before the app is ready, exactly as
// in main.js -- registering it afterwards is silently ignored, and the smoke
// run would then check a viewer that could not load anything.
require('../src/main/lib/preview/serve').registerScheme();

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
  require('../src/main/lib/preview/serve').serve();
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

    // The scan left a snapshot of its tree -- inside this harness's sandbox,
    // never in the real %LOCALAPPDATA%.
    {
      const { services } = require('../src/main/services');
      const snapshotRoots = await services().snapshots.roots();
      check('the scan kept a snapshot of the folder tree', snapshotRoots.length >= 1, snapshotRoots.join(', '));
      check('and kept it inside the sandbox', services().snapshotsDir.startsWith(SANDBOX_USER_DATA),
        services().snapshotsDir);
      const listed = snapshotRoots.length ? await services().snapshots.list(snapshotRoots[0]) : [];
      check('marked complete, with its totals', listed.length >= 1 && listed[0].complete === true && listed[0].totals.files > 0,
        listed[0] ? `${listed[0].totals.files} files, ${listed[0].bytesOnDisk} bytes on disk` : '');
      const reply = await win.webContents.executeJavaScript(`
        window.cleandrive.scan(${JSON.stringify(picked.path)}).then((r) => ({
          ok: r.ok,
          hasTree: Boolean(r.data && ('tree' in r.data || 'treeFiles' in r.data)),
          treeId: r.data ? r.data.treeId : null,
          candidates: r.data && Array.isArray(r.data.candidates) ? r.data.candidates.length : -1,
          everyOneHasEvidence: Boolean(r.data) && r.data.candidates.every((c) => c.evidence.length > 0 && c.confidence),
        }))
      `);
      // The map of the folder reads it a level at a time (scan:children); the
      // "Map of the folder" section below holds every reply to that.
      check('the scan reply carries no tree, only an id to ask for one level of it by',
        reply.ok && reply.hasTree === false && typeof reply.treeId === 'string', String(reply.treeId));
      check('what did reach it is candidates, each with evidence and a confidence',
        reply.candidates > 0 && reply.everyOneHasEvidence, `${reply.candidates} candidates`);
    }

    /* -- an .asar archive is a file ---------------------------------------- */
    // Only reproducible inside Electron, which is why it is here: Electron's
    // `fs` calls an `.asar` a folder, and the scan used to drop every one.
    console.log('\nAn .asar archive, as Electron sees it and as the disk has it:');
    {
      const realFs = require('original-fs');
      const asarRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-smoke-asar-'));
      const asar = path.join(asarRoot, 'resources', 'app.asar');
      // A real archive: a pickled size, a pickled JSON header, then the data.
      const body = Buffer.alloc(50000, 0x61);
      const json = Buffer.from(JSON.stringify({ files: { 'main.js': { size: body.length, offset: '0' } } }));
      const pad = (4 - (json.length % 4)) % 4;
      const header = Buffer.alloc(8 + json.length + pad);
      header.writeUInt32LE(4 + json.length + pad, 0);
      header.writeUInt32LE(json.length, 4);
      json.copy(header, 8);
      const size = Buffer.alloc(8);
      size.writeUInt32LE(4, 0);
      size.writeUInt32LE(header.length, 4);
      realFs.mkdirSync(path.dirname(asar), { recursive: true });
      realFs.writeFileSync(asar, Buffer.concat([size, header, body]));
      const bytes = realFs.statSync(asar).size;

      check('the fixture reproduces it: Electron\'s own fs calls the archive a folder',
        fs.lstatSync(asar).isDirectory() === true && realFs.lstatSync(asar).isFile() === true);
      const { scan } = require('../src/main/lib/scanner');
      const scanned = await scan(asarRoot, {}, {});
      check('the scan counts it as one file, at its real size', scanned.totalFiles === 1 && scanned.totalSize === bytes,
        `${scanned.totalFiles} files, ${scanned.totalSize} of ${bytes} bytes`);
      const { measureTree } = require('../src/main/system/walk');
      const walked = await measureTree(asarRoot);
      check('and the system walk adds up real allocation, not NaN',
        walked.buckets.all && walked.buckets.all.logical === bytes && Number.isFinite(walked.buckets.all.allocated) &&
          walked.buckets.all.allocated >= bytes, walked.buckets.all ? JSON.stringify(walked.buckets.all) : 'nothing');
      // Electron keeps the archive open once its own fs has looked inside it,
      // so it may refuse to go until this process exits.
      try {
        realFs.rmSync(asarRoot, { recursive: true, force: true });
      } catch {
        /* a 50 KB file left in %TEMP% */
      }
    }

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

    /* -- the shared components -------------------------------------------- */
    console.log('\nShared components:');

    const components = await win.webContents.executeJavaScript(`
      (async () => {
        const out = {};
        const bar = document.getElementById('cleanup-actionbar');
        out.barShownWithSelection = bar.hidden === false;
        out.frees = (bar.querySelector('.frees-badge') || {}).textContent || '';
        out.readout = document.getElementById('cleanup-selection').textContent;
        document.getElementById('cleanup-select-none').click();
        out.barHiddenWhenEmpty = bar.hidden === true;

        const pill = document.querySelector('#cleanup-groups .file-row .badge-button');
        out.pillText = pill ? pill.textContent : '';
        if (pill) pill.click();
        const panel = document.querySelector('#cleanup-groups .evidence-row');
        out.evidenceShown = Boolean(panel);
        out.evidenceHead = panel ? panel.querySelector('.evidence-head').textContent : '';
        out.evidenceItems = panel ? panel.querySelectorAll('li').length : 0;
        if (pill) document.querySelector('#cleanup-groups .file-row .badge-button').click();
        out.evidenceClosed = !document.querySelector('#cleanup-groups .evidence-row');

        // Shift-click: tick the first box, shift-tick the third, expect three.
        const group = [...document.querySelectorAll('#cleanup-groups .group')].find((g) => g.querySelectorAll('.file-row').length >= 3);
        if (group) {
          const boxes = group.querySelectorAll('.file-row input[type="checkbox"]');
          boxes[0].click();
          boxes[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
          boxes[2].checked = true;
          out.rangeChecked = group.querySelectorAll('.file-row input:checked').length;
          out.rangeReadout = document.getElementById('cleanup-selection').textContent;
        } else {
          out.rangeChecked = -1;
        }
        document.getElementById('cleanup-select-none').click();

        const rows = document.querySelectorAll('#cleanup-groups .file-row');
        out.aria = rows.length > 0 && [...rows].every((r) => r.getAttribute('aria-posinset') && r.getAttribute('aria-setsize'));

        // The keyboard: Space on a row ticks it once, an arrow moves to the next.
        const firstRow = rows[0];
        firstRow.focus();
        firstRow.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        out.spaceTicked = firstRow.querySelector('input').checked;
        firstRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        out.focusMoved = document.activeElement !== firstRow && document.activeElement.classList.contains('file-row');
        document.getElementById('cleanup-select-none').click();

        // A list long enough to be windowed, drawn into the real page.
        const host = document.createElement('ul');
        host.className = 'files';
        document.getElementById('panel-cleanup').appendChild(host);
        const many = Array.from({ length: 5000 }, (_, i) => ({
          id: 'x' + i, path: 'C:\\\\fixture\\\\file-' + i + '.bin', size: i, verdict: 'keep', confidence: 'certain',
          evidence: [{ rank: 1, i18n: 'evidence.noRule', en: 'No rule' }], actions: ['recycle'], mtimeMs: Date.now(),
        }));
        const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const long = CandidateList(host, { rows: many, selection: new Set(), onChange: () => {} });
        await frames();
        // Off screen, it draws nothing: that is the point of it.
        out.offscreenRows = host.querySelectorAll('.file-row').length;
        host.scrollIntoView({ block: 'start' });
        await frames();
        await frames();
        out.windowedRows = host.querySelectorAll('.file-row').length;
        out.windowedSize = host.querySelector('.file-row') ? host.querySelector('.file-row').getAttribute('aria-setsize') : '';
        const scroller = document.querySelector('main');
        scroller.scrollTop += 40000;
        await frames();
        await frames();
        const first = host.querySelector('.file-row');
        out.laterIndex = first ? Number(first.dataset.index) : -1;
        out.laterRows = host.querySelectorAll('.file-row').length;
        host.remove();
        scroller.scrollTop = 0;

        await loadEntitlements();
        out.noUpsellWhenAllowed = UpgradeHint('pro.diff', 'x') === null;
        out.refusal = RefusalNote({ i18n: 'none', en: 'Only one scan so far.' }).textContent;
        return out;
      })()
    `);
    check('the action bar floats in only when something is selected',
      components.barShownWithSelection && components.barHiddenWhenEmpty);
    check('it says how much is selected', /selected/.test(components.readout), components.readout);
    check('and that moving to the bin frees nothing', /Not freed until the bin is emptied/.test(components.frees),
      components.frees);
    check('each row carries how sure the app is', /certain|strong evidence|likely|a guess/.test(components.pillText),
      components.pillText);
    check('clicking it opens the reasons, strongest first', components.evidenceShown && components.evidenceItems >= 1 &&
      /^Why/.test(components.evidenceHead), `${components.evidenceHead} (${components.evidenceItems})`);
    check('and clicking again closes them', components.evidenceClosed);
    check('shift-click takes everything in between', components.rangeChecked === 3 || components.rangeChecked === -1,
      components.rangeChecked === -1 ? 'no group with three rows' : `${components.rangeChecked} checked · ${components.rangeReadout}`);
    check('rows say where they are in the list, for a screen reader', components.aria);
    check('Space on a row ticks it', components.spaceTicked);
    check('and an arrow key moves to the next row', components.focusMoved);
    check('a list of 5,000 rows puts only the visible ones in the page',
      components.windowedRows > 0 && components.windowedRows < 200 && components.windowedSize === '5000',
      `${components.windowedRows} rows drawn, ${components.offscreenRows} while off screen`);
    check('and draws later ones as it is scrolled through',
      components.laterIndex > 300 && components.laterRows > 0 && components.laterRows < 200,
      `first drawn row is #${components.laterIndex}, ${components.laterRows} rows`);
    check('no upgrade hint appears where the feature is allowed', components.noUpsellWhenAllowed);
    check('a refusal is a sentence, not a number', components.refusal === 'Only one scan so far.');

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
      segments: document.querySelectorAll('.ov-seg').length,
      segShares: [...document.querySelectorAll('.ov-seg')].map((e) => e.style.flex),
      legend: document.querySelectorAll('.ov-key').length,
      chips: document.querySelectorAll('.chip').length,
      chipMeta: [...document.querySelectorAll('.chip .chip-meta')].map((e) => e.textContent),
      traitsAvailable: new Set(media.files.flatMap((f) => f.traits.map((t) => t.key))).size,
      barPinned: getComputedStyle(document.getElementById('media-bar')).position,
      overviewPinned: getComputedStyle(document.getElementById('media-overview')).position,
      gridScrolls: getComputedStyle(document.getElementById('media-grid')).overflowY,
      origins: [...new Set(media.files.map((f) => f.origin))].sort(),
      selected: media.selected.size,
      deleteHidden: document.getElementById('media-delete').hidden,
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

    /* -- the layout the first version got wrong ------------------------- */
    //
    // It put all three filter axes into the pinned bar as thirty-three chips,
    // which took four hundred pixels that could never scroll away and left the
    // pictures a slot. Each of these is now a shape the layout enforces rather
    // than a judgement somebody has to keep making.

    // Where a picture came from is a partition, so it is one proportional bar
    // rather than a chip each -- and the segments carry the shares.
    check('the origins are one proportional bar', mediaUi.segments === mediaUi.origins.length,
      `${mediaUi.segments} segments for ${mediaUi.origins.length} origins`);
    check('and every segment is sized by its share',
      mediaUi.segShares.length > 0 && mediaUi.segShares.every((f) => /^[0-9.]+ /.test(f)),
      mediaUi.segShares.slice(0, 3).join(' | '));
    check('with a legend you can click instead', mediaUi.legend === mediaUi.segments);

    // Only actions are pinned. Anything describing the library scrolls with it.
    check('only the action bar is pinned', mediaUi.barPinned === 'sticky', mediaUi.barPinned);
    check('the overview scrolls away with the results', mediaUi.overviewPinned === 'static',
      mediaUi.overviewPinned);
    // Two nested scrollbars was the other half of the problem.
    check('the grid has no scrollbar of its own', mediaUi.gridScrolls === 'visible', mediaUi.gridScrolls);

    // A filter that matches almost everything divides nothing. The first
    // version's widest chip read "Synced to the cloud, 4,032 of 4,062".
    check('the trait chips are a shortlist, not everything',
      mediaUi.chips <= mediaUi.traitsAvailable,
      `${mediaUi.chips} shown of ${mediaUi.traitsAvailable} traits present`);
    check('every chip says how much it holds',
      mediaUi.chips > 0 && mediaUi.chipMeta.every((text) => /·/.test(text)),
      mediaUi.chipMeta.slice(0, 3).join(' | '));

    // The rule this whole screen is built around.
    check('nothing is selected for the user', mediaUi.selected === 0);
    check('and there is no delete button until they choose', mediaUi.deleteHidden === true);

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

    const mediaFiltered = await win.webContents.executeJavaScript(`(() => {
      const before = media.shown.length;
      document.querySelector('.chip').click();
      const after = media.shown.length;
      const activeText = document.querySelector('.chip.is-active .chip-name').textContent;
      const tokens = document.querySelectorAll('#media-tokens .token').length;
      document.querySelector('.chip.is-active').click();
      return { before, after, restored: media.shown.length, activeText, tokens,
               tokensAfter: document.querySelectorAll('#media-tokens .token').length };
    })()`);
    check('a chip filters the grid', mediaFiltered.after < mediaFiltered.before,
      `${mediaFiltered.before} -> ${mediaFiltered.after} (${mediaFiltered.activeText})`);
    check('and clicking it again restores everything', mediaFiltered.restored === mediaFiltered.before);
    // The overview scrolls away, so what is being looked at has to stay in the
    // part that does not -- otherwise a filtered grid three screens down looks
    // exactly like the whole library.
    check('an active filter shows as a token in the pinned bar', mediaFiltered.tokens === 1,
      `${mediaFiltered.tokens} tokens`);
    check('and the token goes when the filter does', mediaFiltered.tokensAfter === 0);

    // Clicking a segment of the origin bar is the same act as clicking a chip.
    const mediaBar = await win.webContents.executeJavaScript(`(() => {
      const before = media.shown.length;
      document.querySelector('.ov-seg').click();
      const after = media.shown.length;
      const active = document.querySelectorAll('.ov-seg.is-active').length;
      document.querySelector('.ov-seg.is-active').click();
      return { before, after, active, restored: media.shown.length };
    })()`);
    check('a segment of the bar filters too', mediaBar.after < mediaBar.before,
      `${mediaBar.before} -> ${mediaBar.after}`);
    check('exactly one segment reads as chosen', mediaBar.active === 1);
    check('and it releases when clicked again', mediaBar.restored === mediaBar.before);

    /* -- choosing several ------------------------------------------------- */
    //
    // The tick was a decoration: drawn on hover because it looked right,
    // `aria-hidden`, no handler of its own. It looked like a checkbox, people
    // clicked it like one, and the click fell through to the cell -- whose
    // plain-click behaviour is "clear the selection and take only this". Three
    // ticks left one picture selected, which is how the bug was reported.
    const mediaTicks = await win.webContents.executeJavaScript(`(() => {
      media.selected.clear();
      const ticks = [...document.querySelectorAll('.media-cell .media-tick')];
      ticks[0].click();
      const afterFirst = media.selected.size;
      ticks[1].click();
      ticks[2].click();
      const afterThree = media.selected.size;
      const choosing = document.getElementById('media-grid').classList.contains('is-choosing');
      ticks[1].click();
      return { afterFirst, afterThree, afterUntick: media.selected.size, choosing,
               isButton: ticks[0].tagName === 'BUTTON' };
    })()`);
    check('the tick is a real button, not a decoration', mediaTicks.isButton === true);
    check('ticking one picture chooses one', mediaTicks.afterFirst === 1, String(mediaTicks.afterFirst));
    check('ticking three chooses three, not the last one',
      mediaTicks.afterThree === 3, `${mediaTicks.afterThree} chosen`);
    check('and ticking one again lets it go', mediaTicks.afterUntick === 2, String(mediaTicks.afterUntick));
    // Once anything is chosen, every tick is on screen -- otherwise the way to
    // add the second picture only exists under the pointer.
    check('the grid shows its ticks once choosing has started', mediaTicks.choosing === true);

    // Shift on a tick takes the whole run, which is what makes forty pictures
    // bearable: tick the first, shift-tick the fortieth.
    const mediaRun = await win.webContents.executeJavaScript(`(() => {
      media.selected.clear();
      media.anchor = null;
      const ticks = [...document.querySelectorAll('.media-cell .media-tick')];
      ticks[0].click();
      ticks[4].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
      return { chosen: media.selected.size };
    })()`);
    check('shift-ticking takes everything in between', mediaRun.chosen === 5,
      `${mediaRun.chosen} chosen`);

    // And a plain click on the picture is still "show me this one" rather than
    // a fourth way to select, so inspecting never disturbs a selection by
    // accident.
    const mediaPlain = await win.webContents.executeJavaScript(`(() => {
      document.querySelectorAll('.media-cell')[7].click();
      return { chosen: media.selected.size, detail: Boolean(document.querySelector('.detail-name')) };
    })()`);
    check('clicking the picture itself still means "show me this one"',
      mediaPlain.chosen === 1 && mediaPlain.detail === true,
      `${mediaPlain.chosen} chosen, detail ${mediaPlain.detail}`);

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

    /* -- the file viewer ---------------------------------------------------- */
    //
    // The viewer is the answer to "what is in this thing", asked from a list
    // that is about to delete it. So the checks here are about honesty: it
    // shows what it can, and where it cannot it says so rather than showing
    // bytes dressed up as content.
    console.log('\nFile viewer:');

    const serve = require('../src/main/lib/preview/serve');
    const viewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-smoke-view-'));
    const aFile = (name, body) => {
      const full = path.join(viewDir, name);
      fs.writeFileSync(full, body);
      return full;
    };
    const textFile = aFile('notes.txt', 'dòng một\ndòng hai\ndòng ba\n');
    const emptyFile = aFile('nothing.txt', '');
    const binFile = aFile('thing.bin', Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x7f, 0x00, 0x03]));
    const imageFile = fs.readdirSync(path.join(mediaRoot, 'Camera Roll'))
      .map((n) => path.join(mediaRoot, 'Camera Roll', n))
      .find((p) => /\.(jpg|jpeg|png)$/i.test(p));

    const open = async (target) => {
      await win.webContents.executeJavaScript(`openViewer(${JSON.stringify(target)})`);
      await wait(400);
      return win.webContents.executeJavaScript(`(() => {
        const body = document.getElementById('viewer-body');
        const img = body.querySelector('.viewer-image');
        return {
          open: document.getElementById('viewer').hidden === false,
          kind: (body.className.match(/is-([a-z-]+)/) || [])[1],
          facts: document.getElementById('viewer-facts').textContent,
          name: document.getElementById('viewer-name').textContent,
          text: (body.querySelector('.viewer-text') || {}).textContent || '',
          src: img ? img.getAttribute('src') : '',
          note: (body.querySelector('.viewer-note') || {}).textContent || '',
        };
      })()`);
    };

    const vText = await open(textFile);
    check('the viewer opens over the page', vText.open === true);
    check('a text file is shown as its own characters', vText.kind === 'text',
      String(vText.kind));
    check('and the accents survive the round trip', vText.text.includes('dòng một'),
      JSON.stringify(vText.text.slice(0, 24)));
    check('the head names the file', vText.name.includes('notes.txt'), vText.name);
    check('and states what it is, not just that it opened', /\d/.test(vText.facts), vText.facts);

    const vEmpty = await open(emptyFile);
    check('an empty file says it is empty rather than showing a blank page',
      vEmpty.kind === 'empty' && vEmpty.note.length > 0, String(vEmpty.kind));

    const vBin = await open(binFile);
    check('a binary is refused in words', vBin.kind === 'binary' && vBin.note.length > 0,
      String(vBin.kind));
    /*
     * No hex dump, ever.
     *
     * Showing bytes as though they were content is the false confidence this
     * app is written against: it invites somebody to decide a file is
     * disposable because its insides looked like noise.
     */
    check('and not as a wall of bytes', vBin.text === '', JSON.stringify(vBin.text.slice(0, 40)));

    if (imageFile) {
      const vImg = await open(imageFile);
      check('a picture is drawn', vImg.kind === 'image', String(vImg.kind));
      /*
       * The renderer never learns the path.
       *
       * It is handed a one-shot token on the app's own scheme, and the main
       * process is the only side that can turn that back into a file. A bug in
       * the page cannot widen into "read anything on the disk".
       */
      check('over the app scheme, with a token instead of a path',
        vImg.src.startsWith('cleandrive://') && !vImg.src.includes(':\\') &&
        !vImg.src.toLowerCase().includes('camera'), vImg.src.slice(0, 48));

      const token = vImg.src.replace(/^cleandrive:\/\//, '').replace(/\/.*$/, '');
      check('the token resolves while the viewer is open', serve.pathFor(token) === imageFile);

      await win.webContents.executeJavaScript('closeViewer()');
      await wait(200);
      check('and stops resolving the moment it closes', !serve.pathFor(token),
        String(serve.pathFor(token)));
    }

    /* -- Word, Excel, PowerPoint and archives ------------------------------- */
    //
    // Drawn from archives built in this test rather than from whatever Office
    // files happen to be on the machine, because on a machine with none the
    // checks would silently pass by never running. What the readers make of
    // real documents is `test-office.js`'s job; this is about the four views
    // reaching the page with their structure intact.
    const ooxml = require('./ooxml-fixture');
    const wordFile = aFile('bao-cao.docx', ooxml.docxFixture());
    const sheetFile = aFile('so-lieu.xlsx', ooxml.xlsxFixture());
    const deckFile = aFile('trinh-chieu.pptx', ooxml.pptxFixture());
    const zipFile = aFile('goi.zip', ooxml.zipFixture());

    const vWord = await open(wordFile);
    check('a Word document is read, not refused', vWord.kind === 'office', String(vWord.kind));
    const word = await win.webContents.executeJavaScript(`(() => {
      const doc = document.querySelector('.viewer-body .doc');
      const topList = doc.querySelector('ol');
      return {
        headings: [...doc.querySelectorAll('h1')].map((h) => h.textContent),
        bold: [...doc.querySelectorAll('strong')].map((b) => b.textContent),
        items: [...doc.querySelectorAll('li')].length,
        nested: Boolean(topList && topList.querySelector('li ol li')),
        cells: [...doc.querySelectorAll('table td')].map((td) => td.textContent.trim()),
        span: (doc.querySelector('table td[colspan]') || {}).colSpan || 0,
        images: doc.querySelectorAll('img.doc-img').length,
        imageIsData: (doc.querySelector('img.doc-img') || {}).src?.startsWith('data:image/') || false,
        inlineStyles: doc.querySelectorAll('[style]').length,
        scripts: doc.querySelectorAll('script, iframe, object, embed').length,
      };
    })()`);
    check('its heading is a heading', word.headings.join('') === 'Báo cáo tháng', word.headings.join('|'));
    check('the bold run is bold and the plain one is not',
      word.bold.length === 1 && word.bold[0] === 'Đậm', JSON.stringify(word.bold));
    /*
     * A real list, numbered by the browser.
     *
     * The earlier reader computed its own markers, which meant getting every
     * restart rule right from the cases it had met. An `<ol>` inside an `<li>`
     * numbers and restarts correctly by construction, and that is most of why
     * the library won for Word.
     */
    check('the list is a real list with a real sub-list', word.items === 3 && word.nested === true,
      `${word.items} items, nested ${word.nested}`);
    check('the table keeps its merged cell', word.span === 2, String(word.span));
    check('and all of its cells', word.cells.join('|') === 'Gộp hai cột|trái|phải', word.cells.join('|'));
    check('a picture inside the document is drawn', word.images === 1 && word.imageIsData === true,
      `${word.images} images, data URI ${word.imageIsData}`);
    /*
     * The document is rebuilt from an allowlist, never assigned as innerHTML.
     *
     * The reader hands back HTML, and these are files the user did not write.
     * Two things are checked here because both would be invisible otherwise: no
     * element carries a `style` attribute, which the page's `style-src 'self'`
     * policy would block anyway and which therefore would silently lose its
     * layout in the shipped app; and nothing that could execute or embed got
     * through the rebuild at all.
     */
    check('nothing reached the page as an inline style', word.inlineStyles === 0,
      String(word.inlineStyles));
    check('and nothing that could run or embed came with it', word.scripts === 0,
      String(word.scripts));

    const vSheet = await open(sheetFile);
    check('a workbook is read', vSheet.kind === 'office', String(vSheet.kind));
    const sheet = await win.webContents.executeJavaScript(`(() => {
      const body = document.getElementById('viewer-body');
      return {
        tabs: [...body.querySelectorAll('.sheet-tab')].map((t) => t.textContent),
        hiddenTab: body.querySelectorAll('.sheet-tab.is-hidden-sheet').length,
        columns: [...body.querySelectorAll('.sheet-col')].map((c) => c.textContent),
        rows: [...body.querySelectorAll('.sheet-row')].map((r) => r.textContent),
        date: (body.querySelector('td.is-date') || {}).textContent || '',
        number: (body.querySelector('td.is-number') || {}).textContent || '',
        bool: (body.querySelector('td.is-bool') || {}).textContent || '',
        error: (body.querySelector('td.is-error') || {}).textContent || '',
      };
    })()`);
    // The tab order is the workbook's, and `sheet2.xml` being the first tab is
    // ordinary; reading the archive instead would put them the other way round.
    check('the sheet tabs are in the workbook\'s order', sheet.tabs.join(',') === 'Tháng 6,Nháp',
      sheet.tabs.join(','));
    check('a sheet hidden in Excel is shown and marked', sheet.hiddenTab === 1);
    check('the lettered strip is drawn', sheet.columns.join('') === 'AB', sheet.columns.join(''));
    check('and the row numbers are the sheet\'s own, gaps and all',
      sheet.rows.join(',') === '1,2,4', sheet.rows.join(','));
    /*
     * The one that matters most on this screen: a date in a spreadsheet is
     * stored as the number 45658, and only a formatting rule in another part of
     * the archive makes it a date. Getting this wrong shows a column of
     * five-digit numbers where the invoice dates should be.
     */
    check('a date is shown as a date, not as the number it is stored as',
      /2025/.test(sheet.date) && !sheet.date.includes('45658'), sheet.date);
    check('a number carries its thousands separators', /1.250.000|1,250,000/.test(sheet.number),
      sheet.number);
    check('a boolean and an error are said in words',
      sheet.bool.length > 0 && sheet.error === '#N/A', `${sheet.bool} / ${sheet.error}`);

    const vDeck = await open(deckFile);
    check('a presentation is read', vDeck.kind === 'office', String(vDeck.kind));
    const deck = await win.webContents.executeJavaScript(`(() => {
      const body = document.getElementById('viewer-body');
      return {
        titles: [...body.querySelectorAll('.slide-title')].map((t) => t.textContent),
        numbers: [...body.querySelectorAll('.slide-n')].map((n) => n.textContent),
        body: [...body.querySelectorAll('.slide-p')].map((p) => p.textContent),
        notes: [...body.querySelectorAll('.slide-notes p')].map((p) => p.textContent),
      };
    })()`);
    // `slide10.xml` sorts before `slide2.xml` as a string, and slides keep
    // their file name when reordered, so only the presentation knows the order.
    check('the slides are in the deck\'s order, not the file names\'',
      deck.titles.join(',') === 'Mở đầu,Kết luận', deck.titles.join(','));
    check('each slide is numbered', deck.numbers.join(',') === '1,2', deck.numbers.join(','));
    check('the body text is there, once', deck.body.join('|') === 'điểm một|điểm hai',
      deck.body.join('|'));
    check('speaker notes are shown', deck.notes.join('') === 'nhớ nói chậm', deck.notes.join('|'));

    const vZip = await open(zipFile);
    check('an archive is listed rather than refused', vZip.kind === 'archive', String(vZip.kind));
    const archive = await win.webContents.executeJavaScript(`(() => {
      const body = document.getElementById('viewer-body');
      return {
        names: [...body.querySelectorAll('.archive-name')].map((n) => n.textContent),
        summary: (body.querySelector('.archive-summary') || {}).textContent || '',
      };
    })()`);
    // The folder entry is not a file and is left out of the listing.
    check('the members are listed and the folder entry is not',
      archive.names.join(',') === 'readme.txt,data/report.csv', archive.names.join(','));
    check('with a line saying how much it unpacks to', /\d/.test(archive.summary), archive.summary);

    const vClosed = await win.webContents.executeJavaScript(`(() => {
      closeViewer();
      return { hidden: document.getElementById('viewer').hidden };
    })()`);
    check('closing puts the page back', vClosed.hidden === true);

    // The button somebody actually reaches the viewer by. It leads on every
    // file row in the app, not only on the photo screen.
    const rowActions = await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('#largest-files .file-row');
      const links = [...row.querySelectorAll('.file-actions .link')];
      return { labels: links.map((l) => l.textContent), lead: links[0].classList.contains('is-lead') };
    })()`);
    check('View leads the actions on a file row', rowActions.lead === true,
      rowActions.labels.join(' / '));
    check('with Reveal and Open behind it', rowActions.labels.length === 3,
      rowActions.labels.join(' / '));

    fs.rmSync(viewDir, { recursive: true, force: true });
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

    // Every one of those forty is in the Action Journal, item by item, and the
    // journal says the Recycle Bin freed none of it.
    {
      const { services } = require('../src/main/services');
      const sessions = await services().journal.sessions();
      const mine = sessions.find((s) => s.kind === 'recycle' &&
        s.items.some((item) => probes.includes(item.from)));
      check('the delete is in the Action Journal, one line per file',
        mine && mine.complete && probes.every((p) => mine.items.some((item) => item.from === p)),
        mine ? `${mine.items.length} items, source ${mine.source}` : 'no session');
      check('and the journal says the bin freed none of it',
        mine && mine.end.freedOnSource === 0 && mine.end.movedBytes > 0 && mine.freesOnVolume === false,
        mine ? `moved ${mine.end.movedBytes}, freed ${mine.end.freedOnSource}` : '');
      check('the journal is inside the sandbox, not the real profile',
        services().journalDir.startsWith(SANDBOX_USER_DATA), services().journalDir);
    }

    /* -- the Restore Center, on those same forty -------------------------- */
    // They are in the real Recycle Bin now, so this is the restore path against
    // the real bin: what the screen says is read from it, and five of them are
    // really put back.
    console.log('\nRestore Center (the same forty, from the real Recycle Bin):');
    {
      await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="restore"]').click()`);
      await until(win, `document.querySelector('#restore-sessions .restore-session[data-kind="recycle"]') !== null`, 30000);
      const listed = await win.webContents.executeJavaScript(`(() => {
        const card = [...document.querySelectorAll('#restore-sessions .restore-session[data-kind="recycle"]')]
          .find((c) => /40/.test(c.querySelector('strong').textContent));
        return card ? {
          session: card.dataset.session,
          title: card.querySelector('strong').textContent,
          note: (card.querySelector('.restore-note') || {}).textContent || '',
          all: (card.querySelector('[data-restore-all]') || {}).textContent || '',
          badges: card.querySelectorAll('.frees-badge').length,
        } : null;
      })()`);
      check('the delete is listed as a session of its own', listed && /Moved 40 items to the Recycle Bin/.test(listed.title),
        listed ? listed.title : 'not listed');
      check('and says all forty are still in the bin -- read from the bin, not the record',
        listed && /40 still in the Recycle Bin/.test(listed.note), listed ? listed.note : '');
      check('with a way to put all of them back', listed && /40/.test(listed.all), listed ? listed.all : '');

      await win.webContents.executeJavaScript(
        `document.querySelector('[data-restore-toggle="${listed ? listed.session : ''}"]').click()`);
      await until(win, `document.querySelectorAll('.restore-session[data-session="${listed ? listed.session : ''}"] .file-row').length >= 40`, 30000);
      const rows = await win.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('.restore-session[data-session="${listed ? listed.session : ''}"]');
        const list = [...card.querySelectorAll('.file-row')];
        return {
          count: list.length,
          tickable: list.filter((li) => !li.querySelector('input').disabled).length,
          words: [...new Set(list.map((li) => (li.querySelector('.badge-state') || {}).textContent))],
          verdictColour: card.querySelectorAll('.badge-safe, .badge-review').length,
          viewButtons: card.querySelectorAll('.file-actions .is-lead').length,
        };
      })()`);
      check('its forty files are listed, each one tickable', rows.count === 40 && rows.tickable === 40,
        `${rows.count} rows, ${rows.tickable} tickable`);
      check('each says where it is, in words, without a verdict colour',
        rows.words.length === 1 && rows.words[0] === 'in the bin' && rows.verdictColour === 0, rows.words.join(', '));
      check('and none offers View: a file in the bin has nothing at its old path to look at', rows.viewButtons === 0);

      // Five back: one of them has a new file in its place, and the request
      // asks to replace it. The window is not allowed that choice -- only the
      // dialog is -- so it must be skipped, not overwritten and not recycled.
      fs.mkdirSync(probeDir, { recursive: true });
      fs.writeFileSync(probes[4], 'somebody made a new one');
      const ids = await win.webContents.executeJavaScript(
        `restoreCenter.view.items.get(${JSON.stringify(listed ? listed.session : '')}).slice(0, 5).map((r) => r.id)`);
      const back = await win.webContents.executeJavaScript(`
        window.cleandrive.restore(${JSON.stringify(ids)}, { confirm: false, onConflict: 'replace' })
          .then((r) => ({ ok: r.ok, moved: r.ok ? r.data.moved.length : 0, failed: r.ok ? r.data.failed.map((f) => f.code) : [] }))`);
      check('four come back from the real bin, with what they held',
        back.ok && back.moved === 4 && probes.slice(0, 4).every((p) => fs.existsSync(p) && fs.readFileSync(p, 'utf8') === 'x'.repeat(4096)),
        JSON.stringify(back));
      check('the one with a file in its place is skipped: the window cannot choose to replace',
        back.failed.includes('EEXIST') && fs.readFileSync(probes[4], 'utf8') === 'somebody made a new one');

      const kept = await win.webContents.executeJavaScript(`
        window.cleandrive.restore(${JSON.stringify(ids.slice(4))}, { confirm: false, onConflict: 'rename' })
          .then((r) => (r.ok ? r.data.moved.map((m) => m.to) : []))`);
      check('asked to keep both, it comes back beside the new one under another name',
        kept.length === 1 && /\(restored\)\.bin$/.test(kept[0]) && fs.readFileSync(kept[0], 'utf8') === 'x'.repeat(4096) &&
          fs.readFileSync(probes[4], 'utf8') === 'somebody made a new one', kept[0] || 'nothing moved');

      const { services } = require('../src/main/services');
      await services().ledger.load();
      const claimed = services().ledger.entries.filter((e) => probes.slice(0, 5).includes(e.path)).length;
      check('the ledger no longer counts what was put back as the app\'s to purge', claimed === 0, `${claimed} still claimed`);

      await win.webContents.executeJavaScript('restoreCenter.load()');
      const after = await win.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('.restore-session[data-session="${listed ? listed.session : ''}"]');
        const list = [...card.querySelectorAll('.file-row')];
        return {
          note: card.querySelector('.restore-note').textContent,
          tickable: list.filter((li) => !li.querySelector('input').disabled).length,
          restoreCards: document.querySelectorAll('.restore-session[data-kind="restore"]').length,
        };
      })()`);
      check('read again, the screen says five are back and thirty-five are still in the bin',
        /35 still in the Recycle Bin/.test(after.note) && /5 put back/.test(after.note), after.note);
      check('the five can no longer be ticked', after.tickable === 35, String(after.tickable));
      check('and each restore is a session of its own on the screen', after.restoreCards === 2, String(after.restoreCards));
    }

    fs.rmSync(probeDir, { recursive: true, force: true });

    /* -- the System screen (A1) ------------------------------------------- */
    // A "drive" this harness builds, laid out like one, so every row can be
    // asserted exactly; and a stand-in for the elevated helper that answers
    // with the real tool output captured on this machine. No UAC prompt, and
    // no Windows page actually opens: the handoffs are recorded.
    console.log('\nSystem (a fixture drive, and the elevated pass with captured tool output):');
    {
      const driveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-smoke-drive-'));
      const put = (rel, bytes) => {
        const full = path.join(driveRoot, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, Buffer.alloc(bytes, 1));
      };
      const MB = 1024 * 1024;
      put('Users/Me/Documents/report.docx', 3 * MB);
      put('Users/Me/.cache/model.bin', 2 * MB);
      put('Users/Me/work/app/node_modules/pkg/index.js', 1 * MB);
      put('Users/Public/readme.txt', 64 * 1024);
      put('Program Files/App/app.exe', 4 * MB);
      put('ProgramData/App/cache.db', 1 * MB);
      put('Windows/WinSxS/amd64_component/file.dll', 2 * MB);
      put('Windows/Installer/setup.msi', 2 * MB);
      put('Windows/System32/kernel.dll', 1 * MB);
      put('Vmware/disk.vmdk', 5 * MB);

      const FIX = path.join(__dirname, 'fixtures', 'system');
      const text = (name) => fs.readFileSync(path.join(FIX, name), 'latin1');
      const { measureTree } = require('../src/main/system/walk');
      const asked = [];
      ipc.setSystemTargetForHarness({ drive: `${driveRoot}\\`, home: path.join(driveRoot, 'Users', 'Me') });
      ipc.setHelperClientForHarness(() => ({
        start: async () => {},
        stop: () => asked.push('stop'),
        async request(op, args) {
          asked.push(op);
          if (op === 'ping') return { pid: 1, integrity: 'high', elevated: true };
          if (op === 'system.breakdown') {
            const sums = [];
            for (const dir of args.dirs) {
              const out = await measureTree(dir);
              const all = out.buckets.all || { allocated: 0, logical: 0, files: 0 };
              sums.push({ dir, allocated: all.allocated, logical: all.logical, files: all.files, denied: out.deniedCount });
            }
            return { sums, ms: 1 };
          }
          const files = {
            'shadowstorage.query': 'vssadmin-list-shadowstorage.en.txt',
            'ntfs.info': 'fsutil-fsinfo-ntfsinfo.en.txt',
            'storagereserve.query': 'fsutil-storagereserve-query.en.txt',
            'dism.analyze': 'dism-analyzecomponentstore.en.txt',
          };
          return { exitCode: 0, text: text(files[op]), ms: 1 };
        },
      }));
      const opened = [];
      ipc.setHandoffDepsForHarness({ openExternal: async (uri) => opened.push(uri), spawn: (exe, args) => opened.push([exe, ...args].join(' ')) });

      await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="system"]').click()`);
      await until(win, `document.getElementById('sstat-total').textContent !== '–'`, 30000);
      const before = await win.webContents.executeJavaScript(`({
        total: document.getElementById('sstat-total').textContent,
        bar: document.getElementById('system-bar-card').hidden,
        status: document.getElementById('system-status').textContent,
        order: [...document.querySelectorAll('.tab[data-tab]')].map((b) => b.dataset.tab).slice(0, 3).join(','),
      })`);
      check('the System tab sits between Disk usage and What to delete', before.order === 'usage,system,cleanup', before.order);
      check('it shows the drive\'s size at once, and waits for a click before reading every folder',
        /\d/.test(before.total) && before.bar === true && /can be stopped/.test(before.status), before.status);

      await win.webContents.executeJavaScript(`document.getElementById('system-measure').click()`);
      await until(win, `document.getElementById('system-bar-card').hidden === false && !document.getElementById('system-measure').disabled`, 60000);
      const measured = await win.webContents.executeJavaScript(`(() => {
        const rows = Object.fromEntries([...document.querySelectorAll('.system-row')].map((r) => [r.dataset.key, {
          size: r.querySelector('.system-row-size').textContent,
          pill: (r.querySelector('.badge') || {}).textContent || '',
          parts: [...r.querySelectorAll('.system-part-name')].map((p) => p.textContent),
          handoff: (r.querySelector('[data-handoff]') || {}).dataset ? r.querySelector('[data-handoff]').dataset.handoff : null,
        }]));
        return {
          rows,
          segments: [...document.querySelectorAll('#system-bar .system-seg')].map((s) => s.className.replace('system-seg system-seg-', '')),
          unexplained: document.getElementById('sstat-unexplained').textContent,
          verdictColours: [...document.querySelectorAll('.system-seg, .system-swatch')].some((el) => /good|warn|danger/.test(getComputedStyle(el).backgroundColor)),
        };
      })()`);
      const r = measured.rows;
      check('every byte of the fixture lands in its row: profile, what the scans skip, programs, Windows',
        r.profile && /3\.\d MB/.test(r.profile.size) && r.profileSkipped && r.programs && r.winsxs && r.installer && r.windows,
        Object.keys(r).join(', '));
      check('what the other scans skip is named, largest first', r.profileSkipped && r.profileSkipped.parts[0] === '.cache',
        r.profileSkipped ? r.profileSkipped.parts.join(', ') : 'no row');
      check('a folder at the top of the drive is named', r.otherFolders && r.otherFolders.parts.includes('Vmware'));
      check('before administrator rights, restore points say they need them', r.restorePoints && /administrator/.test(r.restorePoints.size),
        r.restorePoints ? r.restorePoints.size : 'no row');
      check('each row carries a verdict and how sure the app is', Object.values(r).every((row) => /·/.test(row.pill)));
      check('one bar for the drive, and "not explained" is a number, not hidden',
        measured.segments.includes('yours') && measured.segments.includes('free') && measured.segments.includes('unexplained') && /\d/.test(measured.unexplained),
        measured.segments.join(','));
      check('and the bar is in weights of the accent, with no verdict colour in it', measured.verdictColours === false);

      await win.webContents.executeJavaScript(`document.getElementById('system-elevated').click()`);
      await until(win, `!!document.querySelector('.system-row[data-key="ntfsMetadata"]') && !/administrator/.test(document.querySelector('.system-row[data-key="restorePoints"] .system-row-size').textContent)`, 60000);
      const lifted = await win.webContents.executeJavaScript(`(() => {
        const size = (k) => (document.querySelector('.system-row[data-key="' + k + '"] .system-row-size') || {}).textContent || '';
        return { restore: size('restorePoints'), mft: size('ntfsMetadata'), note: document.getElementById('system-note').textContent,
          command: (document.querySelector('.system-row[data-key="winsxs"] .system-command code') || {}).textContent || '' };
      })()`);
      check('the elevated pass asked only what its button says, and let the helper go',
        asked[0] === 'ping' && asked.includes('system.breakdown') && asked.includes('dism.analyze') && asked[asked.length - 1] === 'stop', asked.join(' > '));
      check('restore points and the MFT come from the tools\' real output: 8.9 GB and 1.8 GB',
        /8\.9 GB/.test(lifted.restore) && /1\.8 GB/.test(lifted.mft), `${lifted.restore} / ${lifted.mft}`);
      check('the screen says it was measured with administrator rights', /administrator rights/.test(lifted.note));
      check('WinSxS offers DISM\'s own cleanup as a command to copy, never runs it', /StartComponentCleanup/.test(lifted.command), lifted.command);

      await win.webContents.executeJavaScript(`document.querySelector('.system-row[data-key="restorePoints"] [data-handoff]').click()`);
      await until(win, `true`, 2000);
      await wait(500);
      check('a row\'s button opens the Windows tool that owns it, from the fixed table', opened.length === 1 &&
        /SystemPropertiesProtection\.exe$/i.test(opened[0]), opened.join(' | '));
      const { services } = require('../src/main/services');
      const handoffs = (await services().journal.sessions()).filter((s) => s.kind === 'handoff');
      check('and it is in the journal, as what was opened', handoffs.length === 1 && /SystemPropertiesProtection/.test(handoffs[0].items[0].from));

      ipc.setSystemTargetForHarness(null);
      ipc.setHelperClientForHarness(null);
      ipc.setHandoffDepsForHarness(null);
      fs.rmSync(driveRoot, { recursive: true, force: true });
    }

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

    /* -- scan history -------------------------------------------------------- */
    console.log('\nScan history:');

    const history = await win.webContents.executeJavaScript(`
      (async () => {
        document.querySelector('.tab[data-tab="settings"]').click();
        const recent = document.getElementById('snapshot-keep-recent');
        const monthly = document.getElementById('snapshot-keep-monthly');
        const shown = { recent: recent.value, monthly: monthly.value };
        recent.value = '5';
        recent.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 1500));
        const saved = (await window.cleandrive.getSettings()).data.settings.snapshots;
        recent.value = '5000';
        recent.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 1500));
        const clamped = { stored: (await window.cleandrive.getSettings()).data.settings.snapshots.keepRecent, shown: recent.value };
        recent.value = '12';
        recent.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 1500));
        return { shown, saved, clamped, detail: document.getElementById('snapshot-detail').textContent };
      })()
    `);
    check('the card shows what is stored', history.shown.recent === '12' && history.shown.monthly === '12',
      `${history.shown.recent} / ${history.shown.monthly}`);
    check('a change is saved without touching the other field', history.saved.keepRecent === 5 && history.saved.keepMonthly === 12);
    check('an impossible number is clamped, and the field shows the clamped one',
      history.clamped.stored === 100 && history.clamped.shown === '100', `${history.clamped.stored} / ${history.clamped.shown}`);
    check('and the card says what that adds up to', /\d+/.test(history.detail), history.detail);

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

    /* -- the map of the folder ---------------------------------------------- */
    // Last, because it scans a folder of its own and the sections above read
    // the Downloads scan. Built here, so the shapes it has to handle are
    // there: deeper than a reply goes, wider than a level carries, more big
    // files than a folder names, and one file the advisor calls safe.
    console.log('\nMap of the folder (Disk usage):');
    {
      const mapBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-smoke-map-'));
      const mapRoot = path.join(mapBase, 'home');
      const make = (relative, bytes) => {
        const full = path.join(mapRoot, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const fd = fs.openSync(full, 'w');
        fs.ftruncateSync(fd, bytes);
        fs.closeSync(fd);
        return full;
      };
      make(path.join('Deep', 'a', 'b', 'c', 'd', 'e', 'f', 'deep.bin'), 1024);
      for (let i = 0; i < 320; i++) make(path.join('Wide', `w${String(i).padStart(3, '0')}`, 'x.bin'), (i + 1) * 100);
      for (let i = 0; i < 12; i++) make(path.join('Big', `big${i}.bin`), 10 * 1024 * 1024 + i * 1000);
      make(path.join('Temp', 'cache.tmp'), 11 * 1024 * 1024);
      for (let i = 0; i < 6; i++) make(path.join('Photos', `200${i}`, `p${i}.jpg`), (3 + i) * 1024 * 1024);
      const throwaway = make(path.join('Scratch', 'cleandrive-smoke-map-throwaway.bin'), 4096);
      make('loose.bin', 5);

      const js = (expr) => win.webContents.executeJavaScript(expr);
      try {
        // What the window can and cannot get, asked of the IPC directly.
        const protocol = await js(`
          (async () => {
            const api = window.cleandrive;
            const first = (await api.scan(${JSON.stringify(mapRoot)})).data;
            const top = await api.scanChildren(first.treeId, '');
            const nodes = [];
            const walk = (folder, depth) => {
              for (const item of folder.children || []) {
                nodes.push({ kind: item.kind, depth, rel: item.rel || '' });
                if (item.kind === 'folder') walk(item, depth + 1);
              }
            };
            if (top.ok) walk(top.data, 1);
            const wide = top.ok ? top.data.children.find((c) => c.name === 'Wide') : null;
            const refusals = {
              unknown: await api.scanChildren(first.treeId, 'Nowhere'),
              escape: await api.scanChildren(first.treeId, '..'),
              absolute: await api.scanChildren(first.treeId, ${JSON.stringify(path.join(mapRoot, 'Big'))}),
              notString: await api.scanChildren(first.treeId, 42),
              noId: await api.scanChildren(undefined, ''),
            };
            const second = (await api.scan(${JSON.stringify(mapRoot)})).data;
            const stale = await api.scanChildren(first.treeId, '');
            return {
              ok: top.ok,
              bytes: top.ok ? top.data.bytes : 0,
              totalSize: first.totalSize,
              nodes: nodes.length,
              deepest: Math.max(...nodes.map((n) => n.depth)),
              hasDeepFolder: nodes.some((n) => /e.f$/.test(n.rel)),
              wideFolders: wide && wide.children ? wide.children.filter((c) => c.kind === 'folder').length : -1,
              wideOthers: wide && wide.children ? (wide.children.find((c) => c.kind === 'others') || {}).count : -1,
              files: nodes.filter((n) => n.kind === 'file').length,
              bytesSent: JSON.stringify(top.data || {}).length,
              refused: Object.fromEntries(Object.entries(refusals).map(([k, r]) => [k, r.ok === false ? r.code || 'refused' : 'ANSWERED'])),
              stale: stale.ok === false ? stale.code : 'ANSWERED',
              renewed: second.treeId !== first.treeId,
            };
          })()
        `);
        console.log(`    one level: ${protocol.nodes} nodes, ${protocol.bytesSent.toLocaleString('en-US')} bytes`);
        check('a level adds up to the scan', protocol.ok && protocol.bytes === protocol.totalSize,
          `${protocol.bytes} of ${protocol.totalSize}`);
        check('and reaches at most three levels down, so the seven-deep folder is not in it',
          protocol.deepest <= 3 && protocol.hasDeepFolder === false, `deepest ${protocol.deepest}`);
        check('a folder of 320 folders arrives as 300 and one tile for the rest',
          protocol.wideFolders === 300 && protocol.wideOthers === 20, `${protocol.wideFolders} + ${protocol.wideOthers}`);
        check('the window cannot ask for a folder the scan never saw, a way out of it, an absolute path, or a non-string',
          Object.values(protocol.refused).every((code) => code !== 'ANSWERED'), JSON.stringify(protocol.refused));
        check('and a map from an earlier scan is told it is stale rather than handed this one',
          protocol.renewed && protocol.stale === 'ESTALE', protocol.stale);

        // Now through the screen itself.
        await js(`document.querySelector('.tab[data-tab="usage"]').click()`);
        await js(`setFolder(${JSON.stringify(mapRoot)})`);
        await until(win, `document.getElementById('run-scan').disabled === false`);
        await js(`document.getElementById('run-scan').click()`);
        await until(win, `document.getElementById('run-scan').disabled === false && window.SpaceMap.debug().tiles.length > 0 && window.SpaceMap.debug().level && window.SpaceMap.debug().level.path === ${JSON.stringify(mapRoot)}`, 60000);
        await wait(300);

        const drawn = await js(`
          (() => {
            const canvas = document.getElementById('spacemap-canvas');
            const ctx = canvas.getContext('2d');
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const colours = new Set();
            for (let i = 0; i < data.length; i += 4 * 97) colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
            const tree = document.getElementById('spacemap-tree');
            const items = [...tree.querySelectorAll('[role="treeitem"]')];
            const debug = window.SpaceMap.debug();
            return {
              view: debug.view,
              mapShown: !document.getElementById('spacemap').hidden,
              listHidden: document.getElementById('top-folders').hidden,
              canvas: [canvas.width, canvas.height],
              colours: colours.size,
              role: tree.getAttribute('role'),
              items: items.length,
              labelled: items.every((el) => el.getAttribute('aria-label') && el.getAttribute('aria-level')),
              levels: [...new Set(items.map((el) => el.getAttribute('aria-level')))].sort(),
              tabStops: items.filter((el) => el.tabIndex === 0).length,
              tiles: debug.tiles.length,
              nested: debug.tiles.filter((t) => t.depth > 1).length,
              kinds: [...new Set(debug.tiles.map((t) => t.kind))].sort(),
              crumbs: [...document.querySelectorAll('#spacemap-crumbs li')].map((li) => li.textContent),
            };
          })()
        `);
        console.log(`    ${drawn.tiles} tiles (${drawn.nested} nested), levels ${drawn.levels.join('/')}, ${drawn.colours} colours sampled`);
        check('the map is what the card opens on', drawn.view === 'map' && drawn.mapShown && drawn.listHidden);
        check('and it is painted, not left blank', drawn.canvas[0] > 0 && drawn.colours >= 3, `${drawn.canvas.join('x')}, ${drawn.colours} colours`);
        check('every tile is a treeitem in a tree, named and levelled',
          drawn.role === 'tree' && drawn.items === drawn.tiles && drawn.labelled, `${drawn.items} items`);
        check('with folders drawn inside folders', drawn.nested > 0 && drawn.levels.includes('2'));
        check('and exactly one of them in the tab order', drawn.tabStops === 1, String(drawn.tabStops));
        check('folders, named files and the "smaller files" tiles are all there',
          ['file', 'folder', 'rest'].every((k) => drawn.kinds.includes(k)), drawn.kinds.join(', '));
        check('the path above the map starts at the scanned folder', drawn.crumbs.length === 1 && drawn.crumbs[0] === 'home',
          drawn.crumbs.join(' > '));

        const keys = await js(`
          (async () => {
            const tree = document.getElementById('spacemap-tree');
            const key = (k, extra = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
            const settle = () => new Promise((r) => setTimeout(r, 250));
            const level1 = [...tree.children];
            level1[0].focus();
            const start = document.activeElement.dataset.key;
            key('ArrowDown');
            const down = document.activeElement.dataset.key;
            const nestedFolder = level1.find((el) => el.classList.contains('is-folder') && el.getAttribute('aria-expanded') === 'true');
            nestedFolder.focus();
            key('ArrowRight');
            const inside = { level: document.activeElement.getAttribute('aria-level') };
            key('ArrowLeft');
            const back = document.activeElement === nestedFolder;
            const goingInto = nestedFolder.dataset.key;
            key('Enter');
            await settle();
            const crumbsIn = document.querySelectorAll('#spacemap-crumbs li').length;
            const focusIn = document.activeElement && document.activeElement.getAttribute('aria-level');
            key('Backspace');
            await settle();
            return {
              moved: start !== down,
              inside,
              back,
              crumbsIn,
              focusIn,
              crumbsOut: document.querySelectorAll('#spacemap-crumbs li').length,
              focusBack: document.activeElement && document.activeElement.dataset.key === goingInto,
            };
          })()
        `);
        check('arrow keys move between tiles', keys.moved);
        check('right goes into a folder drawn inside, left comes back out', keys.inside.level === '2' && keys.back);
        check('Enter opens the folder, and focus lands on its first tile', keys.crumbsIn === 2 && keys.focusIn === '1',
          `${keys.crumbsIn} crumbs`);
        check('Backspace goes up again, back onto the folder it came from', keys.crumbsOut === 1 && keys.focusBack);

        const menu = await js(`
          (async () => {
            const settle = () => new Promise((r) => setTimeout(r, 250));
            const big = [...document.querySelectorAll('#spacemap-tree .spacemap-item.is-folder')].find((el) => /^Big:/.test(el.getAttribute('aria-label')));
            big.click();
            await settle();
            const file = document.querySelector('#spacemap-tree .spacemap-item.is-file');
            const r = file.getBoundingClientRect();
            file.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
            const tip = document.querySelector('.spacemap-tip');
            const tipText = tip.hidden ? '' : tip.textContent;
            file.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
            const menuEl = document.querySelector('.spacemap-menu');
            const items = [...menuEl.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
            const focusedInMenu = menuEl.contains(document.activeElement);
            menuEl.querySelectorAll('[role="menuitem"]')[2].click();
            await settle();
            return {
              crumbs: [...document.querySelectorAll('#spacemap-crumbs li')].map((li) => li.textContent),
              tipText,
              items,
              focusedInMenu,
              menuClosed: menuEl.hidden,
              selected: file.isConnected ? file.getAttribute('aria-selected') : document.querySelector('#spacemap-tree .spacemap-item.is-file.is-selected') ? 'true' : 'false',
              bar: !document.getElementById('large-actionbar').hidden,
              readout: document.getElementById('large-selection').textContent,
            };
          })()
        `);
        check('clicking a folder goes into it', menu.crumbs.join(' > ') === 'home > Big', menu.crumbs.join(' > '));
        check('pointing at a tile shows its path and size', /big\d+\.bin/.test(menu.tipText) && /MB/.test(menu.tipText),
          menu.tipText.slice(0, 80));
        check('right-clicking a file offers View, Reveal and Add to selection, with focus in the menu',
          menu.items.join('|') === 'View|Reveal|Add to selection' && menu.focusedInMenu, menu.items.join(', '));
        check('adding it ticks the tile and brings up the same bar the largest list uses',
          menu.menuClosed && menu.selected === 'true' && menu.bar && /1 selected/.test(menu.readout), menu.readout);

        const listed = await js(`
          (async () => {
            const settle = () => new Promise((r) => setTimeout(r, 250));
            document.querySelector('#spacemap-crumbs button').click();
            await settle();
            document.querySelector('[data-map-view="list"]').click();
            await settle();
            const rows = [...document.querySelectorAll('#top-folders .spacemap-row')];
            const level = window.SpaceMap.debug().level;
            let stored = null;
            try { stored = localStorage.getItem('cleandrive.spacemap.view'); } catch {}
            const out = {
              listShown: !document.getElementById('top-folders').hidden,
              mapHidden: document.getElementById('spacemap').hidden,
              rows: rows.length,
              children: level.children.length,
              folderButtons: document.querySelectorAll('#top-folders .spacemap-open').length,
              menuButtons: document.querySelectorAll('#top-folders .spacemap-more').length,
              stored,
            };
            document.querySelector('#top-folders .spacemap-open').click();
            await settle();
            out.crumbsAfter = document.querySelectorAll('#spacemap-crumbs li').length;
            document.querySelector('#spacemap-crumbs button').click();
            await settle();
            document.querySelector('[data-map-view="map"]').click();
            await settle();
            return out;
          })()
        `);
        check('the list shows the same level, one row per tile', listed.listShown && listed.mapHidden && listed.rows === listed.children,
          `${listed.rows} rows for ${listed.children} tiles`);
        check('with every folder a button that goes into it, and a menu on every folder and file',
          listed.folderButtons > 0 && listed.menuButtons > 0 && listed.crumbsAfter === 2);
        check('and the choice of view is remembered', listed.stored === 'list');

        const before = await js(`window.SpaceMap.debug().level.bytes`);
        await js(`deleteSelected([${JSON.stringify(throwaway)}], () => {}, { confirm: false })`);
        await until(win, `window.SpaceMap.debug().level && window.SpaceMap.debug().level.removed.files === 1`, 15000);
        const after = await js(`({ bytes: window.SpaceMap.debug().level.bytes, note: document.getElementById('spacemap-note').textContent })`);
        check('a file moved to the bin from any screen leaves the map, by exactly its size',
          before - after.bytes === 4096 && !fs.existsSync(throwaway), `${before} -> ${after.bytes}`);
        check('and the map says so, without calling it freed', /Moved to the Recycle Bin since this scan/.test(after.note) &&
          /Not freed/.test(after.note), after.note.slice(0, 90));
      } finally {
        fs.rmSync(mapBase, { recursive: true, force: true });
      }
    }

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
