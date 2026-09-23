'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { protocol, net } = require('electron');

/**
 * Handing a file's bytes to the window, without handing it the filesystem.
 *
 * ## Why a protocol at all
 *
 * The renderer runs under `default-src 'none'` and cannot navigate away from
 * the bundled files, so it has no way to reach anything on disk. Thumbnails get
 * around that by arriving as `data:` URIs, which is fine for nine kilobytes and
 * absurd for a forty-megabyte PDF or a video.
 *
 * So the main process serves them, under a scheme of its own, and the policy
 * widens by exactly one word. Measured before it was built: an `<iframe>`
 * pointing at this scheme still gets **Chromium's own PDF viewer** -- pages,
 * zoom, search, print -- inside a page whose CSP is otherwise unchanged, with
 * no console errors. A `<video>` and an `<img>` stream from it the same way.
 *
 * ## The renderer never names a path
 *
 * This is the part that makes the widening defensible. The window asks to
 * preview a file, the main process vets it and answers with an opaque token,
 * and the URL the window then loads is `cleandrive://<token>/`. Nothing the
 * renderer can say will fetch a file the main process did not already decide to
 * allow -- there is no path in the request to tamper with, and a token for a
 * file nobody asked about does not exist.
 *
 * Tokens are forgotten when the preview closes and when the app quits, so the
 * list is only ever as long as what is on screen.
 */

/** Scheme name. Appears in `index.html`'s CSP, so it is short and obviously ours. */
const SCHEME = 'cleandrive';

/**
 * Registered before `app.whenReady`, which Electron requires.
 *
 * `standard` gives it normal URL parsing, `secure` keeps it out of Chromium's
 * mixed-content rules, and `stream` is what lets a large file arrive in pieces
 * rather than being buffered whole -- the difference between previewing a
 * 300 MB video and allocating 300 MB to do it.
 */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** token -> absolute path. Cleared when the preview closes. */
const granted = new Map();

/** Beyond this a "preview" is a download; the viewer offers the real program instead. */
const MAX_SERVED_BYTES = 512 * 1024 * 1024;

/**
 * Let one file be fetched, and say under what name.
 *
 * @param {string} filePath  already vetted by the caller
 * @returns {string} the token
 */
function grant(filePath) {
  const token = crypto.randomBytes(16).toString('hex');
  granted.set(token, path.resolve(filePath));
  return token;
}

/** Forget everything. Called when the preview closes. */
function revokeAll() {
  granted.clear();
}

function pathFor(token) {
  return granted.get(token) || null;
}

/**
 * Answer requests on the scheme. Called once, after `app.whenReady`.
 */
function serve() {
  protocol.handle(SCHEME, async (request) => {
    let token;
    try {
      // `standard: true` means the token lands in the host position, which is
      // the one part of a URL Chromium normalises for us.
      token = new URL(request.url).hostname;
    } catch {
      return new Response('bad request', { status: 400 });
    }

    const target = pathFor(token);
    if (!target) {
      // Either a token that was never issued, or one from a preview that has
      // since been closed. Both are the same answer.
      return new Response('not found', { status: 404 });
    }

    try {
      const stats = await fsp.stat(target);
      if (!stats.isFile()) return new Response('not a file', { status: 404 });
      if (stats.size > MAX_SERVED_BYTES) return new Response('too large', { status: 413 });
    } catch {
      return new Response('not found', { status: 404 });
    }

    // `net.fetch` on a file URL streams it and sets a content type from the
    // extension, which is what makes Chromium pick its PDF viewer. The bypass
    // flag stops it coming back through this same handler.
    return net.fetch(pathToFileUrl(target), { bypassCustomProtocolHandlers: true });
  });
}

/**
 * A Windows path as a URL.
 *
 * `encodeURI` rather than raw interpolation, because these paths routinely
 * contain spaces, `#` and Vietnamese characters -- and a `#` turns the rest of
 * a path into a fragment, which silently fetches the wrong file or none.
 */
function pathToFileUrl(target) {
  return `file:///${encodeURI(target.replace(/\\/g, '/')).replace(/#/g, '%23')}`;
}

module.exports = {
  SCHEME,
  registerScheme,
  serve,
  grant,
  revokeAll,
  pathFor,
  pathToFileUrl,
  MAX_SERVED_BYTES,
};
