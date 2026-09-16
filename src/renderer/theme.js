'use strict';

/**
 * Appearance: follow the system, or force light or dark.
 *
 * This file is loaded from `<head>`, ahead of everything else, and that
 * placement is the whole point. A theme applied from `app.js` at the end of
 * `<body>` is applied *after* the browser has already painted, so a user who
 * picked light while their OS is dark would watch the window flash black on
 * every launch. A classic script in the head blocks parsing, so the attribute
 * is in place before anything renders.
 *
 * The mode arrives as a query parameter rather than from storage or an IPC
 * call: the main process already knows it — it has to, to pick the window's
 * background colour before the first frame — and reading it synchronously off
 * `location.search` is the only way to have it in hand this early. An IPC round
 * trip is a promise, and a promise resolves after the first paint.
 *
 * Only the mode is passed. "System" is not resolved here, because CSS resolves
 * it better: `color-scheme: light dark` tracks the OS live, so a machine set to
 * switch at sunset switches this window with it, with no listener anywhere.
 */

(() => {
  const VALID = ['system', 'light', 'dark'];

  function readMode() {
    try {
      const mode = new URLSearchParams(window.location.search).get('theme');
      return VALID.includes(mode) ? mode : 'system';
    } catch {
      return 'system';
    }
  }

  /**
   * `data-theme` pins `color-scheme`; its absence means "follow the OS".
   * Removing the attribute rather than setting it to "system" is deliberate —
   * there is no such value for `color-scheme`, and the CSS switch keys off the
   * attribute being present at all.
   */
  function apply(mode) {
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
  }

  let current = readMode();
  apply(current);

  /* ---- the control, once there is a DOM to put it in ------------------- */

  function markActive() {
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      const active = button.dataset.themeChoice === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function wire() {
    const host = document.getElementById('theme-switch');
    if (!host) return;

    host.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-theme-choice]');
      if (!button) return;

      const mode = button.dataset.themeChoice;
      if (!VALID.includes(mode) || mode === current) return;

      // Repaint first, persist second. The switch should feel instant, and a
      // failed write is worth reporting but not worth blocking the change on.
      current = mode;
      apply(mode);
      markActive();

      const envelope = await window.cleandrive.setTheme(mode);
      if (!envelope || !envelope.ok) {
        // toast() comes from app.js, which has loaded by the time anything can
        // be clicked; guard anyway rather than trade one error for another.
        if (typeof toast === 'function') toast('Could not save the appearance setting.', true);
      }
    });

    markActive();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
})();
