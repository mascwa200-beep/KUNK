<#
    Install-FPCamera.ps1 -- puts FPCamera.dll where it belongs, and diagnoses
    the install when it isn't working.

    Run it by double-clicking Install-FPCamera.bat next to this file.

    This exists because bin\NativeMods is not somewhere a mod manager can
    reach: BG3 Mod Manager handles .pak files and load order, and a native
    plugin that hooks the renderer is outside what any version of it knows how
    to install. So this does the placing instead of you.
#>

$ErrorActionPreference = 'Stop'

function Write-Head($text) { Write-Host ""; Write-Host $text -ForegroundColor Cyan }
function Write-Good($text) { Write-Host "  [ ok ] $text" -ForegroundColor Green }
function Write-Bad($text)  { Write-Host "  [FAIL] $text" -ForegroundColor Red }
function Write-Warn($text) { Write-Host "  [warn] $text" -ForegroundColor Yellow }
function Write-Info($text) { Write-Host "         $text" -ForegroundColor Gray }

# ---------------------------------------------------------------- find BG3 --

function Get-SteamLibraries {
    $libraries = @()
    foreach ($key in @('HKLM:\SOFTWARE\WOW6432Node\Valve\Steam',
                       'HKLM:\SOFTWARE\Valve\Steam',
                       'HKCU:\SOFTWARE\Valve\Steam')) {
        try {
            $steam = (Get-ItemProperty -Path $key -ErrorAction Stop)
            $path = $steam.InstallPath
            if (-not $path) { $path = $steam.SteamPath }
            if ($path) { $libraries += $path }
        } catch { }
    }

    # Steam can put games on other drives; libraryfolders.vdf lists them.
    $extra = @()
    foreach ($library in $libraries) {
        $vdf = Join-Path $library 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            foreach ($match in ([regex]'"path"\s+"([^"]+)"').Matches((Get-Content $vdf -Raw))) {
                $extra += $match.Groups[1].Value -replace '\\\\', '\'
            }
        }
    }
    return ($libraries + $extra | Select-Object -Unique)
}

function Find-BG3 {
    $candidates = @()

    foreach ($library in (Get-SteamLibraries)) {
        $candidates += Join-Path $library 'steamapps\common\Baldurs Gate 3'
    }

    # GOG writes its own uninstall entries.
    foreach ($root in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
                        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
        try {
            Get-ChildItem $root -ErrorAction Stop | ForEach-Object {
                $entry = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
                if ($entry.DisplayName -like '*Baldur*Gate*3*' -and $entry.InstallLocation) {
                    $candidates += $entry.InstallLocation
                }
            }
        } catch { }
    }

    $candidates += @(
        'C:\Program Files (x86)\Steam\steamapps\common\Baldurs Gate 3'
        'C:\Program Files\Steam\steamapps\common\Baldurs Gate 3'
        'C:\GOG Games\Baldurs Gate 3'
        'D:\SteamLibrary\steamapps\common\Baldurs Gate 3'
    )

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'bin\bg3.exe'))) {
            return $candidate
        }
    }
    return $null
}

# ------------------------------------------------------------------- start --

Write-Host ""
Write-Host "  FPCameraMod installer" -ForegroundColor White
Write-Host "  ---------------------" -ForegroundColor White

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$dll = Join-Path $scriptDir 'FPCamera.dll'
if (-not (Test-Path $dll)) {
    $found = Get-ChildItem -Path $scriptDir -Filter 'FPCamera.dll' -Recurse -ErrorAction SilentlyContinue |
             Select-Object -First 1
    if ($found) { $dll = $found.FullName }
}

Write-Head "Locating Baldur's Gate 3"
$game = Find-BG3
if (-not $game) {
    Write-Bad "Could not find the game automatically."
    Write-Info "Paste the folder that contains 'bin' and 'Data', then press Enter."
    Write-Info "Example: C:\Program Files (x86)\Steam\steamapps\common\Baldurs Gate 3"
    $game = (Read-Host "  Game folder").Trim('"', ' ')
    if (-not (Test-Path (Join-Path $game 'bin\bg3.exe'))) {
        Write-Bad "No bin\bg3.exe there. Nothing was changed."
        Read-Host "  Press Enter to close"; exit 1
    }
}
Write-Good $game

# ------------------------------------------------- Script Extender check ----
# This is the single most common reason the mod appears to do nothing:
# bin\NativeMods is read by Script Extender, not by the game. Without SE the
# folder is inert and F1 does nothing, with no error anywhere.

