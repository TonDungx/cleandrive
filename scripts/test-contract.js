#!/usr/bin/env node
'use strict';

// The analyzer contract, its registry, and the four screens' analyzers.
//   node scripts/test-contract.js
//
// The claim under test is the one in contract.js: nothing reaches a screen
// with a verdict and no evidence. So most of this file is candidates that
// should be refused, and the rest is the real analyzers run in strict mode --
// where a single invalid candidate throws -- over fixtures.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  validateCandidate,
  candidateId,
  CONFIDENCE,
  VERDICTS,
} = require('../src/main/analyzers/contract');
const categories = require('../src/main/analyzers/categories');
const registry = require('../src/main/analyzers');
const { confidenceFor } = require('../src/main/analyzers/scan');
const { ALLOWED, isAllowedUnattended } = require('../src/main/automatic/allowed-categories');
const { SAFE_CATEGORIES } = require('../src/main/lib/settings');
const { CATEGORIES } = require('../src/main/lib/advisor');
const { CancelToken } = require('../src/main/lib/util');
const { message: m, render } = require('../src/i18n');

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

function refuses(label, candidate, pattern) {
  let error = null;
  try {
    validateCandidate(candidate);
  } catch (err) {
    error = err;
  }
  check(label, error !== null && (!pattern || pattern.test(error.message)), error ? error.message : 'accepted');
}

const ABS = path.resolve(os.tmpdir(), 'x.bin');

function good(over = {}) {
  return {
    id: candidateId('test', ABS),
    path: ABS,
    kind: 'file',
    bytes: 10,
    category: 'cleanup.temp',
    verdict: 'safe',
    confidence: 'strong',
    evidence: [{ rank: 1, ...m('reason.dir.temp', 'Inside a temporary folder') }],
    actions: ['recycle'],
    unattendedEligible: true,
    ...over,
  };
}

async function make(file, { bytes = 64, ageDays = 0, content = 'x' } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  if (bytes > content.length) {
    const handle = await fsp.open(file, 'r+');
    await handle.truncate(bytes);
    await handle.close();
  }
  if (ageDays > 0) {
    const when = new Date(Date.now() - ageDays * DAY);
    await fsp.utimes(file, when, when);
  }
}

