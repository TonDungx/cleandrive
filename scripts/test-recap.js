#!/usr/bin/env node
'use strict';

// G3: the weekly or monthly summary, and the many more occasions on which it
// says nothing.
//
//   node scripts/test-recap.js
//
// No Electron and no disk. `recap.js` takes a history and some settings and
// answers "is one due, and what would it say", so every rule here is checked
// against a history written by hand -- including the ones that matter most,
// which are the refusals.

const historyLib = require('../src/main/lib/history');
const settingsLib = require('../src/main/lib/settings');
const recap = require('../src/main/recap');
const { render } = require('../src/i18n');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const DAY = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;
const NOW = Date.UTC(2026, 8, 28, 12, 0);

/**
 * A history, as the daily measurement builds one. Constructed data.
 *
 * `points` readings ending now, one a day, with the drive filling by
 * `growthPerDay`. `scans` adds folder measurements, which is what a summary
 * needs before it can name a folder.
 */
function historyWith({ points = 10, growthPerDay = 0.5 * GB, spanDays = null, scans = [] } = {}) {
  const total = 500 * GB;
  const span = spanDays === null ? points - 1 : spanDays;
  const snapshots = [];
  for (let i = 0; i < points; i++) {
    const at = NOW - (span - (span * i) / Math.max(1, points - 1)) * DAY;
    const used = 300 * GB + growthPerDay * ((at - (NOW - span * DAY)) / DAY);
    snapshots.push({
      at: Math.round(at),
      source: 'daily',
      volumes: {
        'c:\\': {
          totalBytes: total,
          freeBytes: total - used,
          usedBytes: used,
          usedPercent: (used / total) * 100,
        },
      },
      scan: null,
    });
  }
  for (const s of scans) snapshots.push(s);
  snapshots.sort((a, b) => a.at - b.at);
  return { snapshots, ...historyMethods(snapshots) };
}

/** The three methods `recap.js` reaches for, borrowed from the real class. */
function historyMethods(snapshots) {
  const proto = historyLib.History.prototype;
  const self = { snapshots };
  for (const name of ['volumeRoots', 'volumeSeries', 'scannedRoots', 'folderSeries']) {
    self[name] = proto[name].bind(self);
  }
  return self;
}

function folderScan(root, at, bytes) {
  return {
    at,
    source: 'scan',
    volumes: {},
    scan: { root, totalBytes: bytes, totalFiles: 100, byCategory: {}, topFolders: [] },
  };
}

const settingsWith = (trends) => settingsLib.coerceSettings({ trends }).settings;

/* -------------------------------------------------------------------------- */

function whenItSaysNothing() {
  console.log('\nIt refuses far more often than it speaks:');

  {
    const r = recap.consider({ history: historyWith(), settings: settingsWith({}), now: NOW });
    check('switched off by default, so nothing is due', r.due === false);
    check('and it says which refusal it was', /switched off/i.test(render(r.reason)), render(r.reason));
  }

  {
    // The Trends rule: four measurements over at least a week. Three is not
    // enough however far apart they are.
    const r = recap.consider({
      history: historyWith({ points: 3, spanDays: 20 }),
      settings: settingsWith({ recap: 'weekly' }),
      now: NOW,
    });
    check('three measurements is not a trend, whatever the span', r.due === false, render(r.reason));
  }

  {
    // Four measurements, but all inside a day.
    const r = recap.consider({
      history: historyWith({ points: 6, spanDays: 0.5 }),
      settings: settingsWith({ recap: 'weekly' }),
      now: NOW,
    });
    check('six measurements in half a day is not a week of history', r.due === false, render(r.reason));
  }

  {
    const r = recap.consider({
      history: { snapshots: [], ...historyMethods([]) },
      settings: settingsWith({ recap: 'weekly' }),
      now: NOW,
    });
    check('no measurements at all is not an error, it is silence', r.due === false, render(r.reason));
  }

  {
    // Switched on today, with a long history behind it: the first summary
    // still waits a period rather than arriving at once.
    const r = recap.consider({
      history: historyWith({ points: 30, spanDays: 29 }),
      settings: settingsWith({ recap: 'monthly', recapLastAt: 0 }),
      now: NOW,
    });
    check('a monthly summary needs a month of measurements behind it', r.due === true,
      r.due ? '' : render(r.reason));

    const young = recap.consider({
      history: historyWith({ points: 10, spanDays: 9 }),
      settings: settingsWith({ recap: 'monthly', recapLastAt: 0 }),
      now: NOW,
    });
    check('and nine days of them is not a month', young.due === false, render(young.reason));
  }

  {
    // One was shown yesterday.
    const r = recap.consider({
      history: historyWith({ points: 30, spanDays: 29 }),
      settings: settingsWith({ recap: 'weekly', recapLastAt: NOW - 1 * DAY }),
      now: NOW,
    });
    check('one a week means one a week', r.due === false, render(r.reason));

    const later = recap.consider({
      history: historyWith({ points: 30, spanDays: 29 }),
      settings: settingsWith({ recap: 'weekly', recapLastAt: NOW - 8 * DAY }),
      now: NOW,
    });
    check('and eight days later there is another', later.due === true, later.due ? '' : render(later.reason));
  }

  {
    // A clock that went backwards, or a settings file edited by hand.
    const settings = settingsWith({ recap: 'weekly', recapLastAt: NOW + 365 * DAY });
    check('a last-shown time from the future is clamped, not obeyed',
      settings.trends.recapLastAt <= Date.now(), String(settings.trends.recapLastAt));
  }

  {
    const settings = settingsWith({ recap: 'fortnightly' });
    check('an unknown frequency falls back to off', settings.trends.recap === 'off');
    check('and the file is told', settingsLib.coerceSettings({ trends: { recap: 'fortnightly' } })
      .warnings.some((w) => /trends\.recap/.test(w)));
  }

  check('the settings and this module agree about the frequencies',
    recap.KINDS.join(',') === 'off,weekly,monthly', recap.KINDS.join(','));
}

