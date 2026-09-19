'use strict';

const { app, Tray, Menu, nativeImage } = require('electron');

const { DiskMonitor } = require('./lib/monitor');
const { renderGauge } = require('./lib/trayicon');
const { formatBytes } = require('./lib/util');
const notify = require('./lib/notify');
const { t } = require('./language');

/**
 * The tray presence, and the only part of this app that outlives its window.
 *
 * This contradicts the reasoning used for the scheduled cleanup, which
 * deliberately avoids a resident process, so the contradiction is resolved
 * explicitly rather than quietly: the difference is that a cleanup has a moment
 * it must happen at, which the OS scheduler can be told about, while "warn me
 * before the disk fills" has no moment -- it is a question asked continuously.
 * Task Scheduler could poll, but waking a whole Electron process every minute
 * to call `statfs` costs far more than keeping one small timer alive.
 *
 * So this exists, and it is off by default, and the README states the measured
 * memory cost rather than promising a number.
 */

let tray = null;
let monitor = null;
let quitting = false;
let getWindow = () => null;
let openWindow = () => {};
let lastIconLevel = null;
let lastIconPercent = -1;

// Mirrors settings.monitor.closeToTray. It lives here rather than in main.js so
// that ipc.js never has to require main.js: requiring the entry point from a
// module the entry point itself requires re-runs its top level, which registers
// every IPC handler a second time.
let closeToTrayPreference = true;

/** Wire the tray to the app. Called once, on ready. */
function configure({ window, open }) {
  getWindow = window || getWindow;
  openWindow = open || openWindow;
}

/** True once the app is genuinely shutting down, so close means close. */
function beginQuit() {
  quitting = true;
  destroy();
}

function isQuitting() {
  return quitting;
}

/* -------------------------------------------------------------------------- */
/* lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Bring the tray and the monitor into line with the settings.
 *
 * Called on startup and after every save, so turning monitoring off actually
 * removes the icon and stops the timer rather than leaving them until restart.
 */
function apply(settings) {
  const config = settings.monitor;
  closeToTrayPreference = config.closeToTray;

  if (!config.enabled) {
    destroy();
    return { running: false };
  }

  const volumes = config.volumes.length > 0 ? config.volumes : [app.getPath('home')];

  if (!monitor) {
    monitor = new DiskMonitor({
      volumes,
      warnPercent: config.warnPercent,
      criticalPercent: config.criticalPercent,
      intervalSeconds: config.intervalSeconds,
      snoozeMinutes: config.snoozeMinutes,
    });
    monitor.on(handleEvent);
  } else {
    monitor.warnPercent = config.warnPercent;
    monitor.criticalPercent = config.criticalPercent;
    monitor.snoozeMinutes = config.snoozeMinutes;
    monitor.setVolumes(volumes);

    if (monitor.intervalSeconds !== config.intervalSeconds) {
      monitor.intervalSeconds = config.intervalSeconds;
      monitor.stop();
    }
  }

  if (!tray) {
    tray = new Tray(iconFor(null));
    tray.on('click', () => openWindow());
  }

  if (!monitor.running) monitor.start();
  render();

  return { running: true };
}

