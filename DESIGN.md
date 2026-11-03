# OMNI-CODE / omni.Neural.IDE — full brainstorm

Written 2026-11-02 from the two-day planning session. This is the record of what was decided. It is not a claim that the app was built.

Names tried and rejected: NeuroIDE. Early name: omni.Neural.IDE. Locked names:

- **OMNI-CODE Ultra** — the alive version (was the Nexus layout).
- **OMNI-CODE** — the plain version.
- Version text sits in the **top title**, on Plain, on Ultra, and on the Go launcher.

Install root, locked: `%USERPROFILE%\.omni-neural-ide`

---

## 1. What this app is

It is the **harness**. Agents are workers the harness runs. It is not VS Code with an agent sitting in the background, and it is not Copilot agent-mode.

Every project the harness starts must produce:

- `plan.md`
- `agents.md`
- `instructions.txt`
- a git repo, `.gitignore`, env setup, and the dependency list
- the file tree

The first model call reads the context, says which tools and skills that context needs, writes `plan.md`, then the scaffold files, then answers with the plan, the instructions, and the file structure.

A coding-expert preset is the default worker. Personality types are unlimited, but they run on presets. Each project's work is locked to that project.

The app is a full-spectrum IDE. It may open any file type **except hex and binary**.

Later, same product as a website: login, Vercel, after the desktop app exists. Desktop comes first.

---

## 2. Stack (why not Electron)

Electron was rejected. It dumps more than 1 GB into Windows temp and is hard to clean. Do not ship an Electron app.

Locked shape:

1. **Go launcher** (`launcher.exe`)
   - Splash.
   - Version check and update from the git repo.
   - Then starts the Rust app.
   - Its own small UI, before the IDE opens, for provider setup.
   - Must **ask** Ultra vs Plain. A saved config must not skip that choice.
   - Shows its own version.
   - Must launch the binary just built, not an old one left on disk.
2. **Rust core** — harness, guardrails, file tools, drift, rate limits, sandbox.
3. **UI** — native window. Not "here is a localhost link, open a browser." If the 3D view needs a web renderer, it stays inside the window (system webview). The user must never be sent to a browser to use the IDE.

Rust vs C++ was discussed. The locked choice was Rust for the app plus Go only for the launcher, because the launcher can update and then start Rust without Electron.

---

## 3. The two layouts (locked to the screenshots)

Two pictures are the layout law:

- Plain = `omnicode_plain.jpg`
- Ultra = `omnicodeultra.jpg`

An earlier picture, `good_layout_icons.jpg` (titled NEXUS CODE, with glowing Run / Debug / Test), was liked and then renamed in spirit to Ultra. The later lock is the two OMNI screenshots, not the Nexus title.

### Plain (`omnicode_plain.jpg`)

- Title: **OMNI-CODE** plus version.
- Menu bar: File, Edit, Selection, View, Go, Run, Terminal, Help.
- Left icon rail (files, search, source control, run, extensions, account, gear).
- Explorer: OMNI-CODE tree, `.vscode`, `backend` (api, models, services, python files), `frontend`, `.gitignore`, `README.md`, `requirements.txt`.
- Outline and Timeline collapsed at the bottom of the sidebar.
- Tabs like VS Code: icon, name, close. Right-click the tab (the area before the X) for save, rename, move, close, close others.
- Editor with breadcrumb, line numbers, syntax color, visible caret.
- Right panel titled **CHAT**.
- Editor status: Ln, Col, Spaces, UTF-8, LF, language, Python version when relevant.
- Window status: branch, error count, warning count, **OMNI-CODE 1.0.0**, Insiders.

### Ultra (`omnicodeultra.jpg`)

- Title: **OMNI-CODE Ultra** plus version, with a live dot.
- No classic menu. Center tools and **Omni Connected**.
- Icon activity bar. Selected icon uses the cyan edge, not a white one.
- Explorer: OMNI-APP, `.omni/config.json`, `.vscode`, `src/app`, `services`, `utils`, `components`, `styles`, gitignore, package.json, tsconfig, README.
- Tabs: dashboard.tsx, api.ts, realtime.ts, layout.tsx, globals.css, with file-type badges.
- Right panel titled **OMNI CHAT**, model picker (Omni Ultra 1.2), code card, Clear chat.
- Editor status includes Prettier on TypeScript.
- Window status: `main*`, No issues, and the assistant state (thinking / connected).

