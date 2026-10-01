'use strict';

/**
 * `cleandrive profiles` -- the automatic cleanup profiles, by the id
 * `run --profile` takes.
 *
 * The spec said `run --profile <name>`, but a profile's name is optional: the
 * first one is unnamed on purpose and called "Automatic cleanup" on screen in
 * whichever language the reader has. The id is the one thing that is always
 * there and never changes, and the Automatic tab does not show it -- so this
 * lists them.
 */

const { profilesOf } = require('../../lib/settings');
const { EXIT } = require('../codes');
const f = require('../format');

const SCHEDULE = Object.freeze({
  daily: (s) => `daily at ${s.time}`,
  weekly: (s) => `weekly, ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.weekday] || `day ${s.weekday}`} at ${s.time}`,
  monthly: (s) => `monthly, day ${s.day} at ${s.time}`,
  minutes: (s) => `every ${s.everyMinutes} minutes`,
});

/** What a profile is called when it has no name of its own: what the screen calls it (`profileTitle`). */
const nameOf = (p, index) =>
  p.managed ? "Your organisation's profile" : p.name || (index === 0 ? 'Automatic cleanup' : `Profile ${index + 1}`);

async function run(args, ctx) {
  const { settings: store, runLog } = ctx.services();
  const settings = await store.load();
  await runLog.load();
  const profiles = profilesOf(settings);

  const last = (id) => runLog.runs.find((r) => r.profileId === id) || null;
  const list = profiles.map((p, i) => {
    const r = last(p.id);
    return {
      id: p.id,
      name: p.name || null,
      shownAs: nameOf(p, i),
      // Set by the organisation's policy (H2), not in the settings file.
      managed: p.managed === true,
      enabled: p.enabled,
      reportOnly: p.dryRun,
      action: p.action,
      deleteOriginal: p.deleteOriginal,
      schedule: p.schedule,
      roots: p.roots,
      categories: p.categories,
      minAgeDays: p.minAgeDays,
      minDiskUsedPercent: p.minDiskUsedPercent,
      skipIfRunning: p.skipIfRunning,
      maxItemsPerRun: p.maxItemsPerRun,
      lastRun: r ? { startedAt: f.iso(r.startedAt), outcome: r.outcome, reason: f.text(r.reason) || null, via: r.via || (r.manual ? 'window' : 'scheduled') } : null,
    };
  });

  ctx.out.document({ schema: 'cleandrive.profiles/1', generatedAt: f.iso(ctx.now()), settingsFound: store.exists, profiles: list });
  if (!store.exists) ctx.out.line('No settings file yet, so these are the defaults.');
  for (const p of list) {
    const state = !p.enabled ? 'switched off' : p.reportOnly ? 'on, report only' : 'on, acts';
    ctx.out.line(`${p.id}  ${p.shownAs}  (${state})`);
    ctx.out.line(`  ${SCHEDULE[p.schedule.kind] ? SCHEDULE[p.schedule.kind](p.schedule) : p.schedule.kind}; ${p.action === 'quarantine' ? 'moves files to another drive' : 'moves files to the Recycle Bin'}`);
    ctx.out.line(`  folders: ${p.roots.length > 0 ? p.roots.join(', ') : 'none chosen'}`);
    if (p.lastRun) ctx.out.line(`  last run: ${f.when(Date.parse(p.lastRun.startedAt))}, ${p.lastRun.outcome}${p.lastRun.reason ? ` -- ${p.lastRun.reason}` : ''}`);
    ctx.out.line('');
  }
  return EXIT.OK;
}

module.exports = { run, nameOf };
