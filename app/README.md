# OMNI-CODE / OMNI-CODE Ultra

Desktop AI coding harness. **No Electron.** Go launcher → Rust core → native/webview UI.

## Spec

- Layouts must match `/workspace/omni-spec/omni-code.jpg` (Plain) and `omni-code-ultra.jpg` (Ultra) identically.
- Feature list: see `../omni-confirm-list.md` / repo `BRAINSTORM.md`.
- Install root (Windows): `C:\Users\ThePa\.omni-neural-ide` via `install.ps1`.

## Layout

```
launcher/     Go launcher (mode pick every launch + provider keys UI)
core/         Rust core (guardrails, FS, AI proxy, harness slash cmds, serves UI)
ui/           Vite + Monaco + Three.js assistant face
assistant/    (face lives in ui/src/assistant.ts)
install.ps1   Windows installer
shots/        Screenshot verification vs mockups
```

## Dev (this box)

```bash
# UI
cd ui && npm install && npm run build && npm run preview

# Core API
cd core && cargo run --release -- --mode ultra --ui-dir ../ui/dist --port 8741

# Launcher
cd launcher && go build -o ../dist/launcher . && ../dist/launcher
```

## Screenshots

```bash
node scripts/shot.mjs
```

Writes Plain/Ultra captures to `shots/` at mockup size 1168×784.
