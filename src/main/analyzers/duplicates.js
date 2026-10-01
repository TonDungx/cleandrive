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
 * A row that is not its own file (F4).
 *
 * Either the user joined these copies here, or something else on the machine
 * did -- a package manager, a backup tool, an installer. Whichever it was, the
 * row has to say so, because every other number on this screen is about space
 * and this one would free none of it.
 */
function shared(names) {
  return names === 1
    ? m('evidence.dupes.shared.one', 'Already the same file as 1 other copy here — deleting it would free nothing')
    : m('evidence.dupes.shared.other', 'Already the same file as {n} other copies here — deleting it would free nothing', {
        n: names,
      });
}

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
  const sharesWith = file.sharesWith || [];
  let verdict = 'review';
  let confidence = 'certain';
  let list = [same];

  if (sharesWith.length > 0) {
    // This name and another are one file already. Deleting it frees nothing,
    // joining it is a no-op, and calling it `review` would put it in front of
    // somebody as a decision with no consequence. So it is `keep`, and the
    // evidence says why rather than leaving the row looking arbitrary.
    verdict = 'keep';
    confidence = 'certain';
    list = [evidence(1, shared(sharesWith.length)), same];
  } else if (file.protected) {
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

  /*
   * Which buttons this row offers.
   *
   * `hardlink` (F4) is offered only where it would do something: a copy that
   * is not the keeper, is not a program's own component, and is not already
   * sharing a file with something. Whether the user may *press* it is a
   * separate question with three more gates -- the Developer Pack, the hidden
   * switch, and a confirmation that has to be read to the end -- and none of
   * those belong to the analyzer.
   *
   * A program's component is never moved to another drive and never joined:
   * it would be somewhere, or something, the program cannot rely on.
   */
  const actions = file.protected
    ? ['recycle']
    : sharesWith.length > 0
      ? []
      : file.keeper
        ? ['recycle', 'quarantine']
        : ['recycle', 'quarantine', 'hardlink'];

  return {
    id: candidateId(ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: file.size,
    category: 'dupes.copy',
    verdict,
    confidence,
    evidence: list,
    actions,
    unattendedEligible: false,
    meta: {
      group: group.hash,
      keeper: file.keeper,
      component: file.protected,
      mtimeMs: file.mtimeMs,
      atimeMs: file.atimeMs,
      // Which copy this one would be joined to, and whether it already is.
      // The window sends the pair back when it asks for a join; the handler
      // re-reads and re-hashes both before believing any of it.
      keeperPath: (group.files.find((f) => f.keeper) || {}).path || null,
      links: Number.isFinite(file.links) ? file.links : 1,
      sharesWith,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* whole folders (F2)                                                          */
/* -------------------------------------------------------------------------- */

const pct = (ratio) => Math.round(ratio * 1000) / 10;

/**
 * Three more id namespaces, beside the file screen's own.
 *
 * A candidate's id is the identity of a *decision*, not of a path -- which is
 * why the analyzer's name is already part of it. One path can now carry more
 * than one decision on this screen: `project-b\app.js` is both "a copy of two
 * other files" and "a file inside a folder that is wholly a copy", and
 * `project-a` is both "one of two identical folders" and "the folder
 * `project-c` is 90% the same as". Those are different rows with different
 * evidence and, for a file, possibly *opposite* verdicts -- the oldest copy of
 * a file can sit inside a folder that should go. Sharing one id would let the
 * window's id-to-row map keep whichever arrived last and quietly drop the
 * other.
 *
 * Ticking is still by path, so a file ticked in one list shows ticked in the
 * other and is deleted once.
 */
const FOLDER_ID = `${ID}:folder`;
const NEAR_ID = `${ID}:near`;
const FOLDER_FILE_ID = `${ID}:folderFile`;

function folderEvidence(group, member) {
  const others = group.count - 1;
  return others === 1
    ? m(
        'evidence.dupes.folder.one',
        'Every one of its {n} files is byte-for-byte identical to the file at the same place in 1 other folder',
        { n: member.fileCount }
      )
    : m(
        'evidence.dupes.folder.other',
        'Every one of its {n} files is byte-for-byte identical to the file at the same place in {c} other folders',
        { n: member.fileCount, c: others }
      );
}

const FOLDER_KEEPER = m('evidence.dupes.folder.keeper', 'The copy suggested for keeping — nothing here is offered up');

/**
 * A folder that holds the same thing as another.
 *
 * It carries no action, and that is deliberate rather than an omission: the
 * app never deletes a folder, `actions/recycle.js` and `actions/quarantine.js`
 * both refuse a directory, and the spec's `archive` is B5 and has no handler
 * at all. What can be acted on is each file inside, below.
 */
function folderCandidate(group, member) {
  return {
    id: candidateId(FOLDER_ID, member.path),
    path: member.path,
    kind: 'folder',
    bytes: member.bytes,
    category: 'dupes.folder',
    verdict: member.keeper ? 'keep' : 'review',
    confidence: 'certain',
    evidence: member.keeper
      ? [evidence(1, FOLDER_KEEPER), evidence(2, folderEvidence(group, member))]
      : [evidence(1, folderEvidence(group, member))],
    actions: [],
    unattendedEligible: false,
    meta: {
      group: group.id,
      keeper: member.keeper,
      fileCount: member.fileCount,
      listedFiles: member.files.length,
      truncated: member.truncated,
      folderRow: true,
    },
  };
}

/** One file under a folder that is a copy: this is what a button acts on. */
function folderFileCandidate(file, group, member, why) {
  return {
    id: candidateId(FOLDER_FILE_ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: file.size,
    category: 'dupes.folderFile',
    verdict: 'review',
    confidence: 'certain',
    evidence: [evidence(1, why)],
    actions: ['recycle', 'quarantine'],
    unattendedEligible: false,
    meta: {
      group: group.id,
      folder: member.path,
      rel: file.rel,
      keeper: false,
      mtimeMs: file.mtimeMs,
    },
  };
}

/**
 * A folder that is nearly, but not quite, a copy of another.
 *
 * `review` and never `certain`: what is certain is which files match, and the
 * evidence says exactly that. Whether the two folders are "the same thing" is
 * the user's call, which is what the tree comparison is for.
 */
function nearCandidate(pair, side, keeper) {
  const why = m(
    'evidence.dupes.near',
    '{pct}% the same as {other}: {same} files identical, {differ} different, {only} only here',
    {
      pct: pct(pair.ratio),
      other: keeper ? pair.other.path : pair.keep.path,
      same: pair.matched,
      differ: pair.differing,
      only: keeper ? pair.compare.onlyKeep.length : pair.compare.onlyOther.length,
    }
  );
  return {
    id: candidateId(NEAR_ID, side.path),
    path: side.path,
    kind: 'folder',
    bytes: side.bytes,
    category: 'dupes.nearFolder',
    verdict: keeper ? 'keep' : 'review',
    confidence: 'likely',
    evidence: [evidence(1, why)],
    actions: [],
    unattendedEligible: false,
    meta: {
      group: pair.id,
      keeper,
      fileCount: side.fileCount,
      ratio: pair.ratio,
      listedFiles: (side.files || []).length,
      truncated: Boolean(side.truncated),
      folderRow: true,
    },
  };
}

/**
 * The folder half of the reply, as candidates and as groups of ids.
 *
 * Yields everything it makes, so the registry validates each one the same way
 * it validates a file.
 */
function* folderCandidates(folders) {
  const exact = [];
  for (const group of folders.exact) {
    const ids = [];
    const fileIds = [];
    for (const member of group.members) {
      const row = folderCandidate(group, member);
      ids.push(row.id);
      yield { type: 'candidate', candidate: row };

      if (member.keeper) continue;
      const why = m(
        'evidence.dupes.folderFile',
        'Inside {folder}, which is a byte-for-byte copy of a folder being kept',
        { folder: member.path }
      );
      for (const file of member.files) {
        const candidate = folderFileCandidate(file, group, member, why);
        fileIds.push(candidate.id);
        yield { type: 'candidate', candidate };
      }
    }
    exact.push({ ...group, members: group.members.map(({ files, ...rest }) => rest), ids, fileIds });
  }

  const near = [];
  for (const pair of folders.near) {
    const keepRow = nearCandidate(pair, pair.keep, true);
    const otherRow = nearCandidate(pair, pair.other, false);
    yield { type: 'candidate', candidate: keepRow };
    yield { type: 'candidate', candidate: otherRow };

    // Only the files that were *verified identical on both sides* can be
    // acted on. A file that is only on one side, or that differs, is shown in
    // the comparison and is never offered up -- it is the thing that would
    // actually be lost.
    const why = m(
      'evidence.dupes.nearFile',
      'Identical to the file at the same place in {folder}, which is being kept',
      { folder: pair.keep.path }
    );
    const fileIds = [];
    for (const file of pair.other.files) {
      const candidate = folderFileCandidate(file, pair, pair.other, why);
      fileIds.push(candidate.id);
      yield { type: 'candidate', candidate };
    }
    const { files, ...other } = pair.other;
    near.push({ ...pair, other, ids: [keepRow.id, otherRow.id], fileIds });
  }

  return { ...folders, exact, near };
}

/* -------------------------------------------------------------------------- */
/* documents that look like versions of one another (F3)                       */
/* -------------------------------------------------------------------------- */

const VERSION_ID = `${ID}:version`;

/**
 * One document in a set of apparent versions.
 *
 * `review` and never better than `likely`, because the evidence is a filename.
 * The actions are the ordinary two, but there is no bulk selection anywhere
 * that reaches these -- the spec forbids "select all but the newest" and it is
 * right to: a one-click delete on top of a guess is exactly the false
 * confidence this app is written against.
 */
function versionCandidate(file, group) {
  const why = group.markers.length > 0
    ? m(
        'evidence.dupes.version.marked',
        'One of {n} files whose names differ only by {markers} — which usually means drafts of one document, and sometimes does not',
        { n: group.count, markers: group.markers.join(', ') }
      )
    : m(
        'evidence.dupes.version.formats',
        'One of {n} files with the same name in one folder, saved in different formats — usually one piece of work exported more than once',
        { n: group.count }
      );

  // Three states rather than two: a file whose timestamp ties with the
  // newest is not older than it, and saying so would be the app being
  // wrong about the one thing here it actually measured.
  const extra = file.newest
    ? m('evidence.dupes.version.newest', 'The most recently changed of them')
    : file.sameTimeAsNewest
      ? m('evidence.dupes.version.sameTime', 'Changed at the same moment as the newest of them, which usually means copied rather than drafted')
      : m('evidence.dupes.version.older', 'Changed less recently than another in the set');

  return {
    id: candidateId(VERSION_ID, file.path),
    path: file.path,
    kind: 'file',
    bytes: file.size,
    category: 'dupes.version',
    verdict: 'review',
    // Never `certain` or `strong`: nothing here was read, only named.
    confidence: group.confidence,
    evidence: [evidence(1, why), evidence(2, extra)],
    actions: ['recycle', 'quarantine'],
    unattendedEligible: false,
    meta: {
      group: group.key,
      newest: file.newest,
      sameTimeAsNewest: file.sameTimeAsNewest,
      markers: file.markers,
      ext: file.ext,
      mtimeMs: file.mtimeMs,
      versionRow: true,
    },
  };
}

function* versionCandidates(versions) {
  const groups = [];
  for (const group of versions.groups) {
    const ids = [];
    for (const file of group.files) {
      const candidate = versionCandidate(file, group);
      ids.push(candidate.id);
      yield { type: 'candidate', candidate };
    }
    const { files, ...rest } = group;
    groups.push({ ...rest, ids });
  }
  return { ...versions, groups };
}

const analyzer = {
  id: ID,
  feature: 'free',
  requiresElevation: false,
  categories: ['dupes.copy', 'dupes.folder', 'dupes.nearFolder', 'dupes.folderFile', 'dupes.version'],

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

    // Whole folders (F2), and documents that look like versions (F3), when
    // the run asked for them.
    const folders = result.folders ? yield* folderCandidates(result.folders) : null;
    const versions = result.versions ? yield* versionCandidates(result.versions) : null;

    yield { type: 'summary', summary: { ...result, groups, folders, versions } };
  },
};

module.exports = { analyzer, ID };
