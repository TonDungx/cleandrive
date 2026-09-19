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
 *
 * ## The switch itself
 *
 * Swapping every colour in the window on one frame is abrupt in a way that
 * reads as a glitch rather than a change. The View Transition API takes a
 * snapshot of the old frame and the new one and lets CSS animate between them,
 * so the new theme sweeps out in a circle from the button that was pressed —
 * one movement, with an obvious cause, rather than the whole screen blinking.
 *
 * Three things it deliberately does not do: it does not animate when the
 * machine asks for reduced motion, it does not wait for the animation before
 * saving, and it does not fail if the API is missing. Any of those would trade
 * a working switch for a decorative one.
 */

(() => {
  const VALID = ['system', 'light', 'dark'];
  const SWEEP_MS = 460;

  function readMode() {
    try {
      const mode = new URLSearchParams(window.location.search).get('theme');
      return VALID.includes(mode) ? mode : 'system';
    } catch {
      return 'system';
    }
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
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

  /* ---- the sweep ------------------------------------------------------- */

  /**
   * Where the circle grows from, and how big it has to get.
   *
   * The radius is the distance to the furthest corner of the window, so the
   * reveal finishes covering the screen exactly as the animation ends —
   * measured rather than guessed at, because a fixed radius leaves a corner
   * un-swept on a wide window and overshoots on a narrow one.
   */
  function originFrom(element) {
    const { innerWidth: width, innerHeight: height } = window;

    let x = width / 2;
    let y = height / 2;
    if (element && typeof element.getBoundingClientRect === 'function') {
      const box = element.getBoundingClientRect();
      x = box.left + box.width / 2;
      y = box.top + box.height / 2;
    }

    const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
    return { x, y, radius };
  }

  function sweep(mode, from) {
    const root = document.documentElement;

    // No API, or the machine asked for less movement: change it and be done.
    if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
      apply(mode);
      return;
    }

    const { x, y, radius } = originFrom(from);
    root.style.setProperty('--theme-x', `${x}px`);
    root.style.setProperty('--theme-y', `${y}px`);
    root.style.setProperty('--theme-r', `${radius}px`);
    root.setAttribute('data-theme-sweeping', '');

    const transition = document.startViewTransition(() => apply(mode));

    /*
     * Cleared on whichever happens first: the transition settling, or the clock.
     *
     * `finished` is the obvious signal and it is not sufficient. A window that
     * is not producing frames -- hidden, occluded, or a test harness running
     * with `show: false` -- never animates, so the promise stays pending and
     * the attribute would stay set for the life of the window, keeping the
     * sweep rules live for a transition that is not happening. The timeout is
     * the guarantee; `finished` just gets there sooner in the normal case.
     */
    const done = () => root.removeAttribute('data-theme-sweeping');
    const timer = setTimeout(done, SWEEP_MS + 120);
    transition.finished
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        done();
      });
  }

  /* ---- the control, once there is a DOM to put it in ------------------- */

  function markActive() {
    // Every host, not just the top bar: the Settings tab shows the same control
    // and the two must not disagree about which mode is on.
    for (const host of document.querySelectorAll('[data-theme-host]')) {
      const buttons = [...host.querySelectorAll('[data-theme-choice]')];
      const index = buttons.findIndex((button) => button.dataset.themeChoice === current);
      if (index >= 0) host.style.setProperty('--switch-index', String(index));
    }

    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      const active = button.dataset.themeChoice === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function wire() {
    // Delegated to the document because the control exists twice, and because
    // the Settings tab's copy is in the markup before this runs either way.
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-theme-choice]');
      if (!button) return;

      const mode = button.dataset.themeChoice;
      if (!VALID.includes(mode) || mode === current) return;

      // Repaint first, persist second. The switch should feel instant, and a
      // failed write is worth reporting but not worth blocking the change on.
      current = mode;
      sweep(mode, button);
      markActive();

      const envelope = await window.cleandrive.setTheme(mode);
      if (!envelope || !envelope.ok) {
        // toast() comes from app.js, which has loaded by the time anything can
        // be clicked; guard anyway rather than trade one error for another.
        if (typeof toast === 'function') {
          const message =
            typeof window.t === 'function'
              ? window.t('app.theme.failed', 'Could not save the appearance setting.')
              : 'Could not save the appearance setting.';
          toast(message, true);
        }
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
