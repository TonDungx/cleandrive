'use strict';

/**
 * Joining duplicate copies into one file (F4), from the window's side.
 *
 * Three pieces that belong together and are in one file for that reason: the
 * switch in Settings, the button on the Duplicates screen that the switch
 * reveals, and the confirmation between them.
 *
 * ## Why this dialog is not a native one
 *
 * Every other confirmation in this app is `dialog.showMessageBox`, drawn by
 * Windows. The roadmap asks this one for something a message box cannot do:
 * an explanation that has to be scrolled all the way through before the
 * button will work. So it is an HTML `<dialog>`, and the gate below watches
 * the text actually reach its end.
 *
 * The gate is deliberately not a checkbox saying "I have read this". A
 * checkbox is one click whether or not anybody read anything; scrolling to
 * the bottom at least means the words went past. It is not proof and is not
 * claimed to be -- what it buys is that nobody joins a thousand files by
 * double-clicking through a dialog they never saw the shape of.
 *
 * ## The text is in the markup; the numbers are built here
 *
 * `translateDom` only translates text that is in the HTML, so everything with
 * a count in it is written here and re-written on a language change. And no
 * element this file writes into carries `data-i18n`: that attribute would wipe
 * what was written the moment somebody switched language, which this project
 * has now walked into three times.
 */
