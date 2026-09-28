#!/usr/bin/env node
'use strict';

// The Space Planner's arithmetic (G1).
//
//   node scripts/test-planner.js
//
// `planner/plan.js` does no I/O, so all of it can be checked here against
// candidates built by hand -- in the same shape every analyzer really
// produces, and validated against the same contract, so a plan cannot be
// built from a candidate the app would have refused.
//
// The thing most worth checking is the one the spec got wrong: moving a file
// to the Recycle Bin frees nothing until the bin is emptied, so a plan that
// adds up file sizes is a plan that promises space it cannot deliver.

const path = require('node:path');

const { buildPlan, targetFor, occupies, STEPS, WHEN } = require('../src/main/planner/plan');
const { validateCandidate, evidence, ACTION_KINDS } = require('../src/main/analyzers/contract');
const { message: m } = require('../src/i18n');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const GB = 1024 ** 3;
const gb = (n) => `${(n / GB).toFixed(1)} GB`;

let serial = 0;
/** A candidate in the shape the analyzers produce, checked by their contract. */
function candidate({ category, verdict = 'safe', actions = ['recycle'], bytes = GB, bytesOnDisk, kind = 'file' }) {
  serial += 1;
  const c = {
    id: `t${serial}`,
    path: kind === 'virtual' ? 'C:\\hiberfil.sys' : `D:\\fixture\\file-${serial}.bin`,
    kind,
    bytes,
    category,
    verdict,
    confidence: 'strong',
    evidence: [evidence(1, m('planner.harness', 'built by the planner harness'))],
    actions,
    unattendedEligible: false,
  };
  if (bytesOnDisk !== undefined) c.bytesOnDisk = bytesOnDisk;
  validateCandidate(c);
  return c;
}

const VOLUME = { root: 'C:\\', totalBytes: 500 * GB, freeBytes: 20 * GB };

