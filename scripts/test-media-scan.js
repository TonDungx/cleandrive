#!/usr/bin/env node
'use strict';

// The media scan, its cache, and the folder rules -- against a tree this
// script builds and removes.
//
//   node scripts/test-media-scan.js
//
// The fixtures are real files this time rather than buffers, because what is
// being tested is the parts that touch a filesystem: the walk, the exclusions,
// and above all the cache. A cache is only ever worth having if it is wrong at
// the right moments, so most of what follows is about making it stale on
// purpose and checking it noticed.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { scanMedia } = require('../src/main/lib/media/scan');
const { MediaCache, RECORD_VERSION } = require('../src/main/lib/media/cache');
const cloud = require('../src/main/lib/media/cloud');
const roots = require('../src/main/lib/media/roots');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

/** A real PNG on disk, of stated dimensions and padded to a stated size. */
function pngBytes(width, height, padTo = 0) {
  const head = Buffer.concat([
    Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n', 'latin1'),
    u32be(13), Buffer.from('IHDR', 'latin1'),
    u32be(width), u32be(height),
    Buffer.from([8, 6, 0, 0, 0]), u32be(0),
  ]);
  if (padTo <= head.length) return head;
  // Padding goes in a chunk of its own so the file stays a plausible PNG.
  return Buffer.concat([head, u32be(padTo - head.length - 12), Buffer.from('tEXt', 'latin1'), Buffer.alloc(padTo - head.length - 12), u32be(0)]);
}

function jpegBytes(width, height, padTo = 0) {
  const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker]), u16be(body.length + 2), body]);
  const parts = [
    Buffer.from([0xff, 0xd8]),
    seg(0xc0, Buffer.concat([Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3]), Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])])),
    seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])),
  ];
  const head = Buffer.concat(parts);
  const tail = Buffer.from([0xff, 0xd9]);
  const padding = Math.max(0, padTo - head.length - tail.length);
  return Buffer.concat([head, Buffer.alloc(padding, 0x7f), tail]);
}