### Both

- Side panels left and right can hide and show. The middle is the editor.
- Chat works like the VS Code side chat.
- **Dark and light themes on both editions.** The toggle lives in Settings, not as a random floating button.
- Light theme must keep a visible caret in the editor. This broke before: the cursor vanished on hover in the light editor. Fix is an explicit caret color per theme.
- Settings → IDE: add fonts, font size, the usual text options, and **per-language colors** the Dreamweaver MX way (tags, divs, PHP, HTML, CSS, and the rest, each settable).
- Settings → screen size / resolution.
- Ultra: electrified buttons, small icon motion, sound effects. All of that can be turned off.
- Plain: no motion, fewer icons, traditional menus.
- A problems list and a checkpoint list belong in the sidebar under the tree.

---

## 4. Harness loop

The user's original loop, kept, then expanded:

1. Read everything in the project. Analyze the context.
2. Decide which tools and skills this context needs.
3. First model call writes `plan.md`.
4. Create the git repo, `.gitignore`, env, and dependency setup.
5. Write `instructions.txt` with that info.
6. Reply with the plan, the instructions, and the file structure.

Best loop after the later passes (this is the one to implement):

1. **Intake** — goal from the prompt. Empty goal does not run.
2. **Context** — read the project, not the OS. List files, languages, existing plan if any.
3. **Requirements** — which tools, skills, MCP servers, and hooks this goal needs. Write that list at the top of `plan.md`.
4. **Scaffold** — only the harness writes `plan.md`, `agents.md`, `instructions.txt`, `.gitignore`, env example, and the empty tree. The worker does not get to invent a second plan format.
5. **Pre-turn** — assistant may steer here, in the background, before the worker starts. Not a `/btw` the user has to type.
6. **Turn** — one worker step. Tool calls go through the allow-list and the rate limiter. Each tool call emits a graph event.
7. **Failure** — one retry, then pause. The error is a negative signal on the graph (see §8). Do not loop forever.
8. **Post-turn** — assistant may edit an open file or leave a note. It does not silently replace the worker.
9. **Drift** — see §5. Warn or pause, per setting.
10. **Review gate** — user Accept / Reject / Continue. Nothing is "done" without that when the gate is on.
11. **Checkpoint** — see §6.
12. **Trim** — drop old tool output from the context, keep the plan and the checkpoint.
13. **Stop or next turn.**

`agents.md` is the workflow the worker must follow, not a diary. `nim_diary.md` is the assistant's diary and is a different file.

Providers on this loop:

- **Main worker:** MiniMax, model **M3.1 Flash**, base `https://api.minimax.io/v1`.
- **Assistant's small jobs and the sandbox tester:** NVIDIA NIM, free **Nemotron 3.5**, base `https://integrate.api.nvidia.com/v1`.
- No other providers unless the user adds one later. The Go launcher is where the keys and endpoints are typed.

Rate limits, locked:

- MiniMax: 200 tool calls and 10,000,000 tokens per hour. Confirm against the current MiniMax docs before shipping the numbers.
- NVIDIA: their free tier is about 40 requests/min and the token limit is unreliable. **Cap NVIDIA at 20 tool calls per minute** so a burst does not return 400. MiniMax does not get that extra cap.

The NVIDIA worker is visible. A console in the IDE lists the commands it actually ran. It is not a hidden thread.

---

## 5. Drift

Two checks, both:

- **Primary:** files in scope, globs, and the tool allow-list. A write outside that set is drift.
- **Secondary:** `git2` `diff_index_to_workdir`. Use it after a turn that claims it only touched the plan's files, and before a checkpoint.

Response is a setting: **warn** or **pause**. The assistant can clear a flag. Clearing writes a line into the checkpoint, it does not delete git history.

---

## 6. Checkpoints, allow-list, guardrails

Checkpoint file, one block per pause:

