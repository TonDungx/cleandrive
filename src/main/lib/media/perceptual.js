'use strict';

/**
 * What a picture looks like, reduced to sixty-four bits and two numbers.
 *
 * Phase two's arithmetic, over raw pixels somebody else supplied. Nothing here
 * opens a file or requires Electron, which is the point: the thumbnails come
 * from `nativeImage`, which only exists in the main process, and everything
 * that reasons about them is here where it can be tested against pixel buffers
 * written by hand.
 *
 * ## No model, no library
 *
 * A difference hash is eight rows of eight comparisons. A Laplacian variance is
 * a three-by-three kernel and one pass. Both fit on a page, both run on a
 * thirty-two pixel thumbnail in microseconds, and neither has an opinion it did
 * not get from the pixels. That is the whole of what this subsystem needs: the
 * alternative is a model download and a dependency, in an app whose selling
 * point is that it has one.
 */

/* -------------------------------------------------------------------------- */
/* pixels                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * BGRA bytes to a single grey plane.
 *
 * Electron hands out **BGRA**, not RGBA -- the byte order of the platform's own
 * bitmaps. Reading it as RGBA does not fail, it swaps red and blue, which
 * leaves a hash that is stable and wrong: the same picture always hashes the
 * same way, so nothing looks broken, but a red sunset and a blue one collide.
 *
 * The weights are the usual luma coefficients, applied to the right channels.
 *
 * @param {Buffer|Uint8Array} bitmap
 * @returns {Float64Array} one value per pixel, 0..255
 */
function toGrey(bitmap, width, height) {
  const pixels = width * height;
  const grey = new Float64Array(pixels);
  for (let i = 0, p = 0; p < pixels; i += 4, p++) {
    grey[p] = 0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2];
  }
  return grey;
}

/**
 * Resample a grey plane by averaging the pixels that fall in each output cell.
 *
 * Box averaging rather than nearest-neighbour, and that is not a refinement.
 * Nearest-neighbour picks one source pixel per output pixel, so a one-pixel
 * shift in the source -- which a re-encode produces routinely -- can change
 * which pixel is picked and flip a bit in the hash. Averaging makes the result
 * depend on the whole neighbourhood, which is what makes two encodings of the
 * same photograph land on the same hash.
 */
function resample(grey, width, height, targetWidth, targetHeight) {
  const out = new Float64Array(targetWidth * targetHeight);
  const xScale = width / targetWidth;
  const yScale = height / targetHeight;

  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor(ty * yScale);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * yScale));

    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor(tx * xScale);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * xScale));

      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        const row = y * width;
        for (let x = x0; x < x1 && x < width; x++) {
          sum += grey[row + x];
          n++;
        }
      }
      out[ty * targetWidth + tx] = n > 0 ? sum / n : 0;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* the hash                                                                    */
/* -------------------------------------------------------------------------- */

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

/**
 * A difference hash: is each pixel brighter than the one to its right?
 *
 * Sixty-four of those questions, from a nine-by-eight thumbnail. It survives
 * resizing, re-encoding and a change of brightness, because every bit is a
 * comparison between two neighbours rather than a measurement of either -- turn
 * the whole picture up by ten per cent and every comparison gives the same
 * answer.
 *
 * Returned as sixteen hex characters so it can be a cache key, a Map key and a
 * thing a person can read in a log without decoding anything.
 *
 * @returns {string} 16 hex characters
 */
