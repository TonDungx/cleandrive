'use strict';

/**
 * Reading what Windows' own tools print.
 *
 * Written against real output captured on this machine
 * (`scripts/fixtures/system/`, by `npm run capture:system`), not against
 * memory of what the output looks like. Two things in it decided the design:
 *
 *   - **Numbers follow the regional format, even when the words are English.**
 *     This machine's display language is English and its regional format
 *     Vietnamese, and vssadmin and fsutil print `8,60 GB` and `995.551.231`.
 *     DISM, asked for `/English`, prints `16.56 GB`. So a number is read by its
 *     shape -- which separator is last, how many digits follow it -- and never
 *     by assuming one convention.
 *   - **Sizes are binary.** fsutil calls 124,443,903 clusters of 4 KB
 *     "474,7 GB": that is 474.7 GiB. Every size here is read as 1024-based.
 *
 * Where a label has to be matched (fsutil, DISM), it is matched in English,
 * and a field that does not appear is `null` rather than a guess. A Windows
 * that prints these tools in another language gets "could not be read" on
 * screen, not a wrong number.
 */

const UNITS = { bytes: 0, byte: 0, b: 0, kb: 1, mb: 2, gb: 3, tb: 4, pb: 5 };

/**
 * `8,60` `16.56` `995.551.231` `1.234,5` `5.168` -> a number.
 *
 * With both separators present the last one is the decimal point. With one
 * kind only: repeated, it separates thousands; once, followed by exactly three
 * digits, it separates thousands too (fsutil's cluster counts); otherwise it
 * is the decimal point (every size these tools print has one or two decimals).
 */
function parseNumber(raw) {
  const text = String(raw || '').trim();
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let integer = text;
  let fraction = '';
  if (lastDot !== -1 && lastComma !== -1) {
    const at = Math.max(lastDot, lastComma);
    integer = text.slice(0, at);
    fraction = text.slice(at + 1);
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const count = text.split(sep).length - 1;
    const tail = text.slice(text.lastIndexOf(sep) + 1);
    if (count === 1 && tail.length !== 3) {
      integer = text.slice(0, text.lastIndexOf(sep));
      fraction = tail;
    }
  }
  const value = Number(`${integer.replace(/[.,]/g, '')}${fraction ? `.${fraction}` : ''}`);
  return Number.isFinite(value) ? value : null;
}

/** `8,60 GB` -> bytes. `0 bytes` -> 0. Binary units. */
function parseSize(raw) {
  const match = /^\s*(\d[\d.,]*)\s*([A-Za-z]+)\s*$/.exec(String(raw || ''));
  if (!match) return null;
  const value = parseNumber(match[1]);
  const power = UNITS[match[2].toLowerCase()];
  if (value === null || power === undefined) return null;
  return Math.round(value * 1024 ** power);
}

/** The first size in a line -- a number followed by a unit. */
function sizeIn(line) {
  const match = /(\d[\d.,]*)\s*(bytes|byte|[KMGTP]B)\b/i.exec(line);
  return match ? parseSize(`${match[1]} ${match[2]}`) : null;
}

const lines = (text) => String(text || '').split(/\r?\n/);

/**
 * `vssadmin list shadowstorage`.
 *
 * By shape, not by label: an association is a block whose first lines name
 * two volumes as `(C:)`, followed by three sizes in a fixed order -- used,
 * allocated, maximum. That order is the tool's, and it does not change with
 * the language.
 *
 * @returns {{state: 'ok'|'none'|'denied'|'unreadable', associations: Array<{forVolume, storageVolume, used, allocated, maximum}>}}
 */
function parseShadowStorage(text, { exitCode = 0 } = {}) {
  const associations = [];
  let current = null;
  for (const line of lines(text)) {
    // `(C:)`, never the `(C)` of the copyright line.
    const volume = /\(([A-Za-z]:)\)/.exec(line);
    if (volume) {
      if (!current || current.volumes.length >= 2) {
        current = { volumes: [], sizes: [] };
        associations.push(current);
      }
      current.volumes.push(volume[1].toUpperCase());
      continue;
    }
    if (!current) continue;
    const size = sizeIn(line);
    if (size !== null && current.volumes.length === 2 && current.sizes.length < 3) current.sizes.push(size);
  }
  const complete = associations
    .filter((a) => a.volumes.length === 2 && a.sizes.length === 3)
    .map((a) => ({ forVolume: a.volumes[0], storageVolume: a.volumes[1], used: a.sizes[0], allocated: a.sizes[1], maximum: a.sizes[2] }));
  let state = 'ok';
  if (complete.length === 0) {
    // vssadmin says "you don't have the correct permissions" with exit code 2;
    // with no associations and a clean exit there are simply no restore points.
    if (exitCode === 0) state = 'none';
    else if (exitCode === 2) state = 'denied';
    else state = 'unreadable';
  }
  return { state, associations: complete };
}

/** `Label : value` lines, keyed by the label in lower case. */
function labelled(text) {
  const out = new Map();
  for (const line of lines(text)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const label = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (label && !out.has(label)) out.set(label, value);
  }
  return out;
}

