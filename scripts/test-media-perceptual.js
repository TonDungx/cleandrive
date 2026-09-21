#!/usr/bin/env node
'use strict';

// Phase two's arithmetic, against bitmaps this script draws itself.
//
//   node scripts/test-media-perceptual.js
//
// No Electron. `perceptual.js` takes pixels and gives back numbers, and the
// only thing Electron contributes is the pixels -- so the pixels are painted
// here, in memory, where a test can say exactly what is in them.
//
// The last section is the one that matters most. It is about a group being a
// *claim* -- "these are the same picture" -- on a screen where somebody acts on
// that claim by deleting all but one of them.

const p = require('../src/main/lib/media/perceptual');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/* -------------------------------------------------------------------------- */
/* a tiny painting library                                                     */
/* -------------------------------------------------------------------------- */

/** A BGRA bitmap, filled by a function of x and y returning [b, g, r]. */
function paint(width, height, fn) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [b, g, r] = fn(x, y);
      const i = (y * width + x) * 4;
      bitmap[i] = b;
      bitmap[i + 1] = g;
      bitmap[i + 2] = r;
      bitmap[i + 3] = 255;
    }
  }
  return bitmap;
}

const flat = (w, h, value) => paint(w, h, () => [value, value, value]);
const gradient = (w, h) => paint(w, h, (x) => { const v = Math.round((x / (w - 1)) * 255); return [v, v, v]; });
const checker = (w, h, cell) => paint(w, h, (x, y) => {
  const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 255 : 0;
  return [v, v, v];
});

/**
 * A deterministic pseudo-photograph: smooth, varied, and reproducible.
 *
 * The coordinates are normalised to 0..1 rather than being pixel counts, and
 * that is the whole point of the fixture. Written against raw `x` and `y`, the
 * pattern has a fixed period *in pixels*, so `scene(256, 256)` shows four times
 * as many waves as `scene(64, 64)` -- two genuinely different pictures. The
 * first version of this file did exactly that, and then asserted the two should
 * hash alike, which failed for an entirely correct reason and briefly looked
 * like a bug in the hash.
 */
function scene(w, h, seed = 1) {
  return paint(w, h, (x, y) => {
    const u = w > 1 ? x / (w - 1) : 0;
    const t = h > 1 ? y / (h - 1) : 0;
    const a = Math.sin((u * 6.1 + seed) * 1.7) * 60;
    const b = Math.cos((t * 5.3 + seed) * 1.3) * 50;
    const c = Math.sin((u + t) * 4.2 + seed) * 40;
    const v = Math.max(0, Math.min(255, Math.round(128 + a + b + c)));
    return [v, Math.max(0, Math.min(255, v + 12)), Math.max(0, Math.min(255, v - 9))];
  });
}

/** The same scene, every pixel turned up by `amount`. */
function brighten(bitmap, amount) {
  const out = Buffer.from(bitmap);
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, out[i + c] + amount);
  }
  return out;
}

/** The same scene with a little noise on top, as a re-encode would leave it. */
function noisy(w, h, seed, amount) {
  const base = scene(w, h, seed);
  const out = Buffer.from(base);
  for (let i = 0; i < out.length; i += 4) {
    const jitter = ((i * 2654435761) % 512) / 512 - 0.5;
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.max(0, Math.min(255, out[i + c] + Math.round(jitter * amount)));
    }
  }
  return out;
}

const hashOf = (bitmap, w, h) => p.analyse(bitmap, w, h).hash;

/* -------------------------------------------------------------------------- */

console.log('\nperceptual: reading the pixels the right way round\n');

{
  // Electron hands out BGRA. Read as RGBA it does not fail -- it swaps red and
  // blue, giving a hash that is stable and wrong.
  const red = paint(8, 8, () => [0, 0, 255]);
  const blue = paint(8, 8, () => [255, 0, 0]);
  const greyRed = p.toGrey(red, 8, 8);
  const greyBlue = p.toGrey(blue, 8, 8);

  // Luma weights red at 0.299 and blue at 0.114, so pure red is the brighter
  // of the two. Swapping the channels reverses that.
  check('red is read as red, not as blue', greyRed[0] > greyBlue[0],
    `red ${greyRed[0].toFixed(0)} vs blue ${greyBlue[0].toFixed(0)}`);
  check('pure red measures about 76', Math.abs(greyRed[0] - 76.2) < 1, greyRed[0].toFixed(1));
  check('pure blue measures about 29', Math.abs(greyBlue[0] - 29.1) < 1, greyBlue[0].toFixed(1));
}

