# Does starting the app again bring back a window that was closed to the tray?
#
#   npm run verify:second-instance
#
# This is the shortcut. With monitoring on, closing the window hides it and
# leaves the process running, so every later launch -- the desktop shortcut, the
# Start menu, the .exe itself -- is refused by the single-instance lock and the
# only thing that can answer is the process already running. For one release it
# answered by focusing a window that was hidden, which does nothing, and the app
# could only be reopened from the tray icon.
#
# No unit test can see this: it needs two processes, a real window and a real
# window manager. So it is checked here, by PID -- a window being on screen at
# the end proves nothing on its own, because a second process starting fresh
# would look exactly the same. What is asserted is that the window belongs to
# the process that was already running.
#
# Runs against a throwaway user-data directory and suffixed task names, so it
# cannot reach the real configuration or the real scheduled tasks.

$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $electron)) {
    Write-Output "  SKIP  electron is not installed (npm install first)"
    exit 0
}

$sandbox = Join-Path $env:TEMP ('cleandrive-second-instance-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $sandbox | Out-Null

# Monitoring on and close-to-tray on: the state the window hides in rather than
# the process ending, which is the state this whole check is about.
$settings = @{
    version = 1
    monitor = @{ enabled = $true; closeToTray = $true; intervalSeconds = 60 }
    trends  = @{ dailySample = $false; sampleTime = '12:00' }
} | ConvertTo-Json -Depth 5

# .NET writes UTF-8 without a BOM. Set-Content -Encoding utf8 in Windows
# PowerShell writes one, JSON.parse throws on it, and the app answers a corrupt
# settings file with its defaults -- monitoring off, and the window closing for
# real, which would quietly turn this into a check of nothing.
[IO.File]::WriteAllText((Join-Path $sandbox 'settings.json'), $settings)

$env:CLEANDRIVE_TASK_SUFFIX = 'secondinstance'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

function Window-Owner {
    Get-Process -Name electron -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
}

function Alive($id) {
    if (-not $id) { return $false }
    $null -ne (Get-Process -Id $id -ErrorAction SilentlyContinue)
}

$failures = 0
function Check($label, $cond, $detail) {
    if (-not $cond) { $script:failures++ }
    $mark = if ($cond) { 'PASS' } else { 'FAIL' }
    if ($detail) { Write-Output "  $mark  $label  -- $detail" } else { Write-Output "  $mark  $label" }
}

Write-Output ''
Write-Output 'second instance: the shortcut, with the window closed to the tray'
Write-Output ''

try {
    $first = Start-Process -FilePath $electron -ArgumentList @($repo, "--user-data-dir=$sandbox") -PassThru
    Start-Sleep -Seconds 15
    $opened = Window-Owner
    Check 'the app opens a window' ($null -ne $opened) $(if ($opened) { "pid $($opened.Id)" } else { 'none' })

    if ($opened) { $opened.CloseMainWindow() | Out-Null }
    Start-Sleep -Seconds 6
    $hidden = Window-Owner
    Check 'closing it leaves no window' ($null -eq $hidden)
    Check 'but the process stays alive, watching the disk' (Alive $first.Id) "pid $($first.Id)"

    Start-Process -FilePath $electron -ArgumentList @($repo, "--user-data-dir=$sandbox") | Out-Null
    Start-Sleep -Seconds 12
    $back = Window-Owner

    Check 'starting it again puts a window back on screen' ($null -ne $back) `
        $(if ($back) { "pid $($back.Id)" } else { 'none' })
    # The point of the whole check: the window is the one that was hidden, not a
    # second copy of the app that started because the first was gone.
    Check 'and it is the window of the process that was already running' `
        ($null -ne $back -and $null -ne $opened -and $back.Id -eq $opened.Id) `
        $(if ($back -and $opened) { "$($back.Id) vs $($opened.Id)" } else { 'no window' })
}
finally {
    Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    cmd /c 'schtasks /Delete /TN "\CleanDrive\AutomaticCleanup_secondinstance" /F >nul 2>&1'
    cmd /c 'schtasks /Delete /TN "\CleanDrive\DiskSample_secondinstance" /F >nul 2>&1'
    Remove-Item -Recurse -Force $sandbox -ErrorAction SilentlyContinue
}

Write-Output ''
if ($failures -eq 0) { Write-Output 'ALL PASS'; Write-Output ''; exit 0 }
Write-Output "$failures FAILURE(S)"
Write-Output ''
exit 1
