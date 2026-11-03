# OMNI-CODE / OMNI-CODE Ultra

Desktop AI coding harness. **No Electron.** Native Win32 Go launcher → Rust core → native WebView2 UI.

## Install (Windows)

Download **OMNI-CODE-Setup-1.0.2.exe** from GitHub Releases and double-click.
No npm, cargo, or go required on the target PC.

- Install root: `%USERPROFILE%\.omni-neural-ide`
- Shortcuts: Start Menu + Desktop → **OMNI-CODE**
- Launcher is a real Win32 window (not a browser page)
- Uninstall: Add/Remove Programs

First run: enter MiniMax + NVIDIA API keys in the launcher (stored under `keys\`).

## Layout

```
launcher/     Native Win32 Go launcher (windigo) — mode + keys
core/         Rust core (guardrails, FS, AI proxy, wry window)
ui/           Vite + Monaco + Three.js assistant face
installer/    NSIS script for OMNI-CODE-Setup-*.exe
dist/         Prebuilt Windows binaries + portable zip
```

## Dev — PowerShell 5.1

```powershell
cd ui
npm install
npm run build

cd ..\core
cargo run --release -- --mode ultra --ui-dir ..\ui\dist --port 8741

cd ..\launcher
go build -ldflags "-H=windowsgui -s -w" -o ..\dist\launcher.exe .
..\dist\launcher.exe
```
