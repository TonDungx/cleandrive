'use strict';

const { scan, attr } = require('./xml');
const { readRels, imageBudget } = require('./ooxml');

/**
 * Reading a PowerPoint deck.
 *
 * ## What a slide preview can honestly be
 *
 * Not a slide. A slide is a layout -- every shape carries its position in
 * English Metric Units, over a background inherited from a layout which
 * inherits from a master -- and reproducing that means reimplementing the
 * renderer, at which point the app is a presentation program.
 *
 * So this shows each slide as what it contains: its title, its text in order
 * and at the right indent level, its tables, and its pictures. Somebody
 * deciding whether a deck from 2023 is still needed gets that from the words
 * and the images, and gets nothing at all from the geometry.
 *
 * Speaker notes are included, because they are frequently the only place the
 * actual argument was written down, and they are the first thing lost when a
 * deck is deleted.
 *
 * ## Order comes from the presentation, not from the archive
 *
 * `ppt/slides/slide10.xml` sorts before `slide2.xml` as a string, and slides
 * keep their original file name when they are reordered, so neither the
 * directory order nor the file names are the deck's order. Only the id list in
 * `ppt/presentation.xml` is.
 */

const MAX_SLIDES = 200;
const MAX_CHARS_PER_SLIDE = 20000;

function readPptx(zip) {
  const presentation = zip.read('ppt/presentation.xml');
  if (!presentation) {
    const err = new Error('pptx: no ppt/presentation.xml');
    err.code = 'NOT_A_PPTX';
    throw err;
  }

  const rels = readRels(zip, 'ppt/presentation.xml');
  const order = [];
  scan(presentation.toString('utf8'), {
    open(local, attrs) {
      if (local !== 'sldId') return;
      const id = attr(attrs, 'id2') || attr(attrs, 'id');
      // `r:id` is the relationship; `id` is PowerPoint's own slide id. The
      // attribute helper matches on local name, so `r:id` and `id` both answer
      // to 'id' -- the relationship one is the one with a prefix, and it is
      // read explicitly here rather than by luck.
      const relId = attrs && (attrs['r:id'] || pickRelId(attrs));
      const rel = relId && rels.get(relId);
      if (rel) order.push(rel.target);
      else if (id) order.push(null);
    },
  });

  const inline = imageBudget(zip);
  const slides = [];
  let truncated = order.length > MAX_SLIDES;

  for (const part of order.slice(0, MAX_SLIDES)) {
    if (!part) continue;
    const raw = zip.read(part);
    if (!raw) continue;

    const slideRels = readRels(zip, part);
    const slide = readSlide(raw.toString('utf8'), slideRels, inline);
    slide.n = slides.length + 1;
    slide.notes = readNotes(zip, slideRels);
    if (slide.truncated) truncated = true;
    slides.push(slide);
  }

  return { slides, truncated };
}

