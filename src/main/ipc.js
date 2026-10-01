'use strict';

const path = require('node:path');
const { ipcMain, dialog, shell, app, BrowserWindow, nativeTheme, screen } = require('electron');

const analyzers = require('./analyzers');
const manifest = require('./ipc-manifest');
const mediaRoots = require('./lib/media/roots');
const cloud = require('./lib/media/cloud');
const thumbs = require('./lib/media/thumbs');
const perceptual = require('./lib/media/perceptual');
const videoEncode = require('./lib/media/mp4/encode');
const mapTiles = require('./map/tiles');
const { MediaCache } = require('./lib/media/cache');
const { preview } = require('./lib/preview');
const previewServe = require('./lib/preview/serve');
const { ESTIMATED_FILES_PER_SEC } = require('./lib/trash');
const { execute } = require('./actions/execute');
const restoreEngine = require('./actions/restore');
const quarantineHandler = require('./actions/quarantine');
const quarantineZone = require('./lib/quarantine-zone');
const systemMeasure = require('./system/measure');
const appsMeasure = require('./apps/measure');
const gamesMeasure = require('./games/measure');
const chatMeasure = require('./chat/measure');
const chatKnown = require('./chat/known');
const devMeasure = require('./dev/measure');
const devProjects = require('./dev/projects');
const systemBreakdown = require('./system/breakdown');
const { ScanTree, MultiScanTree } = require('./analyzers/scan-tree');
const scanRoots = require('./analyzers/scan-roots');
const volumes = require('./lib/volumes');
const treeCopy = require('./lib/tree-copy');
const ntfsCompress = require('./lib/ntfs-compress');
const snapshotDiff = require('./snapshots/diff');
const reportCollect = require('./report/collect');
const reportHtml = require('./report/html');
const reportRedact = require('./report/redact');
const mftRead = require('./system/mft-read');
const planner = require('./planner/plan');
const { HelperClient, appLauncher } = require('./helper/client');
const licenseState = require('./license/state');
const entitlements = require('./license/entitlements');
const { CancelToken, formatBytes, formatDuration, pathKey, displayPath, throttle } = require('./lib/util');
const { services } = require('./services');
const scheduler = require('./lib/scheduler');
const { runAutoClean } = require('./lib/autoclean');
const runlock = require('./lib/runlock');
const { diskUsage, usageByVolume, volumeRoot } = require('./lib/disk');
const { findUserBins, purgeRecorded } = require('./lib/recyclebin');
const historyLib = require('./lib/history');
const { sample, volumeTargets } = require('./lib/sampler');
const tasks = require('./tasks');
const settingsLib = require('./lib/settings');
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
const tokens = { scan: null, dupes: null, trash: null, auto: null, media: null, thumbs: null, measureAll: null, system: null, apps: null, games: null, chat: null, dev: null, devProjects: null, planner: null };

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
 *
 * `relocate` (B2) is not here because it does not move a file out of a folder
 * -- it moves the folder. It is handled beside this, through
 * `removeFolders`.
 */
const LEAVES_ITS_FOLDER = new Set(['recycle', 'quarantine']);

/** A value the window sent that may be read as a bag of keys, and nothing else. */
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * How many pictures the side-by-side comparison holds at once (E1).
 *
 * Four, from the roadmap, and the number is a screen constraint rather than a
 * technical one: four panes on the app's minimum width give each picture about
 * 200 pixels across, which is already less than the thumbnail it was opened
 * from. Anything past that is a contact sheet, not a comparison.
 */
const MAX_COMPARED = 4;

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
 * What a scan of several folders (A4) would otherwise ask Windows or a
 * person, for a harness: the drive listing (`volumes`: () => Promise<{drives}>),
 * a drive's usage (`statfs`) and the folder "Choose folder" returns (`pick`).
 */