/**
 * `fsutil fsinfo ntfsinfo C:`.
 *
 * @returns {{state: 'ok'|'denied'|'unreadable', mftBytes: number|null, bytesPerCluster: number|null,
 *   reservedClusters: number|null, storageReserveClusters: number|null, totalClusters: number|null,
 *   freeClusters: number|null}}
 */
function parseNtfsInfo(text, { exitCode = 0 } = {}) {
  const map = labelled(text);
  const count = (label) => {
    const value = map.get(label);
    if (!value) return null;
    return parseNumber(value.split(/\s+/)[0]);
  };
  const size = (label) => {
    const value = map.get(label);
    return value ? sizeIn(value) : null;
  };
  const result = {
    state: 'ok',
    mftBytes: size('mft valid data length'),
    bytesPerCluster: count('bytes per cluster'),
    totalClusters: count('total clusters'),
    freeClusters: count('free clusters'),
    reservedClusters: count('total reserved clusters'),
    storageReserveClusters: count('reserved for storage reserve'),
  };
  if (result.mftBytes === null && result.bytesPerCluster === null) {
    result.state = exitCode !== 0 && /\b5\b|denied/i.test(String(text)) ? 'denied' : 'unreadable';
  }
  return result;
}

/**
 * `fsutil storagereserve query C:`.
 *
 * Each reserve area is a block with a guarantee and what is used, both as an
 * exact hexadecimal byte count. What is held back and not yet used is the part
 * of the guarantee the files in it have not filled; when they have overflowed
 * it, nothing is held back.
 *
 * @returns {{state: 'ok'|'denied'|'unreadable', areas: Array<{guarantee: number, used: number}>, heldBack: number}}
 */
function parseStorageReserve(text, { exitCode = 0 } = {}) {
  const areas = [];
  let current = null;
  for (const line of lines(text)) {
    if (/^\s*reserve id\s*:/i.test(line)) {
      current = { guarantee: null, used: null };
      areas.push(current);
      continue;
    }
    if (!current) continue;
    const hex = /0x([0-9a-f]+)\s*\(/i.exec(line);
    if (!hex) continue;
    const bytes = Number.parseInt(hex[1], 16);
    if (current.guarantee === null) current.guarantee = bytes;
    else if (current.used === null) current.used = bytes;
  }
  const complete = areas.filter((a) => a.guarantee !== null && a.used !== null);
  if (complete.length === 0) {
    return { state: exitCode !== 0 && /\b5\b|denied/i.test(String(text)) ? 'denied' : 'unreadable', areas: [], heldBack: null };
  }
  return { state: 'ok', areas: complete, heldBack: complete.reduce((n, a) => n + Math.max(0, a.guarantee - a.used), 0) };
}

/**
 * `DISM /Online /Cleanup-Image /AnalyzeComponentStore /English`.
 *
 * @returns {{state: 'ok'|'denied'|'unreadable', explorerSize, actualSize, sharedWithWindows, backups, cache,
 *   lastCleanup: string|null, reclaimablePackages: number|null, cleanupRecommended: boolean|null}}
 */
function parseDism(text, { exitCode = 0 } = {}) {
  const map = labelled(text);
  const size = (label) => {
    const value = map.get(label);
    return value ? sizeIn(value) : null;
  };
  const recommended = map.get('component store cleanup recommended');
  const reclaimable = map.get('number of reclaimable packages');
  const result = {
    state: 'ok',
    explorerSize: size('windows explorer reported size of component store'),
    actualSize: size('actual size of component store'),
    sharedWithWindows: size('shared with windows'),
    backups: size('backups and disabled features'),
    cache: size('cache and temporary data'),
    lastCleanup: map.get('date of last cleanup') || null,
    reclaimablePackages: reclaimable ? parseNumber(reclaimable) : null,
    cleanupRecommended: recommended ? /^yes/i.test(recommended) : null,
  };
  if (result.actualSize === null) {
    result.state = exitCode === 740 || /elevat/i.test(String(text)) ? 'denied' : 'unreadable';
  }
  return result;
}

/**
 * `dir /a /-c C:\hiberfil.sys C:\pagefile.sys C:\swapfile.sys`.
 *
 * The size is the run of digits right before the name -- `/-c` leaves out
 * the thousands separators, and the date in front of it is in the regional
 * format, so nothing else on the line is trusted.
 *
 * @returns {{hiberfil: number|null, pagefile: number|null, swapfile: number|null}}
 */
function parseSystemFiles(text) {
  const out = { hiberfil: null, pagefile: null, swapfile: null };
  for (const line of lines(text)) {
    const match = /\s(\d+)\s+(hiberfil|pagefile|swapfile)\.sys\s*$/i.exec(line);
    if (match) out[match[2].toLowerCase()] = Number(match[1]);
  }
  return out;
}

module.exports = {
  parseNumber,
  parseSize,
  parseShadowStorage,
  parseNtfsInfo,
  parseStorageReserve,
  parseDism,
  parseSystemFiles,
};
