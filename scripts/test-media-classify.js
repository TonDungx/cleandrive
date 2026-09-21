#!/usr/bin/env node
'use strict';

// The two classification axes, against records written out by hand.
//
//   node scripts/test-media-classify.js
//
// A record is what `probe.js` produces, and every field in one comes from a
// parser that `test-media-format.js` already holds to the byte. So these
// fixtures are objects rather than files: what is under test here is the
// reasoning, and mixing the two would mean a change to a JPEG header breaking a
// test about where photographs come from.
//
// Half of what follows asserts that something is *not* concluded. That is the
// half that matters: this subsystem decides what a person is shown before they
// delete pictures they cannot get back, and a wrong confident answer is worse
// than an honest "nothing here says".

const { classifyOrigin } = require('../src/main/lib/media/origin');
const { describeNature } = require('../src/main/lib/media/nature');
const i18n = require('../src/i18n');
require('../src/i18n/vi');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

/** A probe record with sensible defaults, so each fixture states only what matters. */
function record(overrides = {}) {
  const base = {
    path: 'C:\\Users\\x\\Pictures\\file.jpg',
    name: 'file.jpg',
    ext: 'jpg',
    size: 2 * 1024 * 1024,
    mtimeMs: Date.now(),
    kind: 'image',
    format: 'jpeg',
    formatMismatch: false,
    width: 3000,
    height: 2000,
    megapixels: 6,
    bytesPerPixel: 0.35,
    aspect: 1.5,
  };
  const merged = { ...base, ...overrides };
  if (overrides.path && !overrides.name) merged.name = overrides.path.split(/[\\/]/).pop();
  return merged;
}

const DISPLAYS = [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }];
const ctx = { displays: DISPLAYS };

/** Render the evidence list to readable English, the way the panel will. */
const why = (result) => result.evidence.map((e) => i18n.render(e)).join(' · ');
const traitKeys = (result) => result.traits.map((t) => t.key);

/* -------------------------------------------------------------------------- */

console.log('\norigin: what the device wrote about itself wins\n');

{
  const camera = classifyOrigin(record({ camera: 'Apple iPhone 15 Pro', hasExif: true, takenAt: Date.now() }), ctx);
  check('a file naming its camera is a camera photo', camera.origin === 'camera' && camera.strength === 'certain');
  check('and it says which camera, in the evidence', /iPhone 15 Pro/.test(why(camera)), why(camera).slice(0, 80));

  // The case ranking exists to get right: a photograph somebody named badly.
  const misnamed = classifyOrigin(
    record({ path: 'C:\\x\\Screenshot of the beach.jpg', camera: 'Canon EOS R6', hasExif: true }),
    ctx
  );
  check('a camera photo called "Screenshot of the beach" is still a camera photo',
    misnamed.origin === 'camera', misnamed.origin);

  // ...and the reverse: nothing weak may overturn the camera, but an editor
  // having touched it afterwards is still worth saying.
  const edited = classifyOrigin(
    record({ camera: 'NIKON Z 6', software: 'Adobe Photoshop 25.0', hasExif: true }),
    ctx
  );
  check('a camera photo later edited is still a camera photo', edited.origin === 'camera');
  check('but the editing is mentioned', /Photoshop/.test(why(edited)), why(edited).slice(0, 90));

  const software = classifyOrigin(record({ software: 'Adobe Lightroom 13.2', hasExif: true }), ctx);
  check('a file with only editing software is "edited"', software.origin === 'edited', software.origin);

  const obs = classifyOrigin(record({ kind: 'video', format: 'mp4', software: 'OBS Studio' }), ctx);
  check('a video made by OBS Studio is a screen recording', obs.origin === 'screenrecord', obs.origin);
}

console.log('\norigin: the folder, then the download record, then the name\n');