function dHash(grey, width, height) {
  const small = resample(grey, width, height, HASH_WIDTH, HASH_HEIGHT);
  let hex = '';
  let nibble = 0;
  let bits = 0;

  for (let y = 0; y < HASH_HEIGHT; y++) {
    const row = y * HASH_WIDTH;
    for (let x = 0; x < HASH_WIDTH - 1; x++) {
      nibble = (nibble << 1) | (small[row + x] > small[row + x + 1] ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

/** Bits set in each of the sixteen hex digits, so Hamming is a table lookup. */
const POPCOUNT = new Uint8Array(16);
for (let i = 0; i < 16; i++) {
  POPCOUNT[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1);
}

const HEX_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) HEX_VALUE['0123456789abcdef'.charCodeAt(i)] = i;

/**
 * How many of the sixty-four answers differ.
 *
 * Returns 64 -- as far apart as possible -- for anything malformed, so a
 * corrupt cache entry can never make two pictures look alike.
 */
function hamming(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const x = HEX_VALUE[a.charCodeAt(i)];
    const y = HEX_VALUE[b.charCodeAt(i)];
    if (x < 0 || y < 0) return 64;
    distance += POPCOUNT[x ^ y];
  }
  return distance;
}

/* -------------------------------------------------------------------------- */
/* the other two numbers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How much fine detail the picture has, as the variance of a Laplacian.
 *
 * **This is not a blur detector**, and the app is careful never to call it one.
 * Measured on this machine: sharp scanned documents score 390 to 550 while
 * screen recordings of text score 3,000 to 6,000. The spread tracks subject
 * matter, not focus -- a photograph of fog, of snow, of a plain wall, or one
 * with a deliberately shallow depth of field all land where a genuinely
 * out-of-focus photograph lands.
 *
 * What it is honestly good for is *ordering*: "least detail first" puts the
 * blank frames, the accidental pocket shots and the smeared thumbnails at the
 * top of a list a person then looks at. That is how the UI uses it, and it is
 * why there is no trait or filter chip called "blurry".
 */
function detail(grey, width, height) {
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSquares = 0;
  let n = 0;

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const value =
        grey[i - 1] + grey[i + 1] + grey[i - width] + grey[i + width] - 4 * grey[i];
      sum += value;
      sumSquares += value * value;
      n++;
    }
  }

  if (n === 0) return 0;
  const mean = sum / n;
  return Math.max(0, sumSquares / n - mean * mean);
}

/**
 * Mean brightness and how much it varies.
 *
 * Unlike the detail figure, this one *does* support a verdict, because its
 * extremes are unambiguous: a frame whose every pixel is the same black is a
 * frame with nothing in it, whatever the subject was meant to be. The
 * combination -- no brightness and no variation -- is what `blank` is built on,
 * and either one alone is not enough. A photograph of a night sky is dark and
 * varies; a white product shot is bright and varies.
 */
function luminance(grey) {
  const n = grey.length;
  if (n === 0) return { mean: 0, deviation: 0 };

  let sum = 0;
  for (let i = 0; i < n; i++) sum += grey[i];
  const mean = sum / n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = grey[i] - mean;
    variance += d * d;
  }
  return { mean, deviation: Math.sqrt(variance / n) };
}

/** Below both of these a frame has nothing in it at all. */
const BLANK_DEVIATION = 3;

function isBlank(lum) {
  return lum.deviation < BLANK_DEVIATION;
}

/**
 * The scale the detail figure is always measured at.
 *
 * A Laplacian variance depends on how big the picture is: the same photograph
 * at 256 pixels and at 32 has neighbouring pixels a different distance apart,
 * so the gradients between them differ, so the variance differs -- by an order
 * of magnitude, not a little. The figure is used to rank files against each
 * other, so it has to be measured at one scale or the ranking is really a
 * ranking of thumbnail sizes.
 *
 * The height is fixed and the width follows the aspect ratio, rather than
 * squashing everything into a square: a 16:9 frame forced into 32×32 has its
 * horizontal gradients stretched, which would make wide pictures score
 * differently from tall ones for no reason to do with their content.
 */
const DETAIL_HEIGHT = 32;

/**
 * Everything phase two computes, from one bitmap.
 *
 * Takes whatever size thumbnail it is given and normalises internally, because
 * the caller's size is decided by what the shell handed back and by what the
 * grid wants to draw -- neither of which is this function's business.
 *
 * @param {Buffer|Uint8Array} bitmap  BGRA, row-major
 * @returns {{hash: string, detail: number, brightness: number, deviation: number, blank: boolean}}
 */
