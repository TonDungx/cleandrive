'use strict';

/**
 * Moving files to another drive (B1), in the window: the Settings card, and
 * the state the "Move to D:" button on every action bar reads.
 *
 * The folder is picked, checked and made by the main process
 * (`quarantine:choose`); this only shows what it says. Until a folder is set,
 * the buttons say "Move to another drive" and lead here.
 */
(() => {
  const BUTTONS = ['quarantine-large', 'quarantine-cleanup', 'quarantine-dupes', 'media-quarantine'];
  const card = $('quarantine-card');
  const facts = $('quarantine-facts');
  const line = $('quarantine-status');
  const choose = $('quarantine-choose');
  const open = $('quarantine-open');
  const days = $('quarantine-days');
  const max = $('quarantine-max');
  const deleteOriginal = $('quarantine-delete-original');
  const title = () => t('settings.quarantine.title', 'Move to another drive');

  let status = null;

  const ready = () => Boolean(status && status.ok);
  const drive = () => (status && status.drive) || '';

  /** The buttons name the drive once there is somewhere to go. */
  function label() {
    const text = ready() ? t('quarantine.go', 'Move to {drive}', { drive: drive() }) : t('quarantine.goNowhere', 'Move to another drive');
    for (const id of BUTTONS) {
      const button = $(id);
      if (button) button.textContent = text;
    }
  }

  function changed() {
    label();
    document.dispatchEvent(new Event('quarantine-changed'));
  }

  const TYPE = {
    Fixed: ['quarantine.type.fixed', 'fixed drive'],
    Removable: ['quarantine.type.removable', 'removable drive'],
  };

  function draw() {
    if (!facts) return;
    facts.replaceChildren();
    const row = (labelText, value, hint) => {
      const li = document.createElement('li');
      li.className = 'pair-row';
      const left = document.createElement('span');
      left.className = 'pair-label';
      left.textContent = labelText;
      const right = document.createElement('span');
      right.className = 'pair-value';
      right.textContent = value;
      if (hint) right.title = hint;
      li.append(left, right);
      facts.append(li);
    };

    const s = status;
    if (!s || !s.zone) {
      line.textContent = t('settings.quarantine.none', 'No folder chosen yet. Choose one on a drive other than the one you want to free.');
      open.hidden = true;
    } else {
      row(t('settings.quarantine.folder', 'Folder'), s.zone, s.zone);
      if (s.ok) {
        const type = TYPE[s.type] ? t(TYPE[s.type][0], TYPE[s.type][1]) : s.type || '';
        row(
          t('settings.quarantine.drive', 'Drive'),
          t('settings.quarantine.driveValue', '{drive} · {type} · {free} free', { drive: s.drive, type, free: formatBytes(s.freeBytes) })
        );
        row(
          t('settings.quarantine.holds', 'In it'),
          t('settings.quarantine.holdsValue', '{n} {files} · {size}', {
            n: formatCount(s.files),
            files: word(s.files, 'app.file', 'file', 'files'),
            size: formatBytes(s.usedBytes),
          })
        );
      }
      const notes = [];
      if (!s.ok && s.reasonText) notes.push(s.reasonText);
      if (s.ok && s.onSystemDrive) {
        notes.push(
          t('settings.quarantine.systemDrive', 'This folder is on {drive}, the drive Windows is on. Files from {drive} cannot go here — that would free nothing.', { drive: s.drive })
        );
      }
      if (s.ok && s.type === 'Removable') {
        notes.push(t('settings.quarantine.removable', '{drive} is removable. If it is lost, so are the copies on it.', { drive: s.drive }));
      }
      if (s.expired > 0) {
        notes.push(
          t('settings.quarantine.expired', '{n} have been there longer than {days} days. Nothing is deleted — they are listed in Restore.', {
            n: formatCount(s.expired),
            days: s.retentionDays,
          })
        );
      }
      line.textContent = notes.join(' ');
      open.hidden = !s.ok;
    }
    choose.textContent = s && s.zone ? t('settings.quarantine.change', 'Change folder…') : t('settings.quarantine.choose', 'Choose folder…');
    if (s) {
      days.value = s.retentionDays;
      max.value = s.maxGB;
      deleteOriginal.checked = s.deleteOriginal === true;
    }
  }

  async function load() {
    const next = unwrap(await api.quarantineStatus(), title());
    if (!next) return;
    status = next;
    draw();
    changed();
  }

  choose.addEventListener('click', async () => {
    choose.disabled = true;
    try {
      const next = unwrap(await api.quarantineChoose(), title());
      if (!next) return;
      status = next;
      draw();
      changed();
      if (next.refusal) toast(next.refusal, true);
      else if (next.chosen) toast(t('settings.quarantine.chosen', 'Files moved to another drive will go to {zone}', { zone: next.zone }));
    } finally {
      choose.disabled = false;
    }
  });

  open.addEventListener('click', () => {
    if (status && status.zone) api.open(status.zone);
  });

  async function save() {
    const saved = unwrap(
      await api.saveSettings({
        quarantine: { retentionDays: Number(days.value), maxGB: Number(max.value), deleteOriginal: deleteOriginal.checked },
      }),
      title()
    );
    if (saved) await load();
  }
  days.addEventListener('change', save);
  max.addEventListener('change', save);
  deleteOriginal.addEventListener('change', save);

  /** Where the buttons send somebody who has not chosen a folder yet. */
  function showCard() {
    const tab = document.querySelector('.tab[data-tab="settings"]');
    if (tab) tab.click();
    card.scrollIntoView({ block: 'center' });
    choose.focus();
  }

  window.Quarantine = {
    ready,
    drive,
    deletesOriginals: () => Boolean(status && status.deleteOriginal),
    refresh: load,
    showCard,
    debug: () => ({ status }),
  };

  onLanguageChange(() => {
    draw();
    label();
  });
  load();
})();
