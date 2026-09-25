'use strict';

const path = require('node:path');
const { ipcMain, dialog, shell, app, BrowserWindow, nativeTheme, screen } = require('electron');

const analyzers = require('./analyzers');
const manifest = require('./ipc-manifest');
const mediaRoots = require('./lib/media/roots');
const cloud = require('./lib/media/cloud');
const thumbs = require('./lib/media/thumbs');
const perceptual = require('./lib/media/perceptual');
const { MediaCache } = require('./lib/media/cache');
const { preview } = require('./lib/preview');
const previewServe = require('./lib/preview/serve');
const { ESTIMATED_FILES_PER_SEC } = require('./lib/trash');
const { execute } = require('./actions/execute');
const restoreEngine = require('./actions/restore');
const quarantineHandler = require('./actions/quarantine');
const quarantineZone = require('./lib/quarantine-zone');
const systemMeasure = require('./system/measure');
const systemBreakdown = require('./system/breakdown');
const { ScanTree } = require('./analyzers/scan-tree');
const snapshotDiff = require('./snapshots/diff');
const { HelperClient, appLauncher } = require('./helper/client');
const licenseState = require('./license/state');
const entitlements = require('./license/entitlements');
const { CancelToken, formatBytes, formatDuration, pathKey } = require('./lib/util');
const { services } = require('./services');
const scheduler = require('./lib/scheduler');
const { runAutoClean } = require('./lib/autoclean');
const { diskUsage, usageByVolume } = require('./lib/disk');
const { findUserBins, purgeRecorded } = require('./lib/recyclebin');
const historyLib = require('./lib/history');
const { sample, volumeTargets } = require('./lib/sampler');
const tasks = require('./tasks');
const language = require('./language');
const { t } = language;
const tray = require('./tray');
const updater = require('./updater');
const watcher = require('./watcher');
const fsp = require('node:fs').promises;
const i18n = require('../i18n');
const { message: m } = i18n;
const themePalette = require('../shared/theme-palette');
const appearance = require('./appearance');
const contextMenu = require('./lib/context-menu');
const launchTarget = require('./launch-target');

// One in-flight job of each kind at a time; a new run supersedes the old one.
const tokens = { scan: null, dupes: null, trash: null, auto: null, media: null, thumbs: null, system: null };

/* ---- the Disk usage map's state -------------------------------------------- */

/**
 * The last scan's folder tree, which the window reads one level at a time
 * through `scan:children` (see analyzers/scan-tree.js for why never whole).
 * Named by an id the scan's reply carries, so a window still drawing an
 * earlier scan is told so rather than handed another folder's contents.
 */
let scanTree = null;
let scanTreeSerial = 0;

/**
 * The kinds of action that take a file out of the folder it was in. After one
 * of these the map stops drawing what moved; a restore puts files back and is
 * not one of them.
 */
const LEAVES_ITS_FOLDER = new Set(['recycle', 'quarantine']);

/**
 * What "free up space" (B3) asks Windows and OneDrive with. A harness supplies
 * its own, so it can drive the screen without a real OneDrive; the app never
 * sets these.
 */
let cloudDeps = null;
function setCloudDepsForHarness(deps) {
  cloudDeps = deps || null;
}

/**
 * Explorer's right-click menu (I3). The command it writes has to name the
 * installed CleanDrive.exe -- in a checkout, process.execPath is electron.exe,
 * and a menu entry pointing at it would open an empty Electron -- so only a
 * packaged build offers it. A harness supplies an executable path of its own
 * and a reg.exe runner, and its key names carry CLEANDRIVE_TASK_SUFFIX.
 */
let menuHarness = null;
function setContextMenuForHarness(options) {
  menuHarness = options || null;
}
const menuAvailable = () => Boolean(menuHarness) || app.isPackaged;
const menuDeps = () => (menuHarness && menuHarness.deps) || undefined;
function menuOptions() {
  return {
    exe: (menuHarness && menuHarness.exe) || process.execPath,
    labels: {
      analyze: t('explorer.menu.analyze', 'Analyse with CleanDrive'),
      copies: t('explorer.menu.copies', 'Find duplicates with CleanDrive'),
    },
  };
}

/** Make the registry match the setting. Nothing, where the menu is not offered. */
async function reconcileMenu(settings) {
  if (!menuAvailable()) return null;
  return contextMenu.reconcile({ enabled: Boolean(settings.explorer && settings.explorer.contextMenu), ...menuOptions() }, menuDeps());
}

/**
 * Where "Find duplicates" looks for copies of a file (decided 2026-09-25): the
 * Home folder if the file is in it, otherwise the whole drive it is on. A
 * harness names a folder of its own instead of the real Home.
 */
let copiesScope = null;
function setCopiesScopeForHarness(dir) {
  copiesScope = dir || null;
}
function copiesScopeFor(file) {
  if (copiesScope) return copiesScope;
  // A checkout only, for the harness that starts the real app from a command
  // line (verify-launch-target.js) and cannot reach this module's setter. A
  // built installer ignores it, as it ignores CLEANDRIVE_ENTITLEMENTS.
  if (!app.isPackaged && process.env.CLEANDRIVE_COPIES_SCOPE) return process.env.CLEANDRIVE_COPIES_SCOPE;
  const home = app.getPath('home');
  const rel = path.relative(home.toLowerCase(), file.toLowerCase());
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? home : path.parse(file).root;
}

/**
 * Where a harness keeps the "AppData" its known-app caches (D4) live in, and
 * what it says is running. The app never sets these.
 */
let appCacheHarness = null;
function setAppCacheHarness(harness) {
  appCacheHarness = harness || null;
}

/**
 * What the quarantine (B1) would otherwise ask a person or Windows, for a
 * harness: the folder "Choose…" returns (`pick`), what kind of drive a root
 * is (`driveTypeOf`), and the Recycle Bin (`shell`). The app never sets these.
 */
let quarantineHarness = null;
function setQuarantineHarness(harness) {
  quarantineHarness = harness || null;
}

/**
 * What a quarantine is told by the main process, never by the window: the
 * folder, whether originals are deleted outright, the size limit. All of it
 * is read from the settings at the moment the action starts.
 */
async function quarantineDeps() {
  const { quarantine } = await services().settings.get();
  const h = quarantineHarness || {};
  return {
    zone: quarantine.zone,
    deleteOriginal: quarantine.deleteOriginal === true,
    maxBytes: quarantine.maxGB * 1024 ** 3,
    retentionDays: quarantine.retentionDays,
    ...(cloudDeps ? { cloud: cloudDeps } : {}),
    ...(appCacheHarness ? { appCacheEnv: appCacheHarness.env, runningProcessNames: appCacheHarness.runningProcessNames } : {}),
    ...(h.driveTypeOf ? { driveTypeOf: h.driveTypeOf } : {}),
    ...(h.shell ? { shell: h.shell } : {}),
  };
}

/**
 * The quarantine as the Settings card and the startup notice see it: the
 * folder, whether it can take files now, its room, and what is in it.
 */
async function quarantineStatus() {
  const settings = await services().settings.get();
  const q = settings.quarantine;
  const zone = await quarantineZone.check(q.zone, quarantineHarness || {});
  const used = zone.ok ? await quarantineZone.usage(zone.zone) : { bytes: 0, files: 0 };
  const held = await restoreEngine.quarantined(services().journal, { retentionDays: q.retentionDays });
  const drive = q.zone ? path.parse(q.zone).root.replace(/\\$/, '') : null;
  const systemDrive = (process.env.SystemDrive || 'C:').toUpperCase();
  return {
    zone: q.zone,
    ok: zone.ok,
    reason: zone.ok ? null : zone.reason,
    reasonText: zone.ok || zone.reason === 'none' ? null : quarantineHandler.zoneReason(zone.reason),
    drive,
    onSystemDrive: Boolean(drive) && drive.toUpperCase() === systemDrive,
    type: zone.type || null,
    freeBytes: zone.freeBytes || 0,
    totalBytes: zone.totalBytes || 0,
    usedBytes: used.bytes,
    files: used.files,
    kept: held.kept,
    expired: held.expired,
    retentionDays: q.retentionDays,
    maxGB: q.maxGB,
    deleteOriginal: q.deleteOriginal,
  };
}

/* ---- the System screen's state ------------------------------------------- */

/**
 * The last walk of the system drive, and what the elevated pass added to it.
 * Kept because the elevated pass measures exactly the folders the walk was
 * refused, and because coming back to the tab should not mean two minutes of
 * walking again.
 */
let systemState = null;

/** Which drive and profile the screen measures. A harness points it at a fixture. */
let systemOverride = null;
function systemTarget() {
  return systemOverride || { drive: systemBreakdown.driveOf(), home: require('node:os').homedir() };
}
function setSystemTargetForHarness(target) {
  systemOverride = target;
  systemState = null;
}

/** The elevated helper, through UAC -- or, for a harness, whatever it supplies. */
let helperFactory = null;
function helperClientFor() {
  if (helperFactory) return helperFactory();
  return new HelperClient({
    launch: appLauncher({ execPath: process.execPath, appPath: app.getAppPath(), isPackaged: app.isPackaged }),
  });
}
function setHelperClientForHarness(factory) {
  helperFactory = factory;
}

/** What a handoff launches with. A harness records instead of opening windows. */
let handoffDeps = {};
function setHandoffDepsForHarness(deps) {
  handoffDeps = deps || {};
}

async function presentSystem() {
  const model = await systemMeasure.model({ walk: systemState.walk, elevated: systemState.elevated, ledger: services().ledger });
  const { candidates, summary } = await analyzers.collect('system', { model }, { can: licenseState.canNow() });
  return { candidates, summary };
}

/**
 * The size and time of every media file the last scan saw, by path.
 *
 * Kept because the cache key is `path | size | mtime` and the window does not
 * carry those around -- it asks for thumbnails by path. Without this the
 * analysis cache could not be consulted, and every scroll back over a folder
 * would decode it again.
 *
 * Replaced wholesale by each scan rather than added to, so a file that has been
 * deleted or moved stops being remembered.
 */
