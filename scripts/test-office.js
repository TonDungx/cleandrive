#!/usr/bin/env node
'use strict';

// The ZIP reader, the XML scanner, and the Excel and PowerPoint readers.
//
//   node scripts/test-office.js
//
// Word is absent on purpose: it is read by `mammoth`, the one runtime
// dependency this app takes. See the note further down.
//
// The fixtures are archives assembled byte by byte (see `ooxml-fixture.js`)
// rather than sample documents committed to the repo, for two reasons. The repo
// carries no binary assets. And a handwritten archive can be made to do the
// specific wrong thing each test is about -- lie about how far it expands, put
// its sheets in an order the directory does not agree with -- which a real
// document obligingly does only sometimes.
//
// Most of what is checked below was, at some point on the way here, wrong.

const zip = require('../src/main/lib/preview/zip');
const { scan, decode, attr, localName } = require('../src/main/lib/preview/xml');
const { readXlsx, kindOfFormatCode, serialToIso, colOf } = require('../src/main/lib/preview/xlsx');
const { readPptx } = require('../src/main/lib/preview/pptx');
const { readRels, resolvePart } = require('../src/main/lib/preview/ooxml');
const { zipOf } = require('./ooxml-fixture');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const open = (files, opts) => zip.open(zipOf(files, opts));
const threw = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code || err.message;
  }
};

/* -------------------------------------------------------------------------- */

console.log('\nzip: reading the index at the end\n');

{
  const archive = open([['a.txt', 'hello'], ['b/c.txt', 'world', 8]]);
  check('a stored member comes back', archive.read('a.txt').toString() === 'hello');
  check('a deflated one does too', archive.read('b/c.txt').toString() === 'world');
  check('a member that is not there is null, not a throw', archive.read('nope') === null);
  check('the directory lists both', archive.entries.length === 2);
  check('and carries their names', archive.entries.map((e) => e.name).join(',') === 'a.txt,b/c.txt');
  check('with a date from the DOS fields', new Date(archive.entries[0].mtimeMs).getFullYear() === 2024,
    new Date(archive.entries[0].mtimeMs).toISOString());

  // The end record is found by scanning backwards, which is what makes it the
  // end record rather than a four-byte coincidence inside compressed data.
  const commented = open([['a.txt', 'hello']], { comment: 'written by something chatty' });
  check('a trailing comment does not hide the index', commented.read('a.txt').toString() === 'hello');

  const folder = open([['dir/', ''], ['dir/f.txt', 'x']]);
  check('a folder entry is marked as one', folder.entries[0].directory === true);
  check('and a file next to it is not', folder.entries[1].directory === false);

  // A name may legally appear twice. Every unpacker takes the last, so that is
  // what the author of the file saw.
  const twice = open([['same.txt', 'first'], ['same.txt', 'second']]);
  check('the last of two identical names wins', twice.read('same.txt').toString() === 'second');

  check('a file that is not an archive says so',
    threw(() => zip.open(Buffer.from('this is just text, at some length'))) === 'NOT_A_ZIP');
  check('and so does one too short to hold a record',
    threw(() => zip.open(Buffer.alloc(4))) === 'NOT_A_ZIP');

  /*
   * The oldest trick in the format: a member that says it expands to two
   * gigabytes. The size is a claim by the file, and it is checked before
   * anything is allocated rather than after.
   */
  const bomb = open([['big.bin', 'tiny']], { claimSize: 'big.bin' });
  check('a member that overstates how far it expands is refused',
    threw(() => bomb.read('big.bin')) === 'ZIP_TOO_BIG');

  const utf8 = open([['Tài liệu/Báo cáo.txt', 'x']]);
  check('a Vietnamese member name survives', utf8.entries[0].name === 'Tài liệu/Báo cáo.txt',
    utf8.entries[0].name);
}

/* -------------------------------------------------------------------------- */

console.log('\nxml: scanning\n');

