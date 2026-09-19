'use strict';

const { app } = require('electron');

const i18n = require('../i18n');

// Loading a dictionary registers it. Adding a language is adding a file and a
// line here -- the rest of the app asks `i18n.LANGUAGES` and needs no edit.
require('../i18n/vi');

/**
 * The language the main process speaks.
 *
 * It has its own copy of the setting because it says things the window never
 * sees: the confirmation in front of a deletion, the notification a scheduled
 * run raises at 02:00, and the tray menu. Those are the most consequential
 * sentences in the app, and leaving them in English while the window is
 * Vietnamese would put the one text that must be understood in the language the
 * user did not choose.
 */

/**
 * What the OS says the user reads, most-preferred first.
 *
 * `getPreferredSystemLanguages()` is the display-language list.
 * `getSystemLocale()` is the regional format, and it is a different question:
 * this machine answers `vi-VN` to the second while its Windows display language
 * is English, so following it would hand somebody a Vietnamese app on an
 * English Windows. `getLocale()` is Chromium's own UI locale and serves as the
 * last resort.
 */
function systemLanguages() {
  try {
    const preferred =
      typeof app.getPreferredSystemLanguages === 'function' ? app.getPreferredSystemLanguages() : [];
    if (Array.isArray(preferred) && preferred.length > 0) return preferred;
  } catch {
    // Fall through to the single-locale question.
  }

  try {
    return [app.getLocale()];
  } catch {
    return [];
  }
}

/**
 * Resolve a stored preference and start speaking it.
 *
 * @param {string} preference 'system' | 'en' | 'vi'
 * @returns {string} the language actually in use
 */
function apply(preference) {
  return i18n.setLanguage(i18n.resolve(preference, systemLanguages()));
}

/** @returns {string} the language in use, not the preference that chose it */
function current() {
  return i18n.getLanguage();
}

/** `t(key, english, params)` — see src/i18n/index.js. */
function t(key, english, params) {
  return i18n.t(key, english, params);
}

module.exports = { apply, current, t, systemLanguages, LANGUAGES: i18n.LANGUAGES, CODES: i18n.CODES };