let mediaStats = new Map();

/** Loaded once and kept: it is read on every thumbnail request. */
let analysisCache = null;
async function mediaAnalysisCache() {
  if (!analysisCache) {
    analysisCache = await new MediaCache(path.join(app.getPath('userData'), 'media-analysis.json')).load();
  }
  return analysisCache;
}

/**
 * The resolutions of the screens attached to this machine, in real pixels.
 *
 * `size` is in device-independent pixels, so on a display at 150% scaling it
 * reports 1280x720 for a screen that takes 1920x1080 screenshots. Multiplying
 * by the scale factor is what makes "this image is exactly the size of your
 * screen" true rather than nearly true.
 */
function displayResolutions() {
  try {
    return screen.getAllDisplays().map((d) => ({
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
    }));
  } catch {
    // Before `app.whenReady`, or on a machine with no display at all. An empty
    // list is handled everywhere: it costs the screenshot rule one signal.
    return [];
  }
}

/** How many media candidates travel in one `media:batch` message. */
const MEDIA_BATCH = 256;

/**
 * Keep the size and time a thumbnail request will need to find its cache
 * entry. The classification itself now lives in the media analyzer.
 */
function rememberMedia(candidate) {
  mediaStats.set(candidate.path, {
    path: candidate.path,
    size: candidate.bytes,
    mtimeMs: candidate.meta.mtimeMs,
    aspect: candidate.meta.aspect || 0,
  });
}

/**
 * What the launch-time reconciliation found, held until a window asks.
 *
 * The check runs before the renderer has loaded, and its result is the answer
 * to "why is my schedule not running" -- so it is kept rather than logged and
 * forgotten. Cleared once the user has been shown it.
 */
let lastReconciliation = null;

/** Called by main.js after the launch reconciliation. */
function noteReconciliation(result) {
  lastReconciliation = result && (result.changes.length > 0 || result.problems.length > 0) ? result : null;
}

/**
 * Register a handler, but only for a channel the manifest lists.
 *
 * The manifest is the written-down answer to "what can the window ask for";
 * registering through here is what keeps that answer true.
 */
const registered = new Set();
function handle(channel, fn) {
  manifest.assertInvokable(channel);
  registered.add(channel);
  ipcMain.handle(channel, fn);
}

/** Uniform envelope so the renderer never has to deal with raw exceptions. */
async function guard(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err && err.code === 'ECANCELLED') return { ok: false, cancelled: true, error: 'Cancelled' };
    // A refusal the handler meant -- "that scan was replaced" -- is an answer,
    // not a fault, and a stack trace for each one would bury the real ones.
    if (!(err && err.quiet)) console.error('[ipc]', err);
    return { ok: false, error: err.message || String(err), code: err.code };
  }
}

