#!/usr/bin/env node
'use strict';

// Plans, prices and the mock payment provider (ROADMAP §7.3, §7.4, §7.9).
//   node scripts/test-commerce.js
//
// Every outcome the real provider could produce is produced here by the mock,
// so each has a screen before Phase 7. Licences that come back are checked
// against the key a real build believes, and activated into a licence file
// of the harness's own.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PLANS, quote, planOf } = require('../src/main/commerce/quote');
const { MockPaymentProvider, OUTCOMES } = require('../src/main/commerce/mock-provider');
const commerce = require('../src/main/commerce');
const token = require('../src/main/license/token');
const licence = require('../src/main/license/state');
const machine = require('../src/main/license/machine');
const { can } = require('../src/main/license/entitlements');
const dpapi = require('../src/main/lib/dpapi');
const { removeAfterExit } = require('./lib/sandbox');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const DAY = 24 * 60 * 60 * 1000;
const fakeDpapi = () => {
  const flip = (b) => Buffer.from([...b].map((x) => x ^ 0x33));
  return { LICENCE_EMAIL_ENTROPY: dpapi.LICENCE_EMAIL_ENTROPY, protect: async (d) => flip(d), unprotect: async (b) => flip(b) };
};
const REQ = (over = {}) => ({ planId: 'pro-annual', addons: [], seats: 3, currency: 'VND', method: 'momo', email: 'a@example.vn', ...over });
const payloadOf = (t) => token.verifyToken(t, { channel: 'stable' });

