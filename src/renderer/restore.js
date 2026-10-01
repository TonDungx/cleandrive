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
 *
 * Above the cards, whether the journal is still as it was sealed (H4). The
 * check itself is never behind the licence either; the licence is read only
 * to say whether *new* sessions are being sealed, and when they are not, to
 * say why in words.
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
    integrity: null, // what `journal:verify` said, or { failed: true }
    audit: null, // the `biz.audit` entitlement: { allowed, reason }
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
      case 'quarantine':
        return s.drive
          ? t('restore.title.quarantine', 'Moved {n} {items} to {drive}', { n, items, drive: s.drive })
          : t('restore.title.quarantineAnywhere', 'Moved {n} {items} to another drive', { n, items });
      case 'archive':
        return t('restore.title.archive', 'Packed {n} {items} into an archive', { n, items });
      case 'hardlink':
        // Nothing moved and nothing was deleted, so the words have to carry
        // the whole meaning: what came back, and what putting it back does.
        return t('restore.title.hardlink', 'Joined {n} {items} into one file each', { n, items });
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
    const { inBin, inQuarantine, restored, purged, gone, unavailable } = s.tally;
    const zone = s.kind === 'quarantine';
    return [
      inBin > 0 && t('restore.tally.inBin', '{n} still in the Recycle Bin', n(inBin)),
      inQuarantine > 0 && t('restore.tally.inQuarantine', '{n} still in the quarantine folder', n(inQuarantine)),
      s.expired > 0 && t('restore.tally.expired', '{n} there longer than the days set in Settings', n(s.expired)),
      restored > 0 && t('restore.tally.restored', '{n} put back', n(restored)),
      purged > 0 && t('restore.tally.purged', '{n} permanently removed by the app', n(purged)),
      gone > 0 &&
        (zone
          ? t('restore.tally.goneZone', '{n} no longer in the quarantine folder', n(gone))
          : t('restore.tally.gone', '{n} no longer in the Recycle Bin', n(gone))),
      unavailable > 0 && t('restore.tally.unavailable', '{n} on a drive that is not connected', n(unavailable)),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  const STATE_WORD = {
    inBin: ['restore.state.inBin', 'in the bin'],
    inQuarantine: ['restore.state.inQuarantine', 'in quarantine'],
    goneZone: ['restore.state.goneZone', 'not in the folder'],
    inArchive: ['restore.state.inArchive', 'in an archive'],
    goneArchive: ['restore.state.goneArchive', 'archive not there'],
    restored: ['restore.state.restored', 'put back'],
    purged: ['restore.state.purged', 'purged'],
    gone: ['restore.state.gone', 'not in the bin'],
    unavailable: ['restore.state.unavailable', 'drive not connected'],
  };

  /** The sentence under a row: where this file is, and how the app knows. */
  function whereNow(row) {
    if (row.kind === 'archive') {
      if (row.state === 'inArchive') {
        return t('restore.row.inArchive', 'Packed into {path} {when}, and every file checked against it', {
          path: row.stored,
          when: formatAgo(row.trashedAt),
        });
      }
      if (row.state === 'unavailable') {
        return t('restore.row.unavailableArchive', 'The drive the archive is on is not connected, so it cannot be read');
      }
      if (row.state === 'gone') {
        return t('restore.row.goneArchive', 'The archive is no longer there, or can no longer be opened — nothing can be put back from it');
      }
    }
    if (row.kind === 'quarantine') {
      if (row.state === 'inQuarantine') {
        const at = t('restore.row.inQuarantine', 'Copied to {path} {when}, and the copy checked against it', {
          path: row.stored,
          when: formatAgo(row.trashedAt),
        });
        return row.expired ? `${at} · ${t('restore.row.expired', 'there longer than the days set in Settings')}` : at;
      }
      if (row.state === 'unavailable') {
        return t('restore.row.unavailableZone', 'The drive the quarantine folder is on is not connected, so the copy cannot be checked');
      }
      if (row.state === 'gone') {
        return t('restore.row.goneZone', 'No longer in the quarantine folder — it was removed outside this app');
      }
    }
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
    // "Gone" means somewhere different for each kind, and the badge is the
    // one place a person reads before anything else.
    const GONE = { quarantine: 'goneZone', archive: 'goneArchive' };
    const state = row.state === 'gone' && GONE[row.kind] ? GONE[row.kind] : row.state;
    const [key, english] = STATE_WORD[state] || STATE_WORD.gone;
    const el = document.createElement('span');
    // Neutral on purpose: green, amber and red mean verdicts in this app, and
    // where a file is now is not a verdict on it.
    el.className = 'badge badge-state';
    el.textContent = t(key, english);
    return el;
  }

  /* ---- the seal (H4) ----------------------------------------------------------- */

  /** Whether there is anything to say about seals: sealing is on, or once was. */
  function sealsInPlay() {
    const report = view.integrity;
    if (!report || report.failed) return false;
    return Boolean(view.audit && view.audit.allowed) || report.seals.count > 0 || report.counts.altered > 0;
  }

  function sealStateOf(session) {
    const s = view.integrity && view.integrity.sessions ? view.integrity.sessions[session.id] : null;
    return s ? s.state : null;
  }

  function sealBadge(session) {
    const state = sealStateOf(session);
    if (!state || !sealsInPlay()) return null;
    const el = document.createElement('span');
    // Neutral like the state badges: a changed record is a fact about the
    // journal, not a verdict on any file in it. The words carry the weight.
    el.className = 'badge badge-state badge-seal';
    el.dataset.seal = state === 'sealed' || state === 'altered' ? state : 'unsealed';
    el.textContent =
      state === 'sealed'
        ? t('restore.seal.state.sealed', 'Sealed')
        : state === 'altered'
          ? t('restore.seal.state.altered', 'Changed after sealing')
          : t('restore.seal.state.unsealed', 'Not sealed');
    return el;
  }

  /** One sentence per thing the check found wrong with a session. */
  function problemText(p) {
    const at = { line: formatCount(p.line), file: p.file };
    switch (p.what) {
      case 'modified':
        return t('restore.seal.problem.modified', 'Line {line} of the journal file {file} was changed after it was sealed.', at);
      case 'deleted':
        return t('restore.seal.problem.deleted', 'A line was removed just before line {line} of the journal file {file}.', at);
      case 'inserted':
        return t('restore.seal.problem.inserted', 'Line {line} of the journal file {file} was added after the session was sealed.', at);
      case 'signature':
        return t('restore.seal.problem.signature', 'The seal on line {line} of the journal file {file} no longer matches what it covers.', at);
      case 'unknownKey':
        return t('restore.seal.problem.unknownKey', 'The seal on line {line} of the journal file {file} was made with a key this computer does not have.', at);
      case 'count':
        return t('restore.seal.problem.count', 'The seal on line {line} of the journal file {file} counts a different number of lines.', at);
      default:
        return t('restore.seal.problem.changed', 'The line before line {line} of the journal file {file} was changed or removed.', at);
    }
  }

  const PROBLEMS_SHOWN = 5;

  function sealNotes(session) {
    const s = view.integrity && view.integrity.sessions ? view.integrity.sessions[session.id] : null;
    if (!s || s.state !== 'altered') return [];
    const lines = s.problems.slice(0, PROBLEMS_SHOWN).map(problemText);
    if (s.problems.length > PROBLEMS_SHOWN) {
      lines.push(t('restore.seal.problem.more', 'And {n} more.', { n: formatCount(s.problems.length - PROBLEMS_SHOWN) }));
    }
    return lines;
  }

  /** The refusal, when the licence does not seal: said, never left out. */
  function refusalText() {
    const lapsed = view.audit && view.audit.reason === 'expired';
    const report = view.integrity;
    const anySealed = report && !report.failed && (report.seals.count > 0 || report.counts.altered > 0);
    if (lapsed) {
      return anySealed
        ? t('restore.seal.expired', 'The Business licence has lapsed, so new sessions are not sealed. Those sealed before it lapsed are still checked.')
        : t('restore.seal.expiredNone', 'The Business licence has lapsed, so sessions are not sealed.');
    }
    return anySealed
      ? t('restore.seal.stopped', 'New sessions are not sealed: sealing the journal is part of CleanDrive Business. Those sealed before are still checked.')
      : t('restore.seal.needsBusiness', 'Sealing the journal is part of CleanDrive Business: each session is signed with a key kept on this computer, so a line changed, removed or added afterwards can be found. Sessions are not sealed now.');
  }

  function headline(report) {
    const sessions = (n) => word(n, 'restore.session', 'session', 'sessions');
    const { counts } = report;
    const unsealed = counts.unsealed + counts.legacy + counts.incomplete;
    const first =
      counts.altered > 0
        ? t('restore.seal.altered', 'Changed after sealing: {n} {sessions}', { n: formatCount(counts.altered), sessions: sessions(counts.altered) })
        : counts.sealed > 0
          ? t('restore.seal.allGood', 'Sealed: {n} {sessions}, none changed since', { n: formatCount(counts.sealed), sessions: sessions(counts.sealed) })
          : t('restore.seal.noneYet', 'Each session is sealed as it finishes. None has finished since sealing began.');
    const rest = [
      counts.altered > 0 && counts.sealed > 0 && t('restore.seal.alsoSealed', '{n} still as sealed', { n: formatCount(counts.sealed) }),
      unsealed > 0 && t('restore.seal.unsealed', '{n} not sealed', { n: formatCount(unsealed) }),
      report.missingCount > 0 &&
        t('restore.seal.missing', 'sealed sessions no longer in the journal: {n}', { n: formatCount(report.missingCount) }),
      report.oldestMissing &&
        t('restore.seal.oldestMissing', 'older sealed sessions no longer in the journal, with no record of the app removing them: {n}', {
          n: formatCount(report.oldestMissing.count),
        }),
      report.duplicates.length > 0 && t('restore.seal.duplicate', 'two seals carry the same number'),
      report.unreadable.length > 0 && t('restore.seal.unreadable', 'lines that could not be read: {n}', { n: formatCount(report.unreadable.length) }),
    ].filter(Boolean);
    return [first, ...rest];
  }

  function failureText(code) {
    switch (code) {
      case 'key':
        return t('restore.seal.failure.key', 'The last session in this window could not be sealed: the key could not be opened. PowerShell may be blocked on this computer.');
      case 'busy':
        return t('restore.seal.failure.busy', 'The last session in this window could not be sealed: another CleanDrive process held the journal for too long.');
      default:
        return t('restore.seal.failure.other', 'The last session in this window could not be sealed.');
    }
  }

  /** The block above the cards, as paragraphs: `[text, className]`. */
  function integrityParagraphs() {
    const report = view.integrity;
    if (!report) return [];
    if (report.failed) return [[t('restore.seal.checkFailed', 'The journal could not be checked just now.'), 'restore-integrity-head']];
    const sealing = Boolean(view.audit && view.audit.allowed);
    if (!sealsInPlay()) return view.audit ? [[refusalText(), 'upgrade-hint']] : [];
    const out = [[headline(report), 'restore-integrity-head']];
    if (report.sealFailure && sealing) out.push([failureText(report.sealFailure), 'restore-integrity-note']);
    if (!sealing) out.push([refusalText(), 'restore-integrity-note']);
    if (report.keys.currentShort) {
      out.push([t('restore.seal.key', 'This computer’s key: {fingerprint}', { fingerprint: report.keys.currentShort }), 'restore-integrity-note']);
    }
    out.push([
      t('restore.seal.limit', 'A seal shows that a session was changed. It cannot stop someone signed in to this computer from deleting the journal, or from rewriting it and signing it again.'),
      'restore-integrity-note',
    ]);
    return out;
  }

  function renderIntegrity() {
    const box = $('restore-integrity');
    if (!box) return;
    const paragraphs = integrityParagraphs();
    box.hidden = paragraphs.length === 0;
    box.replaceChildren(
      ...paragraphs.map(([text, className]) => {
        const p = document.createElement('p');
        p.className = className;
        if (Array.isArray(text)) {
          // One block per fact, so a narrow window breaks between facts and
          // never between a number and what it counts.
          text.forEach((fact, i) => {
            if (i > 0) p.append(' · ');
            const span = document.createElement('span');
            span.className = 'restore-integrity-fact';
            span.textContent = fact;
            p.append(span);
          });
        } else {
          p.textContent = text;
        }
        return p;
      })
    );
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

  /** In the Recycle Bin, or in a quarantine folder on another drive (B1). */
  const canPutBack = (row) => row.state === 'inBin' || row.state === 'inQuarantine';

  function rowsOf(items, kind) {
    // `size` and `actions` are what the shared list and bar read.
    return items.map((item) => ({ ...item, kind, actions: canPutBack(item) ? ['restore'] : [] }));
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
        selectable: canPutBack,
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
          if (row.state === 'inQuarantine' && row.stored) {
            return [linkButton(t('app.reveal', 'Reveal'), () => api.reveal(row.stored))];
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
    const seal = sealBadge(session);
    if (seal) title.appendChild(seal);
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
        if (rows) putBack(rows.filter(canPutBack).map((row) => row.id));
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
    if (session.kind === 'quarantine') {
      notes.push(
        session.freedOnSource > 0
          ? t('restore.quarantineDeleted', 'The originals were deleted once their copies were checked, freeing {size}. Putting back copies each one back and checks it.', {
              size: formatBytes(session.freedOnSource),
            })
          : t('restore.quarantineNote', 'The originals went to the Recycle Bin. Putting back copies each file back from the quarantine folder and checks it; an original still in the bin stays there.')
      );
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
    for (const text of sealNotes(session)) {
      const p = document.createElement('p');
      p.className = 'group-hint restore-note restore-seal-note';
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
    renderIntegrity();
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
    const session = (view.sessions || []).find((s) => s.id === sessionId);
    view.items.set(sessionId, rowsOf(items, session ? session.kind : null));
    return view.items.get(sessionId);
  }

  async function load() {
    if (view.loading) return;
    view.loading = true;
    try {
      /*
       * The sessions and the open sessions' items, asked for together.
       *
       * Each of these asks the disk where every item is *now* -- the Recycle
       * Bin's own metadata, the quarantine folder, the original's location --
       * and measured on this machine that is around seven seconds each. Asking
       * for the list, waiting, and only then asking for the items of the one
       * section that happens to be open made reopening the tab a fifteen-second
       * wait during which it showed the previous list with nothing saying why.
       * Nothing in the second call depends on the first: the ids are already
       * known, and the session's kind is only needed to shape the rows once
       * both have arrived.
       */
      const openIds = [...view.open];
      const [sessionsEnvelope, verifyEnvelope, rights, ...itemEnvelopes] = await Promise.all([
        api.journalSessions(),
        api.journalVerify(),
        loadEntitlements(),
        ...openIds.map((id) => api.journalItems(id)),
      ]);

      const sessions = unwrap(sessionsEnvelope, t('app.tab.restore', 'Restore'));
      if (!sessions) return;
      view.sessions = sessions;
      // A check that could not run is said above the cards rather than in a
      // toast: it must not stand in the way of putting anything back.
      view.integrity = verifyEnvelope && verifyEnvelope.ok ? verifyEnvelope.data : { failed: true };
      view.audit = rights.get('biz.audit') || null;
      // Everything is read again: a file somebody restored in Explorer since
      // the last look must not still be offered.
      view.items.clear();
      openIds.forEach((id, i) => {
        const items = unwrap(itemEnvelopes[i], t('app.tab.restore', 'Restore'));
        if (!items) return;
        const session = sessions.find((s) => s.id === id);
        view.items.set(id, rowsOf(items, session ? session.kind : null));
      });
      for (const [id, paths] of view.selection) {
        const rows = view.items.get(id) || [];
        const still = new Set(rows.filter(canPutBack).map((r) => r.path));
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
