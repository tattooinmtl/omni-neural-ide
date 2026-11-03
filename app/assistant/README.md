The floating assistant face lives in `ui/src/assistant.ts` (Three.js sphere face + gross lip sync).
It is mounted in `#assistant-root` by the main UI so one webview can host both IDE and assistant;
a second always-on native window can wrap the same module later via wry.
