'use strict';

/**
 * Every action this build can carry out, by kind.
 *
 * The contract names nine kinds; only those with a handler here can run. The
 * others -- quarantine, relocate, compress, dehydrate, archive, hardlink,
 * handoff -- arrive with the features that specify them (B1-B5, F4, A1), each
 * as one more entry in this table and nothing else. `execute` refuses a kind
 * that is not listed rather than guessing at it.
 *
 * Each handler declares:
 *
 *   kind, feature        which action, and which entitlement it needs
 *   allowsFolders        whether it may be applied to a directory
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
});