{
  const seen = [];
  scan('<w:p a="1"><w:t xml:space="preserve">hi</w:t><w:br/></w:p>', {
    open: (local, attrs, qualified) => seen.push(['open', local, qualified, attrs && attrs.a]),
    text: (t) => seen.push(['text', t]),
    close: (local) => seen.push(['close', local]),
  });
  check('the local name drops the prefix', seen[0][1] === 'p' && seen[0][2] === 'w:p');
  check('attributes are read', seen[0][3] === '1');
  check('text arrives between the tags', seen.some((e) => e[0] === 'text' && e[1] === 'hi'));
  // A self-closing tag calls both, so no reader has to special-case it.
  const br = seen.findIndex((e) => e[0] === 'open' && e[1] === 'br');
  check('a self-closing tag opens and closes', seen[br + 1][0] === 'close' && seen[br + 1][1] === 'br');

  const texts = [];
  scan('<a>one<!-- a comment -->two<![CDATA[three & four]]></a>', { text: (t) => texts.push(t) });
  check('comments are skipped', !texts.join('').includes('comment'), texts.join(''));
  check('CDATA is text, and exempt from entities', texts.join('').includes('three & four'));

  const names = [];
  scan('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a/>', { open: (n) => names.push(n) });
  check('a declaration and its internal subset are stepped over', names.join(',') === 'a', names.join(','));

  // A `>` inside an attribute is legal and Excel writes them in format strings.
  let width = null;
  scan('<c fmt="a&gt;b" s="7"/>', { open: (n, a) => { width = a && a.s; } });
  check('a tag is not cut in half by a quoted angle bracket', width === '7', String(width));

  check('named entities decode', decode('a &amp; b &lt;c&gt; &quot;d&quot;') === 'a & b <c> "d"');
  check('decimal references decode', decode('&#272;&#7891;ng') === 'Đồng', decode('&#272;&#7891;ng'));
  check('hex references decode', decode('&#x110;&#x1ED3;ng') === 'Đồng');
  check('an unknown entity is left as it was written', decode('&nope; x') === '&nope; x');
  check('text with no ampersand is returned untouched', decode('plain') === 'plain');

  check('an attribute is found by local name whatever its prefix',
    attr({ 'r:id': 'rId7' }, 'id') === 'rId7');
  check('and an unprefixed one is preferred', attr({ id: 'a', 'r:id': 'b' }, 'id') === 'a');
  check('localName strips the prefix', localName('a:t') === 't' && localName('t') === 't');
}

/* -------------------------------------------------------------------------- */

console.log('\nooxml: relationships\n');

{
  const archive = open([
    ['word/_rels/document.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="media/image1.png"/>'
      + '<Relationship Id="rId2" Target="https://example.test/x" TargetMode="External"/>'
      + '<Relationship Id="rId3" Target="/word/other.xml"/></Relationships>'],
  ]);
  const rels = readRels(archive, 'word/document.xml');
  check('a target is resolved against the part that names it',
    rels.get('rId1').target === 'word/media/image1.png', rels.get('rId1').target);
  check('an external target is kept and marked',
    rels.get('rId2').external === true && rels.get('rId2').target === 'https://example.test/x');
  check('a target starting with a slash is from the archive root',
    rels.get('rId3').target === 'word/other.xml', rels.get('rId3').target);
  // `../media/x.png` from inside `ppt/slides` is the everyday shape.
  check('and one that climbs a folder resolves',
    resolvePart('ppt/slides', '../media/image2.png') === 'ppt/media/image2.png');
}

/* -------------------------------------------------------------------------- */

/*
 * Word is not tested here any more.
 *
 * It is read by `mammoth` now -- the one runtime dependency this app takes,
 * chosen after both readers were measured against real documents. Testing a
 * library's own parsing here would be testing somebody else's code; what this
 * app does with its output is checked in `smoke.js`, where the window draws it.
 *
 * The archive and XML layers underneath are still ours and are still tested
 * above, because Excel and PowerPoint are still read here.
 */

console.log('\nxlsx: number formats, which is what makes a date a date\n');

