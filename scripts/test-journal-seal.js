#!/usr/bin/env node
'use strict';

// The sealed journal (H4), mostly from the attacker's side.
//   node scripts/test-journal-seal.js
//
// Most of this runs on a stand-in for DPAPI, so it says nothing about Windows
// and runs anywhere. One block at the end goes through the real thing --
// PowerShell, the user's scope, no administrator -- because that is the part
// a stand-in cannot vouch for.
//
// Two checks here pass on purpose where an attack succeeds: the newest
// session removed whole, and a session rewritten by somebody holding the key.
// Those are the limits the README states, and a harness that only proved the
// seal catches things would let the documentation drift into promising more.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { ActionJournal } = require('../src/main/journal/journal');
const { Sealer, verifyJournal, hashLine, canonical } = require('../src/main/journal/seal');
const { SealKey, fingerprintOf } = require('../src/main/journal/seal-key');
const { TrashLedger } = require('../src/main/lib/ledger');

const MONTH = 31 * 24 * 60 * 60 * 1000;

/** XOR behind a tag: enough to tell "protected" from "in the clear", nothing more. */
function fakeDpapi({ refuse = false, fail = false } = {}) {
  const tag = Buffer.from('FAKEDPAPI:');
  const xor = (bytes) => Buffer.from(Uint8Array.from(bytes, (b) => b ^ 0x5a));
  const error = (op, refused) => Object.assign(new Error(`DPAPI ${op}: ${refused ? 'the blob was refused' : 'powershell exited 1'}`), { code: 'EDPAPI', refused });
  return {
    SCOPE: 'CurrentUser',
    calls: 0,
    async protect(data) {
      this.calls += 1;
      if (fail) throw error('protect', false);
      return Buffer.concat([tag, xor(data)]);
    },
    async unprotect(blob) {
      this.calls += 1;
      if (fail) throw error('unprotect', false);
      if (refuse || !blob.subarray(0, tag.length).equals(tag)) throw error('unprotect', true);
      return xor(blob.subarray(tag.length));
    },
  };
}

function sealed(dir, { dpapi = fakeDpapi(), now, keyFile = path.join(dir, '..', `${path.basename(dir)}-key.json`) } = {}) {
  const key = new SealKey(keyFile, { dpapi, now });
  const sealer = new Sealer({ key, lockFile: path.join(dir, '.seal.lock') });
  return { journal: new ActionJournal(dir, { sealer, ...(now ? { now } : {}) }), key, keyFile, dpapi };
}

async function session(journal, n, tag = 'a') {
  const s = await journal.begin('recycle', { count: n, bytes: n * 10 }, { source: 'manual' });
  for (let i = 0; i < n; i++) await journal.record(s, { path: `C:\\fixture\\${tag}\\${i}.bin`, size: 10 * (i + 1), trashedAt: Date.now() });
  await journal.end(s, { done: n, movedBytes: n * 10 });
  return s;
}

async function check_(dir, key) {
  return verifyJournal(await new ActionJournal(dir).readRaw(), await key.publicKeys());
}

const onlyFile = (dir) => {
  const names = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n));
  if (names.length !== 1) throw new Error(`expected one month file in ${dir}, found ${names.join(', ')}`);
  return path.join(dir, names[0]);
};

/** Edit a journal file as a person with a text editor would: line by line. */
function editLines(file, fn) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const trailing = lines[lines.length - 1] === '' ? lines.pop() : null;
  fn(lines);
  fs.writeFileSync(file, lines.join('\n') + (trailing === '' ? '\n' : ''), 'utf8');
}

const problemsOf = (report, id) => (report.sessions[id] ? report.sessions[id].problems : []);
const describe = (problems) => problems.map((p) => `${p.what}@${p.line}`).join(', ') || 'none';

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/* ---- a child that seals sessions while another does the same --------------- */

async function child([dir, keyFile, tag, count]) {
  const key = new SealKey(keyFile, { dpapi: fakeDpapi() });
  const journal = new ActionJournal(dir, { sealer: new Sealer({ key, lockFile: path.join(dir, '.seal.lock') }) });
  for (let i = 0; i < Number(count); i++) await session(journal, 2, `${tag}${i}`);
}