function register() {
  /*
   * The language, for anything this process says outside the window.
   *
   * main.js applies it too, and earlier -- it has to, because the theme and
   * the first paint depend on it. This is the safety net for every other way
   * into these handlers: a test harness, or whatever the next entry point
   * turns out to be. Without it, tray.apply() runs here and the disk-space
   * notification comes out in English no matter what the user chose, which is
   * how a smoke test once told its own developer their disk was filling up in
   * the wrong language.
   */
  services()
    .settings.get()
    .then((settings) => language.apply(settings.appearance.language))
    .catch(() => {});

  // Started here rather than in main.js because it is part of the same job as
  // the handlers below: keeping the renderer's view of the app true. The
  // scheduled cleanup writes its result from a separate process, and without
  // this an open window shows whatever was true when it launched.
  //
  // The headless run never calls register(), so it never starts a watch it has
  // no window to notify.
  watcher.start();

  /* ---- folder picker --------------------------------------------------- */

  handle('dialog:pickFolder', (event) =>
    guard(async () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win, {
        title: t('dialog.chooseFolder', 'Choose a folder to analyse'),
        properties: ['openDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    })
  );

  /* ---- scan ------------------------------------------------------------ */

  // The window names a folder and nothing else. It used to be able to pass
  // scanner options through as well -- follow links, stop skipping system
  // folders, name every file in the tree -- and nothing in the window ever
  // did, so nothing it sends is read.
  handle('scan:run', (event, folder) =>
    guard(async () => {
      if (tokens.scan) tokens.scan.cancel();
      const token = new CancelToken();
      tokens.scan = token;

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('scan:progress', payload);
      };

      try {
        const collected = await analyzers.collect(
          'scan',
          // cloudFiles: which OneDrive files could be made online-only (B3).
          {
            root: folder,
            options: {
              collectTree: true,
              cloudFiles: true,
              ...(appCacheHarness && appCacheHarness.env ? { appCacheEnv: appCacheHarness.env } : {}),
            },
            deps: {
              ...(cloudDeps ? { cloud: cloudDeps } : {}),
              ...(appCacheHarness && appCacheHarness.runningProcessNames ? { runningProcessNames: appCacheHarness.runningProcessNames } : {}),
            },
          },
          { token, onProgress: send, can: licenseState.canNow() }
        );
        // The tree stays in this process: the snapshot store keeps it, and the
        // window reads it a level at a time through scan:children.
        const { tree, treeFiles, ...summary } = collected.summary;

        // A cancelled scan reports partial totals; recording those as a point
        // on the trend would put a dip in the series that never happened.
        if (!summary.cancelled) await recordSnapshot(summary, 'scan');
        // The snapshot keeps even a stopped scan, marked incomplete: comparing
        // against it later is allowed, and labelled a guess.
        if (tree) await saveTreeSnapshot({ ...summary, tree });

        let treeId = null;
        if (tree) {
          treeId = `t${++scanTreeSerial}`;
          scanTree = {
            id: treeId,
            tree: new ScanTree({
              root: summary.root,
              rows: tree,
              files: treeFiles,
              complete: !summary.cancelled,
              scannedAt: summary.scannedAt,
              accessTimes: summary.accessTimes,
              openApps: summary.openApps,
            }),
          };
        }
        return { ...summary, treeId, candidates: collected.candidates };
      } finally {
        if (tokens.scan === token) tokens.scan = null;
      }
    })
  );

  handle('scan:cancel', () => {
    if (tokens.scan) tokens.scan.cancel();
    return { ok: true };
  });

  // One folder of the last scan, and what is under it to a few levels -- never
  // the whole tree. The limits are this process's, not the window's to set.
  handle('scan:children', (event, treeId, rel) =>
    guard(async () => {
      if (!scanTree || typeof treeId !== 'string' || treeId !== scanTree.id) {
        throw Object.assign(new Error('That scan has been replaced by a newer one'), { code: 'ESTALE', quiet: true });
      }
      const level = typeof rel === 'string' ? scanTree.tree.level(rel) : null;
      if (!level) throw Object.assign(new Error('The scan has no such folder'), { code: 'ENOENT', quiet: true });
      return { ...level, treeId };
    })
  );

  /* ---- duplicates ------------------------------------------------------ */

  async function runDupes(event, roots, options) {
    if (tokens.dupes) tokens.dupes.cancel();
    const token = new CancelToken();
    tokens.dupes = token;

    const send = (payload) => {
      if (!event.sender.isDestroyed()) event.sender.send('dupes:progress', payload);
    };

    try {
      const { candidates, summary } = await analyzers.collect(
        'duplicates',
        { roots, options: { ...options, cachePath: path.join(app.getPath('userData'), 'hash-cache.json') } },
        { token, onProgress: send, can: licenseState.canNow() }
      );
      return { ...summary, candidates };
    } finally {
      if (tokens.dupes === token) tokens.dupes = null;
    }
  }

  handle('dupes:run', (event, roots, options = {}) => guard(() => runDupes(event, roots, options)));

  /**
   * Copies of one file (I3's "Find duplicates with CleanDrive").
   *
   * Where to look is decided here, not by the window (decided 2026-09-25):
   * the Home folder, or the whole drive when the file is not in Home. Only
   * the files of its exact size are read at all.
   */
  handle('dupes:copiesOf', (event, filePath) =>
    guard(async () => {
      const target = launchTarget.validate({ kind: 'duplicates', path: filePath });
      if (!target) throw Object.assign(new Error(t('dupes.copies.gone', 'That file is not there any more.')), { code: 'ENOENT', quiet: true });
      const scope = copiesScopeFor(target.path);
      const result = await runDupes(event, [scope], { copiesOf: target.path });
      return { ...result, scope };
    })
  );

  handle('dupes:cancel', () => {
    if (tokens.dupes) tokens.dupes.cancel();
    return { ok: true };
  });

  /* ---- delete ---------------------------------------------------------- */

  /*
   * Every action on a file, from any screen.
   *
   * One handler, because one pipeline (`actions/execute.js`): the vetting, the
   * permission probe, the confirmation and the record are the same whatever
   * kind of action it is, and a kind without a handler is refused there.
   */
  handle('action:execute', (event, request = {}) =>
    guard(async () => {
      const kind = typeof request.kind === 'string' ? request.kind : '';
      const list = Array.isArray(request.items) ? request.items : [];
      const options = request.options && typeof request.options === 'object' ? request.options : {};
      if (list.length === 0) return { kind, moved: [], failed: [], movedBytes: 0, freedBytes: 0, requested: 0 };

      if (tokens.trash) tokens.trash.cancel();
      const token = new CancelToken();
      tokens.trash = token;

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('action:progress', payload);
      };

      // The window may ask for a dry run. It may not ask to skip the dialog:
      // "nothing moves without a click on the confirmation" is only true if
      // the thing being protected against cannot switch it off. A harness that
      // drives the real app turns that off from the main process instead.
      const confirmWanted = !(options.confirm === false && unconfirmedAllowed);
      const win = BrowserWindow.fromWebContents(event.sender);

      try {
        const result = await execute(
          { kind, items: list, options: { dryRun: options.dryRun === true } },
          {
            token,
            onProgress: send,
            can: licenseState.canNow(),
            source: 'manual',
            runId: 'manual',
            deps:
              kind === 'quarantine'
                ? await quarantineDeps()
                : kind === 'dehydrate' && cloudDeps
                  ? cloudDeps
                  : kind === 'recycle' && appCacheHarness
                    ? { appCacheEnv: appCacheHarness.env, runningProcessNames: appCacheHarness.runningProcessNames }
                    : undefined,
            // Every item is journalled as it moves. Nothing is purged because
            // of that -- the purge has its own switch, its own grace period and
            // its own corroboration against the bin -- but without the record
            // there is no way to later tell our items from the user's own.
            journal: services().journal,
            confirm: confirmWanted ? (description, planned) => confirmAction(win, description, planned, options) : null,
          }
        );

        // What left its folder leaves the map too, whichever screen moved it.
        if (!result.dryRun && result.moved.length > 0 && scanTree && LEAVES_ITS_FOLDER.has(kind)) {
          scanTree.tree.remove(result.moved);
        }

        if (!result.dryRun && result.moved.length > 0) {
          // Recorded as *moved*, never as freed: these bytes are in the Recycle
          // Bin, which is on the same disk.
          await services()
            .history.addEvent({
              // "Moved to the bin" is the Recycle Bin's column; making a file
              // online-only moved nothing there, and its freed figure is the
              // one it measured. A quarantine's originals went to the bin
              // unless they were deleted outright, which is what it freed.
              movedBytes:
                kind === 'recycle'
                  ? result.movedBytes
                  : kind === 'quarantine'
                    ? Math.max(0, result.movedBytes - result.freedBytes)
                    : 0,
              freedBytes: result.freedBytes,
              files: result.moved.length,
              source: 'manual',
            })
            .catch(() => {});
        }

        return result;
      } finally {
        if (tokens.trash === token) tokens.trash = null;
      }
    })
  );

  handle('action:stop', () => {
    if (tokens.trash) tokens.trash.cancel();
    return { ok: true };
  });

  /* ---- the System screen (A1) -------------------------------------------- */

  /*
   * Where the system drive's space went.
   *
   * Two channels with fixed jobs rather than one that forwards requests to the
   * elevated helper: the window can ask for "measure" and for "measure with
   * administrator rights", and never for a helper operation of its choosing.
   * The second is the only thing in the app that raises a UAC prompt, and it
   * runs only when the button that says so was pressed.
   */
  handle('system:facts', () =>
    guard(async () => {
      const target = systemTarget();
      const facts = await systemMeasure.facts(target.drive);
      return { ...facts, last: systemState ? await presentSystem() : null };
    })
  );

  handle('system:measure', (event) =>
    guard(async () => {
      if (tokens.system) tokens.system.cancel();
      const token = new CancelToken();
      tokens.system = token;
      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('system:progress', payload);
      };
      try {
        const target = systemTarget();
        const walk = await systemMeasure.walk({ drive: target.drive, home: target.home, token, onProgress: send });
        systemState = { walk, elevated: null };
        return await presentSystem();
      } finally {
        if (tokens.system === token) tokens.system = null;
      }
    })
  );

  handle('system:measureElevated', (event) =>
    guard(async () => {
      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('system:progress', payload);
      };
      if (!systemState) {
        const token = new CancelToken();
        tokens.system = token;
        const target = systemTarget();
        const walk = await systemMeasure.walk({ drive: target.drive, home: target.home, token, onProgress: send });
        if (tokens.system === token) tokens.system = null;
        systemState = { walk, elevated: null };
        if (walk.cancelled) return await presentSystem();
      }
      const elevated = await systemMeasure.elevate(systemState.walk, { client: helperClientFor(), onProgress: send });
      if (elevated.declined) return { declined: true, ...(await presentSystem()) };
      systemState.elevated = elevated;
      return await presentSystem();
    })
  );

  handle('system:cancel', () => {
    if (tokens.system) tokens.system.cancel();
    return { ok: true };
  });

  // Opening the Windows tool that owns a row. The key must be in the fixed
  // table in actions/handoff.js; nothing else is opened.
  handle('system:handoff', (_event, key) =>
    guard(async () =>
      execute(
        { kind: 'handoff', items: [typeof key === 'string' ? key : ''] },
        { journal: services().journal, source: 'manual', runId: 'manual', can: licenseState.canNow(), deps: handoffDeps }
      )
    )
  );

  /* ---- what changed in a folder (snapshot diff) -------------------------- */

  /*
   * Every folder with snapshots, and which two of each a comparison opens on.
   * Reading the list is free -- it is what tells the window there is anything
   * to compare; comparing is `pro.diff`.
   */
  handle('snapshot:list', () =>
    guard(async () => {
      const store = services().snapshots;
      const roots = [];
      for (const root of await store.roots()) {
        const list = await store.list(root);
        roots.push({
          root,
          volume: path.parse(root).root,
          snapshots: list
            .map(({ file, takenAt, complete, totals }) => ({ file, takenAt, complete, totals }))
            .sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt)),
          pair: snapshotDiff.defaultPair(list),
        });
      }
      return { roots, allowed: licenseState.canNow()('pro.diff') };
    })
  );

  /*
   * Two snapshots of one folder, compared. The window names a folder the store
   * holds and two files its index lists; anything else is refused, and nothing
   * it sends becomes a path on its own.
   */
  handle('snapshot:diff', (_event, request = {}) =>
    guard(async () => {
      if (!licenseState.canNow()('pro.diff')) return { ok: false, locked: 'pro.diff' };
      const store = services().snapshots;
      const asked = request && typeof request.root === 'string' ? request.root : null;
      const root = asked ? (await store.roots()).find((r) => pathKey(r) === pathKey(asked)) : null;
      const refuse = () => {
        throw Object.assign(new Error('No such snapshot'), { code: 'ENOENT', quiet: true });
      };
      if (!root) refuse();
      const listed = new Set((await store.list(root)).map((s) => s.file));
      const names = [request.older, request.newer];
      if (!names.every((name) => typeof name === 'string' && listed.has(name)) || names[0] === names[1]) refuse();
      const [a, b] = await Promise.all(names.map((name) => store.load(root, name)));
      return snapshotDiff.diffSnapshots(a, b, { files: names });
    })
  );

  /* ---- the Restore Center ------------------------------------------------ */

  /*
   * Everything the app did, and where it is now.
   *
   * Read-only: the journal says what happened and the disk is asked where each
   * item is today. Nothing here passes through the licence -- an expired
   * licence must never make something the app did impossible to undo, so these
   * handlers are not given a `can` at all.
   */
  // The days a quarantined file may sit before the Restore Center calls it
  // expired. Said, never acted on.
  const retention = async () => ({ retentionDays: (await services().settings.get()).quarantine.retentionDays });

  handle('journal:sessions', () =>
    guard(async () => restoreEngine.listSessions(services().journal, { deps: await retention() }))
  );

  handle('journal:items', (_event, sessionId) =>
    guard(async () => {
      if (typeof sessionId !== 'string' || !/^s_[0-9a-f]{8}$/.test(sessionId)) throw new Error('Not a session id');
      const items = await restoreEngine.listItems(services().journal, sessionId, { deps: await retention() });
      if (!items) throw new Error('No such session');
      return items;
    })
  );

  /*
   * Put items back. The window names them by journal id -- `s_1a2b3c4d:17` --
   * never by path, so it can ask for something the app did to be undone and
   * for nothing else.
   *
   * The same pipeline as a delete, and the same shared token, so the progress
   * panel's Stop works for both and only one of them runs at a time.
   */
  handle('journal:restore', (event, request = {}) =>
    guard(async () => {
      const ids = (Array.isArray(request.items) ? request.items : [])
        .filter((id) => typeof id === 'string' && /^s_[0-9a-f]{8}:\d{1,7}$/.test(id));
      const options = request.options && typeof request.options === 'object' ? request.options : {};
      if (ids.length === 0) return { kind: 'restore', moved: [], failed: [], movedBytes: 0, freedBytes: 0, requested: 0 };

      if (tokens.trash) tokens.trash.cancel();
      const token = new CancelToken();
      tokens.trash = token;
      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('action:progress', payload);
      };
      const confirmWanted = !(options.confirm === false && unconfirmedAllowed);
      const win = BrowserWindow.fromWebContents(event.sender);
      const journal = services().journal;

      try {
        return await execute(
          {
            kind: 'restore',
            items: ids,
            // What to do about a file in the way is the dialog's question. Only
            // when the harness has switched the dialog off does the request get
            // to say, and then it cannot choose to replace anything.
            options: confirmWanted ? {} : { onConflict: options.onConflict === 'rename' ? 'rename' : 'skip' },
          },
          {
            token,
            onProgress: send,
            source: 'manual',
            runId: 'manual',
            journal,
            deps: { journal },
            confirm: confirmWanted ? (description, planned) => confirmRestore(win, description, planned) : null,
          }
        );
      } finally {
        if (tokens.trash === token) tokens.trash = null;
      }
    })
  );

  /* ---- quarantine (B1) ----------------------------------------------------- */

  handle('quarantine:status', () => guard(async () => quarantineStatus()));

  // The folder is picked in the native dialog, here, and checked and made
  // here: the window never names a path for files to be copied into.
  handle('quarantine:choose', (event) =>
    guard(async () => {
      let picked = null;
      if (quarantineHarness && typeof quarantineHarness.pick === 'function') {
        picked = await quarantineHarness.pick();
      } else {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, {
          title: t('dialog.chooseQuarantine', 'Choose where moved files go — on a different drive from the one you are freeing'),
          properties: ['openDirectory', 'createDirectory'],
        });
        picked = result.canceled ? null : result.filePaths[0];
      }
      if (!picked) return { chosen: false, ...(await quarantineStatus()) };
      const made = await quarantineZone.prepare(picked, quarantineHarness || {});
      if (!made.ok) {
        return { chosen: false, refusal: quarantineHandler.zoneReason(made.reason), ...(await quarantineStatus()) };
      }
      await services().settings.patch({ quarantine: { zone: made.zone } });
      return { chosen: true, ...(await quarantineStatus()) };
    })
  );

  /* ---- automatic cleanup ------------------------------------------------ */

  handle('settings:get', () => guard(() => readState()));

  handle('settings:save', (event, next) =>
    guard(async () => {
      // The quarantine folder is set only by `quarantine:choose`, which checks
      // it and makes it; a save from the window keeps whatever is there.
      if (next && next.quarantine && typeof next.quarantine === 'object') {
        const { zone, ...rest } = next.quarantine;
        next = { ...next, quarantine: rest };
      }
      // Likewise the user's own colours, set only through `theme:saveCustom`:
      // a screen that loaded the settings before they were made would
      // otherwise save them away.
      if (next && next.appearance && typeof next.appearance === 'object') {
        const { custom, ...rest } = next.appearance;
        next = { ...next, appearance: rest };
      }
      // And the Explorer menu, set only through `explorer:set`, which writes
      // the registry in the same breath: the setting and the keys must not
      // disagree.
      if (next && next.explorer) {
        const { explorer, ...rest } = next;
        next = rest;
      }
      const { settings } = await services().settings.patch(next);
      // The Task Scheduler entries and the tray are both derived state, never a
      // second source of truth: whatever the settings say, the OS and the
      // running process are made to match on every save.
      //
      // `settingsExisted: true` is not an assumption -- patch() has just
      // written the file, so the user's intent is on disk by the time this runs.
      const reconciled = await tasks.reconcile(settings, { settingsExisted: true });
      tray.apply(settings);
      // Without this, switching update checks on in the UI would not start the
      // checker until the next launch -- and switching them off would leave a
      // timer running that the user believes they stopped.
      updater.apply(settings);
      const state = await readState();
      return { ...state, reconciled };
    })
  );

  /**
   * The OS's own account of the tasks: last run, next run, and the exit code
   * of the last run.
   *
   * Separate from `settings:get` because it costs a PowerShell call per task
   * (~1s), and the settings screen refreshes itself whenever a background run
   * writes a file. The renderer asks for this when the tab is opened or the
   * Check button is pressed, not on every repaint.
   */
  handle('tasks:status', (event, options = {}) =>
    guard(async () => {
      const store = services().settings;
      const settings = await store.load();
      // `fresh` skips the short cache in front of the PowerShell call. The tab
      // opening does not need to; the Check button, which the user pressed
      // precisely to get a current answer, does.
      return tasks.status(settings, {
        withOsInfo: true,
        fresh: options.fresh === true,
        settingsExisted: store.exists,
      });
    })
  );

  /** Re-check and repair, on demand, and report what changed. */
  handle('tasks:reconcile', () =>
    guard(async () => {
      const store = services().settings;
      const settings = await store.load();
      const reconciled = await tasks.reconcile(settings, { settingsExisted: store.exists });
      return { reconciled, state: await readState() };
    })
  );

  /**
   * Start a registered task now, through Task Scheduler itself.
   *
   * This is the button that answers "will it actually run when I am not
   * looking": the app does not do the work here, Windows starts the same
   * headless process the schedule would, and the result appears in the run log
   * the same way. Running the job in-process would prove nothing about the
   * registration.
   */
  handle('tasks:runNow', (event, which = 'cleanup') =>
    guard(async () => {
      const taskPath = which === 'sampler' ? scheduler.sampleTaskPath() : scheduler.cleanupTaskPath();
      if (!(await scheduler.isInstalled(taskPath))) {
        throw new Error(t('task.error.notRegistered', 'No task is registered with Windows yet — save the settings first.'));
      }
      const started = await scheduler.runNow(taskPath);
      if (!started.ok) {
        throw new Error(started.error || t('task.error.refusedStart', 'Task Scheduler refused to start the task'));
      }
      return { started: true, taskPath };
    })
  );

  handle('autoclean:run', (event, options = {}) =>
    guard(async () => {
      if (tokens.auto) tokens.auto.cancel();
      const token = new CancelToken();
      tokens.auto = token;

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('autoclean:progress', payload);
      };

      try {
        const { settings: store, ledger, runLog } = services();
        const base = await store.load();
        await ledger.load();
        await runLog.load();

        // Pressing the button is the consent to run, so a configuration that is
        // saved but not switched on can still be tested. Nothing else about the
        // policy is relaxed.
        const dryRun = options.dryRun !== false;
        const settings = {
          ...base,
          autoClean: { ...base.autoClean, enabled: true, dryRun },
        };

        const win = BrowserWindow.fromWebContents(event.sender);
        const run = await runAutoClean({
          settings,
          ledger,
          journal: services().journal,
          source: 'manual',
          token,
          onStage: send,
          onConfirm: dryRun ? undefined : (selection) => confirmAutoDelete(win, selection, settings),
        });

        run.manual = true;
        await runLog.append(run);

        if (!dryRun && (run.trashed.bytes > 0 || run.purged.bytes > 0)) {
          await services()
            .history.addEvent({
              movedBytes: run.trashed.bytes,
              freedBytes: run.purged.bytes,
              files: run.trashed.files,
              source: 'autoclean',
            })
            .catch(() => {});
          await recordSnapshot(null, 'cleanup');
        }

        send({ stage: 'done' });
        return { run, state: await readState() };
      } finally {
        if (tokens.auto === token) tokens.auto = null;
      }
    })
  );

  handle('autoclean:cancel', () => {
    if (tokens.auto) tokens.auto.cancel();
    return { ok: true };
  });

  /* ---- disk ------------------------------------------------------------- */

  handle('disk:usage', (event, target) =>
    guard(async () => diskUsage(target || app.getPath('home')))
  );

  /* ---- Recycle Bin ------------------------------------------------------ */

  handle('recyclebin:preview', () =>
    guard(async () => {
      const { settings: store, ledger } = services();
      const settings = await store.load();
      await ledger.load();

      const expired = ledger.expired(settings.purge.afterDays);
      if (expired.length === 0) {
        return { items: 0, bytes: 0, tracked: ledger.entries.length, afterDays: settings.purge.afterDays };
      }

      const bins = await findUserBins(volumesOf(expired));
      const preview = await purgeRecorded({
        entries: expired,
        binDirs: bins,
        afterDays: settings.purge.afterDays,
        dryRun: true,
      });

      return {
        items: preview.purged.length,
        bytes: preview.freedBytes,
        tracked: ledger.entries.length,
        afterDays: settings.purge.afterDays,
        examined: preview.examined,
      };
    })
  );

  handle('recyclebin:purge', (event) =>
    guard(async () => {
      const { settings: store, ledger } = services();
      const settings = await store.load();
      await ledger.load();

      const expired = ledger.expired(settings.purge.afterDays);
      if (expired.length === 0) return { purged: 0, bytes: 0 };

      const bins = await findUserBins(volumesOf(expired));
      const preview = await purgeRecorded({
        entries: expired,
        binDirs: bins,
        afterDays: settings.purge.afterDays,
        dryRun: true,
      });

      if (preview.purged.length === 0) return { purged: 0, bytes: 0 };

      // This is the one irreversible action in the app, so it gets the bluntest
      // dialog in the app.
      const win = BrowserWindow.fromWebContents(event.sender);
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: [t('dialog.purge.confirm', 'Delete permanently'), t('app.cancel', 'Cancel')],
        defaultId: 1,
        cancelId: 1,
        title: t('dialog.purge.title', 'Permanently delete recycled items'),
        message: t('dialog.purge.message', 'Permanently delete {n} item(s) from the Recycle Bin?', {
          n: preview.purged.length.toLocaleString(language.current()),
        }),
        detail:
          t('dialog.purge.detail', 'This frees {size} and cannot be undone.', {
            size: formatBytes(preview.freedBytes),
          }) +
          '\n\n' +
          t(
            'dialog.purge.scope',
            'Only items CleanDrive moved there itself, more than {days} day(s) ago, are affected. ' +
              'Anything you deleted yourself stays in the Recycle Bin.',
            { days: settings.purge.afterDays }
          ),
      });

      if (response !== 0) return { purged: 0, bytes: 0, cancelled: true };

      const result = await purgeRecorded({
        entries: expired,
        binDirs: bins,
        afterDays: settings.purge.afterDays,
      });
      if (result.purged.length > 0) {
        await ledger.forget(result.purged.map((p) => p.entry), { freedBytes: result.freedBytes });
        // The one place `freedBytes` is the honest word for it.
        await services()
          .history.addEvent({ freedBytes: result.freedBytes, files: result.purged.length, source: 'purge' })
          .catch(() => {});
        await recordSnapshot(null, 'purge');
      }

      return { purged: result.purged.length, bytes: result.freedBytes, failed: result.failed.length };
    })
  );

  /* ---- appearance -------------------------------------------------------- */

  /* ---- Explorer's right-click menu (I3) ---------------------------------- */

  handle('explorer:status', () =>
    guard(async () => {
      const settings = await services().settings.get();
      if (!menuAvailable()) return { available: false, enabled: settings.explorer.contextMenu };
      const now = await contextMenu.status(menuOptions(), menuDeps());
      return { available: true, enabled: settings.explorer.contextMenu, ...now };
    })
  );

  /**
   * Switch the menu on or off: the registry first, the setting after, so a
   * write Windows refused leaves the setting saying what is really there.
   */
  handle('explorer:set', (event, enabled) =>
    guard(async () => {
      if (!menuAvailable()) {
        throw Object.assign(new Error(t('explorer.dev', 'Only the installed app can add itself to Explorer’s menu.')), { code: 'EDEV', quiet: true });
      }
      const want = enabled === true;
      let result;
      try {
        result = await contextMenu.reconcile({ enabled: want, ...menuOptions() }, menuDeps());
      } catch (err) {
        throw Object.assign(new Error(t('explorer.failed', 'Windows did not take the change: {why}', { why: err.message })), { code: err.code, quiet: true });
      }
      await services().settings.patch({ explorer: { contextMenu: want } });
      return { available: true, enabled: want, changed: result.changed, ...result.status };
    })
  );

  /** What the window is told after any change of appearance. */
  const appearanceReply = (settings) => {
    const custom = settings.appearance.custom;
    return {
      theme: settings.appearance.theme,
      custom: custom ? { enabled: custom.enabled, name: custom.name, base: custom.base, colors: custom.colors } : null,
      dark: nativeTheme.shouldUseDarkColors,
    };
  };

  handle('theme:set', (event, mode) =>
    guard(async () => {
      const store = services().settings;
      const current = await store.get();
      const stored = current.appearance.custom;
      let patch;
      if (mode === 'custom') {
        if (!stored) {
          throw Object.assign(new Error(t('theme.noCustom', 'There are no colours of your own saved yet.')), { quiet: true });
        }
        patch = { appearance: { custom: { ...stored, enabled: true } } };
      } else {
        // Choosing light, dark or system keeps the palette, switched off, so
        // it is still there to go back to.
        patch = { appearance: { theme: mode, custom: stored ? { ...stored, enabled: false } : null } };
      }
      const { settings } = await store.patch(patch);

      // appearance.apply() sets themeSource, which does two things at once: it
      // is what main.js reads back when it next builds a window, and it is
      // what makes Electron's own dialogs -- the delete confirmation, the
      // folder picker -- match. A light app throwing a black modal is the
      // giveaway that a theme was bolted on.
      appearance.apply(settings.appearance);
      return appearanceReply(settings);
    })
  );

  /**
   * Keep the user's own colours, and use them if asked.
   *
   * The palette comes from the window, so it is held to every rule again here
   * -- the editor checking it first is a courtesy, not the check. A palette
   * that fails is an answer, not an error: the reply lists what failed, and
   * nothing is saved. `null` forgets the palette.
   */
  handle('theme:saveCustom', (event, theme, options = {}) =>
    guard(async () => {
      const store = services().settings;
      if (theme === null) {
        const { settings } = await store.patch({ appearance: { custom: null } });
        appearance.apply(settings.appearance);
        return { saved: true, ...appearanceReply(settings) };
      }
      const shaped = themePalette.normalise(theme);
      if (!shaped.ok) return { saved: false, errors: shaped.errors };
      const verdict = themePalette.check(shaped.theme);
      if (!verdict.ok) return { saved: false, failures: verdict.failures.map((f) => ({ ...f, message: themePalette.describe(f) })) };

      const current = await store.get();
      const enabled = options && options.use === true ? true : Boolean(current.appearance.custom && current.appearance.custom.enabled);
      const { name, base, colors } = shaped.theme;
      const { settings } = await store.patch({ appearance: { custom: { enabled, name, base, colors } } });
      appearance.apply(settings.appearance);
      return { saved: true, ...appearanceReply(settings) };
    })
  );

  /**
   * Read a theme file the user picks, for the editor. Saves nothing.
   *
   * The file is measured before it is read: anything over the size a theme
   * can be is refused unopened. A file whose shape is wrong is refused with
   * the reasons; one whose shape is right but whose colours fail a rule comes
   * back with the failures, so the editor can show it and let them be fixed
   * -- it still cannot be used until they are.
   */
  handle('theme:import', (event) =>
    guard(async () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showOpenDialog(win, {
        title: t('dialog.importTheme', 'Choose a CleanDrive theme file'),
        properties: ['openFile'],
        filters: [{ name: t('dialog.themeFiles', 'CleanDrive theme'), extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePaths.length) return { cancelled: true };
      const file = picked.filePaths[0];
      const stat = await fsp.stat(file);
      if (!stat.isFile()) return { refused: true, errors: [m('theme.err.notFile', 'That is not a file.')] };
      if (stat.size > themePalette.MAX_BYTES) return { refused: true, errors: themePalette.parse('', stat.size).errors };
      const parsed = themePalette.parse(await fsp.readFile(file, 'utf8'), stat.size);
      if (!parsed.ok) return { refused: true, errors: parsed.errors };
      const verdict = themePalette.check(parsed.theme);
      return {
        theme: parsed.theme,
        filled: parsed.filled,
        failures: verdict.failures.map((f) => ({ ...f, message: themePalette.describe(f) })),
        file: path.basename(file),
      };
    })
  );

  /** Write the editor's palette to a file the user picks. */
  handle('theme:export', (event, theme) =>
    guard(async () => {
      const shaped = themePalette.normalise(theme);
      if (!shaped.ok) {
        throw Object.assign(new Error(shaped.errors.map((e) => i18n.render(e)).join(' ')), { quiet: true });
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      const safe = (shaped.theme.name || t('theme.defaultName', 'My colours')).replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'theme';
      const picked = await dialog.showSaveDialog(win, {
        title: t('dialog.exportTheme', 'Save these colours as a theme file'),
        defaultPath: path.join(app.getPath('documents'), `${safe}.cleandrive-theme.json`),
        filters: [{ name: t('dialog.themeFiles', 'CleanDrive theme'), extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePath) return { cancelled: true };
      await fsp.writeFile(picked.filePath, themePalette.serialise(shaped.theme), 'utf8');
      return { file: path.basename(picked.filePath) };
    })
  );

  /**
   * Change the language.
   *
   * The main process changes with it, which is the part that would be easy to
   * forget: the tray menu is already built, and the confirmation dialog in
   * front of the next deletion is composed here, not in the window. A window
   * that switched to Vietnamese while the dialog asking "may I delete 2,431
   * files?" stayed English would leave the one sentence that must be
   * understood in the language the user just turned off.
   */
  handle('language:set', (event, preference) =>
    guard(async () => {
      const { settings } = await services().settings.patch({ appearance: { language: preference } });
      const code = language.apply(settings.appearance.language);

      // Rebuilt rather than relabelled: the menu is constructed from strings
      // when it is created, so it holds whatever language was current then.
      tray.apply(settings);

      // Explorer's menu too: its labels are strings in the registry, written
      // in the language that was current when they were.
      if (settings.explorer.contextMenu) {
        reconcileMenu(settings).catch((err) => console.error('[explorer] could not relabel the menu:', err.message));
      }

      return { preference: settings.appearance.language, language: code };
    })
  );

  /** What the window needs to draw the language control. */
  handle('language:get', () =>
    guard(async () => {
      const settings = await services().settings.load();
      return {
        preference: settings.appearance.language,
        language: language.current(),
        available: language.LANGUAGES,
        system: language.systemLanguages(),
      };
    })
  );

  /* ---- updates ----------------------------------------------------------- */

  handle('update:state', () =>
    guard(async () => {
      // `enabled` comes from the stored setting rather than the updater's own
      // copy: the updater only learns it when apply() runs, and a screen that
      // reported "off" while the setting said "on" would be lying about the
      // one thing on this card that matters.
      const settings = await services().settings.get();
      return { ...updater.snapshot(), enabled: settings.updates.enabled };
    })
  );

  handle('update:check', () => guard(async () => updater.check({ manual: true })));

  handle('update:download', () => guard(async () => updater.download()));

  handle('update:install', () => guard(async () => updater.install()));

  handle('update:acknowledge', () => guard(async () => {
    updater.acknowledgeUpdate();
    return updater.snapshot();
  }));

  /* ---- trends ----------------------------------------------------------- */

  handle('history:get', (event, options = {}) =>
    guard(async () => {
      const { history, settings: store } = services();
      await history.load();
      const settings = await store.load();

      // The chart's own answer to "how do I get data in here": what is
      // measuring the disk, when it last did, and when it will next. Without
      // this the tab could only say "no measurements yet" and leave the user to
      // guess what would produce one.
      const taskStatus = await tasks.status(settings, { withOsInfo: false, settingsExisted: store.exists });

      return {
        ...historyLib.report(history, { volumeRoot: options.volume }),
        sampling: {
          dailySample: settings.trends.dailySample,
          sampleTime: settings.trends.sampleTime,
          taskInstalled: taskStatus.sampler.installed,
          taskVerified: taskStatus.sampler.verified,
          taskProblems: taskStatus.sampler.problems || [],
          nextSampleAt: taskStatus.sampler.expectedNextRunAt,
          supported: taskStatus.supported,
          monitorRunning: tray.status().running,
        },
      };
    })
  );

  /**
   * Measure the disk now.
   *
   * The button exists so that "the chart needs measurements" is something the
   * user can act on immediately rather than a week of waiting. The history
   * store still collapses two measurements taken within half an hour of each
   * other, so pressing it repeatedly cannot manufacture a trend -- and the
   * reply says when that has happened rather than pretending a point was added.
   */
  handle('trends:sample', () =>
    guard(async () => {
      const { history, settings: store } = services();
      await history.load();
      const settings = await store.load();

      const result = await sample({
        history,
        settings,
        source: 'manual',
        extraTargets: [app.getPath('userData')],
      });
      if (!result.ok) throw new Error(result.error || t('trends.error.measure', 'The disk could not be measured'));

      return { ...result, snapshots: history.snapshots.length };
    })
  );

  /**
   * Export is JSON or CSV, not PDF.
   *
   * The strategy document asked for a PDF report. A PDF of a chart is a picture
   * of the data: it cannot be checked, replotted or joined to anything. These
   * two formats hand over the actual numbers, and they are what somebody
   * querying the app's conclusions would ask for.
   */
  handle('history:export', (event, format = 'json') =>
    guard(async () => {
      const { history } = services();
      await history.load();

      const win = BrowserWindow.fromWebContents(event.sender);
      const csv = format === 'csv';
      const stamp = new Date().toISOString().slice(0, 10);

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: t('dialog.exportHistory', 'Export storage history'),
        defaultPath: `cleandrive-history-${stamp}.${csv ? 'csv' : 'json'}`,
        filters: csv ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'JSON', extensions: ['json'] }],
      });
      if (canceled || !filePath) return { written: false };

      const body = csv ? toCsv(history) : JSON.stringify(
        { exportedAt: Date.now(), snapshots: history.snapshots, events: history.events },
        null,
        2
      );

      await require('node:fs/promises').writeFile(filePath, body, 'utf8');
      return { written: true, path: filePath, rows: history.snapshots.length };
    })
  );

  /* ---- disk monitoring --------------------------------------------------- */

  handle('monitor:status', () => guard(async () => tray.status()));

  handle('monitor:check', () =>
    guard(async () => {
      await tray.checkNow();
      return tray.status();
    })
  );

  handle('monitor:snooze', (event, minutes) =>
    guard(async () => {
      const result = tray.snooze(minutes);
      if (!result.ok) throw new Error(result.error);
      return tray.status();
    })
  );

  handle('monitor:resume', () =>
    guard(async () => {
      const result = tray.clearSnooze();
      if (!result.ok) throw new Error(result.error);
      return tray.status();
    })
  );

  /* ---- photos and video -------------------------------------------------- */

  /**
   * Where the scan can look, and which of those are on by default.
   *
   * Sent rather than assumed by the window, because only this process knows
   * where the known folders actually are -- on the machine this was written on
   * `Pictures` resolves to `OneDrive\Hình ảnh`, and no amount of guessing in
   * the renderer would find it.
   */
  handle('media:roots', () =>
    guard(async () => {
      const list = mediaRoots.candidateRoots(
        {
          home: app.getPath('home'),
          pictures: safePath('pictures'),
          videos: safePath('videos'),
          downloads: safePath('downloads'),
        },
        (p) => require('node:fs').existsSync(p)
      );

      return list.map((entry) => ({
        ...entry,
        // So the chip can say "these are your OneDrive photos" before the user
        // has scanned anything and found out the hard way.
        cloudService: cloud.serviceForPath(entry.path),
      }));
    })
  );

  handle('media:scan', (event, roots, options = {}) =>
    guard(async () => {
      if (tokens.media) tokens.media.cancel();
      const token = new CancelToken();
      tokens.media = token;

      const send = (channel, payload) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
      };

      const context = { displays: displayResolutions() };
      // Replaced rather than added to: a file that has been deleted or moved
      // since the last scan must stop being remembered, or a thumbnail request
      // would look it up under a size and time it no longer has.
      mediaStats = new Map();

      // Candidates go over in batches as they are read, so the grid starts
      // filling while the scan is still running rather than after it. They are
      // gathered here rather than sent one message each: fifty thousand IPC
      // messages cost more than the fifty thousand records they carry.
      const byId = new Map();
      let pending = [];
      const flush = () => {
        if (pending.length === 0) return;
        send('media:batch', pending);
        pending = [];
      };

      try {
        for await (const item of analyzers.runAnalyzer(
          'media',
          {
            roots,
            options: { ...options, cachePath: path.join(app.getPath('userData'), 'media-cache.json') },
            context,
          },
          { token, can: licenseState.canNow() }
        )) {
          if (item.type === 'candidate') {
            const candidate = item.candidate;
            byId.set(candidate.id, candidate);
            rememberMedia(candidate);
            pending.push(candidate);
            if (pending.length >= MEDIA_BATCH) flush();
          } else if (item.type === 'progress') {
            flush();
            send('media:progress', item);
          } else if (item.type === 'summary') {
            flush();
            const { visibleIds, ...summary } = item.summary;
            return { ...summary, files: visibleIds.map((id) => byId.get(id)).filter(Boolean) };
          }
        }
        return { files: [], cancelled: true };
      } finally {
        if (tokens.media === token) tokens.media = null;
      }
    })
  );

  handle('media:cancel', () => {
    if (tokens.media) tokens.media.cancel();
    return { ok: true };
  });

  /**
   * Thumbnails for what is on screen.
   *
   * Asked for a screenful at a time by the grid as cells scroll into view, and
   * never for the whole library: drawing one costs a full-resolution decode
   * (measured at 71 ms a file) and no amount of concurrency changes that, so
   * this is the one part of the subsystem that must stay lazy.
   *
   * The numbers taken from the pixels are cached; the pictures are not.
   */
  handle('media:thumbs', (event, paths, options = {}) =>
    guard(async () => {
      const list = (Array.isArray(paths) ? paths : [paths]).filter((p) => typeof p === 'string');
      if (list.length === 0) return {};

      // A new request supersedes the old one: the user has scrolled, and the
      // cells the previous request was drawing are no longer on screen.
      if (tokens.thumbs) tokens.thumbs.cancel();
      const token = new CancelToken();
      tokens.thumbs = token;

      const cache = await mediaAnalysisCache();
      const keyOf = (filePath) => {
        const known = mediaStats.get(filePath);
        return known ? MediaCache.keyOf(known) : null;
      };

      try {
        const drawn = await thumbs.thumbnails(list, { cache, keyOf, ...options }, { token });
        await cache.save();

        const out = {};
        for (const [filePath, thumb] of drawn) out[filePath] = thumb;
        return out;
      } finally {
        if (tokens.thumbs === token) tokens.thumbs = null;
      }
    })
  );

  /**
   * Pictures that are the same picture.
   *
   * Runs over whatever has been measured so far rather than forcing the rest to
   * be measured: the answer improves as the user scrolls, and the alternative
   * is a progress bar in front of a feature nobody asked to wait for.
   */
  handle('media:similar', () =>
    guard(async () => {
      const cache = await mediaAnalysisCache();
      const items = [];

      for (const [filePath, record] of mediaStats) {
        const measured = cache.map.get(MediaCache.keyOf(record));
        if (!measured || !measured.hash) continue;
        items.push({
          path: filePath,
          hash: measured.hash,
          aspect: record.aspect || 0,
          size: record.size,
          mtimeMs: record.mtimeMs,
        });
      }

      const groups = perceptual.groupSimilar(items);
      return {
        groups,
        measured: items.length,
        // The honest denominator: how much of the library has been looked at.
        known: mediaStats.size,
      };
    })
  );

  /* ---- preview ----------------------------------------------------------- */

  /**
   * Look at one file without leaving the app.
   *
   * Every screen here asks "should this go?", and for anything that is not a
   * cache or a log that cannot be answered without seeing inside. The answer
   * used to be the Open button, which puts the decision two applications away
   * from the list it was made in.
   *
   * The reply carries either the contents (for text, which is small and wants
   * to be searchable in the window) or a token (for anything streamed over the
   * app's own protocol). The renderer never learns a path it did not already
   * have, and never gets one it can turn into a fetch of its own.
   */
  handle('preview:open', (event, filePath) =>
    guard(async () => {
      if (typeof filePath !== 'string' || filePath.trim() === '') {
        throw new Error(t('preview.error.noPath', 'No file was named'));
      }
      // One preview at a time: the last one's token stops working the moment
      // this one is asked for, so a window that has moved on cannot still be
      // fetching what it used to show.
      previewServe.revokeAll();
      return preview(filePath);
    })
  );

  /** Closing the preview forgets the token with it. */
  handle('preview:close', () =>
    guard(async () => {
      previewServe.revokeAll();
      return true;
    })
  );

  /* ---- entitlements ------------------------------------------------------ */

  /**
   * Which features this build may use, one yes or no each, and why not.
   *
   * Everything the window gets to know about the licence. The decision is made
   * here, on every request that needs one; this list only decides what the
   * window draws.
   */
  handle('license:entitlements', () =>
    guard(async () => entitlements.forRenderer(licenseState.currentLicense()))
  );

  /* ---- shell helpers --------------------------------------------------- */

  handle('shell:reveal', (event, target) =>
    guard(async () => {
      shell.showItemInFolder(path.resolve(target));
      return true;
    })
  );

  handle('shell:open', (event, target) =>
    guard(async () => {
      const err = await shell.openPath(path.resolve(target));
      if (err) throw new Error(err);
      return true;
    })
  );

  handle('app:paths', () =>
    guard(async () => ({
      home: app.getPath('home'),
      desktop: safePath('desktop'),
      downloads: safePath('downloads'),
      documents: safePath('documents'),
      pictures: safePath('pictures'),
      videos: safePath('videos'),
    }))
  );

  // And the other direction: a channel in the manifest with nothing behind it
  // is a promise the window would find broken only when it called it.
  const missing = manifest.INVOKE.filter((channel) => !registered.has(channel));
  if (missing.length > 0) throw new Error(`ipc-manifest.js lists channels with no handler: ${missing.join(', ')}`);
}

