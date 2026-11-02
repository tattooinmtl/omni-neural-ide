# OMNI-CODE installer
# Usage:
#   irm https://raw.githubusercontent.com/tattooinmtl/omni-neural-ide/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$InstallRoot = "$env:USERPROFILE\.omni-neural-ide"
$RepoUrl = "https://github.com/tattooinmtl/omni-neural-ide.git"

Write-Host "OMNI-CODE installer" -ForegroundColor Cyan
Write-Host "Install root: $InstallRoot"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Git is required. Install from https://git-scm.com/"
}

if (Test-Path $InstallRoot) {
    Write-Host "Updating existing install..."
    Push-Location $InstallRoot
    git pull
    Pop-Location
} else {
    Write-Host "Cloning repository..."
    git clone $RepoUrl $InstallRoot
}

Write-Host "Install complete." -ForegroundColor Green
Write-Host "Folder: $InstallRoot"
