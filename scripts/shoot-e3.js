'use strict';

// Screenshots of E3: the button on the Photos bar, the dialog with its
// estimate, the run, and the original beside its smaller copy -- in both
// themes, in Vietnamese, and at the two narrow widths.
//
//   npx electron scripts/shoot-e3.js [outputDir]
//
// Throwaway userData, a suffixed task name, a fixture of its own on D:.
//
// Nothing is staged. The fixture clips are encoded by Chromium's own encoder,
// the dialog's estimate comes from a real trial encode through the real IPC,
// and the copies at the end are written by the real muxer. The script then puts
// two questions to things that are **not** this project's code: does the
// Windows shell draw a thumbnail of the copy, and will a `<video>` element play
// it? A muxer that only satisfies its own demuxer has proved nothing.
//
// The fixture is on `D:` because `os.tmpdir()` is inside AppData on C:, and
// cleanup is in `process.on('exit')` rather than at the end of the function --
// a run that throws half way through would otherwise leave clips on D:.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme, nativeImage } = require('electron');

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shoote3-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shoote3';
require('../src/main/lib/preview/serve').registerScheme();

const { openEncoder, writeClip } = require('./lib/video-fixture');

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-e3.js')) ||
  path.join(os.tmpdir(), 'cd-e3-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => {});

/* -- the fixture, removed however this process ends ------------------------ */

const BASE = fs.mkdtempSync(path.join('D:\\', 'cleandrive-shoot-e3-'));
process.on('exit', () => {
  try {
    fs.rmSync(BASE, { recursive: true, force: true });
  } catch {
    // Nothing useful to do while exiting; the path is printed above either way.
  }
});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  if (!BASE.toLowerCase().startsWith('d:\\')) throw new Error(`fixture is not on D: (${BASE})`);
  if (BASE.toLowerCase().startsWith(os.tmpdir().toLowerCase())) throw new Error('fixture is inside AppData');
  // `os.tmpdir()` is on C: here, and a fixture that shared a drive with it
  // would make "these are on different drives" true by accident.
  if (BASE[0].toLowerCase() === os.tmpdir()[0].toLowerCase()) throw new Error('fixture shares a drive with tmpdir');

  require('../src/main/lib/preview/serve').serve();
  require('../src/main/ipc').register();
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`\nfixture: ${BASE}`);
  console.log(`output:  ${OUT}\n`);

  /* -- clips ---------------------------------------------------------------- */

  const encoder = await openEncoder(path.join(SANDBOX, 'fixture'));
  const clips = [];
  const plan = [
    { name: 'screen-recording.mp4', width: 1280, height: 720, seconds: 6, seed: 1, ageDays: 12 },
    { name: 'holiday-clip.mp4', width: 1280, height: 720, seconds: 4, seed: 2, ageDays: 40 },
    { name: 'phone-portrait.mp4', width: 720, height: 1280, seconds: 3, seed: 3, ageDays: 80 },
  ];
  for (const one of plan) {
    const made = await writeClip(encoder, { ...one, file: path.join(BASE, one.name) });
    clips.push(made);
    console.log(`  ${one.name}: ${(made.size / 1024 / 1024).toFixed(2)} MB, ${made.frames} frames, ${made.codec}`);
  }
  encoder.destroy();

  // And one file that is a video by name and nothing by content, so the dialog
  // has something real to refuse.
  fs.writeFileSync(path.join(BASE, 'broken-download.mp4'), Buffer.alloc(80 * 1024, 0x2a));
  const old = new Date(Date.now() - 5 * 86400000);
  fs.utimesSync(path.join(BASE, 'broken-download.mp4'), old, old);

  /* -- the window ----------------------------------------------------------- */

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
    // The first frame after a repaint is routinely the one before the change.
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let k = 0; k < 3 && bytes.length === 0; k += 1) {
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
  const until = async (expr, ms = 180000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await read(`Boolean(${expr})`)) return true;
      await wait(200);
    }
    throw new Error(`timed out: ${expr}`);
  };

  /* -- scan the fixture folder ---------------------------------------------- */

  // Through the screen's own controls rather than by assignment, because the
  // feature re-scans after it writes a copy and that re-scan reads whatever the
  // "Where to look" list says. Setting `media.files` directly would leave the
  // list pointing at the real Pictures folder, and the re-scan at the end would
  // walk somebody's actual library instead of the fixture.
  await js(`document.querySelector('.tab[data-tab="media"]').click();`);
  await wait(400);
  await js(`
    for (const root of media.roots) root.on = false;
    media.extraRoots = [{ path: ${JSON.stringify(BASE)}, name: 'Fixture', why: null, on: true }];
    renderRoots();
    document.getElementById('media-roots-card').hidden = true;
    document.getElementById('media-scan').click();
  `);
  await until(`document.getElementById('media-cancel').hidden && media.files.length > 0`, 60000);
  await js(`window.__fixtureFiles = media.files.map((f) => f.path);`);
  await until(`document.querySelectorAll('#media-canvas .media-cell').length >= 3`, 30000);
  const found = await read(`document.querySelectorAll('#media-canvas .media-cell').length`);
  console.log(`\n  ${found} files in the grid\n`);
  if (found < 4) throw new Error('the fixture produced too little to photograph');

  /* -- the bar, with and without a video in the selection -------------------- */

  // A photograph-only selection must not grow a seventh button. There are no
  // photographs in this fixture, so this is checked by selecting nothing.
  await js(`
    media.selected.clear();
    updateSelection();
    document.getElementById('media-actionbar').scrollIntoView({ block: 'center' });
  `);
  const hiddenWhenEmpty = await read(`document.getElementById('media-shrink').hidden`);
  console.log(`  button hidden with nothing selected: ${hiddenWhenEmpty}`);

  await js(`
    media.selected.clear();
    for (const p of window.__fixtureFiles) media.selected.add(p);
    updateSelection();
    document.getElementById('media-actionbar').scrollIntoView({ block: 'center' });
  `);
  await until(`document.getElementById('media-shrink').hidden === false`, 10000);
  await shoot('bar-light');
  await theme('dark');
  await shoot('bar-dark');
  await theme('light');

  // The width the Photos bar was measured to break at in E2, and the two
  // narrow ones. A seventh button is exactly the change that breaks it again.
  for (const width of [1180, 900, 720]) {
    win.setBounds({ width, height: 900 });
    await wait(600);
    await js(`document.getElementById('media-actionbar').scrollIntoView({ block: 'center' });`);
    await shoot(`bar-${width}`);
    const clipped = await read(`(() => {
      const bar = document.getElementById('media-actionbar');
      const edge = bar.getBoundingClientRect().right;
      const out = [];
      for (const b of bar.querySelectorAll('button')) {
        if (b.hidden) continue;
        const r = b.getBoundingClientRect();
        if (r.right > edge + 1 || r.left < bar.getBoundingClientRect().left - 1) out.push(b.id);
      }
      return out;
    })()`);
    console.log(`    ${width}px: buttons outside the bar: ${clipped.length ? clipped.join(', ') : 'none'}`);
  }
  win.setBounds({ width: 1180, height: 900 });
  await wait(500);

  /* -- the dialog, and its estimate ------------------------------------------ */

  await js(`document.getElementById('media-shrink').click();`);
  await until(`document.getElementById('shrink').open === true`, 20000);
  await shoot('dialog-estimating');

  const started = Date.now();
  await until(`document.getElementById('shrink-go').disabled === false`, 180000);
  console.log(`\n  the trial encode of 3 clips took ${((Date.now() - started) / 1000).toFixed(1)} s\n`);

  await shoot('dialog-light');
  await theme('dark');
  await shoot('dialog-dark');
  await theme('light');

  const estimate = await read(`({
    text: document.getElementById('shrink-estimate').textContent,
    rows: [...document.querySelectorAll('.shrink-row')].map((r) => r.textContent),
    refused: document.getElementById('shrink-refusals').textContent,
  })`);
  console.log(`  estimate: ${estimate.text.slice(0, 160)}`);
  for (const row of estimate.rows) console.log(`    ${row}`);
  console.log(`  refused: ${estimate.refused || '(none)'}`);

  // The other level, which should estimate lower and say so.
  await js(`document.getElementById('shrink-level-smallest').click();`);
  await until(`document.getElementById('shrink-go').disabled === false`, 180000);
  await shoot('dialog-smallest');
  const smallest = await read(`document.getElementById('shrink-estimate').textContent`);
  console.log(`  smallest: ${smallest.slice(0, 160)}`);

  await js(`document.getElementById('shrink-level-balanced').click();`);
  await until(`document.getElementById('shrink-go').disabled === false`, 180000);

  /* -- Vietnamese, and the narrow widths ------------------------------------- */

  await js(`
    document.querySelector('.tab[data-tab="settings"]').click();
    document.querySelector('[data-language-choice="vi"]').click();
  `);
  await wait(1000);
  await js(`document.querySelector('.tab[data-tab="media"]').click();`);
  await wait(500);
  await shoot('dialog-vi');

  for (const width of [720, 560]) {
    win.setBounds({ width, height: 900 });
    await wait(700);
    await shoot(`dialog-vi-${width}`);
  }
  win.setBounds({ width: 1180, height: 900 });
  await wait(600);

  const viText = await read(`document.getElementById('shrink-estimate').textContent`);
  console.log(`\n  in Vietnamese: ${viText.slice(0, 160)}`);
  // The grid is in here as well as the dialog, and deliberately: its tiles get
  // their "no preview" label when a thumbnail comes back rather than when the
  // grid is drawn, so they are exactly the kind of text a language change
  // leaves behind. A screenshot caught one still reading NO PREVIEW.
  const stillEnglish = await read(`[...document.querySelectorAll('.shrink-row, .shrink-level, #shrink-estimate, .media-placeholder')]
    .map((e) => e.textContent).join(' ')
    .match(/likely|Smaller|Smallest|copies|about|no preview/gi) || []`);
  console.log(`  English left on screen after the switch: ${stillEnglish.length ? stillEnglish.join(', ') : 'none'}`);
  const placeholders = await read(`[...document.querySelectorAll('.media-placeholder')].map((e) => e.textContent)`);
  console.log(`  tiles with no preview, as labelled: ${placeholders.join(' | ') || '(none on screen)'}`);

  /* -- actually do it -------------------------------------------------------- */

  const runStarted = Date.now();
  await js(`document.getElementById('shrink-go').click();`);
  await until(`document.getElementById('shrink-progress').hidden === false`, 20000).catch(() => {});
  await wait(900);
  await shoot('running-vi');

  await until(`document.getElementById('shrink-go').hidden === true`, 600000);
  console.log(`\n  the real encode took ${((Date.now() - runStarted) / 1000).toFixed(1)} s\n`);
  await wait(700);
  await shoot('done-vi');

  await js(`
    document.querySelector('.tab[data-tab="settings"]').click();
    document.querySelector('[data-language-choice="en"]').click();
  `);
  await wait(1000);
  await js(`document.querySelector('.tab[data-tab="media"]').click();`);
  await wait(500);
  await shoot('done-light');
  await theme('dark');
  await shoot('done-dark');
  await theme('light');

  /* -- what is on the disk, and what things that are not us make of it ------- */

  // A plain window with no Content-Security-Policy of its own, so a `<video>`
  // in it is allowed to open a file on disk.
  const plainPage = path.join(SANDBOX, 'playback.html');
  fs.writeFileSync(plainPage, '<!doctype html><html><head><meta charset="utf-8"><title>playback</title></head><body></body></html>', 'utf8');
  const plain = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await plain.loadFile(plainPage);
  const playElsewhere = (file) => plain.webContents.executeJavaScript(`(async () => {
    const v = document.createElement('video');
    v.src = ${JSON.stringify(`file:///${file.replace(/\\/g, '/')}`)};
    v.preload = 'auto';
    v.muted = true;
    return await new Promise((resolve) => {
      v.onloadeddata = () => { v.currentTime = Math.min(1, v.duration / 2); };
      v.onseeked = () => resolve(v.videoWidth + 'x' + v.videoHeight + ' ' + v.duration.toFixed(2) + 's');
      v.onerror = () => resolve('ERROR ' + (v.error ? v.error.code : '?'));
      setTimeout(() => resolve('TIMED OUT'), 15000);
    });
  })()`);

  const copies = fs.readdirSync(BASE).filter((n) => n.includes('.cleandrive.'));
  console.log(`\n  copies written: ${copies.length}`);
  let allPlayable = true;
  for (const name of copies) {
    const file = path.join(BASE, name);
    const size = fs.statSync(file).size;
    const original = path.join(BASE, name.replace('.cleandrive.mp4', '.mp4'));
    const was = fs.existsSync(original) ? fs.statSync(original).size : 0;

    // Question one, asked of Windows rather than of this project.
    let thumb = 'EMPTY';
    try {
      const img = await nativeImage.createThumbnailFromPath(file, { width: 256, height: 256 });
      thumb = img.isEmpty() ? 'EMPTY' : `${img.getSize().width}x${img.getSize().height}`;
    } catch (err) {
      thumb = `threw ${err.message}`;
    }

    // Question two, asked of Chromium's own demuxer rather than of ours.
    //
    // In a window of its own, and that matters: the app's page carries
    // `media-src cleandrive:`, so a `<video>` pointed at a `file://` path
    // inside it is refused by the Content-Security-Policy and reports
    // MEDIA_ERR_SRC_NOT_SUPPORTED. Asked there, this check measures the policy
    // and not the file -- which is exactly what it did on its first run, and
    // it accused three perfectly good copies of being unplayable.
    const played = await playElsewhere(file);

    if (thumb === 'EMPTY' || played.startsWith('ERROR') || played === 'TIMED OUT') allPlayable = false;
    console.log(
      `    ${name}: ${(size / 1024 / 1024).toFixed(2)} MB (was ${(was / 1024 / 1024).toFixed(2)}) · ` +
      `shell thumbnail ${thumb} · <video> ${played}`
    );
  }
  console.log(`  every copy readable by something that is not this app: ${allPlayable}`);

  // The control. The fixture was written by the same muxer, so if it fails too
  // the fault is the muxer; if only the copies fail, the fault is the pipeline.
  console.log(`  control — a fixture original in <video>: ${await playElsewhere(path.join(BASE, 'screen-recording.mp4'))}`);

  const originals = fs.readdirSync(BASE).filter((n) => n.endsWith('.mp4') && !n.includes('.cleandrive.'));
  console.log(`  originals still present: ${originals.length} — ${originals.join(', ')}`);

  /* -- and the comparison, which is step three of the spec -------------------- */

  await js(`document.getElementById('media-shrink').click();`);
  await wait(400);
  const canCompare = await read(`document.getElementById('shrink-compare') && !document.getElementById('shrink-compare').hidden`);
  await js(`document.getElementById('shrink-close').click();`);
  await wait(300);

  const pair = copies.length
    ? [path.join(BASE, copies[0].replace('.cleandrive.mp4', '.mp4')), path.join(BASE, copies[0])]
    : [];
  if (pair.length === 2) {
    await js(`
      const files = media.files.filter((f) => ${JSON.stringify(pair)}.includes(f.path));
      window.PhotoCompare.open(files, { groups: [], index: -1 });
    `);
    await until(`document.getElementById('compare').hidden === false`, 20000);
    await wait(2500);
    await shoot('compare-light');
    await theme('dark');
    await shoot('compare-dark');
    await theme('light');

    const panes = await read(`({
      videos: document.querySelectorAll('#compare-panes video').length,
      images: document.querySelectorAll('#compare-panes img').length,
      rows: [...document.querySelectorAll('.compare-table tr')].map((r) => r.textContent.trim()),
    })`);
    console.log(`\n  compare: ${panes.videos} video panes, ${panes.images} image panes`);
    for (const row of panes.rows) console.log(`    ${row}`);

    win.setBounds({ width: 720, height: 900 });
    await wait(700);
    await shoot('compare-720');
    win.setBounds({ width: 1180, height: 900 });
  } else {
    console.log('\n  compare: nothing was made to compare');
  }
  console.log(`  the dialog offered a comparison: ${canCompare}`);

  if (errors.length) console.log(`\n  renderer errors: ${errors.length}\n${errors.map((e) => `    ${e}`).join('\n')}`);
  else console.log('\n  no renderer errors');

  app.quit();
}).catch((err) => {
  console.error('FAILED:', err && err.stack ? err.stack : err);
  app.exit(1);
});
