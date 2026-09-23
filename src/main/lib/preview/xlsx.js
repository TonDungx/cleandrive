'use strict';

const { scan, attr } = require('./xml');
const { readRels } = require('./ooxml');

/**
 * Reading an Excel workbook.
 *
 * ## The thing this format gets wrong that everything else gets right
 *
 * A date in a spreadsheet is not stored as a date. It is stored as the number
 * of days since the last day of 1899, and the only thing that makes it a date
 * rather than the number 45678 is a formatting rule, kept in a different part
 * of the archive, reached through two levels of indirection. A reader that
 * ignores that shows a column of five-digit numbers where the invoice dates
 * should be -- which is exactly what the first version of this did.
 *
 * Worse, the epoch is wrong on purpose. Lotus 1-2-3 believed 1900 was a leap
 * year, Excel copied the bug for compatibility in 1985 and has been unable to
 * fix it since, so serial 60 is the 29th of February 1900, a day that did not
 * happen. Every conversion here is written against day zero being the 30th of
 * December 1899, which is the offset that makes the bug cancel out for every
 * date after March 1900 -- that is, for every date anybody has in a file.
 *
 * ## What is read and what is not
 *
 * Read: sheet names and order, cell values, shared strings, whether a value is
 * a date, a percentage, a boolean or an error, merged ranges, column widths.
 *
 * Not read: formulas as formulas. Excel caches the last computed result beside
 * every formula, and that cached value is what the file's author last saw. It
 * is also the only honest thing to show, because evaluating the formulas would
 * mean implementing several hundred worksheet functions and would produce
 * numbers that differ from the ones in the file.
 *
 * Also not read: charts, conditional formatting, colours, pivot tables.
 */

/** A preview, not a spreadsheet program. These bound the table that reaches the window. */
const MAX_SHEETS = 40;
const MAX_ROWS = 2000;
const MAX_COLS = 80;
const MAX_CELL_CHARS = 2000;

/** Days between Excel's day zero (30 Dec 1899) and the Unix epoch. */
const EPOCH_DAYS = 25569;
/** And the offset of the 1904 system some Mac-authored workbooks still use. */
const DATE_1904_DAYS = 1462;

/**
 * Number formats Excel builds in, by id.
 *
 * Only the ones that change how a value should be read are listed. The rest
 * are decoration, and a number shown without its thousands separators is still
 * the number.
 */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 22]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 45, 46, 47]);
const BUILTIN_PERCENT = new Set([9, 10]);

function readXlsx(zip) {
  const workbookPart = zip.read('xl/workbook.xml');
  if (!workbookPart) {
    const err = new Error('xlsx: no xl/workbook.xml');
    err.code = 'NOT_AN_XLSX';
    throw err;
  }

  const rels = readRels(zip, 'xl/workbook.xml');
  const { sheets, date1904 } = readWorkbook(workbookPart.toString('utf8'), rels);
  const shared = readSharedStrings(zip);
  const formats = readStyles(zip);

  const out = [];
  let truncated = sheets.length > MAX_SHEETS;

  for (const sheet of sheets.slice(0, MAX_SHEETS)) {
    const part = sheet.part && zip.read(sheet.part);
    if (!part) {
      out.push({ name: sheet.name, hidden: sheet.hidden, rows: [], cols: [], merges: [], missing: true });
      continue;
    }
    const read = readSheet(part.toString('utf8'), { shared, formats, date1904 });
    if (read.truncated) truncated = true;
    out.push({ name: sheet.name, hidden: sheet.hidden, ...read });
  }

  return { sheets: out, truncated };
}

/* -------------------------------------------------------------------------- */
/* the workbook: which sheets, in which order                                  */
/* -------------------------------------------------------------------------- */

/*
 * The order sheets appear in `xl/workbook.xml` is the order of the tabs, and it
 * is not the order of the files in the archive -- `sheet3.xml` is routinely the
 * first tab. Reading the directory instead of the workbook gets the tabs in
 * whatever order somebody last saved them in, which looks like data loss.
 */
