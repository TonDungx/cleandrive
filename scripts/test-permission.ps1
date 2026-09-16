# Sets up files with real Windows ACLs, then checks planTrash classifies each
# correctly WITHOUT triggering the shell's "administrator permission" prompt.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-permission.ps1

$dir = Join-Path $env:TEMP "cleandrive-perm-test"
$me = "$env:USERDOMAIN\$env:USERNAME"

function Cleanup {
    if (-not (Test-Path $dir)) { return }
    Get-ChildItem -LiteralPath $dir -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        # ACL first: clearing the read-only attribute on a file whose ACL denies
        # write is itself denied.
        icacls $_.FullName /remove:d "$me" 2>$null | Out-Null
        icacls $_.FullName /grant "${me}:(F)" 2>$null | Out-Null
        Set-ItemProperty -LiteralPath $_.FullName -Name IsReadOnly -Value $false -ErrorAction SilentlyContinue
    }
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}

Cleanup
New-Item -ItemType Directory -Path $dir | Out-Null

$normal   = Join-Path $dir "normal.bin"
$denied   = Join-Path $dir "needs-admin.bin"
$readonly = Join-Path $dir "readonly.bin"
foreach ($f in @($normal, $denied, $readonly)) { Set-Content -LiteralPath $f -Value ("x" * 1024) -Encoding ascii }

# The ACL shape an installed program's files have: readable, not writable or deletable.
icacls $denied /inheritance:r /grant "${me}:(R)" /deny "${me}:(D,WDAC,WO,W)" | Out-Null
Set-ItemProperty -LiteralPath $readonly -Name IsReadOnly -Value $true

node -e @"
const { planTrash } = require('D:/personal_projects/cleandrive/src/main/lib/trash');
const path = require('path');
const files = process.argv.slice(1);

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  -- ' + detail : ''));
};

(async () => {
  const started = Date.now();
  const planned = await planTrash(files);
  const elapsed = Date.now() - started;

  const inPlan = planned.plan.map(p => path.basename(p.path)).sort();
  const admin  = planned.needsAdmin.map(f => path.basename(f.path));

  console.log('  plan      : ' + inPlan.join(', '));
  console.log('  needsAdmin: ' + (admin.join(', ') || '(none)'));
  console.log('  elapsed   : ' + elapsed + ' ms   <- a prompt would have blocked here');
  console.log('');

  check('the ACL-denied file is detected up front', admin.includes('needs-admin.bin'), admin.join(','));
  check('it is kept out of the delete plan', !inPlan.includes('needs-admin.bin'));
  check('a normal file still goes in the plan', inPlan.includes('normal.bin'));
  check('a read-only file is NOT mistaken for needing admin', !admin.includes('readonly.bin'));
  check('the read-only file stays deletable', inPlan.includes('readonly.bin'));
  check('the estimate covers only what will really run', planned.plan.length === 2, String(planned.plan.length));
  check('no prompt appeared (completed immediately)', elapsed < 3000, elapsed + ' ms');

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})();
"@ $normal $denied $readonly

$code = $LASTEXITCODE
Cleanup
exit $code
