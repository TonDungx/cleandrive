#!/usr/bin/env node
'use strict';

// Drives the real language and appearance controls in a real window.
//
//   npx electron scripts/verify-appearance.js
//
// test-i18n.js checks that the dictionary and the source agree. This checks the
// half that only exists once there is a document: that switching language
// actually rewrites the screen, that switching back restores the English the
// markup was written in, and that the theme sweep runs and cleans up after
// itself.
//
// Like the other harnesses it runs against a throwaway userData directory and
// suffixed task names, so nothing it does can reach a real configuration.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.setName(require('../package.json').name);

process.env.CLEANDRIVE_TASK_SUFFIX = process.env.CLEANDRIVE_TASK_SUFFIX || 'appearance';
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-verify-appearance-'));
app.setPath('userData', SANDBOX);

const ipc = require('../src/main/ipc');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(win, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await win.webContents.executeJavaScript(expression);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${expression}`);
    await wait(150);
  }
}

app.whenReady().then(async () => {
  ipc.register();

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const rendererErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) rendererErrors.push(message);
  });

  try {
    // Seeded so the daily measurement does not register a task from a harness.
    fs.writeFileSync(
      path.join(SANDBOX, 'settings.json'),
      `${JSON.stringify({ version: 1, trends: { dailySample: false, sampleTime: '12:00' } }, null, 2)}\n`
    );

    console.log('\nverify: the window opens in English\n');

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), {
      query: { theme: 'system', lang: 'en' },
    });
    await until(win, `document.getElementById('auto-categories') !== null`);

    const english = await win.webContents.executeJavaScript(`({
      lang: document.documentElement.lang,
      pending: document.documentElement.hasAttribute('data-i18n-pending'),
      tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent.trim()),
      binNote: document.getElementById('auto-bin-note').textContent.trim().slice(0, 40),
      settingsTab: !!document.getElementById('panel-settings'),
      updatesMovedOut: !document.querySelector('#panel-auto #update-enabled'),
      updatesInSettings: !!document.querySelector('#panel-settings #update-enabled'),
    })`);

    check('the document is marked English', english.lang === 'en', english.lang);
    check('nothing is left hidden behind the translation guard', english.pending === false);
    check('there is a Settings tab', english.settingsTab === true);
    check('the tabs read in English', english.tabs.includes('Disk usage'), english.tabs.join(' | '));
    // The thing that was asked for: the version no longer lives in the schedule screen.
    check('the update controls have left the Automatic tab', english.updatesMovedOut === true);
    check('and are in Settings instead', english.updatesInSettings === true);

    console.log('\nverify: switching to Vietnamese\n');

    const vietnamese = await win.webContents.executeJavaScript(`
      (async () => {
        const reply = await window.cleandrive.setLanguage('vi');
        if (!reply.ok) return { ok: false, error: reply.error };
        window.CleanDriveI18n.setLanguage(reply.data.language);
        window.CleanDriveI18n.translateDom(document);
        document.documentElement.setAttribute('lang', reply.data.language);
        return {
          ok: true,
          resolved: reply.data.language,
          preference: reply.data.preference,
          lang: document.documentElement.lang,
          tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent.trim()),
          binNote: document.getElementById('auto-bin-note').textContent.trim(),
          scheduleTitle: document.querySelector('#panel-auto h2').textContent.trim(),
          themeHint: document.querySelector('[data-theme-choice="light"]').title,
        };
      })()
    `);

    check('the language change is accepted', vietnamese.ok === true, vietnamese.error || '');
    check('and resolves to Vietnamese', vietnamese.resolved === 'vi', String(vietnamese.resolved));
    check('the document is re-marked', vietnamese.lang === 'vi', vietnamese.lang);
    check('the tabs are translated', vietnamese.tabs.includes('Dung lượng đĩa'), vietnamese.tabs.join(' | '));
    check('so are the headings', vietnamese.scheduleTitle === 'Lịch chạy', vietnamese.scheduleTitle);
    // Attributes, not just text: a tooltip left in English is a corner nobody
    // looks at until they hover over it.
    check('and the tooltips', vietnamese.themeHint === 'Luôn sáng', vietnamese.themeHint);
    check('the Recycle Bin caveat keeps its point in Vietnamese',
      /không giải phóng/.test(vietnamese.binNote), vietnamese.binNote.slice(0, 50) + '…');

    const onDisk = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'settings.json'), 'utf8'));
    check('the choice reached the settings file', onDisk.appearance.language === 'vi',
      JSON.stringify(onDisk.appearance));

    console.log('\nverify: and back to English\n');

    const back = await win.webContents.executeJavaScript(`
      (async () => {
        const reply = await window.cleandrive.setLanguage('en');
        window.CleanDriveI18n.setLanguage(reply.data.language);
        window.CleanDriveI18n.translateDom(document);
        return {
          tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent.trim()),
          scheduleTitle: document.querySelector('#panel-auto h2').textContent.trim(),
          themeHint: document.querySelector('[data-theme-choice="light"]').title,
        };
      })()
    `);

    // The English is the markup's own text, which the translation overwrote --
    // restoring it is what the WeakMap of originals is for. Without it, going
    // back would leave the Vietnamese on screen.
    check('the English text comes back', back.scheduleTitle === 'Schedule', back.scheduleTitle);
    check('including the tabs', back.tabs.includes('Disk usage'), back.tabs.join(' | '));
    check('and the tooltips', back.themeHint === 'Always light', back.themeHint);

    console.log('\nverify: the theme sweep\n');

    /*
     * Read synchronously, in the same tick as the click.
     *
     * The first version waited two animation frames and then looked, which
     * failed against a window that is not on screen: `requestAnimationFrame` is
     * throttled to roughly a frame a second there, so by the time it ran the
     * sweep had already finished and cleaned up. `sweep()` sets the attribute
     * before it starts the transition, so there is nothing to wait for.
     */
    const sweep = await win.webContents.executeJavaScript(`
      (async () => {
        const api = typeof document.startViewTransition === 'function';
        const before = document.documentElement.getAttribute('data-theme');

        document.querySelector('[data-theme-choice="dark"]').click();

        const during = {
          sweeping: document.documentElement.hasAttribute('data-theme-sweeping'),
          x: document.documentElement.style.getPropertyValue('--theme-x'),
          y: document.documentElement.style.getPropertyValue('--theme-y'),
          r: document.documentElement.style.getPropertyValue('--theme-r'),
          index: document.getElementById('theme-switch').style.getPropertyValue('--switch-index'),
        };

        // Long enough for the transition callback to have run and the sweep to
        // have cleaned itself up, on a window that may not be painting at all.
        await new Promise((r) => setTimeout(r, 1500));

        return {
          api,
          before,
          during,
          after: {
            sweeping: document.documentElement.hasAttribute('data-theme-sweeping'),
            theme: document.documentElement.getAttribute('data-theme'),
          },
        };
      })()
    `);

    check('the View Transition API is available in this Electron', sweep.api === true);
    check('the window started in the system theme', sweep.before === null, String(sweep.before));
    check('the sweep starts as soon as the button is pressed', sweep.during.sweeping === true);
    // Measured from the button, not assumed: a fixed radius leaves a corner
    // unswept on a wide window.
    check('it grows from the button that was pressed',
      /px$/.test(sweep.during.x) && /px$/.test(sweep.during.y) && parseFloat(sweep.during.r) > 100,
      `x=${sweep.during.x} y=${sweep.during.y} r=${sweep.during.r}`);
    check('the sliding indicator moves to the chosen option',
      sweep.during.index === '2', `--switch-index: ${sweep.during.index}`);
    check('and the sweep cleans up after itself', sweep.after.sweeping === false);
    check('leaving the new theme in place', sweep.after.theme === 'dark', String(sweep.after.theme));

    const bothSwitches = await win.webContents.executeJavaScript(`({
      topBar: document.querySelector('#theme-switch [data-theme-choice="dark"]').classList.contains('is-active'),
      settings: document.querySelector('#theme-switch-settings [data-theme-choice="dark"]').classList.contains('is-active'),
    })`);
    check('both copies of the appearance control agree',
      bothSwitches.topBar === true && bothSwitches.settings === true,
      JSON.stringify(bothSwitches));

    console.log('\nverify: console\n');
    check('no renderer errors', rendererErrors.length === 0, rendererErrors.join(' | '));
  } catch (err) {
    failures++;
    console.error('\nVERIFY THREW:', err);
  } finally {
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch {
      console.log(`    (left behind, still in use: ${SANDBOX})`);
    }
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  app.exit(failures === 0 ? 0 : 1);
});
