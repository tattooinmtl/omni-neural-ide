# omni.Neural.IDE / OMNI-CODE — Locked Design Spec

**Install root:** `C:\Users\ThePa\.omni-neural-ide`  
**Versions:** OMNI-CODE Ultra (alive) + OMNI-CODE (plain)  
**Stack:** Go launcher + Rust core/harness + system webview (Three.js)

---

## 1. Philosophy
- This app is the **harness**. Agents are temporary workers.
- Voice assistant is a parallel helper (floating window only) that can edit open files and steer the main agent.
- Always produce `plan.md`, `agents.md`, `instructions.txt`.
- Strict guardrails enforced in Rust.

## 2. Project Structure
```
.omni-neural-ide/
├── launcher/          # Go splash, update check, starts core
├── core/              # Rust harness, guardrails, drift, registry, event bus
├── ui/                # Three.js neural graph + editor shell
├── docs/              # agents.md, plan.md templates
├── skills/
├── tools/
├── plugins/
└── settings
```

## 3. Agentic Loop
1. Intake
2. Requirements analysis
3. Scaffold & plan (harness only)
4. Pre-turn intervention
5. Execution turn
6. Failure handling
7. Post-turn intervention
8. Drift check (primary + git2)
9. Review gate
10. Checkpoint
11. Context trim
12. Continue or stop

Full details and all locked features are in this file.
