'use strict';

const path = require('node:path');
const { app } = require('electron');

const { SettingsStore, MIN_MINUTES_PACKAGED } = require('./lib/settings');
const { TrashLedger } = require('./lib/ledger');
const { RunLog } = require('./lib/autoclean');
const { History } = require('./lib/history');
const { pathKey } = require('./lib/util');

/**
 * The three files the app now keeps, as one set of shared instances.
 *
 * The window and the headless scheduled run are separate processes, but within
 * either of them there must be exactly one settings store and one ledger: two
 * stores would each hold their own idea of the current settings and the last
 * one to save would silently win.
 */

let cached = null;

/**
 * Where data that belongs to this machine goes, rather than to the user.
 *
 * Snapshots are large-ish, specific to one disk, and pointless on another
 * computer, so they sit in `%LOCALAPPDATA%` and not in the roaming profile
 * that `userData` lives in -- a domain user's roaming profile would otherwise
 * copy them to every machine they log on to.
 *
 * Unless `userData` has been moved. The harnesses move it into a temporary
 * folder so they cannot touch the real app's files, and anything kept beside
 * it must move with it; otherwise a smoke test would quietly fill the real
 * `%LOCALAPPDATA%` with snapshots of its fixture.
 */
function localDataDir({ userData, appData, name, localAppData }) {
  if (isDefaultUserData({ userData, appData, name }) && localAppData) return path.join(localAppData, name);
  return path.join(userData, 'local');
}

/** Whether `userData` is where Electron puts it, rather than where a harness moved it. */
function isDefaultUserData({ userData, appData, name }) {
  return Boolean(appData && name && pathKey(userData) === pathKey(path.join(appData, name)));
}

/**
 * Which registry key holds this process's policy (H2), or null for none.
 *
 * An installed copy reads the organisation's key and nothing else. A checkout
 * reads it too -- a developer's machine may be managed -- but only with the
 * real `userData`: a harness that moved `userData` to keep off the real app's
 * files must keep off a real policy as well, or a policy set on this machine
 * one day would quietly decide what every harness sees. Such a harness has no
 * policy unless it names its own key with CLEANDRIVE_POLICY_KEY, and that key
 * must be under the harness prefix (read.js) -- never a real `Policies` key.
 * The one exception is the word `machine`, for the elevated harness that sets
 * a real policy on purpose and has to read it from a userData of its own.
 * The same rule as CLEANDRIVE_COPIES_SCOPE: a built installer ignores it.
 */
function policyKeyFor({ packaged, defaultUserData, env = process.env }) {
  const { MACHINE_KEY, isHarnessKey } = require('./policy/read');
  if (packaged) return MACHINE_KEY;
  const asked = env.CLEANDRIVE_POLICY_KEY;
  if (asked === 'machine') return MACHINE_KEY;
  if (asked) return isHarnessKey(asked) ? asked : null;
  return defaultUserData ? MACHINE_KEY : null;
}

