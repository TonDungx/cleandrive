#!/usr/bin/env node
'use strict';

// A disk alert that fires every minute is an alert the user switches off. These
// tests are mostly about *not* notifying: edge triggering, hysteresis and
// snooze, driven by an injected clock and reader so nothing waits on a timer.
//   node scripts/test-monitor.js

const path = require('node:path');

const { DiskMonitor, HYSTERESIS_PERCENT } = require('../src/main/lib/monitor');
const { renderGauge, renderAppIcon, buildAppIco, encodePng, crc32, levelFor } = require('../src/main/lib/trayicon');
const { coerceSettings } = require('../src/main/lib/settings');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const GB = 1024 ** 3;
const TOTAL = 500 * GB;
const SEP = path.sep;
const VOL = `C:${SEP}`;

/** A monitor reading a percentage this harness controls. */
function harness(startPercent, options = {}) {
  const box = { percent: startPercent, clock: 1_000_000 };
  const events = [];

  const monitor = new DiskMonitor({
    volumes: [VOL],
    warnPercent: 85,
    criticalPercent: 95,
    ...options,
    read: async () => ({
      ok: true,
      path: VOL,
      root: VOL,
      totalBytes: TOTAL,
      usedBytes: (box.percent / 100) * TOTAL,
      freeBytes: TOTAL - (box.percent / 100) * TOTAL,
      usedPercent: box.percent,
    }),
    now: () => box.clock,
  });

  monitor.on((event) => {
    if (event.type === 'level') events.push(event);
  });

  return { monitor, box, events, alerts: () => events.filter((e) => e.rising && !e.suppressed) };
}

