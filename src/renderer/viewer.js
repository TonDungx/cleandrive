'use strict';

/**
 * The file viewer.
 *
 * Shares `app.js`'s globals the way the other renderer scripts do. Loaded after
 * it, and before the screens that use it, because every one of them calls
 * `openViewer` from a file row.
 *
 * ## One panel, every screen
 *
 * This is not a feature of the photo tab. The question the whole app asks is
 * "should this go?", and a list of filenames cannot answer it. So every file
 * row everywhere gets the same button, and it opens the same panel.
 *
 * ## What it will not do
 *
 * Show a format it cannot show honestly. A binary it does not understand gets
 * its size and its date and an offer of the program that owns it -- not a hex
 * dump, which has never once helped anybody decide whether to delete something
 * and would be exactly the false confidence this app is written against.
 */

const viewer = {
  /** The file currently open, or null. */
  file: null,
  /** Where focus was before it opened, so Escape can put it back. */
  returnFocus: null,
  /** Which tab of a workbook is showing. Reset for each file, not each redraw. */
  sheetIndex: 0,
};

/* ------------------------------------------------------------------ opening */

/**
 * Show a file.
 *
 * @param {string} filePath
 */
async function openViewer(filePath) {
  if (!filePath) return;

  viewer.returnFocus = document.activeElement;
  // A new file starts on its first tab. Carrying the last workbook's tab index
  // over opens the next one on sheet four for no reason anybody could see.
  viewer.sheetIndex = 0;
  $('viewer').hidden = false;
  $('viewer-name').textContent = filePath.split(/[\\/]/).pop();
  $('viewer-name').title = filePath;
  $('viewer-facts').textContent = t('viewer.reading', 'Reading…');
  $('viewer-body').replaceChildren();
  $('viewer-close').focus();

  const result = unwrap(await api.preview(filePath), t('viewer.label', 'Preview'));
  // The panel may have been closed, or another file opened, while this was in
  // flight. Drawing the answer to a question nobody is asking any more would
  // replace what is on screen with something the user did not ask for.
  if (!result || $('viewer').hidden) return;
  if (viewer.file && viewer.file.path !== filePath && result.path !== filePath) return;

  viewer.file = result;
  render(result);
}

function closeViewer() {
  if ($('viewer').hidden) return;
  $('viewer').hidden = true;
  // Emptying it stops a video carrying on playing behind a closed panel, and
  // drops the reference that keeps a large picture in memory.
  $('viewer-body').replaceChildren();
  viewer.file = null;
  api.closePreview();

  if (viewer.returnFocus && typeof viewer.returnFocus.focus === 'function') {
    viewer.returnFocus.focus();
  }
  viewer.returnFocus = null;
}

/* ------------------------------------------------------------------ drawing */

function render(file) {
  $('viewer-name').textContent = file.name;
  $('viewer-name').title = file.path;
  $('viewer-facts').textContent = factsLine(file);

  const body = $('viewer-body');
  body.replaceChildren();
  // The format is carried alongside the kind because the three Office views are
  // laid out quite differently and the stylesheet needs to tell them apart.
  body.className = file.kind === 'office'
    ? `viewer-body is-office is-${file.format}`
    : `viewer-body is-${file.kind}`;

  switch (file.kind) {
    case 'text': body.appendChild(textView(file)); break;
    case 'image': body.appendChild(imageView(file)); break;
    case 'pdf': body.appendChild(frameView(file)); break;
    case 'video': body.appendChild(videoView(file)); break;
    case 'audio': body.appendChild(audioView(file)); break;
    case 'office': body.appendChild(documentView(file)); break;
    case 'archive': body.appendChild(archiveView(file)); break;
    default: body.appendChild(noteView(file)); break;
  }

  if (file.note && file.kind === 'text') body.prepend(noticeLine(tm(file.note)));

  // Said out loud whenever a document was too big to show whole, for the same
  // reason a truncated log says so: a viewer that quietly shows the first part
  // of something is a viewer that will eventually be believed about the rest.
  if (file.document && file.document.truncated) {
    body.prepend(noticeLine(t('viewer.doc.truncated',
      'This is large — only the first part is shown here.')));
  }
}

/** The line under the filename: what this is, how big, and when it changed. */
function factsLine(file) {
  const parts = [];
  /*
   * For a document the extension is the name people know it by; for a picture
   * the detected format is the useful one, because it is occasionally not what
   * the name claims. "SHEET · 99.6 KB" told nobody anything.
   */
  if (file.kind === 'office' || file.kind === 'archive') {
    if (file.ext) parts.push(`.${file.ext}`);
  } else if (file.format) {
    parts.push(String(file.format).toUpperCase());
  }

  if (file.size) parts.push(formatBytes(file.size));
  if (file.lines) {
    parts.push(t('viewer.lines', '{n} lines', { n: formatCount(file.lines) }));
  }
  parts.push(...documentFacts(file));
  // Said out loud, because a viewer that silently shows the first fraction of
  // a log is a viewer that once told somebody the log was empty.
  if (file.truncated) {
    parts.push(t('viewer.truncated', 'showing the first {size}', { size: formatBytes(file.bytesRead) }));
  }
  // Only when it is not the obvious one: "UTF-8" on every file is noise, and
  // "Windows-1258" is the thing worth seeing, because it explains the accents.
  if (file.encoding && file.encoding !== 'UTF-8') parts.push(file.encoding);
  if (file.mtimeMs) parts.push(new Date(file.mtimeMs).toLocaleString(uiLocale()));
  return parts.join(' · ');
}

