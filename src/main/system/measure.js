'use strict';

/**
 * The system breakdown, from button to model: the one sequence both the window
 * (through `ipc.js`) and `scripts/verify-system.js` run, so what the harness
 * measures is what the app measures.
 *
 *   facts()             the drive's size and the files Windows holds open --
 *                       instant, shown before anything is walked
 *   walk()              every folder, unelevated; minutes, with progress
 *   elevate(walk, ...)  one UAC prompt, then the folders that were refused and
 *                       the Windows tools that need an administrator
 *   model(...)          all of it put together by breakdown.build()
 *
 * The helper is started only by elevate(), which only runs when somebody
 * pressed the button that says it will ask for administrator rights, and it is
 * stopped as soon as it has answered.
 */

const path = require('node:path');
const { execFile } = require('node:child_process');

const breakdown = require('./breakdown');
const parse = require('./parse');
const { diskUsage } = require('../lib/disk');
const { findUserBins, listItems, matchRecorded } = require('../lib/recyclebin');

const system32 = (exe) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe);

/**
 * The size of the files Windows keeps open, from a folder listing.
 *
 * `fs.stat` opens the file and is refused (`EPERM` for hiberfil.sys, measured);
 * `dir` reads the directory entry instead. `cmd.exe` by absolute path, fixed
 * arguments, `/-c` so the size has no thousands separators.
 */
function systemFiles(drive) {
  const names = ['hiberfil.sys', 'pagefile.sys', 'swapfile.sys'].map((n) => `${drive}${n}`);
  return new Promise((resolve) => {
    execFile(system32('cmd.exe'), ['/d', '/c', 'dir', '/a', '/-c', ...names], { windowsHide: true, timeout: 20000, encoding: 'latin1' },
      (err, stdout) => resolve(parse.parseSystemFiles(String(stdout || ''))));
  });
}

async function facts(drive = breakdown.driveOf()) {
  const [volume, files] = await Promise.all([diskUsage(drive), systemFiles(drive)]);
  return { drive, volume, systemFiles: files };
}

function walk({ drive = breakdown.driveOf(), home, token, onProgress } = {}) {
  return breakdown.walkDrive({ drive, home, token, onProgress });
}

/**
 * How much of the Recycle Bin on this drive the app put there -- its record
 * corroborated by the bin's own metadata, the purge's rule.
 */
async function appInBin(ledger, drive) {
  if (!ledger) return 0;
  try {
    const entries = (await ledger.ensureLoaded()).filter((e) => e.path.slice(0, 3).toUpperCase() === drive.toUpperCase());
    if (entries.length === 0) return 0;
    const items = await listItems(await findUserBins([drive]));
    let bytes = 0;
    for (const item of matchRecorded(entries, items).values()) bytes += item.size;
    return bytes;
  } catch {
    return 0;
  }
}

/**
 * The elevated pass. `client` is a HelperClient that has not been started.
 *
 * DISM is the slow one (80 s on the machine this was built on), so it is
 * asked first and awaited last; the folders and the other tools take seconds.
 *
 * @returns {Promise<object>} the parsed elevated input for breakdown.build(),
 *   or `{ declined: true }` if the prompt was refused
 */
async function elevate(walkResult, { client, onProgress = () => {} }) {
  onProgress({ phase: 'prompt' });
  try {
    await client.start();
  } catch (err) {
    if (err && err.code === 'EDECLINED') return { declined: true };
    throw err;
  }
  try {
    const ping = await client.request('ping');
    if (!ping || !ping.elevated) throw new Error('The helper started without administrator rights');

    onProgress({ phase: 'dism' });
    const dismPending = client.request('dism.analyze', {}, { timeoutMs: 25 * 60000 }).catch((err) => ({ error: err.message }));

    onProgress({ phase: 'folders', count: walkResult.denied.length });
    const request = breakdown.elevatedRequest(walkResult);
    const folders = await client.request('system.breakdown', { dirs: request.dirs }, { timeoutMs: 20 * 60000 });

    onProgress({ phase: 'tools' });
    const [shadowOut, ntfsOut, reserveOut] = await Promise.all([
      client.request('shadowstorage.query', {}, { timeoutMs: 120000 }),
      client.request('ntfs.info', {}, { timeoutMs: 120000 }),
      client.request('storagereserve.query', {}, { timeoutMs: 120000 }),
    ]);

    onProgress({ phase: 'dism-wait' });
    const dismOut = await dismPending;

    return {
      at: Date.now(),
      sums: folders.sums,
      targets: request.targets,
      shadow: parse.parseShadowStorage(shadowOut.text, { exitCode: shadowOut.exitCode }),
      ntfs: parse.parseNtfsInfo(ntfsOut.text, { exitCode: ntfsOut.exitCode }),
      reserve: parse.parseStorageReserve(reserveOut.text, { exitCode: reserveOut.exitCode }),
      dism: dismOut.error ? { state: 'unreadable', error: dismOut.error } : parse.parseDism(dismOut.text, { exitCode: dismOut.exitCode }),
    };
  } finally {
    // One prompt, one set of answers. Closing the pipe is what makes it leave.
    client.stop();
  }
}

/** Everything together, as breakdown.build() sees it. */
async function model({ walk: walkResult, elevated = null, ledger = null, factsNow = null }) {
  const now = factsNow || (await facts(walkResult.drive));
  return breakdown.build({
    walk: walkResult,
    volume: now.volume,
    systemFiles: now.systemFiles,
    appInBin: await appInBin(ledger, walkResult.drive),
    elevated,
  });
}

module.exports = { facts, walk, elevate, model, systemFiles, appInBin };
