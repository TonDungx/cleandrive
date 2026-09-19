#!/usr/bin/env node
'use strict';

// Trends are where a cleaner is most tempted to invent numbers. Most of these
// tests assert that no number is produced -- that the app says "not enough
// history" where the strategy document would have printed "~12 weeks".
//   node scripts/test-history.js

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { History, growth, predictFull, folderTrends, savings, report, defaultVolume, CONFIDENCE } =
  require('../src/main/lib/history');
const { sample, volumeTargets } = require('../src/main/lib/sampler');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const DAY = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;
const T0 = Date.UTC(2026, 0, 1);

const SEP = path.sep;
const VOL = `C:${SEP}`;
const TOTAL = 500 * GB;

/** A volume series growing by `perDay` bytes, sampled daily. */
function ramp(days, perDay, startUsed, jitter = 0) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const used = startUsed + perDay * i + (jitter ? (i % 2 ? jitter : -jitter) : 0);
    out.push({ at: T0 + i * DAY, totalBytes: TOTAL, usedBytes: used, freeBytes: TOTAL - used,
      usedPercent: (used / TOTAL) * 100 });
  }
  return out;
}

(async () => {
  console.log('\nhistory: growth refuses to answer without evidence\n');

  {
    check('no measurements at all', growth([]).ok === false);
    check('one measurement is not a trend', growth(ramp(1, GB, 100 * GB)).ok === false);

    const twoPoints = growth(ramp(2, GB, 100 * GB));
    check('two points is below the minimum sample count', twoPoints.ok === false, twoPoints.reason);
    check('and it says how much history there is', /2 measurement/.test(twoPoints.reason), twoPoints.reason);

    const shortSpan = growth(ramp(5, GB, 100 * GB));
    check('five daily points still span less than a week', shortSpan.ok === false, shortSpan.reason);

    const enough = growth(ramp(14, GB, 100 * GB));
    check('two weeks of daily points is enough', enough.ok === true, enough.reason || '');
    check('the rate is right', Math.abs(enough.bytesPerDay - GB) < GB * 0.01,
      `${(enough.bytesPerDay / GB).toFixed(3)} GB/day`);
    check('the monthly figure follows from it',
      Math.abs(enough.bytesPerMonth - 30 * GB) < GB * 0.3, `${(enough.bytesPerMonth / GB).toFixed(1)} GB/month`);
    check('a clean ramp fits almost perfectly', enough.r2 > 0.99, String(enough.r2));
  }

  console.log('\nhistory: predictions that refuse themselves\n');

  {
    const flat = predictFull(ramp(30, 0, 100 * GB));
    check('a flat disk yields no prediction', flat.ok === false, flat.reason);
    check('and says the usage is not rising', /flat or falling/.test(flat.reason), flat.reason);

    const shrinking = predictFull(ramp(30, -GB, 300 * GB));
    check('a shrinking disk yields no prediction', shrinking.ok === false, shrinking.reason);

    // Noise far larger than the trend: the classic case where a naive fit still
    // returns a slope and a confident-looking answer.
    const noisy = predictFull(ramp(30, 0.05 * GB, 100 * GB, 20 * GB));
    check('an erratic disk yields no prediction', noisy.ok === false, noisy.reason);
    check('and quantifies how poorly the line fits', /% of the variation/.test(noisy.reason || ''), noisy.reason);

    const slow = predictFull(ramp(30, GB / 1000, 100 * GB));
    check('a disk that will not fill for years says so', slow.ok === false, slow.reason);
    check('and is flagged as beyond the horizon', slow.beyondHorizon === true);

    const real = predictFull(ramp(30, 2 * GB, 400 * GB));
    check('a genuine trend does produce a prediction', real.ok === true, real.reason || '');
    const expectedDays = (TOTAL - (400 * GB + 2 * GB * 29)) / (2 * GB);
    check('and the date is arithmetically right',
      Math.abs(real.days - expectedDays) < 1, `${real.days.toFixed(1)} vs ${expectedDays.toFixed(1)} days`);
    check('the prediction carries its own confidence', real.r2 > 0.99 && real.n === 30);
  }

  console.log('\nhistory: the store\n');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-history-'));
  const file = path.join(dir, 'history.json');

  {
    const h = new History(file);
    await h.load();
    check('a missing file loads empty without throwing', h.snapshots.length === 0);

    await h.addSnapshot({
      at: T0,
      volumes: { [VOL]: { ok: true, totalBytes: TOTAL, freeBytes: 100 * GB, usedBytes: 400 * GB, usedPercent: 80 } },
      scan: { root: `D:${SEP}Downloads`, totalBytes: 10 * GB, totalFiles: 500, topFolders: [{ name: 'a', size: 1 }] },
      source: 'scan',
    });

    check('a snapshot is stored', h.snapshots.length === 1);
    check('the volume is recorded under a normalised key', h.volumeRoots().length === 1, h.volumeRoots().join());
    check('the scanned folder is recorded', h.scannedRoots().length === 1);

    // Same minute: one observation, not two.
    await h.addSnapshot({
      at: T0 + 60 * 1000,
      volumes: { [VOL]: { ok: true, totalBytes: TOTAL, freeBytes: 99 * GB, usedBytes: 401 * GB, usedPercent: 80.2 } },
      source: 'launch',
    });
    check('a snapshot a minute later replaces rather than appends', h.snapshots.length === 1,
      String(h.snapshots.length));
    check('but the newer volume reading wins',
      h.volumeSeries(VOL)[0].usedBytes === 401 * GB, String(h.volumeSeries(VOL)[0].usedBytes / GB));
    check('and the earlier scan is not lost', h.snapshots[0].scan !== null);

    await h.addSnapshot({
      at: T0 + 2 * DAY,
      volumes: { [VOL]: { ok: true, totalBytes: TOTAL, freeBytes: 98 * GB, usedBytes: 402 * GB, usedPercent: 80.4 } },
      source: 'scheduled',
    });
    check('a snapshot two days later does append', h.snapshots.length === 2);

    const unreadable = await h.addSnapshot({ at: T0 + 3 * DAY, volumes: { [VOL]: { ok: false } } });
    check('a volume that could not be read is not stored as zero', unreadable === null);
  }

  // Three processes write this file -- the window, the scheduled cleanup and
  // the daily sampler -- and each used to keep its own copy and write the whole
  // thing back, so whoever wrote last erased the others. A window left open all
  // afternoon quietly deleted every measurement the scheduled tasks took.
  {
    const raceFile = path.join(dir, 'race.json');
    const usage = { ok: true, totalBytes: TOTAL, freeBytes: 100 * GB, usedBytes: 400 * GB, usedPercent: 80 };

    const seed = new History(raceFile);
    await seed.addSnapshot({ at: T0, source: 'launch', volumes: { [VOL]: usage } });

    // The window opens and loads. It holds this copy for as long as it is open.
    const windowProc = new History(raceFile);
    await windowProc.ensureLoaded();

    // A scheduled task records a measurement while that window sits there.
    const taskProc = new History(raceFile);
    await taskProc.addSnapshot({ at: T0 + 2 * DAY, source: 'daily', volumes: { [VOL]: usage } });

    // And now the window writes something of its own: a monitor tick, a scan,
    // anything at all.
    await windowProc.addSnapshot({ at: T0 + 4 * DAY, source: 'monitor', volumes: { [VOL]: usage } });

    const onDisk = JSON.parse(await fsp.readFile(raceFile, 'utf8'));
    const sources = onDisk.snapshots.map((s) => s.source);
    check('a measurement taken by a scheduled task survives the window writing after it',
      sources.includes('daily'), sources.join(', '));
    check('and the window records its own point as well', sources.includes('monitor'), sources.join(', '));
    check('with nothing recorded twice', new Set(sources).size === sources.length, sources.join(', '));
    check('in the order they were taken',
      onDisk.snapshots.every((s, i, all) => i === 0 || all[i - 1].at <= s.at));

    // The same collision one minute apart, where the half-hour rule applies:
    // the two readings become one, and neither process loses its point.
    const near = new History(raceFile);
    await near.ensureLoaded();
    const other = new History(raceFile);
    await other.addSnapshot({ at: T0 + 6 * DAY, source: 'daily', volumes: { [VOL]: usage } });
    await near.addSnapshot({ at: T0 + 6 * DAY - 60 * 1000, source: 'scheduled', volumes: { [VOL]: usage } });

    const after = JSON.parse(await fsp.readFile(raceFile, 'utf8'));
    check('two readings a minute apart stay one observation even across processes',
      after.snapshots.filter((s) => s.at >= T0 + 6 * DAY - 60 * 1000).length === 1,
      String(after.snapshots.length));
  }

  {
    const reread = new History(file);
    await reread.load();
    check('the history round-trips through disk', reread.snapshots.length === 2, String(reread.snapshots.length));

    await fsp.writeFile(file, 'not json at all', 'utf8');
    const broken = new History(file);
    await broken.load();
    check('a corrupt history reads as empty', broken.snapshots.length === 0);
  }

  console.log('\nhistory: per-folder trends stay honest\n');

  {
    const h = new History(path.join(dir, 'folders.json'));
    await h.load();

    const downloads = `D:${SEP}Downloads`;
    const users = `C:${SEP}Users`;

    // Downloads scanned three times a week apart; Users scanned once.
    for (let i = 0; i < 3; i++) {
      await h.addSnapshot({
        at: T0 + i * 7 * DAY,
        volumes: { [VOL]: { ok: true, totalBytes: TOTAL, freeBytes: 100 * GB, usedBytes: 400 * GB, usedPercent: 80 } },
        scan: { root: downloads, totalBytes: (10 + i * 2) * GB, totalFiles: 100 },
      });
    }
    await h.addSnapshot({
      at: T0 + 30 * DAY,
      volumes: { [VOL]: { ok: true, totalBytes: TOTAL, freeBytes: 100 * GB, usedBytes: 400 * GB, usedPercent: 80 } },
      scan: { root: users, totalBytes: 200 * GB, totalFiles: 900 },
    });

    const trends = folderTrends(h);
    const dl = trends.find((t) => t.root === path.resolve(downloads));
    const us = trends.find((t) => t.root === path.resolve(users));

    check('a folder scanned three times gets a rate', dl && dl.ok === true, dl ? dl.reason : 'missing');
    check('and the rate is per-folder, not the disk total',
      dl && Math.abs(dl.bytesPerMonth - (4 * GB / 14) * 30) < GB, dl ? `${(dl.bytesPerMonth / GB).toFixed(2)} GB/mo` : '');
    check('a folder scanned once gets no rate', us && us.ok === false, us ? String(us.ok) : 'missing');
    check('and is told how to get one', us && /scan it again/i.test(us.reason), us ? us.reason : '');
    check('the 200 GB folder does not outrank the growing one on size alone',
      trends[0].root === path.resolve(downloads), trends[0].root);
  }

  console.log('\nhistory: moved is not freed\n');

  {
    const h = new History(path.join(dir, 'events.json'));
    await h.load();

    await h.addEvent({ at: T0, movedBytes: 3 * GB, files: 100, source: 'scheduled' });
    await h.addEvent({ at: T0 + DAY, movedBytes: 1 * GB, files: 20, source: 'manual' });
    await h.addEvent({ at: T0 + 40 * DAY, freedBytes: 2 * GB, files: 60, source: 'purge' });

    const s = savings(h);
    check('moved bytes are totalled', s.movedBytes === 4 * GB, String(s.movedBytes / GB));
    check('freed bytes are totalled separately', s.freedBytes === 2 * GB, String(s.freedBytes / GB));
    check('the two are never added together', s.movedBytes !== s.freedBytes);
    check('months are bucketed', s.byMonth.length === 2, s.byMonth.map((m) => m.month).join(','));
    check('an event with no bytes is not recorded',
      (await h.addEvent({ movedBytes: 0, freedBytes: 0 })) === null);
  }

  console.log('\nhistory: the assembled report\n');

  {
    const h = new History(path.join(dir, 'report.json'));
    await h.load();
    for (const point of ramp(20, 2 * GB, 300 * GB)) {
      await h.addSnapshot({ at: point.at, volumes: { [VOL]: { ok: true, ...point } }, source: 'launch' });
    }

    const r = report(h);
    check('the report picks a volume', r.volume !== null, String(r.volume));
    check('the series is the whole history', r.series.length === 20, String(r.series.length));
    check('growth is reported', r.growth.ok === true);
    check('a prediction is reported', r.prediction.ok === true, r.prediction.reason || '');
    check('savings are present even with no events', r.savings.movedBytes === 0 && r.savings.freedBytes === 0);
  }

  console.log('\nhistory: which volume the chart opens on\n');

  {
    // The tab used to open on whichever volume sorted first alphabetically. On
    // the machine this was written for that was C: with a single measurement,
    // while D: had a series -- so a history with plenty of data reported "one
    // measurement so far".
    const h = new History(path.join(dir, 'choice.json'));
    await h.load();

    const thin = { totalBytes: TOTAL, freeBytes: TOTAL / 2, usedBytes: TOTAL / 2, usedPercent: 50 };
    await h.addSnapshot({ at: T0, source: 'scan', volumes: { [`C:${SEP}`]: thin } });
    for (let i = 0; i < 5; i++) {
      await h.addSnapshot({ at: T0 + (i + 1) * DAY, source: 'daily', volumes: { [`D:${SEP}`]: thin } });
    }

    const roots = h.volumeRoots();
    check('both volumes are listed', roots.length === 2, roots.join(', '));
    check('the most-measured volume is chosen, not the first alphabetically',
      /^d:/i.test(defaultVolume(h, roots)), String(defaultVolume(h, roots)));

    const r = report(h);
    check('so the report opens on a series worth plotting', r.series.length === 5, String(r.series.length));
    check('and an explicit choice still wins', report(h, { volumeRoot: `C:${SEP}` }).series.length === 1);
  }

  console.log('\nsampler: measurements that do not depend on anyone opening the app\n');

  {
    const h = new History(path.join(dir, 'sampled.json'));
    await h.load();

    const first = await sample({ history: h, source: 'launch', extraTargets: [dir] });
    check('a measurement is taken without a scan', first.ok === true, first.error || '');
    check('and recorded', first.recorded === true && h.snapshots.length === 1);
    check('with the source it was taken for', h.snapshots[0].source === 'launch', h.snapshots[0].source);
    check('and no scan attached, because nothing was scanned', h.snapshots[0].scan === null);

    // Pressing "Measure now" twice must not manufacture a trend: the store
    // keeps one point per half hour, and the sampler reports when that happened
    // rather than letting the UI claim a new measurement.
    const second = await sample({ history: h, source: 'manual', extraTargets: [dir] });
    check('a second measurement inside half an hour replaces rather than appends',
      h.snapshots.length === 1, String(h.snapshots.length));
    check('and says so', second.coalesced === true);

    const targets = volumeTargets({
      settings: { monitor: { volumes: [`E:${SEP}data`] }, autoClean: { roots: [`F:${SEP}temp`] } },
      history: h,
      extraTargets: [dir],
    });
    check('the configured monitor volume is measured', targets.includes(`E:${SEP}data`), targets.join(', '));
    check('so is a cleanup root', targets.includes(`F:${SEP}temp`), targets.join(', '));
    check('and every volume already in the history, so a series is never abandoned',
      targets.some((t) => /^[a-z]:/i.test(t)), targets.join(', '));
    check('nothing empty is passed to statfs', targets.every((t) => typeof t === 'string' && t.trim() !== ''));
  }

  console.log('\nhistory: the confidence thresholds are not silently relaxed\n');

  check('at least four points are required', CONFIDENCE.minPoints >= 4, String(CONFIDENCE.minPoints));
  check('at least a week of history is required', CONFIDENCE.minSpanDays >= 7, String(CONFIDENCE.minSpanDays));
  check('a fit must explain at least half the variation', CONFIDENCE.minR2 >= 0.5, String(CONFIDENCE.minR2));

  await fsp.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
