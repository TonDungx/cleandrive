#!/usr/bin/env node
'use strict';

// What the viewer decides a file is, and how it turns bytes into characters.
//
//   node scripts/test-preview.js
//
// Both halves are pure functions over buffers, so the fixtures are buffers.
// The half that matters most here is the encoding: these files are Vietnamese,
// and a `.txt` written by an older Windows program is `windows-1258`. Decoded
// as UTF-8 it comes out as a page of replacement characters, which reads as a
// corrupt file rather than as a guess that went wrong.

const kinds = require('../src/main/lib/preview/kinds');
const { decode, trimPartialCharacter } = require('../src/main/lib/preview/text');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const ascii = (s) => Buffer.from(s, 'latin1');
const classify = (name, head, size) => kinds.classify(`C:\\x\\${name}`, head, size ?? head.length);

/* -------------------------------------------------------------------------- */

console.log('\npreview: which viewer a file belongs to\n');

{
  check('a PDF is recognised from its signature',
    classify('a.pdf', ascii('%PDF-1.7\nstuff')).kind === 'pdf');
  // The extension is not what decides it: a PDF saved as .txt is still a PDF,
  // and showing it as a page of binary would be the wrong kind of obedience.
  check('and a PDF named .txt is still a PDF',
    classify('a.txt', ascii('%PDF-1.4\nstuff')).kind === 'pdf');

  const ole = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(64)]);
  check('an OLE compound file is the older Office format',
    classify('a.doc', ole).kind === 'legacy-office');
  check('whatever it is called', classify('a.bin', ole).kind === 'legacy-office');

  const zip = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(64)]);
  check('a .docx that is a ZIP is an Office file',
    classify('a.docx', zip).kind === 'office' && classify('a.docx', zip).format === 'word');
  check('a .xlsx likewise', classify('a.xlsx', zip).format === 'sheet');
  check('a .pptx likewise', classify('a.pptx', zip).format === 'slides');
  check('a plain ZIP is an archive', classify('a.zip', zip).kind === 'archive');
  // A ZIP under a name nobody recognises is still a ZIP, and listing it is
  // still the useful answer.
  check('and so is a ZIP under an unknown name', classify('a.weird', zip).kind === 'archive');

  const png = Buffer.concat([Buffer.from([0x89]), ascii('PNG\r\n\x1a\n'), Buffer.alloc(32)]);
  check('a PNG is an image', classify('a.png', png).kind === 'image');
  // The photo screen reports this as a finding. Here it is simply an image, and
  // drawing it beats refusing on a technicality.
  check('a PNG named .jpg is still drawn', classify('a.jpg', png).kind === 'image');

  check('an empty file says so', classify('a.txt', Buffer.alloc(0), 0).kind === 'empty');
}

console.log('\npreview: text, by name and by content\n');

{
  check('a .log is text', classify('a.log', ascii('2026-07-15 started')).kind === 'text');
  check('a .json is text', classify('a.json', ascii('{"a":1}')).kind === 'text');
  check('a Makefile with no extension at all is text',
    classify('Makefile', ascii('all:\n\tgcc')).kind === 'text');
  check('a .gitignore is text', classify('.gitignore', ascii('node_modules/')).kind === 'text');

  // An extension nobody has heard of, holding plain text. The content decides.
  check('an unknown extension holding text is shown as text',
    classify('notes.qqq', ascii('hello, this is just writing')).kind === 'text');

  // And the other way: an unknown extension holding bytes is not.
  const noisy = Buffer.alloc(512);
  for (let i = 0; i < noisy.length; i++) noisy[i] = i % 7 === 0 ? 0 : 200 + (i % 50);
  check('an unknown extension holding bytes is not', classify('x.qqq', noisy).kind === 'binary');
}

console.log('\npreview: telling text from bytes\n');

{
  check('a NUL byte means binary, whatever else is there',
    !kinds.looksLikeText(Buffer.concat([ascii('hello world'), Buffer.from([0]), ascii('more')])));
  check('tabs and newlines are ordinary in text',
    kinds.looksLikeText(ascii('a\tb\r\nc\n')));
  check('a UTF-8 BOM settles it', kinds.looksLikeText(Buffer.from([0xef, 0xbb, 0xbf, 0x41])));
  check('a UTF-16 BOM settles it too', kinds.looksLikeText(Buffer.from([0xff, 0xfe, 0x41, 0x00])));
  check('nothing at all is not text', !kinds.looksLikeText(Buffer.alloc(0)));

  // The real case this was written against: a rights-managed document whose
  // header is readable ASCII and whose body is ciphertext. Reported by a real
  // file on the development machine, which begins `<DOCUMENT SAFER V2010 R2>`
  // and then turns to noise -- eighteen NUL bytes in its first four kilobytes.
  const wrapped = Buffer.concat([
    ascii('<DOCUMENT SAFER V2010 R2>'),
    Buffer.from(Array.from({ length: 400 }, (_, i) => (i % 23 === 0 ? 0 : 128 + (i % 120)))),
  ]);
  check('an ASCII header over ciphertext is not text', !kinds.looksLikeText(wrapped));
  check('and such a .docx is reported as binary rather than as a broken ZIP',
    classify('locked.docx', wrapped).kind === 'binary');

  // Vietnamese in UTF-8 is high-bit bytes and no control characters.
  check('Vietnamese UTF-8 is text',
    kinds.looksLikeText(Buffer.from('Xin chào, đây là một tệp văn bản', 'utf8')));
}

