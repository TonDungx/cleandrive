#!/usr/bin/env node
'use strict';

// Installed apps (D1): the registry parser, the last-used sources, what the
// inventory makes of an entry, and the candidates the screen is drawn from.
//
//   node scripts/test-apps.js
//
// The fixtures in scripts/fixtures/apps/ are real output from this machine,
// taken by capture-apps.js: a `reg export` of the Uninstall hives cut down to
// one block of each shape that turned up, a real UserAssist export, and a real
// `Get-AppxPackage` listing. The account name is blanked in both the plain and
// the ROT13 spelling. Where a test needs a shape this machine does not have --
// an app installed into a whole drive, a launch record from two years ago --
// the record is built by hand and the test says so in its name.

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const registryRead = require('../src/main/apps/registry');
const lastused = require('../src/main/apps/lastused');
const inventory = require('../src/main/apps/inventory');
const measure = require('../src/main/apps/measure');
const store = require('../src/main/apps/store');
const appsAnalyzer = require('../src/main/analyzers/apps');
const analyzers = require('../src/main/analyzers');
const { validateCandidate } = require('../src/main/analyzers/contract');
const { isAllowedUnattended } = require('../src/main/automatic/allowed-categories');
const { can } = require('../src/main/license/entitlements');
const helperOps = require('../src/main/helper/ops');

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const FIXTURES = path.join(__dirname, 'fixtures', 'apps');
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name)).toString('utf16le');

const DAY = 86400000;

/* -------------------------------------------------------------------------- */
/* the .reg parser                                                            */
/* -------------------------------------------------------------------------- */

console.log('\napps: reading what installers wrote into the registry\n');

const parsed = registryRead.parseRegFile(readFixture('uninstall.reg'));
const keys = Object.keys(parsed);
check('every block in the fixture came back as a key', keys.length >= 15, String(keys.length));

const entries = [];
for (const [keyPath, values] of Object.entries(parsed)) {
  if (/Uninstall$/i.test(keyPath)) continue;
  const hive = keyPath.startsWith('HKEY_CURRENT_USER') ? 'HKCU' : keyPath.includes('WOW6432Node') ? 'WOW6432Node' : 'HKLM';
  entries.push({ hive, id: keyPath.slice(keyPath.lastIndexOf('\\') + 1), keyPath, values });
}

{
  const studio = entries.find((e) => e.values.DisplayName === 'Studio 3T');
  check('a string value is a string', studio && studio.values.Publisher === '3T Software Labs', studio ? studio.values.Publisher : 'not found');
  check('a dword is a number, not hex text', studio && studio.values.EstimatedSize === 0x63ca5, studio ? String(studio.values.EstimatedSize) : '-');
  check('a path keeps its single backslashes', studio && studio.values.InstallLocation === 'C:\\Program Files\\3T Software Labs\\Studio 3T',
    studio ? studio.values.InstallLocation : '-');
}

{
  // Two entries on this machine keep InstallLocation as hex(2), which is
  // UTF-16LE bytes rather than a quoted string. A parser that reads only the
  // quoted form drops them and says nothing.
  const gnupg = entries.find((e) => e.id === 'GnuPG');
  check('a REG_EXPAND_SZ written as hex(2) decodes to text, not a Buffer',
    gnupg && typeof gnupg.values.InstallLocation === 'string' && gnupg.values.InstallLocation.includes('Gpg4win'),
    gnupg ? JSON.stringify(String(gnupg.values.InstallLocation)).slice(0, 70) : 'not found');
  check('and carries no trailing NUL', gnupg && !String(gnupg.values.InstallLocation).includes('\0'));
}

