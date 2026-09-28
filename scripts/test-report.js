#!/usr/bin/env node
'use strict';

// G2: one self-contained HTML file, and the private mode that decides what is
// in it.
//
//   node scripts/test-report.js
//
// Two halves, neither needing Electron. The escaping, because every value in
// a report came off somebody's disk and a folder may legally be called
// `</script><img src=x onerror=...>`. And the redaction, because "private
// mode" is a claim about a file and the file carries the data twice -- once
// rendered and once as JSON -- so both have to be checked.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const html = require('../src/main/report/html');
const { redact, Pseudonyms } = require('../src/main/report/redact');
const collect = require('../src/main/report/collect');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** The words, as `ipc.js` passes them. English, since that is what `t` falls back to. */
const T = {
  title: 'CleanDrive report',
  madeBy: 'Made by',
  footer: 'Every figure here was measured by CleanDrive.',
  privateOn: 'Private mode: folder and file names have been replaced.',
  volumes: 'Drives', noVolumes: 'No drive could be measured.',
  system: 'System breakdown', noSystem: 'Not measured in this session.',
  folders: 'Folders scanned', noFolders: 'No folder has been scanned yet.',
  trends: 'Over time', noTrends: 'Not enough readings yet.',
  diff: 'What changed', noDiff: 'Two comparable scans are needed.',
  actions: 'What CleanDrive did', noActions: 'Nothing has been done yet.',
  actionsNote: 'From the action journal.',
  drive: 'Drive', fileSystem: 'Format', total: 'Total', free: 'Free', used: 'Used',
  full: 'full', of: 'of', row: 'Row', size: 'Size', note: 'Note',
  systemDrive: 'Drive', measured: 'measured', notElevated: 'without administrator rights',
  folder: 'Folder', files: 'Files', scanned: 'Scanned',
  growth: 'Growing by', perMonth: 'per month', noGrowth: 'Not enough readings to say.',
  readings: 'readings', at: 'When', from: 'From',
  whereChanged: 'Where it changed', filesChanged: 'Files', change: 'Change', what: 'What', file: 'File',
  items: 'items', andMore: 'and {n} more',
  kinds: { recycle: 'Moved to the Recycle Bin', quarantine: 'Moved to another drive', restore: 'Put back' },
};

/*
 * Two nasty names, and the difference between them matters.
 *
 * `REAL` is what a disk can actually hand over. Measured on this machine:
 * Windows accepts `&` and `'` in a file name and refuses `"` and `<`. Both of
 * the accepted ones break a page that does not escape -- `&` swallows what
 * follows it as an entity, `'` ends a single-quoted attribute -- so this is
 * not a hypothetical.
 *
 * `NASTY` cannot come from a file name, because Windows refuses those
 * characters. It can still reach the report: an error message from a tool, a
 * path from a share served by something that is not Windows, a value
 * hand-edited into settings.json. It is here because escaping is either right
 * or wrong, and the strongest string is the one that shows which.
 */
const REAL = "Tom & Jerry's plan.txt";
const NASTY = '</script><img src=x onerror=alert(1)><b foo="bar">&amp;';

