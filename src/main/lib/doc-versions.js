'use strict';

/**
 * Documents that look like versions of one document (F3).
 *
 * `Report.docx`, `Report - Copy.docx`, `Report_v2.docx`, `Report_final.docx`:
 * four files, different bytes, one piece of work. The duplicate finder next
 * door cannot see them -- their bytes differ, which is the whole point -- and
 * nothing else in the app would ever mention them.
 *
 * This reads names and nothing else. No file is opened, so it costs whatever
 * the walk already paid and can ride on a duplicate search for free.
 *
 * ## It never says more than `guess`
 *
 * A name is a very weak signal. `Report_v2.docx` may be the second draft of
 * `Report.docx` or a completely different report somebody named badly, and
 * nothing short of reading both can tell. So every row here is `guess`, raised
 * to `likely` only when two files are in the same folder and the same format,
 * and there is deliberately no "select all but the newest": a one-click delete
 * on top of a guess is exactly the false confidence this app is written
 * against.
 *
 * ## The rules were written against the names on a real disk
 *
 * 6,503 document files under `D:`, Documents, Downloads and Desktop were
 * counted before any of this was written, and three of the obvious rules turned
 * out to be wrong:
 *
 *   - `(n)` is Windows' copy suffix, but 6 of the 27 names ending that way were
 *     `... -Wiley (2018)` -- a publication year. So only a small number counts.
 *   - `v2` is a version, but 2 of the 26 names ending that way were `GPLv3` and
 *     `LGPLv3`. So it counts only after a separator.
 *   - dates are the dangerous one; see `DATE` below.
 */

const path = require('node:path');

/* -------------------------------------------------------------------------- */
/* the markers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Windows' own copy suffix, in the two languages this app speaks.
 *
 * `- Copy - Copy - Copy` is a real name on the machine this was written on, so
 * these are stripped repeatedly rather than once.
 *
 * The Vietnamese forms are here because a Vietnamese Windows writes them, and
 * they are marked as what they are: **not verified on this machine**, where no
 * file matched them. They are a short list on purpose.
 */
const COPY_MARKERS = [
  // "- Copy", "- Copy (2)", "(2)" -- the number kept small, so a year is not a copy.
  /\s*[-–]\s*copy(\s*\(\d{1,2}\))?\s*$/i,
  /\s*\((\d{1,2})\)\s*$/,
  // Vietnamese: "- Bản sao", "Bản sao của X". Unverified here.
  /\s*[-–]\s*b[aả]n\s*sao(\s*\(\d{1,2}\))?\s*$/i,
  /^b[aả]n\s*sao\s*(c[uủ]a)?\s*/i,
];

/**
 * A version marker: `_v2`, `-rev3`, ` final`, `_cuối`.
 *
 * Every one requires a separator before it, which is what keeps `GPLv3` a
 * licence rather than version 3 of something called GPL.
 */
const VERSION_MARKERS = [
  /[_\-\s.](v|ver|rev|r)\s*\.?\s*\d{1,3}\s*$/i,
  /[_\-\s](final|fin|cu[oố]i|cuoi)\s*$/i,
  /[_\-\s](draft|nh[aá]p)\s*$/i,
  /[_\-\s](new|m[oớ]i)\s*$/i,
  /[_\-\s](old|c[uũ])\s*$/i,
];

/**
 * A date in the name -- and the reason this is not simply stripped.
 *
 * The spec asks for dates to be removed along with the other suffixes. Counted
 * on a real disk, 1,755 of the 6,503 document names carry one, and removing it
 * creates 38 groups that exist *only* because it was removed. Every one of
 * those 38 was wrong:
 *
 *     Log 2026-06-13 04-11-30   and   Log 2026-09-26 04-11-30
 *     247express_hoadon_..._20221226-...  (a different invoice each time)
 *
 * A date in a document's name usually *identifies* the document -- this
 * month's report, that day's log, that invoice -- rather than versioning it.
 * So a date is removed only when the name carries some other marker as well,
 * and two names that differ by nothing but a date are never a group.
 */
const DATE = /(\b(19|20)\d{2}[-_. ]?(0[1-9]|1[0-2])[-_. ]?(0[1-9]|[12]\d|3[01])\b|\b(0[1-9]|[12]\d|3[01])[-_. ](0[1-9]|1[0-2])[-_. ](19|20)\d{2}\b)/g;

