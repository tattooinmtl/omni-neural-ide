# OMNI-CODE / omni-neural-ide

Desktop AI coding harness (**no Electron**). Native Win32 Go launcher → Rust core → native WebView2 window (wry/tao).

## Install on Windows (recommended)

1. Download **[OMNI-CODE-Setup-1.0.2.exe](https://github.com/tattooinmtl/omni-neural-ide/releases/download/v1.0.2/OMNI-CODE-Setup-1.0.2.exe)** from [Releases](https://github.com/tattooinmtl/omni-neural-ide/releases/tag/v1.0.2).
2. Double-click the setup. It installs per-user (no admin) to `%USERPROFILE%\.omni-neural-ide`.
3. Open **OMNI-CODE** from the Start Menu or Desktop shortcut.
4. On first launch, paste your **MiniMax** and **NVIDIA** API keys in the **native launcher window** (not a browser), then pick Plain or Ultra.

Windows SmartScreen may warn because the installer is unsigned — click **More info → Run anyway**.

Portable zip: [omni-code-windows-x86_64.zip](https://github.com/tattooinmtl/omni-neural-ide/releases/download/v1.0.2/omni-code-windows-x86_64.zip) — extract and run `bin\launcher.exe`.

## Design notes

- [DESIGN.md](DESIGN.md) / [BRAINSTORM.md](BRAINSTORM.md)
- App sources: [`app/`](app/)

## Build from source (developers)

### PowerShell 5.1 (Windows)

`&&` is **not** valid in Windows PowerShell 5.1. Use `;` or separate lines. PowerShell 7+ supports `&&`.

```powershell
cd app\ui
npm install
npm run build

cd ..\core
cargo build --release

cd ..\launcher
go build -ldflags "-H=windowsgui -s -w" -o ..\dist\launcher.exe .
..\dist\launcher.exe
```

### Bash / PowerShell 7

```bash
cd app/ui && npm install && npm run build
cd ../core && cargo build --release
cd ../launcher && GOOS=windows GOARCH=amd64 go build -ldflags="-H=windowsgui -s -w" -o ../dist/launcher.exe .
```
