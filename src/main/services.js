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
  const isDefault = appData && name && pathKey(userData) === pathKey(path.join(appData, name));
  if (isDefault && localAppData) return path.join(localAppData, name);
  return path.join(userData, 'local');
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
        journal = new ActionJournal(this.journalDir);
      }
      return journal;
    },

    /** The purge's view of the journal. The old ledger file is imported once. */
    get ledger() {
      if (!ledger) ledger = new TrashLedger(this.ledgerPath, { journal: this.journal });
      return ledger;
    },

    // The interval floor is a property of the build, not of the file: a
    // checkout may schedule a one-minute loop to watch it work, an installed
    // copy may not. Passed in here so every process in the app -- window,
    // scheduled run, sampler -- reads the same file with the same rules.
    settings: new SettingsStore(path.join(dir, 'settings.json'), {
      minMinutes: app.isPackaged ? MIN_MINUTES_PACKAGED : 1,
    }),
    runLog: new RunLog(path.join(dir, 'autoclean-log.json')),
    history: new History(path.join(dir, 'history.json')),
  };
  return cached;
}

module.exports = { services, localDataDir };