console.log('\nperceptual: the hash\n');

{
  const h = hashOf(scene(64, 64), 64, 64);
  check('a hash is sixteen hex characters', /^[0-9a-f]{16}$/.test(h), h);

  check('the same pixels hash the same way twice',
    hashOf(scene(64, 64), 64, 64) === hashOf(scene(64, 64), 64, 64));

  // The property the whole thing rests on: the same picture at a different size
  // must land on the same hash, because that is what a re-encode produces.
  const big = hashOf(scene(256, 256), 256, 256);
  const small = hashOf(scene(64, 64), 64, 64);
  check('the same scene at 256px and 64px is within the threshold',
    p.hamming(big, small) <= p.MAX_DISTANCE, `${p.hamming(big, small)} bits apart`);

  // Brightness: every bit is a comparison between neighbours, so turning the
  // whole picture up must not move it.
  const brighter = hashOf(brighten(scene(64, 64), 25), 64, 64);
  check('turning the brightness up does not change the hash',
    p.hamming(brighter, small) <= 2, `${p.hamming(brighter, small)} bits`);

  // Noise, of the kind a chat app's recompression leaves behind.
  const rough = hashOf(noisy(64, 64, 1, 30), 64, 64);
  check('light noise does not change the hash much',
    p.hamming(rough, small) <= p.MAX_DISTANCE, `${p.hamming(rough, small)} bits`);

  // Two genuinely different pictures must be far apart, or the threshold means
  // nothing.
  const other = hashOf(scene(64, 64, 9), 64, 64);
  check('a different scene is far away', p.hamming(other, small) > p.MAX_DISTANCE * 2,
    `${p.hamming(other, small)} bits`);
}

console.log('\nperceptual: hamming, including the cases that must not be generous\n');

{
  check('a hash is zero from itself', p.hamming('0123456789abcdef', '0123456789abcdef') === 0);
  check('one flipped bit is one', p.hamming('0000000000000000', '0000000000000001') === 1);
  check('all sixty-four is sixty-four', p.hamming('0000000000000000', 'ffffffffffffffff') === 64);
  // A corrupt or missing cache entry must never make two pictures look alike:
  // "as far apart as possible" is the only safe answer to a question we cannot
  // answer.
  check('a malformed hash is as far away as possible', p.hamming('zzzz', 'zzzz') === 64);
  check('different lengths are as far away as possible', p.hamming('abcd', 'abcdef') === 64);
  check('nothing at all is as far away as possible', p.hamming(null, '0000000000000000') === 64);
}

console.log('\nperceptual: detail, which is not a blur detector\n');

{
  const blank = p.analyse(flat(64, 64, 128), 64, 64);
  const smooth = p.analyse(scene(64, 64), 64, 64);
  const busy = p.analyse(checker(64, 64, 2), 64, 64);

  check('a flat field has no detail', blank.detail === 0, String(blank.detail));
  check('a smooth scene has some', smooth.detail > 0, String(smooth.detail));
  check('a checkerboard has far more', busy.detail > smooth.detail * 10,
    `${busy.detail} vs ${smooth.detail}`);

  // The figure ranks files against each other, so it has to be measured at one
  // scale. Before this was normalised, the same picture at two thumbnail sizes
  // scored an order of magnitude apart -- which would have made "least detail
  // first" a ranking of thumbnail sizes.
  const at256 = p.analyse(scene(256, 256), 256, 256).detail;
  const at64 = p.analyse(scene(64, 64), 64, 64).detail;
  const ratio = at256 > 0 && at64 > 0 ? Math.max(at256, at64) / Math.min(at256, at64) : Infinity;
  check('the same scene scores comparably at two thumbnail sizes', ratio < 2.5,
    `${at256} at 256px, ${at64} at 64px, ratio ${ratio.toFixed(2)}`);

  // And the same content at two shapes should score in the same region. A
  // checkerboard is used rather than the scene because it is the same picture
  // when transposed, so anything left is the measurement's own shape bias.
  const wide = p.analyse(checker(128, 64, 8), 128, 64).detail;
  const tall = p.analyse(checker(64, 128, 8), 64, 128).detail;
  check('and transposing the same content does not change its order of magnitude',
    Math.max(wide, tall) / Math.max(1, Math.min(wide, tall)) < 10, `${wide} wide, ${tall} tall`);

  // Three sizes of one picture, which is what the grid will actually hand it:
  // whatever size the shell happened to return.
  const sizes = [48, 96, 192].map((s) => p.analyse(scene(s, s), s, s).detail);
  const spread = Math.max(...sizes) / Math.max(1, Math.min(...sizes));
  check('three thumbnail sizes of one picture stay in a narrow band', spread < 3,
    `${sizes.join(', ')} — ratio ${spread.toFixed(2)}`);
}

