'use strict';

/**
 * The Trends tab.
 *
 * The chart is inline SVG built with `createElementNS`, not a charting library.
 * The CSP is `default-src 'none'; script-src 'self'`, so nothing can be pulled
 * from a CDN, and vendoring a chart library to draw one line would be more code
 * than the line.
 *
 * Nothing here invents a figure. Where the main process says it cannot answer,
 * this file prints that sentence rather than a dash or a zero, because a dash
 * reads as "nothing is happening" and the truth is "not enough is known yet".
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

state.trends = null;

/** Smallest vertical span the chart will draw, in percentage points.
 *  Auto-scaling to a 0.2-point range would turn noise into a cliff. */
const MIN_RANGE_PERCENT = 5;

const CHART = { width: 720, height: 240, padLeft: 46, padRight: 14, padTop: 14, padBottom: 26 };

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function formatRate(bytesPerMonth) {
  const sign = bytesPerMonth >= 0 ? '+' : '−';
  return `${sign}${formatBytes(Math.abs(bytesPerMonth))}/month`;
}

function formatDay(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

/** "in 3 weeks" / "in 5 months", coarse on purpose — the input is an estimate. */
function formatHorizon(days) {
  if (days < 1) return 'today';
  if (days < 14) return `in ${Math.round(days)} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  if (days < 730) return `in ${Math.round(days / 30)} months`;
  return `in ${(days / 365).toFixed(1)} years`;
}

/* ---- the chart ---------------------------------------------------------- */

function renderChart(host, series, thresholds) {
  host.replaceChildren();

  if (series.length < 2) {
    const note = document.createElement('div');
    note.className = 'chart-empty';
    // Names the thing to press. The old wording ("run a scan, or switch on
    // automatic cleanup") asked the user to enable unattended deletion in order
    // to see a chart, which was both a poor trade and not even the quickest way.
    note.textContent =
      series.length === 0
        ? 'No measurements of this volume yet. “Measure now” below takes one immediately, and the ' +
          'daily measurement keeps taking them whether or not the app is open.'
        : 'One measurement so far. A second one, on a different day, is what makes a line.';
    host.append(note);
    return;
  }

  const { width, height, padLeft, padRight, padTop, padBottom } = CHART;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const times = series.map((p) => p.at);
  const values = series.map((p) => p.usedPercent);
  const tMin = times[0];
  const tMax = times[times.length - 1];

  // Auto-scaled, but never tighter than MIN_RANGE_PERCENT and never outside
  // 0-100. The axis is labelled, so a magnified view is legible rather than
  // misleading.
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < MIN_RANGE_PERCENT) {
    const mid = (high + low) / 2;
    low = mid - MIN_RANGE_PERCENT / 2;
    high = mid + MIN_RANGE_PERCENT / 2;
  }
  const pad = (high - low) * 0.12;
  low = Math.max(0, low - pad);
  high = Math.min(100, high + pad);
  if (high <= low) high = low + 1;

  const x = (t) => padLeft + (tMax === tMin ? plotWidth : ((t - tMin) / (tMax - tMin)) * plotWidth);
  const y = (v) => padTop + plotHeight - ((v - low) / (high - low)) * plotHeight;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': 'Disk usage over time',
  });

  // Horizontal guides, labelled with the percentage they stand for.
  for (let i = 0; i <= 4; i++) {
    const value = low + ((high - low) * i) / 4;
    const yy = y(value);
    svg.append(svgEl('line', { class: 'chart-grid', x1: padLeft, x2: width - padRight, y1: yy, y2: yy }));
    const label = svgEl('text', { class: 'chart-label', x: 4, y: yy + 3 });
    label.textContent = `${value.toFixed(value >= 10 ? 0 : 1)}%`;
    svg.append(label);
  }

  for (const [percent, cls] of [
    [thresholds.warn, 'chart-threshold-warn'],
    [thresholds.critical, 'chart-threshold-critical'],
  ]) {
    if (percent == null || percent < low || percent > high) continue;
    svg.append(svgEl('line', { class: cls, x1: padLeft, x2: width - padRight, y1: y(percent), y2: y(percent) }));
  }

  const points = series.map((p) => `${x(p.at).toFixed(2)},${y(p.usedPercent).toFixed(2)}`);
  const baseline = padTop + plotHeight;
  svg.append(svgEl('polygon', {
    class: 'chart-area',
    points: `${padLeft},${baseline} ${points.join(' ')} ${x(tMax).toFixed(2)},${baseline}`,
  }));
  svg.append(svgEl('polyline', { class: 'chart-line', points: points.join(' ') }));

  const last = series[series.length - 1];
  svg.append(svgEl('circle', { class: 'chart-point', cx: x(last.at), cy: y(last.usedPercent), r: 3 }));

  const first = svgEl('text', { class: 'chart-label', x: padLeft, y: height - 8 });
  first.textContent = formatDay(tMin);
  const lastLabel = svgEl('text', { class: 'chart-label', x: width - padRight, y: height - 8, 'text-anchor': 'end' });
  lastLabel.textContent = formatDay(tMax);
  svg.append(first, lastLabel);

  host.append(svg);
}

/* ---- the lists ---------------------------------------------------------- */

function renderFolderTrends(folders) {
  const list = $('trend-folders');
  list.replaceChildren();

  if (folders.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'path-empty';
    empty.textContent = 'No folders scanned yet.';
    list.append(empty);
    return;
  }

  for (const folder of folders.slice(0, 12)) {
    const row = document.createElement('li');
    row.className = 'path-row';

    const name = document.createElement('span');
    name.className = 'path-text';
    name.textContent = elide(folder.root, 52);
    name.title = `${folder.root}\n${formatBytes(folder.bytes)} at the last scan`;

    const rate = document.createElement('span');
    if (!folder.ok) {
      rate.className = 'trend-rate is-unknown';
      rate.textContent = `${folder.samples} scan${folder.samples === 1 ? '' : 's'}`;
      rate.title = folder.reason || '';
    } else {
      const up = folder.bytesPerMonth > 0;
      rate.className = `trend-rate ${up ? 'is-up' : 'is-down'}`;
      rate.textContent = formatRate(folder.bytesPerMonth);
      rate.title = `${formatBytes(folder.bytes)} now, over ${folder.samples} scans spanning ` +
        `${folder.spanDays.toFixed(0)} days`;
    }

    row.append(name, rate);
    list.append(row);
  }
}

function renderSavings(savings) {
  const list = $('trend-savings');
  list.replaceChildren();

  const head = document.createElement('li');
  head.className = 'pair-row pair-head';
  const h1 = document.createElement('span');
  h1.className = 'pair-label';
  h1.textContent = 'Month';
  const h2 = document.createElement('span');
  h2.className = 'pair-moved';
  h2.textContent = 'To the bin';
  const h3 = document.createElement('span');
  h3.className = 'pair-freed';
  h3.textContent = 'Freed';
  head.append(h1, h2, h3);
  list.append(head);

  if (savings.byMonth.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'path-empty';
    empty.textContent = 'Nothing deleted through CleanDrive yet.';
    list.append(empty);
    return;
  }

  for (const month of savings.byMonth.slice(-12)) {
    const row = document.createElement('li');
    row.className = 'pair-row';

    const label = document.createElement('span');
    label.className = 'pair-label';
    label.textContent = month.month;

    const moved = document.createElement('span');
    moved.className = 'pair-moved';
    moved.textContent = formatBytes(month.movedBytes);

    const freed = document.createElement('span');
    freed.className = 'pair-freed';
    freed.textContent = formatBytes(month.freedBytes);

    row.append(label, moved, freed);
    list.append(row);
  }

  const total = document.createElement('li');
  total.className = 'pair-row';
  const label = document.createElement('span');
  label.className = 'pair-label';
  label.textContent = 'Total';
  const moved = document.createElement('span');
  moved.className = 'pair-moved';
  moved.textContent = formatBytes(savings.movedBytes);
  const freed = document.createElement('span');
  freed.className = 'pair-freed';
  freed.textContent = formatBytes(savings.freedBytes);
  total.append(label, moved, freed);
  list.append(total);
}

/* ---- where the measurements come from ----------------------------------- */

function samplingRow(label, value, title) {
  const row = document.createElement('li');
  row.className = 'pair-row';

  const left = document.createElement('span');
  left.className = 'pair-label';
  left.textContent = label;

  const right = document.createElement('span');
  right.className = 'pair-value';
  right.textContent = value;
  if (title) right.title = title;

  row.append(left, right);
  return row;
}

/**
 * The samplers, named.
 *
 * This is the answer to the question the tab could not previously answer: what
 * puts numbers in this chart. Four things do, and the user can see which of
 * them are actually running rather than inferring it from an empty chart.
 */
function renderSampling(report) {
  const sampling = report.sampling;
  const list = $('trend-sampling');
  list.replaceChildren();

  if (!sampling) return;

  $('trend-daily').checked = sampling.dailySample;
  $('trend-time').value = sampling.sampleTime;
  $('trend-time-row').hidden = !sampling.dailySample;

  list.append(samplingRow(
    'Daily Windows task',
    !sampling.supported
      ? 'Windows only'
      : sampling.dailySample
        ? (sampling.taskInstalled
            ? (sampling.taskVerified ? `registered, runs at ${sampling.sampleTime}` : 'registered but does not match')
            : 'switched on but not registered — save below')
        : 'off',
    sampling.taskProblems.length > 0 ? sampling.taskProblems.join(' ') : 'Runs with CleanDrive closed'
  ));

  list.append(samplingRow(
    'Next automatic measurement',
    sampling.nextSampleAt ? formatWhen(sampling.nextSampleAt) : 'none scheduled'
  ));

  list.append(samplingRow('When the app starts', 'always', 'One measurement per launch'));

  list.append(samplingRow(
    'While disk monitoring runs',
    sampling.monitorRunning ? 'on, at most one every 30 minutes' : 'off',
    'Readings the monitor already takes are recorded instead of discarded'
  ));

  list.append(samplingRow(
    'When you run a scan',
    'always',
    'A scan also records the folder size, which is what the folder list below compares'
  ));

  const latest = report.latest;
  $('trend-sampling-status').textContent = latest
    ? `Last measurement ${formatWhen(latest.at)}. Two measurements make a line; the growth figure ` +
      'needs four across at least a week.'
    : 'No measurement on file yet.';
}

$('trend-sample').addEventListener('click', async () => {
  $('trend-sampling-status').textContent = 'Measuring…';
  const result = unwrap(await api.sampleNow(), 'Measure disk');
  if (!result) return;

  await refreshTrends($('trend-volume').value);

  toast(
    result.coalesced
      ? 'Measured, but it replaced a reading less than half an hour old — the series only keeps ' +
        'one point per half hour, so repeat presses cannot manufacture a trend.'
      : `Measured ${Object.keys(result.volumes).length} volume(s). ${formatCount(result.snapshots)} on file.`
  );
});

$('trend-daily').addEventListener('change', () => {
  $('trend-time-row').hidden = !$('trend-daily').checked;
  $('trend-sampling-status').textContent = 'Unsaved changes to the measuring settings.';
});

$('trend-time').addEventListener('change', () => {
  $('trend-sampling-status').textContent = 'Unsaved changes to the measuring settings.';
});

$('trend-save').addEventListener('click', async () => {
  $('trend-sampling-status').textContent = 'Saving…';
  const data = unwrap(
    await api.saveSettings({
      trends: { dailySample: $('trend-daily').checked, sampleTime: $('trend-time').value || '12:00' },
    }),
    'Save settings'
  );
  if (!data) return;

  await refreshTrends($('trend-volume').value);

  const problems = data.reconciled ? data.reconciled.problems : [];
  if (problems.length > 0) toast(`Saved, but the measuring task is not right: ${problems.join(' ')}`, true);
  else if (data.settings.trends.dailySample) toast('Saved. Windows will measure the disk daily.');
  else toast('Saved. The daily measurement is off and its Windows task was removed.');
});

/* ---- assembly ----------------------------------------------------------- */

function applyTrends(report) {
  state.trends = report;

  const select = $('trend-volume');
  const chosen = select.value;
  select.replaceChildren();
  for (const volume of report.volumes) {
    const option = document.createElement('option');
    option.value = volume;
    option.textContent = volume;
    option.selected = volume === (report.volume || chosen);
    select.append(option);
  }
  select.disabled = report.volumes.length <= 1;

  const monitor = state.auto ? state.auto.settings.monitor : null;
  renderChart($('trend-chart'), report.series, {
    warn: monitor ? monitor.warnPercent : null,
    critical: monitor ? monitor.criticalPercent : null,
  });

  $('trend-samples').textContent =
    `${formatCount(report.snapshots)} measurement${report.snapshots === 1 ? '' : 's'}`;

  if (report.latest) {
    $('tstat-used').textContent = `${report.latest.usedPercent.toFixed(1)}%`;
    $('tstat-used').title =
      `${formatBytes(report.latest.freeBytes)} free of ${formatBytes(report.latest.totalBytes)}`;
  } else {
    $('tstat-used').textContent = '–';
  }

  // Growth and prediction each print their own refusal when they have one.
  if (report.growth.ok) {
    $('tstat-growth').textContent = formatRate(report.growth.bytesPerMonth);
    $('tstat-growth').title = `Fitted through ${report.growth.n} measurements over ` +
      `${report.growth.spanDays.toFixed(0)} days (r² ${report.growth.r2.toFixed(2)})`;
  } else {
    $('tstat-growth').textContent = 'not yet';
    $('tstat-growth').title = report.growth.reason || '';
  }

  if (report.prediction.ok) {
    $('tstat-full').textContent = formatHorizon(report.prediction.days);
    $('tstat-full').title = `Around ${new Date(report.prediction.at).toLocaleDateString()} ` +
      `at the current rate (r² ${report.prediction.r2.toFixed(2)})`;
  } else {
    $('tstat-full').textContent = report.prediction.beyondHorizon ? 'not soon' : 'unknown';
    $('tstat-full').title = report.prediction.reason || '';
  }

  $('tstat-freed').textContent = formatBytes(report.savings.freedBytes);
  $('tstat-freed').title =
    `${formatBytes(report.savings.movedBytes)} was moved to the Recycle Bin; ` +
    `${formatBytes(report.savings.freedBytes)} of that was permanently removed and is genuinely free.`;

  // The caveat under the chart is the one place the honest limitation is spelled
  // out in full rather than hidden in a tooltip.
  const caveat = [];
  if (!report.growth.ok && report.growth.reason) caveat.push(report.growth.reason);
  else if (!report.prediction.ok && report.prediction.reason) caveat.push(report.prediction.reason);
  if (report.series.length >= 2) {
    caveat.push('The vertical axis is scaled to the data, not to 0–100%, so small changes are visible.');
  }
  $('trend-caveat').textContent = caveat.join(' ');

  renderSampling(report);
  renderFolderTrends(report.folders);
  renderSavings(report.savings);

  $('trend-status').textContent =
    report.snapshots === 0
      ? 'No history yet.'
      : `${formatCount(report.snapshots)} measurement(s) recorded.`;
}

async function refreshTrends(volume) {
  const report = unwrap(await api.getHistory(volume ? { volume } : {}), 'Trends');
  if (report) applyTrends(report);
}

$('trend-volume').addEventListener('change', (event) => refreshTrends(event.target.value));

for (const [id, format] of [['trend-export-json', 'json'], ['trend-export-csv', 'csv']]) {
  $(id).addEventListener('click', async () => {
    const result = unwrap(await api.exportHistory(format), 'Export');
    if (!result) return;
    toast(result.written ? `Exported ${formatCount(result.rows)} measurement(s).` : 'Export cancelled.');
  });
}

// The history grows whenever a scan finishes, so reopening the tab re-reads it
// rather than showing whatever was true when the window opened.
for (const tab of document.querySelectorAll('.tab[data-tab="trends"]')) {
  tab.addEventListener('click', () => refreshTrends($('trend-volume').value));
}

refreshTrends();

// A scheduled run records a fresh disk measurement, so the chart is stale the
// moment one lands. Same reason the Automatic tab listens.
api.onDataChanged((payload) => {
  if (payload && payload.files && !payload.files.includes('history.json')) return;
  refreshTrends($('trend-volume').value);
});