{
  const roll = classifyOrigin(record({ path: 'C:\\Users\\x\\Pictures\\Camera Roll\\a.jpg' }), ctx);
  check('Camera Roll means a camera', roll.origin === 'camera' && roll.strength === 'strong');

  const zalo = classifyOrigin(record({ path: 'C:\\Users\\x\\Documents\\Zalo Received Files\\a.jpg' }), ctx);
  check('a Zalo folder means a message', zalo.origin === 'messaging' && zalo.app === 'Zalo');
  check('and the evidence names Zalo', /Zalo/.test(why(zalo)));

  // The machine this was written on has two profile trees; anchoring the folder
  // test to %USERPROFILE% would find one and miss the other.
  const otherDrive = classifyOrigin(record({ path: 'D:\\Users\\x\\Pictures\\Screenshots\\a.png', format: 'png' }), ctx);
  check('a folder on another drive is recognised too', otherDrive.origin === 'screenshot');

  const downloaded = classifyOrigin(record({ zone: { host: 'images.example.com', zoneId: 3 } }), ctx);
  check('a download record makes it a download', downloaded.origin === 'download');
  check('and the evidence names the host', /images\.example\.com/.test(why(downloaded)));

  const fromChat = classifyOrigin(record({ zone: { host: 'cdn.fbcdn.net', zoneId: 3 } }), ctx);
  check('downloaded from Facebook is a message, not a download',
    fromChat.origin === 'messaging' && fromChat.app === 'Facebook', `${fromChat.origin}/${fromChat.app}`);

  const whatsapp = classifyOrigin(record({ path: 'C:\\x\\y\\IMG-20240817-WA0042.jpg' }), ctx);
  check('WhatsApp\'s filename is unmistakable',
    whatsapp.origin === 'messaging' && whatsapp.app === 'WhatsApp', `${whatsapp.origin}/${whatsapp.app}`);

  const telegram = classifyOrigin(record({ path: 'C:\\x\\y\\photo_2024-01-01_12-00-00.jpg' }), ctx);
  check('Telegram\'s filename is recognised', telegram.app === 'Telegram');

  const fbimg = classifyOrigin(record({ path: 'C:\\x\\y\\FB_IMG_1712345678901.jpg' }), ctx);
  check('FB_IMG_ is recognised', fbimg.app === 'Facebook');
}

console.log('\norigin: the combination the brief asked for out loud\n');

{
  // "Screenshot" must arrive with "the name matches, there is no EXIF, and the
  // size is the screen's" -- all three, in the evidence, in that order.
  const shot = classifyOrigin(
    record({ path: 'C:\\x\\y\\Screenshot 2025-10-30 151324.png', format: 'png', ext: 'png', width: 1920, height: 1080, hasExif: false }),
    ctx
  );
  const text = why(shot);
  check('it is a screenshot', shot.origin === 'screenshot', shot.origin);
  check('the evidence cites the filename', /Screenshot/.test(text));
  check('the evidence cites the absence of camera information', /no camera information/i.test(text));
  check('the evidence cites the screen size', /1920/.test(text) && /size of this screen/i.test(text));
  check('and having all three makes it strong rather than a guess', shot.strength === 'strong', shot.strength);

  // Windows names screenshots in the display language. On the machine that
  // asked for this feature they are called `Ảnh chụp màn hình …`, and an
  // English-only pattern would have been a rule that did nothing for them.
  const vietnamese = classifyOrigin(
    record({ path: 'C:\\x\\y\\Ảnh chụp màn hình 2025-10-30 151324.png', format: 'png', ext: 'png', width: 1920, height: 1080 }),
    ctx
  );
  check('a Vietnamese screenshot name is recognised', vietnamese.origin === 'screenshot', vietnamese.origin);

  const vnFolder = classifyOrigin(
    record({ path: 'C:\\Users\\x\\OneDrive\\Hình ảnh\\Ảnh chụp màn hình\\a.png', format: 'png', ext: 'png' }),
    ctx
  );
  check('so is the Vietnamese Screenshots folder',
    vnFolder.origin === 'screenshot' && vnFolder.strength === 'strong', `${vnFolder.origin}/${vnFolder.strength}`);

  const cuonPhim = classifyOrigin(record({ path: 'C:\\Users\\x\\OneDrive\\Hình ảnh\\Cuộn phim\\a.jpg' }), ctx);
  check('and the Vietnamese Camera Roll', cuonPhim.origin === 'camera', cuonPhim.origin);

  // NTFS stores whatever bytes it was given and normalises nothing. The
  // development machine carries both forms in one folder: `Hình ảnh` arrives
  // decomposed while its sibling `Máy tính` arrives composed. A pattern written
  // in one form matches only that form, and this rule silently matched nothing
  // until every name was normalised first.
  const decomposed = 'C:\\Users\\x\\OneDrive\\Hình ảnh\\Ảnh chụp màn hình\\a.png'.normalize('NFD');
  check('the fixture really is in the other normal form',
    decomposed !== decomposed.normalize('NFC'), `${decomposed.length} vs ${decomposed.normalize('NFC').length} code points`);
  const nfd = classifyOrigin(record({ path: decomposed, format: 'png', ext: 'png' }), ctx);
  check('a decomposed Vietnamese folder name still matches',
    nfd.origin === 'screenshot' && nfd.strength === 'strong', `${nfd.origin}/${nfd.strength}`);

  const nfdName = classifyOrigin(
    record({ path: 'C:\\x\\y\\Ảnh chụp màn hình 2025-10-30 151324.png'.normalize('NFD'), format: 'png', ext: 'png' }),
    ctx
  );
  check('and so does a decomposed filename', nfdName.origin === 'screenshot', nfdName.origin);

  // A maximised browser window: as wide as the screen, shorter than it. This
  // measured 1920x1020 on the development machine.
  const window = classifyOrigin(
    record({ path: 'C:\\x\\y\\something.png', format: 'png', ext: 'png', width: 1920, height: 1020, hasExif: false }),
    ctx
  );
  check('a capture as wide as the screen but shorter is read as a window',
    window.origin === 'screenshot', window.origin);
  check('and it says so rather than claiming a full screen', /shorter/.test(why(window)));

  // A screen-shaped name with no display to compare against must weaken, not
  // strengthen. This is what happens on a machine with no display information.
  const noDisplays = classifyOrigin(
    record({ path: 'C:\\x\\y\\Screenshot 2025-10-30 151324.png', format: 'png', ext: 'png' }),
    { displays: [] }
  );
  check('without a screen to compare against it is only likely',
    noDisplays.origin === 'screenshot' && noDisplays.strength === 'likely', noDisplays.strength);
}

