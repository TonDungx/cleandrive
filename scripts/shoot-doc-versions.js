'use strict';

// Screenshots of F3: documents whose names look like drafts of one another,
// the two opened side by side, and the refusal on Free -- in both themes, in
// Vietnamese and narrow.
//
//   npx electron scripts/shoot-doc-versions.js [outputDir]
//
// Throwaway userData, a suffixed task name, a fixture of its own on D:.
//
// Nothing here is staged: the real duplicate pipeline walks a real fixture and
// the real screen draws what comes back. The fixture goes on `D:` rather than
// under `os.tmpdir()`, which is inside AppData.
//
// The documents are not real documents -- this pass reads names and never
// opens a file, so the bytes only have to be the right size. The two that get
// photographed side by side are text, which the viewer really can read.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootf3-'));
app.setPath('userData', SANDBOX);
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootf3';
require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-doc-versions.js'))
  || path.join(os.tmpdir(), 'cd-f3-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const KB = 1024;

app.on('window-all-closed', () => {});

/**
 * A readable draft, so the side-by-side shot has something on both sides.
 *
 * Long enough to clear F3's own 4 KB floor -- the first version of this wrote
 * two kilobytes of notes and the pass, correctly, refused to call them
 * documents.
 */
function draft(file, title, paragraphs) {
  const lines = [title, ''.padEnd(title.length, '='), ''];
  for (let i = 1; i <= paragraphs; i++) {
    lines.push(`${i}. Muc nay noi ve phan ${i} cua tai lieu, va khong thay doi`);
    lines.push('   giua cac ban nhap tru cac cho da duoc danh dau ro rang o duoi.');
    lines.push('');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = lines.join('\r\n');
  if (Buffer.byteLength(text) < 4 * KB) throw new Error(`${file} is under F3's floor`);
  fs.writeFileSync(file, text, 'utf8');
}

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');

  const base = fs.mkdtempSync(path.join('D:\\', 'cleandrive-shoot-f3-'));
  if (!base.toLowerCase().startsWith('d:\\')) throw new Error(`fixture is not on D: (${base})`);
  if (base.toLowerCase().startsWith(os.tmpdir().toLowerCase())) throw new Error('fixture is inside AppData');

  try {
    require('../src/main/lib/preview/serve').serve();
    require('../src/main/ipc').register();
    fs.mkdirSync(OUT, { recursive: true });

    const put = (rel, kb, fill) => {
      const full = path.join(base, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, Buffer.alloc(kb * KB, fill));
    };

    // Found: three drafts of one report, same folder, same format.
    put('Bao cao\\Bao cao quy 3.docx', 260, 1);
    put('Bao cao\\Bao cao quy 3 - Copy.docx', 245, 2);
    put('Bao cao\\Bao cao quy 3_final.docx', 288, 3);
    // Found: one piece of work exported three times.
    put('Bai nop\\Group 04 - Operating Systems.pptx', 180, 4);
    put('Bai nop\\Group 04 - Operating Systems.pdf', 160, 5);
    put('Bai nop\\Group 04 - Operating Systems.docx', 120, 6);
    // Found, and readable: the pair the viewer opens side by side.
    draft(path.join(base, 'Ghi chu\\Ke hoach.txt'), 'KE HOACH THANG 9', 46);
    draft(path.join(base, 'Ghi chu\\Ke hoach_v2.txt'), 'KE HOACH THANG 9 (ban 2)', 58);
    // Found: the same only once a date comes off, and one of them says copy.
    put('Hop dong\\Hop dong thue nha 2026-01-15.pdf', 95, 7);
    put('Hop dong\\Hop dong thue nha 2026-01-16 - Copy.pdf', 98, 8);
    // Left out, and counted: these differ by nothing but a date.
    put('Nhat ky\\Log 2026-06-13.txt', 40, 9);
    put('Nhat ky\\Log 2026-09-26.txt', 44, 10);
    // Left out, and counted: a common name in two unrelated folders.
    put('pkg-a\\CHANGELOG.md', 12, 11);
    put('pkg-b\\CHANGELOG.md', 14, 12);

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

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'en' } });
    nativeTheme.themeSource = 'light';
    win.focus();
    const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
    await wait(800);

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
    const until = async (expr, ms = 120000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (await win.webContents.executeJavaScript(`Boolean(${expr})`)) return true;
        await wait(200);
      }
      throw new Error(`timed out: ${expr}`);
    };

    // The minimum size stays at the screen's own default, and every document
    // in the fixture is under it. A floor chosen for "which copies are worth
    // deleting" must not decide which documents exist.
    const run = async () => {
      await js(`
        document.querySelector('.tab[data-tab="dupes"]').click();
        document.getElementById('min-size').value = '102400';
        document.getElementById('dupes-versions').checked = true;
        document.getElementById('run-dupes').click();
      `);
      await until(`document.getElementById('cancel-dupes').hidden === true`);
      await wait(600);
    };

    await js(`setFolder(${JSON.stringify(base)});`);
    await until(`document.getElementById('run-dupes').disabled === false`);
    await run();

    const found = await win.webContents.executeJavaScript(`({
      sets: document.querySelectorAll('#dupe-versions .group-versions').length,
      rows: document.querySelectorAll('#dupe-versions .files > li').length,
      ticked: document.querySelectorAll('#dupe-versions input:checked').length,
      note: document.getElementById('dupe-versions-note').textContent,
    })`);
    console.log(`  ${found.sets} sets, ${found.rows} documents, ${found.ticked} ticked`);
    console.log(`  ${found.note}\n`);
    if (found.sets === 0) throw new Error('the fixture produced nothing to photograph');
    if (found.ticked !== 0) throw new Error('something was ticked without being asked');

    await js(`document.getElementById('dupe-versions-section').scrollIntoView({ block: 'start' });`);
    await shoot('versions-light');
    await theme('dark');
    await shoot('versions-dark');
    await theme('light');

    // The reasons behind one row, which is where the hedging has to be legible.
    await js(`document.querySelector('#dupe-versions .files .badge-button').click();`);
    await wait(400);
    await js(`document.querySelector('#dupe-versions .files > li').scrollIntoView({ block: 'center' });`);
    await shoot('evidence-light');
    await theme('dark');
    await shoot('evidence-dark');
    await theme('light');
    await js(`document.querySelector('#dupe-versions .files .badge-button').click();`);

    // Two of them at once, which is the whole answer to "are these the same?".
    await js(`
      (() => {
        const sets = [...document.querySelectorAll('#dupe-versions .group-versions')];
        const readable = sets.find((s) => s.textContent.includes('Ke hoach.txt'));
        readable.querySelector('.btn').click();
      })()
    `);
    await until(`document.querySelectorAll('#viewer .compare-pane .viewer-text').length === 2`, 30000);
    await shoot('side-by-side-light');
    await theme('dark');
    await shoot('side-by-side-dark');
    await theme('light');

    // Narrow: below 860px the two columns stack rather than becoming two
    // columns too thin to read a line of a document in.
    win.setBounds({ width: 820, height: 900 });
    await wait(600);
    await shoot('side-by-side-narrow');
    win.setBounds({ width: 1180, height: 900 });
    await wait(500);
    await js(`document.getElementById('viewer-close').click();`);
    await until(`document.getElementById('viewer').hidden === true`);

    // Narrow, on the list itself.
    win.setBounds({ width: 820, height: 900 });
    await wait(600);
    await js(`document.getElementById('dupe-versions-section').scrollIntoView({ block: 'start' });`);
    await shoot('versions-narrow');
    win.setBounds({ width: 1180, height: 900 });
    await wait(500);

    // Vietnamese, where every one of these sentences is longest.
    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="vi"]').click();
    `);
    await wait(700);
    await run();
    await js(`document.getElementById('dupe-versions-section').scrollIntoView({ block: 'start' });`);
    await shoot('versions-vi');
    console.log(`  vi: ${await win.webContents.executeJavaScript(
      `document.getElementById('dupe-versions-note').textContent`)}\n`);

    // Refused on Free, out loud rather than quietly downgraded.
    process.env.CLEANDRIVE_ENTITLEMENTS = 'free';
    await js(`
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="en"]').click();
    `);
    await wait(700);
    await run();
    await js(`document.getElementById('dupes-status').scrollIntoView({ block: 'center' });`);
    await shoot('refused-free-light');
    console.log(`  free: ${await win.webContents.executeJavaScript(
      `document.getElementById('dupes-status').textContent`)}`);
    process.env.CLEANDRIVE_ENTITLEMENTS = 'all';

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
