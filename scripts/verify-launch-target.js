#!/usr/bin/env node
'use strict';

// What happens when Explorer's right-click menu starts the app (I3).
//
//   node scripts/verify-launch-target.js
//
// The menu's command is `CleanDrive.exe --analyze="<folder>"` or
// `--duplicates-of="<file>"`. This starts the real app the same way -- main.js,
// the single-instance lock, the preload, the window -- with a throwaway
// user-data folder and suffixed task names, and reads the window back through
// Chromium's debugging port:
//
//   1. started with --analyze, it opens on Disk usage and scans that folder;
//   2. started again with --duplicates-of while it runs, the second copy
//      quits and the first one looks for copies of the file;
//   3. started again with a path that is not there, or not a folder, the
//      first copy is shown and asked for nothing.
//
// The copies search is pointed at this script's own folder through
// CLEANDRIVE_COPIES_SCOPE (honoured by a checkout only), not at the real Home.
// No registry is touched: that is verify-contextmenu.js.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const REPO = path.join(__dirname, '..');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');
const TASKKILL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
const PORT = 9300 + Math.floor(Math.random() * 90);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-launch-userdata-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-launch-fixture-'));

// Not a first launch (no introduction over the window), and nothing that would
// register a scheduled task: the daily measurement is off.
fs.writeFileSync(
  path.join(sandbox, 'settings.json'),
  JSON.stringify({ version: 6, trends: { dailySample: false, sampleTime: '12:00' }, monitor: { enabled: false } })
);

const scanMe = path.join(work, 'Scan me');
fs.mkdirSync(path.join(scanMe, 'inside'), { recursive: true });
fs.writeFileSync(path.join(scanMe, 'inside', 'a.bin'), Buffer.alloc(3 * 1024 * 1024, 1));
fs.writeFileSync(path.join(scanMe, 'b.log'), 'log\n');
const body = crypto.randomBytes(123457);
const report = path.join(work, 'Docs', 'report.pdf');
fs.mkdirSync(path.dirname(report), { recursive: true });
fs.writeFileSync(report, body);
fs.mkdirSync(path.join(work, 'Backup'));
fs.writeFileSync(path.join(work, 'Backup', 'report (1).pdf'), body);
fs.writeFileSync(path.join(work, 'Backup', 'same size, other bytes.pdf'), crypto.randomBytes(123457));

const env = { ...process.env, CLEANDRIVE_TASK_SUFFIX: 'launchtarget', CLEANDRIVE_COPIES_SCOPE: work };
delete env.ELECTRON_RUN_AS_NODE;

const children = [];
function start(extra) {
  const child = spawn(ELECTRON, [REPO, `--user-data-dir=${sandbox}`, ...extra], { env, stdio: 'ignore', windowsHide: false });
  children.push(child);
  return child;
}
const exited = (child, ms) =>
  new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

/** A connection to the window's page, over the debugging port. */
async function attach() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && /renderer[\\/]index\.html/.test(decodeURIComponent(t.url)));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        let id = 0;
        const pending = new Map();
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        };
        const evaluate = (expression) =>
          new Promise((resolve) => {
            const n = ++id;
            pending.set(n, (msg) => resolve(msg.result && msg.result.result ? msg.result.result.value : undefined));
            ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
          });
        return { ws, evaluate };
      }
    } catch {
      /* not up yet */
    }
    await wait(250);
  }
  throw new Error('the window never came up on the debugging port');
}

async function until(page, expression, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await page.evaluate(`Boolean(${expression})`)) return true;
    await wait(200);
  }
  return false;
}

(async () => {
  let page = null;
  try {
    console.log('\nIsolation:');
    check('a throwaway user-data folder, with the daily measurement off', fs.existsSync(path.join(sandbox, 'settings.json')), sandbox);
    check('suffixed task names, and copies looked for in this script’s folder', env.CLEANDRIVE_TASK_SUFFIX === 'launchtarget' && env.CLEANDRIVE_COPIES_SCOPE === work);

    console.log('\nStarted from “Analyse with CleanDrive”:');
    const first = start([`--remote-debugging-port=${PORT}`, `--analyze=${scanMe}`]);
    page = await attach();
    const scanned = await until(page, `document.getElementById('scan-stats') && document.getElementById('scan-stats').hidden === false`);
    const at = await page.evaluate(`({ folder: document.getElementById('target-path').title, tab: document.querySelector('.panel.is-active').id,
      files: document.getElementById('stat-files').textContent, intro: document.getElementById('intro').open })`);
    check('it opens on Disk usage with that folder', at.folder === scanMe && at.tab === 'panel-usage', JSON.stringify(at));
    check('and scans it', scanned && at.files === '2', `${at.files} files`);
    check('with no introduction over it (not a first launch)', at.intro === false);

    console.log('\nStarted again from “Find duplicates with CleanDrive”:');
    const second = start([`--duplicates-of=${report}`]);
    check('the second copy hands over and quits', await exited(second, 20000));
    const found = await until(page, `document.querySelector('.panel.is-active').id === 'panel-dupes' && document.getElementById('dupes-stats').hidden === false`);
    const dupes = await page.evaluate(`({ status: document.getElementById('dupes-status').textContent,
      rows: [...document.querySelectorAll('#dupe-groups .file-row')].map((r) => r.dataset.path),
      ticked: document.querySelectorAll('#dupe-groups input[type="checkbox"]:checked').length })`);
    check('the running copy looks for copies of the file', found && /report\.pdf: 1 other copy in /.test(dupes.status), dupes.status);
    check('and lists the file and its one copy, not the file of the same size with other bytes',
      dupes.rows.length === 2 && dupes.rows.some((p) => p.endsWith('report (1).pdf')) && !dupes.rows.some((p) => /other bytes/.test(p)), dupes.rows.map((p) => path.basename(p)).join(', '));
    check('ticking nothing', dupes.ticked === 0);

    console.log('\nStarted again with something that is not there:');
    for (const [label, arg] of [
      ['a folder that does not exist', `--analyze=${path.join(work, 'nowhere')}`],
      ['a file given as a folder', `--analyze=${report}`],
      ['a relative path', '--duplicates-of=Docs\\report.pdf'],
    ]) {
      const before = await page.evaluate(`document.getElementById('target-path').title + '|' + document.querySelector('.panel.is-active').id`);
      const child = start([arg]);
      const quit = await exited(child, 20000);
      await wait(1500);
      const after = await page.evaluate(`document.getElementById('target-path').title + '|' + document.querySelector('.panel.is-active').id`);
      check(`${label}: nothing is asked of the window`, quit && after === before, after);
    }

    page.ws.close();
    page = null;
    execFile(TASKKILL, ['/PID', String(first.pid), '/T', '/F'], () => {});
    await exited(first, 15000);
  } catch (err) {
    check('the run finished', false, err.stack || err.message);
  } finally {
    if (page) page.ws.close();
    for (const child of children) {
      if (child.exitCode === null) execFile(TASKKILL, ['/PID', String(child.pid), '/T', '/F'], () => {});
    }
    await wait(3000);
    for (const dir of [sandbox, work]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        console.log(`    (left behind, still in use: ${dir})`);
      }
    }
  }
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
