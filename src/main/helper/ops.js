'use strict';

/**
 * Everything the elevated helper will do. Nothing else can be asked of it.
 *
 * Every operation here only reads. The helper runs with administrator rights,
 * and the one thing that keeps that safe is that there is nothing in it that
 * writes, deletes or runs a command it was handed: every change to the system
 * the app suggests is a handoff to a Windows tool the user opens themselves.
 * `scripts/test-helper.js` reads this file and fails if a write API appears.
 *
 * The roadmap's list arrives with the features that specify them. A1 brings
 * four: `system.breakdown` (the size of folders a normal process may not
 * read), `shadowstorage.query`, `dism.analyze` and `ntfs.info`. The last three
 * run one Windows tool each, from the fixed table below -- the program by its
 * absolute path in System32, the arguments written here and nowhere else, the
 * drive letter from `SystemDrive` rather than from the request. Their output
 * comes back as text; it is parsed in the unelevated process
 * (`system/parse.js`), so the code that runs as administrator stays as small
 * as it can be.
 *
 * D1 brings `prefetch.list`, which lists one folder and reads no file in it.
 * A prefetch file's contents would say exactly when a program last started;
 * getting at them means decompressing and parsing a Microsoft format, and
 * doing that here would put a parser for untrusted input inside the
 * administrator process to save a few seconds' accuracy. The listing gives
 * the name and the modified time, and that is all that leaves.
 *
 * ## `mft.scan`, and the rule it breaks
 *
 * A2 brings `mft.scan`, which does the thing the paragraph above refuses to
 * do: it runs a byte parser (`system/ntfs.js`, `system/mft.js`) inside the
 * administrator process. That is deliberate and it was weighed, so the
 * reasoning is written down here rather than left to be rediscovered.
 *
 * There is no version of this that keeps the parser out. `$MFT` is reachable
 * only by opening the raw volume, `\\.\C:`, and a normal process is refused
 * that outright -- measured on this machine, Win32 error 5, from Node and
 * through a P/Invoke shim alike. Handing the unparsed table out instead is
 * not an option either: C:'s is 1.81 GB, where the parsed form is 112 MB.
 *
 * What makes it acceptable is the input. A prefetch file is written by
 * Windows on behalf of whatever program ran, and a program can arrange for
 * one to exist. `$MFT` is the volume's own catalogue: to put a chosen byte in
 * it you need write access to the raw volume, which is already administrator.
 * There is no attacker who can reach this parser and cannot already do
 * everything it could be tricked into doing.
 *
 * The parser is held to that anyway. Every field is read at a bounds-checked
 * offset and a record that does not add up is counted as torn rather than
 * trusted (`system/ntfs.js`, 55 checks in `scripts/test-ntfs.js`, several of
 * them malformed records); `MAX_RECORDS` caps what a claimed `$MFT` size may
 * make it allocate; and `scripts/test-helper.js` reads these files and fails
 * if anything in them writes, deletes, opens for writing or runs a command.
 *
 * DISM writes its own log under `C:\Windows\Logs\DISM` while it analyses; that
 * is DISM's doing and the only thing on disk any of these touch.
 */

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promises: fsp } = require('node:fs');

const { measureTree } = require('../system/walk');
const mft = require('../system/mft');
const wire = require('../system/mft-wire');
const { MAX_CHUNK_BYTES } = require('./protocol');

/**
 * A Windows tool by absolute path, never by name.
 *
 * This process is elevated. Resolving `whoami.exe` through PATH would run the
 * first file of that name in any folder on the PATH -- on the machine this was
 * written on that is Git's coreutils, which rejected the arguments, and on
 * somebody else's it could be anything the user can write to, now running as
 * administrator.
 */
function system32(exe) {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe);
}

/**
 * The mandatory integrity level of this process, from its own token.
 *
 * `whoami /groups` lists the token's groups including its integrity label; a
 * SID of S-1-16-12288 is High (elevated), S-1-16-16384 is System. Read by SID
 * rather than by the label's name, which Windows translates.
 */
function integrityLevel() {
  if (process.platform !== 'win32') return Promise.resolve(process.getuid && process.getuid() === 0 ? 'high' : 'medium');
  return new Promise((resolve) => {
    execFile(system32('whoami.exe'), ['/groups', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return resolve('unknown');
      const text = String(stdout);
      if (text.includes('S-1-16-16384')) return resolve('system');
      if (text.includes('S-1-16-12288')) return resolve('high');
      if (text.includes('S-1-16-8192')) return resolve('medium');
      if (text.includes('S-1-16-4096')) return resolve('low');
      return resolve('unknown');
    });
  });
}

