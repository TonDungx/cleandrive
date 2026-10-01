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

  /* `fast` is the one thing the window may say about *how* to scan: read the
     volume's own catalogue instead of walking it (A2). A boolean, not an
     options bag -- the window used to be able to pass the scanner's whole
     configuration through and never did. */
  scan: (folders, fast) => ipcRenderer.invoke('scan:run', folders, fast === true),
  scanDrives: () => ipcRenderer.invoke('scan:drives'),

  /* the Space Planner (G1): a goal in, a list of steps out. Nothing here
     carries out anything -- every step is a link to the screen that already
     offers it. */
  planSpace: (request) => ipcRenderer.invoke('planner:run', request),
  cancelPlan: () => ipcRenderer.invoke('planner:cancel'),
  plannerVolume: (drive) => ipcRenderer.invoke('planner:volume', drive),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  /* one folder of the last scan's tree, a few levels deep -- never all of it */
  scanChildren: (treeId, rel) => ipcRenderer.invoke('scan:children', treeId, rel),

  findDuplicates: (roots, options) => ipcRenderer.invoke('dupes:run', roots, options),
  cancelDuplicates: () => ipcRenderer.invoke('dupes:cancel'),
  findCopies: (filePath) => ipcRenderer.invoke('dupes:copiesOf', filePath),
  explorerStatus: () => ipcRenderer.invoke('explorer:status'),
  setExplorerMenu: (enabled) => ipcRenderer.invoke('explorer:set', enabled),

  /* acting on files -- every kind through the one pipeline */
  trash: (paths, options) => ipcRenderer.invoke('action:execute', { kind: 'recycle', items: paths, options }),
  /* OneDrive "free up space": online-only, nothing deleted */
  dehydrate: (paths, options) => ipcRenderer.invoke('action:execute', { kind: 'dehydrate', items: paths, options }),
  cancelTrash: () => ipcRenderer.invoke('action:stop'),

  /* the System screen: where the system drive's space went */
  systemFacts: () => ipcRenderer.invoke('system:facts'),
  measureSystem: () => ipcRenderer.invoke('system:measure'),
  measureSystemElevated: () => ipcRenderer.invoke('system:measureElevated'),
  cancelSystem: () => ipcRenderer.invoke('system:cancel'),
  handoff: (key) => ipcRenderer.invoke('system:handoff', key),

  lastApps: () => ipcRenderer.invoke('apps:last'),
  scanApps: () => ipcRenderer.invoke('apps:scan'),
  cancelApps: () => ipcRenderer.invoke('apps:cancel'),
  scanAppsPrefetch: () => ipcRenderer.invoke('apps:prefetch'),

  lastGames: () => ipcRenderer.invoke('games:last'),
  scanGames: () => ipcRenderer.invoke('games:scan'),
  cancelGames: () => ipcRenderer.invoke('games:cancel'),

  lastChat: () => ipcRenderer.invoke('chat:last'),
  scanChat: () => ipcRenderer.invoke('chat:scan'),
  cancelChat: () => ipcRenderer.invoke('chat:cancel'),

  lastDev: () => ipcRenderer.invoke('dev:last'),
  scanDev: () => ipcRenderer.invoke('dev:scan'),
  cancelDev: () => ipcRenderer.invoke('dev:cancel'),
  lastDevProjects: () => ipcRenderer.invoke('dev:lastProjects'),
  scanDevProjects: (roots) => ipcRenderer.invoke('dev:scanProjects', roots),
  cancelDevProjects: () => ipcRenderer.invoke('dev:cancelProjects'),

  /* what changed in a folder between two of its scans */
  snapshotList: () => ipcRenderer.invoke('snapshot:list'),
  snapshotDiff: (root, older, newer) => ipcRenderer.invoke('snapshot:diff', { root, older, newer }),

  /* the Restore Center: what the app did, and putting it back */
  journalSessions: () => ipcRenderer.invoke('journal:sessions'),
  journalItems: (sessionId) => ipcRenderer.invoke('journal:items', sessionId),
  restore: (itemIds, options) => ipcRenderer.invoke('journal:restore', { items: itemIds, options }),

  /* moving files to another drive (B1): the folder is picked and made in the main process */
  quarantine: (paths, options) => ipcRenderer.invoke('action:execute', { kind: 'quarantine', items: paths, options }),
  quarantineStatus: () => ipcRenderer.invoke('quarantine:status'),
  quarantineChoose: () => ipcRenderer.invoke('quarantine:choose'),

  // E2: where a copy goes before a delete from the Photos screen. Not an
  // action of its own — it rides on `trash` as an option — so all that is
  // exposed here is choosing the folder and forgetting it again.
  backupChoose: () => ipcRenderer.invoke('backup:choose'),

  // B2: a folder, to another drive. The destination is picked in the main
  // process because only it can open a folder chooser.
  relocate: (folders, options) => ipcRenderer.invoke('action:execute', { kind: 'relocate', items: folders, options }),
  relocateChoose: (forFolder) => ipcRenderer.invoke('relocate:choose', forFolder),

  // B5: a folder, into one .zip. Same shape as relocate: the destination is
  // asked for in the main process, which is the only place that can.
  archive: (folders, options) => ipcRenderer.invoke('action:execute', { kind: 'archive', items: folders, options }),
  archiveChoose: (forFolder) => ipcRenderer.invoke('archive:choose', forFolder),

  // B4: NTFS holds the folder in less room. Nothing moves, so there is no
  // destination to choose — only whether to compress or to stop.
  compress: (folders, options) => ipcRenderer.invoke('action:execute', { kind: 'compress', items: folders, options }),
  compressState: (folder) => ipcRenderer.invoke('compress:state', folder),

  // F4: duplicate copies become extra names for one file. `options` carries
  // which copy each one joins (`keepers`) and whether the confirmation was
  // read to the end (`acknowledged`); the main process refuses without the
  // second, and re-reads and re-hashes both files rather than trusting the
  // first.
  hardlink: (copies, options) => ipcRenderer.invoke('action:execute', { kind: 'hardlink', items: copies, options }),

  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  open: (target) => ipcRenderer.invoke('shell:open', target),

  /* looking at a file without leaving the app */
  preview: (target) => ipcRenderer.invoke('preview:open', target),
  // Two paths (F3, two drafts) or a list of two to four (E1, photographs).
  previewCompare: (left, right) => ipcRenderer.invoke('preview:compare', left, right),
  closePreview: () => ipcRenderer.invoke('preview:close'),

  /* photos and video */
  mediaRoots: () => ipcRenderer.invoke('media:roots'),
  scanMedia: (roots, options) => ipcRenderer.invoke('media:scan', roots, options),
  cancelMediaScan: () => ipcRenderer.invoke('media:cancel'),
  mediaThumbs: (paths, options) => ipcRenderer.invoke('media:thumbs', paths, options),
  mediaSimilar: () => ipcRenderer.invoke('media:similar'),
  // E1: look at every picture rather than only the ones that have been on
  // screen. Costly and explicit — see the handler for the measured figures.
  mediaMeasureAll: () => ipcRenderer.invoke('media:measureAll'),
  mediaMeasureCancel: () => ipcRenderer.invoke('media:measureCancel'),

  /* automatic cleanup */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (next) => ipcRenderer.invoke('settings:save', next),
  runAutoClean: (options) => ipcRenderer.invoke('autoclean:run', options),
  cancelAutoClean: () => ipcRenderer.invoke('autoclean:cancel'),
  /* automatic profiles (G4) */
  saveAutoProfile: (profile) => ipcRenderer.invoke('autoclean:saveProfile', profile),
  addAutoProfile: (template) => ipcRenderer.invoke('autoclean:addProfile', template),
  removeAutoProfile: (id) => ipcRenderer.invoke('autoclean:removeProfile', id),

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
  saveCustomTheme: (theme, options) => ipcRenderer.invoke('theme:saveCustom', theme, options),
  importTheme: () => ipcRenderer.invoke('theme:import'),
  exportTheme: (theme) => ipcRenderer.invoke('theme:export', theme),
  setLanguage: (preference) => ipcRenderer.invoke('language:set', preference),
  getLanguage: () => ipcRenderer.invoke('language:get'),

  /* the Windows tasks behind the schedule */
  taskStatus: (options) => ipcRenderer.invoke('tasks:status', options),
  reconcileTasks: () => ipcRenderer.invoke('tasks:reconcile'),
  runTaskNow: (which) => ipcRenderer.invoke('tasks:runNow', which),

  /* trends */
  getHistory: (options) => ipcRenderer.invoke('history:get', options),
  exportHistory: (format) => ipcRenderer.invoke('history:export', format),
  /* the self-contained HTML report (G2) */
  reportOptions: () => ipcRenderer.invoke('report:options'),
  saveReport: (request) => ipcRenderer.invoke('report:save', request),
  sampleNow: () => ipcRenderer.invoke('trends:sample'),

  /* disk monitoring */
  monitorStatus: () => ipcRenderer.invoke('monitor:status'),
  monitorCheck: () => ipcRenderer.invoke('monitor:check'),
  monitorSnooze: (minutes) => ipcRenderer.invoke('monitor:snooze', minutes),
  monitorResume: () => ipcRenderer.invoke('monitor:resume'),

  /* which features this build may use -- never the licence itself */
  entitlements: () => ipcRenderer.invoke('license:entitlements'),

  /** Subscribe to progress. Returns an unsubscribe function. */
  onScanProgress: (cb) => subscribe('scan:progress', cb),
  onPlannerProgress: (cb) => subscribe('planner:progress', cb),
  onDuplicateProgress: (cb) => subscribe('dupes:progress', cb),
  onTrashProgress: (cb) => subscribe('action:progress', cb),
  onSystemProgress: (cb) => subscribe('system:progress', cb),
  onAppsProgress: (cb) => subscribe('apps:progress', cb),
  onGamesProgress: (cb) => subscribe('games:progress', cb),
  onChatProgress: (cb) => subscribe('chat:progress', cb),
  onDevProgress: (cb) => subscribe('dev:progress', cb),
  onDevProjectsProgress: (cb) => subscribe('dev:projectProgress', cb),
  onAutoCleanProgress: (cb) => subscribe('autoclean:progress', cb),
  onMediaProgress: (cb) => subscribe('media:progress', cb),
  /** Files as they are read, so the grid fills while the scan is still running. */
  onMediaBatch: (cb) => subscribe('media:batch', cb),
  /** How far the look-at-everything pass has got (E1). */
  onMediaMeasureProgress: (cb) => subscribe('media:measureProgress', cb),
  onUpdateState: (cb) => subscribe('update:state', cb),

  /** Fires when a background run rewrites settings, the log or the history. */
  onDataChanged: (cb) => subscribe('app:data-changed', cb),
  // Explorer's right-click menu asked for a folder or a file (I3).
  onTarget: (cb) => subscribe('app:target', cb),
};

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('cleandrive', api);