function readWorkbook(source, rels) {
  const sheets = [];
  let date1904 = false;

  scan(source, {
    open(local, attrs) {
      if (local === 'workbookPr') {
        const value = attr(attrs, 'date1904');
        date1904 = value === '1' || value === 'true';
        return;
      }
      if (local !== 'sheet') return;
      const id = attr(attrs, 'id');
      const rel = id && rels.get(id);
      sheets.push({
        name: attr(attrs, 'name') || `Sheet${sheets.length + 1}`,
        // `hidden` and `veryHidden` both mean the tab is not on screen.
        hidden: (attr(attrs, 'state') || 'visible') !== 'visible',
        part: rel ? rel.target : null,
      });
    },
  });
  return { sheets, date1904 };
}

/* -------------------------------------------------------------------------- */
/* shared strings                                                              */
/* -------------------------------------------------------------------------- */

/*
 * Every piece of text in a workbook is stored once, in a table, and the cells
 * hold indexes into it. One `<si>` may be split across several `<r>` runs where
 * part of it was formatted differently, and the runs have to be joined -- a
 * cell reading "Tổng cộng" with only "Tổng" in bold is two runs and one value.
 */
function readSharedStrings(zip) {
  const part = zip.read('xl/sharedStrings.xml');
  const strings = [];
  if (!part) return strings;

  let current = null;
  let inT = 0;
  let skipAt = -1;
  let depth = 0;
  let pending = '';

  scan(part.toString('utf8'), {
    open(local) {
      depth++;
      if (skipAt !== -1) return;
      if (local === 'si') current = '';
      // Furigana for Japanese text: a reading aid stored alongside the word,
      // which would otherwise be concatenated into the middle of the value.
      else if (local === 'rPh' || local === 'phoneticPr') skipAt = depth;
      else if (local === 't') { inT++; pending = ''; }
    },
    text(value) {
      if (skipAt === -1 && inT) pending += value;
    },
    close(local) {
      const level = depth;
      depth--;
      if (skipAt !== -1) {
        if (level === skipAt) skipAt = -1;
        return;
      }
      if (local === 't' && inT) {
        inT--;
        if (current !== null) current += pending;
        pending = '';
      } else if (local === 'si') {
        strings.push(cap(current || ''));
        current = null;
      }
    },
  });
  return strings;
}

/* -------------------------------------------------------------------------- */
/* styles: the only thing that says a number is a date                         */
/* -------------------------------------------------------------------------- */

function readStyles(zip) {
  const part = zip.read('xl/styles.xml');
  /** cell format index -> what kind of value the format implies */
  const kinds = [];
  if (!part) return kinds;

  const custom = new Map();
  let inCellXfs = false;

  scan(part.toString('utf8'), {
    open(local, attrs) {
      if (local === 'numFmt') {
        const id = Number(attr(attrs, 'numFmtId'));
        const code = attr(attrs, 'formatCode');
        if (Number.isFinite(id) && code) custom.set(id, code);
        return;
      }
      if (local === 'cellXfs') { inCellXfs = true; return; }
      /*
       * `<xf>` appears twice: once in `cellStyleXfs` (named styles) and once in
       * `cellXfs` (what cells actually point at). A cell's `s` attribute indexes
       * the second list. Reading both put every index one place out, which
       * showed up as an entire column of dates rendered as currency.
       */
      if (local === 'xf' && inCellXfs) {
        const id = Number(attr(attrs, 'numFmtId'));
        kinds.push(kindOfFormat(Number.isFinite(id) ? id : 0, custom));
      }
    },
    close(local) {
      if (local === 'cellXfs') inCellXfs = false;
    },
  });
  return kinds;
}

function kindOfFormat(id, custom) {
  if (BUILTIN_DATE.has(id)) return 'date';
  if (BUILTIN_TIME.has(id)) return 'time';
  if (BUILTIN_PERCENT.has(id)) return 'percent';

  const code = custom.get(id);
  if (!code) return 'number';
  return kindOfFormatCode(code);
}