{
  const built = registryRead.parseRegFile(
    'Windows Registry Editor Version 5.00\r\n\r\n[HK\\X]\r\n"A"="a\\\\b"\r\n"B"=dword:0000000a\r\n' +
      '"C"=hex:01,02,\\\r\n  03\r\n"D"="say \\"hi\\""\r\n'
  );
  // Built by hand: this machine has no value that needs all four shapes in one
  // key, and the continuation line is what the 72-byte UserAssist values use.
  check('(built by hand) an escaped backslash comes back as one', built['HK\\X'].A === 'a\\b', built['HK\\X'].A);
  check('(built by hand) a dword is decimal', built['HK\\X'].B === 10, String(built['HK\\X'].B));
  check('(built by hand) a hex value continued on the next line is read whole',
    Buffer.isBuffer(built['HK\\X'].C) && built['HK\\X'].C.length === 3 && built['HK\\X'].C[2] === 3,
    built['HK\\X'].C ? built['HK\\X'].C.toString('hex') : '-');
  check('(built by hand) an escaped quote survives', built['HK\\X'].D === 'say "hi"', built['HK\\X'].D);
}

/* -------------------------------------------------------------------------- */
/* which entries are apps                                                     */
/* -------------------------------------------------------------------------- */

console.log('\napps: which registry entries are programs somebody installed\n');

{
  const read = entries.map(inventory.fromRegistryEntry);
  const why = (name) => {
    const found = read.find((a) => a.name === name || a.key === name);
    return found ? found.hidden : 'not found';
  };
  const nameless = read.find((a) => a.hidden === 'noName');
  check('an entry with no DisplayName is not an app', Boolean(nameless), nameless ? nameless.key : 'none in fixture');
  const sysComp = read.find((a) => a.hidden === 'systemComponent');
  check('a SystemComponent entry is left out, as Windows leaves it out', Boolean(sysComp), sysComp ? sysComp.name : 'none in fixture');
  const update = read.find((a) => /^KB\d+$/.test(a.key));
  check('a Windows update (a KB entry) is not an app', update && update.hidden !== null, update ? `${update.key}: ${update.hidden}` : 'none in fixture');

  const shown = read.filter((a) => !a.hidden);
  check('what is left are programs with names', shown.length > 0 && shown.every((a) => a.name && a.name.trim()), String(shown.length));
  check('EstimatedSize is turned into bytes, not left in KB',
    shown.every((a) => a.declaredBytes === 0 || a.declaredBytes % 1024 === 0) &&
      shown.some((a) => a.declaredBytes > 1024 * 1024), 'x1024');
}

{
  // A location that is a whole drive or a shared root is never walked: one
  // installer writing `C:\` would otherwise have the drive measured and
  // called that app's size.
  const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', ProgramData: 'C:\\ProgramData', USERPROFILE: 'C:\\Users\\USER' };
  check('(built by hand) a drive root is refused as an install folder', measure.tooBroad('C:\\', env));
  check('(built by hand) Program Files itself is refused', measure.tooBroad('C:\\Program Files', env));
  check('(built by hand) the profile folder is refused', measure.tooBroad('C:\\Users\\USER', env));
  check('(built by hand) a real install folder is not', !measure.tooBroad('C:\\Program Files\\Git', env));
}

/* -------------------------------------------------------------------------- */
/* what belongs to Windows                                                    */
/* -------------------------------------------------------------------------- */

console.log('\napps: what is part of Windows, and why\n');

{
  const windowsDir = 'C:\\Windows';
  const p = (app) => inventory.protectionOf(app, { windowsDir });
  check('a package Windows signed itself is protected',
    p({ source: 'store', signature: 'System' }) === 'systemPackage');
  check('a Store app from the Store is not', p({ source: 'store', signature: 'Store' }) === null);
  check('Windows’ own NoRemove flag protects an entry', p({ source: 'registry', noRemove: true, uninstallCommand: 'x' }) === 'noRemove');
  check('something installed inside Windows is protected',
    p({ source: 'registry', installLocation: 'C:\\Windows\\System32\\Thing', uninstallCommand: 'x' }) === 'inWindows');
  check('and so is an entry that registered no uninstaller',
    p({ source: 'registry', installLocation: 'C:\\Program Files\\Thing', uninstallCommand: '' }) === 'noUninstaller');
  check('an ordinary program is not protected',
    p({ source: 'registry', installLocation: 'C:\\Program Files\\Thing', uninstallCommand: 'x' }) === null);
}

