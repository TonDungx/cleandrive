#!/usr/bin/env node
'use strict';

// F3: documents that look like versions of one another.
//
//   node scripts/test-doc-versions.js
//
// No disk. The rules are about names, so the tests are about names -- and the
// names that matter most are the real ones. Every "not a version" case below
// was found by counting 6,503 document files under D:, Documents, Downloads
// and Desktop before the rules were written, and each one is quoted where it
// is used.

const docs = require('../src/main/lib/doc-versions');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 28);

/** A file record in the shape the walk hands over. */
const file = (p, { size = 2 * MB, days = 0 } = {}) => ({ path: p, size, mtimeMs: NOW - days * DAY });

const keyOf = (name) => docs.normalise(name).key;
const groupsOf = (files, options) => docs.findVersions(files, options).groups;

/* -------------------------------------------------------------------------- */

function normalising() {
  console.log('\nWhat a name means once the suffixes come off:');

  check('Windows’ English copy suffix', keyOf('Report - Copy') === keyOf('Report'));
  check('and its numbered form', keyOf('Report (2)') === keyOf('Report'));
  check('applied as many times as it was applied',
    keyOf('fda-risk-provider-template - Copy - Copy - Copy') === keyOf('fda-risk-provider-template'),
    'a real name on this machine');

  check('a version suffix', keyOf('README_th_en_CA_v2') === keyOf('README_th_en_CA'), 'a real name');
  check('and a revision', keyOf('spec-rev3') === keyOf('spec'));
  check('“final”, in either language', keyOf('Do An_Final') === keyOf('Do An') && keyOf('bao cao_cuối') === keyOf('bao cao'),
    'Do An_Final is a real name');
  check('draft and its Vietnamese', keyOf('plan_draft') === keyOf('plan') && keyOf('ke hoach_nháp') === keyOf('ke hoach'));

  // Vietnamese Windows writes these. No file on this machine matched them, so
  // they are supported and said to be unverified rather than claimed.
  check('the Vietnamese copy suffix is handled [unverified here]',
    keyOf('Hop dong - Bản sao') === keyOf('Hop dong') && keyOf('Bản sao của Hop dong') === keyOf('Hop dong'));

  check('separators do not change the answer',
    keyOf('My Report') === keyOf('My_Report') && keyOf('My-Report') === keyOf('My.Report'));
  check('nor does case', keyOf('REPORT') === keyOf('report'));

  console.log('\n  …and the three rules the real names corrected:');

  // 6 of the 27 names ending in (n) were publication years.
  check('a year in brackets is not a copy suffix',
    keyOf('Operating System Concepts-Wiley (2018)') !== keyOf('Operating System Concepts-Wiley'),
    'Modern Operating Systems ... -Pearson (2024) is a real name here');
  check('but a small number still is', keyOf('Notes (3)') === keyOf('Notes'));

  // 2 of the 26 names ending in v<number> were licences.
  check('a version glued to a word is not a version',
    keyOf('GPLv3') !== keyOf('GPL') && keyOf('LGPLv3') !== keyOf('LGPL'),
    'GPLv3 and LGPLv3 are real files here');
  check('with a separator it is', keyOf('spec_v3') === keyOf('spec'));

  // A trailing number on its own: `mt19937-testset-1` and `-2` are two test
  // sets, and 1,882 names here end in one.
  check('a bare trailing number is not a version',
    keyOf('mt19937-testset-1') !== keyOf('mt19937-testset-2'),
    'they are two test sets, not two drafts');
}

function dates() {
  console.log('\nA date in a name identifies the document more often than it versions it:');

  // Measured: removing dates created 38 groups on this machine, and all 38
  // were sets of distinct logs or invoices.
  const logs = [
    file('D:\\logs\\Log 2026-06-13 04-11-30.txt'),
    file('D:\\logs\\Log 2026-09-26 04-11-30.txt'),
  ];
  const out = docs.findVersions(logs);
  check('two logs from different days are not two versions of one log',
    out.groups.length === 0, JSON.stringify(out.groups.map((g) => g.key)));
  check('and they are counted, so the screen can say how many were left out',
    out.skippedDateOnly === 1, String(out.skippedDateOnly));

  const invoices = [
    file('D:\\hd\\247express_hoadon_k22thc_00070764_20221226.pdf'),
    file('D:\\hd\\247express_hoadon_k22thc_00070764_20230115.pdf'),
  ];
  check('nor are two invoices', groupsOf(invoices).length === 0);

  // With another marker, the date is a version after all.
  const drafts = [
    file('D:\\work\\Contract 2026-01-15.docx'),
    file('D:\\work\\Contract 2026-01-16 - Copy.docx'),
  ];
  check('but a date beside a copy marker is one piece of work',
    groupsOf(drafts).length === 1, JSON.stringify(groupsOf(drafts).map((g) => g.key)));
}

