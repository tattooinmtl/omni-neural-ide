import { mountGraph, nodesFrom } from "./graph.js";

const COMMANDS = [
  ["/status", "Show harness status"],
  ["/plan", "Open plan.md"],
  ["/checkpoint", "Show latest checkpoint"],
  ["/diff", "Show files touched this run"],
  ["/accept", "Accept the review gate"],
  ["/reject", "Reject and restore the run"],
  ["/steer", "Steer the main agent"],
  ["/note", "Write a note"],
  ["/audit", "Read-only audit"],
  ["/rollback", "Roll back the last run"],
  ["/eval", "Show the last result"],
  ["/tools", "List tools"],
  ["/skills", "List skills"],
  ["/create-skill", "Create a skill"],
  ["/create-tool", "Create a tool"],
];

const state = { data: null, content: "", path: null, graph: null };

const $ = (id) => document.getElementById(id);

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (body.state) render(body.state);
  if (body.content != null && body.ok) {
    state.content = body.content;
    $("code").value = body.content;
  }
  toast(body.message || (body.ok ? "ok" : "failed"), body.ok ? "" : "bad");
  if (!body.ok) speak(body.message);
  return body;
}

function toast(message, kind) {
  if (!message || message === "ok" || message === "opened") return;
  const el = document.createElement("div");
  el.className = `toast ${kind || ""}`;
  el.textContent = message.length > 180 ? `${message.slice(0, 180)}…` : message;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function render(data) {
  state.data = data;
  const settings = data.settings;
  document.body.dataset.theme = settings.theme === "light" ? "light" : "dark";
  document.body.dataset.style = settings.version_style === "plain" ? "plain" : "ultra";
  document.body.classList.toggle("graph-off", settings.neural_graph === false);
  $("style-name").textContent = settings.version_style === "plain" ? "Plain" : "Ultra";
  $("sb-theme").textContent = settings.theme === "light" ? "Light" : "Dark";
  $("sb-voice").textContent = settings.voice_mode ? (settings.muted ? "Muted" : "On") : "Off";
  $("sb-step").textContent = data.run.phase;
  $("sb-drift").textContent = data.run.drift.length ? String(data.run.drift.length) : "none";
  $("code").style.fontSize = `${settings.font_size || 13}px`;
  $("code").style.tabSize = String(settings.tab_size || 2);
  $("voice-toggle").textContent = settings.voice_mode ? "Voice On" : "Voice Off";
  $("mute").textContent = settings.muted ? "Unmute" : "Mute";
  $("accept").hidden = !data.run.awaiting_review;
  $("reject").hidden = !data.run.awaiting_review;
  $("continue").hidden = !data.run.paused;
  $("run").hidden = data.run.awaiting_review;

  const files = $("file-list");
  files.innerHTML = "";
  if (!data.files.length) {
    files.innerHTML = '<div class="empty">No project files yet. Run a goal and the harness will write plan.md.</div>';
  }
  for (const file of data.files) {
    const row = document.createElement("div");
    row.className = `file${file === data.focus ? " active" : ""}`;
    row.textContent = file;
    row.onclick = () => openFile(file);
    files.appendChild(row);
  }
  $("tab-name").textContent = data.focus || "no file";

  const problems = $("problem-list");
  problems.innerHTML = "";
  for (const problem of data.problems) {
    const row = document.createElement("div");
    row.className = `problem${problem.includes("none") ? "" : " warn"}`;
    row.textContent = problem;
    problems.appendChild(row);
  }

  const checkpoints = $("checkpoint-list");
  checkpoints.innerHTML = "";
  if (!data.checkpoints.length) {
    checkpoints.innerHTML = '<div class="empty">No checkpoints yet.</div>';
  }
  for (const checkpoint of [...data.checkpoints].reverse()) {
    const row = document.createElement("div");
    row.className = "checkpoint";
    row.textContent = `${checkpoint.status} · ${checkpoint.drift} · ${checkpoint.result || checkpoint.step}`;
    checkpoints.appendChild(row);
  }

  const transcript = $("transcript");
  const stick = transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 24;
  transcript.innerHTML = "";
  for (const line of data.assistant.lines) {
    const row = document.createElement("div");
    row.className = `line ${line.role === "you" ? "you" : "assistant"}`;
    row.textContent = line.text;
    transcript.appendChild(row);
  }
  if (stick) transcript.scrollTop = transcript.scrollHeight;

  if (state.graph && settings.neural_graph !== false && settings.version_style !== "plain") {
    state.graph.configure(settings);
    const nodes = nodesFrom(data);
    const signature = nodes.map((node) => `${node.type}:${node.label}`).join("|");
    if (signature !== state.signature) {
      state.signature = signature;
      state.graph.rebuild(nodes);
    }
    state.graph.resize();
  }
  fillSettings(settings, data);
}

async function openFile(path) {
  state.path = path;
  await api("/api/open", { method: "POST", body: JSON.stringify({ path }) });
}

async function refresh() {
  const response = await fetch("/api/state");
  render(await response.json().then((body) => body.state));
}

function speak(text) {
  const settings = state.data?.settings;
  if (!settings?.voice_mode || settings.muted || !text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function bindingMatches(event, binding) {
  if (!binding) return false;
  const parts = binding.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  const ctrl = parts.includes("ctrl");
  const shift = parts.includes("shift");
  const alt = parts.includes("alt");
  if (event.ctrlKey !== ctrl || event.shiftKey !== shift || event.altKey !== alt) return false;
  return event.key.toLowerCase() === key;
}

let recognition = null;
function setRecognition(on) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    if (on) toast("This window has no speech recognition.", "bad");
    return;
  }
  if (!recognition) {
    recognition = new Rec();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const said = event.results[event.results.length - 1][0].transcript.trim();
      if (!said) return;
      $("assist-input").value = said;
      api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "steer", text: said }) }).then((body) => speak(body.message));
    };
  }
  if (on) recognition.start();
  else recognition.stop();
}

