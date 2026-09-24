'use strict';

/**
 * The pieces every screen is drawn from.
 *
 * Until now each screen built its own rows, its own selection readout and its
 * own delete button, and they had drifted: shift-click worked on the photo
 * grid and nowhere else, the confidence the app had in a verdict was shown on
 * one screen out of four, and three delete buttons said nothing about the fact
 * that the Recycle Bin frees no space. These are the shared versions.
 *
 *   CandidateList   selectable rows, shift-click ranges, arrow keys, and a
 *                   window of rows rather than all of them past a few hundred
 *   EvidencePanel   the reasons for a verdict, strongest first, and how sure
 *   ActionBar       a floating bar: what is selected, and what can be done
 *                   to all of it -- the actions every selected row allows
 *   FreesBadge      beside each action: does it give the space back or not
 *   UpgradeHint     a line of text where a free limit is reached. Never in a
 *                   dialog, a progress panel or a toast -- it has no API that
 *                   could put it there
 *   RefusalNote     the sentence that stands in for a number that would be a lie
 *
 * They take the views `candidates.js` makes, so a row can only be drawn from a
 * candidate that passed the main process's validation.
 */
(function (root) {
  /* ------------------------------------------------------------ evidence */

  /**
   * @param {object} view    a candidate view
   * @param {object} [options]
   * @param {string} [options.className]
   */
  function EvidencePanel(view, { className = 'evidence' } = {}) {
    const panel = document.createElement('div');
    panel.className = `${className}-panel`;

    const head = document.createElement('p');
    head.className = `${className}-head`;
    head.textContent = t('evidence.head', 'Why — {confidence}', { confidence: confidenceWord(view.confidence) });
    panel.appendChild(head);

    const list = document.createElement('ol');
    list.className = className;
    for (const item of [...(view.evidence || [])].sort((a, b) => a.rank - b.rank)) {
      const li = document.createElement('li');
      li.textContent = tm(item);
      list.appendChild(li);
    }
    panel.appendChild(list);
    return panel;
  }

  /** Every reason on one line, for a tooltip. */
  function evidenceText(view) {
    return [...(view.evidence || [])].sort((a, b) => a.rank - b.rank).map((e) => tm(e)).join('\n');
  }

  /* ------------------------------------------------------------ frees */

  /**
   * Whether an action gives space back to the drive it came from.
   *
   * Moving to the Recycle Bin does not -- the bin is on the same drive -- and
   * a button that says "Move to Recycle Bin" next to a total in gigabytes
   * reads as a promise of gigabytes. This says otherwise, every time.
   */
  function FreesBadge(freesOnVolume) {
    const el = document.createElement('span');
    el.className = freesOnVolume ? 'frees-badge is-frees' : 'frees-badge is-not-freed';
    el.textContent = freesOnVolume
      ? t('frees.yes', 'Frees the space')
      : t('frees.bin', 'Not freed until the bin is emptied');
    el.title = freesOnVolume
      ? t('frees.yesHint', 'The space comes back to this drive as soon as this finishes.')
      : t(
          'frees.binHint',
          'The Recycle Bin is on the same drive, so moving files there frees nothing until it is emptied.'
        );
    return el;
  }

  /** What each action frees, as the main process's handlers declare it. */
  const FREES = { recycle: false };

  /* ------------------------------------------------------------ action bar */

  /**
   * A floating bar that appears when something is selected.
   *
   * The buttons are the actions every selected candidate allows -- the
   * intersection of their `actions`, not the union: an action is offered only
   * if it applies to everything it would be applied to. Only the Recycle Bin
   * exists today, so in practice that is one button; the rule is here for the
   * ones that follow.
   *
   * @param {object} options
   * @param {HTMLElement} options.root       the `.actionbar` element
   * @param {HTMLElement} options.readout    where "n selected · size" goes
   * @param {Object<string, HTMLButtonElement>} options.buttons  one per action kind
   * @param {() => object[]} options.selected  the selected views
   */
  function ActionBar({ root, readout, buttons, selected }) {
    const badges = {};
    for (const [kind, button] of Object.entries(buttons)) {
      badges[kind] = FreesBadge(FREES[kind] === true);
      button.before(badges[kind]);
    }

    function update() {
      const rows = selected();
      const count = rows.length;
      const bytes = rows.reduce((n, row) => n + (row.size || 0), 0);

      readout.textContent = count
        ? t('app.selectedCount', '{n} selected · {size}', { n: formatCount(count), size: formatBytes(bytes) })
        : t('app.nothingSelected', 'Nothing selected');

      for (const [kind, button] of Object.entries(buttons)) {
        const allowed = count > 0 && rows.every((row) => !row.actions || row.actions.includes(kind));
        button.disabled = !allowed || actionRunning;
        badges[kind].hidden = !allowed;
      }
      root.hidden = count === 0;
    }

    return { update, root };
  }

  /** Set by the delete progress panel: nothing else may start while one runs. */
  let actionRunning = false;
  function setActionRunning(running) {
    actionRunning = running;
  }

  /* ------------------------------------------------------------ list */

  /** Past this many rows only the ones near the viewport are in the DOM. */
  const VIRTUALIZE_AT = 200;

  /**
   * A list of candidate rows.
   *
   * Tick a box to select; shift-tick to take everything between it and the
   * last box ticked. Arrow keys move between rows, Space ticks, and
   * Shift+arrow extends the selection -- the keyboard gets everything the
   * mouse does.
   *
   * @param {HTMLElement} list        a <ul>
   * @param {object} options
   * @param {object[]} options.rows   candidate views
   * @param {Set<string>} options.selection  paths
   * @param {() => void} options.onChange
   * @param {(row) => string|null} [options.meta]    the second line
   * @param {(row) => HTMLElement|null} [options.badge]
   * @param {number} [options.virtualizeAt]
   */
  function CandidateList(list, { rows, selection, onChange, meta = null, badge = null, virtualizeAt = VIRTUALIZE_AT }) {
    let anchor = null;
    let active = 0;
    const expanded = new Set();
    const windowed = rows.length > virtualizeAt;
    let rowHeight = 0;
    let range = [0, rows.length];

    list.setAttribute('role', 'list');
    list.classList.toggle('is-windowed', windowed);

    function toggle(index, checked, extend) {
      const row = rows[index];
      if (!row) return;
      if (extend && anchor !== null) {
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
        for (let i = from; i <= to; i++) {
          if (checked) selection.add(rows[i].path);
          else selection.delete(rows[i].path);
        }
      } else if (checked) selection.add(row.path);
      else selection.delete(row.path);
      anchor = index;
      sync();
      onChange();
    }

    function rowElement(row, index) {
      const li = document.createElement('li');
      li.className = 'file-row';
      li.dataset.path = row.path;
      li.dataset.index = String(index);
      li.setAttribute('aria-setsize', String(rows.length));
      li.setAttribute('aria-posinset', String(index + 1));
      li.tabIndex = index === active ? 0 : -1;

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = selection.has(row.path);
      check.tabIndex = -1;
      check.setAttribute('aria-label', row.path);
      check.addEventListener('click', (event) => {
        event.stopPropagation();
        toggle(index, check.checked, event.shiftKey);
      });

      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = formatBytes(row.size);

      const main = document.createElement('span');
      main.className = 'file-main';
      const pathEl = document.createElement('span');
      pathEl.className = 'file-path';
      pathEl.textContent = elide(row.path, 90);
      pathEl.title = row.path;
      main.appendChild(pathEl);

      const metaText = meta ? meta(row) : timeLabel(row);
      if (metaText) {
        const metaEl = document.createElement('span');
        metaEl.className = 'file-meta';
        metaEl.textContent = metaText;
        metaEl.title = metaText;
        main.appendChild(metaEl);
      }

      li.append(check, size, main);

      const b = badge ? badge(row) : null;
      if (b) {
        // The badge is where the evidence opens: it is already the thing on
        // the row that states a conclusion, so it is where "why?" belongs.
        if (b.tagName === 'BUTTON') {
          b.setAttribute('aria-expanded', String(expanded.has(row.path)));
          b.addEventListener('click', (event) => {
            event.stopPropagation();
            if (expanded.has(row.path)) expanded.delete(row.path);
            else expanded.add(row.path);
            render();
          });
        }
        li.appendChild(b);
      }

      const actions = document.createElement('span');
      actions.className = 'file-actions';
      actions.append(
        linkButton(t('app.view', 'View'), () => openViewer(row.path), 'is-lead'),
        linkButton(t('app.reveal', 'Reveal'), () => api.reveal(row.path)),
        linkButton(t('app.open', 'Open'), async () => unwrap(await api.open(row.path), t('app.open', 'Open')))
      );
      for (const button of actions.querySelectorAll('button')) button.tabIndex = -1;
      li.appendChild(actions);

      li.addEventListener('focus', () => {
        active = index;
      });
      return li;
    }

    function evidenceElement(row) {
      const li = document.createElement('li');
      li.className = 'evidence-row';
      li.setAttribute('role', 'note');
      li.appendChild(EvidencePanel(row));
      return li;
    }

    function spacer(height) {
      const li = document.createElement('li');
      li.className = 'file-spacer';
      li.setAttribute('aria-hidden', 'true');
      li.style.height = `${height}px`;
      return li;
    }

    /** Which rows are near the viewport, given where the list sits in the page. */
    function visibleRange() {
      if (!windowed || !rowHeight) return [0, windowed ? Math.min(rows.length, 60) : rows.length];
      const box = list.getBoundingClientRect();
      const viewport = window.innerHeight;
      const first = Math.max(0, Math.floor(-box.top / rowHeight) - 20);
      const last = Math.min(rows.length, Math.ceil((viewport - box.top) / rowHeight) + 20);
      return [Math.min(first, rows.length), Math.max(first, last)];
    }

    function render() {
      range = visibleRange();
      const [from, to] = range;
      const children = [];
      if (windowed && from > 0) children.push(spacer(from * rowHeight));
      for (let i = from; i < to; i++) {
        children.push(rowElement(rows[i], i));
        if (expanded.has(rows[i].path)) children.push(evidenceElement(rows[i]));
      }
      if (windowed && to < rows.length) children.push(spacer((rows.length - to) * rowHeight));
      list.replaceChildren(...children);

      if (windowed && !rowHeight) {
        const first = list.querySelector('.file-row');
        if (first) {
          rowHeight = first.getBoundingClientRect().height || 44;
          render();
        }
      }
    }

    function sync() {
      for (const li of list.querySelectorAll('.file-row')) {
        const box = li.querySelector('input[type="checkbox"]');
        if (box) box.checked = selection.has(li.dataset.path);
      }
    }

    function focusRow(index) {
      active = Math.max(0, Math.min(rows.length - 1, index));
      let li = list.querySelector(`.file-row[data-index="${active}"]`);
      if (!li && windowed) {
        list.scrollIntoView({ block: 'nearest' });
        render();
        li = list.querySelector(`.file-row[data-index="${active}"]`);
      }
      for (const row of list.querySelectorAll('.file-row')) row.tabIndex = row === li ? 0 : -1;
      if (li) {
        li.focus();
        li.scrollIntoView({ block: 'nearest' });
      }
    }

    list.onkeydown = (event) => {
      const li = event.target.closest && event.target.closest('.file-row');
      if (!li) return;
      // Space and Enter belong to whatever has focus. On the checkbox or a
      // button they already do their own thing, and handling them here too
      // would tick a box twice or open the viewer on top of Reveal.
      if ((event.key === ' ' || event.key === 'Enter') && event.target !== li) return;
      const index = Number(li.dataset.index);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = index + (event.key === 'ArrowDown' ? 1 : -1);
        if (event.shiftKey && rows[next]) {
          // The row the extension starts from is the one the keyboard was on,
          // unless a range has already been started.
          if (anchor === null) anchor = index;
          toggle(next, true, true);
        }
        focusRow(next);
      } else if (event.key === ' ') {
        event.preventDefault();
        toggle(index, !selection.has(rows[index].path), event.shiftKey);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        openViewer(rows[index].path);
      }
    };

    // A list drawn again into the same element -- a new scan, a language
    // change -- takes over from the old one, whose listeners go with it.
    if (typeof list._candidateListDetach === 'function') list._candidateListDetach();
    list._candidateListDetach = null;

    let frame = 0;
    const scroller = document.querySelector('main') || window;
    const detach = () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (list._candidateListDetach === detach) list._candidateListDetach = null;
    };
    function onScroll() {
      // A list that has left the page stops listening the first time it hears.
      if (!list.isConnected) {
        detach();
        return;
      }
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const [from, to] = visibleRange();
        if (from !== range[0] || to !== range[1]) render();
      });
    }
    if (windowed) {
      scroller.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      list._candidateListDetach = detach;
    }

    render();
    return { sync, render, rows, focusRow };
  }

  /* ------------------------------------------------------------ upgrade */

  /** What the main process says this build may use, loaded once. */
  let entitlements = null;
  async function loadEntitlements() {
    const reply = await api.entitlements();
    entitlements = reply && reply.ok ? new Map(reply.data.map((e) => [e.feature, e])) : new Map();
    return entitlements;
  }

  /**
   * A line of text where a paid limit is reached, or nothing.
   *
   * Returns null when the feature is allowed, and null when the entitlements
   * have not been read yet -- an app that is not sure must not advertise.
   * There is no modal version and no way to attach one to a dialog: the rule
   * is that the moment of deciding what to delete never carries an upsell.
   */
  function UpgradeHint(feature, message) {
    const known = entitlements && entitlements.get(feature);
    if (!known || known.allowed) return null;
    const el = document.createElement('p');
    el.className = 'upgrade-hint';
    el.dataset.feature = feature;
    el.textContent = tm(message);
    return el;
  }

  /* ------------------------------------------------------------ refusal */

  /** Where a number would be a guess presented as a fact, the reason instead. */
  function RefusalNote(message) {
    const el = document.createElement('p');
    el.className = 'refusal-note';
    el.setAttribute('role', 'status');
    el.textContent = tm(message);
    return el;
  }

  root.EvidencePanel = EvidencePanel;
  root.evidenceText = evidenceText;
  root.FreesBadge = FreesBadge;
  root.ActionBar = ActionBar;
  root.setActionRunning = setActionRunning;
  root.CandidateList = CandidateList;
  root.UpgradeHint = UpgradeHint;
  root.loadEntitlements = loadEntitlements;
  root.RefusalNote = RefusalNote;
  root.VIRTUALIZE_AT = VIRTUALIZE_AT;
})(window);
