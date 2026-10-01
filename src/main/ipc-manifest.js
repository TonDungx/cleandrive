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
  'scan:children',
  'scan:drives',
  'dupes:run',
  'dupes:cancel',
  'dupes:copiesOf',

  'planner:run',
  'planner:cancel',
  'planner:volume',

  'action:execute',
  'action:stop',

  'system:facts',
  'system:measure',
  'system:measureElevated',
  'system:cancel',
  'system:handoff',

  'apps:last',
  'apps:scan',
  'apps:cancel',
  'apps:prefetch',

  'games:last',
  'games:scan',
  'games:cancel',

  'chat:last',
  'chat:scan',
  'chat:cancel',

  'dev:last',
  'dev:scan',
  'dev:cancel',
  'dev:lastProjects',
  'dev:scanProjects',
  'dev:cancelProjects',

  'snapshot:list',
  'snapshot:diff',

  'journal:sessions',
  'journal:items',
  'journal:restore',

  'quarantine:status',
  'quarantine:choose',

  'backup:choose',

  'relocate:choose',
  'archive:choose',
  'compress:state',

  'explorer:status',
  'explorer:set',

  'shell:reveal',
  'shell:open',

  'preview:open',
  'preview:compare',
  'preview:close',

  'media:roots',
  'media:scan',
  'media:cancel',
  'media:thumbs',
  'media:similar',
  'media:measureAll',
  'media:measureCancel',

  'video:plan',
  'video:open',
  'video:read',
  'video:write',
  'video:save',
  'video:close',

  /* The map (E4). The window sends tile coordinates and gets PNG bytes; it
     cannot reach the network itself and this is the only way one is fetched. */
  'map:tiles',
  'map:cache',
  'map:clearCache',

  'settings:get',
  'settings:save',
  'autoclean:run',
  'autoclean:cancel',
  // The unattended profiles (G4). Saving one goes through its own channel
  // rather than `settings:save`, because adding one has a licence to check and
  // removing one has a Windows task to take away.
  'autoclean:saveProfile',
  'autoclean:addProfile',
  'autoclean:removeProfile',
  'disk:usage',
  'recyclebin:preview',
  'recyclebin:purge',

  'update:state',
  'update:check',
  'update:download',
  'update:install',
  'update:acknowledge',

  'theme:set',
  'theme:saveCustom',
  'theme:import',
  'theme:export',
  'language:set',
  'language:get',

  'tasks:status',
  'tasks:reconcile',
  'tasks:runNow',

  'history:get',
  'history:export',
  // The self-contained HTML report (G2). Two channels: what could be in one,
  // and write it.
  'report:options',
  'report:save',
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
  'system:progress',
  'apps:progress',
  'games:progress',
  'chat:progress',
  'dev:progress',
  'dev:projectProgress',
  'planner:progress',
  'autoclean:progress',
  'media:progress',
  'media:batch',
  'media:measureProgress',
  'update:state',
  'app:data-changed',
  'app:target',
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