/**
 * Read a format string well enough to tell a date from a number.
 *
 * The literal parts have to come out first. A format like `"Ngày "dd/mm/yyyy`
 * has a `d` and an `m` inside the quoted text as well as outside, and
 * `[$-1010409]` is a locale tag, not three month placeholders. Stripping both
 * before looking is the whole trick.
 */
function kindOfFormatCode(code) {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');

  // Excel keeps up to four sections separated by semicolons: positive,
  // negative, zero, text. They share a kind, so the first is enough.
  const first = bare.split(';')[0];

  if (/%/.test(first)) return 'percent';
  const hasDate = /[yd]/i.test(first) || /m{3,}/i.test(first);
  const hasTime = /[hs]/i.test(first);
  // A lone `m` is ambiguous -- month or minute -- and is only a month when a
  // day or year keeps it company, which the test above already requires.
  if (hasDate && hasTime) return 'datetime';
  if (hasDate) return 'date';
  if (hasTime) return 'time';
  return 'number';
}

/* -------------------------------------------------------------------------- */
/* one sheet                                                                   */
/* -------------------------------------------------------------------------- */

function readSheet(source, { shared, formats, date1904 }) {
  const rows = [];
  const cols = [];
  const merges = [];

  let row = null;
  let rowIndex = 0;
  let colIndex = 0;
  let cell = null;
  let inV = 0;
  let inIs = 0;
  let inT = 0;
  let pending = '';
  let widest = 0;
  let truncated = false;
  let skipAt = -1;
  let depth = 0;

  scan(source, {
    open(local, attrs) {
      depth++;
      if (skipAt !== -1) return;

      switch (local) {
        case 'col': {
          const min = Number(attr(attrs, 'min'));
          const max = Number(attr(attrs, 'max'));
          const width = Number(attr(attrs, 'width'));
          if (!Number.isFinite(min) || !Number.isFinite(width)) return;
          for (let c = min; c <= Math.min(max || min, MAX_COLS); c++) cols[c - 1] = width;
          return;
        }

        case 'mergeCell': {
          const range = parseRange(attr(attrs, 'ref'));
          if (range) merges.push(range);
          return;
        }

        case 'row': {
          const declared = Number(attr(attrs, 'r'));
          // A row without an `r` follows the previous one. Sparse sheets omit
          // the empty rows entirely, so the number matters for alignment.
          rowIndex = Number.isFinite(declared) ? declared : rowIndex + 1;
          if (rows.length >= MAX_ROWS) {
            truncated = true;
            skipAt = depth;
            return;
          }
          row = { r: rowIndex, cells: [] };
          colIndex = 0;
          return;
        }

        case 'c': {
          if (!row) return;
          const ref = attr(attrs, 'ref') || attr(attrs, 'r');
          const parsed = ref ? colOf(ref) : 0;
          colIndex = parsed || colIndex + 1;
          if (colIndex > MAX_COLS) {
            truncated = true;
            cell = null;
            return;
          }
          if (colIndex > widest) widest = colIndex;

          const styleIndex = Number(attr(attrs, 's'));
          cell = {
            c: colIndex,
            t: attr(attrs, 't') || 'n',
            style: Number.isFinite(styleIndex) ? styleIndex : -1,
            raw: '',
          };
          return;
        }

        case 'v': if (cell) { inV++; pending = ''; } return;
        case 'is': if (cell) inIs++; return;
        case 't': if (cell && inIs) { inT++; pending = ''; } return;

        // The cached formula, which is the formula's text rather than its
        // result. The result is in `<v>` beside it, and that is what is shown.
        case 'f': if (cell) { skipAt = depth; cell.formula = true; } return;

        default:
      }
    },

    text(value) {
      if (skipAt === -1 && (inV || inT)) pending += value;
    },

    close(local) {
      const level = depth;
      depth--;
      if (skipAt !== -1) {
        if (level === skipAt) {
          skipAt = -1;
          // A row skipped because the sheet is already at its ceiling leaves
          // no row open behind it.
          if (local === 'row') row = null;
        }
        return;
      }

      switch (local) {
        case 'v': if (inV) { inV--; if (cell) cell.raw = pending; pending = ''; } return;
        case 't': if (inT) { inT--; if (cell) cell.raw += pending; pending = ''; } return;
        case 'is': if (inIs) inIs--; return;

        case 'c': {
          if (!cell) return;
          const value = valueOf(cell, { shared, formats, date1904 });
          if (value) row.cells.push(value);
          cell = null;
          return;
        }

        case 'row':
          if (row) rows.push(row);
          row = null;
          return;

        default:
      }
    },
  });

  return { rows, cols: cols.slice(0, MAX_COLS), merges, colCount: widest, truncated };
}

