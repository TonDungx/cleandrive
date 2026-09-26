'use strict';

/**
 * The Apps screen (D1): what is installed, what it occupies, when it was last
 * started.
 *
 * Two things about it are deliberate and easy to undo by accident.
 *
 * **Two size columns, never one.** "Measured" is a folder that was walked.
 * "Declared" is the number the installer wrote into the registry, and on the
 * machine this was built on it ranged from a quarter of the real size to
 * twenty-five times it. They are never added together and never share a
 * column, because somebody sorting by size would otherwise be sorting real
 * measurements and installers' guesses into one order.
 *
 * **Silence is not disuse.** An app with no launch record says "no record",
 * not "not used". Windows records what Explorer and the Start menu open; a
 * program started from a pinned taskbar button leaves no trace in it.
 *
 * The screen redraws itself from `render()` for a language change and for a
 * new result, so the rows go through `replaceChildrenIfChanged` -- a redraw
 * that changed nothing must not take the keyboard out of the row it is on.
 */
(() => {
  const host = $('apps-list');
  if (!host) return;

  const view = { result: null, running: null, sort: 'size', onlyStale: false, open: new Set() };

  /* ---- words -------------------------------------------------------------- */

  const PROTECTION = {
    systemPackage: () => t('apps.protection.systemPackage', 'Part of Windows'),
    noRemove: () => t('apps.protection.noRemove', 'Windows does not allow removing it'),
    inWindows: () => t('apps.protection.inWindows', 'Installed inside Windows'),
    noUninstaller: () => t('apps.protection.noUninstaller', 'No uninstaller'),
  };

  const SOURCE_WORD = {
    prefetch: () => t('apps.source.prefetch', 'Prefetch'),
    userAssist: () => t('apps.source.userAssist', 'Start menu and Explorer'),
    shortcut: () => t('apps.source.shortcut', 'its shortcut'),
  };

  /** How long ago, in the words the rest of the app uses for an age. */
  function whenLabel(meta) {
    if (!meta.lastUsedAllowed) return t('apps.lastUsed.locked', 'Pro');
    if (!meta.lastUsed) return t('apps.lastUsed.none', 'no record');
    return formatAgo(meta.lastUsed.at);
  }

  /* ---- a row -------------------------------------------------------------- */

  function cell(className, text, title) {
    const el = document.createElement('span');
    el.className = className;
    el.setAttribute('role', 'cell');
    el.textContent = text;
    if (title) el.title = title;
    return el;
  }

  function renderHead() {
    const head = document.createElement('div');
    head.className = 'apps-row apps-head';
    head.setAttribute('role', 'row');
    const columns = [
      ['apps-col-name', t('apps.col.name', 'App'), null],
      ['apps-col-size', t('apps.col.measured', 'Measured'), t('apps.col.measured.what', 'Its folders, read and added up. Blank where there is no folder to read.')],
      ['apps-col-size', t('apps.col.declared', 'Declared'), t('apps.col.declared.what', 'What the installer wrote into the registry. Often wrong, and never added to the measured figure.')],
      ['apps-col-when', t('apps.col.lastUsed', 'Last started'), t('apps.col.lastUsed.what', 'From the records Windows keeps of what was opened.')],
      ['apps-col-badge', '', null],
      ['apps-col-actions', '', null],
    ];
    for (const [className, label, title] of columns) {
      const el = cell(`${className} apps-headcell`, label, title);
      el.setAttribute('role', 'columnheader');
      head.appendChild(el);
    }
    return head;
  }

  function renderRow(row) {
    // `candidateView` in candidates.js spreads a candidate's `meta` onto the
    // row and calls its size `size`, which is the shape every screen draws
    // from -- there is no `row.meta` here.
    const meta = row;
    const el = document.createElement('div');
    el.className = 'apps-row';
    el.setAttribute('role', 'row');
    el.dataset.appId = meta.appId;

    const name = document.createElement('span');
    name.className = 'apps-col-name';
    name.setAttribute('role', 'cell');
    const title = document.createElement('strong');
    title.className = 'apps-name';
    title.textContent = meta.name;
    title.title = meta.installLocation || meta.name;
    const sub = document.createElement('span');
    sub.className = 'apps-publisher';
    const parts = [meta.publisher, meta.version].filter(Boolean);
    if (meta.source === 'store') parts.push(t('apps.fromStore', 'Microsoft Store'));
    sub.textContent = parts.join(' · ');
    name.append(title, sub);
    el.appendChild(name);

    el.appendChild(cell('apps-col-size', meta.measuredBytes === null ? '—' : formatBytes(row.size),
      meta.measuredBytes === null ? t('apps.noMeasure', 'Nothing to measure: it did not record an install folder, or the folder is gone.')
        : t('apps.measureBreakdown', 'Install folder {install}, its data folders {data}', {
          install: formatBytes(meta.measuredBytes), data: formatBytes(meta.dataBytes),
        })));

    el.appendChild(cell('apps-col-size apps-declared', meta.declaredBytes > 0 ? formatBytes(meta.declaredBytes) : '—',
      meta.declaredBytes > 0 ? t('apps.declaredWhat', 'The installer’s own figure, not a measurement') : ''));

    const when = cell('apps-col-when', whenLabel(meta),
      meta.lastUsed ? t('apps.lastUsedVia', 'From {source}', { source: SOURCE_WORD[meta.lastUsed.source]() }) : '');
    if (!meta.lastUsedAllowed) when.classList.add('apps-locked');
    if (!meta.lastUsed) when.classList.add('apps-unknown');
    el.appendChild(when);

    const badge = document.createElement('span');
    badge.className = 'apps-col-badge';
    badge.setAttribute('role', 'cell');
    const expanded = view.open.has(meta.appId);
    const onToggle = () => {
      if (view.open.has(meta.appId)) view.open.delete(meta.appId);
      else view.open.add(meta.appId);
      render();
    };
    // Only a row the app has something to say about wears a pill: a `keep`
    // on all three hundred rows is noise, not information.
    const pill = row.verdict === 'review' || row.verdict === 'protected'
      ? evidencePill(row)
      : evidencePill(row, { verdict: false, className: 'badge badge-confidence badge-button' });
    pill.setAttribute('aria-expanded', String(expanded));
    pill.addEventListener('click', onToggle);
    badge.appendChild(pill);
    el.appendChild(badge);

    const actions = document.createElement('span');
    actions.className = 'apps-col-actions';
    actions.setAttribute('role', 'cell');
    if (meta.protection) {
      // Plain text inside the actions cell, not a cell of its own: a cell
      // nested in a cell has no row to belong to, and axe says so.
      const why = document.createElement('span');
      why.className = 'apps-protection';
      why.textContent = PROTECTION[meta.protection] ? PROTECTION[meta.protection]() : '';
      actions.appendChild(why);
    } else {
      const uninstall = document.createElement('button');
      uninstall.className = 'btn btn-sm';
      uninstall.textContent = t('apps.uninstall', 'Uninstall…');
      uninstall.addEventListener('click', async () => {
        const out = unwrap(await api.handoff('apps'), t('app.tab.apps', 'Apps'));
        if (out && out.failed && out.failed.length) toast(out.failed[0].error, true);
      });
      actions.appendChild(uninstall);
    }
    if (meta.installLocation) {
      const reveal = document.createElement('button');
      reveal.className = 'btn btn-sm btn-quiet';
      reveal.textContent = t('apps.reveal', 'Open folder');
      reveal.addEventListener('click', () => api.reveal(meta.installLocation));
      actions.appendChild(reveal);
    }
    el.appendChild(actions);

    return el;
  }

  /**
   * The evidence, and -- where the app registered one -- the command its own
   * uninstaller put in the registry, shown to copy and never run by the app.
   *
   * Which rows are open is state on `view`, and the panel is drawn by
   * `render()` like everything else. Splicing it into the DOM beside the row
   * instead would put markup in the list that the next redraw knows nothing
   * about, and a redraw happens on a language change and on every
   * `data-changed` -- the panel would vanish under whoever had just opened it.
   */
  function evidenceRowFor(row) {
    const panel = document.createElement('div');
    panel.className = 'apps-evidence-row';
    panel.setAttribute('role', 'row');
    const inner = document.createElement('div');
    inner.className = 'apps-evidence-cell';
    inner.setAttribute('role', 'cell');
    inner.appendChild(EvidencePanel(row));

    if (row.uninstallCommand) {
      const box = document.createElement('div');
      box.className = 'system-command';
      const label = document.createElement('p');
      label.className = 'apps-command-label';
      label.textContent = t('apps.commandLabel', 'The command this app’s own uninstaller registered. The app never runs it:');
      const code = document.createElement('code');
      code.textContent = row.uninstallCommand;
      const copy = document.createElement('button');
      copy.className = 'btn btn-sm';
      copy.textContent = t('system.copy', 'Copy');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(row.uninstallCommand);
          toast(t('apps.copied', 'The uninstall command was copied'));
        } catch {
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          toast(t('system.copySelect', 'Selected — press Ctrl+C to copy it'));
        }
      });
      box.append(code, copy);
      inner.append(label, box);
    }

    panel.appendChild(inner);
    return panel;
  }

  /* ---- the screen --------------------------------------------------------- */

  function sorted(rows, summary) {
    const list = [...rows];
    if (view.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (view.sort === 'lastUsed' && summary.lastUsedAllowed) {
      // Oldest first, and the ones with no record after them -- "unknown" is
      // not "longest ago", and putting it first would read as if it were.
      list.sort((a, b) => {
        const x = a.lastUsed ? a.lastUsed.at : Infinity;
        const y = b.lastUsed ? b.lastUsed.at : Infinity;
        return x - y || b.size - a.size;
      });
    } else list.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
    if (view.onlyStale && summary.lastUsedAllowed) {
      return list.filter((row) => !row.lastUsed || Date.now() - row.lastUsed.at >= summary.staleDays * 86400000);
    }
    return list;
  }

  function renderNotes(summary) {
    const notes = [];
    if (summary.cancelled) notes.push(t('apps.note.cancelled', 'The list was stopped part-way, so some apps have no size yet.'));

    const counts = summary.counts || {};
    const unmeasured = (counts.shown || 0) - (counts.measured || 0);
    if (unmeasured > 0) {
      notes.push(t('apps.note.unmeasured', '{n} of these did not record where they installed to, or their folder is gone, so there is nothing to measure. Where an installer left a figure behind it is in the Declared column, and that figure is the installer’s claim, not a measurement.', {
        n: formatCount(unmeasured),
      }));
    }
    if (counts.hiddenTotal > 0) {
      notes.push(t('apps.note.hidden', '{n} more entries in the registry are left out, the same ones Windows leaves out of its own list: shared runtimes, driver packages and updates.', {
        n: formatCount(counts.hiddenTotal),
      }));
    }
    if (summary.lastUsedAllowed) {
      if (summary.prefetch && summary.prefetch.available) {
        notes.push(t('apps.note.prefetch', 'Windows’ own launch records are included: {n} programs, measured with your permission.', { n: formatCount(summary.prefetch.programs) }));
      } else if (summary.coverMonths > 0) {
        notes.push(t('apps.note.cover', 'The launch records on this machine go back about {n} months, and Windows only writes them for what you open from Explorer and the Start menu. “No record” means nothing was written down, not that the app went unused. Adding Windows’ own Prefetch records needs administrator rights.', {
          n: formatCount(summary.coverMonths),
        }));
      } else {
        notes.push(t('apps.note.noRecords', 'Windows has no launch records for this account, so nothing can be said about when any of these was last started.'));
      }
      // The measured reason last-access time is not one of the sources.
      notes.push(t('apps.note.noAtime', 'A file’s “last opened” time is not used here. On this machine 70% of the programs under Program Files had been read in the past week — by the antivirus, the search indexer and the backup, not by anyone starting them.'));
    }
    if (!summary.storeAvailable) notes.push(t('apps.note.noStore', 'Windows would not list the Microsoft Store apps, so they are missing from this list.'));

    const note = $('apps-note');
    note.hidden = notes.length === 0;
    replaceChildrenIfChanged(note, notes.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
  }

  function render() {
    const running = Boolean(view.running);
    $('apps-scan').disabled = running;
    $('apps-prefetch').disabled = running;
    $('apps-cancel').hidden = !running;
    $('apps-progress').hidden = !running;

    const result = view.result;
    if (!result || !result.summary) {
      $('apps-controls').hidden = true;
      $('apps-note').hidden = true;
      host.replaceChildren();
      for (const id of ['astat-count', 'astat-measured', 'astat-unmeasured', 'astat-review']) setText($(id), '–');
      if (!running) {
        setText($('apps-status'), t('apps.ready', 'Reads the list Windows keeps of installed programs and measures the folders each one names. It needs no administrator rights and takes about half a minute.'));
      }
      return;
    }

    const { summary } = result;
    const byId = indexCandidates(result.candidates);
    const rows = viewsOf(summary.rows, byId);
    const reviewCount = rows.filter((row) => row.verdict === 'review').length;

    const counts = summary.counts || {};
    setText($('astat-count'), formatCount(counts.shown || 0));
    setText($('astat-measured'), formatBytes(summary.totalMeasuredBytes));
    setText($('astat-unmeasured'), formatCount((counts.shown || 0) - (counts.measured || 0)));
    setText($('astat-review'), summary.lastUsedAllowed ? formatCount(reviewCount) : '–');

    renderNotes(summary);

    $('apps-controls').hidden = false;
    const staleBox = $('apps-only-stale');
    staleBox.disabled = !summary.lastUsedAllowed;
    // Without the launch dates there is nothing to sort by, so the option is
    // turned off rather than left selectable and quietly ignored -- a control
    // that says "Last used" over a list ordered by size is a lie the screen
    // tells about its own data.
    const sortBox = $('apps-sort');
    const byLastUsed = sortBox.querySelector('option[value="lastUsed"]');
    if (byLastUsed) byLastUsed.disabled = !summary.lastUsedAllowed;
    if (!summary.lastUsedAllowed && view.sort === 'lastUsed') view.sort = 'size';
    if (sortBox.value !== view.sort) sortBox.value = view.sort;
    setText($('apps-only-stale-label'), t('apps.onlyStaleDays', 'Only ones with no record in {n} days', { n: formatCount(summary.staleDays) }));
    const upsell = $('apps-upsell');
    upsell.hidden = summary.lastUsedAllowed;
    if (!summary.lastUsedAllowed) setText(upsell, t('apps.needsPro', 'When each app was last started, and sorting by it, are part of Pro.'));

    const list = sorted(rows, summary);
    const nodes = [renderHead()];
    for (const row of list) {
      nodes.push(renderRow(row));
      if (view.open.has(row.appId)) nodes.push(evidenceRowFor(row));
    }
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'apps-empty';
      empty.textContent = t('apps.empty', 'Nothing matches that.');
      nodes.push(empty);
    }
    replaceChildrenIfChanged(host, nodes);

    if (!running) {
      setText($('apps-status'), t('apps.done', '{n} apps, {size} measured, in {time}.', {
        n: formatCount(counts.shown || 0),
        size: formatBytes(summary.totalMeasuredBytes),
        time: formatSeconds(summary.durationMs),
      }));
    }
  }

  const PHASES = {
    registry: () => t('apps.phase.registry', 'Reading the list Windows keeps of installed programs…'),
    store: () => t('apps.phase.store', 'Asking Windows about apps from the Microsoft Store…'),
    folders: () => t('apps.phase.folders', 'Looking for the folders each app keeps its data in…'),
    prompt: () => t('system.phase.prompt', 'Waiting for the administrator prompt…'),
    prefetch: () => t('apps.phase.prefetch', 'Reading Windows’ own launch records…'),
  };

  api.onAppsProgress((p) => {
    if (p.phase === 'measuring') {
      setText($('apps-status'), t('apps.phase.measuring', 'Measuring folders… {done} of {total}', {
        done: formatCount(p.done), total: formatCount(p.total),
      }));
    } else if (PHASES[p.phase]) setText($('apps-status'), PHASES[p.phase]());
  });

  async function run(kind) {
    view.running = kind;
    render();
    let out;
    try {
      out = unwrap(kind === 'prefetch' ? await api.scanAppsPrefetch() : await api.scanApps(), t('app.tab.apps', 'Apps'));
    } finally {
      view.running = null;
    }
    if (out) {
      view.open.clear();
      if (out.declined) toast(t('apps.declined', 'The administrator prompt was declined, so Windows’ launch records were not read.'));
      if (out.summary) view.result = { candidates: out.candidates, summary: out.summary };
    }
    render();
    if (out && !out.declined) announce($('apps-status').textContent);
  }

  $('apps-scan').addEventListener('click', () => run('scan'));
  $('apps-prefetch').addEventListener('click', () => run('prefetch'));
  $('apps-cancel').addEventListener('click', () => api.cancelApps());
  $('apps-sort').addEventListener('change', (event) => {
    view.sort = event.target.value;
    render();
  });
  $('apps-only-stale').addEventListener('change', (event) => {
    view.onlyStale = event.target.checked;
    render();
  });

  async function load() {
    if (view.result || view.running) return;
    const out = unwrap(await api.lastApps(), t('app.tab.apps', 'Apps'));
    if (out && out.summary) view.result = { candidates: out.candidates, summary: out.summary };
    render();
  }

  const tab = document.querySelector('.tab[data-tab="apps"]');
  if (tab) tab.addEventListener('click', load);
  onLanguageChange(render);

  window.appsScreen = { load, run, view, render };
})();
