<#
  Box Dispatch setup for the main PC (Windows 10/11, 64-bit). Run it via setup.bat or update.bat (as administrator).
  Safe to run again: anything already in place is skipped. Your data (backend\data.db) is never touched.

  What it does:
    1. Installs Python 3.12.10 and Node.js 22.23.3 LTS if missing (official installers, checksum-verified)
    2. Creates backend\.venv and installs the exact Python packages (backend\requirements.txt)
    3. Installs the exact website packages (frontend\package-lock.json) and builds the website
    4. Downloads the Android app (APK) from the latest GitHub release
    5. Opens port 8015 in Windows Firewall for phones/PCs on the shop network
    6. Puts a "Box Dispatch" shortcut on the desktop

  -NoSystemChanges : only steps 2-4 (no installers, firewall or shortcut; no admin needed)
#>
param([switch]$NoSystemChanges)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster on PowerShell 5.1
# Older Windows 10 builds don't enable TLS 1.2 by default; python.org / nodejs.org / GitHub require it.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Start-Transcript -Path (Join-Path $Root 'setup-log.txt') | Out-Null   # a copy of everything shown, for troubleshooting

# ---- Pinned versions (change together with a tested setup) ----
$PyVersion  = '3.12.10'   # last Python 3.12 release with a Windows installer
$PyUrl      = "https://www.python.org/ftp/python/$PyVersion/python-$PyVersion-amd64.exe"
$PySha256   = '67B5635E80EA51072B87941312D00EC8927C4DB9BA18938F7AD2D27B328B95FB'
$NodeVersion = '22.23.3'  # Node.js 22 LTS ("Jod")
$NodeUrl    = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-x64.msi"
$NodeSha256 = '1C0EFC8449987E7DA5D184786A0A96DA83FFA11D334421201E5C09B93017CB8D'
$Repo       = 'subbu-h21/box-management'
$Port       = 8015   # must match PORT in start.bat

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   $text" -ForegroundColor Yellow }

function Get-File($url, $out, $sha256) {
  Write-Host "   Downloading $url"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out
  if ($sha256) {
    $actual = (Get-FileHash -Path $out -Algorithm SHA256).Hash
    if ($actual -ne $sha256) {
      Remove-Item $out -Force
      throw "Checksum mismatch for $url (download corrupted or tampered with). Try again."
    }
  }
}

function Invoke-Checked($exe, [string[]]$arguments, $what) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

function Add-ToPath($dir) { $env:Path = "$dir;$env:Path" }   # first, so it wins over any older copy

# ----------------------------------------------------------------------------------------------
Step 'Checking Windows'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Box Dispatch needs 64-bit Windows.' }
$os = Get-CimInstance Win32_OperatingSystem
Ok "$($os.Caption) (build $($os.BuildNumber))"
if (-not $NoSystemChanges) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw 'Run setup.bat (it asks for administrator rights), not this script directly.' }
}

# ---- Python 3.12 -------------------------------------------------------------------------------
Step "Python $PyVersion"
function Find-Python312 {
  $candidates = @(
    "$env:ProgramFiles\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    # Windows PowerShell treats a native program's error output as an error when it is redirected.
    $ErrorActionPreference = 'Continue'
    $exe = & $py.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null
    if ($LASTEXITCODE -eq 0 -and $exe -and (Test-Path $exe)) { return $exe }
  }
  return $null
}
$Python = Find-Python312
if (-not $Python) {
  if ($NoSystemChanges) { throw 'Python 3.12 is not installed (run setup.bat without -NoSystemChanges).' }
  $installer = Join-Path $env:TEMP "python-$PyVersion-amd64.exe"
  Get-File $PyUrl $installer $PySha256
  Write-Host '   Installing Python (takes a minute)...'
  $p = Start-Process -FilePath $installer -Wait -PassThru -ArgumentList @(
    '/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_launcher=1', 'Include_test=0', 'Shortcuts=0')
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "Python installer failed (exit code $($p.ExitCode))" }
  Remove-Item $installer -Force -ErrorAction SilentlyContinue
  $Python = Find-Python312
  if (-not $Python) { throw 'Python was installed but could not be found.' }
}
Ok "Using $Python ($(& $Python --version))"

# ---- Node.js -----------------------------------------------------------------------------------
Step "Node.js (website build)"
function Test-NodeOk($exe) {
  # The website build tool (Vite 8) needs Node ^20.19 or >= 22.12.
  $v = (& $exe --version) -replace '^v', ''
  $parts = $v.Split('.') | ForEach-Object { [int]$_ }
  if ($parts[0] -ge 23) { return $true }
  if ($parts[0] -eq 22) { return $parts[1] -ge 12 }
  if ($parts[0] -eq 20) { return $parts[1] -ge 19 }
  return $false
}
$Node = $null
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCmd -and (Test-NodeOk $nodeCmd.Source)) { $Node = $nodeCmd.Source }
elseif (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
  if (Test-NodeOk "$env:ProgramFiles\nodejs\node.exe") { $Node = "$env:ProgramFiles\nodejs\node.exe" }
}
if (-not $Node) {
  if ($NoSystemChanges) { throw 'A suitable Node.js is not installed (run setup.bat without -NoSystemChanges).' }
  $msi = Join-Path $env:TEMP "node-v$NodeVersion-x64.msi"
  Get-File $NodeUrl $msi $NodeSha256
  Write-Host '   Installing Node.js (takes a minute)...'
  $p = Start-Process -FilePath 'msiexec.exe' -Wait -PassThru -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart')
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "Node.js installer failed (exit code $($p.ExitCode))" }
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
  $Node = "$env:ProgramFiles\nodejs\node.exe"
  if (-not (Test-Path $Node)) { throw 'Node.js was installed but could not be found.' }
}
$NodeDir = Split-Path -Parent $Node
Add-ToPath $NodeDir   # this window doesn't see PATH changes made by the installer
$Npm = Join-Path $NodeDir 'npm.cmd'
Ok "Using Node $(& $Node --version) at $NodeDir"