Write-Head "Checking BG3 Script Extender"
$dwrite = Join-Path $game 'bin\DWrite.dll'
$seInstalled = Test-Path $dwrite
if ($seInstalled) {
    Write-Good "DWrite.dll present in bin\"
} else {
    Write-Bad "DWrite.dll is NOT in $game\bin\"
    Write-Info ""
    Write-Info "This is almost certainly why the mod did nothing."
    Write-Info ""
    Write-Info "bin\NativeMods is a Script Extender feature, not a game feature."
    Write-Info "Without Script Extender, nothing ever reads that folder, so the"
    Write-Info "DLL sits there and F1 does nothing -- with no error to see."
    Write-Info ""
    Write-Info "Get it from Norbyte's BG3 Script Extender releases, put its"
    Write-Info "DWrite.dll in:  $game\bin\"
    Write-Info "then run this installer again."
    Write-Info ""
    Write-Info "Script Extender is required by a large share of BG3 mods, so if"
    Write-Info "you use BG3MM you may well want it regardless."
}

# ------------------------------------------------------------ install DLL ---

Write-Head "Installing FPCamera.dll"
if (-not (Test-Path $dll)) {
    Write-Bad "FPCamera.dll was not found next to this installer."
    Write-Info "Keep the installer and the DLL in the same folder."
    Read-Host "  Press Enter to close"; exit 1
}

$nativeMods = Join-Path $game 'bin\NativeMods'
if (-not (Test-Path $nativeMods)) {
    New-Item -ItemType Directory -Path $nativeMods -Force | Out-Null
    Write-Good "Created bin\NativeMods\"
}

try {
    Copy-Item -Path $dll -Destination (Join-Path $nativeMods 'FPCamera.dll') -Force
    $size = (Get-Item (Join-Path $nativeMods 'FPCamera.dll')).Length
    Write-Good "Copied FPCamera.dll ($('{0:N0}' -f $size) bytes)"
} catch {
    Write-Bad "Copy failed: $($_.Exception.Message)"
    Write-Info "If the game is running, close it and try again. If the game is"
    Write-Info "under Program Files, right-click the .bat and Run as administrator."
    Read-Host "  Press Enter to close"; exit 1
}

# --------------------------------------------------------------- diagnose ---

Write-Head "Previous run"
$log = Join-Path $nativeMods 'FPCamera.log'
if (-not (Test-Path $log)) {
    if ($seInstalled) {
        Write-Info "No FPCamera.log yet -- expected if this is the first install."
    } else {
        Write-Warn "No FPCamera.log, which matches Script Extender being absent."
    }
} else {
    $text = Get-Content $log -Raw
    if ($text -match 'Could not create a dummy D3D11 device') {
        Write-Bad "The last run was in Vulkan mode."
        Write-Info "The plugin hooks the DirectX 11 swapchain; Vulkan has none."
        Write-Info "Launch bin\bg3_dx11.exe, or pick DirectX 11 when Steam asks."
    } elseif ($text -match 'FPCamera ready') {
        Write-Good "The plugin loaded successfully on the last run."
        if ($text -match 'required signature\(s\) missing') {
            Write-Info "Camera rotation, mouse look and WASD work; the viewpoint"
            Write-Info "will not drop to eye level until the build-specific"
            Write-Info "offsets are filled in. That is expected, not a fault."
        }
    } else {
        Write-Warn "FPCamera.log exists but did not reach 'ready'."
        Write-Info "Last few lines:"
        ($text -split "`r?`n" | Where-Object { $_ } | Select-Object -Last 6) |
            ForEach-Object { Write-Info "  $_" }
    }
}

# ------------------------------------------------------------------ done ----

Write-Head "Done"
if ($seInstalled) {
    Write-Host "  1. Launch bin\bg3_dx11.exe  (NOT bg3.exe -- Vulkan does nothing)" -ForegroundColor White
    Write-Host "  2. Press F1 in game" -ForegroundColor White
    Write-Host "  3. If nothing happens, press F7 and send FPCamera.selftest.log" -ForegroundColor White
    Write-Host ""
    Write-Host "  Both files land in:" -ForegroundColor Gray
    Write-Host "  $nativeMods" -ForegroundColor Gray
} else {
    Write-Host "  The DLL is in place, but it will not load until Script" -ForegroundColor Yellow
    Write-Host "  Extender is installed. See above." -ForegroundColor Yellow
}
Write-Host ""
Read-Host "  Press Enter to close"
