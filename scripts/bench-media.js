'use strict';

// What the photo and video scan costs, measured rather than claimed.
//
//   npm run bench:media                 -- the default roots
//   npm run bench:media -- "D:\Photos"  -- somewhere specific
//   npm run bench:media -- --cold       -- ignore the cache
//
// ## Why this exists
//
// The budget for this subsystem was set as a number before a line of it was
// written: fifty thousand files, a usable list in seconds. A budget nobody
// measures is a wish, and a figure quoted once in a commit message is a figure
// that quietly stops being true. This prints the same six numbers every time so
// the next person can run it and compare rather than guess.
//
// It runs under Electron because phase two does: `nativeImage` is main-process
// only, and half of what is being measured here is the shell drawing thumbnails.
//
// Nothing is deleted, nothing is written except the cache the scan would have
// written anyway, and that goes to a temporary file.

const { app, nativeImage, screen } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setName(require('../package.json').name);

// Every harness in this project sets this, and `notify.js` reads it to keep
// test runs from putting toasts on the tester's screen. A benchmark raises no
// notifications, but it costs nothing to be consistent and it means a future
// change to this file cannot surprise anybody.
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'bench';

const { scanMedia, DEFAULTS: SCAN_DEFAULTS } = require('../src/main/lib/media/scan');
const { classifyOrigin } = require('../src/main/lib/media/origin');
const { describeNature } = require('../src/main/lib/media/nature');
const { thumbnails } = require('../src/main/lib/media/thumbs');
const perceptual = require('../src/main/lib/media/perceptual');
const { candidateRoots } = require('../src/main/lib/media/roots');
const { MediaCache } = require('../src/main/lib/media/cache');

const COLD = process.argv.includes('--cold');
const explicitRoots = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('bench-media.js'));

/** How many files phase two is measured over. Phase two only ever runs on what is on screen. */
const PHASE_TWO_SAMPLE = Number(valueOf('--phase2') || 400);

function valueOf(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

/* -------------------------------------------------------------------------- */

const MB = 1024 * 1024;
const rss = () => process.memoryUsage().rss;

/**
 * Resident memory is sampled rather than read once, because the peak is what
 * matters and it happens somewhere in the middle. A timer is enough: this is a
 * benchmark, and stopping the world to measure it would change the thing being
 * measured.
 */
function watchMemory() {
  let peak = rss();
  const timer = setInterval(() => {
    const now = rss();
    if (now > peak) peak = now;
  }, 25);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      return Math.max(peak, rss());
    },
  };
}

const pad = (value, width) => String(value).padStart(width);
const rate = (n, ms) => (ms > 0 ? Math.round(n / (ms / 1000)) : 0);

function row(label, value, note = '') {
  console.log(`  ${label.padEnd(34)} ${value.padStart(14)}  ${note}`);
}

