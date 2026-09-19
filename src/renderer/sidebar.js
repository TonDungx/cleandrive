'use strict';

/**
 * The sidebar: how wide it is, and whether it is there at all.
 *
 * Three states, one number. The width the handle sets is written to
 * `--sidebar-w` on the document element, and everything else follows from it:
 * a container query inside the sidebar drops the labels when there is no room
 * for them, and a media query for a narrow window overrides the same custom
 * property on `.workspace` -- nearer to the sidebar than `:root`, so the
 * window wins where it has an opinion, and the stored width comes back
 * untouched when the window is wide again.
 *
 * Closing is a state rather than a width of zero, because reopening has to
 * restore what the person last chose. Dragging the handle into the left edge
 * closes it too: the threshold is above the icon rail, so the rail is a place
 * the drag can rest rather than a gate it has to pass through.
 *
 * The choice is kept in `localStorage`, not the settings file. It is a
 * per-window convenience, not a preference the scheduled run or the tray has
 * any use for, and a storage that is unavailable (a fresh profile, a wiped
 * cache) leaves the default rather than an error.
 */
(() => {
  const root = document.documentElement;

  const KEY = 'cleandrive.sidebar';
  const RAIL = 56; //  icons alone
  const MAX = 340;
  const DEFAULT = 208;
  /** Drag narrower than this and it closes rather than shrinking further. */
  const SHUT_BELOW = 92;

  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  const hide = document.getElementById('sidebar-toggle');
  const show = document.getElementById('sidebar-open');

  if (!sidebar || !resizer) return;

  let width = DEFAULT;
  let closed = false;

  const clamp = (n) => Math.min(MAX, Math.max(RAIL, Math.round(n)));

  /* ---- the stored choice ------------------------------------------------ */

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Number.isFinite(saved.width)) width = clamp(saved.width);
    if (saved && saved.closed === true) closed = true;
  } catch {
    /* No storage, or nothing in it. The defaults above are the answer. */
  }

  function remember() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ width, closed }));
    } catch {
      /* Storage can be unavailable; the sidebar still works for this window. */
    }
  }

  /* ---- applying it ------------------------------------------------------ */

  function apply() {
    root.style.setProperty('--sidebar-w', `${width}px`);
    root.dataset.sidebar = closed ? 'closed' : 'open';
    if (show) show.hidden = !closed;
    resizer.setAttribute('aria-valuenow', String(closed ? 0 : width));
    resizer.setAttribute('aria-valuemin', '0');
    resizer.setAttribute('aria-valuemax', String(MAX));
  }

  function setClosed(next, focus) {
    closed = next;
    apply();
    remember();
    if (!focus) return;
    // Focus has to go somewhere that still exists: the button that just
    // vanished cannot keep it, and a keyboard user would land back at the top
    // of the document.
    const target = closed ? show : resizer;
    if (target) target.focus();
  }

  apply();

  /* ---- dragging --------------------------------------------------------- */

  let dragging = false;
  /** The width the drag started from, for a drag that ends with it shut. */
  let widthBeforeDrag = width;

  function widthFromPointer(event) {
    // Measured from the workspace's left edge rather than the sidebar's, which
    // is zero-width while closed -- the sidebar is the thing being measured,
    // so it cannot also be the ruler.
    const left = resizer.parentElement.getBoundingClientRect().left;
    return event.clientX - left;
  }

  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    widthBeforeDrag = width;
    // Capture keeps the drag alive once the pointer leaves the 7px handle.
    // A synthetic pointer id (a test driving the UI) cannot be captured, and
    // that is not a reason to refuse the drag.
    try {
      resizer.setPointerCapture(event.pointerId);
    } catch {
      /* not a real pointer */
    }
    root.dataset.sidebarDragging = '';
    event.preventDefault();
  });

  resizer.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const next = widthFromPointer(event);

    if (next < SHUT_BELOW) {
      closed = true;
    } else {
      closed = false;
      width = clamp(next);
    }
    apply();
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    try {
      if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured */
    }
    delete root.dataset.sidebarDragging;

    // A drag that ends shut swept through every width on its way to the edge,
    // and the last one it passed is not a choice anybody made. Reopening
    // should give back the width the sidebar had before the drag, not the
    // 100-odd pixels the pointer happened to cross at speed.
    if (closed) {
      width = widthBeforeDrag;
      apply();
    }

    remember();
  }

  resizer.addEventListener('pointerup', endDrag);
  resizer.addEventListener('pointercancel', endDrag);

  /** A double-click is the usual way back to the default width. */
  resizer.addEventListener('dblclick', () => {
    width = DEFAULT;
    setClosed(false);
  });

  /* ---- the keyboard ----------------------------------------------------- */

  resizer.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 32 : 16;

    switch (event.key) {
      case 'ArrowLeft':
        if (closed) return;
        if (width - step < SHUT_BELOW) setClosed(true);
        else {
          width = clamp(width - step);
          apply();
          remember();
        }
        break;
      case 'ArrowRight':
        if (closed) setClosed(false);
        else {
          width = clamp(width + step);
          apply();
          remember();
        }
        break;
      case 'Home':
        width = RAIL;
        setClosed(false);
        break;
      case 'End':
        width = MAX;
        setClosed(false);
        break;
      case 'Enter':
      case ' ':
        setClosed(!closed, true);
        break;
      default:
        return;
    }

    event.preventDefault();
  });

  /* ---- the two buttons -------------------------------------------------- */

  if (hide) {
    hide.addEventListener('click', () => setClosed(true, true));
  }

  if (show) {
    show.addEventListener('click', () => {
      // Reopening at the rail width would look like nothing happened to
      // someone who had dragged it that narrow before closing it.
      if (width < SHUT_BELOW) width = DEFAULT;
      setClosed(false, true);
    });
  }
})();
