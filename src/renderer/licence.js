'use strict';

/**
 * Plans and licence, from the window's side (Phase 6, ROADMAP §7.2).
 *
 * Four things that belong together: the card at the top of Settings, the
 * dialog that chooses a plan, pays for it and says what happened, the thin
 * strip at the top of the window, and the way in from every UpgradeHint.
 *
 * ## What the window knows
 *
 * The licence it holds -- tier, dates, seats -- because showing that is this
 * screen's job. The email only when the card asks for it by name, which costs
 * one DPAPI call in the main process. What may *run* is still asked of
 * `entitlements()`, never worked out here.
 *
 * ## The rules this file keeps
 *
 * - No field for a card number, ever (§7.7). "International card" is a choice
 *   of method; a real provider draws its own page in Phase 7.
 * - The checkout looks like production on every channel (decided
 *   2026-10-02). The one thing said about the mock is on the card, about the
 *   licence: it ends when selling begins.
 * - The strip never shows over a screen that is scanning or deleting, nor
 *   while any dialog is open, nor in a toast (§7.2.5).
 * - Nothing written by JS carries `data-i18n`; a language change redraws.
 * - Redrawing a list puts the keyboard back where it was.
 */
(() => {
  const card = $('licence-card');
  const dialog = $('plans');
  if (!card || !dialog) return;

  const DAY = 24 * 60 * 60 * 1000;
  const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;

  const view = {
    status: null,
    invoices: [],
    email: undefined, // undefined: not asked yet; null: none kept
    catalogue: null, // { plans, features }
    period: 'annual',
    choice: null, // { planId, addons, seats }
    quote: null,
    coupon: null, // { code, discount }
    mode: 'choose',
    result: null,
    lastRequest: null,
    busy: false,
    opener: null,
  };

  /* ------------------------------------------------------------- words */

  /** What each feature key buys, as the plan columns list them. Literal keys, one per FEATURES entry. */
  const FEATURE_LABEL = {
    'pro.scan.multiroot': () => t('feature.pro.scan.multiroot', 'Several folders, or a whole drive, in one scan'),
    'pro.scan.mft': () => t('feature.pro.scan.mft', 'Fast scan of a whole NTFS drive'),
    'pro.diff': () => t('feature.pro.diff', 'What changed in a folder between two scans'),
    'pro.planner': () => t('feature.pro.planner', 'The Space Planner'),
    'pro.quarantine': () => t('feature.pro.quarantine', 'Moving files to another drive'),
    'pro.relocate': () => t('feature.pro.relocate', 'Moving a whole folder to another drive'),
    'pro.compress': () => t('feature.pro.compress', 'NTFS compression of a folder'),
    'pro.archive': () => t('feature.pro.archive', 'Packing a folder into one archive'),
    'pro.apps.lastused': () => t('feature.pro.apps.lastused', 'When each app was last started'),
    'pro.games': () => t('feature.pro.games', 'Game libraries'),
    'pro.chat': () => t('feature.pro.chat', 'Chat apps, conversation by conversation'),
    'pro.dupes.advanced': () => t('feature.pro.dupes.advanced', 'Duplicates by drive, whole folders and drafts of one document'),
    'pro.reports': () => t('feature.pro.reports', 'HTML reports and the weekly or monthly recap'),
    'pro.automatic.profiles': () => t('feature.pro.automatic.profiles', 'More than one automatic cleanup profile'),
    'pro.dev': () => t('feature.pro.dev', 'Build output, package caches and SDKs, and joining duplicate copies'),
    'biz.cli': () => t('feature.biz.cli', 'The command line'),
    'biz.policy': () => t('feature.biz.policy', 'An organisation’s own profile and quarantine folder, set by Group Policy'),
    'biz.console': () => t('feature.biz.console', 'One console over every computer'),
    'biz.audit': () => t('feature.biz.audit', 'A sealed journal for audits'),
  };

  const FREE_LINES = () => [
    t('plans.free.1', 'Scans, the map of a folder, and deleting to the Recycle Bin'),
    t('plans.free.2', 'System, Apps, Photos & video and Duplicates'),
    t('plans.free.3', 'Known app caches and OneDrive “Free up space”'),
    t('plans.free.4', 'One automatic cleanup profile'),
    t('plans.free.5', 'Restore, every confirmation and every warning'),
  ];

  const tierName = (tier) =>
    tier === 'business' ? t('licence.tier.business', 'CleanDrive Business') : tier === 'pro' ? t('licence.tier.pro', 'CleanDrive Pro') : t('licence.tier.free', 'CleanDrive Free');

  const periodName = (period) =>
    period === 'lifetime'
      ? t('licence.period.lifetime', 'Lifetime')
      : period === 'trial'
        ? t('licence.period.trial', 'Trial')
        : t('licence.period.annual', 'Yearly');

  const planName = (planId) => {
    if (planId === 'pro-annual') return t('plans.name.proAnnual', 'CleanDrive Pro · 1 year');
    if (planId === 'pro-lifetime') return t('plans.name.proLifetime', 'CleanDrive Pro · lifetime');
    if (planId === 'business-annual') return t('plans.name.businessAnnual', 'CleanDrive Business · 1 year');
    if (planId === 'pro-trial') return t('plans.name.proTrial', 'CleanDrive Pro · 14-day trial');
    return planId || '—';
  };

  const methodName = (m) =>
    ({
      card: () => t('checkout.method.card', 'International card'),
      momo: () => t('checkout.method.momo', 'MoMo'),
      vnpay: () => t('checkout.method.vnpay', 'VNPay'),
      bank_qr: () => t('checkout.method.bankQr', 'Bank transfer (QR)'),
    })[m] || (() => m);

  const money = (amount) =>
    new Intl.NumberFormat(uiLocale(), { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount || 0);

  const date = (iso) => (iso ? new Date(iso).toLocaleDateString(uiLocale(), { dateStyle: 'medium' }) : '—');

  const daysLeft = (iso) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / DAY));

  const reasonText = (reason) =>
    ({
      malformed: () => t('licence.reason.malformed', 'That is not a licence key. Copy the whole key, from its first character to its last.'),
      badSignature: () => t('licence.reason.badSignature', 'That key has been changed since it was issued, so it cannot be used.'),
      unknownKey: () => t('licence.reason.unknownKey', 'That key was not issued for this version of CleanDrive.'),
      trialUsed: () => t('licence.reason.trialUsed', 'This computer has already had its trial.'),
      noStore: () => t('licence.reason.noStore', 'The licence could not be saved on this computer.'),
    })[reason] || (() => t('licence.reason.other', 'The key could not be used ({reason}).', { reason: reason || '?' }));

  /** Build an element with text, and nothing that a language change would wipe. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ------------------------------------------------------------- the card */

  async function refresh() {
    const reply = await api.licenceStatus();
    if (!reply || !reply.ok) return;
    const before = view.status;
    view.status = reply.data;
    // The address belongs to one licence; a different one means asking again.
    if (!before || before.orderId !== view.status.orderId || before.state !== view.status.state) view.email = undefined;
    const invoices = await api.commerceInvoices();
    view.invoices = invoices && invoices.ok ? invoices.data : [];
    drawCard();
    drawStrip();
  }

  function productLine(s) {
    if (s.state === 'free') return tierName(null);
    const dev = s.tier === 'pro' && s.addons.includes('dev') ? t('licence.withDev', ' + Developer Pack') : '';
    return `${tierName(s.tier)}${dev} · ${periodName(s.period)}`;
  }

  function badgeText(s) {
    if (s.state === 'trial') return t('licence.badge.trial', 'Trial');
    if (s.state === 'expired') return t('licence.badge.expired', 'Expired');
    if (s.state === 'active') return s.fallback ? t('licence.badge.kept', 'Kept on this version') : t('licence.badge.active', 'Active');
    return t('licence.badge.free', 'Free');
  }

  function notesFor(s) {
    const notes = [];
    if (s.overridden) {
      notes.push(t('licence.note.overridden', 'Running from source: what is open is set by the developer’s configuration, not by the licence below.'));
    }
    if (s.source === 'invalid') {
      notes.push(t('licence.note.invalid', 'The licence saved on this computer cannot be used, so this is CleanDrive Free. {why}', { why: reasonText(s.reason)() }));
    }
    if (s.closedAgain && s.state === 'free') {
      notes.push(t('licence.note.closedAgain',
        'Up to {previous}, Pro and the Developer Pack were open to everyone while there was nothing to buy. From {version} they are part of a licence again. Everything the app did can still be put back from Restore, every file moved to another drive is still there, and any extra automatic profiles now only report what they would do.',
        { previous: s.upgradedFrom, version: s.closedIn }));
    }
    if (s.state === 'expired') {
      notes.push(t('licence.note.expired', 'Pro has expired. Pro features are read-only; all your data is still here.'));
    }
    if (s.fallback) {
      notes.push(t('licence.note.fallback', 'The licence year ended on {date}. This version ({version}) was released before then, so it keeps Pro for good; versions released after that day will not have it.',
        { date: date(s.expires), version: s.version }));
    }
    if (s.mock && s.state !== 'free') {
      notes.push(t('licence.note.mock', 'This licence was issued while CleanDrive is not yet on sale, and it ends when selling begins.'));
    }
    return notes;
  }

  function factsFor(s) {
    const facts = [[t('licence.fact.current', 'Current'), productLine(s)]];
    if (s.state === 'free') return facts;
    if (s.state === 'trial') {
      const n = daysLeft(s.expires);
      facts.push([t('licence.fact.trialEnds', 'Trial ends'), t('licence.trialLeft', '{date} · {n} {days} left', { date: date(s.expires), n, days: word(n, 'licence.day', 'day', 'days') })]);
    } else {
      facts.push([t('licence.fact.expires', 'Expires'), s.expires ? date(s.expires) : t('licence.never', 'Never — every later version is included')]);
    }
    facts.push([
      t('licence.fact.seats', 'Activated on'),
      s.machine
        ? t('licence.seatsWith', '1 / {seats} computers · this one is {machine}', { seats: s.seats, machine: s.machine })
        : t('licence.seats', '1 / {seats} computers', { seats: s.seats }),
    ]);
    // A trial never asked for an address, so there is no row to say it is missing.
    if (s.state !== 'trial') {
      facts.push([
        t('licence.fact.email', 'Email'),
        view.email === undefined ? t('licence.email.reading', 'Reading…') : view.email || t('licence.email.none', 'Not kept on this computer'),
      ]);
    }
    if (s.orderId) facts.push([t('licence.fact.order', 'Order'), s.orderId]);
    return facts;
  }

  function drawCard() {
    const s = view.status;
    if (!s) return;
    setText($('licence-badge'), badgeText(s));
    const channel = $('version-channel');
    if (channel) {
      channel.hidden = s.channel !== 'dev';
      if (s.channel === 'dev') setText(channel, t('licence.devChannel', 'Channel: dev · Payment: simulated'));
    }

    const notes = $('licence-notes');
    notes.replaceChildren(...notesFor(s).map((text) => el('p', 'card-note licence-note', text)));

    const facts = $('licence-facts');
    facts.replaceChildren(
      ...factsFor(s).map(([label, value]) => {
        const li = el('li');
        li.append(el('span', 'licence-fact-label', label), el('span', 'licence-fact-value', value));
        return li;
      })
    );

    const plans = $('licence-plans');
    const label =
      s.state === 'expired'
        ? t('licence.renew', 'Renew')
        : s.state === 'active' && s.tier === 'pro'
          ? t('licence.toBusiness', 'Upgrade to Business')
          : s.state === 'trial'
            ? t('licence.choose', 'Choose a plan')
            : t('licence.seePlans', 'See the plans');
    setText(plans, label);
    plans.hidden = s.state === 'active' && s.tier === 'business' && !s.fallback;
    $('licence-trial').hidden = !s.canTrial;
    const held = s.state !== 'free';
    $('licence-copy').hidden = !held;
    $('licence-save').hidden = !held;
    $('licence-deactivate').hidden = !held;

    const list = $('licence-invoices');
    if (view.invoices.length === 0) {
      list.replaceChildren(el('li', 'card-note', t('licence.invoices.none', 'No invoices yet.')));
    } else {
      list.replaceChildren(
        ...view.invoices.slice(0, 6).map((inv) => {
          const li = el('li');
          const what = [planName(inv.planId), ...(inv.addons.includes('dev') ? [t('plans.addon.dev', 'Developer Pack')] : [])].join(' + ');
          li.append(
            el('span', 'licence-fact-label', date(inv.paidAt)),
            el('span', 'licence-fact-value', `${what} · ${money(inv.total)} · ${methodName(inv.method)()}`)
          );
          return li;
        })
      );
    }

    // One DPAPI call, and none at all for a trial, which has no address.
    if (held && s.state !== 'trial' && view.email === undefined) readEmail();
  }

  let readingEmail = false;
  async function readEmail() {
    if (readingEmail) return;
    readingEmail = true;
    const reply = await api.licenceEmail();
    readingEmail = false;
    view.email = reply && reply.ok ? reply.data : null;
    drawCard();
  }

  /* ------------------------------------------------------------- the strip */

  const STRIP_TRIAL = 'cleandrive.licence.strip.trial';
  const STRIP_CLOSED = 'cleandrive.licence.strip.closed';

  function stored(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function store(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private storage refused: the strip just shows again next time
    }
  }

  const today = () => new Date().toISOString().slice(0, 10);
  let trialShownHere = false;
  let trialDismissed = false;

  /** Which strip the licence asks for, if any. */
  function wantedStrip() {
    const s = view.status;
    if (!s || s.overridden) return null;
    if (s.state === 'trial' && daysLeft(s.expires) <= 3 && !trialDismissed && (trialShownHere || stored(STRIP_TRIAL) !== today())) {
      const n = daysLeft(s.expires);
      return { kind: 'trial', text: t('licence.strip.trial', '{n} {days} left of your Pro trial.', { n, days: word(n, 'licence.day', 'day', 'days') }) };
    }
    if (s.closedAgain && s.state === 'free' && stored(STRIP_CLOSED) !== 'dismissed') {
      return { kind: 'closed', text: t('licence.strip.closed', 'Pro and the Developer Pack are part of a licence again from {version}. Your data and Restore are unchanged.', { version: s.closedIn }) };
    }
    return null;
  }

  /** Never over a scan, a delete or an open dialog. */
  function stripAllowed() {
    if (!$('delete-progress').hidden) return false;
    if (document.querySelector('dialog[open]')) return false;
    return ![...document.querySelectorAll('[role="progressbar"]')].some((bar) => bar.offsetParent !== null);
  }

  let strip = null;
  function drawStrip() {
    strip = wantedStrip();
    const host = $('licence-strip');
    const show = Boolean(strip) && stripAllowed();
    if (strip) setText($('licence-strip-text'), strip.text);
    if (host.hidden === show) host.hidden = !show;
    // "At most once a day": the day it was shown counts as seen -- for the
    // next window, not for this one, where it stays until it is closed.
    if (show && strip.kind === 'trial' && !trialShownHere) {
      trialShownHere = true;
      store(STRIP_TRIAL, today());
    }
  }

  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const host = $('licence-strip');
      const show = Boolean(strip) && stripAllowed();
      if (host.hidden === show) host.hidden = !show;
    });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });

  $('licence-strip-close').addEventListener('click', () => {
    if (strip && strip.kind === 'closed') store(STRIP_CLOSED, 'dismissed');
    if (strip && strip.kind === 'trial') {
      trialDismissed = true;
      store(STRIP_TRIAL, today());
    }
    strip = null;
    $('licence-strip').hidden = true;
  });
  $('licence-strip-plans').addEventListener('click', () => open({ opener: $('licence-strip-plans') }));

  /* ------------------------------------------------------------- the dialog */

  async function catalogue() {
    if (view.catalogue) return view.catalogue;
    const reply = await api.commercePlans();
    view.catalogue = reply && reply.ok ? reply.data : null;
    return view.catalogue;
  }

  const planFor = (id) => view.catalogue && view.catalogue.plans.plans.find((p) => p.id === id);

  /**
   * Open on the plans.
   *
   * @param {object} [options]
   * @param {string} [options.feature]   the hint it was opened from, so the right column is first in view
   * @param {Element} [options.opener]   where the keyboard goes back to
   */
  async function open({ feature = null, opener = document.activeElement } = {}) {
    if (!(await catalogue())) {
      toast(t('plans.unavailable', 'The plans could not be read.'), true);
      return;
    }
    if (!view.status) await refresh();
    view.opener = opener;
    view.coupon = null;
    view.result = null;
    show('choose');
    if (!dialog.open) dialog.showModal();
    if (feature && feature.startsWith('biz.')) {
      const col = dialog.querySelector('[data-column="business"]');
      if (col) col.scrollIntoView({ block: 'nearest' });
    }
    $('plans-title').focus({ preventScroll: true });
  }

  function close() {
    if (view.busy) return;
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    const back = view.opener;
    view.opener = null;
    if (back && document.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
  });
  // Escape while paying would leave a payment without anybody to see it end.
  dialog.addEventListener('cancel', (event) => {
    if (view.busy) event.preventDefault();
  });
  $('plans-close').addEventListener('click', close);

  function show(mode) {
    view.mode = mode;
    $('plans-choose').hidden = mode !== 'choose';
    $('plans-checkout').hidden = mode !== 'checkout';
    $('plans-result').hidden = mode !== 'result';
    if (mode === 'choose') drawChoose();
    if (mode === 'checkout') drawCheckout();
    if (mode === 'result') drawResult();
  }

  /* ---- choosing --------------------------------------------------------- */

  function drawChoose() {
    setText($('plans-title'), t('plans.title', 'Choose a plan'));
    for (const b of $('plans-period').querySelectorAll('[data-period]')) {
      const on = b.dataset.period === view.period;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    $('plans-period').style.setProperty('--switch-index', view.period === 'lifetime' ? '1' : '0');
    setText($('plans-period-note'), view.period === 'lifetime'
      ? t('plans.period.lifetimeNote', 'Lifetime: every later version of CleanDrive, with no renewal. Business is yearly only.')
      : t('plans.period.annualNote', 'Yearly: when a year ends, the versions released during it keep Pro for good.'));

    const s = view.status || {};
    const features = view.catalogue.features;
    const columns = $('plans-columns');
    const focusedKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : null;

    const free = column('free', tierName(null), t('plans.free.price', 'Free'), FREE_LINES());
    if (s.state === 'free') free.querySelector('.plans-col-head').append(el('span', 'plans-current', t('plans.current', 'Current plan')));

    const proPlan = planFor(view.period === 'lifetime' ? 'pro-lifetime' : 'pro-annual');
    const proFeatures = features.filter((f) => f.tier === 'pro' && !f.addon).map((f) => FEATURE_LABEL[f.key]());
    const pro = column('pro', tierName('pro'), priceLine(proPlan), proFeatures);
    if (s.state === 'active' && s.tier === 'pro' && !s.fallback) pro.querySelector('.plans-col-head').append(el('span', 'plans-current', t('plans.current', 'Current plan')));
    const addon = el('label', 'check plans-addon');
    const box = el('input');
    box.type = 'checkbox';
    box.id = 'plans-dev';
    box.dataset.focusKey = 'dev';
    box.checked = Boolean(view.choice && view.choice.addons.includes('dev'));
    const devFeature = features.find((f) => f.addon === 'dev');
    addon.append(box, el('span', null, t('plans.addon.devLine', '+ Developer Pack ({price}): {what}', {
      price: money(proPlan.addons.dev),
      what: devFeature ? FEATURE_LABEL[devFeature.key]() : '',
    })));
    // Beside the button it changes, not under a list it would be lost below.
    pro.querySelector('.plans-col-foot').append(addon);
    const choosePro = el('button', 'btn btn-primary btn-sm', t('plans.choosePro', 'Choose Pro'));
    choosePro.type = 'button';
    choosePro.dataset.focusKey = 'choose-pro';
    choosePro.addEventListener('click', () => startCheckout(proPlan.id, box.checked ? ['dev'] : []));
    pro.querySelector('.plans-col-foot').append(choosePro);
    if (s.canTrial) {
      const trial = el('button', 'btn btn-sm', t('licence.trial', 'Try Pro for 14 days — no payment'));
      trial.type = 'button';
      trial.dataset.focusKey = 'trial';
      trial.addEventListener('click', () => startTrial(trial));
      pro.querySelector('.plans-col-foot').append(trial);
    }

    const bizPlan = planFor('business-annual');
    const bizFeatures = [
      t('plans.business.includes', 'Everything in Pro, and the Developer Pack'),
      ...features.filter((f) => f.tier === 'business').map((f) => FEATURE_LABEL[f.key]()),
    ];
    const biz = column('business', tierName('business'), priceLine(bizPlan), bizFeatures);
    if (s.state === 'active' && s.tier === 'business') biz.querySelector('.plans-col-head').append(el('span', 'plans-current', t('plans.current', 'Current plan')));
    if (view.period === 'lifetime') biz.querySelector('.plans-col-body').prepend(el('p', 'card-note', t('plans.business.yearly', 'Yearly only.')));
    const chooseBiz = el('button', 'btn btn-primary btn-sm', t('plans.chooseBusiness', 'Choose Business'));
    chooseBiz.type = 'button';
    chooseBiz.dataset.focusKey = 'choose-business';
    chooseBiz.addEventListener('click', () => startCheckout(bizPlan.id, []));
    biz.querySelector('.plans-col-foot').append(chooseBiz);

    columns.replaceChildren(free, pro, biz);
    if (focusedKey) {
      const again = columns.querySelector(`[data-focus-key="${focusedKey}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  function priceLine(plan) {
    const seats = plan.seats.find((x) => x.n === plan.defaultSeats);
    return plan.period === 'lifetime'
      ? t('plans.price.lifetime', '{price} once · {n} computers', { price: money(seats.price), n: seats.n })
      : t('plans.price.annual', '{price} a year · {n} computers', { price: money(seats.price), n: seats.n });
  }

  function column(key, name, price, lines) {
    const col = el('section', 'plans-col');
    col.dataset.column = key;
    const head = el('div', 'plans-col-head');
    head.append(el('h3', 'plans-col-name', name), el('p', 'plans-col-price', price));
    const body = el('div', 'plans-col-body');
    const list = el('ul', 'plans-col-list');
    for (const line of lines) list.append(el('li', null, line));
    body.append(list);
    // The buttons under the price, so choosing never needs a scroll past the list.
    col.append(head, el('div', 'plans-col-foot'), body);
    return col;
  }

  for (const b of $('plans-period').querySelectorAll('[data-period]')) {
    b.addEventListener('click', () => {
      view.period = b.dataset.period;
      drawChoose();
      b.focus({ preventScroll: true });
    });
  }

  async function startTrial(button) {
    button.disabled = true;
    const reply = await api.commerceStartTrial();
    button.disabled = false;
    const data = unwrap(reply, t('licence.trial', 'Try Pro for 14 days — no payment'));
    if (!data) return;
    if (!data.ok) {
      toast(reasonText(data.reason)(), true);
      return;
    }
    view.status = data.status;
    view.result = { kind: 'trial' };
    show('result');
    $('plans-title').focus({ preventScroll: true });
  }

  /* ---- paying ----------------------------------------------------------- */

  async function startCheckout(planId, addons) {
    const plan = planFor(planId);
    view.choice = { planId, addons, seats: plan.defaultSeats };
    view.coupon = null;
    // The last checkout's numbers must not be drawn for this one, even for a frame.
    view.quote = null;
    $('plans-coupon').value = '';
    setText($('plans-coupon-result'), '');
    // Agreed for this purchase, not remembered from the last one.
    $('plans-terms').checked = false;
    show('checkout');
    await requote();
    $('plans-title').focus({ preventScroll: true });
  }

  async function requote() {
    const reply = await api.commerceQuote({ ...view.choice, discount: view.coupon ? view.coupon.discount : 0 });
    view.quote = reply && reply.ok && reply.data.ok ? reply.data : null;
    drawLines();
    updatePay();
  }

  function drawCheckout() {
    setText($('plans-title'), t('checkout.title', 'Payment'));
    const plan = planFor(view.choice.planId);
    const seats = $('plans-seats');
    seats.replaceChildren(
      ...plan.seats.map((x) => {
        const o = el('option', null, t('checkout.seats.option', '{n} computers', { n: x.n }));
        o.value = String(x.n);
        o.selected = x.n === view.choice.seats;
        return o;
      })
    );
    drawLines();
    updatePay();
  }

  function drawLines() {
    const q = view.quote;
    const lines = $('plans-lines');
    if (!q) {
      lines.replaceChildren();
      setText($('plans-total'), '—');
      return;
    }
    const rows = q.lines.map((l) => [l.item === 'plan' ? planName(l.id) : t('plans.addon.devPlus', '+ Developer Pack'), money(l.amount)]);
    if (q.discount > 0) rows.push([t('checkout.discount', 'Discount {code}', { code: view.coupon ? view.coupon.code : '' }), `−${money(q.discount)}`]);
    lines.replaceChildren(
      ...rows.map(([label, amount]) => {
        const li = el('li');
        li.append(el('span', null, label), el('span', 'plans-amount', amount));
        return li;
      })
    );
    setText($('plans-total'), money(q.total));
  }

  const methodChosen = () => {
    const picked = dialog.querySelector('input[name="plans-method"]:checked');
    return picked ? picked.value : null;
  };

  /** The Pay button works only when every field it needs is there (§7.2.3), and says which is missing. */
  function updatePay() {
    const pay = $('plans-pay');
    const q = view.quote;
    setText(pay, view.busy ? t('checkout.processing', 'Processing…') : t('checkout.pay', 'Pay {total}', { total: q ? money(q.total) : '—' }));
    pay.classList.toggle('is-busy', view.busy);
    const missing = [];
    if (!EMAIL.test($('plans-email').value.trim())) missing.push(t('checkout.need.email', 'an email address'));
    if (!methodChosen()) missing.push(t('checkout.need.method', 'a payment method'));
    if (!$('plans-terms').checked) missing.push(t('checkout.need.terms', 'agreement to the terms'));
    pay.disabled = view.busy || !q || missing.length > 0;
    setText($('plans-pay-hint'), view.busy || missing.length === 0 ? '' : t('checkout.need', 'Still needed: {what}.', { what: missing.join(', ') }));
  }

  $('plans-email').addEventListener('input', updatePay);
  $('plans-terms').addEventListener('change', updatePay);
  for (const r of dialog.querySelectorAll('input[name="plans-method"]')) r.addEventListener('change', updatePay);
  $('plans-seats').addEventListener('change', () => {
    view.choice.seats = Number($('plans-seats').value);
    requote();
  });
  $('plans-back').addEventListener('click', () => {
    if (view.busy) return;
    show('choose');
    $('plans-title').focus({ preventScroll: true });
  });

  $('plans-coupon-apply').addEventListener('click', async () => {
    const code = $('plans-coupon').value.trim();
    if (!code) {
      view.coupon = null;
      setText($('plans-coupon-result'), '');
      await requote();
      return;
    }
    const reply = await api.commerceCoupon(code, view.choice.planId);
    const r = reply && reply.ok ? reply.data : null;
    if (r && r.valid) {
      view.coupon = { code: code.toUpperCase(), discount: r.discount };
      setText($('plans-coupon-result'), t('checkout.coupon.ok', '{percent}% off.', { percent: Math.round(r.discount * 100) }));
    } else {
      view.coupon = null;
      setText($('plans-coupon-result'), t('checkout.coupon.bad', 'That code cannot be used.'));
    }
    await requote();
  });

  function setBusy(busy) {
    view.busy = busy;
    for (const input of $('plans-checkout').querySelectorAll('input, select, button')) {
      if (input.id !== 'plans-pay') input.disabled = busy;
    }
    $('plans-close').disabled = busy;
    dialog.setAttribute('aria-busy', String(busy));
    updatePay();
  }

  $('plans-checkout').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (view.busy || $('plans-pay').disabled) return;
    const request = {
      planId: view.choice.planId,
      addons: view.choice.addons,
      seats: view.choice.seats,
      method: methodChosen(),
      email: $('plans-email').value.trim(),
      coupon: view.coupon ? view.coupon.code : undefined,
    };
    await pay(request);
  });

  async function pay(request) {
    view.lastRequest = request;
    setBusy(true);
    const reply = await api.commerceCheckout(request);
    setBusy(false);
    settle(reply);
  }

  function settle(reply) {
    if (!reply || !reply.ok) {
      view.result = { status: 'failed', errorCode: (reply && reply.code) || 'error', error: reply && reply.error };
    } else {
      view.result = reply.data;
      if (reply.data.licence) view.status = reply.data.licence;
    }
    show('result');
    $('plans-title').focus({ preventScroll: true });
  }

  /* ---- what happened ---------------------------------------------------- */

  function action(label, onClick, primary = false) {
    const b = el('button', `btn btn-sm${primary ? ' btn-primary' : ''}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function drawResult() {
    const r = view.result || {};
    const message = $('plans-result-message');
    const facts = $('plans-result-facts');
    const actions = $('plans-result-actions');
    const keyBox = $('plans-key-box');
    keyBox.hidden = true;
    facts.replaceChildren();
    const s = view.status;

    const succeeded = r.kind === 'trial' || r.status === 'succeeded';
    if (succeeded && s) {
      setText($('plans-title'), r.kind === 'trial' ? t('result.trial.title', 'Your trial has started') : t('result.ok.title', 'Activated'));
      setText(message, r.kind === 'trial'
        ? t('result.trial', 'CleanDrive Pro is open on this computer for 14 days. Nothing to pay, and nothing changes when it ends except that Pro features go back to read-only.')
        : t('result.ok', 'Thank you. {product} is now active on this computer.', { product: tierName(s.tier) }));
      const rows = [
        [t('licence.fact.expires', 'Expires'), s.expires ? date(s.expires) : t('licence.never', 'Never — every later version is included')],
        [t('licence.fact.seats', 'Activated on'), t('licence.seats', '1 / {seats} computers', { seats: s.seats })],
      ];
      facts.replaceChildren(...rows.map(([a, b]) => {
        const li = el('li');
        li.append(el('span', 'licence-fact-label', a), el('span', 'licence-fact-value', b));
        return li;
      }));
      const keyActions = [];
      if (r.token) {
        keyBox.hidden = false;
        $('plans-key').value = r.token;
        keyActions.push(action(t('licence.copy', 'Copy the key'), () => copyKey(r.token)));
        keyActions.push(action(t('licence.saveKey', 'Save the key to a file'), saveKey));
      }
      actions.replaceChildren(...keyActions, el('span', 'spacer'), action(t('app.close', 'Close'), close, true));
      return;
    }

    setText($('plans-title'), t('result.problem.title', 'Not paid'));
    const back = () => {
      show('checkout');
      $('plans-title').focus({ preventScroll: true });
    };
    const checkAgain = async (button) => {
      button.disabled = true;
      const reply = await api.commerceStatus(r.orderId);
      button.disabled = false;
      settle(reply);
    };
    let text;
    let buttons;
    if (r.status === 'cancelled') {
      setText($('plans-title'), t('result.cancelled.title', 'Cancelled'));
      text = t('result.cancelled', 'You cancelled the payment.');
      buttons = [action(t('result.back', 'Go back'), back, true)];
    } else if (r.status === 'pending') {
      setText($('plans-title'), t('result.pending.title', 'Waiting'));
      text = t('result.pending', 'Waiting for the bank transfer to be confirmed.');
      const again = action(t('result.checkAgain', 'Check again'), () => checkAgain(again), true);
      buttons = [again, action(t('result.enterKey', 'Enter the key when the email arrives'), () => {
        close();
        openEnter();
      })];
    } else if (r.errorCode === 'card_declined') {
      text = t('result.declined', 'The bank declined the payment. You have not been charged.');
      buttons = [action(t('result.otherMethod', 'Try another method'), back, true)];
    } else if (r.errorCode === 'network') {
      text = t('result.network', 'The payment server could not be reached. You have not been charged.');
      buttons = [action(t('result.retry', 'Try again'), () => {
        show('checkout');
        pay(view.lastRequest);
      }, true), action(t('result.back', 'Go back'), back)];
    } else if (r.errorCode === 'timeout') {
      setText($('plans-title'), t('result.timeout.title', 'No answer yet'));
      text = t('result.timeout', 'No confirmation yet. If you have been charged, the licence will be sent to your email.');
      const again = action(t('result.checkAgain', 'Check again'), () => checkAgain(again), true);
      buttons = [again];
    } else if (r.errorCode === 'coupon_invalid') {
      text = t('result.coupon', 'That discount code cannot be used. You have not been charged.');
      buttons = [action(t('result.back', 'Go back'), back, true)];
    } else if (r.errorCode === 'EBUSY') {
      text = t('result.busy', 'A payment is already in progress.');
      buttons = [action(t('result.back', 'Go back'), back, true)];
    } else {
      text = t('result.failed', 'The payment could not be made ({code}). You have not been charged.', { code: r.errorCode || r.error || '?' });
      buttons = [action(t('result.back', 'Go back'), back, true)];
    }
    setText(message, text);
    actions.replaceChildren(el('span', 'spacer'), ...buttons);
  }

  /* ------------------------------------------------------------- the key */

  async function copyKey(token) {
    const text = token || (await api.licenceToken()).data;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(t('licence.copied', 'The licence key is on the clipboard.'));
    } catch {
      toast(t('licence.copyFailed', 'The clipboard could not be reached. Use “Save the key to a file” instead.'), true);
    }
  }

  async function saveKey() {
    const data = unwrap(await api.licenceSaveKey(), t('licence.saveKey', 'Save the key to a file'));
    if (data && data.saved) toast(t('licence.saved', 'Saved {path}.', { path: data.path }));
  }

  function openEnter() {
    const form = $('licence-enter-form');
    form.hidden = false;
    $('licence-enter').setAttribute('aria-expanded', 'true');
    setText($('licence-enter-result'), '');
    const tab = document.querySelector('.tab[data-tab="settings"]');
    if (tab && !tab.classList.contains('is-active')) tab.click();
    $('licence-key').focus();
  }

  $('licence-enter').addEventListener('click', () => {
    if ($('licence-enter-form').hidden) openEnter();
    else {
      $('licence-enter-form').hidden = true;
      $('licence-enter').setAttribute('aria-expanded', 'false');
    }
  });
  $('licence-enter-cancel').addEventListener('click', () => {
    $('licence-enter-form').hidden = true;
    $('licence-enter').setAttribute('aria-expanded', 'false');
    $('licence-enter').focus();
  });
  $('licence-enter-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('licence-activate');
    button.disabled = true;
    const data = unwrap(await api.licenceActivate($('licence-key').value), t('licence.activate', 'Activate'));
    button.disabled = false;
    if (!data) return;
    if (!data.ok) {
      setText($('licence-enter-result'), reasonText(data.reason)());
      return;
    }
    view.status = data.status;
    view.email = undefined;
    $('licence-key').value = '';
    $('licence-enter-form').hidden = true;
    $('licence-enter').setAttribute('aria-expanded', 'false');
    toast(t('licence.activated', '{product} is now active on this computer.', { product: tierName(data.status.tier) }));
    drawCard();
    ($('licence-plans').hidden ? $('licence-enter') : $('licence-plans')).focus();
  });

  $('licence-plans').addEventListener('click', () => open({ opener: $('licence-plans') }));
  // Starts the trial at once, and shows what happened in the dialog.
  $('licence-trial').addEventListener('click', async () => {
    await open({ opener: $('licence-trial') });
    const button = dialog.querySelector('[data-focus-key="trial"]');
    if (button) await startTrial(button);
  });
  $('licence-copy').addEventListener('click', () => copyKey(null));
  $('licence-save').addEventListener('click', saveKey);
  $('licence-deactivate').addEventListener('click', async () => {
    const data = unwrap(await api.licenceDeactivate(), t('licence.deactivate', 'Deactivate this computer'));
    if (!data || data.cancelled) return;
    view.status = data.status;
    view.email = undefined;
    toast(t('licence.deactivated', 'This computer is back on CleanDrive Free.'));
    drawCard();
    $('licence-enter').focus();
  });

  /* ------------------------------------------------------------- wiring */

  api.onLicenseChanged(() => refresh());
  onLanguageChange(() => {
    drawCard();
    drawStrip();
    if (dialog.open) show(view.mode);
  });

  /** The way in from every UpgradeHint (components.js). */
  window.LicenceUI = { open, refresh };

  refresh();
})();