function services() {
  if (cached) return cached;

  const dir = app.getPath('userData');
  const localDir = localDataDir({
    userData: dir,
    appData: app.getPath('appData'),
    name: app.getName(),
    localAppData: process.env.LOCALAPPDATA,
  });
  let journal = null;
  let ledger = null;
  let snapshots = null;
  let sealKey = null;
  let sealer;
  let policy = null;
  const minMinutes = app.isPackaged ? MIN_MINUTES_PACKAGED : 1;

  cached = {
    dir,
    localDir,
    snapshotsDir: path.join(localDir, 'snapshots'),

    /** A compressed tree of every scan, for comparing two of them later. */
    get snapshots() {
      if (!snapshots) {
        const { SnapshotStore } = require('./snapshots/store');
        // How many to keep is a setting, read afresh at each save.
        snapshots = new SnapshotStore(this.snapshotsDir, {
          retention: async () => (await this.settings.get()).snapshots,
        });
      }
      return snapshots;
    },

    settingsPath: path.join(dir, 'settings.json'),
    ledgerPath: path.join(dir, 'trash-ledger.json'),
    journalDir: path.join(dir, 'journal'),
    runLogPath: path.join(dir, 'autoclean-log.json'),
    historyPath: path.join(dir, 'history.json'),
    // Held by whichever unattended run is in progress (G4). In userData, so a
    // harness with its own userData gets its own lock and cannot be blocked by
    // -- or block -- a real run.
    runLockPath: path.join(dir, 'autoclean.lock'),

    /**
     * Everything the app did to a file, appended and never rewritten.
     *
     * Built on first use rather than here: the daily disk measurement shares
     * this module and never touches the journal, and it is a process whose
     * whole runtime is a few hundred milliseconds.
     */
    get journal() {
      if (!journal) {
        const { ActionJournal } = require('./journal/journal');
        journal = new ActionJournal(this.journalDir, { sealer: this.sealer });
      }
      return journal;
    },

    sealKeyPath: path.join(dir, 'seal-key.json'),

    /** The key that seals the journal (H4). Public halves only, until something signs. */
    get sealKey() {
      if (!sealKey) {
        const { SealKey } = require('./journal/seal-key');
        sealKey = new SealKey(this.sealKeyPath);
      }
      return sealKey;
    },

    /**
     * Whether sessions are sealed (H4, `biz.audit`), decided here and handed
     * to the journal, which never asks.
     *
     * That split is the whole of how a Business feature lives inside the one
     * module no licence may touch: sealing is an extra line at the end of a
     * session, and a journal without it records, purges and restores exactly
     * as before. Checking seals is reading, and is never gated -- a lapsed
     * licence stops new seals and leaves every old one checkable.
     *
     * Asked once per process, which is right while a licence cannot change
     * under a running app. Phase 6 makes it able to, and must ask again.
     */
    get sealer() {
      if (sealer === undefined) {
        const { canNow } = require('./license/state');
        if (canNow()('biz.audit')) {
          const { Sealer } = require('./journal/seal');
          sealer = new Sealer({ key: this.sealKey, lockFile: path.join(this.journalDir, '.seal.lock') });
        } else {
          sealer = null;
        }
      }
      return sealer;
    },

    /** The purge's view of the journal. The old ledger file is imported once. */
    get ledger() {
      if (!ledger) ledger = new TrashLedger(this.ledgerPath, { journal: this.journal });
      return ledger;
    },

    /**
     * The organisation's policy (H2), and which half of it applies.
     *
     * The tightening half applies to every copy; the acting half -- the
     * organisation's own profile, its quarantine folder -- is `biz.policy`
     * (decided 2026-10-01). Asked here and handed in, the way the journal is
     * handed a sealer: nothing under policy/ loads the licence. Asked once
     * per process, for the same reason as the seal.
     */
    get policy() {
      if (!policy) {
        const { PolicySource } = require('./policy/source');
        const { canNow } = require('./license/state');
        policy = new PolicySource({
          key: policyKeyFor({
            packaged: app.isPackaged,
            defaultUserData: isDefaultUserData({ userData: dir, appData: app.getPath('appData'), name: app.getName() }),
          }),
          acting: canNow()('biz.policy'),
          minMinutes,
        });
      }
      return policy;
    },

    runLog: new RunLog(path.join(dir, 'autoclean-log.json')),
    history: new History(path.join(dir, 'history.json')),
  };

  // The interval floor is a property of the build, not of the file: a
  // checkout may schedule a one-minute loop to watch it work, an installed
  // copy may not. Passed in here so every process in the app -- window,
  // scheduled run, sampler -- reads the same file with the same rules. And
  // every one of them reads it through the policy (H2): see policy/store.js.
  const { ManagedSettingsStore } = require('./policy/store');
  cached.settings = new ManagedSettingsStore(new SettingsStore(path.join(dir, 'settings.json'), { minMinutes }), () => cached.policy);
  return cached;
}

module.exports = { services, localDataDir, isDefaultUserData, policyKeyFor };