/* -------------------------------------------------------------------------- */
/* UserAssist                                                                 */
/* -------------------------------------------------------------------------- */

console.log('\napps: when Windows says a program was last started\n');

check('ROT13 is its own inverse', lastused.rot13(lastused.rot13('CleanDrive 0.1')) === 'CleanDrive 0.1');
check('and it leaves digits and punctuation alone', lastused.rot13('a-1.Z') === 'n-1.M');

{
  const ua = lastused.readUserAssist;
  // The fixture is read through the same code path the real key goes through,
  // by handing exportKey a reader that returns the fixture.
  const fixtureDeps = {
    run: async () => true,
    scratch: async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cleandrive-apps-test-'));
      await fsp.writeFile(path.join(dir, 'export.reg'), Buffer.from(readFixture('userassist.reg'), 'utf16le'));
      return dir;
    },
  };
  (async () => {
    const records = await ua(fixtureDeps);
    check('the UserAssist key decodes into launch records', records.available && records.entries.length > 0, String(records.entries.length));
    check('every record has a time that has already happened',
      records.entries.every((e) => e.lastRunMs > 0 && e.lastRunMs <= Date.now()), String(records.entries.length));
    check('an executable and a shortcut are told apart',
      records.entries.some((e) => e.kind === 'exe') && records.entries.some((e) => e.kind === 'shortcut'),
      `${records.entries.filter((e) => e.kind === 'exe').length} exe / ${records.entries.filter((e) => e.kind === 'shortcut').length} lnk`);
    const withPath = records.entries.filter((e) => e.fullPath);
    check('a folder id in front of a name is resolved to a real path',
      withPath.length > 0 && withPath.every((e) => /^[A-Za-z]:\\/.test(e.fullPath)),
      withPath.length ? withPath[0].fullPath : 'none');

    await rest(records);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

/* -------------------------------------------------------------------------- */

async function rest(records) {
  {
    // Built by hand: a FILETIME of zero is what an entry that has never run
    // carries, and a clock wound forward writes one in the future.
    const never = Buffer.alloc(72);
    check('(built by hand) a record with no time is not a launch', lastused.filetimeAt(never, 60) === null);
    const future = Buffer.alloc(72);
    const ahead = BigInt(Date.now() + 40 * DAY + 11644473600000) * 10000n;
    future.writeUInt32LE(Number(ahead & 0xffffffffn), 60);
    future.writeUInt32LE(Number(ahead >> 32n), 64);
    check('(built by hand) a time in the future is refused, not shown as a launch', lastused.filetimeAt(future, 60) === null);
  }

  console.log('\napps: Prefetch, as the elevated helper hands it over\n');

  {
    // Built by hand: this account cannot read C:\Windows\Prefetch, so the
    // listing shape is written out here. `verify-prefetch.js` is what checks
    // it against the real folder, with administrator rights.
    const now = Date.now();
    const listing = lastused.fromPrefetchListing([
      { name: 'NOTEPAD.EXE-9B4F2A1C.pf', mtimeMs: now - 3 * DAY, size: 20000 },
      { name: 'NOTEPAD.EXE-11223344.pf', mtimeMs: now - 400 * DAY, size: 20000 },
      { name: 'SETUP.EXE-DEADBEEF.pf', mtimeMs: now - 10 * DAY, size: 20000 },
      { name: 'AgAppLaunch.db', mtimeMs: now, size: 5 },
      { name: 'not-a-prefetch-file.pf', mtimeMs: now, size: 5 },
    ]);
    check('(built by hand) a .pf name gives the program it belongs to', listing.byExe.has('notepad.exe'), [...listing.byExe.keys()].join(', '));
    check('(built by hand) two prefetch files for one program keep the newer time',
      Math.abs(listing.byExe.get('notepad.exe').lastRunMs - (now - 3 * DAY)) < 1000);
    check('(built by hand) the database Windows keeps beside them is not a program', !listing.byExe.has('agapplaunch.db'));
    check('(built by hand) a file that is not named like a prefetch file is skipped', listing.byExe.size === 2, String(listing.byExe.size));
  }

  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'helper', 'ops.js'), 'utf8');
    check('the helper op exists and is in the fixed list', helperOps.has('prefetch.list'));
    const body = src.slice(src.indexOf("'prefetch.list'"), src.indexOf("'shadowstorage.query'"));
    check('it reads the folder and nothing else: no readFile, no open',
      !/readFile|\.open\s*\(|createReadStream/.test(body), body.slice(0, 0) || 'ok');
    check('and the folder is the fixed one, not one from the request',
      /SystemRoot.*Prefetch|'Prefetch'/.test(body) && !/args/.test(body));
  }

  console.log('\napps: matching an app to its data folders\n');

  {
    // Written the way these four are really registered on this machine: VS
    // Code's display name matches no folder it owns and its uninstaller is
    // Inno Setup's generic one, so `DisplayIcon` is the only field that says
    // `Code.exe`.
    const apps = [
      { id: 'a', name: 'Microsoft Visual Studio Code (User)', publisher: 'Microsoft Corporation', installLocation: 'C:\\Users\\USER\\AppData\\Local\\Programs\\Microsoft VS Code', uninstallCommand: '"C:\\Users\\USER\\AppData\\Local\\Programs\\Microsoft VS Code\\unins000.exe"', displayIcon: 'C:\\Users\\USER\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe' },
      { id: 'b', name: 'Discord', publisher: 'Discord Inc.', installLocation: 'C:\\Users\\USER\\AppData\\Local\\Discord', uninstallCommand: 'Update.exe --uninstall', displayIcon: '' },
      { id: 'c', name: 'Microsoft', publisher: 'Contoso', installLocation: '', uninstallCommand: '', displayIcon: '' },
      { id: 'd', name: 'Other Thing', publisher: 'Microsoft', installLocation: '', uninstallCommand: '', displayIcon: '' },
      { id: 'e', name: 'Postman', publisher: 'Postman Inc', installLocation: '', uninstallCommand: '', displayIcon: '' },
    ];
    const folders = [
      { root: 'roaming', name: 'Code', path: 'C:\\Users\\USER\\AppData\\Roaming\\Code' },
      { root: 'roaming', name: 'Microsoft', path: 'C:\\Users\\USER\\AppData\\Roaming\\Microsoft' },
      { root: 'roaming', name: 'discord', path: 'C:\\Users\\USER\\AppData\\Roaming\\discord' },
      { root: 'local', name: 'Discord', path: 'C:\\Users\\USER\\AppData\\Local\\Discord' },
      { root: 'local', name: 'NothingKnowsThis', path: 'C:\\Users\\USER\\AppData\\Local\\NothingKnowsThis' },
      { root: 'roaming', name: 'Postman', path: 'C:\\Users\\USER\\AppData\\Roaming\\Postman' },
    ];
    const { matches, ambiguous } = inventory.matchDataFolders(apps, folders);
    check('a folder named after the app’s own executable is matched', (matches.get('a') || []).some((f) => f.name === 'Code'));
    check('and matching the executable counts as strong, not a guess',
      (matches.get('a') || []).every((f) => f.confidence === 'strong'), JSON.stringify((matches.get('a') || []).map((f) => f.confidence)));
    check('a folder two apps both claim goes to neither',
      !(matches.get('c') || []).length && !(matches.get('d') || []).length && ambiguous === 1,
      `ambiguous=${ambiguous}`);
    check('a folder nothing claims is left alone', ![...matches.values()].flat().some((f) => f.name === 'NothingKnowsThis'));
    check('a folder inside the install folder is not counted a second time',
      !(matches.get('b') || []).some((f) => f.path === 'C:\\Users\\USER\\AppData\\Local\\Discord'),
      JSON.stringify((matches.get('b') || []).map((f) => f.name)));
    check('a folder named after the install folder is strong too',
      (matches.get('b') || []).some((f) => f.name === 'discord' && f.confidence === 'strong'),
      JSON.stringify((matches.get('b') || []).map((f) => `${f.name}:${f.confidence}`)));
    check('a folder matched only to a display name is a guess, not strong',
      (matches.get('e') || []).length === 1 && matches.get('e')[0].confidence === 'guess',
      JSON.stringify((matches.get('e') || []).map((f) => `${f.name}:${f.confidence}`)));
    check('an app with a generic uninstaller is not identified by it',
      !inventory.identifiersOf(apps[0]).strong.has('unins000'),
      [...inventory.identifiersOf(apps[0]).strong].join(', '));
  }

  console.log('\napps: the Store listing\n');

  {
    const rows = fs.readFileSync(path.join(FIXTURES, 'appx.tsv'), 'utf8');
    const packages = store.parseListing(rows);
    check('every line of the real listing became a package', packages.length >= 30, String(packages.length));
    check('a certificate subject becomes a publisher somebody could read',
      packages.every((p) => !/^CN=/.test(p.publisher)), packages[0] ? packages[0].publisher : '-');
    check('the packages Windows signed itself are marked as such',
      packages.some((p) => p.signature === 'System'), packages.filter((p) => p.signature === 'System').length + ' of ' + packages.length);
    check('an identity is turned into words', store.readableName('Microsoft.WindowsCalculator') === 'Windows Calculator',
      store.readableName('Microsoft.WindowsCalculator'));
    check('a tab-separated name with a space in it stays one field',
      packages.every((p) => !p.name.includes('\t') && p.fullName.includes('_')), 'ok');
  }

  console.log('\napps: the rows the screen is drawn from\n');

  {
    const now = Date.now();
    const model = {
      at: now,
      // Built by hand: one app of each shape the screen has to draw.
      apps: [
        {
          id: 'reg:HKLM:Big', source: 'registry', hive: 'HKLM', key: 'Big', name: 'Big App', publisher: 'Acme',
          installLocation: 'C:\\Program Files\\Big', declaredBytes: 100 * 1024 * 1024, uninstallCommand: '"C:\\Program Files\\Big\\unins.exe"',
          protection: null, dataFolders: [{ path: 'C:\\Users\\USER\\AppData\\Roaming\\Big', bytes: 5e8, confidence: 'strong', root: 'roaming' }],
          dataBytes: 5e8, measured: { bytes: 2e9, files: 1000, refused: 0 }, sharesLocationWith: 0,
          lastUsed: { at: now - 200 * DAY, source: 'userAssist', confidence: 'strong', sources: ['userAssist'] },
        },
        {
          id: 'reg:HKLM:Fresh', source: 'registry', hive: 'HKLM', key: 'Fresh', name: 'Fresh App', publisher: 'Acme',
          installLocation: 'C:\\Program Files\\Fresh', declaredBytes: 0, uninstallCommand: 'x', protection: null,
          dataFolders: [], dataBytes: 0, measured: { bytes: 1e8, files: 10, refused: 0 }, sharesLocationWith: 0,
          lastUsed: { at: now - 2 * DAY, source: 'prefetch', confidence: 'likely', sources: ['prefetch'] },
        },
        {
          id: 'reg:HKLM:Quiet', source: 'registry', hive: 'HKLM', key: 'Quiet', name: 'Never Recorded', publisher: 'Acme',
          installLocation: '', declaredBytes: 50 * 1024 * 1024, uninstallCommand: 'x', protection: null,
          dataFolders: [], dataBytes: 0, measured: null, sharesLocationWith: 0, lastUsed: null,
        },
        {
          id: 'store:Sys', source: 'store', name: 'Bio Enrollment', publisher: 'Microsoft', signature: 'System',
          installLocation: 'C:\\Windows\\SystemApps\\Bio', declaredBytes: 0, uninstallCommand: '', protection: 'systemPackage',
          dataFolders: [], dataBytes: 0, measured: { bytes: 1e7, files: 5, refused: 0 }, sharesLocationWith: 0,
          lastUsed: { at: now - 400 * DAY, source: 'userAssist', confidence: 'strong', sources: ['userAssist'] },
        },
      ],
      counts: { shown: 4, measured: 3 },
      distinctBytes: 2e9 + 1e8 + 1e7 + 5e8,
      userAssist: { available: true, entries: 10, oldestMs: now - 300 * DAY, newestMs: now - DAY },
      prefetch: null,
      storeAvailable: true,
      cancelled: false,
      durationMs: 1000,
    };

    const pro = await analyzers.collect('apps', { model, can: () => true }, { strict: true });
    check('every row validates as a candidate', pro.candidates.length === 4 && pro.summary.rejected === 0, String(pro.candidates.length));
    for (const c of pro.candidates) validateCandidate(c);

    const byName = (name) => pro.candidates.find((c) => c.meta.name === name);
    check('no app is ever safe', pro.candidates.every((c) => c.verdict !== 'safe'),
      pro.candidates.map((c) => c.verdict).join(', '));
    check('an app with an old launch record is worth a look', byName('Big App').verdict === 'review', byName('Big App').verdict);
    check('one started two days ago is not', byName('Fresh App').verdict === 'keep', byName('Fresh App').verdict);
    check('an app with no record at all is kept, not called unused',
      byName('Never Recorded').verdict === 'keep', byName('Never Recorded').verdict);
    check('and its evidence says a record is missing rather than that it went unused',
      byName('Never Recorded').evidence.some((e) => e.i18n === 'evidence.apps.noRecord'),
      byName('Never Recorded').evidence.map((e) => e.i18n).join(', '));
    check('part of Windows is protected even when its record is two years old',
      byName('Bio Enrollment').verdict === 'protected', byName('Bio Enrollment').verdict);
    check('a protected row offers nothing to do', byName('Bio Enrollment').actions.join() === 'none');
    check('and shows no uninstall command to copy', byName('Bio Enrollment').meta.uninstallCommand === '');
    check('every other row offers only a handoff',
      pro.candidates.filter((c) => !c.meta.protection).every((c) => c.actions.join() === 'handoff'));
    check('nothing here is ever part of an unattended run',
      pro.candidates.every((c) => c.unattendedEligible === false && !isAllowedUnattended(c.category)));

    check('the size a row leads with is measured plus its data folders, never the declared figure',
      byName('Big App').bytes === 2e9 + 5e8, String(byName('Big App').bytes));
    check('the declared figure is kept apart, with the installer named as its source',
      byName('Big App').meta.declaredBytes === 100 * 1024 * 1024 &&
        byName('Big App').evidence.some((e) => e.i18n === 'evidence.apps.declared'));
    check('an app with nothing to measure leads with no size at all',
      byName('Never Recorded').bytes === 0 && byName('Never Recorded').meta.measuredBytes === null);
    check('and says why rather than falling back to the declared number',
      byName('Never Recorded').evidence.some((e) => e.i18n === 'evidence.apps.noLocation'));

    check('the total is the folders measured, not the sum of the rows',
      pro.summary.totalMeasuredBytes === model.distinctBytes, String(pro.summary.totalMeasuredBytes));

    // Free keeps the list and the sizes and loses the launch dates.
    const free = await analyzers.collect('apps', { model, can: (f) => can({ state: 'free' }, f) }, { strict: true });
    check('on Free every row still has its size', free.candidates.every((c) => c.meta.measuredBytes === null || c.meta.measuredBytes > 0));
    check('on Free no row carries a launch date', free.candidates.every((c) => c.meta.lastUsed === null));
    check('and no row is called worth a look, since nothing says it is',
      free.candidates.every((c) => c.verdict !== 'review'), free.candidates.map((c) => c.verdict).join(', '));
    check('Free is told why the column is empty', free.summary.lastUsedAllowed === false);
    check('and Free still gets the count and the size totals',
      free.summary.counts.shown === 4 && free.summary.totalMeasuredBytes === model.distinctBytes,
      `${free.summary.counts.shown} apps, ${free.summary.totalMeasuredBytes} bytes`);
    check('the launch dates are the Pro feature the roadmap named',
      can({ state: 'active', tier: 'pro' }, 'pro.apps.lastused') && !can({ state: 'free' }, 'pro.apps.lastused'));
  }

  {
    // Built by hand: four entries that installed into one folder, which is
    // what Microsoft 365 does here (one per language).
    const shared = (n) => ({
      id: `reg:HKLM:M${n}`, source: 'registry', hive: 'HKLM', key: `M${n}`, name: `Office ${n}`, publisher: 'Microsoft',
      installLocation: 'C:\\Program Files\\Office', declaredBytes: 0, uninstallCommand: 'x', protection: null,
      dataFolders: [], dataBytes: 0, measured: { bytes: 4.5e9, files: 100, refused: 0 }, sharesLocationWith: 3, lastUsed: null,
    });
    const model = {
      at: Date.now(), apps: [shared(1), shared(2), shared(3), shared(4)], counts: { shown: 4, measured: 4 },
      distinctBytes: 4.5e9, userAssist: { available: true, entries: 1, oldestMs: Date.now() - 100 * DAY, newestMs: Date.now() },
      prefetch: null, storeAvailable: true, cancelled: false, durationMs: 1,
    };
    const out = await analyzers.collect('apps', { model, can: () => true }, { strict: true });
    check('(built by hand) four apps sharing one folder each show the folder’s size',
      out.candidates.every((c) => c.bytes === 4.5e9));
    check('(built by hand) but the total counts those bytes once',
      out.summary.totalMeasuredBytes === 4.5e9, String(out.summary.totalMeasuredBytes));
    check('(built by hand) and each row says it is sharing',
      out.candidates.every((c) => c.evidence.some((e) => e.i18n === 'evidence.apps.shared')));
    // The window indexes rows by id, so four rows sharing an id are one row
    // shown four times. A screenshot caught exactly that before this existed.
    check('(built by hand) four apps in one folder are still four different rows',
      new Set(out.candidates.map((c) => c.id)).size === 4,
      `${new Set(out.candidates.map((c) => c.id)).size} distinct ids for ${out.candidates.length} rows`);
    const again = await analyzers.collect('apps', { model, can: () => true }, { strict: true });
    check('(built by hand) the ids do not move between scans',
      JSON.stringify(again.candidates.map((c) => c.id)) === JSON.stringify(out.candidates.map((c) => c.id)));
  }

  console.log('\napps: last-access time is not one of the sources\n');

  {
    const files = ['src/main/apps/lastused.js', 'src/main/apps/measure.js', 'src/main/analyzers/apps.js', 'src/renderer/apps.js']
      .map((rel) => [rel, fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')]);
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const uses = files.filter(([, src]) => /\batimeMs\b|accessTimesAreTracked/.test(code(src))).map(([rel]) => rel);
    // Measured 2026-09-26: 70% of the binaries under Program Files here had
    // been read in the past week, and of 30 executables matched to a real
    // launch only 5 had a last-access time within a week of it. The screen
    // says so; the code must not quietly start using it again.
    check('no part of the Apps screen reads a file’s last-access time', uses.length === 0, uses.join(', '));
    const renderer = files.find(([rel]) => rel === 'src/renderer/apps.js')[1];
    check('and the screen says why, where somebody can read it',
      /apps\.note\.noAtime/.test(renderer));
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
