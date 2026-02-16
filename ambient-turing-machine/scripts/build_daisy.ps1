param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$repoRootWin = Split-Path -Parent $PSScriptRoot
$bashExe  = "C:\msys64\usr\bin\bash.exe"

if (!(Test-Path $bashExe)) {
    throw "MSYS2 bash not found at $bashExe"
}

$repoRootMsys = & $bashExe -lc "cygpath -u '$repoRootWin'" | Select-Object -First 1
$repoRootMsys = $repoRootMsys.Trim()

$cmd = @"
export PATH='/usr/bin:/bin:/mingw64/bin:/c/Program Files (x86)/Arm GNU Toolchain arm-none-eabi/14.2 rel1/bin:`$PATH'
cd '$repoRootMsys'
"@

if($Clean) {
    $cmd += "`nmake clean"
}
$cmd += "`nmake -j4"

& $bashExe -lc $cmd
