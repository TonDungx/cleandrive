'use strict';

const path = require('node:path');

const { detectFormat, kindOfExtension } = require('../media/format');

/**
 * What kind of thing a file is, for the purpose of showing it.
 *
 * ## Why this is not the media classifier again
 *
 * `media/format.js` answers "is this a photograph or a film, and which codec".
 * This answers a different question: "which viewer should open it". They
 * overlap on images and video and diverge everywhere else, and the two
 * questions want different mistakes. A `.jpg` that is really a PNG is a finding
 * worth reporting on the photo screen; here it is simply an image, and saying
 * so and drawing it is more useful than refusing on a technicality.
 *
 * ## Bytes first, name second -- but the name still matters
 *
 * The media subsystem reads bytes because an extension lies often enough to
 * matter. That holds here too. One of the twelve `.docx` files on the machine
 * this was written on begins `<DOCUMENT SAFER V2010 R2>` and then turns to
 * ciphertext -- a rights-managed wrapper, not a Word file at all. A viewer that
 * trusted the name would hand it to a ZIP reader and report it as corrupt; what
 * it actually needs to say is "this is not a document, it is a locked box, open
 * it with the thing that locked it".
 *
 * But the name is the only thing that separates a `.json` from a `.js` from a
 * `.log`, and all three are the same bytes. So: magic bytes decide the
 * container, and the extension decides what to do inside it.
 */

/* -------------------------------------------------------------------------- */
/* text                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Extensions this app will show as text.
 *
 * Grouped only so the list stays readable; nothing downstream cares which group
 * an extension came from, because the viewer renders all of them the same way.
 * Syntax colouring is deliberately absent -- it would need a grammar per
 * language, and the question this screen answers is "what is in this file",
 * which plain text answers completely.
 */
const TEXT_EXT = new Set([
  // plain
  'txt', 'log', 'md', 'markdown', 'rst', 'nfo', 'me', 'readme', 'text',
  // tabular
  'csv', 'tsv', 'psv',
  // structured
  'json', 'jsonl', 'ndjson', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'properties', 'env', 'plist', 'srt', 'vtt', 'ass',
  // web
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  // code
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'php', 'go', 'rs', 'java',
  'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'm', 'mm', 'scala',
  'lua', 'pl', 'r', 'jl', 'dart', 'vue', 'svelte', 'sql', 'graphql', 'proto',
  // shells and build
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'mk', 'makefile',
  'dockerfile', 'gradle', 'cmake', 'gitignore', 'gitattributes', 'editorconfig',
  // patches and keys that are text
  'patch', 'diff', 'pem', 'crt', 'csr', 'asc', 'sig',
]);

/** Extensions that are archives. Listing what is inside is the useful preview. */
const ARCHIVE_EXT = new Set(['zip', 'jar', 'war', 'apk', 'epub', 'whl', 'nupkg', 'vsix', 'xpi']);

/** OOXML: a ZIP with a known layout inside. */
const OOXML_EXT = new Map(
  Object.entries({
    docx: 'word', docm: 'word', dotx: 'word',
    xlsx: 'sheet', xlsm: 'sheet', xltx: 'sheet',
    pptx: 'slides', pptm: 'slides', potx: 'slides',
  })
);

/**
 * The formats that predate OOXML and are OLE compound files.
 *
 * Confirmed on this machine: every `.doc` and `.xls` found begins
 * `d0cf11e0a1b11ae1`. Reading them means implementing the OLE container *and*
 * the Word or Excel binary record format, which is a project rather than a
 * feature. They are recognised so the viewer can say what they are and offer
 * the program that owns them, instead of showing a wall of bytes.
 */
const LEGACY_OFFICE_EXT = new Set(['doc', 'xls', 'ppt', 'pps', 'dot', 'xlt', 'pot', 'msg', 'wps']);

const OLE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');

/**
 * Decide which viewer a file belongs to.
 *
 * @param {string} filePath
 * @param {Buffer} head       the first few KB, already read
 * @param {number} size
 * @returns {{kind: string, detail?: string, format?: string, note?: string}}
 *   kind is one of: image · video · audio · pdf · text · office · legacy-office
 *                   · archive · empty · binary
 */