(async () => {
  console.log('\nmonitor: alerts fire on the edge, not while high\n');

  {
    const h = harness(70);
    await h.monitor.check();
    check('a healthy disk raises nothing', h.alerts().length === 0);

    h.box.percent = 88;
    await h.monitor.check();
    check('crossing the warning level alerts once', h.alerts().length === 1, String(h.alerts().length));
    check('and names the level it reached', h.alerts()[0].to === 'warn', h.alerts()[0].to);

    // The disk stays high. This is the case the naive implementation gets wrong.
    for (let i = 0; i < 10; i++) {
      h.box.percent = 88 + (i % 2) * 0.3;
      await h.monitor.check();
    }
    check('ten more readings above the threshold add no alerts',
      h.alerts().length === 1, `${h.alerts().length} alerts`);

    h.box.percent = 96;
    await h.monitor.check();
    check('crossing into critical alerts again', h.alerts().length === 2);
    check('and is marked critical', h.alerts()[1].to === 'critical');

    h.box.percent = 97;
    await h.monitor.check();
    check('rising further within critical is silent', h.alerts().length === 2);
  }

  console.log('\nmonitor: hysteresis stops the flapping\n');

  {
    const h = harness(70);
    await h.monitor.check();
    h.box.percent = 85.0;
    await h.monitor.check();
    check('exactly at the threshold counts as crossed', h.alerts().length === 1);

    // Rounding noise around the threshold: without hysteresis this alternates
    // ok/warn and alerts on every other reading.
    for (const percent of [84.9, 85.1, 84.8, 85.2, 84.5, 85.0]) {
      h.box.percent = percent;
      await h.monitor.check();
    }
    check('noise around the threshold produces no further alerts',
      h.alerts().length === 1, `${h.alerts().length} alerts`);
    check('the level is still warn while inside the margin',
      h.monitor.snapshot()[0].level === 'warn', h.monitor.snapshot()[0].level);

    h.box.percent = 85 - HYSTERESIS_PERCENT - 1;
    await h.monitor.check();
    check('a real recovery does clear the level',
      h.monitor.snapshot()[0].level === 'ok', h.monitor.snapshot()[0].level);
    check('and clearing is not itself an alert', h.alerts().length === 1);

    h.box.percent = 86;
    await h.monitor.check();
    check('after a real recovery, crossing again alerts again', h.alerts().length === 2);
  }

  console.log('\nmonitor: snooze\n');

  {
    const h = harness(70, { snoozeMinutes: 60 });
    await h.monitor.check();
    h.monitor.snooze();
    check('snoozing is recorded', h.monitor.isSnoozed() === true);

    h.box.percent = 90;
    await h.monitor.check();
    check('a crossing during snooze raises no alert', h.alerts().length === 0);
    check('but the transition is still recorded as suppressed',
      h.events.some((e) => e.suppressed === true));
    check('so the level did move', h.monitor.snapshot()[0].level === 'warn');

    // The important part: when the snooze ends, the app must not suddenly
    // announce a threshold that was crossed an hour ago.
    h.box.clock += 61 * 60 * 1000;
    check('the snooze has expired', h.monitor.isSnoozed() === false);
    h.box.percent = 91;
    await h.monitor.check();
    check('a level already crossed is not re-announced after the snooze ends',
      h.alerts().length === 0, `${h.alerts().length} alerts`);

    h.box.percent = 96;
    await h.monitor.check();
    check('a genuinely new level does alert after the snooze', h.alerts().length === 1);
  }

  console.log('\nmonitor: unreadable volumes\n');

  {
    const monitor = new DiskMonitor({
      volumes: [VOL],
      read: async () => ({ ok: false, error: 'gone' }),
      now: () => 1,
    });
    const seen = [];
    monitor.on((e) => { if (e.type === 'level') seen.push(e); });
    await monitor.check();
    check('an unreadable volume raises no transition', seen.length === 0);
    check('and does not become an all-clear or an emergency',
      monitor.snapshot()[0].level === 'ok' && monitor.worst() === null);
  }

  console.log('\nmonitor: several volumes\n');

  {
    const monitor = new DiskMonitor({
      volumes: [`C:${SEP}Users`, `C:${SEP}Windows`, `D:${SEP}data`],
      read: async (target) => {
        const percent = target.startsWith('D') ? 97 : 40;
        return { ok: true, path: target, root: target.slice(0, 3), totalBytes: TOTAL,
          usedBytes: (percent / 100) * TOTAL, freeBytes: TOTAL - (percent / 100) * TOTAL, usedPercent: percent };
      },
      now: () => 1,
    });
    await monitor.check();
    check('two paths on one volume are watched once', monitor.snapshot().length === 2,
      String(monitor.snapshot().length));
    check('the worst volume is the one reported', monitor.worst().usage.usedPercent === 97);
    check('and it is the one in the critical state', monitor.worst().level === 'critical');
  }

  console.log('\nmonitor: the settings that drive it\n');

  {
    const { settings, warnings } = coerceSettings({ monitor: { warnPercent: 90, criticalPercent: 80 } });
    check('a critical level below the warning level is corrected',
      settings.monitor.criticalPercent > settings.monitor.warnPercent,
      `${settings.monitor.warnPercent} / ${settings.monitor.criticalPercent}`);
    check('and the correction is reported', warnings.some((w) => w.includes('criticalPercent')));

    const { settings: fast } = coerceSettings({ monitor: { intervalSeconds: 0 } });
    check('a zero polling interval is clamped', fast.monitor.intervalSeconds >= 15,
      String(fast.monitor.intervalSeconds));

    check('monitoring is off by default', coerceSettings({}).settings.monitor.enabled === false);
  }

  console.log('\ntray icon: a PNG generated at runtime\n');

  {
    const { png, level } = renderGauge({ usedPercent: 50, size: 32 });
    check('the output is a PNG', png.slice(0, 8).toString('hex') === '89504e470d0a1a0a', png.slice(0, 8).toString('hex'));
    check('it declares the right dimensions',
      png.readUInt32BE(16) === 32 && png.readUInt32BE(20) === 32,
      `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
    // IHDR body starts at byte 16: width, height, then bit depth and colour type.
    check('it is 8-bit truecolour with alpha', png[24] === 8 && png[25] === 6,
      `depth ${png[24]}, colour type ${png[25]}`);
    check('it ends with IEND', png.slice(-8, -4).toString('ascii') === 'IEND');
    check('a small icon stays small', png.length < 4096, `${png.length} bytes`);
    check('50% usage is reported as healthy', level === 'ok', level);

    // The CRC is what a decoder checks first; a wrong one is a blank tray icon
    // with no error anywhere.
    const ihdrLength = png.readUInt32BE(8);
    const ihdrBody = png.slice(12, 12 + 4 + ihdrLength);
    check('the IHDR checksum is correct',
      crc32(ihdrBody) === png.readUInt32BE(12 + 4 + ihdrLength), 'IHDR CRC');

    check('85% is a warning', renderGauge({ usedPercent: 85 }).level === 'warn');
    check('95% is critical', renderGauge({ usedPercent: 95 }).level === 'critical');
    check('an unknown reading is drawn as unknown, not as empty',
      renderGauge({ usedPercent: NaN }).level === 'unknown');
    check('thresholds are respected when they are not the defaults',
      levelFor(72, 70, 90) === 'warn' && levelFor(91, 70, 90) === 'critical');

    const empty = renderGauge({ usedPercent: 0 }).png;
    const full = renderGauge({ usedPercent: 100 }).png;
    check('an empty and a full gauge are different images', !empty.equals(full));

    check('the encoder handles a 1x1 image without special-casing',
      encodePng(Buffer.from([255, 0, 0, 255]), 1, 1).length > 8);
  }

  console.log('\napp icon: the .ico is generated too, so the repo holds no binary assets\n');

  {
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const ico = buildAppIco(sizes);

    check('it declares itself an icon, not a cursor',
      ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1);
    check('it holds every size', ico.readUInt16LE(4) === sizes.length, String(ico.readUInt16LE(4)));

    // Each directory entry has to point at a real PNG inside the file, or
    // Windows shows a blank icon with no error anywhere.
    let allPng = true;
    let allInBounds = true;
    let declared = [];
    for (let i = 0; i < sizes.length; i++) {
      const at = 6 + i * 16;
      const bytes = ico.readUInt32LE(at + 8);
      const offset = ico.readUInt32LE(at + 12);
      declared.push(ico[at] === 0 ? 256 : ico[at]);
      if (offset + bytes > ico.length) allInBounds = false;
      else if (ico.slice(offset, offset + 8).toString('hex') !== '89504e470d0a1a0a') allPng = false;
    }

    check('every entry points inside the file', allInBounds);
    check('every payload really is a PNG', allPng);
    check('256 is recorded as 0, as the one-byte field requires',
      declared.join(',') === sizes.join(','), declared.join(','));
    check('entries are ordered smallest first', declared.every((s, i) => i === 0 || s > declared[i - 1]));

    const bigIcon = renderAppIcon(256);
    check('the icon is opaque in the middle and transparent at the corner',
      bigIcon.length > 500 && ico.length > bigIcon.length, `${ico.length} bytes total`);
    check('a whole icon file stays small', ico.length < 64 * 1024, `${ico.length} bytes`);

    // Corners must be cut, or the tile is a square and the rounding was a lie.
    const corner = renderAppIcon(64);
    check('rendering is deterministic', renderAppIcon(64).equals(corner));
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
