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
 * Nothing installs on its own. The sequence is check, then download, then
 * restart, each on a click — the same rule the rest of the app follows about
 * deleting files, applied to replacing itself.
 */

state.update = null;

const UPDATE_BADGE = {
  idle: { text: 'Up to date', cls: 'card-badge is-ok' },
  checking: { text: 'Checking…', cls: 'card-badge' },
  available: { text: 'Update available', cls: 'card-badge is-warn' },
  downloading: { text: 'Downloading…', cls: 'card-badge' },
  ready: { text: 'Ready to install', cls: 'card-badge is-ok' },
  error: { text: 'Check failed', cls: 'card-badge is-critical' },
  unsupported: { text: 'Not applicable', cls: 'card-badge' },
};

function describeUpdate(s) {
  if (!s.supported) {
    return 'Running from source, or from a build with no release feed configured — ' +
      'there is nothing to check against. Installed copies check the release page.';
  }
  if (!s.enabled) return 'Switched off. The app makes no network requests.';

  switch (s.status) {
    case 'checking':
      return 'Asking the release page whether there is a newer version.';
    case 'available':
      return `Version ${s.version} is available. You are on ${s.currentVersion}.` +
        (s.signed ? '' : ' This build is not code-signed, so the only check on the ' +
          'download is that it came from the release server over HTTPS.');
    case 'downloading':
      return `Downloading version ${s.version} — ${Math.round(s.progress)}%.`;
    case 'ready':
      return `Version ${s.version} is downloaded. It installs when you restart.`;
    case 'error':
      return `Could not check: ${s.error}`;
    default:
      return s.checkedAt
        ? `Version ${s.currentVersion}. Last checked ${formatWhen(s.checkedAt)}.`
        : `Version ${s.currentVersion}.`;
  }
}

function applyUpdateState(next) {
  if (!next) return;
  state.update = next;

  const badge = UPDATE_BADGE[next.status] || UPDATE_BADGE.idle;
  $('update-badge').textContent = !next.supported
    ? UPDATE_BADGE.unsupported.text
    : !next.enabled
      ? 'Off'
      : badge.text;
  $('update-badge').className = !next.supported || !next.enabled ? 'card-badge' : badge.cls;

  $('update-enabled').checked = next.enabled;
  $('update-detail').textContent = describeUpdate(next);

  const downloading = next.status === 'downloading';
  $('update-progress').hidden = !downloading;
  if (downloading) $('update-bar').style.width = `${Math.round(next.progress)}%`;

  $('update-check').disabled = !next.supported || next.checking || downloading;
  $('update-download').hidden = next.status !== 'available';
  $('update-install').hidden = next.status !== 'ready';

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
    pill.textContent = `Update to ${next.version}`;
    pill.title = 'Download the new version';
  } else if (next.status === 'downloading') {
    pill.textContent = `Downloading ${Math.round(next.progress)}%`;
    pill.title = '';
  } else {
    pill.textContent = `Restart to install ${next.version}`;
    pill.title = 'Restart CleanDrive to finish updating';
  }
}

/* ---- wiring -------------------------------------------------------------- */

$('update-enabled').addEventListener('change', async () => {
  const enabled = $('update-enabled').checked;
  const saved = unwrap(await api.saveSettings({ updates: { enabled } }), 'Save settings');
  if (saved) applyAutoState(saved);
  applyUpdateState(unwrap(await api.updateState(), 'Updates'));
  toast(enabled ? 'Update checks are on.' : 'Update checks are off. The app makes no network requests.');
});

$('update-check').addEventListener('click', async () => {
  applyUpdateState(unwrap(await api.checkForUpdate(), 'Updates'));
  const s = state.update;
  if (s && s.status === 'idle') toast(`You are on the latest version (${s.currentVersion}).`);
  else if (s && s.status === 'unsupported') toast('This build has no release feed to check.');
});

$('update-download').addEventListener('click', async () => {
  applyUpdateState(unwrap(await api.downloadUpdate(), 'Updates'));
});

$('update-install').addEventListener('click', async () => {
  const result = unwrap(await api.installUpdate(), 'Updates');
  if (result && result.cancelled) toast('The update will install next time you restart.');
});

$('update-pill').addEventListener('click', async () => {
  const s = state.update;
  if (!s) return;
  if (s.status === 'available') $('update-download').click();
  else if (s.status === 'ready') $('update-install').click();
});

// The main process pushes every state change, so a download that finishes while
// the user is on another tab still updates both surfaces.
api.onUpdateState(applyUpdateState);

(async function initUpdates() {
  applyUpdateState(unwrap(await api.updateState(), 'Updates'));
})();