(async () => {
  console.log('\ncontract: what a candidate must carry\n');

  {
    let ok = true;
    try {
      validateCandidate(good());
    } catch (err) {
      ok = false;
      console.log(err.message);
    }
    check('a complete candidate is accepted', ok);
  }

  refuses('a verdict with no evidence at all', good({ evidence: undefined }), /no evidence/);
  refuses('a verdict with an empty evidence list', good({ evidence: [] }), /no evidence/);
  refuses('a verdict with no confidence', good({ confidence: undefined }), /confidence/);
  refuses('a confidence that is not one of the four words', good({ confidence: 'high' }), /confidence/);
  refuses('a verdict that is not one of the four', good({ verdict: 'delete' }), /verdict/);
  refuses('a category nobody declared', good({ category: 'cleanup.everything' }), /not declared/);
  refuses('evidence with no rank', good({ evidence: [m('reason.dir.temp', 'Inside a temporary folder')] }), /rank/);
  refuses('evidence ranked zero', good({ evidence: [{ rank: 0, ...m('a', 'b') }] }), /rank/);
  refuses('evidence with no English beside its key', good({ evidence: [{ rank: 1, i18n: 'reason.dir.temp' }] }), /English/);
  refuses('a size that is not a size', good({ bytes: NaN }), /bytes/);
  refuses('a negative size', good({ bytes: -1 }), /bytes/);
  refuses('a relative path', good({ path: 'x.bin' }), /absolute/);
  refuses('an action that is not an ActionKind', good({ actions: ['shred'] }), /ActionKind/);
  refuses('no id', good({ id: '' }), /id/);

  console.log('\ncontract: the unattended rule, checked where it is made\n');

  refuses('unattended on a review verdict',
    good({ verdict: 'review', category: 'cleanup.installer' }), /unattended/);
  refuses('unattended on a safe verdict outside the whitelist',
    good({ category: 'usage.file' }), /unattended/);
  refuses('unattended on a photograph, whatever its verdict says',
    good({ category: 'media.image' }), /unattended/);
  refuses('unattendedEligible left unset', good({ unattendedEligible: undefined }), /boolean/);

  check('the whitelist is six advisor categories, all of them safe',
    ALLOWED.length === 6 && ALLOWED.every((c) => CATEGORIES[categories.advisorName(c)].verdict === 'safe'),
    ALLOWED.join(', '));
  check('no review category is on it',
    Object.entries(CATEGORIES).filter(([, v]) => v.verdict === 'review')
      .every(([k]) => !isAllowedUnattended(`cleanup.${k}`)));
  check('the settings file allows exactly the whitelist',
    JSON.stringify(SAFE_CATEGORIES) === JSON.stringify(ALLOWED.map((c) => categories.advisorName(c))),
    SAFE_CATEGORIES.join(', '));

  console.log('\ncontract: ids\n');

  check('the same file gets the same id on the next scan',
    candidateId('scan', 'C:\\Users\\a\\x.iso') === candidateId('scan', 'C:\\Users\\a\\x.iso'));
  if (process.platform === 'win32') {
    check('and the same id however its case is written',
      candidateId('scan', 'C:\\Users\\A\\X.iso') === candidateId('scan', 'c:\\users\\a\\x.iso'));
  }
  check('the same file under two analyzers is two decisions',
    candidateId('scan', ABS) !== candidateId('duplicates', ABS));
  check('the vocabulary is the four words the README promises',
    JSON.stringify(CONFIDENCE) === '["certain","strong","likely","guess"]' &&
      JSON.stringify(VERDICTS) === '["safe","review","protected","keep"]');

  console.log('\nregistry: registering\n');

  {
    let threw = null;
    try {
      registry.register({ ...registry.get('scan') });
    } catch (err) {
      threw = err;
    }
    check('a second analyzer with the same id is refused', threw && /duplicate/.test(threw.message));

    threw = null;
    try {
      registry.register({ id: 'x-undeclared', feature: 'free', categories: ['made.up'], run: async function* () {} });
    } catch (err) {
      threw = err;
    }
    check('an analyzer that declares an unknown category is refused', threw && /not declared/.test(threw.message));
    check('and is not left half-registered', registry.get('x-undeclared') === null);

    check('the four screens are served by three analyzers',
      ['scan', 'duplicates', 'media'].every((id) => registry.get(id)),
      registry.list().map((a) => a.id).join(', '));
  }

  console.log('\nregistry: running\n');

  registry.register({
    id: 'x-fixture',
    feature: 'pro.test',
    categories: ['cleanup.temp', 'usage.file'],
    async *run(ctx, token) {
      for (let i = 0; i < ctx.n; i++) {
        if (token.cancelled) break;
        if (ctx.cancelAt === i) token.cancel();
        yield { type: 'progress', done: i };
        const c = good({
          id: candidateId('x-fixture', path.join(os.tmpdir(), `f${i}`)),
          path: path.join(os.tmpdir(), `f${i}`),
        });
        if (ctx.badAt === i) delete c.confidence;
        if (ctx.foreignAt === i) {
          c.category = 'dupes.copy';
          c.verdict = 'review';
          c.unattendedEligible = false;
        }
        yield { type: 'candidate', candidate: c };
      }
      yield { type: 'summary', summary: { produced: ctx.n } };
    },
  });

  {
    const locked = await registry.collect('x-fixture', { n: 3 }, { can: (f) => f !== 'pro.test' });
    check('a feature the licence does not include yields "locked", not results',
      locked.locked === 'pro.test' && locked.candidates.length === 0);

    const dropped = await registry.collect('x-fixture', { n: 5, badAt: 2 });
    check('an invalid candidate is dropped, not drawn',
      dropped.candidates.length === 4 && dropped.summary.rejected === 1,
      `${dropped.candidates.length} kept, ${dropped.summary.rejected} rejected`);

    const foreign = await registry.collect('x-fixture', { n: 3, foreignAt: 1 });
    check('a category the analyzer did not declare is dropped too',
      foreign.candidates.length === 2 && foreign.summary.rejected === 1);

    let threw = null;
    try {
      await registry.collect('x-fixture', { n: 5, badAt: 2 }, { strict: true });
    } catch (err) {
      threw = err;
    }
    check('strict mode names the invalid candidate instead', threw && /confidence/.test(threw.message),
      threw ? threw.message : '');

    const token = new CancelToken();
    const stopped = await registry.collect('x-fixture', { n: 10, cancelAt: 3 }, { token });
    check('a stopped run returns what it had, not nothing',
      stopped.candidates.length === 4 && stopped.summary.cancelled === true,
      `${stopped.candidates.length} candidates, cancelled=${stopped.summary.cancelled}`);

    let progress = 0;
    await registry.collect('x-fixture', { n: 4 }, { onProgress: () => progress++ });
    check('progress is passed through as it happens', progress === 4, String(progress));

    registry.unregister('x-fixture');
  }

  console.log('\nanalyzer "scan": Disk usage and What to delete\n');

  const dir = path.join(os.tmpdir(), 'cleandrive-contract-fixture');
  await fsp.rm(dir, { recursive: true, force: true });
  await make(path.join(dir, 'Temp', 'leftover.dat'), { bytes: 5 * MB });
  await make(path.join(dir, 'old.bak'), { bytes: 2 * MB });
  await make(path.join(dir, 'AppLike', 'Cache', 'blob.bin'), { bytes: 7 * MB });
  await make(path.join(dir, 'logs', 'old.log'), { bytes: 2 * MB, ageDays: 40 });
  await make(path.join(dir, 'project', 'package.json'), { content: '{}' });
  await make(path.join(dir, 'project', 'obj', 'compiled.o'), { bytes: 4 * MB });
  await make(path.join(dir, 'Downloads', 'setup.exe'), { bytes: 30 * MB, ageDays: 90 });
  await make(path.join(dir, 'movie.mkv'), { bytes: 300 * MB });
  await make(path.join(dir, 'notes.txt'), { bytes: 1024 });

  {
    const { candidates, summary } = await registry.collect('scan', { root: dir }, { strict: true });
    const byPath = new Map(candidates.map((c) => [path.relative(dir, c.path), c]));

    check('strict mode: every file the scan acts on is a valid candidate', candidates.length > 0,
      `${candidates.length} candidates`);
    check('each file is one candidate, even when it is in both lists',
      new Set(candidates.map((c) => c.id)).size === candidates.length);

    const allIds = new Set(candidates.map((c) => c.id));
    const groupIds = summary.cleanup.groups.flatMap((g) => g.ids);
    check('every cleanup row names a candidate that was sent', groupIds.every((id) => allIds.has(id)));
    check('every largest-file row names a candidate that was sent', summary.largest.every((id) => allIds.has(id)));
    check('the summary carries no file lists of its own',
      summary.largestFiles === undefined && summary.cleanup.groups.every((g) => g.files === undefined));

    const temp = byPath.get(path.join('Temp', 'leftover.dat'));
    check('a file in Temp is safe, strong evidence, and may run unattended',
      temp && temp.verdict === 'safe' && temp.confidence === 'strong' && temp.unattendedEligible === true,
      temp && `${temp.verdict}/${temp.confidence}/${temp.unattendedEligible}`);

    const bak = byPath.get('old.bak');
    check('a .bak is only "likely" -- it can be somebody’s only backup',
      bak && bak.verdict === 'safe' && bak.confidence === 'likely', bak && bak.confidence);

    const cache = byPath.get(path.join('AppLike', 'Cache', 'blob.bin'));
    check('a folder merely called Cache is only "likely"', cache && cache.confidence === 'likely', cache && cache.confidence);

    const build = byPath.get(path.join('project', 'obj', 'compiled.o'));
    check('build output is eligible for the whitelist, and only "likely"',
      build && build.unattendedEligible === true && build.confidence === 'likely');

    const installer = byPath.get(path.join('Downloads', 'setup.exe'));
    check('an old installer is review and never unattended',
      installer && installer.verdict === 'review' && installer.unattendedEligible === false,
      installer && `${installer.verdict}/${installer.unattendedEligible}`);

    const movie = byPath.get('movie.mkv');
    check('a large file no rule matched is "keep", and says why',
      movie && movie.verdict === 'keep' && movie.category === 'usage.file' &&
        render(movie.evidence[0]).includes('No cleanup rule matched'),
      movie && `${movie.verdict} ${render(movie.evidence[0])}`);

    check('no cleanup verdict claims to be certain',
      candidates.filter((c) => c.category.startsWith('cleanup.')).every((c) => c.confidence !== 'certain'));

    check('what is safe and what is review are still separate totals',
      summary.cleanup.safeBytes > 0 && summary.cleanup.reviewBytes > 0,
      `${summary.cleanup.safeBytes} / ${summary.cleanup.reviewBytes}`);
  }

  check('"untouched" is only a guess where Windows does not record opening a file',
    confidenceFor('stale', 'size', ABS, { tracked: false }) === 'guess' &&
      confidenceFor('stale', 'size', ABS, { tracked: null }) === 'guess' &&
      confidenceFor('stale', 'size', ABS, { tracked: true }) === 'strong');

  console.log('\nanalyzer "duplicates"\n');

  const dupes = path.join(os.tmpdir(), 'cleandrive-contract-dupes');
  await fsp.rm(dupes, { recursive: true, force: true });
  const body = 'same bytes '.repeat(400);
  await make(path.join(dupes, 'a', 'report.pdf'), { content: body, ageDays: 30 });
  await make(path.join(dupes, 'b', 'report.pdf'), { content: body, ageDays: 10 });
  await make(path.join(dupes, 'c', 'report copy.pdf'), { content: body, ageDays: 5 });
  await make(path.join(dupes, 'env', 'site-packages', 'lib.py'), { content: body, ageDays: 2 });

  {
    const { candidates, summary } = await registry.collect(
      'duplicates',
      { roots: [dupes], options: { minSize: 1, useCache: false } },
      { strict: true }
    );
    const byName = (rel) => candidates.find((c) => path.relative(dupes, c.path) === rel);

    check('one group of four copies', summary.groups.length === 1 && summary.groups[0].ids.length === 4,
      `${summary.groups.length} group(s)`);

    const oldest = byName(path.join('a', 'report.pdf'));
    check('the oldest copy is kept, and the reason it leads with is that it is the oldest',
      oldest && oldest.verdict === 'keep' && oldest.evidence[0].i18n === 'evidence.dupes.oldest');

    const copy = byName(path.join('b', 'report.pdf'));
    check('another copy is review, and certain -- the hashes were compared',
      copy && copy.verdict === 'review' && copy.confidence === 'certain' &&
        copy.evidence[0].i18n === 'evidence.dupes.identical.other',
      copy && `${copy.verdict}/${copy.confidence}`);

    const component = byName(path.join('env', 'site-packages', 'lib.py'));
    check('a copy inside site-packages is kept, and leads with why',
      component && component.verdict === 'keep' && component.evidence[0].i18n === 'reason.dependency' &&
        component.meta.component === true);

    check('no copy is ever safe', candidates.every((c) => c.verdict !== 'safe'));
    check('no copy may run unattended', candidates.every((c) => c.unattendedEligible === false));
  }

  console.log('\nanalyzer "media": Photos & video\n');

  {
    const P = (name) => path.join(os.tmpdir(), 'pics', name);
    const records = [
      { path: P('IMG_0001.jpg'), name: 'IMG_0001.jpg', ext: 'jpg', size: 3 * MB, kind: 'image', camera: 'Pixel 7', hasExif: true, takenAt: Date.UTC(2021, 5, 1), mtimeMs: Date.now() },
      { path: P('Screenshot 2024-01-01.png'), name: 'Screenshot 2024-01-01.png', ext: 'png', size: MB, kind: 'image', mtimeMs: Date.now(), width: 1920, height: 1080 },
      { path: P('clip.mp4'), name: 'clip.mp4', ext: 'mp4', size: 40 * MB, kind: 'video', mtimeMs: Date.now() },
      { path: P('icons', 'a.png'), name: 'a.png', ext: 'png', size: 400, kind: 'image', mtimeMs: Date.now() },
    ];
    const fakeScan = async (roots, options, handlers) => {
      // Two in a batch, one never batched, one batched and then hidden.
      handlers.onBatch([records[0], records[3]]);
      handlers.onBatch([records[1]]);
      return { files: [records[0], records[1], records[2]], hidden: 1, excluded: [], stats: {}, totalBytes: 0 };
    };

    const { candidates, summary } = await registry.collect(
      'media',
      { roots: [P('')], context: { displays: [{ width: 1920, height: 1080 }] }, deps: { scanMedia: fakeScan } },
      { strict: true }
    );
    const visible = summary.visibleIds.map((id) => candidates.find((c) => c.id === id));

    check('every file is a candidate, including one no batch carried', candidates.length === 4, String(candidates.length));
    check('the final set leaves out what was hidden', visible.length === 3 && visible.every(Boolean));
    check('every photograph is keep -- this screen suggests nothing', candidates.every((c) => c.verdict === 'keep'));
    check('none may run unattended', candidates.every((c) => c.unattendedEligible === false));
    check('a camera photo is "certain", from the camera’s own name',
      visible[0].confidence === 'certain' && visible[0].evidence[0].rank === 1 &&
        render(visible[0].evidence[0]).includes('Pixel 7'));
    check('video is filed as video', visible[2].category === 'media.video');
    check('the evidence keeps the classifier’s order as its rank',
      visible.every((c) => c.evidence.every((e, i) => e.rank === i + 1)));
  }

  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rm(dupes, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