# ---- Backend packages --------------------------------------------------------------------------
Step 'Python packages (backend)'
$Venv = Join-Path $Root 'backend\.venv'
$VenvPy = Join-Path $Venv 'Scripts\python.exe'
$cfg = Join-Path $Venv 'pyvenv.cfg'
if ((Test-Path $cfg) -and -not (Select-String -Path $cfg -Pattern "version(_info)?\s*=\s*3\.12\." -Quiet)) {
  Warn 'Existing backend\.venv is not Python 3.12: recreating it.'
  Remove-Item $Venv -Recurse -Force
}
if (-not (Test-Path $VenvPy)) {
  Invoke-Checked $Python @('-m', 'venv', $Venv) 'Creating the Python environment'
}
Invoke-Checked $VenvPy @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-q',
  '-r', (Join-Path $Root 'backend\requirements.txt')) 'Installing Python packages'
Ok 'Python packages installed (exact versions from requirements.txt)'

# ---- Website -----------------------------------------------------------------------------------
Step 'Website packages and build'
Push-Location (Join-Path $Root 'frontend')
try {
  Invoke-Checked $Npm @('ci', '--no-audit', '--no-fund', '--loglevel=error') 'Installing website packages'
  Invoke-Checked $Npm @('run', 'build', '--silent') 'Building the website'
} finally { Pop-Location }
Ok 'Website built (exact versions from package-lock.json)'

# ---- Android app -------------------------------------------------------------------------------
Step 'Android app (APK) from GitHub'
$dl = Join-Path $Root 'downloads'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
$apk = Join-Path $dl 'box-dispatch.apk'
$json = Join-Path $dl 'box-dispatch.json'
try {
  $latest = Invoke-RestMethod -UseBasicParsing -Uri "https://github.com/$Repo/releases/latest/download/box-dispatch.json"
  $current = if ((Test-Path $apk) -and (Test-Path $json)) { Get-Content $json -Raw | ConvertFrom-Json } else { $null }
  if ($current -and $current.versionCode -eq $latest.versionCode) {
    Ok "Android app version $($latest.version) is already here"
  } else {
    Get-File "https://github.com/$Repo/releases/latest/download/box-dispatch.apk" "$apk.part" $null
    Move-Item -Force "$apk.part" $apk
    $latest | ConvertTo-Json | Set-Content -Path $json -Encoding ASCII
    Ok "Android app version $($latest.version) ready for download from the website"
  }
} catch {
  Remove-Item "$apk.part" -Force -ErrorAction SilentlyContinue
  Warn "Could not download the Android app ($($_.Exception.Message))."
  Warn 'The website works without it; run setup.bat (or update.bat) again later to get the app.'
}

# ---- Other files the app needs -----------------------------------------------------------------
Step 'Printing tools'
if (Test-Path (Join-Path $Root 'tools\SumatraPDF.exe')) { Ok 'SumatraPDF found' } else { Warn 'tools\SumatraPDF.exe is missing: printing will not work.' }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Ok 'Microsoft Edge found' } else { Warn 'Microsoft Edge not found: printing will not work until Edge is installed.' }

if (-not $NoSystemChanges) {
  # ---- Firewall --------------------------------------------------------------------------------
  Step "Network access (port $Port)"
  # The rule covers every network type (Public, Private, Domain), so the network's own Public/Private
  # setting is left alone: other software on this PC may depend on it. Recreated each run so the port
  # stays up to date.
  Get-NetFirewallRule -DisplayName 'Box Dispatch' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'Box Dispatch' -Direction Inbound -Protocol TCP -LocalPort $Port `
    -Action Allow -Profile Any | Out-Null
  Ok "Firewall: port $Port allowed for phones and computers on the shop network"
  # Another program already using the port would stop Box Dispatch from starting.
  foreach ($c in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -ne 'python') {
      Warn "Port $Port is already used by '$($proc.ProcessName)'. Box Dispatch cannot start until that program"
      Warn "stops using it, or the port is changed (PORT in start.bat and `$Port in scripts\setup.ps1)."
    }
  }

  # ---- Desktop shortcut ------------------------------------------------------------------------
  Step 'Desktop shortcut'
  $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')   # visible to every user of this PC
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut((Join-Path $desktop 'Box Dispatch.lnk'))
  $lnk.TargetPath = Join-Path $Root 'start.bat'
  $lnk.WorkingDirectory = $Root
  $lnk.Description = 'Start the Box Dispatch server and print agent'
  $lnk.Save()
  Ok "Shortcut created: $desktop\Box Dispatch.lnk"
}

# ---- Done --------------------------------------------------------------------------------------
Step 'Done'
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Ok "Start the app with the 'Box Dispatch' desktop shortcut (or start.bat), then open http://localhost:$Port"
Ok 'The first time, the website asks you to create the admin account.'
if ($ips) { Ok ("Phones on the shop Wi-Fi use: " + (($ips | ForEach-Object { "${_}:$Port" }) -join '  or  ')) }
