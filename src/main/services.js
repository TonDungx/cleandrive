'use strict';

const path = require('node:path');
const { app } = require('electron');

const { SettingsStore, MIN_MINUTES_PACKAGED } = require('./lib/settings');
const { TrashLedger } = require('./lib/ledger');
const { RunLog } = require('./lib/autoclean');
const { History } = require('./lib/history');

/**
 * The three files the app now keeps, as one set of shared instances.
 *
 * The window and the headless scheduled run are separate processes, but within
 * either of them there must be exactly one settings store and one ledger: two
 * stores would each hold their own idea of the current settings and the last
 * one to save would silently win.
 */

let cached = null;

function services() {
  if (cached) return cached;

  const dir = app.getPath('userData');
  cached = {
    dir,
    settingsPath: path.join(dir, 'settings.json'),
    ledgerPath: path.join(dir, 'trash-ledger.json'),
    runLogPath: path.join(dir, 'autoclean-log.json'),
    historyPath: path.join(dir, 'history.json'),
    // The interval floor is a property of the build, not of the file: a
    // checkout may schedule a one-minute loop to watch it work, an installed
    // copy may not. Passed in here so every process in the app -- window,
    // scheduled run, sampler -- reads the same file with the same rules.
    settings: new SettingsStore(path.join(dir, 'settings.json'), {
      minMinutes: app.isPackaged ? MIN_MINUTES_PACKAGED : 1,
    }),
    ledger: new TrashLedger(path.join(dir, 'trash-ledger.json')),
    runLog: new RunLog(path.join(dir, 'autoclean-log.json')),
    history: new History(path.join(dir, 'history.json')),
  };
  return cached;
}

module.exports = { services };