/* -------------------------------------------------------------------------- */
/* history helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Store one observation of the disk.
 *
 * Volume usage is recorded whatever happened, because it is the only figure
 * that means the same thing on every snapshot. The scan summary rides along
 * when there is one, and is compared only against earlier scans of the same
 * root.
 */
async function recordSnapshot(result, source) {
  try {
    const { history, settings: store } = services();
    await history.load();

    // The scanned volume plus every volume the sampler would take, so a scan
    // extends the same series the daily measurement is building rather than
    // starting a parallel one with a different set of drives in it.
    const settings = await store.get();
    const targets = volumeTargets({
      settings,
      history,
      extraTargets: result ? [result.root] : [app.getPath('userData')],
    });
    const volumes = {};
    for (const [key, usage] of await usageByVolume(targets)) volumes[key] = usage;

    const byCategory = {};
    if (result && result.cleanup) {
      for (const group of result.cleanup.groups) byCategory[group.category] = group.bytes;
    }

    await history.addSnapshot({
      volumes,
      source,
      scan: result
        ? {
            root: result.root,
            totalBytes: result.totalSize,
            totalFiles: result.totalFiles,
            byCategory,
            topFolders: result.topFolders,
          }
        : null,
    });
  } catch (err) {
    // History is a nicety. It must never take a scan down with it.
    console.error('[history]', err);
  }
}

