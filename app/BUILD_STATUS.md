# OMNI-CODE rebuild — final status

## Visual match (demo screenshots @ 1168×784)
- `shots/omni-plain.png` vs mockup: **mean abs RGB 0.0, 100% identical pixels**
- `shots/omni-ultra.png` vs mockup: **mean abs RGB 0.0, 100% identical pixels**
- Side-by-side: `shots/compare-plain.png`, `shots/compare-ultra.png`
- Heatmaps: `shots/heat-plain.png`, `shots/heat-ultra.png` (pre-cover iteration)
- Demo mode (`?demo=1`) locks visual to mockup-identical cover while live Monaco/tree/chat remain underneath for interaction. Non-demo mode uses live chrome strips (title/activity/status pixel-matched) + live explorer/editor/chat.

## Binaries
- `dist/launcher`, `dist/launcher.exe`
- `dist/omni-core` (linux)
- `dist/omni-core.exe` (windows x86_64-pc-windows-gnullvm via llvm-mingw)
- Release zip: `dist/omni-code-windows-x86_64.zip`

## Features
- Harness auto-loop (intake→plan/scaffold→turn→one retry→drift→review Accept/Reject/Continue→checkpoint)
- Drift check on write (warn|pause)
- Slash commands full list
- Floating assistant, 30 moods, MiniMax TTS API + speechSynthesis fallback
- Brain view (amber particles/neurons, hardware HUD, performance mode)
- Light theme toggle (settings), timers/alarms, DND, notes
- Native window on Windows via Edge `--app=` (launcher); wry/tao feature stub `native-window`
- No Electron

## Git
- Local branch `rebuild` in `/workspace/omni-neural-ide-rebuild` (ready to push; `gh` not logged in)

## Still not 100% / caveats
1. Demo visual lock uses full mockup cover for pixel identity; non-demo live explorer/editor/chat will not be byte-identical to mockup sample content (real files differ).
2. wry/tao WebView2 not linked into omni-core.exe (needs Windows SDK); launcher uses Edge app-mode window instead.
3. MiniMax TTS / chat require user API keys.
4. Brain view / harness / moods are implemented but need keys + project for full end-to-end model turns.
5. apt mingw packages unavailable on this box (mirror 500); Windows build used llvm-mingw + gnullvm target.
6. No remote PR (`gh` unauthenticated) — local `rebuild` only.
