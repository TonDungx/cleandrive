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
 */
module.exports = Object.freeze({
  recycle: require('./recycle'),
});
