'use strict';

const fsp = require('node:fs/promises');

/**
 * Reading a text file so it can be shown.
 *
 * Two things this has to get right, and neither is "call readFile".
 *
 * **How much.** A log file is routinely hundreds of megabytes. Nobody reads one
 * in a preview pane, and handing the renderer a 400 MB string would stop the
 * window rather than fill it. A bounded head is read, and the fact that it is a
 * head is *said* -- an app that silently shows the first fraction of a file is
 * an app that once told somebody a log was empty.
 *
 * **Which encoding.** This matters more here than in most places, because the
 * files are Vietnamese. A `.txt` saved by an older Windows program is very
 * often `windows-1258`, and decoded as UTF-8 it comes out as a page of
 * replacement characters -- which reads as a corrupt file rather than as a
 * guess that went wrong.
 */

/** How much of a file is read for a preview. Beyond this the viewer says so. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Encodings tried, in order, when there is no byte-order mark.
 *
 * UTF-8 first and strictly: `TextDecoder` with `fatal: true` throws on a byte
 * sequence that is not valid UTF-8, which makes it a *test* rather than a
 * guess. Almost everything written this century passes it, and anything that
 * does not is genuinely something else.
 *
 * `windows-1258` before `windows-1252` because of where this app is written and
 * used. The two agree on everything except the positions Vietnamese needs, so
 * putting 1258 first costs nothing for a French or German file and rescues a
 * Vietnamese one.
 */
const FALLBACKS = ['windows-1258', 'windows-1252'];

/**
 * @param {string} filePath
 * @param {number} size       from the caller's stat, so it is not stat'd twice
 * @returns {Promise<{text: string, encoding: string, truncated: boolean,
 *                    bytesRead: number, totalBytes: number, lines: number}>}
 */
async function readText(filePath, size) {
  const handle = await fsp.open(filePath, 'r');
  let buf;
  try {
    const want = Math.min(size, MAX_BYTES);
    buf = Buffer.allocUnsafe(want);
    const { bytesRead } = await handle.read(buf, 0, want, 0);
    buf = buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }

  const { text, encoding } = decode(buf);
  const truncated = size > buf.length;

  return {
    // A file cut at two megabytes almost certainly ends mid-line. Dropping the
    // partial line is tidier than showing half a record and letting somebody
    // read it as whole.
    text: truncated ? text.slice(0, text.lastIndexOf('\n') + 1 || text.length) : text,
    encoding,
    truncated,
    bytesRead: buf.length,
    totalBytes: size,
    lines: countLines(text),
  };
}

/**
 * Bytes to characters, with the encoding worked out rather than assumed.
 *
 * @returns {{text: string, encoding: string}}
 */
function decode(buf) {
  /* -- a byte-order mark settles it, and is removed ----------------------- */

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), encoding: 'UTF-8' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'UTF-16 LE' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'UTF-16 BE' };
  }

  /* -- no mark: test rather than guess ------------------------------------ */

  try {
    // `fatal` is the whole point. Without it every byte sequence "decodes",
    // into replacement characters, and there is nothing left to tell a
    // successful guess from a failed one.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(trimPartialCharacter(buf));
    return { text, encoding: 'UTF-8' };
  } catch {
    // Not UTF-8. Fall through.
  }

  for (const encoding of FALLBACKS) {
    try {
      // These are single-byte encodings with no invalid sequences, so this
      // cannot fail -- the first one wins, which is why the order above is a
      // decision rather than a list.
      return { text: new TextDecoder(encoding).decode(buf), encoding: labelFor(encoding) };
    } catch {
      // A runtime without this encoding. Try the next.
    }
  }

  return { text: new TextDecoder('utf-8').decode(buf), encoding: 'UTF-8' };
}

/**
 * Drop a multi-byte character the read window cut in half.
 *
 * Without this, a UTF-8 file whose two-megabyte mark lands inside a Vietnamese
 * character fails the strict decode and the whole file is reported as
 * `windows-1258` -- every accent wrong, because of one byte at the end.
 */
function trimPartialCharacter(buf) {
  if (buf.length === 0) return buf;
  // A continuation byte is 10xxxxxx; a lead byte says how many follow.
  let end = buf.length;
  for (let back = 1; back <= 4 && back <= buf.length; back++) {
    const byte = buf[buf.length - back];
    if ((byte & 0xc0) !== 0x80) {
      const needed =
        (byte & 0x80) === 0 ? 1 : (byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : (byte & 0xf8) === 0xf0 ? 4 : 0;
      if (needed !== 0 && back < needed) end = buf.length - back;
      break;
    }
  }
  return end === buf.length ? buf : buf.subarray(0, end);
}

function labelFor(encoding) {
  return encoding === 'windows-1258' ? 'Windows-1258' : 'Windows-1252';
}

function countLines(text) {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines += 1;
  return lines;
}

module.exports = { readText, decode, trimPartialCharacter, MAX_BYTES, FALLBACKS };
