'use strict';

/**
 * One self-contained HTML file (G2).
 *
 * Something a person can email to whoever fixes their computer, open on a
 * machine that has never heard of CleanDrive, and still read in five years.
 * So: no script tags that run, no stylesheet to fetch, no font to download, no
 * image to load. Inline CSS, inline SVG, and the numbers themselves embedded
 * as JSON so the file is also the data rather than a picture of it.
 *
 * This file does no I/O and knows nothing about the app's services. It takes
 * the object `report/collect.js` gathered -- already redacted, if private mode
 * is on -- and returns a string.
 *
 * ## Escaping is the whole risk
 *
 * Every value here came off somebody's disk. A folder called
 * `</script><img src=x onerror=alert(1)>` is a legal Windows folder name, and
 * it reaches this file as text. Two rules, and `scripts/test-report.js` runs
 * both against exactly that name:
 *
 *   - every value goes through `esc` before it touches markup;
 *   - the embedded JSON goes through `jsonBlock`, which breaks up the one
 *     sequence an HTML parser looks for inside a script element.
 *
 * `<script type="application/json">` is not executed by anything -- the type
 * is not a script type -- but an unescaped `</script>` inside it still ends
 * the element early and the rest of the JSON becomes markup.
 *
 * ## Why there is no dark-mode toggle
 *
 * A toggle needs script, and this file has none that runs. It follows
 * `prefers-color-scheme` instead, which is the reader's own setting.
 */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Every value that reaches markup goes through this. No exceptions. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * The data, embedded so it can be taken back out.
 *
 * `</` is split so no closing tag can appear inside the element, whatever the
 * data holds; `<` is the same character to every JSON parser, so what
 * comes back out is byte-identical to what went in. U+2028 and U+2029 are
 * escaped too: they are legal in JSON strings and terminate a line in some
 * parsers.
 */
