'use strict';

/**
 * The analyzer behind the Duplicates screen.
 *
 * The one place in the app where `certain` is the honest word: two files whose
 * full SHA-256 agree are the same bytes, and that is verified, not inferred.
 * What stays uncertain is which copy should go, and that is the user's call --
 * so a copy is `review`, never `safe`, and the suggested keeper and the copies
 * that belong to installed programs are `keep`.
 */

const { findDuplicates } = require('../lib/duplicate');
const { message: m } = require('../../i18n');
const { candidateId, evidence } = require('./contract');
const { streamWhile } = require('./channel');

const ID = 'duplicates';

function identical(count) {
  const others = count - 1;
  return others === 1
    ? m('evidence.dupes.identical.one', 'Byte-for-byte identical to 1 other copy, confirmed by a full SHA-256 of each')
    : m(
        'evidence.dupes.identical.other',
        'Byte-for-byte identical to {n} other copies, confirmed by a full SHA-256 of each',
        { n: others }
      );
}

const OLDEST = m('evidence.dupes.oldest', 'The oldest copy — suggested as the one to keep');

/**
 * How sure the app is that a copy belongs to a program rather than a person.
 *
 * A dependency folder or a system location is a strong signal; a file being a
 * .dll is a weaker one, which is why the advisor words it "usually".
 */
function componentConfidence(reason) {
  if (reason && reason.i18n === 'reason.binaryModule') return 'likely';
  return 'strong';
}

function toCandidate(file, group) {
  const same = evidence(file.keeper || file.protected ? 2 : 1, identical(group.count));
  let verdict = 'review';
  let confidence = 'certain';
  let list = [same];

  if (file.protected) {
    // Listed, never bulk-selected: for a program's components "identical" does
    // not mean "redundant". Still tickable by hand -- the guard is on what a
    // single click may take, not on what the user is allowed to do.
    verdict = 'keep';
    confidence = componentConfidence(file.protectionReason);
    list = [evidence(1, file.protectionReason), same];
  } else if (file.keeper) {
    verdict = 'keep';
    confidence = 'certain';
    list = [evidence(1, OLDEST), same];
  }

  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: file.size,
    category: 'dupes.copy',
    verdict,
    confidence,
    evidence: list,
    actions: ['recycle'],
    unattendedEligible: false,
    meta: {
      group: group.hash,
      keeper: file.keeper,
      component: file.protected,
      mtimeMs: file.mtimeMs,
      atimeMs: file.atimeMs,
    },
  };
}

const analyzer = {
  id: ID,
  feature: 'free',
  requiresElevation: false,
  categories: ['dupes.copy'],

  /**
   * @param {object} ctx  { roots, options, deps: { findDuplicates } }
   */
  async *run(ctx, token) {
    const find = (ctx.deps && ctx.deps.findDuplicates) || findDuplicates;
    const result = yield* streamWhile((push) =>
      find(ctx.roots, ctx.options || {}, {
        token,
        onProgress: (p) => push({ type: 'progress', ...p }),
      })
    );

    const groups = [];
    for (const group of result.groups) {
      const ids = [];
      for (const file of group.files) {
        const candidate = toCandidate(file, group);
        ids.push(candidate.id);
        yield { type: 'candidate', candidate };
      }
      const { files, ...rest } = group;
      groups.push({ ...rest, ids });
    }

    yield { type: 'summary', summary: { ...result, groups } };
  },
};

module.exports = { analyzer, ID };
