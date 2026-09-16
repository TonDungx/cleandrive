# Measures SHFileOperation batch-to-Recycle-Bin throughput against the
# per-file rate Electron's shell.trashItem achieves. Creates its own throwaway
# files in temp and purges them from the bin afterwards.

param([int]$Count = 100)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class Batch {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct SHFILEOPSTRUCT {
        public IntPtr hwnd;
        public uint wFunc;
        [MarshalAs(UnmanagedType.LPWStr)] public string pFrom;
        [MarshalAs(UnmanagedType.LPWStr)] public string pTo;
        public ushort fFlags;
        [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperation(ref SHFILEOPSTRUCT lpFileOp);

    const uint FO_DELETE = 0x0003;
    const ushort FOF_SILENT = 0x0004;
    const ushort FOF_NOCONFIRMATION = 0x0010;
    const ushort FOF_ALLOWUNDO = 0x0040;
    const ushort FOF_NOERRORUI = 0x0400;

    public static int Recycle(string[] paths) {
        var op = new SHFILEOPSTRUCT();
        op.wFunc = FO_DELETE;
        op.pFrom = string.Join("\0", paths) + "\0\0";
        op.fFlags = (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI);
        return SHFileOperation(ref op);
    }
}
'@

$dir = Join-Path $env:TEMP "cleandrive-batchbench"
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
New-Item -ItemType Directory -Path $dir | Out-Null

$paths = @()
for ($i = 0; $i -lt $Count; $i++) {
    $p = Join-Path $dir "bench-batch-$i.bin"
    Set-Content -LiteralPath $p -Value ("x" * 256) -Encoding ascii
    $paths += $p
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$rc = [Batch]::Recycle($paths)
$sw.Stop()

$ms = $sw.ElapsedMilliseconds
$rate = [math]::Round($Count / ($ms / 1000), 0)
$projected = ($ms / $Count) * 200000 / 1000
$remaining = (Get-ChildItem -LiteralPath $dir -ErrorAction SilentlyContinue | Measure-Object).Count

"SHFileOperation batch ($Count files in ONE call)"
"  return code   : $rc  (0 = success)"
"  elapsed       : $ms ms"
"  rate          : $rate files/s"
"  200k projected: $([math]::Round($projected, 1))s  ($([math]::Round($projected / 60, 1)) min)"
"  files left on disk: $remaining  (0 = all moved)"

$bin = (New-Object -ComObject Shell.Application).Namespace(0xA)
$found = @($bin.Items()) | Where-Object { $_.Name -like 'bench-batch-*' }
"  found in Recycle Bin: $($found.Count)  (recoverable)"
$found | ForEach-Object { Remove-Item -LiteralPath $_.Path -Force -Recurse -ErrorAction SilentlyContinue }
"  purged benchmark files from the bin"
Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