function whatItSays() {
  console.log('\nWhen it does speak:');

  const history = historyWith({ points: 30, spanDays: 29, growthPerDay: 0.2 * GB });
  const r = recap.consider({
    history,
    settings: settingsWith({ recap: 'monthly', recapLastAt: NOW - 30 * DAY }),
    now: NOW,
  });
  check('a month of daily measurements is enough', r.due === true, r.due ? '' : render(r.reason));
  if (!r.due) return;

  const s = r.summary;
  check('it names the drive the chart would open on', s.volume === 'c:\\', s.volume);
  check('and how much it changed over the period', s.changeBytes > 5 * GB && s.changeBytes < 7 * GB,
    `${(s.changeBytes / GB).toFixed(1)} GB`);
  check('the period is the period, not the whole history', s.days >= 27 && s.days <= 28, `${s.days} days`);
  check('and it carries how full the drive is now', s.usedPercent > 0 && s.freeBytes > 0,
    `${s.usedPercent.toFixed(1)}% / ${(s.freeBytes / GB).toFixed(0)} GB`);

  const words = recap.wording(s);
  const text = `${render(words.title)} ${render(words.body)}`;
  check('the sentence says the drive and the amount', /C:/.test(text) && /GB/.test(text), text);
  // Everything a person reads is formatted: `render()` substitutes what it is
  // given, so a raw byte count would go on screen exactly as it is.
  check('no raw byte count or unrounded percentage reaches the screen',
    !/\d{7,}/.test(text) && !/\d\.\d{3,}/.test(text), text);
  check('and the drive is spelled the way a person writes it', /C:\\/.test(text) && !/c:\\/.test(text), text);
  check('with nothing scanned, it names no folder', words.named === null);

  /*
   * No upsell, ever. A summary that arrives once a month and tries to sell
   * something is a summary people switch off -- and then the one that mattered
   * never arrives either.
   */
  const selling = /\b(pro|upgrade|unlock|buy|trial|premium|licen[cs]e)\b/i;
  check('and it never tries to sell anything', !selling.test(text), text);
}

function namingFolders() {
  console.log('\nNaming a folder needs scans of that folder:');

  const scans = [
    folderScan('D:\\Downloads', NOW - 28 * DAY, 4 * GB),
    folderScan('D:\\Downloads', NOW - 1 * DAY, 6.5 * GB),
    folderScan('D:\\Music', NOW - 28 * DAY, 2 * GB),
    folderScan('D:\\Music', NOW - 1 * DAY, 2.05 * GB),
  ];
  const r = recap.consider({
    history: historyWith({ points: 30, spanDays: 29, scans }),
    settings: settingsWith({ recap: 'monthly', recapLastAt: NOW - 30 * DAY }),
    now: NOW,
  });
  check('a summary is due', r.due === true, r.due ? '' : render(r.reason));
  if (!r.due) return;

  const names = r.summary.folders.map((f) => f.root);
  check('the folder that grew is named', names.includes('D:\\Downloads'), names.join(', '));
  check('the one that barely moved is not', !names.includes('D:\\Music'),
    `50 MB is under the ${(recap.MIN_FOLDER_BYTES / 1024 ** 2).toFixed(0)} MB floor`);
  check('and at most two are named, because this is one sentence',
    r.summary.folders.length <= recap.NAMED_FOLDERS, String(r.summary.folders.length));

  const words = recap.wording(r.summary);
  check('the sentence names it', /Downloads/.test(render(words.named)), render(words.named));

  // A folder scanned once has no trend, and must not be named as though it had.
  const once = recap.consider({
    history: historyWith({
      points: 30,
      spanDays: 29,
      scans: [folderScan('D:\\Videos', NOW - 2 * DAY, 40 * GB)],
    }),
    settings: settingsWith({ recap: 'monthly', recapLastAt: NOW - 30 * DAY }),
    now: NOW,
  });
  check('a folder scanned once is never named', once.due && once.summary.folders.length === 0,
    once.due ? JSON.stringify(once.summary.folders) : 'not due');
}

function shrinking() {
  console.log('\nA disk that emptied is worth saying too:');
  const r = recap.consider({
    history: historyWith({ points: 30, spanDays: 29, growthPerDay: -0.3 * GB }),
    settings: settingsWith({ recap: 'monthly', recapLastAt: NOW - 30 * DAY }),
    now: NOW,
  });
  check('a summary is due', r.due === true, r.due ? '' : render(r.reason));
  if (!r.due) return;
  check('the change is negative', r.summary.changeBytes < 0, `${(r.summary.changeBytes / GB).toFixed(1)} GB`);
  const text = render(recap.wording(r.summary).body);
  check('and the sentence says it went down, not that it grew by a minus',
    /down/i.test(text) && !/-/.test(text.replace(/[^\d-]/g, '')), text);
}

function recording() {
  console.log('\nOnce shown, it is written down:');
  const patch = recap.recordSent(NOW);
  check('the patch sets only the time it was shown',
    JSON.stringify(patch) === JSON.stringify({ trends: { recapLastAt: NOW } }), JSON.stringify(patch));
  const settings = settingsLib.coerceSettings({ trends: { recap: 'weekly', recapLastAt: NOW - DAY } }).settings;
  check('and the settings keep it', settings.trends.recapLastAt === NOW - DAY);
}

(() => {
  whenItSaysNothing();
  whatItSays();
  namingFolders();
  shrinking();
  recording();
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
