'use strict';

// Screenshots of A2's switch: "Fast scan (needs administrator)" beside the
// Scan button, the line it shows while the catalogue is being read, the line
// it leaves behind naming the scanner that answered, and what it says when
// the prompt is declined -- in both themes, in Vietnamese and narrow.
//
//   npx electron scripts/shoot-fastscan.js [outputDir]
//
// Throwaway userData, a suffixed task name, a fixture of its own on D:, and a
// `subst` drive over it so that a whole drive can be chosen without touching
// a real one. All removed at the end.
//
// The elevated helper is replaced by one that serves a table describing that
// fixture, through the real wire format (`system/mft-wire.js`) and the real
// `scan:run` path. So everything in these pictures is real except the raw
// volume read itself, which needs a UAC prompt nobody can answer from a
// script -- that half is `npm run verify:mft`.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootfast-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootfast';
require('../src/main/lib/preview/serve').registerScheme();

const wire = require('../src/main/system/mft-wire');
const ntfs = require('../src/main/system/ntfs');

const SUBST = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'subst.exe');
const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-fastscan.js'))
  || path.join(os.tmpdir(), 'cd-fastscan-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function write(file, bytes, ageDays = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crypto.randomBytes(bytes));
  if (ageDays) fs.utimesSync(file, new Date(Date.now() - ageDays * 86400000), new Date(Date.now() - ageDays * 86400000));
}

/**
 * The fixture, described the way `$MFT` describes it.
 *
 * Read back off the disk rather than generated, so the sizes and times are
 * the filesystem's own and a picture cannot show a total the folder does not
 * have.
 */
function tableOf(root) {
  const folders = new Map();
  const files = new wire.Columns();
  const numberOf = new Map([[root.toLowerCase(), ntfs.ROOT_RECORD]]);
  let next = 16;

  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const parent = numberOf.get(dir.toLowerCase());
      const stat = fs.lstatSync(full);
      const number = next++;
      numberOf.set(full.toLowerCase(), number);
      if (entry.isDirectory()) {
        folders.set(number, { parent, name: entry.name, attributes: 0x10, reparseTag: 0 });
        visit(full);
        continue;
      }
      files.append({
        count: 1,
        name: [entry.name],
        parent: [parent],
        size: [stat.size],
        allocated: [Math.ceil(stat.size / 4096) * 4096],
        modified: [stat.mtimeMs],
        accessed: [stat.atimeMs],
        created: [stat.birthtimeMs],
        attributes: [0x20],
        reparse: [0],
      });
    }
  };
  visit(root);
  return { folders, files };
}

/**
 * A helper client that is elevated, answers `mft.scan` out of that table, and
 * sends it in pieces the way the real one does.
 */
