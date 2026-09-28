'use strict';

/**
 * Every action this build can carry out, by kind.
 *
 * The contract names nine kinds; only those with a handler here can run.
 * `hardlink` (F4) is the last one without, and arrives as one more entry in
 * this table and nothing else. `execute` refuses a kind that is not listed
 * rather than guessing at it.
 *
 * Each handler declares:
 *
 *   kind, feature        which action, and which entitlement it needs
 *   allowsFolders        whether it may be applied to a directory. Enforced by
 *                        `execute`, which is newer than the field: until B2
 *                        every handler declared `false` and nothing read it,
 *                        so the declaration described an intention rather than
 *                        a rule. `relocate` is the first to declare `true`.
 *   reversible           'bin' | 'journal' | 'manual' | 'none'
 *   freesOnVolume(...)   whether it gives space back to the source volume
 *   plan, describe, apply
 *   undo                 optional: { locate, ready, putBack } -- how the
 *                        Restore Center finds this kind's items and puts them
 *                        back. A kind without one is listed but not undoable.
 *
 * `restore` is here too, though no candidate ever offers it: it acts on the
 * app's own earlier sessions rather than on a file somebody chose, which is
 * why it is not an ActionKind in the contract. It is still an action, so it
 * gets the same pipeline and the same journal as the rest.
 */
module.exports = Object.freeze({
  recycle: require('./recycle'),
  restore: require('./restore'),
  handoff: require('./handoff'),
  dehydrate: require('./dehydrate'),
  quarantine: require('./quarantine'),
  relocate: require('./relocate'),
  archive: require('./archive'),
  compress: require('./compress'),
});
