'use strict';

/**
 * The analyzer behind the Apps screen (D1): one installed program per row,
 * each with what it occupies, when it was last started, and the evidence for
 * both.
 *
 * Two rules from the roadmap shape all of it.
 *
 * **No app is ever `safe`.** The most an app can be is `review`, and only when
 * there is a record of it having been started and that record is old. An app
 * nobody has a record of is `keep` with "no record of it being started" -- not
 * `review` -- because UserAssist only sees what Explorer and the Start menu
 * launched, so a program started from a pinned taskbar button, a desktop
 * shortcut or by another program leaves no trace in it. Treating silence as
 * disuse would put "you have not used this" next to something used daily.
 *
 * **Part of Windows is `protected`.** Four separate facts can say so, and the
 * row says which one: the package is signed as part of Windows, Windows' own
 * `NoRemove` flag is set, it is installed inside the Windows folder, or it
 * registered no uninstaller at all.
 *
 * `unattendedEligible` is false for every row and neither category is on the
 * automatic whitelist. The only action any row offers is `handoff`.
 */

const path = require('node:path');

const { message: m } = require('../../i18n');
const { formatBytes } = require('../lib/util');
const { candidateId, evidence } = require('./contract');

const ID = 'apps';

/** Older than this, with a record to prove it, and the row is worth a look. */
const STALE_DAYS = 90;

const DAY = 86400000;
const n = (v) => Number(v || 0).toLocaleString('en-US');
const days = (ms) => Math.floor((Date.now() - ms) / DAY);

/** How many months of launches the records on this machine actually cover. */
function coverMonths(summary) {
  const oldest = [summary.userAssist && summary.userAssist.oldestMs, summary.prefetch && summary.prefetch.oldestMs]
    .filter((v) => typeof v === 'number' && v > 0);
  if (oldest.length === 0) return 0;
  return Math.max(1, Math.round((Date.now() - Math.min(...oldest)) / (30 * DAY)));
}

/**
 * Why this row says what it says, strongest fact first.
 *
 * The size sentences are deliberately two, never one: a walked folder and an
 * installer's declaration are different kinds of claim, and the screen has a
 * column for each.
 */
function evidenceFor(app, summary, { lastUsedAllowed }) {
  const list = [];
  const add = (message) => list.push(evidence(list.length + 1, message));

  if (app.protection) {
    add({
      systemPackage: m('evidence.apps.systemPackage', 'Windows signed this as part of itself'),
      noRemove: m('evidence.apps.noRemove', 'Windows marks it as one that cannot be removed from the installed-apps list'),
      inWindows: m('evidence.apps.inWindows', 'It is installed inside the Windows folder'),
      noUninstaller: m('evidence.apps.noUninstaller', 'It registered no uninstaller, so Windows offers no way to remove it'),
    }[app.protection]);
  }

  if (lastUsedAllowed) {
    if (app.lastUsed) {
      const since = days(app.lastUsed.at);
      const source = {
        prefetch: m('evidence.apps.viaPrefetch', 'Last started {n} days ago, as Windows’ own Prefetch records it', { n: n(since) }),
        userAssist: m('evidence.apps.viaUserAssist', 'Last started {n} days ago, as Windows records what you open from Explorer and the Start menu', { n: n(since) }),
        shortcut: m('evidence.apps.viaShortcut', 'Its shortcut was last opened {n} days ago, as Windows records what you open from Explorer and the Start menu', { n: n(since) }),
      }[app.lastUsed.source];
      add(source);
      if (app.lastUsed.confidence === 'strong') {
        add(m('evidence.apps.matchedByPath', 'The record names a program inside this app’s own folder'));
      } else {
        add(m('evidence.apps.matchedByName', 'Matched by the program’s file name, which another app could share'));
      }
    } else {
      const months = coverMonths(summary);
      add(months > 0
        ? m('evidence.apps.noRecord', 'No record of it being started in the {n} months these records cover. Windows only records what you open from Explorer and the Start menu, so a pinned button or another program starting it leaves no trace', { n: n(months) })
        : m('evidence.apps.noRecords', 'Windows has no launch records on this machine, so nothing can be said about when this was last used'));
    }
  }

  if (app.measured) {
    add(m('evidence.apps.measured', 'Its install folder measured by reading every folder in it: {size} in {files} files', {
      size: formatBytes(app.measured.bytes), files: n(app.measured.files),
    }));
    if (app.measured.refused > 0) {
      add(m('evidence.apps.measuredPartial', '{n} folders in it could not be read, so it holds at least this much', { n: n(app.measured.refused) }));
    }
  } else if (app.locationMissing) {
    add(m('evidence.apps.locationGone', 'The folder it says it installed into is not there any more'));
  } else if (app.locationTooBroad) {
    add(m('evidence.apps.locationBroad', 'It names a whole drive or a shared folder as its install folder, which would measure far more than this app'));
  } else {
    add(m('evidence.apps.noLocation', 'It did not record where it installed to, so its folder cannot be measured'));
  }

  if (app.declaredBytes > 0) {
    add(m('evidence.apps.declared', 'Its installer declared {size}. That figure is whatever the installer wrote and is often wrong — on this machine it ranged from a quarter of the real size to twenty-five times it', {
      size: formatBytes(app.declaredBytes),
    }));
  }

  for (const folder of app.dataFolders.slice(0, 3)) {
    add(folder.confidence === 'strong'
      ? m('evidence.apps.dataStrong', '{size} in {folder}, which matches a name this app gives for itself', { size: formatBytes(folder.bytes), folder: folder.path })
      : m('evidence.apps.dataGuess', '{size} in {folder}, matched to this app by name alone', { size: formatBytes(folder.bytes), folder: folder.path }));
  }

  if (app.sharesLocationWith > 0) {
    add(m('evidence.apps.shared', '{n} other apps installed into this same folder, so this size is the folder’s, not this app’s alone. The total at the top counts it once', {
      n: n(app.sharesLocationWith),
    }));
  }

  if (app.alsoIn && app.alsoIn.length) {
    add(m('evidence.apps.alsoIn', 'The same program is registered {n} more times, and is counted once here', { n: n(app.alsoIn.length) }));
  }

  return list;
}