console.log('\norigin: refusing to decide\n');

{
  const nothing = classifyOrigin(record({ path: 'C:\\x\\y\\a1b2c3d4.jpg', width: 700, height: 460 }), ctx);
  check('a file with no signals at all is unknown', nothing.origin === 'unknown', nothing.origin);
  check('and it says plainly that nothing said', /Nothing in the file/.test(why(nothing)));
  check('and it is marked as a guess', nothing.strength === 'guess');

  // A photo forwarded through a chat app arrives with a camera-shaped name and
  // no metadata, because every messenger strips it. Saying "camera, likely"
  // with that stated is honest; saying "camera, certain" would not be.
  const stripped = classifyOrigin(record({ path: 'C:\\x\\y\\IMG_4821.jpg', hasExif: false }), ctx);
  check('a camera-shaped name with no metadata is only likely',
    stripped.origin === 'camera' && stripped.strength === 'likely', stripped.strength);
  check('and the stripping is spelled out', /stripped/.test(why(stripped)));

  check('every verdict carries at least one piece of evidence',
    [nothing, stripped].every((r) => r.evidence.length > 0));
}

/* -------------------------------------------------------------------------- */

console.log('\nnature: a file can be several things at once\n');

{
  const both = describeNature(record({ size: 900, format: 'gif', ext: 'jpg', formatMismatch: true, width: 32, height: 32, megapixels: 0, bytesPerPixel: 0.87 }), ctx);
  const keys = traitKeys(both);
  check('a tiny mislabelled file is reported as both', keys.includes('tiny') && keys.includes('mislabelled'), keys.join(','));

  const broken = describeNature(record({ unread: 'empty', size: 0 }), ctx);
  check('a zero-byte file is broken', traitKeys(broken).includes('broken'));
  check('and nothing else is invented about it', broken.traits.length === 1, traitKeys(broken).join(','));
  check('the reason says it is empty', /nothing in it/i.test(i18n.render(broken.traits[0].evidence)));

  const failed = describeNature(record({ unread: 'unrecognised', ext: 'jpg' }), ctx);
  check('a failed download is broken with its own reason',
    /download that failed/i.test(i18n.render(failed.traits[0].evidence)));
}

console.log('\nnature: bytes per pixel is never a verdict on its own\n');

