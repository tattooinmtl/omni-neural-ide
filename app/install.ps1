# OMNI-CODE copy-install (dev / portable). Prefer OMNI-CODE-Setup-1.0.0.exe from Releases.
$ErrorActionPreference = "Stop"
if ($env:OMNI_HOME -and $env:OMNI_HOME.Trim() -ne "") {
  $Root = $env:OMNI_HOME
} elseif ($env:LOCALAPPDATA) {
  $Root = Join-Path $env:LOCALAPPDATA "Programs\OMNI-CODE"
} else {
  $Root = Join-Path $env:USERPROFILE ".omni-neural-ide"
}
$Repo = $PSScriptRoot

Write-Host "OMNI-CODE install -> $Root"
New-Item -ItemType Directory -Force -Path $Root, "$Root\bin", "$Root\keys", "$Root\sandbox", "$Root\checkpoints", "$Root\ui\dist" | Out-Null

foreach ($name in @("launcher.exe", "omni-core.exe")) {
  $src = Join-Path $Repo "dist\$name"
  if (-not (Test-Path $src)) { $src = Join-Path $Repo "bin\$name" }
  if (Test-Path $src) {
    Copy-Item -Force $src (Join-Path $Root "bin\$name")
    Write-Host "Installed $name"
  } else {
    Write-Warning "Missing $name (build or download the release zip first)"
  }
}

if (Test-Path "$Repo\ui\dist\index.html") {
  Copy-Item -Recurse -Force "$Repo\ui\dist\*" "$Root\ui\dist\"
} elseif (Test-Path "$Repo\ui\index.html") {
  Copy-Item -Recurse -Force "$Repo\ui\*" "$Root\ui\dist\"
}

Write-Host "Done. Run: $Root\bin\launcher.exe"
Write-Host "Or install OMNI-CODE-Setup-1.0.0.exe from GitHub Releases for shortcuts + WebView2 check."
