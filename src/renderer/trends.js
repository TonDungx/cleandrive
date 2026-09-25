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
  return t('trends.perMonth', '{sign}{size}/month', { sign, size: formatBytes(Math.abs(bytesPerMonth)) });
}

function formatDay(timestamp) {
  return new Date(timestamp).toLocaleDateString(uiLocale(), { day: '2-digit', month: 'short' });
}

/** "in 3 weeks" / "in 5 months", coarse on purpose — the input is an estimate. */
function formatHorizon(days) {
  if (days < 1) return t('app.ago.today', 'today');
  if (days < 14) return t('trends.in.days', 'in {n} days', { n: Math.round(days) });
  if (days < 60) return t('trends.in.weeks', 'in {n} weeks', { n: Math.round(days / 7) });
  if (days < 730) return t('trends.in.months', 'in {n} months', { n: Math.round(days / 30) });
  return t('trends.in.years', 'in {n} years', { n: (days / 365).toFixed(1) });
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
        ? t(
            'trends.chart.none',
            'No measurements of this volume yet. “Measure now” below takes one immediately, and the ' +
              'daily measurement keeps taking them whether or not the app is open.'
          )
        : t('trends.chart.one', 'One measurement so far. A second one, on a different day, is what makes a line.');
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

  const first = series[0];
  const final = series[series.length - 1];
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': t('trends.chartSummary', 'Disk usage over time: {from} on {fromDay}, {to} on {toDay}. The readings are in the table that follows.', {
      from: `${first.usedPercent.toFixed(1)}%`,
      fromDay: formatDay(first.at),
      to: `${final.usedPercent.toFixed(1)}%`,
      toDay: formatDay(final.at),
    }),
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

  const firstLabel = svgEl('text', { class: 'chart-label', x: padLeft, y: height - 8 });
  firstLabel.textContent = formatDay(tMin);
  const lastLabel = svgEl('text', { class: 'chart-label', x: width - padRight, y: height - 8, 'text-anchor': 'end' });
  lastLabel.textContent = formatDay(tMax);
  svg.append(firstLabel, lastLabel);

  host.append(svg, chartTable(series));
}

/** Rows the table under the chart reads out; the newest, when there are more. */
const CHART_TABLE_ROWS = 100;

/**
 * The chart's readings, as a table only a screen reader sees.
 *
 * A line is a picture of numbers, and the numbers are what somebody who
 * cannot see the line needs: the same series, newest first.
 */