/**
 * How sure the row is -- about what it claims, which is the size.
 *
 * A walked folder is `strong`; a folder that could not be fully read, or a
 * size that is only the installer's word, is weaker. Nothing here is ever
 * `certain`: no app's true footprint is knowable from a list of folders.
 */
function confidenceFor(app) {
  if (app.measured && app.measured.refused === 0) {
    return app.dataFolders.some((f) => f.confidence === 'guess') ? 'likely' : 'strong';
  }
  if (app.measured) return 'likely';
  if (app.declaredBytes > 0) return 'guess';
  return 'guess';
}

/**
 * `protected`, `review` or `keep`. Never `safe` -- see the note at the top.
 */
function verdictFor(app, { lastUsedAllowed }) {
  if (app.protection) return 'protected';
  if (!lastUsedAllowed) return 'keep';
  if (app.lastUsed && days(app.lastUsed.at) >= STALE_DAYS) return 'review';
  return 'keep';
}

/**
 * The size the row leads with.
 *
 * The measured figure where there is one, the data folders added to it, and
 * nothing else. The installer's declaration never enters this number: it is
 * shown in its own column, with the installer named as the one who said it.
 */
function bytesFor(app) {
  return (app.measured ? app.measured.bytes : 0) + (app.dataBytes || 0);
}

function toCandidate(app, summary, options) {
  const verdict = verdictFor(app, options);
  return {
    // Keyed on the app's own registry key or package family, not on its
    // folder: Microsoft 365 and OneNote register four entries here that all
    // name `C:\Program Files\Microsoft Office`, and an id built from the path
    // would make them one id -- the window indexes rows by id, so three of the
    // four would disappear behind the fourth. `app.id` is as stable across
    // scans as the path was.
    id: candidateId(ID, app.id),
    // A program with no install folder still needs somewhere to be. Its
    // registry key is where it is, which is honest and never a path on disk
    // the app could be asked to act on -- `kind` says so.
    path: app.installLocation || `${app.source === 'store' ? 'Store' : app.hive}\\${app.key || app.packageName || app.name}`,
    kind: app.installLocation ? 'folder' : 'virtual',
    bytes: bytesFor(app),
    category: app.source === 'store' ? 'apps.store' : 'apps.installed',
    verdict,
    confidence: confidenceFor(app),
    evidence: evidenceFor(app, summary, options),
    // Opening Windows' list is the only thing offered, and only for something
    // Windows would let you remove.
    actions: app.protection ? ['none'] : ['handoff'],
    unattendedEligible: false,
    meta: {
      appId: app.id,
      source: app.source,
      name: app.name,
      publisher: app.publisher,
      version: app.version,
      installLocation: app.installLocation,
      installDate: app.installDate || '',
      measuredBytes: app.measured ? app.measured.bytes : null,
      dataBytes: app.dataBytes || 0,
      declaredBytes: app.declaredBytes || 0,
      dataFolders: app.dataFolders.map((f) => ({ path: f.path, bytes: f.bytes, confidence: f.confidence, root: f.root })),
      lastUsed: options.lastUsedAllowed && app.lastUsed
        ? { at: app.lastUsed.at, source: app.lastUsed.source, confidence: app.lastUsed.confidence, sources: app.lastUsed.sources }
        : null,
      lastUsedAllowed: options.lastUsedAllowed,
      protection: app.protection || null,
      sharesLocationWith: app.sharesLocationWith || 0,
      // Shown for the person to copy, never run by the app. The one in the
      // registry is whatever the installer wrote there.
      uninstallCommand: app.protection ? '' : app.uninstallCommand || '',
      handoff: app.protection ? null : 'apps',
      staleDays: STALE_DAYS,
      alsoIn: app.alsoIn || [],
    },
  };
}

const analyzer = {
  id: ID,
  feature: 'free',
  requiresElevation: false,
  categories: ['apps.installed', 'apps.store'],

  /** @param {object} ctx  { model, can } -- the model from apps/measure.js */
  async *run(ctx, token) {
    const model = ctx.model;
    // Free gets the list and the sizes; `pro.apps.lastused` adds when each was
    // last started, and with it the sorting and filtering that rest on it.
    const lastUsedAllowed = typeof ctx.can === 'function' ? ctx.can('pro.apps.lastused') : true;
    const options = { lastUsedAllowed };

    const ids = [];
    for (const app of model.apps) {
      if (token && token.cancelled) break;
      const candidate = toCandidate(app, model, options);
      ids.push(candidate.id);
      yield { type: 'candidate', candidate };
    }

    const { apps: _apps, ...rest } = model;
    yield {
      type: 'summary',
      summary: {
        ...rest,
        rows: ids,
        lastUsedAllowed,
        staleDays: STALE_DAYS,
        coverMonths: coverMonths(model),
        // From the folders that were walked, each counted once -- never the
        // sum of the rows, which would count a folder that four apps share
        // four times. `moved is not freed` is the same rule in a different
        // place: two numbers about the same bytes are never added.
        totalMeasuredBytes: model.distinctBytes || 0,
      },
    };
  },
};

module.exports = { analyzer, ID, toCandidate, verdictFor, confidenceFor, bytesFor, coverMonths, STALE_DAYS };
