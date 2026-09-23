'use strict';

const zlib = require('node:zlib');

/**
 * Office documents built byte by byte, for tests.
 *
 * The repo carries no binary assets, so there are no sample `.docx` files to
 * check in. That turns out to be the better arrangement anyway: an archive
 * assembled here can be made to do the specific wrong thing a test is about --
 * lie about how far it expands, list its sheets in an order the directory does
 * not agree with, wrap one paragraph twice for two versions of Word -- which a
 * real document does only by chance.
 *
 * Used by `test-office.js`, which exercises the readers, and by `smoke.js`,
 * which needs something for the window to draw.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/**
 * An archive, from a list of `[name, content, method]`.
 *
 * The CRC is written as zero throughout. The reader does not check it -- a
 * preview that refused a file Windows opens happily would be wrong about which
 * of the two was broken -- so a real checksum here would only test the test.
 *
 * @param {Array<[string, string|Buffer, number?]>} files  method 0 stored, 8 deflated
 * @param {{comment?: string, claimSize?: string}} opts
 *   `claimSize` names a member whose index entry will overstate how far it
 *   expands, which is the shape of the old and reliable decompression bomb.
 * @returns {Buffer}
 */
function zipOf(files, opts = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, content, method = 0] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = method === 8 ? zlib.deflateRawSync(raw) : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // the name is UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(CENTRAL_SIG, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(0x6000, 12); // 12:00:00
    entry.writeUInt16LE(0x5921, 14); // 2024-09-01
    entry.writeUInt32LE(0, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(opts.claimSize === name ? 0x7ffffff0 : raw.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(name.endsWith('/') ? 0x10 : 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += 30 + nameBuf.length + packed.length;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const comment = Buffer.from(opts.comment || '', 'utf8');

  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIG, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  end.writeUInt16LE(comment.length, 20);

  return Buffer.concat([body, directory, end, comment]);
}

/* -------------------------------------------------------------------------- */
/* whole documents, for the window to draw                                     */
/* -------------------------------------------------------------------------- */

/*
 * Namespaces, content types and package relationships.
 *
 * The readers written here are lenient -- they match on local names and never
 * look at a namespace URI -- so the first version of this fixture had none of
 * this and passed. Then Word's own format arrived as a dependency and refused
 * it outright: "are you sure this is a docx file?". It was right. A fixture
 * only the code under test will accept is not much of a fixture, so this one is
 * a document Word itself would open.
 */
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
  + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** A real 1x1 transparent PNG, so the picture in the fixture actually draws. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function contentTypes(overrides) {
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + overrides
    + '</Types>';
}

function packageRels(target, type) {
  return `${XML_HEAD}<Relationships ${REL_NS}>`
    + `<Relationship Id="rId1" Type="${REL_TYPE}/${type}" Target="${target}"/>`
    + '</Relationships>';
}

/**
 * A Word document with one of everything the view knows how to draw.
 *
 * Deliberately includes a heading, a numbered list with a sub-item, a run that
 * is bold beside one that is not, a table with a cell merged across two columns
 * and an inline picture -- because the point of drawing it in the smoke test is
 * that each of those reaches the page rather than throwing on the way.
 */
function docxFixture() {
  const item = (level, text) =>
    `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>`
    + `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>`
    + `<w:r><w:t>${text}</w:t></w:r></w:p>`;

  // The full DrawingML chain, because that is what an Office-format reader
  // walks: a blip on its own is not a picture to anything but a lenient parser.
  const picture =
    '<w:p><w:r><w:drawing><wp:inline>'
    + '<wp:extent cx="914400" cy="914400"/>'
    + '<wp:docPr id="1" name="Picture 1"/>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="pic.png"/><pic:cNvPicPr/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic>'
    + '</wp:inline></w:drawing></w:r></w:p>';

  return zipOf([
    ['[Content_Types].xml', contentTypes(
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    )],
    ['_rels/.rels', packageRels('word/document.xml', 'officeDocument')],
    ['word/document.xml',
      `${XML_HEAD}<w:document ${W_NS}><w:body>`
      + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Báo cáo tháng</w:t></w:r></w:p>'
      + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Đậm</w:t></w:r><w:r><w:t> và thường</w:t></w:r></w:p>'
      + item(0, 'Bước một') + item(0, 'Bước hai') + item(1, 'Bước hai a')
      + '<w:tbl><w:tr>'
      + '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Gộp hai cột</w:t></w:r></w:p></w:tc>'
      + '</w:tr><w:tr>'
      + '<w:tc><w:p><w:r><w:t>trái</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:p><w:r><w:t>phải</w:t></w:r></w:p></w:tc>'
      + '</w:tr></w:tbl>'
      + picture
      + '</w:body></w:document>'],
    ['word/_rels/document.xml.rels',
      `${XML_HEAD}<Relationships ${REL_NS}>`
      + `<Relationship Id="rId2" Type="${REL_TYPE}/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId3" Type="${REL_TYPE}/numbering" Target="numbering.xml"/>`
      + `<Relationship Id="rId5" Type="${REL_TYPE}/image" Target="media/pic.png"/>`
      + '</Relationships>'],
    ['word/media/pic.png', TINY_PNG],
    ['word/styles.xml',
      `${XML_HEAD}<w:styles ${W_NS}>`
      + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>'
      + '</w:styles>'],
    ['word/numbering.xml',
      `${XML_HEAD}<w:numbering ${W_NS}>`
      + '<w:abstractNum w:abstractNumId="0">'
      + '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>'
      + '<w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>'
      + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
      + '</w:numbering>'],
  ]);
}

/**
 * A workbook with two sheets, the second hidden, and one of each kind of cell.
 *
 * The sheets are listed in an order the archive does not share, so the view is
 * drawn against the workbook's order rather than the directory's.
 */
function xlsxFixture() {
  return zipOf([
    ['xl/workbook.xml',
      '<workbook><sheets>'
      + '<sheet name="Tháng 6" sheetId="2" r:id="rId2"/>'
      + '<sheet name="Nháp" sheetId="1" r:id="rId1" state="hidden"/>'
      + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels',
      '<Relationships>'
      + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>'
      + '</Relationships>'],
    ['xl/sharedStrings.xml', '<sst><si><t>Ngày</t></si><si><t>Số tiền</t></si></sst>'],
    ['xl/styles.xml',
      '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>'
      + '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet2.xml',
      '<worksheet><cols><col min="1" max="1" width="16"/></cols><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" s="1"><v>45658</v></c><c r="B2"><v>1250000</v></c></row>'
      + '<row r="4"><c r="A4" t="b"><v>1</v></c><c r="B4" t="e"><v>#N/A</v></c></row>'
      + '</sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData/></worksheet>'],
  ]);
}

/** Two slides, in an order the file names disagree with, one with notes. */
function pptxFixture() {
  const slide = (title, body) =>
    '<p:sld><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody>'
    + `<a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>`
    + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>'
    + `<a:p><a:pPr lvl="1"/><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>`
    + '</p:spTree></p:cSld></p:sld>';

  return zipOf([
    ['ppt/presentation.xml',
      '<p:presentation><p:sldIdLst>'
      + '<p:sldId id="260" r:id="rId9"/><p:sldId id="256" r:id="rId2"/>'
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
      + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>'
      + '<a:p><a:r><a:t>nhớ nói chậm</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:notes>'],
  ]);
}

/** A plain archive, for the listing view. */
function zipFixture() {
  return zipOf([
    ['readme.txt', 'xin chào'],
    ['data/report.csv', 'a,b,c\n1,2,3\n', 8],
    ['data/', ''],
  ]);
}

module.exports = { zipOf, docxFixture, xlsxFixture, pptxFixture, zipFixture };