let audioOk = false;
document.addEventListener("pointerdown", () => {
  audioOk = true;
}, { once: true });

function playBlip() {
  if (!audioOk || !state.data?.settings.sound_enabled) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 660;
  gain.gain.value = 0.03;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.04);
  setTimeout(() => ctx.close(), 200);
}

const palette = $("palette");
const paletteInput = $("palette-input");
const paletteList = $("palette-list");

function openPalette() {
  palette.style.display = "block";
  paletteInput.value = "";
  renderPalette("");
  paletteInput.focus();
}
function closePalette() {
  palette.style.display = "none";
}
function renderPalette(query) {
  const q = query.toLowerCase();
  const rows = COMMANDS.filter(([id, label]) => id.includes(q) || label.toLowerCase().includes(q));
  paletteList.innerHTML = rows.map(([id, label]) => `<div class="item" data-cmd="${id}">${id} — ${label}</div>`).join("");
}
paletteInput.addEventListener("input", () => renderPalette(paletteInput.value));
paletteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const line = paletteInput.value.trim() || paletteList.querySelector(".item")?.dataset.cmd;
    if (line) runCommand(line.startsWith("/") ? line : `/${line}`);
    closePalette();
  }
});
paletteList.addEventListener("click", (event) => {
  const item = event.target.closest(".item");
  if (!item) return;
  paletteInput.value = `${item.dataset.cmd} `;
  paletteInput.focus();
});

function runCommand(line) {
  return api("/api/command", { method: "POST", body: JSON.stringify({ line }) }).then((body) => {
    speak(body.message);
    if (line.startsWith("/plan")) openFile("plan.md");
  });
}