function runChild(dir, keyFile, tag, count) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [__filename, '--child', dir, keyFile, tag, String(count)], { stdio: ['ignore', 'ignore', 'inherit'] });
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child ${tag} exited ${code}`))));
  });
}

/* ---- the harness ------------------------------------------------------------ */

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleandrive-seal-'));
  process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
  const dirOf = (name) => path.join(root, name);

  console.log('\nseal: a journal with no sealer is the journal it was\n');
  {
    const dir = dirOf('free');
    const journal = new ActionJournal(dir);
    await session(journal, 2);
    const lines = fs.readFileSync(onlyFile(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    check('no line carries `prev`, and there is no seal', lines.length === 4 && lines.every((l) => !('prev' in l)) && !lines.some((l) => l.op === 'seal'),
      lines.map((l) => l.op).join(' '));
    const report = verifyJournal(await journal.readRaw(), { keys: new Map() });
    check('and the check calls it unsealed, not altered', report.counts.legacy === 1 && report.counts.altered === 0);
  }

  console.log('\nseal: a sealed session\n');
  const base = dirOf('base');
  const ids = [];
  let baseKey;
  {
    const { journal, key, keyFile, dpapi } = sealed(base);
    baseKey = { key, keyFile };
    for (let i = 0; i < 3; i++) ids.push((await session(journal, 3, `s${i}`)).id);
    const text = fs.readFileSync(onlyFile(base), 'utf8');
    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    const first = lines.filter((l) => l.session === ids[0]);
    check('begin, three items, end, and a seal', first.map((l) => l.op).join(' ') === 'begin item item item end seal');
    const raws = text.split('\n').filter(Boolean).filter((r) => JSON.parse(r).session === ids[0]);
    check('the first line names no line before it, each other the one before', first[0].prev === null &&
      first.slice(1).every((l, i) => l.prev === hashLine(raws[i])));
    const seals = lines.filter((l) => l.op === 'seal');
    check('seals are numbered 1, 2, 3, each naming the one before', seals.map((s) => s.n).join() === '1,2,3' && seals[0].after === null &&
      seals[1].after === hashLine(text.split('\n').find((r) => r.includes('"n":1,'))));
    check('the seal counts the lines it covers', seals[0].lines === 5);
    check('one DPAPI call for three seals -- the key is opened once per process', dpapi.calls === 1, `${dpapi.calls} calls`);

    const keyText = fs.readFileSync(keyFile, 'utf8');
    const keyData = JSON.parse(keyText);
    const pkcs8 = (await key.signing()).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    check('the private key is not in the key file in the clear', !keyText.includes(pkcs8) && keyData.keys[0].protected.length > 0);
    check('the fingerprint is the public key’s', fingerprintOf(Buffer.from(keyData.keys[0].publicKey, 'base64')) === keyData.current);

    const report = await check_(base, key);
    check('the check finds all three sealed and nothing wrong', report.counts.sealed === 3 && report.counts.altered === 0 &&
      report.missing.length === 0 && report.unreadable.length === 0, JSON.stringify(report.counts));
    check('and reports where the numbering ends, for comparing with a copy kept elsewhere', report.seals.last === 3 && report.seals.count === 3);
  }

  /** A fresh copy of the sealed journal to attack. */
  let copies = 0;
  const attack = () => {
    const dir = dirOf(`attack-${++copies}`);
    fs.cpSync(base, dir, { recursive: true });
    return dir;
  };
  const lineOf = (file, predicate) => fs.readFileSync(file, 'utf8').split('\n').findIndex((raw) => raw && predicate(JSON.parse(raw), raw)) + 1;
  const isItem = (id, i) => (l) => l.session === id && l.op === 'item' && l.from.endsWith(`\\${i}.bin`);

  console.log('\nseal: from the attacker’s side\n');
  {
    const dir = attack();
    const file = onlyFile(dir);
    const at = lineOf(file, isItem(ids[1], 1));
    editLines(file, (lines) => {
      lines[at - 1] = lines[at - 1].replace('"bytes":20', '"bytes":2');
    });
    const report = await check_(dir, baseKey.key);
    const p = problemsOf(report, ids[1]);
    check('a number changed in one line: that session is altered, at that line', report.sessions[ids[1]].state === 'altered' &&
      p.length === 1 && p[0].what === 'modified' && p[0].line === at, describe(p));
    check('and the sessions either side are still sealed', report.sessions[ids[0]].state === 'sealed' && report.sessions[ids[2]].state === 'sealed');
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    const at = lineOf(file, isItem(ids[1], 1));
    editLines(file, (lines) => lines.splice(at - 1, 1));
    const report = await check_(dir, baseKey.key);
    const p = problemsOf(report, ids[1]);
    check('a line removed: reported as removed, before the line that followed it', p.length === 1 && p[0].what === 'deleted' && p[0].line === at, describe(p));
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    const at = lineOf(file, isItem(ids[1], 0));
    editLines(file, (lines) => {
      const forged = JSON.parse(lines[at - 1]);
      forged.from = 'C:\\fixture\\planted.bin';
      lines.splice(at, 0, JSON.stringify(forged));
    });
    const report = await check_(dir, baseKey.key);
    const p = problemsOf(report, ids[1]);
    check('a line added: reported as added, at that line', p.length === 1 && p[0].what === 'inserted' && p[0].line === at + 1, describe(p));
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    const at = lineOf(file, (l) => l.session === ids[1] && l.op === 'begin');
    editLines(file, (lines) => lines.splice(at - 1, 1));
    const report = await check_(dir, baseKey.key);
    check('the begin line removed: altered', report.sessions[ids[1]].state === 'altered', describe(problemsOf(report, ids[1])));
  }
  {
    // Recomputing every hash after the edit is easy -- sha256 is public. The
    // signature over the last of them is what cannot be redone.
    const dir = attack();
    const file = onlyFile(dir);
    editLines(file, (lines) => {
      const mine = lines.map((raw, i) => ({ raw, i, l: JSON.parse(raw) })).filter((x) => x.l.session === ids[1]);
      let prev = null;
      for (const x of mine) {
        if (x.l.op === 'item' && x.l.from.endsWith('\\1.bin')) x.l.bytes = 1;
        x.l.prev = prev;
        if (x.l.op === 'seal') {
          x.l.prev = prev;
          lines[x.i] = JSON.stringify(x.l);
          break;
        }
        lines[x.i] = JSON.stringify(x.l);
        prev = hashLine(lines[x.i]);
      }
    });
    const report = await check_(dir, baseKey.key);
    const p = problemsOf(report, ids[1]);
    check('an edit with every hash recomputed: the chain holds, the signature does not', p.length === 1 && p[0].what === 'signature', describe(p));
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    editLines(file, (lines) => {
      for (let i = lines.length - 1; i >= 0; i--) if (JSON.parse(lines[i]).session === ids[1]) lines.splice(i, 1);
    });
    const report = await check_(dir, baseKey.key);
    check('a whole session removed from the middle: its seal number is missing', report.missing.length === 1 &&
      report.missing[0].from === 2 && report.missing[0].to === 2 && report.counts.sealed === 2, JSON.stringify(report.missing));
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    editLines(file, (lines) => {
      for (let i = lines.length - 1; i >= 0; i--) if (JSON.parse(lines[i]).session === ids[2]) lines.splice(i, 1);
    });
    const report = await check_(dir, baseKey.key);
    check('THE LIMIT: the newest session removed whole is not detected -- nothing comes after it',
      report.counts.sealed === 2 && report.missing.length === 0 && report.counts.altered === 0);
  }
  {
    // The computer's own user can open the key the unattended run opens. This
    // is what they can do with it, and why the README says so.
    const dir = attack();
    const file = onlyFile(dir);
    const keyData = JSON.parse(fs.readFileSync(baseKey.keyFile, 'utf8'));
    const der = await fakeDpapi().unprotect(Buffer.from(keyData.keys[0].protected, 'base64'));
    const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    editLines(file, (lines) => {
      const mine = lines.map((raw, i) => ({ i, l: JSON.parse(raw) })).filter((x) => x.l.session === ids[2]);
      let prev = null;
      for (const x of mine) {
        if (x.l.op === 'item') x.l.from = x.l.from.replace('fixture', 'somewhere-else');
        x.l.prev = prev;
        if (x.l.op === 'seal') {
          delete x.l.sig;
          x.l.sig = crypto.sign(null, Buffer.from(canonical(x.l), 'utf8'), privateKey).toString('base64');
        }
        lines[x.i] = JSON.stringify(x.l);
        prev = hashLine(lines[x.i]);
      }
    });
    const report = await check_(dir, baseKey.key);
    check('THE LIMIT: somebody holding the key rewrites the newest session and signs it again -- the check passes',
      report.sessions[ids[2]].state === 'sealed' && report.counts.altered === 0);
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    const at = lineOf(file, (l) => l.op === 'seal' && l.n === 1);
    editLines(file, (lines) => {
      lines[at - 1] = JSON.stringify(JSON.parse(lines[at - 1]), null, 1).replace(/\n/g, '');
    });
    const report = await check_(dir, baseKey.key);
    const p = problemsOf(report, ids[0]);
    check('a seal line respaced -- it still signs the same -- is caught by the seal after it', p.some((x) => x.what === 'modified' && x.line === at), describe(p));
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    const report = await check_(dir, baseKey.key);
    check('the file saved with Windows line endings: every session reads as changed, because every line was',
      report.counts.altered === 3 && report.counts.sealed === 0, JSON.stringify(report.counts));
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    const at = lineOf(file, (l) => l.op === 'seal' && l.n === 2);
    editLines(file, (lines) => lines.splice(at, 0, lines[at - 1]));
    const report = await check_(dir, baseKey.key);
    check('a seal line repeated: the copy is an added line', problemsOf(report, ids[1]).some((p) => p.what === 'inserted' && p.line === at + 1),
      describe(problemsOf(report, ids[1])));
  }
  {
    const dir = attack();
    const file = onlyFile(dir);
    const forged = { v: 1, t: new Date().toISOString(), session: 's_deadbeef', op: 'seal', n: 1e9, prev: null, after: null, lines: 0, key: 'f'.repeat(64), sig: 'AAAA' };
    fs.appendFileSync(file, `${JSON.stringify(forged)}\n`);
    const started = Date.now();
    const report = await check_(dir, baseKey.key);
    const took = Date.now() - started;
    check('a forged seal numbered a billion: no gap of a billion, and the check stays quick',
      report.missing.length === 0 && report.seals.last === 3 && took < 2000, `${took} ms`);
    const { journal } = sealed(dir, { keyFile: baseKey.keyFile });
    const next = await session(journal, 1, 'after-forgery');
    const after = await check_(dir, baseKey.key);
    check('and the next real seal is numbered 4, after the last genuine one', after.sessions[next.id].n === 4 && after.sessions[next.id].state === 'sealed');
  }

  console.log('\nseal: the order of lines, and lines that are not lines\n');
  {
    const dir = dirOf('order');
    const { journal, key } = sealed(dir);
    const s = await journal.begin('recycle', { count: 3 });
    // Not awaited one by one: the journal must keep them in the order asked.
    const pending = [0, 1, 2].map((i) => journal.record(s, { path: `C:\\fixture\\order\\${i}.bin`, size: i }));
    await journal.end(s, { done: 3 });
    await Promise.all(pending);
    const items = fs.readFileSync(onlyFile(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.op === 'item');
    check('records asked for without waiting land in the order they were asked', items.map((l) => l.from.slice(-5)).join() === '0.bin,1.bin,2.bin');
    check('and the session seals', (await check_(dir, key)).sessions[s.id].state === 'sealed');

    editLines(onlyFile(dir), (lines) => {
      const [a, b] = [1, 2];
      [lines[a], lines[b]] = [lines[b], lines[a]];
    });
    check('two lines swapped in place: the same lines, still sealed -- order in the file is not part of the record',
      (await check_(dir, key)).sessions[s.id].state === 'sealed');
  }
  {
    const dir = dirOf('torn');
    const { journal, key } = sealed(dir);
    const done = await session(journal, 2, 'done');
    const s = await journal.begin('recycle', { count: 5 });
    await journal.record(s, { path: 'C:\\fixture\\torn\\0.bin', size: 1 });
    fs.appendFileSync(onlyFile(dir), '{"v":1,"t":"2026-10-01T02:00:00.000Z","session":"');
    const report = await check_(dir, key);
    check('a power cut mid-line: that session is unfinished, not altered', report.sessions[s.id].state === 'incomplete' && report.counts.altered === 0,
      JSON.stringify(report.counts));
    check('the torn line is counted as unreadable, and the finished session is still sealed',
      report.unreadable.length === 1 && report.sessions[done.id].state === 'sealed');
  }
  {
    const dir = dirOf('legacy');
    await session(new ActionJournal(dir), 2, 'before');
    const { journal, key } = sealed(dir);
    const after = await session(journal, 2, 'after');
    const report = await check_(dir, key);
    check('a session from before sealing began reads as such, beside a sealed one', report.counts.legacy === 1 && report.sessions[after.id].state === 'sealed' &&
      report.counts.altered === 0);
  }

  console.log('\nseal: the key\n');
  {
    const dir = dirOf('key-gone');
    const { journal, keyFile } = sealed(dir);
    const old = await session(journal, 1, 'old');
    fs.rmSync(keyFile);
    const fresh = sealed(dir, { keyFile });
    const later = await session(fresh.journal, 1, 'new');
    const report = await check_(dir, fresh.key);
    check('the key file deleted: a new key is made, and every seal from before names a key it does not know',
      report.sessions[old.id].state === 'altered' && problemsOf(report, old.id)[0].what === 'unknownKey' && report.sessions[later.id].state === 'sealed',
      describe(problemsOf(report, old.id)));
    check('and the new key numbers its seals from 1 again -- the old ones no longer count', report.sessions[later.id].n === 1);
  }
  {
    const dir = dirOf('key-garbled');
    const { journal, keyFile } = sealed(dir);
    await session(journal, 1);
    fs.writeFileSync(keyFile, '{ not json');
    const again = sealed(dir, { keyFile });
    await session(again.journal, 1, 'b');
    const aside = fs.readdirSync(path.dirname(keyFile)).filter((n) => n.startsWith(`${path.basename(keyFile)}.unreadable-`));
    check('a key file that is not JSON is moved aside, never overwritten', aside.length === 1 &&
      fs.readFileSync(path.join(path.dirname(keyFile), aside[0]), 'utf8') === '{ not json');
  }
  {
    const dir = dirOf('key-refused');
    const { journal, keyFile } = sealed(dir);
    const old = await session(journal, 1, 'old');
    // Refuses to open the old blob, and protects the new key as usual.
    const refused = sealed(dir, { keyFile, dpapi: fakeDpapi({ refuse: true }) });
    const later = await session(refused.journal, 1, 'new');
    const data = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    const report = await check_(dir, refused.key);
    check('a key DPAPI refuses to open is replaced, and the old one stays listed for checking',
      data.keys.length === 2 && Boolean(data.keys[0].retiredAt) && data.current === data.keys[1].fingerprint);
    check('so a session sealed before the replacement still checks', report.sessions[old.id].state === 'sealed' && report.sessions[later.id].state === 'sealed' &&
      report.sessions[later.id].n === 2);
  }
  {
    const dir = dirOf('key-blocked');
    const { journal, keyFile } = sealed(dir);
    await session(journal, 1, 'first');
    const before = fs.readFileSync(keyFile, 'utf8');
    const blocked = sealed(dir, { keyFile, dpapi: fakeDpapi({ fail: true }) });
    const s = await session(blocked.journal, 2, 'blocked');
    const report = await check_(dir, blocked.key);
    check('PowerShell that will not run: the key file is left exactly as it was', fs.readFileSync(keyFile, 'utf8') === before);
    check('the session is written whole and reads as unsealed, which is true', report.sessions[s.id].state === 'unsealed');
    const listed = (await blocked.journal.sessions()).find((x) => x.id === s.id);
    check('and the Restore Center lists it complete, with both its items', listed && listed.complete && listed.items.length === 2);
    check('and the journal says why, for whoever asks', Boolean(blocked.journal.sealError) && blocked.journal.sealError.code === 'EDPAPI');
  }

  console.log('\nseal: what every other reader sees\n');
  {
    const plain = dirOf('readers-plain');
    const withSeal = dirOf('readers-sealed');
    await session(new ActionJournal(plain), 3, 'x');
    const { journal } = sealed(withSeal);
    await session(journal, 3, 'x');
    const strip = (list) => list.map((s) => ({ kind: s.kind, count: s.count, items: s.items.length, complete: s.complete }));
    const a = strip(await new ActionJournal(plain).sessions());
    const b = strip(await new ActionJournal(withSeal).sessions());
    check('sessions() reads a sealed journal exactly as an unsealed one', JSON.stringify(a) === JSON.stringify(b), JSON.stringify(b));
    const ledger = new TrashLedger(path.join(withSeal, '..', 'l.json'), { journal: new ActionJournal(withSeal) });
    await ledger.load();
    const found = ledger.expired(0, Date.now() + 365 * 24 * 60 * 60 * 1000).length;
    check('and the ledger finds the same three recycled items', found === 3, String(found));
  }

  console.log('\nseal: retention\n');
  {
    const dir = dirOf('prune');
    let now = Date.UTC(2025, 0, 15);
    const clock = () => now;
    const { journal, key } = sealed(dir, { now: clock });
    for (let m = 0; m < 3; m++) {
      await session(journal, 1, `m${m}`);
      now += MONTH;
    }
    // January, February and March 2025 are all older than the thirteen months
    // that end in April 2026.
    now = Date.UTC(2026, 3, 15);
    const recent = await session(journal, 1, 'recent');
    await journal.prune();
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort();
    let report = await check_(dir, key);
    check('the three oldest months are removed by retention', names.length === 1 && names[0] === '2026-04.jsonl', names.join(', '));
    check('and the sealed record of it means no session reads as deleted', report.missing.length === 0 && report.oldestMissing === null &&
      report.sessions[recent.id].state === 'sealed', JSON.stringify({ missing: report.missing, oldest: report.oldestMissing }));
    const recordLines = fs.readFileSync(onlyFile(dir), 'utf8').split('\n').filter((raw) => raw.includes('"op":"prune"'));
    check('the record is in the journal, and is not a session the Restore Center lists', recordLines.length === 1 &&
      (await journal.sessions()).length === 1);

    // The same, done by hand: the months removed without the record.
    const dir2 = dirOf('prune-by-hand');
    now = Date.UTC(2025, 0, 15);
    const byHand = sealed(dir2, { now: clock, keyFile: path.join(root, 'prune-by-hand-key.json') });
    for (let m = 0; m < 3; m++) {
      await session(byHand.journal, 1, `m${m}`);
      now += MONTH;
    }
    now = Date.UTC(2026, 3, 15);
    await session(byHand.journal, 1, 'recent');
    for (const n of fs.readdirSync(dir2)) if (n.startsWith('2025-')) fs.rmSync(path.join(dir2, n));
    report = await check_(dir2, byHand.key);
    check('months removed by hand: the oldest seals are reported missing', report.oldestMissing && report.oldestMissing.count === 3,
      JSON.stringify(report.oldestMissing));

    // An unsigned prune record cannot excuse it.
    const forged = { v: 1, t: new Date(now).toISOString(), session: 's_00000000', op: 'prune', prev: null, removed: [{ file: '2025-01.jsonl', seals: [[1, 3]] }] };
    fs.appendFileSync(onlyFile(dir2), `${JSON.stringify(forged)}\n`);
    report = await check_(dir2, byHand.key);
    check('and a prune record without a seal excuses nothing', report.oldestMissing && report.oldestMissing.count === 3);
  }

  console.log('\nseal: two processes sealing at once\n');
  {
    const dir = dirOf('concurrent');
    const keyFile = path.join(root, 'concurrent-key.json');
    // The key is made before either starts, as it would be by the window long
    // before a scheduled run; making it is tested on its own above.
    const first = sealed(dir, { keyFile });
    await session(first.journal, 1, 'seed');
    const started = Date.now();
    await Promise.all([runChild(dir, keyFile, 'A', 15), runChild(dir, keyFile, 'B', 15)]);
    const took = Date.now() - started;
    const report = await check_(dir, first.key);
    check('31 sessions from three processes, all sealed', report.counts.sealed === 31 && report.counts.altered === 0, JSON.stringify(report.counts));
    check('numbered 1 to 31 with no number twice and none missing', report.seals.first === 1 && report.seals.last === 31 &&
      report.duplicates.length === 0 && report.missing.length === 0, `${took} ms for both children`);
  }

  console.log('\nseal: how long it takes, on a journal of a busy year\n');
  {
    const dir = dirOf('busy');
    const { journal, key } = sealed(dir);
    const items = Array.from({ length: 50 }, (_, i) => ({ path: `C:\\fixture\\busy\\${'x'.repeat(80)}-${i}.bin`, size: i, trashedAt: Date.now() }));
    let t = Date.now();
    for (let i = 0; i < 200; i++) await journal.appendSession('recycle', items, { source: 'scheduled' });
    const writing = Date.now() - t;
    const bytes = fs.statSync(onlyFile(dir)).size;
    t = Date.now();
    await session(journal, 1, 'one-more');
    const oneSeal = Date.now() - t;
    t = Date.now();
    const report = await check_(dir, key);
    const checking = Date.now() - t;
    check('201 sessions, 10,604 lines, all sealed', report.counts.sealed === 201 && report.lines === 200 * 53 + 4, `${report.lines} lines`);
    check('one more seal on top of it, and checking the lot, each under two seconds', oneSeal < 2000 && checking < 2000,
      `${(bytes / 1048576).toFixed(1)} MB; writing 200 sessions ${writing} ms, one more seal ${oneSeal} ms, checking ${checking} ms`);
  }

  console.log('\nseal: the real DPAPI, through PowerShell, as this user\n');
  if (process.platform !== 'win32') {
    console.log('  SKIP  not Windows');
  } else {
    const dir = dirOf('real');
    const keyFile = path.join(root, 'real-key.json');
    const key = new SealKey(keyFile);
    let t = Date.now();
    const made = await key.signing();
    const making = Date.now() - t;
    const next = new SealKey(keyFile);
    t = Date.now();
    const opened = await next.signing();
    const opening = Date.now() - t;
    check('a key made in one process opens in the next', made.fingerprint === opened.fingerprint, `making ${making} ms, opening ${opening} ms`);
    const pkcs8 = opened.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    check('and the key file never holds it in the clear', !fs.readFileSync(keyFile, 'utf8').includes(pkcs8));
    const journal = new ActionJournal(dir, { sealer: new Sealer({ key: next, lockFile: path.join(dir, '.seal.lock') }) });
    const s = await session(journal, 2, 'real');
    check('a session sealed with it checks', (await check_(dir, next)).sessions[s.id].state === 'sealed');
  }

  console.log('\njournal seal: a licence that changes while the app runs (Phase 6)\n');

  {
    // Business bought, then lapsing, with sessions open across both moments.
    // services.js hands the journal the new answer; a session keeps the one it
    // began with, so none is ever half chained.
    const dir = path.join(root, 'switch');
    fs.mkdirSync(dir, { recursive: true });
    const { journal, key } = sealed(dir);
    const sealer = journal.sealer;
    journal.useSealer(null);

    const before = await journal.begin('recycle', { count: 1 }, { source: 'manual' });
    await journal.record(before, { path: 'C:\\fixture\\switch\\0.bin', size: 10, trashedAt: Date.now() });
    journal.useSealer(sealer); // bought, mid-session
    await journal.end(before, { done: 1, movedBytes: 10 });
    const after = await session(journal, 2, 'switch-after');

    const open = await journal.begin('recycle', { count: 1 }, { source: 'manual' });
    journal.useSealer(null); // lapsed, mid-session
    await journal.end(open, { done: 0, movedBytes: 0 });
    const lapsed = await session(journal, 1, 'switch-lapsed');

    const report = await check_(dir, key);
    const stateOf = (s) => (report.sessions[s.id] ? report.sessions[s.id].state : 'absent');
    check('a session begun before the purchase stays unsealed, not half chained', stateOf(before) === 'legacy', stateOf(before));
    check('the first session after it is sealed', stateOf(after) === 'sealed', stateOf(after));
    check('a session begun before the licence lapsed is still sealed at its end', stateOf(open) === 'sealed', stateOf(open));
    check('and the next one is not', stateOf(lapsed) === 'legacy', stateOf(lapsed));
    check('nothing reads as altered', report.counts.altered === 0, JSON.stringify(report.counts));
  }

  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[2] === '--child') {
  child(process.argv.slice(3)).then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
} else {
  main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  });
}