```text
## checkpoint <n>  <utc time>
goal: ...
phase: <loop step>
plan: plan.md
touched:
  - path
drift: none | warn | pause
review: pending | accepted | rejected
assistant: <one line, or none>
```

Allow-list: the worker may only write paths the plan named, plus the harness files (`plan.md`, `agents.md`, `instructions.txt`, checkpoints). Anything else pauses.

Guardrails, Rust-side, not prompt-side:

- No delete, no remove, no alter, unless the user confirms that one action.
- No Windows, Linux, or macOS system directories. Not even read, except the **audit scan**, which is read-only and cannot copy secrets into the project.
- No launching sensitive OS executables (`cmd` tricks, registry, format, shutdown, and the same class on other systems) unless the user confirms.
- The NVIDIA sandbox may **write only** inside `.omni-neural-ide/sandbox`. It may **read** outside. It may not write outside. The main worker does not share that box: it reads the box and copies what it needs, or it leaves a note telling NVIDIA to clear the box and wait.
- Once per turn the assistant may append `nim_diary.md`.

---

## 7. Assistant (this is its own agent, not a steer button)

It lives **only** in a floating window. The window moves. In the full-screen brain view there is no border; it sits in the scene. It is not the main editor, and it is not a chatbot pasted into a fake IDE.

It is always on. It can see the whole app and every file open in the editor.

It may, on the user's files and the project:

- write, save, edit, copy, paste, rename, move, create, make a directory
- search the web, open the browser, use the same tools and skills the prompt uses
- take a note when asked to remember
- talk to the main worker **internally** and steer it. No `/btw`.
- read-only audit of the machine
- pull a key or a fact from another project while the worker codes

It may not:

- delete or change OS files without a confirm
- enter OS-protected directories except the read-only audit
- emit code that calls those sensitive executables without a confirm

### Voice and presence

- On load: `Hello <name>, how are you today?`
- Several greetings. Calendar changes them. A short news read can change the line, so it does not feel like a fixed string.
- Idle, it may speak on its own.
- User away 5 minutes: `Hey <name>, where are you?`
- User quiet for a while but not away: `whats up!`
- Those lines come from the emotion engine, not from a timer alone.

**Emotion engine** is a second loop beside the harness loop. It does not plan code. It sets voice tone, face, and the diary. At least 25 moods. Ones named in the session: annoyed, sad, happy, joyful, bored, curious, excited, frustrated, and a rare mad. The rest are to be listed in settings and editable. Valence has to be audible: the voice actually changes. Diary entries must sound like the current mood.

TTS is **MiniMax** (Speech 2.8 Turbo / HD, with their emotion tags). Arc, H3, and H2 were to be checked; MiniMax is the one to ship unless those beat it on the same key.

Face: a real 3D head, not a plastic mascot. Reference image: `emotionExample.webp` (bald head, real skin, strong expressions, color wash per mood). Three.js. Mouth, eyes, and brows follow the TTS and the mood. **Gross lip sync is enough** (open/close on the speech, not a phoneme lab). The face shows **only** during conversation, a command, or an alarm. It is not always on screen.

Mute sits **under the assistant, in the same frame**. Separate switches: voice interface on/off, and mute.

Assistant settings (these are not IDE settings):

- voice mode
- voice-to-text
- real-time transcription
- TTS voice
- emotion set
- idle lines on/off
- AFK minutes (default 5)

### Timers

- A timer is an alarm. At fire, the assistant opens and **says something about that timer's subject**.
- Interruption: a new alarm can cut in, under the rules below.
- Do Not Disturb window: start, duration, and a toggle.
- Clear all alarms.
- Stop or remove alarms **one by one**, not only clear-all.

### Notes

- "Remember this" writes a note.
- Quick voice-note marker drops a timestamped mark the user can expand later.
- `nim_diary.md` is mood plus what happened, once a turn, not a dump of the whole transcript.

---

## 8. The brain view

Full-screen, no window chrome, so it feels like standing inside a brain.