function classify(filePath, head, size) {
  const ext = extensionOf(filePath);

  if (size === 0) return { kind: 'empty' };

  /* -- what the bytes say --------------------------------------------------- */

  if (head.length >= 5 && head.toString('latin1', 0, 5) === '%PDF-') {
    return { kind: 'pdf' };
  }

  if (head.length >= 8 && head.subarray(0, 8).equals(OLE_MAGIC)) {
    return { kind: 'legacy-office', format: ext };
  }

  const media = detectFormat(head);
  if (media) {
    // A container that is an image or a film gets drawn, whatever it is called.
    if (media.kind === 'image') return { kind: 'image', format: media.format };
    if (media.kind === 'video') return { kind: 'video', format: media.format };
  }

  const zipLike = head.length >= 4 && head.readUInt32LE(0) === 0x04034b50;
  if (zipLike) {
    const ooxml = OOXML_EXT.get(ext);
    if (ooxml) return { kind: 'office', format: ooxml };
    if (ARCHIVE_EXT.has(ext)) return { kind: 'archive', format: ext };
    // A ZIP under some other name is still a ZIP worth listing.
    return { kind: 'archive', format: 'zip' };
  }

  if (isAudio(head, ext)) return { kind: 'audio', format: ext };

  /* -- what the name says, once the bytes have had their turn --------------- */

  if (TEXT_EXT.has(ext) || looksLikeText(head)) {
    return { kind: 'text', format: ext };
  }

  if (LEGACY_OFFICE_EXT.has(ext)) return { kind: 'legacy-office', format: ext };
  if (OOXML_EXT.has(ext)) {
    /*
     * Named like an Office file and not a ZIP.
     *
     * Two quite different things land here. Word's older XML format really is
     * text and is worth showing, so it is. A rights-managed wrapper is not --
     * the one on this machine is an ASCII header over ciphertext, and the
     * `looksLikeText` test rejects it on the NUL bytes, which is the right
     * answer. Saying "this is not a document" is more use than a page of
     * mojibake.
     */
    return looksLikeText(head)
      ? { kind: 'text', format: 'xml', note: 'mislabelled' }
      : { kind: 'binary', format: ext };
  }

  return { kind: 'binary', format: ext };
}

function isAudio(head, ext) {
  if (head.length >= 3 && head.toString('latin1', 0, 3) === 'ID3') return true;
  if (head.length >= 4 && head.toString('latin1', 0, 4) === 'fLaC') return true;
  return ['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'wma', 'opus'].includes(ext);
}

/**
 * Does this look like text rather than a binary?
 *
 * A NUL byte inside the first few KB is the classic signal and it is a good
 * one: text encodings the world still uses do not contain one, and every
 * binary format worth the name does. UTF-16 is the exception, and it announces
 * itself with a byte-order mark, which is checked first.
 *
 * The second test is the proportion of bytes that are neither printable nor
 * ordinary whitespace. A file that is mostly control characters is not
 * something anybody wants rendered as text, whatever it is called.
 */
function looksLikeText(head) {
  if (head.length === 0) return false;

  // A BOM settles it.
  if (head.length >= 2) {
    const b0 = head[0];
    const b1 = head[1];
    if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) return true;
  }
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return true;

  const sample = head.subarray(0, Math.min(head.length, 4096));
  let odd = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    // Tab, newline, carriage return, form feed and escape are ordinary in text.
    const ordinary = byte === 9 || byte === 10 || byte === 13 || byte === 12 || byte === 27;
    if (!ordinary && byte < 32) odd += 1;
  }
  return odd / sample.length < 0.02;
}

function extensionOf(filePath) {
  const ext = path.extname(filePath);
  if (ext) return ext.slice(1).toLowerCase();
  // `Makefile`, `Dockerfile`, `.gitignore` -- no extension, but the name is
  // the type.
  return path.basename(filePath).replace(/^\./, '').toLowerCase();
}

module.exports = {
  classify,
  looksLikeText,
  extensionOf,
  TEXT_EXT,
  ARCHIVE_EXT,
  OOXML_EXT,
  LEGACY_OFFICE_EXT,
  kindOfExtension,
};
