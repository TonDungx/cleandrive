'use strict';

/**
 * Every key the app answers to, in one list, opened with `?`.
 *
 * The keys themselves live with the screens that answer to them -- the list,
 * the map, the grid, the sidebar. This file only says what they are, so the
 * table is written here, not collected from the handlers: a key a handler
 * forgot to register would otherwise be a key the list forgot to mention, and
 * scripts/test-a11y.js presses the keys and checks they do what this says.
 *
 * `?` opens it from anywhere but a text field, where a question mark is
 * something being typed. The dialog is a native <dialog> opened modally, so
 * focus stays inside it, Escape closes it, and the window behind is inert.
 */
(() => {
  const dialog = $('shortcuts');
  const body = $('shortcuts-body');
  if (!dialog || !body) return;

  /** [keys, what they do] per section. Keys are joined with " / " when shown. */
  function table() {
    return [
      {
        title: t('keys.anywhere', 'Anywhere'),
        rows: [
          [['?'], t('keys.help', 'This list')],
          [['Tab', 'Shift+Tab'], t('keys.tab', 'Next or previous control')],
          [['Esc'], t('keys.escape', 'Close the preview, a menu or this list')],
        ],
      },
      {
        title: t('keys.sidebar', 'Sidebar'),
        rows: [
          [['↑', '↓'], t('keys.sidebar.move', 'Previous or next screen — it opens as you move')],
          [['Home', 'End'], t('keys.sidebar.ends', 'First or last screen')],
          [['←', '→'], t('keys.resizer.width', 'On the sidebar’s edge: narrower or wider (Shift for bigger steps)')],
          [['Enter', 'Space'], t('keys.resizer.toggle', 'On the sidebar’s edge: hide it or bring it back')],
        ],
      },
      {
        title: t('keys.lists', 'Lists of files'),
        rows: [
          [['↑', '↓'], t('keys.lists.move', 'Previous or next row')],
          [['Shift+↑', 'Shift+↓'], t('keys.lists.extend', 'Tick each row on the way')],
          [['Space'], t('keys.lists.tick', 'Tick or untick the row')],
          [['Enter'], t('keys.lists.view', 'Look at the file in the app')],
          [['Tab'], t('keys.lists.buttons', 'The row’s own buttons: its reasons, View, Reveal, Open')],
        ],
      },
      {
        title: t('keys.map', 'Map of a folder'),
        rows: [
          [['↑', '↓'], t('keys.map.siblings', 'Previous or next tile at the same level')],
          [['→'], t('keys.map.in', 'Into a folder')],
          [['←'], t('keys.map.out', 'Back out to the folder around it')],
          [['Enter'], t('keys.map.open', 'Open the folder, or look at the file')],
          [['Space'], t('keys.map.tick', 'Tick the file')],
          [['Backspace'], t('keys.map.up', 'Up one folder')],
          [['Menu', 'Shift+F10'], t('keys.map.menu', 'The tile’s menu')],
        ],
      },
      {
        title: t('keys.grid', 'Photos & video'),
        rows: [
          [['←', '→', '↑', '↓'], t('keys.grid.move', 'Move through the pictures')],
          [['Home', 'End'], t('keys.grid.ends', 'First or last picture')],
          [['Space'], t('keys.grid.tick', 'Tick or untick the picture')],
          [['Esc'], t('keys.grid.clear', 'Clear the selection and close the details')],
        ],
      },
    ];
  }

  function render() {
    const nodes = [];
    for (const section of table()) {
      const h = document.createElement('h3');
      h.className = 'shortcuts-section';
      h.textContent = section.title;
      const dl = document.createElement('dl');
      dl.className = 'shortcuts-list';
      for (const [keys, what] of section.rows) {
        const dt = document.createElement('dt');
        keys.forEach((key, i) => {
          if (i > 0) dt.append(document.createTextNode(' / '));
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          dt.appendChild(kbd);
        });
        const dd = document.createElement('dd');
        dd.textContent = what;
        dl.append(dt, dd);
      }
      nodes.push(h, dl);
    }
    body.replaceChildren(...nodes);
  }

  function open() {
    if (dialog.open) return;
    render();
    dialog.showModal();
    $('shortcuts-close').focus();
  }

  const editable = (el) =>
    el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  document.addEventListener('keydown', (event) => {
    if (event.key !== '?' || event.ctrlKey || event.altKey || event.metaKey) return;
    if (editable(event.target) || dialog.open || !$('viewer').hidden) return;
    event.preventDefault();
    open();
  });

  $('shortcuts-close').addEventListener('click', () => dialog.close());
  $('shortcuts-open').addEventListener('click', open);
  // A click on the backdrop lands on the dialog itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  onLanguageChange(() => {
    if (dialog.open) render();
  });

  window.Shortcuts = { open, table };
})();