function main() {
  console.log('\nplanner: what the goal actually asks for\n');

  check('"30 GB more" is 30 GB',
    targetFor({ kind: 'bytes', bytes: 30 * GB }, VOLUME) === 30 * GB);
  check('"have 30 GB free" counts what is already free',
    targetFor({ kind: 'bytes', bytes: 30 * GB, aboveCurrent: false }, VOLUME) === 10 * GB,
    `${gb(targetFor({ kind: 'bytes', bytes: 30 * GB, aboveCurrent: false }, VOLUME))} of 30 asked, 20 already free`);
  // 500 GB total, 20 free -> 480 used. Under 80% means used <= 400.
  check('"under 80%" is the used space above that line',
    targetFor({ kind: 'percent', percent: 80 }, VOLUME) === 80 * GB,
    gb(targetFor({ kind: 'percent', percent: 80 }, VOLUME)));
  check('a volume already under the line asks for nothing',
    targetFor({ kind: 'percent', percent: 99 }, VOLUME) === 0);
  check('nonsense asks for nothing rather than throwing',
    targetFor({ kind: 'percent', percent: -5 }, VOLUME) === 0
      && targetFor({ kind: 'bytes', bytes: NaN }, VOLUME) === 0
      && targetFor(null, VOLUME) === 0);

  console.log('\nplanner: the bin frees nothing until it is emptied\n');

  {
    const plan = buildPlan({
      goal: { kind: 'bytes', bytes: 10 * GB },
      volume: VOLUME,
      candidates: [
        candidate({ category: 'cleanup.temp', bytes: 6 * GB }),
        candidate({ category: 'cleanup.cache', bytes: 4 * GB }),
      ],
    });
    const caches = plan.steps.find((s) => s.id === 'caches');
    check('a step that recycles moves its bytes and frees none of them yet',
      caches.moves === 10 * GB && caches.freesNow === 0 && caches.afterBin === 10 * GB,
      `moves ${gb(caches.moves)}, frees now ${gb(caches.freesNow)}, after the bin ${gb(caches.afterBin)}`);
    check('so the running total after it is still zero',
      caches.cumulative === 0, gb(caches.cumulative));

    const bin = plan.steps.find((s) => s.id === 'bin');
    check('a bin step appears, and it is where the space arrives',
      bin && bin.freesNow === 10 * GB && bin.derived === true,
      bin ? gb(bin.freesNow) : 'no bin step');
    check('and that is where the goal is met',
      plan.reached && plan.steps[plan.reachedAt].id === 'bin',
      `${plan.reached ? 'reached' : 'not reached'} at ${plan.reachedAt}`);
    check('the plan does not count the same bytes twice',
      plan.total === 10 * GB, gb(plan.total));
  }

  console.log('\nplanner: three ways space comes back, counted where each lands\n');

  {
    const plan = buildPlan({
      goal: { kind: 'bytes', bytes: 100 * GB },
      volume: VOLUME,
      candidates: [
        candidate({ category: 'cleanup.temp', bytes: 5 * GB }),
        candidate({ category: 'cloud.dehydrate', bytes: 7 * GB, actions: ['dehydrate'] }),
        candidate({ category: 'system.hiberfil', kind: 'virtual', verdict: 'review', bytes: 6 * GB, actions: ['handoff'] }),
      ],
    });
    const by = Object.fromEntries(plan.steps.map((s) => [s.id, s]));
    check('dehydrate frees on the spot', by.cloud.freesNow === 7 * GB && by.cloud.afterBin === 0);
    check('a handoff is counted as Windows doing it, not as us',
      by.system.viaWindows === 6 * GB && by.system.freesNow === 0,
      `${gb(by.system.viaWindows)} via Windows`);
    check('recycle waits for the bin', by.caches.afterBin === 5 * GB && by.caches.freesNow === 0);
    check('and the three add up once each',
      plan.total === 18 * GB, gb(plan.total));
  }

  console.log('\nplanner: allocation, not the size somebody typed\n');

  {
    const plan = buildPlan({
      goal: { kind: 'bytes', bytes: 1 * GB },
      volume: VOLUME,
      // A OneDrive placeholder: 4 GB logical, nothing of it on this disk.
      candidates: [candidate({ category: 'cleanup.stale', verdict: 'review', bytes: 4 * GB, bytesOnDisk: 0 })],
    });
    check('a file whose contents are not on this disk frees nothing',
      plan.total === 0 && plan.steps[0].moves === 0,
      `${gb(plan.steps[0].moves)} moved`);
    check('and `occupies` prefers allocation wherever the analyzer knew it',
      occupies({ bytes: 4 * GB, bytesOnDisk: 1024 }) === 1024 && occupies({ bytes: 7 }) === 7);
  }

  console.log('\nplanner: risk order, and one candidate in one step\n');

  {
    const plan = buildPlan({
      goal: { kind: 'bytes', bytes: 1 * GB },
      volume: VOLUME,
      candidates: [
        candidate({ category: 'games.steam', verdict: 'review', actions: ['handoff'] }),
        candidate({ category: 'cleanup.temp' }),
        candidate({ category: 'dev.packageCache' }),
        candidate({ category: 'cleanup.archive', verdict: 'review' }),
        candidate({ category: 'cloud.dehydrate', actions: ['dehydrate'] }),
      ],
    });
    const order = plan.steps.filter((s) => !s.derived).map((s) => s.id);
    check('steps arrive in rising risk',
      JSON.stringify(order) === JSON.stringify(['caches', 'cloud', 'devtools', 'review', 'games']),
      order.join(' → '));
    const risks = plan.steps.filter((s) => !s.derived).map((s) => s.risk);
    check('and their risk numbers never go backwards',
      risks.every((r, i) => i === 0 || r >= risks[i - 1]), risks.join(', '));

    const counted = plan.steps.reduce((n, s) => n + s.count, 0);
    check('every candidate lands in exactly one step', counted === 5, `${counted} of 5`);
  }

  {
    // A file that two steps would both take: the earlier, lower-risk one wins,
    // and the later one must not count it again.
    const shared = candidate({ category: 'cleanup.temp', bytes: 3 * GB });
    const plan = buildPlan({
      goal: { kind: 'bytes', bytes: 1 * GB },
      volume: VOLUME,
      candidates: [shared, shared],
    });
    check('the same candidate handed in twice is still counted twice, not silently merged',
      plan.steps[0].count === 2, `${plan.steps[0].count}`);
  }

  console.log('\nplanner: when it cannot get there\n');

  {
    const plan = buildPlan({
      goal: { kind: 'bytes', bytes: 30 * GB },
      volume: VOLUME,
      candidates: [candidate({ category: 'cleanup.temp', bytes: 12 * GB })],
      missing: [{ id: 'apps', reason: 'notMeasured' }],
    });
    check('it says so rather than padding the numbers',
      plan.reached === false && plan.shortfall === 18 * GB,
      `short by ${gb(plan.shortfall)} of ${gb(plan.target)}`);
    check('and it carries what it never measured, so the screen can say that too',
      plan.missing.length === 1 && plan.missing[0].id === 'apps');
    check('with no goal there is no shortfall and nothing is "reached"',
      buildPlan({ volume: VOLUME, candidates: [] }).reached === false
        && buildPlan({ volume: VOLUME, candidates: [] }).shortfall === 0);
    check('and no candidates at all is an empty plan, not a crash',
      buildPlan({ goal: { kind: 'bytes', bytes: GB }, volume: VOLUME }).steps.length === 0);
  }

  console.log('\nplanner: it cannot disagree with the handlers about what frees space\n');

  {
    // WHEN is a table in the planner; the handlers are the truth. If one is
    // edited without the other, this is where it shows.
    const handlers = require('../src/main/actions/handlers');
    const rows = [];
    for (const [kind, handler] of Object.entries(handlers)) {
      if (typeof handler.freesOnVolume !== 'function') continue;
      // Asked the way the pipeline asks it, for the case each handler treats
      // as its default.
      const immediate = handler.freesOnVolume({}, {});
      const planner = WHEN[kind];
      if (planner === undefined) continue;
      rows.push({ kind, immediate, planner });
    }
    check('every handler the planner knows about was asked', rows.length >= 3, rows.map((r) => r.kind).join(', '));
    const wrong = rows.filter((r) => (r.immediate === true) !== (r.planner === 'now'));
    check('a handler that frees at once is "now" in the planner, and one that does not is never "now"',
      wrong.length === 0,
      wrong.length
        ? wrong.map((r) => `${r.kind}: handler ${r.immediate}, planner ${r.planner}`).join(', ')
        : rows.map((r) => `${r.kind}=${r.planner}`).join(', '));
    check('recycle in particular is not "now" -- the bin is on the same volume',
      WHEN.recycle === 'bin' && handlers.recycle.freesOnVolume() === false);
    check('every action the contract allows has an entry',
      ACTION_KINDS.every((k) => WHEN[k] !== undefined),
      ACTION_KINDS.filter((k) => WHEN[k] === undefined).join(', ') || 'all of them');
  }

  console.log('\nplanner: every step points somewhere that exists\n');

  {
    const fs = require('node:fs');
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    const tabs = new Set([...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]));
    const screens = [...new Set(STEPS.map((s) => s.screen)), 'restore'];
    const unknown = screens.filter((s) => !tabs.has(s));
    check('a step that says "go to this screen" names a tab that is really there',
      unknown.length === 0, unknown.join(', ') || screens.join(', '));

    const categories = require('../src/main/analyzers/categories');
    const undeclared = STEPS.flatMap((s) => s.categories).filter((c) => !categories.isDeclared(c));
    check('and every category a step collects is one the analyzers declare',
      undeclared.length === 0, undeclared.join(', ') || `${STEPS.flatMap((s) => s.categories).length} categories`);
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