let scanHarness = null;
function setScanHarness(harness) {
  scanHarness = harness || null;
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
 * The same, for relocating a folder (B2): the folder "Choose…" returns
 * (`pick`) and the Recycle Bin (`shell`). The app never sets these either.
 */
let relocateHarness = null;
function setRelocateHarness(harness) {
  relocateHarness = harness || null;
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
    // E1: a file that exists only in the cloud cannot be measured without
    // downloading it, and the bulk pass that finds similar pictures must be
    // able to leave those alone. Measured on this machine: 2,534 of 6,687
    // photographs in the default roots are online-only, so a pass that did
    // not check this would quietly pull several gigabytes back onto the disk
    // -- undoing exactly what "free up space" (B3) had just done.
    dehydrated: Boolean(candidate.meta.dehydrated),
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

  // Where tiles are cached and what the tile server is told we are (E4). Named
  // here rather than at import time because it needs `app.getPath`, which only
  // answers once Electron is ready.
  mapTiles.configure();

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
      if (scanHarness && scanHarness.pick) return scanHarness.pick();
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win, {
        title: t('dialog.chooseFolder', 'Choose a folder to analyse'),
        properties: ['openDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    })
  );

  /* ---- scan ------------------------------------------------------------ */

  /**
   * One UAC prompt, then one catalogue read per eligible drive.
   *
   * Returns a map from drive root to the source a walk can be run against,
   * plus what to tell the user when there is nothing in it. A refusal here is
   * never fatal: every root falls back to the ordinary walk, and the status
   * line says which scanner answered.
   */
  async function prepareFastScan(roots, { can, token, onProgress }) {
    if (!can('pro.scan.mft')) return { sources: new Map(), refused: 'locked' };

    const eligible = [];
    const reasons = new Map();
    for (const info of roots) {
      const why = scanRoots.whyNotFast(info);
      if (why) reasons.set(pathKey(info.root), why);
      else if (!eligible.some((e) => pathKey(e.root) === pathKey(info.root))) eligible.push(info);
    }
    if (eligible.length === 0) {
      return { sources: new Map(), reasons, refused: reasons.values().next().value || 'notWholeDrive' };
    }

    const client = helperClientFor();
    onProgress({ phase: 'prompt' });
    try {
      await client.start();
    } catch (err) {
      if (err && err.code === 'EDECLINED') return { sources: new Map(), reasons, refused: 'declined' };
      return { sources: new Map(), reasons, refused: 'helper' };
    }

    const sources = new Map();
    const summaries = [];
    try {
      const ping = await client.request('ping');
      if (!ping || !ping.elevated) return { sources, reasons, refused: 'notElevated' };

      for (const info of eligible) {
        if (token.cancelled) break;
        try {
          const read = await mftRead.readElevated(client, info.volume, {
            onProgress: (p) => onProgress({ phase: 'mft', root: info.root, records: p.records, of: p.of }),
          });
          const built = mftRead.sourceFor(read, info.root);
          sources.set(pathKey(info.root), { source: built.source, summary: read.summary });
          summaries.push(read.summary);
        } catch (err) {
          // One drive's catalogue being unreadable is a reason to walk that
          // drive, not a reason to fail the scan.
          reasons.set(pathKey(info.root), 'unreadable');
          console.error('[mft]', info.volume, err && err.message);
        }
      }
    } finally {
      // One prompt, one set of answers. Closing the pipe is what makes the
      // helper leave; the table is already in this process.
      client.stop();
    }
    return { sources, reasons, summaries, refused: sources.size === 0 ? 'unreadable' : null };
  }

  // The window names folders, and one thing about how to read them: `fast`,
  // which is the "Fast scan" switch (A2). It used to be able to pass the
  // scanner's whole configuration through -- follow links, stop skipping
  // system folders, name every file in the tree -- and nothing in the window
  // ever did, so nothing else it sends is read.
  //
  // One folder, or several (A4). Each is scanned on its own, as one always
  // was, and keeps its own point in the history and its own snapshot, so a
  // comparison with the last scan of the same folder still means what it
  // meant. The reply joins them.
  handle('scan:run', (event, folders, fast) =>
    guard(async () => {
      if (tokens.scan) tokens.scan.cancel();
      const token = new CancelToken();
      tokens.scan = token;

      try {
        const listing = await (scanHarness && scanHarness.volumes ? scanHarness.volumes() : volumes.list());
        const prepared = await scanRoots.prepareRoots(folders, { drives: listing.drives });
        if (prepared.roots.length === 0) {
          const why = prepared.refused[0] ? prepared.refused[0].reason : 'missing';
          throw Object.assign(new Error(why === 'notFolder' ? 'That is not a folder' : 'That folder is not there any more'), { code: 'ENOENT', quiet: true });
        }
        const can = licenseState.canNow();
        if (prepared.roots.length > 1 && !can('pro.scan.multiroot')) {
          throw Object.assign(new Error('Scanning several folders at once is part of CleanDrive Pro'), { code: 'ELOCKED', quiet: true });
        }

        // Asked for before any folder is scanned: one UAC prompt covers every
        // drive in the list, and a refusal only means the ordinary walk runs.
        const plan = fast === true
          ? await prepareFastScan(prepared.roots, {
            can,
            token,
            onProgress: (payload) => {
              if (!event.sender.isDestroyed()) event.sender.send('scan:progress', { ...payload, roots: prepared.roots.length });
            },
          })
          : null;

        const parts = [];
        for (const [index, info] of prepared.roots.entries()) {
          if (token.cancelled) break;
          const send = (payload) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('scan:progress', { ...payload, root: info.root, rootIndex: index, roots: prepared.roots.length });
            }
          };
          const fromTable = plan ? plan.sources.get(pathKey(info.root)) : null;
          const collected = await analyzers.collect(
            'scan',
            // cloudFiles: which OneDrive files could be made online-only (B3).
            {
              root: info.root,
              options: {
                collectTree: true,
                cloudFiles: info.readOnly === null,
                // The one option that changes where the walk's answers come
                // from rather than what it does with them (A2). Unset, and
                // the walk is exactly the walk it was.
                ...(fromTable ? { source: fromTable.source } : {}),
                ...(appCacheHarness && appCacheHarness.env ? { appCacheEnv: appCacheHarness.env } : {}),
              },
              deps: {
                ...(cloudDeps ? { cloud: cloudDeps } : {}),
                ...(appCacheHarness && appCacheHarness.runningProcessNames ? { runningProcessNames: appCacheHarness.runningProcessNames } : {}),
              },
            },
            { token, onProgress: send, can }
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

          const candidates = info.readOnly
            ? collected.candidates.map((c) => scanRoots.readOnlyCandidate(c, info.readOnly))
            : collected.candidates;
          const unscanned = await scanRoots.unscannedOnDrive(info, summary, scanHarness && scanHarness.statfs ? { statfs: scanHarness.statfs } : {});
          // Which scanner answered for this folder, and -- when the fast one
          // was asked for and did not -- why not. The window says so on the
          // status line: a measurement nobody can attribute is a measurement
          // nobody can check.
          const scanner = fromTable
            ? {
              scanner: 'mft',
              mft: {
                bytes: fromTable.summary.mftBytes,
                records: fromTable.summary.recordsRead,
                files: fromTable.summary.fileCount,
                folders: fromTable.summary.folderCount,
                torn: fromTable.summary.torn,
                ms: fromTable.summary.ms,
              },
            }
            : { scanner: 'walk', ...(plan ? { fastRefused: plan.reasons.get(pathKey(info.root)) || plan.refused } : {}) };
          parts.push({ info: { ...info, unscanned, ...scanner }, summary, candidates, tree, treeFiles });
        }

        const trees = parts.filter((p) => p.tree).map((p) => new ScanTree({
          root: p.summary.root,
          rows: p.tree,
          files: p.treeFiles,
          complete: !p.summary.cancelled,
          scannedAt: p.summary.scannedAt,
          accessTimes: p.summary.accessTimes,
          openApps: p.summary.openApps,
          unscanned: p.info.unscanned,
          readOnly: p.info.readOnly,
        }));
        let treeId = null;
        if (trees.length > 0) {
          treeId = `t${++scanTreeSerial}`;
          scanTree = { id: treeId, tree: trees.length === 1 ? trees[0] : new MultiScanTree(trees) };
        }

        const summary = parts.length === 1 ? parts[0].summary : scanRoots.mergeScans(parts);
        return {
          ...summary,
          // A stop between two folders leaves the rest unscanned; say so.
          cancelled: summary.cancelled || parts.length < prepared.roots.length,
          roots: parts.map((p) => p.info),
          notScanned: prepared.roots.slice(parts.length).map((r) => r.root),
          merged: prepared.merged,
          refused: prepared.refused,
          treeId,
          candidates: parts.flatMap((p) => p.candidates),
        };
      } finally {
        if (tokens.scan === token) tokens.scan = null;
      }
    })
  );

  // The drives a whole-drive scan can start from (A4), with what the app may
  // do on each.
  handle('scan:drives', () =>
    guard(async () => {
      const listing = await (scanHarness && scanHarness.volumes ? scanHarness.volumes() : volumes.list({ fresh: true }));
      return volumes.scannable(listing.drives).map((d) => ({ ...volumes.describe(d.root, listing.drives), totalBytes: d.totalBytes, freeBytes: d.freeBytes }));
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
      // The same folders the scan takes (A4), made safe the same way. A share
      // is left out -- hashing a network folder is F1's, with its own warning
      // about speed -- and the reply says which were.
      const listing = await (scanHarness && scanHarness.volumes ? scanHarness.volumes() : volumes.list());
      const prepared = await scanRoots.prepareRoots(roots, { drives: listing.drives });
      const local = prepared.roots.filter((r) => r.kind !== 'network');
      if (local.length === 0) {
        throw Object.assign(new Error('Duplicates are looked for on this computer’s drives only'), { code: 'ENETWORK', quiet: true });
      }
      const can = licenseState.canNow();
      if (local.length > 1 && !can('pro.scan.multiroot')) {
        throw Object.assign(new Error('Looking in several folders at once is part of CleanDrive Pro'), { code: 'ELOCKED', quiet: true });
      }
      // Which copy to suggest keeping (F1). The default is the oldest, which
      // is what it has always been; the other two are Pro, and asked for by
      // the window. A folder the request names that is not one of the roots
      // ranks last, so nothing outside the search can become the keeper.
      const asked = ['internal', 'backup'].includes(options.prefer) ? options.prefer : 'oldest';
      // Refused rather than silently downgraded: somebody who picks "keep the
      // copy on the backup drive" and is given the oldest instead has been
      // told nothing, and the keepers on screen are not the ones they asked
      // for. Same shape as the fast scan's refusal (A2).
      const preferRefused = asked !== 'oldest' && !can('pro.dupes.advanced') ? 'locked' : null;
      const prefer = preferRefused ? 'oldest' : asked;
      const keeperRank = scanRoots.keeperRankFor(local, prefer) || undefined;

      // Whole folders (F2). Pro, and refused out loud for the same reason the
      // keeper rule is: somebody who asked for folders and is handed a list of
      // files has been told nothing about why. Off for copies-of-one-file --
      // that is a search for one file, not a comparison of folders.
      const wantFolders = Boolean(options.folders) && !options.copiesOf;
      const foldersRefused = wantFolders && !can('pro.dupes.advanced') ? 'locked' : null;
      const folders = wantFolders && !foldersRefused;

      // Documents that look like versions of one another (F3). Same licence,
      // same refused-out-loud shape, and off for copies-of-one-file.
      const wantVersions = Boolean(options.versions) && !options.copiesOf;
      const versionsRefused = wantVersions && !can('pro.dupes.advanced') ? 'locked' : null;
      const versions = wantVersions && !versionsRefused;

      const { candidates, summary } = await analyzers.collect(
        'duplicates',
        {
          roots: local.map((r) => r.root),
          options: {
            ...options,
            prefer,
            keeperRank,
            folders,
            versions,
            cachePath: path.join(app.getPath('userData'), 'hash-cache.json'),
          },
        },
        { token, onProgress: send, can }
      );
      const readOnly = local.filter((r) => r.readOnly);
      const guarded = readOnly.length === 0
        ? candidates
        : candidates.map((c) => {
          const under = readOnly.find((r) => scanRoots.inside(c.path, r.root));
          return under ? scanRoots.readOnlyCandidate(c, under.readOnly) : c;
        });
      return {
        ...summary,
        candidates: guarded,
        roots: local,
        // Which rule actually chose the keepers, so the screen can say so
        // rather than the window assuming its own setting was honoured.
        prefer,
        preferRefused,
        foldersAsked: wantFolders,
        foldersRefused,
        versionsAsked: wantVersions,
        versionsRefused,
        skipped: prepared.roots.filter((r) => r.kind === 'network').map((r) => r.root),
        merged: prepared.merged,
      };
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

      /*
       * F4's second gate, and the reason it is here rather than in the handler:
       * this is a *setting*, and a handler that read settings would be a
       * handler whose behaviour depended on a file it does not own.
       *
       * The refusal is spoken, never silent. A window that somehow asks with
       * the switch off gets told which switch, in the same words the Settings
       * screen uses -- the app never quietly downgrades a request into doing
       * less than was asked.
       */
      if (kind === 'hardlink') {
        const { developer } = await services().settings.get();
        if (!developer || developer.hardlink !== true) {
          return {
            kind,
            moved: [],
            failed: list.map((item) => ({
              path: item,
              error: t(
                'hardlink.off',
                'Joining copies into one file is switched off. Settings → Developer → “Allow joining duplicate copies”.'
              ),
              code: 'EDISABLED',
            })),
            movedBytes: 0,
            freedBytes: 0,
            requested: list.length,
            refused: 'disabled',
          };
        }
      }

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
          {
            kind,
            items: list,
            options: {
              dryRun: options.dryRun === true,
              // B2 carries three answers the window collected: where to, and
              // the two switches on the confirmation. Nothing else from the
              // window reaches a handler's options.
              ...(kind === 'relocate'
                ? {
                    destination: typeof options.destination === 'string' ? options.destination : null,
                    leaveShortcut: options.leaveShortcut === true,
                    deleteOriginal: options.deleteOriginal === true,
                  }
                : {}),
              // B5 takes the same one answer: where the archive goes.
              ...(kind === 'archive'
                ? { destination: typeof options.destination === 'string' ? options.destination : null }
                : {}),
              // B4 takes no destination, only the direction.
              ...(kind === 'compress' ? { uncompress: options.uncompress === true } : {}),
              // F4 takes the pairs -- which copy is joined to which keeper --
              // and the one flag the scrolled confirmation sets. The pairs are
              // a claim the window is making, not a fact: `actions/hardlink.js`
              // re-reads and re-hashes both files before it believes any of
              // them.
              ...(kind === 'hardlink'
                ? {
                    keepers: isPlainObject(options.keepers) ? options.keepers : {},
                    acknowledged: options.acknowledged === true,
                  }
                : {}),
              // E2 takes where a copy goes before the originals are binned.
              // Absent or empty means no backup, which is what every delete
              // in the app did before this and still does everywhere but the
              // Photos screen.
              ...(kind === 'recycle' && typeof options.backupTo === 'string' && options.backupTo.trim() !== ''
                ? { backupTo: options.backupTo.trim() }
                : {}),
            },
          },
          {
            token,
            onProgress: send,
            can: licenseState.canNow(),
            source: 'manual',
            runId: 'manual',
            deps:
              kind === 'quarantine'
                ? await quarantineDeps()
                : kind === 'relocate' || kind === 'archive' || kind === 'compress'
                  ? relocateHarness || undefined
                  : kind === 'dehydrate' && cloudDeps
                  ? cloudDeps
                  : kind === 'hardlink'
                    ? { photoRoots: await photoRootPaths() }
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
        if (!result.dryRun && result.moved.length > 0 && scanTree) {
          // A relocated folder is not a file that left a folder, it is the
          // folder -- node, contents and all the bytes its parents were
          // counting. Taking it out the file way would decrement one file and
          // leave the map drawing 103 MB that is now on another drive, which
          // is what the first screenshots of B2 showed.
          if (kind === 'relocate') scanTree.tree.removeFolders(result.moved);
          else if (LEAVES_ITS_FOLDER.has(kind)) scanTree.tree.remove(result.moved);
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

  /* ---- the Apps screen (D1) ---------------------------------------------- */

  /*
   * Installed programs, what each occupies and when each was last started.
   *
   * The scan needs no administrator rights and takes about half a minute
   * here, so it waits for a click and can be stopped, like the System walk.
   * Prefetch is the one part that does need rights, and it has its own
   * channel and its own button: `apps:prefetch` re-runs the scan with the
   * launch records only an administrator can read, and raises exactly one
   * UAC prompt when it is pressed.
   */
  let appsState = null;

  async function presentApps() {
    const { candidates, summary } = await analyzers.collect(
      'apps',
      { model: appsState, can: licenseState.canNow() },
      { can: licenseState.canNow() }
    );
    return { candidates, summary };
  }

  async function runAppsScan(event, { prefetch = null } = {}) {
    if (tokens.apps) tokens.apps.cancel();
    const token = new CancelToken();
    tokens.apps = token;
    const send = (payload) => {
      if (!event.sender.isDestroyed()) event.sender.send('apps:progress', payload);
    };
    try {
      appsState = await appsMeasure.scan({ token, onProgress: send, prefetch });
      return await presentApps();
    } finally {
      if (tokens.apps === token) tokens.apps = null;
    }
  }

  handle('apps:last', () => guard(async () => (appsState ? await presentApps() : { candidates: null, summary: null })));

  handle('apps:scan', (event) => guard(async () => runAppsScan(event)));

  handle('apps:prefetch', (event) =>
    guard(async () => {
      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('apps:progress', payload);
      };
      const listing = await appsMeasure.elevate({ client: helperClientFor(), onProgress: send });
      if (listing.declined) return { declined: true, ...(appsState ? await presentApps() : { candidates: null, summary: null }) };
      return runAppsScan(event, { prefetch: listing });
    })
  );

  handle('apps:cancel', () => {
    if (tokens.apps) tokens.apps.cancel();
    return { ok: true };
  });

  /* ---- the Games screen (D2) --------------------------------------------- */

  /*
   * The Steam library. Almost nothing is walked: Steam records each game's
   * size exactly, which this machine checked against a real walk of all of
   * them. What is walked is what Steam keeps no figure for -- a folder no
   * manifest claims, and whatever is left in `steamapps\downloading`.
   *
   * The whole screen is `pro.games`, so the analyzer answers `locked` rather
   * than results when the licence does not include it; the scan still runs,
   * because the window needs to know whether there is a Steam here at all.
   */
  let gamesState = null;

  async function presentGames() {
    const { candidates, summary, locked } = await analyzers.collect(
      'games',
      { model: gamesState },
      { can: licenseState.canNow() }
    );
    return { candidates, summary, locked: locked || null, steam: { installed: gamesState.installed, path: gamesState.steamPath } };
  }

  handle('games:last', () => guard(async () => (gamesState ? await presentGames() : { candidates: null, summary: null })));

  handle('games:scan', (event) =>
    guard(async () => {
      if (tokens.games) tokens.games.cancel();
      const token = new CancelToken();
      tokens.games = token;
      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('games:progress', payload);
      };
      try {
        gamesState = await gamesMeasure.scan({ token, onProgress: send });
        return await presentGames();
      } finally {
        if (tokens.games === token) tokens.games = null;
      }
    })
  );

  handle('games:cancel', () => {
    if (tokens.games) tokens.games.cancel();
    return { ok: true };
  });

  /* ---- the Chat screen (D3) ---------------------------------------------- */

  /*
   * What Zalo and Telegram Desktop have downloaded, and which conversation
   * each piece of it came from.
   *
   * A screen of its own for a structural reason rather than a stylistic one:
   * both apps keep their data under `AppData\Roaming`, which `lib/scanner.js`
   * marks `hard`-blocked so that `lib/advisor.js` will never call any of it
   * disposable. That guard is right and stays, so D3 cannot arrive through
   * "What to delete" and arrives here instead, behind `pro.chat`.
   *
   * The scan is a real walk -- 11,567 files and about seven seconds on this
   * machine -- so it waits for a click and can be stopped, like Apps and the
   * system walk. Nothing in it opens a message database.
   */
  let chatState = null;

  async function presentChat() {
    const { candidates, summary, locked } = await analyzers.collect(
      'chat',
      { model: chatState },
      { can: licenseState.canNow() }
    );
    return {
      candidates,
      summary,
      locked: locked || null,
      apps: {
        zalo: { installed: chatState.zalo.installed, path: chatState.zalo.root },
        telegram: { installed: chatState.telegram.installed, path: chatState.telegram.root },
      },
    };
  }

  handle('chat:last', () => guard(async () => (chatState ? await presentChat() : { candidates: null, summary: null })));

  handle('chat:scan', (event) =>
    guard(async () => {
      if (tokens.chat) tokens.chat.cancel();
      const token = new CancelToken();
      tokens.chat = token;
      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('chat:progress', payload);
      };
      try {
        chatState = await chatMeasure.scan({ token, onProgress: send });
        return await presentChat();
      } finally {
        if (tokens.chat === token) tokens.chat = null;
      }
    })
  );

  handle('chat:cancel', () => {
    if (tokens.chat) tokens.chat.cancel();
    return { ok: true };
  });

  /* ---- the Space Planner (G1) -------------------------------------------- */

  /*
   * "I need 30 GB on C:" -- measured, then turned into steps.
   *
   * Every other screen answers "what is here". This one answers "what do I
   * do", and to do that it needs every other screen's numbers. The user chose
   * (2026-09-28) that pressing the button measures them all rather than
   * planning from whatever happens to have been looked at already, so this
   * runs each source in turn and sends a plan after every one -- a whole-drive
   * scan plus the tools, the applications and the games is minutes, and a
   * screen that showed nothing until the last of them finished would be a
   * screen nobody waits for.
   *
   * Two sources are deliberately not in the list:
   *
   *   Duplicates  its floor is 1 KB (`lib/duplicate.js`), so running it over
   *               a whole drive means reading the contents of nearly every
   *               file on it. Every other source here reads metadata. It is
   *               reported as not measured, with a link, rather than making
   *               the button take an hour.
   *   The system  it needs a UAC prompt to be complete, and a prompt nobody
   *               asked for is the thing `helper/client.js` exists to
   *               prevent. It is a tick-box beside the button, off by default.
   */
  const PLANNER_SOURCES = [
    { id: 'scan', needs: 'roots' },
    { id: 'dev' },
    { id: 'apps' },
    { id: 'games' },
  ];

  function plannerMissing(ids) {
    return ids.map((id) => ({ id, reason: id === 'dupes' ? 'tooExpensive' : 'notMeasured' }));
  }

  handle('planner:run', (event, request = {}) =>
    guard(async () => {
      const can = licenseState.canNow();
      if (!can('pro.planner')) {
        throw Object.assign(new Error('The Space Planner is part of CleanDrive Pro'), { code: 'ELOCKED', quiet: true });
      }
      if (tokens.planner) tokens.planner.cancel();
      const token = new CancelToken();
      tokens.planner = token;

      const drive = String(request.drive || '').trim() || volumeRoot(app.getPath('home'));
      const goal = request.goal || null;
      const includeSystem = request.includeSystem === true;

      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('planner:progress', payload);
      };

      const sources = [...PLANNER_SOURCES, ...(includeSystem ? [{ id: 'system' }] : [])];
      const missing = ['dupes', ...(includeSystem ? [] : ['system'])];
      const candidates = [];
      const measured = [];

      const emit = async (phase) => {
        const volume = await diskUsage(drive);
        send({
          phase,
          plan: planner.buildPlan({
            goal,
            volume,
            candidates,
            measured: [...measured],
            missing: plannerMissing(missing),
          }),
          done: measured.length,
          total: sources.length,
        });
      };

      try {
        for (const [index, source] of sources.entries()) {
          if (token.cancelled) break;
          send({ phase: 'measuring', source: source.id, done: index, total: sources.length });
          try {
            const got = await plannerMeasure(source.id, { token, drive, event });
            candidates.push(...got);
            measured.push(source.id);
          } catch (err) {
            // One source failing is a source the plan has to do without, not
            // a plan that fails. The screen says which, and why.
            missing.push(source.id);
            console.error('[planner]', source.id, err && err.message);
          }
          await emit('partial');
        }

        const volume = await diskUsage(drive);
        return {
          drive,
          cancelled: token.cancelled,
          ...planner.buildPlan({
            goal,
            volume,
            candidates,
            measured,
            missing: plannerMissing(missing),
          }),
        };
      } finally {
        if (tokens.planner === token) tokens.planner = null;
      }
    })
  );

  /**
   * One source, measured the way its own screen measures it.
   *
   * Reusing each screen's measurement rather than reaching into the analyzers
   * keeps one implementation of "what the Apps screen knows": the planner
   * cannot drift from the screen it links to.
   */
  async function plannerMeasure(id, { token, drive, event }) {
    const can = licenseState.canNow();
    if (id === 'scan') {
      const listing = await (scanHarness && scanHarness.volumes ? scanHarness.volumes() : volumes.list());
      const prepared = await scanRoots.prepareRoots([drive], { drives: listing.drives });
      if (prepared.roots.length === 0) return [];
      const info = prepared.roots[0];
      const collected = await analyzers.collect(
        'scan',
        {
          root: info.root,
          options: { cloudFiles: info.readOnly === null, ...(appCacheHarness && appCacheHarness.env ? { appCacheEnv: appCacheHarness.env } : {}) },
          deps: { ...(cloudDeps ? { cloud: cloudDeps } : {}) },
        },
        { token, can }
      );
      return collected.candidates;
    }
    if (id === 'dev') {
      devState = await devMeasure.scan({ token });
      return (await presentDev()).candidates || [];
    }
    if (id === 'apps') {
      appsState = await appsMeasure.scan({ token });
      return (await presentApps()).candidates || [];
    }
    if (id === 'games') {
      gamesState = await gamesMeasure.scan({ token });
      return (await presentGames()).candidates || [];
    }
    if (id === 'system') {
      const target = systemTarget();
      const walk = await systemMeasure.walk({ drive: target.drive, home: target.home, token });
      systemState = { walk, elevated: null };
      const elevated = await systemMeasure.elevate(walk, { client: helperClientFor() });
      if (!elevated.declined) systemState.elevated = elevated;
      return (await presentSystem()).candidates || [];
    }
    return [];
  }

  handle('planner:cancel', () => {
    if (tokens.planner) tokens.planner.cancel();
    return { ok: true };
  });

  /** The volume as it is right now, for the bar at the top of the screen. */
  handle('planner:volume', (event, drive) =>
    guard(async () => diskUsage(String(drive || '').trim() || volumeRoot(app.getPath('home'))))
  );

  /* ---- the Developer screen (C2, C4) ------------------------------------- */

  /*
   * What a developer's tools have filled the disk with.
   *
   * The whole screen is `pro.dev`. A package cache is measured and explained;
   * an IDE's own cache is listed file by file, because that is the half the
   * app will actually move -- and only while that IDE is closed.
   */
  let devState = null;

  async function presentDev() {
    const { candidates, summary, locked } = await analyzers.collect(
      'dev',
      { model: devState },
      { can: licenseState.canNow() }
    );
    return { candidates, summary, locked: locked || null };
  }

  handle('dev:last', () => guard(async () => (devState ? await presentDev() : { candidates: null, summary: null })));

  handle('dev:scan', (event) =>
    guard(async () => {
      if (tokens.dev) tokens.dev.cancel();
      const token = new CancelToken();
      tokens.dev = token;
      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('dev:progress', payload);
      };
      try {
        devState = await devMeasure.scan({ token, onProgress: send });
        return await presentDev();
      } finally {
        if (tokens.dev === token) tokens.dev = null;
      }
    })
  );

  handle('dev:cancel', () => {
    if (tokens.dev) tokens.dev.cancel();
    return { ok: true };
  });

  /* ---- the projects on the chosen folders (C1, C5) ----------------------- */

  /*
   * A second scan on the same screen, because it has a second input: the
   * folders chosen on the Disk usage screen rather than the fixed places a
   * tool keeps its cache. It costs a different amount every time -- 12.5 s for
   * the whole of D:\ here, against 22.6 s for the tools half -- and it can
   * have nothing to scan at all, which the reply says rather than guessing a
   * folder on the user's behalf.
   *
   * Several folders at once is Pro, the same rule and the same message as the
   * Disk usage screen, and the folders are made safe the same way (A4).
   */
  let devProjectsState = null;

  async function presentDevProjects() {
    const { candidates, summary, locked } = await analyzers.collect(
      'devProjects',
      { model: devProjectsState },
      { can: licenseState.canNow() }
    );
    return { candidates, summary, locked: locked || null };
  }

  handle('dev:lastProjects', () =>
    guard(async () => (devProjectsState ? await presentDevProjects() : { candidates: null, summary: null })));

  handle('dev:scanProjects', (event, roots) =>
    guard(async () => {
      if (tokens.devProjects) tokens.devProjects.cancel();
      const token = new CancelToken();
      tokens.devProjects = token;
      const send = (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send('dev:projectProgress', payload);
      };
      try {
        const listing = await (scanHarness && scanHarness.volumes ? scanHarness.volumes() : volumes.list());
        const prepared = await scanRoots.prepareRoots(roots, { drives: listing.drives });
        if (prepared.roots.length === 0) {
          const why = prepared.refused[0] ? prepared.refused[0].reason : 'missing';
          throw Object.assign(
            new Error(why === 'notFolder' ? 'That is not a folder' : 'That folder is not there any more'),
            { code: 'ENOENT', quiet: true }
          );
        }
        const can = licenseState.canNow();
        if (prepared.roots.length > 1 && !can('pro.scan.multiroot')) {
          throw Object.assign(new Error('Scanning several folders at once is part of CleanDrive Pro'), { code: 'ELOCKED', quiet: true });
        }

        devProjectsState = await devProjects.scan({
          roots: prepared.roots.map((r) => r.root),
          token,
          onProgress: send,
        });
        // A folder the app may only read cannot offer its build output.
        const readOnly = prepared.roots.filter((r) => r.readOnly);
        const presented = await presentDevProjects();
        if (readOnly.length === 0 || !presented.candidates) {
          return { ...presented, merged: prepared.merged, chosenRoots: prepared.roots };
        }
        return {
          ...presented,
          candidates: presented.candidates.map((c) => {
            const under = readOnly.find((r) => scanRoots.inside(c.path, r.root));
            return under ? scanRoots.readOnlyCandidate(c, under.readOnly) : c;
          }),
          merged: prepared.merged,
          chosenRoots: prepared.roots,
        };
      } finally {
        if (tokens.devProjects === token) tokens.devProjects = null;
      }
    })
  );

  handle('dev:cancelProjects', () => {
    if (tokens.devProjects) tokens.devProjects.cancel();
    return { ok: true };
  });

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
  /**
   * Where a folder should go (B2).
   *
   * Separate from `quarantine:choose` although both pick a folder, because
   * they answer different questions and keep different things. The quarantine
   * zone is a setting: chosen once, remembered, prepared, written to
   * settings. A relocate destination is chosen per move and remembered
   * nowhere -- "move this to D:\Archive" is not a policy.
   *
   * The drive is described back to the window so the confirmation can say how
   * much room is on it, and so "the same drive" is answered before the person
   * has read a dialog about copying.
   */
  handle('relocate:choose', (event, forFolder) =>
    guard(async () => {
      let picked = null;
      if (relocateHarness && typeof relocateHarness.pick === 'function') {
        picked = await relocateHarness.pick(forFolder);
      } else {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, {
          title: t('dialog.chooseRelocate', 'Choose where this folder should go — on a different drive'),
          properties: ['openDirectory', 'createDirectory'],
        });
        picked = result.canceled ? null : result.filePaths[0];
      }
      if (!picked) return { chosen: false };

      const drive = await volumes.describePath(picked).catch(() => null);
      return {
        chosen: true,
        destination: picked,
        drive: drive ? displayPath(drive.root || picked) : null,
        freeBytes: drive && Number.isFinite(drive.freeBytes) ? drive.freeBytes : null,
      };
    })
  );

  /**
   * Is this folder already held compressed, and what is it costing (B4)?
   *
   * Asked when the map's menu is used rather than carried in the scan, so the
   * answer is the disk's rather than one taken minutes ago. It reads sizes
   * and nothing else -- no `compact`, no writing, no elevation.
   */
  handle('compress:state', (event, folder) =>
    guard(async () => {
      if (typeof folder !== 'string' || !path.isAbsolute(folder)) return { ok: false };
      const tree = await treeCopy.walk(folder);
      if (tree.files.length === 0) return { ok: true, files: 0, compressed: false, logical: 0, onDisk: 0 };

      const seen = await ntfsCompress.measure(tree.files);
      // A folder counts as compressed when most of what is in it is: a
      // handful of new files in a compressed folder should not flip it back.
      let compressedFiles = 0;
      for (const file of tree.files) {
        if (await ntfsCompress.looksCompressed(file.abs)) compressedFiles += 1;
      }
      return {
        ok: true,
        files: tree.files.length,
        compressedFiles,
        compressed: compressedFiles > tree.files.length / 2,
        logical: seen.logical,
        onDisk: seen.disk,
        saved: seen.saved,
      };
    })
  );

  /** Where the archive goes (B5). Unlike B2, the same drive is allowed. */
  handle('archive:choose', (event, forFolder) =>
    guard(async () => {
      let picked = null;
      if (relocateHarness && typeof relocateHarness.pickArchive === 'function') {
        picked = await relocateHarness.pickArchive(forFolder);
      } else if (relocateHarness && typeof relocateHarness.pick === 'function') {
        picked = await relocateHarness.pick(forFolder);
      } else {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, {
          title: t('dialog.chooseArchive', 'Choose where to keep the archive'),
          properties: ['openDirectory', 'createDirectory'],
        });
        picked = result.canceled ? null : result.filePaths[0];
      }
      if (!picked) return { chosen: false };

      const drive = await volumes.describePath(picked).catch(() => null);
      return {
        chosen: true,
        destination: picked,
        drive: drive ? displayPath(drive.root || picked) : null,
        freeBytes: drive && Number.isFinite(drive.freeBytes) ? drive.freeBytes : null,
      };
    })
  );

  /**
   * Where a copy goes before the originals are deleted (E2).
   *
   * Unlike the quarantine, nothing is prepared here and nothing is claimed:
   * this is a folder the user already has -- an external drive, a NAS share,
   * anywhere -- and the app writes into it rather than owning it. So the only
   * questions asked are whether it can be written to at all and how much room
   * is left, and both are answered by trying rather than by inferring from the
   * kind of drive it is.
   *
   * A network destination is allowed on purpose. `lib/trash.js` refuses to
   * delete anything *on* a network drive, and that rule is untouched: what is
   * deleted here is the local original, and the share only ever receives a
   * copy. [Unverified] No NAS has been measured on this machine -- see the
   * open-items list -- so the speed of one is not promised anywhere.
   */
  handle('backup:choose', (event) =>
    guard(async () => {
      let picked = null;
      if (relocateHarness && typeof relocateHarness.pickBackup === 'function') {
        picked = await relocateHarness.pickBackup();
      } else {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, {
          title: t('dialog.chooseBackup', 'Choose where the copies go before deleting'),
          properties: ['openDirectory', 'createDirectory'],
        });
        picked = result.canceled ? null : result.filePaths[0];
      }
      if (!picked) return { chosen: false };

      const destination = path.resolve(picked);
      // Asked by trying. A folder can be on a perfectly ordinary drive and
      // still be one this account may not write to, and the only reliable way
      // to find that out is to write to it.
      try {
        const probe = path.join(destination, `.cleandrive-write-test-${process.pid}`);
        await fsp.writeFile(probe, '');
        await fsp.rm(probe, { force: true });
      } catch (err) {
        return {
          chosen: false,
          refusal: t('backup.refuse.write', 'Nothing can be written to that folder: {reason}', { reason: err.message }),
        };
      }

      await services().settings.patch({ backup: { destination } });
      const drive = await volumes.describePath(destination).catch(() => null);
      return {
        chosen: true,
        destination,
        display: displayPath(destination),
        freeBytes: drive && Number.isFinite(drive.freeBytes) ? drive.freeBytes : null,
      };
    })
  );

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
      // The backup folder is set only by `backup:choose`, which proves it can
      // be written to first. Same reason as the quarantine's zone below.
      if (next && next.backup && typeof next.backup === 'object') {
        const { destination, ...rest } = next.backup;
        next = { ...next, backup: rest };
      }
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
      // The unattended profiles, set only through `autoclean:saveProfile` and
      // its neighbours (G4), because adding one has a licence to check and
      // removing one has a Windows task to take away. A screen that loaded
      // before a profile was added would otherwise save the old list back.
      if (next && next.autoClean) {
        const { autoClean, ...rest } = next;
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

  /* ---- profiles (G4) ---------------------------------------------------- */

  /**
   * Save one profile, by id.
   *
   * The window sends a whole profile; `coerceSettings` clamps every field of
   * it on the way in, exactly as it does for a file somebody edited by hand.
   * A profile the settings do not list is refused rather than created, so a
   * stale screen cannot resurrect one that was just deleted.
   */
  async function writeProfiles(next, { sweep = false } = {}) {
    const { settings } = await services().settings.patch({ autoClean: { profiles: next } });
    const reconciled = await tasks.reconcile(settings, { settingsExisted: true, sweep });
    tray.apply(settings);
    return { ...(await readState()), reconciled };
  }

  handle('autoclean:saveProfile', (event, profile) =>
    guard(async () => {
      if (!profile || typeof profile !== 'object' || typeof profile.id !== 'string') {
        throw Object.assign(new Error('No profile was sent'), { code: 'EINVAL', quiet: true });
      }
      const settings = await services().settings.load();
      const profiles = settingsLib.profilesOf(settings);
      const at = profiles.findIndex((p) => p.id === profile.id);
      if (at === -1) {
        throw Object.assign(new Error('That profile no longer exists'), { code: 'ENOENT', quiet: true });
      }
      const next = profiles.map((p, i) => (i === at ? { ...p, ...profile, id: p.id } : p));
      return writeProfiles(next);
    })
  );

  handle('autoclean:addProfile', (event, template = {}) =>
    guard(async () => {
      const settings = await services().settings.load();
      const profiles = settingsLib.profilesOf(settings);
      const can = licenseState.canNow();

      // Refused out loud, never a silently ignored button -- the same shape as
      // the fast scan (A2), the keeper rule (F1) and whole folders (F2).
      if (profiles.length >= 1 && !can('pro.automatic.profiles')) {
        throw Object.assign(
          new Error('More than one automatic profile is part of CleanDrive Pro'),
          { code: 'ELOCKED', quiet: true }
        );
      }
      if (profiles.length >= settingsLib.MAX_PROFILES) {
        throw Object.assign(
          new Error(`At most ${settingsLib.MAX_PROFILES} profiles`),
          { code: 'EINVAL', quiet: true }
        );
      }

      const id = settingsLib.newProfileId(new Set(profiles.map((p) => p.id)));
      // Every new profile starts switched off and in report-only, whatever it
      // was copied from. The spec asks for it and it is the only safe default:
      // a profile that starts deleting on a timetable nobody has read yet is
      // how an unattended feature loses somebody's trust in one night.
      const made = {
        ...settingsLib.defaultProfile(id),
        ...(typeof template.name === 'string' ? { name: template.name } : {}),
        enabled: false,
        dryRun: true,
      };
      const state = await writeProfiles([...profiles, made]);
      return { ...state, addedId: id };
    })
  );

  handle('autoclean:removeProfile', (event, id) =>
    guard(async () => {
      const settings = await services().settings.load();
      const profiles = settingsLib.profilesOf(settings);
      if (profiles.length <= 1) {
        throw Object.assign(new Error('The last profile cannot be removed'), { code: 'EINVAL', quiet: true });
      }
      const next = profiles.filter((p) => p.id !== id);
      if (next.length === profiles.length) {
        throw Object.assign(new Error('That profile no longer exists'), { code: 'ENOENT', quiet: true });
      }
      // Sweep here and nowhere else on this path: removing a profile is the one
      // action that leaves a task behind, and without the sweep it would keep
      // running on its own timetable for ever.
      return writeProfiles(next, { sweep: true });
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
      // Pressing "Check" is a deliberate ask, so it is worth the PowerShell
      // call that looks for tasks left by profiles that are gone.
      const reconciled = await tasks.reconcile(settings, { settingsExisted: store.exists, sweep: true });
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
  handle('tasks:runNow', (event, which = 'cleanup', profileId = null) =>
    guard(async () => {
      // `which` still names the sampler or the cleanup; for a cleanup, which
      // profile's task it is now has to be said, because there is one each.
      const taskPath =
        which === 'sampler' ? scheduler.sampleTaskPath() : scheduler.cleanupTaskPath(profileId);
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

        // Which profile the button belongs to (G4). The window says; a profile
        // it names that is not there is an error rather than a run of whatever
        // happens to be first.
        const asked = typeof options.profileId === 'string' ? options.profileId : null;
        const profiles = settingsLib.profilesOf(base);
        const chosen = asked ? settingsLib.profileById(base, asked) : profiles[0];
        if (!chosen) {
          throw Object.assign(new Error('That profile no longer exists'), { code: 'ENOENT', quiet: true });
        }

        // Pressing the button is the consent to run, so a configuration that is
        // saved but not switched on can still be tested. Nothing else about the
        // policy is relaxed.
        const dryRun = options.dryRun !== false;
        const profile = { ...chosen, enabled: true, dryRun };
        const settings = base;

        // The button is a run like any other, so it takes the same lock -- a
        // scheduled profile firing mid-click would otherwise rewrite the run
        // log from under this one.
        const lock = await runlock.acquire(services().runLockPath, { holder: `manual:${profile.id}`, waitMs: 5000 });
        if (!lock.ok) {
          throw Object.assign(
            new Error(t('autoclean.busy', 'An automatic cleanup is running right now. Try again in a moment.')),
            { code: 'EBUSY', quiet: true }
          );
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        let run;
        try {
          run = await runAutoClean({
            settings,
            profile,
            ledger,
            journal: services().journal,
            source: 'manual',
            quarantine: settings.quarantine,
            token,
            onStage: send,
            onConfirm: dryRun ? undefined : (selection) => confirmAutoDelete(win, selection, profile, settings),
          });
        } finally {
          await lock.release();
        }

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
          // The periodic summary (G3), and when one was last shown.
          recap: settings.trends.recap,
          recapLastAt: settings.trends.recapLastAt,
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

  /* ---- the HTML report (G2) ---------------------------------------------- */

  /**
   * What a report could hold right now, so the window can offer only the
   * sections there is something behind.
   *
   * Cheap on purpose: it counts what is on disk rather than gathering it, so
   * opening the dialog costs nothing.
   */
  handle('report:options', () =>
    guard(async () => {
      const { history, snapshots, journal } = services();
      await history.load();
      const roots = await snapshots.roots();
      let pairs = 0;
      for (const root of roots) {
        if (snapshotDiff.defaultPair(await snapshots.list(root)).ok) pairs += 1;
      }
      const sessions = await journal.sessions();
      return {
        allowed: licenseState.canNow()('pro.reports'),
        sections: reportCollect.SECTIONS,
        namesFiles: reportCollect.FILE_LISTING_SECTIONS,
        available: {
          volumes: true,
          // In this process's memory and nowhere else; see `collectSystem`.
          system: systemState !== null,
          folders: history.scannedRoots().length > 0,
          trends: history.snapshots.length >= 2,
          diff: pairs > 0,
          actions: (sessions || []).length > 0,
        },
      };
    })
  );

  /**
   * Write one self-contained HTML file.
   *
   * Nothing is measured to fill it in: a section with no data behind it says
   * so in the report. The only exception is the drive list, which is a
   * `statfs` per volume.
   */
  handle('report:save', (event, request = {}) =>
    guard(async () => {
      if (!licenseState.canNow()('pro.reports')) {
        throw Object.assign(
          new Error(t('report.locked', 'Saving an HTML report is part of CleanDrive Pro.')),
          { code: 'ELOCKED', quiet: true }
        );
      }

      const asked = Array.isArray(request.sections) ? request.sections : reportCollect.SECTIONS;
      const sections = reportCollect.SECTIONS.filter((s) => asked.includes(s));
      if (sections.length === 0) {
        throw Object.assign(new Error(t('report.nothingChosen', 'Choose at least one section.')), {
          code: 'EINVAL',
          quiet: true,
        });
      }

      // On unless the window says otherwise, and the window's own default is
      // the same rule: a report that names files names people.
      const wantsPrivate =
        typeof request.private === 'boolean' ? request.private : reportCollect.namesFiles(sections);

      const data = await reportCollect.collect({
        sections,
        services: services(),
        deps: { volumes },
        // The System screen's rows, as the window is showing them.
        system: request.system || null,
        volume: typeof request.volume === 'string' ? request.volume : undefined,
        app: app.getName(),
        // The app's own version, not Electron's. In a checkout
        // app.getVersion() answers 33.4.11, and this figure goes into a
        // document somebody else reads.
        version: require('../../package.json').version,
        machine: request.machine !== false,
        lang: language.current(),
      });

      const body = reportHtml.buildReport(
        wantsPrivate ? reportRedact.redact(data, reportWords().pseudonyms) : data,
        reportWords()
      );

      const win = BrowserWindow.fromWebContents(event.sender);
      const stamp = new Date().toISOString().slice(0, 10);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: t('dialog.saveReport', 'Save report'),
        defaultPath: `cleandrive-report-${stamp}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (canceled || !filePath) return { written: false };

      await require('node:fs/promises').writeFile(filePath, body, 'utf8');
      return {
        written: true,
        path: filePath,
        bytes: Buffer.byteLength(body, 'utf8'),
        private: wantsPrivate,
        sections,
      };
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

  /* ---- the map (E4) ------------------------------------------------------ */

  /*
   * Tiles, fetched here because the window cannot fetch anything.
   *
   * `index.html` runs under `default-src 'none'` and that is not widened for
   * this: the window sends tile coordinates and gets PNG bytes back as `data:`
   * URIs, which `img-src` has allowed since thumbnails were built. The same
   * arrangement phase 6 settled on for payments.
   *
   * Refused outright when the map is switched off, which is how it ships. That
   * is not only tidiness -- it is what stops a window asking this process to
   * make a network request the user did not turn on.
   */
  handle('map:tiles', (event, list) =>
    guard(async () => {
      const { map } = await services().settings.get();
      if (!map || map.enabled !== true) return { tiles: [], attribution: mapTiles.ATTRIBUTION, refused: 'off' };
      return mapTiles.fetchTiles(Array.isArray(list) ? list : []);
    })
  );

  /** What the tile cache holds, for the card in Settings that offers to clear it. */
  handle('map:cache', () => guard(() => mapTiles.cacheSize()));

  handle('map:clearCache', () => guard(() => mapTiles.clearCache()));

  /* ---- photos and video -------------------------------------------------- */

  /**
   * The photo folders as real paths, for the one caller outside this screen
   * that needs them: F4 refuses to join anything inside them.
   *
   * `candidateRoots` needs Electron's known-folder lookups, which is why this
   * lives here and not in the handler. Built fresh rather than cached: the
   * refusal has to be about where the photo folders are now.
   */
  const photoRootPaths = async () => {
    try {
      const list = mediaRoots.candidateRoots(
        {
          home: app.getPath('home'),
          pictures: safePath('pictures'),
          videos: safePath('videos'),
          downloads: safePath('downloads'),
        },
        (p) => require('node:fs').existsSync(p),
        () => []
      );
      return list.map((entry) => entry.path);
    } catch {
      // A lookup that fails must not turn into "nothing is a photo folder".
      // The handler's own fallback -- the same folder names under the home
      // directory -- is a worse answer than this one but a far better answer
      // than none, so say nothing and let it use that.
      return null;
    }
  };

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
        (p) => require('node:fs').existsSync(p),
        // Telegram keeps a folder per signed-in account; see `roots.js`.
        (dir) => {
          try {
            return require('node:fs')
              .readdirSync(dir, { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .map((e) => e.name);
          } catch {
            return [];
          }
        }
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

      // `coordinates` is the gate in front of E4's map: with it false, which is
      // how the app ships, `analyzers/media.js` leaves positions out of the
      // payload entirely. Read here rather than remembered, so switching the
      // map off and scanning again really does stop sending them.
      const { map } = await services().settings.get();
      const context = { displays: displayResolutions(), coordinates: Boolean(map && map.enabled) };
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
   *
   * E1 kept that, and added the button (`media:measureAll`) for somebody who
   * *does* want to wait. The counts below are what lets the screen say which
   * of the two it is showing, so a short list reads as "we have only looked at
   * 214 of these" rather than as "there are no duplicates".
   */
  handle('media:similar', () =>
    guard(async () => {
      const cache = await mediaAnalysisCache();
      const items = [];
      let measurable = 0;
      let dehydrated = 0;

      for (const [filePath, record] of mediaStats) {
        // Counted, never queued. Reading one downloads it.
        if (record.dehydrated) {
          dehydrated += 1;
          continue;
        }
        measurable += 1;
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
        // And the one that the button acts on: everything but the cloud-only
        // files, which are never in the total it counts towards.
        measurable,
        dehydrated,
      };
    })
  );

  /**
   * Look at every picture, not just the ones that have been on screen (E1).
   *
   * ## Why this is a button and not something that just happens
   *
   * Measured on this machine with `npm run bench:media`: decoding a file to
   * the point where it can be compared costs **70.6 ms**, and no amount of
   * concurrency changes that -- it is the decode, not the waiting. Over the
   * 4,124 readable photographs in the default roots that is **about five
   * minutes**. Grouping them afterwards is 2 ms. So the whole cost of this
   * feature is a decode the grid was deliberately built never to do in bulk,
   * and a five-minute job that nobody asked for is not something to start on
   * somebody's behalf.
   *
   * It is paid once. The numbers taken from the pixels are cached by
   * `lib/media/cache.js` and keyed on path, size and time, so a second run
   * over the same library is the 91 ms the benchmark measured rather than
   * another five minutes.
   *
   * `display: false` asks for the measurements without the JPEG data URI: the
   * pictures are not wanted here, only the hashes, and not encoding them is
   * most of what makes this bearable.
   */
  handle('media:measureAll', (event) =>
    guard(async () => {
      if (tokens.measureAll) tokens.measureAll.cancel();
      const token = new CancelToken();
      tokens.measureAll = token;

      const cache = await mediaAnalysisCache();
      const keyOf = (filePath) => {
        const known = mediaStats.get(filePath);
        return known ? MediaCache.keyOf(known) : null;
      };

      const wanted = [];
      let dehydrated = 0;
      for (const [filePath, record] of mediaStats) {
        if (record.dehydrated) {
          dehydrated += 1;
          continue;
        }
        const known = cache.map.get(MediaCache.keyOf(record));
        // Already measured: left out of the list entirely rather than passed
        // through for the cache to answer, so the progress bar counts the work
        // that is actually left.
        if (known && known.hash) continue;
        wanted.push(filePath);
      }

      const started = Date.now();
      let done = 0;
      const total = wanted.length;
      const tick = throttle(() => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('media:measureProgress', {
            done,
            total,
            dehydrated,
            elapsedMs: Date.now() - started,
          });
        }
      }, 200);

      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('media:measureProgress', { done: 0, total, dehydrated, elapsedMs: 0 });
        }
        await thumbs.thumbnails(
          wanted,
          { cache, keyOf, display: false },
          {
            token,
            onOne: () => {
              done += 1;
              tick();
            },
          }
        );
        await cache.save();
        return { measured: done, total, dehydrated, cancelled: token.cancelled, elapsedMs: Date.now() - started };
      } finally {
        if (tokens.measureAll === token) tokens.measureAll = null;
      }
    })
  );

  /** Stop the pass. What it measured before stopping is kept. */
  handle('media:measureCancel', () =>
    guard(async () => {
      if (tokens.measureAll) tokens.measureAll.cancel();
      return true;
    })
  );

  /* ---- a smaller copy of a video (E3) ------------------------------------ */

  /**
   * Six channels for one feature, because the encoder is in the window.
   *
   * `VideoEncoder` is a web API and the main process does not have one;
   * `fs` is a Node API and the window does not have one. So a run is a
   * conversation: this side finds the frames and writes the file, the window
   * turns the frames into smaller frames, and the two halves pass batches back
   * and forth. A `VideoFrame` never crosses -- it is a handle to the window's
   * own memory and would not survive the trip.
   *
   * The job holds the sample index, which is small, and the encoded output as
   * it arrives. The source bytes are read from the disk a batch at a time
   * rather than held, because the index is a few hundred kilobytes and the file
   * can be hundreds of megabytes.
   */
  const videoJobs = new Map();
  let videoJobSeq = 0;

  const forgetVideoJob = (jobId) => {
    const job = videoJobs.get(jobId);
    if (!job) return;
    videoJobs.delete(jobId);
  };

  /**
   * What could be done with each of these files, before anything is encoded.
   *
   * Every file answers for itself. A cloud placeholder and a Matroska file are
   * ordinary things to find in a list somebody ticked, and both are reported
   * rather than thrown -- the dialog names them and leaves them out, which is
   * the same shape `preview:compare` uses for a file that will not open.
   */
  handle('video:plan', (event, paths) =>
    guard(async () => {
      const wanted = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p.trim()) : [];
      if (!wanted.length) throw new Error(t('preview.error.noPath', 'No file was named'));

      const out = [];
      for (const filePath of wanted) {
        const source = await videoEncode.open(filePath);
        if (!source.ok) {
          out.push({
            ok: false,
            path: filePath,
            name: path.basename(filePath),
            reason: source.reason,
            detail: source.detail || null,
            size: source.size || 0,
          });
          continue;
        }
        out.push({
          ok: true,
          path: filePath,
          name: path.basename(filePath),
          size: source.size,
          durationSec: Math.round(source.durationSec * 10) / 10,
          width: source.video.width,
          height: source.video.height,
          codec: source.video.codec,
          hasAudio: Boolean(source.audio),
          audioDropped: source.audioDropped,
        });
      }
      return out;
    })
  );

  /** Begin one file: the sample index, and what the encoder should aim for. */
  handle('video:open', (event, filePath, level) =>
    guard(async () => {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        throw new Error(t('preview.error.noPath', 'No file was named'));
      }
      const source = await videoEncode.open(filePath);
      if (!source.ok) throw new Error(`cannot encode: ${source.reason}`);

      const settings = videoEncode.settings(source, level === 'smallest' ? 'smallest' : 'balanced');
      const trialCount = videoEncode.trialSampleCount(source.video.samples, videoEncode.TRIAL_SECONDS);
      const trialSeconds = source.video.samples[Math.min(trialCount, source.video.samples.length - 1)].timestamp / 1e6
        || videoEncode.TRIAL_SECONDS;

      videoJobSeq += 1;
      const jobId = `v${videoJobSeq}`;
      videoJobs.set(jobId, { source, settings, chunks: [], bytes: 0 });

      return {
        jobId,
        settings,
        source: {
          codec: source.video.codec,
          // The configuration record a decoder cannot start without. It is a
          // few dozen bytes, so it goes over whole rather than by reference.
          description: source.video.description ? Array.from(source.video.description) : null,
          width: source.video.width,
          height: source.video.height,
          sampleCount: source.video.samples.length,
          durationSec: source.durationSec,
          audioBytes: source.audio ? source.audio.bytes : 0,
        },
        trial: { sampleCount: trialCount, seconds: Math.max(0.1, trialSeconds) },
      };
    })
  );

  /** A batch of source frames, as bytes. */
  handle('video:read', (event, jobId, from, count) =>
    guard(async () => {
      const job = videoJobs.get(jobId);
      if (!job) throw new Error('that job has already finished');
      return videoEncode.readSamples(
        job.source.path,
        job.source.video.samples,
        Math.max(0, Number(from) || 0),
        Math.max(1, Math.min(512, Number(count) || 1))
      );
    })
  );

  /** A batch of encoded frames, on their way back. */
  handle('video:write', (event, jobId, chunks) =>
    guard(async () => {
      const job = videoJobs.get(jobId);
      if (!job) throw new Error('that job has already finished');
      for (const chunk of Array.isArray(chunks) ? chunks : []) {
        const data = Buffer.from(chunk.data);
        job.bytes += data.length;
        job.chunks.push({
          data,
          timestamp: Number(chunk.timestamp) || 0,
          duration: Number(chunk.duration) || 0,
          key: Boolean(chunk.key),
        });
      }
      return { frames: job.chunks.length, bytes: job.bytes };
    })
  );

  /**
   * Mux what came back, write it beside the original, and read it back.
   *
   * The read-back is the point. A smaller file nothing can open is worse than
   * no file at all, and this project has already met that exact shape once --
   * E5 measured Zalo's re-encoded copies as both smaller and undrawable. So the
   * copy is parsed with the app's own reader before anyone is told it exists,
   * and a copy that will not parse is deleted rather than reported.
   */
  handle('video:save', (event, jobId, meta) =>
    guard(async () => {
      const job = videoJobs.get(jobId);
      if (!job) throw new Error('that job has already finished');
      if (!job.chunks.length) throw new Error('nothing was encoded');
      if (!meta || !meta.codecConfig || !meta.codecConfig.length) {
        throw new Error('the encoder did not describe its own output');
      }

      const { source, settings } = job;
      const spec = {
        createdAt: source.createdAt,
        video: {
          fourcc: meta.fourcc === 'hvc1' ? 'hvc1' : 'avc1',
          codecConfig: Buffer.from(meta.codecConfig),
          width: Number(meta.width) || settings.width,
          height: Number(meta.height) || settings.height,
          framerate: Number(meta.framerate) || settings.framerate,
          // The rotation the source carried. Dropping it would lay a portrait
          // phone video on its side; the position it may also carry is
          // deliberately not passed on, and the screen says so.
          matrix: source.video.matrix || null,
          samples: job.chunks,
        },
      };

      if (source.audio) {
        const audioSamples = await videoEncode.readSamples(
          source.path,
          source.audio.samples,
          0,
          source.audio.samples.length
        );
        spec.audio = {
          fourcc: 'mp4a',
          config: source.audio.description,
          channels: source.audio.channels,
          sampleRate: source.audio.sampleRate,
          timescale: source.audio.timescale,
          samples: audioSamples.map((s, i) => ({
            data: s.data,
            durationTicks: Math.max(1, Math.round((source.audio.samples[i].duration / 1e6) * source.audio.timescale)),
          })),
        };
      }

      const destination = await videoEncode.destinationFor(source.path);
      const verified = await videoEncode.write(source, spec, destination);
      forgetVideoJob(jobId);

      return {
        path: destination,
        name: path.basename(destination),
        size: verified.size,
        was: source.size,
        codec: verified.codec,
        width: verified.width,
        height: verified.height,
        frames: verified.frames,
        hasAudio: verified.hasAudio,
        durationSec: verified.durationSec,
        audioDropped: source.audioDropped,
        locationDropped: Boolean(source.video.hasLocation),
      };
    })
  );

  /** Forget a job, whether it finished or was stopped. Writes nothing. */
  handle('video:close', (event, jobId) =>
    guard(async () => {
      forgetVideoJob(jobId);
      return true;
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

  /**
   * Two files at once, for the side-by-side comparison (F3).
   *
   * Not two `preview:open` calls. That handler revokes the last file's token
   * before it grants the next one -- one preview at a time is what stops a
   * window that has moved on from still being able to fetch what it used to
   * show -- so two of them in flight together would have the second revoke the
   * first, and one of the two panes would be pointed at a token that no longer
   * works. The pair is therefore one request: revoked once, granted twice.
   *
   * Each file answers for itself. One of the two being unreadable is an
   * ordinary outcome -- the set is a guess made from filenames, and a name is
   * no promise the file behind it can be opened -- and it should cost that one
   * pane, not the comparison.
   */
  handle('preview:compare', (event, left, right) =>
    guard(async () => {
      // Two paths, or a list of them. F3 compares exactly two drafts of a
      // document; E1 compares two to four photographs, and both want the same
      // thing from this handler -- one revoke, then a token each -- so the
      // list form was added rather than a second handler that would have to
      // stay in step with this one about what "one preview at a time" means.
      const wanted = Array.isArray(left) ? left : [left, right];
      if (wanted.length < 2 || wanted.length > MAX_COMPARED) {
        throw new Error(t('preview.error.compareCount', 'Between 2 and {n} files can be compared at once', { n: MAX_COMPARED }));
      }
      if (wanted.some((p) => typeof p !== 'string' || p.trim() === '')) {
        throw new Error(t('preview.error.noPath', 'No file was named'));
      }
      previewServe.revokeAll();
      // Serial on purpose: each of these reads the head of a file off one
      // disk, and two such reads at once are not two reads in the time of one.
      const out = [];
      for (const target of wanted) out.push(await guard(() => preview(target)));
      return out;
    })
  ),

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
    // What the window may do with profiles (G4), decided here rather than
    // guessed from the licence in the renderer.
    profileLimits: {
      max: settingsLib.MAX_PROFILES,
      // Free keeps the one profile it has always had. The refusal is said out
      // loud when an extra one is asked for -- see `autoclean:addProfile`.
      allowed: licenseState.canNow()('pro.automatic.profiles') ? settingsLib.MAX_PROFILES : 1,
      actions: settingsLib.AUTO_ACTIONS,
    },
    // The last run of each profile, so a card can show its own result rather
    // than whichever profile happened to run most recently.
    lastRunByProfile: lastRunPerProfile(runLog.runs, settingsLib.profilesOf(settings)),
  };
}

/**
 * The most recent run of each profile, keyed by id.
 *
 * The log is one list in time order, shared by every profile, because that is
 * what it has always been and because a run that could not identify itself
 * still belongs in it. A profile with no run yet gets null rather than being
 * left out, so the screen shows "not run yet" instead of nothing at all.
 */
function lastRunPerProfile(runs, profiles) {
  const out = {};
  for (const profile of profiles) out[profile.id] = null;
  for (const run of runs || []) {
    const id = run.profileId || settingsLib.FIRST_PROFILE_ID;
    if (id in out && out[id] === null) out[id] = run;
  }
  return out;
}

/**
 * Every word the report puts on the page (G2).
 *
 * Built here rather than in `report/html.js` so that file stays a renderer
 * with no opinions, and so every key is a literal one `test:i18n` can see.
 * Read at save time, not at startup, because the language can change while
 * the app is open.
 */
function reportWords() {
  return {
    title: t('report.title', 'CleanDrive report'),
    madeBy: t('report.madeBy', 'Made by'),
    footer: t('report.footer', 'Every figure here was measured by CleanDrive on the computer named above. Nothing in this file was sent anywhere, and nothing in it is fetched when you open it — the numbers are embedded at the end as JSON.'),
    privateOn: t('report.privateOn', 'Private mode: folder and file names have been replaced with generic ones. The same folder keeps the same name throughout, so the report still reads, and the data at the end of the file is replaced too.'),

    volumes: t('report.volumes', 'Drives'),
    noVolumes: t('report.noVolumes', 'No drive could be measured.'),
    system: t('report.system', 'Where the drive went'),
    noSystem: t('report.noSystem', 'Not measured in this session. Open the System screen and measure, then save the report again.'),
    folders: t('report.folders', 'Folders that have been scanned'),
    noFolders: t('report.noFolders', 'No folder has been scanned yet. Scan one on the Disk usage screen.'),
    trends: t('report.trends', 'Over time'),
    noTrends: t('report.noTrends', 'Two or more measurements are needed before anything can be said about a trend.'),
    diff: t('report.diff', 'What changed'),
    noDiff: t('report.noDiff', 'Two comparable scans of one folder are needed. Scan the same folder again in a few days.'),
    actions: t('report.actions', 'What CleanDrive did'),
    noActions: t('report.noActions', 'CleanDrive has not moved or deleted anything yet.'),
    actionsNote: t('report.actionsNote', 'From the action journal, which records every file this app moved and where it went.'),

    drive: t('report.col.drive', 'Drive'),
    fileSystem: t('report.col.fileSystem', 'Format'),
    total: t('report.col.total', 'Total'),
    free: t('report.col.free', 'Free'),
    used: t('report.col.used', 'Used'),
    full: t('report.full', 'full'),
    of: t('report.of', 'of'),
    row: t('report.col.row', 'Where'),
    size: t('report.col.size', 'Size'),
    note: t('report.col.note', 'Note'),
    systemDrive: t('report.systemDrive', 'Drive'),
    measured: t('report.measured', 'measured'),
    notElevated: t('report.notElevated', 'measured without administrator rights, so some rows are incomplete'),
    folder: t('report.col.folder', 'Folder'),
    files: t('report.col.files', 'Files'),
    scanned: t('report.col.scanned', 'Scanned'),
    growth: t('report.growth', 'Growing by'),
    perMonth: t('report.perMonth', 'per month'),
    noChart: t('report.noChart', 'The measurements below could not be drawn as a line — not enough of them say how full the drive was.'),
    noGrowth: t('report.noGrowth', 'Not enough measurements to say whether it is growing.'),
    readings: t('report.readings', 'measurements'),
    at: t('report.col.at', 'When'),
    from: t('report.col.from', 'Measured by'),
    whereChanged: t('report.whereChanged', 'Where it changed'),
    filesChanged: t('report.filesChanged', 'Files that changed'),
    change: t('report.col.change', 'Change'),
    what: t('report.col.what', 'What'),
    file: t('report.col.file', 'File'),
    items: t('report.items', 'items'),
    andMore: t('report.andMore', 'and {n} more'),

    kinds: {
      recycle: t('report.kind.recycle', 'Moved to the Recycle Bin'),
      quarantine: t('report.kind.quarantine', 'Moved to another drive'),
      restore: t('report.kind.restore', 'Put back'),
      handoff: t('report.kind.handoff', 'Handed to a Windows tool'),
      dehydrate: t('report.kind.dehydrate', 'Made online-only'),
      purge: t('report.kind.purge', 'Removed from the Recycle Bin'),
    },

    // The words private mode builds its stand-in names from.
    pseudonyms: {
      folderWord: t('report.pseudonym.folder', 'Folder'),
      fileWord: t('report.pseudonym.file', 'File'),
      driveWord: t('report.pseudonym.drive', 'Drive'),
    },
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

/**
 * The confirmation in front of moving a folder to another drive (B2).
 *
 * It says three things the person cannot see from the treemap, in the order
 * that matters if they read only the first line:
 *
 *   - how much is actually going, in files as well as bytes, because "move
 *     this folder" hides how long it will take
 *   - that this frees nothing yet, since the original goes to the Recycle Bin
 *     on the same drive -- the sentence the rest of this app already insists on
 *   - what is being left behind: a link stepped over, a stream carried across
 *
 * There is no "do not ask again".
 */
async function confirmRelocate(win, description) {
  const one = description.folders && description.folders.length === 1 ? description.folders[0] : null;
  const lines = [];

  lines.push(
    t('dialog.relocate.detail', '{files} file(s), {size}, will be copied to {destination} and checked there first.', {
      files: description.files.toLocaleString(language.current()),
      size: formatBytes(description.bytes),
      destination: displayPath(description.destination || ''),
    })
  );

  lines.push(
    description.deleteOriginal
      ? t(
          'dialog.relocate.deleting',
          'The original will then be deleted for good. That is the only way this frees space, and it cannot be undone.'
        )
      : t(
          'dialog.relocate.binned',
          'The original then goes to the Recycle Bin — so nothing is freed on this drive until the bin is emptied.'
        )
  );

  if (description.skippedLinks > 0) {
    lines.push(
      t('dialog.relocate.links', '{n} link(s) inside it are stepped over rather than followed, and are not copied.', {
        n: description.skippedLinks.toLocaleString(language.current()),
      })
    );
  }
  if (description.leaveShortcut) {
    lines.push(t('dialog.relocate.shortcut', 'A shortcut is left where the folder was. It is a shortcut, not a junction, so nothing else on the computer will follow it by accident.'));
  }

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [t('dialog.relocate.go', 'Move the folder'), t('app.cancel', 'Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.relocate.title', 'Move to another drive'),
    message: one
      ? t('dialog.relocate.messageOne', 'Move “{name}” to another drive?', { name: path.basename(one.path) })
      : t('dialog.relocate.message', 'Move {n} folder(s) to another drive?', {
          n: description.count.toLocaleString(language.current()),
        }),
    detail: lines.join('\n\n'),
  });

  return response === 0;
}

/**
 * The confirmation in front of packing a folder away (B5).
 *
 * The line that matters is the second one. "Pack this folder" sounds like it
 * saves space, and for a folder of photos it saves almost none -- so the
 * dialog states the estimate before the person agrees rather than letting
 * them find out from the disk afterwards. The figure is sampled and says so.
 */
async function confirmArchive(win, description) {
  const one = description.folders && description.folders.length === 1 ? description.folders[0] : null;
  const lines = [];

  lines.push(
    t('dialog.archive.detail', '{files} file(s), {size}, will be packed into one .zip and every one of them checked inside it afterwards.', {
      files: description.files.toLocaleString(language.current()),
      size: formatBytes(description.bytes),
    })
  );

  const saving = description.bytes > 0 ? 1 - description.estimatedArchiveBytes / description.bytes : 0;
  lines.push(
    saving < 0.05
      ? t(
          'dialog.archive.noSaving',
          'This folder is already about as small as it gets — the archive should be around {archive}, so packing it is about having one file instead of {files}, not about space.',
          {
            archive: formatBytes(description.estimatedArchiveBytes),
            files: description.files.toLocaleString(language.current()),
          }
        )
      : t('dialog.archive.saving', 'The archive should be around {archive}, from a sample of the files — roughly {percent} smaller.', {
          archive: formatBytes(description.estimatedArchiveBytes),
          percent: `${Math.round(saving * 100)}%`,
        })
  );

  lines.push(
    description.sameVolume
      ? t(
          'dialog.archive.sameDrive',
          'The archive goes on the same drive, so emptying the Recycle Bin afterwards gives back about {freed}.',
          { freed: formatBytes(description.estimatedFreedBytes) }
        )
      : t(
          'dialog.archive.otherDrive',
          'The archive goes to {drive}, so emptying the Recycle Bin afterwards gives back about {freed} here.',
          { drive: description.destinationDrive || '', freed: formatBytes(description.estimatedFreedBytes) }
        )
  );

  lines.push(
    t(
      'dialog.archive.back',
      'The folder goes to the Recycle Bin, and the Restore Center can unpack the archive back to where it was, timestamps and all.'
    )
  );

  if (description.skippedLinks > 0) {
    lines.push(
      t('dialog.archive.links', '{n} link(s) inside it are stepped over rather than followed, and are not packed.', {
        n: description.skippedLinks.toLocaleString(language.current()),
      })
    );
  }

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [t('dialog.archive.go', 'Pack the folder'), t('app.cancel', 'Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.archive.title', 'Pack into an archive'),
    message: one
      ? t('dialog.archive.messageOne', 'Pack “{name}” into one file?', { name: path.basename(one.path) })
      : t('dialog.archive.message', 'Pack {n} folder(s) into archives?', {
          n: description.count.toLocaleString(language.current()),
        }),
    detail: lines.join('\n\n'),
  });

  return response === 0;
}

/**
 * The confirmation in front of letting NTFS hold a folder in less room (B4).
 *
 * The one place in this app where "this frees space" is simply true: there is
 * no Recycle Bin in the way, and the figure is back the moment it finishes.
 * So it says the figure, and it says where the figure came from -- a dozen of
 * the folder's own files put through NTFS, not a guess.
 */
async function confirmCompress(win, description) {
  const one = description.folders && description.folders.length === 1 ? description.folders[0] : null;
  const name = one ? path.basename(one.path) : '';

  if (description.uncompress) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [t('dialog.compress.undoGo', 'Stop compressing'), t('app.cancel', 'Cancel')],
      defaultId: 1,
      cancelId: 1,
      title: t('dialog.compress.undoTitle', 'Stop compressing'),
      message: one
        ? t('dialog.compress.undoMessageOne', 'Stop compressing “{name}”?', { name })
        : t('dialog.compress.undoMessage', 'Stop compressing {n} folder(s)?', {
            n: description.count.toLocaleString(language.current()),
          }),
      detail: t(
        'dialog.compress.undoDetail',
        'The files do not change — they go back to taking their full {size} on the disk. Nothing is deleted either way.',
        { size: formatBytes(description.bytes) }
      ),
    });
    return response === 0;
  }

  const lines = [];
  const saving = description.onDiskBefore > 0 ? description.estimatedFreedBytes / description.onDiskBefore : 0;

  lines.push(
    saving < 0.05
      ? t(
          'dialog.compress.noSaving',
          'These files are already compressed inside — photos, video, and the like — so NTFS has almost nothing to take out. Measured on a sample of {n} of them: about {freed} back out of {before}.',
          {
            n: (description.sampled || description.alreadyCompressed).toLocaleString(language.current()),
            freed: formatBytes(description.estimatedFreedBytes),
            before: formatBytes(description.onDiskBefore),
          }
        )
      : t(
          'dialog.compress.saving',
          'About {freed} comes back, from {before} to about {after} — measured by putting {n} of this folder’s own files through NTFS, not guessed.',
          {
            freed: formatBytes(description.estimatedFreedBytes),
            before: formatBytes(description.onDiskBefore),
            after: formatBytes(description.estimatedBytes),
            n: (description.sampled || 0).toLocaleString(language.current()),
          }
        )
  );

  lines.push(
    t(
      'dialog.compress.freesNow',
      'This is space back straight away — nothing goes to the Recycle Bin, and there is nothing to empty afterwards.'
    )
  );

  lines.push(
    t(
      'dialog.compress.whatChanges',
      'The files keep their names, their contents and the size every program sees. Opening one costs a little processor instead of a little more reading. You can stop compressing the folder at any time from the same menu.'
    )
  );

  if (description.alreadyCompressed > 0) {
    lines.push(
      t('dialog.compress.alreadyCompressed', '{n} of the {files} file(s) in it are formats that are already compressed and will not shrink.', {
        n: description.alreadyCompressed.toLocaleString(language.current()),
        files: description.files.toLocaleString(language.current()),
      })
    );
  }

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: [t('dialog.compress.go', 'Compress the folder'), t('app.cancel', 'Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.compress.title', 'Compress with NTFS'),
    message: one
      ? t('dialog.compress.messageOne', 'Let Windows compress “{name}”?', { name })
      : t('dialog.compress.message', 'Let Windows compress {n} folder(s)?', {
          n: description.count.toLocaleString(language.current()),
        }),
    detail: lines.join('\n\n'),
  });

  return response === 0;
}

async function confirmAction(win, description, planned, options) {
  /*
   * F4 is the one action whose confirmation is not a native message box.
   *
   * The roadmap requires an explanation the person has to scroll all the way
   * through before the button becomes pressable, and `dialog.showMessageBox`
   * cannot do that -- E2 already established that its only control besides the
   * buttons is a single checkbox. So the dialog is an HTML one in the window
   * (`renderer/hardlink.js`), and what arrives here is the answer it produced.
   *
   * Being honest about what that is worth: this checks a flag the window sent,
   * so it is not a guarantee against a window that lies. It is the same trust
   * every other option crossing this boundary gets, and it is not the only
   * thing standing there -- `actions/hardlink.js` refuses to link without the
   * flag too, so a caller that skips the dialog gets nothing linked rather
   * than a silent join.
   */
  if (description.kind === 'hardlink') return options.acknowledged === true;
  if (description.kind === 'quarantine') return confirmQuarantine(win, description, planned);
  if (description.kind === 'relocate') return confirmRelocate(win, description);
  if (description.kind === 'archive') return confirmArchive(win, description);
  if (description.kind === 'compress') return confirmCompress(win, description);
  if (description.kind === 'dehydrate') return confirmDehydrate(win, description);
  if (description.kind !== 'recycle') return false;

  const count = description.count;
  const slow = description.etaMs >= 30000;

  /*
   * E2 puts its switch in this dialog, and a native message box is the reason
   * it is a checkbox rather than a folder picker.
   *
   * The roadmap says "an option in the confirmation dialog: back up to …
   * first". `dialog.showMessageBox` has exactly one control besides its
   * buttons, and that is a checkbox; it cannot hold a path field or open a
   * folder browser. So the destination is chosen on the screen behind, the
   * same way B2 and B5 choose theirs, and what lands here is the yes or no
   * about a destination already named -- which is the part somebody actually
   * changes their mind about at this moment.
   */
  const backup = description.backupTo
    ? {
        checkboxLabel: t('dialog.confirmDelete.backupCheck', 'Back up to {dest} first', {
          dest: displayPath(description.backupTo),
        }),
        checkboxChecked: true,
      }
    : {};

  const backupNote = description.backupTo
    ? `\n\n${t(
        'dialog.confirmDelete.backup',
        'Each one is copied to {dest} and read back and checked against its original (SHA-256) before it goes to the ' +
          'bin, and a manifest.json there lists what was copied. Anything whose copy does not match is left exactly ' +
          'where it is and named in the receipt. Turn the box below off to delete without a copy.',
        { dest: displayPath(description.backupTo) }
      )}`
    : '';

  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
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
      backupNote +
      binNote(description) +
      chatNote(planned) +
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
    ...backup,
  });

  if (response !== 0) return false;
  // Unticking the box is an answer, not a cancel: delete these, without a
  // copy. The pipeline takes options from a dialog over options from a window
  // precisely so a decision made here is the one that runs.
  if (description.backupTo && checkboxChecked === false) {
    return { approved: true, options: { backupTo: null } };
  }
  return true;
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
async function confirmAutoDelete(win, selection, profile, settings) {
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
        { days: profile.minAgeDays, size: formatBytes(selection.bytes) }
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
/**
 * The sentence D3 requires in front of deleting something a chat app received.
 *
 * Decided by looking at the paths rather than by trusting the screen that
 * asked. A photograph from a Zalo conversation is the same photograph whether
 * it was reached from the Chat screen or from Photos & video, and the warning
 * it deserves does not depend on which button was pressed. `chat/known.js`
 * answers only for the folders downloads land in, so a settings file under the
 * same app does not trigger it.
 *
 * The second half is the part worth being careful about. The roadmap's draft
 * said the app "can download it again if it is still on the server", which
 * reads as a reassurance -- and nothing here can check whether it is. So it is
 * written as the uncertainty it is, and it says which way to assume.
 */
function chatNote(planned) {
  const counts = chatKnown.countByApp((planned.plan || []).map((item) => item.path));
  if (counts.size === 0) return '';
  const total = [...counts.values()].reduce((sum, v) => sum + v, 0);
  const names = [...counts.keys()].map((app) => (app === 'zalo' ? 'Zalo' : 'Telegram')).join(', ');
  return `\n\n${t(
    'dialog.confirmDelete.chat',
    '{n} of these were downloaded by {apps}. Deleting them removes them from this computer, not from the ' +
      'conversation. Whether the app can fetch one again depends on whether it is still on the server, which ' +
      'cannot be checked from here — assume it cannot.',
    { n: total.toLocaleString(language.current()), apps: names }
  )}`;
}

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
  // The report’s words, so a harness photographs what the app writes
  // rather than a second copy made for the camera (G2).
  reportWords,
  cancelAll,
  noteReconciliation,
  allowUnconfirmedForHarness,
  setSystemTargetForHarness,
  setHelperClientForHarness,
  setHandoffDepsForHarness,
  setCloudDepsForHarness,
  setAppCacheHarness,
  setScanHarness,
  setQuarantineHarness,
  setRelocateHarness,
  quarantineStatus,
  confirmQuarantineText,
  setContextMenuForHarness,
  setCopiesScopeForHarness,
  reconcileMenu,
};