function grouping() {
  console.log('\nGrouping, and how sure it is willing to be:');

  {
    const same = [
      file('D:\\work\\Report.docx', { days: 9 }),
      file('D:\\work\\Report - Copy.docx', { days: 4 }),
      file('D:\\work\\Report_v2.docx', { days: 1 }),
    ];
    const [g] = groupsOf(same);
    check('three names, one group', g && g.count === 3, g ? String(g.count) : 'none');
    check('the newest is marked, and it is the newest',
      g.files[0].newest === true && g.files[0].path.endsWith('Report_v2.docx'), g.files[0].path);
    check('same folder and same kind of document raises it to likely',
      g.confidence === 'likely', g.confidence);
    check('and the markers it removed are kept, so the row can say why',
      g.markers.length >= 2, g.markers.join(' | '));
  }

  {
    // The case the whole feature is for: a draft carried to the desktop.
    const spread = [
      file('D:\\work\\Report.docx', { days: 9 }),
      file('C:\\Users\\a\\Desktop\\Report - Copy.docx', { days: 2 }),
    ];
    const [g] = groupsOf(spread);
    check('a copy in another folder is still found', g && g.count === 2);
    check('but across folders it is only ever a guess', g.confidence === 'guess', g.confidence);
  }

  {
    const formats = [file('D:\\w\\Plan.docx'), file('D:\\w\\Plan_final.pdf')];
    const [g] = groupsOf(formats);
    check('the same work exported twice is one group', g && g.count === 2);
    check('and two formats keep it a guess', g.confidence === 'guess', g.confidence);
  }

  {
    check('a single file is not a group', groupsOf([file('D:\\w\\Alone.docx')]).length === 0);
    check('two unrelated names are not a group',
      groupsOf([file('D:\\w\\Alpha.docx'), file('D:\\w\\Beta.docx')]).length === 0);
  }

  {
    // Only documents. A photo named `IMG (1).jpg` is the duplicate finder's.
    const mixed = [
      file('D:\\p\\IMG_0001.jpg'),
      file('D:\\p\\IMG_0001 - Copy.jpg'),
      file('D:\\p\\setup.exe'),
      file('D:\\p\\setup (1).exe'),
    ];
    check('photos and programs are not documents', groupsOf(mixed).length === 0);
  }

  {
    const tiny = [file('D:\\w\\Note.txt', { size: 200 }), file('D:\\w\\Note - Copy.txt', { size: 200 })];
    check('a pair of stubs is below the floor', groupsOf(tiny).length === 0,
      `${docs.MIN_BYTES / 1024} KB floor`);
  }

  console.log('\n  …and a common filename is not a draft:');

  {
    /*
     * Run against the real disk, the plain rule found 216 sets and 180 were
     * this: 143 copies of `CHANGELOG.md`, one per package in a Dart cache;
     * 135 `README.md`, 25 `LICENSE.txt`. With this rule, 36 sets, and
     * the ones left are drafts.
     */
    const changelogs = [
      file('D:\\pub-cache\\image-4.10.1\\CHANGELOG.md'),
      file('D:\\pub-cache\\archive-4.3.0\\CHANGELOG.md'),
      file('D:\\pub-cache\\image_picker-1.2.3\\CHANGELOG.md'),
    ];
    const out = docs.findVersions(changelogs);
    check('one name shared by three packages is not three drafts',
      out.groups.length === 0, '143 files named CHANGELOG.md on the real disk, in one set');
    check('and those are counted separately from the date ones',
      out.skippedCommonName === 1 && out.skippedDateOnly === 0,
      `common ${out.skippedCommonName}, date ${out.skippedDateOnly}`);

    const logs = [file('D:\\a\\log.txt'), file('D:\\b\\log.txt'), file('C:\\c\\log.txt')];
    check('nor are three log.txt in three projects', groupsOf(logs).length === 0);
  }

  {
    // The two shapes that survive it, both real.
    const marked = [
      file('D:\\Subject\\do_an\\Do An_Final.docx'),
      file('D:\\Subject\\do_an\\bao cao mau\\Do An_Final - Copy.docx'),
    ];
    check('a marker makes it a draft even across folders',
      groupsOf(marked).length === 1, 'Do An_Final and its copy are real files here');

    const exported = [
      file('D:\\S\\Group 04 - OS.pptx'),
      file('D:\\S\\Group 04 - OS.pdf'),
      file('D:\\S\\Group 04 - OS.docx'),
    ];
    const [g] = groupsOf(exported);
    check('and one folder, one name, three formats is one piece of work',
      g && g.count === 3, 'Group 04 - OS.* are real files here');
    check('which stays a guess, because three formats is not three drafts',
      g.confidence === 'guess', g.confidence);
  }

  {
    // Nothing here is ever safe, and nothing is ever counted as reclaimable:
    // these are different files, and which to keep is not a question a name
    // can answer.
    const g = groupsOf([
      file('D:\\w\\Thesis.docx', { days: 30, size: 30 * MB }),
      file('D:\\w\\Thesis_final.docx', { days: 1, size: 31 * MB }),
    ])[0];
    check('the group carries no reclaimable figure at all',
      !('wastedBytes' in g) && !('reclaimableBytes' in g) && !('selectableBytes' in g),
      Object.keys(g).join(','));
    check('and its confidence is never better than likely',
      ['guess', 'likely'].includes(g.confidence), g.confidence);
  }
}