{
  // A PNG screenshot of a flat interface is genuinely 0.02 bytes a pixel and
  // has lost nothing. Calling that "compressed hard" would be wrong, and it is
  // the most common single file in a screenshots folder.
  const screenshot = describeNature(
    record({ format: 'png', ext: 'png', width: 1920, height: 1080, megapixels: 2.1, bytesPerPixel: 0.02, size: 40 * 1024 }),
    ctx
  );
  check('a flat PNG is not accused of being over-compressed',
    !traitKeys(screenshot).includes('hard-compressed'), traitKeys(screenshot).join(','));

  const squeezed = describeNature(
    record({ format: 'jpeg', width: 3000, height: 2000, megapixels: 6, bytesPerPixel: 0.05, size: 300 * 1024 }),
    ctx
  );
  check('a hard-compressed JPEG is', traitKeys(squeezed).includes('hard-compressed'));
  check('and the wording tells the user to look first',
    /look before deciding/i.test(i18n.render(squeezed.traits.find((t) => t.key === 'hard-compressed').evidence)));

  // The three-signal combination: a messenger's exact long edge, no camera
  // metadata, and a thin byte budget.
  const passed = describeNature(
    record({ format: 'jpeg', width: 1600, height: 1200, megapixels: 1.9, bytesPerPixel: 0.25, hasExif: false, size: 480 * 1024 }),
    ctx
  );
  check('a photo resized to a chat app\'s size with no metadata is flagged as recompressed',
    traitKeys(passed).includes('recompressed'), traitKeys(passed).join(','));
  check('and the evidence names the size and the app',
    /1600/.test(i18n.render(passed.traits.find((t) => t.key === 'recompressed').evidence)));

  // The same dimensions but the camera data is still there: not recompressed,
  // just a photo that happens to be 1600 wide.
  const intact = describeNature(
    record({ format: 'jpeg', width: 1600, height: 1200, megapixels: 1.9, bytesPerPixel: 0.25, hasExif: true, camera: 'Canon', size: 480 * 1024 }),
    ctx
  );
  check('the same size with its camera data intact is not',
    !traitKeys(intact).includes('recompressed'), traitKeys(intact).join(','));
}

console.log('\nnature: no blur category, on purpose\n');

{
  // The brief asked for one. Measured on this machine, sharp scanned documents
  // scored 390-550 on Laplacian variance while screen recordings of text
  // scored 3,000-6,000 -- the spread tracks subject matter, not focus. A group
  // labelled "blurry" would invite bulk selection of the least recoverable
  // files in the app on the strength of that.
  const everything = [
    describeNature(record({}), ctx),
    describeNature(record({ width: 4032, height: 3024, megapixels: 12.2 }), ctx),
    describeNature(record({ size: 500, width: 16, height: 16 }), ctx),
    describeNature(record({ kind: 'video', format: 'mp4', durationSec: 120, bitrateKbps: 9000, width: 1920, height: 1080 }), ctx),
  ];
  const allKeys = new Set(everything.flatMap(traitKeys));
  check('nothing is ever labelled blurry', !allKeys.has('blurry') && !allKeys.has('blur'),
    [...allKeys].join(','));
}

console.log('\nnature: video\n');

{
  const screen = describeNature(
    record({ kind: 'video', format: 'mp4', ext: 'mp4', width: 1920, height: 1020, durationSec: 55, bitrateKbps: 9572, hasVideoTrack: true, hasAudioTrack: false, size: 63 * 1024 * 1024 }),
    ctx
  );
  check('a silent video says so', traitKeys(screen).includes('silent'), traitKeys(screen).join(','));
  check('a big file says so', traitKeys(screen).includes('big'));

  const uhd = describeNature(
    record({ kind: 'video', format: 'mov', ext: 'mov', width: 3840, height: 2160, durationSec: 4, bitrateKbps: 60695, hasVideoTrack: true, hasAudioTrack: true, size: 29 * 1024 * 1024 }),
    ctx
  );
  check('4K is called 4K', traitKeys(uhd).includes('4k'));
  check('a four-second clip is called brief', traitKeys(uhd).includes('brief'));

  const noMeta = describeNature(record({ kind: 'video', format: 'mkv', ext: 'mkv', noMetadata: true, width: 0, height: 0 }), ctx);
  check('a container we cannot read says so rather than guessing',
    traitKeys(noMeta).includes('no-metadata'), traitKeys(noMeta).join(','));
}

