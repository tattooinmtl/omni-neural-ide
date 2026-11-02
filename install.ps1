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

function Test-GitRepo($path) {
    if (-not (Test-Path (Join-Path $path ".git"))) { return $false }
    return $true
}

if (Test-Path $InstallRoot) {
    if (Test-GitRepo $InstallRoot) {
        Write-Host "Updating existing install..." -ForegroundColor Yellow
        Push-Location $InstallRoot
        git pull
        Pop-Location
    } else {
        Write-Host "Folder exists but is not a git repo. Removing and recloning..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $InstallRoot
        git clone $RepoUrl $InstallRoot
    }
} else {
    Write-Host "Cloning repository..." -ForegroundColor Yellow
    git clone $RepoUrl $InstallRoot
}

Write-Host "Install complete." -ForegroundColor Green
Write-Host "Folder: $InstallRoot"