function chartTable(series) {
  const table = document.createElement('table');
  table.className = 'sr-only';
  const caption = document.createElement('caption');
  caption.textContent =
    series.length > CHART_TABLE_ROWS
      ? t('trends.table.captionSome', 'Disk usage readings: the newest {n} of {total}', { n: CHART_TABLE_ROWS, total: series.length })
      : t('trends.table.caption', 'Disk usage readings, {n} of them', { n: series.length });
  table.appendChild(caption);

  const head = document.createElement('tr');
  for (const label of [
    t('trends.table.when', 'When'),
    t('trends.table.used', 'In use'),
    t('trends.table.usedBytes', 'Used'),
    t('trends.table.free', 'Free'),
  ]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    head.appendChild(th);
  }
  const thead = document.createElement('thead');
  thead.appendChild(head);
  table.appendChild(thead);

  const body = document.createElement('tbody');
  for (const point of series.slice(-CHART_TABLE_ROWS).reverse()) {
    const tr = document.createElement('tr');
    const cells = [
      new Date(point.at).toLocaleString(uiLocale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      `${point.usedPercent.toFixed(1)}%`,
      Number.isFinite(point.usedBytes) ? formatBytes(point.usedBytes) : '–',
      Number.isFinite(point.freeBytes) ? formatBytes(point.freeBytes) : '–',
    ];
    cells.forEach((text, i) => {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      if (i === 0) cell.scope = 'row';
      cell.textContent = text;
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

/* ---- the lists ---------------------------------------------------------- */

function renderFolderTrends(folders) {
  const list = $('trend-folders');
  list.replaceChildren();

  if (folders.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'path-empty';
    empty.textContent = t('trends.folders.none', 'No folders scanned yet.');
    list.append(empty);
    return;
  }

  for (const folder of folders.slice(0, 12)) {
    const row = document.createElement('li');
    row.className = 'path-row';

    const name = document.createElement('span');
    name.className = 'path-text';
    name.textContent = elide(folder.root, 52);
    name.title = `${folder.root}\n${t('trends.folders.atLastScan', '{size} at the last scan', {
      size: formatBytes(folder.bytes),
    })}`;

    const rate = document.createElement('span');
    if (!folder.ok) {
      rate.className = 'trend-rate is-unknown';
      rate.textContent = `${folder.samples} ${word(folder.samples, 'trends.scan', 'scan', 'scans')}`;
      rate.title = tm(folder.reason);
    } else {
      const up = folder.bytesPerMonth > 0;
      rate.className = `trend-rate ${up ? 'is-up' : 'is-down'}`;
      rate.textContent = formatRate(folder.bytesPerMonth);
      rate.title = t('trends.folders.rateHint', '{size} now, over {samples} scans spanning {days} days', {
        size: formatBytes(folder.bytes),
        samples: folder.samples,
        days: folder.spanDays.toFixed(0),
      });
    }

    row.append(name, rate);
    // Two scans of this folder make a comparison: what grew in it, by name.
    if (window.Changes && window.Changes.has(folder.root)) {
      row.append(linkButton(t('changes.link.row', 'What changed?'), () => window.Changes.open(folder.root), 'trend-changes-row'));
    }
    list.append(row);
  }
}

/**
 * The growth figure is the whole volume's; this says where on it, if two
 * scans of one of its folders can. The link names the folder and how far
 * apart the scans are, because "C: grew 6 GB" and "this folder grew 2 GB in
 * three days" are different measurements and must not read as one.
 */
function renderChangesLink(report) {
  const host = $('trend-changes');
  host.replaceChildren();
  const growing = report.growth && report.growth.ok && report.growth.bytesPerMonth > 0 && report.volume;
  if (!growing || !window.Changes) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const volume = report.volume.toUpperCase();
  const target = window.Changes.rootOn(report.volume);
  if (!target) {
    host.append(
      RefusalNote(t('changes.link.none', 'To see what is growing on {volume}, scan one of its folders now and again later.', { volume }))
    );
    return;
  }
  if (!window.Changes.allowed()) {
    const hint = UpgradeHint('pro.diff', t('changes.upgrade', 'Comparing two scans of a folder is part of CleanDrive Pro.'));
    if (hint) host.append(hint);
    else host.hidden = true;
    return;
  }
  const lead = document.createElement('span');
  lead.textContent = t('changes.link.lead', '{volume} is growing {rate}.', { volume, rate: formatRate(report.growth.bytesPerMonth) });
  const go = linkButton(
    t('changes.link.go', 'See what grew in {folder}', { folder: elide(target.root, 48) }),
    () => window.Changes.open(target.root),
    'trend-changes-go'
  );
  go.title = target.root;
  const scope = document.createElement('span');
  scope.className = 'trend-changes-scope';
  scope.textContent = t('changes.link.scope', '— two scans of that folder, {span} apart, not the whole of {volume}.', {
    span: window.Changes.span(target.days),
    volume,
  });
  host.append(lead, ' ', go, ' ', scope);
}

function renderSavings(savings) {
  const list = $('trend-savings');
  list.replaceChildren();

  const head = document.createElement('li');
  head.className = 'pair-row pair-head';
  const h1 = document.createElement('span');
  h1.className = 'pair-label';
  h1.textContent = t('trends.savings.month', 'Month');
  const h2 = document.createElement('span');
  h2.className = 'pair-moved';
  h2.textContent = t('trends.savings.toBin', 'To the bin');
  const h3 = document.createElement('span');
  h3.className = 'pair-freed';
  h3.textContent = t('trends.savings.freed', 'Freed');
  head.append(h1, h2, h3);
  list.append(head);

  if (savings.byMonth.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'path-empty';
    empty.textContent = t('trends.savings.none', 'Nothing deleted through CleanDrive yet.');
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
  label.textContent = t('trends.savings.total', 'Total');
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
    t('trends.sampler.daily', 'Daily Windows task'),
    !sampling.supported
      ? t('task.windowsOnly', 'Windows only')
      : sampling.dailySample
        ? sampling.taskInstalled
          ? sampling.taskVerified
            ? t('trends.sampler.registered', 'registered, runs at {time}', { time: sampling.sampleTime })
            : t('task.samplerMismatch', 'registered but does not match')
          : t('trends.sampler.notRegistered', 'switched on but not registered — save below')
        : t('app.off.lower', 'off'),
    sampling.taskProblems.length > 0
      ? sampling.taskProblems.join(' ')
      : t('trends.sampler.closedHint', 'Runs with CleanDrive closed')
  ));

  list.append(samplingRow(
    t('trends.sampler.next', 'Next automatic measurement'),
    sampling.nextSampleAt ? formatWhen(sampling.nextSampleAt) : t('task.noneScheduled', 'none scheduled')
  ));

  list.append(samplingRow(
    t('trends.sampler.launch', 'When the app starts'),
    t('trends.sampler.always', 'always'),
    t('trends.sampler.launchHint', 'One measurement per launch')
  ));

  list.append(samplingRow(
    t('trends.sampler.monitor', 'While disk monitoring runs'),
    sampling.monitorRunning
      ? t('trends.sampler.monitorOn', 'on, at most one every 30 minutes')
      : t('app.off.lower', 'off'),
    t('trends.sampler.monitorHint', 'Readings the monitor already takes are recorded instead of discarded')
  ));

  list.append(samplingRow(
    t('trends.sampler.scan', 'When you run a scan'),
    t('trends.sampler.always', 'always'),
    t('trends.sampler.scanHint', 'A scan also records the folder size, which is what the folder list below compares')
  ));

  const latest = report.latest;
  $('trend-sampling-status').textContent = latest
    ? t(
        'trends.sampler.lastMeasurement',
        'Last measurement {when}. Two measurements make a line; the growth figure needs four across ' +
          'at least a week.',
        { when: formatWhen(latest.at) }
      )
    : t('trends.sampler.noneYet', 'No measurement on file yet.');
}

$('trend-sample').addEventListener('click', async () => {
  $('trend-sampling-status').textContent = t('trends.measuring', 'Measuring…');
  const result = unwrap(await api.sampleNow(), t('trends.measureLabel', 'Measure disk'));
  if (!result) return;

  await refreshTrends($('trend-volume').value);

  toast(
    result.coalesced
      ? t(
          'trends.measured.coalesced',
          'Measured, but it replaced a reading less than half an hour old — the series only keeps ' +
            'one point per half hour, so repeat presses cannot manufacture a trend.'
        )
      : t('trends.measured.new', 'Measured {n} volume(s). {total} on file.', {
          n: Object.keys(result.volumes).length,
          total: formatCount(result.snapshots),
        })
  );
});

$('trend-daily').addEventListener('change', () => {
  $('trend-time-row').hidden = !$('trend-daily').checked;
  $('trend-sampling-status').textContent = t('trends.unsaved', 'Unsaved changes to the measuring settings.');
});

$('trend-time').addEventListener('change', () => {
  $('trend-sampling-status').textContent = t('trends.unsaved', 'Unsaved changes to the measuring settings.');
});

$('trend-save').addEventListener('click', async () => {
  $('trend-sampling-status').textContent = t('app.saving', 'Saving…');
  const data = unwrap(
    await api.saveSettings({
      trends: { dailySample: $('trend-daily').checked, sampleTime: $('trend-time').value || '12:00' },
    }),
    t('app.label.saveSettings', 'Save settings')
  );
  if (!data) return;

  await refreshTrends($('trend-volume').value);

  const problems = data.reconciled ? data.reconciled.problems : [];
  if (problems.length > 0) {
    toast(t('trends.saved.taskWrong', 'Saved, but the measuring task is not right: {problems}', {
      problems: problems.join(' '),
    }), true);
  } else if (data.settings.trends.dailySample) {
    toast(t('trends.saved.on', 'Saved. Windows will measure the disk daily.'));
  } else {
    toast(t('trends.saved.off', 'Saved. The daily measurement is off and its Windows task was removed.'));
  }
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

  $('trend-samples').textContent = `${formatCount(report.snapshots)} ${word(
    report.snapshots,
    'trends.measurement',
    'measurement',
    'measurements'
  )}`;

  if (report.latest) {
    $('tstat-used').textContent = `${report.latest.usedPercent.toFixed(1)}%`;
    $('tstat-used').title = t('trends.freeOf', '{free} free of {total}', {
      free: formatBytes(report.latest.freeBytes),
      total: formatBytes(report.latest.totalBytes),
    });
  } else {
    $('tstat-used').textContent = '–';
  }

  // Growth and prediction each print their own refusal when they have one.
  if (report.growth.ok) {
    $('tstat-growth').textContent = formatRate(report.growth.bytesPerMonth);
    $('tstat-growth').title = t('trends.growthHint', 'Fitted through {n} measurements over {days} days (r² {r2})', {
      n: report.growth.n,
      days: report.growth.spanDays.toFixed(0),
      r2: report.growth.r2.toFixed(2),
    });
  } else {
    $('tstat-growth').textContent = t('trends.notYet', 'not yet');
    $('tstat-growth').title = tm(report.growth.reason);
  }

  if (report.prediction.ok) {
    $('tstat-full').textContent = formatHorizon(report.prediction.days);
    $('tstat-full').title = t('trends.fullHint', 'Around {date} at the current rate (r² {r2})', {
      date: new Date(report.prediction.at).toLocaleDateString(uiLocale()),
      r2: report.prediction.r2.toFixed(2),
    });
  } else {
    $('tstat-full').textContent = report.prediction.beyondHorizon
      ? t('trends.notSoon', 'not soon')
      : t('trends.unknown', 'unknown');
    $('tstat-full').title = tm(report.prediction.reason);
  }

  $('tstat-freed').textContent = formatBytes(report.savings.freedBytes);
  $('tstat-freed').title = t(
    'trends.freedHint',
    '{moved} was moved to the Recycle Bin; {freed} of that was permanently removed and is genuinely free.',
    { moved: formatBytes(report.savings.movedBytes), freed: formatBytes(report.savings.freedBytes) }
  );

  // The caveat under the chart is the one place the honest limitation is spelled
  // out in full rather than hidden in a tooltip.
  const caveat = [];
  if (!report.growth.ok && report.growth.reason) caveat.push(tm(report.growth.reason));
  else if (!report.prediction.ok && report.prediction.reason) caveat.push(tm(report.prediction.reason));
  if (report.series.length >= 2) {
    caveat.push(
      t('trends.axisCaveat', 'The vertical axis is scaled to the data, not to 0–100%, so small changes are visible.')
    );
  }
  $('trend-caveat').textContent = caveat.join(' ');

  renderSampling(report);
  renderFolderTrends(report.folders);
  renderChangesLink(report);
  renderSavings(report.savings);

  $('trend-status').textContent =
    report.snapshots === 0
      ? t('trends.noHistory', 'No history yet.')
      : t('trends.recorded', '{n} measurement(s) recorded.', { n: formatCount(report.snapshots) });
}

async function refreshTrends(volume) {
  const report = unwrap(await api.getHistory(volume ? { volume } : {}), t('app.tab.trends', 'Trends'));
  if (report) applyTrends(report);
}

$('trend-volume').addEventListener('change', (event) => refreshTrends(event.target.value));

for (const [id, format] of [['trend-export-json', 'json'], ['trend-export-csv', 'csv']]) {
  $(id).addEventListener('click', async () => {
    const result = unwrap(await api.exportHistory(format), t('trends.exportLabel', 'Export'));
    if (!result) return;
    toast(
      result.written
        ? t('trends.exported', 'Exported {n} measurement(s).', { n: formatCount(result.rows) })
        : t('trends.exportCancelled', 'Export cancelled.')
    );
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

onLanguageChange(() => {
  if (state.trends) applyTrends(state.trends);
});