{
  check('a format with a day and a year is a date', kindOfFormatCode('dd/mm/yyyy') === 'date');
  check('one with hours as well is both', kindOfFormatCode('dd/mm/yyyy hh:mm') === 'datetime');
  check('one with only hours is a time', kindOfFormatCode('h:mm:ss') === 'time');
  check('a percentage is a percentage', kindOfFormatCode('0.00%') === 'percent');
  check('plain money is a number', kindOfFormatCode('#,##0.00') === 'number');

  /*
   * The literal parts have to come out first. `"Ngày "dd/mm/yyyy` has a `d` and
   * an `m` inside the quoted text as well as outside, and `[$-1010409]` is a
   * locale tag rather than three month placeholders.
   */
  check('text inside quotes is not read as placeholders',
    kindOfFormatCode('"Số: "#,##0') === 'number', kindOfFormatCode('"Số: "#,##0'));
  check('a locale tag is not read as placeholders',
    kindOfFormatCode('[$-1010409]#,##0') === 'number', kindOfFormatCode('[$-1010409]#,##0'));
  check('but a real date with a prefix still reads as one',
    kindOfFormatCode('"Ngày "dd/mm/yyyy') === 'date');

  // A lone `m` is ambiguous -- month or minute -- and is only a month when a
  // day or a year keeps it company.
  check('a lone m is not enough to make a date', kindOfFormatCode('#,##0 m') === 'number',
    kindOfFormatCode('#,##0 m'));

  /*
   * Excel's day zero is the 30th of December 1899, not the 31st, because Lotus
   * believed 1900 was a leap year and Excel copied the bug for compatibility.
   * Serial 25569 is the Unix epoch; anything else means every date in every
   * file is off by one or two days.
   */
  check('serial 25569 is 1 January 1970', serialToIso(25569, false, 'date').slice(0, 10) === '1970-01-01',
    serialToIso(25569, false, 'date'));
  check('serial 45658 is 1 January 2025', serialToIso(45658, false, 'date').slice(0, 10) === '2025-01-01',
    serialToIso(45658, false, 'date'));
  check('serial 61 is 1 March 1900, where the two calendars meet again',
    serialToIso(61, false, 'date').slice(0, 10) === '1900-03-01', serialToIso(61, false, 'date'));

  /*
   * Below serial 61 this reads one day earlier than Excel shows, and that is
   * the correct answer rather than a bug to fix.
   *
   * Excel believes the 29th of February 1900 existed. It did not. So for the
   * first fifty-nine days of 1900 Excel's serial numbers are one ahead of the
   * real calendar, and no single offset can be right on both sides of that
   * phantom day. The offset used here is the one that is right from March 1900
   * onwards -- which is to say, right for every date in every spreadsheet
   * anybody has. Every other library makes the same trade; it is worth a test
   * so that nobody later "fixes" it and moves every real date by a day.
   */
  check('the phantom leap day is not chased backwards through every real date',
    serialToIso(1, false, 'date').slice(0, 10) === '1899-12-31', serialToIso(1, false, 'date'));
  // The 1904 system, which a few Mac-authored workbooks still use.
  check('the 1904 system shifts by 1462 days',
    serialToIso(45658 - 1462, true, 'date').slice(0, 10) === '2025-01-01');
  // Rounded to the second: the fraction of a day is a float, and without the
  // rounding 09:00 arrives as 08:59:59.9999998.
  check('a time does not lose a second to floating point',
    serialToIso(45658.375, false, 'datetime').slice(11, 19) === '09:00:00',
    serialToIso(45658.375, false, 'datetime'));
  check('a serial far outside any real date is refused', serialToIso(1e9, false, 'date') === null);

  check('a column reference becomes a number', colOf('A1') === 1 && colOf('B7') === 2 && colOf('AA3') === 27);
  check('and an absolute one does too', colOf('$B$7') === 2);
}

console.log('\nxlsx: a workbook\n');

const xlsxOf = (parts) => readXlsx(open(parts));

