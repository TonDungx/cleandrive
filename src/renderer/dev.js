'use strict';

/**
 * The Developer screen (C2, C4): what a developer's tools have filled the disk
 * with.
 *
 * One card per tool rather than a flat list, because the two halves want
 * different things from a row. A package cache is one number and one command
 * to copy — there is nothing to select, and the app does not act on it. An
 * IDE's cache is hundreds of files the app *will* move, so that card carries
 * the count, the size and a button, and the button is only there while the
 * editor that owns the cache is closed.
 *
 * The whole screen is `pro.dev`, so the main process answers `locked` rather
 * than rows when the licence does not include it.
 */
(() => {
  const host = $('dev-groups');
  if (!host) return;

  const view = { result: null, running: false, open: new Set(), busy: false };

  const PHASES = {
    processes: () => t('dev.phase.processes', 'Checking which editors are open…'),
  };

  const KIND_TITLE = {
    packageCache: () => t('dev.group.packages', 'Package caches'),
    sdk: () => t('dev.group.sdk', 'SDKs and toolchains'),
    ideCache: () => t('dev.group.ide', 'Editor caches'),
  };

  const KIND_WHAT = {
    packageCache: () => t('dev.group.packages.what', 'Packages your tools downloaded. Each one clears its own with the command shown — the app does not touch these, because the tool that made them knows which are still needed and a walk of the folder does not.'),
    sdk: () => t('dev.group.sdk.what', 'Whole toolchains. Removing a piece is the vendor’s own manager’s job; taking folders out by hand leaves it believing they are still there.'),
    ideCache: () => t('dev.group.ide.what', 'Data your editors write again when they need it. These the app will move to the Recycle Bin — and only while the editor that owns them is closed.'),
  };

  /* ---- one tool ------------------------------------------------------------ */

  function copyButton(text) {
    const box = document.createElement('div');
    box.className = 'system-command';
    const code = document.createElement('code');
    code.textContent = text;
    const copy = document.createElement('button');
    copy.className = 'btn btn-sm';
    copy.textContent = t('system.copy', 'Copy');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast(t('dev.copied', 'Copied: {text}', { text }));
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
    return box;
  }

  function renderTool(group, rows) {
    const card = document.createElement('section');
    card.className = 'dev-tool';
    card.dataset.tool = group.id;

    const head = document.createElement('div');
    head.className = 'dev-tool-head';
    const name = document.createElement('strong');
    name.textContent = group.name;
    const size = document.createElement('span');
    size.className = 'dev-tool-size';
    size.textContent = `${formatBytes(group.bytes)} · ${t('dev.files', '{n} files', { n: formatCount(group.fileCount) })}`;
    head.append(name, size);

    // Only a row the app has an opinion about wears a pill.
    const first = rows[0];
    if (first) {
      const pill = evidencePill(first, { verdict: first.verdict !== 'keep' });
      pill.setAttribute('aria-expanded', String(view.open.has(group.id)));
      pill.addEventListener('click', () => {
        if (view.open.has(group.id)) view.open.delete(group.id);
        else view.open.add(group.id);
        render();
      });
      head.appendChild(pill);
    }
    card.appendChild(head);

    for (const place of group.places) {
      const line = document.createElement('p');
      line.className = 'dev-place';
      line.textContent = `${place.dir} — ${formatBytes(place.bytes)}`;
      line.title = place.dir;
      card.appendChild(line);
    }

    if (group.isOpen === true) {
      const open = document.createElement('p');
      open.className = 'dev-open';
      open.textContent = t('dev.isOpen', '{name} is open — close it and scan again.', { name: group.name });
      card.appendChild(open);
    } else if (group.kind === 'ideCache' && group.isOpen === null) {
      const open = document.createElement('p');
      open.className = 'dev-open';
      open.textContent = t('dev.processesUnknown', 'Whether {name} is running could not be checked, so nothing here is offered.', { name: group.name });
      card.appendChild(open);
    }

    if (group.command) card.appendChild(copyButton(group.command));

    const actions = document.createElement('div');
    actions.className = 'dev-tool-actions';

    if (group.kind === 'ideCache' && group.isOpen === false && rows.length) {
      const clear = document.createElement('button');
      clear.className = 'btn btn-sm btn-primary';
      clear.disabled = view.busy;
      clear.textContent = t('dev.clear', 'Move {n} files to the Recycle Bin', { n: formatCount(rows.length) });
      clear.addEventListener('click', () => clearCache(group, rows));
      actions.appendChild(clear);
    }

    const handoffRow = rows.find((row) => row.handoff);
    if (handoffRow) {
      const open = document.createElement('button');
      open.className = 'btn btn-sm';
      open.textContent = t('dev.openApps', 'Open Windows’ installed apps');
      open.addEventListener('click', async () => {
        const out = unwrap(await api.handoff(handoffRow.handoff), t('app.tab.dev', 'Developer'));
        if (out && out.failed && out.failed.length) toast(out.failed[0].error, true);
      });
      actions.appendChild(open);
    }

    const reveal = document.createElement('button');
    reveal.className = 'btn btn-sm btn-quiet';
    reveal.textContent = t('dev.reveal', 'Open folder');
    reveal.addEventListener('click', () => api.reveal(group.places[0].dir));
    actions.appendChild(reveal);

    if (actions.childElementCount) card.appendChild(actions);

    if (view.open.has(group.id) && first) card.appendChild(EvidencePanel(first));
    return card;
  }

  /**
   * Moving an editor's cache to the bin, through the same pipeline and the
   * same confirmation as every other delete on any other screen.
   */
  async function clearCache(group, rows) {
    view.busy = true;
    render();
    try {
      await deleteSelected(rows.map((row) => row.path), () => {}, { kind: 'recycle' });
    } finally {
      view.busy = false;
    }
    await run();
  }

  /* ---- the screen ---------------------------------------------------------- */

  function renderNotes(summary) {
    const notes = [];
    if (summary.cancelled) notes.push(t('dev.note.cancelled', 'The scan was stopped part-way.'));
    if (!summary.processesReadable) {
      notes.push(t('dev.note.noProcesses', 'The list of running programs could not be read, so no editor cache is offered — the app will not take a cache from under an editor it cannot see.'));
    }
    if (summary.missing && summary.missing.length) {
      notes.push(t('dev.note.missing', 'Not on this computer, and looked for: {list}.', {
        list: summary.missing.map((tool) => tool.name).join(', '),
      }));
    }
    notes.push(t('dev.note.neverRuns', 'The app never runs any of these commands. It shows what each tool uses so you can read it first, and copy it if you want it.'));

    const note = $('dev-note');
    note.hidden = notes.length === 0;
    replaceChildrenIfChanged(note, notes.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
  }

  function render() {
    $('dev-scan').disabled = view.running;
    $('dev-cancel').hidden = !view.running;
    $('dev-progress').hidden = !view.running;

    const result = view.result;
    if (!result || !result.summary) {
      $('dev-stats').hidden = true;
      $('dev-note').hidden = true;
      host.replaceChildren();
      if (!view.running) {
        setText($('dev-status'), result && result.locked
          ? t('dev.needsPro', 'The Developer Pack is part of Pro·Dev.')
          : t('dev.ready', 'Looks for the package caches, SDKs and editor caches your development tools keep, and measures each one.'));
      }
      return;
    }

    const { summary } = result;
    const byId = indexCandidates(result.candidates);

    if (summary.groups.length === 0) {
      $('dev-stats').hidden = true;
      renderNotes(summary);
      const empty = document.createElement('p');
      empty.className = 'dev-empty';
      empty.textContent = t('dev.none', 'No developer tools were found on this computer.');
      replaceChildrenIfChanged(host, [empty]);
      setText($('dev-status'), t('dev.noneShort', 'Nothing found.'));
      return;
    }

    $('dev-stats').hidden = false;
    setText($('dstat-total'), formatBytes(summary.totalBytes));
    setText($('dstat-packages'), formatBytes(summary.packageCacheBytes));
    setText($('dstat-sdk'), formatBytes(summary.sdkBytes));
    setText($('dstat-free'), formatBytes(summary.freeableBytes));

    renderNotes(summary);

    const rowsFor = (group) => {
      if (group.kind === 'packageCache') return viewsOf(summary.rows.packageCaches, byId).filter((row) => row.toolId === group.id);
      if (group.kind === 'sdk') return viewsOf(summary.rows.sdks, byId).filter((row) => row.toolId === group.id);
      return viewsOf(summary.rows.ideCaches, byId).filter((row) => row.toolId === group.id);
    };

    const nodes = [];
    for (const kind of ['ideCache', 'packageCache', 'sdk']) {
      const groups = summary.groups.filter((group) => group.kind === kind).sort((a, b) => b.bytes - a.bytes);
      if (groups.length === 0) continue;
      const section = document.createElement('section');
      section.className = 'dev-group';
      section.dataset.kind = kind;
      const title = document.createElement('h2');
      title.className = 'dev-group-title';
      const total = groups.reduce((sum, group) => sum + group.bytes, 0);
      title.textContent = `${KIND_TITLE[kind]()} · ${formatBytes(total)}`;
      const what = document.createElement('p');
      what.className = 'dev-group-what';
      what.textContent = KIND_WHAT[kind]();
      section.append(title, what);
      for (const group of groups) section.appendChild(renderTool(group, rowsFor(group)));
      nodes.push(section);
    }
    replaceChildrenIfChanged(host, nodes);

    if (!view.running) {
      setText($('dev-status'), t('dev.done', '{n} tools, {size}, in {time}.', {
        n: formatCount(summary.groups.length),
        size: formatBytes(summary.totalBytes),
        time: formatSeconds(summary.durationMs),
      }));
    }
  }

  api.onDevProgress((p) => {
    if (p.phase === 'measuring') {
      setText($('dev-status'), t('dev.phase.measuring', 'Measuring {name}…', { name: p.name }));
    } else if (PHASES[p.phase]) setText($('dev-status'), PHASES[p.phase]());
  });

  async function run() {
    view.running = true;
    view.open.clear();
    render();
    let out;
    try {
      out = unwrap(await api.scanDev(), t('app.tab.dev', 'Developer'));
    } finally {
      view.running = false;
    }
    if (out) view.result = out;
    render();
    announce($('dev-status').textContent);
  }

  $('dev-scan').addEventListener('click', run);
  $('dev-cancel').addEventListener('click', () => api.cancelDev());

  async function load() {
    if (view.result || view.running) return;
    const out = unwrap(await api.lastDev(), t('app.tab.dev', 'Developer'));
    if (out) view.result = out;
    render();
  }

  const tab = document.querySelector('.tab[data-tab="dev"]');
  if (tab) tab.addEventListener('click', load);
  onLanguageChange(render);

  window.devScreen = { load, run, view, render };
})();