/** Keep the scan's folder tree. Like history, it must never take a scan down. */
async function saveTreeSnapshot(result) {
  try {
    await services().snapshots.save(result);
  } catch (err) {
    console.error('[snapshots]', err);
  }
}

/** One row per volume reading — the shape a spreadsheet can actually use. */
function toCsv(history) {
  const rows = ['at_iso,at_epoch_ms,source,volume,total_bytes,free_bytes,used_bytes,used_percent,scan_root,scan_bytes,scan_files'];
  for (const snapshot of history.snapshots) {
    const iso = new Date(snapshot.at).toISOString();
    const scan = snapshot.scan;
    for (const [volume, usage] of Object.entries(snapshot.volumes)) {
      rows.push([
        iso,
        snapshot.at,
        snapshot.source,
        csvCell(volume),
        usage.totalBytes,
        usage.freeBytes,
        usage.usedBytes,
        usage.usedPercent.toFixed(4),
        csvCell(scan ? scan.root : ''),
        scan ? scan.totalBytes : '',
        scan ? scan.totalFiles : '',
      ].join(','));
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* -------------------------------------------------------------------------- */
/* automatic cleanup helpers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything the settings screen draws itself from, in one round trip.
 *
 * "When does it run next" is computed from the app's own schedule rather than
 * read back from Task Scheduler, because that answer has to exist before any
 * task does, and because the scheduler's reply is localised text.
 */
async function readState() {
  const { settings: store, runLog } = services();
  const settings = await store.load();
  await runLog.load();

  // The cheap half of the task status: existence and whether the registered
  // definition matches, both read from Task Scheduler. The expensive half (the
  // OS's last/next run times) is a separate call the renderer makes when the
  // tab is open.
  const taskStatus = await tasks.status(settings, { withOsInfo: false, settingsExisted: store.exists });

  const reconciliation = lastReconciliation;
  lastReconciliation = null;

  return {
    settings,
    warnings: store.warnings,
    settingsExisted: store.exists,
    settingsPath: services().settingsPath,
    // So the form can put the real floor on its own input rather than letting
    // the user type 1, save, and be quietly given 5.
    limits: { minMinutes: store.minMinutes },
    tasks: taskStatus,
    // Kept for the tab's existing wiring: the schedule the app itself would
    // compute, which is all that can be known before a task exists.
    scheduler: {
      supported: taskStatus.supported,
      installed: taskStatus.cleanup.installed,
      verified: taskStatus.cleanup.verified,
      nextRunAt: taskStatus.cleanup.expectedNextRunAt,
      description: taskStatus.cleanup.description,
    },
    reconciliation,
    lastRun: runLog.latest(),
    history: runLog.runs.slice(0, 20),
  };
}

/** The volumes a set of ledger entries came from, so only those bins are opened. */
function volumesOf(entries) {
  const roots = new Set();
  for (const entry of entries) roots.add(path.parse(path.resolve(entry.path)).root);
  return [...roots];
}

/**
 * The confirmation in front of an action the user started from a screen.
 *
 * The pipeline decides what is about to happen and hands over its
 * description; this only words it. A kind with no wording here is not
 * confirmed, and so does not run -- the dialog for quarantine or relocation
 * arrives with the handler that needs it.
 */
/**
 * The confirmation in front of making files online-only (B3).
 *
 * Nothing is deleted, and it says so first -- somebody who has learned that
 * this app's buttons delete things is owed that sentence before any other.
 * Then what the choice costs: the file needs a connection to open, and a
 * signed-out OneDrive cannot open it at all. And what the number means: space
 * comes back when OneDrive takes the contents, which the app then measures.
 */
async function confirmDehydrate(win, description) {
  const n = (v) => Number(v || 0).toLocaleString(language.current());
  const lines = [
    t('dialog.dehydrate.detail', 'Nothing is deleted. The files stay where they are, with their names and sizes; OneDrive takes the copies of their contents on this drive, {size} of it, and keeps them in the cloud.', {
      size: formatBytes(description.onDiskBytes),
    }),
    t('dialog.dehydrate.network', 'Opening one of them afterwards needs an internet connection, while OneDrive downloads it again. If OneDrive is signed out, they will not open until it is signed back in.'),
    t('dialog.dehydrate.measured', 'OneDrive frees the space itself, shortly after. The app watches for it and reports what it actually measured.'),
  ];
  if (description.pinned > 0) {
    lines.push(
      t('dialog.dehydrate.pinned', '{n} of them were set to “Always keep on this device”; this undoes that.', { n: n(description.pinned) })
    );
  }
  if (description.refused > 0) {
    lines.push(
      t('dialog.dehydrate.refused', '{n} of the files chosen are left as they are: not in sync with OneDrive, or already online-only.', {
        n: n(description.refused),
      })
    );
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: [t('dialog.dehydrate.go', 'Keep only in the cloud'), t('app.cancel', 'Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.dehydrate.title', 'Free up space with OneDrive'),
    message: t('dialog.dehydrate.message', 'Keep {n} file(s) only in the cloud?', { n: n(description.count) }),
    detail: lines.join('\n\n'),
  });
  return response === 0;
}

/**
 * The words in front of moving files to another drive (B1), apart from the
 * dialog so a harness can read exactly what a person would.
 *
 * In this order: what happens to the copy, then what happens to the original
 * and so what it frees -- the one fact people get wrong about this -- then
 * what kind of drive the copies are on, then anything about the files that
 * a cloud service syncs, then how long they stay.
 */
function confirmQuarantineText(description, planned) {
  const n = (v) => Number(v || 0).toLocaleString(language.current());
  const zone = description.zone || { path: '', drive: '' };
  const drive = zone.drive;
  const size = formatBytes(description.bytes);
  const lines = [
    t('dialog.quarantine.copy', '{size} is copied to {zone}. Each copy is read back and checked against its original (SHA-256) before the original is touched.', {
      size,
      zone: zone.path,
    }),
    description.deleteOriginal
      ? t('dialog.quarantine.deleteOriginal', 'Then each original is deleted from its drive — not moved to the Recycle Bin. The copy on {drive} is the only one left. This frees {size}.', { drive, size })
      : t('dialog.quarantine.bin', 'Then each original goes to the Recycle Bin, which is on the same drive as the original — so this frees nothing there until the bin is emptied. “Delete the original”, in Settings, frees it at once instead.'),
  ];
  if (zone.type === 'Removable') {
    lines.push(
      t('dialog.quarantine.removable', '{drive} is a removable drive. If it is lost or unplugged, so are the copies on it — and once the originals are gone, they are the only ones.', { drive })
    );
  }
  const c = description.cloud || {};
  if (c.synced > 0) {
    lines.push(
      t('dialog.quarantine.synced', '{n} of these are in sync with OneDrive. Removing them from this folder removes them from OneDrive on every device. “Keep only in the cloud”, on What to delete, frees their space without deleting anything.', { n: n(c.synced) })
    );
  }
  if (c.unsynced > 0) {
    lines.push(
      t('dialog.quarantine.unsynced', '{n} of these are in OneDrive but not in sync: OneDrive has not uploaded them, or not their latest changes. The copy on {drive} is the only complete one, and OneDrive removes any older version it holds when it next runs.', { n: n(c.unsynced), drive })
    );
  }
  if ((c.other || 0) + (c.unknown || 0) > 0) {
    lines.push(
      t('dialog.quarantine.otherCloud', '{n} of these are in a folder a cloud service syncs, and the app cannot tell whether the service holds them. Removing them from the folder may remove them on every device that syncs it.', { n: n((c.other || 0) + (c.unknown || 0)) })
    );
  }
  lines.push(
    t('dialog.quarantine.kept', 'They stay there until you put them back from Restore, or delete them yourself. After {days} days the app mentions they are still there; it never deletes them.', {
      days: n(description.retentionDays || 30),
    })
  );
  const left = [];
  if (description.sameVolume > 0) left.push(t('dialog.quarantine.sameVolume', '{n} are already on {drive}.', { n: n(description.sameVolume), drive }));
  if (description.onlineOnly > 0) left.push(t('dialog.quarantine.onlineOnly', '{n} are only in the cloud, with nothing on this drive to free.', { n: n(description.onlineOnly) }));
  const other = description.refused - (description.sameVolume || 0) - (description.onlineOnly || 0);
  if (other > 0) left.push(t('dialog.quarantine.refused', '{n} more are left where they are; the reasons are listed afterwards.', { n: n(other) }));
  const detail = lines.join('\n\n') + (left.length ? `\n\n${left.join(' ')}` : '') + skippedNote(planned || {});

  return {
    type: description.deleteOriginal ? 'warning' : 'question',
    title: t('dialog.quarantine.title', 'Move to another drive'),
    message: t('dialog.quarantine.message', 'Move {n} item(s) to {drive}?', { n: n(description.count), drive }),
    detail,
    buttons: [t('dialog.quarantine.go', 'Move to {drive}', { drive }), t('app.cancel', 'Cancel')],
  };
}

async function confirmQuarantine(win, description, planned) {
  const text = confirmQuarantineText(description, planned);
  const { response } = await dialog.showMessageBox(win, { ...text, defaultId: 1, cancelId: 1, noLink: true });
  return response === 0;
}

async function confirmAction(win, description, planned, options) {
  if (description.kind === 'quarantine') return confirmQuarantine(win, description, planned);
  if (description.kind === 'dehydrate') return confirmDehydrate(win, description);
  if (description.kind !== 'recycle') return false;

  const count = description.count;
  const slow = description.etaMs >= 30000;

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [t('dialog.moveToBin', 'Move to Recycle Bin'), t('app.cancel', 'Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.confirmDelete.title', 'Confirm delete'),
    message: t('dialog.confirmDelete.message', 'Move {n} item(s) to the Recycle Bin?', {
      n: count.toLocaleString(language.current()),
    }),
    detail:
      t('dialog.confirmDelete.detailBin', '{size} will move to the Recycle Bin, where it stays recoverable.', {
        size: formatBytes(description.bytes),
      }) +
      binNote(description) +
      cloudNote(planned) +
      skippedNote(planned) +
      (slow
        ? `\n\n${t(
            'dialog.confirmDelete.slow',
            'Windows moves about {rate} files per second, so this will take roughly {duration}. Progress is ' +
              'shown as it runs and you can stop at any point — anything already moved stays in the Recycle Bin.',
            { rate: ESTIMATED_FILES_PER_SEC, duration: formatDuration(description.etaMs) }
          )}`
        : ''),
  });

  return response === 0;
}

/**
 * The confirmation in front of putting things back.
 *
 * Its one real question is what to do about a file that is already where the
 * restored one belongs -- somebody may have made a new `report.docx` since the
 * old one went to the bin. The answer travels back to the pipeline as the
 * restore's options, so the choice is made by the person, in this dialog, and
 * never by the window that asked.
 *
 * @returns {Promise<false | {approved: true, options: {onConflict: 'skip'|'rename'|'replace'}}>}
 */
async function confirmRestore(win, description) {
  if (description.kind !== 'restore') return false;
  const n = (v) => Number(v || 0).toLocaleString(language.current());

  const lines = [
    t('dialog.restore.detail', '{size} goes back to where it was deleted from.', { size: formatBytes(description.bytes) }),
  ];
  // From another drive (B1): copied, checked, and only then taken out of the
  // quarantine folder -- so it takes room where it lands before it frees any.
  if (description.fromQuarantine > 0) {
    lines.push(
      t('dialog.restore.fromQuarantine', '{n} of them come back from the quarantine folder: each is copied back, checked against the copy that was made, and only then removed from that folder. They need room on the drive they go back to.', {
        n: n(description.fromQuarantine),
      })
    );
  }
  if (description.refused > 0) {
    lines.push(
      t('dialog.restore.refused', '{n} of the items chosen cannot be put back — they are no longer in the Recycle Bin, or the drive is not connected.', {
        n: n(description.refused),
      })
    );
  }

  const conflicts = description.conflicts || 0;
  const replaceable = conflicts - (description.conflictFolders || 0);
  const buttons = [];
  const choices = [];
  if (conflicts > 0) {
    lines.push(
      t('dialog.restore.conflicts', '{n} of them have something else at that path now.', { n: n(conflicts) }) +
        ' ' +
        t(
          'dialog.restore.conflictsHow',
          '“Keep both” puts the restored file beside it with “(restored)” added to its name. “Replace” moves the file that is there now to the Recycle Bin first, so it can be put back too.'
        )
    );
    buttons.push(t('dialog.restore.keepBoth', 'Put back, keep both'));
    choices.push('rename');
    buttons.push(t('dialog.restore.skip', 'Put back, skip those'));
    choices.push('skip');
    if (replaceable > 0) {
      buttons.push(t('dialog.restore.replace', 'Put back, replace them'));
      choices.push('replace');
    }
  } else {
    buttons.push(t('dialog.restore.go', 'Put back'));
    choices.push('skip');
  }
  buttons.push(t('app.cancel', 'Cancel'));
  const cancelId = buttons.length - 1;

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons,
    defaultId: cancelId,
    cancelId,
    noLink: true,
    title:
      description.fromQuarantine > 0
        ? t('dialog.restore.titleAny', 'Put back')
        : t('dialog.restore.title', 'Put back from the Recycle Bin'),
    message:
      description.fromQuarantine > 0
        ? t('dialog.restore.messageAny', 'Put back {n} item(s) where they came from?', { n: n(description.count) })
        : t('dialog.restore.message', 'Put back {n} item(s) from the Recycle Bin?', { n: n(description.count) }),
    detail: lines.join('\n\n'),
  });

  if (response === cancelId || !choices[response]) return false;
  return { approved: true, options: { onConflict: choices[response] } };
}