{
  const workbook = [
    ['xl/workbook.xml',
      '<workbook><sheets>'
      + '<sheet name="Báo cáo" sheetId="3" r:id="rId3"/>'
      + '<sheet name="Nháp" sheetId="1" r:id="rId1" state="hidden"/>'
      + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels',
      '<Relationships>'
      + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId3" Target="worksheets/sheet3.xml"/>'
      + '</Relationships>'],
    ['xl/sharedStrings.xml',
      '<sst><si><t>Tổng</t></si>'
      + '<si><r><t>Tổng </t></r><r><t>cộng</t></r></si>'
      + '<si><t>ル</t><rPh sb="0" eb="1"><t>ruby</t></rPh></si></sst>'],
    ['xl/styles.xml',
      '<styleSheet>'
      + '<numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>'
      // The decoy: these are named styles, not what a cell's `s` indexes.
      + '<cellStyleXfs><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="0"/></cellStyleXfs>'
      + '<cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="9"/></cellXfs>'
      + '</styleSheet>'],
    ['xl/worksheets/sheet3.xml',
      '<worksheet>'
      + '<cols><col min="1" max="2" width="18"/></cols>'
      + '<sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="3">'
      + '<c r="A3" s="1"><v>45658</v></c>'
      + '<c r="B3" s="2"><v>45658</v></c>'
      + '<c r="C3" s="3"><v>0.125</v></c>'
      + '<c r="D3"><v>1234.5</v></c>'
      + '<c r="E3" t="b"><v>1</v></c>'
      + '<c r="F3" t="e"><v>#DIV/0!</v></c>'
      + '<c r="G3" t="str"><f>A1&amp;""</f><v>from a formula</v></c>'
      + '<c r="H3" t="inlineStr"><is><t>inline</t></is></c>'
      + '<c r="I3" s="0"/>'
      + '</row>'
      + '</sheetData>'
      + '<mergeCells><mergeCell ref="A1:B1"/></mergeCells>'
      + '</worksheet>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData/></worksheet>'],
  ];

  const book = xlsxOf(workbook);

  /*
   * The tab order is the workbook's, not the archive's. `sheet3.xml` being the
   * first tab is routine, and reading the directory instead puts the tabs in
   * whatever order they were last saved in -- which looks like data loss.
   */
  check('the sheets are in the workbook\'s order, not the archive\'s',
    book.sheets.map((s) => s.name).join(',') === 'Báo cáo,Nháp',
    book.sheets.map((s) => s.name).join(','));
  check('a hidden sheet is kept and marked', book.sheets[1].hidden === true);
  check('a visible one is not marked', book.sheets[0].hidden === false);

  const rows = book.sheets[0].rows;
  const cell = (r, c) => (rows.find((row) => row.r === r) || { cells: [] }).cells.find((x) => x.c === c);

  check('a shared string is looked up', cell(1, 1).v === 'Tổng');
  check('a string split across runs is joined', cell(1, 2).v === 'Tổng cộng', cell(1, 2).v);
  // Furigana is a reading aid stored beside the word; concatenating it puts
  // the pronunciation into the middle of the value.
  check('a phonetic hint is not concatenated into the value', cell(1, 3).v === 'ル', cell(1, 3).v);

  check('a built-in date format makes a number a date',
    cell(3, 1).k === 'date' && cell(3, 1).iso.slice(0, 10) === '2025-01-01',
    `${cell(3, 1).k} ${cell(3, 1).iso}`);
  /*
   * `<xf>` appears in `cellStyleXfs` as well, and a cell's `s` indexes only
   * `cellXfs`. Reading both lists put every index out of step, which showed up
   * as a whole column of dates rendered as currency.
   */
  check('a custom date format does too, from the right list of styles',
    cell(3, 2).k === 'date' && cell(3, 2).iso.slice(0, 10) === '2025-01-01',
    `${cell(3, 2).k} ${cell(3, 2).iso}`);
  check('a percentage is marked as one', cell(3, 3).k === 'percent' && cell(3, 3).v === 0.125);
  check('an unformatted number stays a number', cell(3, 4).k === 'number' && cell(3, 4).v === 1234.5);
  check('a boolean is a boolean', cell(3, 5).k === 'bool' && cell(3, 5).v === true);
  check('an error is an error', cell(3, 6).k === 'error' && cell(3, 6).v === '#DIV/0!');

  // Excel caches the last computed result beside every formula, and that
  // cached value is what the file's author last saw -- the only honest thing
  // to show without implementing several hundred worksheet functions.
  check('a formula shows its cached result', cell(3, 7).v === 'from a formula' && cell(3, 7).f === true);
  check('and the formula itself is not mistaken for the value',
    !String(cell(3, 7).v).includes('A1&'), String(cell(3, 7).v));

  check('an inline string is read', cell(3, 8).v === 'inline');
  // Excel writes out cells that have only ever been formatted. Keeping them
  // triples the size of a sparse sheet for no visible difference.
  check('a cell with a style and no value is dropped', cell(3, 9) === undefined);

  check('a merged range is recorded',
    book.sheets[0].merges.length === 1 && book.sheets[0].merges[0].c2 === 2);
  check('column widths are read', book.sheets[0].cols[0] === 18);
  // The row numbers are the sheet's own: a sparse sheet omits its empty rows
  // entirely, and the gap is information.
  check('a gap in the rows keeps its numbering', rows.map((r) => r.r).join(',') === '1,3',
    rows.map((r) => r.r).join(','));

  check('a workbook with no workbook part is refused',
    threw(() => readXlsx(open([['xl/styles.xml', '<styleSheet/>']]))) === 'NOT_AN_XLSX');
}