console.log('\nperceptual: blank frames, which are unambiguous\n');

{
  check('a black frame is blank', p.analyse(flat(32, 32, 0), 32, 32).blank);
  check('a white frame is blank too', p.analyse(flat(32, 32, 255), 32, 32).blank);
  check('a mid-grey frame is blank', p.analyse(flat(32, 32, 128), 32, 32).blank);
  check('and the brightness is reported', p.analyse(flat(32, 32, 255), 32, 32).brightness === 255);

  // A photograph of a night sky is dark and varies; that is why the test is on
  // the variation and not on the brightness.
  const nightSky = paint(32, 32, (x, y) => {
    const v = (x * 7 + y * 13) % 11 === 0 ? 200 : 6;
    return [v, v, v];
  });
  const night = p.analyse(nightSky, 32, 32);
  check('a dark picture with something in it is not blank', !night.blank,
    `brightness ${night.brightness}, deviation ${night.deviation}`);
  check('a real scene is not blank', !p.analyse(scene(32, 32), 32, 32).blank);
}

console.log('\nperceptual: resampling\n');

{
  const grey = p.toGrey(gradient(64, 8), 64, 8);
  const small = p.resample(grey, 64, 8, 8, 8);
  check('a resample keeps the left-to-right order', small[0] < small[7], `${small[0].toFixed(0)} .. ${small[7].toFixed(0)}`);

  // Box averaging rather than nearest-neighbour is what makes the hash survive
  // a one-pixel shift, which a re-encode produces routinely.
  const shifted = p.toGrey(paint(64, 8, (x) => {
    const v = Math.round((Math.max(0, x - 1) / 63) * 255);
    return [v, v, v];
  }), 64, 8);
  const shiftedSmall = p.resample(shifted, 64, 8, 8, 8);
  let worst = 0;
  for (let i = 0; i < 8; i++) worst = Math.max(worst, Math.abs(small[i] - shiftedSmall[i]));
  check('a one-pixel shift barely moves the resampled values', worst < 12, worst.toFixed(1));

  check('resampling up does not throw', p.resample(grey, 64, 8, 128, 16).length === 128 * 16);
  check('resampling to one pixel does not throw', p.resample(grey, 64, 8, 1, 1).length === 1);
}

/* -------------------------------------------------------------------------- */

console.log('\nperceptual: a group is a claim that these are the same picture\n');

const item = (name, hash, extra = {}) => ({
  path: `C:\\x\\${name}`,
  hash,
  aspect: 1.5,
  size: 1000,
  mtimeMs: 1,
  ...extra,
});

{
  const identical = p.groupSimilar([
    item('a', '0f1e2d3c4b5a6978'),
    item('b', '0f1e2d3c4b5a6978'),
    item('c', 'ffffffffffffffff'),
  ]);
  check('two identical hashes group', identical.length === 1 && identical[0].count === 2,
    `${identical.length} groups`);
  check('and the unrelated one is left alone', identical[0].files.every((f) => !f.path.endsWith('c')));

  const apart = p.groupSimilar([
    item('a', '0000000000000000'),
    item('b', '00000000000000ff'), // eight bits apart
  ]);
  check('eight bits apart is not a group', apart.length === 0, `${apart.length} groups`);

  const close = p.groupSimilar([
    item('a', '0000000000000000'),
    item('b', '000000000000000f'), // four bits apart, exactly at the line
  ]);
  check('exactly at the threshold still groups', close.length === 1, `${close.length} groups`);

  // The shape gate. A hash is computed on a nine-by-eight grid whatever shape
  // it came from, so a wide crop and its source can hash within a bit or two.
  const cropped = p.groupSimilar([
    item('full', '0000000000000000', { aspect: 1.5 }),
    item('crop', '0000000000000000', { aspect: 2.4 }),
  ]);
  check('the same hash at a different shape is not a group', cropped.length === 0,
    `${cropped.length} groups`);

  const sameShape = p.groupSimilar([
    item('a', '0000000000000000', { aspect: 1.5 }),
    item('b', '0000000000000000', { aspect: 1.52 }),
  ]);
  check('a rounding-sized difference in shape still groups', sameShape.length === 1);
}