$("goalbar").addEventListener("submit", (event) => {
  event.preventDefault();
  const goal = $("goal").value.trim();
  if (!goal) return;
  api("/api/intake", { method: "POST", body: JSON.stringify({ goal }) }).then((body) => speak(body.message));
});
$("accept").onclick = () => api("/api/review", { method: "POST", body: JSON.stringify({ decision: "accept" }) });
$("reject").onclick = () => api("/api/review", { method: "POST", body: JSON.stringify({ decision: "reject" }) });
$("continue").onclick = () => api("/api/resume", { method: "POST", body: "{}" });
$("save").onclick = () => {
  if (!state.data?.focus) return;
  api("/api/file", {
    method: "POST",
    body: JSON.stringify({ path: state.data.focus, content: $("code").value }),
  });
};

$("assist-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("assist-input").value.trim();
  if (!text) return;
  $("assist-input").value = "";
  api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "steer", text }) }).then((body) => speak(body.message));
});
$("voice-toggle").onclick = async () => {
  const on = !state.data?.settings.voice_mode;
  const body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "voice", on }) });
  setRecognition(Boolean(body.state?.settings.voice_mode));
  speak(body.message);
};
$("mute").onclick = () => {
  const on = !state.data?.settings.muted;
  api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "mute", on }) });
};
$("audit").onclick = () => api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "audit" }) }).then((body) => speak(body.message));
$("clear-drift").onclick = () => api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "clear-drift" }) });
$("mark").onclick = () => {
  const code = $("code");
  const selected = code.value.slice(code.selectionStart, code.selectionEnd);
  api("/api/assistant", {
    method: "POST",
    body: JSON.stringify({ action: "mark", path: state.data?.focus || "", text: selected }),
  });
};

document.addEventListener("keydown", (event) => {
  const bindings = state.data?.settings.keybindings || {};
  if (bindingMatches(event, bindings.palette || "Ctrl+Shift+P")) {
    event.preventDefault();
    openPalette();
  } else if (event.key === "Escape") {
    closePalette();
    hideMenu();
    $("settings").style.display = "none";
  } else if (bindingMatches(event, bindings.accept || "Ctrl+Enter") && state.data?.run.awaiting_review) {
    event.preventDefault();
    $("accept").click();
  } else if (bindingMatches(event, bindings.run || "Ctrl+Enter") && document.activeElement !== $("assist-input")) {
    event.preventDefault();
    $("goalbar").requestSubmit();
  } else if (bindingMatches(event, bindings.reject || "Ctrl+Backspace") && state.data?.run.awaiting_review) {
    event.preventDefault();
    $("reject").click();
  }
});

const drag = $("assist-drag");
let dragAt = null;
drag.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  dragAt = { x: event.clientX, y: event.clientY, left: $("assistant").offsetLeft, top: $("assistant").offsetTop };
  drag.setPointerCapture(event.pointerId);
});
drag.addEventListener("pointermove", (event) => {
  if (!dragAt) return;
  const assistant = $("assistant");
  assistant.style.left = `${dragAt.left + event.clientX - dragAt.x}px`;
  assistant.style.top = `${dragAt.top + event.clientY - dragAt.y}px`;
  assistant.style.right = "auto";
  assistant.style.bottom = "auto";
});
drag.addEventListener("pointerup", () => {
  dragAt = null;
});

$("open-settings").onclick = () => {
  const panel = $("settings");
  panel.style.display = panel.style.display === "block" ? "none" : "block";
};