function sampleData(over = {}) {
  return {
    app: 'CleanDrive',
    version: '0.2.0',
    at: Date.UTC(2026, 8, 28, 9, 0),
    machine: 'TEST-PC',
    lang: 'en',
    private: false,
    sections: [...collect.SECTIONS],
    volumes: [
      { root: 'C:\\', label: null, fileSystem: 'NTFS', totalBytes: 476 * GB, freeBytes: 40 * GB, usedPercent: 91.6 },
      { root: 'D:\\', label: null, fileSystem: 'NTFS', totalBytes: 466 * GB, freeBytes: 166 * GB, usedPercent: 64.4 },
    ],
    system: {
      drive: 'C:\\', at: Date.UTC(2026, 8, 28, 8, 0), elevated: true, totalBytes: 436 * GB,
      rows: [{ key: 'profile', label: 'Your profile', bytes: 210 * GB, path: 'C:\\Users\\somebody', note: null }],
    },
    folders: [
      { root: 'D:\\personal_projects', bytes: 6 * GB, files: 15518, at: Date.UTC(2026, 8, 27), samples: 4 },
      { root: `D:\\${NASTY}`, bytes: 2 * GB, files: 12, at: Date.UTC(2026, 8, 26), samples: 2 },
    ],
    trends: {
      volume: 'C:\\',
      volumes: ['C:\\', 'D:\\'],
      series: [
        { at: Date.UTC(2026, 8, 1), usedPercent: 88.0, freeBytes: 57 * GB, totalBytes: 476 * GB, source: 'scan' },
        { at: Date.UTC(2026, 8, 14), usedPercent: 89.9, freeBytes: 48 * GB, totalBytes: 476 * GB, source: 'monitor' },
        { at: Date.UTC(2026, 8, 28), usedPercent: 91.6, freeBytes: 40 * GB, totalBytes: 476 * GB, source: 'scheduled' },
      ],
      growth: { ok: true, bytesPerMonth: 8 * GB },
      prediction: null,
      folders: [],
      savings: null,
    },
    diff: {
      root: 'D:\\personal_projects',
      fromAt: Date.UTC(2026, 8, 21), toAt: Date.UTC(2026, 8, 28), days: 7, confidence: 'strong',
      beforeBytes: 5 * GB, afterBytes: 6 * GB, deltaBytes: 1 * GB,
      places: [{ path: 'D:\\personal_projects\\cleandrive', deltaBytes: 900 * MB, beforeBytes: 0, afterBytes: 900 * MB }],
      files: [{ path: `D:\\personal_projects\\${NASTY}.bin`, kind: 'appeared', bytes: 500 * MB }],
      filesRefused: null,
    },
    actions: {
      sessions: [
        {
          id: 's_00000001', kind: 'recycle', at: Date.UTC(2026, 8, 27), source: 'manual',
          count: 2, bytes: 3 * MB, freedOnSource: 0,
          items: [
            { path: 'C:\\Users\\somebody\\Downloads\\old.tmp', size: 2 * MB, to: null },
            { path: `C:\\Users\\somebody\\Downloads\\${REAL}`, size: 1 * MB, to: null },
            { path: `C:\\Users\\somebody\\Downloads\\${NASTY}`, size: 1 * MB, to: null },
          ],
        },
      ],
    },
    ...over,
  };
}

/* -------------------------------------------------------------------------- */

