'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Whether this is the first time the app has been opened on this account,
 * which is when the three-screen introduction (I4) is shown.
 *
 * Asked once, before the first window exists, from what is already on disk:
 * every launch since the Trends rework writes a disk measurement to
 * history.json, a delete writes the journal (or, before it, the ledger), and
 * any change of settings writes settings.json. None of them there means
 * nobody has run the app here -- so somebody upgrading is not shown an
 * introduction to an app they already use.
 *
 * The window also remembers that it has shown it (localStorage), so a first
 * launch whose measurement failed to write does not introduce itself twice.
 */

const TRACES = ['settings.json', 'history.json', 'journal', 'trash-ledger.json'];

/**
 * @param {string} userData  the app's data folder
 * @param {object} [fsImpl]  for the test
 */
function firstRun(userData, fsImpl = fs) {
  if (!userData) return false;
  return !TRACES.some((name) => {
    try {
      return fsImpl.existsSync(path.join(userData, name));
    } catch {
      // Unreadable is not the same as absent: say it has run before, and
      // stay quiet rather than introduce the app to somebody who uses it.
      return true;
    }
  });
}

let pending = false;

/** Decide, once, before the first window. */
function decide(userData) {
  pending = firstRun(userData);
  return pending;
}

/**
 * What the first window is told, in its URL. Only the first: a window built
 * again later (reopened from the tray) is not the first launch.
 */
function query() {
  if (!pending) return {};
  pending = false;
  return { intro: '1' };
}

module.exports = { firstRun, decide, query, TRACES };
