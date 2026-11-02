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

$isRepo = $false
if (Test-Path $InstallRoot) {
    Push-Location $InstallRoot
    git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -eq 0) { $isRepo = $true }
    Pop-Location
}

if ($isRepo) {
    Write-Host "Updating existing install..." -ForegroundColor Yellow
    Push-Location $InstallRoot
    git pull
    Pop-Location
} else {
    if (Test-Path $InstallRoot) {
        Write-Host "Existing folder is not a git repo. Replacing..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $InstallRoot
    }
    Write-Host "Cloning repository..." -ForegroundColor Yellow
    git clone $RepoUrl $InstallRoot
}

Write-Host "Install complete." -ForegroundColor Green
Write-Host "Folder: $InstallRoot"
