'use strict';

/**
 * The report dialog (G2).
 *
 * Picks which sections go into the file and whether names are replaced, then
 * hands the choice to the main process, which gathers, renders and writes.
 * Nothing is rendered here: the report has to be a file that opens on a
 * machine with no CleanDrive on it, so the page that builds it lives beside
 * the data rather than in the window.
 *
 * The one thing the window contributes is the System screen's rows. That
 * breakdown is never written down -- it costs a walk of the whole drive and,
 * for some rows, administrator rights -- and its row titles live in
 * `system.js`, where `test:i18n` can see them as literal keys. So the window
 * hands over what it is already showing rather than the main process keeping
 * a second copy of the app's vocabulary.
 */
(function () {
  const dialog = $('report');
  const view = { options: null, chosen: new Set(), touchedPrivate: false };

  /** What each section is called, and what it would put in the file. */
  const SECTION_TEXT = {
    volumes: () => [
      t('report.section.volumes', 'Drives'),
      t('report.section.volumes.what', 'How big each drive is and how full. No file or folder names.'),
    ],
    system: () => [
      t('report.section.system', 'Where the drive went'),
      t('report.section.system.what', 'The System screen’s breakdown of the whole drive. Folder names, no file names.'),
    ],
    folders: () => [
      t('report.section.folders', 'Folders that have been scanned'),
      t('report.section.folders.what', 'Each scanned folder with its size. Folder names, no file names.'),
    ],
    trends: () => [
      t('report.section.trends', 'Over time'),
      t('report.section.trends.what', 'The chart and every measurement behind it. No file or folder names.'),
    ],
    diff: () => [
      t('report.section.diff', 'What changed'),
      t('report.section.diff.what', 'The newest comparison of one folder against an earlier scan of itself — including which files appeared and vanished.'),
    ],
    actions: () => [
      t('report.section.actions', 'What CleanDrive did'),
      t('report.section.actions.what', 'Every file this app moved or deleted, and where it went.'),
    ],
  };

  /** Why a section cannot be included, in the words of the screen that fills it. */
  const UNAVAILABLE = {
    system: () => t('report.missing.system', 'Nothing measured yet — open the System screen and measure.'),
    folders: () => t('report.missing.folders', 'No folder has been scanned yet.'),
    trends: () => t('report.missing.trends', 'Two or more measurements are needed.'),
    diff: () => t('report.missing.diff', 'Two comparable scans of one folder are needed.'),
    actions: () => t('report.missing.actions', 'CleanDrive has not moved or deleted anything yet.'),
  };

  function namesFiles() {
    const listing = view.options ? view.options.namesFiles : [];
    return [...view.chosen].some((s) => listing.includes(s));
  }

  /**
   * Private mode follows what is being included, until somebody sets it.
   *
   * Ticking "what CleanDrive did" turns it on, because that section is a list
   * of this person's files. Once they have touched the box themselves, it is
   * theirs and nothing moves it again.
   */
  function syncPrivate() {
    const files = namesFiles();
    if (!view.touchedPrivate) $('report-private').checked = files;
    setText(
      $('report-private-note'),
      $('report-private').checked
        ? t('report.dialog.privateOn', 'Folders become “Folder 1”, files become “File 1.jpg”. The same folder keeps the same name throughout, and the data embedded in the file is replaced too.')
        : files
          ? t('report.dialog.privateOffWarn', 'The report will contain the real names of files on this computer.')
          : t('report.dialog.privateOff', 'The report will contain real folder names, but no file names.')
    );
    $('report-private-note').classList.toggle('is-warning', !$('report-private').checked && files);
  }

  function renderSections() {
    const options = view.options;
    const host = $('report-sections');
    const rows = options.sections.map((id) => {
      const [title, what] = (SECTION_TEXT[id] || (() => [id, '']))();
      const available = options.available[id] === true;

      const label = document.createElement('label');
      label.className = `check report-section${available ? '' : ' is-unavailable'}`;

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = `report-section-${id}`;
      box.checked = available && view.chosen.has(id);
      box.disabled = !available;
      box.addEventListener('change', () => {
        if (box.checked) view.chosen.add(id);
        else view.chosen.delete(id);
        syncPrivate();
        $('report-save').disabled = view.chosen.size === 0;
      });

      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = title;
      const note = document.createElement('span');
      note.className = 'report-section-what';
      // A section with nothing behind it says why, rather than disappearing.
      note.textContent = available ? what : (UNAVAILABLE[id] || (() => what))();
      text.append(strong, document.createElement('br'), note);

      label.append(box, text);
      return label;
    });
    host.replaceChildren(...rows);
  }

  async function open() {
    const options = unwrap(await api.reportOptions(), t('report.label', 'Report'));
    if (!options) return;
    view.options = options;
    view.touchedPrivate = false;

    // Everything there is something behind, to begin with: a report that
    // leaves out what it could have said is a worse default than one that
    // says too much, and every line of it can be unticked.
    view.chosen = new Set(options.sections.filter((s) => options.available[s] === true));

    renderSections();
    syncPrivate();
    $('report-save').disabled = view.chosen.size === 0;

    const problem = $('report-problem');
    if (options.allowed) {
      problem.hidden = true;
    } else {
      problem.hidden = false;
      setText(problem, t('report.locked', 'Saving an HTML report is part of CleanDrive Pro.'));
      $('report-save').disabled = true;
    }

    dialog.showModal();
  }

  /**
   * The System screen's rows, as it is showing them.
   *
   * `system.js` keeps its last result and the words for it; this reads both
   * rather than asking the main process, which holds the numbers but not the
   * titles. Nothing to show means nothing is sent, and the section reports
   * itself as not measured.
   */
  function systemRows() {
    const panel = window.SystemScreen;
    if (!panel || typeof panel.reportRows !== 'function') return null;
    try {
      return panel.reportRows();
    } catch {
      return null;
    }
  }

  $('report-private').addEventListener('change', () => {
    view.touchedPrivate = true;
    syncPrivate();
  });

  $('report-cancel').addEventListener('click', () => dialog.close());

  $('report-save').addEventListener('click', async () => {
    const sections = view.options.sections.filter((s) => view.chosen.has(s));
    $('report-save').disabled = true;
    const result = unwrap(
      await api.saveReport({
        sections,
        private: $('report-private').checked,
        system: sections.includes('system') ? systemRows() : null,
        volume: $('trend-volume') ? $('trend-volume').value : undefined,
      }),
      t('report.label', 'Report')
    );
    $('report-save').disabled = false;
    if (!result) return;
    dialog.close();
    if (!result.written) {
      toast(t('report.cancelled', 'Report not saved.'));
      return;
    }
    toast(
      t('report.saved', 'Report saved: {name} ({size}).', {
        name: result.path.split(/[\\/]/).pop(),
        size: formatBytes(result.bytes),
      }) + (result.private ? ` ${t('report.savedPrivate', 'Names were replaced.')}` : '')
    );
  });

  $('trend-report').addEventListener('click', open);

  onLanguageChange(() => {
    if (view.options && dialog.open) {
      renderSections();
      syncPrivate();
    }
  });

  // For the harnesses.
  window.ReportDialog = { open, view };
})();