/* -------------------------------------------------------------------------- */

console.log('\npreview: bytes to characters\n');

{
  const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Chào bạn', 'utf8')]);
  const a = decode(utf8Bom);
  check('a UTF-8 BOM is honoured and removed', a.text === 'Chào bạn' && a.encoding === 'UTF-8',
    JSON.stringify(a.text));

  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Chào bạn', 'utf16le')]);
  const b = decode(utf16);
  check('UTF-16 LE is read as UTF-16', b.text === 'Chào bạn' && b.encoding === 'UTF-16 LE',
    JSON.stringify(b.text));

  const plain = decode(Buffer.from('Chào bạn, đây là UTF-8 không BOM', 'utf8'));
  check('UTF-8 without a BOM is recognised', plain.encoding === 'UTF-8' && /Chào bạn/.test(plain.text));

  /*
   * The case this ordering exists for.
   *
   * These bytes are Vietnamese written in windows-1258 -- a code page that
   * spells the accents as separate combining marks, so the byte values are not
   * valid UTF-8. The strict decode throws and the fallback runs.
   *
   * What comes out is `Tiếng Viềt`: this fixture was typed by hand from the
   * code page table and one mark is on the wrong vowel. That is left as it is,
   * because what is being tested is which decoder was chosen, not whether the
   * author can spell in hex. Without `fatal: true` on that first attempt
   * every byte sequence "decodes" -- into replacement characters -- and there
   * is nothing left to tell a successful guess from a failed one.
   */
  const vn1258 = Buffer.from([0x54, 0x69, 0xea, 0xec, 0x6e, 0x67, 0x20, 0x56, 0x69, 0xea, 0xcc, 0x74]);
  const c = decode(vn1258);
  check('a Vietnamese file in Windows-1258 is not decoded as UTF-8', c.encoding === 'Windows-1258',
    `${c.encoding}: ${JSON.stringify(c.text)}`);
  check('and it comes out without replacement characters', !c.text.includes('\ufffd'),
    JSON.stringify(c.text));

  check('an empty buffer decodes to nothing', decode(Buffer.alloc(0)).text === '');
}

console.log('\npreview: a read window that lands mid-character\n');

{
  // Two megabytes of a UTF-8 file is very unlikely to end on a character
  // boundary. Before this, one trailing half-character failed the strict decode
  // and the whole file was reported as Windows-1258 -- every accent wrong,
  // because of one byte at the end.
  const full = Buffer.from('Chào bạn — đây là chữ tiếng Việt ở cuối: ệ', 'utf8');
  for (let cut = 1; cut <= 3; cut++) {
    const chopped = full.subarray(0, full.length - cut);
    const trimmed = trimPartialCharacter(chopped);
    const result = decode(chopped);
    check(`cutting ${cut} byte(s) off the end still reads as UTF-8`,
      result.encoding === 'UTF-8', `${result.encoding} (trimmed ${chopped.length - trimmed.length})`);
  }

  check('a buffer ending on a boundary is left alone',
    trimPartialCharacter(full).length === full.length);
  check('trimming nothing does not throw', trimPartialCharacter(Buffer.alloc(0)).length === 0);
  // An ASCII-only file has no multi-byte characters to cut.
  check('plain ASCII is never trimmed',
    trimPartialCharacter(ascii('hello')).length === 5);
}

console.log('\npreview: extensions\n');

{
  check('the extension is lowercased', kinds.extensionOf('C:\\x\\A.LOG') === 'log');
  check('a dotfile is named by itself', kinds.extensionOf('C:\\x\\.gitignore') === 'gitignore');
  check('a file with no extension is named by itself', kinds.extensionOf('C:\\x\\Makefile') === 'makefile');
  check('a path with dots in the folders is not confused',
    kinds.extensionOf('C:\\a.b\\c.d\\file.txt') === 'txt');
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
