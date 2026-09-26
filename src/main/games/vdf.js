'use strict';

/**
 * Valve's KeyValues format, which every file Steam keeps on disk is written in.
 *
 *   "libraryfolders"
 *   {
 *       "0"
 *       {
 *           "path"    "C:\\Program Files (x86)\\Steam"
 *           "apps"
 *           {
 *               "228980"    "255461734"
 *           }
 *       }
 *   }
 *
 * Parsed properly rather than with a regular expression per field, because the
 * same key name appears at several depths and means different things: an
 * `apps` block inside a library is appid-to-size, and the `apps` block in
 * `localconfig.vdf` is appid-to-play-record. A regex for `"LastPlayed"` would
 * read both and could not say which game either belonged to.
 *
 * What it handles, all seen in the real files on the machine this was written
 * on: quoted keys and values, nested blocks, `\\` and `\"` escapes, `//`
 * comments, and unquoted tokens (`localconfig.vdf` has them). Conditional
 * suffixes (`[$WIN32]`) are recognised and dropped -- Steam uses them in its
 * shipped configs, and treating one as a value would shift everything after it.
 *
 * A duplicate key keeps the last one, which is what Steam itself does.
 *
 * Only reads, and only what it is handed: it never touches the disk.
 */

/** Past whitespace and comments, to the next thing that matters. */
function skip(text, at) {
  let i = at;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    break;
  }
  return i;
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"' };

/** One token: a quoted string, a bare word, or a brace. */
function readToken(text, at) {
  const i = skip(text, at);
  if (i >= text.length) return null;

  const ch = text[i];
  if (ch === '{' || ch === '}') return { kind: ch, value: ch, next: i + 1 };

  if (ch === '"') {
    let out = '';
    let j = i + 1;
    while (j < text.length && text[j] !== '"') {
      if (text[j] === '\\' && j + 1 < text.length) {
        const escaped = text[j + 1];
        // An unknown escape keeps both characters: a Windows path written
        // without doubling its backslashes is common in these files, and
        // swallowing the backslash would turn `C:\program` into `C:program`.
        out += Object.prototype.hasOwnProperty.call(ESCAPES, escaped) ? ESCAPES[escaped] : `\\${escaped}`;
        j += 2;
        continue;
      }
      out += text[j];
      j++;
    }
    // An unterminated string at the end of a truncated file is not a crash.
    return { kind: 'string', value: out, next: Math.min(j + 1, text.length) };
  }

  let j = i;
  while (j < text.length && !' \t\r\n"{}'.includes(text[j])) j++;
  return { kind: 'string', value: text.slice(i, j), next: j };
}

/**
 * A KeyValues document, as plain nested objects.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxDepth]  a file that nests deeper than this is refused
 * @returns {object}
 */
function parse(text, { maxDepth = 32 } = {}) {
  const root = {};
  const stack = [root];
  let at = 0;
  let pendingKey = null;

  while (at < text.length) {
    const token = readToken(text, at);
    if (!token) break;
    at = token.next;

    if (token.kind === '}') {
      pendingKey = null;
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (token.kind === '{') {
      // A block with no key before it cannot be stored anywhere.
      if (pendingKey === null) continue;
      if (stack.length >= maxDepth) throw new Error('vdf: nested too deep');
      const block = {};
      stack[stack.length - 1][pendingKey] = block;
      stack.push(block);
      pendingKey = null;
      continue;
    }

    if (pendingKey === null) {
      pendingKey = token.value;
      continue;
    }

    // `"key" "value" [$WIN32]` -- the condition belongs to the pair before it
    // and is not a key of its own.
    const after = readToken(text, at);
    if (after && after.kind === 'string' && /^\[\$[^\]]*\]$/.test(after.value)) at = after.next;

    stack[stack.length - 1][pendingKey] = token.value;
    pendingKey = null;
  }

  return root;
}

/**
 * The one block a file is really about, whatever it is called.
 *
 * `libraryfolders.vdf` wraps everything in `"libraryfolders"`, an appmanifest
 * in `"AppState"`, and Steam has renamed these before. Matched without regard
 * to case, and falling back to the only top-level block there is.
 */
function section(doc, name) {
  if (!doc || typeof doc !== 'object') return null;
  for (const [key, value] of Object.entries(doc)) {
    if (key.toLowerCase() === String(name).toLowerCase() && value && typeof value === 'object') return value;
  }
  const blocks = Object.values(doc).filter((v) => v && typeof v === 'object');
  return blocks.length === 1 ? blocks[0] : null;
}

/** A value from a block, case-insensitively: Steam is not consistent about it. */
function get(block, name) {
  if (!block || typeof block !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(block, name)) return block[name];
  const lower = String(name).toLowerCase();
  for (const [key, value] of Object.entries(block)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** A value as a number, or 0 -- these files hold every number as a string. */
function num(block, name) {
  const value = Number(get(block, name));
  return Number.isFinite(value) ? value : 0;
}

/** A value as a string, or ''. */
function str(block, name) {
  const value = get(block, name);
  return typeof value === 'string' ? value : '';
}

module.exports = { parse, section, get, num, str, readToken };