function pickRelId(attrs) {
  for (const key in attrs) {
    if (key.endsWith(':id')) return attrs[key];
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */

function readSlide(source, rels, inline) {
  const blocks = [];
  const images = [];
  let title = '';

  // Which placeholder the shape being read fills, if any.
  let placeholder = null;
  let shapeBlocks = null;

  let para = null;
  let fmt = { b: false, i: false };
  let inT = 0;
  let pending = '';
  let chars = 0;
  let truncated = false;

  // Tables inside a slide.
  const tables = [];
  const rows = [];
  let cellBlocks = null;

  const target = () => cellBlocks || shapeBlocks || blocks;

  function endParagraph() {
    if (!para) return;
    const text = para.runs.map((r) => r.text).join('');
    if (text.trim()) target().push(para);
    para = null;
  }

  function pushRun(text) {
    if (!para || !text) return;
    if (chars + text.length > MAX_CHARS_PER_SLIDE) {
      truncated = true;
      return;
    }
    chars += text.length;
    const last = para.runs[para.runs.length - 1];
    if (last && Boolean(last.b) === fmt.b && Boolean(last.i) === fmt.i) {
      last.text += text;
      return;
    }
    const run = { text };
    if (fmt.b) run.b = true;
    if (fmt.i) run.i = true;
    para.runs.push(run);
  }

  scan(source, {
    open(local, attrs) {
      switch (local) {
        case 'ph':
          placeholder = attr(attrs, 'type') || 'body';
          return;

        case 'sp':
          placeholder = null;
          shapeBlocks = [];
          return;

        case 'txBody':
          return;

        case 'p':
          endParagraph();
          para = { type: 'text', level: 0, runs: [] };
          return;

        case 'pPr': {
          if (!para) return;
          const level = Number(attr(attrs, 'lvl'));
          if (Number.isFinite(level)) para.level = level;
          return;
        }

        case 'buNone': if (para) para.noBullet = true; return;

        case 'rPr': {
          fmt = {
            b: attr(attrs, 'b') === '1',
            i: attr(attrs, 'i') === '1',
          };
          return;
        }

        case 't': inT++; pending = ''; return;
        case 'br': pushRun('\n'); return;

        case 'blip': {
          const id = attr(attrs, 'embed');
          const rel = id && rels.get(id);
          if (!rel || rel.external) return;
          const picture = inline(rel.target);
          if (picture && picture.src) images.push(picture);
          return;
        }

        case 'tbl': {
          const table = { type: 'table', rows: [] };
          endParagraph();
          (shapeBlocks || blocks).push(table);
          tables.push(table);
          return;
        }
        case 'tr': {
          if (!tables.length) return;
          const row = [];
          tables[tables.length - 1].rows.push(row);
          rows.push(row);
          return;
        }
        case 'tc': {
          if (!rows.length) return;
          const cell = { blocks: [] };
          rows[rows.length - 1].push(cell);
          cellBlocks = cell.blocks;
          return;
        }
        case 'gridSpan': {
          const row = rows[rows.length - 1];
          const cell = row && row[row.length - 1];
          const span = Number(attr(attrs, 'val'));
          if (cell && Number.isFinite(span) && span > 1) cell.span = span;
          return;
        }

        default:
      }
    },

    text(value) {
      if (inT) pending += value;
    },

    close(local) {
      switch (local) {
        case 't':
          if (inT) {
            inT--;
            pushRun(pending);
            pending = '';
          }
          return;

        case 'p': endParagraph(); return;

        case 'tc': cellBlocks = null; return;
        case 'tr': rows.pop(); return;
        case 'tbl': tables.pop(); return;

        case 'sp': {
          endParagraph();
          if (!shapeBlocks) return;
          const isTitle = placeholder === 'title' || placeholder === 'ctrTitle';
          if (isTitle && !title) {
            title = shapeBlocks
              .filter((b) => b.type === 'text')
              .map((b) => b.runs.map((r) => r.text).join(''))
              .join(' ')
              .trim();
            // The title is shown in the slide's heading, so repeating it in the
            // body would print it twice on every slide.
            shapeBlocks = shapeBlocks.filter((b) => b.type !== 'text');
          }
          blocks.push(...shapeBlocks);
          shapeBlocks = null;
          placeholder = null;
          return;
        }

        default:
      }
    },
  });

  endParagraph();
  if (shapeBlocks) blocks.push(...shapeBlocks);

  return { title, blocks, images, truncated };
}

/**
 * The speaker notes for a slide, if there are any.
 *
 * A notes page carries a copy of the slide itself as a thumbnail placeholder,
 * which holds the slide's text again. Only the body placeholder is wanted, and
 * the copy is what the `sldNum` and `body`-with-no-text shapes are; taking the
 * whole part put every slide's own text into its notes.
 */
function readNotes(zip, slideRels) {
  let part = null;
  for (const rel of slideRels.values()) {
    if (/notesSlide\d*\.xml$/.test(rel.target)) {
      part = rel.target;
      break;
    }
  }
  if (!part) return '';

  const raw = zip.read(part);
  if (!raw) return '';

  const pieces = [];
  let placeholder = null;
  let keep = false;
  let inT = 0;
  let pending = '';
  let paragraph = '';

  scan(raw.toString('utf8'), {
    open(local, attrs) {
      if (local === 'sp') { placeholder = null; keep = false; return; }
      if (local === 'ph') {
        placeholder = attr(attrs, 'type') || 'body';
        keep = placeholder === 'body';
        return;
      }
      if (local === 't') { inT++; pending = ''; }
    },
    text(value) { if (inT) pending += value; },
    close(local) {
      if (local === 't' && inT) {
        inT--;
        if (keep) paragraph += pending;
        pending = '';
      } else if (local === 'p') {
        if (keep && paragraph.trim()) pieces.push(paragraph.trim());
        paragraph = '';
      } else if (local === 'sp') {
        keep = false;
      }
    },
  });

  return pieces.join('\n');
}

module.exports = { readPptx, MAX_SLIDES };
