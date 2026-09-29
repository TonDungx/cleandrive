'use strict';

/**
 * The Chat screen (D3): what Zalo and Telegram Desktop have downloaded, and --
 * for Zalo -- which conversation each piece of it came from.
 *
 * Three levels, in the order the roadmap sets them out and in the order they
 * stop being possible: by type, by month, by conversation. The third exists
 * for one app, and the screen says so in words rather than showing Telegram an
 * empty list.
 *
 * ## A conversation is a number here, and that is the point
 *
 * Its name is in the message database, and the app does not open message
 * databases. Rather than hide that behind a prettier label, every conversation
 * row says the id is what there is and why.
 *
 * ## Selection is per kind, not per file
 *
 * Nobody picks through 5,868 photographs. What somebody does decide is "the
 * videos in this group chat can go, the photographs stay", so a tick is on a
 * (conversation, kind) pair and the paths are gathered from the file rows
 * underneath it. The file rows are candidates like any other -- the folder
 * rows carry no action at all, because `recycle` and `quarantine` both refuse
 * a directory.
 *
 * ## Zalo keeps photographs twice, and the smaller copy is the unreadable one
 *
 * Measured: 2,195 pictures on this machine exist both as Zalo received them
 * and re-encoded as JPEG XL, and nothing here can display the JPEG XL -- not
 * the Windows shell, not Chromium 130. So the screen reports the pairing as a
 * fact and does not offer to "remove the duplicate", which would point at the
 * only copy anything can open.
 */