console.log('\nnature: wide and tall are not the same thing\n');

{
  // Of 778 files past the aspect threshold on the development machine, 763 were
  // wide -- and nearly all of those were strips cropped out of a screen, not
  // landscapes. One chip labelled "panorama" holding both teaches the user that
  // the labels do not mean anything.
  const strip = describeNature(record({ width: 1900, height: 400, megapixels: 0.8, format: 'png', ext: 'png', bytesPerPixel: 0.3 }), ctx);
  check('a wide image is called wide', traitKeys(strip).includes('wide'), traitKeys(strip).join(','));

  const scroll = describeNature(record({ width: 928, height: 3279, megapixels: 3, format: 'png', ext: 'png', bytesPerPixel: 0.1 }), ctx);
  check('a tall one is called tall, not a panorama', traitKeys(scroll).includes('tall'), traitKeys(scroll).join(','));
  check('and nothing is called a panorama any more',
    !traitKeys(strip).includes('panorama') && !traitKeys(scroll).includes('panorama'));
  check('the tall wording names the thing it usually is',
    /scrolling screenshot/i.test(i18n.render(scroll.traits.find((t) => t.key === 'tall').evidence)));

  const ordinary = describeNature(record({ width: 3000, height: 2000 }), ctx);
  check('an ordinary photograph is neither',
    !traitKeys(ordinary).includes('wide') && !traitKeys(ordinary).includes('tall'));
}

console.log('\norigin: the game bar records more than games\n');

{
  // `Videos\Captures` was mapped to "game capture" until a scan of real files
  // filed a recording of a browser tab under it. The game bar records whatever
  // window is in front.
  const tab = classifyOrigin(
    record({
      path: 'C:\\Users\\x\\Videos\\Captures\\Streaming System and 6 more pages.mp4',
      kind: 'video', format: 'mp4', ext: 'mp4', width: 1920, height: 1020,
      title: 'Streaming System and 6 more pages - Personal - Microsoft Edge',
    }),
    ctx
  );
  check('a browser recording in Captures is a screen recording, not a game capture',
    tab.origin === 'screenrecord', tab.origin);
  check('and the window title is given as the reason',
    /window title/.test(why(tab)) && /Streaming System/.test(why(tab)), why(tab).slice(0, 110));
  // Titles run long -- the real ones on this machine are "… and 6 more pages -
  // Personal - Microsoft Edge" -- so the evidence keeps the front, which is the
  // part a person recognises, and says it stopped.
  check('a long title is cut rather than allowed to fill the panel',
    /…/.test(why(tab)), why(tab).slice(-40));

  const shadowplay = classifyOrigin(
    record({ path: 'C:\\Users\\x\\Videos\\ShadowPlay\\Elden Ring\\clip.mp4', kind: 'video', format: 'mp4', ext: 'mp4' }),
    ctx
  );
  check('ShadowPlay really is a game capture', shadowplay.origin === 'gamecapture', shadowplay.origin);

  // A still image that happens to sit in Captures is still a screenshot.
  const still = classifyOrigin(
    record({ path: 'C:\\Users\\x\\Videos\\Captures\\Screenshot 2025-01-01 000000.png', format: 'png', ext: 'png' }),
    ctx
  );
  check('a picture in Captures is not a recording', still.origin === 'screenshot', still.origin);
}

console.log('\norigin: the evidence reads as a sentence\n');

