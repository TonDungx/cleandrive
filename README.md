# CleanDrive

A desktop tool for deciding what to delete from a Windows machine that has run
out of room — and then deleting it safely.

It is not an optimiser and it does not promise to make anything faster. It does
one thing: it shows you what is taking up your disk, tells you what it thinks
about each piece and how confident it is, and then gets out of the way while you
decide. Every removal goes to the Recycle Bin, so every decision is reversible.

The interface reads in English or Vietnamese, including the confirmation dialogs
and the notifications.

---

## Contents

- [The question every screen answers](#the-question-every-screen-answers)
- [At a glance](#at-a-glance)
- [What a session looks like](#what-a-session-looks-like)
- [The shell everything sits in](#the-shell-everything-sits-in)
- [Choosing what to look at](#choosing-what-to-look-at)
- [Screen 1 — Disk usage](#screen-1--disk-usage)
- [Screen 2 — System](#screen-2--system)
- [Screen 3 — What to delete](#screen-3--what-to-delete)
- [Screen 4 — Photos & video](#screen-4--photos--video)
- [Screen 5 — Duplicates](#screen-5--duplicates)
- [Screen 6 — Trends](#screen-6--trends)
- [Screen 7 — Restore](#screen-7--restore)
- [Screen 8 — Automatic](#screen-8--automatic)
- [Screen 9 — Settings](#screen-9--settings)
- [The file viewer](#the-file-viewer)
- [Deleting](#deleting)
- [Disk alerts and the tray](#disk-alerts-and-the-tray)
- [Rules the interface will not break](#rules-the-interface-will-not-break)
- [What it deliberately does not do](#what-it-deliberately-does-not-do)
- [Limits worth knowing before you plan around it](#limits-worth-knowing-before-you-plan-around-it)
- [Running and building it](#running-and-building-it)

---

## The question every screen answers

**Should this go?**

Every tab is a different way of asking it — by size, by category, by duplication,
by age, by whether it is a photograph. The product is not the scanning. Any tool
can list large files. The product is everything that happens between seeing the
list and pressing delete.

Three rules follow from that, and they shape more of the interface than any
feature does.

### 1. Nothing is ever selected for you

There is no "clean up" button that picks its own targets. Bulk selection exists,
but every one of them acts on a set the user chose and can see the count and size
of: *everything marked safe*, *everything in this category*, *all but the oldest
copy*, *everything currently shown by this filter*.

This is strictest on the **Photos & video** screen, where the files are the only
ones in the app that cannot be got back. A cache rebuilds itself, an installer
can be downloaded again, a log is regenerated. A photograph is none of those, so
that screen has no automatic selection of any kind — not near-duplicates, not
blank frames, not folders full of icons.

### 2. Moved is not freed

Moving a file to the Recycle Bin **frees no disk space**. The bin sits on the
same volume; the bytes are still there. This sounds like a technicality and it is
load-bearing: it means a scheduled cleaner that only moves files to the bin will
report gigabytes reclaimed and change nothing at all.

So the app never adds the two figures together. The Trends screen has two
separate columns — *moved to the bin* and *actually freed* — and the confirmation
in front of a deletion says so in words.

### 3. Every verdict arrives with its evidence and its confidence

The app is allowed to be unsure, and it says so rather than rounding up to a
conclusion. "Screenshot" appears next to the reasons for it — *its name begins
Screenshot*, *it carries no camera information*, *it is exactly 1920×1080, the
size of this screen* — and next to one of four words: **certain**, **strong**,
**likely** or **a guess**.

A guess that looks like a conclusion is how somebody deletes the wrong thing
while skimming.

---

## At a glance

| Screen | The question it answers | Acts on |
| --- | --- | --- |
| **Disk usage** | Where did the space go? | One folder you choose |
| **System** | Where did the rest of the drive go? | The whole system drive |
| **What to delete** | Which of it is safe to remove, and why? | The same scan |
| **Photos & video** | What is in my picture library, and where did it come from? | Curated photo folders |
| **Duplicates** | What do I have more than one copy of? | One folder you choose |
| **Trends** | Is this getting worse, and how fast? | Every volume the app knows about |
| **Restore** | What did the app do, and can I have it back? | Everything in the Action Journal |
| **Automatic** | Can this happen without me? | A policy you write |
| **Settings** | Appearance, language, version | The app itself |

Plus two things that run outside the window: an optional **tray watcher** that
warns before a disk fills, and a **scheduled cleanup** that runs with no window
open.

---

## What a session looks like

The typical path through the app, end to end:

1. **Pick a folder.** Native picker, or one click for Home / Desktop / Downloads
   / Documents / Pictures / Videos.
2. **Scan.** A progress line reports files, bytes and elapsed time as it goes,
   and can be stopped at any point — a stopped scan returns what it found rather
   than nothing.
3. **Read the result.** Where the space went, by file type, the largest files,
   and a tab badge telling you how much the app considers safe to remove.
4. **Look inside anything you are unsure about.** **View** opens the file in the
   app — a PDF, a spreadsheet, a Word document, a log — without launching another
   program.
5. **Select.** By hand, or with a bulk action whose scope is on screen.
6. **Confirm.** A native dialog stating the exact count, the exact bytes, what is
   being skipped and why, and — for long jobs — how long it will take.
7. **Watch it run.** A progress panel with a determinate bar, a live rate, an ETA
   and a **Stop** button that is safe to press at any moment.
8. **Read the summary.** A toast saying what moved and how big it was, how long
   it took, that none of it is freed until the bin is emptied, and what was
   skipped and why. The lists on screen update in place.

Nothing in that sequence happens without a click, and step 6 cannot be skipped.

---

## The shell everything sits in

### The window

| | |
| --- | --- |
| Size | 1180×780, minimum 900×600 |
| First paint | The window is revealed only once it has been painted, so there is no white flash before the interface appears |
| One copy at a time | Launching it twice restores and focuses the window you already have |
| Closing it | Cancels every scan, search and delete in flight. Nothing is left running unless the tray watcher is on |

### The sidebar

Nine tabs down the left, each with an icon and a label. Two of them carry a
**badge** when there is something to report: *What to delete* shows the total
size it considers safe to remove, *Photos & video* shows how many files it found.

The sidebar can be collapsed to icons only, and its width dragged; dragging it
all the way in hides it. The choice is remembered.

### Appearance

Light, dark, or follow the system — chosen in Settings, and also from a control
in the top bar, because it is the one preference people flip on a whim. Both
controls are always in agreement.

Switching it is a **circular sweep that grows from the button you pressed**.
Changing every colour in a window on a single frame reads as a glitch; a reveal
that spreads from where the pointer just was reads as a consequence. Anyone whose
system asks for reduced motion gets the change with no animation at all.

Electron's own dialogs — the folder picker, the delete confirmation — follow the
same theme. A light app throwing a black modal is the giveaway that a theme was
added afterwards.

### Language

English and Vietnamese, switched in Settings and applied immediately with no
restart. It reaches further than the window:

- the text on screen
- the **native confirmation in front of a deletion**, which is the sentence that
  matters most
- Windows notifications
- the tray menu

"System" follows the Windows **display language**, not the regional number format
— those are two different settings, and a machine set to Vietnamese date formats
with English menus should not be handed a Vietnamese app it never asked for.

One deliberate exception: *Task Scheduler* is never translated, because it is the
name of the Windows window somebody has to open to find the entry.

### Progress, and the animals on it

Every long operation reports honestly: a determinate bar where the total is
known, counts and rates in words beside it, and a stop that leaves partial work
intact.

A scan of a large folder is a wait with nothing to watch, so a few small animals
walk along the progress line — they patrol it, sit down, and occasionally chase
each other. Choose cat, dog, bird, mouse, a mix, or none at all in Settings.

It is a small thing, and it is not free of engineering: every frame is drawn by
the browser's compositor rather than by a timer in JavaScript, precisely because
a scan is the busiest the app ever is and an animation must not compete with the
work the user is waiting for.

### Toasts

Every completed action ends in a short summary at the bottom of the window: what
happened, how much, how long, and what was skipped. They are the app's receipts.

---

## Choosing what to look at

- A **native folder picker**.
- **Six one-click shortcuts** — Home, Desktop, Downloads, Documents, Pictures,
  Videos — each showing its real path on hover. A folder that has been redirected
  or does not exist is simply not offered, rather than failing when clicked.
- The chosen path is shown **elided in the middle** so both ends stay readable,
  with the full path on hover.

The Disk usage and Duplicates screens work on one folder at a time. Photos &
video works on its own curated list instead, described below.

---

## Screen 1 — Disk usage

One pass over the chosen folder produces everything on this screen.

### The four figures at the top

Total size · file count · folder count · how long the scan took.

### Where the space went

A **map of the folder**: every folder in it is a tile sized by what it holds,
and the folders inside those are drawn inside them, three levels deep where
there is room. **Click a folder to go into it**; the path above the map goes
back up. Point at a tile for its full path, its size, how many files it holds
and its share of the folder around it, and — for a file the app has an opinion
about — the verdict and how sure it is. Right-click for **View**, **Reveal**
and **Add to selection**, which ticks the file into the same floating bar the
largest files use.

It is drawn in weights of one colour: the top level at full strength, each
level inside a step paler. Nothing is coloured by file type — green, amber and
red mean verdicts in this app, and a palette of types would be nine more
colours that say nothing about whether a file can go.

What gets a tile of its own follows the rule the scan's snapshot keeps: files
of **10 MB or more, the ten largest per folder**. Everything else in a folder
is one tile, **(n smaller files)**, so the sizes add up and nobody wonders
where the rest went. On the machine this was built on that rule names 781
files in a home folder of 377,000 — and they hold 78% of its bytes. A folder
with more than three hundred folders in it shows the three hundred largest and
one **(n more folders)** tile, and tiles too small to see are folded into
**(n small items)** rather than dropped.

**List** shows the same level as rows: the same drill-down, the same menu on
every folder and file. The map is also a tree to the keyboard — the arrow keys
move between tiles and in and out of the folders drawn inside, Enter opens a
folder or views a file, Space ticks a file, Backspace goes up, and the
context-menu key opens the menu.

The window never holds the whole tree. It asks the main process for the folder
it is showing and at most three levels under it — about a hundred kilobytes,
where the home folder's whole tree is five megabytes of names. A file moved to
the Recycle Bin from any screen leaves the map, and the card says how much has
gone since the scan, without calling it freed.

### By file type

The largest extensions by total bytes, each with a file count. Files with no
extension are grouped as **(no extension)** rather than discarded.

### Largest files

The fifty largest, each row offering:

- a checkbox
- its size, and its age
- its path, elided, with the full path on hover
- where the app has an opinion, a pill with the verdict **and how sure it is**
  — *safe · strong evidence*, *review · likely* — and the reason behind it in
  plain words. Click the pill and the reasons open under the row, strongest
  first
- **View**, **Reveal in Explorer**, **Open**

A file that is moved to the Recycle Bin from here leaves the list, as it does on
every other screen.

### Every list works the same way

Disk usage, What to delete and Duplicates are built from one shared list:

- **Tick to select, Shift-tick to take everything in between** — the way the
  photo grid has always worked.
- **The keyboard does everything the mouse does**: arrow keys move between rows,
  Space ticks, Shift+arrow extends, Enter opens the file in the viewer.
- **What is selected floats at the bottom of the window**, and only while
  something is: how many, how big, and the one action that applies to all of
  them. Beside the button it says, every time, *Not freed until the bin is
  emptied*.
- **A long list draws only what is on screen.** Past two hundred rows the rest
  exist as space, so a list of thousands scrolls as easily as one of fifty.

### What the scan will not do

| | |
| --- | --- |
| Symlinks and junctions | Never followed, so nothing is counted twice |
| Hidden entries | Skipped |
| System locations | Skipped, and reported — never entered |
| Development noise | `.git`, `node_modules`, `.venv`, `__pycache__` are skipped; they would drown out everything actionable |
| Unreadable entries | Recorded and reported as a count; the scan continues |

Because system locations are excluded by design, **scanning `C:\` under-reports
the drive's real usage**. The status line says how many locations were left out,
so the gap is visible rather than mysterious, and the [System](#screen-2--system)
screen measures all of it.

Two things used to be left out that never should have been, and were found by
measuring a real drive. **OneDrive's folder** is a special kind of folder that
Windows' directory listing describes as a link, so a scan of the home folder
skipped it — on the machine this was built on that was 12 GB, including
Documents, Pictures and the Desktop. And inside the app, **`.asar` files** (the
single file most Electron apps ship in) were reported as folders and skipped.
Both are now asked about directly and counted.

### Honest timestamps

Windows can be configured not to record when a file was last *opened*, and on
such a machine every file's last-access time is simply a copy of its modification
time. A "last opened" column would then be fiction.

The app checks the real setting and says so: when access times are not tracked, a
banner explains it and every date on screen is relabelled **Modified**.

---

## Screen 2 — System

Where **all** of the system drive went — including everything the other screens
leave out on purpose. It answers the question Disk usage cannot: "the drive says
413 GB is used, the scan found 140 — where is the rest?"

### Measuring

- **The drive's size, what is used and what is free** appear as soon as the tab
  opens.
- **Measure this drive** reads every folder on it. It adds up the space each
  file actually takes on the disk (a OneDrive file that is only in the cloud
  takes none), counts a file with several names once — most of `System32` is
  also in `WinSxS` under a second name — and follows no link. On a 475 GB drive
  with 1.1 million files it took between one and two and a quarter minutes. It
  can be stopped.
- **Measure with administrator rights…** is the one button in the app that
  raises a UAC prompt, and only when it is pressed. It measures exactly the
  folders the first pass could not read, and asks Windows' own tools what only
  they can see: restore points (`vssadmin`), the file system's index
  (`fsutil`), and the component store (`DISM`). The helper that does this reads
  only, answers only that fixed list, and leaves as soon as it has answered.

### What you see

One bar for the whole drive: **your files · programs · Windows and the system ·
free · not explained**. Under it, a card per row — your profile, what the other
scans skip (folders whose names start with a dot, `node_modules`…), folders at
the top of the drive, installed programs, the Windows Installer cache, the
component store, the hibernation file, restore points, the Recycle Bin, and the
rest — each with its size, one sentence saying what it is, what doing something
about it costs, and how it was measured.

**Not explained** is a number, never hidden. It is what the drive reports as used
and nothing on the screen accounts for. On the machine this was built on it was
35.5 GB before administrator rights and 1.4 GB after — a third of one per cent
of the space in use.

### What it will not do

**Change anything.** The app does not turn off hibernation, delete restore
points or clean the component store. A row's button opens the Windows tool that
owns that space — Power Options, System Protection, Disk Cleanup, Storage
settings, Installed apps — and a command such as
`DISM /Online /Cleanup-Image /StartComponentCleanup` is shown to copy, never run.
Every row is `keep` or `review`, never `safe`, and none of it can ever be part of
an automatic cleanup.

---

## Screen 3 — What to delete

The same scan, read a different way: not "what is big" but "what is disposable".

Every file receives exactly one of four verdicts — **safe**, **review**,
**protected**, **keep** — and lands in one of ten categories:

temporary files · caches · GPU and compiled-code caches · application caches ·
crash dumps · old log files · build output · old installers · large archives and
disk images · large and untouched.

### What you see

- **Two totals as separate tiles**: how much is *safe*, and how much is *worth
  reviewing*. They are never added together.
- **Groups sorted safe-first**, then by how much they would reclaim. Each carries
  a label, a plain sentence explaining what the category is, its total size and
  file count.
- **A reason per file**, not just per category: *"Not opened in 2.4 years"*,
  *"Nothing written to it in 3 months"*, *"Installer downloaded 8 months ago —
  the program it installs is unaffected by deleting it"*.
- **How sure the app is, per file.** The same category can rest on stronger or
  weaker evidence, so each row says which:

  | Evidence | Confidence |
  | --- | --- |
  | Inside a folder called Temp; a `.tmp` or half-downloaded file; an editor lock file | strong |
  | A `.bak` file — it can be somebody's only backup | likely |
  | Inside a folder merely called *Cache* | likely |
  | A GPU, shader or compiled-code cache; a crash dump; a log untouched for a week | strong |
  | `bin`/`obj`/`out` beside a project file — nothing checks the project is idle | likely |
  | An installer in Downloads a month old — it could be a portable app | likely |
  | A large archive or disk image | strong |
  | Large and untouched, where Windows records when files are opened | strong |
  | Large and untouched, where it does not — "untouched" is then only "unmodified" | a guess |

  **No cleanup verdict is ever *certain*.** Nothing about a file's name or place
  makes its disposability certain; the word is kept for what the app has
  actually verified, like two files hashing the same.
- **Protected locations**, listed with the reason each was refused, so a user can
  see the app declining to suggest something rather than silently omitting it.
- **Application folders** that were excluded because their contents belong to an
  installed program.

### The thresholds, in one place

180 days before *untouched* · 100 MB before *large* · 30 days before an installer
has served its purpose · 7 days before a log is old · 50 MB before an archive is
worth reviewing.

All ages in one scan are measured against a single instant, so two files written
a millisecond apart cannot land on opposite sides of a threshold.

### Selection tools

*Select everything marked safe* (which skips every `review` group), *select all*
within one category, and *clear selection*. A live readout shows `n selected ·
total size`, and the delete button stays disabled until something is ticked.

### Available in the cloud

When the folder scanned includes OneDrive, a card below the groups lists the
files OneDrive already has in the cloud and that are on this drive too — the
ones Explorer's *Free up space* would take. **Keep only in the cloud** makes
them online-only: nothing is deleted, they stay in their folders with their
names and sizes, and they come back down when opened.

It is built to be unlike the rest of the screen, because a OneDrive file moved
to the Recycle Bin is deleted on every device. It has its own selection and its
own button; *Select everything marked safe* cannot reach it, the delete button
never sees it, and its totals are not in *Safe to delete*. Its button says
*Frees the space, deletes nothing*.

- **Only files Windows says are in sync.** Being in the OneDrive folder is not
  enough: on the machine this was built on, 10 GB of it had never been uploaded
  — there was no copy in the cloud, and making it online-only would have freed
  nothing. The card says how much that is, rather than offering it. Files
  waiting to upload, and ones already online-only, are counted the same way.
- **Asked of Windows, not guessed.** Node cannot see a file's sync state, so the
  app asks Windows' own Cloud Files API through Windows PowerShell, from a
  fixed script that reads each file's directory entry and never opens a file —
  reading one would make OneDrive download it. Where PowerShell cannot compile
  that small piece of code (a machine locked down with AppLocker or WDAC), the
  card says it could not check and offers nothing.
- **OneDrive has to be running**, because OneDrive is what frees the space. If
  it is not, the button refuses, says why, and changes nothing.
- **What it frees is measured.** OneDrive takes the contents away a moment after
  it is asked; the app watches what each file takes on the disk for up to half
  a minute and reports the drop it saw, and says so when OneDrive has not got to
  some of them yet. Tried on real OneDrive with three files of the app's own:
  6.00 MB on the disk before, nothing after, 6.00 MB reported.
- A file somebody set to *Always keep on this device* is offered too, but as
  *review*, and the confirmation says the choice is being undone.
- A synced file that a delete group also lists — *large and untouched*, say —
  keeps its place there, and its reasons add that this card frees the same space
  without deleting it on every device.

The confirmation says what it costs: opening one of these files afterwards needs
a connection, and a signed-out OneDrive cannot open them at all. Nothing here
goes to the Restore tab — nothing moved — and none of it can ever be part of an
automatic cleanup. Dropbox and Google Drive are not offered: nothing has checked
that they behave the same way.

---

## Screen 4 — Photos & video

Its own screen, because its files are the only ones in the app that cannot be got
back. Everything here is arranged around that.

### Where it looks

Not the whole drive. A thirty-second walk of a real home folder found 10,185
files with a picture extension of which **97% were under 20 KB**, and **9,676 of
them sat in two folders** — both the unpacked contents of a download, full of a
web application's interface assets. The whole walk turned up 71 photographs and
11 videos that were anybody's media, and it was still tens of thousands of
directories from finishing.

So the scan looks in **photo folders**, each of which is listed on screen with a
plain description and can be switched off individually:

your Pictures folder · your Videos folder · where the Windows screenshot key
saves · pictures saved by apps · where the Game Bar records · Zalo received files
· Telegram · WhatsApp · Viber

Plus **any folder you add yourself**. Downloads is offered and is **off by
default**. Folders the scan decided to skip are listed too, with the reason.

### Two independent questions about every file

**Where did it come from?** A camera, a screenshot, a chat app, a download, a
piece of software, a screen recorder — or nothing we can tell.

The evidence is **ranked, not scored**, and that distinction is the whole design.
Metadata the device wrote itself outranks the folder, which outranks the
filename. So a photograph called `Screenshot of the beach.jpg` is still a
photograph: a name cannot outvote the camera model written into the file by the
camera.

| Rank | Evidence |
| --- | --- |
| 1 | Metadata the device wrote itself |
| 2 | Metadata an editor wrote |
| 3 | The folder it lives in |
| 4 | The download record Windows kept |
| 5 | The shape of the filename |
| 6 | The shape of the picture — exactly the size of a monitor attached to this machine |

**What is it, actually?** Read from the bytes rather than from the extension: the
real format against the declared one, pixel dimensions, aspect, icon-sized junk,
pictures a chat app has resized and stripped, empty and unreadable files, and for
video the duration, resolution, bitrate and whether it has sound. A file can
carry several of these at once, so they are tags rather than a category.

### Three axes, three different controls

The first version of this screen shipped with thirty-three filter chips wrapped
over five rows — four hundred pixels of controls, in a bar that did not scroll
away. The photographs, which are the only reason to open the screen, got about
two rows.

The mistake was using one control for three different shapes of data:

| Axis | Shape | Control | What the shape buys |
| --- | --- | --- | --- |
| Where from | A partition — each file is in exactly one | **One proportional bar**, segments sized by bytes | The *share* each source takes, not merely that it exists. 3,450 screenshots at 674 MB should not look bigger than 463 photographs at 1.3 GB |
| Year | An axis — ordered, with gaps | **A histogram** | The shape of a library over time, and its empty years, in the space three chips used |
| What it is | Overlapping tags | **Chips**, which genuinely fit | Unchanged — but far fewer of them |

Two smaller rules came with it:

- **A filter that divides nothing is not offered first.** One chip used to read
  *Synced to the cloud — 4,032 files* out of a library of 4,062. Filters are now
  ordered by how evenly they split the library; ones matching almost everything
  or almost nothing fall to the bottom, behind *show more*. Nothing is hidden,
  only ordered.
- **Only the action row stays pinned**: scan, where to look, the sort, and the
  active filters as removable tokens. The tokens matter because the overview
  scrolls away, and a filtered grid three screens down would otherwise look
  exactly like the whole library.

### The grid

- Sort by **largest**, **newest**, **oldest**, **name**, or **least detail
  first**.
- Click a tile to see everything known about that file: size, dimensions,
  megapixels, duration, bitrate, format, camera — and the verdicts with their
  evidence and confidence.
- **Tick to select. Shift-tick to take everything in between.** A running total
  appears in a bar that floats over the grid and exists only when there are
  results, because on this screen every row of height is a row of photographs.
- The one bulk action is *select everything currently shown*, which acts on the
  filter you applied and whose count is on screen.

### Two things it will not claim

**There is no "blurry" group.** The only blur measure available without decoding
every image is the variance of a Laplacian, and measured on real files it
separates *detailed* from *smooth*, which is a different question — sharp scanned
documents scored 390–550 while screen recordings of text scored 3,000–6,000. A
photograph of fog, or one with a shallow depth of field, lands exactly where a
genuinely out-of-focus one does. It ships as a sort order named *least detail
first*, which is an honest description of what it ranks.

**Near-duplicates are grouped tightly and named carefully.** On a screen where
somebody might delete all but one copy, a group is a claim that these are the
same picture. Missing a burst costs nothing; a wrong group costs a photograph.

### Deleting from here

Through the same guarded path as everything else, with one extra sentence in the
confirmation that applies to **every** delete in the app:

> A file inside a sync folder is not protected by the Recycle Bin. Deleting it
> here tells OneDrive or Dropbox to delete it on every device, and this machine's
> bin has no say in what the others do.

Somebody who has learned that this app is safe *because* everything is
recoverable is exactly the person who needs telling.

**Automatic cleanup can never reach this screen.** The unattended run works from
a fixed list of categories, and nothing here produces one.

---

## Screen 5 — Duplicates

Byte-identical files inside the chosen folder.

### Controls

**Ignore files under** — 1 KB, 100 KB (default), 1 MB or 10 MB.

### What it reports while it works

Four named phases, with counts and elapsed time, so a long search is legible
rather than a spinner: **Indexing files → Grouping by size → Comparing file heads
→ Verifying full contents**.

It can be stopped at any phase boundary and returns what it found so far.

### What you get

- **Groups**, each showing the number of identical copies, the size of one copy,
  and how much removing the extras would reclaim.
- **A suggested keeper** — the oldest copy — tagged *oldest* with a hint saying
  to keep that one.
- **Two totals, reported separately**: everything duplicated, and what *select
  all but the oldest copy* would actually take. The status line spells out the
  gap and how many copies were held back.
- **Statistics** for the run: files indexed, candidates surviving each pass,
  files hashed, and how many hashes were reused from the cache.

### Files in use stay visible and are never bulk-selected

A copy is marked as a program component when its path runs through a dependency
or runtime directory (`site-packages`, `venv`, `vendor`, `.cargo`, `.nuget`,
`gems`, …), when it sits inside a protected system location, or when it is a
loadable binary (`.dll`, `.pyd`, `.so`, `.jar`, `.node`, …).

They remain on screen and can be ticked by hand if you know better. The guard
governs bulk selection only — it decides what a single click may take, not what
you are allowed to do.

---

## Screen 6 — Trends

Whether the problem is getting worse, and how fast.

### The series behind it is volume usage, not scan totals

A scan covers one folder somebody chose at one moment. Scanning Downloads on
Monday and Users on Friday produces two numbers that are not two points on any
curve. So every headline figure on this screen is built from **volume usage**,
recorded on a timetable regardless of what was scanned — or whether anything was
scanned at all.

Per-folder history is kept as well, but a folder is only ever compared against
earlier measurements of *the same folder*, and one scanned a single time says
"scanned once" instead of being given a growth rate of zero.

### What is on the screen

- **A volume selector**, opening on the volume with the most history rather than
  the first one alphabetically.
- **A chart of used space over time.** Its vertical axis is scaled to the data
  rather than pinned to 0–100%, and it says so underneath: an 80→82% move is
  worth seeing and is invisible on a full-height axis.
- **In use · Growth per month · When it fills**, each carrying the number of
  measurements and the span behind it.
- **Folders, by how fast they are growing.** Each one scanned twice has a
  **What changed?** link to the comparison below.
- **What changed in a folder** — see below.
- **Moved to the bin, and actually freed** — two columns, by month, never
  summed.
- **Where these measurements come from**, listed plainly: a daily Windows task
  that runs with the app closed, every app launch, each tick while disk
  monitoring is on, and the **Measure now** button.
- **Export**, as JSON or CSV. Not PDF: a PDF of a chart is a picture of the data
  and cannot be checked, replotted or joined to anything.

### Predictions that refuse themselves

The screen returns a reason instead of a number whenever the data does not
support one:

| Situation | What it says |
| --- | --- |
| One measurement | "Only one measurement so far — trends need at least two." |
| Too little history | "Too little history to be worth reporting: *n* measurements over *d* days." |
| Flat or falling | "Usage is flat or falling, so there is nothing to extrapolate." |
| Too erratic | "Usage moves too erratically to extrapolate (the trend explains only *n*% of the variation)." |
| Very slow growth | "At this rate the disk does not fill within two years." |

A confident date produced from three points a week apart would be the most
plausible lie the app could tell.

Trends need history and history starts empty. A fresh install shows "not enough
measurements" for roughly the first week, and there is no way around that.

### What changed in a folder

The chart can say the disk is growing and how fast; it measures the volume, so
it cannot say where. Every scan leaves a snapshot of the folder it read, and
two of those can. Pick a folder and two of its scans — it opens on the newest
and the one nearest a week before it, and says how far apart they really are —
and the card shows:

- **Where it grew, and where it shrank**, each change named at the deepest
  folder that holds it: `AppData\Local\Docker\wsl\disk +800 MB`, not "AppData
  grew", "Local grew", "Docker grew" printed as three facts. The places do not
  overlap, and what grew and what shrank add up to the net change exactly. A
  folder that held no files before is marked *new*; one that holds none now,
  *empty now*.
- **Large files that grew, appeared, went, or moved.** A file gone from one
  folder that arrived in another with the same name, size and date is reported
  once, as moved, rather than as one loss and one gain.
- **What it cannot see, counted rather than guessed.** A snapshot names only a
  folder's ten largest files of 10 MB or more. A file missing from the later
  scan is only called gone when that scan would have named it had it still
  been there at that size; one that was merely pushed out of its folder's ten
  by bigger files is counted under *could not tell*, with its size.

It refuses, with the reason, when there is nothing honest to show: a folder
scanned once, two scans that measured in different ways (a different scanner,
different rules about what to skip, or a version of the app that counts
differently), and it compares a scan that was stopped early only as *a guess*.

When the volume is growing, a line under the figures links to it — *C:\ is
growing +6.2 GB/month. See what grew in C:\Users\you — two scans of that
folder, five days apart, not the whole of C:\.* The scope is in the sentence
because the two numbers measure different things.

---

## Screen 7 — Restore

Everything the app has done to a file, newest first, and the way back from each
of it. It is free on every tier and it is never behind a licence: whatever the
app did, it must stay possible to undo.

Each card is one session from the [Action Journal](#the-action-journal) — a
delete from a screen, a scheduled cleanup, a purge, an earlier restore — with
when it happened, where it came from, and its size. Under it, **where its files
are now**:

| What the row says | What the app checked |
| --- | --- |
| *in the bin* | The Recycle Bin's own record names this path, deleted at the moment the app recorded, and the data is still there |
| *put back* | A restore session names it — and whether it is still where it was put |
| *purged* | The app's own purge removed it for good; it cannot be put back |
| *not in the bin* | Nothing in the bin matches any more: it was emptied, or restored in Explorer. If a file sits at its old path, the row says so |
| *drive not connected* | The drive it was on is not there, so nothing can be said about it |

That column is read from the disk every time the tab opens, not taken from the
journal. The journal says what the app did; only the disk says what is true now,
and the two part company the moment somebody uses Explorer's own *Restore* or
empties the bin.

**Put back all**, or tick files and **Put back selected**. It goes through the
same pipeline as a delete — a native confirmation with the count and the size,
the progress panel with Stop, a receipt — and is recorded as a session of its
own.

When a file has appeared at the old path since, the confirmation asks rather
than choosing: **keep both** (the restored one comes back as `name (restored)`),
**skip** those, or **replace** them — in which case the file there now goes to
the Recycle Bin first, as its own session, so it can be put back too. Nothing is
ever overwritten, and a folder in the way is never replaced.

Two decisions behind it, both measured rather than assumed:

- **A file comes back by hard link, never by rename.** On Windows a rename onto
  a path where a file already stands replaces that file without an error; a link
  refuses. Windows' own *undelete* was tried as well and works, at about half a
  second a file — but when something is in the way it raises Explorer's conflict
  dialog, which the app can neither see nor answer.
- **What was put back is no longer the app's to purge.** Before this, a file
  restored and then deleted by hand within five minutes of the app's own delete
  could have been matched by the purge and removed permanently. The purge now
  skips anything a restore session names.

The window asks for items by their place in the journal and never by path, so it
can ask for something the app did to be undone and for nothing else.

---

## Screen 8 — Automatic

Cleanup on a timetable, with no window open. Off by default, and designed so that
every ambiguity resolves towards doing nothing — there is no dialog in front of
this to catch a mistake.

### Writing the policy

| Control | Meaning |
| --- | --- |
| **Run cleanup automatically** | The master switch |
| **Report only** | Lists what would be taken and deletes nothing |
| **How often** | Every few minutes (for testing), daily, weekly, or monthly — with the day and time |
| **Catch up after you log in** | For a schedule that came due while the machine was off |
| **What it may delete** | Which categories, ticked individually |
| **Leave alone for at least** | *N* days untouched |
| **Only when the disk is over** | *N*% used — 0 means always |
| **At most** | *N* files per run, largest first |
| **Folders it may clean** | The roots it is allowed into |
| **Never touch** | A whitelist, on top of every guard that already applies |
| **Skip while these apps are open** | Named programs |

Then **Save settings**, **Preview what would be deleted**, or **Run cleanup
now…**.

**A new schedule starts in report-only mode.** The first run tells you what it
would have taken; you decide whether to let it.

### The gates an unattended run must pass

| Gate | Rule |
| --- | --- |
| Verdict | Only categories the app calls *safe*. *Review* never runs unattended, whatever the settings file says |
| Category | Only the subset you enabled. Build output is safe by the app's own rules and is **off by default** — "safe to delete" and "safe to delete at 2am" are different bars |
| Age | Untouched for at least *N* days, taking the **later** of access and modification time: a file written a year ago but opened yesterday is in use |
| Whitelist | Nothing under a listed folder |
| Running apps | If any named program is open, the whole run is skipped. If the app cannot determine what is running, it also skips |
| Disk pressure | Optionally, only when the volume is over *N*% full |
| Cap | At most *N* files per run |

### The one permanent-deletion path in the app

Because moving to the bin frees nothing, a scheduled cleaner that only moves
files would be theatre. So the app has exactly one path that removes something
permanently, scoped as narrowly as it could be. An item is purged only if **all
four** hold:

1. it physically sits inside a Recycle Bin folder the app enumerated;
2. the bin's own metadata says it came from a path **this app** moved there;
3. the bin's recorded deletion time agrees with the app's own record, so a file
   the user deleted themselves is never mistaken for one of the app's — even at
   the same path;
4. it has sat there longer than a grace period you set, so "restore from Recycle
   Bin" genuinely worked for that whole window.

The app's own record is never sufficient on its own. It is a claim; the bin's
metadata is the evidence.

### Seeing that it actually runs

A configured schedule that has quietly stopped is worse than no schedule, because
the screen goes on showing a next run time for weeks. So this tab reports
**what Windows itself holds**, not what the settings file says:

- the registered task name, and whether it matches your settings
- Windows' own last-run and next-run times
- the last run's exit code **in words** — `0x80070002` reads as *"the program it
  launches could not be found — the app has moved"*
- **Run now**, so "does it work when I am not looking" can be answered without
  waiting for 02:00

Below that: the last result in figures — files scanned, selected, moved to the
bin, permanently removed, disk before and after — and a list of recent runs.

### Why a Windows task and not a background process

A resident process is one the user eventually kills, after which the cleanup
silently stops. Windows already owns a scheduler that survives reboots, so the
app registers a task there and exits. **Nothing of this app stays running** for
the cleanup.

---

## Screen 9 — Settings

Small on purpose. **Nothing in Settings changes what the app deletes.**

| Card | What it holds |
| --- | --- |
| **Appearance** | Light, dark, or follow the system |
| **Language** | English or Vietnamese, or follow Windows |
| **Company while scanning** | Which animal walks the progress bar, or none |
| **Scan history** | How many folder snapshots to keep: the newest few, plus one a month |
| **Version and updates** | Which version you are running, and the update controls |

The version lives here because "which version am I running" is the first thing
anyone reporting a problem is asked, and it used to sit inside a screen about
deleting files on a timetable.

### Updates

**Checking, downloading and installing are three separate clicks.** Replacing the
application binary follows the same rule as deleting a file: nothing happens on
its own. Update checks can be switched off entirely, and the scheduled cleanup
never checks — a 2am maintenance task that replaced the program is not something
anybody asked for.

---

## The file viewer

Reached by **View**, which now leads the actions on **every file row in every
tab**, ahead of Reveal and Open.

It is drawn loudest because it is the act these screens exist for. Every tab asks
whether something can go, and for anything that is not a cache or a log that
cannot be answered from a filename. Until this existed the only answer was
**Open**, which hands the file to Word or Acrobat and puts the decision two
applications away from the list it was being made in. Somebody weighing forty
documents was opening and closing Word forty times.

One panel over the whole window:

| Kind | What it shows |
| --- | --- |
| **PDF** | The browser's full viewer — pages, thumbnails, zoom, search, print |
| **Images** | JPEG, PNG, GIF, WebP, BMP, TIFF — drawn whole, never cropped to fit |
| **Video, audio** | Played in place. Never autoplayed |
| **Text** | Around ninety extensions, plus anything whose contents read as text under another name |
| **Word** | Headings, nested lists, tables with merged cells, inline pictures, hyperlinks shown but inert |
| **Excel** | Sheet tabs in the workbook's order, lettered columns and real row numbers that stay put while you scroll, dates shown as dates, merged ranges, formula results |
| **PowerPoint** | Slides in the deck's order, with titles, indented text, pictures and **speaker notes** |
| **Archives** | What is inside: names, sizes, dates |
| **Anything else** | What it is and how big, and a button to open it in the program that owns it |

Three behaviours are worth stating because they are decisions, not omissions:

- **No hex dump, ever.** Showing bytes as though they were content invites
  somebody to decide a file is disposable because its insides looked like noise.
- **A file that cannot be read says why.** Damaged, password-protected, or a
  rights-managed wrapper are three different sentences, because *"this file is
  damaged"* and *"this document is empty"* lead to opposite decisions.
- **A spreadsheet is drawn to 2,000 rows a sheet, and says so when it truncates.**
  This is a preview for deciding whether a file can go, not a spreadsheet
  program; a 50,000-row table is a frozen window.

Links inside a document are shown as links and **do not go anywhere**. These
files arrive by email, and a preview that follows their links turns reading a
document into visiting whoever sent it. The address is in the tooltip.

---

## Deleting

Three screens can start a delete — largest files, cleanup suggestions and
duplicates — and all three drive the same machinery.

### Before anything moves

Every path is vetted. Refused outright: a drive root, the home folder, a system
location, anything inside an installed application, a path that no longer exists,
and folders (the interface never deletes a folder).

**Then the permission probe.** Files belonging to installed programs carry
permissions that deny deletion, and Windows answers each one with a *modal*
prompt — per file. Two thousand seven hundred selected files could mean two
thousand seven hundred interruptions, each one stalling the run. The app finds
them first, so the prompt never appears, and reports them as a count instead.
Files held open by another program are found the same way and counted separately.

### The confirmation

A native dialog stating:

- the exact number of items and the exact bytes
- how many are being skipped for needing administrator permission, or being in
  use
- **whether any of them are in a cloud-sync folder**, and what that means
- that moving to the Recycle Bin frees no space until the bin is emptied
- for any job expected to take more than 30 seconds, **an up-front estimate** —
  so the decision is made before the wait rather than during it

### While it runs

A shared progress panel: a determinate bar, `n of N`, bytes moved, a live rate,
an ETA, the current file, and **Stop**.

- **Stopping is safe at any moment.** Everything already moved stays in the bin,
  and the summary says how many were left untouched.
- **One bad path never aborts the batch.** It is reported and skipped.
- **Other delete buttons are disabled** while a delete runs.

### Afterwards

Cleanup groups shrink and recompute their totals, duplicate groups that no longer
have two copies disappear, largest files that moved leave the list, and a toast
summarises what moved, how big it was, how long it took, and what was skipped and
why — ending *not freed until the bin is emptied*, because it is not. It used to
say "2.1 GB freed" after every move to the bin, which was the most misleading
sentence the app printed.

### One pipeline for every action

Every screen's delete, the manual cleanup and the 02:00 run go through the same
sequence — vet, probe, confirm, record, act — in `src/main/actions/`. Moving to
the Recycle Bin, putting back from it, and making OneDrive files online-only are
the actions today; each one the roadmap adds is another handler in the same
sequence rather than a path of its own. What an action frees is the handler's
own figure: for the Recycle Bin that is nothing, and for OneDrive it is what the
disk was measured to give back. The window can ask
for a dry run; it cannot ask to skip the confirmation. That used to be possible
by passing `confirm: false` from the page, and is now something only the main
process can switch off, for the test harness.

Deletion is **sequential on purpose**. Running eight at once was measured and buys
17%, because Windows serialises the operation internally — and it costs ordered
progress, per-file error attribution and instant cancellation.

---

## Disk alerts and the tray

Off by default. Switching it on is what makes closing the window hide the app
rather than quit it.

| Control | Meaning |
| --- | --- |
| **Watch disk space and warn me** | The master switch |
| **Warn at** / **Critical at** | Two thresholds, as percentages |
| **Check every** | The polling interval |
| **Volumes watched** | Which drives, each showing its current percentage and free space |
| **Snooze** | Silence alerts for a period |

**Most of the work here is not alerting.**

| Mechanism | What it prevents |
| --- | --- |
| Alerting on the crossing, not the state | An alert every minute for as long as the disk stays full. Ten readings at 88% produce one alert, not ten |
| A margin around the threshold | A disk hovering at 85.0% flipping back and forth on rounding noise |
| Snooze | Being nagged during the hour you are already dealing with it — and a threshold crossed *during* a snooze is recorded but never announced when it ends |
| Treating an unreadable volume as unchanged | Being told it is either fine or an emergency when the app simply could not read it |
| Ignoring falling edges | A notification for good news |

Snooze lives in memory only. It is a statement about the next hour, not a
setting, and a quiet flag that survives a restart is one nobody remembers turning
on.

**Clicking a notification opens the app.** It does not start a cleanup. A
deletion that began from a notification click, with nothing shown first, is the
kind of thing this app does not do.

The **tray icon is a gauge**, not a logo — green, amber or red, showing how full
the disk is, so the question can be answered without clicking anything.

---

## Rules the interface will not break

| Rule | Where you see it |
| --- | --- |
| Nothing is permanently deleted by a click | Every removal goes to the Recycle Bin. The single exception runs unattended, is off by default, and must clear four independent checks |
| Nothing is selected for you | Every bulk action names its scope and shows its count and size first |
| Moved is never reported as freed | Two separate columns on Trends; stated in the confirmation dialog, beside every delete button, and in the receipt afterwards |
| A guess is labelled a guess | Four confidence words, always beside the evidence |
| Stop is always safe | Every long operation returns partial results rather than nothing |
| The app says what it skipped, and why | Protected locations, application folders, files needing administrator permission, files in use, unreadable entries — all counted and explained rather than silently omitted |
| No file is ever executed or interpreted | Contents are read only to identify, hash or display them |

---

## What it deliberately does not do

- **No shred, no force, and no "empty the Recycle Bin" button.**
- **No folder deletion from the interface.**
- **No background service and no resident timer** for the scheduled cleanup. It
  is a Windows task that starts the app, works with no window, and exits.
- **No telemetry, no crash reporting, no identifiers.** The app makes exactly one
  kind of network request — asking the release feed whether there is a newer
  version — and that can be switched off, in which case it makes none. The
  interface itself is forbidden from reaching the network at all.
- **No automatic optimisation, defragmentation or registry cleaning.** It does
  not claim to make anything faster.
- **No system change of its own.** Hibernation, restore points, the component
  store, a previous Windows installation: the System screen explains them and
  opens the Windows tool that owns them. It never runs a command that changes
  the system.
- **What is written outside the Recycle Bin.** In the app's own data folder:
  the settings, the **Action Journal** (below), a log of unattended runs, the
  disk-usage history behind Trends, a duplicate-finder hash cache, and two
  photo-scan caches. In `%LOCALAPPDATA%`, because they belong to this machine
  and not to a roaming profile: a **snapshot** of each scanned folder — every
  folder's size and its largest files, compressed, a few dozen kilobytes for a
  folder of fifteen thousand files — kept so two scans can later be compared.
  None of them holds the contents of any file. Snapshots and the journal do hold
  file *names*, so none of it ever leaves the machine.
- **Settings upgrade forward, once.** The settings file is versioned; the first
  save after an upgrade keeps the previous file as `settings.v1.json`, and the
  version before this one still reads the new file (that is tested against the
  released code, not assumed).

### The Action Journal

Everything the app does to a file is appended to `journal\<year>-<month>.jsonl`,
one line per event, and never rewritten: a line when a delete begins, a line for
each file **after** it has moved and before the window is told, and a line when
it ends, with *moved* and *freed* recorded as two separate figures. The one
permanent deletion the app makes — the delayed purge of its own Recycle Bin
items — is recorded there too.

It replaced `trash-ledger.json`, which is imported once on first launch and then
kept as `trash-ledger.json.migrated`. The old file had two faults the journal
does not: it was rewritten whole from whatever copy a process held in memory, so
a window left open overnight overwrote what the 02:00 run had added; and it
stamped a whole batch with one time, so items from a delete that ran longer than
five minutes could never be matched to the Recycle Bin's own record and purged.
Two processes appending at once was measured: 4,000 lines from two writers,
none lost, none torn.

The journal is a claim, not a permission. The purge still acts only on items the
Recycle Bin's own metadata corroborates, so a hand-edited line deletes nothing.
Month files older than thirteen months are dropped at launch.

It is also what the [Restore](#screen-7--restore) screen reads, and a restore is
recorded in it like any other action — which is how the purge knows a file that
was put back is no longer the app's to remove.

---

## Limits worth knowing before you plan around it

- **Windows only, in practice.** It is written for Windows and exercised there.
  Scheduling and the selective Recycle Bin purge are Windows-only by
  construction. [Unverified] The app has not been run on macOS or Linux.
- **The installer is unsigned**, so Windows SmartScreen warns on first run.
- **One folder at a time** for Disk usage and Duplicates.
- **Display caps**: 300 duplicate groups, 50 largest files, 50 protected-location
  rows, 100 files per cleanup category. The last is flagged on screen. The map
  of the folder gives its own tile only to files of 10 MB or more, ten per
  folder, and to the 300 largest folders in any one folder; the rest are
  counted in a tile that says how many.
- **Scanning `C:\` under-reports it**, because protected system locations are
  excluded by design. The status line says how many were left out; the System
  screen measures the whole drive.
- **The System screen measures the system drive only**, and reading every
  folder on it takes minutes rather than seconds. It has been checked on one
  machine; several Windows installations, a drive BitLocker is still encrypting,
  Storage Spaces and ReFS have not been tried.
- **Trends need about a week** before they say anything.
- **Comparing two scans sees only what a snapshot keeps**: every folder's size,
  and its ten largest files of 10 MB or more. A change among smaller files shows
  as its folder growing or shrinking, never by name. Scans are not taken on a
  timetable yet, so there is only something to compare once a folder has been
  scanned twice.
- **Keeping files only in the cloud is OneDrive only**, for files of 1 MB or
  more, and needs OneDrive running and Windows PowerShell able to compile a few
  lines of C#. OneDrive frees the space in its own time: the app reports what
  it measured within half a minute, and a OneDrive just started after a long
  time off can take minutes to catch up before it will touch anything new — six
  minutes, the one time that was measured.
- **The scheduled task only fires while somebody is logged on.** A machine left
  at the login screen at 02:00 runs the cleanup at the next opportunity instead.
- **Moving the app** relocates the executable the scheduled task points at. The
  app notices on next launch and repairs it, but the runs between the move and
  that launch do not happen.
- **No high-contrast theme**, and no way to change the accent colour.

---

## Running and building it

```
npm install
npm start            # run it
npm run dev          # run it with developer tools
npm test             # the unit suites
npm run test:e2e     # boot the real app, click its own buttons, read the DOM back
npm run build        # a Windows installer in dist/
```

The interface is plain HTML, CSS and JavaScript — no framework and no build step,
so what is in `src/renderer/` is what runs. All filesystem work happens in a
separate process; the interface has no access to the disk, the network or Node at
all, and reaches the system only through a fixed list of named operations —
fifty-four of them, written down in `src/main/ipc-manifest.js`. A handler for a
channel not in that file throws at startup, and `npm run test:ipc` holds the
preload, the handlers and the manifest to the same list.

Every row a screen draws is a **candidate** (`src/main/analyzers/contract.js`):
a path, a size, one of four verdicts, one of four confidence words, and the
ranked evidence behind them. A candidate missing its confidence or its evidence
is refused before it leaves the main process, which is what makes "every verdict
arrives with its evidence" a property of the code rather than a habit.

Two further environment variables exist for development only:

```
CLEANDRIVE_CHANNEL=beta npm run build         # which channel a build is (default: stable)
CLEANDRIVE_ENTITLEMENTS=free npm start        # narrow a checkout to one tier: free, pro, pro+dev, business, all
```

A checkout opens every feature by default; a built installer ignores
`CLEANDRIVE_ENTITLEMENTS` entirely. One feature so far belongs to the paid tier
— comparing two scans of a folder — and until licences exist a built installer
has that tier open to everyone. The developer add-on and the business tier stay
closed.

Three Windows programs are run for OneDrive's *Free up space*, each by its
absolute path in `System32`: `tasklist` to see whether OneDrive is running,
Windows PowerShell with a fixed script (the file paths go in on its input, never
into the script) to read each file's sync state through the Cloud Files API,
and `attrib +U -P` — the command Microsoft documents for Files On-Demand — to
make a file online-only. `npm run verify:dehydrate` checks the real OneDrive
reading only; with `-- --write` it makes three small files of its own
online-only, measures it, and deletes them again.

A few paths need an administrator. They go through a **helper**: the same
executable started with `--helper` through a UAC prompt the user answered,
answering only a fixed, read-only list of requests over a named pipe that both
sides authenticate: measure these refused folders (sums only, never a file
name), and run `vssadmin`, `fsutil` or `DISM` from `System32` with arguments
written into the app. It opens no window and leaves after five minutes idle, or
as soon as the System screen has its answers. `npm run verify:helper --
--elevated` raises a real prompt to prove it; `npm run capture:system` records
what those tools print, as the fixtures the parsers are tested against; and
`npm run verify:system -- --elevated` measures the real drive end to end.

The app ships with **two runtime dependencies**: one for auto-update, and
`mammoth` for reading Word documents in the viewer. The second is a deliberate
exception to a standing rule against dependencies, made after building both a
hand-written reader and the library version and measuring them against real
documents — the comparison harness is still in `scripts/` and still runs for the
other formats.

Everything else, including the ZIP, Excel, PowerPoint, image and video readers,
the charts and the tray icon, is written here. There are no binary assets in the
repository; the icons are drawn in code.

Test harnesses live in [`scripts/`](scripts/) — thirty-two suites in
`npm test`, plus the Electron ones, covering the classification rules, the
candidate contract, the action pipeline, the map of the folder and what the
window may ask of it, what two scans of a folder can honestly say changed, the
journal (including two processes
writing it at once), the deletion guards, the unattended-run gates, the Recycle
Bin purge and the restore both written from the attacker's side, the
entitlement matrix, the elevated helper's handshake, the settings migration
against the released code, the translation dictionary, and an end-to-end run
that boots the real application and reads its rendered interface back out.
`npm run verify:restore` puts throwaway files back from the real Recycle Bin.
`npm run shoot:lists`, `shoot:media`, `shoot:viewer`, `shoot:restore`,
`shoot:system`, `shoot:treemap`, `shoot:changes` and `shoot:cloud` take screenshots of the real screens.
