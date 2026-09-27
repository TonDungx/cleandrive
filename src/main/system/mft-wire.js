'use strict';

/**
 * How an `$MFT` read crosses between the two processes (A2).
 *
 * Both halves of the format live here -- the side that builds the pieces and
 * the side that puts them back together -- because a format written down
 * twice is a format that drifts, and this one is checked by round-tripping a
 * whole table through it (`scripts/test-mftwalk.js`) rather than by a reader
 * and a writer agreeing on paper.
 *
 * ## Why anything crosses at all
 *
 * Opening `\\.\C:` needs administrator; nothing else about a scan does. So
 * the elevated process reads the catalogue and this format carries it out,
 * and every rule about what a scan keeps, skips or calls safe stays on the
 * unelevated side where the ordinary scanner's rules already are. That is
 * what makes "the same filters as the ordinary scanner" true by construction
 * instead of by a second implementation that happens to agree today.
 *
 * ## Columns, not objects
 *
 * Measured on 1.2 million real file names, sizes and times: as a list of
 * objects the reply is 186.0 MB and costs 1,587 ms to write and 1,384 ms to
 * read; as columns it is 92.2 MB, 1,009 ms and 581 ms. The key names are the
 * difference -- eight of them repeated a million times.
 *
 * Nine columns leave, and they are the nine the walk reads (`mft-walk.js`).
 * The record number, the hard-link lists and the sparse/compressed/resident
 * flags stay behind: on C: they would be about 10 MB of wire that nothing on
 * the other side would look at.
 */

/** The nine, in the order they are written and read. */
const COLUMNS = Object.freeze([
  'parent',
  'name',
  'size',
  'allocated',
  'modified',
  'accessed',
  'created',
  'attributes',
  'reparse',
]);

/** Everything but the names, which is what a typed array can hold. */
const NUMERIC = COLUMNS.filter((c) => c !== 'name');

/**
 * What one record is assumed to cost, before its name.
 *
 * Eight numbers and their commas. It does not have to be exact: it decides
 * when to cut a piece, and the budget it is measured against is half the line
 * limit, so being wrong by a third still leaves room.
 */
const FIXED_BYTES = 70;

/** A folder row costs less: a number, a parent, a name, two small numbers. */
const FOLDER_BYTES = 40;

/**
 * The pieces of one table, in the order they must be sent.
 *
 * Folders first, because the app can start resolving nothing until it has
 * them all and files are the long tail. A generator rather than an array:
 * the elevated process builds one piece, sends it, and lets it go.
 *
 * @param {Map<number, object>} folders
 * @param {object} files    columns, from `mft.collect`
 * @param {object} [limits]
 */
function* chunksOf(folders, files, { maxBytes = 512 * 1024, maxRecords = 8192 } = {}) {
  let rows = [];
  let bytes = 0;
  for (const [number, folder] of folders) {
    rows.push([number, folder.parent, folder.name, folder.attributes || 0, folder.reparseTag || 0]);
    bytes += Buffer.byteLength(folder.name, 'utf8') + FOLDER_BYTES;
    if (bytes >= maxBytes || rows.length >= maxRecords) {
      yield { kind: 'folders', rows };
      rows = [];
      bytes = 0;
    }
  }
  if (rows.length) yield { kind: 'folders', rows };

  let from = 0;
  while (from < files.length) {
    let to = from;
    let width = 0;
    while (to < files.length && width < maxBytes && to - from < maxRecords) {
      width += Buffer.byteLength(files.name[to], 'utf8') + FIXED_BYTES;
      to += 1;
    }
    const chunk = { kind: 'files', from, count: to - from };
    // `Array.from` on a typed-array view: JSON cannot serialise a typed
    // array, and a plain array of numbers is what the other side builds its
    // own columns out of anyway.
    chunk.name = files.name.slice(from, to);
    for (const column of NUMERIC) chunk[column] = Array.from(files[column].subarray(from, to));
    yield chunk;
    from = to;
  }
}

/**
 * Files as the walk needs them, grown as the pieces arrive.
 *
 * Capacity doubles like `mft.FileColumns` does, from the same reasoning: a
 * million small objects cost more in headers than the numbers do in total,
 * and give the garbage collector a million things to walk.
 *
 * This is deliberately not a `mft.FileColumns` and deliberately has no
 * `at()`: code that wants a whole file record wants one of the three fields
 * that did not come, and should fail loudly rather than be told `false`.
 */
class Columns {
  constructor(capacity = 1 << 16) {
    this.length = 0;
    this.capacity = capacity;
    this.parent = new Int32Array(capacity);
    this.size = new Float64Array(capacity);
    this.allocated = new Float64Array(capacity);
    this.modified = new Float64Array(capacity);
    this.accessed = new Float64Array(capacity);
    this.created = new Float64Array(capacity);
    this.attributes = new Int32Array(capacity);
    this.reparse = new Uint32Array(capacity);
    this.name = new Array(capacity);
  }

  reserve(more) {
    if (this.length + more <= this.capacity) return;
    let capacity = this.capacity;
    while (capacity < this.length + more) capacity *= 2;
    for (const field of NUMERIC) {
      const bigger = new this[field].constructor(capacity);
      bigger.set(this[field]);
      this[field] = bigger;
    }
    this.name.length = capacity;
    this.capacity = capacity;
  }

  append(chunk) {
    const count = Number(chunk.count) || 0;
    if (count === 0) return;
    this.reserve(count);
    const at = this.length;
    for (const field of NUMERIC) this[field].set(chunk[field], at);
    for (let k = 0; k < count; k++) this.name[at + k] = chunk.name[k];
    this.length = at + count;
  }
}

/** The other end: every piece, back into a table. */
function receiver({ onProgress = null } = {}) {
  const folders = new Map();
  const files = new Columns();
  let records = 0;

  return {
    folders,
    files,
    get records() {
      return records;
    },
    accept(chunk) {
      if (!chunk || typeof chunk !== 'object') return;
      if (chunk.kind === 'progress') {
        records = chunk.records || records;
        if (onProgress) onProgress(chunk);
        return;
      }
      if (chunk.kind === 'folders') {
        for (const row of chunk.rows || []) {
          folders.set(row[0], { parent: row[1], name: row[2], attributes: row[3], reparseTag: row[4] });
        }
        return;
      }
      if (chunk.kind === 'files') files.append(chunk);
    },
  };
}

module.exports = { COLUMNS, NUMERIC, chunksOf, receiver, Columns };
