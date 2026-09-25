'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * What Explorer's right-click menu asked for (I3), read from a command line.
 *
 *   CleanDrive.exe --analyze="<folder or drive>"
 *   CleanDrive.exe --duplicates-of="<file>"
 *
 * One token each, `--flag=value`: Chromium reorders a command line's switches
 * and loose arguments, and a flag followed by its path as a separate word can
 * arrive with the path somewhere else. (`--flag <path>` is read too.)
 *
 * The command line is somebody else's input -- anything that can start the
 * exe can put anything after it -- so this only ever answers with a path that
 * is absolute, exists and is the right kind of thing, and the window is only
 * ever asked to *read* it: scan a folder, or look for copies of a file. It
 * never runs, opens or deletes what it is given. A second instance hands its
 * answer to the first through the single-instance lock, and the first checks
 * it again with `validate()`.
 */

const FLAGS = { '--analyze': 'analyze', '--duplicates-of': 'duplicates' };

/**
 * Explorer writes "%1" for C:\ as "C:\" and the command line's quoting turns
 * the backslash-quote into a quote: the path arrives as C:" .
 */
function clean(raw) {
  const text = String(raw).replace(/^"+/, '').replace(/"+$/, '');
  return text.length === 2 && text[1] === ':' ? `${text}\\` : text;
}

/**
 * @param {{kind: string, path: string}} target
 * @returns {{kind: 'analyze'|'duplicates', path: string} | null}
 */
function validate(target, fsImpl = fs) {
  if (!target || typeof target !== 'object') return null;
  const { kind } = target;
  if (kind !== 'analyze' && kind !== 'duplicates') return null;
  if (typeof target.path !== 'string' || !target.path || target.path.length > 32767) return null;
  const cleaned = clean(target.path);
  if (!path.isAbsolute(cleaned) || cleaned.includes('\0')) return null;
  const resolved = path.resolve(cleaned);
  let stat;
  try {
    stat = fsImpl.statSync(resolved);
  } catch {
    return null;
  }
  if (kind === 'analyze' && !stat.isDirectory()) return null;
  if (kind === 'duplicates' && !stat.isFile()) return null;
  return { kind, path: resolved };
}

/**
 * @param {string[]} argv
 * @param {object} [fsImpl]
 */
function parse(argv, fsImpl = fs) {
  if (!Array.isArray(argv)) return null;
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const kind = FLAGS[flag];
    if (!kind) continue;
    const value = eq > 0 ? arg.slice(eq + 1) : argv[i + 1];
    if (typeof value !== 'string' || !value || value.startsWith('--')) return null;
    return validate({ kind, path: value }, fsImpl);
  }
  return null;
}

module.exports = { parse, validate, clean, FLAGS };