function escaping() {
  console.log('\nEvery value came off a disk, so every value is escaped:');

  const page = html.buildReport(sampleData(), T);

  check('the page is a complete HTML document',
    page.startsWith('<!doctype html>') && page.trimEnd().endsWith('</html>'));

  // The one sequence that ends a script element, wherever it appears.
  check('no raw </script> survives anywhere in the file',
    !/<\/script[\s>]/i.test(page.replace(/<\/script>\s*<\/body>/i, '')),
    'the only closing script tag is the real one at the end');

  check('the nasty folder name is not markup in the page',
    !page.includes('<img src=x') && page.includes('&lt;img src=x'),
    'it appears escaped, and only escaped');

  // The one a real disk can hand over. In the markup it must be escaped; in
  // the data block it must not be, because `<script>` is a raw-text element
  // where `&` is not an entity and the value has to come back out unchanged.
  const upToData = page.slice(0, page.indexOf('<script type="application/json"'));
  check('a name a disk can really hold is escaped in the markup',
    upToData.includes('Tom &amp; Jerry&#39;s plan.txt') && !upToData.includes('Tom & Jerry'),
    'unescaped, the & would eat what follows it and the apostrophe would end an attribute');

  check('exactly one script element, and it is not a script type',
    (page.match(/<script/g) || []).length === 1 && page.includes('<script type="application/json"'));

  check('nothing is fetched: no src, href, @import or url()',
    !/<script[^>]+src=/i.test(page) && !/<link/i.test(page) && !/@import/i.test(page) && !/url\(/i.test(page),
    'a report has to open on a machine with no network');

  // Split the file: markup, and the data block. The rules are different.
  // `onerror=` legitimately appears inside the JSON, as the text of a folder's
  // name -- what matters there is that the `<` before it is `<`, so there
  // is no tag for an attribute to be on.
  const dataAt = page.indexOf('<script type="application/json"');
  const markup = page.slice(0, dataAt);
  const dataBlock = page.slice(dataAt);

  check('the markup carries no event handler attribute',
    !/\son[a-z]+\s*=/i.test(markup.replace(/&lt;[^&]*?&gt;/g, '')));
  check('and the data block carries no raw angle bracket at all',
    !/[<>]/.test(dataBlock.slice(dataBlock.indexOf('>') + 1, dataBlock.lastIndexOf('</script>'))),
    'every one is \\u003c or \\u003e, so nothing in it can start a tag');

  /* -- the embedded data reads back -- */

  const start = page.indexOf('<script type="application/json"');
  const open = page.indexOf('>', start) + 1;
  const close = page.indexOf('</script>', open);
  let parsed = null;
  try {
    parsed = JSON.parse(page.slice(open, close));
  } catch (err) {
    check('the embedded JSON parses', false, err.message);
  }
  if (parsed) {
    check('the embedded JSON parses', true);
    check('and it is the data that was rendered, byte for byte',
      parsed.folders[1].root === `D:\\${NASTY}`,
      'the escaping is in the markup, not in the values');
    check('the whole report is reconstructable from it',
      parsed.volumes.length === 2 && parsed.trends.series.length === 3 && parsed.actions.sessions.length === 1);
  }

  /* -- the sections that were asked for, and only those -- */

  const few = html.buildReport(sampleData({ sections: ['volumes'] }), T);
  check('only the chosen sections are rendered',
    few.includes(T.volumes) && !few.includes(T.actions) && !few.includes(T.trends));

  const none = html.buildReport(sampleData({ sections: ['trends'], trends: null }), T);
  check('a section with no data says so rather than showing nothing',
    none.includes(T.noTrends), 'the gap is named');
  check('and never prints a zero in place of an answer', !/>0 B</.test(none));
}

function charts() {
  console.log('\nThe chart is drawn, not described:');

  const data = sampleData();
  const page = html.buildReport(data, T);
  check('an SVG is inline in the page', page.includes('<svg class="chart"'));
  check('and it has a line through every reading',
    (page.match(/<polyline class="line" points="([^"]*)"/) || [, ''])[1].split(' ').length === 3);
  check('it is named for a reader who cannot see it', /<svg class="chart"[^>]*aria-label="[^"]+"/.test(page));

  // Two readings a tenth of a point apart must not be drawn as a cliff.
  const flat = html.chart([
    { at: 1, usedPercent: 50.0 },
    { at: 2, usedPercent: 50.1 },
  ]);
  const ys = flat
    .match(/<polyline class="line" points="([^"]+)"/)[1]
    .split(' ')
    .map((p) => Number(p.split(',')[1]));
  check('a tenth of a point is drawn as a tenth of a point, not a cliff',
    Math.abs(ys[0] - ys[1]) < 10, `${Math.abs(ys[0] - ys[1]).toFixed(1)}px apart`);

  check('one reading is not a trend, and draws nothing', html.chart([{ at: 1, usedPercent: 50 }]) === '');

  /*
   * A reading with no percentage in it.
   *
   * A history file written by an older build, or edited by hand, is exactly
   * the sort of thing a report is asked to describe, and one unusable row must
   * not take the page down with it.
   */
  check('a reading with nothing to plot is dropped rather than thrown over',
    html.chart([{ at: 1, usedPercent: 50 }, { at: 2 }, { at: 3, usedPercent: 52 }]).includes('<polyline'));
  check('and when too few are left, there is no chart rather than an exception',
    html.chart([{ at: 1, usedPercent: 50 }, { at: 2, freeBytes: 10 }]) === '');

  const broken = html.buildReport(
    sampleData({
      sections: ['trends'],
      trends: { volume: 'C:\\', volumes: [], series: [{ at: 1 }, { at: 2 }], growth: null, folders: [], savings: null },
    }),
    { ...T, noChart: 'Could not be drawn.' }
  );
  check('the section still renders, and says why there is no line',
    broken.includes('Could not be drawn.') && !broken.includes('<svg'),
    'the readings are still in the table below it');
}

function privateMode() {
  console.log('\nPrivate mode, which has to be true of the whole file:');

  const data = sampleData();
  const hidden = redact(data, { folderWord: 'Folder', fileWord: 'File', driveWord: 'Drive' });

  check('the input is not modified', data.folders[0].root === 'D:\\personal_projects');
  check('the computer’s name goes too, because it names somebody',
    hidden.machine === null && data.machine === 'TEST-PC');
  check('a folder becomes a generic name', /^D:\\Folder \d+$/.test(hidden.folders[0].root), hidden.folders[0].root);
  check('the drive letter is kept, because it names nobody',
    hidden.volumes[0].root === 'C:\\' && hidden.folders[0].root.startsWith('D:\\'));
  check('a file keeps its extension and loses its name',
    /\\File \d+\.bin$/.test(hidden.diff.files[0].path), hidden.diff.files[0].path);
  check('and no part of the real name survives',
    !hidden.diff.files[0].path.includes('script') && !hidden.actions.sessions[0].items[1].path.includes('img'),
    hidden.actions.sessions[0].items[1].path);

  // The same folder must read as the same folder wherever it appears, or the
  // report stops saying anything about it.
  check('one folder has one name throughout',
    hidden.diff.root === hidden.folders[0].root,
    `${hidden.diff.root} vs ${hidden.folders[0].root}`);
  check('and a folder inside it reads as inside it',
    hidden.diff.places[0].path.startsWith(`${hidden.diff.root}\\`),
    hidden.diff.places[0].path);

  /* -- the JSON is the redacted data, not a second copy of the real one -- */

  const page = html.buildReport(hidden, T);
  check('the page says private mode is on', page.includes(T.privateOn));
  check('no real folder name is anywhere in the file, JSON included',
    !page.includes('personal_projects') && !page.includes('somebody') && !page.includes('Downloads'),
    'this is the check that makes the claim true');

  const start = page.indexOf('<script type="application/json"');
  const parsed = JSON.parse(page.slice(page.indexOf('>', start) + 1, page.indexOf('</script>', start)));
  check('the embedded data is the redacted data', parsed.private === true &&
    !JSON.stringify(parsed).includes('personal_projects'));

  /* -- and the default -- */

  check('a report naming files defaults to private', collect.namesFiles(['volumes', 'actions']) === true);
  check('one that only names folders does not', collect.namesFiles(['volumes', 'trends', 'folders']) === false);
  check('the diff section counts as naming files', collect.namesFiles(['diff']) === true);
}

function pseudonyms() {
  console.log('\nThe pseudonyms themselves:');
  const names = new Pseudonyms();

  const a = names.folder('D:\\work\\projects\\alpha');
  const b = names.folder('D:\\work\\projects\\beta');
  check('two folders side by side get two names', a !== b, `${a} / ${b}`);
  check('and they share their parent', a.slice(0, a.lastIndexOf('\\')) === b.slice(0, b.lastIndexOf('\\')));
  check('asking twice gives the same name', names.folder('D:\\work\\projects\\alpha') === a);
  check('case does not make a second folder', names.folder('d:\\WORK\\Projects\\Alpha') === a);

  const unc = names.folder('\\\\NAS\\family-photos\\2019');
  check('a share name is replaced, because somebody chose it', !unc.includes('NAS') && !unc.includes('family'), unc);

  check('a drive root stays a drive root', names.drive('C:\\') === 'C:\\' && names.drive('c:') === 'C:\\');
  const f = names.file('D:\\work\\projects\\alpha\\secret plan.docx');
  check('a file sits inside its folder’s pseudonym', f.startsWith(`${a}\\`) && f.endsWith('.docx'), f);
}

async function onDisk() {
  console.log('\nWritten out, and read back:');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-report-'));
  try {
    const file = path.join(dir, 'report.html');
    const page = html.buildReport(sampleData(), T);
    await fsp.writeFile(file, page, 'utf8');
    const back = await fsp.readFile(file, 'utf8');
    check('what was written is what was built', back === page);
    check('and it is a size a person can send', back.length < 2 * 1024 * 1024, `${(back.length / 1024).toFixed(0)} KB`);
    check('it declares its encoding, so the accents survive', back.includes('<meta charset="utf-8">'));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

(async () => {
  escaping();
  charts();
  privateMode();
  pseudonyms();
  await onDisk();
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
