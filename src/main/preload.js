'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The renderer's entire view of the system. No fs, no child_process, no
 * ipcRenderer -- only these calls, each backed by a validated main-process
 * handler.
 */
const api = {
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  knownPaths: () => ipcRenderer.invoke('app:paths'),

  scan: (folder, options) => ipcRenderer.invoke('scan:run', folder, options),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),

  findDuplicates: (roots, options) => ipcRenderer.invoke('dupes:run', roots, options),
  cancelDuplicates: () => ipcRenderer.invoke('dupes:cancel'),

  trash: (paths, options) => ipcRenderer.invoke('trash:delete', paths, options),
  cancelTrash: () => ipcRenderer.invoke('trash:cancel'),

  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  open: (target) => ipcRenderer.invoke('shell:open', target),

  /* automatic cleanup */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (next) => ipcRenderer.invoke('settings:save', next),
  runAutoClean: (options) => ipcRenderer.invoke('autoclean:run', options),
  cancelAutoClean: () => ipcRenderer.invoke('autoclean:cancel'),

  diskUsage: (target) => ipcRenderer.invoke('disk:usage', target),

  previewPurge: () => ipcRenderer.invoke('recyclebin:preview'),
  purgeNow: () => ipcRenderer.invoke('recyclebin:purge'),

  /* updates */
  updateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  /* appearance */
  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),

  /* trends */
  getHistory: (options) => ipcRenderer.invoke('history:get', options),
  exportHistory: (format) => ipcRenderer.invoke('history:export', format),

  /* disk monitoring */
  monitorStatus: () => ipcRenderer.invoke('monitor:status'),
  monitorCheck: () => ipcRenderer.invoke('monitor:check'),
  monitorSnooze: (minutes) => ipcRenderer.invoke('monitor:snooze', minutes),
  monitorResume: () => ipcRenderer.invoke('monitor:resume'),

  /** Subscribe to progress. Returns an unsubscribe function. */
  onScanProgress: (cb) => subscribe('scan:progress', cb),
  onDuplicateProgress: (cb) => subscribe('dupes:progress', cb),
  onTrashProgress: (cb) => subscribe('trash:progress', cb),
  onAutoCleanProgress: (cb) => subscribe('autoclean:progress', cb),
  onUpdateState: (cb) => subscribe('update:state', cb),
};

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('cleandrive', api);