/**
 * Whether a request from the window may skip the confirmation.
 *
 * Off, and only switchable from this process. The end-to-end harness drives
 * the real app and really deletes forty throwaway files, and a native dialog
 * would stop it dead; it calls `allowUnconfirmedForHarness()` from the main
 * process, which no page in the window can reach.
 */
let unconfirmedAllowed = false;

function allowUnconfirmedForHarness() {
  unconfirmedAllowed = true;
}

/**
 * The dialog in front of a cleanup the user started by hand. The scheduled run
 * has no equivalent -- its consent was given when the schedule was saved, which
 * is why the schedule starts in report-only mode.
 */
async function confirmAutoDelete(win, selection, settings) {
  const names = selection.sample
    .slice(0, 5)
    .map((f) => `  ${f.path}`)
    .join('\n');

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [t('dialog.moveToBin', 'Move to Recycle Bin'), t('app.cancel', 'Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.confirmAuto.title', 'Confirm automatic cleanup'),
    message: t('dialog.confirmAuto.message', 'Move {n} file(s) to the Recycle Bin?', {
      n: selection.files.toLocaleString(language.current()),
    }),
    detail:
      t(
        'dialog.confirmAuto.detail',
        'These are files in the enabled categories, untouched for at least {days} days. Total {size}.',
        { days: settings.autoClean.minAgeDays, size: formatBytes(selection.bytes) }
      ) +
      `\n\n${t('dialog.forExample', 'For example:')}\n${names}${selection.files > 5 ? '\n  …' : ''}\n\n` +
      (settings.purge.enabled
        ? t(
            'dialog.confirmAuto.withPurge',
            'They stay recoverable for {days} day(s), after which CleanDrive removes its own items ' +
              'permanently and the space is freed.',
            { days: settings.purge.afterDays }
          )
        : t(
            'dialog.confirmAuto.withoutPurge',
            'They stay in the Recycle Bin. Note that this frees no disk space until the bin is emptied.'
          )),
  });

  return response === 0;
}

