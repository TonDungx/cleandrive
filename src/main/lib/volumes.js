'use strict';

/**
 * What kind of drive a folder is on (A4).
 *
 * A scan can take in a network share, a USB disk, a card in a reader. What the
 * app may then do there differs, and measuring it is what decided each rule:
 *
 *   network    `shell.trashItem` on `\\localhost\D$\...` was refused ("Failed
 *              to perform delete operation", 187 ms) and the file stayed put,
 *              while the same call on the same file's local path put it in the
 *              Recycle Bin (2026-09-26). Windows keeps no bin for a share, so
 *              a network folder is read, and nothing is offered there.
 *   removable  not measured: there was no such drive to measure on. Until it
 *              is, the same rule as a share.
 *   cdrom      read-only by nature.
 *   fixed      as today -- whatever the bus. An external disk on USB is
 *              `fixed` to Windows; it is said to be external, nothing more.
 *
 * Asked of Windows in one call, through CIM: `Win32_LogicalDisk` for the drive
 * type, file system and a network drive's share, and the storage namespace's
 * `MSFT_Partition` / `MSFT_Disk` for the bus. Measured here: 1.45 s with
 * PowerShell's start (`Get-Partition | Get-Disk`, which says the same, took
 * 6.2 s -- most of it loading the Storage module). `Win32_DiskDrive`'s
 * InterfaceType was not used: it calls both NVMe disks on this machine "SCSI".
 * The script is fixed text and takes no input.
 */

const path = require('node:path');
const { execFile } = require('node:child_process');

const { canonicalPath, isNetworkPath } = require('./util');

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$bus = @{}',
  'try {',
  "  $ns = 'root/Microsoft/Windows/Storage'",
  '  $disks = @{}',
  '  foreach ($d in Get-CimInstance -Namespace $ns -ClassName MSFT_Disk) { $disks[[string]$d.Number] = $d.BusType }',
  '  foreach ($p in Get-CimInstance -Namespace $ns -ClassName MSFT_Partition) {',
  '    if ([int]$p.DriveLetter -ne 0) { $bus[([char]$p.DriveLetter).ToString().ToUpper()] = $disks[[string]$p.DiskNumber] }',
  '  }',
  '} catch {}',
  'foreach ($ld in Get-CimInstance -ClassName Win32_LogicalDisk) {',
  '  $letter = $ld.DeviceID.Substring(0, 1).ToUpper()',
  "  [Console]::Out.WriteLine(('drive', $letter, $ld.DriveType, $ld.FileSystem, $ld.ProviderName, $bus[$letter], $ld.Size, $ld.FreeSpace, $ld.VolumeName) -join \"`t\")",
  '}',
].join('\n');
const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

/** Win32_LogicalDisk.DriveType. */
const DRIVE_TYPES = Object.freeze({ 0: 'unknown', 1: 'noRoot', 2: 'removable', 3: 'fixed', 4: 'network', 5: 'cdrom', 6: 'ram' });

/**
 * MSFT_Disk.BusType, as Microsoft's documentation of the class numbers it.
 * Only 17 (NVMe) has been seen on this machine; the rest are the table.
 */
const BUS_TYPES = Object.freeze({
  0: 'Unknown', 1: 'SCSI', 2: 'ATAPI', 3: 'ATA', 4: '1394', 5: 'SSA', 6: 'Fibre Channel', 7: 'USB', 8: 'RAID',
  9: 'iSCSI', 10: 'SAS', 11: 'SATA', 12: 'SD', 13: 'MMC', 14: 'Virtual', 15: 'File Backed Virtual',
  16: 'Storage Spaces', 17: 'NVMe', 18: 'SCM', 19: 'UFS',
});

/** Buses that mean "plugged in from outside", whatever Windows calls the drive. */
const EXTERNAL_BUSES = new Set(['USB', '1394', 'SD', 'MMC']);

/** Drive kinds on which the app reads and offers nothing. */
const READ_ONLY_KINDS = new Set(['network', 'removable', 'cdrom']);

