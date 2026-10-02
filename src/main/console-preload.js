'use strict';

/**
 * The console window's bridge (H3, `--console`): five operations, all of them
 * reads except saving a CSV the person asked for and forgetting one
 * machine's seals. Nothing of the main window's bridge is here -- no action,
 * no scan, no settings -- so the console's page cannot reach what it has no
 * use for. `scripts/test-ipc-manifest.js` holds this file to the console's
 * list in ipc-manifest.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cleandrive', {
  consoleInfo: () => ipcRenderer.invoke('console:info'),
  consoleRead: () => ipcRenderer.invoke('console:read'),
  consolePick: () => ipcRenderer.invoke('console:pick'),
  consoleExportCsv: () => ipcRenderer.invoke('console:exportCsv'),
  consoleForget: (host) => ipcRenderer.invoke('console:forget', host),
});
