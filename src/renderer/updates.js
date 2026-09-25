'use strict';

/**
 * The update UI.
 *
 * Two surfaces, doing different jobs. The card in the Automatic tab is where
 * the setting lives and where the detail goes. The pill in the top bar exists
 * only when there is something to act on: an app that permanently displays "you
 * are up to date" is spending prime screen space on the least interesting fact
 * about itself.
 *
 * The update downloads by itself and asks once, plainly, before installing.
 * The first version made this three clicks — check, download, restart — on the
 * grounds that replacing the binary should follow the same rule as deleting a
 * file. That was the wrong line: downloading costs bandwidth, installing is
 * what changes the app. So the only button that ever needs pressing is the one
 * that installs.
 */

state.update = null;

const UPDATE_BADGE = {
  idle: { key: 'update.badge.idle', text: 'Up to date', cls: 'card-badge is-ok' },
  checking: { key: 'app.checking', text: 'Checking…', cls: 'card-badge' },
  available: { key: 'update.badge.available', text: 'Update available', cls: 'card-badge is-warn' },
  downloading: { key: 'update.badge.downloading', text: 'Downloading…', cls: 'card-badge' },
  ready: { key: 'update.badge.ready', text: 'Ready to install', cls: 'card-badge is-ok' },
  error: { key: 'update.badge.error', text: 'Check failed', cls: 'card-badge is-critical' },
  unsupported: { key: 'update.badge.unsupported', text: 'Not applicable', cls: 'card-badge' },
};

function describeUpdate(s) {
  if (!s.supported) {
    return t(
      'update.detail.unsupported',
      'Running from source, or from a build with no release feed configured — there is nothing to ' +
        'check against. Installed copies check the release page.'
    );
  }
  if (!s.enabled) return t('update.detail.off', 'Switched off. The app makes no network requests.');

  switch (s.status) {
    case 'checking':
      return t('update.detail.checking', 'Asking the release page whether there is a newer version.');
    case 'available':
      return t(
        'update.detail.available',
        'Version {version} found. Downloading it now — you will be asked before anything is installed.',
        { version: s.version }
      );
    case 'downloading':
      return t(
        'update.detail.downloading',
        'Downloading version {version} — {percent}%. Nothing is installed until you say so.',
        { version: s.version, percent: Math.round(s.progress) }
      );
    case 'ready':
      return (
        t(
          'update.detail.ready',
          'Version {version} is downloaded and ready. Installing takes a few seconds and the app ' +
            'reopens by itself.',
          { version: s.version }
        ) +
        (s.signed
          ? ''
          : ' ' +
            t(
              'update.detail.unsigned',
              'This build is not code-signed, so the only check on the download is that it came from ' +
                'the release server over HTTPS.'
            ))
      );
    case 'error':
      return t('update.detail.error', 'Could not check: {error}', { error: s.error });
    default:
      return s.checkedAt
        ? t('update.detail.idleChecked', 'Version {version}. Last checked {when}.', {
            version: s.currentVersion,
            when: formatWhen(s.checkedAt),
          })
        : t('update.detail.idle', 'Version {version}.', { version: s.currentVersion });
  }
}

/**
 * The version, stated plainly, above everything about updating it.
 *
 * "Which version am I running" used to be answerable only by reading the
 * sentence under the update controls, in a card that lived between the cleanup
 * policy and the disk alerts. It is the first thing anybody reporting a problem
 * is asked for, so it gets a row of its own.
 */
function renderVersionFacts(s) {
  const list = $('version-facts');
  if (!list) return;
  list.replaceChildren();

  const row = (label, value, title) => {
    const li = document.createElement('li');
    li.className = 'pair-row';
    const left = document.createElement('span');
    left.className = 'pair-label';
    left.textContent = label;
    const right = document.createElement('span');
    right.className = 'pair-value';
    right.textContent = value;
    if (title) right.title = title;
    li.append(left, right);
    return li;
  };

  list.append(row(t('settings.version.installed', 'Installed version'), s.currentVersion || '–'));

  if (s.supported) {
    list.append(
      row(
        t('settings.version.lastChecked', 'Last checked'),
        s.checkedAt ? formatWhen(s.checkedAt) : t('app.never.lower', 'never')
      )
    );
  }

  list.append(
    row(
      t('settings.version.signed', 'Code signature'),
      s.signed
        ? t('settings.version.signedYes', 'signed')
        : t('settings.version.signedNo', 'not signed'),
      t(
        'settings.version.signedHint',
        'Without a signature the only thing protecting an update is HTTPS to the release server.'
      )
    )
  );
}

