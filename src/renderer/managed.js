'use strict';

/**
 * What the organisation's policy locks on this computer (H2), as the window
 * shows it.
 *
 * The main process decides; this only draws. Every control a policy holds is
 * disabled and carries the padlock and the line "Managed by your
 * organisation", and one line at the top of the window says what is managed
 * at all -- a switch that is greyed out with no reason given reads as broken.
 *
 * Asked when the window opens and again whenever it comes back to the front:
 * Group Policy changes the registry in the background, and a window open since
 * Monday should not go on drawing Monday's locks. The main process reads the
 * policy again before every action anyway, so a stale lock here can only ever
 * be a button that is refused when pressed, never a file changed that should
 * not have been.
 */
(function (root) {
  let current = null;
  const listeners = new Set();

  /** What view only still lets through: putting back, and opening a Windows tool. */
  const VIEW_ONLY_ALLOWS = new Set(['restore', 'handoff']);

  const managedLine = () => t('policy.managed', 'Managed by your organisation');

  /** The padlock, drawn the way the tab icons are: a stroke in the text colour. */
  function lockIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'managed-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const body = document.createElementNS(ns, 'rect');
    for (const [k, v] of Object.entries({ x: '3.5', y: '7', width: '9', height: '6.5', rx: '1.2' })) body.setAttribute(k, v);
    const shackle = document.createElementNS(ns, 'path');
    shackle.setAttribute('d', 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2');
    svg.append(body, shackle);
    return svg;
  }

  /**
   * The padlock and the line, as one element, for a place the script builds.
   * The words are written by this script, so it rewrites them when the
   * language changes (see below) rather than marking them for the DOM pass.
   */
  function ManagedMark() {
    const mark = document.createElement('span');
    mark.className = 'managed-mark';
    const text = document.createElement('span');
    text.className = 'managed-text';
    text.textContent = managedLine();
    mark.append(lockIcon(), text);
    return mark;
  }

  /** Every mark that is already in the markup gets its padlock once. */
  function decorate(scope) {
    for (const mark of (scope || document).querySelectorAll('.managed-mark[data-managed]')) {
      if (!mark.querySelector('.managed-icon')) mark.prepend(lockIcon());
    }
  }

  /** Show or hide the marks for one thing a policy can hold. */
  function show(name, on) {
    for (const mark of document.querySelectorAll(`.managed-mark[data-managed="${name}"]`)) mark.hidden = !on;
  }

  /**
   * Hold one control: disabled, with the padlock, and the line as its
   * accessible description. Released, it is left for its own code to enable
   * -- unless `release` says nothing but the policy ever turns it off, and
   * then it is switched back on here.
   */
  function hold(control, held, { release = false } = {}) {
    if (!control) return;
    const was = control.dataset.managedTitle !== undefined;
    control.classList.toggle('is-managed', Boolean(held));
    if (held) {
      control.disabled = true;
      control.setAttribute('aria-description', managedLine());
      if (!was) control.dataset.managedTitle = control.title || '';
      control.title = managedLine();
    } else if (was) {
      control.removeAttribute('aria-description');
      control.title = control.dataset.managedTitle;
      delete control.dataset.managedTitle;
      if (release) control.disabled = false;
    }
  }

  const viewOnly = () => Boolean(current && current.viewOnly);

  /** Whether an action of this kind is held by the policy right now. */
  function holds(kind) {
    return viewOnly() && !VIEW_ONLY_ALLOWS.has(kind);
  }

  /** The line at the top of the window, in whatever language is current. */
  function drawBanner() {
    const banner = document.getElementById('managed-banner');
    const text = document.getElementById('managed-banner-text');
    if (!banner || !text) return;
    const m = current;
    const parts = [];
    if (m && m.active) {
      const what = [];
      if (m.viewOnly) what.push(t('policy.banner.viewOnly', 'view only — CleanDrive changes no files here, and putting things back still works'));
      if (m.automatic === 'off') what.push(t('policy.banner.automaticOff', 'automatic cleanup is off'));
      if (m.automatic === 'on') what.push(t('policy.banner.automaticOn', 'it runs a cleanup profile of its own'));
      if (m.categories) what.push(t('policy.banner.categories', 'which categories automatic cleanup may use'));
      if ((m.protectedFolders || []).length > 0) what.push(t('policy.banner.protected', 'folders automatic cleanup never touches'));
      if (m.updatesOff) what.push(t('policy.banner.updates', 'update checks are off'));
      if (m.quarantineZone) what.push(t('policy.banner.quarantine', 'where files moved to another drive go'));
      parts.push(t('policy.banner.lead', 'Your organisation manages some of CleanDrive on this computer: {list}.', { list: what.join('; ') }));
    }
    if (m && (m.notApplied || []).length > 0) {
      parts.push(
        t('policy.banner.notApplied', 'It also set {n} policy(ies) this copy does not apply, because they need CleanDrive Business.', {
          n: m.notApplied.length,
        })
      );
    }
    if (m && m.status === 'unreadable') {
      parts.push(t('policy.banner.unreadable', 'Your organisation’s policy could not be read, so none of it is applied here.'));
    }
    banner.hidden = parts.length === 0;
    setText(text, parts.join(' '));
  }

  /**
   * Everything this file draws, from the last answer. The screens that keep
   * their own copy of the policy are told only when it actually changed:
   * the window gets focus every time somebody comes back to it, and a screen
   * that reloaded its state each time would ask Task Scheduler for nothing.
   */
  function apply(changed) {
    decorate();
    drawBanner();
    show('viewOnly', viewOnly());
    if (typeof refreshActionBars === 'function') refreshActionBars();
    if (!changed) return;
    for (const fn of listeners) {
      try {
        fn(current);
      } catch (err) {
        console.error('[managed] a listener failed:', err);
      }
    }
  }

  let seen = undefined;
  async function load() {
    try {
      const reply = await api.policyState();
      current = reply && reply.ok ? reply.data : null;
    } catch {
      current = null;
    }
    const now = JSON.stringify(current);
    const changed = seen !== undefined && now !== seen;
    seen = now;
    apply(changed);
    return current;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * The words a refused click shows, for the few buttons drawn before the
   * answer arrives. The main process refuses the action itself either way.
   */
  function refuseIfHeld(kind) {
    if (!holds(kind)) return false;
    toast(t('policy.viewOnly.refused', 'Your organisation has set this computer to view only, so CleanDrive changes no files here.'), true);
    return true;
  }

  window.addEventListener('focus', () => {
    load();
  });
  onLanguageChange(() => {
    for (const text of document.querySelectorAll('.managed-mark:not([data-managed]) .managed-text')) setText(text, managedLine());
    for (const control of document.querySelectorAll('.is-managed')) {
      control.title = managedLine();
      control.setAttribute('aria-description', managedLine());
    }
    drawBanner();
  });

  root.Managed = {
    load,
    current: () => current,
    viewOnly,
    holds,
    hold,
    show,
    onChange,
    refuseIfHeld,
    ManagedMark,
    lockIcon,
    VIEW_ONLY_ALLOWS,
  };

  load();
})(window);
