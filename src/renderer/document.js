'use strict';

/**
 * Drawing the documents the viewer can read: Word, Excel, PowerPoint, archives.
 *
 * Split out of `viewer.js` because these four are the only views with real
 * structure in them -- everything else is one element with a source attribute.
 * Shares the page's globals like every other renderer script.
 *
 * ## The rule this file works to
 *
 * Show the content, not the page. None of this tries to look like Word: no
 * paper size, no margins, no fonts from the document, no attempt at the layout
 * somebody would get if they printed it. It tries to be *readable*, at the
 * window's width, with the structure intact -- headings that look like
 * headings, lists that look like lists, a table that lines up.
 *
 * That is a deliberate choice rather than a shortcut, and it is worth saying
 * why: a preview that half-imitates a page invites the reader to believe they
 * are seeing the document. They are not, and where the imitation fails they
 * will not know which part was missing. A view that is plainly a reading view
 * makes no such promise.
 *
 * ## No innerHTML, anywhere
 *
 * Every node here is built with `createElement` and `textContent`. These are
 * files the user did not write, roughly half of them are markup already, and a
 * preview pane is the last place to start parsing untrusted strings as HTML.
 *
 * Word is the one that arrives *as* HTML, because it is read by `mammoth` and
 * markup is what that library produces. It still never touches `innerHTML`:
 * `DOMParser` inspects it without running anything, and only the tags and
 * attributes on the two allowlists below are rebuilt into the page.
 */

/* ========================================================================== */
/* Word                                                                        */
/* ========================================================================== */

/**
 * Tags a Word document is allowed to become.
 *
 * Everything outside this list is dropped and its children kept, so an unknown
 * wrapper loses its box and never its words.
 */
const DOC_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sup', 'sub', 'mark', 'span',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'img', 'a',
]);

/** And the only attributes that survive with them. */
const DOC_ATTRS = {
  img: ['src', 'alt'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  a: ['href'],
};

function docView(file) {
  const doc = file.document;
  const page = document.createElement('article');
  page.className = 'doc';
  page.tabIndex = 0;

  /*
   * Parsed, then rebuilt node by node -- never `innerHTML`.
   *
   * The reader hands back HTML, and these are documents the user did not write.
   * `DOMParser` does not run anything it parses, and nothing crosses into the
   * page except the tags above with the attributes above, so a document cannot
   * bring its own behaviour with it however it was assembled.
   */
  const parsed = new DOMParser().parseFromString(doc.html || '', 'text/html');
  adopt(parsed.body, page);

  if (!page.childNodes.length) {
    page.appendChild(emptyLine(t('viewer.doc.empty', 'This document has no text in it.')));
  }
  if (doc.droppedImages) {
    page.appendChild(emptyLine(t('viewer.doc.droppedImages',
      '{n} pictures were too large to show here.', { n: formatCount(doc.droppedImages) })));
  }
  return page;
}

function adopt(source, target) {
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(node.nodeValue));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = node.tagName.toLowerCase();
    if (!DOC_TAGS.has(tag)) {
      // Unwrapped rather than removed: the words inside it are still the
      // document's, whatever the box around them was.
      adopt(node, target);
      continue;
    }

    if (tag === 'img') {
      target.appendChild(adoptImage(node));
      continue;
    }

    if (tag === 'a') {
      /*
       * A link is shown as a link and does not go anywhere.
       *
       * Nothing in this panel should be able to open a browser: these files
       * arrived by email, and a preview that follows their links turns reading
       * a document into visiting whoever sent it. The address is in the
       * tooltip, which is all anybody needs in order to decide.
       */
      const link = document.createElement('span');
      link.className = 'doc-link';
      const href = node.getAttribute('href');
      if (href) link.title = href;
      adopt(node, link);
      target.appendChild(link);
      continue;
    }

    const copy = document.createElement(tag);
    for (const name of DOC_ATTRS[tag] || []) {
      const value = node.getAttribute(name);
      if (value) copy.setAttribute(name, value);
    }
    adopt(node, copy);
    target.appendChild(copy);
  }
}

