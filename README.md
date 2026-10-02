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
- [Screen 3 — Plan](#screen-3--plan)
- [Screen 4 — What to delete](#screen-4--what-to-delete)
- [Screen 5 — Photos & video](#screen-5--photos--video)
- [Screen 6 — Duplicates](#screen-6--duplicates)
- [Screen 7 — Apps](#screen-7--apps)
- [Screen 8 — Games](#screen-8--games)
- [Screen 9 — Chat apps](#screen-9--chat-apps)
- [Screen 10 — Developer](#screen-10--developer)
- [Screen 11 — Trends](#screen-11--trends)
- [Screen 12 — Restore](#screen-12--restore)
- [Screen 13 — Automatic](#screen-13--automatic)
- [Screen 14 — Settings](#screen-14--settings)
- [The file viewer](#the-file-viewer)
- [Deleting](#deleting)
- [Disk alerts and the tray](#disk-alerts-and-the-tray)
- [The command line](#the-command-line)
- [Managed by an organisation](#managed-by-an-organisation)
- [The organisation's console](#the-organisations-console)
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
| **Duplicates** | What do I have more than one copy of — file by file, a whole folder at a time, or drafts of one document? | One folder you choose |
| **Apps** | What is installed, how big is it, when did I last start it? | The installed-apps list, and the folders it names |
| **Games** | Which games am I keeping and not playing? | The Steam library |
| **Chat apps** | What have Zalo and Telegram downloaded, and which conversation is it from? | What those two apps downloaded — never a message database |
| **Developer** | What have my development tools filled the disk with? | Package caches, SDKs, editor caches, WSL and Docker, and your own projects |
| **Trends** | Is this getting worse, and how fast? | Every volume the app knows about |
| **Restore** | What did the app do, and can I have it back? | Everything in the Action Journal |
| **Automatic** | Can this happen without me? | Policies you write, one Windows task each |
| **Settings** | Appearance and your own colours, language, keys, version | The app itself |

Plus three things outside the window: an optional **tray watcher** that warns
before a disk fills, a **scheduled cleanup** that runs with no window open, and,
if you switch it on, CleanDrive in **Explorer's right-click menu**.

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

### The first time it opens

Three short screens, each with **Skip**, and Esc closes them:

1. **It shows you, then you decide** — a row as the lists draw one: a verdict,
   how sure the app is, and the reasons.
2. **Moving to the Recycle Bin is not freeing** — the same drive after a move
   to the bin (exactly as full) and after the bin is emptied, and the two
   sentences the app puts beside its buttons to say which is which. It is
   labelled an illustration, and it has no figures: it is not your drive. For
   anyone who asked Windows for less motion, the file does not travel into the
   bin; the bin is simply shown holding it.
3. **Choose the first folder** — the folder shortcuts, the picker, or the
   System screen. A folder chosen here is only chosen: the scan starts when you
   press **Scan folder**, as it always does.

"The first time" is decided by the main process from what is on disk: every
launch writes a disk measurement, a change of settings writes the settings, a
delete writes the journal. None of them there means nobody has run the app on
this account — so somebody upgrading is not introduced to an app they already
use. **Show the introduction again** is on the Version card in Settings.

### The sidebar

Twelve tabs down the left, each with an icon and a label. Two of them carry a
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

**A Windows contrast theme is followed.** With one on, Windows replaces the
app's colours with its own, and the app makes sure nothing it says depends on a
colour Windows took away: the selected screen, the pressed option and a ticked
row are drawn in the system's highlight, a progress bar keeps its fill, the
drive's five parts on the System screen become five patterns, and the map of a
folder — drawn on a canvas, which Windows does not recolour — asks for the
system's colours and draws in those. [Unverified] This was checked on a contrast
theme emulated through Chromium's developer protocol, which forces the palette
for real, not on each of Windows' own contrast themes.

**Or your own colours** (Settings → *Your own colours*): eleven colour pickers,
each with the colour written out as `#rrggbb` beside it, a small preview drawn in
them, and **Import…** / **Export…** for a theme file. Every change is checked as
it is made — text at 4.5:1 on every surface, the edges of fields at 3:1, the
three verdict colours readable on their own badges and never too alike to tell
apart — and the colours cannot be used until every check passes. The verdict
colours may be changed (blue and orange for somebody who cannot tell red from
green), but they still mean only verdicts. While **Custom** is chosen it is drawn
even over a Windows contrast theme; that was a deliberate choice. A theme file
holds eleven `#rrggbb` values and nothing else — no names, no `url()`, nothing
that could become CSS the app did not write — and anything over 32 KB is refused
unread.

The two built-in themes are held to the same rules, and failed four of them when
the rules were first written: the quietest text was 3.4–4.1:1, the edges of text
fields 1.3:1, a button's label on the dark theme's blue 3.2:1, and the green of a
*safe* badge 4.46:1. All four were moved along their own hue until they pass.

### Keyboard and screen readers

- **Every control is a Tab stop, or sits where the arrow keys reach it.** The
  sidebar is a list of tabs (↑/↓ move and open, Home/End), a list of files is
  one stop (↑/↓ between rows, Tab to the row's own buttons), and the map and the
  photo grid move with the arrows. **?** anywhere outside a text field lists
  every key.
- **A screen reader is told what the screen does not show where it is
  looking:** a finished scan, a new phase of a delete, a receipt, how many are
  now selected — through two announcement regions written at those moments,
  never on every progress tick. A failure interrupts; the rest waits its turn.
- **Pictures and charts have words.** Each photo says its name, whether it is a
  photo or a video, its size and its date; the disk-usage chart is followed by a
  table of its readings; the page says which language it is in, so the voice
  reading it is the right one.
- **Left alone, the window stays where you left it.** The disk monitor's
  readings (once a minute by default) update the figures in place: the control
  you are on keeps the focus, the chart keeps its nodes while its newest reading
  moves, and nothing typed but not yet saved on Automatic or Trends is put back.
  Before this, both screens redrew themselves at every reading, which took the
  focus off a tick box and dropped it on the page itself (measured).
- Checked by `npm run test:a11y`: axe-core on every screen in both themes, in the
  user's own colours and in Vietnamese, and again with every kind of control
  forced into its hovered and focused look (a colour that only exists under the
  pointer was found only when the real pointer happened to rest there);
  Chromium's own accessibility tree; Tab walked through every screen; the keys
  pressed; a contrast theme emulated. `npm run test:idle` takes real readings
  the way the monitor does, on every screen, with the keyboard somewhere and an
  edit unsaved.
  Narrator was tried on the one test machine with 0.1.16 and confirmed to work
  (as a whole, not item by item). It once jumped on its own while nothing was
  touched, while another heavy job was running; with that job stopped, it was
  confirmed to work. So the cause was not separated, and the redraw above was
  fixed because it was a fault either way. [Unverified] The build with that fix has been
  checked by `test:idle`, not listened to. Windows' UI Automation cannot see
  into this Electron's pages from outside to check it.

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
- **From Explorer**, once it is switched on in Settings: **Analyse with
  CleanDrive** on a folder, on the empty space inside one, or on a drive opens
  the app on it and scans it; **Find duplicates with CleanDrive** on a file looks
  for its copies. On Windows 11 both are under *Show more options* (or
  Shift+F10). Each is offered for one item at a time — a menu entry on a
  selection of forty would start forty searches.

The Disk usage and Duplicates screens work on the folders chosen here — one,
several (**+ Folder**), or a whole drive (**Whole drive…**). Photos & video
works on its own curated list instead, described below.

### The right-click menu, and what it writes

Off until you switch it on. Switched on, it writes four entries under
`HKEY_CURRENT_USER\Software\Classes` — your account only, no administrator —
each naming this copy of `CleanDrive.exe`. Every launch checks them against the
executable and the language actually in use, and rewrites any that differ, so
moving the app or changing its language does not leave a menu pointing at
nothing or speaking the wrong language. Switched off, they are taken out; so
they are when the app is uninstalled (not when it is updated). The card in
Settings says what the registry has, read back each time it is opened, not what
the setting says.

What Explorer passes in is somebody else's input, and treated so: the app only
acts on a path that is absolute, exists, and is a folder or a file as the entry
expects — and it only ever reads it. A second copy started from the menu while
the app is running hands its request to the first and quits.

Windows 11's own new-style menu wants a signed package with native code inside
it, which this app does not have; the classic entries are what it can offer.

---

## Screen 1 — Disk usage

One pass over the chosen folder produces everything on this screen.

### Several folders, or a whole drive

**+ Folder** beside the folder adds another, and **Whole drive…** lists the
drives with their free space and scans one from its root. Each folder is still
scanned on its own — its own point in Trends, its own snapshot for "What
changed" — and the screen joins them: one set of figures, one largest list,
one set of groups in What to delete, and a map whose first level is a tile per
folder. A folder chosen inside another is scanned with it, not twice, and the
status line says so. Duplicates looks across all of them.

What the app may do depends on the drive, and each rule is a measurement:

| Drive | What happens |
| --- | --- |
| This computer's own disks | As always |
| An external disk (USB) | As always; the row says it is external |
| A network drive or share | Read, and **nothing offered**. The Recycle Bin refused a network path when it was tried (`\\localhost\D$\…`: "Failed to perform delete operation", file untouched), so there is no delete there that could be undone. Duplicates leaves it out |
| A removable drive (card, stick) | Read, and nothing offered — what the Recycle Bin does there has not been measured yet |

The same rule is checked again when anything asks for a delete, whatever the
window sends. A whole drive's map has one more tile, **(not in this scan)**:
the drive's space in use minus what the scan counted — Windows, programs,
other people's folders, what could not be read. It is an estimate (the drive
counts allocation, the scan counts file sizes) and it opens the
[System](#screen-2--system) screen, which says what it is.

Scanning more than one folder at once, or a whole drive, is a Pro feature
(`pro.scan.multiroot`).
Choosing `C:\` in the folder dialog stays what it always was.

### Fast scan

With a whole drive chosen, a switch appears beside **Scan**: **Fast scan
(needs administrator)**. Instead of opening every folder in turn, the app
reads the drive's own catalogue — NTFS keeps one, `$MFT`, which lists every
file on the volume with its size and its dates. Reading it needs
administrator, so ticking the switch raises one Windows prompt; declining it
is an answer, and the scan runs the ordinary way.

What comes back is a list of names and sizes, nothing more, and it goes
through **exactly the same scan** as always — the same folders skipped, the
same hidden and system files left out, the same `.gitignore` rules, the same
verdicts. There is one scanner; the catalogue only changes where it gets its
answers. The status line afterwards names the one that answered, with what it
read: *"Read from C:'s own catalogue: 1,894,144 records, 1.81 GB, in 23.5s."*

It is offered for a whole drive and nothing smaller, because the cost is the
drive's and not the folder's: `D:` has 516,000 records in its catalogue where
a walk of the same drive lists 192,000, since the walk skips `node_modules`,
`.git` and hidden folders and a catalogue cannot skip anything. For one
folder the fast scan is the slower one.

How much faster it is depends on how warm Windows' cache is, so the honest
version is: the catalogue read is **steady** where the walk is not. Measured
on this machine, whole drives, both scanners producing the same answer:

| | Read the catalogue | Then scan it | Total | The ordinary walk |
| --- | --- | --- | --- | --- |
| `C:` — 1,198,835 files | 23.5 s | 45.8 s | **69.4 s** | 86.5 s (44.2–144.8 s across runs) |
| `D:` — 515,940 files | 4.6 s | 3.0 s | **7.5 s** | 10.7 s (4.6–28.1 s across runs) |

So: faster, but not by the margin the phrase "read the table instead of
walking it" suggests — most of a fast scan is still the scan. What the
catalogue really buys is that the first number does not move, while the last
column swings by a factor of three on the same drive depending on what
Windows happens to have cached.

It falls back to the ordinary walk, and says why on the status line, when the
drive is not NTFS (FAT, exFAT and ReFS have no catalogue), when it is a
network or read-only drive, when the prompt is declined, and when the
catalogue cannot be read. Fast scan is a Pro feature (`pro.scan.mft`).

**In 0.4.0 and every version before it, the switch never actually read the
catalogue.** The figures above were measured by a test harness reading the
drive in its own process. The app hands the read to its administrator helper,
and inside the helper the drive's name was turned into its root *folder* —
so every fast scan quietly fell back to the walk and said the catalogue
"could not be read". Found on 2026-10-01 and fixed after 0.4.0. Measured
since, as administrator, through the helper itself: `D:`'s 518,136 files in
4.7 s, the same table a helper run under plain Node reads.

### The four figures at the top

Total size · file count · folder count · how long the scan took — including
the catalogue read, when there was one.

### Where the space went

A **map of the folder**: every folder in it is a tile sized by what it holds,
and the folders inside those are drawn inside them, three levels deep where
there is room. **Click a folder to go into it**; the path above the map goes
back up. Point at a tile for its full path, its size, how many files it holds
and its share of the folder around it, and — for a file the app has an opinion
about — the verdict and how sure it is. Right-click a file for **View**,
**Reveal** and **Add to selection**, which ticks it into the same floating bar
the largest files use; right-click a folder for **Open**, **Reveal** and
**Move to another drive…**.

### Moving a whole folder to another drive

`Videos\2019` is not two hundred files, it is a year — so this moves the
arrangement, not just the bytes. Every file is copied, hashed on the way out
and read back before it counts; empty folders come too; names, timestamps and
the read-only bit are kept; and the extra data Windows hangs off a file — the
mark that says it was downloaded from the internet, among others — comes with
it, because a copy without that mark is treated as more trustworthy than the
original was.

Nothing happens to the original until the copy has been proved. Then the
original folder goes to the Recycle Bin, whole, so it can be dragged back out
in one piece. **That frees nothing yet** — the Recycle Bin is on the drive the
folder just left, and the space comes back when the bin is emptied. If
anything at all fails, the half-made copy is removed and the original is left
exactly where it was; and if the copy is fine but the original cannot be
moved, the copy is removed too, because two copies and no word about it is the
worst outcome available.

A link inside the folder is stepped over rather than followed — copying
through one would drag in somebody else's folder, and recreating it would
leave a link pointing back at the drive the files just left. You can choose to
leave a shortcut where the folder was. It is a `.lnk`, never a junction: a
junction is transparent, so every tool that walks the disk follows one without
being told, and a folder "moved" behind one is counted on both drives at once.

Three kinds of folder are handed over rather than moved, each to the tool that
actually knows where it lives: a **game** to Steam's own *Move install folder*,
a folder **Windows has a registered location for** (Documents, Pictures and
the rest) to Properties → Location, and a folder **inside OneDrive** to
nothing at all — its files are on your other devices too, and binning the
original here would delete them there.

### Packing a folder into one archive

The other answer to "this folder is big and I am not opening it": ten thousand
files become one `.zip`, kept wherever you like, including on the same drive.
The folder then goes to the Recycle Bin, so — as everywhere else in this app —
nothing is freed until the bin is emptied.

**Only what compresses is compressed.** Measured on this machine, deflating
real files: a folder of source code gives back 68% of its size, a folder of
documents 10%, and a folder of photos and video gives back nothing at all —
`.docx` saves 1%, `.png` 1.5%, and an `.mp4` comes out very slightly *bigger*.
So each file is tried on its first 64 KB and the ones that will not shrink are
stored as they are, which saves minutes of processor on a folder of video for
a saving that was never going to arrive. The confirmation states the estimate
before you agree: for a source project it says how much smaller, and for
photos it says plainly that packing them is about having one file instead of
thousands rather than about space.

**It is checked before your folder is touched.** The archive is written, then
reopened and read back: every file's checksum, every file's length, and every
file's SHA-256 against a `manifest.json` written inside the archive. Only then
does the original folder go to the bin. An archive that cannot be opened is
not a backup, it is a folder that has been deleted, so a single wrong byte
anywhere means the archive is removed and the folder is left exactly where it
was.

**Getting it back.** A `.zip` opens in Explorer like any other, but Explorer
will not restore the timestamps and checks nothing, so the Restore Center
unpacks it itself — every file back where it was, every checksum verified,
every modification time set, and the manifest left out, because it was never
one of your files. Files larger than 4 GB are handled (ZIP64), Vietnamese
names survive, empty folders come back, and a link inside the folder is
stepped over rather than followed.

### Letting NTFS hold a folder in less room

The third thing you can do with a folder, and the only one anywhere in
CleanDrive where "this frees space" comes with no conditions attached. Nothing
moves, nothing is copied, nothing goes to the Recycle Bin. The files stay
exactly where they are, keep their names and their contents, and every program
that opens one sees what it always saw — Windows simply stores them in fewer
clusters. The space is back the moment it finishes.

**It measures your folder before it promises anything.** Not a rule of thumb:
a dozen of that folder's own files are copied to a scratch directory on the
same drive and put through NTFS, and the answer is what the confirmation
quotes. On a 20.7 MB folder of source code that took 361 ms and said 87.6%,
and the real result was 87.5%. On a folder of photos it samples nothing at
all — the extensions already answer it — and says so: these files are
compressed inside already, and NTFS has nothing left to take out. Measured
here, a source project gives back 87.5% and archived logs 81.2%, while photos
and video give back 0.0%.

**What it will not do.** The Windows folder — compressing Windows itself is
CompactOS, which Windows has its own setting for, and this points you at it
rather than interfering. Anything belonging to an installed program, or to a
game, which goes to Steam as it does everywhere else. A drive that cannot hold
compressed files, which is settled by trying rather than by guessing from the
cluster size. And a folder with files in it that are **only on OneDrive**,
because compressing one would pull it back down — exactly the space *Keep on
cloud only* had just given you.

**Stopping again** is the same menu entry: the app asks the disk whether the
folder is compressed and offers the other direction. Nothing is deleted either
way; the files simply go back to taking their full room.

One thing worth knowing: the map on the Disk usage screen shows **file sizes**,
and compression does not change those. A compressed folder still reads as the
same number of megabytes there, because the files really are that size — what
changed is how much of the disk they occupy. The receipt after compressing
tells you that figure.

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
  Space ticks, Shift+arrow extends, Enter opens the file in the viewer, and Tab
  from a row walks its own buttons — the reasons, View, Reveal, Open. They used
  to be out of the Tab order on every row, which left Reveal and Open out of the
  keyboard's reach altogether.
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
| The one exception | Duplicates' [whole-folder comparison](#whole-folders) does enter all of those. Nothing else does, and system locations stay out even there |
| Unreadable entries | Recorded and reported as a count; the scan continues |

Because system locations are excluded by design, **scanning `C:\` under-reports
the drive's real usage**. The status line says how many locations were left out
and how much space in use the scan did not count, the map draws that as its own
tile, so the gap is visible rather than mysterious, and the
[System](#screen-2--system) screen measures all of it. A system folder is one
however its path is spelt: `\\?\C:\Windows`, `\\localhost\C$\Windows` and
another machine's `\\pc\C$\Windows` were all not recognised as one until they
were tried (2026-09-26).

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

---

## Screen 3 — Plan

Every other screen answers *what is here*. This one answers *what do I do*.

Say how much room you need — **I need 30 GB on C:** — and press **Work out a
plan**. It measures the other screens, then sorts what they found into steps
in rising order of risk: temporary files and caches first, then OneDrive
files that can go back online, build folders your `.gitignore` declares,
developer caches, the system areas Windows can reclaim, old installers and
big archives, and finally programs and games you have not opened in months.

**There is no "carry out the plan" button, and there will not be one.** Each
step is a link to the screen that already offers that work, where you tick
the rows and confirm them yourself, exactly as you would have. A button here
that deleted nine categories of file across six screens on one click is the
one thing this app has never done.

### The number that is not the size of the files

A step says two things, because they are different: **how much it moves**,
and **how much that gives back**. Three things can happen to the space:

| | What the step says |
| --- | --- |
| Moved to the Recycle Bin | *"Moves 10.1 GB to the Recycle Bin — not freed until it is emptied"*. The running total does not move. |
| Freed on the spot | *"Frees 6.8 GB straight away"* — a OneDrive file going back online only. |
| Windows frees it | *"Windows frees 18.6 GB when you go through with it"* — hiberfil, Windows.old, restore points, an uninstaller. CleanDrive opens the tool and counts nothing itself. |

So the plan contains a step of its own: **empty what CleanDrive put in the
Recycle Bin**. Everything above it that went to the bin is still on the drive
until that step, and the running total climbs there rather than earlier. This
is the same rule the rest of the app follows — the bin is on the same volume,
so moving a file into it frees nothing — applied to a screen whose whole job
is adding up what you would get back.

The bar at the top is how far the plan gets toward what you asked for. Steps
past the point where the goal is met are dimmed but still readable: they are
the ones you do not have to do.

### What it will not count

When the sources it knows about do not reach your goal, it says so and does
not pad the numbers: *"The sources CleanDrive knows about come to 36.5 GB of
the 120 GB you asked for. The rest would have to be your own files — see Disk
usage."*

Two sources are left out on purpose, and each says why on the screen:

- **Duplicates.** Finding them means reading the contents of nearly every
  file on the drive rather than just its size — the floor is 1 KB. Every
  other source here reads metadata. Run the Duplicates screen if you want
  them counted.
- **The system areas**, unless you tick the box. Measuring them properly
  needs administrator, and a prompt you did not ask for is not something this
  app does.

A source that fails to measure is named too, and the plan is built from the
rest rather than abandoned.

The Space Planner is a Pro feature (`pro.planner`).
## Screen 4 — What to delete

The same scan, read a different way: not "what is big" but "what is disposable".

Every file receives exactly one of four verdicts — **safe**, **review**,
**protected**, **keep** — and lands in one of ten categories, or in a
[known app's own cache](#known-apps-caches):

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
  | A known app's own cache folder, with the app closed | strong |
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
- **Held back**: the folders that hold installed programs, or programs' settings
  and data. Nothing in them is called safe except GPU and crash files and a known
  app's own cache.

### The thresholds, in one place

180 days before *untouched* · 100 MB before *large* · 30 days before an installer
has served its purpose · 7 days before a log is old · 50 MB before an archive is
worth reviewing.

All ages in one scan are measured against a single instant, so two files written
a millisecond apart cannot land on opposite sides of a threshold.

**A folder named `logs` does not decide on its own.** It used to: everything
inside one was an old log file, whatever the file was. A real folder on the
machine this was written on — 108 `.log` beside 82 screenshots — was therefore
79 MB of pictures marked safe to delete. Now the folder's name settles only
files whose own name does not contradict it (`.log`, `.txt`, `.etl`, `.out`,
`.err`, `.trace`, `.dbg`, a rotated `.log.1`, or no extension at all).
Everything else in there is judged exactly as it would be anywhere else, which
for a screenshot means nothing is said about it.

### Selection tools

*Select everything marked safe* (which skips every `review` group), *select all*
within one category, and *clear selection*. A live readout shows `n selected ·
total size`, and the delete button stays disabled until something is ticked.

### Known apps' caches

For seven apps — Google Chrome, Microsoft Edge, the new Microsoft Teams,
Discord, Zoom, Figma and Zalo — the scan knows which of their folders are
cache, and each gets a group under its own name. Only the folders on that
app's list count: `Cache`, `Code Cache`, `GPUCache` and the shader caches, in
each profile. Everything else in the app's folder — `IndexedDB`,
`Service Worker`, `Local Storage`, sign-ins, extensions — is left alone, even
where it is bigger. Each list was checked
against the app's real folders on a real machine
([`src/main/analyzers/app-caches/`](src/main/analyzers/app-caches/)), and an app
is shipped only when that could be done; Adobe Camera Raw is not.

Zalo is on that list for its browser caches only — around 600 MB here. What it
has downloaded from conversations is a different thing entirely and lives on
[Chat apps](#screen-9--chat-apps), where nothing is ever marked safe.

An app's cache is offered only while the app is closed. The scan asks Windows
which programs are running as it finishes. An open app's group says *open*,
nothing in it can be ticked, and it is not in *Safe to delete*: close the app
and scan again. If the list of running programs cannot be read, no app's cache
is offered. The check is made again just before anything moves, so an app
opened between the scan and the click keeps its cache — those files are skipped
as in use.

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

## Screen 5 — Photos & video

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
· Zalo conversations · Telegram, one entry per signed-in account · WhatsApp ·
Viber

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

### Five axes, four different controls

The first version of this screen shipped with thirty-three filter chips wrapped
over five rows — four hundred pixels of controls, in a bar that did not scroll
away. The photographs, which are the only reason to open the screen, got about
two rows.

The mistake was using one control for three different shapes of data:

| Axis | Shape | Control | What the shape buys |
| --- | --- | --- | --- |
| Where from | A partition — each file is in exactly one | **One proportional bar**, segments sized by bytes | The *share* each source takes, not merely that it exists. 3,450 screenshots at 674 MB should not look bigger than 463 photographs at 1.3 GB |
| When | An axis — ordered, with gaps, and three levels deep | **A histogram you can walk into**: years, then months, then days | The shape of a library over time, its empty stretches, and the single day an event filled — in the space three chips used |
| What it is | Overlapping tags | **Chips**, which genuinely fit | Unchanged — but far fewer of them |
| Conversation | A partition of *part* of the library — most photographs came from no chat at all | **One proportional bar**, over the chat pictures only | Which conversation took the room. The card is absent entirely when nothing came from a chat |
| Where taken | Points on the earth, which is not a list at all | **A map**, off until you switch it on | Which trip, rather than which folder. Absent when nothing recorded a position, and it is the one axis that reaches the network — see *Where they were taken* |

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

### When they were taken

The card called **When** is a histogram you can walk into. It opens on years;
click one and the bars become that year's twelve months; click a month and they
become its days. A trail above them — *All years › 2026 › September* — walks
back out again.

Zooming in and filtering are the same gesture on purpose. The bar you clicked
is the bar you are looking at, and the grid below shows exactly what it
counts. Clicking the bar you are already on steps back out.

**Empty bars are drawn, not skipped.** A month with nothing in it is a fact
about your library, and closing up the gap would quietly redraw its history.

**It says where its dates came from, at every level**, and that line is the
most important thing on the card. Measured on the machine this was built on,
of 11,419 pictures and videos:

| | |
| --- | --- |
| a date from the picture or video itself | 513 (4.5%) |
| only the file's own date | 10,906 (95.5%) |

That sounds alarming and mostly is not. A screenshot has no capture date and
never will; the moment the file was written *is* the moment it was taken. A
picture from a chat is dated when it arrived, which is what somebody clearing
space means by "when". The one case where the two can really differ is a
photograph copied off a camera — and of the 513 files carrying both dates,
**98.1% agree to the day** and not one is more than a year out.

So the timeline draws from whichever date exists and tells you which, rather
than hiding the difference or refusing to go past years.

### Where they were taken

Off until you switch it on, and the card explains what switching it on does
before it does anything. It is absent entirely from a library where nothing
recorded a position — not an empty card, not an explanation of a feature you
cannot use.

**Two things happen when you turn it on**, and both are in the card:

- The position stored inside each picture is read. Nothing else in this app
  reads one. Until this feature existed the code deliberately refused to, and
  the reason is still in the comments.
- Pieces of map are fetched for the area your pictures are in — so whoever
  serves those pieces learns roughly where your pictures were taken. That is
  the real cost, and it is not reduced by the map being useful.

This is the second thing in the app that reaches the network. The first is the
update check, and the Settings card for it used to say it was the only one;
that sentence has been changed rather than left standing.

**The window itself still never touches the network.** It runs under a policy
that forbids it, and that policy was not loosened: the main process fetches
each piece of map and hands the bytes back, which is the same route thumbnails
have always taken.

Pins that land on top of each other become one with a count on it. Clicking it
filters the grid to the pictures it holds. **Zoom out**, **Zoom in** and **Fit
all** are the only controls — there is no dragging, which is where a
hand-written map goes wrong first.

**When the pieces of map cannot be fetched**, the pins are still drawn in the
right places and a line says why the background is missing. Where your
pictures were taken is not in doubt because a server did not answer.

Map pieces come from OpenStreetMap, are credited on the map as its licence
requires, and are kept on your computer after the first time — **Settings →
Map tiles** says how many and how much, and removes them.

**One number worth knowing before you turn it on.** On the machine this was
built on, 38 of 11,419 pictures and videos recorded a position at all — 0.3%,
and nearly all of them from phones a decade old. Screenshots never do, chat
pictures almost never do, and most modern phones have the setting off. The
feature works; there may simply not be much for it to show.

### Which conversation a picture arrived in

Zalo puts the conversation in its folder names, so the photographs it has
downloaded can be divided up by chat. That folder is in *Where to look*, on by
default, like the other chat apps already there.

A conversation is shown by its id and the card says why: the name is in the
message database, and the app does not open message databases. Clicking a
segment filters the grid to that chat; the legend lists the largest few and the
bar holds every one of them.

Two things had to be relaxed to see these pictures at all, and both only
inside a chat app’s own download folder. Zalo writes the original of every
photograph **with no file extension**, into a folder it calls `Cache` — and
the scan normally refuses a file whose extension it does not know, and refuses
any folder called Cache. On this machine those two rules between them were
hiding **4,005 readable photographs and 57 playable videos**. Inside those
folders a file is judged by its first bytes instead. Everywhere else both
rules stand exactly as they were.

Zalo also keeps a second, re-encoded copy of every picture, and **those are
not shown**: nothing on this computer can decode the format they are in, so
they would be several thousand tiles reading *no decoder*. The status line
says how many were left out and how much they come to, and the copy that can
be opened — the same photograph — is in the grid. Their space is accounted
for on [Chat apps](#screen-9--chat-apps).

Telegram has no conversation axis. Nothing in its folders is named after a
chat, so there is nothing to divide by, and the card simply does not appear.

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

### Photos that look the same

Below the three overview cards, a list of groups: the same photograph at several
sizes, the copy a chat app re-encoded, the frame taken twice. Each row says how
many, how much sits in the copies, and how alike they actually are — *the same
picture as far as this can tell*, or *they differ by 3 of 64*.

**It only groups photos it has looked at, and it says how many that is.**
Comparing two pictures means decoding both, which costs **70.6 ms a file** on the
machine this was built on. The grid does that a screenful at a time — that is why
a library of thousands opens at all — so straight after a scan this list is
nearly empty and the card says so: *Looked at 214 of 4,124 photos so far.*

**Look at the rest** does the whole library, with a progress count and a stop
button, and the button says roughly how long before you press it. On the default
folders here that is about five minutes. It is paid once: what is measured from
the pixels is kept, and a second run takes under a second.

**Photos stored online only are left out**, and the card names how many. Opening
one would download it — on this machine that is 2,534 pictures — which is the
opposite of what *Free up space* just did.

### Side by side

**Compare** on any group, or two to four files you ticked yourself, opens them
next to each other. **Videos open here too**, which is what makes a smaller copy
worth looking at before you decide anything about the original.

- **Zoom and pan are locked together.** Scroll to zoom, drag to pan, and every
  photo moves with it. Comparing sharpness means looking at the same corner of
  each picture at the same magnification; panes that moved independently would
  be showing different things.
- **Flick between two** puts the first two in the same rectangle, one after the
  other. A difference of a few pixels does not survive the journey your eyes make
  between two pictures side by side. In the same place, one after the other, it
  jumps out.
- **A table of the facts that differ**: dimensions, megapixels, size, detail,
  when it was taken, camera, ISO and shutter, and for videos their length and
  data rate. A row nothing on screen carries is left out rather than filled with
  dashes, so the table changes shape with what is in it.
- **With videos, the clocks are locked together instead of the zoom.** Play,
  pause or seek one and they all follow, so you are always comparing the same
  moment — for the same reason the zoom is shared between pictures. The sound is
  off: two to four soundtracks at once is noise, and the thing being compared is
  the picture.
- `1`–`4` ticks a file, `←` and `→` move between groups, `Esc` closes.

**Nothing here decides for you.** The photos are *ordered* by resolution, then
detail, then size, and the screen says that is an order and not a recommendation.
The cell holding the value that stands out is shaded — largest, or lowest for ISO
— and the line under the table says shading means *stands out*, not *keep this*.
The shading deliberately is not green: in this app green, amber and red mean
*safe to delete*, *your call* and *keep*, and borrowing one here would be picking
the photograph for you. Nothing arrives ticked, and closing the panel ticks
nothing.

### Making a smaller copy of a video

Tick one or more videos and **Make a smaller copy…** appears on the bar. It
offers two levels — *Smaller, keeping the quality*, and *Smallest*, which also
brings anything wider than 1280 pixels down to it.

**The size it quotes is measured, not predicted.** Before anything is written,
the app encodes the opening of each file for real and multiplies, which is why
it says *likely*: a recording whose second half is busier will come out larger.
On the machine this was built on that trial costs about three seconds for three
clips.

What it does, and does not do:

- **The copy goes beside the original**, with `.cleandrive.mp4` added to the
  name. If that name is taken it becomes ` (2)` — nothing is ever overwritten.
- **Nothing is deleted.** The original stays exactly where it is. Putting it in
  the Recycle Bin afterwards is yours to do, through the ordinary button, once
  you have looked at both.
- **Until you do, this uses more space, not less** — for a while the drive is
  holding both copies. The dialog says so rather than leaving you to find out.
- **The capture date and the rotation are carried over.** A phone shoots a
  portrait video as landscape pixels plus a quarter turn, and a copy that lost
  that would be lying on its side.
- **The location is deliberately not carried over.** If the video records where
  it was taken, that stays in the original and does not go into the new file.
  Writing a coordinate into a file this app creates is the one thing it refuses
  to do with one, and the dialog says it is refusing.
- **The sound is copied across untouched** rather than re-encoded, so it loses
  nothing. The rare video whose audio is in a format that cannot be copied comes
  out silent, and the screen says which.
- **The copy is opened and read back before you are told it exists.** A smaller
  file that nothing can play is worse than no file, so one that will not read
  back is deleted rather than left looking like a result.

Some files are left out, and each one is named with the reason:

- **Videos stored online only.** Reading one would download it, and it is not
  taking up room on this drive to begin with. On the machine this was built on
  that is 308 of 381 videos — 4.6 GB by name, nothing at all on the disk.
- **Anything that is not an MP4 or a MOV**, and MP4s split into fragments, which
  this cannot take apart yet.

No encoder is downloaded and none is bundled: this uses the video encoder
already in the app, and the one in your computer behind it.

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

### Back up before deleting

Because these are the files that cannot be got back, this screen can keep a copy
somewhere else first — an external drive, a network share, any folder you pick.
**Back up before deleting…** on the action bar chooses where; the button then
names the folder, and clicking it again switches backing up off without
forgetting the folder.

What happens, in this order and no other:

1. Each file is copied to the destination.
2. The copy is **read back off that disk** and checked against the original with
   SHA-256, and its length is checked too.
3. A `manifest.json` at the top of the destination records what was copied, where
   it came from, and each hash.
4. Only then do the originals go to the Recycle Bin.

**A file whose copy does not match is not deleted.** It stays exactly where it
is, and the receipt says how many were left alone. If the manifest cannot be
written, nothing is deleted at all — the copies stay, but nothing is thrown away
on the strength of a backup the app cannot describe.

Your files land under the destination in their original paths, with the drive as
the first folder: `C:\Users\you\Pictures\trip\a.jpg` becomes
`<destination>\C\Users\you\Pictures\trip\a.jpg`. The drive has to be in there —
without it, the same path on two different drives would be the same destination.

**Nothing is ever overwritten.** A file already there with the same contents is
recognised and not copied again; one with the same name but different contents is
saved as `a (2).jpg`. Backing up to the same folder next month adds to the
manifest rather than replacing it.

The confirmation dialog carries the switch as a tick box, so you can turn the
copy off for one delete without leaving the dialog.

> **Known limit.** A network destination is allowed and works here, but no NAS
> has been available to measure on the machine this was built on, so nothing is
> promised about speed over one. Copying to a network share is untested against
> real hardware.

---

## Screen 6 — Duplicates

Byte-identical files inside the chosen folder — and, if you ask for them,
whole folders that hold the same thing, and documents whose names look like
drafts of one another.

### Controls

**Ignore files under** — 1 KB, 100 KB (default), 1 MB or 10 MB.

**Also compare whole folders** — off by default. See *Whole folders* below.

**Also look for drafts of one document** — off by default. See *Drafts of one
document* below.

**Suggest keeping** — which copy of a group carries the *keep* tag:

| | |
| --- | --- |
| the oldest copy | The default, and what it has always been: the oldest is the original and the rest are copies somebody made of it. |
| the copy on this computer | Keeps the one on an internal disk, so the copies on a drive you carry around are the ones offered up. |
| the copy on an external or network drive | The other way round: keeps the one that is away, so the space comes back on the disk that is short of it. |

The drive rules are Pro (`pro.dupes.advanced`). Asked for without it, the
search still runs and the status line says the oldest copy was kept instead —
it is not quietly downgraded, because a list of keepers that is not the one
you asked for is worse than being told no. The oldest copy always breaks a
tie, so the drive rule narrows the old rule rather than replacing it.

With several folders chosen it looks across all of them, on this computer's
drives: a folder on a network drive is left out, and the status line names it.
Hashing files over a network is not offered, and the reason is that nobody has
been able to measure how slow it would be here — the only share this machine
can reach is its own disk through its own address, where the bytes never
actually cross a network.

### Copies of one file

**Find duplicates with CleanDrive** on a file in Explorer opens this screen on
that file alone: every byte-for-byte copy of it in your Home folder, or on its
whole drive when the file is not in Home. Only the files of its exact size are
read at all, so it is a walk of the folder and a handful of hashes. The same
list and the same rules follow — the oldest copy is the suggested keeper, and
nothing is ticked. "No other copy" says where it looked.

### What it reports while it works

Named phases, with counts and elapsed time, so a long search is legible rather
than a spinner: **Indexing files → Grouping by size → Comparing file heads
→ Verifying full contents**, and with whole folders on, **Comparing folders by
name and size → Verifying folder contents → Comparing folders that nearly
match**.

Looking for drafts adds no phase, because it adds no reading — it happens once
the walk is done, on the list the walk produced.

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

### Whole folders

Tick **Also compare whole folders** and the screen gains a section above the
file groups: folders that hold the same thing, and folders that nearly do. One
row there stands for hundreds below it — two copies of a project, a photo
import done twice, a `dist` and a `release` built from the same source.

This is Pro (`pro.dupes.advanced`). Asked for without it, the search still runs
over files and the status line says the folder comparison was refused, the same
way the drive rules do.

**Two folders are the same when their files are**: the same relative paths,
and the same bytes at every one of them, confirmed by a full SHA-256 on both
sides. A folder that exists on one side and holds nothing does not make them
different — there is nothing in it to lose.

**It looks at everything.** For this comparison, and only this one, the walk
goes into `node_modules`, `.git`, `.venv`, `__pycache__` and names beginning
with `.` or `$`, which every other scan in the app leaves out. It has to: if
two folders differ only in a `.env` the app never looked at, calling them
identical would be how you lose that file. There is no switch for it, because
a switch you could set wrong is a switch that costs you a file.

That costs walking time and nothing else — measured on this machine,
`D:\personal_projects` goes from 15,518 files in 5.9 s to 87,371 in 21.6 s, and
the whole of `D:` from 173,664 in 41.8 s to 464,617 in 79.5 s. No extra file is
*read*: the first pass compares names and sizes only, and contents are hashed
just for the folders that survive it.

**Nearly the same** means at least 90% of the files are identical, counted as
`matching / the larger side` and counted from the hashes rather than estimated.
Such a pair opens a three-column comparison — only on the left, only on the
right, and same place but different contents — because "97% the same" is not
something you can act on until you can see the other 3%.

**What you can do with one.** Nothing acts on a folder: the app does not delete
folders, and neither *Move to Recycle Bin* nor *Move to another drive* accepts
one. A folder row is a heading with no tick. Under a copy that is not the one
being kept, its files are listed and tickable, with **Select every file in this
copy** above them — so "get rid of this copy" is, visibly, sending those N files
to the Recycle Bin.

Under a *nearly* matching folder, only the files verified identical on both
sides are offered. Files that exist on one side alone, or that differ, appear in
the comparison and nowhere else — those are the ones you would actually lose.

**Two things it deliberately does not show.**

- **Folders inside a folder that is already reported.** If `A\` is a copy of
  `B\` then so is `A\sub\`, and listing both would count the same space twice.
  The status line says how many were folded away.
- **Anything under 1 MB.** Measured on `D:\personal_projects`: with no floor,
  233 groups totalling 307 MB; with the 1 MB floor, 13 groups totalling 286 MB.
  220 extra rows to find another 21 MB.

A folder holding a file that could not be read is never claimed as a copy of
anything, and the status line counts those separately.

### Drafts of one document

Tick **Also look for drafts of one document** and the screen gains a second
section above the file groups: sets of documents whose *names* say they are
versions of one another. `Report.docx`, `Report - Copy.docx`, `Report_v2.docx`,
`Report_final.docx` — four different files, one piece of work. The duplicate
finder cannot see them, because their bytes differ, which is the whole point.

This is Pro (`pro.dupes.advanced`). Asked for without it, the search still runs
over files and the status line says so, the same way the other two do.

**It reads names and nothing else.** No document is opened. It rides on the
walk the duplicate search already did, and on this machine grouping 3,833
documents took 0.01 s. Word, Excel, PowerPoint, PDF, OpenDocument, `.txt`, `.md`,
`.rst` and `.tex`, down to 4 KB — under that a "document" is a stub.

Its own 4 KB floor is deliberately below **Ignore files under**. That control
answers "which copies are worth deleting" and defaults to 100 KB, which most
Word drafts are under; it does not get to decide which documents exist. With
this on, the walk goes down to 4 KB and the file half of the screen is filtered
back to whatever you chose.

**Nothing here is ever more than a guess.** A name is a very weak signal:
`Report_v2.docx` may be the second draft of `Report.docx` or a different report
somebody named badly, and nothing short of reading both can tell. So every row
is *a guess*, raised to *likely* only when the files are in one folder and one
format — and **nothing is ticked for you**. There is no *keep only the newest*
and there will not be one.

What there is instead is **Open the two newest side by side**: both files in
one panel, in the same reader the View button uses, so the question is settled
by looking. Reveal and Open are not offered there — they act on one file, and
there are two.

**Two kinds of set are deliberately left out**, and the note above the list
counts both.

- **Names that differ by nothing but a date.** The obvious rule is to strip the
  date along with `_v2` and `- Copy`. Counted on this machine, 1,755 of 6,503
  document names carry a date, and stripping it created 38 sets that existed
  *only* because it had been stripped — `Log 2026-06-13` beside
  `Log 2026-09-26`, a different invoice each time. All 38 were wrong. A date in
  a document name usually says *which* document, not *which draft*, so a date
  comes off only when something else in the set actually says "version".
- **A common filename in unrelated folders.** Same name, different folders,
  nothing else to go on. Without this rule the real disk gave 216 sets, and 180
  of them were not versions of anything: 143 copies of `CHANGELOG.md`, one per
  package in a Dart cache; 135 `README.md`; 25 `LICENSE.txt` — 856 files in all.
  With it: 36 sets. Where those
  files really are the same, the duplicate finder already has them, and it
  *knows* rather than guesses.

Two more rules came from the same counting. `(2)` is Windows' copy suffix, but 6
of the 27 names ending that way were a publication year (`… -Wiley (2018)`), so
only small numbers count. `v2` is a version, but 2 of the 26 ending that way were
`GPLv3` and `LGPLv3`, so it counts only after a separator.

**What you can do with one.** Tick the rows you want, by hand, one at a time,
and send them to the Recycle Bin or to Quarantine like anything else. These
never enter an automatic cleanup.

### Joining copies into one file

Off unless you switch it on in **Settings → Developer → Allow joining duplicate
copies into one file**. It is the heaviest thing in the app and the only one
that changes what a file *is*, so with the switch off the button does not exist
at all — not greyed out, absent. It is part of Pro·Dev (`pro.dev`).

**What it does.** The copies you tick stop being their own files and become
extra names for the copy being kept. Nothing is deleted, nothing moves, every
path goes on working, and the disk holds the contents once instead of three
times. Unlike everything else on this screen, the space comes back
*immediately* — there is no Recycle Bin standing between you and it.

**What it costs.** The copies are now one file. Editing through one name
changes what every name shows. Deleting one frees nothing until the last one is
deleted. The confirmation says this, and you cannot press its button until you
have scrolled the explanation to the end.

**The failure mode, measured here rather than guessed at.** Some programs save
a file by writing a new one over the top instead of writing into the one that
is there. Word and Excel both do. A `.docx` written by Word, joined to a second
name, then opened, edited and saved once:

| | before | after one save |
| --- | --- | --- |
| `report.docx` | 13,457 B, shared | 13,540 B, **its own file again** |
| `report-link.docx` | 13,457 B, shared | 13,457 B, **still the old contents** |

The join silently comes apart, the space silently comes back, and nothing says
so. Documents are skipped for that reason. But the rule underneath is not
"Office" — measured on a joined pair: writing over a file **in place** keeps the
join, and writing a temporary file and renaming it over the top **breaks** it.
Any program doing an atomic save breaks it. The app cannot know which program
will open a file later, so the list of skipped extensions is a stand-in for a
rule it cannot express, and the dialog says so rather than letting the list look
complete.

**Also skipped:** copies on different drives (a hard link cannot cross one),
drives that are not NTFS (asked by reading the volume, not assumed), anything
inside OneDrive or another sync folder, anything in the folders the Photos
screen manages, system locations, installed programs and network paths. The
confirmation counts every refusal and says what each one was.

**It re-reads both files before joining them.** The window sends pairs, but a
hash from a scan minutes old is a claim about a file as it was — and joining on
a stale claim destroys the copy. Both files are read and hashed again inside
the same pass, and again immediately before the link is made.

**Undoing it** is in the Restore Center, listed like any other session. Each
name is split back into a file of its own, which needs room for a full copy of
each. What it restores is their *separateness*, not their old contents: the
copy's original bytes were freed the moment it was joined, so anything written
while the names were joined is what every copy ends up with. The Restore Center
says so.

**It needs no administrator rights.** Hard links never have, unlike symbolic
links.

### Copies that are already one file

Whether or not you ever use the button above, some files on a disk already
share one file — a package manager, a backup tool or an installer may have done
it. Those names hold identical bytes, so they are duplicates by every test this
screen applies, and deleting one of them frees **nothing**.

The screen counts files, not rows. A group of three names that are one file
reads `0 B reclaimable`, each of its rows is tagged **one file · 3 names**
instead of *identical*, and none of them counts towards the Reclaimable total
at the top. The check costs nothing on an ordinary scan: the number of names a
file has arrives with the information the scan already reads, and only groups
that contain such a file are looked at a second time.

### Files in use stay visible and are never bulk-selected

A copy is marked as a program component when its path runs through a dependency
or runtime directory (`site-packages`, `venv`, `vendor`, `.cargo`, `.nuget`,
`gems`, …), when it sits inside a protected system location, or when it is a
loadable binary (`.dll`, `.pyd`, `.so`, `.jar`, `.node`, …).

They remain on screen and can be ticked by hand if you know better. The guard
governs bulk selection only — it decides what a single click may take, not what
you are allowed to do.

---

## Screen 7 — Apps

What is installed, what each one occupies, and when each was last started. The
app never uninstalls anything here: a row's button opens Windows' own list of
installed apps, and the command the program's own uninstaller registered is
shown to copy, never run.

### Where the list comes from

The three places Windows keeps installed programs — the machine-wide list, the
one for 32-bit programs, and your own — plus the apps that came from the
Microsoft Store. On the machine this was built on that is 638 registry entries,
of which 162 are programs somebody installed; the other 476 are what Windows
leaves out of its own list too: shared runtimes, driver packages and updates.
The number left out is shown, not quietly dropped.

Listing needs no administrator rights and took about 26 seconds here.

### Two size columns, and why they are never added together

- **Measured** is its folders, read and added up the same way the System screen
  reads anything. Blank where there is nothing to read — only 69 of the 162
  programs record where they installed to, and 58 of those folders still exist.
- **Declared** is the figure the installer wrote into the registry. It is shown
  in its own column, in italics, and it is never part of a total. Of the 36
  programs here that have both, only 24 are within a factor of two either way:
  one declares 19 MB and occupies 482 MB, another declares 3,080 MB and occupies
  634 MB.

Where several programs installed into one folder — Microsoft 365 registers
itself once per language — each row shows that folder's size, and says so, while
the total at the top counts the folder once.

### When it was last started

Two of Windows' own records, ranked and never added up:

- **What you opened from Explorer and the Start menu**, which is free and
  immediate. On this machine those records go back about four months.
- **Windows' own Prefetch records**, behind the **Add Windows' launch records…**
  button — the folder is closed to a normal program, so this raises one
  administrator prompt, and only when the button is pressed.

**A file's "last opened" time is deliberately not used**, although Windows is
recording it here. Measured: 70% of the programs under `Program Files` had been
read in the past week, while Windows had records of 94 programs actually being
started in four months; of 30 programs that could be matched to a real launch,
all 30 had a newer "last opened" time and only 5 were within a week of it. What
moves it is the antivirus, the search indexer and the backup — not you starting
the program. (A size-only scan does not move it: that was checked separately.)

**No record is not the same as not used**, and the screen says so rather than
implying otherwise. Windows only writes these records for what you open from
Explorer and the Start menu, so a program started from a pinned taskbar button,
a desktop shortcut, or by another program leaves no trace. A row with no record
is `keep` with the reason; only a row that *has* a record, older than 90 days,
is `review`.

### What it will not do

**Uninstall anything, ever.** No app is marked `safe` — the strongest verdict on
this screen is `review` — and nothing here can be part of an automatic cleanup.
Parts of Windows are `protected`, and the row says which of four things made it
so: Windows signed the package itself, Windows' own "cannot be removed" flag,
it is installed inside the Windows folder, or it registered no uninstaller.

### When it arrived

The evidence under a row says how long ago Windows records the program as
installed. **505 of the 581 registry entries on this machine carry that date**,
87%; the other 13% get no line at all rather than a guessed one. It is Windows'
record and not a measurement — an in-place upgrade rewrites it, so a program
that has been here for years can honestly claim to have arrived last week.

---

## Screen 8 — Games

The Steam library: what is installed, how big each game is, and when it was
last played. **The app never removes a game.** Deleting a game's folder leaves
Steam still listing it and failing to start it, so a game's only button hands
over to Steam, with the same command Steam registers as that game's uninstaller.

Only Steam is read. On the machine this was built on there was no Epic, GOG,
EA, Ubisoft or Battle.net library to check against — the Epic launcher is
installed with no games in it — and nothing ships here that could not be
verified against a real installation.

### What it reads, and what it does not

Steam's own files, not the Windows registry. Steam writes a registry entry per
game, and three of them here point at a drive that no longer exists, because
the library was moved and nothing went back to correct them; one holds a game's
Vietnamese name as mojibake while the file beside the game has it right. The
registry is used for one thing: finding where Steam itself is installed.

**Sizes are Steam's own figures, and they are exact.** Every game here was
measured against a real walk of its folder and the two agreed to three decimal
places, 47.05 GB against 47.05 GB. So there is one size column on this screen,
where the Apps screen needs two, and no long scan to open it.

**Last played is the later of two records.** Steam writes one beside the game
and one per signed-in account, and neither is reliably the newer: three of nine
games here had been played more recently than the file beside them said, one of
them by 499 days. Every account folder on the machine is read — the question is
whether anyone has played it here — and only that one date is taken from them.

**When Steam last updated it** is shown alongside, because the two disagree in
the way that matters: a game played two years ago but patched last month is one
Steam still maintains, and one never updated since it arrived is one nobody has
touched at either end. Neither is a reason to remove it, which is why it is
evidence and not a rule.

A game is `review` when it has not been played for six months, which is longer
than the ninety days the Apps screen uses: not opening a program for three
months usually means you are done with it, and not playing a game for three
months usually means it is summer. No game is ever `safe`, and none of this can
be part of an automatic cleanup.

### What Steam left behind

Two things Steam keeps no account of, shown under the games:

- **Unfinished downloads.** Steam does not always clear `steamapps\downloading`:
  1.77 GB here for a game that is installed and working, the oldest piece from
  July 2025. These are loose files, so they can go to the Recycle Bin — but
  only while Steam is closed, and never automatically. Steam fetches any of it
  again if it turns out to be needed.
- **Folders no game claims**, which an interrupted uninstall leaves behind.
  These are reported and nothing more: the app does not delete folders, and a
  game whose manifest went missing would look exactly the same. Check it in
  Steam, then remove it yourself.

**A leftover's size is what it occupies, not what it claims.** Steam creates a
file at its finished size and fills it in as the download arrives, so one file
here claims 7.6 GB and holds nothing at all. The figures on this screen are the
space that would actually come back; files holding nothing yet are counted and
said out loud rather than listed as if they were worth removing.

---

## Screen 9 — Chat apps

What Zalo and Telegram Desktop have downloaded onto this computer, and — for
Zalo — which conversation each piece of it came from. Pro.

**No message database is opened and no message is read.** That is not a
limitation that happened; it is the decision the screen is built around, and it
is why a conversation is shown by an id rather than by a name — the name is
inside the database. `ZaloData\Database` is 1.2 GB on the machine this was
built on and nothing here touches it.

Three answers, in the order they stop being possible:

- **By type** — every kind of thing each app has downloaded, with its size.
  Both apps.
- **By month** — when it arrived, and the largest pieces. Zalo puts the time a
  message was sent into the file name, so for Zalo this is when something
  arrived in the conversation rather than when the computer wrote the file.
- **By conversation** — Zalo only. Nothing in Telegram’s folders is named
  after a conversation: its caches are addressed by content, and the only place
  a chat is identified is the message store. The screen says so rather than
  showing an empty list.

### Zalo keeps every photo twice, and the smaller copy is the unreadable one

For each picture, Zalo stores the JPEG it received *and* a re-encoded JPEG XL
copy. On this machine **2,195 photos exist as both**, and the copies as
received come to 272 MB — about a quarter of everything Zalo has downloaded.

The obvious advice would be "delete the duplicate", and it points at the wrong
file. Neither the Windows shell nor Chromium can decode JPEG XL: the `.jxl`
copy opens in nothing on this computer, while the copy Zalo received — which
has no file extension at all — decodes fine. So the screen reports the pairing
as a fact and leaves the choice alone.

### What you can remove

Selection is per kind inside a conversation, not per file: nobody picks through
5,868 photographs, but "the videos in this group chat can go, the photographs
stay" is a real decision. Ticked kinds go to the Recycle Bin, or to another
drive.

Nothing here is ever marked safe, nothing is ticked in advance, and none of it
can run automatically. A photograph somebody sent is not a cache, and it may be
the only copy: whether the app could fetch it again depends on whether it is
still on the server, which cannot be checked from here. The confirmation says
so, and says which way to assume — and it says it wherever those files are
deleted from, including the Photos screen.

**While either app is open, nothing it owns is offered.** Nor is it when the
running programs cannot be listed at all. The screen names the app to close.

Zalo’s *browser* caches are not on this screen. They behave like any other
app’s cache — around 600 MB here, rebuilt when needed — so they sit on **What
to delete** with Chrome’s and Discord’s, and they are free.

### The one row that is not media

Telegram unpacks a downloaded update into its own folder and applies it at the
next start. On this machine that folder holds **212 MB**: Telegram 7.2.5.0,
waiting to replace the 7.1.3.0 that is running. It is by far the largest thing
Telegram keeps and it looks like an installer nobody needs. Deleting it costs a
212 MB download, so the row names both version numbers and says that outright.

---

## Screen 10 — Developer

What a developer's tools have quietly filled the disk with: the packages they
downloaded, the toolchains they installed, the caches the editors write, and the
virtual disks WSL and Docker keep everything else in.

99 GB on the machine this was built on, most of it in two virtual disks.

Only tools that were on that machine are shipped, which is the same rule the
known apps' caches follow. Found and shipped: npm, Gradle, NuGet, pip, Maven,
the Android SDK, the .NET SDKs, Visual Studio Code, Cursor, JetBrains and
Visual Studio. Looked for and absent, so not shipped: pnpm, yarn, uv, cargo,
Go modules and Composer. The screen says which ones it looked for and did not
find, so nobody has to wonder whether it bothered.

### The biggest thing on the screen, and the one it touches least

A Linux distribution keeps everything inside it in one file, and Docker keeps
every image and volume in another. 85 GB between them here: Docker's data disk
53.7 GB, Ubuntu 31.2 GB. None of it is sparse — those are real occupied bytes,
not a file claiming more than it uses.

The app does not touch any of it. Each row is the steps, in the order they have
to happen, shown to read and copy: shut everything down first, then let the disk
give space back as it is freed inside it, and — only if you mean it — remove the
distribution entirely. The steps that delete data say so before the command, not
after, because none of what they remove reaches the Recycle Bin.

Two things it gets right that are easy to get wrong. **Docker's data disk is not
the `docker-desktop` distribution's disk** — that one is 96 MB here, and making
it sparse would shrink nothing; Docker's own `docker system df` and
`docker system prune` are what clear the big one. And **the `docker-desktop`
distribution is never offered a removal**, because removing it uninstalls
Docker's engine rather than freeing space.

The distributions are read from the registry, so nothing is started to list
them. Where a distribution's disk was last written is shown, and called that —
not a last boot, which cannot be read without starting it.

### Two halves, and they behave differently

**A package cache is explained, not deleted.** One row for the whole cache with
its size, where it is, and the command its own tool uses to clear it — shown to
copy, never run. The app does not touch these, for two measured reasons: listing
npm's cache file by file took 13.8 seconds here and Gradle's 21.8, so a file
list would make the screen slow for something nobody wants file by file; and
`npm cache clean --force` knows which entries are still referenced, which a walk
of the folder does not. These rows are `review`, never `safe`.

**An editor's own cache is a file list, and it can go to the Recycle Bin.**
All four together took 2.4 seconds to list. They are `safe` while that editor is
closed, and `keep` the moment it is open — or when the list of running programs
cannot be read at all, because the app will not take a cache from under an
editor it cannot see.

**The folders are named exactly, never a whole product folder.** A JetBrains
product keeps `caches`, `index` and `log` — and, right beside them,
`LocalHistory`: every edit you have made, backed up nowhere else. Visual
Studio's folder is the same story, with `BackupFiles` and `SettingsBackup_*`
next to its two caches. Only the named folders are ever touched.

### Your own projects, on the folders you chose

A second scan on the same screen, with a button of its own. The half above
looks in fixed places — npm's cache is in the same folder on every machine.
This one looks wherever you pointed the Disk usage screen, which can be nowhere
at all until you have chosen something, and costs a different amount each time.
Scanning the whole of `D:` here takes 12 seconds against 23 for the tools half,
and a 4 GB `venv` alone accounts for 22 of them, so opening the tab to look at
Docker's 53 GB does not make you wait for either.

It does not look under `AppData`, in folders whose name starts with a dot, in
the insides of installed applications, or in the package caches the half above
already reports. Those rules are not tidiness: a walk of the Home folder
without them found 222 "projects" in 68 seconds, and the first eight with a
`node_modules` were the insides of Cursor and Discord. With them it finds 143
in 17 seconds and none of those eight.

**A project's dependencies are explained, never touched.** One row per project
with its size, whether it has a lockfile, how long since anybody touched it,
and the one command that brings it back — `npm ci`, `pip install -r
requirements.txt`, `cargo build`. It is `safe` only when there is a lockfile
*and* nothing outside the dependency folder has changed for sixty days. The
"last touched" reading deliberately skips the dependency folder itself, because
one `npm install` stamps 47,754 files with today's date and would make a
project nobody has opened since February look like this morning's work.

**A project with no git repository says so**, and only then — a folder under
git has a history to fall back on if the wrong thing goes, and one without has
nothing but the Recycle Bin.

**A build folder can go to the Recycle Bin — but only when your own
`.gitignore` says it is regenerated.** Not because a project file sits beside
it. That rule is wrong, and measurably so: of the 113 build folders on this
machine, 11 are declared that way and 102 are not, and the 102 include every
vendored copy of Bootstrap, echarts and Chart.js — folders called `dist` with a
`package.json` right next to them, committed to git, loaded by the page. They
also include 1.30 GB of released APKs, versions 1.0.3 through 1.2.1, in a
folder called `dist` that somebody meant to keep. Rebuilding gives you the
current version, not the ten that shipped.

A line in your `.gitignore` saying `dist/` is you stating in writing that the
folder is regenerated, and the row quotes it back to you. The folders nobody
declared are still listed, with their sizes, and marked as guesses that the app
will not act on — so you can see they were found and left alone.

The same test now decides what the disk scan calls build output, and what an
automatic cleanup is allowed near. Before it, a run with build output switched
on would have taken 400 files of vendored library off this machine.

**The declaration is taken at its word, all the way down.** A `dist/` line
covers everything under `dist/`, including anything the program *writes there
while running* rather than anything the build put there. On the machine this
was written on that is 91 screenshots, 21.8 MB, under
`dist\ToWTool\logs\` — a tool packaged into `dist/` that then saved pictures
of its own runs beside its logs. Rebuilding the project would not bring those
back. They are treated as build output because the project's `.gitignore` says
`dist/`, and that file is the only statement of intent the app has: the same
`.gitignore` also knows how to make exceptions — it carries `!img/*.png` — and
does not make one here. If you keep something under a folder you have declared
regenerated, say so in the `.gitignore` the way you already can.

### What it will not do

**Run any of these commands.** It shows what each tool uses so you can read it
first and copy it if you want it. Nothing on this screen can be part of an
automatic cleanup. An SDK is never removed by the app either: the Android SDK
Manager and Windows' own installed-apps list know which pieces something still
needs, and taking folders out by hand leaves them believing otherwise. Nor is a
`node_modules` or a `venv`: nineteen of them here hold 232,229 files between
them, and the tool that filled one knows what its lockfile pins in a way a walk
of the folder never will.

**Decide whether a program is running inside a project folder.** Windows
reports where a process was started from, not which folder it is working in, so
the question cannot be asked. Every dependency row says so rather than leaving
you to assume it was checked.

---

## Screen 11 — Trends

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
- **Save a report…**, described below.

### A report you can send to somebody

One HTML file, for when the person who has to look at the disk is not the
person sitting at it — a relative, or whoever fixes the computer. It opens in
any browser on any machine and **fetches nothing when it does**: the styles are
inline, the chart is inline SVG, and the numbers are embedded at the end as
JSON, so the file is the data rather than a picture of it.

You choose what goes in: the drives, the [System breakdown](#screen-2--system),
the folders that have been scanned, the chart and its measurements,
[what changed](#what-changed-in-a-folder), and what CleanDrive itself has done.
A section with nothing behind it is shown greyed out with the reason — "nothing
measured yet, open the System screen" — rather than quietly disappearing.

**Nothing is measured to fill it in.** Saving a report never starts a scan and
never raises an administrator prompt; it writes down what has already been
measured. The System breakdown is the one section that is only available in a
session where you have measured it, because that result is never written to
disk.

**Private mode** replaces folder and file names with generic ones — `Folder 1`,
`File 7.jpg` — and is on by default whenever the report would name individual
files. The same folder keeps the same name throughout and folders inside it
still read as inside it, so the report still says something. The drive letter
stays, because `C:\` names nobody; a file's extension stays, because that is
the part worth reporting. The computer's name goes too. **The embedded JSON is
replaced as well** — otherwise anyone who opened it would have the real names
back and private mode would be a label rather than a fact.

This is Pro (`pro.reports`). The JSON and CSV exports are unchanged and stay
free.

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

### A note once a week or once a month

**Tell me what changed** puts a Windows notification on screen saying what the
drive did over the period and which folders grew: *"C: grew by 5.7 GB. It is
61.3% full, with 194 GB left. Biggest: D:\Downloads is up 2.4 GB."* Off until
you ask for it.

It is shown only when the data supports it — the same rule the chart holds
itself to, at least four measurements over a week — and **otherwise nothing is
shown at all**. There is deliberately no notification whose only content is
that it would like your attention.

Clicking it opens [What changed in a folder](#what-changed-in-a-folder) and
does nothing else. It never starts a cleanup.

It rides on the daily measurement above rather than registering a Windows task
of its own, and it needs it: a summary of growth with nothing measured is not a
summary. With the daily measurement off, the setting says so rather than
sitting there doing nothing. The cost on every other day is one comparison —
measured at 612–753 ms for the whole daily process, the same as before it
existed, because the decision is made before the part that would start a
browser.

This is Pro (`pro.reports`).

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

## Screen 12 — Restore

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
| *in quarantine* | [Moved to another drive](#moving-to-another-drive-instead): its copy is in the quarantine folder, the size the journal recorded |
| *not in the folder* | That copy is no longer in the quarantine folder — removed outside the app |
| *drive not connected* | The drive it was on — or, for a quarantine, the drive its copy is on — is not there, so nothing can be said about it |
| *one file with others* | [Joined into one file](#joining-copies-into-one-file): this name and at least one other still lead to the same file |

That column is read from the disk every time the tab opens, not taken from the
journal. The journal says what the app did; only the disk says what is true now,
and the two part company the moment somebody uses Explorer's own *Restore* or
empties the bin.

**Put back all**, or tick files and **Put back selected**. It goes through the
same pipeline as a delete — a native confirmation with the count and the size,
the progress panel with Stop, a receipt — and is recorded as a session of its
own.

A file moved to another drive comes back by copy: it is copied home, checked
against the hash taken when it was quarantined, and only then taken out of the
quarantine folder. A copy that no longer matches is not put back. Its original,
if still in the Recycle Bin, is left there.

A name that was joined into one file is the odd one here, because it never went
anywhere: it is at its own path and always has been. What is put back is its
*separateness* — the contents are copied beside it, checked, and moved over the
top, which takes the name off the shared file and needs room for a full copy.
That also means it restores separateness and not history: the copy's own bytes
were freed the moment it was joined, so if anything wrote to the shared file in
the meantime, every name ends up with an independent copy of the newer
contents.

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

### Whether the journal is still as it was

On **CleanDrive Business**, every session ends with a **seal**: one more line in
the journal, signed with a key kept on this computer. Above the cards the screen
says whether every sealed session is still exactly as it was sealed —
*"Sealed: 12 sessions, none changed since"* — and each card carries one of three
words: *Sealed*, *Changed after sealing*, or *Not sealed*. A changed card says
where: *"Line 14 of the journal file 2026-10.jsonl was changed after it was
sealed."*

| Done to the journal | What the screen says |
| --- | --- |
| A number or a path in one line edited | That line was changed after it was sealed |
| A line taken out | A line was removed just before the line that followed it |
| A line put in | That line was added after the session was sealed |
| A whole session taken out from between two others | Sealed sessions no longer in the journal: 1 |
| Every hash recomputed after an edit (anyone can) | The seal no longer matches what it covers — recomputing the chain is easy, signing it again is not |
| The file opened and saved by an editor that changes line endings | Every session in that file changed — because every line was |
| The key file deleted or replaced | Each older seal *"was made with a key this computer does not have"* |

**What it cannot find — read this before relying on it:**

- **The computer's own user can rewrite the journal and sign it again.** The
  cleanup that runs at 02:00 runs as that user, without administrator rights,
  and seals as it goes; any key it can open with nobody there, that user can
  open too. A seal shows that a session was changed by something that did not
  go to that trouble — a hand edit, another program, a damaged disk. It is not
  proof against the person whose computer it is.
- **The newest sessions, taken out whole, leave no trace**: nothing comes after
  them to notice. Nor does deleting the whole journal.
- Both need a copy kept where the user cannot rewrite it. With the
  organisation's daily report on, [the console](#the-organisations-console)
  keeps one: it notices both, for any change made after it has read a report
  from that computer.

The key is `seal-key.json`, beside the settings. Its private half is protected
by Windows (DPAPI) for this user's account; the screen shows the first sixteen
characters of its fingerprint, so it can be compared with a note kept
elsewhere. If Windows can no longer open it — [Unverified] for instance after an
administrator resets a local account's password — a new key is made, the old
public half is kept, and every earlier seal still checks. If PowerShell cannot
run on the machine, the key cannot be opened at all: sessions are still written
whole, they read as *Not sealed*, and the screen says why.

On any other licence sessions are not sealed, and the screen says so in one
line. When a Business licence lapses, new sessions stop being sealed and every
earlier seal is still checked: the check is reading, and reading the journal is
never behind a licence. Nothing about putting files back changes either way.

---

## Screen 13 — Automatic

Cleanup on a timetable, with no window open. Off by default, and designed so that
every ambiguity resolves towards doing nothing — there is no dialog in front of
this to catch a mistake.

### Profiles

There can be more than one, each a complete policy with its own timetable and
its own Windows task: a weekly sweep of caches, a monthly one for build output,
and so on. The row of names at the top picks which one the form below is
editing; **Add a profile** makes another and **Remove this one** takes it away
along with its Windows task.

One profile is free. The rest are Pro (`pro.automatic.profiles`), and asking
for another without it is refused in words rather than by a button that does
nothing. There is a ceiling of eight, because each is a process that wakes up
and reads the disk.

Profiles made while the licence included them are kept when it no longer does,
and they do not stop. The first of your profiles still runs as it is set; every
other one — and any profile that moves files to another drive, which is Pro
(`pro.quarantine`) on its own — **runs in report only** and its entry in the
run log says why, whether it was the 02:00 run, the *Run now* button or
`cleandrive run`. Nothing it would have moved is moved.

**Every new profile starts switched off and in report-only**, whatever the one
beside it is doing.

Two profiles can come due in the same minute, and Windows will start both. They
take a lock so that only one runs at a time; the second waits up to ninety
seconds and then skips, saying so in the run log. Its work comes round again on
its own timetable. The lock is not only about disk contention — the run log is
rewritten whole on each entry, so two runs at once would lose one of them.

### Writing the policy

| Control | Meaning |
| --- | --- |
| **Name** | What this profile is called, in the row above |
| **Run cleanup automatically** | The master switch, for this profile |
| **Report only** | Lists what would be taken and deletes nothing |
| **What it does** | Move to the Recycle Bin, or [move to another drive](#moving-to-another-drive-instead) |
| **Delete the original after copying** | Only for "another drive", and the only setting here that frees space on the drive being cleaned. Separate from the same-named option on the What to delete screen, which stays off |
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
| Known apps | A [known app's cache](#known-apps-caches) is taken only while that app is closed, checked after the scan and again just before anything moves; if what is running cannot be read, no app's cache is taken. On by default, one tick per app |
| Disk pressure | Optionally, only when the volume is over *N*% full |
| Cap | At most *N* files per run |
| Somewhere to put them | A profile that moves files to another drive skips the run when no folder has been chosen, or when the drive it is on is not connected. A drive in a drawer at 02:00 is a reason to try again next time, not a fault |
| One at a time | Another profile already running means this one waits, then skips |

A profile that moves files to another drive **and keeps the originals** frees
nothing on the drive it cleaned — it uses more space overall. That is allowed,
and the screen and the run both say so in those words rather than reporting a
figure that is not space anybody got back.

Note that `installer` is not among the categories an unattended run may touch,
so a "clear out old installers every month" profile cannot be built: an
installer is something you might want to keep, and that list is a hard rule
rather than a default.

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
**what Windows itself holds** for the profile you are looking at, not what the
settings file says:

- the registered task name, and whether it matches your settings
- Windows' own last-run and next-run times
- the last run's exit code **in words** — `0x80070002` reads as *"the program it
  launches could not be found — the app has moved"*
- **Run now**, so "does it work when I am not looking" can be answered without
  waiting for 02:00

A task Windows cannot run is never registered in the first place. The app checks
that the program it is about to hand to Task Scheduler is one that can actually
start, and refuses with a reason if it is not — because Task Scheduler accepts
such a task without complaint, and the failure then surfaces days later as an
error dialog at logon, with nothing on it to connect it back to this screen.

Below that: the last result in figures — files scanned, selected, moved to the
bin, permanently removed, disk before and after — and a list of recent runs.

### Why a Windows task and not a background process

A resident process is one the user eventually kills, after which the cleanup
silently stops. Windows already owns a scheduler that survives reboots, so the
app registers a task there and exits. **Nothing of this app stays running** for
the cleanup.

Each profile gets a task of its own, named after it, so Windows runs them on
their own timetables and the process it starts knows which policy it is there
for. Removing a profile removes its task with it; a task left behind by one
that is already gone — by a crash, or a settings file edited by hand — is found
and removed when the app starts, when a profile is removed, and when you press
**Check with Windows**. Nothing else is touched: a task whose name the app
cannot attribute with certainty is left exactly where it is.

---

## Screen 14 — Settings

Small on purpose. **Nothing in Settings changes what the app deletes**, with one
exception, off until you switch it on: *Delete the original*, on the card for
[moving files to another drive](#moving-to-another-drive-instead).

One card does something different again: **Developer** does not change what any
action does, it decides whether an action is offered at all. Its single switch
is off out of the box and stays off when the app updates.

| Card | What it holds |
| --- | --- |
| **Plans and licence** | Which plan this computer is on and until when, the key, the plans, and the invoices ([below](#plans-and-licence)) |
| **Appearance** | Light, dark, follow the system, or your own colours |
| **Your own colours** | Eleven colours, checked as you pick them; import and export a theme file |
| **Keyboard** | Where the list of keys is (**?** opens it too) |
| **Right-click menu in Explorer** | Whether CleanDrive is in Explorer's menu, and what the registry actually has |
| **Language** | English or Vietnamese, or follow Windows |
| **Company while scanning** | Which animal walks the progress bar, or none |
| **Scan history** | How many folder snapshots to keep: the newest few, plus one a month |
| **Move to another drive** | Where moved files go, how many days before the app mentions they are still there, the most that folder may hold, and *Delete the original* |
| **Map tiles** | What the [map](#where-they-were-taken) has downloaded and kept, and a button that removes it |
| **Developer** | One switch, off: whether the Duplicates screen may [join copies into one file](#joining-copies-into-one-file) |
| **Version and updates** | Which version you are running, the update controls, and the introduction again |

The version lives here because "which version am I running" is the first thing
anyone reporting a problem is asked, and it used to sit inside a screen about
deleting files on a timetable.

### Plans and licence

The first card in Settings. It says which plan this computer is on — **Free**,
**Pro** (yearly or lifetime, with or without the **Developer Pack**), a 14-day
**Pro trial**, or **Business** — when it ends, how many computers it covers,
the email it was bought with, the order, and the invoices. Its buttons open the
plans, start the trial (once per copy), take a licence key, copy or save the
key, and deactivate this computer.

**The plans.** Three columns, Free, Pro and Business, each listing what it
includes; the lists are drawn from the same table the app checks before it lets
a feature run, so the two cannot disagree. Yearly or lifetime is a switch above
them. Lifetime covers every later version; a yearly licence that runs out keeps
Pro on the versions released while it was paid for. Business is yearly and
includes the Developer Pack. Every *This is part of CleanDrive Pro* line in the
app carries a **See the plans** button that opens the same dialog.

**Paying.** The total is worked out in one place and the Pay button only works
once there is an email address, a payment method and agreement to the terms —
and it says which is missing. There is no field for a card number, and there
never will be: *International card* is a choice of method, and the payment
provider draws its own page. When a payment succeeds the licence is active at
once, no restart; the key is shown with buttons to copy it and save it to a file.
A declined card, an unreachable server, a cancelled payment, a bank transfer
still waiting and a payment with no answer yet each have their own words and
their own way on, and none of them is ever said to have charged anything.

> **Payment is not open yet.** Until it is, pressing Pay activates the plan
> without taking any money, on every copy. A licence issued that way says so on
> this card, and it ends when selling begins. The prices are sample prices, in
> VND.

**What stays free, whatever the licence.** Restore, every confirmation, every
warning and the journal. A licence that runs out never deletes or hides anything
the app made: what is in quarantine, the snapshots, the reports and the journal
are all still there.

**Pro was open to everyone up to 0.5.0**, while there was nothing to buy. From
0.6.0 Pro and the Developer Pack are part of a licence again. Someone upgrading
from an earlier version is told so on the card and, once, in a strip at the top
of the window. Automatic profiles they made stay; every profile after the first,
and any profile that moves files to another drive, runs in report only until a
licence includes it (see [Profiles](#profiles)).

**The strip at the top** says one of two things — a trial in its last three
days, or Pro closed again — and never appears over a scan, a delete, or a
dialog. *Not now* puts it away; the trial one comes back at most once a day.

### Updates

**Checking, downloading and installing are three separate clicks.** Replacing the
application binary follows the same rule as deleting a file: nothing happens on
its own. Update checks can be switched off entirely, and the scheduled cleanup
never checks — a 2am maintenance task that replaced the program is not something
anybody asked for. An organisation can switch them off for you
([Managed by an organisation](#managed-by-an-organisation)); then the switch
and *Check now* carry a padlock, and nothing contacts the release page, not
even when the button is pressed.

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

### Moving to another drive instead

The Recycle Bin is on the same drive, so it frees nothing; deleting for good
keeps nothing. **Move to D:** is the third choice: the file leaves the full
drive and stays on the computer. Choose a folder on another drive once, in
Settings; the app makes `CleanDrive Quarantine` inside it, with a `README.txt`
saying what it is. The button then names that drive, on Disk usage, Duplicates
and Photos & video, and on What to delete for everything but the groups marked
safe — a temp file or a cache is not worth the copy.

For each file, and nothing is done to the original until its copy is proved:

1. it is copied, and hashed (SHA-256) as it is read;
2. the original is checked to be unchanged by the copy;
3. the copy is flushed to the drive, read back, and its hash compared — and
   only then given its name. Until then it is `….partial`: a drive pulled out
   mid-copy was measured to keep the half-written file, and under that name it
   is never mistaken for a copy; the next move takes it out;
4. the session's `manifest.jsonl`, on that drive, records which original the
   copy is — so the drive explains itself without this computer;
5. the path is checked once more to be the very file that was copied (a folder
   on the way swapped for a junction is caught here);
6. the original goes to the Recycle Bin — or, if *Delete the original* is on
   in Settings, is deleted, which is the only way this frees its space;
7. the journal records it.

A step that fails leaves the original as it was and takes the copy back out.
The drive filling up, or being pulled out, stops the batch there. Nothing is
started without room for all of it plus a gigabyte. Files already on that
drive, files in the folder itself, links and folders are refused; a network
drive, or a folder a cloud service syncs, cannot hold the quarantine.

**OneDrive files are judged by what Windows says about each one.** Only in the
cloud: refused — there is nothing on this drive to free, and reading it would
download it. Not in sync: allowed, and the dialog says the copy on the other
drive is the only complete one, since OneDrive has not uploaded it or its
latest changes. In sync: allowed, and the dialog says removing it removes it
from OneDrive on every device, and that *Keep only in the cloud* frees the space
without deleting anything. Other services get the general warning.

Files stay there until they are put back from Restore or deleted by hand. The
app never deletes them; after the days set in Settings (30 to begin with) it
mentions, once a day at most, that they are still there. The receipt, the
badge beside the button and Trends all say *not freed* while the originals are
in the bin, and count as freed exactly what was deleted.

### One pipeline for every action

Every screen's delete, the manual cleanup and the 02:00 run go through the same
sequence — vet, probe, confirm, record, act — in `src/main/actions/`. Moving to
the Recycle Bin, moving to another drive, putting back from either, and making
OneDrive files online-only are the actions today; each one the roadmap adds is another handler in the same
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

## The command line

The same program, started from a terminal, for whoever looks after the machine
and for the scripts they write. It reads, suggests, compares, measures, runs a
profile and puts things back — the things the window does — and nothing the
window would not.

```
cleandrive scan <folder...> [--mft] [--snapshot] [--json]
cleandrive suggest <folder...> [--category <c>] [--verdict safe|review] [--json]
cleandrive snapshots [<folder>] [--json]
cleandrive diff <snapshot> <snapshot> [--json]
cleandrive system [--json]
cleandrive profiles [--json]
cleandrive run --profile <id> [--report-only] [--json]
cleandrive report [--json]
cleandrive journal list | show <session> | verify [--json]
cleandrive restore <session> [--dry-run] [--json]
cleandrive policy validate [<file.reg>] | apply [--json]
cleandrive version | help [<command>]
```

It is part of CleanDrive Business. Without it, every command except `journal`, `restore`, `policy`,
`version` and `help` answers with exit code 3 and a sentence saying so — never
a smaller run instead. Those five are never asked about the licence at all:
reading what the app did, putting it back, and checking what an organisation's
policy says are there whatever the licence says.

### Starting it

It is installed as **`bin\cleandrive.cmd`** inside the folder CleanDrive was
installed to:

```
"C:\Program Files\CleanDrive\bin\cleandrive.cmd" scan D:\Projects
```

The installer does not add that folder to `PATH`; add it yourself, or through
whatever manages the machine, to type `cleandrive` alone.

Use the batch file, not `CleanDrive.exe --cli` directly. CleanDrive.exe is a
Windows program rather than a console one, and PowerShell and cmd do not wait
for one to finish: typed bare, its output arrives after the next prompt and its
exit code is lost, and `$x = & CleanDrive.exe --cli …` captures nothing at all.
A batch file is waited for, so through `cleandrive.cmd` both come back as they
should. That file holds no logic of its own; what it starts is the executable.

### What it will and will not do

- **Two commands change anything: `run --profile` and `restore`.** There is no
  command that deletes a path you give it.
- **`run` goes through every gate the 02:00 run passes**, because it is the same
  code: the profile's categories, whitelist, age, disk threshold, open
  programs, and the delete guards. A profile that is switched off is refused,
  not run anyway. A profile in report-only mode stays in it; `--report-only` can
  make a live profile report, and nothing can make a report-only one act. It
  takes the same lock as the scheduled run and waits up to 90 seconds for one
  already running. The run is in the run log like any other, and the Automatic
  tab marks it *from the command line*.
- **`restore` never overwrites.** A file now sitting where one used to be is
  skipped, named, and the exit code is 2; the Restore Center is where you choose
  to keep both or replace it. `--dry-run` says what would come back and touches
  nothing. Sessions and their files show in the Restore Center as *from the
  command line*.
- **Everything else only reads.** `scan` writes nothing at all unless you ask
  for `--snapshot` — not even a point on the Trends chart, which a script
  scanning every hour would otherwise draw.
- **It never raises a UAC prompt.** `system` and `scan --mft` need an elevated
  terminal and say so (exit code 4) in an ordinary one; a script nobody is
  watching would otherwise wait for a click that never comes. `scan --mft` is
  stricter than the window's *Fast scan* switch: a folder that is not a whole
  NTFS drive is refused rather than walked instead.
- **It runs beside the window and beside the scheduled run.** It takes no
  single-instance lock.
- **`policy validate` and `policy apply` are for whoever manages the machine**
  ([Managed by an organisation](#managed-by-an-organisation)). `validate`
  says, value by value, what the app makes of the policy in the registry — or
  of a `.reg` file before it is rolled out — and changes nothing. `apply`
  registers or removes this account's scheduled cleanups to match the policy
  now, instead of the next time somebody opens the window — and, when the
  policy asks for a daily report, the daily disk measurement too, and writes
  one report at once.
- **`report` prints what this computer sends to the organisation's console**
  ([The organisation's console](#the-organisations-console)) and writes
  nothing. It answers whether or not a policy asks for one, so the question
  "what would it send about me?" can be answered before anybody switches it on.

`profiles` lists the ids `run --profile` takes — a profile's name is optional,
so the id is the one thing every profile has. `snapshots` lists the ids `diff`
takes. `scan --snapshot` prints the id of the one it keeps, and a live `run`
prints the session to undo it with.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Failed; the message says why |
| 2 | Refused by a gate: a profile switched off, a disk below its threshold, another run holding the lock, a file in the way, nothing to put back, a policy value refused or not understood |
| 3 | Not in this licence; nothing was done. For `policy validate`: a policy is set that only CleanDrive Business applies |
| 4 | Needs an elevated terminal; nothing was done |
| 5 | Started and stopped short: the record of what moved could not be written |
| 6 | `journal verify` found a sealed session changed, removed or duplicated |
| 64 | The command line names nothing this program can act on |

**Ctrl+C is not 5.** It ends the program at once and Windows reports
`0xC000013A`; measured, no handler inside the program gets to run. Every file
already moved is in the journal by then, so Restore still finds it. Through the
batch file, cmd then asks *Terminate batch job (Y/N)?* — either answer is fine.

### `--json`

One JSON document on standard output, with `"schema": "cleandrive.<command>/1"`
saying what it is; a refusal is `cleandrive.error/1`. Every character past
plain ASCII is written as a `\u` escape, so a folder called `Ảnh của tôi` comes
through any console code page intact. Messages — progress, warnings, refusals —
always go to standard error. In Windows PowerShell 5.1:

```
$scan = (& cleandrive scan D:\Projects --json) -join "`n" | ConvertFrom-Json
$scan.cleanup.safeBytes
```

`journal verify --json` is the Restore Center's own check, report and all
(`cleandrive.journal-verify/1`). `policy validate --json` and `policy apply
--json` are `cleandrive.policy-validate/1` and `cleandrive.policy-apply/1`.
`report --json` is the machine report itself, byte for byte what goes on the
share (`cleandrive.machine-report/1`).

### Language

The command line speaks English, whatever the window is set to. On the machine
it was built on, a Windows console runs code page 437 and shows Vietnamese as
garbage, and a program cannot change that from inside — it was tried, two ways.
Paths are printed as they are, so they read correctly in a console set to UTF-8
(`chcp 65001`, measured) and in any file the output is sent to.

---

## Managed by an organisation

Whoever looks after a group of computers can set CleanDrive's rules for all of
them with Group Policy or Intune. The definitions are in the install folder,
under `policy\` — `CleanDrive.admx`, and its words in `en-US\CleanDrive.adml`
and `vi-VN\CleanDrive.adml` — and in the `policy/` folder of the source.
Copy them into the Group Policy central store, or import them into Intune, and
the policies appear under *Computer Configuration → Administrative Templates →
CleanDrive*. They write `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\CleanDrive`,
which an account without administrator rights cannot change. A machine with no
Group Policy can be given the same values with `reg import`.

| Policy | What it does | Without Business |
| --- | --- | --- |
| **View only: change no files** | Nothing is moved, deleted, compressed, packed, joined or made online-only — not from the window, not on a schedule, not from the command line — and nothing is emptied from the Recycle Bin. Putting things back still works, except that a file in the way is never replaced. Opening a Windows tool, making a smaller copy of a video and saving a report still work: they change no file that is there. | Applies |
| **Automatic cleanup** — *Disabled* | Every profile is off. The person's own profiles are kept as they were and come back when the policy is removed. | Applies |
| **Automatic cleanup** — *Enabled* | Runs one profile of the organisation's own: its folders (`%USERPROFILE%` and the like are expanded for each person; network folders are refused), schedule, age and threshold. It goes through every rule a person's profile does, and **starts in report only** unless the policy says otherwise in so many words. Every run that moves anything shows a notification saying it was the organisation's. | Not applied, and said so |
| **Categories automatic cleanup may use** | A ceiling: a person can untick more, not tick one outside it. Only categories automatic cleanup could already use are offered. | Applies |
| **Folders automatic cleanup never touches** | Added to every profile's list; a person can add more, not remove these. | Applies |
| **Do not check for updates** | No request to the release page, not even from *Check now*. | Applies |
| **Where files moved to another drive go** | The `CleanDrive Quarantine` folder is made inside the folder named, which must already exist on a local drive; a person cannot choose another. | Not applied, and said so |
| **Daily report for the CleanDrive console** | Once a day each computer writes one small file about its drives and cleanup tasks to the folder named — normally a share on the organisation's network — for [the console](#the-organisations-console). It names no file and no folder; ticking *Include the largest folders* adds the names of the largest folders from the last scan. The daily disk measurement, which writes it, is kept on while this is set. | Not applied, and said so |

The ones that only take something away apply to every copy of CleanDrive: an
organisation's *view only* that a missing licence could quietly switch off
would be a safety rail that is not there. The three that make the app act on the
organisation's behalf are CleanDrive Business — so on a copy without it, `cleandrive policy validate`
and the line at the top of the window both say which policies were set but not
applied.

**What the person at the computer sees.** A line at the top of every screen
saying that the organisation manages part of CleanDrive and what, and on every
control the policy holds a padlock and *Managed by your organisation* (*Do tổ
chức của bạn quản lý*). A profile that would act on a view-only computer says
*Held: view only* rather than *On*. The organisation's profile is listed beside
the person's own, padlocked, and cannot be changed or removed from here.

**The settings file is never changed by a policy.** What the window shows is
the file with the policy laid over it; what it saves is put back to the file's
own values wherever the policy holds a field. When the organisation lifts a
policy, the person's choices are exactly where they left them.

**When the policy changes.** It is read again before every action, before every
unattended run, and whenever the window comes back to the front. A policy that
was there and is suddenly not is read a second time a moment later before it is
believed, because a key being rewritten reads as empty for an instant. The
organisation's scheduled task is registered the next time CleanDrive opens, or
at once by `cleandrive policy apply` — run as the person who signs in (a logon
script, or an Intune script in the user's context), because scheduled cleanups
belong to an account. Run as SYSTEM, from a startup script, it refuses and says
why. The daily disk measurement is the person's own setting, and `apply`
leaves it alone — unless the policy asks for a daily report, which rides on
that measurement: then `apply` registers it too, and writes the first report
at once.

**A policy that cannot be read is no policy, said out loud.** If neither
`reg.exe` nor PowerShell can read the key, the app runs as if none were set,
and the line at the top says the organisation's policy could not be read. View
only is a guard rail for an organisation, not a lock against the person: they
can delete their own files in Explorer whatever it says.

What has not been checked: the files have not been loaded into the Group Policy
editor or into Intune — the machine this was built on runs Windows 11 Home,
which has neither. [Unverified] Their structure follows the ADMX files
Microsoft ships in `C:\Windows\PolicyDefinitions`, they parse as XML, and
every value they write is one the app is tested to read.

---

## The organisation's console

One window over every computer an organisation manages, with no server and no
cloud: each computer writes a small file to a shared folder on the
organisation's own network, and the console reads the folder. Both halves are
CleanDrive Business.

### What each computer writes

With the *Daily report for the CleanDrive console* policy set, each computer
writes `<computer name>.cleandrive.json` to the folder the policy names, once a
day, as part of the daily disk measurement — the same task that draws the
Trends chart, so there is no third scheduled task. `cleandrive policy apply`
writes one at once, so a logon script puts the computer in the console the same
morning.

The file holds:

- each drive, by letter: how full, how fast it is growing, and when it would
  fill — the Trends tab's own numbers, not a second calculation — or, when the
  history does not support a forecast, the reason Trends gives, which the
  console shows in its own language;
- each cleanup profile by its **id**, never its name or folders: whether it is
  on, whether Windows holds a task that matches it, when Windows last ran it
  and with what exit code, and what the app recorded of that run (counts and
  outcome; a reason that would name a folder or a program has that part
  blanked);
- whether the daily measurement's own task is registered;
- which policies took effect there, and which were set but not applied;
- the number, hash and key of the newest seal on the journal (Business);
- from the last scan someone ran by hand: when, whether it covered a whole
  drive or one folder (never which folder), and how much each cleanup category
  held. With *Include the largest folders* ticked, also the names and sizes of
  that scan's largest folders — off by default, because a folder under
  `C:\Users` is a person's name.

It names no file and no folder. It is ASCII JSON with
`"schema": "cleandrive.machine-report/1"`, and `cleandrive report --json` prints
exactly what would be written.

**Permissions.** The file is written with the rights of the person signed in,
so the share needs to let them create and change files. Anyone who can write
there can also write a file claiming to be another computer; the console
treats every file as untrusted and draws it as text only, but it cannot know
who wrote it.

**When the share is not there.** The report is the last thing the daily
measurement does, after the measurement and any summary. A share that has gone
leaves the exit code alone and is logged; measured on the machine this was
built on, a server address that does not answer holds the hidden process for
about 42–44 seconds before Windows gives up — inside the task's five-minute
limit. A folder that does not exist is never created.

### Opening the console

```
"C:\Program Files\CleanDrive\CleanDrive.exe" --console \\server\cleandrive
```

`--console` must come first. Without a folder it opens on the one this
computer's own policy names, or asks for one. It opens its own window and
takes no single-instance lock, so it runs beside CleanDrive's own window.

It lists every computer that reported, with its fullest-soonest drive, growth,
when it fills, the last automatic run and its exit code, when it last reported,
and what needs a look:

| Needs a look | Why |
| --- | --- |
| No report for more than 2 days | The report rides on the daily measurement, so a computer whose task broke cannot say so — it falls silent |
| A cleanup task switched on but not registered, or not matching its profile; a last run Windows recorded as failed | Task Scheduler's own answer, in words: *the program it launches could not be found — the app has moved* |
| A drive that fills within 30 days on its own trend, or is over 95% full | The console's thresholds, said at the foot of the window |
| The computer's own journal check finds a changed or missing session | |
| **The newest seal went back, or a seal number already seen came back different** | See below |
| A report older than one already seen, or a file not named after its computer | An old file put back, or a mistake |

Find a computer by name, filter (*Needs a look*, *Silent*, *Task problems*,
*Filling up*, *Journal*), sort by any column, open a computer for every drive,
task, category and policy it reported, and **Export CSV** — one line per
computer and drive, with a byte-order mark so Excel reads it, and every cell
that would start a formula defused.

**What the console keeps.** It is read-only, with one exception: in its own
data folder (`console-seen.json`), the seal numbers and hashes it has seen for
each computer. That is the copy off the machine the journal's seal needs
([what the seal cannot find](#whether-the-journal-is-still-as-it-was)): when a
computer's newest sessions are taken out whole, its newest seal number goes
back; when its journal is rewritten and signed again, a number the console has
already seen comes back with a different hash. Neither shows on the computer
itself, and both show here — **provided the console read a report before the
change**. It cannot notice a person who forges every report from then on: they
can write their own computer's file. *Start this computer's seals again* makes
the next report the new reference, after a reinstall for instance.

**Limits.** [Unverified] Speed over a real network: the share was tested
through this machine's own administrative share (`\\localhost\D$`, the real
SMB client and server — 10–20 ms a report) because there is no second machine
here. Two people using CleanDrive on one computer write the same file, the last
one winning. A run recorded by CleanDrive 0.4 or earlier, just before an
upgrade, can show exit code 0 for a run that failed: those versions never
handed their exit code to Windows.

---

## Rules the interface will not break

| Rule | Where you see it |
| --- | --- |
| Nothing is permanently deleted by a click | Every removal goes to the Recycle Bin. Two exceptions, both off by default: the purge, which runs unattended and must clear four independent checks; and *Delete the original* when moving files to another drive, which deletes an original only once its copy there has been read back and matched, and says so in the confirmation |
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
- **No command-line delete.** [The command line](#the-command-line) moves files
  only through a profile's own rules, and puts back only what the journal says
  the app moved.
- **No background service and no resident timer** for the scheduled cleanup. It
  is a Windows task that starts the app, works with no window, and exits.
- **No telemetry, no crash reporting, no identifiers.** The app makes two kinds
  of network request and no others. One asks the release feed whether there is a
  newer version. The other fetches pieces of map, and only after you switch on
  [the map of where pictures were taken](#where-they-were-taken), which ships
  off — that one is *about* your pictures, in that the pieces fetched are for
  the area they are in, and the card says so before you turn it on. Switch both
  off and the app makes no network requests at all. An organisation can switch
  the first off for every computer it manages. The interface itself is
  forbidden from reaching the network either way: both requests are made by the
  main process. (An organisation's [daily report](#the-organisations-console)
  is a file written to a folder the organisation names, usually a share on its
  own network — not a request to anybody, and nothing it holds names a file.)
  Buying a plan makes no request either, until payment opens: the payment
  provider in this version answers from inside the app.
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
  file *names*, so none of it ever leaves the machine. And, only if you move
  files to another drive, the `CleanDrive Quarantine` folder on the drive you
  chose: the files themselves, and a manifest of where each came from. And a
  theme file, only when you export your own colours, only where you save it. And,
  only while the right-click menu is switched on, its four entries in your
  account's registry (see [the right-click menu](#the-right-click-menu-and-what-it-writes)).
  And, only when an organisation names one, the `CleanDrive Quarantine` folder
  inside the folder it named. And, only when an organisation's policy asks for
  it, one small file a day in the folder it named — [the machine
  report](#what-each-computer-writes), which names no file or folder. The
  console, when someone opens it, keeps the seal numbers it has seen in its own
  data folder, and writes a CSV only where it is told to. The app reads an
  organisation's policy and never writes it. And `license.dat`, once you have a
  licence or a trial: the signed key in the clear — it holds no email address,
  only a salted hash of one — the address it was bought with, encrypted for
  your Windows account with DPAPI and opened only when the licence screen shows
  it, and, once this copy has had a trial, that trial's key, which is how it
  knows not to offer another.
  And `orders.json`, once something has been bought: the plan, the price, the
  method and a hash of this computer's id for each order — no email address and
  no licence key — which is what the invoices on the licence card are read
  from. And the licence key, only where you save it.
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
Month files older than thirteen months are dropped at launch — except a month
that moved files to another drive: those copies stay as long as somebody leaves
them, and the journal is how Restore knows where each came from.

It is also what the [Restore](#screen-12--restore) screen reads, and a restore is
recorded in it like any other action — which is how the purge knows a file that
was put back is no longer the app's to remove.

On Business, each line also names the line before it in the same session by its
hash, and each session ends with a signed seal ([what that does and does not
prove](#whether-the-journal-is-still-as-it-was)). The chain runs per session
rather than through the file because the window and the 02:00 run append to the
same file at once, and a chain through it would call every power cut an edit.
Dropping old months still happens, but with sealing on the journal first writes
a sealed note naming the months it removes, so that retention is never mistaken
for somebody deleting them.

---

## Limits worth knowing before you plan around it

- **Windows only, in practice.** It is written for Windows and exercised there.
  Scheduling and the selective Recycle Bin purge are Windows-only by
  construction. [Unverified] The app has not been run on macOS or Linux.
- **The installer is unsigned**, so Windows SmartScreen warns on first run.
- **At most twelve folders at once**, scanned one after another, not in
  parallel. A network folder is read only, and a removable drive is too until
  the Recycle Bin has been measured on one.
- **Display caps**: 300 duplicate groups, 50 largest files, 50 protected-location
  rows, 100 files per cleanup category. The last is flagged on screen. The map
  of the folder gives its own tile only to files of 10 MB or more, ten per
  folder, and to the 300 largest folders in any one folder; the rest are
  counted in a tile that says how many.
- **Scanning `C:\` under-reports it**, because protected system locations are
  excluded by design. The status line says how many were left out; the System
  screen measures the whole drive.
- **Fast scan is NTFS only, whole drives only, and costs a prompt.** FAT,
  exFAT and ReFS keep no `$MFT`; network and read-only drives are refused.
  A hard link in two folders is counted once by the catalogue and twice by the
  walk, so the two can differ by a handful of files outside `C:\Windows`,
  which is excluded from both anyway. The catalogue is a list of names and
  sizes, and everything else a scan decides is decided afterwards from that
  list, exactly as it would be from the folders themselves.
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
- **Moving to another drive is for files, by hand, to a local drive.** No
  folders, no network drives, and not in the unattended run yet. Whether the
  drive is removable is what Windows says, and [Unverified] a USB hard disk may
  call itself fixed. The copy is read back after it is flushed to the drive,
  but [Inference] that read can be answered from memory rather than from the
  disk itself.
- **The right-click menu is the classic one**: on Windows 11 it is a click
  further in, under *Show more options*. It is offered only by the installed
  app, for one item at a time. That the uninstaller takes its entries out is
  checked in the script it is built from, [Unverified] not by installing and
  uninstalling — a test install carries the same identity as a real one and
  would replace it.
- **A sealed journal is not proof against the computer's own user** (Business).
  They can rewrite it and sign it again, and nobody can tell that its newest
  sessions were taken out. It catches edits by anything else.
  [Details](#whether-the-journal-is-still-as-it-was).
- **The command line is English, and needs its batch file.** Started as
  `CleanDrive.exe --cli` directly, PowerShell and cmd do not wait for it. Ctrl+C
  ends it at once rather than letting it finish the file it is on. Business
  only.
- **An organisation's policy is machine-wide and read through `reg.exe`** — or
  through PowerShell when `reg.exe` is blocked, which it is (measured) wherever
  *Prevent access to registry editing tools* is on. There is no per-user half yet. The
  ADMX files have not been loaded into a real Group Policy editor or Intune.
  The organisation's profile skips while one of the programs on the default
  list is open (Visual Studio Code among them), like any profile, and the
  policy cannot change that list.
- **The scheduled task only fires while somebody is logged on.** A machine left
  at the login screen at 02:00 runs the cleanup at the next opportunity instead.
- **Moving the app** relocates the executable the scheduled task points at. The
  app notices on next launch and repairs it, but the runs between the move and
  that launch do not happen.
- **No choice of accent colour on its own.** A Windows contrast theme, or your
  own colours, change every colour instead. Windows' contrast themes were
  checked through an emulated one, not each of the real ones. Narrator was
  tried with 0.1.16 and worked (see Keyboard and screen readers).

---

## Running and building it

```
npm install
npm start            # run it
npm run dev          # run it with developer tools
npm test             # the unit suites
npm run test:e2e     # boot the real app, click its own buttons, read the DOM back
npm run build        # a Windows installer in dist/
npm run cli -- scan D:\Projects   # the command line, from a checkout
```

`npm run test:cli` runs every command against the real modules under plain
Node; `npm run verify:cli` starts the real program — exit codes out of a real
process, a live run through the real Recycle Bin and back, a journal edited by
hand, and a hidden console read back from its own screen to see that the batch
file waits — and `-- --packaged <win-unpacked folder>` does the same to a build,
through its own `bin\cleandrive.cmd`. `-- --elevated`, from an elevated
terminal, adds `system` and `scan --mft`. `npm run verify:scheduled-exit` checks
that a failed scheduled run reaches Task Scheduler as a failure.

The interface is plain HTML, CSS and JavaScript — no framework and no build step,
so what is in `src/renderer/` is what runs. All filesystem work happens in a
separate process; the interface has no access to the disk, the network or Node at
all, and reaches the system only through a fixed list of named operations —
sixty-two of them, written down in `src/main/ipc-manifest.js`. A handler for a
channel not in that file throws at startup, and `npm run test:ipc` holds the
preload, the handlers and the manifest to the same list.

Every row a screen draws is a **candidate** (`src/main/analyzers/contract.js`):
a path, a size, one of four verdicts, one of four confidence words, and the
ranked evidence behind them. A candidate missing its confidence or its evidence
is refused before it leaves the main process, which is what makes "every verdict
arrives with its evidence" a property of the code rather than a habit.

Three further environment variables exist for development only:

```
CLEANDRIVE_CHANNEL=beta npm run build         # which channel a build is (default: stable)
CLEANDRIVE_ENTITLEMENTS=free npm start        # narrow a checkout to one tier: free, pro, pro+dev, business, all -- or stored
CLEANDRIVE_COPIES_SCOPE=D:\x npm start        # where "Find duplicates" looks, instead of Home (a checkout only)
```

A checkout opens every feature by default and honours `CLEANDRIVE_ENTITLEMENTS`.
A built installer cannot be told a tier at all: the module that reads the
variable is left out of every build but the `dev` channel. An installed copy
is Free until `license.dat` in its data folder holds a licence whose signature
it believes. Pro and the developer add-on were open to everyone on installed
copies from 0.1.x to 0.5.0, while there was nothing to buy; 0.6.0 closes them
again. `CLEANDRIVE_ENTITLEMENTS=stored` makes a checkout read `license.dat` the
way an installed copy does.

**The release guard.** `npm run build` checks what it actually packed — after
the app folder is made and before the installer is — and stops if a build that
is not `dev` holds the developer override (the module, or the variable's name
in any text file), anything from `scripts/`, a devDependency, or a
`build-info.json` that names another channel. `npm run guard:release --
dist\win-unpacked` runs the same check on a folder already built;
`npm run verify:release-guard` proves it on three real builds (a planted leak
that must fail without leaving an installer, a clean stable build whose exe
ignores the variable, and a dev build that honours it). It reads the asar
itself, so it adds no dependency.

Three Windows programs are run for OneDrive's *Free up space*, each by its
absolute path in `System32`: `tasklist` to see whether OneDrive is running,
Windows PowerShell with a fixed script (the file paths go in on its input, never
into the script) to read each file's sync state through the Cloud Files API,
and `attrib +U -P` — the command Microsoft documents for Files On-Demand — to
make a file online-only. `npm run verify:dehydrate` checks the real OneDrive
reading only; with `-- --write` it makes three small files of its own
online-only, measures it, and deletes them again. `tasklist` is also how a
known app's cache waits for the app to close — the same absolute path, the same
fixed arguments — and `npm run capture:appcaches` records, reading only, the
folder names those apps keep on this machine: the fixtures their definitions
are tested against, with sites' and accounts' names blanked.

The right-click menu is written with `System32\reg.exe` and nothing else, by its
absolute path: `import` of a `.reg` file the app writes to its own temp folder
(UTF-16, so a Vietnamese label arrives intact and a command line's quotes are
the file's escapes, not a second layer of quoting), and `export` of one key to
read it back — `reg query` prints in the console's code page, which has no
Vietnamese. `npm run verify:contextmenu` does all of it against the real
registry, under harness names (`CleanDrive.harness.*`) that are never the real
ones, asks Windows' Shell whether a folder and a file now carry the entries, and
takes them out again, checking nothing else under those keys changed.
`npm run verify:launch` starts the real app the way Explorer does — with
`--analyze=…`, then a second copy with `--duplicates-of=…` — and reads the
window back through Chromium's debugging port.

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
`npm run verify:quarantine -- --elevated` makes a 64 MB virtual disk of its own,
uses it as the quarantine drive, fills it and detaches it part way through a
copy, and deletes it: the one program it runs elevated is
`System32\diskpart.exe`, on scripts it writes itself. The drive type the
quarantine card shows comes from a fixed PowerShell script given only a drive
root such as `D:\`.

The app ships with **two runtime dependencies**: one for auto-update, and
`mammoth` for reading Word documents in the viewer. The second is a deliberate
exception to a standing rule against dependencies, made after building both a
hand-written reader and the library version and measuring them against real
documents — the comparison harness is still in `scripts/` and still runs for the
other formats. `axe-core` is a development dependency only, pinned to one
version, for the accessibility harness; it is not in the installer.

Everything else, including the ZIP, Excel, PowerPoint, image and video readers,
the charts and the tray icon, is written here. There are no binary assets in the
repository; the icons are drawn in code.

Test harnesses live in [`scripts/`](scripts/) — thirty-eight suites in
`npm test`, plus the Electron ones, covering the classification rules, the
colour rules a theme must pass (CIEDE2000 held to its published reference
pairs), the
known apps' caches held to their real folders, moving files to another drive
down to a folder swapped for a junction half way through, the
candidate contract, the action pipeline, the map of the folder and what the
window may ask of it, what two scans of a folder can honestly say changed, the
journal (including two processes
writing it at once) and its seal (edited, cut and forged lines, and the two
attacks it cannot see, checked to be as invisible as the documentation says), the deletion guards, the unattended-run gates, the Recycle
Bin purge and the restore both written from the attacker's side, the
entitlement matrix, the elevated helper's handshake, the settings migration
against the released code, the translation dictionary, and an end-to-end run
that boots the real application and reads its rendered interface back out.
`npm run test:a11y` boots it too and checks it for accessibility (see
[Keyboard and screen readers](#keyboard-and-screen-readers)), and
`npm run test:onboarding` walks the introduction every way out of it, and
`npm run test:explorer` the right-click menu's card and what the menu asks for.
`npm run verify:restore` puts throwaway files back from the real Recycle Bin.
`npm run shoot:lists`, `shoot:media`, `shoot:viewer`, `shoot:restore`, `shoot:seal`,
`shoot:system`, `shoot:treemap`, `shoot:changes`, `shoot:cloud`, `shoot:appcaches`, `shoot:quarantine`, `shoot:a11y`, `shoot:intro`, `shoot:explorer` and `shoot:cli` take screenshots of the real screens.

Harnesses run against a sandbox userData and a suffixed task name, so they cannot
reach anything of yours. They used to leave something of their own behind all the
same: a real entry in Task Scheduler, since a fresh userData has the daily disk
measurement switched on. `npm run verify:task-cleanup` registers a task in a child
process and then asks Windows whether it survived the child, and
`npm run tasks:leftovers` lists what this project has in Task Scheduler, marking
which entries are the app's and which were left by a harness — `--remove` deletes
the latter and never the former.
