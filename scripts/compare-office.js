#!/usr/bin/env node
'use strict';

/**
 * The Office readers written here, against the ones you would install.
 *
 *   npm install --no-save xlsx officeparser
 *   node scripts/compare-office.js [outputFile] [--files a.xlsx,b.pptx] [--fragment]
 *
 * This exists to answer one question with evidence instead of opinion: is the
 * dependency worth it? The app has a standing rule against adding runtime
 * dependencies, and a rule held without ever testing it is a prejudice. So both
 * readers run over the same real files, their output is styled with the *same*
 * stylesheet, and the only thing that differs between the two columns is what
 * each one managed to get out of the file.
 *
 * The libraries here are deliberately not saved into `package.json`. Nothing
 * the app ships depends on them; they are here to be measured and then removed.
 *
 * ## Word is missing from this, and that is the result
 *
 * It was compared the same way and the library won, so `mammoth` is now a real
 * dependency and the reader written here is gone. Putting Word back on this
 * page would mean rendering mammoth's output twice.
 *
 * The margin was not in the word count -- on a two-thousand-word specification
 * the two agreed to within two words. It was that mammoth emits real nested
 * `<ol>` lists, which the browser numbers and restarts correctly by
 * construction, where a reader computing its own markers only has the restart
 * cases it has met so far.
 *
 * For the two below the comparison went the other way, which is why they stayed
 * hand-written: the spreadsheet library returns a grid with no row numbers or
 * column letters, so "look at column F" stops meaning anything; and no widely
 * used library renders PowerPoint at all -- the best available dropped three
 * slides of a sixty-six slide deck and returned no picture bytes whatsoever.
 *
 * ## What is being compared, and what is not
 *
 * Not speed -- both are fast enough that a person waiting for a preview cannot
 * tell them apart. Not code quality. What is compared is fidelity: how much of
 * the document survives, and which parts are lost.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { readOffice } = require('../src/main/lib/preview/office');

/* -------------------------------------------------------------------------- */
/* the libraries, loaded only if they are there                                */
/* -------------------------------------------------------------------------- */

function optional(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}

const sheetjs = optional('xlsx');
const officeparser = optional('officeparser');

/* -------------------------------------------------------------------------- */
/* finding real files                                                          */
/* -------------------------------------------------------------------------- */

const ZIP_MAGIC = 0x04034b50;

async function isZip(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const buf = Buffer.alloc(4);
    await handle.read(buf, 0, 4, 0);
    return buf.readUInt32LE(0) === ZIP_MAGIC;
  } catch {
    return false;
  } finally {
    if (handle) await handle.close();
  }
}

/**
 * One real document per extension, chosen by its bytes.
 *
 * Real files, because the whole question is what real files do. A fixture
 * proves the code runs; it does not show that one reader keeps a merged header
 * row and the other flattens it.
 */
async function findFiles(wanted, perExt) {
  const found = new Map(wanted.map((ext) => [ext, []]));
  const queue = ['Downloads', 'Documents', 'OneDrive', 'Desktop']
    .map((n) => path.join(os.homedir(), n))
    .filter((p) => fs.existsSync(p));
  let hops = 0;

  while (queue.length && hops++ < 9000) {
    if (wanted.every((ext) => found.get(ext).length >= perExt)) break;
    const dir = queue.shift();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !entry.name.startsWith('$') && entry.name !== 'node_modules') {
          queue.push(full);
        }
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith('~$')) continue;
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      const list = found.get(ext);
      if (!list || list.length >= perExt) continue;

      let size;
      try {
        size = (await fsp.stat(full)).size;
      } catch {
        continue;
      }
      if (size < 2000 || size > 40 * 1024 * 1024) continue;
      // An Office extension is not a promise: files turn up on a working
      // machine carrying one that are not an archive at all. Neither reader can
      // open those, so comparing them on one measures nothing.
      if (!(await isZip(full))) continue;
      list.push({ path: full, size });
    }
  }

  return found;
}