function applyUpdateState(next) {
  if (!next) return;
  state.update = next;

  const badge = UPDATE_BADGE[next.status] || UPDATE_BADGE.idle;
  $('update-badge').textContent = !next.supported
    ? t(UPDATE_BADGE.unsupported.key, UPDATE_BADGE.unsupported.text)
    : !next.enabled
      ? t('app.off', 'Off')
      : t(badge.key, badge.text);
  $('update-badge').className = !next.supported || !next.enabled ? 'card-badge' : badge.cls;

  $('update-enabled').checked = next.enabled;
  $('update-detail').textContent = describeUpdate(next);
  renderVersionFacts(next);

  const downloading = next.status === 'downloading';
  $('update-progress').hidden = !downloading;
  if (downloading) {
    $('update-bar').style.width = `${Math.round(next.progress)}%`;
    $('update-progress').setAttribute('aria-valuenow', String(Math.round(next.progress)));
  }

  $('update-check').disabled = !next.supported || next.checking || downloading ||
    next.status === 'available';
  // The download runs on its own, so the only button that ever needs pressing
  // is the one that installs. "Download" stays as a manual fallback for the
  // case where the automatic fetch failed and left it merely available.
  $('update-download').hidden = next.status !== 'available';
  $('update-install').hidden = next.status !== 'ready';
  $('update-install').textContent = t('update.installVersion', 'Install {version} and restart', {
    version: next.version || '',
  }).replace(/\s+/g, ' ').trim();

  /* ---- the top bar pill ------------------------------------------------- */

  const pill = $('update-pill');
  if (!next.supported || !next.enabled || next.status === 'idle' ||
      next.status === 'checking' || next.status === 'error') {
    pill.hidden = true;
    return;
  }

  pill.hidden = false;
  pill.classList.toggle('is-busy', next.status === 'downloading');

  if (next.status === 'available') {
    pill.textContent = t('update.pill.downloadingVersion', 'Downloading {version}…', { version: next.version });
    pill.title = t('update.pill.fetchingHint', 'Fetching the update; you will be asked before it installs');
    pill.classList.add('is-busy');
  } else if (next.status === 'downloading') {
    pill.textContent = t('update.pill.percent', 'Downloading {percent}%', { percent: Math.round(next.progress) });
    pill.title = '';
  } else {
    pill.textContent = t('update.pill.install', 'Install {version}', { version: next.version });
    pill.title = t('update.pill.installHint', 'Install the update and restart — takes a few seconds');
  }
}

/* ---- wiring -------------------------------------------------------------- */

$('update-enabled').addEventListener('change', async () => {
  const enabled = $('update-enabled').checked;
  const saved = unwrap(await api.saveSettings({ updates: { enabled } }), t('app.label.saveSettings', 'Save settings'));
  if (saved) applyAutoState(saved);
  applyUpdateState(unwrap(await api.updateState(), t('update.label', 'Updates')));
  toast(
    enabled
      ? t('update.toast.on', 'Update checks are on.')
      : t('update.toast.off', 'Update checks are off. The app makes no network requests.')
  );
});

$('update-check').addEventListener('click', async () => {
  applyUpdateState(unwrap(await api.checkForUpdate(), t('update.label', 'Updates')));
  const s = state.update;
  if (s && s.status === 'idle') {
    toast(t('update.toast.latest', 'You are on the latest version ({version}).', { version: s.currentVersion }));
  } else if (s && s.status === 'unsupported') {
    toast(t('update.toast.noFeed', 'This build has no release feed to check.'));
  }
});

$('update-download').addEventListener('click', async () => {
  applyUpdateState(unwrap(await api.downloadUpdate(), t('update.label', 'Updates')));
});

$('update-install').addEventListener('click', async () => {
  const result = unwrap(await api.installUpdate(), t('update.label', 'Updates'));
  if (result && result.cancelled) {
    toast(t('update.toast.deferred', 'The update will install next time you restart.'));
  }
});

$('update-pill').addEventListener('click', () => {
  const s = state.update;
  if (s && s.status === 'ready') {
    $('update-install').click();
    return;
  }
  // Otherwise take them to where the detail is. The card moved out of the
  // Automatic tab, so a pill that did nothing would be a dead end.
  const tab = document.querySelector('.tab[data-tab="settings"]');
  if (tab) tab.click();
});

// The main process pushes every state change, so a download that finishes while
// the user is on another tab still updates both surfaces.
api.onUpdateState(applyUpdateState);

(async function initUpdates() {
  const first = unwrap(await api.updateState(), t('update.label', 'Updates'));
  applyUpdateState(first);

  // The last step of a sequence the user started. An update that finishes in
  // silence leaves them wondering whether it worked -- which is exactly the
  // complaint that produced this rewrite.
  if (first && first.justUpdated) {
    toast(t('update.toast.justUpdated', 'CleanDrive updated to {version}, from {previous}.', {
      version: first.currentVersion,
      previous: first.justUpdated,
    }));
    await api.acknowledgeUpdate();
  }
})();

onLanguageChange(() => {
  if (state.update) applyUpdateState(state.update);
});