function jsonBlock(data) {
  return JSON.stringify(data, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/* -------------------------------------------------------------------------- */
/* numbers, as a reader reads them                                             */
/* -------------------------------------------------------------------------- */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

function bytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  const sign = n < 0 ? '−' : '';
  let size = Math.abs(n);
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${sign}${unit === 0 ? Math.round(size) : size.toFixed(size >= 100 ? 0 : 1)} ${UNITS[unit]}`;
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-GB') : '–';
}

/**
 * A date, written out rather than localised.
 *
 * The report is opened by somebody else, on another machine, possibly in
 * another country. `2026-09-28 14:05` is the one form that means the same
 * thing everywhere, and it sorts.
 */
function when(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '–';
  const d = new Date(n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const percent = (value) => (Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '–');

/* -------------------------------------------------------------------------- */
/* pieces                                                                      */
/* -------------------------------------------------------------------------- */

/** A section that had no data, saying where the data would come from. */
function missing(title, reason) {
  return `<section class="card missing">
      <h2>${esc(title)}</h2>
      <p class="none">${esc(reason)}</p>
    </section>`;
}

function table(headings, rows, { align = [] } = {}) {
  if (rows.length === 0) return '';
  const head = headings.map((h, i) => `<th${align[i] === 'r' ? ' class="r"' : ''}>${esc(h)}</th>`).join('');
  const body = rows
    .map((cells) => `<tr>${cells.map((c, i) => `<td${align[i] === 'r' ? ' class="r"' : ''}>${esc(c)}</td>`).join('')}</tr>`)
    .join('\n        ');
  return `<table><thead><tr>${head}</tr></thead><tbody>\n        ${body}\n      </tbody></table>`;
}

/**
 * A bar whose width is a share of the whole, drawn with a div rather than SVG.
 *
 * It is one rectangle; an SVG element to draw one rectangle is more markup
 * than the rectangle.
 */
function bar(share) {
  const width = Math.max(0, Math.min(100, Number(share) || 0));
  return `<span class="bar"><span class="bar-fill" style="width:${width.toFixed(2)}%"></span></span>`;
}

/**
 * The disk-usage chart, as inline SVG built from a string.
 *
 * The same shape the Trends tab draws, and the same scale rule: a range of
 * less than five percentage points is widened, because auto-scaling to a
 * fifth of a point turns noise into a cliff.
 */
function chart(input, { width = 720, height = 220 } = {}) {
  // A reading with no percentage in it cannot be plotted, and one bad row must
  // not take the page down: a history file written by an older build, or
  // edited by hand, is exactly the sort of thing this report is asked to
  // describe. Such rows are dropped, and if too few are left there is no
  // chart -- which the section above already knows how to say.
  const series = (Array.isArray(input) ? input : []).filter(
    (p) => p && Number.isFinite(p.at) && Number.isFinite(p.usedPercent)
  );
  if (series.length < 2) return '';

  const padLeft = 46;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 26;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const times = series.map((p) => p.at);
  const values = series.map((p) => p.usedPercent);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);

  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < 5) {
    const mid = (high + low) / 2;
    low = mid - 2.5;
    high = mid + 2.5;
  }
  const pad = (high - low) * 0.12;
  low = Math.max(0, low - pad);
  high = Math.min(100, high + pad);
  if (high <= low) high = low + 1;

  const x = (t) => padLeft + (tMax === tMin ? plotWidth : ((t - tMin) / (tMax - tMin)) * plotWidth);
  const y = (v) => padTop + plotHeight - ((v - low) / (high - low)) * plotHeight;

  const parts = [];
  for (let i = 0; i <= 4; i++) {
    const value = low + ((high - low) * i) / 4;
    const yy = y(value).toFixed(2);
    parts.push(`<line class="grid" x1="${padLeft}" x2="${width - padRight}" y1="${yy}" y2="${yy}"/>`);
    parts.push(`<text class="tick" x="4" y="${(y(value) + 3).toFixed(2)}">${esc(value.toFixed(value >= 10 ? 0 : 1))}%</text>`);
  }

  const points = series.map((p) => `${x(p.at).toFixed(2)},${y(p.usedPercent).toFixed(2)}`).join(' ');
  const baseline = (padTop + plotHeight).toFixed(2);
  parts.push(`<polygon class="area" points="${padLeft},${baseline} ${points} ${x(tMax).toFixed(2)},${baseline}"/>`);
  parts.push(`<polyline class="line" points="${points}"/>`);

  const first = series[0];
  const last = series[series.length - 1];
  parts.push(`<text class="tick" x="${padLeft}" y="${height - 8}">${esc(when(first.at).slice(0, 10))}</text>`);
  parts.push(`<text class="tick r" x="${width - padRight}" y="${height - 8}" text-anchor="end">${esc(when(last.at).slice(0, 10))}</text>`);

  // Named for a reader who cannot see it: the same two figures the line shows.
  const label = `Disk usage over time: ${first.usedPercent.toFixed(1)}% on ${when(first.at).slice(0, 10)}, ` +
    `${last.usedPercent.toFixed(1)}% on ${when(last.at).slice(0, 10)}. The readings are in the table below.`;

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
        ${parts.join('\n        ')}
      </svg>`;
}

/* -------------------------------------------------------------------------- */
/* sections                                                                    */
/* -------------------------------------------------------------------------- */

function volumesSection(data, T) {
  const rows = (data.volumes || []).map((v) => [
    v.root,
    v.fileSystem || '–',
    bytes(v.totalBytes),
    bytes(v.freeBytes),
    percent(v.usedPercent),
  ]);
  if (rows.length === 0) return missing(T.volumes, T.noVolumes);

  const bars = (data.volumes || [])
    .map(
      (v) => `<div class="vol">
          <div class="vol-head"><strong>${esc(v.root)}</strong><span>${esc(percent(v.usedPercent))} ${esc(T.full)}</span></div>
          ${bar(v.usedPercent)}
          <div class="vol-foot">${esc(bytes(v.totalBytes - v.freeBytes))} ${esc(T.of)} ${esc(bytes(v.totalBytes))} · ${esc(bytes(v.freeBytes))} ${esc(T.free)}</div>
        </div>`
    )
    .join('\n        ');

  return `<section class="card">
      <h2>${esc(T.volumes)}</h2>
      <div class="vols">
        ${bars}
      </div>
      ${table([T.drive, T.fileSystem, T.total, T.free, T.used], rows, { align: ['', '', 'r', 'r', 'r'] })}
    </section>`;
}

function systemSection(data, T) {
  if (!data.system) return missing(T.system, T.noSystem);
  const rows = (data.system.rows || []).map((r) => [r.label, bytes(r.bytes), r.note || '']);
  return `<section class="card">
      <h2>${esc(T.system)}</h2>
      <p class="sub">${esc(T.systemDrive)}: <strong>${esc(data.system.drive)}</strong> · ${esc(T.measured)} ${esc(when(data.system.at))}${
        data.system.elevated ? '' : ` · ${esc(T.notElevated)}`
      }</p>
      ${table([T.row, T.size, T.note], rows, { align: ['', 'r', ''] })}
    </section>`;
}

function foldersSection(data, T) {
  const rows = (data.folders || []).map((f) => [f.root, bytes(f.bytes), count(f.files), when(f.at)]);
  if (rows.length === 0) return missing(T.folders, T.noFolders);
  return `<section class="card">
      <h2>${esc(T.folders)}</h2>
      ${table([T.folder, T.size, T.files, T.scanned], rows, { align: ['', 'r', 'r', ''] })}
    </section>`;
}

function trendsSection(data, T) {
  const trends = data.trends;
  if (!trends || !Array.isArray(trends.series) || trends.series.length === 0) return missing(T.trends, T.noTrends);

  const rows = trends.series
    .slice(-40)
    .map((p) => [when(p.at), percent(p.usedPercent), bytes(p.freeBytes), p.source || '']);

  const drawn = chart(trends.series);

  const growth = trends.growth && trends.growth.ok
    ? `<p class="sub">${esc(T.growth)}: <strong>${esc(bytes(trends.growth.bytesPerMonth))}</strong> ${esc(T.perMonth)}</p>`
    : `<p class="sub none">${esc(T.noGrowth)}</p>`;

  return `<section class="card">
      <h2>${esc(T.trends)}</h2>
      <p class="sub">${esc(T.drive)}: <strong>${esc(trends.volume)}</strong> · ${esc(count(trends.series.length))} ${esc(T.readings)}</p>
      ${drawn || `<p class="none">${esc(T.noChart)}</p>`}
      ${growth}
      ${table([T.at, T.used, T.free, T.from], rows, { align: ['', 'r', 'r', ''] })}
    </section>`;
}

function diffSection(data, T) {
  if (!data.diff) return missing(T.diff, T.noDiff);
  const d = data.diff;
  const places = (d.places || []).slice(0, 40).map((p) => [p.path, bytes(p.deltaBytes)]);
  const files = (d.files || []).slice(0, 40).map((f) => [f.path, esc(f.kind), bytes(f.bytes)]);

  return `<section class="card">
      <h2>${esc(T.diff)}</h2>
      <p class="sub">${esc(d.root)} · ${esc(when(d.fromAt))} → ${esc(when(d.toAt))} · <strong>${esc(bytes(d.deltaBytes))}</strong></p>
      ${places.length ? `<h3>${esc(T.whereChanged)}</h3>${table([T.folder, T.change], places, { align: ['', 'r'] })}` : ''}
      ${files.length ? `<h3>${esc(T.filesChanged)}</h3>${table([T.file, T.what, T.size], files, { align: ['', '', 'r'] })}` : ''}
    </section>`;
}

function actionsSection(data, T) {
  if (!data.actions || (data.actions.sessions || []).length === 0) return missing(T.actions, T.noActions);

  const sessions = data.actions.sessions
    .map((s) => {
      const items = (s.items || []).slice(0, 25).map((i) => [i.path, bytes(i.size)]);
      const more = (s.items || []).length - items.length;
      return `<div class="session">
          <div class="session-head">
            <strong>${esc(T.kinds[s.kind] || s.kind)}</strong>
            <span>${esc(when(s.at))} · ${esc(count(s.count))} ${esc(T.items)} · ${esc(bytes(s.bytes))}</span>
          </div>
          ${items.length ? table([T.file, T.size], items, { align: ['', 'r'] }) : ''}
          ${more > 0 ? `<p class="none">${esc(T.andMore.replace('{n}', count(more)))}</p>` : ''}
        </div>`;
    })
    .join('\n      ');

  return `<section class="card">
      <h2>${esc(T.actions)}</h2>
      <p class="sub">${esc(T.actionsNote)}</p>
      ${sessions}
    </section>`;
}

/* -------------------------------------------------------------------------- */
/* the page                                                                    */
/* -------------------------------------------------------------------------- */

const STYLE = `
    :root {
      --bg: #f6f7f9; --card: #ffffff; --ink: #1b1d21; --ink-2: #5b6170;
      --line: #e3e6ec; --accent: #2f6fd0; --accent-soft: #e8f0fc;
      --good: #1f8a4c; --warn: #b26a00; --bad: #c0392b;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #16181d; --card: #1e2128; --ink: #e8eaee; --ink-2: #a2a9b8;
        --line: #2c3039; --accent: #6ea3f0; --accent-soft: #223a5e;
        --good: #4cc47f; --warn: #e0a24a; --bad: #f0776a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 28px 20px 60px;
      background: var(--bg); color: var(--ink);
      font: 14px/1.55 "Segoe UI", system-ui, -apple-system, sans-serif;
    }
    .page { max-width: 900px; margin: 0 auto; }
    header { margin-bottom: 22px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    h2 { margin: 0 0 12px; font-size: 15px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-2); }
    h3 { margin: 18px 0 8px; font-size: 13px; color: var(--ink-2); }
    .meta { color: var(--ink-2); font-size: 12.5px; }
    .card {
      background: var(--card); border: 1px solid var(--line); border-radius: 10px;
      padding: 18px 20px; margin-bottom: 16px;
    }
    .card.missing { background: none; border-style: dashed; }
    .sub { margin: 0 0 12px; color: var(--ink-2); font-size: 12.5px; }
    .none { color: var(--ink-2); font-style: italic; margin: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12.5px; }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--ink-2); font-weight: 600; white-space: nowrap; }
    td { word-break: break-all; }
    .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .vols { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .vol-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .vol-foot { color: var(--ink-2); font-size: 12px; margin-top: 4px; }
    .bar { display: block; height: 8px; margin-top: 6px; border-radius: 99px; background: var(--accent-soft); overflow: hidden; }
    .bar-fill { display: block; height: 100%; background: var(--accent); }
    .chart { width: 100%; height: auto; display: block; margin: 6px 0 4px; }
    .chart .grid { stroke: var(--line); stroke-width: 1; }
    .chart .tick { fill: var(--ink-2); font-size: 10px; }
    .chart .area { fill: var(--accent); opacity: .14; }
    .chart .line { fill: none; stroke: var(--accent); stroke-width: 2; }
    .session { padding: 12px 0; border-top: 1px solid var(--line); }
    .session:first-of-type { border-top: 0; padding-top: 0; }
    .session-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .session-head span { color: var(--ink-2); font-size: 12.5px; }
    .notice { border-left: 3px solid var(--warn); padding: 10px 14px; background: var(--card); border-radius: 0 8px 8px 0; margin-bottom: 16px; }
    footer { margin-top: 26px; color: var(--ink-2); font-size: 12px; }
    @media print {
      body { background: #fff; padding: 0; }
      .card { break-inside: avoid; border-color: #ccc; }
    }
`;

/**
 * Build the file.
 *
 * @param {object} data  from `report/collect.js`, redacted already if private
 * @param {object} T     the words, in the reader's language
 * @returns {string} a complete HTML document
 */
function buildReport(data, T) {
  const sections = [];
  const wanted = new Set(data.sections || []);
  if (wanted.has('volumes')) sections.push(volumesSection(data, T));
  if (wanted.has('system')) sections.push(systemSection(data, T));
  if (wanted.has('folders')) sections.push(foldersSection(data, T));
  if (wanted.has('trends')) sections.push(trendsSection(data, T));
  if (wanted.has('diff')) sections.push(diffSection(data, T));
  if (wanted.has('actions')) sections.push(actionsSection(data, T));

  const privacy = data.private
    ? `<p class="notice">${esc(T.privateOn)}</p>`
    : '';

  return `<!doctype html>
<html lang="${esc(data.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T.title)} — ${esc(when(data.at))}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
  <header>
    <h1>${esc(T.title)}</h1>
    <p class="meta">${esc(T.madeBy)} ${esc(data.app || 'CleanDrive')} ${esc(data.version || '')} · ${esc(when(data.at))}${
      data.machine ? ` · ${esc(data.machine)}` : ''
    }</p>
  </header>
  ${privacy}
  ${sections.join('\n  ')}
  <footer>
    <p>${esc(T.footer)}</p>
  </footer>
</div>
<script type="application/json" id="cleandrive-report-data">
${jsonBlock(data)}
</script>
</body>
</html>
`;
}

module.exports = { buildReport, esc, jsonBlock, bytes, count, when, percent, chart, STYLE };
