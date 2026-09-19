'use strict';

/**
 * Translation, shared by the window and the main process.
 *
 * ## English is not a dictionary
 *
 * The obvious shape is two tables, `en` and `vi`, and every string referred to
 * by a key. That was rejected: it moves every sentence in the app out of the
 * place it is used and into a file of its own, so reading `automatic.js` stops
 * telling you what the screen says. This codebase's comments are load-bearing
 * and its prose is the feature; hiding the text from the code would cost more
 * than it saves.
 *
 * So **English lives where it always lived** — inline in the HTML, and as the
 * second argument to `t()`:
 *
 *     t('auto.save', 'Save settings')
 *     <h2 data-i18n="auto.schedule.title">Schedule</h2>
 *
 * Only the *other* languages are tables. A key with no translation falls back
 * to the English that is right there in the call, so a half-finished dictionary
 * shows English rather than `auto.schedule.title`, and adding a language never
 * requires touching English again.
 *
 * ## Loaded by both processes
 *
 * The main process needs this for the confirmation dialog, the notifications
 * and the tray menu — the text that matters most, being the text in front of a
 * deletion. The renderer needs it for everything else. So this file is written
 * to load as a CommonJS module *and* as a classic `<script>`, which is also why
 * there is no build step to add here.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CleanDriveI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * Every language the app can be read in.
   *
   * `nativeLabel` is what the switch shows. A language list that writes
   * "Vietnamese" to somebody who is looking for "Tiếng Việt" is asking them to
   * read the language they cannot read in order to choose the one they can.
   */
  const LANGUAGES = [
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt' },
  ];

  const CODES = LANGUAGES.map((language) => language.code);
  const FALLBACK = 'en';

  /** `en` stays empty on purpose: English is in the source, not in a table. */
  const dictionaries = { en: {} };

  let current = FALLBACK;

  /** A language file calls this; the order files load in does not matter. */
  function register(code, table) {
    if (!CODES.includes(code)) return false;
    dictionaries[code] = Object.assign({}, dictionaries[code], table);
    return true;
  }

  function has(code) {
    return Boolean(dictionaries[code]) && Object.keys(dictionaries[code]).length > 0;
  }

  /**
   * Turn a stored preference into a language to actually use.
   *
   * `system` consults the OS. On Windows the right source is the *display
   * language* list, not the regional format: this machine reports
   * `getSystemLocale() === 'vi-VN'` because its date and number formats are
   * Vietnamese, while its Windows display language is English. Following the
   * format setting would give somebody a Vietnamese app on an English Windows,
   * which is not what either setting means.
   *
   * @param {string} preference        'system' | 'en' | 'vi'
   * @param {string[]} systemLanguages most-preferred first, e.g. ['en-US', 'vi']
   */
  function resolve(preference, systemLanguages) {
    if (CODES.includes(preference)) return preference;

    for (const tag of Array.isArray(systemLanguages) ? systemLanguages : []) {
      if (typeof tag !== 'string') continue;
      const base = tag.toLowerCase().split(/[-_]/)[0];
      if (CODES.includes(base)) return base;
    }
    return FALLBACK;
  }

  function setLanguage(code) {
    current = CODES.includes(code) ? code : FALLBACK;
    return current;
  }

  function getLanguage() {
    return current;
  }

  /**
   * A sentence that has not been rendered yet.
   *
   * ## Why a sentence is sometimes an object
   *
   * `t()` renders immediately, which is right when the text is about to be put
   * on screen. It is wrong for text that is produced somewhere else and read
   * later:
   *
   *   - the scanner's verdicts travel from the main process to the window and
   *     sit in the window's state until the next scan, so rendering them at
   *     production time freezes them in whatever language was current *then*;
   *   - a scheduled run's reason is **written to a file**. Rendered, it is
   *     English on disk forever, and the run log still reads "No settings file
   *     was found" in a Vietnamese app a year later.
   *
   * So the producers hand back `{ i18n, en, params }` and the screen renders it
   * with `render()`. The English travels with it, so an old log entry written
   * by a previous version -- a plain string -- still displays, and a key that
   * has since been deleted still displays too.
   */
  function message(key, english, params) {
    return params ? { i18n: key, en: english, params } : { i18n: key, en: english };
  }

  /**
   * Turn whatever a producer handed over into text.
   *
   * Accepts a message, a plain string (already rendered, or written by an older
   * version of the app) and null. Callers should not have to know which they
   * have -- a run log holds both.
   */
  function render(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof value.i18n === 'string') {
      return t(value.i18n, value.en, value.params);
    }
    return String(value);
  }

  /** `{name}` placeholders. A missing parameter is left as written rather than
   *  printed as "undefined", which at least reads as a bug instead of a value. */
  function format(text, params) {
    if (!params) return text;
    return String(text).replace(/\{(\w+)\}/g, (whole, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
    );
  }

  /**
   * @param {string} key
   * @param {string} [english]  the source text, and the fallback
   * @param {object} [params]
   */
  function t(key, english, params) {
    const table = dictionaries[current];
    const translated =
      table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;

    const text = translated == null ? (english == null ? key : english) : translated;
    return format(text, params);
  }

  /** Which keys a language is missing, given the keys the app actually asks for. */
  function missingKeys(code, keys) {
    const table = dictionaries[code] || {};
    return keys.filter((key) => !Object.prototype.hasOwnProperty.call(table, key));
  }

  function keysFor(code) {
    return Object.keys(dictionaries[code] || {});
  }

  /* ------------------------------------------------------------------ */
  /* the DOM pass                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * The English in the markup, remembered before anything overwrites it.
   *
   * Without this, switching to Vietnamese and back would leave the Vietnamese
   * on screen: the element's own text is the English fallback, and by then it
   * is gone. A WeakMap rather than a data attribute, so the DOM stays as
   * written and nothing has to be cleaned up.
   */
  const originals = new WeakMap();

  function originalFor(element, attribute) {
    let record = originals.get(element);
    if (!record) {
      record = {};
      originals.set(element, record);
    }
    if (!(attribute in record)) {
      record[attribute] = attribute === 'text' ? element.textContent : element.getAttribute(attribute);
    }
    return record[attribute];
  }

  /**
   * Translate everything marked up for it.
   *
   * `data-i18n` replaces the element's text, `data-i18n-title` its tooltip, and
   * `data-i18n-aria` its accessible name. Anything the JS writes at runtime is
   * translated by that JS through `t()` and is deliberately not marked here --
   * a second pass over it would overwrite what was just computed.
   */
  function translateDom(rootElement) {
    const scope = rootElement || (typeof document !== 'undefined' ? document : null);
    if (!scope) return 0;

    let count = 0;

    for (const element of scope.querySelectorAll('[data-i18n]')) {
      element.textContent = t(element.dataset.i18n, originalFor(element, 'text'));
      count += 1;
    }

    for (const [attribute, dataset] of [['title', 'i18nTitle'], ['aria-label', 'i18nAria'], ['placeholder', 'i18nPlaceholder']]) {
      for (const element of scope.querySelectorAll(`[data-${dataset.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`)) {
        element.setAttribute(attribute, t(element.dataset[dataset], originalFor(element, attribute)));
        count += 1;
      }
    }

    return count;
  }

  return {
    LANGUAGES,
    CODES,
    FALLBACK,
    register,
    has,
    resolve,
    setLanguage,
    getLanguage,
    t,
    message,
    render,
    format,
    translateDom,
    missingKeys,
    keysFor,
  };
});
