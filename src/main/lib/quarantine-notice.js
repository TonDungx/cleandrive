'use strict';

/**
 * "n files have been in quarantine longer than 30 days" (B1).
 *
 * The roadmap puts this in the tray, but the tray only exists while disk
 * monitoring is on, and that is off by default. So it is a notification when
 * the app starts, at most once a day, and the same count on the Settings card
 * and in Restore. It is only ever said: the app never deletes a quarantined
 * file, however old.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {object} options
 * @param {object} options.journal
 * @param {object} options.settings    a SettingsStore
 * @param {string} options.stateFile   where the last notice's time is kept
 * @param {(expired: number, days: number) => void} options.show
 * @param {() => number} [options.now]
 * @param {object} [options.deps]      passed to the locate, for the harness
 * @returns {Promise<{shown: boolean, expired: number}>}
 */
async function noteExpired({ journal, settings, stateFile, show, now = Date.now, deps = {} }) {
  const { quarantined } = require('../actions/restore');
  const { quarantine } = await settings.get();
  const held = await quarantined(journal, { retentionDays: quarantine.retentionDays, deps });
  if (held.expired === 0) return { shown: false, expired: 0 };

  let last = 0;
  try {
    last = Number(JSON.parse(await fsp.readFile(stateFile, 'utf8')).lastShownAt) || 0;
  } catch {
    last = 0;
  }
  if (now() - last < DAY) return { shown: false, expired: held.expired };

  show(held.expired, quarantine.retentionDays);
  await fsp.mkdir(path.dirname(stateFile), { recursive: true });
  await fsp.writeFile(stateFile, `${JSON.stringify({ lastShownAt: now() })}\n`, 'utf8');
  return { shown: true, expired: held.expired };
}

module.exports = { noteExpired, DAY };
