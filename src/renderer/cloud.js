'use strict';

/*
 * "Available in the cloud" on What to delete: OneDrive files whose contents
 * are in the cloud and on this drive, which can be made online-only (B3).
 *
 * It lives on the delete screen and is built to be unlike everything else on
 * it. Its own card, its own selection and its own button: "Select everything
 * marked safe" cannot reach it, the Recycle Bin button never sees it, and the
 * candidates it draws offer one action only, `dehydrate`. A OneDrive file
 * moved to the bin is deleted on every device; that must never be one wrong
 * click away from a screen that frees space without deleting anything.
 *
 * Its totals are not in "Safe to delete" either. Nothing here is deleted.
 */

(function () {
  const card = $('cloud-card');
  const list = $('cloud-files');
  const status = $('cloud-status');
  const selectAll = $('cloud-select-all');
  const button = $('cloud-dehydrate');
  const selection = new Set();
  let files = [];
  let summary = null;
  let listView = null;

  const bar = ActionBar({
    root: $('cloud-actionbar'),
    readout: $('cloud-selection'),
    buttons: { dehydrate: button },
    selected: () => files.filter((f) => selection.has(f.path)),
  });

  /** One selection on the screen at a time, so one floating bar at a time. */
  function onChange() {
    if (selection.size > 0 && state.selectedCleanup.size > 0) {
      state.selectedCleanup.clear();
      syncCleanupCheckboxes();
      updateCleanupSelection();
    }
    bar.update();
  }

  function statusLines() {
    const lines = [];
    if (!summary) return lines;
    if (summary.unavailable) {
      lines.push(t('cloud.unavailable', 'Windows could not be asked which OneDrive files are in sync here, so none is offered.'));
      return lines;
    }
    if (!summary.running) {
      lines.push(t('cloud.notRunning', 'OneDrive is not running. It is OneDrive that frees the space, so start it before using this.'));
    }
    if (summary.notSynced.count > 0) {
      lines.push(
        t('cloud.notSynced', 'Never uploaded, so not offered: {n} {files} ({size}) in OneDrive with no copy in the cloud. Making them online-only would free nothing.', {
          n: formatCount(summary.notSynced.count),
          files: word(summary.notSynced.count, 'app.file', 'file', 'files'),
          size: formatBytes(summary.notSynced.bytes),
        })
      );
    }
    if (summary.pending.count > 0) {
      lines.push(
        t('cloud.pending', 'Waiting for OneDrive to upload them, since they changed: {n} {files} ({size}).', {
          n: formatCount(summary.pending.count),
          files: word(summary.pending.count, 'app.file', 'file', 'files'),
          size: formatBytes(summary.pending.bytes),
        })
      );
    }
    if (summary.onlineOnly.count > 0) {
      lines.push(
        t('cloud.onlineOnly', 'Online-only already: {n} {files} ({size}).', {
          n: formatCount(summary.onlineOnly.count),
          files: word(summary.onlineOnly.count, 'app.file', 'file', 'files'),
          size: formatBytes(summary.onlineOnly.bytes),
        })
      );
    }
    return lines;
  }

  function render() {
    if (!summary) {
      card.hidden = true;
      bar.update();
      return;
    }
    card.hidden = false;
    const lines = statusLines();
    status.textContent = lines.join(' ');
    status.hidden = lines.length === 0;

    const onDisk = files.reduce((n, f) => n + (f.bytesOnDisk || f.size), 0);
    selectAll.hidden = files.length === 0;
    selectAll.textContent = t('cloud.selectAll', 'Select all {n} · {size} on this drive', {
      n: formatCount(files.length),
      size: formatBytes(onDisk),
    });

    if (files.length === 0) {
      list.replaceChildren();
      const empty = document.createElement('li');
      empty.className = 'path-empty';
      empty.textContent = t('cloud.none', 'No OneDrive file of 1 MB or more in this folder is in sync and still on this drive.');
      list.appendChild(empty);
      listView = null;
    } else {
      listView = CandidateList(list, {
        rows: files,
        selection,
        onChange,
        meta: (file) => `${formatBytes(file.bytesOnDisk || file.size)} ${t('cloud.onDrive', 'on this drive')} · ${tm(file.evidence[file.evidence.length - 1])}`,
        badge: (file) => evidencePill(file),
      });
    }
    bar.update();
  }

  selectAll.addEventListener('click', () => {
    for (const f of files) selection.add(f.path);
    if (listView) listView.sync();
    onChange();
  });

  /** Ticking a delete candidate clears this selection -- see app.js. */
  function clearSelection() {
    if (selection.size === 0) return;
    selection.clear();
    if (listView) listView.sync();
    bar.update();
  }

  const REASONS = {
    oneDriveOff: () => t('cloud.refused.off', 'OneDrive is not running, so nothing could be freed now. Start OneDrive, then try again — nothing was changed.'),
    cannotCheck: () => t('cloud.refused.check', 'Windows could not be asked about these files, so nothing was changed.'),
    notSynced: () => t('cloud.refused.notSynced', 'not in the cloud'),
    pending: () => t('cloud.refused.pending', 'waiting to sync'),
    onlineOnly: () => t('cloud.refused.onlineOnly', 'already online-only'),
    changed: () => t('cloud.refused.changed', 'changed since the scan'),
  };

  /**
   * Hand the ticked files to the main process, which asks Windows again, shows
   * the native confirmation, and only then acts. `options` is what every
   * action takes; the window cannot use it to skip the confirmation.
   */
  async function run(options = {}) {
    const paths = [...selection];
    if (paths.length === 0) return;
    progressPanel.show(t('cloud.checking', 'Asking OneDrive about the files'));
    let result;
    try {
      result = unwrap(await api.dehydrate(paths, options), t('cloud.label', 'Free up space'));
    } finally {
      progressPanel.hide();
    }
    if (!result) return;

    const handed = result.moved.length;
    if (handed === 0) {
      const first = result.failed[0];
      const whole = first && (first.reason === 'oneDriveOff' || first.reason === 'cannotCheck');
      toast(
        whole
          ? REASONS[first.reason]()
          : result.cancelled
            ? t('cloud.cancelled', 'Cancelled — nothing was changed.')
            : t('cloud.nothing', 'Nothing was made online-only. {reason}', {
                reason: first && REASONS[first.reason] ? REASONS[first.reason]() : '',
              }),
        !result.cancelled
      );
      return;
    }

    const parts = [
      t('cloud.done', 'Handed {n} {files} to OneDrive. Freed on this drive, as measured: {freed}.', {
        n: formatCount(handed),
        files: word(handed, 'app.file', 'file', 'files'),
        freed: formatBytes(result.freedBytes),
      }),
    ];
    if (result.pendingCount > 0) {
      parts.push(
        t('cloud.stillPending', 'OneDrive had not freed {n} of them yet when the app stopped watching; it will in its own time.', {
          n: formatCount(result.pendingCount),
        })
      );
    }
    const skipped = result.failed.length;
    if (skipped > 0) {
      parts.push(t('cloud.skipped', '{n} left as they were.', { n: formatCount(skipped) }));
    }
    toast(parts.join(' '));

    const done = new Set(result.moved.map((m) => m.path));
    files = files.filter((f) => !done.has(f.path));
    for (const p of done) selection.delete(p);
    render();
  }

  button.addEventListener('click', () => run());

  /** A scan's reply arrived: its OneDrive findings, if the folder had any. */
  function show(scan) {
    summary = scan && scan.cloud ? scan.cloud : null;
    const byId = scan ? indexCandidates(scan.candidates || []) : new Map();
    files = summary ? viewsOf(summary.ids, byId) : [];
    selection.clear();
    render();
  }

  onLanguageChange(() => {
    if (summary) render();
  });

  window.CloudCard = { show, run, clearSelection, debug: () => ({ files: files.length, selected: selection.size, summary }) };
})();
