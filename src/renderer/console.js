'use strict';

/**
 * The console's window (H3): every machine that reports to one folder, read
 * only -- find, filter, sort, look closer, export CSV.
 *
 * The main process reads and judges (fleet/console-model.js); this draws.
 * Everything on the page came from files any reporting machine could have
 * written, so it is put there with textContent and nothing else -- no markup
 * from a report ever reaches the DOM as markup.
 *
 * No verdict colours. Green, amber and red mean something about a file in this
 * app; here the facts are about machines, and the words say how serious each
 * is. What needs a look gets weight instead, as a changed journal does in the
 * Restore Center.
 */

(() => {
  const api = window.cleandrive;
  const $ = (id) => document.getElementById(id);
  const locale = () => (window.CleanDriveI18n ? window.CleanDriveI18n.getLanguage() : 'en');

  const DAY = 24 * 60 * 60 * 1000;

  const view = {
    info: null,
    result: null,
    reading: false,
    filter: 'all',
    query: '',
    sort: { key: 'attention', dir: -1 },
    selected: null,
  };

  /* ---------------------------------------------------------------- words */

  function setText(el, text) {
    const value = String(text);
    if (el.textContent !== value) el.textContent = value;
  }

  function word(n, key, one, other) {
    return n === 1 ? t(`${key}.one`, one) : t(`${key}.other`, other);
  }

  const count = (n) => (n || 0).toLocaleString(locale());

  function bytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const value = n / 1024 ** i;
    return `${(value >= 100 || i === 0 ? Math.round(value) : Number(value.toFixed(1))).toLocaleString(locale())} ${units[i]}`;
  }

  const when = (ms) =>
    Number.isFinite(ms)
      ? new Date(ms).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : t('console.unknown', 'unknown');
  const date = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

  function ago(ms) {
    if (!Number.isFinite(ms)) return t('console.unknown', 'unknown');
    const age = Date.now() - ms;
    if (age < 0) return t('console.ago.future', 'dated in the future');
    if (age < 60 * 60 * 1000) return t('console.ago.minutes', '{n} min ago', { n: Math.max(1, Math.round(age / 60000)) });
    if (age < DAY) return t('console.ago.hours', '{n} h ago', { n: Math.round(age / 3600000) });
    return t('console.ago.days', '{n} days ago', { n: Math.floor(age / DAY) });
  }

  const percent = (p) => `${(Math.round(p * 10) / 10).toLocaleString(locale())}%`;

  function growthText(g) {
    if (!g) return t('console.growth.none', 'no measurements');
    if (!g.ok) return t('console.growth.notYet', 'not enough data yet');
    const perMonth = g.bytesPerDay * 30;
    if (Math.abs(perMonth) < 1024 * 1024) return t('console.growth.flat', 'about flat');
    return perMonth > 0
      ? t('console.growth.up', '+{size} a month', { size: bytes(perMonth) })
      : t('console.growth.down', '−{size} a month', { size: bytes(-perMonth) });
  }

  /** "When it fills", or the reason the machine's own history refuses to say -- in so many words. */
  function fullText(f) {
    if (!f) return t('console.full.none', 'no forecast');
    if (f.ok) return t('console.full.days', 'about {n} days ({date})', { n: count(Math.round(f.days)), date: date(f.at) });
    return f.reason ? tm(f.reason) : t('console.full.none', 'no forecast');
  }

  function profileName(p) {
    if (p.managed) return t('console.profile.org', 'the organisation’s profile');
    if (p.id === 'main') return t('console.profile.first', 'the first profile');
    return t('console.profile.other', 'profile {id}', { id: p.id });
  }

  const nameOfId = (machine, id) => {
    const p = (machine.tasks ? machine.tasks.profiles : []).find((x) => x.id === id);
    return p ? profileName(p) : t('console.profile.other', 'profile {id}', { id });
  };

  /**
   * A policy by the name Group Policy shows it (the ADMX's own words, from
   * policy/admx.js), so the console and the editor an administrator uses
   * agree. A name this version does not know is shown as it came.
   */
  const POLICY_NAMES = {
    ViewOnly: () => t('policy.admx.viewOnly', 'View only: change no files'),
    AutomaticCleanup: () => t('policy.admx.automatic', 'Automatic cleanup'),
    AllowedCategories: () => t('policy.admx.categories', 'Categories automatic cleanup may use'),
    ProtectedFolders: () => t('policy.admx.protected', 'Folders automatic cleanup never touches'),
    DisableUpdateCheck: () => t('policy.admx.updates', 'Do not check for updates'),
    QuarantineFolder: () => t('policy.admx.quarantine', 'Where files moved to another drive go'),
    MachineReport: () => t('policy.admx.report', 'Daily report for the CleanDrive console'),
  };
  const policyName = (name) => (POLICY_NAMES[name] ? POLICY_NAMES[name]() : name);

  const OUTCOME = {
    ok: () => t('console.outcome.ok', 'done'),
    skipped: () => t('console.outcome.skipped', 'skipped'),
    cancelled: () => t('console.outcome.cancelled', 'cancelled'),
    error: () => t('console.outcome.error', 'failed'),
  };
  const outcomeText = (o) => (OUTCOME[o] ? OUTCOME[o]() : o || t('console.unknown', 'unknown'));

  function runText(machine) {
    const r = machine.lastRun;
    if (!r) {
      const profiles = machine.tasks ? machine.tasks.profiles : [];
      return profiles.length === 0 ? t('console.run.noProfile', 'no cleanup profile') : t('console.run.never', 'not run yet');
    }
    const what = r.reportOnly
      ? t('console.run.reported', 'report only: {n} {files}', { n: count(r.selected.files), files: word(r.selected.files, 'console.word.file', 'file', 'files') })
      : t('console.run.moved', '{n} {files}, {size}', { n: count(r.moved.files), files: word(r.moved.files, 'console.word.file', 'file', 'files'), size: bytes(r.moved.bytes) });
    return t('console.run.line', '{when} · {outcome} · {what}', { when: when(r.at), outcome: outcomeText(r.outcome), what });
  }

  function codeText(result, text) {
    if (result === null || result === undefined) return '';
    const hex = `0x${result.toString(16).toUpperCase()}`;
    return text ? t('console.code.with', 'Task Scheduler code {code}: {text}', { code: hex, text }) : t('console.code.bare', 'Task Scheduler code {code}', { code: hex });
  }

  function attentionText(a, machine) {
    switch (a.code) {
      case 'stale':
        return t('console.att.stale', 'no report for {n} days', { n: count(a.days) });
      case 'future':
        return t('console.att.future', 'the report is dated in the future: a clock is wrong');
      case 'nameMismatch':
        return t('console.att.nameMismatch', 'the file is not named after the computer it describes ({name})', { name: a.expected });
      case 'older':
        return t('console.att.older', 'this report is older than one already seen ({when})', { when: when(a.seenAt) });
      case 'sealRewritten':
        return t('console.att.sealRewritten', 'journal seal no. {n} is not the one first seen: the journal was rewritten', { n: count(a.n) });
      case 'sealBack':
        return a.to === 0
          ? t('console.att.sealGone', 'the journal has no seal any more; it had up to no. {from}', { from: count(a.from) })
          : t('console.att.sealBack', 'the newest journal seal went back from no. {from} to no. {to}: sessions were removed', { from: count(a.from), to: count(a.to) });
      case 'journalAltered':
        return t('console.att.journalAltered', 'its own journal check: {altered} changed, {missing} missing', { altered: count(a.altered), missing: count(a.missing) });
      case 'taskMissing':
        return t('console.att.taskMissing', 'cleanup task not registered: {names}', { names: a.ids.map((id) => nameOfId(machine, id)).join(', ') });
      case 'taskWrong':
        return t('console.att.taskWrong', 'cleanup task does not match its profile: {names}', { names: a.ids.map((id) => nameOfId(machine, id)).join(', ') });
      case 'taskFailed':
        return t('console.att.taskFailed', 'last run of {name} failed ({code})', { name: nameOfId(machine, a.id), code: codeText(a.result, a.resultText) });
      case 'fillsSoon':
        return t('console.att.fillsSoon', '{drive} fills in about {n} days', { drive: a.root, n: count(Math.round(a.days)) });
      case 'nearlyFull':
        return t('console.att.nearlyFull', '{drive} is {pct} full', { drive: a.root, pct: percent(a.percent) });
      default:
        return a.code;
    }
  }

  function noteText(n) {
    switch (n.code) {
      case 'sealKeyChanged':
        return t('console.note.sealKeyChanged', 'Its seal key has changed. CleanDrive makes a new one when the old one can no longer be opened, for example after a password is reset; seals made before stay checkable on that machine.');
      case 'notApplied':
        return t('console.note.notApplied', 'Not applied there, because that copy does not include CleanDrive Business: {names}.', { names: n.names.map(policyName).join('; ') });
      case 'policyUnreadable':
        return t('console.note.policyUnreadable', 'Its policy could not be read, so none of it applies there.');
      case 'osUnreadable':
        return t('console.note.osUnreadable', 'Windows did not say how {name} last ran.', { name: profileName({ id: n.id, managed: n.id === 'policy' }) });
      default:
        return n.code;
    }
  }

  /* ---------------------------------------------------------------- filter + sort */

  const FILTERS = [
    { id: 'all', label: () => t('console.filter.all', 'All'), test: () => true },
    { id: 'attention', label: () => t('console.filter.attention', 'Needs a look'), test: (m) => m.attention.length > 0 },
    { id: 'stale', label: () => t('console.filter.stale', 'Silent'), test: (m) => m.stale },
    { id: 'tasks', label: () => t('console.filter.tasks', 'Task problems'), test: (m) => m.attention.some((a) => /^task/.test(a.code)) },
    { id: 'full', label: () => t('console.filter.full', 'Filling up'), test: (m) => m.attention.some((a) => a.code === 'fillsSoon' || a.code === 'nearlyFull') },
    { id: 'journal', label: () => t('console.filter.journal', 'Journal'), test: (m) => m.attention.some((a) => /^seal|^journal/.test(a.code)) },
  ];

  const SORTS = {
    host: (m) => m.host.toLowerCase(),
    used: (m) => (m.primary ? m.primary.usedPercent : -1),
    growth: (m) => (m.primary && m.primary.growth && m.primary.growth.ok ? m.primary.growth.bytesPerDay : -Infinity),
    full: (m) => (m.primary && m.primary.fullIn && m.primary.fullIn.ok ? m.primary.fullIn.days : Infinity),
    run: (m) => (m.lastRun ? m.lastRun.at : 0),
    report: (m) => m.generatedAt,
    attention: (m) => m.attention.length,
  };

  function visibleMachines() {
    const machines = view.result && view.result.ok ? view.result.machines : [];
    const filter = FILTERS.find((f) => f.id === view.filter) || FILTERS[0];
    const q = view.query.trim().toLowerCase();
    const key = SORTS[view.sort.key] || SORTS.attention;
    return machines
      .filter((m) => filter.test(m) && (!q || m.host.toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        const order = x < y ? -1 : x > y ? 1 : 0;
        return order * view.sort.dir || a.host.localeCompare(b.host);
      });
  }

  /* ---------------------------------------------------------------- drawing */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function drawHeader() {
    const share = view.info && view.info.share;
    setText($('console-share'), share ? t('console.share', 'Reports in {folder}', { folder: share }) : t('console.share.none', 'No folder chosen'));
    $('console-pick').disabled = !(view.info && view.info.allowed);
    $('console-reload').disabled = !(view.info && view.info.allowed && share) || view.reading;
    $('console-csv').disabled = !(view.result && view.result.ok && view.result.machines.length > 0);
    document.title = t('console.windowTitle', 'CleanDrive Console');
  }

  /** The card that stands in for the list; `after` comes under the command line, when there is one. */
  function showGate(title, text, { command = false, after = '' } = {}) {
    $('console-gate').hidden = !title;
    if (!title) return;
    setText($('console-gate-title'), title);
    setText($('console-gate-text'), text);
    $('console-gate-command').hidden = !command;
    $('console-gate-after').hidden = !after;
    setText($('console-gate-after'), after);
  }

  function readErrorText(r) {
    if (r.code === 'ENOENT') return t('console.error.missing', 'There is no folder at {folder}.', { folder: r.share });
    if (r.code === 'EACCES' || r.code === 'EPERM') return t('console.error.denied', 'This account may not read {folder}.', { folder: r.share });
    if (r.code === 'ENOTDIR') return t('console.error.notFolder', '{folder} is not a folder.', { folder: r.share });
    return t('console.error.other', '{folder} could not be read ({code}). The server may not be answering, or the name may be wrong.', { folder: r.share, code: r.code || '?' });
  }

  function drawStatus() {
    const r = view.result;
    let text = '';
    if (view.reading) text = t('console.status.reading', 'Reading {folder}…', { folder: view.info.share });
    else if (r && r.ok) {
      text = t('console.status.read', '{n} {computers} read at {time}, in {ms} ms.', {
        n: count(r.machines.length),
        computers: word(r.machines.length, 'console.word.computer', 'computer', 'computers'),
        time: when(r.readAt),
        ms: count(r.ms),
      });
      const look = r.machines.filter((m) => m.attention.length > 0).length;
      if (look > 0) text += ` ${t('console.status.look', '{n} {need} a look.', { n: count(look), need: word(look, 'console.word.need', 'needs', 'need') })}`;
    } else if (r && r.ok === false) text = readErrorText(r);
    setText($('console-status'), text);
    $('console-status').classList.toggle('is-strong', Boolean(r && r.ok === false));
  }

  function drawGate() {
    const info = view.info;
    const r = view.result;
    if (!info) return showGate(null);
    if (!info.allowed) {
      return showGate(
        t('console.gate.licence.title', 'Not in this copy'),
        t('console.gate.licence.text', 'The console is part of CleanDrive Business, and this copy does not include it. No report was read.')
      );
    }
    if (!info.share) {
      return showGate(
        t('console.gate.noShare.title', 'Which folder?'),
        t('console.gate.noShare.text', 'Choose the folder your computers write their reports to, or start the console with it:'),
        { command: true, after: t('console.gate.noShare.after', 'Each computer writes there once a day when the organisation’s “Daily report” policy is on.') }
      );
    }
    if (r && r.ok && r.machines.length === 0 && r.unreadable.length === 0) {
      return showGate(
        t('console.gate.empty.title', 'No reports here yet'),
        t('console.gate.empty.text', 'A computer writes its report once a day, with its daily disk measurement, once the “Daily report” policy names this folder — or at once, when “cleandrive policy apply” runs as the person signed in.')
      );
    }
    return showGate(null);
  }

  function drawFilters() {
    const host = $('console-filters');
    const machines = view.result && view.result.ok ? view.result.machines : [];
    const buttons = host.querySelectorAll('button[data-filter]');
    if (buttons.length !== FILTERS.length) {
      for (const b of buttons) b.remove();
      for (const f of FILTERS) {
        const b = el('button', 'chip');
        b.type = 'button';
        b.dataset.filter = f.id;
        b.append(el('span', 'chip-name'), el('span', 'chip-meta'));
        host.append(b);
      }
    }
    for (const b of host.querySelectorAll('button[data-filter]')) {
      const f = FILTERS.find((x) => x.id === b.dataset.filter);
      setText(b.querySelector('.chip-name'), f.label());
      setText(b.querySelector('.chip-meta'), count(machines.filter(f.test).length));
      b.classList.toggle('is-active', view.filter === f.id);
      b.setAttribute('aria-pressed', String(view.filter === f.id));
    }
  }

  function drawSortHeaders() {
    for (const th of document.querySelectorAll('#console-table th[data-sort]')) {
      const on = th.dataset.sort === view.sort.key;
      th.setAttribute('aria-sort', on ? (view.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
  }

  const COLUMNS = () => [
    t('console.col.host', 'Computer'),
    t('console.col.drive', 'Drive'),
    t('console.col.growth', 'Growth'),
    t('console.col.full', 'Full in'),
    t('console.col.run', 'Last automatic run'),
    t('console.col.report', 'Report'),
    t('console.col.attention', 'Needs a look'),
  ];

  function rowFor(m, labels) {
    const tr = el('tr', 'console-row');
    tr.dataset.host = m.key;
    tr.classList.toggle('is-attention', m.attention.length > 0);
    tr.classList.toggle('is-selected', view.selected === m.key);
    // Each cell's content in one block, so the narrow layout's label column
    // (td::before) and the value column are the only two things in the cell.
    const cell = (i) => {
      const td = el('td');
      td.dataset.label = labels[i];
      const body = el('div', 'console-cell');
      td.append(body);
      td.body = body;
      return td;
    };

    const host = cell(0);
    const open = el('button', 'console-host', m.host);
    open.type = 'button';
    open.setAttribute('aria-expanded', String(view.selected === m.key));
    open.addEventListener('click', () => select(view.selected === m.key ? null : m.key));
    host.body.append(open, el('span', 'console-sub', t('console.version', 'CleanDrive {version}', { version: m.app.version || '?' })));

    const drive = cell(1);
    if (m.primary) {
      const v = m.primary;
      drive.body.append(el('span', 'console-strong', t('console.drive.line', '{drive} {pct}', { drive: v.root, pct: percent(v.usedPercent) })));
      const meter = el('span', 'console-meter');
      meter.setAttribute('aria-hidden', 'true');
      const fill = el('span', 'console-meter-fill');
      fill.style.width = `${Math.max(0, Math.min(100, v.usedPercent))}%`;
      meter.append(fill);
      drive.body.append(meter);
      drive.body.append(el('span', 'console-sub', t('console.drive.free', '{free} free of {total}', { free: bytes(v.freeBytes), total: bytes(v.totalBytes) })));
      if (m.volumes.length > 1) drive.body.append(el('span', 'console-sub', t('console.drive.more', '+{n} more', { n: count(m.volumes.length - 1) })));
    } else {
      drive.body.append(el('span', 'console-sub', t('console.drive.none', 'no drive measured this week')));
    }

    const growth = cell(2);
    growth.body.append(el('span', null, growthText(m.primary && m.primary.growth)));

    const full = cell(3);
    full.body.append(el('span', m.primary && m.primary.fullIn && m.primary.fullIn.ok ? null : 'console-sub', fullText(m.primary && m.primary.fullIn)));

    const run = cell(4);
    run.body.append(el('span', null, runText(m)));
    if (m.lastRun && m.lastRun.result !== null) run.body.append(el('span', 'console-sub', codeText(m.lastRun.result, m.lastRun.resultText)));

    const report = cell(5);
    report.body.append(el('span', m.stale ? 'console-strong' : null, ago(m.generatedAt)));

    const look = cell(6);
    if (m.attention.length === 0) look.body.append(el('span', 'console-sub', t('console.att.none', 'nothing')));
    else {
      const list = el('ul', 'console-attention');
      for (const a of m.attention) list.append(el('li', null, attentionText(a, m)));
      look.body.append(list);
    }

    tr.append(host, drive, growth, full, run, report, look);
    return tr;
  }

  function drawRows() {
    const r = view.result;
    const ok = Boolean(r && r.ok && r.machines.length > 0);
    $('console-tools').hidden = !ok;
    $('console-table-wrap').hidden = !ok;
    if (!ok) {
      $('console-rows').replaceChildren();
      return;
    }
    const labels = COLUMNS();
    const rows = visibleMachines().map((m) => rowFor(m, labels));
    if (rows.length === 0) {
      const tr = el('tr', 'console-row');
      const td = el('td', 'console-empty', t('console.filter.empty', 'No computer matches.'));
      td.colSpan = 7;
      tr.append(td);
      rows.push(tr);
    }
    $('console-rows').replaceChildren(...rows);
  }

  function drawUnreadable() {
    const r = view.result;
    const list = r && r.ok ? r.unreadable : [];
    $('console-unreadable').hidden = list.length === 0;
    if (list.length === 0) return;
    const WHY = {
      notJson: () => t('console.why.notJson', 'not JSON'),
      notReport: () => t('console.why.notReport', 'not a CleanDrive report'),
      newerSchema: () => t('console.why.newerSchema', 'written by a newer CleanDrive'),
      tooLarge: () => t('console.why.tooLarge', 'too large to be a report'),
      duplicate: () => t('console.why.duplicate', 'another file describes the same computer'),
    };
    const items = list.map((u) => t('console.unreadable.item', '{name} ({why})', { name: u.name, why: WHY[u.why] ? WHY[u.why]() : u.why }));
    setText(
      $('console-unreadable'),
      t('console.unreadable', '{n} {files} could not be used: {list}', {
        n: count(list.length),
        files: word(list.length, 'console.word.file', 'file', 'files'),
        list: items.join('; '),
      })
    );
  }

  function section(title) {
    const box = el('section', 'console-detail-section');
    box.append(el('h3', 'console-detail-head', title));
    return box;
  }

  function factList(rows) {
    const dl = el('dl', 'console-facts');
    for (const [k, v] of rows) {
      dl.append(el('dt', null, k), el('dd', null, v));
    }
    return dl;
  }

  function drawDetail() {
    const r = view.result;
    const m = r && r.ok ? r.machines.find((x) => x.key === view.selected) : null;
    $('console-detail').hidden = !m;
    if (!m) return;
    setText($('console-detail-title'), m.host);
    const body = [];

    body.push(
      factList([
        [t('console.detail.report', 'Report'), t('console.detail.reportAt', '{when} ({ago})', { when: when(m.generatedAt), ago: ago(m.generatedAt) })],
        [t('console.detail.version', 'Version'), `${m.app.version || '?'}${m.app.channel ? ` (${m.app.channel})` : ''}`],
        [t('console.detail.file', 'File'), m.file],
      ])
    );

    if (m.attention.length > 0 || m.notes.length > 0) {
      const s = section(t('console.detail.look', 'Needs a look'));
      if (m.attention.length > 0) {
        const ul = el('ul', 'console-attention');
        for (const a of m.attention) ul.append(el('li', null, attentionText(a, m)));
        s.append(ul);
      }
      for (const n of m.notes) s.append(el('p', 'console-note', noteText(n)));
      body.push(s);
    }

    {
      const s = section(t('console.detail.drives', 'Drives'));
      if (m.volumes.length === 0) s.append(el('p', 'console-note', t('console.drive.none', 'no drive measured this week')));
      for (const v of m.volumes) {
        s.append(
          factList([
            [v.root, t('console.detail.driveLine', '{pct} full, {free} free of {total}, measured {when}', { pct: percent(v.usedPercent), free: bytes(v.freeBytes), total: bytes(v.totalBytes), when: when(v.measuredAt) })],
            [t('console.col.growth', 'Growth'), v.growth && v.growth.ok ? growthText(v.growth) : v.growth && v.growth.reason ? tm(v.growth.reason) : growthText(v.growth)],
            [t('console.col.full', 'Full in'), fullText(v.fullIn)],
          ])
        );
      }
      body.push(s);
    }

    {
      const s = section(t('console.detail.tasks', 'Automatic cleanup'));
      const profiles = m.tasks ? m.tasks.profiles : [];
      if (!m.tasks) s.append(el('p', 'console-note', t('console.detail.tasksUnknown', 'The report says nothing about tasks.')));
      else if (profiles.length === 0) s.append(el('p', 'console-note', t('console.run.noProfile', 'no cleanup profile')));
      for (const p of profiles) {
        const state = !p.enabled
          ? t('console.task.off', 'off')
          : !p.installed
            ? t('console.task.missing', 'on, but no Windows task')
            : !p.verified
              ? t('console.task.wrong', 'on, but the Windows task does not match')
              : p.reportOnly
                ? t('console.task.reportOnly', 'on, report only')
                : t('console.task.on', 'on');
        const rows = [[profileName(p), state]];
        if (p.os && p.os.lastRunAt) rows.push([t('console.task.windowsLast', 'Windows ran it'), `${when(p.os.lastRunAt)} · ${codeText(p.os.lastResult, p.os.resultText)}`]);
        if (p.os && p.os.nextRunAt) rows.push([t('console.task.next', 'Next run'), when(p.os.nextRunAt)]);
        if (p.lastRun) {
          const lr = p.lastRun;
          rows.push([
            t('console.task.appLast', 'The app recorded'),
            t('console.run.line', '{when} · {outcome} · {what}', {
              when: when(lr.at),
              outcome: outcomeText(lr.outcome),
              what: lr.reportOnly
                ? t('console.run.reported', 'report only: {n} {files}', { n: count(lr.selected.files), files: word(lr.selected.files, 'console.word.file', 'file', 'files') })
                : t('console.run.moved', '{n} {files}, {size}', { n: count(lr.moved.files), files: word(lr.moved.files, 'console.word.file', 'file', 'files'), size: bytes(lr.moved.bytes) }),
            }),
          ]);
          if (lr.reason) rows.push([t('console.task.reason', 'Why'), tm(lr.reason)]);
        }
        s.append(factList(rows));
      }
      if (m.tasks && m.tasks.sampler) {
        s.append(
          el(
            'p',
            'console-note',
            m.tasks.sampler.installed && m.tasks.sampler.verified
              ? t('console.task.sampler', 'The daily measurement that writes this report is registered.')
              : t('console.task.samplerWrong', 'The daily measurement that writes this report is not registered as it should be; the report may stop.')
          )
        );
      }
      body.push(s);
    }

    {
      const s = section(t('console.detail.scan', 'Last scan run by hand'));
      const scan = m.lastScan;
      if (!scan) s.append(el('p', 'console-note', t('console.scan.none', 'Nobody has run a scan on this computer.')));
      else {
        const what =
          scan.rootKind === 'drive'
            ? t('console.scan.drive', 'the whole of {drive}', { drive: scan.drive || '?' })
            : scan.rootKind === 'folder'
              ? t('console.scan.folder', 'one folder on {drive}', { drive: scan.drive || '?' })
              : t('console.scan.network', 'a folder on the network');
        s.append(factList([[t('console.scan.when', 'When'), when(scan.at)], [t('console.scan.what', 'What'), t('console.scan.size', '{what} — {size}, {n} {files}', { what, size: bytes(scan.totalBytes), n: count(scan.totalFiles), files: word(scan.totalFiles, 'console.word.file', 'file', 'files') })]]));
        const cats = Object.entries(scan.categories).sort((a, b) => b[1] - a[1]);
        if (cats.length > 0) {
          s.append(el('p', 'console-note', t('console.scan.categories', 'What it would clean, by category:')));
          s.append(factList(cats.map(([k, v]) => [t(`category.${k}`, k), bytes(v)])));
        }
        if (scan.topFolders) {
          s.append(el('p', 'console-note', t('console.scan.top', 'Largest folders (sent because the policy allows it):')));
          s.append(factList(scan.topFolders.map((f) => [f.name, bytes(f.size)])));
        }
      }
      body.push(s);
    }

    {
      const s = section(t('console.detail.journal', 'Journal'));
      const j = m.journal;
      if (!j) s.append(el('p', 'console-note', t('console.journal.unknown', 'The report says nothing about the journal.')));
      else {
        const rows = [
          [t('console.journal.sessions', 'Sessions'), t('console.journal.counts', '{sealed} sealed, {unsealed} not sealed, {altered} changed', { sealed: count(j.sessions.sealed), unsealed: count(j.sessions.unsealed + j.sessions.legacy + j.sessions.incomplete), altered: count(j.sessions.altered) })],
        ];
        if (j.seal) rows.push([t('console.journal.seal', 'Newest seal'), t('console.journal.sealLine', 'no. {n}, {when}', { n: count(j.seal.n), when: when(j.seal.at) })]);
        else rows.push([t('console.journal.seal', 'Newest seal'), t('console.journal.noSeal', 'none — sealing is part of CleanDrive Business')]);
        const STATE = {
          new: () => t('console.seal.new', 'first seen by this console now'),
          same: () => t('console.seal.same', 'the same as last time'),
          advanced: () => t('console.seal.advanced', 'newer than last time, and every number seen before still matches'),
          back: () => t('console.seal.back', 'went backwards since this console last read it'),
          rewritten: () => t('console.seal.rewritten', 'a number seen before now carries a different seal'),
          gone: () => t('console.seal.gone', 'gone, where there were seals before'),
          none: () => t('console.seal.none', 'nothing to compare'),
        };
        rows.push([t('console.journal.check', 'This console’s check'), STATE[m.seal.state] ? STATE[m.seal.state]() : m.seal.state]);
        s.append(factList(rows));
        s.append(el('p', 'console-note', t('console.journal.limit', 'This console keeps every seal number it has seen for each computer. It notices sessions removed or a journal re-signed after it has read a report, and not a person who forges every report from then on.')));
        if (m.seal.state === 'back' || m.seal.state === 'rewritten' || m.seal.state === 'gone') {
          const forget = el('button', 'btn btn-sm', t('console.journal.forget', 'Start this computer’s seals again from its next report'));
          forget.type = 'button';
          forget.addEventListener('click', async () => {
            const reply = await api.consoleForget(m.host);
            if (!reply || !reply.ok) return;
            await read();
            // The button is gone once the seals start again; the keyboard goes
            // back to the machine's name rather than to the page.
            const row = [...document.querySelectorAll('#console-rows tr[data-host]')].find((tr) => tr.dataset.host === m.key);
            if (row) row.querySelector('.console-host').focus({ preventScroll: true });
          });
          s.append(forget);
        }
      }
      body.push(s);
    }

    if (m.policy) {
      const s = section(t('console.detail.policy', 'Organisation policy'));
      const named = (list) => list.map(policyName).join('; ');
      s.append(
        factList([
          [t('console.policy.applied', 'Applied'), m.policy.applied.length > 0 ? named(m.policy.applied) : t('console.policy.nothing', 'none')],
          ...(m.policy.notApplied.length > 0 ? [[t('console.policy.notApplied', 'Not applied (needs Business)'), named(m.policy.notApplied)]] : []),
          ...(m.policy.refused.length > 0 ? [[t('console.policy.refused', 'Refused'), named(m.policy.refused)]] : []),
        ])
      );
      body.push(s);
    }

    $('console-detail-body').replaceChildren(...body);
  }

  function drawFoot() {
    const th = view.result && view.result.thresholds;
    setText(
      $('console-foot'),
      t(
        'console.foot',
        'Read only. Each computer writes its report once a day; one silent for more than {stale} days is marked. “Fills in” is the computer’s own trend, and is marked within {soon} days; a drive over {full}% is marked too. No report names a file or a folder.',
        { stale: th ? th.staleDays : 2, soon: th ? th.fillsSoonDays : 30, full: th ? th.nearlyFullPercent : 95 }
      )
    );
  }

  function draw() {
    drawHeader();
    drawStatus();
    drawGate();
    drawFilters();
    drawSortHeaders();
    drawRows();
    drawUnreadable();
    drawDetail();
    drawFoot();
  }

  /**
   * Open one machine's detail, or close it. The rows are drawn again, so the
   * button the keyboard was on is replaced -- and focus would fall to the
   * page, taking a screen reader with it (test:a11y caught it). It goes back
   * to the same machine's button in the new row.
   */
  function select(key) {
    const active = document.activeElement;
    const fromRow = active && active.classList.contains('console-host') ? active.closest('tr').dataset.host : null;
    const fromDetail = active && $('console-detail').contains(active);
    const back = key || view.selected;
    view.selected = key;
    draw();
    if (fromRow || fromDetail) {
      const row = [...document.querySelectorAll('#console-rows tr[data-host]')].find((tr) => tr.dataset.host === (fromRow || back));
      const button = row && row.querySelector('.console-host');
      if (button) button.focus({ preventScroll: true });
    }
    if (key) $('console-detail').scrollIntoView({ block: 'nearest' });
  }

  /* ---------------------------------------------------------------- talking to main */

  async function loadInfo() {
    const reply = await api.consoleInfo();
    view.info = reply && reply.ok ? reply.data : { allowed: false, share: null };
  }

  async function read() {
    if (!view.info || !view.info.allowed || !view.info.share) {
      draw();
      return;
    }
    view.reading = true;
    draw();
    const reply = await api.consoleRead();
    view.reading = false;
    view.result = reply && reply.ok ? reply.data : { ok: false, share: view.info.share, code: 'ERROR' };
    if (view.selected && !(view.result.ok && view.result.machines.some((m) => m.key === view.selected))) view.selected = null;
    draw();
  }

  /* ---------------------------------------------------------------- wiring */

  $('console-reload').addEventListener('click', () => read());
  $('console-pick').addEventListener('click', async () => {
    const reply = await api.consolePick();
    if (reply && reply.ok) {
      const before = view.info && view.info.share;
      view.info = reply.data;
      if (view.info.share !== before) {
        view.result = null;
        view.selected = null;
      }
      await read();
    }
  });
  $('console-csv').addEventListener('click', async () => {
    const reply = await api.consoleExportCsv();
    if (reply && reply.ok && reply.data.saved) {
      setText($('console-status'), t('console.csv.saved', 'Saved {file}.', { file: reply.data.file }));
    } else if (reply && !reply.ok) {
      setText($('console-status'), t('console.csv.failed', 'The CSV could not be saved: {error}', { error: reply.error }));
    }
  });
  $('console-search').addEventListener('input', (event) => {
    view.query = event.target.value;
    drawRows();
  });
  $('console-filters').addEventListener('click', (event) => {
    const b = event.target.closest('button[data-filter]');
    if (!b) return;
    view.filter = b.dataset.filter;
    drawFilters();
    drawRows();
  });
  for (const th of document.querySelectorAll('#console-table th[data-sort]')) {
    th.querySelector('button').addEventListener('click', () => {
      const key = th.dataset.sort;
      view.sort = view.sort.key === key ? { key, dir: -view.sort.dir } : { key, dir: key === 'host' ? 1 : -1 };
      drawSortHeaders();
      drawRows();
    });
  }
  $('console-detail-close').addEventListener('click', () => select(null));

  /** For the screenshot harness: which machines are drawn, in order. */
  window.ConsoleView = { state: () => view, read, select };

  loadInfo().then(read);
})();
