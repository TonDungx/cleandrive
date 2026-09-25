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
  const VALID = ['system', 'light', 'dark', 'custom'];
  const SWEEP_MS = 460;
  const palettes = window.CleanDriveTheme;

  /**
   * The user's own colours, checked again here before a single token is set
   * from them. The main process checked them when they were saved; this is
   * the last place a bad palette could still become unreadable text, so it is
   * checked where it is used too.
   */
  function usable(raw) {
    if (!palettes || !raw) return null;
    const shaped = palettes.normalise({ format: palettes.FORMAT, version: palettes.VERSION, name: raw.name || '', base: raw.base, colors: raw.colors });
    return shaped.ok && palettes.check(shaped.theme).ok ? shaped.theme : null;
  }

  /** The palette the Custom choice draws with: the stored one, once known. */
  let stored = null;

  function readMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      // Present whether or not Custom is on: it is what the Custom button and
      // the editor offer.
      stored = usable(JSON.parse(params.get('palette') || 'null'));
      const mode = params.get('theme');
      if (mode === 'custom') return stored ? 'custom' : 'system';
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
  function apply(mode, palette = stored) {
    const root = document.documentElement;
    // The custom palette is a set of inline tokens on the document element,
    // where they win over the stylesheet's; leaving any behind would tint the
    // built-in theme with the last palette.
    if (palettes) for (const token of palettes.TOKENS) root.style.removeProperty(token);
    delete root.dataset.themeBase;

    if (mode === 'custom' && palette) {
      root.setAttribute('data-theme', 'custom');
      root.dataset.themeBase = palette.base;
      for (const [token, value] of Object.entries(palettes.derive(palette.colors, palette.base))) {
        root.style.setProperty(token, value);
      }
    } else if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');

    // The map of a folder paints on a canvas, which reads the tokens when it
    // draws; one custom palette replacing another changes no attribute it
    // could watch.
    document.dispatchEvent(new CustomEvent('cleandrive:theme'));
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
      // The sidebar's copy has no Custom button; with Custom on, its pill
      // must not sit under whichever of the three was chosen last.
      host.toggleAttribute('data-switch-none', index < 0);
    }

    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      const active = button.dataset.themeChoice === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      if (button.dataset.themeChoice === 'custom') {
        // language.js is loaded before this file, so t() is always there.
        button.disabled = !stored;
        button.title = stored
          ? window.t('custom.useHint', 'Your own colours: {name}', { name: stored.name || window.t('theme.defaultName', 'My colours') })
          : window.t('custom.noneHint', 'Make your own colours in the card below first.');
      }
    }
  }

  /**
   * Change the stored palette -- the editor saved one, or forgot it. With
   * Custom on, the window redraws in the new one at once.
   */
  function setStored(palette) {
    stored = palette ? usable(palette) : null;
    if (current === 'custom' && stored) apply('custom');
    markActive();
  }

  /**
   * Take up a mode the main process has already saved -- the editor's "Use
   * these colours", or what is left after forgetting them. No IPC: this is
   * the window catching up, not a new choice.
   */
  function adopt(mode, from) {
    const next = mode === 'custom' && !stored ? 'system' : VALID.includes(mode) ? mode : 'system';
    current = next;
    sweep(next, from);
    markActive();
  }

  function wire() {
    // Delegated to the document because the control exists twice, and because
    // the Settings tab's copy is in the markup before this runs either way.
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-theme-choice]');
      if (!button) return;

      const mode = button.dataset.themeChoice;
      if (!VALID.includes(mode) || mode === current) return;
      if (mode === 'custom' && !stored) return;

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
    // The Custom button's tooltip is words, and follows a change of language.
    if (typeof window.onLanguageChange === 'function') window.onLanguageChange(markActive);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }

  /** For the colour editor, and for the harnesses. */
  window.ThemeSwitch = {
    current: () => current,
    stored: () => stored,
    setStored,
    adopt,
    markActive,
  };
})();