/**
 * What is worth saying about a document, beyond its size.
 *
 * The count of the thing the format is measured in -- sheets, slides, files --
 * because that is what somebody asks about a document they half-remember.
 */
function documentFacts(file) {
  const facts = [];
  const doc = file.document;

  if (doc && Array.isArray(doc.sheets)) {
    facts.push(t('viewer.facts.sheets', '{n} sheets', { n: formatCount(doc.sheets.length) }));
  }
  if (doc && Array.isArray(doc.slides)) {
    facts.push(t('viewer.facts.slides', '{n} slides', { n: formatCount(doc.slides.length) }));
  }
  if (doc && doc.images) {
    facts.push(t('viewer.facts.images', '{n} pictures', { n: formatCount(doc.images) }));
  }
  if (file.archive) {
    facts.push(t('viewer.facts.entries', '{n} files', { n: formatCount(file.archive.count) }));
  }
  return facts;
}

/**
 * Word, Excel or PowerPoint.
 *
 * The three views live in `document.js`; this is only the fork. A format that
 * was classified as a document but has no view falls back to the honest note,
 * which is the same thing that happens for anything else unshowable.
 */
function documentView(file) {
  switch (file.format) {
    case 'word': return docView(file);
    case 'sheet': return sheetView(file);
    case 'slides': return slidesView(file);
    default: return noteView(file);
  }
}

function textView(file) {
  const pre = document.createElement('pre');
  pre.className = 'viewer-text';
  pre.tabIndex = 0;
  // `textContent`, never `innerHTML`. The whole point of this panel is showing
  // files the user did not write, and half of them are markup.
  pre.textContent = file.text;
  return pre;
}

function imageView(file) {
  const img = document.createElement('img');
  img.className = 'viewer-image';
  img.src = url(file.token);
  img.alt = file.name;
  return img;
}

/**
 * A PDF, in Chromium's own viewer.
 *
 * An `<iframe>` on the app's scheme, which was measured rather than hoped for:
 * it gets the full viewer -- pages, thumbnails, zoom, search, print -- with no
 * dependency and no console errors under the page's policy.
 */
function frameView(file) {
  const frame = document.createElement('iframe');
  frame.className = 'viewer-frame';
  frame.src = url(file.token);
  frame.title = file.name;
  return frame;
}

function videoView(file) {
  const video = document.createElement('video');
  video.className = 'viewer-video';
  video.src = url(file.token);
  video.controls = true;
  // Never autoplay. A folder of videos that each start shouting when clicked is
  // not a preview, it is an ambush.
  video.preload = 'metadata';
  return video;
}

function audioView(file) {
  const wrap = document.createElement('div');
  wrap.className = 'viewer-audio';
  const audio = document.createElement('audio');
  audio.src = url(file.token);
  audio.controls = true;
  audio.preload = 'metadata';
  wrap.appendChild(audio);
  return wrap;
}

/**
 * What to say about a file that cannot be shown.
 *
 * Plainly, and with the way out: the program that owns it is one button away,
 * and that is a better answer than a wall of bytes.
 */
function noteView(file) {
  const wrap = document.createElement('div');
  wrap.className = 'viewer-note';

  const icon = document.createElement('span');
  icon.className = 'viewer-note-ext';
  icon.textContent = file.ext ? `.${file.ext}` : t('viewer.noExtension', 'no extension');

  const text = document.createElement('p');
  text.textContent = file.note
    ? tm(file.note)
    : t('viewer.note.unknown', 'Not a format this app can show.');

  wrap.append(icon, text);
  return wrap;
}

function noticeLine(text) {
  const p = document.createElement('p');
  p.className = 'viewer-notice';
  p.textContent = text;
  return p;
}

/**
 * The URL for a granted file.
 *
 * A token, never a path. The main process decides what each token means and
 * forgets them all when the panel closes, so there is nothing here the renderer
 * could rewrite into a request for something else.
 */
function url(token) {
  return `cleandrive://${token}/`;
}

/* ------------------------------------------------------------------ wiring */

$('viewer-close').addEventListener('click', closeViewer);

$('viewer-reveal').addEventListener('click', () => {
  if (viewer.file) api.reveal(viewer.file.path);
});

$('viewer-open').addEventListener('click', async () => {
  if (!viewer.file) return;
  unwrap(await api.open(viewer.file.path), t('app.open', 'Open'));
});

// Escape closes it, and clicking the backdrop does too. Both are what a panel
// over the top of everything has to answer to.
$('viewer').addEventListener('click', (event) => {
  if (event.target === $('viewer')) closeViewer();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('viewer').hidden) {
    closeViewer();
    // Stop it reaching the grid, which clears the selection on Escape. Closing
    // a preview should not also throw away what somebody had chosen.
    event.stopPropagation();
    event.preventDefault();
  }
}, true);

onLanguageChange(() => {
  if (viewer.file && !$('viewer').hidden) render(viewer.file);
});
