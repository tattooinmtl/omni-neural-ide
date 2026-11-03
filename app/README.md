# OMNI-CODE / OMNI-CODE Ultra

Desktop AI coding harness. **No Electron.** Go launcher → Rust core → native WebView2 UI.

## Install (Windows)

Download **OMNI-CODE-Setup-1.0.0.exe** from the GitHub Release and double-click.
No npm, cargo, or go required on the target PC.

- Install root (default): `%LOCALAPPDATA%\Programs\OMNI-CODE`
- Shortcuts: Start Menu + Desktop → **OMNI-CODE**
- Uninstall: Add/Remove Programs, or the Start Menu uninstall entry

First run: enter MiniMax + NVIDIA API keys in the launcher (stored under `keys\`, never hardcoded).

## Spec

- Layouts target the Plain / Ultra mockups in the project docs.
- Feature list: repo `BRAINSTORM.md` / confirm list.
- NSIS script: `installer/omni-code.nsi`

## Layout

```
launcher/     Go launcher (mode pick every launch + provider keys UI)
core/         Rust core (guardrails, FS, AI proxy, harness, wry window)
ui/           Vite + Monaco + Three.js assistant face
installer/    NSIS script for OMNI-CODE-Setup-*.exe
install.ps1   Optional PowerShell copy-install (dev)
dist/         Prebuilt Windows binaries + portable zip
```

## Dev — PowerShell 5.1

`&&` fails on Windows PowerShell 5.1. Use `;` or separate lines:

```powershell
cd ui
npm install
npm run build

cd ..\core
cargo run --release -- --mode ultra --ui-dir ..\ui\dist --port 8741

cd ..\launcher
go build -o ..\dist\launcher.exe .
..\dist\launcher.exe
```

## Dev — Bash / PowerShell 7

```bash
cd ui && npm install && npm run build && npm run preview
cd core && cargo run --release -- --mode ultra --ui-dir ../ui/dist --port 8741
cd launcher && go build -o ../dist/launcher.exe . && ../dist/launcher.exe
```

## Screenshots

```bash
node scripts/shot.mjs
```
