'use strict';

const path = require('node:path');

const { scan, attr } = require('./xml');

/**
 * The parts of the Office formats that are the same in all three of them.
 *
 * Word, Excel and PowerPoint files are the same container with different
 * contents: a ZIP of XML parts, wired together by relationship files that map
 * an opaque id to another part's path. Every reader needs that wiring, needs
 * the same rule for turning a relative target into a member name, and needs
 * the same answer about how many pictures it is willing to carry back to the
 * window. So it lives here once.
 */

/**
 * How much picture a preview is allowed to weigh.
 *
 * Images travel to the window as `data:` URIs -- the app's content policy
 * permits those and the alternative, handing the renderer a second protocol
 * for archive members, would be a lot of machinery for a preview. A data URI
 * is base64, so it is a third larger than the file, and it is copied through
 * an IPC message. Hence a ceiling rather than a best effort: a report with
 * sixty full-resolution photographs in it should degrade to a note, not to a
 * frozen window.
 */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_TOTAL = 10 * 1024 * 1024;

const IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
  // EMF and WMF are Windows metafiles. Chromium cannot draw them, so they are
  // deliberately absent and fall through to "there is a picture here".
};

/**
 * Read a relationship part.
 *
 * @param {object} zip
 * @param {string} partName  the part the relationships belong to, e.g. `word/document.xml`
 * @returns {Map<string, {target: string, external: boolean}>} keyed by relationship id
 */
function readRels(zip, partName) {
  const dir = path.posix.dirname(partName);
  const relsName = `${dir === '.' ? '' : `${dir}/`}_rels/${path.posix.basename(partName)}.rels`;
  const rels = new Map();

  const raw = zip.read(relsName);
  if (!raw) return rels;

  scan(raw.toString('utf8'), {
    open(local, attrs) {
      if (local !== 'Relationship') return;
      const id = attr(attrs, 'Id');
      const target = attr(attrs, 'Target');
      if (!id || !target) return;
      const external = attr(attrs, 'TargetMode') === 'External';
      rels.set(id, {
        target: external ? target : resolvePart(dir, target),
        external,
      });
    },
  });
  return rels;
}

/**
 * Turn a relationship target into a member name.
 *
 * Targets are relative to the folder holding the part that references them,
 * except when they start with a slash, in which case they are relative to the
 * archive root. `../media/image1.png` from inside `ppt/slides` is the common
 * shape and the reason this is not a string concatenation.
 */
function resolvePart(dir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const joined = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, target));
  // A target that climbs above the root is malformed, and following it would
  // be looking for a member that cannot exist. Left as-is so it simply misses.
  return joined.replace(/^(\.\.\/)+/, '');
}

/**
 * A budget for inlining pictures, shared across one document.
 *
 * Handed to a reader so that the limit is per document rather than per image:
 * the question "is this one too big" is much less useful than "have we carried
 * enough already".
 */
function imageBudget(zip) {
  let spent = 0;
  const seen = new Map();

  return function inline(partName) {
    if (!partName) return null;
    if (seen.has(partName)) return seen.get(partName);

    const ext = path.posix.extname(partName).slice(1).toLowerCase();
    const type = IMAGE_TYPES[ext];
    if (!type) return remember(partName, { skipped: 'format', ext });

    let bytes;
    try {
      bytes = zip.read(partName);
    } catch {
      // A member that will not expand is not a reason to fail the document.
      return remember(partName, { skipped: 'unreadable', ext });
    }
    if (!bytes) return remember(partName, { skipped: 'missing', ext });
    if (bytes.length > MAX_IMAGE_BYTES) return remember(partName, { skipped: 'tooLarge', ext, bytes: bytes.length });
    if (spent + bytes.length > MAX_IMAGE_TOTAL) return remember(partName, { skipped: 'budget', ext, bytes: bytes.length });

    spent += bytes.length;
    return remember(partName, {
      src: `data:${type};base64,${bytes.toString('base64')}`,
      bytes: bytes.length,
      ext,
    });
  };

  function remember(key, value) {
    seen.set(key, value);
    return value;
  }
}

module.exports = { readRels, resolvePart, imageBudget, MAX_IMAGE_BYTES, MAX_IMAGE_TOTAL };
