'use strict';

/**
 * The file each machine writes for the console (H3), and the only way the
 * console reads one back.
 *
 * Pure: inputs in, a plain object out, and text in, a checked object out. What
 * gathers the inputs on a real machine is collect.js; what puts the text on a
 * share is share.js.
 *
 * ## What the file may hold
 *
 * The spec's rule is that it names no personal file, and every field here was
 * chosen against that rule rather than trimmed to it afterwards:
 *
 *   - drives by letter only, with the numbers the Trends tab already draws --
 *     growth and "when it fills" come from `history.js`, never recomputed, and
 *     a forecast that refuses itself travels as its reason;
 *   - cleanup profiles by **id** only: a profile's name is typed by a person
 *     ("Lan's photos"), and its folders are paths;
 *   - the last run's counts and outcome; its reason as a message whose text
 *     parameters are blanked, because some of them are paths or program names;
 *   - from the last manual scan, bytes per cleanup category, the date, and
 *     whether it covered a whole drive -- never the folder;
 *   - the largest folders of that scan, by name and size, **only** when the
 *     organisation ticked that box (decided 2026-10-02): a folder under
 *     C:\Users is a person's name;
 *   - the newest journal seal's number, hash and key fingerprint (decided
 *     2026-10-02), so a console off this machine can notice what the seal on
 *     its own cannot: the newest sessions removed, or the journal re-signed.
 *
 * No coordinate goes anywhere near it: `test-media-map.js` reads this folder.
 *
 * ## Reading one back
 *
 * The share is writable by every machine that reports to it, so a file on it
 * is untrusted input: any user can put any bytes under any name. `parse()`
 * therefore rebuilds the report from the fields it knows, each checked and
 * bounded, and never hands on anything it did not build itself. The console
 * draws the result with textContent only.
 */

const { PROFILE_ID } = require('../policy/schema');

const SCHEMA = 'cleandrive.machine-report/1';

/** The suffix that marks a report among whatever else lives on the share. */
const SUFFIX = '.cleandrive.json';

/** Larger than any real report by two orders of magnitude; anything bigger is not one. */
const MAX_BYTES = 256 * 1024;

const LIMITS = Object.freeze({ volumes: 26, profiles: 32, categories: 64, topFolders: 12, text: 300, params: 8 });

/* ------------------------------------------------------------ names */

/**
 * A computer name as a file name. Windows computer names are letters, digits
 * and hyphens (NetBIOS, 15 characters), so this changes nothing on a real
 * machine; it exists so a hostname from elsewhere cannot carry a path.
 */
function safeHost(host) {
  const clean = String(host || '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 63);
  return clean || 'unnamed';
}

function fileNameFor(host) {
  return `${safeHost(host)}${SUFFIX}`;
}

const isReportName = (name) => typeof name === 'string' && name.toLowerCase().endsWith(SUFFIX) && name.length > SUFFIX.length;

/* ------------------------------------------------------------ values */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, { min = -Infinity, max = Infinity } = {}) => (finite(v) && v >= min && v <= max ? v : null);
const int = (v, opts) => {
  const n = num(v, opts);
  return n !== null && Number.isInteger(n) ? n : null;
};
const iso = (ms) => (finite(ms) ? new Date(ms).toISOString() : null);
const text = (v, max = LIMITS.text) => (typeof v === 'string' ? v.slice(0, max) : null);
const bool = (v) => v === true;

