'use strict';

/*
 * What changed in a folder between two of its scans -- a card in Trends.
 *
 * Trends measures the volume, so it can say the disk is growing and how fast,
 * never where. Every scan leaves a snapshot of the folder it read, and two of
 * those can say where: which folders grew or shrank, and which large files
 * appeared, grew, moved or went. The main process does the comparing
 * (`snapshot:diff`, behind `pro.diff`) and this draws it.
 *
 * Two things it is careful about, because they are where a comparison lies:
 *
 *   - Scope. A snapshot covers one folder, not the drive. The growth figure
 *     above it is the whole volume's, so every sentence that links the two
 *     says which folder and over which days.
 *   - What a snapshot cannot see. It names a folder's ten largest files of
 *     10 MB or more, and nothing smaller. A file that dropped out of a ten is
 *     counted as "could not tell", never listed as gone.
 *
 * Growth is not a verdict, so none of this is green, amber or red.
 */

(function () {
  const card = $('changes-card');
  const rootSelect = $('changes-root');
  const olderSelect = $('changes-older');
  const newerSelect = $('changes-newer');
  const body = $('changes-body');

  const view = { roots: [], allowed: true, root: null, older: null, newer: null, diff: null, request: 0, loaded: false };

  const signed = (n) => (n >= 0 ? `+${formatBytes(n)}` : `−${formatBytes(-n)}`);
  const when = (iso) => new Date(iso).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  // Paths as the main process compares them on Windows: without regard to case.
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

  /** How far apart two scans are, in the unit that makes it a small number. */
  function days(n) {
    const minutes = n * 24 * 60;
    if (minutes < 1) return t('changes.underMinute', 'less than a minute');
    if (minutes < 60) {
      const m = Math.round(minutes);
      return `${formatCount(m)} ${word(m, 'changes.minute', 'minute', 'minutes')}`;
    }
    if (n < 1) {
      const hours = Math.round(n * 24);
      return `${formatCount(hours)} ${word(hours, 'changes.hour', 'hour', 'hours')}`;
    }
    const d = Math.round(n);
    return `${formatCount(d)} ${word(d, 'changes.day', 'day', 'days')}`;
  }

  function entryFor(root) {
    return view.roots.find((r) => same(r.root, root)) || null;
  }

  /** The folder to open on: the one scanned most recently that has two scans to compare. */
  function bestRoot(roots) {
    const newest = (r) => (r.snapshots[0] ? Date.parse(r.snapshots[0].takenAt) : 0);
    const withPair = roots.filter((r) => r.pair && r.pair.ok).sort((a, b) => newest(b) - newest(a));
    if (withPair.length) return withPair[0].root;
    const any = [...roots].sort((a, b) => newest(b) - newest(a));
    return any.length ? any[0].root : null;
  }

  /* ---------------------------------------------------------------- pickers */

  function option(value, label, selected) {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    el.selected = selected;
    return el;
  }

  function snapshotLabel(s) {
    const parts = [when(s.takenAt), formatBytes(s.totals ? s.totals.bytes : 0)];
    if (!s.complete) parts.push(t('changes.stopped', 'stopped early'));
    return parts.join(' · ');
  }

  function fillPickers() {
    const entry = entryFor(view.root);
    rootSelect.replaceChildren(...view.roots.map((r) => option(r.root, elide(r.root, 60), same(r.root, view.root))));
    rootSelect.disabled = view.roots.length <= 1;

    const snaps = entry ? entry.snapshots : [];
    if (entry && !(snaps.some((s) => s.file === view.older) && snaps.some((s) => s.file === view.newer))) {
      view.older = entry.pair && entry.pair.ok ? entry.pair.older : snaps[1] ? snaps[1].file : null;
      view.newer = entry.pair && entry.pair.ok ? entry.pair.newer : snaps[0] ? snaps[0].file : null;
    }
    olderSelect.replaceChildren(...snaps.map((s) => option(s.file, snapshotLabel(s), s.file === view.older)));
    newerSelect.replaceChildren(...snaps.map((s) => option(s.file, snapshotLabel(s), s.file === view.newer)));
    olderSelect.disabled = snaps.length < 2;
    newerSelect.disabled = snaps.length < 2;
  }

  rootSelect.addEventListener('change', () => {
    view.root = rootSelect.value;
    view.older = null;
    view.newer = null;
    fillPickers();
    compare();
  });
  olderSelect.addEventListener('change', () => {
    view.older = olderSelect.value;
    compare();
  });
  newerSelect.addEventListener('change', () => {
    view.newer = newerSelect.value;
    compare();
  });

  /* ---------------------------------------------------------------- loading */

  async function load() {
    if (!view.loaded) {
      // What this build may use; an upgrade hint says nothing until it is known.
      try {
        await loadEntitlements();
      } catch {
        // No hint, then -- never a guess at one.
      }
    }
    const reply = unwrap(await api.snapshotList(), t('changes.label', 'What changed'));
    if (!reply) return;
    view.roots = reply.roots;
    view.allowed = reply.allowed;
    view.loaded = true;
    if (!view.root || !entryFor(view.root)) view.root = bestRoot(view.roots);
    fillPickers();
    // The growth figure and the folder rows link here, and they could not know
    // what there was to link to until now.
    if (typeof applyTrends === 'function' && state.trends) applyTrends(state.trends);
    await compare();
  }

  function refuse(text) {
    body.replaceChildren(RefusalNote(text));
  }

  async function compare() {
    const entry = entryFor(view.root);
    if (!entry) {
      refuse(t('changes.none', 'No folder has been scanned yet. Scan one on Disk usage, and again later, to see what changed in it.'));
      return;
    }
    if (entry.snapshots.length < 2) {
      refuse(t('changes.onlyOne', 'Scanned only once — it takes two scans of the same folder to compare.'));
      return;
    }
    if (!view.allowed) {
      const hint = UpgradeHint('pro.diff', t('changes.upgrade', 'Comparing two scans of a folder is part of CleanDrive Pro.'));
      body.replaceChildren(...(hint ? [hint] : []));
      return;
    }
    if (!view.older || !view.newer || view.older === view.newer) {
      refuse(t('changes.pickTwo', 'Pick two different scans to compare.'));
      return;
    }

    const ticket = ++view.request;
    const reply = await api.snapshotDiff(entry.root, view.older, view.newer);
    if (ticket !== view.request) return;
    const diff = unwrap(reply, t('changes.label', 'What changed'));
    if (!diff) return;
    view.diff = diff;
    render(diff);
  }

  /* ---------------------------------------------------------------- drawing */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function refusalFor(diff) {
    switch (diff.reason) {
      case 'onlyOne':
        return t('changes.onlyOne', 'Scanned only once — it takes two scans of the same folder to compare.');
      case 'differentRoot':
        return t('changes.differentRoot', 'These are scans of two different folders, so they cannot be compared.');
      default:
        return t('changes.differentRules', 'The two scans measured in different ways, so they cannot be compared.');
    }
  }

  function placeLabel(place, root) {
    if (place.elsewhere) {
      return t('changes.elsewhere', 'Elsewhere in {folder}', { folder: place.rel === '' ? baseName(root) : place.rel });
    }
    return place.rel === '' ? baseName(root) : place.rel;
  }

  function placeList(title, result, root, empty) {
    const section = el('div', 'changes-col');
    section.appendChild(el('h3', 'changes-sub', title));
    const list = el('ul', 'changes-list');
    const max = result.places.reduce((n, p) => Math.max(n, Math.abs(p.change)), 0) || 1;
    for (const place of result.places) {
      const row = el('li', 'changes-row');
      const where = el('span', 'changes-where', placeLabel(place, root));
      where.title = place.elsewhere
        ? t('changes.elsewhereHint', 'Files directly in {path}, and folders inside it too small to list on their own', { path: place.path })
        : place.path;
      row.appendChild(where);
      // What the snapshots can say about the folder itself: whether it held
      // any files. An empty folder has no row, so "gone" would be a guess.
      if (place.appeared) {
        const tag = el('span', 'changes-tag', t('changes.tag.new', 'new'));
        tag.title = t('changes.tag.newHint', 'It held no files in the earlier scan');
        row.appendChild(tag);
      } else if (place.vanished) {
        const tag = el('span', 'changes-tag', t('changes.tag.empty', 'empty now'));
        tag.title = t('changes.tag.emptyHint', 'It holds no files in the later scan — removed, or emptied');
        row.appendChild(tag);
      }
      row.appendChild(el('span', 'changes-amount', signed(place.change)));
      const bar = el('span', 'changes-bar');
      const fill = el('span', 'changes-fill');
      fill.style.width = `${Math.max(2, (Math.abs(place.change) / max) * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      list.appendChild(row);
    }
    if (result.places.length === 0) list.appendChild(el('li', 'changes-empty', empty));
    if (result.more && result.more.count > 0) {
      list.appendChild(
        el('li', 'changes-more', t('changes.morePlaces', 'and {n} more, {size} between them', {
          n: formatCount(result.more.count),
          size: formatBytes(Math.abs(result.more.bytes)),
        }))
      );
    }
    section.appendChild(list);
    return section;
  }

  function reveal(file) {
    const button = el('button', 'link', t('app.reveal', 'Reveal'));
    button.type = 'button';
    button.addEventListener('click', () => api.reveal(file));
    return button;
  }

  function fileRow(name, folder, amount, action) {
    const row = el('li', 'changes-row changes-file');
    const where = el('span', 'changes-where');
    where.appendChild(el('span', 'changes-name', name));
    if (folder) where.appendChild(el('span', 'changes-dir', folder));
    row.appendChild(where);
    row.appendChild(el('span', 'changes-amount', amount));
    if (action) row.appendChild(action);
    return row;
  }

  function fileSection(title, note, group, row) {
    if (!group || group.total === 0) return null;
    const section = el('div', 'changes-files');
    section.appendChild(
      el('h3', 'changes-sub', `${title} · ${formatCount(group.total)} · ${formatBytes(group.bytes)}`)
    );
    if (note) section.appendChild(el('p', 'card-note', note));
    const list = el('ul', 'changes-list');
    for (const item of group.items) list.appendChild(row(item));
    if (group.total > group.items.length) {
      list.appendChild(el('li', 'changes-more', t('changes.moreFiles', 'and {n} more', { n: formatCount(group.total - group.items.length) })));
    }
    section.appendChild(list);
    return section;
  }

  const folderOf = (rel) => (rel ? t('changes.inFolder', 'in {folder}', { folder: rel }) : '');

  function render(diff) {
    const out = [];
    if (!diff.ok) {
      refuse(refusalFor(diff));
      return;
    }

    const root = diff.root;
    const entry = entryFor(root);
    const volume = entry ? entry.volume : root.slice(0, 3);
    const head = el('p', 'changes-head');
    head.append(
      el('strong', '', `${baseName(root)}: ${formatBytes(diff.total.before)} → ${formatBytes(diff.total.after)}`),
      document.createTextNode(' '),
      el('span', 'changes-net', signed(diff.total.change))
    );
    out.push(head);
    out.push(
      el('p', 'card-note', t('changes.span', 'Between {from} and {to}, {span} apart. Measured in {folder} only, not the whole of {volume}.', {
        from: when(diff.from.takenAt),
        to: when(diff.to.takenAt),
        span: days(diff.days),
        folder: root,
        volume,
      }))
    );
    if (diff.confidence === 'guess') {
      const stopped = diff.incomplete.map((at) => when(at)).join(', ');
      out.push(
        RefusalNote(t('changes.incomplete', 'The scan of {date} was stopped early, so this comparison is {guess}: part of what looks gone may simply not have been read.', {
          date: stopped,
          guess: confidenceWord('guess'),
        }))
      );
    }

    const cols = el('div', 'changes-cols');
    cols.append(
      placeList(t('changes.grew', 'Grew'), diff.grew, root, t('changes.noGrowth', 'Nothing grew by a megabyte or more.')),
      placeList(t('changes.shrank', 'Shrank'), diff.shrank, root, t('changes.noShrink', 'Nothing shrank by a megabyte or more.'))
    );
    out.push(cols);

    if (!diff.files) {
      out.push(RefusalNote(t('changes.filesRefused', 'The two scans picked out large files by different rules, so files are not compared.')));
    } else {
      const f = diff.files;
      const sections = [
        fileSection(t('changes.files.grew', 'Large files that grew'), null, f.grew, (x) =>
          fileRow(x.name, folderOf(x.rel), `${formatBytes(x.before)} → ${formatBytes(x.after)} (${signed(x.change)})`, reveal(x.path))),
        fileSection(
          t('changes.files.appeared', 'New large files'),
          t('changes.files.appearedNote', 'Not among the folder’s large files in the earlier scan: new, or grown past 10 MB since.'),
          f.appeared,
          (x) => fileRow(x.name, folderOf(x.rel), formatBytes(x.size), reveal(x.path))
        ),
        fileSection(
          t('changes.files.vanished', 'Large files no longer there'),
          t('changes.files.vanishedNote', 'The later scan would have named these had they still been there at this size. Deleted, moved elsewhere, or shrunk — the scans cannot tell which.'),
          f.vanished,
          (x) => fileRow(x.name, folderOf(x.rel), formatBytes(x.size), null)
        ),
        fileSection(
          t('changes.files.moved', 'Moved'),
          t('changes.files.movedNote', 'Gone from one folder and arrived in another with the same name, size and date.'),
          f.moved,
          (x) => {
            const row = fileRow(x.name, `${x.fromRel || baseName(root)} → ${x.toRel || baseName(root)}`, formatBytes(x.size), reveal(x.to));
            row.querySelector('.changes-where').title = `${x.from}\n→ ${x.to}`;
            return row;
          }
        ),
        fileSection(t('changes.files.shrank', 'Large files that shrank'), null, f.shrank, (x) =>
          fileRow(x.name, folderOf(x.rel), `${formatBytes(x.before)} → ${formatBytes(x.after)} (${signed(x.change)})`, reveal(x.path))),
      ].filter(Boolean);
      if (sections.length === 0) {
        out.push(el('p', 'card-note', t('changes.files.none', 'No file of 10 MB or more changed that the two scans can see.')));
      }
      out.push(...sections);
      if (f.unknown.count > 0) {
        out.push(
          el('p', 'card-note changes-unknown', t('changes.files.unknown', 'Could not tell: {n} large {files} ({size}) moved into or out of a folder’s ten largest, so whether they changed is not something these two scans can say.', {
            n: formatCount(f.unknown.count),
            files: word(f.unknown.count, 'app.file', 'file', 'files'),
            size: formatBytes(f.unknown.bytes),
          }))
        );
      }
    }

    body.replaceChildren(...out);
  }

  /* ---------------------------------------------------------------- outside */

  for (const tab of document.querySelectorAll('.tab[data-tab="trends"]')) tab.addEventListener('click', () => load());
  onLanguageChange(() => {
    if (!view.loaded) return;
    fillPickers();
    if (view.diff) render(view.diff);
    else compare();
  });
  load();

  window.Changes = {
    load,
    span: days,
    allowed: () => view.allowed,
    /** Whether this folder has two scans to compare. */
    has(root) {
      const entry = entryFor(root);
      return Boolean(entry && entry.snapshots.length >= 2);
    },
    /** The folder on a volume that a "see what grew" link should open, or null. */
    rootOn(volume) {
      const on = view.roots.filter((r) => same(r.volume, volume) && r.pair && r.pair.ok);
      const root = bestRoot(on);
      return root ? { root, days: entryFor(root).pair.days } : null;
    },
    /** Open the card on a folder, with its default pair, and bring it into view. */
    async open(root) {
      const entry = entryFor(root);
      if (!entry) return;
      view.root = entry.root;
      view.older = null;
      view.newer = null;
      fillPickers();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      await compare();
    },
    /** For the harnesses. */
    debug: () => ({ root: view.root, older: view.older, newer: view.newer, diff: view.diff, roots: view.roots.length }),
  };
})();
