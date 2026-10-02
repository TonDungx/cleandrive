'use strict';

// A4 in the real window over the real IPC: several folders in one scan, a
// whole drive, a network folder, and the Free tier's limit.
//
//   npx electron scripts/test-multiroot.js
//
// "Choose folder" is a harness hook (ipc.setScanHarness({ pick })); nothing
// else is stood in for. The whole drive is a real drive root: a `subst`
// letter over a folder of this harness's, made with System32\subst.exe and
// removed at the end. The network folder is a folder of this harness's on D:,
// read through this machine's own LAN address (\\<ip>\D$\...), which the app
// cannot tell from another machine's share -- if the address answers. If it
// does not, those checks say SKIP and are not counted.
//
// Isolation: throwaway userData, suffixed task names, the harness's own
// folders on the temp drive and on D:; all checked first, all removed after.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

app.setName(require('../package.json').name);
const PRODUCTION_USER_DATA = app.getPath('userData');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-multiroot-userdata-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'multiroot';
require('../src/main/lib/preview/serve').registerScheme();

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SUBST = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'subst.exe');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};
const skip = (label, why) => console.log(`  SKIP  ${label}  -- ${why}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chromium holds userData until this process is gone; a small Node process removes it after. */
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

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const cleanups = [];
  try {
    console.log('\nIsolation:');
    check('userData is a throwaway directory', app.getPath('userData') === SANDBOX && SANDBOX !== PRODUCTION_USER_DATA && SANDBOX.startsWith(os.tmpdir()), SANDBOX);
    check('scheduled-task names are suffixed', Boolean(process.env.CLEANDRIVE_TASK_SUFFIX), process.env.CLEANDRIVE_TASK_SUFFIX);
    const realSettings = path.join(PRODUCTION_USER_DATA, 'settings.json');
    const realBefore = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;

    // Two folders with a copy of the same file in each, and one inside the first.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-multiroot-fixture-'));
    cleanups.push(() => fs.rmSync(work, { recursive: true, force: true }));
    const alpha = path.join(work, 'Alpha');
    const beta = path.join(work, 'Beta');
    const inner = path.join(alpha, 'Inner');
    const same = crypto.randomBytes(400 * 1024);
    write(path.join(alpha, 'Docs', 'report.pdf'), same);
    write(path.join(beta, 'Backup', 'report (copy).pdf'), same);
    write(path.join(alpha, 'Downloads', 'setup.exe'), crypto.randomBytes(3 * 1024 * 1024));
    write(path.join(inner, 'photo.raw'), crypto.randomBytes(2 * 1024 * 1024));
    write(path.join(beta, 'Videos', 'clip.mkv'), crypto.randomBytes(5 * 1024 * 1024));

    // A whole drive: a subst letter over a folder of ours.
    const wholeDir = path.join(work, 'WholeDrive');
    write(path.join(wholeDir, 'Games', 'save.dat'), crypto.randomBytes(1024 * 1024));
    const letter = ['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'].find((l) => !fs.existsSync(`${l}:\\`));
    let wholeRoot = null;
    if (letter) {
      execFileSync(SUBST, [`${letter}:`, wholeDir]);
      cleanups.unshift(() => execFileSync(SUBST, [`${letter}:`, '/d']));
      if (fs.existsSync(`${letter}:\\Games\\save.dat`)) wholeRoot = `${letter}:\\`;
    }

    // A network folder: ours on D:, through this machine's LAN address.
    const netDir = path.join('D:\\', `cleandrive-harness-net-${crypto.randomBytes(4).toString('hex')}`);
    write(path.join(netDir, 'Shared', 'deck.pptx'), crypto.randomBytes(1024 * 1024));
    cleanups.push(() => fs.rmSync(netDir, { recursive: true, force: true }));
    const ip = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    let unc = null;
    if (ip) {
      const candidate = `\\\\${ip.address}\\D$\\${path.basename(netDir)}\\Shared`;
      if (fs.existsSync(path.join(candidate, 'deck.pptx'))) unc = candidate;
    }

    console.log('\nSetup:');
    check(`a whole drive to scan: ${wholeRoot || 'none'}`, Boolean(wholeRoot), letter ? `subst ${letter}:` : 'no free letter');
    if (unc) check(`a network folder: ${unc}`, true);
    else skip('a network folder', ip ? `\\\\${ip.address}\\D$ did not answer` : 'no LAN address');

    require('../src/main/lib/preview/serve').serve();
    const ipc = require('../src/main/ipc');
    ipc.register();
    ipc.allowUnconfirmedForHarness();
    const picks = [];
    ipc.setScanHarness({ pick: async () => picks.shift() || null });

    const win = new BrowserWindow({
      width: 1180,
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
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await wait(500);
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    const until = async (expr, ms = 30000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await js(`return Boolean(${expr})`)) return true;
        await wait(150);
      }
      return false;
    };
    await js(AXE);
    const axe = () => js(`return axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
      .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')))`);
    const scan = async () => {
      await js(`document.getElementById('scan-stats').hidden = true; document.getElementById('run-scan').click();`);
      await until(`!document.getElementById('scan-stats').hidden && document.getElementById('cancel-scan').hidden`, 120000);
    };
    const status = () => js(`return document.getElementById('scan-status').textContent`);
    const chips = () => js(`return [...document.querySelectorAll('#scan-roots .root-chip')].map((c) => ({
      name: c.querySelector('.root-name').title, badge: (c.querySelector('.root-badge') || {}).textContent || '', remove: Boolean(c.querySelector('.root-remove')) }))`);

    /* ---- one folder, then more ---- */

    console.log('\nOne folder, then more:');
    picks.push(alpha);
    await js(`document.getElementById('pick-folder').click();`);
    await until(`document.getElementById('target-path').title === ${JSON.stringify(alpha)}`);
    check('one folder chosen: its path, and a way to add another', (await js(`return !document.getElementById('add-folder').hidden && document.getElementById('scan-roots').hidden`)));
    picks.push(beta);
    await js(`document.getElementById('add-folder').click();`);
    await until(`document.getElementById('target-path').textContent === '2 folders'`);
    let got = await chips();
    check('two folders: the bar says so, and the screen lists both with a way to leave one out',
      got.length === 2 && got.every((c) => c.remove) && got[0].name === alpha && got[1].name === beta, JSON.stringify(got));
    picks.push(inner);
    await js(`document.getElementById('add-folder').click();`);
    await until(`document.getElementById('target-path').textContent === '3 folders'`);

    await scan();
    let line = await status();
    check('three asked for, two scanned: the one inside another was scanned with it, and the line says so',
      /Scanned \d+ files in 2 folders\./.test(line) && /Inner is inside .*Alpha, so it was scanned with it\./.test(line), line);
    got = await chips();
    check('its row says where it went', got.some((c) => c.name === inner && /inside .*Alpha, scanned with it/.test(c.badge)), JSON.stringify(got));
    const largest = await js(`return state.scan.largestFiles.map((f) => f.path)`);
    check('one largest list, from both folders', largest.some((p) => p.startsWith(alpha)) && largest.some((p) => p.startsWith(beta)));
    await until(`document.querySelectorAll('#spacemap-tree [role="treeitem"]').length > 0`);
    const top = await js(`return { crumb: document.querySelector('#spacemap-crumbs .spacemap-crumb-here').textContent,
      rows: [...document.querySelectorAll('#top-folders .spacemap-row .bar-name')].map((n) => n.textContent) }`);
    check('the map starts above both: "2 folders", a tile for each, named by its folder',
      top.crumb === '2 folders' && top.rows.includes('Alpha') && top.rows.includes('Beta'), JSON.stringify(top));
    check('the button says how many folders it scans', (await js(`return document.getElementById('run-scan').textContent`)) === 'Scan 3 folders');
    check('Disk usage has no violations', (await axe()).length === 0, (await axe()).join(' || '));

    await js(`[...document.querySelectorAll('#scan-roots .root-chip')].find((c) => c.querySelector('.root-name').title === ${JSON.stringify(inner)}).querySelector('.root-remove').click();`);
    got = await chips();
    check('leaving one out takes it off the list', got.length === 2 && !got.some((c) => c.name === inner));

    /* ---- duplicates across both ---- */

    console.log('\nDuplicates, across the folders chosen:');
    await js(`document.querySelector('.tab[data-tab="dupes"]').click(); document.getElementById('min-size').value = '100'; document.getElementById('run-dupes').click();`);
    await until(`!document.getElementById('dupes-stats').hidden && document.getElementById('cancel-dupes').hidden`, 60000);
    const pair = await js(`return state.dupes.groups.map((g) => g.files.map((f) => f.path))`);
    check('a copy in each folder is one group', pair.some((g) => g.some((p) => p.startsWith(alpha)) && g.some((p) => p.startsWith(beta))), JSON.stringify(pair));

    /* ---- a network folder ---- */

    console.log('\nA folder on a network drive:');
    if (!unc) {
      skip('network: read, nothing offered', 'no network folder');
    } else {
      await js(`setRoots([${JSON.stringify(alpha)}, ${JSON.stringify(unc)}]); document.querySelector('.tab[data-tab="usage"]').click();`);
      await scan();
      line = await status();
      check('the line says a network folder is read and nothing is offered there', /On a network drive: read, and nothing offered/.test(line), line);
      got = await chips();
      check('its row says so too', got.some((c) => c.name === unc && /network drive · read only/.test(c.badge)), JSON.stringify(got));
      await until(`[...document.querySelectorAll('#top-folders .spacemap-row .bar-name')].some((n) => n.textContent === 'Shared')`, 5000);
      const netRows = await js(`return [...document.querySelectorAll('#top-folders .spacemap-row .bar-name')].map((n) => n.textContent)`);
      check('and it has its tile on the map, beside the other', netRows.includes('Shared') && netRows.includes('Alpha'), JSON.stringify(netRows));
      const rows = await js(`return state.scan.largestFiles.filter((f) => f.path.startsWith('\\\\\\\\')).map((f) => ({ actions: f.actions.length, why: f.evidence[f.evidence.length - 1].i18n }))`);
      check('its files are listed, each with nothing to do and the reason last',
        rows.length > 0 && rows.every((r) => r.actions === 0 && r.why === 'evidence.readOnly.network'), JSON.stringify(rows));
      const reply = await js(`return window.cleandrive.trash([${JSON.stringify(path.join(unc, 'deck.pptx'))}])`);
      const failed = reply && reply.ok ? reply.data.failed : [];
      check('a delete asked for anyway is refused, and the file is where it was',
        failed.length === 1 && failed[0].code === 'ENETWORK' && fs.existsSync(path.join(netDir, 'Shared', 'deck.pptx')), JSON.stringify(reply).slice(0, 300));
      await js(`document.querySelector('.tab[data-tab="dupes"]').click(); document.getElementById('run-dupes').click();`);
      await until(`!document.getElementById('dupes-stats').hidden && document.getElementById('cancel-dupes').hidden`, 60000);
      const dline = await js(`return document.getElementById('dupes-status').textContent`);
      check('Duplicates leaves the network folder out, and says so', /Not searched, on a network drive:/.test(dline), dline);
    }

    /* ---- a whole drive ---- */

    console.log('\nA whole drive:');
    if (!wholeRoot) {
      skip('whole drive', 'no subst letter');
    } else {
      await js(`document.querySelector('.tab[data-tab="usage"]').click(); document.getElementById('pick-drive').click();`);
      await until(`document.getElementById('drives').open && document.querySelectorAll('#drives-list .drive-option').length > 0`, 20000);
      const offered = await js(`return [...document.querySelectorAll('#drives-list .drive-option .drive-name')].map((n) => n.textContent)`);
      check(`the drive dialog lists ${wholeRoot} among the drives`, offered.some((n) => n.startsWith(wholeRoot)), JSON.stringify(offered));
      check('the dialog has no violations', (await axe()).length === 0, (await axe()).join(' || '));
      await js(`[...document.querySelectorAll('#drives-list .drive-option')].find((b) => b.querySelector('.drive-name').textContent.startsWith(${JSON.stringify(wholeRoot)})).click();`);
      await until(`!document.getElementById('cancel-scan').hidden`, 5000);
      await until(`!document.getElementById('scan-stats').hidden && document.getElementById('cancel-scan').hidden`, 120000);
      line = await status();
      check('choosing it scans it, and the line gives the space the scan did not count', new RegExp(`in use on ${wholeRoot.replace(/\\/g, '\\\\')} is not in this scan`).test(line), line);
      await until(`document.querySelector('#top-folders .spacemap-row.is-unscanned')`);
      const tile = await js(`const row = document.querySelector('#top-folders .spacemap-row.is-unscanned'); return row ? row.querySelector('.bar-name').textContent : null`);
      check('the map has a tile for it', tile === '(not in this scan)', String(tile));
      await js(`document.querySelector('#top-folders .spacemap-row.is-unscanned .bar-name').click();`);
      check('and the tile opens the System screen', await until(`document.querySelector('.panel.is-active').id === 'panel-system'`, 3000));
    }

    /* ---- the Free tier ---- */

    console.log('\nOn the Free tier:');
    process.env.CLEANDRIVE_ENTITLEMENTS = 'free';
    await js(`setRoots([${JSON.stringify(alpha)}]); document.querySelector('.tab[data-tab="usage"]').click(); document.getElementById('add-folder').click();`);
    await until(`!document.getElementById('roots-hint').hidden`, 5000);
    const hintText = await js(`return document.getElementById('roots-hint').textContent`);
    check('adding a second folder says it is Pro, and asks for no folder', /part of CleanDrive Pro/.test(hintText) && picks.length === 0, hintText);
    const locked = await js(`return window.cleandrive.scan([${JSON.stringify(alpha)}, ${JSON.stringify(beta)}])`);
    check('and the main process refuses two folders asked for anyway', locked && !locked.ok && locked.code === 'ELOCKED', JSON.stringify(locked));
    process.env.CLEANDRIVE_ENTITLEMENTS = 'all';

    /* ---- in Vietnamese ---- */

    console.log('\nIn Vietnamese:');
    await js(`setRoots([${JSON.stringify(alpha)}, ${JSON.stringify(beta)}]); document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
    await until(`document.documentElement.lang === 'vi'`);
    await js(`document.querySelector('.tab[data-tab="usage"]').click();`);
    const vi = await js(`return { bar: document.getElementById('target-path').textContent, add: document.getElementById('add-folder').textContent, drive: document.getElementById('pick-drive').textContent }`);
    check('the bar and its buttons are in Vietnamese', vi.bar === '2 thư mục' && vi.add === '+ Thư mục' && vi.drive === 'Toàn bộ ổ…', JSON.stringify(vi));
    await js(`document.querySelector('[data-language-choice="en"]').click();`);

    console.log('\nConsole:');
    check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    win.destroy();
    const realAfter = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;
    check('the real settings file was not touched', realAfter === realBefore);
  } catch (err) {
    failures++;
    console.error('\nFailed:', err && err.stack ? err.stack : err);
  } finally {
    for (const undo of cleanups) {
      try {
        undo();
      } catch (err) {
        console.log(`    (cleanup: ${err.message})`);
      }
    }
    removeAfterExit(SANDBOX);
  }
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
});