/** An ISO time back to milliseconds, or null. */
function msOf(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A message for the file: `{ i18n, en, params }`, the shape the app's
 * producers already hand back, so the console words it in its own language.
 *
 * Parameters that are numbers -- "4 measurements over 2.5 days" -- are kept;
 * any other text is blanked, because it can be a path ("The drive files are
 * moved to is not available: E:\Kept") or the names of programs someone runs.
 * A plain string (an old run log's already-rendered English) is dropped for
 * the same reason.
 */
function outgoingMessage(value) {
  if (!value || typeof value !== 'object' || typeof value.i18n !== 'string') return null;
  const out = { i18n: value.i18n, en: typeof value.en === 'string' ? value.en : '' };
  if (value.params && typeof value.params === 'object') {
    out.params = {};
    for (const [k, v] of Object.entries(value.params)) {
      out.params[k] = finite(v) || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) ? v : '…';
    }
  }
  return out;
}

/** The same message read back from an untrusted file. */
function incomingMessage(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.i18n !== 'string' || !/^[a-z][A-Za-z0-9_.-]{0,80}$/.test(value.i18n)) return null;
  const out = { i18n: value.i18n, en: text(value.en) || '' };
  if (value.params && typeof value.params === 'object' && !Array.isArray(value.params)) {
    const params = {};
    for (const [k, v] of Object.entries(value.params).slice(0, LIMITS.params)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(k)) continue;
      if (finite(v)) params[k] = v;
      else if (typeof v === 'string') params[k] = v.slice(0, 100);
    }
    out.params = params;
  }
  return out;
}

/* ------------------------------------------------------------ building */

const DRIVE_ROOT = /^[A-Za-z]:\\$/;

/** A forecast or a trend, as the file carries it. */
function growthOut(g) {
  if (!g) return null;
  if (g.ok) return { ok: true, bytesPerDay: g.bytesPerDay, r2: g.r2, n: g.n, spanDays: g.spanDays };
  return { ok: false, n: g.n || 0, spanDays: g.spanDays || 0, reason: outgoingMessage(g.reason) };
}

function fullOut(p) {
  if (!p) return null;
  if (p.ok) return { ok: true, days: p.days, at: iso(p.at) };
  return { ok: false, beyondHorizon: p.beyondHorizon === true, reason: outgoingMessage(p.reason) };
}

/** What Windows says about a task, trimmed to what a console can use. */
function osOut(os) {
  if (!os) return null;
  return {
    lastRunAt: iso(os.lastRunAt),
    nextRunAt: iso(os.nextRunAt),
    lastResult: Number.isInteger(os.lastResult) ? os.lastResult >>> 0 : null,
    state: typeof os.state === 'string' ? os.state : null,
    missedRuns: Number.isInteger(os.missedRuns) ? os.missedRuns : null,
    // Not the error text: it can name a path. Whether there was one is enough.
    unreadable: Boolean(os.error),
  };
}

function lastRunOut(run) {
  if (!run) return null;
  const trashed = run.trashed || {};
  return {
    at: iso(run.finishedAt || run.startedAt),
    outcome: typeof run.outcome === 'string' ? run.outcome : null,
    via: run.via || (run.manual ? 'window' : 'scheduled'),
    reportOnly: run.dryRun === true,
    selected: { files: run.selected ? run.selected.files || 0 : 0, bytes: run.selected ? run.selected.bytes || 0 : 0 },
    moved: { files: trashed.files || 0, bytes: trashed.bytes || 0 },
    failed: trashed.failed || 0,
    freedBytes: trashed.freedBytes || 0,
    reason: outgoingMessage(run.reason),
  };
}

/**
 * The report, from what collect.js gathered.
 *
 * @param {object} input
 * @param {string} input.host
 * @param {number} input.now
 * @param {{version: string, channel: string}} input.app
 * @param {{root: string, latest: object, growth: object, prediction: object}[]} input.volumes
 * @param {object|null} input.lastScan       a history snapshot's `scan`, with its `at`
 * @param {boolean} input.topFolders         whether the policy allows the folder names
 * @param {object|null} input.tasks          from tasks.status(..., { withOsInfo: true })
 * @param {object[]} input.runs              the run log, newest first
 * @param {object|null} input.journal        from verifyJournal()
 * @param {object|null} input.managed        settings.managed
 */