const number = (text) => (/^\d+$/.test(text) ? Number(text) : null);

/** The script's output, one drive per line. Anything else is ignored. */
function parse(stdout) {
  const drives = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const cells = line.split('\t');
    if (cells[0] !== 'drive' || !/^[A-Z]$/.test(cells[1] || '')) continue;
    const [, letter, type, fileSystem, provider, bus, size, free, label] = cells;
    drives.push({
      letter,
      root: `${letter}:\\`,
      type: DRIVE_TYPES[number(type)] || 'unknown',
      fileSystem: fileSystem || null,
      provider: provider || null,
      bus: bus === '' || bus === undefined ? null : BUS_TYPES[number(bus)] || 'Unknown',
      totalBytes: number(size || ''),
      freeBytes: number(free || ''),
      label: label || null,
    });
  }
  return drives;
}

function powershell() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

const TTL_MS = 60 * 1000;
let cache = null;
let inflight = null;

/**
 * Every drive letter Windows knows, with its kind and bus.
 *
 * @param {object} [options]
 * @param {boolean} [options.fresh]  ask again even if the last answer is recent
 * @param {Function} [options.run]   harnesses: `(exe, args) => Promise<stdout>`
 * @returns {Promise<{ok: boolean, drives: Array, at: number, error?: string}>}
 */
async function list({ fresh = false, run = null } = {}) {
  if (process.platform !== 'win32') return { ok: false, drives: [], at: Date.now(), error: 'Windows only' };
  if (!fresh && !run && cache && Date.now() - cache.at < TTL_MS) return cache;
  // Many paths are vetted at once before a delete; they share one question.
  if (!run && inflight) return inflight;
  const exec = run || ((exe, args) => new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: 20000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  }));
  const ask = (async () => {
    try {
      const drives = parse(await exec(powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED]));
      const answer = { ok: drives.length > 0, drives, at: Date.now() };
      if (!run && answer.ok) cache = answer;
      return answer;
    } catch (err) {
      return { ok: false, drives: [], at: Date.now(), error: err.message };
    }
  })();
  if (run) return ask;
  inflight = ask;
  try {
    return await ask;
  } finally {
    inflight = null;
  }
}

/**
 * What the app may do under one folder.
 *
 * @param {string} root
 * @param {Array} drives  from `list()`; an empty list knows only what the path says
 * @returns {{root: string, volume: string, kind: string, bus: string|null,
 *   fileSystem: string|null, external: boolean, readOnly: string|null, label: string|null}}
 */
function describe(root, drives = []) {
  const canonical = canonicalPath(root);
  if (isNetworkPath(canonical)) {
    return { root: canonical, volume: path.parse(canonical).root, kind: 'network', bus: null, fileSystem: null, external: false, readOnly: 'network', label: null };
  }
  const letter = /^([A-Za-z]):/.exec(canonical);
  const drive = letter ? drives.find((d) => d.letter === letter[1].toUpperCase()) : null;
  const kind = drive ? drive.type : 'unknown';
  return {
    root: canonical,
    volume: path.parse(canonical).root,
    kind,
    bus: drive ? drive.bus : null,
    fileSystem: drive ? drive.fileSystem : null,
    external: Boolean(drive && EXTERNAL_BUSES.has(drive.bus)),
    readOnly: READ_ONLY_KINDS.has(kind) ? kind : null,
    label: drive ? drive.label : null,
  };
}

/** `describe` for one path, asking Windows (cached) first. */
async function describePath(p, options) {
  return describe(p, (await list(options)).drives);
}

/** The drives a "whole drive" scan can be pointed at: ready, and not a share. */
function scannable(drives) {
  return drives.filter((d) => d.fileSystem && (d.type === 'fixed' || d.type === 'removable') && d.totalBytes > 0);
}

module.exports = { list, parse, describe, describePath, scannable, SCRIPT, DRIVE_TYPES, BUS_TYPES, EXTERNAL_BUSES, READ_ONLY_KINDS };
