'use strict';
// Where should a preview live?
//
// An in-app overlay is the nicer shape, but the renderer's CSP is
// `default-src 'none'` and navigation away from the bundled files is blocked,
// so it cannot reach a file on disk at all. Two ways out:
//
//   A. a window of its own, loading file:// directly -- no CSP change, but a
//      second window to manage and an inconsistent shape next to text previews
//   B. a custom protocol the main process serves, so the overlay can frame it,
//      and the CSP widens by exactly one scheme that only this app can answer
//
// B is only worth it if Chromium still uses its own PDF viewer for a custom
// scheme. That is the thing to find out.

const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

app.setName(require('../package.json').name);
process.env.CLEANDRIVE_TASK_SUFFIX = 'protoprobe';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Must be declared before `ready`, and `stream: true` is what lets a large PDF
// arrive without being buffered whole.
protocol.registerSchemesAsPrivileged([
  { scheme: 'cdfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

async function findPdf() {
  const queue = ['Downloads', 'Documents'].map((n) => path.join(os.homedir(), n)).filter((p) => fs.existsSync(p));
  let hops = 0;
  while (queue.length && hops++ < 3000) {
    const dir = queue.shift();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !e.name.startsWith('$')) queue.push(full); }
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf') && (await fsp.stat(full)).size > 20000) return full;
    }
  }
  return null;
}

app.whenReady().then(async () => {
  const pdf = await findPdf();
  console.log('pdf:', pdf ? path.basename(pdf) : 'none', '\n');
  if (!pdf) { app.quit(); return; }

  // Only ever serves paths this process put on the list. The renderer names a
  // key, never a path, so a compromised renderer cannot ask for anything the
  // main process did not already decide to allow.
  const allowed = new Map([['doc1', pdf]]);

  protocol.handle('cdfile', (request) => {
    const key = new URL(request.url).hostname;
    const target = allowed.get(key);
    if (!target) return new Response('not found', { status: 404 });
    return net.fetch(`file:///${target.replace(/\\/g, '/')}`, { bypassCustomProtocolHandlers: true });
  });

  const page = path.join(os.tmpdir(), 'cd-proto-probe.html');
  fs.writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; frame-src cdfile:; img-src cdfile: data:;">
<style>html,body{margin:0;height:100%;background:#111}iframe{border:0;width:100%;height:100%}</style>
</head><body><iframe src="cdfile://doc1/"></iframe></body></html>`);

  const win = new BrowserWindow({
    width: 900, height: 700, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true },
  });

  const problems = [];
  win.webContents.on('console-message', (...args) => {
    const level = typeof args[1] === 'object' ? args[1].level : args[1];
    const message = typeof args[1] === 'object' ? args[1].message : args[2];
    if (level === 3 || level === 'error') problems.push(message);
  });

  await win.loadFile(page);
  await wait(1800);

  const shot = await win.webContents.capturePage();
  const out = path.join(os.tmpdir(), 'cd-proto-probe.png');
  fs.writeFileSync(out, shot.toPNG());

  console.log('frames    :', win.webContents.mainFrame.frames.length);
  console.log('frame url :', win.webContents.mainFrame.frames.map((f) => f.url).join(', ') || '(none)');
  console.log('painted   :', shot.getSize(), '->', out);
  console.log('csp errors:', problems.length ? problems.slice(0, 3).join(' | ') : 'none');

  win.destroy();
  app.quit();
}).catch((e) => { console.error('FATAL', e); app.exit(1); });
