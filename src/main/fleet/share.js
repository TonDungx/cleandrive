'use strict';

/**
 * Putting a report on the share, and reading the share back (H3).
 *
 * ## Measured before it was written (2026-10-02, this machine, not elevated)
 *
 * Through `\\localhost\D$` -- the real SMB client and server, though the bytes
 * never leave the machine -- a 4 KB report written to a temporary name and
 * renamed over the old one took 10-11 ms (median), 17 ms at worst; the first
 * touch of the share 121 ms. Reading 500 reports: 111 ms. Over a real network
 * these are [Unverified]; there is no second machine here (ROADMAP §11 row 12).
 *
 * Failures are what shape the code. An unknown server name failed in 2.7 s, a
 * wrong share name in 4.2 s -- and a server address that does not answer held
 * the write for **42 seconds**. Neither `process.exit()` nor Electron's
 * `app.exit()` ends the process while a write like that is pending (42.3 s
 * and 43.6 s): the thread doing it is inside Windows, and nothing in Node can
 * call it back. So:
 *
 *   - the daily measurement writes the report **last**, after the history and
 *     the summary, so a dead share costs nothing but a hidden process staying
 *     up for that long -- under the task's five-minute limit;
 *   - the console reads in the background and its window stays usable;
 *   - nothing here creates the share's folder. A mistyped path in a policy
 *     must fail, not make folders on whatever drive it happens to name.
 *
 * ## One file per machine, replaced whole
 *
 * Written to `<name>.<pid>.tmp` and renamed over the old report, so a console
 * reading at that moment sees the old file or the new one, never half of one.
 * The rename retries the way every other atomic write here does: a console
 * with the file open can hold it for a moment.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const { renameRetrying } = require('../lib/atomic');
const { fileNameFor, isReportName, MAX_BYTES } = require('./report');

/**
 * @param {string} folder  the policy's folder, as interpret() resolved it
 * @param {string} host
 * @param {string} body    serialize()'s output
 * @returns {Promise<{ok: boolean, file: string, bytes?: number, ms: number, error?: string, code?: string}>}
 */
async function writeReport(folder, host, body, { fs = fsp, now = () => Date.now() } = {}) {
  const started = now();
  const file = path.join(folder, fileNameFor(host));
  const temp = `${file}.${process.pid}.tmp`;
  try {
    // The folder must already be there: see the header.
    const stat = await fs.stat(folder);
    if (!stat.isDirectory()) return { ok: false, file, ms: now() - started, code: 'ENOTDIR', error: 'not a folder' };
    await fs.writeFile(temp, body, 'utf8');
    await renameRetrying(temp, file, { rename: fs.rename });
    return { ok: true, file, bytes: Buffer.byteLength(body), ms: now() - started };
  } catch (err) {
    try {
      await fs.unlink(temp);
    } catch {
      // never written, or the share has gone
    }
    return { ok: false, file, ms: now() - started, code: (err && err.code) || 'ERROR', error: (err && err.message) || String(err) };
  }
}

/**
 * Every report in the folder, read as text. Only `*.cleandrive.json` at the
 * top of the folder: nothing below it, nothing else, nothing large.
 *
 * @returns {Promise<{ok: boolean, files: {name: string, body?: string, size: number, mtimeMs: number, error?: string}[], error?: string, code?: string}>}
 */
async function readReports(folder, { fs = fsp, maxFiles = 5000 } = {}) {
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch (err) {
    return { ok: false, files: [], code: (err && err.code) || 'ERROR', error: (err && err.message) || String(err) };
  }
  const names = entries.filter((e) => e.isFile() && isReportName(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b)).slice(0, maxFiles);
  const files = await Promise.all(
    names.map(async (name) => {
      const full = path.join(folder, name);
      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_BYTES) return { name, size: stat.size, mtimeMs: stat.mtimeMs, error: 'tooLarge' };
        const body = await fs.readFile(full, 'utf8');
        return { name, body, size: stat.size, mtimeMs: stat.mtimeMs };
      } catch (err) {
        return { name, size: 0, mtimeMs: 0, error: (err && err.code) || 'unreadable' };
      }
    })
  );
  return { ok: true, files, truncated: names.length >= maxFiles };
}

module.exports = { writeReport, readReports };
