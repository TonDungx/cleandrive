'use strict';

/**
 * The window's half of translation.
 *
 * Loaded from `<head>` alongside the dictionaries, and for the same reason
 * `theme.js` is: the markup in `index.html` is written in English, so a
 * Vietnamese user whose language arrived over IPC would watch the app translate
 * itself after the first frame. The chosen language comes in on
 * `location.search`, which is readable synchronously — the main process already
 * knows it, because it resolves the setting before the window exists.
 *
 * ## The blank frame is deliberate
 *
 * The DOM pass cannot run until the body is parsed, which is after the browser
 * could paint. Rather than let one English frame through, the document is
 * hidden until the pass finishes — and *only* when a translation is actually
 * needed, so an English user never pays for the mechanism. The attribute is
 * cleared in a `finally`: a dictionary that threw would otherwise leave the
 * window permanently invisible, which is a far worse bug than a flash.
 */

(() => {
  const i18n = window.CleanDriveI18n;

  /** A build without the dictionaries must still start, in English. */
  if (!i18n) {
    window.t = (key, english) => (english == null ? key : english);
    window.onLanguageChange = () => {};
    return;
  }

  const root = document.documentElement;

  function readLanguage() {
    try {
      const code = new URLSearchParams(window.location.search).get('lang');
      return i18n.CODES.includes(code) ? code : i18n.FALLBACK;
    } catch {
      return i18n.FALLBACK;
    }
  }

  i18n.setLanguage(readLanguage());
  root.setAttribute('lang', i18n.getLanguage());
  if (i18n.getLanguage() !== i18n.FALLBACK) root.setAttribute('data-i18n-pending', '');

  /**
   * `t(key, english, params)`, global for the same reason `$` and `toast` are:
   * these files share one scope by design and a module system would be a build
   * step for four scripts.
   */
  window.t = (key, english, params) => i18n.t(key, english, params);

  /**
   * Everything the app draws at runtime rather than from the markup.
   *
   * The DOM pass can only reach text that is *in* the DOM as written. A table
   * of scan results, a toast, a run log — all of that is built by JS and has to
   * be built again in the new language. Each file registers how to redraw
   * itself rather than this one knowing about all of them.
   */
  const listeners = new Set();
  window.onLanguageChange = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  function translate() {
    try {
      i18n.translateDom(document);
      markActive();
    } finally {
      root.removeAttribute('data-i18n-pending');
      root.setAttribute('lang', i18n.getLanguage());
    }
  }

  /* ---- the control ----------------------------------------------------- */

  function markActive() {
    const preference = current;
    for (const host of document.querySelectorAll('[data-language-switch]')) {
      const buttons = [...host.querySelectorAll('[data-language-choice]')];
      const index = buttons.findIndex((button) => button.dataset.languageChoice === preference);
      // Drives the sliding indicator in CSS; -1 simply leaves it where it was.
      if (index >= 0) host.style.setProperty('--switch-index', String(index));

      for (const button of buttons) {
        const active = button.dataset.languageChoice === preference;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }
  }

  /** The stored preference, which is not the same thing as the language in use:
   *  'system' is a preference and resolves to one of the codes. */
  let current = 'system';

  async function choose(preference) {
    if (preference === current) return;

    const previous = current;
    current = preference;
    markActive();

    const envelope = await window.cleandrive.setLanguage(preference);
    if (!envelope || !envelope.ok) {
      current = previous;
      markActive();
      if (typeof toast === 'function') {
        toast(window.t('settings.language.failed', 'Could not save the language setting.'), true);
      }
      return;
    }

    i18n.setLanguage(envelope.data.language);
    translate();

    for (const listener of listeners) {
      try {
        listener(envelope.data.language);
      } catch {
        // One screen failing to redraw must not stop the others.
      }
    }
  }

  function wire() {
    for (const host of document.querySelectorAll('[data-language-switch]')) {
      host.addEventListener('click', (event) => {
        const button = event.target.closest('[data-language-choice]');
        if (button) choose(button.dataset.languageChoice);
      });
    }

    // The preference behind the resolved language, so the control can show
    // "Auto" rather than the language Auto happened to pick.
    window.cleandrive
      .getLanguage()
      .then((envelope) => {
        if (envelope && envelope.ok) {
          current = envelope.data.preference;
          markActive();
        }
      })
      .catch(() => {});

    translate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
})();
