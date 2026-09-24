'use strict';

/**
 * Every operation the window can ask the main process for, and every message
 * the main process may send it.
 *
 * The window has no access to the disk, the network or Node; this list is the
 * whole of what it can reach. It is written down here rather than being
 * whatever `ipc.js` happens to register, so that "the renderer can do exactly
 * these things" is a list somebody can read -- and so the harness in
 * `scripts/test-ipc-manifest.js` can hold the preload, the handlers and this
 * file to the same set. A handler registered for a channel not listed here
 * throws at startup.
 *
 * Names are `area:verb`, the convention every existing channel already used.
 */

const INVOKE = Object.freeze([
  'dialog:pickFolder',
  'app:paths',

  'scan:run',
  'scan:cancel',
  'dupes:run',
  'dupes:cancel',

  'action:execute',
  'action:stop',

  'shell:reveal',
  'shell:open',

  'preview:open',
  'preview:close',

  'media:roots',
  'media:scan',
  'media:cancel',
  'media:thumbs',
  'media:similar',

  'settings:get',
  'settings:save',
  'autoclean:run',
  'autoclean:cancel',
  'disk:usage',
  'recyclebin:preview',
  'recyclebin:purge',

  'update:state',
  'update:check',
  'update:download',
  'update:install',
  'update:acknowledge',

  'theme:set',
  'language:set',
  'language:get',

  'tasks:status',
  'tasks:reconcile',
  'tasks:runNow',

  'history:get',
  'history:export',
  'trends:sample',

  'monitor:status',
  'monitor:check',
  'monitor:snooze',
  'monitor:resume',

  'license:entitlements',
]);

const EVENTS = Object.freeze([
  'scan:progress',
  'dupes:progress',
  'action:progress',
  'autoclean:progress',
  'media:progress',
  'media:batch',
  'update:state',
  'app:data-changed',
]);

const INVOKE_SET = new Set(INVOKE);
const EVENT_SET = new Set(EVENTS);

function assertInvokable(channel) {
  if (!INVOKE_SET.has(channel)) {
    throw new Error(`IPC channel ${channel} is not in ipc-manifest.js -- add it there first`);
  }
}

function isEvent(channel) {
  return EVENT_SET.has(channel);
}

module.exports = { INVOKE, EVENTS, assertInvokable, isEvent };