function adoptImage(node) {
  const src = node.getAttribute('src');
  // A picture the reader refused to carry, because it would not fit the
  // budget. Named, so the gap in the page is explained rather than blank.
  if (!src || !src.startsWith('data:')) {
    const missing = document.createElement('span');
    missing.className = 'doc-img-missing';
    missing.textContent = t('viewer.img.skipped', '[picture too large to show here]');
    return missing;
  }
  const img = document.createElement('img');
  img.className = 'doc-img';
  img.src = src;
  img.alt = node.getAttribute('alt') || '';
  img.loading = 'lazy';
  return img;
}

/**
 * One block of a slide: a line of text at its indent level, or a table.
 *
 * Word does not come through here -- that arrives as HTML and is rebuilt by
 * `adopt` above. This is PowerPoint's shape, and a table cell's contents, which
 * are the same shape again.
 */
function drawBlock(parent, block) {
  if (block.type === 'table') {
    parent.appendChild(drawTable(block));
    return;
  }

  const p = document.createElement('p');
  /*
   * Indented by level, and not given a bullet.
   *
   * PowerPoint keeps a slide's bullet characters in the layout and the master,
   * neither of which this reads, so drawing one would be a guess. The first
   * version guessed, and on a real deck it produced "• - Sân khấu hoá…" -- an
   * invented bullet in front of the dash the author had typed. Indentation
   * carries the nesting on its own.
   */
  p.className = `slide-p is-l${Math.min(block.level || 0, 8)}`;
  drawRuns(p, block.runs);
  parent.appendChild(p);
}

/**
 * The text of a slide line.
 *
 * Bold and italic only: those are the two a PowerPoint run carries directly,
 * and everything else a slide looks like comes from its theme, which this does
 * not read and will not guess at.
 */
function drawRuns(parent, runs) {
  for (const run of runs || []) {
    if (!run.text) continue;

    let node = document.createTextNode(run.text);
    if (run.b) node = wrap('strong', node);
    if (run.i) node = wrap('em', node);
    parent.appendChild(node);
  }
}

function wrap(tag, node) {
  const element = document.createElement(tag);
  element.appendChild(node);
  return element;
}

