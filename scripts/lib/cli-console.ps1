param(
  [Parameter(Mandatory)] [string] $Shim,
  [Parameter(Mandatory)] [string] $Folder,
  [Parameter(Mandatory)] [string] $Dump
)
# Part of scripts/verify-cli.js. Runs in a console of its own (the harness
# starts it with Start-Process, hidden), so the command line meets a real
# console -- not the pipes a test harness is wired to -- and what landed on
# the screen is read back from the console's own buffer at the end.
#
# The question it answers is the one measured on 2026-10-01: does a person
# typing `cleandrive ...` in PowerShell or cmd get the output before the next
# prompt, and the exit code? Typed bare, CleanDrive.exe gives neither; the
# batch file is supposed to give both.

$ErrorActionPreference = 'Continue'
trap {
  [IO.File]::WriteAllText($Dump, "DRIVER ERROR: $($_ | Out-String)`n$($_.ScriptStackTrace)", [Text.Encoding]::UTF8)
  exit 1
}
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$raw = $Host.UI.RawUI
$raw.BufferSize = New-Object System.Management.Automation.Host.Size ($raw.BufferSize.Width), 3000

function Mark([string] $s) { [Console]::Out.WriteLine("=== $s") }

Mark 'A typed in PowerShell'
& $Shim version
Mark "A returned $LASTEXITCODE"

Mark 'B captured by PowerShell'
$text = (& $Shim scan $Folder --json) -join "`n"
Mark "B returned $LASTEXITCODE"
try {
  $doc = $text | ConvertFrom-Json
  Mark "B parsed schema=$($doc.schema)"
  # One folder name a line, as code points, so the check depends neither on
  # the console's font nor on a line fitting the console's width. (Not
  # `$folder`: PowerShell names are case-blind, and that is the [string]
  # parameter `$Folder`, which would turn each entry into text.)
  foreach ($top in $doc.topFolders) {
    $name = [IO.Path]::GetFileName($top.path)
    Mark ("B name " + (($name.ToCharArray() | ForEach-Object { [int]$_ }) -join ','))
  }
} catch {
  Mark "B parse failed: $($_.Exception.Message)"
}

Mark 'C a wrong command, typed in PowerShell'
& $Shim frobnicate
Mark "C returned $LASTEXITCODE"

Mark 'D through cmd'
cmd /d /c ('"' + $Shim + '" frobnicate & call echo D errorlevel=%^errorlevel%')
Mark 'D returned'

Mark 'END'
$width = $raw.BufferSize.Width
$bottom = $raw.CursorPosition.Y
$rect = New-Object System.Management.Automation.Host.Rectangle 0, 0, ($width - 1), $bottom
$cells = $raw.GetBufferContents($rect)
$sb = New-Object System.Text.StringBuilder
for ($y = 0; $y -le $bottom; $y++) {
  $line = New-Object System.Text.StringBuilder
  for ($x = 0; $x -lt $width; $x++) { $cell = $cells.GetValue($y, $x); [void]$line.Append($cell.Character) }
  [void]$sb.AppendLine($line.ToString().TrimEnd())
}
[IO.File]::WriteAllText($Dump, $sb.ToString(), [Text.Encoding]::UTF8)