function build(input) {
  const volumes = (input.volumes || [])
    .filter((v) => DRIVE_ROOT.test(v.root) && v.latest)
    .slice(0, LIMITS.volumes)
    .map((v) => ({
      root: v.root.toUpperCase(),
      measuredAt: iso(v.latest.at),
      totalBytes: v.latest.totalBytes,
      freeBytes: v.latest.freeBytes,
      usedBytes: v.latest.usedBytes,
      usedPercent: v.latest.usedPercent,
      growth: growthOut(v.growth),
      fullIn: fullOut(v.prediction),
    }));

  let lastScan = null;
  if (input.lastScan) {
    const scan = input.lastScan;
    const root = String(scan.root || '');
    const drive = /^([A-Za-z]):/.exec(root);
    lastScan = {
      at: iso(scan.at),
      // Whether it covered a whole drive is worth knowing -- a category total
      // for Downloads is not one for C: -- and says nothing about whose.
      rootKind: DRIVE_ROOT.test(root) ? 'drive' : drive ? 'folder' : 'network',
      drive: drive ? `${drive[1].toUpperCase()}:` : null,
      totalBytes: scan.totalBytes || 0,
      totalFiles: scan.totalFiles || 0,
      categories: Object.fromEntries(
        Object.entries(scan.byCategory || {})
          .filter(([k, v]) => /^[a-z][a-z0-9.]{0,40}$/.test(k) && finite(v))
          .slice(0, LIMITS.categories)
      ),
      topFolders: input.topFolders
        ? (scan.topFolders || []).slice(0, LIMITS.topFolders).map((f) => ({ name: String(f.name), size: f.size || 0 }))
        : null,
    };
  }

  const runs = input.runs || [];
  const tasks = input.tasks
    ? {
        supported: input.tasks.supported !== false,
        profiles: (input.tasks.profiles || []).slice(0, LIMITS.profiles).map((p) => ({
          id: p.profileId,
          managed: p.profileId === PROFILE_ID,
          enabled: p.wanted === true,
          reportOnly: p.dryRun === true,
          action: p.action || null,
          installed: p.installed === true,
          // Whether Windows holds a task that matches the profile -- exists,
          // points at this copy of the app, runs on the profile's timetable.
          // The problem sentences are not sent: they name task paths and are
          // in this machine's language, and the console words its own.
          verified: p.verified === true,
          os: osOut(p.os),
          lastRun: lastRunOut(runs.find((r) => r.profileId === p.profileId) || null),
        })),
        sampler: input.tasks.sampler
          ? { installed: input.tasks.sampler.installed === true, verified: input.tasks.sampler.verified === true, os: osOut(input.tasks.sampler.os) }
          : null,
      }
    : null;

  const j = input.journal;
  const journal = j
    ? {
        sessions: { ...j.counts },
        missing: j.missingCount || 0,
        seal: j.seals && j.seals.count > 0 ? { n: j.seals.last, at: iso(j.seals.lastAt), hash: j.seals.lastHash, key: j.seals.lastKey } : null,
      }
    : null;

  const m = input.managed;
  const policy = m
    ? { status: m.status || 'none', applied: m.applied || [], notApplied: m.notApplied || [], refused: m.refused || [] }
    : null;

  return {
    schema: SCHEMA,
    host: input.host,
    generatedAt: iso(input.now),
    app: { version: input.app.version, channel: input.app.channel },
    volumes,
    lastScan,
    tasks,
    journal,
    policy,
  };
}

/* ------------------------------------------------------------ text */

/**
 * ASCII JSON, as the command line writes it (H1): every character past 0x7E
 * escaped, so the file reads the same on any machine whatever its code page.
 */
