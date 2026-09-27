'use strict';

/**
 * The unelevated half of an `$MFT` read (A2).
 *
 * `helper/ops.js` opens the raw volume, parses the table and sends it back in
 * pieces; this asks for it, puts the pieces together (`mft-wire.js`) and
 * turns the result into something `lib/scanner.js` can walk (`mft-walk.js`).
 *
 * Nothing here needs administrator, and that is the point: the elevated
 * process is given exactly one job -- turn bytes into records -- and every
 * rule about what a scan keeps, skips or calls safe stays on this side.
 */

const mft = require('./mft');
const { mftSource } = require('./mft-walk');
const wire = require('./mft-wire');

/**
 * Ask the elevated helper for a volume's table.
 *
 * `client` is a HelperClient that is already started and has proved elevated.
 * Started here it would raise a UAC prompt nobody asked for, which is the one
 * thing `helper/client.js` exists to prevent.
 *
 * The timeout is per piece, not per read. C:'s table takes 23.3 s to parse
 * and arrives in a few hundred pieces, so any fixed deadline for the whole
 * thing would be a guess; two minutes of *silence*, on the other hand, means
 * the helper is stuck.
 *
 * @param {object} client
 * @param {string} drive   a drive letter, with or without its colon
 * @returns {Promise<{folders: Map, files: object, summary: object}>}
 */
async function readElevated(client, drive, { onProgress = null, silenceMs = 120000 } = {}) {
  const letter = String(drive).replace(/[:\\]/g, '');
  const sink = wire.receiver({ onProgress });
  const summary = await client.request(
    'mft.scan',
    { drive: letter },
    { timeoutMs: silenceMs, onChunk: (chunk) => sink.accept(chunk) }
  );
  return { folders: sink.folders, files: sink.files, summary };
}

/**
 * The table, as a source the walk can be run against.
 *
 * `root` is where paths start -- the drive root for a whole-drive scan. The
 * folder numbers become paths here, in one pass, and then every file's path
 * is a string join (`mft.resolveFolderPaths`).
 */
function sourceFor({ folders, files }, root) {
  const { paths, orphaned, looped } = mft.resolveFolderPaths(folders, root);
  return { source: mftSource({ folders, files }, paths), paths, orphaned, looped };
}

module.exports = { readElevated, sourceFor };
