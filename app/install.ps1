# OMNI-CODE installer — Windows
# Install root locked: C:\Users\ThePa\.omni-neural-ide
$ErrorActionPreference = "Stop"
$Root = "C:\Users\ThePa\.omni-neural-ide"
$Repo = $PSScriptRoot

Write-Host "OMNI-CODE install -> $Root"

if (Test-Path $Root) {
  if (-not (Test-Path (Join-Path $Root ".git"))) {
    Write-Error "Refusing update: $Root exists but is not a git repo. Remove it or init git first."
  }
  Push-Location $Root
  git pull --ff-only
  Pop-Location
} else {
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
  if (Test-Path (Join-Path $Repo ".git")) {
    git clone $Repo $Root
  } else {
    Copy-Item -Recurse -Force "$Repo\*" $Root
    Push-Location $Root
    git init
    git add .
    git commit -m "OMNI-CODE install" | Out-Null
    Pop-Location
  }
}

New-Item -ItemType Directory -Force -Path "$Root\bin","$Root\keys","$Root\sandbox","$Root\checkpoints" | Out-Null

# Copy newest built binaries if present beside installer
foreach ($name in @("launcher.exe","omni-core.exe")) {
  $src = Join-Path $Repo "dist\$name"
  if (Test-Path $src) {
    Copy-Item -Force $src (Join-Path $Root "bin\$name")
    Write-Host "Installed $name"
  }
}

# UI assets
if (Test-Path "$Repo\ui\dist") {
  Copy-Item -Recurse -Force "$Repo\ui\dist" "$Root\ui-dist"
}

Write-Host "Done. Run: $Root\bin\launcher.exe"
Write-Host "Launcher asks Ultra vs Plain every launch and starts the freshest omni-core.exe."
