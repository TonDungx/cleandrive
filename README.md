# CleanDrive

Desktop disk-space analyser and duplicate-file finder. Electron main process does
all filesystem work; the renderer has no Node access at all.

## Everything this app can do

A capability inventory read off the source in `src/`. The measured figures
quoted further down this file come from earlier runs on the author's machine
and are not re-measured here.

Six tabs — **Disk usage**, **What to delete**, **Duplicates**, **Trends**,
**Automatic** and **Settings** — over one selected folder at a time, plus a
scheduled cleanup that runs with no window open, a daily disk measurement that
does the same, and an optional tray watcher. The interface reads in English or
Vietnamese, and says so in whichever one you chose, notifications included.

### Application shell

| Capability | Detail |
| --- | --- |
| Desktop window | 1180×780, minimum 900×600, revealed only once painted (`ready-to-show`) so there is no white flash |
| Dev mode | `npm run dev` passes `--dev`, which opens DevTools in a detached window |
| One copy at a time | `requestSingleInstanceLock`; a second launch restores and focuses the running window rather than starting a rival that would fight over the hash cache |
| Faster filesystem I/O | `UV_THREADPOOL_SIZE` defaults to 16 — the walk is `lstat`-bound and libuv's default of 4 is the bottleneck |
| Clean shutdown | Closing the window cancels every in-flight scan, duplicate search and delete |
| External links | `http`/`https` URLs open in the real browser; every other `window.open` is denied, and navigation away from `file://` is blocked |
| macOS lifecycle | `activate` recreates the window; on every other platform closing the last window quits |
| Language | English and Vietnamese, chosen in Settings or followed from the Windows *display language*; applied to the window, the tray menu, the notifications and the native dialogs without a restart |
| Appearance | Light, dark or follow-the-system, switched with a circular View Transition sweep from the button pressed, and skipped entirely under `prefers-reduced-motion` |

### What the renderer is allowed to do

The UI is plain HTML/CSS/JS with no framework and no build step. It runs with
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a CSP
of `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:`.

Its entire view of the system is the thirty-two functions on `window.cleandrive`:

| Call | Does |
| --- | --- |
| `pickFolder()` | native folder picker |
| `knownPaths()` | home, desktop, downloads, documents, pictures, videos — each resolved defensively, so a redirected or missing folder yields `null` instead of throwing |
| `scan(folder, options)` / `cancelScan()` | disk-usage walk |
| `findDuplicates(roots, options)` / `cancelDuplicates()` | duplicate search over one or more roots |
| `trash(paths, options)` / `cancelTrash()` | guarded Recycle Bin deletion |
| `reveal(target)` / `open(target)` | show in Explorer / open with the default program |
| `getSettings()` / `saveSettings(next)` | read and write the automatic-cleanup policy; saving also makes the Windows task match |
| `runAutoClean({ dryRun })` / `cancelAutoClean()` | run the cleanup now, as a report or for real; a real run raises a native confirmation with the actual figures first |
| `diskUsage(target)` | free and total bytes for the volume a path sits on |
| `previewPurge()` / `purgeNow()` | what could be permanently removed from the Recycle Bin, and doing it — behind the bluntest dialog in the app |
| `taskStatus()` | what Windows Task Scheduler actually holds: the registered definition, whether it matches the settings, and `LastRunTime` / `NextRunTime` / `LastTaskResult` from the OS. One PowerShell process for all tasks at once, asked on demand and cached for 15s, never on a timer |
| `reconcileTasks()` / `runTaskNow(which)` | re-check and repair the registration, and ask Task Scheduler to start the task now — so "does it run when I am not looking" can be answered without waiting for 02:00 |
| `getHistory(options)` / `exportHistory(format)` | the trend report, and writing the raw measurements out as JSON or CSV |
| `sampleNow()` | measure the disk this instant, for a chart that has nothing in it yet |
| `monitorStatus()` / `monitorCheck()` | what the disk watcher currently sees, and forcing a reading now |
| `monitorSnooze(minutes)` / `monitorResume()` | silence and un-silence disk alerts |
| `setTheme(mode)` | persist `system`, `light` or `dark`, and match Electron's native dialogs to it |
| `setLanguage(preference)` / `getLanguage()` | switch the app's language, including the main process's dialogs, notifications and tray menu; and read back which language a `system` preference resolved to |
| `updateState()` / `checkForUpdate()` | what the updater knows, and asking the release feed now |
| `downloadUpdate()` / `installUpdate()` | fetch a new version, and restart into its installer — two separate clicks on purpose |
| `onScanProgress` / `onDuplicateProgress` / `onTrashProgress` / `onAutoCleanProgress` / `onUpdateState` | subscribe to progress and update state; each returns an unsubscribe function |

Every `ipcMain` handler answers with the same `{ ok, data, error, code }`
envelope, so the renderer never sees a raw exception. A cancelled job comes
back as `{ ok: false, cancelled: true }` and is not reported as an error.

Only one job of each kind runs at a time — starting a new scan, duplicate
search or delete cancels the previous one. Progress sends are skipped if the
web contents have been destroyed, so a closed window cannot crash a running job.

### The interface

Light and dark, in one `styles.css`, built on a 4px rhythm and a three-step
elevation ramp, with no framework, no build step and no web fonts (the CSP
forbids loading any). Colour is rationed: in an app whose job is saying what is
safe to delete, green, amber and red have to mean something, so the accent
carries interaction, the neutrals carry structure, and the three semantic
colours are reserved for verdicts, thresholds and outcomes.

Both themes are written once, using `light-dark()` — a CSS colour function that
resolves against the element's `color-scheme`. Every token has one declaration
carrying both values, and the entire theme switch is a single property:

```css
:root                    { color-scheme: light dark; }  /* follow the OS */
:root[data-theme="light"]{ color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
```

The palette does not merely invert. The accent darkens from `#5b8cff` to
`#2563eb` in light mode, because the dark-mode blue sits at roughly 2.6:1
against white — fine as a fill behind white text, unreadable as text. The three
semantic colours darken for the same reason, and the white sheen along the top
of a filled button drops to zero, where it would otherwise just wash the button
out. Shadow *geometry* is shared and only the shadow colour switches, since
`light-dark()` takes colours, not comma-separated shadow lists.

Three mechanisms keep the chosen theme from flashing the wrong one on launch:
the window's `backgroundColor` is picked from `nativeTheme.shouldUseDarkColors`
before the first frame; the mode travels to the renderer as a URL query
parameter, because an IPC round trip is a promise and a promise resolves after
the first paint; and `theme.js` is loaded from `<head>`, so it sets the
attribute before the body is parsed. "System" is never resolved in JavaScript —
`color-scheme: light dark` tracks the OS live, so a machine set to switch at
sunset switches this window with it, with no listener anywhere.

`nativeTheme.themeSource` is set too, so Electron's own dialogs — the delete
confirmation, the folder picker — match. A light app throwing a black modal is
the giveaway that a theme was bolted on afterwards.

#### Switching it

The switch is a **circular sweep from the button that was pressed**, using the
View Transition API: Chromium snapshots the old frame and the new one, and CSS
animates between them. Changing every colour in the window on a single frame
reads as a glitch; a reveal that grows from where the pointer just was reads as
a consequence.

```js
root.style.setProperty('--theme-r', `${radius}px`);   // to the furthest corner
document.startViewTransition(() => apply(mode));
```