/** Extensions this is willing to call a document. */
const DOCUMENT_EXT = new Set([
  'doc', 'docx', 'docm', 'dot', 'dotx', 'rtf', 'odt', 'pages',
  'xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'ods', 'csv',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'odp', 'key',
  'pdf', 'txt', 'md', 'rst', 'tex',
]);

/** Below this a "document" is a stub, and a group of stubs is noise. */
const MIN_BYTES = 4 * 1024;

/* -------------------------------------------------------------------------- */
/* normalising                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The name with its version and copy markers taken off.
 *
 * @returns {{key: string, markers: string[], hadDate: boolean}}
 *   `key` is what two files must share to be a group; `markers` is what was
 *   removed, which the evidence quotes back so a person can see why the app
 *   put these two together.
 */
function normalise(base) {
  let text = String(base).trim();
  const markers = [];

  // Repeatedly, because "- Copy - Copy - Copy" exists.
  for (let pass = 0; pass < 8; pass++) {
    let cut = false;
    for (const re of COPY_MARKERS) {
      const found = text.match(re);
      if (!found) continue;
      markers.push(found[0].trim());
      text = text.replace(re, '').trim();
      cut = true;
    }
    for (const re of VERSION_MARKERS) {
      const found = text.match(re);
      if (!found) continue;
      markers.push(found[0].trim());
      text = text.replace(re, '').trim();
      cut = true;
    }
    if (!cut) break;
  }

  DATE.lastIndex = 0;
  const hadDate = DATE.test(text);
  DATE.lastIndex = 0;

  const tidy = (s) => s.replace(/[\s_\-.]+/g, ' ').trim().toLowerCase();

  /*
   * Two keys, because a date cannot be decided one file at a time.
   *
   * Grouping needs a key two files share, and "remove the date only when this
   * name also has a marker" is a judgement about one name: `Contract
   * 2026-01-15.docx` keeps its date and `Contract 2026-01-16 - Copy.docx`
   * loses it, and the two never meet. So each file carries both spellings and
   * `findVersions` decides -- where it can see the whole group and can ask
   * whether anything in it is marked as a version at all.
   */
  return {
    key: tidy(text),
    looseKey: tidy(text.replace(DATE, ' ')),
    markers,
    hadDate,
  };
}

/* -------------------------------------------------------------------------- */
/* grouping                                                                    */
/* -------------------------------------------------------------------------- */

const extOf = (p) => path.extname(p).slice(1).toLowerCase();

/**
 * Is a set of same-named documents actually about one piece of work?
 *
 * Run against a real disk, the plain rule -- same name, different files --
 * produced 216 sets, and 180 of them were not versions of anything: 143 copies
 * of `CHANGELOG.md`, one per package in a Dart package cache; 135 `README.md`;
 * 25 `LICENSE.txt`. 856 files in all. They share a name because the name is a
 * common one, not because somebody drafted them twice.
 *
 * What separates the real ones is that they say so. Either a file in the set
 * carries a marker -- `Do An_Final` beside `Do An_Final - Copy` -- or they sit
 * in one folder under one name with different extensions, which is one piece
 * of work exported twice: `Group 04 - OS.pptx`, `.pdf` and `.docx`.
 *
 * The same name in two folders with nothing else to go on is left alone. Where
 * those files are genuinely the same, the duplicate finder has them already,
 * and it knows rather than guesses.
 */
function worthReporting(rows) {
  if (rows.some((r) => r.markers.length > 0)) return true;
  const folders = new Set(rows.map((r) => r.folder.toLowerCase()));
  return folders.size === 1;
}

