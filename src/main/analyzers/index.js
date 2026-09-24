'use strict';

/**
 * The analyzers this build ships, registered once.
 *
 * Required for its side effect by anything that runs one. The registry throws
 * on a second registration of the same id, so this file guards itself rather
 * than relying on every caller requiring it exactly once.
 */

const registry = require('./registry');

const BUILT_IN = [
  require('./scan').analyzer,
  require('./duplicates').analyzer,
  require('./media').analyzer,
  require('./system').analyzer,
];

for (const analyzer of BUILT_IN) {
  if (!registry.get(analyzer.id)) registry.register(analyzer);
}

module.exports = registry;