function drawTable(block) {
  const table = document.createElement('table');
  table.className = 'doc-table';
  const body = document.createElement('tbody');

  for (const row of block.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      if (cell.span > 1) td.colSpan = cell.span;
      for (const inner of cell.blocks) drawBlock(td, inner);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  table.appendChild(body);
  return table;
}

function drawPicture(picture) {
  if (picture.src) {
    const img = document.createElement('img');
    img.className = 'doc-img';
    img.src = picture.src;
    img.alt = '';
    img.loading = 'lazy';
    return img;
  }

  // Said, rather than left as a gap. A document that reads oddly because a
  // diagram is missing should say the diagram is missing.
  const missing = document.createElement('span');
  missing.className = 'doc-img-missing';
  missing.textContent = picture.skipped === 'format'
    ? t('viewer.img.format', '[picture in a format that cannot be shown: .{ext}]', { ext: picture.ext || '?' })
    : t('viewer.img.skipped', '[picture too large to show here]');
  return missing;
}

/* ========================================================================== */
/* Excel                                                                       */
/* ========================================================================== */

function sheetView(file) {
  const doc = file.document;
  const wrap = document.createElement('div');
  wrap.className = 'sheet';

  const visible = doc.sheets;
  if (!visible.length) {
    wrap.appendChild(emptyLine(t('viewer.sheet.none', 'This workbook has no sheets in it.')));
    return wrap;
  }

  if (viewer.sheetIndex >= visible.length) viewer.sheetIndex = 0;

  const grid = document.createElement('div');
  grid.className = 'sheet-grid';
  grid.tabIndex = 0;

  // Tabs, drawn only when there is a choice to make.
  if (visible.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'sheet-tabs';
    visible.forEach((sheet, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'sheet-tab';
      tab.textContent = sheet.name;
      if (sheet.hidden) {
        tab.classList.add('is-hidden-sheet');
        // A hidden sheet is often where the working is. Worth showing, worth
        // labelling, never worth pretending is a normal tab.
        tab.title = t('viewer.sheet.hidden', 'Hidden in Excel');
      }
      if (index === viewer.sheetIndex) tab.classList.add('is-on');
      tab.addEventListener('click', () => {
        viewer.sheetIndex = index;
        render(viewer.file);
      });
      tabs.appendChild(tab);
    });
    wrap.appendChild(tabs);
  }

  drawSheet(grid, visible[viewer.sheetIndex]);
  wrap.appendChild(grid);
  return wrap;
}

function drawSheet(parent, sheet) {
  if (sheet.missing) {
    parent.appendChild(emptyLine(t('viewer.sheet.missing', 'This sheet is referenced but not stored in the file.')));
    return;
  }
  if (!sheet.rows.length) {
    parent.appendChild(emptyLine(t('viewer.sheet.empty', 'This sheet is empty.')));
    return;
  }

  const columns = Math.max(1, sheet.colCount || 1);
  const covered = coveredCells(sheet.merges || []);

  const table = document.createElement('table');
  table.className = 'sheet-table';

  // The lettered strip along the top, so a reference in a conversation -- "look
  // at column F" -- still means something here.
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(cornerCell());
  for (let c = 1; c <= columns; c++) {
    const th = document.createElement('th');
    th.className = 'sheet-col';
    th.scope = 'col';
    th.textContent = columnName(c);
    const width = sheet.cols && sheet.cols[c - 1];
    // Excel's width unit is characters of the default font. Six pixels each is
    // close enough that a column sized for a date looks sized for a date.
    if (width) th.style.width = `${Math.min(Math.round(width * 7), 420)}px`;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  for (const row of sheet.rows) {
    const tr = document.createElement('tr');

    const gutter = document.createElement('th');
    gutter.className = 'sheet-row';
    gutter.scope = 'row';
    gutter.textContent = formatCount(row.r);
    tr.appendChild(gutter);

    const cells = new Map(row.cells.map((cell) => [cell.c, cell]));
    for (let c = 1; c <= columns; c++) {
      if (covered.has(`${row.r}:${c}`)) continue;
      const td = document.createElement('td');
      const span = spanAt(sheet.merges || [], row.r, c);
      if (span) {
        if (span.cols > 1) td.colSpan = span.cols;
        if (span.rows > 1) td.rowSpan = span.rows;
      }
      const cell = cells.get(c);
      if (cell) {
        td.textContent = cellText(cell);
        td.classList.add(`is-${cell.k}`);
        // The cached result of a formula, marked so nobody reads it as a typed
        // figure. What the formula was is deliberately not shown: this is a
        // reading view, not an audit.
        if (cell.f) td.classList.add('is-formula');
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  parent.appendChild(table);
}

function cornerCell() {
  const th = document.createElement('th');
  th.className = 'sheet-corner';
  return th;
}

/** Which coordinates are hidden underneath a merged range. */
function coveredCells(merges) {
  const covered = new Set();
  for (const merge of merges) {
    for (let r = merge.r1; r <= merge.r2; r++) {
      for (let c = merge.c1; c <= merge.c2; c++) {
        if (r === merge.r1 && c === merge.c1) continue;
        covered.add(`${r}:${c}`);
      }
    }
  }
  return covered;
}

function spanAt(merges, r, c) {
  for (const merge of merges) {
    if (merge.r1 === r && merge.c1 === c) {
      return { rows: merge.r2 - merge.r1 + 1, cols: merge.c2 - merge.c1 + 1 };
    }
  }
  return null;
}

/** 1 -> A, 27 -> AA. The same spiral as the file format's own references. */
function columnName(n) {
  let name = '';
  let value = n;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

/**
 * One cell, as text.
 *
 * Dates are formatted in UTC on purpose. The main process built the timestamp
 * in UTC because a spreadsheet date has no time zone -- an invoice dated the
 * 5th is the 5th everywhere -- and reading it back in local time is how it
 * arrives on screen as the 4th.
 */
function cellText(cell) {
  const locale = uiLocale();
  switch (cell.k) {
    case 'date':
      return new Date(cell.iso).toLocaleDateString(locale, { timeZone: 'UTC' });
    case 'datetime':
      return new Date(cell.iso).toLocaleString(locale, { timeZone: 'UTC' });
    case 'time':
      return cell.iso;
    case 'number':
      return cell.v.toLocaleString(locale, { maximumFractionDigits: 6 });
    case 'percent':
      return `${(cell.v * 100).toLocaleString(locale, { maximumFractionDigits: 2 })}%`;
    case 'bool':
      return cell.v ? t('viewer.cell.true', 'TRUE') : t('viewer.cell.false', 'FALSE');
    default:
      return String(cell.v);
  }
}

/* ========================================================================== */
/* PowerPoint                                                                  */
/* ========================================================================== */

function slidesView(file) {
  const doc = file.document;
  const wrap = document.createElement('div');
  wrap.className = 'deck';
  wrap.tabIndex = 0;

  if (!doc.slides.length) {
    wrap.appendChild(emptyLine(t('viewer.deck.empty', 'This presentation has no slides in it.')));
    return wrap;
  }

  for (const slide of doc.slides) {
    const card = document.createElement('section');
    card.className = 'slide';

    const head = document.createElement('div');
    head.className = 'slide-head';

    const number = document.createElement('span');
    number.className = 'slide-n';
    number.textContent = formatCount(slide.n);

    const title = document.createElement('h3');
    title.className = 'slide-title';
    title.textContent = slide.title || t('viewer.deck.untitled', 'Untitled slide');
    if (!slide.title) title.classList.add('is-untitled');

    head.append(number, title);
    card.appendChild(head);

    const bodyBlocks = slide.blocks || [];
    if (bodyBlocks.length) {
      const body = document.createElement('div');
      body.className = 'slide-body';
      for (const block of bodyBlocks) drawBlock(body, block);
      card.appendChild(body);
    }

    if (slide.images && slide.images.length) {
      const strip = document.createElement('div');
      strip.className = 'slide-images';
      for (const picture of slide.images) strip.appendChild(drawPicture(picture));
      card.appendChild(strip);
    }

    /*
     * Notes are shown, and shown last.
     *
     * They are frequently the only place the actual argument was written down
     * -- the slide says "Q3 results", the note says why they were bad -- and
     * they are the first thing lost when a deck goes. Last, because they are
     * not what was on the screen.
     */
    if (slide.notes) {
      const notes = document.createElement('div');
      notes.className = 'slide-notes';
      const label = document.createElement('span');
      label.className = 'slide-notes-label';
      label.textContent = t('viewer.deck.notes', 'Speaker notes');
      const text = document.createElement('p');
      text.textContent = slide.notes;
      notes.append(label, text);
      card.appendChild(notes);
    }

    wrap.appendChild(card);
  }

  return wrap;
}

/* ========================================================================== */
/* archives                                                                    */
/* ========================================================================== */

function archiveView(file) {
  const listing = file.archive;
  const wrap = document.createElement('div');
  wrap.className = 'archive';
  wrap.tabIndex = 0;

  const summary = document.createElement('p');
  summary.className = 'archive-summary';
  summary.textContent = t('viewer.archive.summary', '{n} files · {size} unpacked', {
    n: formatCount(listing.count),
    size: formatBytes(listing.total),
  });
  wrap.appendChild(summary);

  if (listing.encrypted) {
    const locked = document.createElement('p');
    locked.className = 'archive-locked';
    // Worth saying before somebody deletes the archive on the strength of its
    // file names: the names are readable even when the contents are not.
    locked.textContent = t('viewer.archive.encrypted', 'Some of the contents are password-protected.');
    wrap.appendChild(locked);
  }

  const table = document.createElement('table');
  table.className = 'archive-table';
  const body = document.createElement('tbody');

  for (const entry of listing.entries) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.className = 'archive-name';
    name.textContent = entry.name;
    name.title = entry.name;

    const size = document.createElement('td');
    size.className = 'archive-size';
    size.textContent = formatBytes(entry.size);

    const when = document.createElement('td');
    when.className = 'archive-when';
    when.textContent = entry.mtimeMs ? new Date(entry.mtimeMs).toLocaleDateString(uiLocale()) : '';

    tr.append(name, size, when);
    body.appendChild(tr);
  }

  table.appendChild(body);
  wrap.appendChild(table);

  if (listing.truncated) {
    wrap.appendChild(emptyLine(t('viewer.archive.more', 'Only the first {n} are listed.', {
      n: formatCount(listing.entries.length),
    })));
  }

  return wrap;
}

/* ========================================================================== */

function emptyLine(text) {
  const p = document.createElement('p');
  p.className = 'viewer-empty';
  p.textContent = text;
  return p;
}