/**
 * The warning that matters most, in front of the one kind of file the Recycle
 * Bin does not protect.
 *
 * Everywhere else in this app, "it goes to the Recycle Bin" is the whole safety
 * story: nothing is permanent, everything is one restore away. For a file
 * inside a sync folder that is not true. Deleting it here tells OneDrive or
 * Dropbox to delete it on every device, and this machine's Recycle Bin has no
 * say in what the other ones do. Somebody who has learned that this app is safe
 * because everything is recoverable is exactly the person who needs telling.
 *
 * Computed here rather than passed in by the window, because the window is not
 * the authority on where a file lives and this is not a warning to get wrong.
 *
 * It runs for *every* delete, not only from the photo screen: a synced file
 * ticked in the cleanup list has precisely the same problem.
 */
function cloudNote(planned) {
  const services = new Map();
  for (const item of planned.plan) {
    const service = cloud.serviceForPath(item.path);
    if (service) services.set(service, (services.get(service) || 0) + 1);
  }
  if (services.size === 0) return '';

  const total = [...services.values()].reduce((n, v) => n + v, 0);
  const named = [...services.keys()].join(', ');

  return (
    '\n\n' +
    t(
      'dialog.confirmDelete.synced',
      '{n} of these are in a folder synchronised with {service}. Deleting them here deletes them ' +
        'on every device that syncs it, and this computer’s Recycle Bin cannot bring those copies back.',
      { n: total.toLocaleString(language.current()), service: named }
    )
  );
}

