'use strict';

/**
 * Which build this is.
 *
 * `npm run build` writes `build-info.json` beside this file before packaging
 * and removes it afterwards, so the file exists only inside an installer. A
 * checkout has none, and is therefore the `dev` channel -- which is the one
 * place a developer override of the entitlements is honoured.
 *
 *   dev      running from source
 *   stable   what users download (the default for `npm run build`)
 *   beta     reserved: a public build with purchasing hidden (roadmap 7.8)
 */

const pkg = require('../../package.json');

let written = null;
try {
  // eslint-disable-next-line global-require
  written = require('./build-info.json');
} catch {
  written = null;
}

const CHANNELS = ['dev', 'beta', 'stable'];

const BUILD_INFO = Object.freeze({
  channel: written && CHANNELS.includes(written.channel) ? written.channel : 'dev',
  version: pkg.version,
  releaseDate: written && typeof written.releaseDate === 'string' ? written.releaseDate : null,
});

module.exports = { BUILD_INFO, BUILD_CHANNEL: BUILD_INFO.channel, CHANNELS };