console.log('\nperceptual: closeness does not chain\n');

{
  // The bug the benchmark found, printed as "widest gap in a group: 5, of 4
  // allowed". A is four from B, B is four from C, so union-find put A and C --
  // eight bits apart, plainly different pictures -- in one group. On a screen
  // where somebody deletes all but one copy, that is a photograph destroyed.
  const chain = p.groupSimilar([
    item('a', '0000000000000000'),
    item('b', '000000000000000f'), // 4 from a
    item('c', '00000000000000ff'), // 4 from b, 8 from a
  ]);

  for (const group of chain) {
    for (let i = 0; i < group.files.length; i++) {
      for (let j = i + 1; j < group.files.length; j++) {
        const d = p.hamming(group.files[i].hash, group.files[j].hash);
        check(`every pair inside a group is within ${p.MAX_DISTANCE}`, d <= p.MAX_DISTANCE, `${d} bits`);
      }
    }
  }
  check('and the chain became more than one group, not one big one',
    chain.every((g) => g.spread <= p.MAX_DISTANCE),
    chain.map((g) => `${g.count} files, spread ${g.spread}`).join(' | '));

  // A longer chain, to be sure the splitting is not a special case of three.
  const long = p.groupSimilar([
    item('a', '0000000000000000'),
    item('b', '0000000000000003'),
    item('c', '000000000000000f'),
    item('d', '000000000000003f'),
    item('e', '00000000000000ff'),
    item('f', '00000000000003ff'),
  ]);
  const widest = long.length ? Math.max(...long.map((g) => g.spread)) : 0;
  check('a six-link chain never produces an over-wide group', widest <= p.MAX_DISTANCE,
    `widest spread ${widest} across ${long.length} groups`);

  // And the honest case still works: a real burst, every frame close to every
  // other, stays as one group rather than being split into pairs.
  const burst = p.groupSimilar([
    item('1', '0000000000000000'),
    item('2', '0000000000000001'),
    item('3', '0000000000000003'),
    item('4', '0000000000000002'),
  ]);
  check('a genuine burst stays one group', burst.length === 1 && burst[0].count === 4,
    burst.map((g) => g.count).join(','));
}

console.log('\nperceptual: grouping at scale\n');

{
  // Fifty thousand photographs is 1.25 billion pairs. The band index is what
  // stops this being quadratic, and a test that only ever sees three files
  // would never notice it had stopped working.
  const many = [];
  for (let i = 0; i < 4000; i++) {
    const hash = i.toString(16).padStart(16, '0');
    many.push(item(`f${i}`, hash, { size: 1000 + i }));
  }
  // Twenty deliberate duplicates of one of them.
  for (let i = 0; i < 20; i++) many.push(item(`dup${i}`, (7).toString(16).padStart(16, '0'), { size: 500 }));

  const started = Date.now();
  const groups = p.groupSimilar(many);
  const ms = Date.now() - started;

  check('four thousand hashes group in well under a second', ms < 1000, `${ms}ms`);
  check('and the deliberate duplicates were found',
    groups.some((g) => g.count >= 21), groups.map((g) => g.count).sort((a, b) => b - a).slice(0, 3).join(','));
  check('no group is wider than the threshold',
    groups.every((g) => g.spread <= p.MAX_DISTANCE),
    String(Math.max(0, ...groups.map((g) => g.spread))));
}

console.log('\nperceptual: rubbish in\n');

{
  check('items with no hash are ignored, not grouped',
    p.groupSimilar([item('a', null), item('b', undefined)]).length === 0);
  check('a short hash is ignored', p.groupSimilar([item('a', 'abc'), item('b', 'abc')]).length === 0);
  check('an empty list does not throw', p.groupSimilar([]).length === 0);
  check('a one-item list does not throw', p.groupSimilar([item('a', '0000000000000000')]).length === 0);
  check('items with no aspect ratio do not group',
    p.groupSimilar([item('a', '0000000000000000', { aspect: 0 }), item('b', '0000000000000000', { aspect: 0 })]).length === 0);
  check('a 2x2 bitmap does not throw', (() => {
    try { p.analyse(flat(2, 2, 100), 2, 2); return true; } catch { return false; }
  })());
  check('a 1x1 bitmap does not throw', (() => {
    try { p.analyse(flat(1, 1, 100), 1, 1); return true; } catch { return false; }
  })());
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