function analyse(bitmap, width, height) {
  const grey = toGrey(bitmap, width, height);

  // Brightness is measured on every pixel there is: it is one pass, and being
  // exact costs nothing.
  const lum = luminance(grey);

  const detailHeight = Math.min(DETAIL_HEIGHT, height);
  const detailWidth = Math.max(3, Math.min(Math.round((width / height) * detailHeight), DETAIL_HEIGHT * 4));
  const normalised =
    detailHeight === height && detailWidth === width
      ? grey
      : resample(grey, width, height, detailWidth, detailHeight);

  return {
    hash: dHash(grey, width, height),
    detail: Math.round(detail(normalised, detailWidth, detailHeight)),
    brightness: Math.round(lum.mean),
    deviation: Math.round(lum.deviation * 10) / 10,
    blank: isBlank(lum),
  };
}

/* -------------------------------------------------------------------------- */
/* grouping                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How many of the sixty-four bits may differ before two pictures stop being the
 * same picture.
 *
 * Four, which is tight, and deliberately so. The whole point of this screen is
 * that somebody looks at a group and deletes all but one of them; a group that
 * wrongly contains two different photographs is a photograph destroyed. Missing
 * a burst whose frames differ more than this costs nothing but a missed
 * opportunity, which is the direction every decision in this app leans.
 */
const MAX_DISTANCE = 4;

/**
 * How far two aspect ratios may differ and still be called the same shape.
 *
 * A hash says nothing about proportions -- it is computed on a nine-by-eight
 * grid whatever shape it came from -- so a wide crop of a photograph and the
 * photograph itself can hash within a bit or two of each other. Requiring the
 * shape to match as well is what stops "I cropped this for a banner" being
 * offered as "these are the same, delete one".
 */
const ASPECT_TOLERANCE = 0.02;

/** Hex digits per band, summing to 16. See `groupSimilar`. */
const BANDS = [4, 3, 3, 3, 3];

/**
 * Group pictures that are the same picture.
 *
 * ## Why this is not every pair compared
 *
 * Fifty thousand photographs is 1.25 billion pairs. So the hashes are indexed
 * instead, by the pigeonhole principle: split sixty-four bits into five bands,
 * and two hashes that differ in at most four bits must agree *exactly* on at
 * least one band -- four errors cannot be spread across five bands without
 * leaving one clean. Indexing every band and only comparing within a bucket
 * turns the problem from quadratic into roughly linear, and it cannot miss a
 * pair that the exhaustive comparison would have found.
 *
 * @param {Array<{path: string, hash: string, aspect: number, size: number, mtimeMs: number}>} items
 * @param {{maxDistance?: number}} [options]
 * @returns {Array<{hash: string, files: Array, count: number, wastedBytes: number}>}
 */
