# Windows installer (NSIS)

Builds `OMNI-CODE-Setup-1.0.0.exe` (per-user, no admin).

## Prerequisites

- `makensis` (NSIS 3.x)
- Payload with `bin/`, `ui/dist/`, `fixtures/`, `webview2/` (see `omni-code.nsi` File paths)

## Build

```bash
export NSISDIR=/path/to/nsis/windows
makensis omni-code.nsi
```
