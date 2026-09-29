'use strict';

/**
 * One pass of the Chat screen (D3): both apps, all three levels.
 *
 * The roadmap asks for three levels of answer and says each must stand on its
 * own, so that the screen is useful even where the deepest one cannot be
 * reached. That is exactly what happens here:
 *
 *   Level 1  by type      both apps
 *   Level 2  by month     both apps
 *   Level 3  by chat      Zalo only -- nothing in Telegram's layout names a
 *                         conversation, and the app does not open the store
 *                         that does
 *
 * ## The scan is deliberately outside the ordinary analyzers
 *
 * `lib/scanner.js` marks everything under `AppData\Roaming` as `hard`-blocked
 * and `lib/advisor.js` then refuses to call any of it disposable. Both apps
 * live there. That guard is right and stays; it is why this is a screen of its
 * own, like Games and Apps, rather than a category in "What to delete".
 *
 * ## Both processes are checked, and a running app holds everything back
 *
 * Same rule as the known-app caches (D4) and the Steam leftovers (D2): if the
 * app is open, nothing it owns is offered, and if the process list cannot be
 * read at all then nothing is offered either. A half-written download that
 * disappears under a running Zalo is not a bug anybody will report clearly.
 *
 * Only reads.
 */

const { runningProcessNames } = require('../lib/processes');

const zalo = require('./zalo');
const telegram = require('./telegram');

/**
 * The processes that mean an app is using these files.
 *
 * All three of Zalo's, not just the one named after it: `ZaloCall.exe` and
 * `ZaloCap.exe` are separate executables under `plugins\capture`, and both
 * were running on this machine while `Zalo.exe` was. A check that knew only
 * `Zalo.exe` would let a call in progress be interrupted. The same list is in
 * `analyzers/app-caches/zalo.json`, which guards the same app's browser caches.
 */
const PROCESSES = Object.freeze({
  zalo: ['zalo.exe', 'zalocall.exe', 'zalocap.exe'],
  telegram: ['telegram.exe', 'updater.exe'],
});

/** A month bucket, as `YYYY-MM`. */
function monthOf(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  if (year < 2000 || year > 2100) return null;
  return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Level 2: how many bytes arrived in each month, and the largest files.
 *
 * Built from the time in the file's name where there is one and its mtime
 * where there is not. Those are different questions -- when the message was
 * sent against when this machine wrote the file -- and for a folder of chat
 * downloads the first is the one a person means. Zalo puts it in the name;
 * Telegram does not, so Telegram's histogram is mtimes and the screen says so.
 */
const BIGGEST_FILES = 20;

function histogram(groups) {
  const months = new Map();
  const biggest = [];
  let named = 0;
  let total = 0;

  for (const group of groups) {
    for (const file of group.files) {
      total += 1;
      const when = Number.isFinite(file.sentAt) ? file.sentAt : file.mtimeMs;
      if (Number.isFinite(file.sentAt)) named += 1;
      const month = monthOf(when);
      if (month) {
        const prev = months.get(month) || { bytes: 0, files: 0 };
        months.set(month, { bytes: prev.bytes + file.size, files: prev.files + 1 });
      }
      biggest.push({ path: file.path, name: file.name, size: file.size, when, kind: group.kind });
    }
  }

  biggest.sort((a, b) => b.size - a.size);

  return {
    months: [...months.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, v]) => ({ month, ...v })),
    biggest: biggest.slice(0, BIGGEST_FILES),
    // How much of the histogram is "when it was sent" rather than "when this
    // machine wrote it". The screen says which it is looking at.
    fromNames: named,
    totalFiles: total,
  };
}

/** Level 1: bytes and files per kind, across everything an app holds. */
function byKind(groups) {
  const out = new Map();
  for (const group of groups) {
    const prev = out.get(group.kind) || { kind: group.kind, bytes: 0, files: 0 };
    prev.bytes += group.bytes;
    prev.files += group.files.length;
    out.set(group.kind, prev);
  }
  return [...out.values()].sort((a, b) => b.bytes - a.bytes);
}

/**
 * Is one of these apps running?
 *
 * `null` for "could not tell", which is not "no": the screen holds actions
 * back in both cases, and says which it is.
 */
async function openApps(deps = {}) {
  const names = await (deps.runningProcessNames || runningProcessNames)();
  if (!names) return null;
  const out = {};
  for (const [app, list] of Object.entries(PROCESSES)) {
    out[app] = list.some((name) => names.has(name));
  }
  return out;
}

/**
 * Read both apps.
 *
 * @param {object} [options]
 * @param {object} [options.token]
 * @param {Function} [options.onProgress]
 * @param {object} [options.env]
 * @param {object} [options.deps]  `{ runningProcessNames }` for the harness
 */
async function scan({ token = null, onProgress = null, env = process.env, deps = {} } = {}) {
  const started = Date.now();
  const emit = (payload) => {
    if (onProgress) onProgress(payload);
  };

  emit({ phase: 'finding' });
  const running = await openApps(deps);

  const zaloModel = await zalo.scan({ token, onProgress: emit, env });

  emit({ phase: 'telegram' });
  const telegramModel = await telegram.scan({ token, onProgress: emit, env });

  /* -- everything Zalo holds, conversation or not ------------------------- */

  const zaloGroups = [];
  for (const conversation of zaloModel.conversations) zaloGroups.push(...conversation.byKind);
  zaloGroups.push(...zaloModel.shared);

  /* -- everything Telegram holds ------------------------------------------ */

  const telegramGroups = [];
  for (const account of telegramModel.accounts) telegramGroups.push(...account.caches);
  if (telegramModel.update) {
    telegramGroups.push({ kind: 'update', path: telegramModel.update.path, files: telegramModel.update.files, bytes: telegramModel.update.bytes });
  }

  return {
    startedAt: started,
    durationMs: Date.now() - started,
    cancelled: Boolean(token && token.cancelled),
    running,
    zalo: {
      ...zaloModel,
      byKind: byKind(zaloGroups),
      histogram: histogram(zaloGroups),
      bytes: zaloGroups.reduce((sum, g) => sum + g.bytes, 0),
      files: zaloGroups.reduce((sum, g) => sum + g.files.length, 0),
    },
    telegram: {
      ...telegramModel,
      byKind: byKind(telegramGroups),
      histogram: histogram(telegramGroups),
      bytes: telegramGroups.reduce((sum, g) => sum + g.bytes, 0),
      files: telegramGroups.reduce((sum, g) => sum + g.files.length, 0),
    },
  };
}

module.exports = { scan, histogram, byKind, openApps, monthOf, PROCESSES, BIGGEST_FILES };