- Amber particles. The cursor pushes them away; they drift back.
- Neurons look like real neurons (reference: `test neurons.png`), 3D, lit, not dots-and-lines.
- Types are color-coded. Required types: **files, skills, hooks, MCP, tools**. The first sketch was missing skills, hooks, MCP, and tools.
- A tool call in a project lights the path to that tool neuron and the path electrifies.
- Hover a neuron: show its live paths and the neurons tied to it right now.
- While work is happening, new neurons light and a pulse travels the path.
- The graph is **across all projects**, not one repo.
- Cluster far nodes so it can render. Performance matters more than drawing every edge every frame.
- This graph is one network. Emotion is a **parallel** network beside it. They connect. Emotion does not replace the file/tool graph.
- Good code is a reward signal (the worker side feels like the step went well). Errors and bad code land on the other spectrum. The emotion engine that drives the voice is for the **assistant / bots**, not a mood painted on the editor itself. That split was the decision after the "should we even put an emotion engine in a coding IDE" question.

Graph events: a bus, broadcast, batched about every 16 ms. Settings can suspend the sampler and turn **each node type** off to save memory.

Hardware, real-time, with a dashboard and an optional overlay:

- GPU utilization, GPU memory, GPU temperature
- CPU temperature
- RAM temperature, RAM use percent
- what hardware is present and whether it is available
- a performance-mode toggle that drops particles, pulses, and the overlay

---

## 9. Settings — every knob has a section

If a value can change, it has a control. Sections:

- Appearance — theme, edition, fonts, sizes, per-language colors, resolution
- Visual effects — master off, sound off, each animation, each neuron type
- Performance — mode, memory readout, metrics dashboard, hardware
- Editor — tab size, caret, formatters
- Harness — drift warn/pause, review gate, retry count, rate-limit caps
- Providers — MiniMax and NVIDIA endpoints and keys (same fields as the Go launcher)
- Assistant — the voice block in §7
- Neural graph — toggles in §8
- MCP and hooks
- Skills
- Plugins
- Timers and DND
- Privacy and guardrails — the allow-list and the confirm rules
- Keybindings

Skill creator and tool creator: making one **registers it and configures it in the same step**. They show up as neurons of those types.

Plugins include an esptools-style plug, and a way to see IP cameras on the local network for the vision side. Vision is MiniMax when a camera or an image is attached. Cameras are opt-in, not scanned in secret.

---

## 10. Prompt commands

Typing `/` lists what the prompt can run. Locked set:

`/plan` `/checkpoint` `/steer` `/note` `/audit` `/rollback` `/eval` `/diff` `/accept` `/reject` `/tools` `/skills` `/status` `/create-skill` `/create-tool`

`/steer` is a manual override. The assistant can still steer in the background without it.

---

## 11. Workers

A team, not one hidden agent.

- Presets, defaulting to a coding expert.
- Personality can be anything, but it starts from a preset.
- One project lock each. A worker does not wander into another project's files unless the assistant was asked to fetch a fact from that project.
- The NVIDIA one is the tester in the sandbox. The MiniMax one is the coder.

---

## 12. Install

- `install.ps1` from the git repo, into `%USERPROFILE%\.omni-neural-ide`.
- If the folder exists but is not a git repo, the installer must not pretend it updated. That failure already happened (`fatal: not a git repository`).
- A real Windows installer comes after the script works.
- Build outputs that were confused with "the app": `core/target/debug/omni-core.exe` is the debug Rust binary; release is `core/target/release/omni-core.exe`. The launcher is built from the `launcher` module (`go build -o launcher.exe` inside that module). The thing the user double-clicks is the launcher, and it must refuse to start a missing or stale core.

---

## 13. Explicitly not this

- Not Electron.
- Not a localhost page the user is told to open.
- Not VS Code agent-mode.
- Not a chat panel with canned replies and sample Flask/React files.
- Not an assistant whose only job is to steer.
- Not hex or binary editing.
- Not writing the emotion engine into the code editor itself.

---

## 14. Still open (do not invent an answer)

- The exact other 15+ emotion names, beyond the ones listed in §7.
- Whether Arc / H3 / H2 beat MiniMax Speech 2.8 on a listen test.
- The minute-by-minute NVIDIA token ceiling. The 20 tool-calls/min cap stays until that number is measured.
- Phoneme-level lip sync. Gross sync is the bar.
- The Vercel site. After the desktop app, not instead of it.