function rule(title) {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

/* -------------------------------------------------------------------------- */

app.whenReady().then(async () => {
  const displays = screen.getAllDisplays().map((d) => ({
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
  }));

  const roots = explicitRoots.length
    ? explicitRoots
    : candidateRoots(
        {
          home: app.getPath('home'),
          pictures: safePath('pictures'),
          videos: safePath('videos'),
          downloads: safePath('downloads'),
        },
        (p) => fs.existsSync(p)
      )
        .filter((entry) => entry.defaultOn)
        .map((entry) => entry.path);

  // The app's own default unless overridden, so the benchmark measures what
  // ships rather than a number that drifted apart from it.
  const concurrency = Number(valueOf('--concurrency') || SCAN_DEFAULTS.concurrency);
  const cachePath = path.join(os.tmpdir(), 'cleandrive-bench-media-cache.json');
  if (COLD) fs.rmSync(cachePath, { force: true });

  console.log(`\nCleanDrive media benchmark`);
  console.log(`  electron ${process.versions.electron}  node ${process.versions.node}  ${os.cpus().length} CPUs`);
  console.log(`  UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE || '(default 4)'}`);
  console.log(`  displays: ${displays.map((d) => `${d.width}x${d.height}`).join(', ') || 'none'}`);
  console.log(`  cache: ${COLD ? 'discarded first (--cold)' : 'reused if present'}`);
  console.log(`  roots:`);
  for (const root of roots) console.log(`    ${root}`);

  const baseline = rss();

  /* -- phase one ---------------------------------------------------------- */

  const memory = watchMemory();
  const result = await scanMedia(roots, { cachePath, concurrency }, {});

  rule('Phase 1 — find and read (the part that must be fast)');
  row('files walked', pad(result.stats.walkedFiles, 8), `${rate(result.stats.walkedFiles, result.stats.walkMs)} /s`);
  row('media files found', pad(result.stats.mediaFiles, 8));
  row('  of which shown', pad(result.files.length, 8), `${result.hidden} hidden as program artwork`);
  row('walk', `${pad(result.stats.walkMs, 8)} ms`, 'names only -- nothing is measured here');
  row('read and parse', `${pad(result.stats.probeMs, 8)} ms`, `${rate(result.stats.probed, result.stats.probeMs)} files/s at ${concurrency}-way, including the stat`);
  row('  read from disk', pad(result.stats.probed - result.stats.fromCache, 8));
  row('  reused from cache', pad(result.stats.fromCache, 8), result.stats.cache && result.stats.cache.discardedVersion ? 'cache discarded: record shape changed' : '');
  row('unreadable', pad(result.stats.unreadable, 8));
  row('online-only, not read', pad(result.stats.dehydrated, 8), 'reading these would download them');
  row('TOTAL phase 1', `${pad(result.durationMs, 8)} ms`, `${rate(result.files.length, result.durationMs)} files/s end to end`);

  /* -- classification ------------------------------------------------------ */

  const classifyStart = Date.now();
  const context = { displays };
  const origins = new Map();
  const traits = new Map();
  for (const record of result.files) {
    const origin = classifyOrigin(record, context);
    origins.set(origin.origin, (origins.get(origin.origin) || 0) + 1);
    for (const trait of describeNature(record, context).traits) {
      traits.set(trait.key, (traits.get(trait.key) || 0) + 1);
    }
  }
  const classifyMs = Date.now() - classifyStart;

  rule('Classification — both axes, over every file');
  row('classify', `${pad(classifyMs, 8)} ms`, `${rate(result.files.length, classifyMs)} files/s`);
  for (const [key, n] of [...origins].sort((a, b) => b[1] - a[1])) {
    row(`  ${key}`, pad(n, 8));
  }

  /* -- phase two ----------------------------------------------------------- */

  // Only ever run on what is on screen plus a margin, so the benchmark measures
  // a screenful rather than the library. Measuring all of it would produce a
  // number the app never pays.
  const sample = result.files
    .filter((f) => !f.unread)
    .slice(0, PHASE_TWO_SAMPLE)
    .map((f) => f.path);

  rule(`Phase 2 — thumbnails and pixels (lazy, ${sample.length} files: one screenful plus margin)`);

  const phaseOnePeak = memory.stop();
  const phaseTwoMemory = watchMemory();

  const twoStart = Date.now();
  let bytesOfThumbnails = 0;
  let drawn = 0;
  let failed = 0;
  const analysed = [];
  // Which route produced each picture. The shell reads Windows' thumbnail
  // cache and the decoder reads the file; they cost very different amounts,
  // and a single average hides which one the machine is actually paying for.
  const bySource = new Map();

  const byPath = new Map(result.files.map((f) => [f.path, f]));
  const analysisCache = await new MediaCache(path.join(os.tmpdir(), 'cleandrive-bench-analysis.json')).load();
  if (COLD) analysisCache.map.clear();
  const keyOf = (filePath) => {
    const record = byPath.get(filePath);
    return record ? MediaCache.keyOf(record) : filePath;
  };

  await thumbnails(sample, { cache: analysisCache, keyOf }, {
    onOne: (filePath, thumb) => {
      const key = thumb.source || 'none';
      bySource.set(key, (bySource.get(key) || 0) + 1);

      if (thumb.dataUri) {
        drawn += 1;
        bytesOfThumbnails += thumb.dataUri.length;
      } else {
        failed += 1;
      }
      if (thumb.hash) {
        const record = byPath.get(filePath);
        analysed.push({
          path: filePath,
          hash: thumb.hash,
          aspect: record ? record.aspect : 0,
          size: record ? record.size : 0,
          mtimeMs: record ? record.mtimeMs : 0,
          detail: thumb.detail,
          blank: thumb.blank,
        });
      }
    },
  });
  const twoMs = Date.now() - twoStart;

  row('thumbnails drawn', pad(drawn, 8), `${rate(drawn, twoMs)} /s — both paths decode synchronously, so this does not improve with concurrency`);
  row('  nothing could draw', pad(failed, 8), 'video the shell has not cached has no fallback');
  for (const [source, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
    row(`  via ${source}`, pad(n, 8), source === 'decoder' ? 'Chromium decoded the file itself' : source === 'shell' ? "from Windows' thumbnail cache" : '');
  }
  row('phase 2 total', `${pad(twoMs, 8)} ms`);
  row('per file', `${pad((twoMs / Math.max(1, sample.length)).toFixed(1), 8)} ms`);
  row('thumbnail payload', `${pad((bytesOfThumbnails / 1024).toFixed(0), 8)} KB`, `${(bytesOfThumbnails / Math.max(1, drawn) / 1024).toFixed(1)} KB each, as JPEG data URIs`);
  row('blank frames found', pad(analysed.filter((a) => a.blank).length, 8));

  // What a person actually waits for. Phase two runs on what is visible plus a
  // margin, so a screenful is the number that matters -- the 400 above is four
  // screenfuls deep and exists to make the average steady.
  const screenful = 48;
  row('one screenful of cells', `${pad(Math.round((twoMs / Math.max(1, sample.length)) * screenful), 8)} ms`, `${screenful} cells, streamed as they finish`);

  // The same files again, with the pixel measurements already known. This is
  // what near-duplicate grouping costs on a library that has been looked at
  // once -- the thumbnails are still redrawn, because they are not kept.
  await analysisCache.save();
  const warmStart = Date.now();
  await thumbnails(sample, { cache: analysisCache, keyOf, display: false }, {});
  const warmMs = Date.now() - warmStart;
  row('measurements, second time', `${pad(warmMs, 8)} ms`, `${rate(sample.length, warmMs)} /s — the numbers are kept, the pictures are not`);

  /* -- grouping ------------------------------------------------------------ */

  const groupStart = Date.now();
  const groups = perceptual.groupSimilar(analysed);
  const groupMs = Date.now() - groupStart;

  row('near-duplicate groups', pad(groups.length, 8), `${groupMs} ms over ${analysed.length} hashes`);
  if (groups.length) {
    const copies = groups.reduce((n, g) => n + g.count, 0);
    row('  files in a group', pad(copies, 8));
    row('  reclaimable if pruned', `${pad((groups.reduce((n, g) => n + g.wastedBytes, 0) / MB).toFixed(1), 8)} MB`, 'nothing is selected for the user');
    row('  widest gap in a group', pad(Math.max(...groups.map((g) => g.spread)), 8), `of ${perceptual.MAX_DISTANCE} allowed, out of 64 bits`);
  }

  /* -- memory and the budget ------------------------------------------------ */

  const phaseTwoPeak = phaseTwoMemory.stop();

  rule('Memory');
  row('at rest, before scanning', `${pad((baseline / MB).toFixed(0), 8)} MB`);
  // Split, because the two halves cost memory for entirely different reasons:
  // phase one holds a record per file for the whole library, phase two holds
  // decoded bitmaps and base64 for a screenful. Reporting one peak attributes
  // the second to the first and makes the per-file figure nonsense.
  row('peak during phase 1', `${pad((phaseOnePeak / MB).toFixed(0), 8)} MB`, `+${((phaseOnePeak - baseline) / MB).toFixed(0)} MB for ${result.files.length} records`);
  row('  per record held', `${pad(Math.round((phaseOnePeak - baseline) / Math.max(1, result.files.length)), 8)} B`);
  row('peak during phase 2', `${pad((phaseTwoPeak / MB).toFixed(0), 8)} MB`, `${sample.length} thumbnails in flight`);

  rule('Against the budget: 50,000 media files');

  // Walking and reading are not the same population. The walk `lstat`s every
  // file it passes, media or not; the probe only opens the media. Projecting
  // 50,000 through both rates counts the same files twice and overstates the
  // total by whatever the ratio happens to be -- which on this machine is
  // nearly double.
  const readRate = rate(result.stats.probed, result.stats.probeMs);
  const walkRate = rate(result.stats.walkedFiles, result.stats.walkMs);
  const filesPerMedia = result.stats.mediaFiles > 0 ? result.stats.walkedFiles / result.stats.mediaFiles : 1;

  const walkSeconds = walkRate > 0 ? (50000 * filesPerMedia) / walkRate : 0;
  const readSeconds = readRate > 0 ? 50000 / readRate : 0;
  const cold = walkSeconds + readSeconds;

  row('walk', `${pad(walkSeconds.toFixed(1), 8)} s`, `${Math.round(50000 * filesPerMedia)} names at ${walkRate}/s`);
  row('read and parse, first time', `${pad(readSeconds.toFixed(1), 8)} s`, `${readRate}/s at ${concurrency}-way`);
  row('TOTAL, nothing cached', `${pad(cold.toFixed(1), 8)} s`);
  row('TOTAL, scanned before', `${pad(walkSeconds.toFixed(1), 8)} s`, 'the walk again, and almost nothing else');

  // Which half is the cost is derived rather than asserted: it has already
  // swapped once. Moving the stat out of the walk and into the probe pool took
  // the walk from six seconds to under one and left reading as the whole bill.
  const dominant = readSeconds > walkSeconds ? 'reading the files' : 'walking the tree';
  const verdict = cold < 5 ? `comfortably inside "seconds, not minutes" — ${dominant} is the cost`
    : cold < 15 ? `inside "seconds, not minutes" — ${dominant} is now the whole of it`
      : 'OUTSIDE the budget — see the concurrency table in scan.js';
  row('verdict', pad('', 8), verdict);

  console.log('');
  console.log('  Phase 2 is deliberately absent from that total: it runs only on what is');
  console.log('  on screen, so its cost is per screenful and does not grow with the');
  console.log(`  library. A screenful here took ${Math.round((twoMs / Math.max(1, sample.length)) * screenful)} ms the first time and ${Math.round((warmMs / Math.max(1, sample.length)) * screenful)} ms once`);
  console.log('  the pixel measurements were known.');
  console.log('');

  app.quit();
}).catch((err) => {
  console.error('\nBenchmark failed:', err && err.stack ? err.stack : err);
  app.exit(1);
});

function safePath(name) {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
}