function destroy() {
  if (monitor) {
    monitor.stop();
    monitor = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  lastIconLevel = null;
  lastIconPercent = -1;
}

function status() {
  if (!monitor) return { running: false, volumes: [], snoozed: false, snoozedUntil: 0 };
  return {
    running: monitor.running,
    volumes: monitor.snapshot(),
    snoozed: monitor.isSnoozed(),
    snoozedUntil: monitor.snoozedUntil,
    lastCheckedAt: monitor.lastCheckedAt,
  };
}

function snooze(minutes) {
  if (!monitor) return { ok: false, error: 'Monitoring is not running' };
  const until = monitor.snooze(minutes);
  render();
  return { ok: true, until };
}

function clearSnooze() {
  if (!monitor) return { ok: false, error: 'Monitoring is not running' };
  monitor.clearSnooze();
  render();
  return { ok: true };
}

/** Force a reading now, rather than waiting for the next interval. */
async function checkNow() {
  if (!monitor) return null;
  const snapshot = await monitor.check();
  render();
  return snapshot;
}

/* -------------------------------------------------------------------------- */
/* presentation                                                                */
/* -------------------------------------------------------------------------- */

function iconFor(worst) {
  const percent = worst && worst.usage ? worst.usage.usedPercent : NaN;
  const { png } = renderGauge({
    usedPercent: percent,
    warnPercent: monitor ? monitor.warnPercent : 85,
    criticalPercent: monitor ? monitor.criticalPercent : 95,
    size: 32,
  });
  return nativeImage.createFromBuffer(png);
}

function render() {
  if (!tray || !monitor) return;

  const worst = monitor.worst();
  const percent = worst && worst.usage ? worst.usage.usedPercent : NaN;
  const level = worst ? worst.level : 'unknown';

  // Redrawing a PNG and handing it to the shell on every tick is wasted work
  // when nothing visible changed. A tenth of a percent is below what the icon
  // can show anyway.
  const rounded = Number.isFinite(percent) ? Math.round(percent * 10) / 10 : -1;
  if (level !== lastIconLevel || rounded !== lastIconPercent) {
    tray.setImage(iconFor(worst));
    lastIconLevel = level;
    lastIconPercent = rounded;
  }

  tray.setToolTip(tooltip(worst));
  tray.setContextMenu(buildMenu());
}

function tooltip(worst) {
  if (!worst || !worst.usage || worst.usage.ok !== true) {
    return t('tray.tooltip.unknown', 'CleanDrive — disk usage unknown');
  }
  const { usage, root } = worst;
  return (
    `CleanDrive — ${root}\n` +
    t('tray.tooltip.usage', '{percent}% used · {free} free of {total}', {
      percent: usage.usedPercent.toFixed(1),
      free: formatBytes(usage.freeBytes),
      total: formatBytes(usage.totalBytes),
    }) +
    (monitor.isSnoozed() ? `\n${t('tray.snoozed', 'Alerts snoozed')}` : '')
  );
}

function buildMenu() {
  const rows = monitor.snapshot().map((entry) => ({
    label:
      entry.usage && entry.usage.ok
        ? `${entry.root}  ` +
          t('tray.volumeUsage', '{percent}% used · {free} free', {
            percent: entry.usage.usedPercent.toFixed(1),
            free: formatBytes(entry.usage.freeBytes),
          })
        : `${entry.root}  ${t('tray.unreadable', 'unreadable')}`,
    enabled: false,
  }));

  const snoozed = monitor.isSnoozed();

  return Menu.buildFromTemplate([
    { label: 'CleanDrive', enabled: false },
    { type: 'separator' },
    ...(rows.length > 0
      ? rows
      : [{ label: t('tray.noVolumes', 'No volumes watched'), enabled: false }]),
    { type: 'separator' },
    { label: t('tray.open', 'Open CleanDrive'), click: () => openWindow() },
    snoozed
      ? { label: t('monitor.resume', 'Resume alerts'), click: () => clearSnooze() }
      : {
          label: t('tray.snoozeFor', 'Snooze alerts for {n} minutes', { n: monitor.snoozeMinutes }),
          click: () => snooze(),
        },
    { label: t('app.checkNow', 'Check now'), click: () => { checkNow().catch(() => {}); } },
    { type: 'separator' },
    { label: t('tray.quit', 'Quit'), click: () => { beginQuit(); app.quit(); } },
  ]);
}

/* -------------------------------------------------------------------------- */
/* alerts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A reading the monitor has already taken is a measurement the trends can use.
 *
 * Monitoring polls every minute by default and, until now, threw every reading
 * away after painting the tray icon -- while the Trends tab a few pixels away
 * said it had no measurements. The history store collapses anything taken
 * within half an hour of the last point, so this contributes at most two points
 * an hour however often the monitor ticks.
 *
 * Failures are swallowed on purpose: the disk-alert feature must not stop
 * working because a history file could not be written.
 */
function recordReading() {
  Promise.resolve()
    .then(async () => {
      const { services } = require('./services');
      const { sample } = require('./lib/sampler');
      const { history, settings: store } = services();
      await history.load();
      await sample({
        history,
        settings: await store.get(),
        source: 'monitor',
        extraTargets: [app.getPath('userData')],
      });
    })
    .catch(() => {});
}

function handleEvent(event) {
  if (event.type === 'reading' || event.type === 'snoozed') {
    render();
    if (event.type === 'reading') recordReading();
    return;
  }

  if (event.type !== 'level') return;
  render();

  // Only a rise is worth interrupting for. Dropping back to "ok" is good news,
  // and good news does not need a notification.
  if (!event.rising || event.suppressed) return;

  const { usage } = event;
  const critical = event.to === 'critical';

  notify.show(
    {
      title: critical
        ? t('notify.disk.criticalTitle', 'CleanDrive: disk almost full')
        : t('notify.disk.lowTitle', 'CleanDrive: disk space is low'),
      body:
        t('notify.disk.body', '{root} is {percent}% full — {free} left of {total}.', {
          root: event.root,
          percent: usage.usedPercent.toFixed(1),
          free: formatBytes(usage.freeBytes),
          total: formatBytes(usage.totalBytes),
        }) +
        (critical
          ? ' ' + t('notify.disk.criticalNote', 'Windows may start misbehaving below a gigabyte or so.')
          : ''),
      urgency: critical ? 'critical' : 'normal',
      silent: !critical,
    },
    // Clicking opens the app rather than starting a cleanup. A deletion that
    // began from a notification click, with nothing shown first, is exactly
    // the kind of thing this app does not do.
    () => openWindow()
  );
}

/** Whether closing the window should hide it. Only meaningful while running. */
function shouldCloseToTray() {
  return closeToTrayPreference;
}

module.exports = {
  configure,
  apply,
  destroy,
  status,
  shouldCloseToTray,
  snooze,
  clearSnooze,
  checkNow,
  beginQuit,
  isQuitting,
};