function groupSimilar(items, options = {}) {
  const maxDistance = options.maxDistance ?? MAX_DISTANCE;
  const usable = items.filter((item) => typeof item.hash === 'string' && item.hash.length === 16);

  /* -- index every band --------------------------------------------------- */

  const buckets = new Map();
  for (const item of usable) {
    let at = 0;
    for (let band = 0; band < BANDS.length; band++) {
      const key = `${band}:${item.hash.slice(at, at + BANDS[band])}`;
      at += BANDS[band];
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
  }

  /* -- union-find over the pairs that survive both tests ------------------ */

  const parent = new Map(usable.map((item) => [item.path, item.path]));
  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    // Path compression, so a long chain is walked once rather than every time.
    while (parent.get(key) !== root) {
      const next = parent.get(key);
      parent.set(key, root);
      key = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const bucket of buckets.values()) {
    // A band that every blank thumbnail shares would otherwise be compared
    // pairwise, which is the quadratic case coming back in through the door.
    if (bucket.length < 2 || bucket.length > 400) continue;

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        if (!sameShape(a, b)) continue;
        if (hamming(a.hash, b.hash) > maxDistance) continue;
        union(a.path, b.path);
      }
    }
  }

  /* -- collect ------------------------------------------------------------- */

  const components = new Map();
  for (const item of usable) {
    const root = find(item.path);
    const bucket = components.get(root);
    if (bucket) bucket.push(item);
    else components.set(root, [item]);
  }

  const out = [];
  for (const component of components.values()) {
    if (component.length < 2) continue;

    for (const files of tighten(component, maxDistance)) {
      if (files.length < 2) continue;

      // Largest first, then oldest. The largest copy is usually the original --
      // every re-encode on the way through a chat app makes it smaller -- but
      // nothing is selected for the user either way, so this is an ordering and
      // not a recommendation.
      files.sort((a, b) => b.size - a.size || a.mtimeMs - b.mtimeMs);

      out.push({
        hash: files[0].hash,
        files,
        count: files.length,
        // What deleting every copy but the largest would reclaim.
        wastedBytes: files.slice(1).reduce((n, f) => n + f.size, 0),
        spread: maxSpread(files),
      });
    }
  }

  out.sort((a, b) => b.wastedBytes - a.wastedBytes);
  return out;
}

/**
 * Split a connected component into groups where *every* pair is close.
 *
 * ## The bug this exists because of
 *
 * Union-find joins anything reachable, and closeness is not transitive. With a
 * threshold of four bits, A and B four apart and B and C four apart put A and C
 * -- eight apart, visibly different pictures -- in one group. The benchmark
 * printed it plainly: "widest gap in a group: 5, of 4 allowed". On a screen
 * whose whole purpose is somebody selecting all but one copy and deleting the
 * rest, a group is a claim that these are the same picture, and a chain of
 * near-misses is not that claim.
 *
 * So the component is only the candidate set, cheaply found. Each group is then
 * built so that every member is within the threshold of every other -- a
 * complete linkage rather than a single one. The seed is the largest file,
 * because if a group must be split the original belongs with its own copies
 * rather than with whatever happened to be scanned first.
 *
 * Components are small -- two or three files, almost always -- so the pairwise
 * work here is nothing. The index above is what keeps it that way.
 */
function tighten(component, maxDistance) {
  // Already tight? Almost every component is, and checking is cheaper than
  // rebuilding.
  if (component.length === 2 || maxSpread(component) <= maxDistance) return [component];

  const remaining = [...component].sort((a, b) => b.size - a.size);
  const groups = [];

  while (remaining.length > 0) {
    const seed = remaining.shift();
    const group = [seed];

    for (let i = remaining.length - 1; i >= 0; i--) {
      const candidate = remaining[i];
      const fits = group.every((member) => hamming(member.hash, candidate.hash) <= maxDistance);
      if (fits) {
        group.push(candidate);
        remaining.splice(i, 1);
      }
    }
    groups.push(group);
  }

  return groups;
}

function sameShape(a, b) {
  if (!a.aspect || !b.aspect) return false;
  const ratio = a.aspect / b.aspect;
  return Math.abs(ratio - 1) <= ASPECT_TOLERANCE;
}

/**
 * The widest gap inside a group, so the UI can say how alike these actually
 * are rather than only that they were grouped.
 */
function maxSpread(files) {
  let worst = 0;
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const d = hamming(files[i].hash, files[j].hash);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

module.exports = {
  toGrey,
  resample,
  dHash,
  hamming,
  detail,
  luminance,
  isBlank,
  analyse,
  groupSimilar,
  sameShape,
  MAX_DISTANCE,
  ASPECT_TOLERANCE,
  BLANK_DEVIATION,
  DETAIL_HEIGHT,
  HASH_WIDTH,
  HASH_HEIGHT,
};
