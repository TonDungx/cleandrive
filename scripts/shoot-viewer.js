'use strict';

// Screenshots of the file viewer, one per kind it can show.
//
//   npx electron scripts/shoot-viewer.js [outputDir]
//
// Points at real files on this machine, because the whole question the viewer
// answers is what real files look like: a PDF that is genuinely thirteen pages
// of Japanese, a log with real line endings, a spreadsheet nobody wrote for a
// test. Fixtures would prove the code runs and nothing about whether it helps.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { app, BrowserWindow, nativeTheme } = require('electron');

app.setName(require('../package.json').name);
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootview-')));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootview';

require('../src/main/lib/preview/serve').registerScheme();

const OUT = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-viewer.js'))
  || path.join(os.tmpdir(), 'cd-viewer-shots');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One real file per extension, chosen by its bytes rather than by its name. */
async function findByExt(wanted) {
  const found = new Map();
  const queue = ['Downloads', 'Documents', 'OneDrive', 'Videos']
    .map((n) => path.join(os.homedir(), n)).filter((p) => fs.existsSync(p));
  let hops = 0;

  while (queue.length && found.size < wanted.length && hops++ < 6000) {
    const dir = queue.shift();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !e.name.startsWith('$') && e.name !== 'node_modules') queue.push(full);
        continue;
      }
      if (!e.isFile() || e.name.startsWith('~$')) continue;
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (!wanted.includes(ext) || found.has(ext)) continue;
      let size;
      try { size = (await fsp.stat(full)).size; } catch { continue; }
      if (size < 400 || size > 60 * 1024 * 1024) continue;
      // An Office extension is not a promise. The first `.docx` on this machine
      // is a rights-managed wrapper that is not a ZIP at all, and shooting it
      // produced a picture of the refusal card rather than of the Word reader.
      if (['docx', 'xlsx', 'pptx', 'zip'].includes(ext) && !(await isZip(full))) continue;
      found.set(ext, full);
    }
  }
  return found;
}

async function isZip(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const buf = Buffer.alloc(4);
    await handle.read(buf, 0, 4, 0);
    return buf.readUInt32LE(0) === 0x04034b50;
  } catch {
    return false;
  } finally {
    if (handle) await handle.close();
  }
}

app.whenReady().then(async () => {
  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();

  fs.mkdirSync(OUT, { recursive: true });
  const wanted = ['pdf', 'log', 'csv', 'json', 'md', 'jpg', 'png', 'mp4', 'xlsx', 'docx', 'xls', 'pptx', 'zip'];
  const files = await findByExt(wanted);
  console.log(`\noutput: ${OUT}`);
  for (const [ext, file] of files) console.log(`  .${ext.padEnd(5)} ${path.basename(file).slice(0, 56)}`);
  console.log('');

  const win = new BrowserWindow({
    width: 1280, height: 860, show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true,
    },
  });

  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const level = typeof args[1] === 'object' ? args[1].level : args[1];
    const message = typeof args[1] === 'object' ? args[1].message : args[2];
    if (level === 3 || level === 'error') errors.push(message);
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (expr) => win.webContents.executeJavaScript(expr);
  await wait(500);

  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
    await wait(250);

    for (const [ext, file] of files) {
      await js(`openViewer(${JSON.stringify(file)})`);
      // A PDF and a video need a moment to decode their first frame; text is
      // instant but waiting the same amount keeps the timing uniform.
      await wait(ext === 'pdf' || ext === 'mp4' ? 2000 : 700);

      const state = await js(`({
        kind: (document.getElementById('viewer-body').className.match(/is-([a-z-]+)/) || [])[1],
        facts: document.getElementById('viewer-facts').textContent,
        hasFrame: Boolean(document.querySelector('.viewer-frame')),
        hasText: Boolean(document.querySelector('.viewer-text')),
        chars: (document.querySelector('.viewer-text') || {}).textContent?.length || 0,
      })`);

      let bytes = (await win.webContents.capturePage()).toPNG();
      for (let n = 0; n < 3 && bytes.length === 0; n++) {
        await wait(400);
        bytes = (await win.webContents.capturePage()).toPNG();
      }
      const out = path.join(OUT, `viewer-${ext}-${theme}.png`);
      fs.writeFileSync(out, bytes);
      console.log(`  ${`${ext}/${theme}`.padEnd(12)} ${String(state.kind).padEnd(14)} ${state.chars ? `${state.chars} chars` : ''} ${state.facts.slice(0, 54)}`);

      await js(`closeViewer()`);
      await wait(150);
    }
  }

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  console.log(`${files.size * 2} screenshots in ${OUT}\n`);
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
