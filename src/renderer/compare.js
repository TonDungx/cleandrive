'use strict';

/**
 * Two to four photographs, side by side (E1).
 *
 * Opened from a group of near-identical pictures, or from anything between two
 * and four the user ticked themselves. Loaded after `media.js` because it
 * reads that screen's state -- which files are known, what was measured from
 * their pixels, what is selected -- and hands the ticking back to it.
 *
 * ## What it refuses to do
 *
 * Decide. Every part of this screen is arranged so that it does not:
 *
 *   - the panes are *ordered* by resolution, then detail, then size, and the
 *     screen says out loud that this is an order and not a recommendation;
 *   - the cell holding the larger value in a row is tinted, and the line under
 *     the table says that tinting means larger, not better;
 *   - nothing arrives ticked, and closing the panel ticks nothing.
 *
 * The roadmap is explicit about this and it is worth restating here, because
 * every one of these is one line of code away from becoming a recommendation:
 * a screen that picks the keeper is a screen that deletes somebody's
 * photographs for them.
 *
 * ## Zoom and pan are shared
 *
 * One transform, applied to every pane. Comparing sharpness means looking at
 * the same corner of each picture at the same magnification -- panes that
 * scrolled independently would be two pictures of different things, and the
 * comparison would be worthless in exactly the case it exists for.
 */