/** The system drive, as `C:`. From the environment, never from a request. */
function systemDrive() {
  const drive = String(process.env.SystemDrive || 'C:');
  return /^[A-Za-z]:$/.test(drive) ? drive.toUpperCase() : 'C:';
}

/**
 * Every Windows tool an operation may run, with every argument it is run with.
 * A function only where the drive letter goes in.
 */
const TOOLS = Object.freeze({
  shadowstorage: { exe: 'vssadmin.exe', args: () => ['list', 'shadowstorage'], timeoutMs: 60000 },
  // `/English` makes DISM speak English whatever the display language, which
  // is what lets its output be parsed by label at all.
  dism: { exe: 'Dism.exe', args: () => ['/Online', '/Cleanup-Image', '/AnalyzeComponentStore', '/English'], timeoutMs: 20 * 60000 },
  ntfsinfo: { exe: 'fsutil.exe', args: () => ['fsinfo', 'ntfsinfo', systemDrive()], timeoutMs: 60000 },
  storagereserve: { exe: 'fsutil.exe', args: () => ['storagereserve', 'query', systemDrive()], timeoutMs: 60000 },
});

const MAX_OUTPUT = 512 * 1024;

/** Run one tool from the table and hand back what it printed. */
function runTool(name) {
  const tool = TOOLS[name];
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      system32(tool.exe),
      tool.args(),
      { windowsHide: true, timeout: tool.timeoutMs, encoding: 'buffer', maxBuffer: MAX_OUTPUT },
      (err, stdout, stderr) => {
        // These tools print ASCII in English; `latin1` keeps every byte of
        // anything else rather than turning it into replacement characters.
        resolve({
          exitCode: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          timedOut: Boolean(err && err.killed),
          text: Buffer.concat([stdout || Buffer.alloc(0), stderr || Buffer.alloc(0)]).toString('latin1').slice(0, MAX_OUTPUT),
          ms: Date.now() - started,
        });
      }
    );
  });
}

/** At most this many folders in one request: more than the walk ever lists. */
const MAX_DIRS = 5000;

/** Windows keeps 1024 prefetch files at most; this is room to spare. */
const MAX_PREFETCH = 4096;

/**
 * How much of an `$MFT` read goes in one piece.
 *
 * The byte budget is what actually decides it; the record cap is a backstop
 * for a volume of tiny names, where 512 KB would be tens of thousands of
 * records in one `JSON.parse`.
 */
const MAX_CHUNK_RECORDS = 8192;

/**
 * The folders a request may ask to have measured: absolute, already in their
 * normal form, on the system drive, and nothing that could be a pattern.
 */
