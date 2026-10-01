'use strict';

/**
 * What a command is handed: the app's services, the licence, and the few
 * things only this process can answer -- whether it is elevated, and how to
 * start the helper without a UAC prompt.
 *
 * Kept apart from the commands so the harness can hand them its own
 * (scripts/test-cli.js runs every command under plain Node with fakes), and so
 * the commands that must never consult the licence -- the journal, restore --
 * do not even load the file that holds it.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const { app } = require('electron');

const { HelperClient } = require('../helper/client');
const { CancelToken } = require('../lib/util');

/**
 * The helper, started as a child of this process rather than through UAC.
 *
 * Only ever called once this process has been found elevated: a child of an
 * elevated process is elevated, so the same fixed list of read-only
 * operations runs with the rights it needs and nobody is shown a prompt. A
 * script that raised one would hang until somebody walked over to click it.
 */
function directLaunch(name, nonce) {
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--helper', '--pipe', name, '--nonce', nonce];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true });
    child.once('spawn', resolve);
    child.once('error', (err) => reject(Object.assign(new Error(err.message), { code: 'ELAUNCH' })));
  });
}

function create() {
  const { services } = require('../services');
  const licenceState = require('../license/state');
  const entitlements = require('../license/entitlements');
  const { BUILD_CHANNEL } = require('../build-info');
  const licence = licenceState.currentLicense();

  return {
    services: () => services(),
    can: (feature) => entitlements.can(licence, feature),
    reasonFor: (feature) => entitlements.reasonFor(licence, feature),
    licence,
    elevated: async () => {
      const level = await require('../helper/ops').integrityLevel();
      return level === 'high' || level === 'system';
    },
    helperClient: () => new HelperClient({ launch: directLaunch }),
    token: new CancelToken(),
    cwd: process.cwd(),
    now: () => Date.now(),
    // `policy apply` (H2): the same reconciliation the window runs at launch,
    // and the organisation's quarantine folder made the way a chosen one is.
    reconcileTasks: (settings, options) => require('../tasks').reconcile(settings, options),
    prepareZone: (zone) => require('../lib/quarantine-zone').prepare(path.dirname(zone)),
    app: {
      version: app.getVersion(),
      channel: BUILD_CHANNEL,
      dataDir: app.getPath('userData'),
      exe: process.execPath,
      packaged: app.isPackaged,
      electron: process.versions.electron,
      node: process.versions.node,
    },
    resolve: (p) => path.resolve(process.cwd(), p),
  };
}

module.exports = { create, directLaunch };