(() => {
  const box = $('developer-hardlink');
  const state = $('developer-hardlink-state');
  const button = $('hardlink-dupes');
  const dialog = $('hardlink');
  if (!box || !button || !dialog) return;

  const body = $('hardlink-body');
  const go = $('hardlink-go');
  const cancel = $('hardlink-cancel');
  const lead = $('hardlink-lead');
  const list = $('hardlink-list');
  const refusals = $('hardlink-refusals');
  const end = $('hardlink-end');

  /** What the switch says right now, so a language change can redraw it. */
  let enabled = false;
  /** The plan the dialog is showing, kept for the language change too. */
  let showing = null;
  let scrolled = false;

  /* ------------------------------------------------------------ the switch */

  /**
   * Whether the button is *usable* belongs to the action bar, which already
   * decides it for every other button by the same rule -- offered only when
   * every ticked row allows it. All this file decides is whether the button
   * exists at all, because a greyed-out button for something this heavy is an
   * invitation to go and find out what it does.
   */
  function drawSwitch() {
    box.checked = enabled;
    state.textContent = enabled
      ? t('developer.hardlink.on', 'On. The Duplicates screen has a “Join into one file” button.')
      : t('developer.hardlink.off', 'Off. Nothing on the Duplicates screen can join anything.');
    button.hidden = !enabled;
    if (!enabled) button.disabled = true;

    /*
     * A third button is what makes this bar too wide for one line, so the
     * class that wraps it goes on and off with the button.
     *
     * The Photos bar already carries this class for the same reason and by
     * measurement: at 1180px with two extra buttons, its delete button was off
     * the edge of the window. The screenshots of this feature showed exactly
     * that here -- "Move selected to Recycle Bin" clipped by the right edge at
     * 1180px -- which is why it is set rather than assumed unnecessary.
     */
    const bar = document.getElementById('dupes-actionbar');
    if (bar) bar.classList.toggle('is-crowded', enabled);
  }

  async function load() {
    // `settings:get` answers with the whole state -- settings, warnings, the
    // task status -- so the settings themselves are one level in.
    const state = unwrap(await api.getSettings(), t('developer.title', 'Developer'));
    if (!state || !state.settings) return;
    enabled = Boolean(state.settings.developer && state.settings.developer.hardlink);
    drawSwitch();
  }

  box.addEventListener('change', async () => {
    const want = box.checked;
    box.disabled = true;
    const saved = unwrap(
      await api.saveSettings({ developer: { hardlink: want } }),
      t('app.label.saveSettings', 'Save settings')
    );
    box.disabled = false;
    if (!saved || !saved.settings) {
      // The save was refused: the box goes back to what is actually stored,
      // rather than showing a state nothing is in.
      box.checked = enabled;
      return;
    }
    enabled = Boolean(saved.settings.developer && saved.settings.developer.hardlink);
    drawSwitch();
    announce(state.textContent);
  });

  /* ------------------------------------------------- what is selected, now */

  /**
   * The ticked copies this action can act on, each with the copy it would be
   * joined to. `app.js` owns the pairing, because it owns the model the
   * Duplicates screen is drawn from.
   *
   * Everything here is about what to *show*. The main process checks all of it
   * again -- and re-reads and re-hashes both files -- before anything is
   * joined, so nothing safe rests on this being right.
   */
  function pairsForSelection() {
    return typeof window.selectedDupePairs === 'function' ? window.selectedDupePairs() : [];
  }

  /* ------------------------------------------------------------ the dialog */

  function drawDialog() {
    if (!showing) return;
    const { plan, description } = showing;

    go.textContent = t('hardlink.dialog.go', 'Join {n} into one file', { n: formatCount(plan.length) });
    lead.textContent = t(
      'hardlink.dialog.lead',
      '{n} of the copies you picked can be joined, freeing {size}. Read to the end to continue.',
      { n: formatCount(plan.length), size: formatBytes(description.freedBytes || 0) }
    );

    list.replaceChildren();
    for (const item of plan.slice(0, 40)) {
      const row = document.createElement('p');
      row.className = 'hardlink-row';
      const gone = document.createElement('span');
      gone.className = 'hardlink-row-copy';
      gone.textContent = item.path;
      const arrow = document.createElement('span');
      arrow.className = 'hardlink-row-arrow';
      arrow.textContent = t('hardlink.dialog.becomes', 'becomes another name for');
      const kept = document.createElement('span');
      kept.className = 'hardlink-row-keeper';
      kept.textContent = item.keeper;
      row.append(gone, arrow, kept);
      list.appendChild(row);
    }
    if (plan.length > 40) {
      const more = document.createElement('p');
      more.className = 'card-note';
      more.textContent = t('hardlink.dialog.more', '…and {n} more', { n: formatCount(plan.length - 40) });
      list.appendChild(more);
    }

    // Why anything was left out, in words rather than as a number on its own.
    //
    // A switch and not a table, because `test:i18n` reads the source for keys
    // written out as string literals, and a key held in a variable is
    // invisible to it -- which is how a string reaches Vietnamese users in
    // English.
    const why = [];
    for (const [code, count] of Object.entries(description.refusedBy || {})) {
      if (!count) continue;
      const n = formatCount(count);
      // The only one of these with a countable noun in English, so the only
      // one that reads wrong at one: the smoke log printed "1 documents".
      if (code === 'EREPLACEDONSAVE') {
        why.push(
          t('hardlink.refused.office', '{n} {docs} (Word, Excel and the like)', {
            n,
            docs: word(count, 'hardlink.doc', 'document', 'documents'),
          })
        );
      }
      else if (code === 'ESYNCED') why.push(t('hardlink.refused.synced', '{n} inside a sync folder', { n }));
      else if (code === 'EPHOTOS') why.push(t('hardlink.refused.photos', '{n} in a folder the Photos screen manages', { n }));
      else if (code === 'EXDEV') why.push(t('hardlink.refused.otherVolume', '{n} on another drive', { n }));
      else if (code === 'ENOTNTFS') why.push(t('hardlink.refused.notNtfs', '{n} on a drive that is not NTFS', { n }));
      else if (code === 'EDIFFERS') why.push(t('hardlink.refused.differs', '{n} that are no longer identical', { n }));
      else if (code === 'ESYSTEM') why.push(t('hardlink.refused.system', '{n} in a Windows system location', { n }));
      else if (code === 'EPROGRAM') why.push(t('hardlink.refused.program', '{n} belonging to an installed program', { n }));
      else if (code === 'ENETWORK') why.push(t('hardlink.refused.network', '{n} on the network', { n }));
      else why.push(t('hardlink.refused.other', '{n} skipped', { n }));
    }
    if (description.alreadyJoined > 0) {
      why.push(t('hardlink.refused.already', '{n} already one file', { n: formatCount(description.alreadyJoined) }));
    }
    refusals.hidden = why.length === 0;
    refusals.textContent = why.length === 0 ? '' : t('hardlink.refused.head', 'Left alone: {list}.', { list: why.join(' · ') });

    end.textContent = scrolled
      ? t('hardlink.dialog.readEnd', 'That is all of it. The button is now active.')
      : t('hardlink.dialog.keepReading', 'Keep scrolling — the button turns on at the end.');
    go.disabled = !scrolled;
  }

  /**
   * Has the text actually reached its end?
   *
   * The two-pixel slack is for fractional scroll heights, which a zoomed
   * window and a high-DPI screen both produce; without it the last pixel is
   * unreachable and the button never turns on. A body short enough not to
   * scroll at all counts as read, because there was nothing to scroll past.
   */
  function atEnd() {
    return body.scrollHeight - body.clientHeight - body.scrollTop <= 2;
  }

  body.addEventListener('scroll', () => {
    if (scrolled || !atEnd()) return;
    scrolled = true;
    go.disabled = false;
    end.textContent = t('hardlink.dialog.readEnd', 'That is all of it. The button is now active.');
    announce(end.textContent);
  });

  const close = () => {
    showing = null;
    if (dialog.open) dialog.close();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    showing = null;
  });

  /* ------------------------------------------------------------ doing it */

  button.addEventListener('click', async () => {
    const pairs = pairsForSelection();
    if (pairs.length === 0) return;
    if (Managed.refuseIfHeld('hardlink')) return;

    const keepers = {};
    for (const pair of pairs) keepers[pair.path] = pair.keeper;
    const paths = pairs.map((p) => p.path);

    // A dry run first: the dialog's numbers are the main process's answer
    // about these exact files as they are now, not the window's arithmetic
    // over a scan that may be an hour old.
    progressPanel.show(t('hardlink.checking', 'Checking which copies can be joined'));
    let probe;
    try {
      probe = unwrap(await api.hardlink(paths, { keepers, dryRun: true }), t('hardlink.button', 'Join into one file'));
    } finally {
      progressPanel.hide();
    }
    if (!probe) return;

    const description = probe.description || {};
    const plan = (description.files || []).map((f) => ({ path: f.path, keeper: f.keeper, bytes: f.bytes }));
    if (plan.length === 0) {
      toast(
        description.alreadyJoined > 0
          ? t('hardlink.allAlready', 'Those copies are already one file — there is nothing to join.')
          : t('hardlink.noneEligible', 'None of those copies can be joined. Nothing was changed.')
      );
      return;
    }

    scrolled = false;
    showing = { plan, description };
    drawDialog();
    dialog.showModal();
    body.scrollTop = 0;
    // A body that fits without scrolling has already been read to its end.
    if (atEnd()) {
      scrolled = true;
      drawDialog();
    }
  });

  go.addEventListener('click', async () => {
    if (!showing || go.disabled) return;
    const { plan } = showing;
    const keepers = {};
    for (const item of plan) keepers[item.path] = item.keeper;
    close();

    progressPanel.show(t('hardlink.joining', 'Joining copies into one file'));
    let result;
    try {
      result = unwrap(
        await api.hardlink(plan.map((p) => p.path), { keepers, acknowledged: true }),
        t('hardlink.button', 'Join into one file')
      );
    } finally {
      progressPanel.hide();
    }
    if (!result) return;

    const joined = result.moved.length;
    if (joined === 0) {
      toast(t('hardlink.noneJoined', 'Nothing was joined.'), true);
      return;
    }
    toast(
      t('hardlink.done', '{n} {items} joined · {size} freed. Undo from the Restore Center.', {
        n: formatCount(joined),
        items: word(joined, 'app.item', 'item', 'items'),
        size: formatBytes(result.freedBytes || 0),
      })
    );
    if (typeof window.rescanDupesAfterHardlink === 'function') window.rescanDupesAfterHardlink(result.moved);
  });

  onLanguageChange(() => {
    drawSwitch();
    drawDialog();
  });

  const tab = document.querySelector('.tab[data-tab="settings"]');
  if (tab) tab.addEventListener('click', load);

  load();
})();