function timestamps() {
  console.log('\nWhich one is the newest:');

  {
    const g = groupsOf([
      file('D:\\w\\Plan.docx', { days: 9 }),
      file('D:\\w\\Plan - Copy.docx', { days: 2 }),
      file('D:\\w\\Plan_v2.docx', { days: 5 }),
    ])[0];
    check('the most recently changed comes first', g.files[0].path.endsWith('Plan - Copy.docx'),
      g.files[0].path);
    check('and exactly one of them is the newest',
      g.files.filter((f) => f.newest).length === 1,
      g.files.map((f) => `${f.newest}`).join(','));
    check('the other two are neither newest nor tied with it',
      g.files.slice(1).every((f) => !f.newest && !f.sameTimeAsNewest));
  }

  {
    /*
     * Three drafts copied in one go share a timestamp to the millisecond.
     * Found by looking at a screenshot: the flag used to be "my mtime equals
     * the largest mtime", so two rows were labelled the newest at once and a
     * third was called older than both of them.
     */
    const g = groupsOf([
      file('D:\\w\\Bao cao.docx', { days: 3 }),
      file('D:\\w\\Bao cao - Copy.docx', { days: 3 }),
      file('D:\\w\\Bao cao_final.docx', { days: 3 }),
    ])[0];
    check('with every timestamp equal, still exactly one newest',
      g.files.filter((f) => f.newest).length === 1,
      g.files.map((f) => `${f.newest}`).join(','));
    check('and the other two say they tie with it rather than trail it',
      g.files.slice(1).every((f) => f.sameTimeAsNewest === true),
      g.files.map((f) => `${f.sameTimeAsNewest}`).join(','));
  }

  {
    const g = groupsOf([
      file('D:\\w\\Note.txt', { days: 1 }),
      file('D:\\w\\Note - Copy.txt', { days: 1 }),
      file('D:\\w\\Note_old.txt', { days: 40 }),
    ])[0];
    check('a tie at the top does not make the genuinely older one tie too',
      g.files.filter((f) => f.sameTimeAsNewest).length === 1,
      g.files.map((f) => `${f.newest}/${f.sameTimeAsNewest}`).join(' '));
    check('and the set still spans the right two moments',
      g.newestAt - g.oldestAt === 39 * DAY, String((g.newestAt - g.oldestAt) / DAY));
  }
}

function ordering() {
  console.log('\nWhat comes first:');
  const out = docs.findVersions([
    file('D:\\a\\Small.docx', { size: 1 * MB }),
    file('D:\\a\\Small - Copy.docx', { size: 1 * MB }),
    file('D:\\b\\Big.pptx', { size: 40 * MB }),
    file('D:\\b\\Big_v2.pptx', { size: 41 * MB }),
  ]);
  check('two groups', out.groups.length === 2, String(out.groups.length));
  check('the bigger set of drafts is first', out.groups[0].key.includes('big'), out.groups[0].key);
  check('and every document looked at is counted', out.considered === 4, String(out.considered));
}

(() => {
  normalising();
  dates();
  grouping();
  timestamps();
  ordering();
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
