'use strict';

/**
 * The Restore Center.
 *
 * One card per session the journal holds -- a delete from a screen, a
 * scheduled cleanup, a purge, an earlier restore -- newest first. A card says
 * what happened in one sentence and then where its files are now, which the
 * main process reads from the disk every time this tab is opened. The journal
 * is what the app claims it did; the disk is what is true, and the two differ
 * whenever somebody has used Explorer's own "Restore" or emptied the bin.
 *
 * The rows are journal records, not candidates: none of them is a verdict on
 * whether a file should go. They are drawn with the same list as every other
 * screen so the keyboard does the same things here, but a file that is in the
 * Recycle Bin has nothing to View at the path it came from, and one the purge
 * removed cannot be ticked.
 *
 * Nothing here is behind a licence. The window never names a path to put
 * back, only journal ids, so it can ask for something the app did to be undone
 * and for nothing else.
 */
(() => {
  const host = $('restore-sessions');
  if (!host) return;

  const view = {
    sessions: null,
    items: new Map(), // session id -> item rows
    open: new Set(), // session ids whose files are shown
    selection: new Map(), // session id -> Set of paths
    lists: new Map(), // session id -> CandidateList
    loading: false,
  };

  const selectionFor = (id) => {
    if (!view.selection.has(id)) view.selection.set(id, new Set());
    return view.selection.get(id);
  };

  /* ---- words --------------------------------------------------------------- */

  function formatWhen(ms) {
    if (!Number.isFinite(ms)) return t('app.ago.unknown', 'unknown');
    return new Date(ms).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** What a session did, as one sentence. */
  function titleOf(s) {
    const n = formatCount(s.count);
    const items = word(s.count, 'app.item', 'item', 'items');
    switch (s.kind) {
      case 'recycle':
        return t('restore.title.recycle', 'Moved {n} {items} to the Recycle Bin', { n, items });
      case 'restore':
        return t('restore.title.restore', 'Put back {n} {items} from the Recycle Bin', { n, items });
      case 'purge':
        return t('restore.title.purge', 'Permanently removed {n} {items} from the Recycle Bin', { n, items });
      default:
        return t('restore.title.other', '{kind}: {n} {items}', { kind: s.kind, n, items });
    }
  }

  /** Where the session came from. */
  function sourceOf(s) {
    switch (s.source) {
      case 'manual':
        return t('restore.source.manual', 'from a screen');
      case 'autoclean':
        return t('restore.source.autoclean', 'automatic cleanup, started by hand');
      case 'scheduled':
        return t('restore.source.scheduled', 'scheduled cleanup');
      case 'migrated':
        return t('restore.source.migrated', 'from the older record');
      case 'purge':
        return t('restore.source.purge', 'Recycle Bin purge');
      case 'restore':
        return t('restore.source.restore', 'moved aside for a file being put back');
      default:
        return s.source || '';
    }
  }

  /** "405 still in the Recycle Bin · 3 put back · …", leaving out the zeroes. */
  function tallyOf(s) {
    if (!s.tally) return '';
    const n = (count) => ({ n: formatCount(count) });
    const { inBin, restored, purged, gone, unavailable } = s.tally;
    return [
      inBin > 0 && t('restore.tally.inBin', '{n} still in the Recycle Bin', n(inBin)),
      restored > 0 && t('restore.tally.restored', '{n} put back', n(restored)),
      purged > 0 && t('restore.tally.purged', '{n} permanently removed by the app', n(purged)),
      gone > 0 && t('restore.tally.gone', '{n} no longer in the Recycle Bin', n(gone)),
      unavailable > 0 && t('restore.tally.unavailable', '{n} on a drive that is not connected', n(unavailable)),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  const STATE_WORD = {
    inBin: ['restore.state.inBin', 'in the bin'],
    restored: ['restore.state.restored', 'put back'],
    purged: ['restore.state.purged', 'purged'],
    gone: ['restore.state.gone', 'not in the bin'],
    unavailable: ['restore.state.unavailable', 'drive not connected'],
  };

  /** The sentence under a row: where this file is, and how the app knows. */
  function whereNow(row) {
    switch (row.state) {
      case 'inBin':
        return t('restore.row.inBin', 'Moved to the Recycle Bin {when} — the bin records the same moment', {
          when: formatAgo(row.trashedAt),
        });
      case 'restored': {
        // Windows paths compare without case; the path line above already
        // says where it is, so the sentence only names a path when it differs.
        const samePlace = row.to && row.to.toLowerCase() === row.path.toLowerCase();
        if (!row.stillThere) {
          return t('restore.row.restoredMoved', 'Put back {when}, and no longer at {path}', { when: formatAgo(row.at), path: row.to });
        }
        return samePlace
          ? t('restore.row.restoredHere', 'Put back {when}, to where it was', { when: formatAgo(row.at) })
          : t('restore.row.restored', 'Put back {when}, as {path}', { when: formatAgo(row.at), path: row.to });
      }
      case 'purged':
        return t('restore.row.purged', 'Removed from the Recycle Bin for good {when}, by the app’s purge — it cannot be put back', {
          when: formatAgo(row.at),
        });
      case 'unavailable':
        return t('restore.row.unavailable', 'The drive it was on is not connected, so where it is now cannot be checked');
      default:
        return row.existsAtOrigin
          ? t('restore.row.goneHere', 'No longer in the Recycle Bin, and there is a file at its old path — it may have been put back in Explorer')
          : t('restore.row.gone', 'No longer in the Recycle Bin — it was emptied, or taken out of it outside this app');
    }
  }

  function stateBadge(row) {
    const [key, english] = STATE_WORD[row.state] || STATE_WORD.gone;
    const el = document.createElement('span');
    // Neutral on purpose: green, amber and red mean verdicts in this app, and
    // where a file is now is not a verdict on it.
    el.className = 'badge badge-state';
    el.textContent = t(key, english);
    return el;
  }

  /* ---- the floating bar ------------------------------------------------------ */

  function selectedRows() {
    const out = [];
    for (const [id, paths] of view.selection) {
      for (const row of view.items.get(id) || []) if (paths.has(row.path)) out.push(row);
    }
    return out;
  }

  const bar = ActionBar({
    root: $('restore-actionbar'),
    readout: $('restore-selection'),
    buttons: { restore: $('restore-selected') },
    selected: selectedRows,
  });

  $('restore-selected').addEventListener('click', () => putBack(selectedRows().map((row) => row.id)));

  /* ---- drawing ---------------------------------------------------------------- */

  function rowsOf(items) {
    // `size` and `actions` are what the shared list and bar read.
    return items.map((item) => ({ ...item, actions: item.state === 'inBin' ? ['restore'] : [] }));
  }

  function renderItems(session, body) {
    const rows = view.items.get(session.id);
    body.replaceChildren();
    if (!rows) {
      const wait = document.createElement('p');
      wait.className = 'group-hint';
      wait.textContent = t('app.loading', 'Loading…');
      body.appendChild(wait);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'files';
    body.appendChild(list);
    view.lists.set(
      session.id,
      CandidateList(list, {
        rows,
        selection: selectionFor(session.id),
        onChange: () => bar.update(),
        meta: whereNow,
        badge: stateBadge,
        selectable: (row) => row.state === 'inBin',
        onOpen: (row) => {
          if (row.state === 'restored' && row.stillThere) openViewer(row.to);
        },
        rowActions: (row) => {
          if (row.state === 'restored' && row.stillThere) {
            return [
              linkButton(t('app.view', 'View'), () => openViewer(row.to), 'is-lead'),
              linkButton(t('app.reveal', 'Reveal'), () => api.reveal(row.to)),
            ];
          }
          if (row.state === 'gone' && row.existsAtOrigin) {
            return [linkButton(t('app.reveal', 'Reveal'), () => api.reveal(row.path))];
          }
          return [];
        },
      })
    );
  }

  function renderSession(session) {
    const section = document.createElement('section');
    section.className = 'group restore-session';
    section.dataset.session = session.id;
    section.dataset.kind = session.kind;

    const head = document.createElement('div');
    head.className = 'group-head restore-head';

    const title = document.createElement('div');
    title.className = 'restore-title';
    const strong = document.createElement('strong');
    strong.textContent = titleOf(session);
    const meta = document.createElement('span');
    meta.className = 'restore-meta';
    meta.textContent = [formatWhen(session.startedAt), sourceOf(session), formatBytes(session.bytes)].filter(Boolean).join(' · ');
    title.append(strong, meta);
    head.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'restore-actions';
    if (session.undoable && session.restorable.count > 0) {
      const all = document.createElement('button');
      all.className = 'btn btn-sm';
      all.dataset.restoreAll = session.id;
      all.textContent = t('restore.putBackAll', 'Put back all {n}', { n: formatCount(session.restorable.count) });
      all.addEventListener('click', async () => {
        const rows = await itemsOf(session.id);
        if (rows) putBack(rows.filter((row) => row.state === 'inBin').map((row) => row.id));
      });
      actions.appendChild(all);
    }
    if (session.undoable && session.count > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'group-select';
      toggle.dataset.restoreToggle = session.id;
      const isOpen = view.open.has(session.id);
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.textContent = isOpen ? t('restore.hideFiles', 'Hide files') : t('restore.showFiles', 'Show files');
      toggle.addEventListener('click', async () => {
        if (view.open.has(session.id)) view.open.delete(session.id);
        else {
          view.open.add(session.id);
          await itemsOf(session.id);
        }
        render();
      });
      actions.appendChild(toggle);
    }
    head.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'group-body';
    const notes = [];
    const tally = tallyOf(session);
    if (tally) notes.push(tally);
    if (!session.complete) {
      notes.push(t('restore.incomplete', 'This did not finish — the app stopped while it ran. What is listed is what it recorded before then.'));
    } else if (session.cancelled) {
      notes.push(t('restore.cancelled', 'Stopped part-way through; the rest was left where it was.'));
    }
    if (session.kind === 'purge') {
      notes.push(
        t('restore.purgeNote', 'A purge is permanent: these files cannot be put back. It freed {size}.', {
          size: formatBytes(session.freedOnSource),
        })
      );
    }
    for (const text of notes) {
      const p = document.createElement('p');
      p.className = 'group-hint restore-note';
      p.textContent = text;
      body.appendChild(p);
    }

    if (view.open.has(session.id)) {
      const files = document.createElement('div');
      files.className = 'restore-files';
      body.appendChild(files);
      renderItems(session, files);
    }
    // A card with nothing to add under its head is just the head: an empty
    // body would draw a band that means nothing.
    section.append(head);
    if (body.childElementCount > 0) section.append(body);
    else head.classList.add('is-alone');
    return section;
  }

  function render() {
    view.lists.clear();
    const sessions = view.sessions || [];
    $('restore-empty').hidden = sessions.length > 0 || view.sessions === null;
    host.replaceChildren(...sessions.map(renderSession));

    const restorable = sessions.reduce((n, s) => n + (s.undoable ? s.restorable.count : 0), 0);
    const bytes = sessions.reduce((n, s) => n + (s.undoable ? s.restorable.bytes : 0), 0);
    $('restore-status').textContent =
      view.sessions === null
        ? t('app.loading', 'Loading…')
        : t('restore.status', '{n} {sessions} · {count} {items} can be put back ({size})', {
            n: formatCount(sessions.length),
            sessions: word(sessions.length, 'restore.session', 'session', 'sessions'),
            count: formatCount(restorable),
            items: word(restorable, 'app.item', 'item', 'items'),
            size: formatBytes(bytes),
          });
    bar.update();
  }

  /* ---- data ------------------------------------------------------------------ */

  async function itemsOf(sessionId) {
    if (view.items.has(sessionId)) return view.items.get(sessionId);
    const items = unwrap(await api.journalItems(sessionId), t('app.tab.restore', 'Restore'));
    if (!items) return null;
    view.items.set(sessionId, rowsOf(items));
    return view.items.get(sessionId);
  }

  async function load() {
    if (view.loading) return;
    view.loading = true;
    try {
      const sessions = unwrap(await api.journalSessions(), t('app.tab.restore', 'Restore'));
      if (!sessions) return;
      view.sessions = sessions;
      // Everything is read again: a file somebody restored in Explorer since
      // the last look must not still be offered.
      view.items.clear();
      for (const id of view.open) await itemsOf(id);
      for (const [id, paths] of view.selection) {
        const rows = view.items.get(id) || [];
        const still = new Set(rows.filter((r) => r.state === 'inBin').map((r) => r.path));
        for (const p of [...paths]) if (!still.has(p)) paths.delete(p);
      }
      render();
    } finally {
      view.loading = false;
    }
  }

  /* ---- putting back --------------------------------------------------------- */

  async function putBack(ids) {
    if (!ids || ids.length === 0) return;
    progressPanel.show(t('restore.progressTitle', 'Putting back from the Recycle Bin'));
    let result;
    try {
      result = unwrap(await api.restore(ids), t('app.tab.restore', 'Restore'));
    } finally {
      progressPanel.hide();
    }
    if (!result) return;

    const moved = result.moved.length;
    if (result.cancelled && moved === 0) {
      toast(t('restore.cancelledNothing', 'Nothing was put back.'));
    } else if (moved > 0) {
      const skipped = result.failed.length;
      toast(
        t('restore.done', 'Put back {n} {items} ({size}) where they came from', {
          n: formatCount(moved),
          items: word(moved, 'app.item', 'item', 'items'),
          size: formatBytes(result.movedBytes),
        }) + (skipped ? ` · ${t('restore.skipped', '{n} could not be', { n: formatCount(skipped) })}` : '')
      );
    } else if (result.failed.length) {
      toast(t('restore.nothing', 'Nothing was put back. {reason}', { reason: result.failed[0].error }), true);
    }
    for (const paths of view.selection.values()) paths.clear();
    await load();
  }

  $('restore-refresh').addEventListener('click', load);

  // Read afresh each time the tab is opened, because the bin changes behind
  // the app's back.
  const tab = document.querySelector('.tab[data-tab="restore"]');
  if (tab) tab.addEventListener('click', load);

  onLanguageChange(render);

  // Exposed for the harnesses and for the rest of the window.
  window.restoreCenter = { load, putBack, view };
})();
