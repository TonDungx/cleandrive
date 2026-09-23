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

  /* looking at a file without leaving the app */
  preview: (target) => ipcRenderer.invoke('preview:open', target),
  closePreview: () => ipcRenderer.invoke('preview:close'),

  /* photos and video */
  mediaRoots: () => ipcRenderer.invoke('media:roots'),
  scanMedia: (roots, options) => ipcRenderer.invoke('media:scan', roots, options),
  cancelMediaScan: () => ipcRenderer.invoke('media:cancel'),
  mediaThumbs: (paths, options) => ipcRenderer.invoke('media:thumbs', paths, options),
  mediaSimilar: () => ipcRenderer.invoke('media:similar'),

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
  acknowledgeUpdate: () => ipcRenderer.invoke('update:acknowledge'),

  /* appearance */
  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
  setLanguage: (preference) => ipcRenderer.invoke('language:set', preference),
  getLanguage: () => ipcRenderer.invoke('language:get'),

  /* the Windows tasks behind the schedule */
  taskStatus: (options) => ipcRenderer.invoke('tasks:status', options),
  reconcileTasks: () => ipcRenderer.invoke('tasks:reconcile'),
  runTaskNow: (which) => ipcRenderer.invoke('tasks:runNow', which),

  /* trends */
  getHistory: (options) => ipcRenderer.invoke('history:get', options),
  exportHistory: (format) => ipcRenderer.invoke('history:export', format),
  sampleNow: () => ipcRenderer.invoke('trends:sample'),

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
  onMediaProgress: (cb) => subscribe('media:progress', cb),
  /** Files as they are read, so the grid fills while the scan is still running. */
  onMediaBatch: (cb) => subscribe('media:batch', cb),
  onUpdateState: (cb) => subscribe('update:state', cb),

  /** Fires when a background run rewrites settings, the log or the history. */
  onDataChanged: (cb) => subscribe('app:data-changed', cb),
};

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('cleandrive', api);
