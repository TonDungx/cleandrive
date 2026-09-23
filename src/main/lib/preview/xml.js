'use strict';

/**
 * A scanner for the XML that Office writes.
 *
 * ## Why not a real XML parser
 *
 * Because nothing here needs a tree. The three readers built on this all do
 * the same thing -- walk forwards, keep a little state, emit a paragraph or a
 * cell when the closing tag arrives -- and a tree would mean holding a whole
 * document in objects to answer questions that a cursor answers as it passes.
 * A forty megabyte spreadsheet is common. A forty megabyte spreadsheet turned
 * into a DOM is not something to do to somebody's machine so they can decide
 * whether to delete it.
 *
 * ## What it deliberately does not do
 *
 * No namespace resolution, no DTD, no external entities, no validation. Office
 * writes its own files with fixed prefixes (`w:`, `a:`, `r:`) and the readers
 * match on the local name, which is what the format guarantees. External
 * entities are not merely unimplemented but unwanted: resolving them is how an
 * XML parser is talked into reading a file somebody else chose, and this one is
 * pointed at documents that arrived by email.
 *
 * The one piece of real XML this does implement is entity decoding, because
 * `&amp;` in a filename or `&#10;` in a cell is content, not markup.
 */

/**
 * Walk a document, calling back on each tag and each run of text.
 *
 * @param {string} source
 * @param {{open?: Function, close?: Function, text?: Function}} on
 *   open(local, attrs, qualified) -- attrs is null when the tag has none
 *   close(local, qualified)
 *   text(decoded)
 *   A self-closing tag calls open then close, so callers never special-case it.
 */
function scan(source, on) {
  const onOpen = on.open;
  const onClose = on.close;
  const onText = on.text;
  const length = source.length;
  let at = 0;

  while (at < length) {
    const lt = source.indexOf('<', at);
    if (lt === -1) {
      if (onText && at < length) emitText(source.slice(at), onText);
      return;
    }
    if (onText && lt > at) emitText(source.slice(at, lt), onText);

    const next = source.charCodeAt(lt + 1);

    /* -- the things that are not tags ------------------------------------- */

    if (next === 33 /* ! */) {
      if (source.startsWith('<![CDATA[', lt)) {
        const end = source.indexOf(']]>', lt + 9);
        const stop = end === -1 ? length : end;
        // CDATA is text that is exempt from entity decoding -- that is the
        // whole point of it, so it goes through raw.
        if (onText && stop > lt + 9) onText(source.slice(lt + 9, stop));
        at = end === -1 ? length : end + 3;
        continue;
      }
      if (source.startsWith('<!--', lt)) {
        const end = source.indexOf('-->', lt + 4);
        at = end === -1 ? length : end + 3;
        continue;
      }
      // A DOCTYPE, which may hold a bracketed internal subset. Skipped whole,
      // entities and all: see the note above about what is not wanted here.
      at = skipDeclaration(source, lt);
      continue;
    }

    if (next === 63 /* ? */) {
      const end = source.indexOf('?>', lt + 2);
      at = end === -1 ? length : end + 2;
      continue;
    }

    /* -- a closing tag ----------------------------------------------------- */

    if (next === 47 /* / */) {
      const end = source.indexOf('>', lt + 2);
      if (end === -1) return;
      if (onClose) {
        const qualified = source.slice(lt + 2, end).trim();
        onClose(localName(qualified), qualified);
      }
      at = end + 1;
      continue;
    }

    /* -- an opening tag ---------------------------------------------------- */

    const end = findTagEnd(source, lt + 1);
    if (end === -1) return;

    const selfClosing = source.charCodeAt(end - 1) === 47 /* / */;
    const inner = source.slice(lt + 1, selfClosing ? end - 1 : end);

    // The name runs to the first whitespace; everything after it is attributes.
    let cut = 0;
    while (cut < inner.length && !isSpace(inner.charCodeAt(cut))) cut++;
    const qualified = inner.slice(0, cut);
    const local = localName(qualified);

    if (onOpen) {
      const attrs = cut < inner.length ? parseAttrs(inner, cut) : null;
      onOpen(local, attrs, qualified);
    }
    if (selfClosing && onClose) onClose(local, qualified);

    at = end + 1;
  }
}

/*
 * A '>' inside an attribute value is legal and Office writes them -- a cell
 * whose format string contains one, for instance. Finding the end of a tag by
 * searching for '>' would cut such a tag in half, so quotes are tracked.
 */
function findTagEnd(source, from) {
  let quote = 0;
  for (let at = from; at < source.length; at++) {
    const code = source.charCodeAt(at);
    if (quote) {
      if (code === quote) quote = 0;
    } else if (code === 34 || code === 39) {
      quote = code;
    } else if (code === 62 /* > */) {
      return at;
    }
  }
  return -1;
}

function skipDeclaration(source, from) {
  let depth = 0;
  for (let at = from; at < source.length; at++) {
    const code = source.charCodeAt(at);
    if (code === 91 /* [ */) depth++;
    else if (code === 93 /* ] */) depth--;
    else if (code === 62 /* > */ && depth <= 0) return at + 1;
  }
  return source.length;
}

function parseAttrs(inner, from) {
  const attrs = {};
  let at = from;
  while (at < inner.length) {
    while (at < inner.length && isSpace(inner.charCodeAt(at))) at++;
    if (at >= inner.length) break;

    const eq = inner.indexOf('=', at);
    if (eq === -1) break;
    const name = inner.slice(at, eq).trim();

    let valueAt = eq + 1;
    while (valueAt < inner.length && isSpace(inner.charCodeAt(valueAt))) valueAt++;
    const quote = inner.charCodeAt(valueAt);
    if (quote !== 34 && quote !== 39) break;

    const close = inner.indexOf(String.fromCharCode(quote), valueAt + 1);
    if (close === -1) break;
    attrs[name] = decode(inner.slice(valueAt + 1, close));
    at = close + 1;
  }
  return attrs;
}

function emitText(raw, onText) {
  onText(decode(raw));
}

function isSpace(code) {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/** `w:val` -> `val`. The prefix is decoration; the local name is the format. */
function localName(qualified) {
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ',
};

/**
 * Turn `&amp;` and `&#233;` back into characters.
 *
 * The fast path matters: most text has no ampersand at all, and checking for
 * one is far cheaper than running a replace over every string in a
 * spreadsheet.
 */
function decode(text) {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // An out-of-range or unparseable reference is left as it was written --
      // showing `&#0;` is more honest than showing a replacement character and
      // implying the file contained one.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED[body];
    return named === undefined ? whole : named;
  });
}

/** Read an attribute by local name, ignoring whichever prefix the writer chose. */
function attr(attrs, local) {
  if (!attrs) return undefined;
  const direct = attrs[local];
  if (direct !== undefined) return direct;
  for (const key in attrs) {
    const colon = key.indexOf(':');
    if (colon !== -1 && key.slice(colon + 1) === local) return attrs[key];
  }
  return undefined;
}

module.exports = { scan, decode, attr, localName };
