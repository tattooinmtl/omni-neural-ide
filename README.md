# omni.Neural.IDE / OMNI-CODE

Harness-first AI coding environment with organic 3D neural visualization.

## Structure
- `launcher/` — Go splash, version check, updater, starts the core
- `core/` — Rust harness (guardrails, agentic loop, drift detection, tool registry, graph event bus)
- `ui/` — Three.js neural graph + editor shell (system webview)
- `docs/` — agents.md, plan.md templates
- `skills/`, `tools/`, `plugins/` — user-extensible

## Install
```powershell
irm https://raw.githubusercontent.com/tattooinmtl/omni-neural-ide/main/install.ps1 | iex
```

## Status
Initial skeleton. Design locked in DESIGN.md.
