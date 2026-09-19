# Locates MakeAppx.exe in the installed Windows SDK and prints its full path.
#
# The runner images ship several Windows SDK versions, each with per-architecture
# tool folders. Prefer the folder matching the host architecture, then x64 (which
# also runs under Windows 11 ARM64 emulation), then x86, and always take the
# newest SDK version available for that architecture.
$ErrorActionPreference = 'Stop'

$roots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'),
    (Join-Path $env:ProgramFiles 'Windows Kits\10\bin')
) | Where-Object { $_ -and (Test-Path $_) }

$candidates = foreach ($root in $roots) {
    Get-ChildItem -Path $root -Recurse -Filter 'makeappx.exe' -ErrorAction SilentlyContinue
}

$hostArchitecture = switch -Wildcard ($env:PROCESSOR_ARCHITECTURE) {
    'ARM64' { 'arm64' }
    'AMD64' { 'x64' }
    'x86' { 'x86' }
    default { 'x64' }
}

$preferred = @($hostArchitecture, 'x64', 'x86') | Select-Object -Unique
$makeappx = $null
foreach ($architecture in $preferred) {
    $match = $candidates |
        Where-Object { $_.FullName -match "\\$architecture\\makeappx\.exe$" } |
        Sort-Object -Property FullName -Descending |
        Select-Object -First 1
    if ($match) { $makeappx = $match.FullName; break }
}

if (-not $makeappx) {
    throw 'MakeAppx.exe was not found in the installed Windows SDK.'
}

Write-Output $makeappx