(() => {
  /** The roadmap's number, and the main process enforces the same one. */
  const MAX_PANES = 4;

  /** How fast the flicker alternates. Fast enough to see a difference jump. */
  const FLICKER_MS = 600;

  const MIN_SCALE = 1;
  const MAX_SCALE = 16;

  const state = {
    /** The files on screen, in the suggested order. */
    panes: [],
    /** Every group this was opened from, for Previous/Next. */
    groups: [],
    /** Which of `groups` is showing, or -1 when opened from a free selection. */
    index: -1,
    /** Shared zoom and pan. `scale` 1 is "fit", which is where it opens. */
    view: { scale: 1, x: 0, y: 0 },
    flicker: false,
    flickerAt: 0,
    flickerTimer: null,
    returnFocus: null,
    /** Guards a reply that arrives after the panel moved on. */
    epoch: 0,
    dragging: null,
  };

  const panel = () => $('compare');
  const open = () => !panel().hidden;

  /* ------------------------------------------------------------ ordering -- */

  /**
   * Resolution, then detail, then size -- the roadmap's order, largest first.
   *
   * A file nothing has measured sorts as if it had no detail rather than as if
   * it had none: `media.js` makes the same distinction when it sorts the grid,
   * and for the same reason. An unmeasured picture is not a blank one.
   */
  function suggestedOrder(files) {
    return [...files].sort((a, b) => {
      const pixels = (f) => (f.width || 0) * (f.height || 0);
      if (pixels(b) !== pixels(a)) return pixels(b) - pixels(a);
      const detail = (f) => {
        const m = media.thumbs.get(f.path);
        return m && m.detail !== null && m.detail !== undefined ? m.detail : -1;
      };
      if (detail(b) !== detail(a)) return detail(b) - detail(a);
      return (b.size || 0) - (a.size || 0);
    });
  }

  /* --------------------------------------------------------------- facts -- */

  /**
   * One row of the table: a label, how to read the value out of a file, how to
   * print it, and which way is larger.
   *
   * `bigger` is 1 when a larger number is the one that gets tinted, -1 when a
   * smaller one is (ISO: less light amplified is less noise), and 0 when the
   * question does not apply. Nothing with `bigger: 0` is ever tinted, because
   * there is no honest way to say that one camera or one date beats another.
   */
  const ROWS = [
    {
      key: 'dimensions',
      label: () => t('compare.row.dimensions', 'Dimensions'),
      value: (f) => (f.width && f.height ? f.width * f.height : null),
      text: (f) => (f.width && f.height ? `${formatCount(f.width)} × ${formatCount(f.height)}` : null),
      bigger: 1,
    },
    {
      key: 'megapixels',
      label: () => t('compare.row.megapixels', 'Megapixels'),
      // Computed from the dimensions rather than read straight off the record.
      // The record rounds, and a 160×120 thumbnail rounds to zero -- which
      // `|| null` then turned into a dash, so the table said "we do not know"
      // about a file whose size it had just printed on the line above. A
      // screenshot caught it. Everywhere in this table a dash means unknown.
      value: (f) => (f.width && f.height ? (f.width * f.height) / 1e6 : null),
      text: (f) => {
        if (!f.width || !f.height) return null;
        const mp = (f.width * f.height) / 1e6;
        return mp >= 0.1 ? mp.toFixed(1) : t('compare.underTenth', 'under 0.1');
      },
      bigger: 1,
    },
    {
      key: 'size',
      label: () => t('compare.row.size', 'Size'),
      value: (f) => f.size || null,
      text: (f) => formatBytes(f.size || 0),
      bigger: 1,
    },
    {
      key: 'detail',
      label: () => t('compare.row.detail', 'Detail'),
      value: (f) => {
        const m = media.thumbs.get(f.path);
        return m && m.detail !== null && m.detail !== undefined ? m.detail : null;
      },
      text: (f) => {
        const m = media.thumbs.get(f.path);
        return m && m.detail !== null && m.detail !== undefined ? formatCount(m.detail) : null;
      },
      bigger: 1,
    },
    {
      key: 'taken',
      label: () => t('compare.row.taken', 'Taken'),
      value: () => null,
      text: (f) => (f.takenAt ? new Date(f.takenAt).toLocaleString(uiLocale()) : null),
      bigger: 0,
    },
    {
      key: 'camera',
      label: () => t('compare.row.camera', 'Camera'),
      value: () => null,
      text: (f) => f.camera || null,
      bigger: 0,
    },
    {
      key: 'iso',
      label: () => t('compare.row.iso', 'ISO'),
      value: (f) => (Number.isFinite(f.iso) ? f.iso : null),
      text: (f) => (Number.isFinite(f.iso) ? formatCount(f.iso) : null),
      // Lower is less amplification and so less noise. The one row where the
      // tinted cell is the smaller number, which is why the note under the
      // table says "stands out" rather than "is highest".
      bigger: -1,
    },
    {
      key: 'shutter',
      label: () => t('compare.row.shutter', 'Shutter'),
      value: () => null,
      text: (f) => shutter(f.exposureTime),
      bigger: 0,
    },
  ];

  /** `0.008` as `1/125 s`, the way a camera says it. */
  function shutter(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`;
    return `1/${Math.round(1 / seconds)} s`;
  }

  /* ------------------------------------------------------------- opening -- */

  /**
   * @param {object[]} files  2–4 media records, in any order
   * @param {{groups?: object[], index?: number}} [context]
   */
  async function openCompare(files, context = {}) {
    const list = (files || []).filter(Boolean).slice(0, MAX_PANES);
    if (list.length < 2) {
      toast(t('compare.needTwo', 'Pick at least two photos to compare.'), true);
      return;
    }

    const epoch = ++state.epoch;
    state.returnFocus = state.returnFocus || document.activeElement;
    state.groups = Array.isArray(context.groups) ? context.groups : [];
    state.index = Number.isInteger(context.index) ? context.index : -1;
    state.panes = suggestedOrder(list).map((file) => ({ file, token: null, error: null }));
    stopFlicker();
    resetView();

    panel().hidden = false;
    setBehind(true);
    draw();
    $('compare-close').focus();

    const reply = unwrap(
      await api.previewCompare(state.panes.map((p) => p.file.path)),
      t('compare.label', 'Compare')
    );
    if (epoch !== state.epoch || !open()) return;

    const answers = Array.isArray(reply) ? reply : [];
    state.panes.forEach((pane, i) => {
      const one = answers[i];
      // Each file answers for itself: one of four being unreadable costs that
      // pane, not the comparison. `preview:compare` is built the same way.
      if (one && one.ok && one.data && one.data.token) pane.token = one.data.token;
      else pane.error = one && one.error ? one.error : t('compare.unreadable', 'Could not be read');
    });
    draw();
  }

  function close() {
    if (!open()) return;
    stopFlicker();
    state.epoch += 1;
    panel().hidden = true;
    setBehind(false);
    // Drops the references that keep four full-resolution pictures in memory.
    $('compare-panes').replaceChildren();
    state.panes = [];
    api.closePreview();
    if (state.returnFocus && typeof state.returnFocus.focus === 'function') state.returnFocus.focus();
    state.returnFocus = null;
  }

  /**
   * The window behind, made inert. Copied in spirit from `viewer.js`, which
   * explains why `aria-modal` alone is not enough: it tells a screen reader
   * the rest is out of reach without stopping Tab walking into it.
   */
  function setBehind(on) {
    for (const el of document.querySelectorAll('body > .topbar, body > .workspace, body > .delete-progress')) {
      el.inert = on;
    }
  }

  /* --------------------------------------------------------------- zoom  -- */

  function resetView() {
    state.view = { scale: 1, x: 0, y: 0 };
    applyView();
  }

  function clampPan() {
    // At fit there is nothing to pan; past it, the picture may not be dragged
    // entirely out of its own frame.
    const limit = (state.view.scale - 1) * 50;
    state.view.x = Math.max(-limit, Math.min(limit, state.view.x));
    state.view.y = Math.max(-limit, Math.min(limit, state.view.y));
  }

  function applyView() {
    clampPan();
    const { scale, x, y } = state.view;
    for (const img of $('compare-panes').querySelectorAll('.compare-img')) {
      img.style.transform = `translate(${x}%, ${y}%) scale(${scale})`;
    }
    const reset = $('compare-reset');
    if (reset) reset.disabled = scale === 1 && x === 0 && y === 0;
  }

  function zoomBy(factor, origin) {
    const before = state.view.scale;
    const after = Math.max(MIN_SCALE, Math.min(MAX_SCALE, before * factor));
    if (after === before) return;

    // Zoom about the pointer rather than the centre, so the detail somebody is
    // looking at stays under the cursor instead of sliding off the pane.
    if (origin) {
      const grow = after / before;
      state.view.x = (state.view.x - origin.x) * grow + origin.x;
      state.view.y = (state.view.y - origin.y) * grow + origin.y;
    }
    state.view.scale = after;
    if (after === 1) {
      state.view.x = 0;
      state.view.y = 0;
    }
    applyView();
  }

  /* ------------------------------------------------------------ flicker  -- */

  /**
   * Show one picture at a time in the same place, alternating.
   *
   * The reason this is worth a mode of its own: two pictures side by side are
   * compared by moving your eyes, and a difference of a few pixels does not
   * survive the journey. In the same rectangle, one after the other, it jumps
   * out. Only the first two panes take part -- flicking between four is not a
   * comparison, it is a slideshow.
   */
  function startFlicker() {
    if (state.panes.length < 2) return;
    state.flicker = true;
    state.flickerAt = 0;
    panel().classList.add('is-flicking');
    $('compare-flicker').setAttribute('aria-pressed', 'true');
    clearInterval(state.flickerTimer);
    state.flickerTimer = setInterval(() => {
      state.flickerAt = state.flickerAt === 0 ? 1 : 0;
      showFlickerFrame();
    }, FLICKER_MS);
    showFlickerFrame();
  }

  function stopFlicker() {
    state.flicker = false;
    clearInterval(state.flickerTimer);
    state.flickerTimer = null;
    panel().classList.remove('is-flicking');
    const button = $('compare-flicker');
    if (button) button.setAttribute('aria-pressed', 'false');
    for (const pane of $('compare-panes').children) pane.classList.remove('is-hidden-frame');
    drawHint();
  }

  function showFlickerFrame() {
    const panes = [...$('compare-panes').children];
    panes.forEach((pane, i) => {
      if (i > 1) pane.classList.add('is-hidden-frame');
      else pane.classList.toggle('is-hidden-frame', i !== state.flickerAt);
    });
    drawHint();
  }

  /* -------------------------------------------------------------- drawing - */

  function draw() {
    drawHead();
    drawPanes();
    drawFacts();
    drawHint();
    applyView();
  }

  function drawHead() {
    const n = state.panes.length;
    $('compare-heading').textContent = t('compare.heading', '{n} photos, side by side', { n: formatCount(n) });

    const group = state.index >= 0 ? state.groups[state.index] : null;
    $('compare-where').textContent = group
      ? t('compare.ofGroups', 'Group {i} of {total} · they differ by {spread} of 64', {
          i: formatCount(state.index + 1),
          total: formatCount(state.groups.length),
          spread: formatCount(group.spread || 0),
        })
      : t('compare.ownPick', 'The ones you ticked');

    const many = state.groups.length > 1;
    $('compare-prev').hidden = !many;
    $('compare-next').hidden = !many;
    $('compare-prev').disabled = !many || state.index <= 0;
    $('compare-next').disabled = !many || state.index < 0 || state.index >= state.groups.length - 1;
    $('compare-flicker').disabled = state.panes.length < 2;
  }

  function drawPanes() {
    const host = $('compare-panes');
    host.replaceChildren();
    host.dataset.count = String(state.panes.length);

    state.panes.forEach((pane, i) => {
      const box = document.createElement('div');
      box.className = 'cmp-pane';

      const head = document.createElement('div');
      head.className = 'cmp-pane-head';

      // The number is the keyboard shortcut, shown rather than documented
      // somewhere else. A shortcut nobody can see is a shortcut nobody uses.
      const key = document.createElement('kbd');
      key.className = 'compare-key';
      key.textContent = String(i + 1);

      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.className = 'compare-tick';
      tick.checked = media.selected.has(pane.file.path);
      tick.id = `compare-tick-${i}`;
      tick.addEventListener('change', () => toggle(i));

      const label = document.createElement('label');
      label.className = 'cmp-pane-name';
      label.htmlFor = tick.id;
      label.textContent = pane.file.name;
      label.title = pane.file.path;

      head.append(key, tick, label);

      const frame = document.createElement('div');
      frame.className = 'compare-frame';
      if (pane.token) {
        const img = document.createElement('img');
        img.className = 'compare-img';
        img.src = `cleandrive://${pane.token}/`;
        img.alt = '';
        img.draggable = false;
        frame.appendChild(img);
      } else {
        const note = document.createElement('span');
        note.className = 'compare-waiting';
        note.textContent = pane.error || t('viewer.reading', 'Reading…');
        frame.appendChild(note);
      }

      box.append(head, frame);
      host.appendChild(box);
    });
  }

  function drawFacts() {
    const host = $('compare-facts');
    host.replaceChildren();
    if (state.panes.length === 0) return;

    const table = document.createElement('table');
    table.className = 'compare-table';

    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    state.panes.forEach((pane, i) => {
      const th = document.createElement('th');
      th.textContent = `${i + 1}`;
      th.title = pane.file.name;
      headRow.appendChild(th);
    });
    table.appendChild(headRow);

    for (const row of ROWS) {
      const cells = state.panes.map((pane) => ({
        text: row.text(pane.file),
        value: row.value(pane.file),
      }));
      // A row where nobody knows anything is left out rather than printed as a
      // line of dashes. On a burst from one phone half of these are empty.
      if (cells.every((c) => c.text === null || c.text === undefined || c.text === '')) continue;

      let best = null;
      if (row.bigger !== 0) {
        const known = cells.map((c) => c.value).filter((v) => Number.isFinite(v));
        // Tinted only when there is something to tell apart: every value the
        // same means no cell stands out, and tinting them all says nothing.
        if (known.length > 1 && new Set(known).size > 1) {
          best = row.bigger > 0 ? Math.max(...known) : Math.min(...known);
        }
      }

      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row.label();
      tr.appendChild(th);

      for (const cell of cells) {
        const td = document.createElement('td');
        td.textContent = cell.text === null || cell.text === undefined ? '—' : cell.text;
        if (best !== null && Number.isFinite(cell.value) && cell.value === best) {
          td.classList.add('is-standout');
        }
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }

    host.appendChild(table);

    const note = document.createElement('p');
    note.className = 'compare-note';
    note.textContent = t(
      'compare.note',
      'Shaded cells are the value that stands out — largest, or lowest for ISO. They are not a recommendation, ' +
        'and the order the photos are in is a suggestion, not a choice made for you.'
    );
    host.appendChild(note);
  }

  function drawHint() {
    const hint = $('compare-hint');
    if (!hint) return;
    if (state.flicker) {
      const showing = state.panes[state.flickerAt];
      hint.textContent = t('compare.flicking', 'Flicking between 1 and 2 — showing {name}', {
        name: showing ? showing.file.name : '',
      });
      return;
    }
    hint.textContent = t(
      'compare.hint',
      'Scroll to zoom, drag to pan — both move every photo together. 1–4 ticks a photo, ← and → change group.'
    );
  }

  /* --------------------------------------------------------------- ticking */

  /**
   * Tick or untick one pane, in the grid's own selection.
   *
   * The compare panel keeps no list of its own. Somebody who ticks two copies
   * here, closes the panel and presses delete must be deleting those two, and
   * a second list is how that stops being true.
   */
  function toggle(i) {
    const pane = state.panes[i];
    if (!pane) return;
    if (media.selected.has(pane.file.path)) media.selected.delete(pane.file.path);
    else media.selected.add(pane.file.path);

    const tick = $(`compare-tick-${i}`);
    if (tick) tick.checked = media.selected.has(pane.file.path);
    syncCells();
    updateSelection();
  }

  function goto(index) {
    if (index < 0 || index >= state.groups.length) return;
    const group = state.groups[index];
    const files = group.files
      .map((f) => media.files.find((one) => one.path === f.path))
      .filter(Boolean);
    if (files.length < 2) {
      toast(t('compare.groupGone', 'That group is no longer in the list.'), true);
      return;
    }
    openCompare(files, { groups: state.groups, index });
  }

  /* ----------------------------------------------------------------- wiring */

  $('compare-close').addEventListener('click', close);
  $('compare-reset').addEventListener('click', resetView);
  $('compare-prev').addEventListener('click', () => goto(state.index - 1));
  $('compare-next').addEventListener('click', () => goto(state.index + 1));
  $('compare-flicker').addEventListener('click', () => (state.flicker ? stopFlicker() : startFlicker()));

  panel().addEventListener('click', (event) => {
    if (event.target === panel()) close();
  });

  /* -- zoom and pan, shared across every pane ----------------------------- */

  $('compare-panes').addEventListener(
    'wheel',
    (event) => {
      if (!open()) return;
      event.preventDefault();
      const frame = event.target.closest('.compare-frame');
      let origin = null;
      if (frame) {
        const box = frame.getBoundingClientRect();
        // As a percentage of the frame, measured from its centre, because the
        // transform is in percentages and every pane is the same size.
        origin = {
          x: ((event.clientX - box.left) / box.width - 0.5) * -100,
          y: ((event.clientY - box.top) / box.height - 0.5) * -100,
        };
      }
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, origin);
    },
    { passive: false }
  );

  $('compare-panes').addEventListener('pointerdown', (event) => {
    if (!open() || state.view.scale === 1) return;
    const frame = event.target.closest('.compare-frame');
    if (!frame) return;
    state.dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, box: frame.getBoundingClientRect() };
    frame.setPointerCapture(event.pointerId);
    panel().classList.add('is-dragging');
  });

  $('compare-panes').addEventListener('pointermove', (event) => {
    const drag = state.dragging;
    if (!drag || drag.id !== event.pointerId) return;
    state.view.x += ((event.clientX - drag.x) / drag.box.width) * 100;
    state.view.y += ((event.clientY - drag.y) / drag.box.height) * 100;
    drag.x = event.clientX;
    drag.y = event.clientY;
    applyView();
  });

  const endDrag = (event) => {
    if (!state.dragging || state.dragging.id !== event.pointerId) return;
    state.dragging = null;
    panel().classList.remove('is-dragging');
  };
  $('compare-panes').addEventListener('pointerup', endDrag);
  $('compare-panes').addEventListener('pointercancel', endDrag);

  /* -- keys ---------------------------------------------------------------- */

  document.addEventListener(
    'keydown',
    (event) => {
      if (!open()) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (event.key === 'Escape') {
        close();
        // As the viewer does: closing this must not also reach the grid, which
        // clears the selection on Escape.
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      if (event.key >= '1' && event.key <= '4') {
        const i = Number(event.key) - 1;
        if (i < state.panes.length) {
          toggle(i);
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (state.groups.length > 1 && state.index >= 0) {
          goto(state.index + (event.key === 'ArrowRight' ? 1 : -1));
          event.preventDefault();
          event.stopPropagation();
        }
      }
    },
    true
  );

  onLanguageChange(() => {
    if (open()) draw();
  });

  window.PhotoCompare = { open: openCompare, close, isOpen: open, suggestedOrder, shutter, MAX_PANES };
})();