function acceptableDir(dir) {
  if (typeof dir !== 'string' || dir.length < 4 || dir.length > 1024) return false;
  if (!path.win32.isAbsolute(dir) || path.win32.normalize(dir) !== dir) return false;
  if (/[*?"<>|]/.test(dir.slice(2))) return false;
  return dir.slice(0, 3).toUpperCase() === `${systemDrive()}\\`;
}

const OPS = Object.freeze({
  async ping() {
    const level = await integrityLevel();
    return { pid: process.pid, integrity: level, elevated: level === 'high' || level === 'system' };
  },

  /**
   * How much each of the given folders occupies. Sums only: no file name
   * inside any of them leaves this process.
   */
  async 'system.breakdown'(args) {
    const dirs = Array.isArray(args && args.dirs) ? args.dirs : [];
    if (dirs.length > MAX_DIRS) throw new Error(`at most ${MAX_DIRS} folders`);
    const refused = dirs.filter((d) => !acceptableDir(d));
    if (refused.length > 0) throw new Error(`not a folder on ${systemDrive()}: ${String(refused[0]).slice(0, 80)}`);
    const started = Date.now();
    const sums = [];
    for (const dir of dirs) {
      const out = await measureTree(dir);
      const all = out.buckets.all || { allocated: 0, logical: 0, files: 0 };
      sums.push({ dir, allocated: all.allocated, logical: all.logical, files: all.files, denied: out.deniedCount });
    }
    return { sums, ms: Date.now() - started };
  },

  /**
   * What is in the Prefetch folder: one entry per program Windows has seen
   * start, named after the program and a hash of where it started from.
   *
   * A normal process is refused this folder outright (EPERM, measured on this
   * machine), which is the only reason it is here. Nothing is opened: each
   * entry's name, size and modified time, and no path but the fixed one
   * below -- the request carries no arguments at all, so there is nothing in
   * it to point somewhere else.
   */
  async 'prefetch.list'() {
    const started = Date.now();
    const dir = path.join(process.env.SystemRoot || 'C:\\Windows', 'Prefetch');
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return { available: false, reason: err.code || 'EUNKNOWN', files: [], ms: Date.now() - started };
    }
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/\.pf$/i.test(entry.name)) continue;
      if (files.length >= MAX_PREFETCH) break;
      try {
        const stat = await fsp.stat(path.join(dir, entry.name));
        files.push({ name: entry.name, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // One file being gone between the listing and the stat is not a
        // reason to lose the other thousand.
      }
    }
    return { available: true, files, ms: Date.now() - started };
  },

  'shadowstorage.query'() {
    return runTool('shadowstorage');
  },

  'dism.analyze'() {
    return runTool('dism');
  },

  'ntfs.info'() {
    return runTool('ntfsinfo');
  },

  'storagereserve.query'() {
    return runTool('storagereserve');
  },

  /**
   * Read one NTFS volume's own catalogue and send it back (A2).
   *
   * The request is a single drive letter and nothing else, so there is no
   * path in it to point anywhere: `\\.\X:` is built here from one character
   * that has been checked to be a letter.
   *
   * What comes back is the table, not an answer about it. Every filter the
   * scan applies -- hidden, system, dependency folders, installed
   * applications, `.gitignore` -- stays in the unelevated process, because
   * that is the only way the fast scan and the ordinary one can be made to
   * give the same answer (`system/mft-walk.js`). So this sends every record,
   * in pieces, as columns rather than as objects: measured, 80.5 bytes per
   * file against 162.5 for a list of objects, on 1.2 million of them.
   *
   * Nine columns leave, and they are the nine the walk reads. Sizes it does
   * not use (`sparse`, `compressed`, `resident`), the record number and the
   * hard-link lists stay here; sending them would be 10 MB of wire nothing
   * would look at.
   */
  async 'mft.scan'(args, emit) {
    const letter = String((args && args.drive) || '').replace(/[:\\]/g, '');
    if (!/^[A-Za-z]$/.test(letter)) throw new Error('not a drive letter');
    if (typeof emit !== 'function') throw new Error('mft.scan has to be able to send pieces');

    const started = Date.now();
    const reader = await mft.openVolume(letter);
    try {
      const located = await mft.locateMft(reader);

      let lastProgress = 0;
      const { folders, files, spill, stats } = await mft.collect(
        mft.readRecords(reader, located, {
          onProgress: (p) => {
            // Rate-limited here rather than in the app: the point of sending
            // it is that somebody is watching a bar move, and a message per
            // megabyte of table would be 1,800 of them.
            if (Date.now() - lastProgress < 400) return;
            lastProgress = Date.now();
            emit({ kind: 'progress', pass: p.pass, records: p.records, of: p.of });
          },
        }),
        {}
      );

      // The format is `system/mft-wire.js`, which also holds the code that
      // puts the pieces back together. One place, so that the two ends cannot
      // drift; and a whole table is round-tripped through it in
      // `scripts/test-mftwalk.js` without needing a volume or a prompt.
      for (const chunk of wire.chunksOf(folders, files, { maxBytes: MAX_CHUNK_BYTES, maxRecords: MAX_CHUNK_RECORDS })) {
        await emit(chunk);
      }

      return {
        drive: `${letter.toUpperCase()}:`,
        boot: {
          bytesPerSector: located.boot.bytesPerSector,
          clusterBytes: located.boot.clusterBytes,
          recordBytes: located.boot.recordBytes,
        },
        mftBytes: Number(located.sizeBytes),
        extents: located.extents.length,
        recordsRead: located.records,
        fileCount: files.length,
        folderCount: folders.size,
        torn: stats.torn,
        unused: stats.unused,
        skipped: stats.skipped,
        withList: stats.withList,
        spilled: spill.size,
        ms: Date.now() - started,
      };
    } finally {
      await reader.close();
    }
  },
});

function has(op) {
  return typeof op === 'string' && Object.prototype.hasOwnProperty.call(OPS, op);
}

module.exports = { OPS, TOOLS, has, integrityLevel, system32, systemDrive, acceptableDir, MAX_DIRS, MAX_PREFETCH };
