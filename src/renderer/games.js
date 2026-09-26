'use strict';

/**
 * The Games screen (D2): the Steam library, and the two kinds of leftover
 * Steam keeps no account of.
 *
 * The whole screen is a Pro feature, so the main process answers `locked`
 * rather than rows when the licence does not include it, and this draws the
 * reason instead of an empty table.
 *
 * Two things here are easy to undo by accident:
 *
 * **A game's size is Steam's own figure, and it is exact.** Every game was
 * walked and compared on the machine this was built on and the ratio was
 * 1.000, which is why there is one size column here and two on the installed
 * apps screen.
 *
 * **A leftover's size is what it occupies, not what it claims.** Steam makes
 * a file its finished size before downloading it, so one 7.6 GB file here
 * holds nothing at all. The rows show the allocation; `bytesOnDisk` is where
 * that lives.
 */
(() => {
  const host = $('games-list');
  if (!host) return;

  const view = { result: null, running: false, open: new Set() };

  /* ---- words --------------------------------------------------------------- */

  const PHASES = {
    finding: () => t('games.phase.finding', 'Looking for Steam…'),
    libraries: () => t('games.phase.libraries', 'Reading which folders Steam keeps games in…'),
    manifests: () => t('games.phase.manifests', 'Reading what is installed…'),
    played: () => t('games.phase.played', 'Reading when each game was last played…'),
    leftovers: () => t('games.phase.leftovers', 'Measuring what Steam left behind…'),
  };

  /** What a row shows for a size: the allocation where the two differ. */
  const sizeOf = (row) => (Number.isFinite(row.bytesOnDisk) ? row.bytesOnDisk : row.size);

  /* ---- a game row ---------------------------------------------------------- */

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
    head.className = 'games-row games-head';
    head.setAttribute('role', 'row');
    for (const [className, label, title] of [
      ['games-col-name', t('games.col.name', 'Game'), null],
      ['games-col-size', t('games.col.size', 'On disk'), t('games.col.size.what', 'As Steam records it. Checked against a real measurement on this machine and found exact.')],
      ['games-col-when', t('games.col.played', 'Last played'), t('games.col.played.what', 'The later of what Steam wrote beside the game and what each account on this machine recorded.')],
      ['games-col-badge', '', null],
      ['games-col-actions', '', null],
    ]) {
      const el = cell(`${className} games-headcell`, label, title);
      el.setAttribute('role', 'columnheader');
      head.appendChild(el);
    }
    return head;
  }

  function evidenceRowFor(row) {
    const panel = document.createElement('div');
    panel.className = 'games-evidence-row';
    panel.setAttribute('role', 'row');
    const inner = document.createElement('div');
    inner.className = 'games-evidence-cell';
    inner.setAttribute('role', 'cell');
    inner.appendChild(EvidencePanel(row));
    panel.appendChild(inner);
    return panel;
  }

  function badgeFor(row) {
    // A verdict the app has an opinion about wears it; a plain `keep` shows
    // only how sure the size is, the way the installed apps screen does.
    const pill = row.verdict === 'review' || row.verdict === 'protected'
      ? evidencePill(row)
      : evidencePill(row, { verdict: false, className: 'badge badge-confidence badge-button' });
    pill.setAttribute('aria-expanded', String(view.open.has(row.id)));
    pill.addEventListener('click', () => {
      if (view.open.has(row.id)) view.open.delete(row.id);
      else view.open.add(row.id);
      render();
    });
    return pill;
  }

  function renderGame(row) {
    const el = document.createElement('div');
    el.className = 'games-row';
    el.setAttribute('role', 'row');

    const name = document.createElement('span');
    name.className = 'games-col-name';
    name.setAttribute('role', 'cell');
    const title = document.createElement('strong');
    title.className = 'games-name';
    title.textContent = row.name;
    title.title = row.path;
    const sub = document.createElement('span');
    sub.className = 'games-library';
    sub.textContent = row.library;
    name.append(title, sub);
    el.appendChild(name);

    el.appendChild(cell('games-col-size', formatBytes(row.size)));
    el.appendChild(cell('games-col-when', row.lastPlayedAt ? formatAgo(row.lastPlayedAt) : t('games.neverPlayed', 'no record'),
      row.lastPlayedAt && row.playedSource === 'account'
        ? t('games.viaAccount', 'From a Steam account’s own record')
        : ''));

    const badge = document.createElement('span');
    badge.className = 'games-col-badge';
    badge.setAttribute('role', 'cell');
    badge.appendChild(badgeFor(row));
    el.appendChild(badge);

    const actions = document.createElement('span');
    actions.className = 'games-col-actions';
    actions.setAttribute('role', 'cell');
    // Steam's own shared runtime carries no handoff: there is nothing to
    // suggest doing about it, and a button would be suggesting it.
    if (!row.handoff) {
      const why = document.createElement('span');
      why.className = 'games-protection';
      why.textContent = t('games.sharedRuntime', 'Shared by other games');
      actions.appendChild(why);
      el.appendChild(actions);
      return el;
    }
    const uninstall = document.createElement('button');
    uninstall.className = 'btn btn-sm';
    uninstall.textContent = t('games.uninstall', 'Uninstall in Steam…');
    uninstall.addEventListener('click', async () => {
      const out = unwrap(await api.handoff(row.handoff), t('app.tab.games', 'Games'));
      if (out && out.failed && out.failed.length) toast(out.failed[0].error, true);
      else toast(t('games.handedOver', 'Steam was asked to uninstall {name}. Steam does the removing, and asks you first.', { name: row.name }));
    });
    actions.appendChild(uninstall);
    if (row.path) {
      const reveal = document.createElement('button');
      reveal.className = 'btn btn-sm btn-quiet';
      reveal.textContent = t('games.reveal', 'Open folder');
      reveal.addEventListener('click', () => api.reveal(row.path));
      actions.appendChild(reveal);
    }
    el.appendChild(actions);

    return el;
  }

  /* ---- the leftovers ------------------------------------------------------- */

  function renderLeftovers(summary, byId) {
    const orphans = viewsOf(summary.rows.orphans, byId);
    const downloads = viewsOf(summary.rows.downloads, byId);
    const card = $('games-leftovers-card');
    if (orphans.length === 0 && downloads.length === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const notes = [];
    if (downloads.length) {
      notes.push(t('games.leftovers.downloads', '{size} in {n} files from downloads that did not finish. Steam fetches any of it again if it turns out to be needed.', {
        size: formatBytes(downloads.reduce((sum, row) => sum + sizeOf(row), 0)),
        n: formatCount(downloads.length),
      }));
    }
    if (summary.emptyReservations > 0) {
      notes.push(t('games.leftovers.reserved', '{n} more files are set aside at their finished size with nothing written into them yet, so they occupy nothing and are not listed.', {
        n: formatCount(summary.emptyReservations),
      }));
    }
    if (orphans.length) {
      notes.push(t('games.leftovers.orphans', '{n} folders in Steam’s games folder are claimed by no installed game. Check each one in Steam before removing it yourself — the app will not delete a folder.', {
        n: formatCount(orphans.length),
      }));
    }
    if (summary.steamRunning === true) {
      notes.push(t('games.leftovers.steamOpen', 'Steam is open, so none of this is offered for removal. Close Steam and look again.'));
    } else if (summary.steamRunning === null) {
      notes.push(t('games.leftovers.steamUnknown', 'Whether Steam is running could not be checked, so none of this is offered for removal.'));
    }
    setText($('games-leftovers-what'), notes.join(' '));

    const rows = [...orphans, ...downloads].sort((a, b) => sizeOf(b) - sizeOf(a));
    const nodes = [];
    for (const row of rows.slice(0, 200)) {
      const el = document.createElement('div');
      el.className = 'games-leftover';
      const name = document.createElement('span');
      name.className = 'games-leftover-name';
      name.textContent = row.name || row.path;
      name.title = row.path;
      const size = document.createElement('span');
      size.className = 'games-leftover-size';
      size.textContent = formatBytes(sizeOf(row));
      const badge = badgeFor(row);
      el.append(name, size, badge);
      nodes.push(el);
      if (view.open.has(row.id)) nodes.push(evidenceRowFor(row));
    }
    if (rows.length > 200) {
      const more = document.createElement('p');
      more.className = 'games-leftover-more';
      more.textContent = t('games.leftovers.more', 'and {n} more', { n: formatCount(rows.length - 200) });
      nodes.push(more);
    }
    replaceChildrenIfChanged($('games-leftovers'), nodes);
  }

  /* ---- the screen ---------------------------------------------------------- */

  function renderNotes(summary) {
    const notes = [];
    if (summary.cancelled) notes.push(t('games.note.cancelled', 'The scan was stopped part-way.'));
    if (summary.librariesMissing && summary.librariesMissing.length) {
      notes.push(t('games.note.missingLibrary', 'Steam lists a games folder on {where}, which is not attached. Games in it are not counted here.', {
        where: summary.librariesMissing.join(', '),
      }));
    }
    if (summary.accounts && summary.accounts.total > 0) {
      notes.push(t('games.note.accounts', 'When each game was last played is the later of what Steam wrote beside the game and what each of the {n} Steam accounts on this machine recorded. Only that one date is read from them.', {
        n: formatCount(summary.accounts.total),
      }));
    }
    notes.push(t('games.note.neverDeletes', 'The app never removes a game. Deleting a game’s folder leaves Steam still listing it, and it would fail to start — so Steam is asked to do it.'));

    const note = $('games-note');
    note.hidden = notes.length === 0;
    replaceChildrenIfChanged(note, notes.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
  }

  function render() {
    $('games-scan').disabled = view.running;
    $('games-cancel').hidden = !view.running;
    $('games-progress').hidden = !view.running;

    const result = view.result;
    if (!result || !result.summary) {
      $('games-stats').hidden = true;
      $('games-note').hidden = true;
      $('games-leftovers-card').hidden = true;
      host.replaceChildren();
      if (!view.running) {
        setText($('games-status'), result && result.locked
          ? t('games.needsPro', 'The games library is part of Pro.')
          : result && result.steam && !result.steam.installed
            ? t('games.noSteam', 'No Steam installation was found on this computer. Only Steam is read here.')
            : t('games.ready', 'Reads Steam’s own files to list what is installed, how big each game is, and when it was last played.'));
      }
      return;
    }

    const { summary } = result;
    const byId = indexCandidates(result.candidates);
    const games = viewsOf(summary.rows.games, byId);
    const stale = games.filter((row) => row.verdict === 'review');

    $('games-stats').hidden = false;
    setText($('gstat-count'), formatCount(games.length));
    setText($('gstat-size'), formatBytes(summary.totalGameBytes));
    setText($('gstat-stale'), formatCount(stale.length));
    setText($('gstat-leftovers'), formatBytes(summary.totalDownloadBytes + summary.totalOrphanBytes));

    renderNotes(summary);

    const nodes = [renderHead()];
    for (const row of [...games].sort((a, b) => b.size - a.size)) {
      nodes.push(renderGame(row));
      if (view.open.has(row.id)) nodes.push(evidenceRowFor(row));
    }
    replaceChildrenIfChanged(host, nodes);

    renderLeftovers(summary, byId);

    if (!view.running) {
      setText($('games-status'), t('games.done', '{n} games, {size}, in {time}.', {
        n: formatCount(games.length),
        size: formatBytes(summary.totalGameBytes),
        time: formatSeconds(summary.durationMs),
      }));
    }
  }

  api.onGamesProgress((p) => {
    if (PHASES[p.phase]) setText($('games-status'), PHASES[p.phase]());
  });

  async function run() {
    view.running = true;
    view.open.clear();
    render();
    let out;
    try {
      out = unwrap(await api.scanGames(), t('app.tab.games', 'Games'));
    } finally {
      view.running = false;
    }
    if (out) view.result = out;
    render();
    announce($('games-status').textContent);
  }

  $('games-scan').addEventListener('click', run);
  $('games-cancel').addEventListener('click', () => api.cancelGames());

  async function load() {
    if (view.result || view.running) return;
    const out = unwrap(await api.lastGames(), t('app.tab.games', 'Games'));
    if (out) view.result = out;
    render();
  }

  const tab = document.querySelector('.tab[data-tab="games"]');
  if (tab) tab.addEventListener('click', load);
  onLanguageChange(render);

  window.gamesScreen = { load, run, view, render };
})();