/* -------------------------------------------------------------------------- */
/* rendering: this app's readers                                               */
/* -------------------------------------------------------------------------- */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** A slide's runs. Bold and italic are all a PowerPoint run carries directly. */
function runsToHtml(runs) {
  let out = '';
  for (const run of runs || []) {
    if (!run.text) continue;
    let piece = esc(run.text);
    if (run.b) piece = `<strong>${piece}</strong>`;
    if (run.i) piece = `<em>${piece}</em>`;
    out += piece;
  }
  return out;
}

function blockToHtml(block) {
  if (block.type === 'table') {
    const rows = block.rows.map((row) => {
      const cells = row.map((cell) => {
        const span = cell.span > 1 ? ` colspan="${cell.span}"` : '';
        return `<td${span}>${cell.blocks.map(blockToHtml).join('')}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table class="doc-table"><tbody>${rows}</tbody></table>`;
  }
  return `<p class="slide-p is-l${Math.min(block.level || 0, 8)}">${runsToHtml(block.runs)}</p>`;
}

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

function cellToText(cell) {
  switch (cell.k) {
    case 'date': return new Date(cell.iso).toISOString().slice(0, 10);
    case 'datetime': return new Date(cell.iso).toISOString().slice(0, 16).replace('T', ' ');
    case 'time': return cell.iso;
    case 'number': return cell.v.toLocaleString('en-US', { maximumFractionDigits: 6 });
    case 'percent': return `${(cell.v * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
    case 'bool': return cell.v ? 'TRUE' : 'FALSE';
    default: return String(cell.v);
  }
}

function mineToHtml(result, format) {
  if (!result.ok) return `<p class="fail">Could not read: ${esc(result.why)}</p>`;

  if (format === 'sheet') {
    return result.sheets.map((sheet) => {
      if (!sheet.rows || !sheet.rows.length) {
        return `<h4 class="tabname">${esc(sheet.name)}</h4><p class="muted">empty</p>`;
      }
      const columns = Math.max(1, sheet.colCount || 1);
      const covered = new Set();
      for (const merge of sheet.merges || []) {
        for (let r = merge.r1; r <= merge.r2; r++) {
          for (let c = merge.c1; c <= merge.c2; c++) {
            if (r !== merge.r1 || c !== merge.c1) covered.add(`${r}:${c}`);
          }
        }
      }
      const head = `<tr><th class="sheet-corner"></th>${
        Array.from({ length: columns }, (_, i) => `<th class="sheet-col">${columnName(i + 1)}</th>`).join('')
      }</tr>`;
      const body = sheet.rows.map((row) => {
        const cells = new Map(row.cells.map((cell) => [cell.c, cell]));
        let out = `<th class="sheet-row">${row.r}</th>`;
        for (let c = 1; c <= columns; c++) {
          if (covered.has(`${row.r}:${c}`)) continue;
          const merge = (sheet.merges || []).find((mg) => mg.r1 === row.r && mg.c1 === c);
          const span = merge
            ? `${merge.c2 > merge.c1 ? ` colspan="${merge.c2 - merge.c1 + 1}"` : ''}${merge.r2 > merge.r1 ? ` rowspan="${merge.r2 - merge.r1 + 1}"` : ''}`
            : '';
          const cell = cells.get(c);
          out += cell
            ? `<td${span} class="is-${cell.k}">${esc(cellToText(cell))}</td>`
            : `<td${span}></td>`;
        }
        return `<tr>${out}</tr>`;
      }).join('');
      return `<h4 class="tabname">${esc(sheet.name)}${sheet.hidden ? ' <em>(hidden)</em>' : ''}</h4>`
        + `<div class="scroll"><table class="sheet-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    }).join('');
  }

  return result.slides.map((slide) => {
    const body = (slide.blocks || []).map((block) => (block.type === 'table'
      ? blockToHtml(block)
      : `<p class="slide-p is-l${Math.min(block.level || 0, 8)}">${runsToHtml(block.runs)}</p>`)).join('');
    const images = (slide.images || []).filter((p) => p.src)
      .map((p) => `<img class="doc-img slide-img" src="${p.src}" alt="">`).join('');
    const notes = slide.notes
      ? `<div class="slide-notes"><span class="slide-notes-label">Speaker notes</span><p>${esc(slide.notes)}</p></div>`
      : '';
    return `<section class="slide"><div class="slide-head"><span class="slide-n">${slide.n}</span>`
      + `<h3 class="slide-title">${esc(slide.title || 'Untitled slide')}</h3></div>`
      + `${body}${images ? `<div class="slide-images">${images}</div>` : ''}${notes}</section>`;
  }).join('');
}

/* -------------------------------------------------------------------------- */
/* rendering: the libraries                                                    */
/* -------------------------------------------------------------------------- */

async function theirsToHtml(file, format) {
  try {
    if (format === 'sheet') {
      if (!sheetjs) return { html: missing('xlsx (SheetJS)'), note: null };
      const workbook = sheetjs.read(await fsp.readFile(file), { cellDates: true, cellStyles: true });
      const html = workbook.SheetNames.map((name) => {
        /*
         * `header` and `footer` emptied on purpose.
         *
         * By default this returns a whole HTML *document* -- doctype, head,
         * title, body -- which is right for writing a file and wrong for
         * putting inside a page. Left as it came, every sheet nested a second
         * document inside this one.
         */
        const table = sheetjs.utils.sheet_to_html(workbook.Sheets[name], {
          editable: false, header: '', footer: '',
        });
        return `<h4 class="tabname">${esc(name)}</h4><div class="scroll">${table}</div>`;
      }).join('');
      return { html, note: null };
    }

    if (!officeparser) return { html: missing('officeparser'), note: null };
    const parsed = await officeparser.parseOffice(file);
    return {
      html: officeparserToHtml(parsed),
      /*
       * Stated on the page rather than left for the reader to notice.
       *
       * There is no widely used Node library that *renders* PowerPoint. This
       * one returns structure -- slides, headings, paragraphs, lists -- but no
       * picture bytes at all: it names each image and hands back an empty
       * attachment list. A deck whose content is mostly pictures therefore
       * comes back nearly empty, which is the single biggest difference on
       * this page.
       */
      note: 'Structure without pictures: this library names the images and returns none of them.',
    };
  } catch (err) {
    return { html: `<p class="fail">Threw: ${esc(err.message)}</p>`, note: null };
  }
}

/**
 * officeparser's slide tree, drawn with the same classes as everything else.
 *
 * It returns `content` as a list of slides, each with typed children --
 * heading, paragraph, list, table, image -- which is a good deal more than the
 * plain-text extractor its older API offered. Rendering it properly is the only
 * way the comparison is worth anything: a library shown at its worst proves
 * nothing about whether to install it.
 */
function officeparserToHtml(parsed) {
  const slides = Array.isArray(parsed.content) ? parsed.content : [];
  if (!slides.length) return '<p class="muted">Nothing returned.</p>';

  return slides.map((slide, index) => {
    const children = slide.children || [];
    const heading = children.find((node) => node.type === 'heading');
    const body = children.filter((node) => node !== heading).map((node) => {
      if (node.type === 'image') {
        // Named, never supplied: `attachments` comes back empty.
        return `<span class="doc-img-missing">[picture: ${esc((node.metadata && node.metadata.attachmentName) || 'unnamed')}]</span>`;
      }
      if (node.type === 'table') {
        const rows = (node.children || []).map((row) => `<tr>${
          (row.children || []).map((cell) => `<td>${esc(cell.text || '')}</td>`).join('')
        }</tr>`).join('');
        return `<table class="doc-table"><tbody>${rows}</tbody></table>`;
      }
      const level = (node.metadata && node.metadata.level) || 0;
      return `<p class="slide-p is-l${Math.min(level, 8)}">${esc(node.text || '')}</p>`;
    }).join('');

    return `<section class="slide"><div class="slide-head"><span class="slide-n">${index + 1}</span>`
      + `<h3 class="slide-title">${esc((heading && heading.text) || 'Untitled slide')}</h3></div>${body}</section>`;
  }).join('');
}

function missing(name) {
  return `<p class="muted">\`${esc(name)}\` is not installed. Run <code>npm install --no-save xlsx officeparser</code>.</p>`;
}

/* -------------------------------------------------------------------------- */
/* measuring                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The same crude count applied to both sides.
 *
 * Crude on purpose: counting tags in the finished HTML measures what actually
 * reached the page, which is the thing being compared. Counting each reader's
 * own data structures would measure two different vocabularies and prove
 * nothing.
 */
function measure(html) {
  const count = (re) => (html.match(re) || []).length;
  const text = html
    .replace(/<img[^>]*>/gi, '')
    /*
     * The stand-ins for pictures are removed before counting.
     *
     * They are text this script wrote, not text from the document, and leaving
     * them in awarded the reader that returns *no* pictures six thousand extra
     * characters for saying so two hundred and seventy-one times. That is the
     * opposite of what the column is measuring.
     */
    .replace(/<span class="doc-img-missing">[\s\S]*?<\/span>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    chars: text.length,
    headings: count(/<h[1-6][\s>]/gi),
    paragraphs: count(/<p[\s>]/gi),
    tables: count(/<table[\s>]/gi),
    cells: count(/<t[dh][\s>]/gi),
    images: count(/<img[\s>]/gi),
    links: count(/<a[\s>]/gi) + count(/class="doc-link"/g),
    bold: count(/<(strong|b)[\s>]/gi),
  };
}

/**
 * How many pictures one pane may carry.
 *
 * A sixty-six slide deck with two hundred and seventy images produced a
 * seventy-seven megabyte page -- unopenable, and useless as a comparison. The
 * cap is applied to both sides *after* they have been measured, so the counts
 * in the table are the real ones and only the page is smaller.
 */
const MAX_SHOWN_IMAGES = 10;

function capImages(html) {
  let kept = 0;
  let dropped = 0;
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!/src\s*=\s*"data:/i.test(tag)) return tag;
    if (kept < MAX_SHOWN_IMAGES) {
      kept++;
      return tag;
    }
    dropped++;
    return '<span class="doc-img-missing">[picture omitted from this page]</span>';
  });
  return dropped
    ? out.replace(/$/, `<p class="muted">${dropped} more pictures were read but left out of this comparison page to keep it openable.</p>`)
    : out;
}

/** Untrusted content from somebody's document, bound for a page. */
function sanitise(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, 'blocked:');
}

/* -------------------------------------------------------------------------- */
/* the page                                                                    */
/* -------------------------------------------------------------------------- */

const STYLE = fs.readFileSync(path.join(__dirname, 'compare-office.css'), 'utf8');

function statsRow(label, mine, theirs) {
  const cells = ['chars', 'headings', 'paragraphs', 'tables', 'cells', 'images', 'links', 'bold']
    .map((key) => {
      const a = mine[key];
      const b = theirs[key];
      const same = a === b;
      const better = a > b;
      return `<td class="${same ? '' : better ? 'more' : 'less'}">${a.toLocaleString('en-US')} <span class="vs">/ ${b.toLocaleString('en-US')}</span></td>`;
    }).join('');
  return `<tr><th>${esc(label)}</th>${cells}</tr>`;
}

/**
 * The documents to compare, either named or found.
 *
 * Naming them matters more than it looks. The search picks whatever it meets
 * first, and on a working machine that is as likely to be a contract or a
 * salary table as anything else -- fine for a report that stays on the disk,
 * not fine for one that is going to be shared. `--files` is how a comparison
 * gets made from documents somebody is willing to show.
 */
async function chooseFiles() {
  const flag = process.argv.find((a) => a.startsWith('--files='));
  if (!flag) return findFiles(['xlsx', 'pptx'], 2);

  const found = new Map([['xlsx', []], ['pptx', []]]);
  for (const entry of flag.slice('--files='.length).split(',')) {
    const file = entry.trim();
    if (!file) continue;
    const ext = path.extname(file).slice(1).toLowerCase();
    const list = found.get(ext);
    if (!list) {
      console.log(`  skipped (not an Office file): ${file}`);
      continue;
    }
    let size;
    try {
      size = (await fsp.stat(file)).size;
    } catch {
      console.log(`  skipped (not found): ${file}`);
      continue;
    }
    list.push({ path: file, size });
  }
  return found;
}

async function main() {
  const outArg = process.argv.find((a, i) => i > 1 && !a.startsWith('--'));
  const out = outArg || path.join(os.tmpdir(), 'cleandrive-office-comparison.html');

  const found = await chooseFiles();

  const sections = [];
  const rows = [];

  for (const [ext, list] of found) {
    const format = ext === 'xlsx' ? 'sheet' : 'slides';
    for (const file of list) {
      const name = path.basename(file.path);
      process.stdout.write(`  ${name.slice(0, 54).padEnd(56)}`);

      const t0 = Date.now();
      const mineResult = await readOffice(file.path, format, file.size);
      const mineMs = Date.now() - t0;
      const mineHtml = sanitise(mineToHtml(mineResult, format));

      const t1 = Date.now();
      const theirs = await theirsToHtml(file.path, format);
      const theirsMs = Date.now() - t1;
      const theirsHtml = sanitise(theirs.html);

      // Measured whole, then trimmed for the page: the table reports what each
      // reader found, not what survived the size limit.
      const a = measure(mineHtml);
      const b = measure(theirsHtml);
      const minePage = capImages(mineHtml);
      const theirsPage = capImages(theirsHtml);
      console.log(`${String(mineMs).padStart(5)}ms / ${String(theirsMs).padStart(5)}ms   ${a.chars} / ${b.chars} chars`);

      rows.push(statsRow(name, a, b));
      sections.push(`
<section class="file" id="f${sections.length}">
  <h2>${esc(name)}</h2>
  <p class="meta">.${ext} &middot; ${(file.size / 1024).toFixed(0)} KB</p>
  <div class="panes">
    <div class="pane">
      <header><span class="tag mine">Written here</span><span class="ms">${mineMs} ms &middot; no dependency</span></header>
      <div class="render">${minePage}</div>
    </div>
    <div class="pane">
      <header><span class="tag theirs">${esc(libraryFor(format))}</span><span class="ms">${theirsMs} ms</span></header>
      ${theirs.note ? `<p class="note">${esc(theirs.note)}</p>` : ''}
      <div class="render">${theirsPage}</div>
    </div>
  </div>
</section>`);
    }
  }

  const body = `<title>Office readers compared</title>
<style>${STYLE}</style>
<h1>Office readers: written here vs installed</h1>
<p class="lede">Every pair below is the same file, read twice and styled by the same stylesheet.
The only difference between two columns is what each reader got out of the document.</p>

<div class="verdict">
  <h2>What this decided</h2>
  <p><strong>Word now uses the library.</strong> It was compared the same way and
  <code>mammoth</code> won, so it is a real dependency and the Word reader written here is gone.
  The margin was not the word count &mdash; on a two-thousand-word specification the two agreed
  to within two words. It was that mammoth emits real nested <code>&lt;ol&gt;</code> lists, which
  the browser numbers and restarts correctly by construction, where a reader computing its own
  markers only ever has the restart cases it has already met. Word is absent from this page
  because putting it back would mean rendering mammoth's output twice.</p>
  <p><strong>Excel and PowerPoint stayed hand-written</strong>, on the evidence below: the
  spreadsheet library returns a grid with no row numbers and no column letters, so
  &ldquo;look at column F&rdquo; stops meaning anything; and no widely used library
  <em>renders</em> PowerPoint at all &mdash; the best available dropped three slides of a
  sixty-six slide deck and returned no picture bytes whatsoever.</p>
</div>

<table class="stats">
  <thead><tr><th>file</th><th>chars</th><th>headings</th><th>paragraphs</th><th>tables</th><th>cells</th><th>images</th><th>links</th><th>bold</th></tr></thead>
  <tbody>${rows.join('')}</tbody>
</table>
<p class="legend">Each cell is <strong>written here</strong> / <span class="vs">library</span>.
Green means this app's reader found more, amber means it found less.</p>

${sections.join('')}`;

  /*
   * Two shapes, one page.
   *
   * A file opened from the disk needs the whole document; a page published as
   * an artifact is wrapped in its own skeleton at publish time and must not
   * bring a second one. Only the wrapper differs -- the comparison itself is
   * the same bytes either way.
   */
  const page = process.argv.includes('--fragment')
    ? body
    : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${body}\n</body>\n</html>`;

  await fsp.writeFile(out, page, 'utf8');
  console.log(`\n  ${(Buffer.byteLength(page) / 1024 / 1024).toFixed(1)} MB written to ${out}\n`);
}

function libraryFor(format) {
  if (format === 'sheet') return `SheetJS ${sheetjs ? sheetjs.version : '(missing)'}`;
  return 'officeparser';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
