'use strict';

// Screenshots of F4: the switch in Settings, the join button on the
// Duplicates screen, and the confirmation that has to be scrolled through --
// in both themes, in Vietnamese, and at two narrow widths.
//
//   npx electron scripts/shoot-hardlink.js [outputDir]
//
// Throwaway userData, a suffixed task name, a fixture of its own on D:.
//
// Nothing is staged. The real duplicate pipeline walks a real fixture, the
// real dialog opens on a real dry run from the main process, and the join at
// the end makes real hard links which the script then reads back. The fixture
// is on `D:` rather than under `os.tmpdir()`, which is inside AppData on C:
// and would make "both copies are on one drive" true by accident.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootf4-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootf4';
require('../src/main/lib/preview/serve').registerScheme();

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-hardlink.js')) ||
  path.join(os.tmpdir(), 'cd-f4-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const KB = 1024;

app.on('window-all-closed', () => {});

/**
 * A fixture with something to say in every column.
 *
 * Ages are set rather than left to chance: which copy is kept is decided by
 * age, and files written in one millisecond fall back to sorting by name --
 * which once made the copy the keeper and left nothing to join.
 */
function build(root) {
  const put = (name, bytes, fill, ageDays) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(bytes, fill));
    const when = new Date(Date.now() - ageDays * 86400000);
    fs.utimesSync(file, when, when);
  };

  // One group of ordinary copies, spread across folders the way real ones are.
  put('renders/final-render.png', 2600 * KB, 7, 400);
  put('renders/backup/final-render.png', 2600 * KB, 7, 120);
  put('sent to client/final-render.png', 2600 * KB, 7, 30);

  // A second group, smaller, so the screen shows more than one card.
  put('audio/theme.wav', 1400 * KB, 9, 300);
  put('audio/old/theme.wav', 1400 * KB, 9, 60);

  // Documents, which are refused -- and the dialog has to say so.
  put('contracts/agreement.docx', 900 * KB, 5, 500);
  put('contracts/2024/agreement.docx', 900 * KB, 5, 90);
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');

  const base = fs.mkdtempSync(path.join('D:\\', 'cleandrive-shoot-f4-'));
  if (!base.toLowerCase().startsWith('d:\\')) throw new Error(`fixture is not on D: (${base})`);
  if (base.toLowerCase().startsWith(os.tmpdir().toLowerCase())) throw new Error('fixture is inside AppData');

  try {
    require('../src/main/lib/preview/serve').serve();
    require('../src/main/ipc').register();
    fs.mkdirSync(OUT, { recursive: true });

    build(base);
    console.log(`\nfixture: ${base}`);
    console.log(`output:  ${OUT}\n`);

    const win = new BrowserWindow({
      width: 1180,
      height: 900,
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

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), {
      query: { theme: 'light', lang: 'en' },
    });
    nativeTheme.themeSource = 'light';
    win.focus();
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    const read = (expr) => win.webContents.executeJavaScript(expr);
    await wait(800);

    const shoot = async (name) => {
      await wait(400);
      win.webContents.invalidate();
      // The first frame after a repaint is routinely the one before the change,
      // so it is taken and thrown away.
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
    const until = async (expr, ms = 120000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await read(`Boolean(${expr})`)) return true;
        await wait(200);
      }
      throw new Error(`timed out: ${expr}`);
    };

    /* -- the switch, in Settings ----------------------------------------- */

    await js(`document.querySelector('.tab[data-tab="settings"]').click();`);
    await until(`document.getElementById('developer-hardlink')`);
    await js(`document.getElementById('developer-card').scrollIntoView({ block: 'center' });`);
    await shoot('settings-off-light');
    await theme('dark');
    await shoot('settings-off-dark');
    await theme('light');

    await js(`
      const box = document.getElementById('developer-hardlink');
      box.checked = true;
      box.dispatchEvent(new Event('change'));
    `);
    await until(`document.getElementById('hardlink-dupes').hidden === false`, 20000);
    await js(`document.getElementById('developer-card').scrollIntoView({ block: 'center' });`);
    await shoot('settings-on-light');

    /* -- the scan --------------------------------------------------------- */

    const run = async () => {
      await js(`
        document.querySelector('.tab[data-tab="dupes"]').click();
        document.getElementById('min-size').value = '102400';
        document.getElementById('run-dupes').click();
      `);
      await until(`document.getElementById('cancel-dupes').hidden === true`);
      await wait(600);
    };

    await js(`setFolder(${JSON.stringify(base)});`);
    await until(`document.getElementById('run-dupes').disabled === false`);
    await run();

    const found = await read(`({
      groups: document.querySelectorAll('#dupe-groups .group').length,
      rows: document.querySelectorAll('#dupe-groups .file-row').length,
      waste: document.getElementById('dstat-waste').textContent,
    })`);
    console.log(`  ${found.groups} groups, ${found.rows} rows, ${found.waste} reclaimable\n`);
    if (found.groups < 2) throw new Error('the fixture produced too little to photograph');

    // Everything but the keeper, which is what the button beside it does.
    await js(`
      document.getElementById('select-extra').click();
      document.getElementById('dupes-actionbar').scrollIntoView({ block: 'center' });
    `);
    await shoot('button-light');
    await theme('dark');
    await shoot('button-dark');
    await theme('light');

    // The width the Photos bar was found to break at, and the one below it.
    // Three buttons and their sentences do not fit on one line here.
    for (const width of [1180, 900]) {
      win.setBounds({ width, height: 900 });
      await wait(600);
      await js(`document.getElementById('dupes-actionbar').scrollIntoView({ block: 'center' });`);
      await shoot(`bar-${width}`);
    }
    win.setBounds({ width: 1180, height: 900 });
    await wait(500);

    /* -- the confirmation ------------------------------------------------- */

    const openDialog = async () => {
      await js(`document.getElementById('hardlink-dupes').click();`);
      await until(`document.getElementById('hardlink').open === true`);
      await wait(700);
    };
    await openDialog();

    const room = await read(
      `document.getElementById('hardlink-body').scrollHeight - document.getElementById('hardlink-body').clientHeight`
    );
    console.log(`  the confirmation has ${room}px of scrolling in it`);

    await shoot('dialog-top-light');
    await theme('dark');
    await shoot('dialog-top-dark');
    await theme('light');

    // Scrolled to the end: the button is live and the line under it says so.
    await js(`
      const el = document.getElementById('hardlink-body');
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    `);
    await wait(400);
    await shoot('dialog-end-light');
    await theme('dark');
    await shoot('dialog-end-dark');
    await theme('light');

    // Narrow, at both widths the roadmap asks for. The dialog's rows are three
    // columns at full width and have to stack rather than overflow.
    for (const width of [720, 560]) {
      win.setBounds({ width, height: 900 });
      await wait(600);
      await js(`
        const el = document.getElementById('hardlink-body');
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event('scroll'));
      `);
      await shoot(`dialog-${width}`);
    }
    win.setBounds({ width: 1180, height: 900 });
    await wait(500);

    /* -- Vietnamese, where the sentences are longest ---------------------- */

    await js(`document.getElementById('hardlink-cancel').click();`);
    await wait(300);
    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="vi"]').click();
    `);
    await wait(900);
    await js(`document.getElementById('developer-card').scrollIntoView({ block: 'center' });`);
    await shoot('settings-vi');

    await run();
    await js(`document.getElementById('select-extra').click();`);
    await openDialog();
    await shoot('dialog-top-vi');
    await js(`
      const el = document.getElementById('hardlink-body');
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    `);
    await wait(400);
    await shoot('dialog-end-vi');

    win.setBounds({ width: 560, height: 900 });
    await wait(600);
    await shoot('dialog-vi-560');
    win.setBounds({ width: 1180, height: 900 });
    await wait(500);

    /* -- and actually do it, so the "after" is a real after ---------------- */

    await js(`document.getElementById('hardlink-go').click();`);
    await until(`document.getElementById('hardlink').open === false`, 20000);
    await until(`document.getElementById('delete-progress').hidden === true`, 120000);
    await wait(900);
    await shoot('after-vi');

    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="en"]').click();
    `);
    await wait(900);
    await js(`document.querySelector('.tab[data-tab="dupes"]').click();`);
    await wait(500);
    await shoot('after-light');
    await theme('dark');
    await shoot('after-dark');
    await theme('light');

    // What the disk says, as opposed to what the screen says.
    const linked = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          const st = fs.statSync(full, { bigint: true });
          if (Number(st.nlink) > 1) linked.push(`${path.relative(base, full)} (nlink=${st.nlink})`);
        }
      }
    };
    walk(base);
    console.log(`\n  names sharing a file afterwards: ${linked.length}`);
    for (const one of linked) console.log(`    ${one}`);

    const afterWaste = await read(`document.getElementById('dstat-waste').textContent`);
    console.log(`  reclaimable now: ${afterWaste} (was ${found.waste})`);

    // The Restore Center, which is where undoing lives.
    await js(`document.querySelector('.tab[data-tab="restore"]').click();`);
    await wait(1200);
    await shoot('restore-light');
    await theme('dark');
    await shoot('restore-dark');

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