function serialize(report) {
  return `${JSON.stringify(report, null, 2).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
}

/* ------------------------------------------------------------ reading back */

function osIn(o) {
  if (!o || typeof o !== 'object') return null;
  return {
    lastRunAt: msOf(o.lastRunAt),
    nextRunAt: msOf(o.nextRunAt),
    lastResult: int(o.lastResult, { min: 0, max: 0xffffffff }),
    state: text(o.state, 20),
    missedRuns: int(o.missedRuns, { min: 0 }),
    unreadable: bool(o.unreadable),
  };
}

function growthIn(g) {
  if (!g || typeof g !== 'object') return null;
  if (g.ok === true) {
    const bytesPerDay = num(g.bytesPerDay);
    if (bytesPerDay === null) return null;
    return { ok: true, bytesPerDay, r2: num(g.r2, { min: 0, max: 1 }), n: int(g.n, { min: 0 }), spanDays: num(g.spanDays, { min: 0 }) };
  }
  return { ok: false, n: int(g.n, { min: 0 }) || 0, spanDays: num(g.spanDays, { min: 0 }) || 0, reason: incomingMessage(g.reason) };
}

function fullIn(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.ok === true) {
    const days = num(p.days, { min: 0, max: 100000 });
    if (days === null) return null;
    return { ok: true, days, at: msOf(p.at) };
  }
  return { ok: false, beyondHorizon: bool(p.beyondHorizon), reason: incomingMessage(p.reason) };
}

function runIn(r) {
  if (!r || typeof r !== 'object') return null;
  const pair = (x) => ({ files: int(x && x.files, { min: 0 }) || 0, bytes: num(x && x.bytes, { min: 0 }) || 0 });
  return {
    at: msOf(r.at),
    outcome: text(r.outcome, 20),
    via: text(r.via, 20),
    reportOnly: bool(r.reportOnly),
    selected: pair(r.selected),
    moved: pair(r.moved),
    failed: int(r.failed, { min: 0 }) || 0,
    freedBytes: num(r.freedBytes, { min: 0 }) || 0,
    reason: incomingMessage(r.reason),
  };
}

const names = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string' && /^\w{1,40}$/.test(x)).slice(0, 16) : []);

/**
 * A report from the bytes of a file on the share, or why it is not one.
 *
 * @param {string} body
 * @param {{fileName?: string}} [options]
 * @returns {{ok: true, report: object, nameMatches: boolean} | {ok: false, why: string}}
 */
function parse(body, { fileName = null } = {}) {
  if (typeof body !== 'string') return { ok: false, why: 'unreadable' };
  if (body.length > MAX_BYTES) return { ok: false, why: 'tooLarge' };
  let raw;
  try {
    raw = JSON.parse(body.charCodeAt(0) === 0xfeff ? body.slice(1) : body);
  } catch {
    return { ok: false, why: 'notJson' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'notReport' };
  if (raw.schema !== SCHEMA) return { ok: false, why: typeof raw.schema === 'string' && raw.schema.startsWith('cleandrive.machine-report/') ? 'newerSchema' : 'notReport' };
  const host = text(raw.host, 63);
  const generatedAt = msOf(raw.generatedAt);
  if (!host || generatedAt === null) return { ok: false, why: 'notReport' };

  const volumes = (Array.isArray(raw.volumes) ? raw.volumes : [])
    .slice(0, LIMITS.volumes)
    .filter((v) => v && typeof v === 'object' && typeof v.root === 'string' && DRIVE_ROOT.test(v.root))
    .map((v) => ({
      root: v.root.toUpperCase(),
      measuredAt: msOf(v.measuredAt),
      totalBytes: num(v.totalBytes, { min: 0 }),
      freeBytes: num(v.freeBytes, { min: 0 }),
      usedBytes: num(v.usedBytes, { min: 0 }),
      usedPercent: num(v.usedPercent, { min: 0, max: 100 }),
      growth: growthIn(v.growth),
      fullIn: fullIn(v.fullIn),
    }))
    .filter((v) => v.totalBytes !== null && v.usedPercent !== null);

  let lastScan = null;
  if (raw.lastScan && typeof raw.lastScan === 'object') {
    const s = raw.lastScan;
    const categories = {};
    if (s.categories && typeof s.categories === 'object' && !Array.isArray(s.categories)) {
      for (const [k, v] of Object.entries(s.categories).slice(0, LIMITS.categories)) {
        if (/^[a-z][a-z0-9.]{0,40}$/.test(k) && num(v, { min: 0 }) !== null) categories[k] = v;
      }
    }
    lastScan = {
      at: msOf(s.at),
      rootKind: ['drive', 'folder', 'network'].includes(s.rootKind) ? s.rootKind : null,
      drive: typeof s.drive === 'string' && /^[A-Z]:$/.test(s.drive) ? s.drive : null,
      totalBytes: num(s.totalBytes, { min: 0 }) || 0,
      totalFiles: int(s.totalFiles, { min: 0 }) || 0,
      categories,
      topFolders: Array.isArray(s.topFolders)
        ? s.topFolders
            .slice(0, LIMITS.topFolders)
            .filter((f) => f && typeof f.name === 'string')
            .map((f) => ({ name: f.name.slice(0, 120), size: num(f.size, { min: 0 }) || 0 }))
        : null,
    };
  }

  let tasks = null;
  if (raw.tasks && typeof raw.tasks === 'object') {
    const t = raw.tasks;
    tasks = {
      supported: t.supported !== false,
      profiles: (Array.isArray(t.profiles) ? t.profiles : [])
        .slice(0, LIMITS.profiles)
        .filter((p) => p && typeof p.id === 'string' && /^[a-z][a-z0-9]{0,15}$/.test(p.id))
        .map((p) => ({
          id: p.id,
          managed: bool(p.managed),
          enabled: bool(p.enabled),
          reportOnly: bool(p.reportOnly),
          action: ['recycle', 'quarantine'].includes(p.action) ? p.action : null,
          installed: bool(p.installed),
          verified: bool(p.verified),
          os: osIn(p.os),
          lastRun: runIn(p.lastRun),
        })),
      sampler: t.sampler && typeof t.sampler === 'object'
        ? { installed: bool(t.sampler.installed), verified: bool(t.sampler.verified), os: osIn(t.sampler.os) }
        : null,
    };
  }

  let journal = null;
  if (raw.journal && typeof raw.journal === 'object') {
    const j = raw.journal;
    const sessions = {};
    for (const k of ['sealed', 'altered', 'unsealed', 'legacy', 'incomplete']) sessions[k] = int(j.sessions && j.sessions[k], { min: 0 }) || 0;
    const s = j.seal;
    journal = {
      sessions,
      missing: int(j.missing, { min: 0 }) || 0,
      seal:
        s && typeof s === 'object' && int(s.n, { min: 1 }) !== null && typeof s.hash === 'string' && /^[0-9a-f]{16,128}$/.test(s.hash)
          ? { n: s.n, at: msOf(s.at), hash: s.hash, key: typeof s.key === 'string' && /^[0-9a-f]{16,128}$/.test(s.key) ? s.key : null }
          : null,
    };
  }

  const policy = raw.policy && typeof raw.policy === 'object'
    ? {
        status: ['none', 'present', 'unreadable'].includes(raw.policy.status) ? raw.policy.status : 'none',
        applied: names(raw.policy.applied),
        notApplied: names(raw.policy.notApplied),
        refused: names(raw.policy.refused),
      }
    : null;

  const report = {
    schema: SCHEMA,
    host,
    generatedAt,
    app: { version: text(raw.app && raw.app.version, 40), channel: text(raw.app && raw.app.channel, 20) },
    volumes,
    lastScan,
    tasks,
    journal,
    policy,
  };
  const nameMatches = fileName === null || fileName.toLowerCase() === fileNameFor(host).toLowerCase();
  return { ok: true, report, nameMatches };
}

module.exports = {
  SCHEMA,
  SUFFIX,
  MAX_BYTES,
  LIMITS,
  safeHost,
  fileNameFor,
  isReportName,
  outgoingMessage,
  incomingMessage,
  build,
  serialize,
  parse,
};