/**
 * Turn one parsed cell into something the window can show.
 *
 * Returns null for a cell that holds nothing. Excel writes those constantly --
 * a cell that has only ever been formatted is still written out -- and keeping
 * them would triple the size of a sparse sheet for no visible difference.
 */
function valueOf(cell, { shared, formats, date1904 }) {
  const { t, raw } = cell;
  if (raw === '' || raw === undefined) return null;

  const base = { c: cell.c };
  if (cell.formula) base.f = true;

  switch (t) {
    case 's': {
      const index = Number(raw);
      const text = Number.isFinite(index) ? shared[index] : undefined;
      if (text === undefined || text === '') return null;
      return { ...base, k: 'text', v: text };
    }
    case 'inlineStr':
    case 'str':
      return { ...base, k: 'text', v: cap(raw) };
    case 'b':
      return { ...base, k: 'bool', v: raw === '1' };
    case 'e':
      return { ...base, k: 'error', v: cap(raw) };
    case 'd':
      // The ISO variant, which a few writers emit and Excel itself does not.
      return { ...base, k: 'date', v: raw, iso: raw };
    default: {
      const number = Number(raw);
      if (!Number.isFinite(number)) return { ...base, k: 'text', v: cap(raw) };

      const kind = cell.style >= 0 ? formats[cell.style] : undefined;
      if (kind === 'date' || kind === 'datetime' || kind === 'time') {
        const iso = serialToIso(number, date1904, kind);
        // A serial that converts to nothing sensible is shown as the number it
        // is, rather than as a date in 1899 that the file does not contain.
        if (iso) return { ...base, k: kind, v: number, iso };
      }
      if (kind === 'percent') return { ...base, k: 'percent', v: number };
      return { ...base, k: 'number', v: number };
    }
  }
}

/**
 * A serial number to an ISO timestamp.
 *
 * Built in UTC on purpose. A spreadsheet date has no time zone -- an invoice
 * dated the 5th is the 5th everywhere -- and converting through local time is
 * how a date arrives in the window as the 4th for anybody west of Greenwich.
 */
function serialToIso(serial, date1904, kind) {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958466) return null;
  const days = serial + (date1904 ? DATE_1904_DAYS : 0) - EPOCH_DAYS;
  // Rounded to the second: the fractional day is a float, and without this a
  // time of 09:00 arrives as 08:59:59.9999998.
  const ms = Math.round(days * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return kind === 'time' ? date.toISOString().slice(11, 19) : date.toISOString();
}

/** `B7` or `$B$7` -> 2. Returns 0 when the reference has no column part. */
function colOf(ref) {
  let n = 0;
  for (let at = 0; at < ref.length; at++) {
    const code = ref.charCodeAt(at);
    if (code === 36 /* $ */) continue;
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n;
}

function rowOf(ref) {
  const match = /(\d+)\s*$/.exec(ref);
  return match ? Number(match[1]) : 0;
}

function parseRange(ref) {
  if (!ref) return null;
  const [from, to] = ref.split(':');
  if (!from || !to) return null;
  const range = { r1: rowOf(from), c1: colOf(from), r2: rowOf(to), c2: colOf(to) };
  return range.r1 && range.c1 && range.r2 && range.c2 ? range : null;
}

function cap(text) {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

module.exports = { readXlsx, kindOfFormatCode, serialToIso, colOf, MAX_ROWS, MAX_COLS };