async function build(root) {
  const mk = async (relative, bytes) => {
    const full = path.join(root, relative);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, bytes);
    return full;
  };

  await mk('Photos/IMG_0001.jpg', jpegBytes(4032, 3024, 240 * 1024));
  await mk('Photos/IMG_0002.jpg', jpegBytes(4032, 3024, 260 * 1024));
  await mk('Photos/holiday.png', pngBytes(1920, 1080, 400 * 1024));
  await mk('Photos/notes.txt', Buffer.from('not media'));

  // A file whose name lies about what it is.
  await mk('Photos/actually-a-png.jpg', pngBytes(800, 600, 50 * 1024));

  // Zero bytes -- which really does happen; nineteen of these turned up in a
  // screenshots folder on the development machine.
  await mk('Photos/broken.png', Buffer.alloc(0));

  // A folder the media rules refuse by name.
  await mk('AppData/Local/Thing/icon.png', pngBytes(32, 32, 2 * 1024));
  await mk('node_modules/pkg/logo.png', pngBytes(64, 64, 3 * 1024));
  await mk('Photos/Thumbnails/thumb.png', pngBytes(120, 90, 4 * 1024));

  // An unpacked archive of interface assets: many files, all tiny. This is the
  // shape that produced 9,676 of 10,185 "photos" in the original measurement.
  for (let i = 0; i < 180; i++) {
    await mk(`Downloads/aB3xQ9/sprite-${i}.png`, pngBytes(24, 24, 1200 + i));
  }

  // A real album with the same file count, to prove the rule separates them by
  // size rather than by count. If this folder is ever hidden, the rule is
  // hiding somebody's photographs.
  for (let i = 0; i < 180; i++) {
    await mk(`Photos/Album/DSC_${1000 + i}.jpg`, jpegBytes(6000, 4000, 300 * 1024 + i));
  }
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-media-'));
  const cachePath = path.join(root, 'media-cache.json');

  try {
    await build(root);

    /* ------------------------------------------------------------------ */
    console.log('\nmedia scan: what it finds, and what it refuses to look at\n');

    const first = await scanMedia([root], { cachePath });

    const byName = new Map(first.files.map((f) => [path.basename(f.path), f]));
    check('the photographs are found', byName.has('IMG_0001.jpg') && byName.has('holiday.png'));
    check('a text file is not media', !byName.has('notes.txt'));
    check('the album of 180 photographs is kept', byName.has('DSC_1000.jpg'),
      `${[...byName.keys()].filter((n) => n.startsWith('DSC_')).length} of 180`);

    // The whole point of the size test rather than a count test.
    check('the 180 sprites are hidden', !byName.has('sprite-0.png'), `${first.hidden} hidden`);
    check('and hiding them is reported rather than silent', first.hidden === 180, String(first.hidden));

    check('a folder called AppData is never walked', !byName.has('icon.png'));
    check('node_modules is never walked', !byName.has('logo.png'));
    check('a Thumbnails folder is never walked', !byName.has('thumb.png'));

    const mismatch = byName.get('actually-a-png.jpg');
    check('a .jpg holding a PNG is reported as such',
      mismatch && mismatch.formatMismatch === true && mismatch.format === 'png',
      mismatch ? `${mismatch.format} mismatch=${mismatch.formatMismatch}` : 'missing');
    check('and it is still measured correctly',
      mismatch && mismatch.width === 800 && mismatch.height === 600);

    const broken = byName.get('broken.png');
    check('a zero-byte image is reported unread rather than dropped',
      broken && broken.unread === 'empty', broken ? broken.unread : 'missing');

    const photo = byName.get('IMG_0001.jpg');
    check('dimensions come from the header', photo && photo.width === 4032 && photo.height === 3024,
      photo ? `${photo.width}x${photo.height}` : 'missing');
    check('megapixels are derived', photo && photo.megapixels === 12.2, photo && String(photo.megapixels));
    check('bytes per pixel are derived', photo && photo.bytesPerPixel > 0, photo && String(photo.bytesPerPixel));
    check('the aspect ratio is derived', photo && Math.abs(photo.aspect - 4 / 3) < 0.01, photo && String(photo.aspect));

    check('refused folders are grouped by reason, not listed one by one',
      first.excluded.length > 0 && first.excluded.every((g) => g.count >= 1 && g.examples.length <= 5),
      first.excluded.map((g) => `${g.key}×${g.count}`).join(' '));

    /* ------------------------------------------------------------------ */
    console.log('\nmedia cache: faster the second time\n');

    check('the first scan read every file', first.stats.fromCache === 0, String(first.stats.fromCache));
    check('and wrote a cache file', fs.existsSync(cachePath));

    const second = await scanMedia([root], { cachePath });
    check('the second scan reads none of them', second.stats.fromCache === second.stats.probed,
      `${second.stats.fromCache} of ${second.stats.probed}`);
    check('and is measurably quicker at it', second.stats.probeMs < first.stats.probeMs,
      `${first.stats.probeMs}ms then ${second.stats.probeMs}ms`);
    check('with the same answer', second.files.length === first.files.length,
      `${first.files.length} then ${second.files.length}`);

    /* ------------------------------------------------------------------ */
    console.log('\nmedia cache: stale at the right moments\n');

    // Contents changed, size changed. The obvious case.
    const changed = path.join(root, 'Photos', 'IMG_0001.jpg');
    await fsp.writeFile(changed, jpegBytes(1024, 768, 90 * 1024));
    const afterEdit = await scanMedia([root], { cachePath });
    const edited = afterEdit.files.find((f) => f.path === changed);
    check('an edited file is read again, not remembered',
      edited && edited.width === 1024 && edited.height === 768,
      edited ? `${edited.width}x${edited.height}` : 'missing');
    check('and only that one file was re-read',
      afterEdit.stats.probed - afterEdit.stats.fromCache === 1,
      `${afterEdit.stats.probed - afterEdit.stats.fromCache} re-read`);

    // The case a path-only key would get wrong: same size, different contents,
    // different mtime. This is what an export-at-the-same-quality produces.
    const sameSize = path.join(root, 'Photos', 'IMG_0002.jpg');
    const originalSize = (await fsp.stat(sameSize)).size;
    await fsp.writeFile(sameSize, jpegBytes(640, 480, originalSize));
    check('the replacement really is the same size', (await fsp.stat(sameSize)).size === originalSize);
    // mtime has to actually differ; a fast machine can write twice inside one
    // filesystem tick, which would make this test pass for the wrong reason.
    await fsp.utimes(sameSize, new Date(), new Date(Date.now() + 5000));

    const afterSwap = await scanMedia([root], { cachePath });
    const swapped = afterSwap.files.find((f) => f.path === sameSize);
    check('a file replaced by one of the same size is still re-read',
      swapped && swapped.width === 640, swapped ? `${swapped.width}x${swapped.height}` : 'missing');

    // Touching a file without changing it. mtime moves, so the key moves.
    // Re-reading here is the safe direction and is what the key guarantees.
    const touched = path.join(root, 'Photos', 'holiday.png');
    await fsp.utimes(touched, new Date(), new Date(Date.now() + 10000));
    const afterTouch = await scanMedia([root], { cachePath });
    const retouched = afterTouch.files.find((f) => f.path === touched);
    check('a touched file is re-read and still measured the same',
      retouched && retouched.width === 1920 && retouched.height === 1080);

    /* ------------------------------------------------------------------ */
    console.log('\nmedia cache: hostile and broken cache files\n');

    await fsp.writeFile(cachePath, '{ this is not json');
    const afterCorrupt = await scanMedia([root], { cachePath });
    check('a corrupt cache is an empty cache, not an error',
      afterCorrupt.files.length === first.files.length && afterCorrupt.stats.fromCache === 0,
      `${afterCorrupt.stats.fromCache} hits`);

    // The failure a version field exists to prevent: entries written by a build
    // whose record shape was different.
    const good = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
    await fsp.writeFile(cachePath, JSON.stringify({ ...good, version: RECORD_VERSION + 1 }));
    const afterVersion = await scanMedia([root], { cachePath });
    check('a cache from a different record shape is discarded, not half-trusted',
      afterVersion.stats.fromCache === 0, `${afterVersion.stats.fromCache} hits`);
    check('and the scan says that is why it was slow',
      afterVersion.stats.cache && afterVersion.stats.cache.discardedVersion === true);

    // Dead entries. A folder moved away leaves its keys behind for ever, and
    // the size cap would eventually evict live entries to keep them.
    const gone = path.join(root, 'Photos', 'Album');
    const beforePrune = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
    await fsp.rm(gone, { recursive: true, force: true });
    await scanMedia([root], { cachePath });
    const afterPrune = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
    check('entries for files that no longer exist are dropped',
      Object.keys(afterPrune.entries).length < Object.keys(beforePrune.entries).length,
      `${Object.keys(beforePrune.entries).length} then ${Object.keys(afterPrune.entries).length}`);

    check('a cache that cannot be written does not fail the scan', await (async () => {
      const impossible = path.join(root, 'no-such-dir', '\0bad', 'x.json');
      const result = await scanMedia([root], { cachePath: impossible }).catch(() => null);
      return result !== null && result.files.length > 0;
    })());

    /* ------------------------------------------------------------------ */
    console.log('\nmedia scan: stopping part way\n');

    const { CancelToken } = require('../src/main/lib/util');

    // Cancelled during the walk, before a single file has been read.
    const earlyToken = new CancelToken();
    const early = await scanMedia([root], { cachePath: path.join(root, 'early-cache.json') }, {
      token: earlyToken,
      onProgress: () => earlyToken.cancel(),
    });
    check('a scan stopped during the walk says so', early.cancelled === true);
    check('and returns what it had rather than throwing', Array.isArray(early.files));
    // This was a real crash: `finish` closes over the record list, and stopping
    // during the walk reached it before the probe loop had declared it.
    check('stopping that early is a stop, not a failure', early.stats.probed === 0,
      String(early.stats.probed));

    // Cancelled during the read, after some files are done. The half a scan
    // that did happen is still worth keeping: the cache is keyed on content, so
    // those entries are exactly as valid as a finished scan's -- and throwing
    // them away would make "stop, then start again" slower than never stopping.
    const cancelCache = path.join(root, 'cancel-cache.json');
    const lateToken = new CancelToken();
    let batches = 0;
    const late = await scanMedia([root], { cachePath: cancelCache, batchSize: 8 }, {
      token: lateToken,
      onBatch: () => { if (++batches >= 1) lateToken.cancel(); },
    });
    check('a scan stopped while reading says so', late.cancelled === true);
    check('and it did read something first', late.stats.probed > 0, `${late.stats.probed} probed`);
    check('what it learned is written down', fs.existsSync(cancelCache));

    const resumed = await scanMedia([root], { cachePath: cancelCache });
    check('and the next scan picks that work up rather than repeating it',
      resumed.stats.fromCache > 0, `${resumed.stats.fromCache} reused`);
    // A cancelled scan must not prune: the files it never reached are not
    // files that stopped existing, and dropping their entries would throw away
    // a previous complete scan's work every time somebody pressed Stop.
    check('a cancelled scan does not mistake "not reached" for "gone"',
      resumed.stats.fromCache >= late.stats.probed,
      `${late.stats.probed} kept, ${resumed.stats.fromCache} reused`);

    /* ------------------------------------------------------------------ */
    console.log('\nmedia: folders that sync somewhere else\n');

    cloud.reset();
    check('a OneDrive path is recognised',
      cloud.serviceForPath('C:\\Users\\x\\OneDrive\\Hình ảnh\\a.jpg') === 'OneDrive');
    // A work account produces `OneDrive - Contoso`, which an equality test misses.
    check('a work OneDrive folder is recognised',
      cloud.serviceForPath('C:\\Users\\x\\OneDrive - Contoso Ltd\\a.jpg') === 'OneDrive');
    check('Dropbox is recognised', cloud.serviceForPath('D:\\Dropbox\\Photos\\a.jpg') === 'Dropbox');
    check('Google Drive is recognised', cloud.serviceForPath('G:\\My Drive\\a.jpg') === 'Google Drive');
    // The machine this was written on has two profile trees, C: and D:, and
    // anchoring to %USERPROFILE% finds only the first.
    check('a sync folder on another drive is recognised too',
      cloud.serviceForPath('D:\\Users\\x\\Dropbox\\a.jpg') === 'Dropbox');
    check('an ordinary folder is not', cloud.serviceForPath('C:\\Users\\x\\Pictures\\a.jpg') === null);
    check('a folder merely containing the word is not',
      cloud.serviceForPath('C:\\Users\\x\\Pictures\\my-dropbox-backup\\a.jpg') === null);
    check('rubbish does not throw', cloud.serviceForPath(null) === null && cloud.serviceForPath('') === null);

    /* ------------------------------------------------------------------ */
    console.log('\nmedia: files whose bytes are not on this disk\n');

    // Confirmed against real OneDrive placeholders, whose Windows attributes
    // read ARCHIVE | SPARSE_FILE | REPARSE_POINT | OFFLINE | RECALL_ON_DATA_ACCESS.
    // Node surfaces none of those, so the test is `blocks` against `size`.
    check('a full size with nothing allocated is a placeholder',
      cloud.looksDehydrated({ size: 230725, blocks: 0 }) === (process.platform === 'win32'));
    // NTFS keeps a small file's contents inside its own directory record, so
    // zero blocks is normal down there. Verified: a 96-byte desktop.ini.
    check('a small resident file is not a placeholder',
      cloud.looksDehydrated({ size: 96, blocks: 0 }) === false);
    check('a file with its blocks allocated is not a placeholder',
      cloud.looksDehydrated({ size: 230725, blocks: 456 }) === false);
    // `blocks` is not populated everywhere, and absent evidence must not read
    // as evidence of absence -- that direction would stop the scan reading
    // perfectly ordinary files.
    check('a filesystem that does not report blocks is not guessed at',
      cloud.looksDehydrated({ size: 230725, blocks: undefined }) === false);
    check('nothing at all does not throw', cloud.looksDehydrated(null) === false);

    /* ------------------------------------------------------------------ */
    console.log('\nmedia: the asset-folder rule, at its edges\n');

    const tiny = Array.from({ length: 200 }, () => ({ size: 1500 }));
    const album = Array.from({ length: 200 }, () => ({ size: 3 * 1024 * 1024 }));
    check('two hundred tiny images is an asset folder', roots.looksLikeAssetDump(tiny));
    check('two hundred photographs is not', !roots.looksLikeAssetDump(album));
    check('a handful of tiny images is not enough to decide',
      !roots.looksLikeAssetDump(Array.from({ length: 20 }, () => ({ size: 900 }))));
    // The mean would be dragged over the line by one big file; the median is
    // what makes a real download folder survive.
    const mixed = [...Array.from({ length: 199 }, () => ({ size: 1500 })), { size: 900 * 1024 * 1024 }];
    check('one huge file does not rescue a folder of icons', roots.looksLikeAssetDump(mixed));
    const mostlyPhotos = [...Array.from({ length: 160 }, () => ({ size: 4 * 1024 * 1024 })), ...Array.from({ length: 40 }, () => ({ size: 800 }))];
    check('an album with some small files in it survives', !roots.looksLikeAssetDump(mostlyPhotos));
    check('an empty folder does not throw', !roots.looksLikeAssetDump([]));

    /* ------------------------------------------------------------------ */
    console.log('\nmedia: the cache key\n');

    const base = { path: 'C:\\a\\b.jpg', size: 100, mtimeMs: 1700000000000 };
    check('the key carries the path, the size and the time',
      MediaCache.keyOf(base) === 'C:\\a\\b.jpg|100|1700000000000', MediaCache.keyOf(base));
    check('a different size is a different key',
      MediaCache.keyOf({ ...base, size: 101 }) !== MediaCache.keyOf(base));
    check('a different time is a different key',
      MediaCache.keyOf({ ...base, mtimeMs: 1700000000001 }) !== MediaCache.keyOf(base));
    // Some filesystems report sub-millisecond precision and some do not; a key
    // that moved because of that would miss every time without looking wrong.
    check('sub-millisecond noise is not a different key',
      MediaCache.keyOf({ ...base, mtimeMs: 1700000000000.4 }) === MediaCache.keyOf(base));

  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nThe suite could not run:', err && err.stack ? err.stack : err);
  process.exit(1);
});
