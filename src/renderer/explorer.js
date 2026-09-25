'use strict';

/**
 * Settings → Right-click menu in Explorer (I3).
 *
 * The box says what the setting is; the line under it says what the registry
 * has, read back by the main process each time the tab is opened. The two can
 * differ for a moment -- the app was moved and the entries still name the old
 * path -- and the launch after that puts them right.
 */
(() => {
  const box = $('explorer-menu');
  const line = $('explorer-status');
  if (!box || !line) return;

  let last = null;

  function describe(state) {
    if (!state) return '';
    if (!state.available) return t('explorer.dev', 'Only the installed app can add itself to Explorer’s menu.');
    if (state.enabled && state.current) return t('explorer.on', 'In Explorer’s menu: {n} entries, pointing at this copy of the app.', { n: state.total });
    if (state.enabled) return t('explorer.stale', 'Switched on, but {n} of the {total} entries are missing or out of date. They are put right the next time the app starts.', { n: state.stale.length, total: state.total });
    if (state.present > 0) return t('explorer.leftover', '{n} entries are still in Explorer’s menu; they are taken out the next time the app starts.', { n: state.present });
    return t('explorer.off', 'Not in Explorer’s menu.');
  }

  function draw(state) {
    last = state;
    box.checked = Boolean(state && state.enabled);
    box.disabled = !state || !state.available;
    line.textContent = describe(state);
  }

  async function load() {
    const state = unwrap(await api.explorerStatus(), t('explorer.title', 'Right-click menu in Explorer'));
    if (state) draw(state);
  }

  box.addEventListener('change', async () => {
    const want = box.checked;
    box.disabled = true;
    line.textContent = want ? t('explorer.adding', 'Adding the entries…') : t('explorer.removing', 'Taking the entries out…');
    const state = unwrap(await api.setExplorerMenu(want), t('explorer.title', 'Right-click menu in Explorer'));
    if (state) {
      draw(state);
      announce(line.textContent);
    } else {
      // Windows refused: the box goes back to what is really there.
      draw(last);
    }
  });

  const tab = document.querySelector('.tab[data-tab="settings"]');
  if (tab) tab.addEventListener('click', load);
  onLanguageChange(() => draw(last));
  load();
})();
