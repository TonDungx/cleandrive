'use strict';

/**
 * The projects half of the Developer screen (C1, C5).
 *
 * Loaded after app.js and sharing its globals, like the rest of the window.
 * The folders it works on are `state.roots` -- the same ones the Disk usage
 * screen was pointed at -- which is why this has a button of its own rather
 * than running with the tools scan: a different input, a different cost, and
 * a state where there is nothing chosen to scan.
 *
 * Two kinds of card, and they differ in what the app will do:
 *
 *   a project   its dependency folder, with the size, how long it has been
 *               left alone, and the one command that brings it back. Nothing
 *               to tick. `recycle` refuses folders on purpose and the files
 *               below are 232,229 of them on this machine.
 *   a build     a folder the project's own `.gitignore` calls regenerated:
 *               the file count, and a button. A folder nobody declared gets a
 *               row that says so and offers nothing.
 */
(() => {
  const host = $('devp-groups');
  if (!host) return;

  const view = { result: null, running: false, open: new Set(), busy: false };

  /** "1 file" / "2 files" -- English needs both forms, Vietnamese needs one. */
  const countOfFiles = (n) => t('dev.projects.files', '{n} {files}', {
    n: formatCount(n), files: word(n, 'app.file', 'file', 'files'),
  });

  /* ---- one project -------------------------------------------------------- */

  function renderProject(project, row) {
    const card = document.createElement('section');
    card.className = 'dev-tool';
    card.dataset.project = project.path;

    const head = document.createElement('div');
    head.className = 'dev-tool-head';
    const name = document.createElement('strong');
    name.textContent = project.name;
    const size = document.createElement('span');
    size.className = 'dev-tool-size';
    size.textContent = `${formatBytes(project.bytes)} · ${countOfFiles(project.fileCount)}`;
    head.append(name, size);

    if (row) {
      const pill = evidencePill(row, { verdict: true });
      pill.setAttribute('aria-expanded', String(view.open.has(project.path)));
      pill.addEventListener('click', () => {
        if (view.open.has(project.path)) view.open.delete(project.path);
        else view.open.add(project.path);
        render();
      });
      head.appendChild(pill);
    }
    card.appendChild(head);

    const where = document.createElement('p');
    where.className = 'dev-place';
    where.textContent = project.path;
    where.title = project.path;
    card.appendChild(where);

    const facts = document.createElement('p');
    facts.className = 'dev-project-facts';
    const bits = [project.kindNames.join(' + ')];
    bits.push(project.lockfiles.length
      ? t('dev.projects.lock', 'lockfile: {list}', { list: project.lockfiles.join(', ') })
      : t('dev.projects.noLock', 'no lockfile'));
    if (project.idleDays !== null) {
      bits.push(project.idleDays === 0
        ? t('dev.projects.today', 'touched today')
        : t('dev.projects.idle', 'left alone {days} days', { days: formatCount(project.idleDays) }));
    }
    facts.textContent = bits.join(' · ');
    card.appendChild(facts);

    for (const dir of project.dependencyDirs) {
      const line = document.createElement('p');
      line.className = 'dev-place';
      line.textContent = `${dir.path} — ${formatBytes(dir.bytes)}`;
      line.title = dir.path;
      card.appendChild(line);
    }

    if (project.restore) card.appendChild(copyCommand(project.restore));

    const actions = document.createElement('div');
    actions.className = 'dev-tool-actions';
    const reveal = document.createElement('button');
    reveal.className = 'btn btn-sm btn-quiet';
    reveal.textContent = t('dev.reveal', 'Open folder');
    reveal.addEventListener('click', () => api.reveal(project.path));
    actions.appendChild(reveal);
    card.appendChild(actions);

    if (view.open.has(project.path) && row) card.appendChild(EvidencePanel(row));
    return card;
  }

  /* ---- one build folder ---------------------------------------------------- */

  function renderBuild(group, rows, byId) {
    const card = document.createElement('section');
    card.className = 'dev-tool';
    card.dataset.build = group.path;

    const head = document.createElement('div');
    head.className = 'dev-tool-head';
    const name = document.createElement('strong');
    name.textContent = group.projectName ? `${group.projectName} — ${group.name}` : group.name;
    const size = document.createElement('span');
    size.className = 'dev-tool-size';
    size.textContent = `${formatBytes(group.bytes)} · ${countOfFiles(group.fileCount)}`;
    head.append(name, size);

    // The row the pill speaks for: the folder's own when nothing was declared,
    // the first of its files when it was.
    const first = group.declared ? rows[0] : byId.get(group.rowId);
    if (first) {
      const pill = evidencePill(first, { verdict: true });
      pill.setAttribute('aria-expanded', String(view.open.has(group.path)));
      pill.addEventListener('click', () => {
        if (view.open.has(group.path)) view.open.delete(group.path);
        else view.open.add(group.path);
        render();
      });
      head.appendChild(pill);
    }
    card.appendChild(head);

    const where = document.createElement('p');
    where.className = 'dev-place';
    where.textContent = group.path;
    where.title = group.path;
    card.appendChild(where);

    if (group.declared) {
      const said = document.createElement('p');
      said.className = 'dev-project-facts';
      said.textContent = t('dev.projects.declaredBy', 'Its .gitignore says “{line}”', { line: group.declaredBy });
      card.appendChild(said);
    }

    if (group.truncated) {
      const more = document.createElement('p');
      more.className = 'dev-open';
      more.textContent = t('dev.projects.truncated', 'Only the first files here are listed, so only those can be moved.');
      card.appendChild(more);
    }

    const actions = document.createElement('div');
    actions.className = 'dev-tool-actions';

    if (group.declared && rows.length) {
      const clear = document.createElement('button');
      clear.className = 'btn btn-sm btn-primary';
      clear.disabled = view.busy;
      Managed.hold(clear, Managed.holds('recycle'));
      clear.textContent = t('dev.projects.clear', 'Move {count} to the Recycle Bin', { count: countOfFiles(rows.length) });
      clear.addEventListener('click', () => clearBuild(rows));
      actions.appendChild(clear);
    }

    const reveal = document.createElement('button');
    reveal.className = 'btn btn-sm btn-quiet';
    reveal.textContent = t('dev.reveal', 'Open folder');
    reveal.addEventListener('click', () => api.reveal(group.path));
    actions.appendChild(reveal);
    card.appendChild(actions);

    if (view.open.has(group.path) && first) card.appendChild(EvidencePanel(first));
    return card;
  }

  /** A command to read and copy. The app runs none of them. */
  function copyCommand(text) {
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

  async function clearBuild(rows) {
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
    if (summary.refused > 0) {
      notes.push(t('dev.projects.note.refused', '{n} folders could not be read, so some of this is a floor rather than a total.', {
        n: formatCount(summary.refused),
      }));
    }
    // A folder somebody chose on purpose and the rules then refused. Saying
    // nothing about it looks like a bug rather than a rule.
    for (const refused of summary.refusedRoots || []) {
      notes.push(refused.reason === 'appData'
        ? t('dev.projects.note.rootAppData', '{root} was not looked through: it is inside AppData, where applications keep their own copies of everything.', { root: refused.root })
        : t('dev.projects.note.rootRefused', '{root} was not looked through: Windows and installed programs live there.', { root: refused.root }));
    }
    notes.push(t(
      'dev.projects.note.declared',
      'A build folder is only offered when the project’s own .gitignore calls it regenerated. A folder merely named build or dist is left alone — a vendored library ships one, and so does a folder of releases somebody meant to keep.'
    ));
    notes.push(t(
      'dev.projects.note.dependencies',
      'A dependency folder is never touched. The command shown puts it back, and the tool that owns it knows what the lockfile pins in a way the app does not.'
    ));
    notes.push(t(
      'dev.projects.note.notLookedIn',
      'Not looked in: everything under AppData, folders whose name starts with a dot, the insides of installed applications, and the package caches listed above.'
    ));

    const note = $('devp-note');
    note.hidden = notes.length === 0;
    replaceChildrenIfChanged(note, notes.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
  }

  function render() {
    $('devp-scan').disabled = view.running;
    $('devp-cancel').hidden = !view.running;
    $('devp-progress').hidden = !view.running;

    const result = view.result;
    if (!result || !result.summary) {
      $('devp-stats').hidden = true;
      $('devp-note').hidden = true;
      host.replaceChildren();
      if (!view.running) {
        setText($('devp-status'), result && result.locked
          ? t('dev.needsPro', 'The Developer Pack is part of Pro·Dev.')
          : readyLine());
      }
      return;
    }

    const { summary } = result;
    if (summary.noRoots) {
      $('devp-stats').hidden = true;
      $('devp-note').hidden = true;
      const empty = document.createElement('p');
      empty.className = 'dev-empty';
      empty.textContent = t('dev.projects.noRoots', 'Choose a folder on the Disk usage screen first — this looks through the folders chosen there.');
      replaceChildrenIfChanged(host, [empty]);
      setText($('devp-status'), t('dev.projects.noRootsShort', 'No folder chosen.'));
      return;
    }

    const byId = indexCandidates(result.candidates);

    $('devp-stats').hidden = false;
    setText($('pstat-projects'), formatCount(summary.projectsFound || 0));
    setText($('pstat-deps'), formatBytes(summary.dependencyBytes || 0));
    setText($('pstat-build'), formatBytes(summary.buildBytes || 0));
    setText($('pstat-free'), formatBytes(summary.freeableBytes || 0));

    renderNotes(summary);

    const nodes = [];

    const projectRows = viewsOf(summary.rows.projects, byId);
    const rowFor = (p) => projectRows.find((row) => row.path.toLowerCase() === p.path.toLowerCase());
    const projects = [...(summary.projectRows || [])].sort((a, b) => b.bytes - a.bytes);
    if (projects.length) {
      const section = document.createElement('section');
      section.className = 'dev-group';
      section.dataset.kind = 'project';
      const title = document.createElement('h2');
      title.className = 'dev-group-title';
      title.textContent = `${t('dev.projects.group.deps', 'Dependencies, by project')} · ${formatBytes(summary.dependencyBytes || 0)}`;
      const what = document.createElement('p');
      what.className = 'dev-group-what';
      what.textContent = t(
        'dev.projects.group.deps.what',
        'What each project downloaded to build itself. None of it is touched — the command on each row is how it comes back.'
      );
      section.append(title, what);
      for (const project of projects) section.appendChild(renderProject(project, rowFor(project)));
      nodes.push(section);
    }

    const groups = summary.buildGroups || [];
    const declared = groups.filter((g) => g.declared);
    const guessed = groups.filter((g) => !g.declared);

    const buildSection = (list, kind, titleText, whatText, total) => {
      if (list.length === 0) return;
      const section = document.createElement('section');
      section.className = 'dev-group';
      section.dataset.kind = kind;
      const title = document.createElement('h2');
      title.className = 'dev-group-title';
      title.textContent = `${titleText} · ${formatBytes(total)}`;
      const what = document.createElement('p');
      what.className = 'dev-group-what';
      what.textContent = whatText;
      section.append(title, what);
      for (const group of list) {
        section.appendChild(renderBuild(group, viewsOf(group.fileIds, byId), byId));
      }
      nodes.push(section);
    };

    buildSection(
      declared, 'buildDeclared',
      t('dev.projects.group.build', 'Build output your projects declared'),
      t('dev.projects.group.build.what', 'Every one of these sits under a .gitignore line saying it is regenerated. Those are the only ones offered.'),
      declared.reduce((sum, g) => sum + g.bytes, 0)
    );
    buildSection(
      guessed, 'buildGuess',
      t('dev.projects.group.guess', 'Folders that only look like build output'),
      t('dev.projects.group.guess.what', 'Named build, dist or bin, and nothing says they are regenerated. Shown so you know they were found and left alone.'),
      guessed.reduce((sum, g) => sum + g.bytes, 0)
    );

    if (nodes.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dev-empty';
      empty.textContent = t('dev.projects.none', 'No projects with a dependency or build folder were found in the folders chosen.');
      nodes.push(empty);
    }
    replaceChildrenIfChanged(host, nodes);

    if (!view.running) {
      setText($('devp-status'), t('dev.projects.done', '{n} projects, {size}, in {time}.', {
        n: formatCount(summary.projectsFound || 0),
        size: formatBytes((summary.dependencyBytes || 0) + (summary.buildBytes || 0)),
        time: formatSeconds(summary.durationMs),
      }));
    }
  }

  function readyLine() {
    const roots = (state && state.roots) || [];
    if (roots.length === 0) {
      return t('dev.projects.noRoots', 'Choose a folder on the Disk usage screen first — this looks through the folders chosen there.');
    }
    return roots.length === 1
      ? t('dev.projects.ready', 'Ready to look through {folder}.', { folder: elide(roots[0], 48) })
      : t('dev.projects.readyMany', 'Ready to look through {n} folders.', { n: formatCount(roots.length) });
  }

  api.onDevProjectsProgress((p) => {
    if (p.phase === 'walking') {
      setText($('devp-status'), t('dev.projects.phase.walking', 'Looking through folders… {dirs} so far, {projects} projects', {
        dirs: formatCount(p.dirs || 0), projects: formatCount(p.projects || 0),
      }));
    } else if (p.phase === 'builds') {
      setText($('devp-status'), t('dev.projects.phase.builds', 'Reading build folders… {at} of {of}', {
        at: formatCount(p.at), of: formatCount(p.of),
      }));
    } else if (p.phase === 'measuring') {
      setText($('devp-status'), t('dev.projects.phase.measuring', 'Measuring {name}… {at} of {of}', {
        name: p.name, at: formatCount(p.at), of: formatCount(p.of),
      }));
    } else if (p.phase === 'touched') {
      setText($('devp-status'), t('dev.projects.phase.touched', 'Reading when {name} was last touched…', { name: p.name }));
    }
  });

  async function run() {
    const roots = (state && state.roots) || [];
    if (roots.length === 0) {
      view.result = { candidates: [], summary: { noRoots: true } };
      render();
      announce($('devp-status').textContent);
      return;
    }
    view.running = true;
    view.open.clear();
    render();
    let out;
    try {
      out = unwrap(await api.scanDevProjects(roots), t('app.tab.dev', 'Developer'));
    } finally {
      view.running = false;
    }
    if (out) view.result = out;
    render();
    announce($('devp-status').textContent);
  }

  $('devp-scan').addEventListener('click', run);
  $('devp-cancel').addEventListener('click', () => api.cancelDevProjects());

  async function load() {
    if (view.result || view.running) return;
    const out = unwrap(await api.lastDevProjects(), t('app.tab.dev', 'Developer'));
    if (out) view.result = out;
    render();
  }

  const tab = document.querySelector('.tab[data-tab="dev"]');
  if (tab) tab.addEventListener('click', load);
  onLanguageChange(render);
  Managed.onChange(render);

  window.devProjectsScreen = { load, run, view, render };
})();
