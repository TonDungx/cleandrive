'use strict';

// Screenshots of Plans and licence (Phase 6): the card at the top of
// Settings for Free (with Pro closed again for someone upgrading from 0.5.0),
// the plans dialog yearly and lifetime, checkout, paying, every result §7.4
// lists, the card holding a licence, the trial strip, and the button an
// UpgradeHint now carries -- in both themes, in Vietnamese and English, at
// 1180, 720 and 560 wide.
//
//   npx electron scripts/shoot-licence.js [outputDir]
//
// Throwaway userData (so license.dat and orders.json are the harness's own),
// a suffixed task name, the stored licence as a release reads it, and the
// mock answering fast. Every state is checked by what is on screen before it
// is shot; a shot of the wrong state throws instead of being saved.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');

process.env.CLEANDRIVE_ENTITLEMENTS = 'stored';
process.env.CLEANDRIVE_MOCK_LATENCY_MS = '1500';
delete process.env.CLEANDRIVE_MOCK_OUTCOME;

app.setName(require('../package.json').name);
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-shootlicence-'));
app.setPath('userData', require('./lib/sandbox').removeAfterExit(SANDBOX));
process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'shootlicence';
require('../src/main/lib/preview/serve').registerScheme();

const OUT =
  process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !a.endsWith('shoot-licence.js')) ||
  path.join(os.tmpdir(), 'cd-licence-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  if (app.getPath('userData') !== SANDBOX) throw new Error('not isolated');
  const licence = require('../src/main/license/state');
  if (!licence.licenceFile().startsWith(SANDBOX)) throw new Error(`the licence would be read from ${licence.licenceFile()}`);
  const commerce = require('../src/main/commerce');

  // Someone who used 0.5.0, while Pro was open.
  // Two profiles of their own, the second made while Pro was open (§7.1),
  // over a folder of this script's own on D: (the scan refuses %TEMP%).
  const FIXTURE = path.join('D:', path.sep, `cleandrive-shootlicence-${require('node:crypto').randomBytes(3).toString('hex')}`);
  fs.mkdirSync(path.join(FIXTURE, 'Temp'), { recursive: true });
  for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(FIXTURE, 'Temp', `f${i}.tmp`), Buffer.alloc(20000 + i * 1000, i));
  process.on('exit', () => {
    if (/^D:\\cleandrive-shootlicence-[0-9a-f]{6}$/.test(FIXTURE) && !fs.lstatSync(FIXTURE).isSymbolicLink()) fs.rmSync(FIXTURE, { recursive: true, force: true });
  });
  const profile = (id, name, over) => ({ id, name, enabled: true, dryRun: false, roots: [path.join(FIXTURE, 'Temp')], categories: ['temp'], skipIfRunning: [], ...over });
  fs.writeFileSync(path.join(SANDBOX, 'settings.json'), JSON.stringify({
    version: 12,
    trends: { dailySample: false, sampleTime: '12:00' },
    updates: { enabled: false, lastVersion: '0.5.0' },
    autoClean: { profiles: [profile('main', 'Hằng tuần', { dryRun: true }), profile('pcaches01', 'Cache hằng ngày', {})] },
  }));
  require('../src/main/lib/preview/serve').serve();
  const ipc = require('../src/main/ipc');
  ipc.register();
  ipc.noteUpgradedFrom('0.5.0');
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`\noutput: ${OUT}\nlicence file: ${licence.licenceFile()}\n`);

  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  licence.onChange(() => {
    if (!win.isDestroyed()) win.webContents.send('license:changed');
  });
  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const level = typeof args[1] === 'object' ? args[1].level : args[1];
    const message = typeof args[1] === 'object' ? args[1].message : args[2];
    if (level === 3 || level === 'error') errors.push(message);
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { theme: 'light', lang: 'en' } });
  nativeTheme.themeSource = 'light';
  win.focus();

  const js = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`);
  const read = (expr) => win.webContents.executeJavaScript(expr);
  const until = async (expr, ms = 20000, what = expr) => {
    const start = Date.now();
    while (!(await read(expr))) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for: ${what}`);
      await wait(120);
    }
  };
  await wait(800);

  /** §11 item 9: the palette has to have reached every ink before anything is shot. */
  const paletteSettled = async (mode, ms = 8000) => {
    const sample = () =>
      read(`(() => {
        const rgb = (v) => (String(v).match(/[\\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
        const lum = (c) => {
          const [r, g, b] = rgb(c).map((n) => { const x = n / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const inks = ['body', '.brand-name', '.tab .tab-label', '#licence-title'].map((s) => (s === 'body' ? document.body : document.querySelector(s))).filter(Boolean).map((el) => lum(getComputedStyle(el).color));
        return { inks, background: lum(getComputedStyle(document.body).backgroundColor) };
      })()`);
    const start = Date.now();
    let last = null;
    while (Date.now() - start < ms) {
      const s = await sample();
      const dark = mode === 'dark';
      const right = dark ? s.background < 0.1 && s.inks.every((n) => n > 0.2) : s.background > 0.7 && s.inks.every((n) => n < 0.4);
      const key = JSON.stringify(s);
      if (right && key === last) return true;
      last = key;
      await wait(200);
    }
    throw new Error(`the ${mode} palette did not settle`);
  };

  const shoot = async (name) => {
    await wait(300);
    win.webContents.invalidate();
    await win.webContents.capturePage();
    await wait(150);
    let bytes = (await win.webContents.capturePage()).toPNG();
    for (let k = 0; k < 3 && bytes.length === 0; k += 1) {
      await wait(300);
      bytes = (await win.webContents.capturePage()).toPNG();
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), bytes);
    console.log(`  ${name}.png`);
  };
  let current = 'light';
  const theme = async (mode) => {
    current = mode;
    nativeTheme.themeSource = mode;
    await js(`ThemeSwitch.adopt(${JSON.stringify(mode)});`);
    await paletteSettled(mode);
  };
  const both = async (name) => {
    const back = current;
    await shoot(`${name}-${current}`);
    await theme(current === 'light' ? 'dark' : 'light');
    await shoot(`${name}-${current}`);
    await theme(back);
  };
  const language = async (code) => {
    await js(`
      if (document.getElementById('plans').open) document.getElementById('plans').close();
      document.querySelector('.tab[data-tab="settings"]').click();
      document.querySelector('[data-language-choice="${code}"]').click();
    `);
    await wait(1000);
  };
  const tab = async (name) => {
    await js(`document.querySelector('.tab[data-tab="${name}"]').click(); document.querySelector('main').scrollTop = 0;`);
    await wait(600);
  };
  const text = (id) => read(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent ? document.getElementById(${JSON.stringify(id)}).textContent.replace(/\\s+/g, ' ').trim() : ''`);
  const need = async (label, expr) => {
    if (!(await read(expr))) {
      const card = await text('licence-card');
      const dialog = await text('plans');
      throw new Error(`${label}: not on screen\ncard: ${card.slice(0, 400)}\ndialog: ${dialog.slice(0, 400)}`);
    }
  };
  /** A button by its words, inside `scope`; throws when nothing matches. */
  const click = async (scope, words) => {
    const ok = await read(`(() => {
      const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((x) => x.offsetParent !== null && x.textContent.trim() === ${JSON.stringify(words)});
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!ok) throw new Error(`no visible button "${words}" in ${scope}`);
    await wait(500);
  };
  const overflow = async (label) => {
    const o = await read(`(() => {
      const main = document.querySelector('main');
      const edge = main.getBoundingClientRect().left + main.clientWidth + 1;
      const dialog = document.getElementById('plans');
      // The dialog's content edge: past its border (clientLeft), not counting its scrollbar.
      const dEdge = dialog.getBoundingClientRect().left + dialog.clientLeft + dialog.clientWidth + 1;
      const inDialog = dialog.open ? [...dialog.querySelectorAll('*')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > dEdge; }) : [];
      // And inside each plan column: a button wider than its column is clipped by nothing and reads as broken.
      for (const col of dialog.open ? dialog.querySelectorAll('.plans-col') : []) {
        const c = col.getBoundingClientRect();
        for (const el of col.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.width > 0 && (b.right > c.right + 0.5 || b.left < c.left - 0.5)) inDialog.push(el); }
      }
      const wide = dialog.open ? inDialog : [...document.querySelectorAll('main *')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > edge && !el.classList.contains('panel-bar'); });
      return {
        scroll: dialog.open ? dialog.scrollWidth - dialog.clientWidth : getComputedStyle(main).overflowX !== 'hidden' ? main.scrollWidth - main.clientWidth : 0,
        wide: wide.slice(0, 4).map((el) => el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 30) + ' "' + (el.textContent || '').trim().slice(0, 30) + '"'),
      };
    })()`);
    console.log(`    ${label}: sideways ${o.scroll}px${o.wide.length ? `, past the edge: ${o.wide.join(', ')}` : ''}`);
    if (o.scroll > 0 || o.wide.length > 0) throw new Error(`${label}: something sticks out`);
  };
  const focusIn = (id) => read(`Boolean(document.activeElement && document.getElementById(${JSON.stringify(id)}).contains(document.activeElement))`);

  /* -- 1. Free, after 0.5.0 -------------------------------------------------------- */

  await language('vi');
  await tab('settings');
  await until(`document.getElementById('licence-badge').textContent.trim() === 'Free'`, 20000, 'the Free badge');
  await need('Pro closed again, said on the card', `/Tới bản 0\\.5\\.0, Pro và Developer Pack mở cho mọi người/.test(document.getElementById('licence-notes').textContent)`);
  await need('the trial offered', `!document.getElementById('licence-trial').hidden && document.getElementById('licence-plans').textContent.trim() === 'Xem các gói'`);
  await need('the strip about it at the top', `!document.getElementById('licence-strip').hidden && /lại thuộc về bản quyền/.test(document.getElementById('licence-strip-text').textContent)`);
  await need('no key to copy on Free', `document.getElementById('licence-copy').hidden && document.getElementById('licence-deactivate').hidden`);
  await need('no invoices yet', `/Chưa có hoá đơn nào/.test(document.getElementById('licence-invoices').textContent)`);
  await paletteSettled('light');
  await both('licence-free-vi');

  // The strip keeps out of the way of a dialog and a delete (§7.2.5).
  await js(`document.getElementById('delete-progress').hidden = false;`);
  await until(`document.getElementById('licence-strip').hidden`, 3000, 'the strip hiding while a delete runs');
  await js(`document.getElementById('delete-progress').hidden = true;`);
  await until(`!document.getElementById('licence-strip').hidden`, 3000, 'the strip back after the delete');
  console.log('    the strip hides while the delete bar is up, and comes back after');

  /* -- 2. the plans ------------------------------------------------------------------- */

  await js(`document.getElementById('licence-plans').click();`);
  await until(`document.getElementById('plans').open && document.querySelectorAll('#plans-columns .plans-col').length === 3`, 5000, 'the plans dialog');
  await need('the strip hides under an open dialog', `document.getElementById('licence-strip').hidden`);
  await need('focus inside the dialog', `document.activeElement && document.getElementById('plans').contains(document.activeElement)`);
  await overflow('1180 vi, the plans with the trial on offer');
  await need('Free marked as the current plan, Pro priced yearly, Business listing its own',
    `(() => { const c = [...document.querySelectorAll('#plans-columns .plans-col')].map((x) => x.textContent);
      return /Gói hiện tại/.test(c[0]) && /499\\.000\\s₫ một năm · 3 máy/.test(c[1]) && /Thư viện game/.test(c[1]) && /Developer Pack \\(199\\.000\\s₫\\)/.test(c[1]) && /Dòng lệnh/.test(c[2]) && /Mọi thứ của Pro/.test(c[2]); })()`);
  await need('a column per tier, and every feature key named in one of them', `document.querySelectorAll('#plans-columns li').length >= 5 + 14 + 5`);
  await both('plans-choose-vi');
  await js(`document.querySelector('#plans-period [data-period="lifetime"]').click();`);
  await wait(400);
  await need('lifetime prices', `/1\\.490\\.000\\s₫ một lần · 3 máy/.test(document.getElementById('plans-columns').textContent) && /Chỉ có theo năm/.test(document.getElementById('plans-columns').textContent)`);
  await need('the period button keeps the keyboard', `document.activeElement && document.activeElement.dataset.period === 'lifetime'`);
  await overflow('1180 vi, the plans');
  await shoot('plans-lifetime-vi-light');
  await js(`document.querySelector('#plans-period [data-period="annual"]').click();`);
  await wait(300);

  /* -- 3. checkout ---------------------------------------------------------------------- */

  await js(`document.getElementById('plans-dev').click();`);
  await click('#plans-columns', 'Chọn Pro');
  await until(`!document.getElementById('plans-checkout').hidden && /698\\.000/.test(document.getElementById('plans-total').textContent)`, 5000, 'checkout at 698.000 ₫');
  await need('§7.2.3: Pay waits for an email, a method and the terms', `document.getElementById('plans-pay').disabled && /Còn thiếu: địa chỉ email, phương thức thanh toán, đồng ý điều khoản/.test(document.getElementById('plans-pay-hint').textContent)`);
  await need('no field for a card number anywhere (§7.7)', `![...document.querySelectorAll('#plans input')].some((i) => /card|cc-|number/i.test((i.autocomplete || '') + (i.name || '') + (i.id || '')) && i.type !== 'radio')`);
  await shoot('checkout-empty-vi-light');

  // The two documents, opened from the agreement line itself.
  await js(`document.querySelector('#plans-checkout [data-legal="terms"]').click();`);
  await until(`document.getElementById('legal').open && document.getElementById('legal-title').textContent === 'Điều khoản sử dụng'`, 3000, 'the Terms of use');
  await need('reading the terms does not agree to them', `!document.getElementById('plans-terms').checked && document.getElementById('plans').open`);
  await need('the terms say up front that nothing is sold yet, then ten sections', `/chưa mở bán/.test(document.getElementById('legal-body').textContent) && document.querySelectorAll('#legal-body h3').length === 10`);
  await overflow('1180 vi, the Terms of use');
  await both('legal-terms-vi');
  await js(`document.getElementById('legal').scrollTop = document.getElementById('legal').scrollHeight;`);
  await shoot('legal-terms-end-vi-light');
  await js(`document.getElementById('legal-close').click();`);
  await need('closing it gives the keyboard back to the link', `document.activeElement === document.querySelector('#plans-checkout [data-legal="terms"]')`);
  await js(`document.querySelector('#plans-checkout [data-legal="refund"]').click();`);
  await until(`document.getElementById('legal').open && document.getElementById('legal-title').textContent === 'Chính sách hoàn tiền'`, 3000, 'the Refund policy');
  await need('a document opened after another starts at its top', `document.getElementById('legal').scrollTop === 0`);
  await need('the refund policy: 30 days, no reason, no fee', `/30 ngày kể từ ngày thanh toán/.test(document.getElementById('legal-body').textContent)`);
  await both('legal-refund-vi');
  await js(`document.getElementById('legal-close').click();`);
  await js(`
    const e = document.getElementById('plans-email'); e.value = 'nguoi.mua@example.vn'; e.dispatchEvent(new Event('input'));
    document.querySelector('input[name="plans-method"][value="momo"]').click();
    document.getElementById('plans-terms').click();
    document.getElementById('plans-coupon').value = 'test10';
    document.getElementById('plans-coupon-apply').click();
  `);
  await until(`/628\\.200/.test(document.getElementById('plans-total').textContent) && !document.getElementById('plans-pay').disabled`, 5000, 'the coupon and an enabled Pay');
  await need('the discount line', `/Giảm giá TEST10/.test(document.getElementById('plans-lines').textContent) && /Thanh toán 628\\.200/.test(document.getElementById('plans-pay').textContent)`);
  await both('checkout-filled-vi');
  await js(`document.getElementById('plans-pay').click();`);
  await until(`document.getElementById('plans-pay').classList.contains('is-busy')`, 3000, 'processing');
  await need('processing locks the dialog', `document.getElementById('plans-pay').textContent.trim() === 'Đang xử lý…' && document.getElementById('plans-close').disabled && document.getElementById('plans-email').disabled`);
  await shoot('checkout-processing-vi-light');
  await until(`!document.getElementById('plans-result').hidden`, 10000, 'the result');
  await need('§7.2.4: thanks, the key, its expiry and seats',
    `/Cảm ơn bạn\\. CleanDrive Pro đã được kích hoạt trên máy này\\./.test(document.getElementById('plans-result-message').textContent) && document.getElementById('plans-key').value.split('.').length === 2 && /1 \\/ 3 máy/.test(document.getElementById('plans-result-facts').textContent)`);
  await both('result-ok-vi');
  await click('#plans-result-actions', 'Đóng');
  await need('focus back where the dialog was opened from', `document.activeElement === document.getElementById('licence-plans')`);

  /* -- 4. the card, holding a licence --------------------------------------------------- */

  await until(`document.getElementById('licence-badge').textContent.trim() === 'Đang dùng' && !/Đang đọc…/.test(document.getElementById('licence-facts').textContent)`, 15000, 'the active card, email read');
  await need('the card names the licence, the add-on, the email and the invoice',
    `(() => { const c = document.getElementById('licence-card').textContent;
      return /CleanDrive Pro \\+ Developer Pack · Hàng năm/.test(c) && /nguoi\\.mua@example\\.vn/.test(c) && /628\\.200/.test(c) && /MoMo/.test(c) && /hết hiệu lực khi bắt đầu bán/.test(c) && !document.getElementById('licence-copy').hidden; })()`);
  await need('the strip about Pro closing has gone', `document.getElementById('licence-strip').hidden`);
  const onDisk = fs.readFileSync(licence.licenceFile(), 'utf8') + fs.readFileSync(path.join(SANDBOX, 'orders.json'), 'utf8');
  if (onDisk.includes('nguoi.mua')) throw new Error('the email address is in the clear on disk');
  console.log('    license.dat and orders.json hold no email address in the clear');
  await js(`document.getElementById('licence-card').scrollIntoView({ block: 'start' });`);
  await both('licence-active-vi');
  await need('Pro opened without a restart', `(async () => (await window.cleandrive.entitlements()).data.find((e) => e.feature === 'pro.dev').allowed)()`);
  console.log('    pro.dev is open in the same window, no restart');

  /* -- 5. every other outcome ------------------------------------------------------------ */

  const outcome = async (name, expectText, shotName) => {
    process.env.CLEANDRIVE_MOCK_OUTCOME = name;
    commerce.resetForHarness();
    await js(`window.LicenceUI.open({ opener: document.getElementById('licence-plans') });`);
    await until(`document.getElementById('plans').open`, 3000, 'the dialog');
    await click('#plans-columns', 'Chọn Business');
    await until(`!document.getElementById('plans-checkout').hidden`, 3000, 'checkout');
    await js(`
      const e = document.getElementById('plans-email'); e.value = 'it@example.vn'; e.dispatchEvent(new Event('input'));
      document.querySelector('input[name="plans-method"][value="bank_qr"]').click();
      if (!document.getElementById('plans-terms').checked) document.getElementById('plans-terms').click();
      document.getElementById('plans-pay').click();
    `);
    await until(`!document.getElementById('plans-result').hidden`, 10000, `the ${name} result`);
    await need(`${name}: ${expectText}`, `${JSON.stringify(expectText)} === document.getElementById('plans-result-message').textContent.trim()`);
    if (shotName) await shoot(shotName);
  };
  await outcome('failed:card_declined', 'Ngân hàng từ chối giao dịch. Bạn chưa bị trừ tiền.', 'result-declined-vi-light');
  await click('#plans-result-actions', 'Thử phương thức khác');
  await need('"try another method" goes back to the form', `!document.getElementById('plans-checkout').hidden`);
  await js(`document.getElementById('plans').close();`);
  await outcome('failed:network', 'Không kết nối được máy chủ thanh toán. Bạn chưa bị trừ tiền.', 'result-network-vi-light');
  await js(`document.getElementById('plans').close();`);
  await outcome('cancelled', 'Bạn đã huỷ thanh toán.', 'result-cancelled-vi-light');
  await js(`document.getElementById('plans').close();`);
  await outcome('failed:timeout', 'Chưa nhận được xác nhận. Nếu bạn đã bị trừ tiền, bản quyền sẽ được gửi tới email.', null);
  await theme('dark');
  await shoot('result-timeout-vi-dark');
  await theme('light');
  await click('#plans-result-actions', 'Kiểm tra lại');
  await until(`/CleanDrive Business đã được kích hoạt/.test(document.getElementById('plans-result-message').textContent)`, 10000, 'the late confirmation');
  console.log('    a timed-out payment confirmed on "check again"');
  await js(`document.getElementById('plans').close();`);
  await outcome('pending', 'Đang chờ xác nhận chuyển khoản.', 'result-pending-vi-light');
  await need('pending offers both ways on', `/Kiểm tra lại/.test(document.getElementById('plans-result-actions').textContent) && /Nhập mã khi nhận được email/.test(document.getElementById('plans-result-actions').textContent)`);
  await click('#plans-result-actions', 'Nhập mã khi nhận được email');
  await need('"enter the key" opens the field on the card', `!document.getElementById('licence-enter-form').hidden && document.activeElement === document.getElementById('licence-key')`);
  delete process.env.CLEANDRIVE_MOCK_OUTCOME;
  commerce.resetForHarness();

  /* -- 6. a bad key, then a trial in its last days ---------------------------------------- */

  await js(`document.getElementById('licence-key').value = 'abc.def'; document.getElementById('licence-activate').click();`);
  await until(`document.getElementById('licence-enter-result').textContent.trim().length > 0`, 5000, 'the refusal');
  await need('a bad key is refused in words', `/đã bị sửa sau khi được cấp|không phải mã bản quyền/.test(document.getElementById('licence-enter-result').textContent)`);
  await shoot('licence-badkey-vi-light');
  await js(`document.getElementById('licence-enter-cancel').click();`);

  await licence.deactivate();
  const ending = require('../src/main/license/mock-issuer').issue({ plan: 'pro-trial', tier: 'pro', seats: 1, expires: new Date(Date.now() + 2 * DAY + 3600e3).toISOString(), trial: true });
  const trial = await licence.activate(ending.token, {});
  if (!trial.ok) throw new Error(`could not set up an ending trial: ${trial.reason}`);
  await js(`try { localStorage.removeItem('cleandrive.licence.strip.trial'); } catch {}`);
  await until(`document.getElementById('licence-badge').textContent.trim() === 'Dùng thử'`, 10000, 'the trial badge');
  await js(`window.LicenceUI.refresh();`);
  await until(`!document.getElementById('licence-strip').hidden && /Còn 3 ngày dùng thử Pro/.test(document.getElementById('licence-strip-text').textContent)`, 5000, 'the trial strip');
  await js(`document.querySelector('main').scrollTop = 0;`);
  await both('strip-trial-vi');
  await click('#licence-strip', 'Để sau');
  await js(`window.LicenceUI.refresh();`);
  await wait(400);
  await need('once a day: dismissed, it stays away today', `document.getElementById('licence-strip').hidden`);

  /* -- 7. the way in from an UpgradeHint --------------------------------------------------- */

  await licence.deactivate();
  await tab('planner');
  await js(`document.getElementById('plan-run').click();`);
  await until(`document.querySelector('#panel-planner .upgrade-hint .upgrade-hint-plans')`, 10000, 'the planner hint with its button');
  await both('hint-planner-vi');
  await js(`document.querySelector('#panel-planner .upgrade-hint-plans').click();`);
  await until(`document.getElementById('plans').open`, 3000, 'the dialog from the hint');
  await js(`document.getElementById('plans').close();`);

  /* -- 8. a yearly licence that ran out (6.5) ------------------------------------------------------ */

  const lapsed = require('../src/main/license/mock-issuer').issue({ plan: 'pro-annual', tier: 'pro', seats: 3, expires: new Date(Date.now() - 10 * DAY).toISOString() });
  if (!(await licence.activate(lapsed.token, {})).ok) throw new Error('could not set up a lapsed licence');
  await tab('settings');
  await until(`document.getElementById('licence-badge').textContent.trim() === 'Hết hạn'`, 10000, 'the expired badge');
  await need('the card says read-only, all data still here, and offers to renew', `/Pro đã hết hạn\. Tính năng Pro đang ở chế độ chỉ đọc; mọi dữ liệu vẫn còn\./.test(document.getElementById('licence-notes').textContent) && document.getElementById('licence-plans').textContent.trim() === 'Gia hạn'`);
  await js(`document.querySelector('main').scrollTop = 0;`);
  await both('licence-expired-vi');

  await tab('auto');
  await js(`document.querySelector('.profile-chip[data-profile-id="pcaches01"]').click();`);
  await until(`!document.getElementById('auto-licence').hidden`, 10000, 'the licence line on Automatic');
  await need('Automatic says why this profile only reports (§7.1)', `/Pro đã hết hạn.*Hồ sơ này cần nhiều hơn một hồ sơ, nên nó chỉ báo cáo/.test(document.getElementById('auto-licence-text').textContent) && document.getElementById('auto-state').textContent.trim() === 'Chỉ báo cáo: bản quyền' && document.getElementById('auto-licence-plans').textContent.trim() === 'Gia hạn'`);
  await both('auto-expired-vi');
  await js(`document.querySelector('.profile-chip[data-profile-id="main"]').click();`);
  await wait(500);
  await need('the first profile carries no such line', `document.getElementById('auto-licence').hidden`);

  // The Changes card: two scans of the fixture, both taken after the licence ended.
  await js(`await setFolder(${JSON.stringify(path.join(FIXTURE, 'Temp'))});`);
  for (let k = 0; k < 2; k += 1) {
    await js(`document.getElementById('run-scan').click();`);
    await until(`document.getElementById('scan-stats').hidden === false && !document.getElementById('run-scan').disabled`, 60000, 'a scan');
    await wait(1200);
  }
  await tab('trends');
  await js(`await window.Changes.load(); await window.Changes.open(${JSON.stringify(path.join(FIXTURE, 'Temp'))});`);
  await until(`/Pro đã hết hạn ngày .*, và thư mục này có ít hơn hai lần quét trước ngày đó/.test(document.getElementById('panel-trends').textContent)`, 10000, 'the Changes card refusing scans taken after expiry');
  await shoot('changes-expired-vi-light');

  // An update released after the licence ended, held back (§7.6).
  await tab('settings');
  await js(`applyUpdateState({ supported: true, enabled: true, checking: false, status: 'available', version: '0.7.0', progress: 0, error: null, checkedAt: Date.now(), currentVersion: '0.6.0', signed: false, justUpdated: null, managed: false, licenceHold: { expires: ${JSON.stringify(new Date(Date.now() - 10 * DAY).toISOString())} } });`);
  await need('the update card says why it was not fetched', `/phát hành sau ngày bản quyền Pro của bạn hết hạn/.test(document.getElementById('update-detail').textContent) && !document.getElementById('update-download').hidden && /Có bản 0\.7\.0/.test(document.getElementById('update-pill').textContent)`);
  await js(`document.getElementById('update-detail').scrollIntoView({ block: 'center' });`);
  await both('update-held-vi');
  await licence.deactivate();

  /* -- narrow, and English -------------------------------------------------------------------- */

  await tab('settings');
  for (const width of [720, 560]) {
    win.setSize(width, 900);
    await wait(600);
    await js(`document.querySelector('main').scrollTop = 0;`);
    await overflow(`${width} vi, the card`);
    await both(`licence-${width}-vi`);
    await js(`document.getElementById('licence-plans').click();`);
    await until(`document.getElementById('plans').open`, 3000, 'the dialog');
    await overflow(`${width} vi, the plans`);
    await both(`plans-${width}-vi`);
    await click('#plans-columns', 'Chọn Pro');
    await until(`!document.getElementById('plans-checkout').hidden`, 3000, 'checkout');
    await overflow(`${width} vi, checkout`);
    await shoot(`checkout-${width}-vi-light`);
    await js(`document.querySelector('#plans-checkout [data-legal="terms"]').click();`);
    await until(`document.getElementById('legal').open`, 3000, 'the Terms of use');
    await shoot(`legal-${width}-vi-light`);
    await js(`document.getElementById('legal-close').click();`);
    await js(`document.getElementById('plans').close();`);
  }
  win.setSize(1180, 900);
  await wait(500);
  await language('en');
  await tab('settings');
  await until(`document.getElementById('licence-plans').textContent.trim() === 'See the plans'`, 5000, 'the English card');
  await shoot('licence-free-en-light');
  await js(`document.getElementById('licence-plans').click();`);
  await until(`document.getElementById('plans').open`, 3000, 'the dialog');
  await need('English prices', `/₫499,000 a year · 3 computers/.test(document.getElementById('plans-columns').textContent)`);
  await shoot('plans-choose-en-light');
  await js(`document.getElementById('plans').close(); document.querySelector('#licence-card [data-legal="refund"]').click();`);
  await until(`document.getElementById('legal').open && document.getElementById('legal-title').textContent === 'Refund policy'`, 3000, 'the English Refund policy');
  await need('in English, the window\'s language', `/not on sale yet/.test(document.getElementById('legal-body').textContent)`);
  await shoot('legal-refund-en-light');
  await js(`document.getElementById('legal-close').click();`);
  await js(`document.getElementById('plans').close();`);

  console.log(errors.length ? `\nrenderer errors: ${errors.slice(0, 4).join(' | ')}` : '\nno renderer errors');
  if (errors.length) app.exit(1);
  app.quit();
}).catch((err) => {
  console.error('\nFailed:', err && err.stack ? err.stack : err);
  app.exit(1);
});