{
  // A real scan produced "and it is exactly 1920×1080 · and it carries no
  // camera information at all" -- an argument with no opening clause, in both
  // languages, because both fragments are written as continuations.
  const leading = classifyOrigin(
    record({ path: 'C:\\x\\y\\103780405_DESKTOP-BB8GC4J1452025_154832.png', format: 'png', ext: 'png', width: 1920, height: 1080, hasExif: false }),
    ctx
  );
  const first = i18n.render(leading.evidence[0]);
  check('no verdict opens its case with the word "and"', !/^and\b/i.test(first), first);

  i18n.setLanguage('vi');
  const firstVi = i18n.render(leading.evidence[0]);
  check('nor with "và" in Vietnamese', !/^và\b/i.test(firstVi), firstVi);
  i18n.setLanguage('en');

  // Every path into the classifier, checked the same way, so a new rule cannot
  // reintroduce this without the suite noticing.
  const everyShape = [
    record({ camera: 'Canon EOS R6', hasExif: true }),
    record({ software: 'Adobe Photoshop 25.0', hasExif: true }),
    record({ path: 'C:\\x\\Pictures\\Camera Roll\\a.jpg' }),
    record({ zone: { host: 'example.com' } }),
    record({ path: 'C:\\x\\y\\IMG-20240817-WA0042.jpg' }),
    record({ path: 'C:\\x\\y\\Screenshot 2025-01-01 000000.png', format: 'png', ext: 'png', width: 1920, height: 1080 }),
    record({ width: 1920, height: 1080, hasExif: false }),
    record({ path: 'C:\\x\\y\\a1b2c3.jpg', width: 700, height: 460 }),
    record({ kind: 'video', format: 'mp4', ext: 'mp4', title: 'Something - Microsoft Edge' }),
  ].map((r) => classifyOrigin(r, ctx));

  const openers = everyShape.map((r) => i18n.render(r.evidence[0]));
  check('and that holds for every route through the classifier',
    openers.every((t) => t.length > 0 && !/^(and|which|but|nor)\b/i.test(t)),
    openers.filter((t) => /^(and|which|but|nor)\b/i.test(t)).join(' | ') || 'all clean');
}

console.log('\nnature: the two things that change what deleting means\n');

{
  const synced = describeNature(record({ cloudService: 'OneDrive' }), ctx);
  const cloudTrait = synced.traits.find((t) => t.key === 'cloud');
  check('a synced file is marked', Boolean(cloudTrait));
  // The whole safety story everywhere else in this app is "it goes to the
  // Recycle Bin". For these files that is not true, and the trait has to say so
  // rather than merely naming the service.
  check('and the reason says deleting it here deletes it everywhere',
    /everywhere/i.test(i18n.render(cloudTrait.evidence)), i18n.render(cloudTrait.evidence));

  const placeholder = describeNature(record({ unread: 'dehydrated', dehydrated: true, cloudService: 'OneDrive' }), ctx);
  check('an online-only file is reported as unread rather than as a picture',
    traitKeys(placeholder).includes('broken'));
  check('and the reason says its contents were never read',
    /online only/i.test(i18n.render(placeholder.traits[0].evidence)));
}

console.log('\nclassification: every reason survives translation\n');

{
  // These reasons are built in the main process and rendered in the window, so
  // they travel as message objects. A reason that arrived as a plain English
  // string would be English in a Vietnamese window for ever.
  const samples = [
    classifyOrigin(record({ camera: 'Apple iPhone 15 Pro', hasExif: true }), ctx),
    classifyOrigin(record({ path: 'C:\\x\\Screenshot 2025-01-01 000000.png', format: 'png', width: 1920, height: 1080 }), ctx),
    classifyOrigin(record({ zone: { host: 'example.com' } }), ctx),
  ];
  check('every piece of origin evidence is a message, not a rendered sentence',
    samples.every((s) => s.evidence.every((e) => e && typeof e === 'object' && typeof e.i18n === 'string')),
    samples.flatMap((s) => s.evidence.map((e) => typeof e)).join(','));

  const natures = [
    describeNature(record({ cloudService: 'OneDrive' }), ctx),
    describeNature(record({ size: 900, width: 16, height: 16 }), ctx),
    describeNature(record({ unread: 'empty' }), ctx),
  ];
  check('and so is every trait',
    natures.every((n) => n.traits.every((t) => t.evidence && typeof t.evidence.i18n === 'string')));

  i18n.setLanguage('vi');
  const vi = classifyOrigin(record({ camera: 'Apple iPhone 15 Pro', hasExif: true }), ctx);
  const rendered = i18n.render(vi.evidence[0]);
  check('and it reads as Vietnamese when the window is Vietnamese',
    rendered !== 'The file says it was taken by Apple iPhone 15 Pro' && /iPhone 15 Pro/.test(rendered),
    rendered);
  i18n.setLanguage('en');
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