/** Which family a format belongs to, for "the same kind of document". */
function family(ext) {
  if (['doc', 'docx', 'docm', 'dot', 'dotx', 'rtf', 'odt', 'pages'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'ods', 'csv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'odp', 'key'].includes(ext)) return 'slides';
  if (ext === 'pdf') return 'pdf';
  return 'text';
}

/**
 * Group documents whose names look like versions of one another.
 *
 * @param {Array<{path, size, mtimeMs}>} files  every file the walk found
 * @param {object} [options]
 * @returns {{groups: Array, considered: number, skippedDateOnly: number}}
 */
function findVersions(files, options = {}) {
  const minBytes = options.minBytes ?? MIN_BYTES;
  const rows = [];
  let considered = 0;

  for (const file of files) {
    const ext = extOf(file.path);
    if (!DOCUMENT_EXT.has(ext) || file.size < minBytes) continue;
    considered += 1;

    const base = path.basename(file.path, path.extname(file.path));
    const { key, looseKey, markers, hadDate } = normalise(base);
    if (key === '') continue;

    // Neither key includes the folder: the whole point is to find a draft that
    // was carried to the desktop. Neither includes the extension either,
    // because `Report.docx` and `Report.pdf` are one piece of work exported
    // twice -- which the confidence rule then takes into account.
    rows.push({ ...file, base, ext, key, looseKey, markers, hadDate, folder: path.dirname(file.path) });
  }

  /*
   * Names first, then names with their dates taken off.
   *
   * A file that already belongs to a group on its exact name is not offered
   * again by the looser key, so `Report`, `Report - Copy` and `Report_v2` stay
   * one group rather than being merged with anything a date away.
   */
  const bucketBy = (list, keyName) => {
    const out = new Map();
    for (const row of list) {
      const bucket = out.get(row[keyName]);
      if (bucket) bucket.push(row);
      else out.set(row[keyName], [row]);
    }
    return out;
  };

  const groups = [];
  let skippedDateOnly = 0;
  const taken = new Set();
  const collected = [];

  let skippedCommonName = 0;

  for (const [key, bucket] of bucketBy(rows, 'key')) {
    if (bucket.length < 2) continue;
    if (!worthReporting(bucket)) {
      // Judged here and not offered to the looser pass: these have already
      // been looked at under their exact names, and letting them back in
      // would count the same set twice under two different reasons.
      skippedCommonName += 1;
      for (const row of bucket) taken.add(row);
      continue;
    }
    for (const row of bucket) taken.add(row);
    collected.push({ key, rows: bucket });
  }

  for (const [key, bucket] of bucketBy(rows.filter((r) => !taken.has(r)), 'looseKey')) {
    if (bucket.length < 2) continue;

    /*
     * These are the same only because a date came off. Unless something in
     * the set actually says "version" -- a copy suffix, a `_v2` -- they are
     * two documents rather than two drafts: this month's report, that day's
     * log, that invoice.
     *
     * Counted rather than silently dropped, because "39 sets of logs were left
     * out" is worth being able to say, and on this machine that is exactly
     * what they were.
     */
    if (bucket.every((r) => r.markers.length === 0)) {
      skippedDateOnly += 1;
      continue;
    }
    for (const row of bucket) taken.add(row);
    collected.push({ key, rows: bucket, viaDate: true });
  }

  for (const { key, rows: found, viaDate } of collected) {
    const sorted = [...found].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const folders = new Set(sorted.map((r) => r.folder.toLowerCase()));
    const families = new Set(sorted.map((r) => family(r.ext)));

    // `guess` always, and `likely` only when they are in the same folder and
    // the same kind of document -- which is the one case where a name is
    // worth much.
    const confidence = folders.size === 1 && families.size === 1 ? 'likely' : 'guess';

    groups.push({
      key,
      confidence,
      sameFolder: folders.size === 1,
      // Grouped only because a date came off, and something in it said version.
      viaDate: Boolean(viaDate),
      sameFamily: families.size === 1,
      count: sorted.length,
      bytes: sorted.reduce((n, r) => n + r.size, 0),
      // What could be freed is never asserted: these are different files, and
      // which of them is worth keeping is not a question a name can answer.
      newestAt: sorted[0].mtimeMs,
      oldestAt: sorted[sorted.length - 1].mtimeMs,
      markers: [...new Set(sorted.flatMap((r) => r.markers))],
      /*
       * Exactly one `newest`, even when several share the timestamp.
       *
       * `mtimeMs === sorted[0].mtimeMs` looked right and was not: three
       * drafts copied in one go carry one mtime between them, and the list
       * came out with two rows both labelled the newest and one labelled
       * older than them. A tie is worth knowing about on its own -- files
       * with the same timestamp were usually copied rather than drafted --
       * so it is said rather than hidden behind an arbitrary winner.
       */
      files: sorted.map((r, i) => ({
        path: r.path,
        size: r.size,
        mtimeMs: r.mtimeMs,
        ext: r.ext,
        markers: r.markers,
        newest: i === 0,
        sameTimeAsNewest: i > 0 && r.mtimeMs === sorted[0].mtimeMs,
      })),
    });
  }

  // Biggest first: a set of four 30 MB drafts is worth more attention than a
  // pair of 8 KB notes.
  groups.sort((a, b) => b.bytes - a.bytes);
  return { groups, considered, skippedDateOnly, skippedCommonName };
}

module.exports = {
  findVersions,
  normalise,
  family,
  DOCUMENT_EXT,
  COPY_MARKERS,
  VERSION_MARKERS,
  DATE,
  MIN_BYTES,
};