(async () => {
  const dir = removeAfterExit(fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-commerce-')));

  console.log('\ncommerce: the plans and their prices\n');

  {
    check('VND only, and marked as sample data (decided 2026-10-02)', PLANS.currency === 'VND' && PLANS.sample === true);
    check('the three plans of §7.3', PLANS.plans.map((p) => p.id).join(',') === 'pro-annual,pro-lifetime,business-annual');
    check('every price is a whole, positive number of đồng',
      PLANS.plans.every((p) => p.seats.every((s) => Number.isInteger(s.price) && s.price > 0) && Object.values(p.addons).every((v) => Number.isInteger(v) && v > 0)));
    check('every plan offers its own default seat count', PLANS.plans.every((p) => p.seats.some((s) => s.n === p.defaultSeats)));
    check('Business has no add-on to sell: it includes the Developer Pack', Object.keys(planOf('business-annual').addons).length === 0 &&
      can({ state: 'active', tier: 'business', addons: [] }, 'pro.dev'));
    check('the Developer Pack is an add-on of Pro (decided 2026-10-02)', planOf('pro-annual').addons.dev > 0 && planOf('pro-lifetime').addons.dev > 0);

    const q = quote({ planId: 'pro-annual', addons: ['dev'] });
    check('§7.2.3\'s example: Pro for a year, three machines, with the Developer Pack: 698.000 ₫',
      q.ok && q.seats === 3 && q.total === 698000 && q.lines.length === 2, JSON.stringify(q.lines));
    check('a coupon takes its share, in whole đồng', quote({ planId: 'pro-annual', addons: ['dev'], discount: 0.1 }).total === 628200);
    check('one add-on asked for twice is charged once', quote({ planId: 'pro-annual', addons: ['dev', 'dev'] }).total === 698000);
    check('a plan that does not exist is refused', quote({ planId: 'pro-forever' }).reason === 'unknownPlan');
    check('a seat count the plan does not sell is refused', quote({ planId: 'pro-annual', seats: 4 }).reason === 'unknownSeats');
    check('an add-on the plan does not sell is refused', quote({ planId: 'business-annual', addons: ['dev'] }).reason === 'unknownAddon');
    check('a discount of everything is refused', quote({ planId: 'pro-annual', discount: 1 }).reason === 'badDiscount');
  }

  console.log('\ncommerce: the mock provider, outcome by outcome\n');

  const mock = (outcome, over = {}) => new MockPaymentProvider({ outcome, latencyMs: 0, ordersFile: path.join(dir, `orders-${outcome.replace(':', '-')}.json`), ...over });

  {
    check('§7.4\'s six outcomes, no more', OUTCOMES.length === 6);
    check('an unknown outcome falls back to success', new MockPaymentProvider({ outcome: 'nonsense' }).outcome === 'succeeded');

    const ok = await mock('succeeded').checkout(REQ({ addons: ['dev'], total: 698000 }));
    const v = payloadOf(ok.licenseToken);
    check('succeeded: a licence this build believes', ok.status === 'succeeded' && v.ok, v.reason || '');
    check('for the plan, the add-on and the seats that were bought', v.ok && v.payload.tier === 'pro' && v.payload.addons.join() === 'dev' &&
      v.payload.seats === 3 && v.payload.plan === 'pro-annual' && v.payload.orderId === ok.orderId);
    check('a year long', v.ok && Math.abs(Date.parse(v.payload.expires) - Date.now() - 365 * DAY) < 60000);
    check('and naming no email address', !Buffer.from(ok.licenseToken.split('.')[0], 'base64url').toString('utf8').includes('@'));
    const life = payloadOf((await mock('succeeded').checkout(REQ({ planId: 'pro-lifetime' }))).licenseToken);
    check('lifetime: no expiry at all', life.ok && life.payload.expires === null);
    const biz = payloadOf((await mock('succeeded').checkout(REQ({ planId: 'business-annual', seats: 10 }))).licenseToken);
    check('Business: the Developer Pack is part of it, not an add-on on the token', biz.ok && biz.payload.tier === 'business' && biz.payload.addons.length === 0);

    for (const outcome of ['failed:card_declined', 'failed:network', 'cancelled']) {
      const p = mock(outcome);
      const r = await p.checkout(REQ());
      const [status, code] = outcome.split(':');
      check(`${outcome}: says so, carries no licence, and leaves no invoice`,
        r.status === status && (code ? r.errorCode === code : true) && !r.licenseToken && (await p.invoices()).length === 0);
    }

    for (const outcome of ['pending', 'failed:timeout']) {
      const p = mock(outcome);
      const r = await p.checkout(REQ());
      check(`${outcome}: no licence yet`, r.status === outcome.split(':')[0] && !r.licenseToken && Boolean(r.orderId));
      const later = await p.status(r.orderId);
      check(`${outcome}: asking again later brings the licence (the confirmation arrived)`, later.status === 'succeeded' && payloadOf(later.licenseToken).ok);
      const again = await p.status(r.orderId);
      check(`${outcome}: and only once`, again.status === 'succeeded' && !again.licenseToken && again.alreadyActivated === true);
    }
    check('an order nobody made is not found', (await mock('succeeded').status('mock_nope')).errorCode === 'order.notFound');

    const slow = new MockPaymentProvider({ latencyMs: 5000 });
    const ctl = new AbortController();
    const started = Date.now();
    setTimeout(() => ctl.abort(), 50);
    let stopped = null;
    try {
      await slow.checkout(REQ(), { signal: ctl.signal });
    } catch (err) {
      stopped = err;
    }
    check('a checkout can be stopped while it waits', stopped && stopped.name === 'AbortError' && Date.now() - started < 2000);

    const bad = [
      ['an email that is not one', { email: 'not-an-email' }],
      ['a method nobody offers', { method: 'cash' }],
      ['a currency the plans are not in', { currency: 'USD' }],
      ['a total that is not what the plan costs', { total: 1 }],
      ['a seat count the plan does not sell', { seats: 2 }],
    ];
    for (const [label, over] of bad) {
      const r = await new MockPaymentProvider({ latencyMs: 60000 }).checkout(REQ(over));
      check(`refused before any wait: ${label}`, r.status === 'failed' && r.errorCode === 'invalid_request');
    }
    check('the coupon of §7.4, in any case', (await mock('succeeded').coupon(' test10 ', 'pro-annual')).discount === 0.1 &&
      (await mock('succeeded').coupon('NOPE', 'pro-annual')).reason === 'coupon.notFound');
  }

  {
    const file = path.join(dir, 'orders-kept.json');
    const first = new MockPaymentProvider({ latencyMs: 0, ordersFile: file });
    const r = await first.checkout(REQ({ email: 'private.person@example.vn' }));
    const reopened = new MockPaymentProvider({ latencyMs: 0, ordersFile: file });
    const invoices = await reopened.invoices();
    check('invoices survive a restart', invoices.length === 1 && invoices[0].orderId === r.orderId && invoices[0].total === 499000);
    const text = fs.readFileSync(file, 'utf8');
    check('orders.json never holds the email address', !text.includes('private.person') && !text.includes('@'));
    check('nor a licence key', !text.includes(r.licenseToken.split('.')[1]));
  }

  console.log('\ncommerce: paying activates, through the same door as entering a key\n');

  {
    const file = path.join(dir, 'license.dat');
    licence.setFileForHarness(file);
    const ordersDir = path.join(dir, 'app');
    commerce.resetForHarness();
    const fake = fakeDpapi();

    const r = await commerce.checkout(REQ({ addons: ['dev'], email: 'buyer@example.vn' }), { dir: ordersDir, dpapi: fake });
    check('a purchase activates its licence before the window hears', r.status === 'succeeded' && r.licence && r.licence.state === 'active' &&
      licence.storedLicence({ channel: 'stable' }).addons.includes('dev'));
    check('the window gets the key to show and copy, never the address', typeof r.token === 'string' && !('email' in r) && !('licenseToken' in r));
    check('the address is kept, encrypted, for the licence screen', (await licence.emailOfCurrent({ dpapi: fake })) === 'buyer@example.vn' &&
      !fs.readFileSync(file, 'utf8').includes('buyer@'));
    check('the order went to orders.json in the data folder', fs.existsSync(path.join(ordersDir, 'orders.json')));

    const coupon = await commerce.checkout(REQ({ coupon: 'WRONG' }), { dir: ordersDir, dpapi: fake });
    check('a coupon that is not accepted stops the checkout, and says which thing was wrong', coupon.status === 'failed' && coupon.errorCode === 'coupon_invalid');

    fs.rmSync(file);
    const trial = await commerce.startTrial({ dpapi: fake });
    check('the 14-day trial', trial.ok && trial.licence.state === 'trial' && trial.licence.plan === 'pro-trial' &&
      Math.abs(Date.parse(trial.licence.expires) - Date.now() - 14 * DAY) < 60000);
    check('is Pro without the Developer Pack', can(trial.licence, 'pro.diff') && !can(trial.licence, 'pro.dev'));
    const again = await commerce.startTrial({ dpapi: fake });
    check('once per copy', !again.ok && again.reason === 'trialUsed');
    await licence.deactivate();
    check('and still once after the licence is gone', (await commerce.startTrial({ dpapi: fake })).reason === 'trialUsed');
    licence.setFileForHarness(null);
  }

  {
    // A release build cannot be told how the mock should answer.
    commerce.resetForHarness();
    const stable = commerce.getProvider({ dir, channel: 'stable', env: { CLEANDRIVE_MOCK_OUTCOME: 'failed:card_declined', CLEANDRIVE_MOCK_LATENCY_MS: '0' } });
    check('on stable the mock always succeeds, whatever the environment says', stable.outcome === 'succeeded' && stable.latencyMs === 1200);
    commerce.resetForHarness();
    const dev = commerce.getProvider({ dir, channel: 'dev', env: { CLEANDRIVE_MOCK_OUTCOME: 'pending', CLEANDRIVE_MOCK_LATENCY_MS: '5' } });
    check('on dev a harness chooses the outcome and the wait', dev.outcome === 'pending' && dev.latencyMs === 5);
    commerce.resetForHarness();
  }

  console.log('\ncommerce: which computer this is\n');

  {
    const guid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const id = await machine.machineId({ readGuid: async () => guid });
    check('a salted SHA-256 of MachineGuid', id === machine.idFor(guid) && /^[0-9a-f]{64}$/.test(id) && !id.includes(guid.replace(/-/g, '').slice(0, 12)));
    check('the same computer gives the same id', id === (await machine.machineId({ readGuid: async () => guid.toUpperCase() })));
    check('nothing readable: no id, not a made-up one', (await machine.machineId({ readGuid: async () => null })) === null &&
      (await machine.machineId({ readGuid: async () => 'not-a-guid' })) === null);
    check('the screen shows eight characters of it', machine.shortId(id) === id.slice(0, 8) && machine.shortId('x') === null);
    const t0 = Date.now();
    const real = await machine.machineId();
    const raw = await machine.viaReg();
    check('this computer\'s, read unelevated', /^[0-9a-f]{64}$/.test(real || ''), `${Date.now() - t0} ms`);
    check('and it is not the GUID itself', raw && real !== raw && !real.includes(raw.replace(/-/g, '').toLowerCase()));
  }

  console.log('\ncommerce: what the window is made of\n');

  {
    const R = path.join(__dirname, '..', 'src', 'renderer');
    const ui = fs.readFileSync(path.join(R, 'licence.js'), 'utf8');
    const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
    const { FEATURES } = require('../src/main/license/entitlements');
    const unlabelled = Object.keys(FEATURES).filter((k) => k !== 'free' && !ui.includes(`t('feature.${k}',`));
    check('the plan columns word every feature key, each with a literal key (§7.2.2: from FEATURES)', unlabelled.length === 0, unlabelled.join(', '));
    const plansMarkup = html.slice(html.indexOf('<dialog class="shortcuts plans-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog class="shortcuts plans-dialog"')));
    check('the checkout has no field a card number could go in (§7.7)', plansMarkup.length > 1000 &&
      !/autocomplete="cc-|name="card|id="[^"]*card[^"]*"\s[^>]*type="(text|number|tel)"|inputmode="numeric"/i.test(plansMarkup) &&
      !/createElement\('input'\)[\s\S]{0,200}type = '(text|number|tel)'/.test(ui));
    check('and the window never reaches the network to pay (§7.7)', !/\bfetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(ui));
  }

  console.log('\ncommerce: the Terms of use and the Refund policy\n');

  {
    const R = path.join(__dirname, '..', 'src', 'renderer');
    const docs = require('../src/renderer/legal-text');
    const viewer = fs.readFileSync(path.join(R, 'legal.js'), 'utf8');
    const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
    const kinds = Object.keys(docs);
    check('two documents: the terms and the refund policy', kinds.join() === 'terms,refund', kinds.join());
    for (const kind of kinds) {
      const { vi, en } = docs[kind];
      const whole = (d) => d && d.title && d.version && d.effective && Array.isArray(d.sections) && d.sections.length > 0 &&
        d.sections.every((s) => s.heading && Array.isArray(s.body) && s.body.length > 0 &&
          s.body.every((b) => (typeof b === 'string' && b.length > 10) || (Array.isArray(b) && b.length > 0 && b.every((x) => typeof x === 'string' && x.length > 5))));
      check(`${kind}: complete in Vietnamese, which governs, and in English`, whole(vi) && whole(en));
      check(`${kind}: the same sections, in the same order, in both`, vi.sections.length === en.sections.length &&
        vi.sections.every((s, i) => s.body.length === en.sections[i].body.length && s.heading.split('.')[0] === en.sections[i].heading.split('.')[0]),
        `${vi.sections.length} vi / ${en.sections.length} en`);
      check(`${kind}: the same version and date in both`, vi.version === en.version && /2026/.test(vi.effective) && /2026/.test(en.effective));
      check(`${kind}: says up front that nothing is being sold yet`, /chưa mở bán/.test(vi.notice) && /not on sale yet/.test(en.notice));
    }
    const asked = [...html.matchAll(/data-legal="([a-z]+)"/g)].map((m) => m[1]);
    check('every way in names a document that exists', asked.length >= 4 && asked.every((k) => kinds.includes(k)), [...new Set(asked)].join(', '));
    const agreement = html.slice(html.indexOf('id="plans-terms"'), html.indexOf('</label>', html.indexOf('id="plans-terms"')));
    check('checkout\'s agreement line opens both, as buttons that do not tick the box',
      /type="button" class="legal-link" data-legal="terms"/.test(agreement) && /type="button" class="legal-link" data-legal="refund"/.test(agreement));
    check('a document is drawn as text, never as markup, and fetched from nowhere',
      !/innerHTML|insertAdjacentHTML|outerHTML/.test(viewer) && !/\bfetch\(|XMLHttpRequest/.test(viewer));
    const all = JSON.stringify(docs);
    check('the only address in them is the project\'s own support page', (all.match(/https?:\/\/[^\s"',)]+/g) || []).map((u) => u.replace(/[.,;:]+$/, '')).every((u) => u === 'https://github.com/TonDungx/cleandrive/issues'));
    check('the price line no longer says VAT: software is not subject to it (Luật Thuế GTGT 2024, Điều 5 k21)', !/VAT/.test(html) &&
      /every tax and fee included/.test(html));
    check('the refund window in the policy is the one the terms point to: 30 days', /30 ngày/.test(JSON.stringify(docs.refund.vi)) && /30 days/.test(JSON.stringify(docs.refund.en)));
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
