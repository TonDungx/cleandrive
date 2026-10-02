'use strict';

/**
 * From the files on a share to the rows the console draws (H3). Pure.
 *
 * Every report is untrusted (report.js says why) and arrives already rebuilt
 * by `parse()`. What this adds is the console's own judgement, as codes the
 * window words in its language -- never colours: green, amber and red are for
 * verdicts on files in this app, and these are facts about machines.
 *
 * ## What counts as needing a look
 *
 * - **No report for two days.** The report rides on the daily measurement, so
 *   a machine whose task has broken cannot say so -- it falls silent. Silence
 *   is therefore the console's strongest signal, not something to hide.
 * - A cleanup task that is switched on but not registered, or registered but
 *   not matching the profile; a last run Windows recorded as failed.
 * - A drive that would fill within 30 days on the machine's own trend, or is
 *   over 95% full. Both thresholds are this console's choice, said on screen.
 * - The machine's own check of its journal finding a sealed session changed
 *   or missing.
 * - **What only an off-machine copy can see** (decided 2026-10-02): the
 *   newest seal's number going backwards, or a number already seen coming
 *   back with a different hash. H4 proves both pass the seal on the machine
 *   itself -- the newest sessions removed, the journal rewritten and re-signed
 *   by the person whose account the task runs as. The console remembers each
 *   machine's seals in its own folder, so it notices, provided it read the
 *   report before the change. It cannot notice a person who forges every
 *   report from then on: they can write their own machine's file.
 * - A report older than one already seen for the same machine (an old file
 *   put back), and a file whose name is not its machine's.
 */

const { parse, fileNameFor } = require('./report');

const DAY = 24 * 60 * 60 * 1000;
const STALE_MS = 2 * DAY;
/** A report dated this far in the future is a clock that is wrong somewhere. */
const FUTURE_MS = 60 * 60 * 1000;
const FILLS_SOON_DAYS = 30;
const NEARLY_FULL_PERCENT = 95;
/** How many seal numbers to remember per machine. A year of daily cleanups is ~400. */
const KEEP_SEALS = 600;

/**
 * Task Scheduler results that are not a failed run: success, ready, running,
 * never run, and "an instance was already running" (the run was skipped, not
 * broken). Everything else, once a task has run at all, is.
 */
const NOT_FAILED = new Set([0x0, 0x41300, 0x41301, 0x41303, 0x8004131f]);

/* ------------------------------------------------------------ memory */

function emptySeen() {
  return { version: 1, shares: {} };
}