/* -------------------------------------------------------------------------- */

console.log('\npptx: a deck\n');

{
  const slide = (title, body, extra = '') =>
    '<p:sld><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody>'
    + `<a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>`
    + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>'
    + `<a:p><a:pPr lvl="1"/><a:r><a:rPr b="1"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>`
    + `${extra}</p:spTree></p:cSld></p:sld>`;

  const deck = readPptx(open([
    ['ppt/presentation.xml',
      '<p:presentation><p:sldIdLst>'
      + '<p:sldId id="260" r:id="rId9"/>'
      + '<p:sldId id="256" r:id="rId2"/>'
      + '</p:sldIdLst></p:presentation>'],
    ['ppt/_rels/presentation.xml.rels',
      '<Relationships>'
      + '<Relationship Id="rId2" Target="slides/slide2.xml"/>'
      + '<Relationship Id="rId9" Target="slides/slide10.xml"/>'
      + '</Relationships>'],
    ['ppt/slides/slide10.xml', slide('Mở đầu', 'điểm một')],
    ['ppt/slides/slide2.xml', slide('Kết luận', 'điểm hai')],
    ['ppt/slides/_rels/slide2.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide2.xml"/></Relationships>'],
    ['ppt/notesSlides/notesSlide2.xml',
      '<p:notes><p:cSld><p:spTree>'
      // The notes page carries a copy of the slide's own text in a placeholder
      // of its own. Taking the whole part put every slide's text in its notes.
      + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:txBody>'
      + '<a:p><a:r><a:t>Kết luận</a:t></a:r></a:p></p:txBody></p:sp>'
      + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>'
      + '<a:p><a:r><a:t>nhớ nói chậm</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:notes>'],
  ]));

  /*
   * `slide10.xml` sorts before `slide2.xml` as a string, and slides keep their
   * original file name when they are reordered. Only the id list in
   * `presentation.xml` carries the deck's order.
   */
  check('the deck is in the order the presentation gives, not the file names',
    deck.slides.map((s) => s.title).join(',') === 'Mở đầu,Kết luận',
    deck.slides.map((s) => s.title).join(','));
  check('slides are numbered from one', deck.slides[0].n === 1 && deck.slides[1].n === 2);

  const body = deck.slides[0].blocks.filter((b) => b.type === 'text');
  check('the body text is read', body.map((b) => b.runs.map((r) => r.text).join('')).join('') === 'điểm một');
  check('its indent level comes with it', body[0].level === 1, String(body[0].level));
  check('and its formatting', body[0].runs[0].b === true);
  // The title is shown in the slide's own heading, so leaving it in the body
  // would print it twice on every slide.
  check('the title is not repeated in the body',
    !body.some((b) => b.runs.map((r) => r.text).join('').includes('Mở đầu')));

  check('speaker notes are read', deck.slides[1].notes === 'nhớ nói chậm', JSON.stringify(deck.slides[1].notes));
  check('and the slide copy on the notes page is not mistaken for them',
    !deck.slides[1].notes.includes('Kết luận'), JSON.stringify(deck.slides[1].notes));
  check('a slide with no notes has none', deck.slides[0].notes === '');

  check('a file with no presentation part is refused',
    threw(() => readPptx(open([['ppt/slides/slide1.xml', '<p:sld/>']]))) === 'NOT_A_PPTX');
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