(() => {
  const host = $('chat-conversations');
  if (!host) return;

  const view = {
    result: null,
    running: false,
    open: new Set(),
    /** Ticked `<rowId>|<kind>` pairs. */
    picked: new Set(),
    expanded: new Set(),
  };

  const PHASES = {
    finding: () => t('chat.phase.finding', 'Looking for chat apps…'),
    zalo: () => t('chat.phase.zalo', 'Reading what Zalo has downloaded…'),
    conversations: (p) => t('chat.phase.conversations', 'Conversation {done} of {total}…', {
      done: formatCount(p.done), total: formatCount(p.total),
    }),
    telegram: () => t('chat.phase.telegram', 'Reading what Telegram Desktop keeps…'),
  };

  const APP_NAMES = { zalo: 'Zalo', telegram: 'Telegram Desktop' };
  const pick = (rowId, kind) => `${rowId}|${kind}`;

  /** An `{i18n, en, params}` message, in whichever language is on. */
  const say = (message) => (message ? tm(message) : '');

  /* ---- what is picked ------------------------------------------------------ */

  /** Every file row, grouped by the folder row and kind it belongs to. */
  function filesByPick(result) {
    const out = new Map();
    for (const candidate of result.candidates || []) {
      if (candidate.category !== 'chat.file') continue;
      const key = pick(candidate.meta.owner, candidate.meta.kind);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(candidate);
    }
    return out;
  }

  function pickedFiles() {
    if (!view.result) return [];
    const index = filesByPick(view.result);
    const out = [];
    for (const key of view.picked) out.push(...(index.get(key) || []));
    return out;
  }

  /* ---- one folder row ------------------------------------------------------ */

  function cell(className, text, title) {
    const el = document.createElement('span');
    el.className = className;
    el.setAttribute('role', 'cell');
    el.textContent = text;
    if (title) el.title = title;
    return el;
  }

  function evidenceRowFor(row) {
    const panel = document.createElement('div');
    panel.className = 'chat-evidence-row';
    panel.setAttribute('role', 'row');
    const inner = document.createElement('div');
    inner.className = 'chat-evidence-cell';
    inner.setAttribute('role', 'cell');
    inner.appendChild(EvidencePanel(row));
    panel.appendChild(inner);
    return panel;
  }

  function badgeFor(row) {
    const pill = evidencePill(row);
    pill.setAttribute('aria-expanded', String(view.open.has(row.id)));
    pill.addEventListener('click', () => {
      if (view.open.has(row.id)) view.open.delete(row.id);
      else view.open.add(row.id);
      render_();
    });
    return pill;
  }

  /**
   * The chips under a conversation: one per kind, each its own tick.
   *
   * A chip is only tickable when the row has an action at all -- with the app
   * open every row is `keep` and nothing is offered, which is the same rule
   * the known-app caches and the Steam leftovers use.
   */
  function kindChips(row, actionable) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-kind-chips';

    for (const entry of row.byKind || []) {
      const key = pick(row.id, entry.kind);
      const chip = document.createElement(actionable ? 'button' : 'span');
      chip.className = 'chat-chip';
      if (actionable) {
        chip.type = 'button';
        chip.setAttribute('aria-pressed', String(view.picked.has(key)));
        chip.classList.toggle('is-picked', view.picked.has(key));
        chip.addEventListener('click', () => {
          if (view.picked.has(key)) view.picked.delete(key);
          else view.picked.add(key);
          render_();
        });
      }
      const label = document.createElement('span');
      label.className = 'chat-chip-label';
      label.textContent = say(entry.label);
      const size = document.createElement('span');
      size.className = 'chat-chip-size';
      size.textContent = `${formatBytes(entry.bytes)} · ${formatCount(entry.files)}`;
      chip.append(label, size);
      wrap.appendChild(chip);
    }
    return wrap;
  }

  function renderConversation(row, actionable) {
    const el = document.createElement('div');
    el.className = 'chat-row';
    el.setAttribute('role', 'row');

    const name = document.createElement('span');
    name.className = 'chat-col-name';
    name.setAttribute('role', 'cell');

    const title = document.createElement('strong');
    title.className = 'chat-name';
    title.textContent = row.conversationId;
    title.title = row.path;

    const sub = document.createElement('span');
    sub.className = 'chat-sub';
    sub.textContent = row.group
      ? t('chat.groupChat', 'Group chat · {n} files', { n: formatCount(row.files) })
      : t('chat.directChat', 'One-to-one · {n} files', { n: formatCount(row.files) });
    name.append(title, sub);
    el.appendChild(name);

    el.appendChild(cell('chat-col-size', formatBytes(row.size)));

    const when = row.latest
      ? formatAgo(row.latest)
      : t('chat.noDate', 'no date');
    el.appendChild(cell('chat-col-when', when, row.earliest && row.latest
      ? t('chat.span', 'From {first} to {last}', {
        first: new Date(row.earliest).toLocaleDateString(uiLocale()),
        last: new Date(row.latest).toLocaleDateString(uiLocale()),
      })
      : ''));

    const badge = document.createElement('span');
    badge.className = 'chat-col-badge';
    badge.setAttribute('role', 'cell');
    badge.appendChild(badgeFor(row));
    el.appendChild(badge);

    const actions = document.createElement('span');
    actions.className = 'chat-col-actions';
    actions.setAttribute('role', 'cell');
    const expand = document.createElement('button');
    expand.className = 'btn btn-sm btn-quiet';
    expand.setAttribute('aria-expanded', String(view.expanded.has(row.id)));
    expand.textContent = view.expanded.has(row.id)
      ? t('chat.hideKinds', 'Hide what is in it')
      : t('chat.showKinds', 'What is in it');
    expand.addEventListener('click', () => {
      if (view.expanded.has(row.id)) view.expanded.delete(row.id);
      else view.expanded.add(row.id);
      render_();
    });
    actions.appendChild(expand);

    const reveal = document.createElement('button');
    reveal.className = 'btn btn-sm btn-quiet';
    reveal.textContent = t('chat.reveal', 'Open folder');
    reveal.addEventListener('click', () => api.reveal(row.path));
    actions.appendChild(reveal);
    el.appendChild(actions);

    return el;
  }

  function renderSharedRow(row, actionable, manyAccounts) {
    const el = document.createElement('div');
    el.className = 'chat-shared-row';

    const name = document.createElement('span');
    name.className = 'chat-shared-name';
    const strong = document.createElement('strong');
    strong.textContent = say(row.label) || row.kind;
    const sub = document.createElement('span');
    sub.className = 'chat-sub';
    // The account id only earns its place when there is more than one to tell
    // apart. With a single Zalo account it is eighteen digits of noise on
    // every row; with two Telegram accounts it is the only thing separating
    // two rows that otherwise read the same.
    sub.textContent = `${APP_NAMES[row.app] || row.app}${row.account && manyAccounts ? ` · ${row.account}` : ''}`;
    name.append(strong, sub);

    const size = document.createElement('span');
    size.className = 'chat-shared-size';
    size.textContent = `${formatBytes(row.size)} · ${formatCount(row.files)}`;

    el.append(name, size);

    if (actionable && row.category !== 'chat.update') {
      const key = pick(row.id, row.kind);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chat-chip';
      chip.setAttribute('aria-pressed', String(view.picked.has(key)));
      chip.classList.toggle('is-picked', view.picked.has(key));
      chip.textContent = view.picked.has(key) ? t('chat.picked', 'Selected') : t('chat.picking', 'Select');
      chip.addEventListener('click', () => {
        if (view.picked.has(key)) view.picked.delete(key);
        else view.picked.add(key);
        render_();
      });
      el.appendChild(chip);
    }

    // The staged Telegram update gets its own control, because deleting it is
    // the one thing on this screen that costs a download rather than saving
    // one. It is selected the same way but the word on the button says so.
    if (actionable && row.category === 'chat.update') {
      const key = pick(row.id, 'update');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chat-chip chat-chip-warn';
      chip.setAttribute('aria-pressed', String(view.picked.has(key)));
      chip.classList.toggle('is-picked', view.picked.has(key));
      chip.textContent = view.picked.has(key)
        ? t('chat.update.picked', 'Selected — it will download again')
        : t('chat.update.pick', 'Select anyway');
      chip.addEventListener('click', () => {
        if (view.picked.has(key)) view.picked.delete(key);
        else view.picked.add(key);
        render_();
      });
      el.appendChild(chip);
    }

    el.appendChild(badgeFor(row));
    return el;
  }

  /* ---- level 1: by type ---------------------------------------------------- */

  function renderKinds(summary) {
    const card = $('chat-kinds-card');
    const rows = [];
    for (const app of ['zalo', 'telegram']) {
      const model = summary[app];
      if (!model || !model.installed) continue;
      const head = document.createElement('div');
      head.className = 'chat-kind-head';
      const strong = document.createElement('strong');
      strong.textContent = APP_NAMES[app];
      const total = document.createElement('span');
      total.className = 'chat-sub';
      total.textContent = t('chat.appTotal', '{size} in {n} files', {
        size: formatBytes(model.bytes), n: formatCount(model.files),
      });
      head.append(strong, total);
      rows.push(head);

      const widest = Math.max(1, ...model.byKind.map((k) => k.bytes));
      for (const entry of model.byKind) {
        const bar = document.createElement('div');
        bar.className = 'chat-bar';
        const label = document.createElement('span');
        label.className = 'chat-bar-label';
        label.textContent = KIND_WORDS[entry.kind] ? KIND_WORDS[entry.kind]() : entry.kind;
        const track = document.createElement('span');
        track.className = 'chat-bar-track';
        const fill = document.createElement('span');
        fill.className = 'chat-bar-fill';
        fill.style.width = `${Math.max(2, Math.round((entry.bytes / widest) * 100))}%`;
        track.appendChild(fill);
        const size = document.createElement('span');
        size.className = 'chat-bar-size';
        size.textContent = `${formatBytes(entry.bytes)} · ${formatCount(entry.files)}`;
        bar.append(label, track, size);
        rows.push(bar);
      }
    }
    card.hidden = rows.length === 0;
    replaceChildrenIfChanged($('chat-kinds'), rows);
  }

  /**
   * The plain words for Zalo's folder names.
   *
   * Kept beside the ones in `analyzers/chat.js` rather than shipped down with
   * every row: these label the totals, which have no candidate behind them.
   * Several of Zalo's names mislead outright -- `Cache` holds original
   * photographs and `fileNoise` holds documents -- so leaving them as they are
   * would be a wrong guess on screen.
   */
  const KIND_WORDS = {
    picture: () => t('chat.kind.picture', 'Photos, re-encoded by Zalo'),
    Cache: () => t('chat.kind.cache', 'Photos as they arrived'),
    video: () => t('chat.kind.video', 'Videos'),
    voice: () => t('chat.kind.voice', 'Voice messages'),
    file: () => t('chat.kind.file', 'Files people sent'),
    fileNoise: () => t('chat.kind.fileNoise', 'Files, kept in a form only Zalo reads'),
    fileThumb: () => t('chat.kind.fileThumb', 'File thumbnails'),
    richThumb: () => t('chat.kind.richThumb', 'Link previews'),
    zinstant: () => t('chat.kind.zinstant', 'Interface pieces Zalo downloaded'),
    sticker: () => t('chat.kind.sticker', 'Stickers'),
    cache: () => t('chat.kind.tgCache', 'Anything Telegram cached'),
    media_cache: () => t('chat.kind.tgMediaCache', 'Pictures and video Telegram cached'),
    update: () => t('chat.kind.update', 'A downloaded update'),
  };

  /* ---- level 2: by month --------------------------------------------------- */

  function renderMonths(summary) {
    const card = $('chat-months-card');
    const months = (summary.zalo.histogram.months || []).slice(-24);
    if (months.length === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const h = summary.zalo.histogram;
    setText($('chat-months-what'), h.fromNames >= h.totalFiles
      ? t('chat.months.fromNames', 'Zalo puts the time a message was sent into the file name, so this is when each of these arrived in the conversation rather than when this computer wrote the file.')
      : t('chat.months.mixed', '{n} of {total} of these carry the time they were sent in their name; the rest are placed by when this computer wrote the file.', {
        n: formatCount(h.fromNames), total: formatCount(h.totalFiles),
      }));

    const widest = Math.max(1, ...months.map((m) => m.bytes));
    const nodes = months.map((entry) => {
      const col = document.createElement('div');
      col.className = 'chat-month';
      col.title = t('chat.month.what', '{month}: {size} in {n} files', {
        month: entry.month, size: formatBytes(entry.bytes), n: formatCount(entry.files),
      });
      const bar = document.createElement('span');
      bar.className = 'chat-month-bar';
      bar.style.height = `${Math.max(3, Math.round((entry.bytes / widest) * 100))}%`;
      const label = document.createElement('span');
      label.className = 'chat-month-label';
      label.textContent = entry.month.slice(2);
      col.append(bar, label);
      return col;
    });
    replaceChildrenIfChanged($('chat-months'), nodes);

    // The other half of level 2. It is here rather than left in the payload
    // because a number measured, sent to the window and drawn nowhere is the
    // exact shape of the dead feature `npm run test:dead` exists to catch.
    const biggest = [...(summary.zalo.histogram.biggest || []), ...(summary.telegram.histogram.biggest || [])]
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);
    replaceChildrenIfChanged($('chat-biggest'), biggest.map((file) => {
      const row = document.createElement('div');
      row.className = 'chat-biggest-row';

      const name = document.createElement('span');
      name.className = 'chat-biggest-name';
      // Zalo's file names are three ids and a timestamp, which is unreadable
      // and also the only name there is. The kind is what makes the row mean
      // something, so it leads and the name follows as the detail.
      name.textContent = KIND_WORDS[file.kind] ? KIND_WORDS[file.kind]() : file.kind;
      name.title = file.path;

      const when = document.createElement('span');
      when.className = 'chat-biggest-when';
      when.textContent = Number.isFinite(file.when) && file.when > 0
        ? new Date(file.when).toLocaleDateString(uiLocale())
        : t('chat.noDate', 'no date');

      const size = document.createElement('span');
      size.className = 'chat-biggest-size';
      size.textContent = formatBytes(file.size);

      row.append(name, when, size);
      return row;
    }));
  }

  /* ---- the screen ---------------------------------------------------------- */

  function renderNotes(summary) {
    const notes = [];
    if (summary.cancelled) notes.push(t('chat.note.cancelled', 'The scan was stopped part-way.'));

    const running = summary.running;
    if (running === null) {
      notes.push(t('chat.note.processUnknown', 'Whether these apps are running could not be checked, so nothing here is offered for removal.'));
    } else {
      const open = ['zalo', 'telegram'].filter((app) => running[app] && summary[app].installed);
      if (open.length) {
        notes.push(t('chat.note.appOpen', '{apps} is open, so nothing it owns is offered for removal. Close it and scan again.', {
          apps: open.map((app) => APP_NAMES[app]).join(', '),
        }));
      }
    }

    notes.push(t('chat.note.noDatabase', 'No message database is opened and no message is read. That is why a conversation is shown by its id: the name for it is inside the database.'));

    if (summary.telegram.installed) {
      notes.push(t('chat.note.telegramFlat', 'Telegram Desktop names nothing after a conversation — its caches are addressed by content — so it appears above by type and by month only.'));
    }

    const paired = (summary.zalo.conversations || 0);
    if (summary.pairedCount > 0) {
      notes.push(t('chat.note.paired', 'Zalo keeps {n} of these photos twice: once as it received them and once re-encoded. Only the copy as received can be opened by anything on this computer, so the smaller one is not the one to remove.', {
        n: formatCount(summary.pairedCount),
      }));
    }

    const note = $('chat-note');
    note.hidden = notes.length === 0;
    replaceChildrenIfChanged(note, notes.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
  }

  function renderHead() {
    const head = document.createElement('div');
    head.className = 'chat-row chat-head';
    head.setAttribute('role', 'row');
    for (const [className, label, title] of [
      ['chat-col-name', t('chat.col.name', 'Conversation'), t('chat.col.name.what', 'Zalo’s own id for it. The name is in the message database, which this app does not open.')],
      ['chat-col-size', t('chat.col.size', 'Downloaded'), null],
      ['chat-col-when', t('chat.col.when', 'Last arrival'), null],
      ['chat-col-badge', '', null],
      ['chat-col-actions', '', null],
    ]) {
      const el = cell(`${className} chat-headcell`, label, title);
      el.setAttribute('role', 'columnheader');
      head.appendChild(el);
    }
    return head;
  }

  function actionableFor(summary, app) {
    return summary.running !== null && summary.running[app] === false;
  }

  function render_() {
    $('chat-scan').disabled = view.running;
    $('chat-cancel').hidden = !view.running;
    $('chat-progress').hidden = !view.running;

    const result = view.result;
    if (!result || !result.summary) {
      for (const id of ['chat-stats', 'chat-note', 'chat-kinds-card', 'chat-months-card', 'chat-conversations-card', 'chat-shared-card']) {
        $(id).hidden = true;
      }
      $('chat-delete').hidden = true;
      $('chat-quarantine').hidden = true;
      host.replaceChildren();
      if (!view.running) {
        setText($('chat-status'), result && result.locked
          ? t('chat.needsPro', 'Chat app data is part of Pro.')
          : result && result.apps && !result.apps.zalo.installed && !result.apps.telegram.installed
            ? t('chat.noApps', 'Neither Zalo nor Telegram Desktop was found on this computer.')
            : t('chat.ready', 'Measures what Zalo and Telegram Desktop have downloaded onto this computer, and — for Zalo — which conversation each piece came from. No message is read.'));
      }
      return;
    }

    const { summary } = result;
    const byId = indexCandidates(result.candidates);
    const conversations = viewsOf(summary.rows.conversations, byId);
    const shared = viewsOf(summary.rows.shared, byId);
    const updates = viewsOf(summary.rows.updates, byId);

    summary.pairedCount = conversations.reduce((sum, row) => sum + (row.pairedCount || 0), 0);

    const picked = pickedFiles();
    const pickedBytes = picked.reduce((sum, c) => sum + c.bytes, 0);

    $('chat-stats').hidden = false;
    setText($('cstat-size'), formatBytes(summary.zalo.bytes + summary.telegram.bytes));
    setText($('cstat-conversations'), formatCount(conversations.length));
    setText($('cstat-twice'), formatCount(summary.pairedCount));
    setText($('cstat-selected'), picked.length === 0 ? '–' : formatBytes(pickedBytes));

    $('chat-delete').hidden = picked.length === 0;
    $('chat-quarantine').hidden = picked.length === 0;
    setText($('chat-delete'), t('chat.deleteN', 'Move {n} selected to Recycle Bin', { n: formatCount(picked.length) }));
    setText($('chat-quarantine'), t('chat.quarantine', 'Set aside instead…'));

    renderNotes(summary);
    renderKinds(summary);
    renderMonths(summary);

    /* -- by conversation --------------------------------------------------- */

    const convCard = $('chat-conversations-card');
    convCard.hidden = conversations.length === 0;
    if (conversations.length > 0) {
      setText($('chat-conversations-what'), t('chat.conversations.what', '{n} conversations, {size}. Only Zalo’s downloads are split this way, and only because the conversation’s id is in the folder name and in every file name.', {
        n: formatCount(conversations.length),
        size: formatBytes(conversations.reduce((sum, row) => sum + row.size, 0)),
      }));

      const actionable = actionableFor(summary, 'zalo');
      const nodes = [renderHead()];
      for (const row of [...conversations].sort((a, b) => b.size - a.size)) {
        nodes.push(renderConversation(row, actionable));
        if (view.expanded.has(row.id)) {
          const chips = document.createElement('div');
          chips.className = 'chat-chips-row';
          chips.appendChild(kindChips(row, actionable));
          nodes.push(chips);
        }
        if (view.open.has(row.id)) nodes.push(evidenceRowFor(row));
      }
      replaceChildrenIfChanged(host, nodes);
    } else {
      host.replaceChildren();
    }

    /* -- everything else ---------------------------------------------------- */

    const rest = [...shared, ...updates].sort((a, b) => b.size - a.size);
    const sharedCard = $('chat-shared-card');
    sharedCard.hidden = rest.length === 0;
    if (rest.length > 0) {
      setText($('chat-shared-what'), t('chat.shared.what', '{size} that no conversation can be attached to: one app-wide folder per kind, both Telegram accounts’ caches, and anything an update left unpacked.', {
        size: formatBytes(rest.reduce((sum, row) => sum + row.size, 0)),
      }));
      const manyAccounts = {
        zalo: (summary.zalo.accounts || []).length > 1,
        telegram: (summary.telegram.accounts || []).length > 1,
      };
      const nodes = [];
      for (const row of rest) {
        nodes.push(renderSharedRow(row, actionableFor(summary, row.app), manyAccounts[row.app]));
        if (view.open.has(row.id)) nodes.push(evidenceRowFor(row));
      }
      replaceChildrenIfChanged($('chat-shared'), nodes);
    }

    if (!view.running) {
      setText($('chat-status'), t('chat.done', '{size} downloaded by chat apps, in {time}.', {
        size: formatBytes(summary.zalo.bytes + summary.telegram.bytes),
        time: formatSeconds(summary.durationMs),
      }));
    }
  }

  /* ---- acting -------------------------------------------------------------- */

  const onChatAction = (kind) => async () => {
    const picked = pickedFiles();
    if (picked.length === 0) return;
    await deleteSelected(picked.map((c) => c.path), (moved) => {
      const gone = new Set(moved.map((m) => m.path));
      if (view.result) {
        view.result.candidates = view.result.candidates.filter((c) => !gone.has(c.path));
      }
      view.picked.clear();
      render_();
    }, { context: 'chat', kind });
  };

  $('chat-delete').addEventListener('click', onChatAction('recycle'));
  $('chat-quarantine').addEventListener('click', onChatAction('quarantine'));

  api.onChatProgress((p) => {
    if (PHASES[p.phase]) setText($('chat-status'), PHASES[p.phase](p));
  });

  async function run() {
    view.running = true;
    view.open.clear();
    view.picked.clear();
    view.expanded.clear();
    render_();
    let out;
    try {
      out = unwrap(await api.scanChat(), t('app.tab.chat', 'Chat apps'));
    } finally {
      view.running = false;
    }
    if (out) view.result = out;
    render_();
    announce($('chat-status').textContent);
  }

  $('chat-scan').addEventListener('click', run);
  $('chat-cancel').addEventListener('click', () => api.cancelChat());

  async function load() {
    if (view.result || view.running) return;
    const out = unwrap(await api.lastChat(), t('app.tab.chat', 'Chat apps'));
    if (out) view.result = out;
    render_();
  }

  const tab = document.querySelector('.tab[data-tab="chat"]');
  if (tab) tab.addEventListener('click', load);

  // Everything on this screen is built by JavaScript, so none of it is reached
  // by `translateDom`. Without this the Vietnamese runs out at the markup.
  onLanguageChange(render_);

  window.chatScreen = { load, run, view, render: render_ };
})();
