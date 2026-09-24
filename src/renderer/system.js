'use strict';

/**
 * The System screen (A1): where all of the system drive's space went.
 *
 * One bar for the whole drive -- your files, programs, Windows and the
 * system, free, and what nothing here accounts for -- and a card per row
 * under it. Every card is a candidate the main process built and validated,
 * so each says how it was measured and how sure the app is.
 *
 * The app never changes anything here. A row's button opens the Windows tool
 * that owns that space; a command is shown to copy, never run.
 *
 * Measuring reads every folder on the drive, which took about two minutes on
 * the drive this was built on, so it waits for a click and can be stopped.
 * Measuring with administrator rights raises one UAC prompt, and only when its
 * own button is pressed.
 */
(() => {
  const host = $('system-groups');
  if (!host) return;

  const view = { facts: null, result: null, running: null, open: new Set() };

  /* ---- words --------------------------------------------------------------- */

  // Title, what it is, and -- where there is one -- what doing something about
  // it costs. Keyed by row, so a language switch re-words them in place.
  const ROW_TEXT = {
    profile: () => [
      t('system.row.profile', 'Your profile'),
      t('system.row.profile.what', 'Everything in your user folder: documents, downloads, app data, and what OneDrive keeps on this computer.'),
      t('system.row.profile.then', 'Disk usage shows what is inside it, and What to delete what can go.'),
    ],
    profileSkipped: () => [
      t('system.row.profileSkipped', 'In your profile, left out of the other scans'),
      t('system.row.profileSkipped.what', 'Folders whose names start with a dot or $, and node_modules, .git, .venv and __pycache__. Developer tools keep caches, packages and downloaded models here.'),
      null,
    ],
    otherFolders: () => [
      t('system.row.otherFolders', 'Other folders at the top of the drive'),
      t('system.row.otherFolders.what', 'Folders made directly on the drive by programs or by you.'),
      null,
    ],
    otherAccounts: () => [
      t('system.row.otherAccounts', 'Other accounts and shared folders'),
      t('system.row.otherAccounts.what', 'Other people’s profiles on this computer, and the shared Public and Default folders.'),
      null,
    ],
    recycleBin: () => [
      t('system.row.recycleBin', 'Recycle Bin'),
      t('system.row.recycleBin.what', 'Files deleted from this drive that can still be put back. None of it is free space until the bin is emptied.'),
      null,
    ],
    programs: () => [
      t('system.row.programs', 'Installed programs'),
      t('system.row.programs.what', 'Program Files, Program Files (x86), and apps from the Microsoft Store.'),
      t('system.row.programs.then', 'Uninstall from Windows’ own list, so each program’s uninstaller removes what it installed.'),
    ],
    programData: () => [
      t('system.row.programData', 'Data programs share'),
      t('system.row.programData.what', 'ProgramData: settings, caches and databases programs keep for every account.'),
      t('system.row.programData.then', 'It belongs to the programs; uninstalling a program is what removes its part.'),
    ],
    windows: () => [
      t('system.row.windows', 'Windows'),
      t('system.row.windows.what', 'The rest of the Windows folder: the system itself, fonts, drivers in use, logs.'),
      null,
    ],
    winsxs: () => [
      t('system.row.winsxs', 'Component store (WinSxS)'),
      t('system.row.winsxs.what', 'Windows’ own copies of its components, used to repair and update it. Much of it is also in System32 under a second name.'),
      t('system.row.winsxs.then', 'Only Windows should clean it. The command below asks it to remove what updates have replaced; afterwards those updates can no longer be uninstalled.'),
    ],
    driverStore: () => [
      t('system.row.driverStore', 'Driver store'),
      t('system.row.driverStore.what', 'Every driver package installed on this computer, kept so a device can be set up again.'),
      t('system.row.driverStore.then', 'Removing packages from it can leave a device without its driver.'),
    ],
    installer: () => [
      t('system.row.installer', 'Windows Installer cache'),
      t('system.row.installer.what', 'Copies of installed programs’ setup packages. Windows needs them to repair or uninstall those programs.'),
      t('system.row.installer.then', 'Never delete these by hand: the programs they belong to may then refuse to uninstall.'),
    ],
    updateCache: () => [
      t('system.row.updateCache', 'Windows Update downloads'),
      t('system.row.updateCache.what', 'Update files Windows has downloaded, installed or about to be.'),
      t('system.row.updateCache.then', 'Disk Cleanup removes the ones no longer needed, under “Clean up system files”.'),
    ],
    deliveryOptimization: () => [
      t('system.row.deliveryOptimization', 'Delivery Optimization cache'),
      t('system.row.deliveryOptimization.what', 'Pieces of updates Windows keeps to share with other computers.'),
      t('system.row.deliveryOptimization.then', 'Its settings page can limit it and clear it.'),
    ],
    windowsOld: () => [
      t('system.row.windowsOld', 'Previous Windows installation'),
      t('system.row.windowsOld.what', 'Windows.old: the Windows this computer was upgraded from.'),
      t('system.row.windowsOld.then', 'Once it is removed, you can no longer go back to that version.'),
    ],
    upgrade: () => [
      t('system.row.upgrade', 'Upgrade and setup leftovers'),
      t('system.row.upgrade.what', 'Folders Windows setup and updates leave at the top of the drive, such as $WINDOWS.~BT and $WinREAgent.'),
      t('system.row.upgrade.then', 'Storage settings remove them, under temporary files, once Windows no longer needs them.'),
    ],
    recovery: () => [
      t('system.row.recovery', 'Recovery environment'),
      t('system.row.recovery.what', 'The tools Windows starts when it cannot start normally.'),
      null,
    ],
    systemHidden: () => [
      t('system.row.systemHidden', 'System Volume Information'),
      t('system.row.systemHidden.what', 'A folder no account may open, not even an administrator. Restore points are kept in it.'),
      null,
    ],
    hiberfil: () => [
      t('system.row.hiberfil', 'Hibernation file'),
      t('system.row.hiberfil.what', 'Where Windows writes memory when it hibernates, and what fast startup uses.'),
      t('system.row.hiberfil.then', 'Turning hibernation off removes the file, and with it hibernate and fast startup. The reduced type keeps fast startup and makes the file smaller. Both need a command prompt run as administrator.'),
    ],
    pagefile: () => [
      t('system.row.pagefile', 'Paging file'),
      t('system.row.pagefile.what', 'Memory Windows moves to disk when RAM is full.'),
      t('system.row.pagefile.then', 'Best left for Windows to size; the setting is under Virtual memory.'),
    ],
    swapfile: () => [
      t('system.row.swapfile', 'Swap file for Store apps'),
      t('system.row.swapfile.what', 'Paging space Windows keeps for apps from the Microsoft Store. It stays small.'),
      null,
    ],
    restorePoints: () => [
      t('system.row.restorePoints', 'Restore points'),
      t('system.row.restorePoints.what', 'Snapshots of system files that System Protection keeps, so the computer can be rolled back.'),
      t('system.row.restorePoints.then', 'System Protection sets how much space they may use, and can delete them — after which the computer cannot be rolled back to them.'),
    ],
    reservedStorage: () => [
      t('system.row.reservedStorage', 'Reserved storage'),
      t('system.row.reservedStorage.what', 'Space Windows holds back so updates can install, not yet used by any file.'),
      null,
    ],
    ntfsMetadata: () => [
      t('system.row.ntfsMetadata', 'File system index (MFT)'),
      t('system.row.ntfsMetadata.what', 'NTFS’s own record of every file and folder on the drive. It grows with the number of files.'),
      null,
    ],
  };

  const HANDOFF_LABEL = {
    powerOptions: () => t('system.handoff.powerOptions', 'Open Power Options'),
    virtualMemory: () => t('system.handoff.virtualMemory', 'Open Performance options'),
    systemProtection: () => t('system.handoff.systemProtection', 'Open System Protection'),
    diskCleanup: () => t('system.handoff.diskCleanup', 'Open Disk Cleanup'),
    recycleBin: () => t('system.handoff.recycleBin', 'Open the Recycle Bin'),
    storage: () => t('system.handoff.storage', 'Open Storage settings'),
    deliveryOptimization: () => t('system.handoff.deliveryOptimization', 'Open Delivery Optimization'),
    apps: () => t('system.handoff.apps', 'Open Installed apps'),
    otherUsers: () => t('system.handoff.otherUsers', 'Open account settings'),
  };

  const GROUPS = [
    ['yours', () => t('system.group.yours', 'Your files')],
    ['programs', () => t('system.group.programs', 'Programs')],
    ['windows', () => t('system.group.windows', 'Windows and the system')],
  ];

  const percent = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : '');

  /* ---- the bar ------------------------------------------------------------ */

  function renderBar(summary) {
    const total = summary.volume.totalBytes;
    const segments = [
      ['yours', summary.groups.yours, t('system.group.yours', 'Your files')],
      ['programs', summary.groups.programs, t('system.group.programs', 'Programs')],
      ['windows', summary.groups.windows, t('system.group.windows', 'Windows and the system')],
      ['free', summary.groups.free, t('system.free', 'Free')],
      ['unexplained', summary.groups.unexplained, t('system.unexplained', 'Not explained')],
    ];
    const bar = $('system-bar');
    const legend = $('system-legend');
    bar.replaceChildren();
    legend.replaceChildren();
    const described = [];
    for (const [key, bytes, label] of segments) {
      if (bytes <= 0) continue;
      const seg = document.createElement('span');
      seg.className = `system-seg system-seg-${key}`;
      seg.style.flexGrow = String(bytes);
      seg.title = `${label}: ${formatBytes(bytes)} (${percent(bytes, total)})`;
      bar.appendChild(seg);

      const li = document.createElement('li');
      li.className = 'system-legend-item';
      const swatch = document.createElement('span');
      swatch.className = `system-swatch system-seg-${key}`;
      const name = document.createElement('span');
      name.textContent = label;
      const size = document.createElement('span');
      size.className = 'system-legend-size';
      size.textContent = `${formatBytes(bytes)} · ${percent(bytes, total)}`;
      li.append(swatch, name, size);
      legend.appendChild(li);
      described.push(`${label} ${formatBytes(bytes)}`);
    }
    bar.setAttribute('aria-label', t('system.barLabel', '{drive} — {parts}', { drive: summary.drive, parts: described.join(', ') }));
  }

  /* ---- a row -------------------------------------------------------------- */

  function renderRow(row, summary) {
    const [title, what, then] = (ROW_TEXT[row.key] || (() => [row.key, '', null]))();
    const card = document.createElement('section');
    card.className = 'system-row';
    card.dataset.key = row.key;

    const head = document.createElement('div');
    head.className = 'system-row-head';
    const name = document.createElement('strong');
    name.textContent = title;
    const size = document.createElement('span');
    size.className = 'system-row-size';
    size.textContent = row.needsAdmin
      ? t('system.needsAdminShort', 'needs administrator rights')
      : `${formatBytes(row.size)}${row.refused > 0 ? ` ${t('system.atLeast', 'or more')}` : ''}`;
    const pill = evidencePill(row);
    const expanded = view.open.has(row.key);
    pill.setAttribute('aria-expanded', String(expanded));
    pill.addEventListener('click', () => {
      if (view.open.has(row.key)) view.open.delete(row.key);
      else view.open.add(row.key);
      render();
    });
    head.append(name, size, pill);
    card.appendChild(head);

    const whatEl = document.createElement('p');
    whatEl.className = 'system-row-what';
    whatEl.textContent = what;
    card.appendChild(whatEl);

    if (row.key === 'recycleBin' && row.appBytes > 0) {
      const own = document.createElement('p');
      own.className = 'system-row-then';
      own.textContent = t('system.row.recycleBin.app', '{size} of it the app put there; the Restore tab can put it back.', { size: formatBytes(row.appBytes) });
      card.appendChild(own);
    }
    if (then) {
      const thenEl = document.createElement('p');
      thenEl.className = 'system-row-then';
      thenEl.textContent = then;
      card.appendChild(thenEl);
    }

    if (row.parts && row.parts.length) {
      const list = document.createElement('ul');
      list.className = 'system-parts';
      for (const part of row.parts) {
        const li = document.createElement('li');
        const n = document.createElement('span');
        n.className = 'system-part-name';
        n.textContent = part.name || t('system.filesAtTop', '(files at the top of the drive)');
        n.title = n.textContent;
        const s = document.createElement('span');
        s.className = 'system-part-size';
        s.textContent = formatBytes(part.bytes);
        li.append(n, s);
        list.appendChild(li);
      }
      if (row.moreParts > 0) {
        const li = document.createElement('li');
        li.className = 'system-part-more';
        li.textContent = t('system.moreParts', 'and {n} more', { n: formatCount(row.moreParts) });
        list.appendChild(li);
      }
      card.appendChild(list);
    }

    for (const command of row.commands || []) {
      const box = document.createElement('div');
      box.className = 'system-command';
      const code = document.createElement('code');
      code.textContent = command;
      const copy = document.createElement('button');
      copy.className = 'btn btn-sm';
      copy.textContent = t('system.copy', 'Copy');
      copy.addEventListener('click', () => copyText(command, code));
      box.append(code, copy);
      card.appendChild(box);
    }

    const actions = document.createElement('div');
    actions.className = 'system-row-actions';
    if (row.handoff && HANDOFF_LABEL[row.handoff]) {
      const b = document.createElement('button');
      b.className = 'btn btn-sm';
      b.dataset.handoff = row.handoff;
      b.textContent = HANDOFF_LABEL[row.handoff]();
      b.addEventListener('click', async () => {
        const out = unwrap(await api.handoff(row.handoff), t('system.handoffLabel', 'Open'));
        if (out && out.failed && out.failed.length) toast(out.failed[0].error, true);
      });
      actions.appendChild(b);
    }
    if (row.key === 'profile' && summary.profile) {
      const b = document.createElement('button');
      b.className = 'btn btn-sm';
      b.textContent = t('system.openInUsage', 'Look inside with Disk usage');
      b.addEventListener('click', () => {
        setFolder(summary.profile);
        document.querySelector('.tab[data-tab="usage"]').click();
      });
      actions.appendChild(b);
    }
    if (row.key === 'recycleBin' && row.appBytes > 0) {
      const b = document.createElement('button');
      b.className = 'btn btn-sm';
      b.textContent = t('system.openRestore', 'Open Restore');
      b.addEventListener('click', () => document.querySelector('.tab[data-tab="restore"]').click());
      actions.appendChild(b);
    }
    if (actions.childElementCount) card.appendChild(actions);

    if (expanded) card.appendChild(EvidencePanel(row));
    return card;
  }

  async function copyText(text, fallbackNode) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('system.copied', 'Copied: {text}', { text }));
    } catch {
      // No clipboard access: select it, so Ctrl+C does the rest.
      const range = document.createRange();
      range.selectNodeContents(fallbackNode);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      toast(t('system.copySelect', 'Selected — press Ctrl+C to copy it'));
    }
  }

  /* ---- the screen --------------------------------------------------------- */

  function renderFacts() {
    const f = view.facts;
    if (!f || !f.volume || !f.volume.ok) return;
    $('sstat-total').textContent = formatBytes(f.volume.totalBytes);
    $('sstat-used').textContent = formatBytes(f.volume.usedBytes);
    $('sstat-free').textContent = formatBytes(f.volume.freeBytes);
    $('system-drive').textContent = f.drive;
  }

  function render() {
    renderFacts();
    const result = view.result;
    const running = Boolean(view.running);
    $('system-measure').disabled = running;
    $('system-elevated').disabled = running;
    $('system-cancel').hidden = view.running !== 'walk';
    $('system-progress').hidden = !running;

    if (!result) {
      $('system-bar-card').hidden = true;
      host.replaceChildren();
      $('sstat-unexplained').textContent = '–';
      if (!running) {
        $('system-status').textContent = t('system.ready', 'Measuring reads every folder on the drive. It can take a few minutes, and it can be stopped.');
      }
      return;
    }

    const { summary } = result;
    const byId = indexCandidates(result.candidates);
    const rows = viewsOf(summary.rows, byId);

    $('sstat-unexplained').textContent = formatBytes(summary.unexplainedBytes);
    $('system-bar-card').hidden = false;
    renderBar(summary);

    const notes = [];
    if (summary.walk.cancelled) notes.push(t('system.note.cancelled', 'The measurement was stopped, so part of the drive was not read and is counted as not explained.'));
    if (!summary.elevated && summary.walk.refused > 0) {
      notes.push(t('system.note.refused', '{n} folders could not be read without administrator rights. Until they are measured, what is in them is part of “Not explained”.', { n: formatCount(summary.walk.refused) }));
    }
    if (summary.elevated) {
      notes.push(t('system.note.elevated', 'Measured with administrator rights {when}: {size} more was found in folders a normal program may not read.', {
        when: formatAgo(summary.elevated.at),
        size: formatBytes(summary.elevated.addedBytes),
      }));
    }
    notes.push(t('system.note.unexplained', '“Not explained” is what the drive reports as used and nothing here accounts for: folders no account may open, files that came or went while the drive was being read, and file-system structures Windows does not report.'));
    $('system-note').replaceChildren(...notes.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));

    const nodes = [];
    for (const [key, label] of GROUPS) {
      const inGroup = rows.filter((r) => r.group === key).sort((a, b) => b.size - a.size);
      if (!inGroup.length) continue;
      const section = document.createElement('section');
      section.className = 'system-group';
      section.dataset.group = key;
      const h = document.createElement('h2');
      h.className = 'system-group-title';
      h.textContent = `${label()} · ${formatBytes(summary.groups[key])}`;
      section.appendChild(h);
      for (const row of inGroup) section.appendChild(renderRow(row, summary));
      nodes.push(section);
    }
    host.replaceChildren(...nodes);

    if (!running) {
      $('system-status').textContent = t('system.done', 'Read {files} files in {folders} folders in {time}.', {
        files: formatCount(summary.walk.files),
        folders: formatCount(summary.walk.dirs),
        time: formatSeconds(summary.walk.durationMs),
      });
    }
  }

  const PHASES = {
    prompt: () => t('system.phase.prompt', 'Waiting for the administrator prompt…'),
    dism: () => t('system.phase.tools', 'Asking Windows about restore points, the component store and the file system…'),
    folders: (p) => t('system.phase.folders', 'Measuring {n} folders Windows keeps from normal programs…', { n: formatCount(p.count || 0) }),
    tools: () => t('system.phase.tools', 'Asking Windows about restore points, the component store and the file system…'),
    'dism-wait': () => t('system.phase.dism', 'Waiting for DISM to measure the component store — this can take a minute or two…'),
  };

  api.onSystemProgress((p) => {
    if (p.phase === 'walking') {
      $('system-status').textContent = t('system.walking', 'Reading the drive… {files} files, {folders} folders ({time})', {
        files: formatCount(p.files),
        folders: formatCount(p.dirs),
        time: formatSeconds(p.elapsedMs),
      });
    } else if (PHASES[p.phase]) {
      $('system-status').textContent = PHASES[p.phase](p);
    }
  });

  async function run(kind) {
    view.running = kind;
    render();
    let out;
    try {
      out = unwrap(kind === 'walk' ? await api.measureSystem() : await api.measureSystemElevated(), t('app.tab.system', 'System'));
    } finally {
      view.running = null;
    }
    if (out) {
      if (out.declined) toast(t('system.declined', 'The administrator prompt was declined, so nothing more was measured.'));
      view.result = { candidates: out.candidates, summary: out.summary };
    }
    render();
  }

  $('system-measure').addEventListener('click', () => run('walk'));
  $('system-elevated').addEventListener('click', () => run('elevated'));
  $('system-cancel').addEventListener('click', () => api.cancelSystem());

  async function load() {
    const facts = unwrap(await api.systemFacts(), t('app.tab.system', 'System'));
    if (!facts) return;
    view.facts = facts;
    if (facts.last && !view.result) view.result = facts.last;
    render();
  }

  const tab = document.querySelector('.tab[data-tab="system"]');
  if (tab) tab.addEventListener('click', load);
  onLanguageChange(render);

  window.systemScreen = { load, run, view };
})();
