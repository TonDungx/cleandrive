'use strict';

/**
 * The Terms of use and the Refund policy, read inside the app (Phase 6).
 *
 * Checkout asks for agreement to both (§7.2.3), so both have to be there to
 * read at the moment of agreeing -- in the app, without a request, and in the
 * language the window is in. The text is data (`legal-text.js`), drawn here
 * with `textContent` only: a document is never markup.
 *
 * Opened from any element carrying `data-legal="terms|refund"`: the two words
 * in checkout's agreement line, and the line at the foot of the licence card.
 * It opens over checkout without closing it, and gives the keyboard back to
 * the word that opened it.
 */
(() => {
  const dialog = $('legal');
  if (!dialog) return;

  let showing = null;
  let opener = null;

  /** The document in the window's language, English when it has no translation. */
  function documentFor(which) {
    const all = window.LegalText || {};
    const doc = all[which];
    if (!doc) return null;
    return doc[uiLocale()] || doc.en || null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function draw() {
    const doc = documentFor(showing);
    if (!doc) return;
    setText($('legal-title'), doc.title);
    const out = [el('p', 'legal-meta', t('legal.meta', 'Version {version} · in effect from {date}', { version: doc.version, date: doc.effective }))];
    if (doc.notice) out.push(el('p', 'licence-note legal-notice', doc.notice));
    for (const section of doc.sections) {
      out.push(el('h3', 'legal-heading', section.heading));
      for (const item of section.body) {
        if (Array.isArray(item)) {
          const list = el('ul', 'legal-list');
          for (const line of item) list.append(el('li', null, line));
          out.push(list);
        } else {
          out.push(el('p', 'legal-text', item));
        }
      }
    }
    $('legal-body').replaceChildren(...out);
  }

  /**
   * @param {'terms'|'refund'} which
   * @param {Element} [from]  where the keyboard goes back to
   */
  function open(which, from = document.activeElement) {
    if (!documentFor(which)) return;
    showing = which;
    opener = from;
    draw();
    if (!dialog.open) dialog.showModal();
    // The dialog is what scrolls, and it keeps where the last document was
    // left: every document starts at its top, notice first.
    dialog.scrollTop = 0;
    $('legal-title').focus({ preventScroll: true });
  }

  dialog.addEventListener('close', () => {
    const back = opener;
    opener = null;
    if (back && document.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
  });
  $('legal-close').addEventListener('click', () => dialog.close());

  // One listener for every way in, including the ones drawn later.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-legal]');
    if (!link) return;
    event.preventDefault();
    open(link.dataset.legal, link);
  });

  onLanguageChange(() => {
    if (dialog.open) draw();
  });

  window.Legal = { open };
})();