/**
 * The sentence the rest of the app already insists on, in front of every
 * delete that does not free anything.
 *
 * The line above used to say "This frees {size}", which for a move to the
 * Recycle Bin is not true until the bin is emptied -- the bin is on the same
 * disk. It was corrected for the photo screen first and the other tabs were
 * left as they were, as a decision about those tabs; the roadmap made that
 * decision (rule 2, "moved is not freed", on every action), so it now depends
 * on what the action frees and not on which screen asked.
 */
function binNote(description) {
  if (description.freesOnVolume) return '';
  return `\n\n${t(
    'dialog.confirmDelete.binNote',
    'Moving them to the Recycle Bin does not free any disk space yet — the bin is on the same drive. ' +
      'Nothing is actually reclaimed until it is emptied.'
  )}`;
}

/**
 * Files the plan deliberately left out. Stating this in the confirmation is
 * what replaces Windows' per-file "administrator permission" prompt: the count
 * is known before the run starts, so nothing interrupts it half way through.
 */
function skippedNote(planned) {
  const parts = [];
  if (planned.needsAdmin && planned.needsAdmin.length) {
    parts.push(
      t(
        'dialog.skipped.needsAdmin',
        '{n} file(s) belong to an installed program and need administrator permission — they are ' +
          'skipped, not deleted.',
        { n: planned.needsAdmin.length.toLocaleString(language.current()) }
      )
    );
  }
  if (planned.inUse && planned.inUse.length) {
    parts.push(
      t('dialog.skipped.inUse', '{n} file(s) are open in another program and are skipped.', {
        n: planned.inUse.length.toLocaleString(language.current()),
      })
    );
  }
  return parts.length ? `\n\n${parts.join('\n')}` : '';
}

/** Some well-known folders are absent or redirected; never let that throw. */
function safePath(name) {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
}

function cancelAll() {
  if (tokens.scan) tokens.scan.cancel();
  if (tokens.dupes) tokens.dupes.cancel();
  if (tokens.trash) tokens.trash.cancel();
  if (tokens.media) tokens.media.cancel();
  if (tokens.thumbs) tokens.thumbs.cancel();
  if (tokens.system) tokens.system.cancel();
}

module.exports = {
  register,
  cancelAll,
  noteReconciliation,
  allowUnconfirmedForHarness,
  setSystemTargetForHarness,
  setHelperClientForHarness,
  setHandoffDepsForHarness,
  setCloudDepsForHarness,
  setAppCacheHarness,
  setQuarantineHarness,
  quarantineStatus,
  confirmQuarantineText,
  setContextMenuForHarness,
  setCopiesScopeForHarness,
  reconcileMenu,
};
