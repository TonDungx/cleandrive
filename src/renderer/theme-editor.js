'use strict';

/**
 * Settings → Your own colours.
 *
 * Eleven colour pickers, each with the same colour written out as #rrggbb
 * beside it (a colour dialog is not something everybody can operate, and a
 * value somebody was sent is easier typed than picked). Every change is
 * checked at once against the rules in src/shared/theme-palette.js -- the
 * same function the main process runs on save and on import -- and drawn in
 * a small preview inside the card. The window itself only changes when the
 * palette passes and "Use these colours" is pressed: a palette being edited
 * can be unreadable half way through, and it must not take the whole window
 * down with it.
 *
 * Pass and fail are words and weight, never green and red. Those colours are
 * the verdicts', and on this card they may be the very colours being changed.
 */
(() => {
  const T = window.CleanDriveTheme;
  const card = $('custom-card');
  if (!T || !card || !window.ThemeSwitch) return;

  const rowsEl = $('custom-colors');
  const preview = $('custom-preview');
  const summary = $('custom-summary');
  const report = $('custom-report');
  const nameEl = $('custom-name');
  const baseEl = $('custom-base');
  const useBtn = $('custom-use');
  const forgetBtn = $('custom-forget');
  const statusEl = $('custom-status');
  const stateEl = $('custom-state');

  /** The palette being edited. */
  let draft = null;
  /** The last verdict on it. */
  let verdict = null;

  const clone = (theme) => ({ format: T.FORMAT, version: T.VERSION, name: theme.name || '', base: theme.base, colors: { ...theme.colors } });

  function effectiveBase() {
    const mode = ThemeSwitch.current();
    if (mode === 'light' || mode === 'dark') return mode;
    if (mode === 'custom' && ThemeSwitch.stored()) return ThemeSwitch.stored().base;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function start() {
    const stored = ThemeSwitch.stored();
    draft = stored ? clone(stored) : T.template(effectiveBase(), '');
  }

  const label = (key) => {
    const entry = T.LABELS[key] || [key, key];
    return t(entry[0], entry[1]);
  };

  /* ------------------------------------------------------------ rows */

  const inputs = {};

  function buildRows() {
    rowsEl.replaceChildren();
    for (const key of T.KEYS) {
      const row = document.createElement('div');
      row.className = 'custom-row';
      row.dataset.key = key;

      const name = document.createElement('label');
      name.className = 'custom-row-label';
      name.htmlFor = `custom-c-${key}`;
      name.textContent = label(key);

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.id = `custom-c-${key}`;
      picker.className = 'custom-picker';

      const hex = document.createElement('input');
      hex.type = 'text';
      hex.className = 'custom-hex';
      hex.maxLength = 7;
      hex.spellcheck = false;
      hex.setAttribute('aria-label', t('custom.hexLabel', '{name}, written #rrggbb', { name: label(key) }));

      const mark = document.createElement('span');
      mark.className = 'custom-row-mark';

      picker.addEventListener('input', () => {
        draft.colors[key] = picker.value.toLowerCase();
        hex.value = draft.colors[key];
        update();
      });
      hex.addEventListener('input', () => {
        const value = hex.value.trim();
        const ok = /^#[0-9a-f]{6}$/i.test(value);
        hex.setAttribute('aria-invalid', String(!ok));
        if (!ok) return;
        draft.colors[key] = value.toLowerCase();
        picker.value = draft.colors[key];
        update();
      });
      hex.addEventListener('blur', () => {
        // A half-typed value goes back to the colour in use rather than
        // staying on screen looking as though it had been taken.
        hex.value = draft.colors[key];
        hex.removeAttribute('aria-invalid');
      });

      row.append(name, picker, hex, mark);
      rowsEl.appendChild(row);
      inputs[key] = { picker, hex, mark };
    }
  }

  function fillRows() {
    nameEl.value = draft.name;
    baseEl.value = draft.base;
    for (const key of T.KEYS) {
      inputs[key].picker.value = draft.colors[key];
      inputs[key].hex.value = draft.colors[key];
    }
  }

  /* ------------------------------------------------------------ checking */

  function paintPreview() {
    for (const [token, value] of Object.entries(T.derive(draft.colors, draft.base))) {
      preview.style.setProperty(token, value);
    }
    preview.style.colorScheme = draft.base;
  }

  function sameAsStored() {
    const stored = ThemeSwitch.stored();
    if (!stored) return false;
    return stored.base === draft.base && (stored.name || '') === draft.name && T.KEYS.every((k) => stored.colors[k] === draft.colors[k]);
  }

  function update() {
    verdict = T.check(draft);
    paintPreview();

    // Per row: how many of the failing checks it is part of.
    for (const key of T.KEYS) {
      const involved = verdict.failures.filter((f) => f.key === key || f.against === key).length;
      const mark = inputs[key].mark;
      mark.textContent = involved ? t('custom.rowFails', '{n} to fix', { n: involved }) : t('custom.rowOk', 'passes');
      mark.classList.toggle('is-failing', involved > 0);
    }

    const total = verdict.checks.length;
    summary.textContent = verdict.ok
      ? t('custom.allPass', 'All {n} checks pass.', { n: total })
      : t('custom.someFail', '{fail} of {n} checks fail, so these colours cannot be used yet:', { fail: verdict.failures.length, n: total });
    report.replaceChildren(
      ...verdict.failures.map((failure) => {
        const li = document.createElement('li');
        li.textContent = tm(T.describe(failure));
        return li;
      })
    );

    const stored = ThemeSwitch.stored();
    const inUse = ThemeSwitch.current() === 'custom' && sameAsStored();
    useBtn.disabled = !verdict.ok || inUse;
    forgetBtn.hidden = !stored;
    stateEl.textContent = inUse
      ? t('custom.state.inUse', 'In use')
      : stored && sameAsStored()
        ? t('custom.state.saved', 'Saved, not in use')
        : stored
          ? t('custom.state.changed', 'Changed, not used yet')
          : t('custom.state.none', 'Not saved');
  }

  /* ------------------------------------------------------------ actions */

  nameEl.addEventListener('input', () => {
    draft.name = nameEl.value.slice(0, T.MAX_NAME);
    update();
  });

  baseEl.addEventListener('change', () => {
    draft.base = baseEl.value === 'dark' ? 'dark' : 'light';
    update();
  });

  $('custom-reset').addEventListener('click', () => {
    draft = T.template(draft.base, draft.name);
    fillRows();
    update();
    statusEl.textContent = t('custom.resetDone', 'Back to the built-in {base} colours.', {
      base: draft.base === 'dark' ? t('app.theme.dark', 'Dark') : t('app.theme.light', 'Light'),
    });
  });

  $('custom-import').addEventListener('click', async () => {
    const reply = await api.importTheme();
    const data = unwrap(reply, t('custom.import', 'Import…'));
    if (!data || data.cancelled) return;
    if (data.refused) {
      // The file's shape is wrong: nothing in it is taken.
      statusEl.textContent = t('custom.importRefused', 'That file was not taken: {why}', {
        why: data.errors.map((e) => tm(e)).join(' '),
      });
      announce(statusEl.textContent, { assertive: true });
      return;
    }
    draft = clone(data.theme);
    fillRows();
    update();
    const parts = [t('custom.imported', 'Read {file}.', { file: data.file })];
    if (data.filled && data.filled.length) {
      parts.push(
        t('custom.importFilled', '{n} colours were not in it and come from the built-in {base} theme.', {
          n: data.filled.length,
          base: draft.base === 'dark' ? t('app.theme.dark', 'Dark') : t('app.theme.light', 'Light'),
        })
      );
    }
    parts.push(verdict.ok ? t('custom.importReady', 'Nothing is used until you press Use these colours.') : summary.textContent);
    statusEl.textContent = parts.join(' ');
    announce(statusEl.textContent);
  });

  $('custom-export').addEventListener('click', async () => {
    const data = unwrap(await api.exportTheme(draft), t('custom.export', 'Export…'));
    if (!data || data.cancelled) return;
    toast(t('custom.exported', 'Saved these colours as {file}.', { file: data.file }));
  });

  useBtn.addEventListener('click', async () => {
    const data = unwrap(await api.saveCustomTheme(draft, { use: true }), t('custom.use', 'Use these colours'));
    if (!data) return;
    if (!data.saved) {
      // The main process disagreed with the editor. It is the authority.
      statusEl.textContent = t('custom.refusedByApp', 'The app did not accept these colours: {why}', {
        why: (data.errors || []).concat((data.failures || []).map((f) => f.message)).map((e) => tm(e)).join(' '),
      });
      announce(statusEl.textContent, { assertive: true });
      return;
    }
    ThemeSwitch.setStored(data.custom);
    ThemeSwitch.adopt('custom', useBtn);
    statusEl.textContent = t('custom.used', 'These colours are in use.');
    announce(statusEl.textContent);
    update();
  });

  forgetBtn.addEventListener('click', async () => {
    const data = unwrap(await api.saveCustomTheme(null), t('custom.forget', 'Forget my colours'));
    if (!data) return;
    ThemeSwitch.setStored(null);
    ThemeSwitch.adopt(data.theme, forgetBtn);
    // The draft stays, so a forget pressed by mistake is one click from undone.
    statusEl.textContent = t('custom.forgotten', 'Forgotten. They are still here until the app closes; Use these colours keeps them again.');
    announce(statusEl.textContent);
    update();
  });

  // Choosing Light, Dark or Custom elsewhere changes what "in use" means.
  document.addEventListener('cleandrive:theme', () => {
    if (draft) update();
  });

  onLanguageChange(() => {
    buildRows();
    fillRows();
    update();
  });

  start();
  buildRows();
  fillRows();
  update();

  /** For the harnesses. */
  window.ThemeEditor = {
    draft: () => draft,
    set(key, value) {
      draft.colors[key] = value;
      fillRows();
      update();
    },
    load(theme) {
      draft = clone(theme);
      fillRows();
      update();
    },
    verdict: () => verdict,
  };
})();
