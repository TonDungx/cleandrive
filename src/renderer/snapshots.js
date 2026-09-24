'use strict';

/**
 * The Settings card for scan history: how many folder snapshots to keep.
 *
 * Saved as soon as a field is left, through the same `settings:save` as every
 * other setting, and drawn back from what the main process stored -- which is
 * the clamped value, so typing 500 shows 100 rather than a number the app is
 * not using.
 */
(() => {
  const recent = $('snapshot-keep-recent');
  const monthly = $('snapshot-keep-monthly');
  const detail = $('snapshot-detail');
  if (!recent || !monthly) return;

  function draw(settings) {
    const s = settings && settings.snapshots;
    if (!s) return;
    recent.value = s.keepRecent;
    monthly.value = s.keepMonthly;
    detail.textContent = t(
      'settings.snapshots.detail',
      'At most {n} snapshots per folder. Older ones are deleted after the next scan of that folder.',
      { n: s.keepRecent + s.keepMonthly }
    );
  }

  async function load() {
    const state = unwrap(await api.getSettings(), t('settings.snapshots.title', 'Scan history'));
    if (state) draw(state.settings);
  }

  async function save() {
    const state = unwrap(
      await api.saveSettings({
        snapshots: { keepRecent: Number(recent.value), keepMonthly: Number(monthly.value) },
      }),
      t('settings.snapshots.title', 'Scan history')
    );
    if (state) draw(state.settings);
  }

  recent.addEventListener('change', save);
  monthly.addEventListener('change', save);
  onLanguageChange(load);
  load();
})();