/** The share as a key: case and trailing separators do not make another share. */
function shareKey(share) {
  return String(share || '').replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * Compare a machine's newest seal with what this console has seen of it.
 *
 * @returns {{state: string, previousMax: number, keyChanged: boolean, memory: object}}
 */
function checkSeal(memory, seal) {
  const mem = memory ? { seals: { ...memory.seals }, maxN: memory.maxN || 0, key: memory.key || null } : { seals: {}, maxN: 0, key: null };
  const previousMax = mem.maxN;
  if (!seal) {
    // No genuine seal at all, where there were some: the journal is gone or
    // was replaced. Kept as it was, so the alarm stays until somebody looks.
    return { state: previousMax > 0 ? 'gone' : 'none', previousMax, keyChanged: false, memory: mem };
  }
  const known = mem.seals[seal.n];
  let state;
  if (known && known !== seal.hash) state = 'rewritten';
  else if (seal.n < previousMax) state = 'back';
  else if (previousMax === 0) state = 'new';
  else if (seal.n === previousMax) state = 'same';
  else state = 'advanced';

  const keyChanged = Boolean(seal.key && mem.key && seal.key !== mem.key);
  // The first hash seen for a number is the one kept: a rewrite must not be
  // able to make itself the reference by being read twice.
  if (!known) mem.seals[seal.n] = seal.hash;
  mem.maxN = Math.max(previousMax, seal.n);
  if (seal.key) mem.key = seal.key;
  const numbers = Object.keys(mem.seals).map(Number).sort((a, b) => b - a);
  for (const n of numbers.slice(KEEP_SEALS)) delete mem.seals[n];
  return { state, previousMax, keyChanged, memory: mem };
}

/* ------------------------------------------------------------ one machine */

/** The volume a row is summarised by: the one that fills first, else the fullest. */
function primaryVolume(volumes) {
  if (volumes.length === 0) return null;
  const forecast = volumes.filter((v) => v.fullIn && v.fullIn.ok).sort((a, b) => a.fullIn.days - b.fullIn.days);
  if (forecast.length > 0) return forecast[0];
  return [...volumes].sort((a, b) => b.usedPercent - a.usedPercent)[0];
}

function rowFor(file, parsed, memory, now) {
  const r = parsed.report;
  const attention = [];
  const notes = [];

  const ageMs = now - r.generatedAt;
  const stale = ageMs > STALE_MS;
  if (stale) attention.push({ code: 'stale', days: Math.floor(ageMs / DAY) });
  if (-ageMs > FUTURE_MS) attention.push({ code: 'future' });
  if (!parsed.nameMatches) attention.push({ code: 'nameMismatch', expected: fileNameFor(r.host) });
  if (memory && memory.lastGeneratedAt && r.generatedAt < memory.lastGeneratedAt) {
    attention.push({ code: 'older', seenAt: memory.lastGeneratedAt });
  }

  // Seals, against the console's memory of this machine.
  const sealCheck = checkSeal(memory, r.journal ? r.journal.seal : null);
  if (sealCheck.state === 'rewritten') attention.push({ code: 'sealRewritten', n: r.journal.seal.n });
  else if (sealCheck.state === 'back') attention.push({ code: 'sealBack', from: sealCheck.previousMax, to: r.journal.seal.n });
  else if (sealCheck.state === 'gone') attention.push({ code: 'sealBack', from: sealCheck.previousMax, to: 0 });
  if (sealCheck.keyChanged) notes.push({ code: 'sealKeyChanged' });
  if (r.journal && (r.journal.sessions.altered > 0 || r.journal.missing > 0)) {
    attention.push({ code: 'journalAltered', altered: r.journal.sessions.altered, missing: r.journal.missing });
  }

  // Tasks.
  const profiles = r.tasks ? r.tasks.profiles : [];
  const missing = profiles.filter((p) => p.enabled && !p.installed).map((p) => p.id);
  const wrong = profiles.filter((p) => p.enabled && p.installed && !p.verified).map((p) => p.id);
  if (missing.length > 0) attention.push({ code: 'taskMissing', ids: missing });
  if (wrong.length > 0) attention.push({ code: 'taskWrong', ids: wrong });
  for (const p of profiles) {
    if (p.os && p.os.lastRunAt && p.os.lastResult !== null && !NOT_FAILED.has(p.os.lastResult)) {
      attention.push({ code: 'taskFailed', id: p.id, result: p.os.lastResult });
    }
    if (p.os && p.os.unreadable) notes.push({ code: 'osUnreadable', id: p.id });
  }
  const lastRun = profiles
    .filter((p) => p.lastRun && p.lastRun.at)
    .map((p) => ({ id: p.id, managed: p.managed, ...p.lastRun, result: p.os ? p.os.lastResult : null }))
    .sort((a, b) => b.at - a.at)[0] || null;

  // Drives.
  for (const v of r.volumes) {
    if (v.fullIn && v.fullIn.ok && v.fullIn.days <= FILLS_SOON_DAYS) attention.push({ code: 'fillsSoon', root: v.root, days: v.fullIn.days });
    else if (v.usedPercent >= NEARLY_FULL_PERCENT) attention.push({ code: 'nearlyFull', root: v.root, percent: v.usedPercent });
  }

  if (r.policy && r.policy.notApplied.length > 0) notes.push({ code: 'notApplied', names: r.policy.notApplied });
  if (r.policy && r.policy.status === 'unreadable') notes.push({ code: 'policyUnreadable' });

  const primary = primaryVolume(r.volumes);
  const row = {
    file: file.name,
    host: r.host,
    key: r.host.toLowerCase(),
    generatedAt: r.generatedAt,
    ageMs,
    stale,
    app: r.app,
    volumes: r.volumes,
    primary,
    tasks: r.tasks,
    lastRun,
    journal: r.journal,
    seal: { state: sealCheck.state, previousMax: sealCheck.previousMax, keyChanged: sealCheck.keyChanged },
    policy: r.policy,
    lastScan: r.lastScan,
    attention,
    notes,
  };
  const nextMemory = {
    ...sealCheck.memory,
    lastGeneratedAt: Math.max(memory && memory.lastGeneratedAt ? memory.lastGeneratedAt : 0, r.generatedAt),
  };
  return { row, memory: nextMemory };
}

/* ------------------------------------------------------------ the share */

/**
 * @param {{name: string, body?: string, error?: string}[]} files  from readReports()
 * @param {object} seen   the console's memory (emptySeen() the first time)
 * @param {string} share
 * @param {number} now
 * @returns {{machines: object[], unreadable: {name: string, why: string}[], duplicates: string[], seen: object}}
 */
function build(files, seen, share, now) {
  const key = shareKey(share);
  const before = (seen && seen.shares && seen.shares[key]) || {};
  const after = { ...before };
  const machines = [];
  const unreadable = [];
  const byHost = new Map();

  for (const file of files) {
    if (file.error || typeof file.body !== 'string') {
      unreadable.push({ name: file.name, why: file.error || 'unreadable' });
      continue;
    }
    const parsed = parse(file.body, { fileName: file.name });
    if (!parsed.ok) {
      unreadable.push({ name: file.name, why: parsed.why });
      continue;
    }
    const hostKey = parsed.report.host.toLowerCase();
    // Two files claiming one machine: the one whose name is its own wins, and
    // the other is listed as unreadable rather than drawn as a second machine.
    if (byHost.has(hostKey)) {
      const other = byHost.get(hostKey);
      if (!parsed.nameMatches || other.parsed.nameMatches) {
        unreadable.push({ name: file.name, why: 'duplicate' });
        continue;
      }
      unreadable.push({ name: other.file.name, why: 'duplicate' });
    }
    byHost.set(hostKey, { file, parsed });
  }

  for (const [hostKey, { file, parsed }] of byHost) {
    const { row, memory } = rowFor(file, parsed, before[hostKey], now);
    after[hostKey] = memory;
    machines.push(row);
  }
  machines.sort((a, b) => b.attention.length - a.attention.length || a.host.localeCompare(b.host));

  const nextSeen = { version: 1, shares: { ...((seen && seen.shares) || {}), [key]: after } };
  return { machines, unreadable, seen: nextSeen };
}

/** Forget what this console remembers of one machine, so its next report is the new reference. */
function forget(seen, share, host) {
  const key = shareKey(share);
  const shares = { ...((seen && seen.shares) || {}) };
  if (shares[key]) {
    const copy = { ...shares[key] };
    delete copy[String(host).toLowerCase()];
    shares[key] = copy;
  }
  return { version: 1, shares };
}

/* ------------------------------------------------------------ CSV */

/**
 * A cell, quoted where it must be, and defused where a spreadsheet would run
 * it: a text cell starting with = + - @ (or a tab or return) is a formula to
 * Excel, and every text here came from a file any machine could have written.
 * Numbers are numbers -- a falling drive's growth is legitimately negative.
 */
function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS = [
  'host', 'report_at', 'report_age_hours', 'app_version', 'drive', 'total_bytes', 'free_bytes', 'used_percent',
  'growth_bytes_per_day', 'full_in_days', 'full_at', 'forecast_note', 'profiles', 'tasks_needing_a_look',
  'last_run_at', 'last_run_outcome', 'last_run_task_result', 'newest_seal', 'seal_check', 'needs_a_look',
];

/**
 * One line per machine and drive -- the shape a spreadsheet sorts and filters
 * -- and one for a machine that reported no drive.
 *
 * @param {object[]} machines   build()'s rows
 * @param {(message: object) => string} render  words a forecast's reason
 */
function toCsv(machines, render = (m) => (m && m.en) || '') {
  const lines = [CSV_COLUMNS.join(',')];
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : '');
  for (const m of machines) {
    const profiles = m.tasks ? m.tasks.profiles : [];
    const broken = m.attention.filter((a) => a.code === 'taskMissing' || a.code === 'taskWrong').flatMap((a) => a.ids);
    const failed = m.attention.filter((a) => a.code === 'taskFailed').map((a) => a.id);
    const common = (v) => [
      m.host,
      iso(m.generatedAt),
      Math.round((m.ageMs / 3600000) * 10) / 10,
      m.app.version,
      v ? v.root : '',
      v ? v.totalBytes : null,
      v ? v.freeBytes : null,
      v ? Math.round(v.usedPercent * 100) / 100 : null,
      v && v.growth && v.growth.ok ? Math.round(v.growth.bytesPerDay) : null,
      v && v.fullIn && v.fullIn.ok ? Math.round(v.fullIn.days * 10) / 10 : null,
      v && v.fullIn && v.fullIn.ok ? iso(v.fullIn.at) : '',
      v && v.fullIn && !v.fullIn.ok ? render(v.fullIn.reason) : '',
      profiles.length,
      [...new Set([...broken, ...failed])].join(' '),
      m.lastRun ? iso(m.lastRun.at) : '',
      m.lastRun ? m.lastRun.outcome : '',
      m.lastRun && m.lastRun.result !== null ? `0x${m.lastRun.result.toString(16)}` : '',
      m.journal && m.journal.seal ? m.journal.seal.n : null,
      m.seal.state,
      m.attention.map((a) => a.code).join(' '),
    ];
    const volumes = m.volumes.length > 0 ? m.volumes : [null];
    for (const v of volumes) lines.push(common(v).map(cell).join(','));
  }
  // With a byte-order mark: Excel reads a CSV without one in the machine's
  // ANSI code page, and a forecast's reason can be Vietnamese.
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = {
  build,
  forget,
  checkSeal,
  primaryVolume,
  toCsv,
  cell,
  emptySeen,
  shareKey,
  STALE_MS,
  FILLS_SOON_DAYS,
  NEARLY_FULL_PERCENT,
  NOT_FAILED,
  CSV_COLUMNS,
};