function fillSettings(settings, data) {
  const panel = $("settings");
  if (panel.dataset.ready === "1") {
    listEntries(data);
    return;
  }
  panel.dataset.ready = "1";
  panel.innerHTML = `<div class="label">SETTINGS</div>`;
  const form = document.createElement("form");
  form.innerHTML = `
    <h2>Appearance</h2>
    ${selectRow("theme", "Theme", ["dark", "light"])}
    ${selectRow("version_style", "Version", ["ultra", "plain"])}
    <h2>Visual Effects</h2>
    ${check("animation_enabled", "Animation")}
    ${check("particles", "Particles")}
    ${check("sound_enabled", "Sound")}
    <h2>Performance</h2>
    ${selectRow("performance_mode", "Mode", ["low", "balanced", "high"])}
    <h2>Assistant</h2>
    ${check("voice_mode", "Voice mode")}
    ${check("muted", "Mute")}
    <h2>Editor</h2>
    ${numberRow("font_size", "Font size", 11, 22)}
    ${numberRow("tab_size", "Tab size", 1, 8)}
    <h2>Harness</h2>
    ${selectRow("drift_response", "Drift response", ["warn", "pause"])}
    ${selectRow("intervention", "Intervention", ["pass", "hold"])}
    ${selectRow("step_size", "Step size", ["batch", "single"])}
    <h2>Neural Graph</h2>
    ${check("neural_graph", "Graph")}
    ${check("node_toggles.projects", "Projects")}
    ${check("node_toggles.files", "Files")}
    ${check("node_toggles.tools", "Tools")}
    ${check("node_toggles.skills", "Skills")}
    ${check("node_toggles.mcps", "MCPs")}
    ${check("node_toggles.hooks", "Hooks")}
    ${check("node_toggles.workers", "Workers")}
    <h2>MCP & Hooks</h2>
    <div id="hook-list"></div>
    <h2>Skills</h2>
    ${check("skills_enabled", "Skills enabled")}
    <div id="skill-list"></div>
    <h2>Plugins</h2>
    ${check("plugins_enabled", "Plugins enabled")}
    <h2>Timers & DND</h2>
    <label>Do not disturb (minutes) <input id="dnd-minutes" type="number" min="0" max="240" value="0" /></label>
    <h2>Privacy & Guardrails</h2>
    ${check("confirm_destructive", "Confirm destructive actions")}
    <p class="empty">System directories are scan-only. Writes stay in the workspace, skills, tools, and plugins. Enforced in the core.</p>
    <h2>Keybindings</h2>
    ${textRow("keybindings.palette", "Palette")}
    ${textRow("keybindings.run", "Run")}
    ${textRow("keybindings.accept", "Accept")}
    ${textRow("keybindings.reject", "Reject")}
    <button class="primary" type="submit">Save settings</button>
  `;
  panel.appendChild(form);
  applyValues(form, settings);
  listEntries(data);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = structuredClone(state.data.settings);
    readValues(form, next);
    const minutes = Number(form.querySelector("#dnd-minutes").value || 0);
    next.dnd_until = minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    panel.dataset.ready = "";
    await api("/api/settings", { method: "POST", body: JSON.stringify(next) });
    panel.dataset.ready = "";
  });
}

function selectRow(name, label, values) {
  return `<label>${label} <select name="${name}">${values.map((value) => `<option value="${value}">${value}</option>`).join("")}</select></label>`;
}
function check(name, label) {
  return `<label>${label} <input name="${name}" type="checkbox" /></label>`;
}
function numberRow(name, label, min, max) {
  return `<label>${label} <input name="${name}" type="number" min="${min}" max="${max}" /></label>`;
}
function textRow(name, label) {
  return `<label>${label} <input name="${name}" type="text" /></label>`;
}

function valueAt(object, path) {
  return path.split(".").reduce((current, key) => current?.[key], object);
}
function setAt(object, path, value) {
  const keys = path.split(".");
  let current = object;
  for (const key of keys.slice(0, -1)) current = current[key];
  current[keys.at(-1)] = value;
}
function applyValues(form, settings) {
  for (const field of form.elements) {
    if (!field.name) continue;
    const value = valueAt(settings, field.name);
    if (field.type === "checkbox") field.checked = Boolean(value);
    else if (value != null) field.value = value;
  }
}
function readValues(form, settings) {
  for (const field of form.elements) {
    if (!field.name) continue;
    if (field.type === "checkbox") setAt(settings, field.name, field.checked);
    else if (field.type === "number") setAt(settings, field.name, Number(field.value));
    else setAt(settings, field.name, field.value);
  }
}
function listEntries(data) {
  const skills = $("skill-list");
  const hooks = $("hook-list");
  if (!skills || !hooks) return;
  skills.textContent = Object.keys(data.registry.skills).join(", ") || "No skills yet. Use /create-skill.";
  hooks.textContent = Object.keys(data.registry.hooks).concat(Object.keys(data.registry.mcps)).join(", ") || "No MCP servers or hooks registered.";
}