```css
html[data-theme-sweeping]::view-transition-new(root) {
  animation: theme-sweep 460ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

Four details that are not decoration:

- **The radius is measured, not guessed.** It is the distance from the button to
  the furthest corner of the window, so the circle finishes covering the screen
  exactly as the animation ends. A fixed radius leaves a corner unswept on a
  wide window and overshoots on a narrow one.
- **The default cross-fade is switched off** (`animation: none` and
  `mix-blend-mode: normal` on both snapshots). Left on, the two themes blend
  through a third one on the way past.
- **`prefers-reduced-motion` skips it entirely**, in JavaScript *and* in CSS.
- **The cleanup does not depend on frames being produced.** `transition.finished`
  is the obvious signal and it is not sufficient: a window that is hidden or
  occluded never animates, so the promise stays pending and the attribute would
  stay set for the life of the window. A timeout is the guarantee and `finished`
  is the fast path. This was found by a test running against `show: false`.

One consequence worth knowing when reading the code: the DOM change now happens
*inside* the transition callback, so `data-theme` lands a frame after the click
rather than synchronously. The smoke test waits for the attribute instead of
sleeping on it.

The selected option is marked by **one pill that slides**, not by a background
that vanishes here and appears there. Equal-width grid columns are what make
that possible without measuring anything: the indicator is one column wide and
moves by whole multiples of itself, so the only thing script says is which index
is active.

### Language

English and Vietnamese, switchable in Settings, applied immediately — to the
window *and* to the notifications, the tray menu and the confirmation in front
of a deletion, which is the text that matters most.

**English is not a dictionary.** The obvious shape is two tables with every
sentence behind a key, and it was rejected: it moves the app's prose out of the
files that use it, and in a codebase where the writing is the feature that costs
more than it saves. English stays where it always was — inline in the markup,
and as the second argument to `t()`:

```js
t('auto.save', 'Save settings')
t('usage.scanned', 'Scanned {n} files.', { n: 1234 })
```
```html
<h2 data-i18n="auto.scheduleTitle">Schedule</h2>
```

Only the other languages are tables. A key with no translation falls back to the
English that is right there in the call, so a half-finished dictionary shows
English rather than `auto.scheduleTitle`, and adding a language never means
touching English again.

| Decision | Why |
| --- | --- |
| One module, loaded by both processes | The main process composes the delete confirmation, the 02:00 notification and the tray menu. A window in Vietnamese with an English "may I delete 2,431 files?" puts the one sentence that must be understood in the language the user just turned off |
| The language travels in the URL, like the theme | The markup is written in English, so an answer arriving over IPC would be a Vietnamese user watching the app translate itself after the first frame |
| `html[data-i18n-pending] body { visibility: hidden }` | Covers the gap between the body being parsed and the DOM pass running. Set only when a translation is actually needed, and cleared in a `finally` — a dictionary that threw must not leave the window permanently invisible |
| The English in the markup is remembered in a WeakMap | It is the fallback, and the translation overwrites it. Without the copy, switching to Vietnamese and back would leave Vietnamese on screen |
| Each screen registers its own redraw | The DOM pass only reaches text that is *in* the markup. A table of results, a toast, a run log — all composed by JS, all have to be composed again |
| Text produced elsewhere travels as a **message**, not a sentence | `{ i18n, en, params }` rather than rendered English. See below |
| Numbers and dates follow the app's language | Not the system locale, which is a different question: this machine formats dates the Vietnamese way while its Windows display language is English |

**"System" follows the display language, not the regional format.** Those are two
settings and Windows answers them separately — `getSystemLocale()` says `vi-VN`
on the development machine while its menus are in English. Following the format
setting would hand somebody a Vietnamese app they never asked for, so
`getPreferredSystemLanguages()` is what gets consulted.

**Vietnamese has to keep the distinctions the English makes.** The whole product
is the difference between *moved to the Recycle Bin* and *freed*; a translation
that renders both as "xoá" is lying where the English is careful. So the
dictionary fixes the terms — **chuyển vào Thùng rác** against **giải phóng** —
and `test-i18n.js` asserts it, alongside the check that matters most: that every
translated string keeps the `{placeholders}` its English has. A dropped `{n}`
does not fail, it silently prints a sentence with the count missing.

Task Scheduler is deliberately *not* translated: it is the name of the Windows
window somebody has to open to find the entry.

#### A sentence is sometimes an object

`t()` renders immediately, which is right when the text is about to be painted.
It is wrong for text produced in one place and read in another, and the first
pass at this shipped both mistakes:

- The scanner's verdicts ("Inside a cache folder — the app rebuilds it on
  demand") are produced in the main process and sit in the window's state until
  the next scan. Rendered at production time, they stay in whatever language was
  current *then*, so switching language left the whole "What to delete" tab in
  the old one.
- A scheduled run's reason is **written to a file**. Rendered, it is English on
  disk forever — and `autoclean-log.json` still read "No settings file was
  found, so there was no configuration to act on." in a fully Vietnamese app.

So producers hand back a message — `{ i18n, en, params }` — and the screen
renders it with `tm()`. The English travels with it, which is what makes the
migration free: a log entry written by an older version is a plain string, and
`render()` passes those straight through.

```js
finish('skipped', m('run.switchedOff', 'Automatic cleanup is switched off'))
```

**The check that finds the ones nobody noticed.** Every other check compares the
dictionary against the keys the app *asks for* — and a sentence that was never
wrapped in `t()` asks for nothing, so it is invisible to all of them. The
dictionary reads as complete while the screen still says "Automatic cleanup is
off." So `test-i18n.js` also works from the other end: it looks at the positions
where text becomes visible (`textContent`, `toast()`, `title`, dialog fields,
`finish()`, `notes.push()`) and fails on any string literal there that did not
come from `t()` or `m()`. It found four on its first run, one of which was a
real bug rather than an oversight — a missing `require` that stopped
application-data folders being detected at all.

### Settings

Appearance, language, and the version live in their own tab. The update card
used to sit in the Automatic tab between the cleanup policy and the disk alerts,
which put "which version am I running" — the first thing anyone reporting a
problem is asked — inside a screen about deleting files on a timetable. Nothing
in Settings changes what the app deletes.

The appearance switch stays in the top bar as well, because it is the one
preference people flip on a whim. Both copies are driven by the same
`[data-theme-choice]` attribute, so they cannot disagree.

The first rule in the file is `[hidden] { display: none !important }`, and it is
there because of a bug that was live for a long time. A browser's own rule is
`[hidden] { display: none }` — an attribute selector, the same specificity as a
class — and because the browser's sheet is ordered first, any class setting
`display` silently beat it. The scan results, the duplicate toolbar and the
schedule's day-of-month row were all on screen while the code believed they were
hidden.

### Picking a target

- Native folder picker.
- One-click buttons for Home, Desktop, Downloads, Documents, Pictures and
  Videos, each labelled with its real path as a tooltip.
- The chosen path is shown elided in the middle, full path on hover.

### Disk usage scan

One breadth-first walk, 16 directories in flight, produces all of the following
in a single pass:

- **Total size, file count, folder count and elapsed time.**
- **Where the space went** — every immediate child of the scanned folder with
  its byte total, file count and share of the whole. Files sitting loose in the
  root are collected into their own `(files in this folder)` row rather than
  being silently dropped. The UI draws the top 12 as bars.
- **By file type** — the 25 largest extensions by total bytes, each with a file
  count; the UI draws the top 12. Extensionless files are grouped under
  `(no extension)`.
- **Largest files** — the top 100 by size (the walk keeps a 200-entry working
  set and trims in batches); the UI lists 50 with checkboxes, a `safe`/`review`
  badge where the advisor has an opinion, the reason behind it, and Reveal /
  Open actions.
- **Cleanup advice** for every file seen (see below).
- **Whether last-access times are real** on this system.

Walk behaviour:

| | |
| --- | --- |
| Symlinks and junctions | Never followed, so no file is counted twice |
| Hidden entries | Skipped — names starting with `.` or `$` |
| System locations | Skipped and reported, never entered |
| Noise folders | `.git`, `node_modules`, `.venv`, `__pycache__` skipped — they would drown out everything actionable |
| Depth | Unlimited, with a hard cap of 100 as a reparse-point-loop backstop |
| Unreadable entry | Recorded in `errors[]` (capped at 500) and the walk continues |
| Progress | Throttled to one event per 120 ms: files so far, bytes so far, elapsed |
| Cancellation | Stops between entries; returns partial results flagged `cancelled: true` |

`followSymlinks`, `ignoreHidden`, `excludeSystem`, `maxDepth`, `concurrency`,
`topFilesKept` and `progressMs` are all options on `scan()`. The UI does not
expose them — it always scans with the defaults — but a script driving
`src/main/lib/scanner.js` directly can change any of them.

### Deletion advice

Every file gets exactly one of four verdicts (`safe`, `review`, `protected`,
`keep`) and lands in one of ten categories: temporary files, caches, GPU &
compiled-code caches, application caches, crash dumps, old log files, build
output, old installers, large archives & disk images, and large & untouched.

Thresholds, all in one place in `advisor.js`: 180 days before "untouched",
100 MB before "large", 30 days before an installer has served its purpose,
7 days before a log is old, 50 MB before an archive is worth reviewing.

What the advisor gives you:

- Groups sorted safe-first, then by bytes reclaimed, each with a label, a
  plain-English hint, the total bytes and file count, and the 100 largest files
  in that category — marked `truncated` when there were more.
- A **reason string per file**, not just per category: *"Not opened in 2.4
  years"*, *"Nothing written to it in 3 months"*, *"Installer downloaded 8
  months ago — the program it installs is unaffected by deleting it"*.
- **`safeBytes` and `reviewBytes`** as separate totals, shown as two stat tiles
  and as a badge on the tab.
- **Protected locations** (up to 200) — system folders skipped during the walk,
  each with the reason it was refused.
- **Application folders** (up to 200) — directories whose contents were
  excluded from advice because they belong to an installed program, each with
  the reason.

All ages in one scan are measured against a single instant, so two files
written a millisecond apart cannot land on opposite sides of a threshold.
Classification runs inside the walk: the expensive part — deciding what a
directory *is* — happens once per directory and is inherited downward, so the
per-file cost is a `Map` lookup and at most two string tests.

The rules themselves, the three-level safety gate that narrows them inside
application folders, and the real breakages that motivated each guard are
documented under [What to delete](#what-to-delete) below.

### Duplicate finder

Byte-identical files across the selected folder, found in three passes that
each feed fewer files to the next: group by exact size (no reads), hash the
first 64 KB, then full SHA256 on the survivors. Files at or below 128 KB skip
the partial pass, where reading the head means reading nearly the whole file.

- **Minimum size** selectable in the UI: 1 KB, 100 KB (default), 1 MB or 10 MB.
- **Persistent hash cache** at `<userData>/hash-cache.json`, keyed on
  `path + size + mtime` with separate entries for the partial and full digests.
  An edited file is always re-hashed. Capped at 50,000 entries, oldest dropped
  first. A missing or corrupt cache starts empty rather than failing, and a
  cache that cannot be written back is a lost optimisation, not an error.
- **Per group**: the digest, the per-file size, the copy count, `wastedBytes`,
  `selectableBytes`, how many copies are program components, how many were
  withheld from bulk selection, and whether every copy is protected.
- **A suggested keeper** — the oldest copy by modified time, ties broken by
  path — tagged `oldest` in the UI.
- **In-use copies stay visible but are never bulk-selected.** A file is marked
  as a program component when its path runs through any of 17 dependency and
  runtime directories (`site-packages`, `venv`, `vendor`, `.cargo`, `.nuget`,
  `gems`, `wheels`, …), when it is inside a protected system root, or when it
  carries one of 15 loadable-binary extensions (`.dll`, `.pyd`, `.so`,
  `.dylib`, `.jar`, `.node`, …). Tick them by hand if you know better — the
  guard only governs bulk selection.
- **Two totals, reported separately**: `reclaimableBytes` (every duplicate
  byte) and `selectableBytes` (what "select all but the oldest copy" would
  actually take). The status line spells out the gap and how many copies were
  held back.
- **Statistics** for every run: files indexed, candidates after the size pass,
  candidates after the partial pass, files hashed, bytes hashed and cache hits.
- **Named progress phases** — Indexing files → Grouping by size → Comparing
  file heads → Verifying full contents — with counts and elapsed time.
- **Cancellable** at every pass boundary and mid-hash; partial results come
  back flagged.
- Files that cannot be read are recorded individually and the search continues.
- The UI renders the 300 largest groups; the underlying result holds all of them.

Note that the walk skips `.git`, `node_modules`, `.venv` and `__pycache__`
outright, so duplicates inside those trees are never indexed in the first
place. The program-component guard covers everything else that *is* walked —
`venv`, `site-packages`, `vendor`, `.cargo`, loose `.dll`s and so on.

### Deleting

Three separate places can start a delete — largest files, cleanup suggestions,
and duplicates — and all three drive one shared progress panel.

**Phase 1, check.** One `lstat` per path, vetting it against every guard, with
progress reported because vetting 200k paths is itself slow enough to look like
a hang. Refused: anything that is not a non-empty absolute path (tested against
the caller's own string, before resolution, so a relative path can never slip
through), a drive root, the home folder, a system location, anything inside a
per-user installed application, a path that no longer exists, and directories
unless `allowDirectories` is set. Repeated paths in one request are collapsed
silently rather than failing the second copy.

**The permission probe.** Files belonging to installed programs carry ACLs that
deny deletion, and Windows answers each one with a *modal* "you'll need to
provide administrator permission" prompt — per file. The check phase finds them
first with a single `open(path, 'r+')` per path, eight at a time, so the prompt
never appears. Files held open by another program are detected the same way and
counted separately. Read-only files are excluded from the probe: they recycle
perfectly well, so flagging them would be a false positive.

**The confirmation.** A native dialog stating the exact item count and bytes
freed, plus how many files were skipped for needing administrator permission or
being in use — and, whenever the job is expected to exceed 30 seconds, an
up-front duration estimate, so the decision is made before the wait rather than
during it.

**Phase 2, move.** Items go to the Recycle Bin one at a time via
`shell.trashItem`, with an event after each: count done, bytes freed, live
files-per-second computed over a trailing 50-item window, an ETA, and the
current path. Events are throttled to 150 ms with a forced exact final frame.

Throughout:

- **Nothing is ever permanently deleted.** Every removal is recoverable from
  the Recycle Bin.
- **Stop is safe at any point.** Everything already moved stays in the bin and
  the summary says how many items were left untouched.
- **One bad path never aborts the batch** — it is reported in `failed` and
  skipped.
- **Other delete buttons are disabled** while a delete runs.
- **A `dryRun` option** vets everything and reports exactly what would move
  without touching a single file.
- After a successful delete the views update in place: cleanup groups shrink
  and their totals are recomputed, duplicate groups that no longer have two
  copies disappear, and a toast summarises what moved, how long it took, how
  much was freed and what was skipped and why.

### Working with individual files

Every file row in every tab offers **Reveal** (show in Explorer) and **Open**
(launch with the default program), and shows its size, elided path with the
full path on hover, and an age line.

### Honest timestamps

Windows can be configured not to record last-access times, and when it is off
every file's atime simply equals its mtime — a "last opened" column would be
fiction. The app probes the real setting with
`fsutil behavior query DisableLastAccess` once per process, in parallel with the
walk, and reports the answer. When access times are not tracked, or could not
be determined, the UI shows a banner explaining it and relabels every date
"Modified". On non-Windows platforms the app reports the relatime caveat
instead.

### Bulk selection

| Tab | Selection tools |
| --- | --- |
| Disk usage | Per-file checkboxes on the 50 largest files |
| What to delete | *Select everything marked safe* (skips every `review` group), *select all* per category, *Clear selection* |
| Duplicates | *Select all but the oldest copy* (skips program components and toasts how many it left alone), *Clear selection* |

Both bulk tabs show a live `n selected · total bytes` readout, and the delete
button stays disabled until something is ticked.

### Scripts

Standalone harnesses in [scripts/](scripts/). The unit suites need no Electron.

The Electron-based ones call `app.setName()` first. Running
`electron scripts/foo.js` does not read the project's `package.json`, so Electron
falls back to the name "Electron" and `getPath('userData')` points somewhere the
real app never touches — a harness that backs up and restores settings would
otherwise be guarding the wrong directory entirely.

| Script | What it does |
| --- | --- |
| `npm test` | Runs the twelve unit suites below in sequence |
| `test-duplicate.js --fixture` | Builds a tree where one pair is identical, one pair is same-size-different-bytes, and one file shares its first 64 KB but differs at the tail — so the partial pass must pass it and the full hash must reject it |
| `test-advisor.js` | One file per classification rule, back-dated with `utimes` and made sparse so a large fixture costs no disk, then checks each landed in the right bucket |
| `test-protection.js` | Eight real paths that must be guarded and several that must not, taken from a screenshot of the app suggesting exactly the wrong thing |
| `test-appsafety.js` | Regression fixtures for the three real breakages: a VS Code-shaped install, a Roaming chat-client data folder, and an app recognised only by the shape of its data directory |
| `test-trash.js` | Guard tests against a fake `shell`, so nothing real is deleted |
| `test-trash-progress.js` | Progress events, live ETA and mid-run cancellation, against a fake `shell` with an artificial delay |
| `test-settings.js` | The settings file treated as hostile input: review categories smuggled into the auto-delete list, out-of-range thresholds, relative paths, ambiguous times, corrupt JSON, and concurrent saves |
| `test-recyclebin.js` | Written from the attacker's side — a forged ledger naming a precious file, a bin item the user deleted themselves, the same path deleted at a different moment, an item still inside the grace period, and one outside the enumerated bins. All must survive |
| `test-autoclean.js` | The gates that stop an unattended run: verdict, category, age (taking the *later* of atime and mtime), whitelist, path guards, per-run cap, disk threshold, and an open application |
| `test-scheduler.js [--live]` | Task XML content, the interval repetition, schedule round-tripping and next-run arithmetic offline; with `--live`, registers a real task **under a suffixed name** and removes it again. The suffix is itself asserted: this suite used to run against the real task name and unregister whatever the person running it had configured |
| `test-history.js` | Mostly assertions that *no* number is produced: one data point, five days of data, a flat disk, a shrinking disk, a disk too erratic to extrapolate, and a folder scanned only once. Plus which volume the chart opens on, and the sampler's half-hour coalescing |
| `test-i18n.js` | The dictionary against the source: every key the app asks for has a translation, every translation keeps the placeholders its English has and invents none, nothing in the dictionary is dead, and *moved* and *freed* are still two different words in Vietnamese |
| `test-monitor.js` | Ten consecutive readings above the threshold must yield one alert, not ten; rounding noise around the threshold must yield none; a level crossed during a snooze must not be announced when the snooze ends. Plus the runtime PNG encoder |
| `test-scanner.js "C:\path"` | Scans any real folder from the CLI and prints the summary |
| `test-permission.ps1` | Sets genuine Windows ACLs on throwaway files, then checks `planTrash` classifies each one correctly *without* triggering the shell's admin prompt |
| `smoke.js` | Boots the real app — real preload, real IPC, real renderer — clicks its own buttons and reads the rendered DOM back out. Redirects `userData` to a temp directory and suffixes the task names first, and asserts both: it used to delete and restore the real files, and its settings save unregistered the real Windows task |
| `verify-appearance.js` | Switches language in a real window and reads the DOM back: the tabs, headings and tooltips change, the English returns when you switch back, and the theme sweep starts from the button and cleans up after itself |
| `verify-schedule.js` | Drives the real Schedule and Trends screens: the interval schedule round-trips to a real settings file, the task card reports what Windows holds, and "Measure now" records a real measurement. Registers nothing — every Task Scheduler call it makes is a query |
| `verify-trash.js` | Moves one throwaway probe file to the real Recycle Bin and verifies it left the filesystem |
| `verify-autoclean.js` | The whole chain on real files: an unattended run takes them, they are found in the actual Recycle Bin under their original paths, exactly those are purged, and the free-space figure moves. Shows plainly that moving to the bin freed nothing |
| `verify-monitor.js` | Starts the real tray against the real disk and prints what it costs in resident memory, so the figure quoted below is measured rather than claimed |
| `bench-trash.js` | Measures `shell.trashItem` throughput sequentially and 8-way concurrent, then purges exactly the files it created |
| `bench-batch.ps1` | Measures batched `SHFileOperation` throughput via P/Invoke, for comparison |
| `build.js` | Generates the .ico and packages the app into `dist/` |
| `verify-install-location.js` | Copies a build elsewhere, points the scheduled task at a path that does not exist, and checks the app repairs it |
| `verify-updater.js` | Asserts when the updater may run at all, then serves a local feed announcing a newer version to prove it would notice a release |

### Platform

Written for Windows and exercised there. `util.js` carries POSIX branches for
the protected-root and program-install lists, and `shell.trashItem` is
cross-platform, but the Roaming/AppData guards and the last-access probe are
Windows-only by construction. [Unverified] The app has not been run on macOS or
Linux in this repository's history, so nothing is claimed about behaviour there.

### What it deliberately does not do

- **No shred, no force, and no "empty the Recycle Bin" button.** There is
  exactly one permanent deletion path, described under
  [Automatic cleanup](#automatic-cleanup): it is off by default, it only ever
  touches items this app itself moved to the bin, each one has to be
  corroborated by the bin's own metadata, and each has to have sat there longer
  than a grace period the user sets.
- **No folder deletion from the UI.** `allowDirectories` exists on the library
  API but the renderer never sets it.
- **One root folder at a time** in the UI, though `findDuplicates` accepts an
  array of roots.
- **No background service and no resident timer.** The scheduled cleanup is a
  Windows Task Scheduler entry that starts the app, does its work with no
  window, and exits. Nothing of this app stays running.
- **No file contents are ever executed, parsed or interpreted** — only hashed.
  The one binary format it reads is the Recycle Bin's own `$I` metadata record.
- **One network request, and it is switchable.** This used to read "no network
  access of any kind", and that was worth more than it sounds: a tool that
  deletes your files and never phones home is easier to trust. Auto-update
  costs some of it back. What is left of the guarantee:
  - The renderer still has none — the CSP forbids it outright, so nothing the
    UI displays can reach the network.
  - The main process contacts exactly one host, the release feed, and sends
    nothing but the request needed to fetch it. No identifiers, no usage data,
    no telemetry, no crash reporting.
  - Switching update checks off means no requests are made at all.
  - The scheduled cleanup never checks. A 2am maintenance task that replaced
    the application binary is not something anyone asked for.
- **Four files are written outside the Recycle Bin**: the hash cache, plus
  `settings.json`, `trash-ledger.json` and `autoclean-log.json` under the app's
  userData directory.

### Current limitations

- No installer and no code signing. `npm run build` produces a folder to copy,
  and Windows SmartScreen warns on first run because the executable is unsigned.
- Symlink detection relies on `dirent.isSymbolicLink()`; the depth cap of 100
  is the backstop if a Windows reparse point is ever reported as a plain
  directory.
- Display caps: 300 duplicate groups, 50 largest files, 50 protected-location
  rows, 100 files per cleanup category (the last is flagged in the UI).
- Scanning `C:\` under-reports the drive's real usage, because protected system
  locations are excluded by design; the status line says how many were left out.
- Cancelling returns partial results, flagged `cancelled: true`.
- The theme is light, dark, or system; there is no high-contrast mode and no
  way to change the accent.
- Scheduling and the selective Recycle Bin purge are Windows-only. On other
  platforms the Automatic tab loads, configures and runs by hand, but registers
  nothing and purges nothing.
- Moving the app relocates the executable the scheduled task points at. The app
  notices on next launch and re-registers, but the runs between the move and the
  next launch do not happen.
- The scheduled task runs under `InteractiveToken`, so it only fires while
  somebody is logged on. A machine left at the login screen at 02:00 runs the
  cleanup at the next opportunity instead, not at 02:00.
- [Inference] Purging removes the `$R`/`$I` pair directly. If Explorer has the
  Recycle Bin open at that moment it may show stale entries until refreshed;
  this has not been observed to cause anything worse.
- Trends need history, and history starts empty. A fresh install shows "not
  enough measurements" for the first week and there is no way around that —
  which is the point.
- Disk monitoring watches the volumes derived from the folders listed, not every
  drive on the machine. There is no volume enumeration: probing drive letters
  can block for a long time on a disconnected network drive.
- Volume usage is sampled, not subscribed to. A drive that fills and empties
  between two checks leaves no trace in the history and raises no alert.
- The **Automatic** tab is now long. Scheduling, cleanup policy, disk alerts and
  the Recycle Bin purge all live there; it would be better split.

## Run

```bash
npm install
npm start          # or: npm run dev   (opens DevTools)
```

## Distributing it

```bash
npm run build           # installer + unpacked folder
npm run build -- dir    # unpacked folder only, for local testing
```

| Artifact | Size | What it is |
| --- | --- | --- |
| `dist/CleanDrive-Setup-<version>.exe` | ~76 MB | The single file to hand out |
| `dist/win-unpacked/` | ~269 MB | The installed layout, for testing without installing |

The installer is an **assisted NSIS wizard**, not a one-click install and not a
self-extracting portable executable. Both of those alternatives were rejected
for reasons specific to this app:

- **One-click** picks the location for you. This is shipped to people whose
  drive layout nobody here knows about, and "small C:, large D:" is the normal
  case among the users it is aimed at. The wizard suggests a location and lets
  them change it.
- **Portable** unpacks itself to a temporary directory on every launch, so
  [Inference] `process.execPath` differs each time. The automatic cleanup
  registers a Windows scheduled task, and a scheduled task stores an absolute
  path — a portable build would point it at something that no longer exists
  within minutes of being created.

It installs per-user by default, into `%LOCALAPPDATA%\Programs`, so there is no
administrator prompt. The wizard still offers "for all users", which does
prompt. Uninstalling leaves `settings.json`, `history.json` and the trash ledger
behind: they are small, and silently discarding someone's cleanup history
because they reinstalled is not this app's style.

### Installing anywhere, and moving it afterwards

The scheduled task problem does not go away just because the path is stable at
install time. Someone can install to `D:\Tools`, or move the folder later, and
the task would go on pointing at where the app used to be — failing every week,
in the background, while the settings screen cheerfully reports the next run
time.

So on every launch the app reads the registered command back out of Task
Scheduler and re-registers when it no longer matches this executable. Reading it
back uses the XML form, because `<Command>` is an element name rather than a
translated column heading, and that document is UTF-16 — decoding it as UTF-8
yields interleaved NULs that no pattern matches.

`npm run verify:install` proves it end to end: it copies a built app to another
location, registers a task pointing at a path that does not exist, starts the
copy, and checks the task now points at what actually ran.

### The icon

Generated, not committed. `scripts/build.js` calls the same module that draws
the tray gauge to produce `build/icon.ico` at every size from 16 to 256, so the
repo holds no binary assets and the installer, the taskbar and the mark in the
window's own header cannot drift apart.

### Auto-update

Off the shelf, via `electron-updater` against GitHub Releases — the app's first
and only runtime dependency, and its first network request. What that buys and
what it costs is set out under "What it deliberately does not do"; the rules it
follows are:

| Rule | Why |
| --- | --- |
| Check, download, install are three separate clicks | Replacing the binary follows the same rule as deleting a file: nothing happens on its own |
| Never during a scheduled run | A 2am task has no window in which to ask, and silently swapping the executable mid-cleanup is the worst possible moment |
| Off in a development build | There is no feed to check, so it says "not applicable" instead of showing an error every launch |
| Feed derived from `package.json`'s `repository` | A fork that forgot to change it would otherwise poll someone else's releases. With no `repository` field, no feed is baked in and the app simply never checks |
| One check on startup after 8 seconds, then every 6 hours | Updates are not urgent, and a check racing the first paint makes the app feel slower for nothing |

**Releasing.** `npm run build` writes two files that both have to be attached to
the GitHub release: `CleanDrive-Setup-<version>.exe` **and `latest.yml`**.
The `.yml` is the feed — without it, installed copies have nothing to read and
updates silently never appear.

**Auto-update without code signing is a real trade-off.** electron-updater
verifies the downloaded installer's signature against the installed app's
publisher; with neither signed, that check does not happen. The only thing
standing between a user and a malicious update is HTTPS to the release host.
That is the same trust people already place in a download link, but it is now
exercised automatically rather than each time they decide to update. The
confirmation dialog says so plainly rather than implying a guarantee that is not
there.

### Hosting the download

Nothing here uploads anything; `npm run build` produces files and stops. The
usual place for a link people can click is **GitHub Releases** — create a
release, attach `CleanDrive-Setup-<version>.exe`, and the asset gets a permanent
public URL. electron-builder can also publish automatically, and its
`publish` configuration is where that would go.

### Code signing

The build is **unsigned**, and Windows SmartScreen warns on first run: *"Windows
protected your PC"*, with the Run-anyway button hidden behind **More info**.
Every download will meet that screen until a certificate is in place.

[Unverified] The options below are from a September 2026 search, not from
running any of them. Prices and eligibility change.

| Option | Cost | Catch |
| --- | --- | --- |
| **Certum Cloud Code Signing, individual** | ~$49.99 | Individuals only, and **not for commercial software**. No hardware token — signing runs through their cloud service |
| **Certum Open Source Code Signing** | ~€69 first year, ~€29 renewal | Ships a smartcard and reader. Needs identity verification and the URL of an active open-source project |
| **OV certificate** from a commercial CA | ~$200–300/year | Works for commercial software. Since 2023 the private key must live on a hardware token or cloud HSM — no downloadable `.pfx` |
| **Microsoft Azure Artifact Signing** (formerly Trusted Signing) | $9.99/month, 5,000 signatures | **Region-limited.** Businesses in the US, Canada, EU and UK; individuals in the US and Canada only. Not available from Vietnam |

Two things worth knowing before paying for the expensive one:

- **EV certificates no longer bypass SmartScreen.** That behaviour was removed
  in 2024; an EV-signed file now builds reputation exactly as an OV-signed one
  does. Paying the EV premium *solely* to skip the warning no longer buys
  anything.
- **Signing does not remove the warning immediately.** Reputation accrues with
  downloads over time. What signing does buy straight away is the publisher
  name on the prompt instead of "Unknown publisher", and that the warning
  eventually stops.

Nothing in `scripts/build.js` needs to change to sign. electron-builder already
reads `CSC_LINK` and `CSC_KEY_PASSWORD` from the environment, so a machine that
has a certificate produces a signed build and a machine that does not produces
an unsigned one rather than failing. Token-based and cloud certificates need
their CA's own signing tool wired in as a custom step.

## How the duplicate finder works

Three passes, each one feeding fewer files to the next:

1. **Group by size** — no file reads at all. Files with a unique size cannot
   have a duplicate, so most of the tree is eliminated for free.
2. **Hash the first 64 KB** — separates same-size-different-content files
   cheaply. Skipped for files under 128 KB, where a partial read is nearly the
   whole file anyway.
3. **Full SHA256** — only for what survives pass 2. This is what actually
   decides identity; pass 2 is only a filter.

Measured on ~12,800 files (5.6 GB): 12,831 indexed → 8,780 same-size →
8,778 after partial → 70 confirmed groups, 102 MB reclaimable, 5.5 s cold.

Hashes are cached in `<userData>/hash-cache.json`, keyed on
`path + size + mtime`, so an edited file is always re-hashed. Second run on the
same folder: 0.55 s, 0 files hashed, identical results.

### "Identical" is not the same as "redundant"

Two virtualenvs each holding their own copy of `torch/lib/cusparse64_12.dll` are
byte-identical and both necessary. Deleting one breaks that environment. The
same is true of `node_modules`, `vendor`, `.cargo`, and of `.dll`/`.pyd`/`.so`
files generally — each is resolved from its own application's directory.

These copies are still listed, but they carry an **in use** badge with the
reason, and `select all but the oldest copy` refuses to tick them. Two totals
are reported: `reclaimableBytes` (every duplicate byte) and `selectableBytes`
(what bulk-selection would actually take). Measured across three real project
trees on this machine: 499 MB reclaimable, but only **110 MB** safe to
bulk-delete — 689 of 1,063 deletable duplicates held back.

Tick them individually if you know better; the guard only governs
bulk-selection.

## What to delete

Every file gets one of four verdicts. Only the first two are ever suggested.

| Verdict | Meaning |
| --- | --- |
| `safe` | Regenerable junk. Deleting it costs nothing but disk churn. |
| `review` | Big or long-untouched. Plausibly deletable, but only you know. |
| `protected` | Refused by the delete guards. Shown so you can see *why*. |
| `keep` | Everything else. Never suggested, never counted. |

Rules, in the order they fire:

| Category | Verdict | Rule |
| --- | --- | --- |
| Temporary files | safe | Inside `Temp`/`tmp`, or `.tmp` `.bak` `.partial` `.crdownload`, or a `~$` editor lock file |
| Caches | safe | Inside `Cache`, `Code Cache`, `GPUCache`, `CacheStorage`, … |
| Crash dumps | safe | `.dmp` `.mdmp`, or inside `CrashDumps`/`Minidump`/`Crashpad` |
| Old log files | safe | `.log`, or inside `logs/`, **and** nothing written to it in 7 days |
| Build output | safe | Inside `obj`/`bin`/`dist`/`build`/`target` **whose parent holds a project marker** |
| Old installers | review | `.exe` `.msi` `.msix` in a Downloads folder, 30+ days old |
| Large archives & disk images | review | `.zip` `.iso` `.vhdx` `.vmdk` … at 50 MB or more |
| Large & untouched | review | 100 MB or more and not opened in 180 days |

The build-output rule is deliberately narrow. `bin` is a compiler's output
directory inside a project and an *installed program's executables* everywhere
else — an earlier version of this rule flagged a real toolchain's `clang.exe`
and `liblldb.dll` as disposable. The parent directory now has to hold a project
marker (`package.json`, `Cargo.toml`, `*.csproj`, `pom.xml`, `Makefile`, …)
before anything below it counts as build output. The marker check reuses the
directory listing the walk has already read, so it costs no extra syscalls.

Classification runs during the walk, not as a second pass: deciding what a
directory *is* happens once per directory and is inherited by everything
beneath it, so per-file cost is one `Map` lookup and at most two string tests.

### Installed applications and roaming app data

Two rules above are dangerous on their own, and both caused real damage before
these guards existed:

**An application's `out\` is its product, not scratch.** VS Code ships
`resources\app\package.json`, so `looksLikeProject` returned true and the
sibling `out\` matched the build-output rule — the editor's entire compiled
JavaScript was listed as safe to delete. Deleting it gives
`ERR_MODULE_NOT_FOUND` and an unusable install.

**An app's `Cache\` is not a browser cache.** `AppData\Roaming\ZaloData`
contains `Cache`, `Code Cache`, `GPUCache` and `logs` alongside `Local Storage`
and `Database`. Those names matched the cache and log rules, so a chat client's
live state was listed as safe to delete.

Both are now blocked by a sticky flag carried down the walk. Once inside either
kind of location, **nothing below may be classified `safe`**, whatever it is
named. Review verdicts still apply — they are never auto-selected — so a large
VM disk inside an app folder is still reported.

A location is blocked when any of these holds:

| Test | How |
| --- | --- |
| Installed application | the listing holds an uninstaller (`unins*.exe`), or an `.exe` beside a `resources`/`locales` folder |
| Per-user install root | the path runs through `AppData\Local\Programs`, `Microsoft\WindowsApps` or `WinGet` |
| Roaming app data | the path runs through `AppData\Roaming` |

The last two are matched as **path patterns, not against `%APPDATA%`**: this
machine carries two profile trees (`C:\Users\x` and `D:\Users\x`) and only the
pattern catches the second.

`AppData\Local\Programs` is also refused by the delete guards outright, so a
manual tick cannot remove part of an installed application either.

Effect on this machine: `AppData\Roaming` went from offering cleanup to
**0 bytes safe**, and `AppData\Local` from 25.5 GB to **10.0 GB**, with 33
application folders excluded from advice. The 15.5 GB difference was inside
installed applications.

Windows' own convention is that disposable data belongs under `Local`, so
treating everything in `Roaming` as load-bearing costs little real cleanup and
removes a whole class of breakage.

### Applications this tool has never heard of

The two breakages above were fixed by recognising *shapes*, not names — a list
of known apps would only ever protect the apps on the list.

A third, worse case has no name to match at all. Chromium and every Electron app
store Local Storage and IndexedDB in LevelDB, whose write-ahead log is literally
called `000003.log`. The "log files older than a week are safe" rule ate it, and
that file holds real user data: logins, settings, drafts. This affects every
Chromium-based program — browsers, chat clients, editors — including ones that
did not exist when these rules were written.

So classification is narrowed by *where* a file is, in three levels:

| Level | Where | What may be called `safe` |
| --- | --- | --- |
| `none` | ordinary user folders | the rules as written |
| `app` | inside a program's data folder | only GPU/shader/bytecode caches and crash dumps — never anything matched by file name |
| `hard` | inside an installed app, a per-user install root, or `AppData\Roaming` | nothing |

A folder is recognised as application data by its own contents: `Local Storage`,
`IndexedDB`, `Cookies`, `Preferences`, `Local State`, `leveldb`, a `.sqlite`
file, and so on. No app names are involved, so it applies to software released
after this was written.

Inside such a folder:

- **File-name rules are switched off entirely.** `.log`, `.tmp`, `.bak` and
  `.dmp` mean whatever that program decided they mean.
- Directories named `Local Storage`, `Session Storage`, `IndexedDB`, `leveldb`,
  `databases`, `Network`, `Service Worker`, `blob_storage` (and anything ending
  `.leveldb`/`.indexeddb`) are live state — nothing below them is ever touched.
- `GPUCache`, `ShaderCache`, `DawnCache`, `Code Cache`, `Crashpad` stay safe.
  These are compiler and GPU artifacts that Chromium regenerates on next launch.
- A plain `Cache` folder is **downgraded to review**, not deleted. It is usually
  disposable, but only that program knows what it keeps there, so it is shown
  and explained and never selected for you.

Cumulative effect on `AppData\Local` for one real user: **25.5 GB → 10.0 GB →
6.4 GB** classified safe, as the install guard and then the app-data guard were
added. 1.6 GB moved from "safe" to "Application caches (review)".

### What this does and does not promise

It does not promise that no application can ever break. These are heuristics
over third-party layouts, and any program is free to keep irreplaceable data in
a folder called `Temp`. What the design does is make the failure direction
*not cleaning something* rather than *deleting something live*:

- Unknown territory defaults to `keep`, not `safe`.
- `review` items are shown with a reason and are never selected in bulk.
- Deletion goes to the Recycle Bin, never permanent.
- The delete guards refuse system and installed-application paths outright,
  even if a file is ticked by hand.

The regression suite in `scripts/test-appsafety.js` locks in the three cases
above, including one for an application identified only by the shape of its
data folder.

### Last-opened dates

Windows can be configured not to record last-access times, and when it is off
every file's atime simply equals its mtime — a "last opened" column would be
fiction. The app probes the real setting
(`fsutil behavior query DisableLastAccess`) once per scan and reports it in
`result.accessTimes`. When access times are not being tracked the UI says so in
a banner and labels every date "Modified" instead of "Last opened".

Be aware that even with tracking on, atime is noisy: search indexers, antivirus
and backup tools read files and bump the date. That is why the log rule is
judged on *modified* time, and says so in its reason text.

### Protected locations

Directories skipped as system locations are reported in
`result.cleanup.protectedPaths` and listed under "Never deleted", each with the
reason it was refused. Scanning `C:\` reports eight:

```
$Recycle.Bin                 Windows owns this folder
Config.Msi                   Windows owns this folder
Program Files                Operating system or installed programs live here
Program Files (x86)          Operating system or installed programs live here
ProgramData                  Operating system or installed programs live here
Recovery                     Windows owns this folder
System Volume Information    Windows owns this folder
Windows                      Operating system or installed programs live here
```

Because these are excluded, a `C:\` scan total is smaller than the drive's real
usage. The scan status line says how many locations were left out.

## Deleting, and how long it takes

Deletion runs in two phases so the UI can show honest progress instead of
freezing:

1. **Check** — one `lstat` per path, vetting it against every guard. Produces a
   plan of what would actually move plus a list of refusals. Reports progress,
   because vetting 200k paths is itself slow enough to look like a hang.
2. **Move** — walks the plan one item at a time, emitting a progress event after
   each: count, bytes freed, live rate, ETA and the current path.

Splitting them halves the syscalls — the old code vetted every path twice (once
for the confirmation preview, once for the real run) and stat'd each file twice
within each pass.

A single shared progress panel is driven by all three delete paths (largest
files, cleanup suggestions, duplicates). It shows a determinate bar, `n of N`,
bytes freed, files/sec, an ETA, and a **Stop** button. Stopping is safe at any
point: everything already moved stays in the Recycle Bin, and the summary says
how many were left untouched.

### Throughput

Measured on this machine (Windows 11, Electron 33, `npm run bench:trash`):

| Method | Rate | 200,000 files |
| --- | --- | --- |
| `shell.trashItem`, sequential | 28 files/s | ~118 min |
| `shell.trashItem`, 8-way concurrent | 33 files/s | ~101 min |
| `SHFileOperation`, one batched call | 158 files/s | ~21 min |

Concurrency is nearly useless here — the Windows shell serialises the operation
internally, so eight-way parallelism buys 17%. The app therefore deletes
**sequentially on purpose**: it is within noise of the concurrent rate and it
keeps progress ordering, per-file error attribution and instant cancellation.

Because a large delete genuinely takes this long, the confirmation dialog states
the estimate up front (`ESTIMATED_FILES_PER_SEC` in `trash.js`) whenever the job
is expected to exceed 30 seconds, so the decision is made before the wait, not
during it.

The batched `SHFileOperation` path is **not implemented**. Beyond giving up
per-file error reporting, measurement found a disqualifying property: the batch
**stops at the first failure**. With four files where the second is undeletable,
the first is recycled and *both files after it are left behind* — so one
protected file in a chunk silently strands the rest. Recovering from that needs
a resume-after-error loop that degrades to one shell call per file in the worst
case. `npm run bench:batch` measures the speed if you want to revisit the trade.

### "You'll need to provide administrator permission"

Files belonging to installed programs carry ACLs that deny deletion. Windows
answers `shell.trashItem` on one of those with a **modal prompt, per file** —
2,700 selected files means up to 2,700 interruptions, each one stalling the run.

The check phase now detects these before anything is attempted, so the prompt
never appears. The probe is one `open(path, 'r+')`: opening for write is what
actually consults the ACL. Two details make it correct rather than merely
plausible:

- **`fs.access(path, W_OK)` cannot do this job.** On Windows it reports success
  for a file whose ACL denies everything — it only reflects the read-only
  attribute. Verified directly: the ACL-denied file returns `null` from
  `access` and `EPERM` from `open`.
- **The read-only attribute is not an ACL denial.** Read-only files recycle
  perfectly well, so flagging them would be a false positive. They are told
  apart by the write bit in `stats.mode`.

The probe costs one open/close per path (~5,000 files/s, so ~40s for 200k, run
8-way concurrent) and the results are reported before the confirmation dialog:
*"N files belong to an installed program and need administrator permission —
they are skipped, not deleted."* Files held open by another program are
detected the same way and reported separately.

## Automatic cleanup

### The problem this had to solve first

A scheduled cleaner that moves files to the Recycle Bin **frees no disk space**.
The bin is on the same volume; the bytes are still there. Reporting "freed
2.3 GB" after such a run would be the most misleading thing this app could say.

That is not a detail — it is load-bearing. It means "run every Sunday at 2am and
wake up with a tidier disk" cannot be built on `shell.trashItem` alone, and the
app had always refused to empty the bin. `verify-autoclean.js` demonstrates it
on real files: 12 files moved to the bin, free space before and after
**identical**, and only the purge returns the space.

So the app gained exactly one permanent-deletion path, scoped as narrowly as it
could be. An item is removed only if **all four** hold:

1. it physically sits inside a Recycle Bin folder the app enumerated;
2. the bin's own `$I` metadata says it came from a path in
   `trash-ledger.json` — the record of what this app moved there;
3. the bin's recorded deletion time agrees with the app's, within five minutes,
   so a file the user deleted themselves is never mistaken for one of ours *even
   at the same path*;
4. it has sat there longer than the grace period, so "restore from Recycle Bin"
   genuinely worked for that whole window.

The ledger alone is never enough. It is a claim; the bin's metadata is the
evidence. A hand-edited ledger naming `thesis.docx` purges nothing.

### What an unattended run will and will not touch

Every ambiguity resolves towards doing nothing, because there is no dialog in
front of this to catch a mistake.

| Gate | Rule |
| --- | --- |
| Verdict | Only categories the advisor calls `safe`. `review` never runs unattended, whatever the settings file says — the check is repeated at the point of deletion |
| Category | Only the subset the user enabled. `buildoutput` is safe by the advisor's rules but off by default: "safe to delete" and "safe to delete at 2am" are different bars |
| Age | Untouched for at least *N* days, taking the **later** of access and modification time — a file written a year ago but opened yesterday is in use |
| Whitelist | Nothing under a listed folder, on top of the system guards that already apply |
| Running apps | If any named process is open, the whole run is skipped. If the app cannot determine what is running, it also skips — failing closed |
| Disk pressure | Optionally, only run when the volume is over *N*% full |
| Cap | At most *N* files per run, largest first |

A new schedule starts in **report-only** mode. The first run tells you what it
would have taken; you decide whether to let it.

### Why it is a Task Scheduler entry and not a timer

A resident background process is one the user eventually kills, after which the
cleanup silently stops. The OS already owns a scheduler that survives reboots,
so the app registers a task there and exits.

Registration goes through task XML rather than `schtasks` flags for one reason:
`StartWhenAvailable`. A 02:00 cleanup on a laptop that is asleep at 02:00 would,
with the flag form, simply never run and never say so.

Two things had to change in `main.js` for this to work at all, neither obvious
until it is tried:

- **Headless branch.** `--scheduled-run` skips `createWindow()` entirely. A
  cleanup that popped a window open at 2am would be worse than no cleanup.
- **The scheduled run does not take the single-instance lock.** That lock exists
  because two windows would fight over the hash cache; this process never opens
  the duplicate finder. Had it taken the lock, the cleanup would have been
  cancelled outright on any night the user happened to have the app open — a
  maintenance task that looks configured and does nothing.

Nothing parses `schtasks` *table* output. That output is localised — on the
development machine Windows renders times as `9:45 SA` — so existence is taken
from the process exit code, the registered definition is read from the XML form
(element names are not translated), and last/next run times come from
`Get-ScheduledTaskInfo`, whose property names are not translated either.

### The schedule stopped running, and nothing noticed

This is worth recording in full, because the first version of the feature was
correct and still failed.

A cleanup was configured for 02:00 daily. It ran — there is a `source:
"scheduled"` measurement in `history.json` timestamped 02:00:34 to prove it.
Some time later it stopped, and the app went on displaying a next run time for
weeks. Two separate faults, and the second is the one that mattered:

1. **The project's own test suite destroyed it.** `scripts/smoke.js` deleted the
   real `settings.json` and `autoclean-log.json` so its assertions would see a
   fresh install, and saved settings through the real IPC handler — which
   reconciles Task Scheduler on every save, so saving `enabled: false`
   *unregistered the Windows task*. Its `finally` restored the JSON files and
   could not restore the task. `test-scheduler.js --live` had the same problem
   by a shorter route: it called `uninstall()` on the real task name.
2. **Nothing verified anything.** The launch-time check compared only the
   *command* the task launched. A task that had been deleted outright, or left
   holding an older schedule, passed — or rather, was never asked. The next run
   time on screen was computed from `settings.json`, so it stayed plausible
   after the task behind it was gone.

What changed, in order of how much it matters:

- **The tests cannot reach real state.** `smoke.js` redirects `userData` to a
  temp directory with `app.setPath` — every code path still runs for real, the
  data lands somewhere disposable — and both harnesses set
  `CLEANDRIVE_TASK_SUFFIX`, which `scheduler.js` appends to the task names. The
  suffix is asserted in both suites, because a guard nobody checks is a guard
  that quietly stops applying.
- **`verify()` asks Windows.** Existence, the command, *and* the schedule read
  back out of the registered XML and compared field by field
  (`sameSchedule`). Reconciliation runs on launch and on every save, and reports
  what it changed instead of healing silently.
- **A missing settings file is not read as "off".** The defaults say cleanup is
  disabled, so acting on them would delete the task of anyone whose settings
  file vanished — destroying the record of the intent and the mechanism carrying
  it out in one step. `SettingsStore.exists` distinguishes "configured off" from
  "not configured", and the second reports the discrepancy rather than resolving
  it.
- **A failed save can no longer report success.** `SettingsStore.save()` chained
  its write through `.catch(() => {})`. A write that failed resolved as though
  it had worked, and the screen said "Saved. Next run Sunday 02:00" for a
  schedule that was never written down. The error now reaches the caller.
- **The Automatic tab shows the OS's own account**: the registered task name,
  whether it matches the settings, Windows' `LastRunTime` / `NextRunTime`, and
  the last run's exit code in words — `0x80070002` reads as "the program it
  launches could not be found — the app has moved", which is the exact silent
  failure the self-repair exists to catch.

  That comes from the `Schedule.Service` COM object rather than
  `Get-ScheduledTaskInfo`, and the reason is measured: the cmdlet version took
  **5.3s for one task and 10.1s for three**, most of it PowerShell autoloading
  the ScheduledTasks module. The COM object is the same API without the module
  — **677ms for three tasks, 537ms for one**. Both report non-localised
  property names; only the speed differs. If COM is unavailable the card still
  shows everything that comes from `schtasks` and reports the rest as
  unavailable.
- **Every scheduled run leaves a trace.** If anything threw before
  `runLog.append`, the run log kept yesterday's entry and 02:00 left no record
  at all. A run that could not start is now logged as a run that could not
  start, with `outcome: 'error'`, and that one does raise a notification.

### Watching it work: an interval schedule

"It runs at 02:00 even with the app closed, and after a restart" is a claim
nobody can check without staying up, and it was wrong here for a fortnight. So
the schedule kinds include **every N minutes**, which turns the same claim into
something testable over a cup of coffee: set five minutes, close the app, wait,
reopen it and read the run log.

The mechanics are a `<Repetition>` on the daily calendar trigger with an
`<Interval>` and **no `<Duration>`**, which repeats indefinitely — the shape
several of Windows' own tasks use (OneDrive's updater,
`VerifiedPublisherCertStoreCheck`). The daily trigger re-arms at midnight, so
the interval survives a reboot. Element order inside the trigger is
`StartBoundary`, `Enabled`, `Repetition`, `ScheduleBy*`: this schema is a
sequence, and that is the order Windows itself writes when it exports a task.

Two deliberate limits:

- **An installed build will not accept less than five minutes**
  (`MIN_MINUTES_PACKAGED`), because each run starts a fresh process that scans
  the configured folders — a one-minute interval on somebody else's laptop is a
  scanner that never pauses. A checkout allows one minute.
- **There is no `BootTrigger` anywhere.** The task runs with
  `InteractiveToken`, which cannot start before anyone has logged on, so a boot
  trigger would be a trigger that never fires. "Also run a few minutes after you
  log in" is a `LogonTrigger` with a two-minute delay, on by default for the
  interval kind and opt-in for the appointment kinds — an extra cleanup at every
  logon is not what "every Sunday at 02:00" means.

### Files it writes

| File (under userData) | Contents |
| --- | --- |
| `settings.json` | The policy, plus the chosen theme. Plain JSON, hand-editable, and therefore re-validated and clamped on every load; a corrupt file yields defaults rather than an exception, because the alternative is a scheduled task that silently stops running. Saves are **merged per section**, so a screen that submits only the part it owns cannot reset the rest — which the settings form was doing, silently, on every save. A *missing* file is distinguished from a valid one (`store.exists`), because the defaults say "cleanup off" and acting on that would unregister the task of anyone whose settings file vanished |
| `trash-ledger.json` | What this app moved to the Recycle Bin, and when. Written by manual deletions too — recording is not purging |
| `autoclean-log.json` | The last 50 runs, as the Automatic tab displays them — including runs that failed before they started, which used to leave no trace at all |
| `history.json` | The disk measurements the Trends tab is drawn from, and the moved/freed events |

### Platform

Windows only. `recyclebin.js` and `scheduler.js` both report "unsupported" and
do nothing elsewhere, rather than guessing at a trash layout or a scheduler they
have not been tested against.

## Storage trends

### Why the obvious design does not work

Record a snapshot whenever the user runs a scan, fit a line through the totals,
print "your disk fills in 12 weeks". Every part of that is wrong here.

A scan covers **one folder the user chose at that moment**. Scanning Downloads
on Monday and Users on Friday gives two numbers that are not two points on any
curve, and a regression through them describes nothing. The samples are also
irregular, because scans happen when somebody feels like it.

So the series behind every headline figure is **volume usage**, taken with
`statfs` and recorded on every snapshot regardless of what was scanned — or
whether anything was scanned at all. That number means the same thing every
time. Per-folder history is kept as well, but a folder is only ever compared
against earlier snapshots of *the same root*, and a folder scanned once says
"scanned once" instead of being given a rate of zero.

A cancelled scan is not recorded: its partial totals would put a dip in the
series that never happened.

### Where the measurements come from, and why that had to change

The first version recorded a snapshot after each completed scan, after each
cleanup, and on every scheduled run. Stated that way it sounds sufficient. In
practice the chart was empty, and the reason is worth keeping written down: all
three of those are things a person does when they feel like it. Someone who has
not switched on automatic cleanup and only scans when the machine feels slow
produces three points in six hours and then nothing for a week — a record of
their mood, not of the disk. Worse, the tab gave no hint what would fill it; its
empty state suggested enabling unattended deletion, which is a poor price for a
chart and was not even the quickest way to get one.

A trend needs readings on a timetable, so there are now four samplers, all of
them going through `lib/sampler.js` so there is one definition of what a
measurement is:

| Sampler | When | Runs with the app closed |
| --- | --- | --- |
| `CleanDrive\DiskSample` task (`--sample-only`) | once a day, plus a catch-up after logon | **yes** |
| App start | every launch | no |
| Disk monitor tick | each poll, while monitoring is on | no (the monitor is the app) |
| "Measure now" | when pressed | no |

Plus the existing scan, cleanup and scheduled-run snapshots.

Three decisions inside that:

- **The sampler is its own task, not more work for the cleanup task.** Tying
  them together would have meant "you may have a chart of your disk once you let
  the app delete files unattended".
- **It never starts Chromium.** `--sample-only` does not wait for
  `app.whenReady()`, because `app.getPath` and `fs.statfs` both work before it:
  124ms of measured work, and **672ms for the whole packaged process** from
  launch to exit -- the rest being Electron's binary starting, which no mode of
  this app avoids. No window, no GPU process, and it deletes nothing.
- **It measures the drives the app has a reason to know about** — the home
  volume, the configured cleanup roots, the monitored volumes, and everything
  already in the history — rather than probing A: to Z:, which would spin up
  optical and removable media and add a column for a USB stick plugged in once.
  A volume stays in the set after it leaves the settings, so a series is never
  abandoned half way along.

The half-hour coalescing rule in `addSnapshot` is what makes the dense samplers
safe: the monitor can tick every minute and "Measure now" can be pressed
repeatedly without either manufacturing a trend. Pressing it twice says so
rather than claiming a new point.

**The chart also used to open on the wrong volume.** `report()` picked the first
root alphabetically, which on the development machine was `c:\` with a single
measurement while `d:\` had a series — so a history with plenty of data greeted
the user with "one measurement so far". It now opens on the most-measured
volume, ties going to the most recent.

### Predictions that refuse themselves

`predictFull` returns a reason instead of a number whenever the data does not
support one. Each of these is a case the strategy document would have answered
with a confident figure:

| Situation | What the app says |
| --- | --- |
| One measurement | "Only one measurement so far — trends need at least two." |
| Fewer than 4 points, or under a week of span | "Too little history to be worth reporting: *n* measurement(s) over *d* day(s)." |
| Usage flat or falling | "Usage is flat or falling, so there is nothing to extrapolate." |
| Fit explains under half the variation | "Usage moves too erratically to extrapolate (the trend explains only *n*% of the variation)." |
| Fills in more than two years | "At this rate the disk does not fill within two years." |

Every reported trend carries its own r², sample count and span, and the numbers
that back it are one click away as JSON or CSV.

**Moved is not freed.** The savings table has two columns and they are never
added together: bytes moved to the Recycle Bin are still on the disk, and only
the purge column is space that came back.

### Export is JSON and CSV, not PDF

The strategy document asked for a PDF report. A PDF of a chart is a picture of
the data — it cannot be checked, replotted or joined to anything. Both export
formats hand over the actual measurements instead.

The chart itself is inline SVG built with `createElementNS`. The CSP forbids
loading anything from a CDN, and vendoring a charting library to draw one line
would be more code than the line. Its vertical axis is **scaled to the data, not
pinned to 0–100%**, which is stated under the chart: an 80→82% move is worth
seeing, and it is invisible on a full-height axis.

## Disk alerts

### The resident process, and the contradiction in it

The scheduled cleanup deliberately avoids a resident process, on the grounds
that one the user must not kill is one they eventually kill. This feature is
exactly that. The difference is worth being explicit about: a cleanup has a
*moment* it must happen at, which the OS scheduler can be told about, whereas
"warn me before the disk fills" is a question asked continuously. Task Scheduler
could poll, but waking a whole Electron process every minute to call `statfs`
costs far more than one timer.

So monitoring is **off by default**, and switching it on is what makes closing
the window hide it rather than quit. Measured on the development machine with
`verify-monitor.js`:

| | |
| --- | --- |
| The monitoring machinery itself | ~3.7 MB RSS |
| Keeping the Electron main process alive | ~69 MB RSS total |
| Heap growth over repeated checks | under 0.1 MB |

[Unverified] Those are figures from one machine and one Electron build, not a
guarantee. The strategy document promised "under 100MB in the background"
without measuring anything; this is what it actually costs here.

### Not alerting is most of the work

| Mechanism | Prevents |
| --- | --- |
| Edge triggering | An alert every 60 seconds for as long as the disk stays above the threshold. Ten readings at 88% produce one alert, not ten |
| Hysteresis (2 points) | A disk hovering at 85.0% flipping state on rounding noise and alerting repeatedly |
| Snooze | Being nagged during the hour you are already dealing with it — and, crucially, a level crossed *during* a snooze is recorded but never announced when the snooze ends |
| Unreadable volume | Being treated as either an all-clear or an emergency; the level simply stays where it was |
| Falling edges | A notification for good news |

Snooze is in memory only. It is a statement about the next hour, not a setting,
and a "quiet" flag that survives restarts is one nobody remembers turning on.

Clicking a notification **opens the app**. It does not start a cleanup: a
deletion that began from a notification click, with nothing shown first, is the
kind of thing this app does not do.

### The tray icon is generated, not bundled

An icon showing a fixed logo says nothing, and the point of sitting in the tray
is to answer "how full is the disk" without being clicked. So `trayicon.js`
encodes a PNG at runtime — a ~150-byte gauge, green/amber/red, redrawn only when
the reading actually changes. No binary assets in the repo and no dependency:
a truecolour PNG is a header, one zlib stream and a terminator.

It is drawn with a **dark body and a bright fill** on purpose. The Windows tray
sits on a background the user chooses; a light icon vanishes on one, a dark icon
on the other. The body carries it on a light taskbar, the fill on a dark one,
and the fill colour is the actual message.

## Safety model

- **One narrow permanent-deletion path, off by default.** Every ordinary removal
  goes through `shell.trashItem` and stays in the Recycle Bin. The selective
  purge described above is the sole exception, and it must clear four
  independent checks.
- Paths are vetted in `trash.js` before anything is sent to the OS: must be
  absolute, must exist, must not be a drive root or the home folder, must not be
  inside a system location (`C:\Windows`, `Program Files`, `ProgramData`,
  `$Recycle.Bin`, …), and folders are refused unless `allowDirectories` is set.
- The main process shows a native confirmation dialog stating the item count and
  bytes freed before any real delete.
- A path that fails a guard is reported in `failed` and skipped; it never aborts
  the rest of the batch.
- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, a CSP of `default-src 'none'`, navigation blocked away from
  the bundled files, and no file contents are ever executed or parsed — only
  hashed.

## Scan behaviour

| Question | Answer |
| --- | --- |
| Follow symlinks / junctions? | No. Each file is visited once and sizes are never double-counted. |
| Hidden files? | Skipped (names starting with `.` or `$`). |
| Depth limit? | Unlimited, with a hard cap of 100 as a reparse-point-loop backstop. |
| System folders? | Excluded, plus `.git`, `node_modules`, `__pycache__`, `.venv`. |
| Unreadable folder? | Recorded in `errors[]`, scan continues. |

`UV_THREADPOOL_SIZE` is raised to 16 at the top of `main.js` — the walk is
`lstat`-bound and libuv's default of 4 is the bottleneck.

## Known limitations

- Symlink detection relies on `dirent.isSymbolicLink()`. The depth cap is the
  backstop if a Windows reparse point is ever reported as a plain directory.
- The duplicate view renders at most 300 groups; the underlying result holds all
  of them.
- Cancelling returns partial results, flagged with `cancelled: true`.
- No installer/packaging step yet (`electron-builder` not wired up).
