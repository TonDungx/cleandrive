'use strict';

/**
 * "I need 30 GB on C:" — and where it would come from (G1).
 *
 * Loaded after app.js and sharing its globals. Every other screen answers
 * *what is here*; this one answers *what do I do about it*, and it does that
 * by measuring the other screens and sorting what they found by risk.
 *
 * ## There is no "do it" button, on purpose
 *
 * Every step is a link to the screen that already offers that work, where the
 * rows are ticked and confirmed exactly as they would have been. A button
 * here that deleted nine categories of file across six screens on one click
 * would be the one thing this app has never done.
 *
 * ## Three ways space comes back, and they are not the same
 *
 * A step says how much it moves and how much that gives back, because those
 * are different numbers. Moving a file to the Recycle Bin frees nothing --
 * the bin is on the same volume -- so the plan carries a step for emptying
 * it, and that is where the running total climbs. `planner/plan.js` works
 * this out; this file only draws it.
 */
(function () {
  const FEATURE = 'pro.planner';
  const GB = 1024 ** 3;

  /** The last plan drawn, so a language change can redraw without measuring. */
  let plan = null;
  let running = false;

  const el = (id) => $(id);

  /* ---- the goal ---------------------------------------------------------- */

  function goalFromForm() {
    const amount = Number(el('plan-amount').value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = el('plan-unit').value === 'TB' ? GB * 1024 : GB;
    return { kind: 'bytes', bytes: Math.round(amount * unit) };
  }

  async function fillDrives() {
    const select = el('plan-drive');
    if (select.options.length > 0) return;
    const drives = unwrap(await api.scanDrives(), t('planner.title', 'Plan')) || [];
    const rows = drives.length
      ? drives
      : [{ root: 'C:\\', volume: 'C:\\', label: null }];
    for (const drive of rows) {
      const option = document.createElement('option');
      option.value = drive.root;
      option.textContent = drive.label ? `${drive.volume} ${drive.label}` : drive.volume;
      select.appendChild(option);
    }
  }

  /* ---- drawing ----------------------------------------------------------- */

  /** What each step is, and where it sends you. */
  function stepTitle(id) {
    switch (id) {
      case 'caches': return t('planner.step.caches', 'Temporary files, caches and logs');
      case 'cloud': return t('planner.step.cloud', 'Files OneDrive can keep online only');
      case 'buildoutput': return t('planner.step.buildoutput', 'Build output your own .gitignore declares');
      case 'devtools': return t('planner.step.devtools', 'Developer tools’ caches');
      case 'bin': return t('planner.step.bin', 'Empty what CleanDrive put in the Recycle Bin');
      case 'system': return t('planner.step.system', 'System areas Windows can reclaim');
      case 'review': return t('planner.step.review', 'Old installers, big archives, untouched files');
      case 'dupes': return t('planner.step.dupes', 'Duplicate copies');
      case 'apps': return t('planner.step.apps', 'Programs you have not started in months');
      case 'games': return t('planner.step.games', 'Games you have not played');
      default: return id;
    }
  }

  function stepNote(id) {
    switch (id) {
      case 'bin':
        return t('planner.note.bin', 'Everything above that went to the bin is still on this drive until here.');
      case 'system':
        return t('planner.note.system', 'CleanDrive opens Windows’ own tool for these and never removes them itself.');
      case 'apps':
      case 'games':
        return t('planner.note.handoff', 'CleanDrive opens the uninstaller; Windows frees the space.');
      case 'cloud':
        return t('planner.note.cloud', 'The file stays in OneDrive and comes back when you open it, if you are online.');
      default:
        return null;
    }
  }

  /** The one sentence that says how the space comes back. */
  function mechanism(step) {
    if (step.id === 'bin') return t('planner.frees.here', 'Frees {size} here', { size: formatBytes(step.freesNow) });
    if (step.freesNow > 0) {
      return t('planner.frees.now', 'Frees {size} straight away', { size: formatBytes(step.freesNow) });
    }
    if (step.afterBin > 0) {
      return t('planner.frees.bin', 'Moves {size} to the Recycle Bin — not freed until it is emptied', {
        size: formatBytes(step.afterBin),
      });
    }
    if (step.viaWindows > 0) {
      return t('planner.frees.windows', 'Windows frees {size} when you go through with it', {
        size: formatBytes(step.viaWindows),
      });
    }
    return t('planner.frees.none', 'Nothing here frees space on this drive');
  }

  function stepRow(step, index, reachedAt) {
    const li = document.createElement('li');
    li.className = 'plan-step';
    if (step.derived) li.classList.add('is-derived');
    if (reachedAt !== -1 && index > reachedAt) li.classList.add('is-beyond');

    const head = document.createElement('div');
    head.className = 'plan-step-head';

    const title = document.createElement('strong');
    title.textContent = stepTitle(step.id);
    head.appendChild(title);

    const size = document.createElement('span');
    size.className = 'plan-step-size';
    size.textContent = mechanism(step);
    head.appendChild(size);
    li.appendChild(head);

    if (step.count > 0) {
      const count = document.createElement('p');
      count.className = 'plan-step-count';
      // "items", not "files": a step can hold folders and things that are not
      // files at all -- hiberfil.sys, Windows.old, a restore point, an
      // installed program. Calling three of those "3 files" would be the kind
      // of small untruth this app is built not to tell.
      count.textContent = t('planner.count', '{n} {items}, {size} in all', {
        n: formatCount(step.count),
        items: word(step.count, 'app.item', 'item', 'items'),
        size: formatBytes(step.moves),
      });
      li.appendChild(count);
    }

    const note = stepNote(step.id);
    if (note) {
      const p = document.createElement('p');
      p.className = 'plan-step-note';
      p.textContent = note;
      li.appendChild(p);
    }

    const foot = document.createElement('div');
    foot.className = 'plan-step-foot';

    const running = document.createElement('span');
    running.className = 'plan-step-running';
    running.textContent = t('planner.running', '{size} of {target} by this point', {
      size: formatBytes(step.cumulative),
      target: formatBytes(plan.target),
    });
    foot.appendChild(running);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn btn-sm';
    go.textContent = step.id === 'bin'
      ? t('planner.go.bin', 'Open Restore')
      : t('planner.go', 'Take me there');
    go.addEventListener('click', () => {
      const tab = document.querySelector(`.tab[data-tab="${step.screen}"]`);
      if (tab) tab.click();
      // The group this step is about, brought into view on the screen that
      // owns it. Nothing is ticked: the choosing is still the user's.
      requestAnimationFrame(() => {
        const first = step.categories[0];
        const target = first && document.querySelector(`#panel-${step.screen} [data-category="${first}"]`);
        if (target) {
          target.scrollIntoView({ block: 'center' });
          target.classList.add('is-pointed');
          setTimeout(() => target.classList.remove('is-pointed'), 2000);
        }
      });
    });
    foot.appendChild(go);
    li.appendChild(foot);
    return li;
  }

  function draw() {
    if (!plan) return;
    const host = el('plan-steps');
    const steps = plan.steps || [];

    el('plan-bar').hidden = false;
    const pct = plan.target > 0 ? Math.min(100, (plan.total / plan.target) * 100) : 0;
    el('plan-bar-fill').style.width = `${pct.toFixed(1)}%`;
    el('plan-bar-fill').classList.toggle('is-short', !plan.reached);
    setText(el('plan-bar-note'), plan.reached
      ? t('planner.reached', 'The steps below add up to {size}, which covers the {target} you asked for.', {
        size: formatBytes(plan.total),
        target: formatBytes(plan.target),
      })
      : t('planner.short', 'The sources CleanDrive knows about come to {size} of the {target} you asked for. The rest would have to be your own files — see Disk usage.', {
        size: formatBytes(plan.total),
        target: formatBytes(plan.target),
      }));

    host.hidden = steps.length === 0;
    el('plan-empty').hidden = steps.length > 0 || running;
    if (steps.length === 0 && !running) {
      setText(el('plan-empty'), t('planner.empty', 'Nothing was found that could be freed on this drive.'));
    }
    replaceChildrenIfChanged(host, steps.map((s, i) => stepRow(s, i, plan.reachedAt)));

    drawMissing();
  }

  function missingReason(row) {
    if (row.id === 'dupes') {
      return t('planner.missing.dupes', 'Duplicates were not searched for: finding them means reading every file on the drive, not just its size. Run the Duplicates screen if you want them counted.');
    }
    if (row.id === 'system') {
      return t('planner.missing.system', 'The system areas were not measured. Tick the box above and run it again — that one needs administrator.');
    }
    return t('planner.missing.other', '{source} could not be measured, so nothing from it is in this plan.', {
      source: stepTitle(row.id),
    });
  }

  function drawMissing() {
    const host = el('plan-missing');
    const rows = (plan && plan.missing) || [];
    host.hidden = rows.length === 0;
    replaceChildrenIfChanged(host, rows.map((row) => {
      const p = document.createElement('p');
      p.className = 'plan-missing-row';
      p.textContent = missingReason(row);
      return p;
    }));
  }

  /* ---- running it -------------------------------------------------------- */

  function setRunning(on) {
    running = on;
    el('plan-run').disabled = on;
    el('plan-cancel').hidden = !on;
    el('plan-progress').hidden = !on;
    el('plan-amount').disabled = on;
    el('plan-drive').disabled = on;
    el('plan-system').disabled = on;
  }

  api.onPlannerProgress((payload) => {
    if (!payload) return;
    if (payload.phase === 'measuring') {
      setText(el('plan-status'), t('planner.measuring', 'Measuring {source}… ({done} of {total})', {
        source: stepTitle(payload.source),
        done: formatCount(payload.done + 1),
        total: formatCount(payload.total),
      }));
      return;
    }
    if (payload.phase === 'partial' && payload.plan) {
      // The plan fills in as each source finishes. A whole drive, the tools,
      // the programs and the games is minutes, and a screen that stayed empty
      // until the last of them would be a screen nobody waits for.
      plan = payload.plan;
      draw();
    }
  });

  async function run() {
    await loadEntitlements();
    const refusal = UpgradeHint(FEATURE, t('planner.upgrade', 'The Space Planner is part of CleanDrive Pro.'));
    if (refusal) {
      const host = el('plan-missing');
      host.hidden = false;
      host.replaceChildren(refusal);
      return;
    }
    const goal = goalFromForm();
    if (!goal) {
      setText(el('plan-status'), t('planner.noGoal', 'Say how much room you need first.'));
      return;
    }
    setRunning(true);
    el('plan-empty').hidden = true;
    const result = unwrap(
      await api.planSpace({ drive: el('plan-drive').value, goal, includeSystem: el('plan-system').checked }),
      t('planner.title', 'Plan')
    );
    setRunning(false);
    if (!result) {
      setText(el('plan-status'), t('planner.failed', 'The plan could not be worked out.'));
      return;
    }
    plan = result;
    draw();
    setText(el('plan-status'), result.cancelled
      ? t('planner.stopped', 'Stopped — the plan below only covers what was measured before that.')
      : t('planner.done', 'Every source CleanDrive can measure was measured.'));
    announce(el('plan-bar-note').textContent);
  }

  el('plan-run').addEventListener('click', () => { run().catch(() => setRunning(false)); });
  el('plan-cancel').addEventListener('click', () => api.cancelPlan());

  // The bar at the top reads the real volume again whenever the app says
  // something on disk changed, so a delete made on another screen shows here
  // without re-measuring everything.
  api.onDataChanged(() => {
    if (!plan || running) return;
    api.plannerVolume(el('plan-drive').value)
      .then((reply) => {
        const volume = unwrap(reply, t('planner.title', 'Plan'));
        if (volume) plan.volume = volume;
      })
      .catch(() => {});
  });

  onLanguageChange(() => { if (plan) draw(); });

  // The drive list, once, at startup. `scan:drives` is cached for a minute in
  // the main process, and there is no hook for "this tab was opened" -- every
  // other screen waits for its own button too.
  fillDrives().catch(() => {});

  window.Planner = { draw, fillDrives };
})();
