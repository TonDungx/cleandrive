'use strict';

/**
 * Several folders at once, and whole drives (A4).
 *
 * Loaded after app.js and sharing its globals. The folders chosen are
 * `state.roots`, and app.js's `setRoots()` is the one way they change. This
 * file adds to them, offers a drive to scan whole, and draws the folders on
 * the Disk usage screen with what the app may do on each: a folder on a
 * network drive is read and nothing is offered there, and the row says so
 * before anybody wonders why nothing can be ticked.
 */
(function () {
  const FEATURE = 'pro.scan.multiroot';
  const list = $('scan-roots');
  const hint = $('roots-hint');
  const dialog = $('drives');

  /** What the last scan learnt about each folder, by lower-case path. */
  let learnt = new Map();

  const keyOf = (p) => String(p).toLowerCase();
  const looksNetwork = (p) => /^\\\\/.test(p) && !/^\\\\[?.]\\[a-z]:/i.test(p);

  /** The reason the feature is closed, as an element, or null when it is open. */
  async function locked() {
    await loadEntitlements();
    return UpgradeHint(FEATURE, t('roots.upgrade', 'Scanning several folders at once, or a whole drive, is part of CleanDrive Pro.'));
  }

  function showHint(el) {
    hint.replaceChildren(...(el ? [el] : []));
    hint.hidden = !el;
  }

  async function add() {
    const refusal = await locked();
    if (refusal) {
      document.querySelector('.tab[data-tab="usage"]').click();
      showHint(refusal);
      return;
    }
    const folder = unwrap(await api.pickFolder(), t('app.label.folderPicker', 'Folder picker'));
    if (folder) setRoots([...state.roots, folder]);
  }

  function remove(root) {
    setRoots(state.roots.filter((r) => keyOf(r) !== keyOf(root)));
  }

  /* ---- the folders, as the screen shows them ---------------------------- */

  function badgeOf(info) {
    if (info.merged) return t('roots.badge.merged', 'inside {into}, scanned with it', { into: elide(info.merged, 32) });
    if (info.readOnly === 'network') return t('roots.badge.network', 'network drive · read only');
    if (info.readOnly === 'removable') return t('roots.badge.removable', 'removable drive · read only');
    if (info.readOnly === 'cdrom') return t('roots.badge.cdrom', 'disc · read only');
    if (info.external) return t('roots.badge.external', 'external drive · {bus}', { bus: info.bus || '?' });
    return null;
  }

  function chip(info, removable) {
    const li = document.createElement('li');
    li.className = 'root-chip';
    const name = document.createElement('span');
    name.className = 'root-name';
    name.textContent = elide(info.root, 56);
    name.title = info.root;
    li.appendChild(name);

    const badge = badgeOf(info);
    if (badge) {
      const b = document.createElement('span');
      b.className = `root-badge${info.readOnly ? ' is-readonly' : ''}`;
      b.textContent = badge;
      li.appendChild(b);
    }

    if (removable) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'root-remove';
      x.textContent = '×';
      x.title = t('roots.remove', 'Leave {root} out', { root: info.root });
      x.setAttribute('aria-label', x.title);
      x.addEventListener('click', () => remove(info.root));
      li.appendChild(x);
    }
    return li;
  }

  function render() {
    const roots = state.roots || [];
    $('add-folder').hidden = roots.length === 0;
    showHint(null);
    const infos = roots.map((root) => learnt.get(keyOf(root)) || {
      root,
      readOnly: looksNetwork(root) ? 'network' : null,
      external: false,
    });
    const shown = roots.length > 1 || infos.some((info) => badgeOf(info));
    list.hidden = !shown;
    replaceChildrenIfChanged(list, shown ? infos.map((info) => chip(info, roots.length > 1)) : []);
  }

  /** After a scan: what each folder turned out to be on. */
  function describe(result) {
    learnt = new Map();
    for (const info of result.roots || []) learnt.set(keyOf(info.root), { ...info });
    for (const { root, into } of result.merged || []) learnt.set(keyOf(root), { root, merged: into });
    render();
  }

  /* ---- a whole drive ------------------------------------------------------ */

  function kindOf(drive) {
    if (drive.readOnly === 'removable') return t('roots.drives.removable', 'removable · read only');
    if (drive.external) return t('roots.drives.external', 'external · {bus}', { bus: drive.bus || '?' });
    return drive.bus || null;
  }

  function driveRow(drive) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'drive-option';
    const name = document.createElement('span');
    name.className = 'drive-name';
    name.textContent = drive.label ? `${drive.volume} ${drive.label}` : drive.volume;
    const facts = document.createElement('span');
    facts.className = 'drive-facts';
    facts.textContent = [
      t('roots.drives.free', '{free} free of {total}', { free: formatBytes(drive.freeBytes), total: formatBytes(drive.totalBytes) }),
      kindOf(drive),
    ].filter(Boolean).join(' · ');
    button.append(name, facts);
    button.addEventListener('click', () => {
      dialog.close();
      setRoots([drive.root]);
      document.querySelector('.tab[data-tab="usage"]').click();
      if ($('cancel-scan').hidden) $('run-scan').click();
    });
    li.appendChild(button);
    return li;
  }

  async function pickDrive() {
    const refusal = await locked();
    if (refusal) {
      document.querySelector('.tab[data-tab="usage"]').click();
      showHint(refusal);
      return;
    }
    const drives = unwrap(await api.scanDrives(), t('roots.drives.title', 'Scan a whole drive'));
    if (!drives) return;
    const host = $('drives-list');
    if (drives.length === 0) {
      const none = document.createElement('li');
      none.className = 'path-empty';
      none.textContent = t('roots.drives.none', 'Windows listed no drive that can be scanned.');
      host.replaceChildren(none);
    } else {
      host.replaceChildren(...drives.map(driveRow));
    }
    dialog.showModal();
    const first = host.querySelector('button');
    if (first) first.focus();
  }

  $('add-folder').addEventListener('click', add);
  $('pick-drive').addEventListener('click', pickDrive);
  $('drives-close').addEventListener('click', () => dialog.close());

  onLanguageChange(render);

  window.Roots = { render, describe, add, pickDrive };
})();
