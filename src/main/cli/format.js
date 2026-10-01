'use strict';

/**
 * How numbers, dates and the app's own messages read on the command line.
 *
 * English, always (see output.js), and in a fixed format rather than the
 * machine's locale: a report somebody pastes into a ticket should read the
 * same from every computer it came from.
 */

const i18n = require('../../i18n');
const { formatBytes } = require('../lib/util');

const count = (n) => Number(n || 0).toLocaleString('en-US');
/** `1 file`, `2 files`: the noun counted, so a report never says "1 files". */
const files = (n) => `${count(n)} ${Number(n) === 1 ? 'file' : 'files'}`;
const bytes = (n) => formatBytes(Number(n) || 0);

/** `2026-10-01 14:03` in local time, for the readable report. JSON carries ISO. */
function when(ms) {
  if (!Number.isFinite(ms)) {
    const parsed = Date.parse(ms);
    if (!Number.isFinite(parsed)) return '-';
    ms = parsed;
  }
  const d = new Date(ms);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : typeof ms === 'string' ? ms : null);

function seconds(ms) {
  if (!Number.isFinite(ms)) return '-';
  return ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

/**
 * One of the app's messages -- `{ i18n, en, params }` -- or a plain string, in
 * English. The caller sets the language once (index.js); this never changes it.
 */
function text(value) {
  if (value === null || value === undefined) return '';
  return i18n.render(value);
}

/** Right-aligned to `width`, for a column of sizes. */
const pad = (value, width) => String(value).padStart(width);

module.exports = { count, files, bytes, when, iso, seconds, text, pad };