function listen() {
  const source = new EventSource("/api/events");
  source.onmessage = (event) => {
    playBlip();
    state.graph?.pulse();
    if (event.data.includes("step_finished") || event.data.includes("drift")) refresh();
  };
}

const menu = $("context-menu");

function hideMenu() {
  menu.hidden = true;
  menu.replaceChildren();
}

function showMenu(x, y, spec) {
  menu.replaceChildren();
  const title = document.createElement("div");
  title.className = "menu-title";
  title.textContent = spec.title;
  menu.appendChild(title);
  for (const item of spec.items) {
    if (item === "-") {
      const sep = document.createElement("div");
      sep.className = "sep";
      menu.appendChild(sep);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.action = item.label;
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      hideMenu();
      item.run();
    });
    menu.appendChild(button);
  }
  menu.hidden = false;
  const pad = 8;
  const left = Math.max(pad, Math.min(x, window.innerWidth - menu.offsetWidth - pad));
  const top = Math.max(pad, Math.min(y, window.innerHeight - menu.offsetHeight - pad));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => toast("Copied"),
    () => toast("Clipboard was blocked", "bad"),
  );
}

function fieldSelection(field) {
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  return field.value.slice(start, end);
}

function cutField(field) {
  const text = fieldSelection(field);
  if (!text) {
    toast("Nothing selected");
    return;
  }
  copyText(text);
  field.setRangeText("", field.selectionStart, field.selectionEnd, "end");
  field.focus();
}

function copyField(field) {
  const text = fieldSelection(field);
  if (!text) {
    toast("Nothing selected");
    return;
  }
  copyText(text);
}

async function pasteInto(field) {
  field.focus();
  try {
    const text = await navigator.clipboard.readText();
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    field.setRangeText(text, start, end, "end");
  } catch {
    if (!document.execCommand("paste")) toast("Paste was blocked by the window", "bad");
  }
}

function editItems(field) {
  return [
    { label: "Cut", run: () => cutField(field) },
    { label: "Copy", run: () => copyField(field) },
    { label: "Paste", run: () => pasteInto(field) },
    { label: "Select all", run: () => { field.focus(); field.select(); } },
  ];
}

function openSettings() {
  $("settings").style.display = "block";
}

