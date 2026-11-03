# OMNI-CODE / omni-neural-ide

Desktop AI coding harness (**no Electron**). Go launcher → Rust core → native WebView2 window (wry/tao).

## Install on Windows (recommended)

1. Download **[OMNI-CODE-Setup-1.0.0.exe](https://github.com/tattooinmtl/omni-neural-ide/releases/download/v1.0/OMNI-CODE-Setup-1.0.0.exe)** from [Releases](https://github.com/tattooinmtl/omni-neural-ide/releases/tag/v1.0).
2. Double-click the setup. It installs per-user (no admin) to `%LOCALAPPDATA%\Programs\OMNI-CODE`.
3. Open **OMNI-CODE** from the Start Menu or Desktop shortcut.
4. On first launch, paste your **MiniMax** and **NVIDIA** API keys in the launcher, then pick Plain or Ultra.

Windows SmartScreen may warn because the installer is unsigned — click **More info → Run anyway**.

Portable zip (no installer): [omni-code-windows-x86_64.zip](https://github.com/tattooinmtl/omni-neural-ide/releases/download/v1.0/omni-code-windows-x86_64.zip) — extract and run `bin\launcher.exe`.

## Design notes

- [DESIGN.md](DESIGN.md) / [BRAINSTORM.md](BRAINSTORM.md) — plan from the design session
- App sources live under [`app/`](app/)

## Build from source (developers)

Prebuilt UI ships in the installer. You only need a toolchain if you change code.

### PowerShell 5.1 (Windows)

`&&` is **not** valid in Windows PowerShell 5.1. Use `;` or separate lines. PowerShell 7+ supports `&&`.

```powershell
# UI
cd app\ui
npm install
npm run build

# Core (needs Rust + Windows target toolchain)
cd ..\core
cargo build --release

# Launcher
cd ..\launcher
go build -o ..\dist\launcher.exe .
..\dist\launcher.exe
```

### Bash / PowerShell 7

```bash
cd app/ui && npm install && npm run build
cd ../core && cargo build --release
cd ../launcher && go build -o ../dist/launcher.exe .
```

### Windows installer (Linux build host)

```bash
# requires NSIS (makensis). See app/installer/omni-code.nsi
cd app/installer
makensis omni-code.nsi
```
