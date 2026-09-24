'use strict';

/**
 * Where analyzers are registered, and the one way they are run.
 *
 * An analyzer is anything that produces candidates: the scan behind Disk usage
 * and What to delete, the duplicate finder, the photo scan -- and every source
 * the roadmap adds after them. Running one goes through `runAnalyzer`, which is
 * where the two rules no analyzer is trusted to keep for itself are applied:
 *
 *   - a feature the licence does not include yields `locked`, not results;
 *   - every candidate is validated before it leaves, so a verdict with no
 *     evidence never reaches a screen.
 *
 * @typedef Analyzer
 * @property {string}   id
 * @property {string}   feature            entitlement key: 'free', 'pro.dev', ...
 * @property {boolean}  requiresElevation
 * @property {string[]} categories         every category it may produce, declared up front
 * @property {(ctx: object, token: CancelToken) => AsyncIterable<object>} run
 *   Yields `{ type: 'progress', ... }`, `{ type: 'candidate', candidate }` and,
 *   last, one `{ type: 'summary', summary }`.
 */

const { assertCategoryDeclared } = require('./categories');
const { validateCandidate } = require('./contract');
const { CancelToken } = require('../lib/util');

const analyzers = new Map();

function register(analyzer) {
  if (!analyzer || typeof analyzer.id !== 'string' || analyzer.id === '') {
    throw new Error('an analyzer needs an id');
  }
  if (analyzers.has(analyzer.id)) throw new Error(`duplicate analyzer ${analyzer.id}`);
  if (typeof analyzer.feature !== 'string' || analyzer.feature === '') {
    throw new Error(`analyzer ${analyzer.id} names no feature`);
  }
  if (typeof analyzer.run !== 'function') throw new Error(`analyzer ${analyzer.id} has no run()`);
  if (!Array.isArray(analyzer.categories) || analyzer.categories.length === 0) {
    throw new Error(`analyzer ${analyzer.id} declares no categories`);
  }
  for (const category of analyzer.categories) assertCategoryDeclared(category);

  analyzers.set(analyzer.id, Object.freeze({ requiresElevation: false, ...analyzer }));
  return analyzers.get(analyzer.id);
}

function get(id) {
  return analyzers.get(id) || null;
}

function list() {
  return [...analyzers.values()];
}

/** Test harnesses register fixtures of their own; this puts the table back. */
function unregister(id) {
  return analyzers.delete(id);
}

/**
 * Run one analyzer.
 *
 * Stopping is not an error. A cancelled run returns what it had produced so far
 * -- the same promise every long operation in the app makes -- so a caller that
 * stops a scan half way still gets the half.
 *
 * A candidate that fails validation is dropped and counted in `rejected` on the
 * summary, and logged. `strict` makes it throw instead, which is what the test
 * harnesses ask for: in a harness an invalid candidate is a bug to be named,
 * in front of a user it is a row that must not be drawn.
 *
 * @param {string} id
 * @param {object} ctx                 analyzer-specific input
 * @param {object} [options]
 * @param {CancelToken} [options.token]
 * @param {(feature: string) => boolean} [options.can]  entitlement check
 * @param {boolean} [options.strict]
 */
async function* runAnalyzer(id, ctx, { token = new CancelToken(), can = () => true, strict = false } = {}) {
  const analyzer = analyzers.get(id);
  if (!analyzer) throw new Error(`unknown analyzer ${id}`);

  if (!can(analyzer.feature)) {
    yield { type: 'locked', feature: analyzer.feature };
    return;
  }

  const declared = new Set(analyzer.categories);
  let rejected = 0;

  for await (const item of analyzer.run(ctx, token)) {
    if (item && item.type === 'candidate') {
      try {
        validateCandidate(item.candidate);
        // Declared in categories.js is not enough: an analyzer may only emit
        // what it said it would, so the automatic run and the screens can know
        // in advance what a source can produce.
        if (!declared.has(item.candidate.category)) {
          throw new TypeError(
            `invalid candidate (${item.candidate.path}): ${id} did not declare ${item.candidate.category}`
          );
        }
      } catch (err) {
        if (strict) throw err;
        rejected += 1;
        if (rejected <= 5) console.error(`[analyzer:${id}]`, err.message);
        continue;
      }
      yield item;
      continue;
    }

    if (item && item.type === 'summary') {
      yield { type: 'summary', summary: { ...item.summary, rejected, cancelled: Boolean(item.summary.cancelled || token.cancelled) } };
      return;
    }

    yield item;
  }

  // An analyzer that ended without a summary still owes the caller the count.
  yield { type: 'summary', summary: { rejected, cancelled: token.cancelled } };
}

/**
 * Run an analyzer to the end and hand back everything at once.
 *
 * For callers that want the whole answer rather than a stream -- the IPC
 * handlers that return one reply, and the harnesses.
 *
 * @returns {Promise<{candidates: object[], summary: object, locked: string|null}>}
 */
async function collect(id, ctx, options = {}) {
  const candidates = [];
  let summary = null;
  let locked = null;

  for await (const item of runAnalyzer(id, ctx, options)) {
    if (item.type === 'candidate') {
      candidates.push(item.candidate);
      if (options.onCandidate) options.onCandidate(item.candidate);
    } else if (item.type === 'summary') summary = item.summary;
    else if (item.type === 'locked') locked = item.feature;
    else if (options.onProgress) options.onProgress(item);
  }

  return { candidates, summary: summary || {}, locked };
}

module.exports = { register, get, list, unregister, runAnalyzer, collect };