function itemsFor(target) {
  const file = target.closest(".file");
  if (file) {
    const path = file.textContent;
    const name = path.split(/[/\\]/).pop();
    return {
      title: "FILE",
      items: [
        { label: "Open", run: () => openFile(path) },
        { label: "Copy path", run: () => copyText(path) },
        { label: "Copy name", run: () => copyText(name) },
      ],
    };
  }
  if (target.closest("#code")) {
    return {
      title: "EDITOR",
      items: [
        ...editItems($("code")),
        "-",
        { label: "Mark this", run: () => $("mark").click() },
        { label: "Save", run: () => $("save").click() },
      ],
    };
  }
  if (target.closest("#goal")) {
    return {
      title: "GOAL",
      items: [
        ...editItems($("goal")),
        "-",
        { label: "Clear", run: () => { $("goal").value = ""; $("goal").focus(); } },
        { label: "Run", run: () => $("goalbar").requestSubmit() },
      ],
    };
  }
  if (target.closest("#goalbar") || target.closest("#tabs")) {
    const items = [{ label: "Run", run: () => $("goalbar").requestSubmit() }];
    if (!$("accept").hidden) {
      items.push(
        { label: "Accept", run: () => $("accept").click() },
        { label: "Reject", run: () => $("reject").click() },
      );
    }
    if (!$("continue").hidden) items.push({ label: "Continue", run: () => $("continue").click() });
    items.push({ label: "Save", run: () => $("save").click() }, { label: "Mark this", run: () => $("mark").click() });
    return { title: "EDITOR", items };
  }
  if (target.closest("#assist-input")) {
    return {
      title: "ASSISTANT",
      items: [
        ...editItems($("assist-input")),
        "-",
        { label: "Clear", run: () => { $("assist-input").value = ""; $("assist-input").focus(); } },
        { label: "Steer", run: () => $("assist-form").requestSubmit() },
        {
          label: "Note",
          run: () => {
            const text = $("assist-input").value.trim();
            if (!text) return;
            $("assist-input").value = "";
            api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "note", text }) });
          },
        },
      ],
    };
  }
  const line = target.closest("#transcript .line");
  if (line) {
    const text = line.textContent;
    return {
      title: "ASSISTANT",
      items: [
        { label: "Copy", run: () => copyText(text) },
        {
          label: "Steer with this",
          run: () => api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "steer", text }) }),
        },
      ],
    };
  }
  if (target.closest("#assistant")) {
    return {
      title: "ASSISTANT",
      items: [
        { label: "Voice", run: () => $("voice-toggle").click() },
        { label: "Mute", run: () => $("mute").click() },
        { label: "Audit", run: () => $("audit").click() },
        { label: "Clear drift", run: () => $("clear-drift").click() },
      ],
    };
  }
  const problem = target.closest(".problem");
  if (problem) {
    const text = problem.textContent;
    const items = [{ label: "Copy", run: () => copyText(text) }];
    if (!text.toLowerCase().includes("none")) items.push({ label: "Clear drift", run: () => $("clear-drift").click() });
    return { title: "PROBLEMS", items };
  }
  if (target.closest("#problems")) {
    return { title: "PROBLEMS", items: [{ label: "Clear drift", run: () => $("clear-drift").click() }] };
  }
  const checkpoint = target.closest(".checkpoint");
  if (checkpoint) {
    const text = checkpoint.textContent;
    return { title: "CHECKPOINTS", items: [{ label: "Copy", run: () => copyText(text) }] };
  }
  if (target.closest("#timeline")) {
    return { title: "CHECKPOINTS", items: [{ label: "Refresh", run: () => refresh() }] };
  }
  if (target.closest("#explorer")) {
    return { title: "EXPLORER", items: [{ label: "Refresh", run: () => refresh() }] };
  }
  if (target.closest("#settings")) {
    return { title: "SETTINGS", items: [{ label: "Close", run: () => { $("settings").style.display = "none"; } }] };
  }
  if (target.closest("#palette")) {
    return { title: "COMMANDS", items: [{ label: "Close", run: closePalette }] };
  }
  if (target.closest("#statusbar") || target.closest("#titlebar")) {
    return {
      title: "OMNI-CODE",
      items: [
        { label: "Command palette", run: openPalette },
        { label: "Settings", run: openSettings },
      ],
    };
  }
  return {
    title: "OMNI-CODE",
    items: [
      { label: "Command palette", run: openPalette },
      { label: "Settings", run: openSettings },
      { label: "Refresh", run: () => refresh() },
    ],
  };
}

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (event.target.closest("#context-menu")) return;
  showMenu(event.clientX, event.clientY, itemsFor(event.target));
});
document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest("#context-menu")) return;
  hideMenu();
});
document.addEventListener("scroll", hideMenu, true);
window.addEventListener("blur", hideMenu);

try {
  state.graph = mountGraph($("graph"));
  window.addEventListener("resize", () => {
    state.graph?.resize();
    hideMenu();
  });
} catch (error) {
  console.error(error);
  toast("Neural graph failed to start.", "bad");
}

refresh().catch((error) => toast(String(error), "bad"));
listen();