function fakeHelper(table, { declined = false, slow = 0 } = {}) {
  return {
    start: async () => {
      if (declined) throw Object.assign(new Error('The administrator prompt was declined'), { code: 'EDECLINED' });
      return this;
    },
    stop: () => {},
    request: async (op, args, { onChunk } = {}) => {
      if (op === 'ping') return { pid: process.pid, integrity: 'high', elevated: true };
      if (op !== 'mft.scan') throw new Error(`unknown op ${op}`);
      const records = table.files.length + table.folders.size;
      for (let sent = 0; sent <= records; sent += Math.max(1, Math.round(records / 6))) {
        onChunk({ kind: 'progress', pass: 'files', records: Math.min(sent, records), of: records });
        if (slow) await wait(slow);
      }
      for (const chunk of wire.chunksOf(table.folders, table.files, { maxBytes: 64 * 1024, maxRecords: 64 })) {
        onChunk(JSON.parse(JSON.stringify(chunk)));
      }
      return {
        drive: String(args.drive).toUpperCase() + ':',
        boot: { bytesPerSector: 512, clusterBytes: 4096, recordBytes: 1024 },
        mftBytes: records * 1024,
        extents: 4,
        recordsRead: records + 64,
        fileCount: table.files.length,
        folderCount: table.folders.size,
        torn: 0,
        unused: 64,
        skipped: 0,
        withList: 0,
        spilled: 0,
        ms: 5400,
      };
    },
  };
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  const cleanups = [];
  try {
    require('../src/main/lib/preview/serve').serve();
    const ipc = require('../src/main/ipc');
    ipc.register();
    const picks = [];
    ipc.setScanHarness({ pick: async () => picks.shift() || null });
    fs.mkdirSync(OUT, { recursive: true });

    // On D:, never under os.tmpdir(): the system temp folder is inside
    // AppData, which the scan's own rules refuse, and a fixture there would
    // photograph an empty result.
    const work = path.join('D:\\', `cleandrive-shootfast-${crypto.randomBytes(4).toString('hex')}`);
    cleanups.push(() => fs.rmSync(work, { recursive: true, force: true }));
    write(path.join(work, 'Phim', 'Đà Lạt 2025.mp4'), 42 * 1024 * 1024);
    write(path.join(work, 'Phim', 'Tết nhà ngoại.mov'), 27 * 1024 * 1024);
    write(path.join(work, 'Ảnh', '2024', 'biển.jpg'), 8 * 1024 * 1024);
    write(path.join(work, 'Ảnh', '2025', 'sinh nhật.jpg'), 6 * 1024 * 1024);
    write(path.join(work, 'Tài liệu', 'hợp đồng.pdf'), 4 * 1024 * 1024);
    write(path.join(work, 'Tài liệu', 'báo cáo quý.xlsx'), 2 * 1024 * 1024);
    write(path.join(work, 'Temp', 'render.tmp'), 19 * 1024 * 1024, 90);
    write(path.join(work, 'Temp', 'cũ.log'), 11 * 1024 * 1024, 200);
    write(path.join(work, 'Bản cài', 'setup-2019.exe'), 31 * 1024 * 1024, 400);

    const letter = ['S', 'T', 'U', 'V', 'W', 'X', 'Y'].find((l) => !fs.existsSync(`${l}:\\`));
    if (!letter) throw new Error('no spare drive letter for subst');
    execFileSync(SUBST, [`${letter}:`, work]);
    cleanups.unshift(() => execFileSync(SUBST, [`${letter}:`, '/d']));
    const whole = `${letter}:\\`;

    const table = tableOf(whole);
    console.log(`\noutput: ${OUT}\nwhole drive: ${whole}  (${table.files.length} files, ${table.folders.size} folders in the table)\n`);
    ipc.setHelperClientForHarness(() => fakeHelper(table, { slow: 220 }));

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
    nativeTheme.themeSource = 'light';
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    const until = async (expr, ms = 60000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await js(`return Boolean(${expr})`)) return true;
        await wait(150);
      }
      return false;
    };
    await wait(600);

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
    const status = () => js(`return document.getElementById('scan-status').textContent;`);

    /* -- the switch is offered for a whole drive and nothing smaller ------ */

    picks.push(path.join(work, 'Ảnh'));
    await js(`document.getElementById('pick-folder').click();`);
    await until(`state.folder !== null`, 5000);
    console.log(`  one folder: switch shown = ${await js("return !document.getElementById('fast-scan-box').hidden;")}`);
    await shoot('folder-no-switch-light');

    await js(`setRoots([${JSON.stringify(whole)}]); document.querySelector('.tab[data-tab="usage"]').click();`);
    await wait(400);
    console.log(`  whole drive: switch shown = ${await js("return !document.getElementById('fast-scan-box').hidden;")}`);
    await shoot('switch-light');
    await theme('dark');
    await shoot('switch-dark');
    await theme('light');

    /* -- reading the catalogue -------------------------------------------- */

    await js(`document.getElementById('fast-scan').checked = true; document.getElementById('scan-stats').hidden = true; document.getElementById('run-scan').click();`);
    await until(`/catalogue|mục lục/.test(document.getElementById('scan-status').textContent)`, 20000);
    console.log(`  while reading: ${await status()}`);
    await shoot('reading-light');

    await until(`!document.getElementById('scan-stats').hidden && document.getElementById('cancel-scan').hidden`, 120000);
    await js(`document.querySelector('main').scrollTop = 0;`);
    console.log(`  after:  ${await status()}`);
    await shoot('done-light');
    await theme('dark');
    await shoot('done-dark');
    await theme('light');

    /* -- and when the prompt is declined ---------------------------------- */

    ipc.setHelperClientForHarness(() => fakeHelper(table, { declined: true }));
    await js(`document.getElementById('scan-stats').hidden = true; document.getElementById('run-scan').click();`);
    await until(`!document.getElementById('scan-stats').hidden && document.getElementById('cancel-scan').hidden`, 120000);
    await js(`document.querySelector('main').scrollTop = 0;`);
    console.log(`  declined: ${await status()}`);
    await shoot('declined-light');
    ipc.setHelperClientForHarness(() => fakeHelper(table, { slow: 40 }));

    /* -- Vietnamese, and narrow ------------------------------------------- */

    await js(`document.querySelector('.tab[data-tab="settings"]').click(); document.querySelector('[data-language-choice="vi"]').click();`);
    await wait(800);
    await js(`document.querySelector('.tab[data-tab="usage"]').click(); document.getElementById('fast-scan').checked = true; document.getElementById('scan-stats').hidden = true; document.getElementById('run-scan').click();`);
    await until(`!document.getElementById('scan-stats').hidden && document.getElementById('cancel-scan').hidden`, 120000);
    await js(`document.querySelector('main').scrollTop = 0;`);
    console.log(`  tiếng Việt: ${await status()}`);
    await shoot('done-vi-light');
    await theme('dark');
    await shoot('done-vi-dark');
    await theme('light');

    win.setSize(680, 820);
    await wait(500);
    await shoot('done-vi-narrow');
    console.log(`  narrow: switch still shown = ${await js("return !document.getElementById('fast-scan-box').hidden;")}`);

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
