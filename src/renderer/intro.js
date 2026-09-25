'use strict';

/**
 * The introduction (I4): three screens, the first time the app is opened.
 *
 *   1. It shows you, then you decide -- a row as the app draws one, with its
 *      verdict, how sure it is and why.
 *   2. Moving to the Recycle Bin is not freeing -- the same drive before and
 *      after a move to the bin, and after the bin is emptied.
 *   3. Choose the first folder -- the folder shortcuts, the picker, or the
 *      System screen.
 *
 * Whether it is the first time is the main process's answer (src/main/intro.js:
 * nothing on disk says the app has run here), passed in the URL as `intro=1`.
 * The window adds its own memory of having shown it, so a launch whose traces
 * failed to write does not introduce itself twice. Settings → Version has a
 * button to see it again.
 *
 * Skip, Esc, or Done on the last screen all close it; none of them does
 * anything else. A folder chosen on screen 3 is only chosen -- the scan starts
 * when the person presses Scan, as it always does.
 */
(() => {
  const dialog = $('intro');
  if (!dialog) return;

  const KEY = 'cleandrive.intro';
  const pages = [...dialog.querySelectorAll('[data-intro-page]')];
  let index = 0;
  let returnFocus = null;
  /** Where focus goes when it closes, if not back where it came from. */
  let focusAfter = null;

  function remembered() {
    try {
      return localStorage.getItem(KEY) === 'seen';
    } catch {
      return false;
    }
  }

  function remember() {
    try {
      localStorage.setItem(KEY, 'seen');
    } catch {
      /* Storage can be unavailable; the main process's answer still holds. */
    }
  }

  function label() {
    $('intro-step').textContent = t('intro.step', 'Step {n} of {total}', { n: index + 1, total: pages.length });
    $('intro-next').textContent = index === pages.length - 1 ? t('intro.done', 'Done') : t('intro.next', 'Next');
  }

  function show(next, { focus = true } = {}) {
    index = Math.max(0, Math.min(pages.length - 1, next));
    pages.forEach((page, n) => {
      page.hidden = n !== index;
    });
    // The dialog is named by the screen on show, and focus moves to its
    // heading, so a screen reader reads the new screen from the top.
    dialog.setAttribute('aria-labelledby', `intro-title-${index + 1}`);
    $('intro-back').hidden = index === 0;
    label();
    if (focus) pages[index].querySelector('.intro-title').focus();
  }

  async function buildPaths() {
    const host = $('intro-paths');
    const reply = await api.knownPaths();
    const paths = reply && reply.ok ? reply.data : {};
    host.replaceChildren();
    for (const [key, value] of Object.entries(paths)) {
      if (!value) continue;
      const btn = document.createElement('button');
      btn.className = 'btn btn-quick';
      btn.textContent = t(`app.path.${key}`, key[0].toUpperCase() + key.slice(1));
      btn.title = value;
      btn.addEventListener('click', () => choose(value));
      host.appendChild(btn);
    }
  }

  /** A folder is chosen, and nothing more: Scan is the person's to press. */
  function choose(folder) {
    setFolder(folder);
    document.querySelector('.tab[data-tab="usage"]').click();
    focusAfter = $('run-scan');
    dialog.close();
  }

  function open() {
    if (dialog.open) return;
    returnFocus = document.activeElement;
    focusAfter = null;
    buildPaths();
    dialog.showModal();
    show(0);
  }

  $('intro-next').addEventListener('click', () => {
    if (index === pages.length - 1) dialog.close();
    else show(index + 1);
  });
  $('intro-back').addEventListener('click', () => show(index - 1));
  $('intro-skip').addEventListener('click', () => dialog.close());
  $('intro-pick').addEventListener('click', async () => {
    const folder = unwrap(await api.pickFolder(), t('app.label.folderPicker', 'Folder picker'));
    if (folder) choose(folder);
  });
  $('intro-system').addEventListener('click', () => {
    const tab = document.querySelector('.tab[data-tab="system"]');
    tab.click();
    focusAfter = tab;
    dialog.close();
  });
  // Esc closes a modal <dialog> by itself; this is every way out, once.
  dialog.addEventListener('close', () => {
    remember();
    const target = focusAfter || returnFocus;
    if (target && target.isConnected && typeof target.focus === 'function') target.focus();
    focusAfter = null;
    returnFocus = null;
  });
  $('intro-open').addEventListener('click', open);

  onLanguageChange(() => {
    if (!dialog.open) return;
    label();
    buildPaths();
  });

  let first = false;
  try {
    first = new URLSearchParams(window.location.search).get('intro') === '1';
  } catch {
    first = false;
  }
  if (first && !remembered()) open();

  /** For the harnesses. */
  window.Intro = { open, show, index: () => index };
})();
