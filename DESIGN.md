# omni.Neural.IDE / OMNI-CODE — Locked Design Spec

**Install root:** `C:\Users\ThePa\.omni-neural-ide`  
**Versions:** OMNI-CODE Ultra (alive) + OMNI-CODE (plain)  
**Stack:** Go launcher + Rust core/harness + system webview (Three.js)

---

## 1. Philosophy
- This app is the **harness**. Agents are temporary workers.
- Voice assistant is a parallel helper (floating window only) that can edit open files and steer the main agent in the background.
- Always produce `plan.md`, `agents.md`, `instructions.txt`.
- Strict guardrails enforced in Rust.

## 2. Project Structure
```
.omni-neural-ide/
├── launcher/
├── core/
├── ui/
├── docs/
├── skills/
├── tools/
├── plugins/
└── settings.json
```

## 3. Agentic Loop
1. Intake
2. Requirements analysis
3. Scaffold & plan (harness only)
4. Pre-turn intervention
5. Execution turn
6. Failure handling (1 retry then pause)
7. Post-turn intervention
8. Drift check (primary + git2)
9. Review gate
10. Checkpoint
11. Context trim
12. Continue or stop

## 4. Drift Detection
- Primary: files + globs + tool allow-list
- Secondary: git2 working-tree diff
- Assistant can clear flags
- Response: warn or pause

## 5. Voice Assistant
- Floating window only
- Can edit open files, steer main agent, notes, read-only audit, slash commands
- Cannot modify system files or bypass guardrails
- Voice mode, transcription, TTS, Mute, mark-this

## 6. Neural Graph
- Full-screen organic neurons, color-coded types
- Amber particles, electrical pulses, event bus
- Per-type toggles

## 7. UI
- Explorer | Editor | Assistant
- Problems + Checkpoints panels
- Status bar, command palette, toasts
- Dark/Light themes, Ultra vs Plain

## 8. Settings
Complete control sections: Appearance, Visual Effects, Performance, Assistant, Editor, Harness, Neural Graph, MCP & Hooks, Skills, Plugins, Timers & DND, Privacy & Guardrails, Keybindings

## 9. Slash Commands
/plan /checkpoint /steer /note /audit /rollback /eval /diff /accept /reject /tools /skills /status /create-skill /create-tool

## 10. Guardrails
Path allow-list, system scan-only, confirmation for destructive actions. Enforced in Rust.

## 11. Creators
Skill and Tool creators auto-register on save.

## 12. Install
PowerShell installer → C:\Users\ThePa\.omni-neural-ide
Go launcher + later Windows installer and Vercel web version.

This is the single source of truth.
