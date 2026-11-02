import { mountFace } from "./face.js";

const state = { data: null, focus: null, nimLog: [], face: null };
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (body.state) render(body.state);
  if (body.content != null && body.ok) {
    $("code").value = body.content;
  }
  return body;
}

function render(data) {
  state.data = data;
  const s = data.settings || {};
  document.body.dataset.theme = s.theme === "light" ? "light" : "dark";
  document.body.dataset.style = s.version_style === "plain" ? "plain" : "ultra";
  $("app-title").textContent = s.version_style === "plain" ? "OMNI-CODE" : "OMNI-CODE Ultra";
  $("style-name").textContent = s.version_style === "plain" ? "Plain" : "Ultra";
  $("sb-theme").textContent = s.theme === "light" ? "Light" : "Dark";
  $("sb-voice").textContent = s.voice_mode ? (s.muted ? "Muted" : "On") : "Off";
  $("sb-step").textContent = data.run?.phase || "idle";
  $("sb-drift").textContent = (data.run?.drift?.length) ? String(data.run.drift.length) : "none";
  $("voice-toggle").textContent = s.voice_mode ? "Voice On" : "Voice Off";
  $("mute").textContent = s.muted ? "Unmute" : "Mute";
  $("accept").hidden = !data.run?.awaiting_review;
  $("reject").hidden = !data.run?.awaiting_review;
  $("continue").hidden = !data.run?.paused;
  $("code").style.fontSize = `${s.font_size || 13}px`;

  const mood = data.emotion?.current || "calm";
  $("sb-mood").textContent = mood;
  $("sb-mood-bar").textContent = mood;
  if (state.face) state.face.setEmotion(mood);

  const files = $("file-list");
  files.innerHTML = "";
  if (!data.files?.length) {
    files.innerHTML = '<div class="empty">No files. Run a goal.</div>';
  }
  for (const f of data.files || []) {
    const row = document.createElement("div");
    row.className = "file" + (f === data.focus ? " active" : "");
    row.textContent = f;
    row.onclick = () => openFile(f);
    files.appendChild(row);
  }
  $("tab-name").textContent = data.focus || "no file";

  const problems = $("problem-list");
  problems.innerHTML = "";
  for (const p of data.problems || []) {
    const row = document.createElement("div");
    row.className = "file" + (p.includes("none") ? "" : " warn");
    row.textContent = p;
    problems.appendChild(row);
  }

  const transcript = $("transcript");
  const floatT = $("float-transcript");
  transcript.innerHTML = "";
  floatT.innerHTML = "";
  for (const line of data.assistant?.lines || []) {
    const row = document.createElement("div");
    row.className = "line " + (line.role === "you" ? "you" : "assistant");
    row.textContent = line.text;
    transcript.appendChild(row);
    const row2 = row.cloneNode(true);
    floatT.appendChild(row2);
  }
  transcript.scrollTop = transcript.scrollHeight;

  const nim = $("nim-log");
  if (nim) {
    nim.innerHTML = state.nimLog.map((l) => `<div>${l}</div>`).join("") || '<div class="empty">NIM idle</div>';
    nim.scrollTop = nim.scrollHeight;
  }
}

async function openFile(path) {
  state.focus = path;
  await api("/api/open", { method: "POST", body: JSON.stringify({ path }) });
}

function speakLine(text) {
  if (!state.face || !text) return;
  const ms = Math.max(800, text.length * 60);
  state.face.speak(ms);
}

$("goalbar").addEventListener("submit", (e) => {
  e.preventDefault();
  const goal = $("goal").value.trim();
  if (!goal) return;
  api("/api/intake", { method: "POST", body: JSON.stringify({ goal }) });
});
$("accept").onclick = () => api("/api/review", { method: "POST", body: JSON.stringify({ decision: "accept" }) });
$("reject").onclick = () => api("/api/review", { method: "POST", body: JSON.stringify({ decision: "reject" }) });
$("continue").onclick = () => api("/api/resume", { method: "POST", body: "{}" });
$("save").onclick = () => {
  if (!state.data?.focus) return;
  api("/api/file", { method: "POST", body: JSON.stringify({ path: state.data.focus, content: $("code").value }) });
};

$("assist-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("assist-input").value.trim();
  if (!text) return;
  $("assist-input").value = "";
  let body;
  if (text.startsWith("/note ")) {
    body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "note", text: text.slice(6) }) });
  } else if (text.startsWith("/edit ")) {
    const parts = text.slice(6).split(" ");
    body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "edit", path: parts[0], content: parts.slice(1).join(" ") }) });
  } else if (text.startsWith("/scan ")) {
    body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "scan", path: text.slice(6) }) });
  } else if (text.startsWith("/mkdir ")) {
    body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "mkdir", path: text.slice(7) }) });
  } else if (text.startsWith("/search ")) {
    body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "search", text: text.slice(8) }) });
  } else if (text.startsWith("/nim ")) {
    const job = text.slice(5);
    state.nimLog.push(`[${new Date().toLocaleTimeString()}] NIM job: ${job}`);
    body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "nim", text: job }) });
  } else if (text.startsWith("/mood ")) {
    body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "mood", emotion: text.slice(6) }) });
  } else {
    body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "steer", text }) });
  }
  if (body?.message) speakLine(body.message);
});

$("voice-toggle").onclick = async () => {
  const on = !state.data?.settings?.voice_mode;
  await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "voice", on }) });
};
$("mute").onclick = () => {
  const on = !state.data?.settings?.muted;
  api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "mute", on }) });
};
$("audit").onclick = async () => {
  const body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "audit" }) });
  if (body?.message) speakLine(body.message);
};
$("clear-drift").onclick = () => api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "clear-drift" }) });
$("mark").onclick = () => {
  const code = $("code");
  const selected = code.value.slice(code.selectionStart, code.selectionEnd);
  api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "mark", path: state.data?.focus || "", text: selected }) });
};

document.querySelectorAll(".actions button").forEach((btn) => {
  btn.onclick = async () => {
    const action = btn.dataset.action;
    const text = prompt(action + " (enter value):") || "";
    if (!text) return;
    let body;
    if (action === "note") body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "note", text }) });
    else if (action === "steer") body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "steer", text }) });
    else if (action === "scan") body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "scan", path: text }) });
    else if (action === "mkdir") body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "mkdir", path: text }) });
    else if (action === "search") body = await api("/api/assistant", { method: "POST", body: JSON.stringify({ action: "search", text }) });
    if (body?.message) speakLine(body.message);
  };
});

const drag = $("assist-drag");
let dragAt = null;
drag.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) return;
  dragAt = { x: e.clientX, y: e.clientY, left: $("assistant").offsetLeft, top: $("assistant").offsetTop };
  drag.setPointerCapture(e.pointerId);
});
drag.addEventListener("pointermove", (e) => {
  if (!dragAt) return;
  const el = $("assistant");
  el.style.left = (dragAt.left + e.clientX - dragAt.x) + "px";
  el.style.top = (dragAt.top + e.clientY - dragAt.y) + "px";
  el.style.right = "auto";
  el.style.bottom = "auto";
});
drag.addEventListener("pointerup", () => { dragAt = null; });

$("open-settings").onclick = () => {
  const p = $("settings");
  p.style.display = p.style.display === "block" ? "none" : "block";
  if (state.data?.settings) {
    $("set-theme").value = state.data.settings.theme;
    $("set-style").value = state.data.settings.version_style;
    $("set-font").value = state.data.settings.font_size;
    $("set-drift").value = state.data.settings.drift_response;
    $("set-int").value = state.data.settings.intervention;
  }
};
$("save-settings").onclick = async () => {
  const next = structuredClone(state.data.settings);
  next.theme = $("set-theme").value;
  next.version_style = $("set-style").value;
  next.font_size = Number($("set-font").value);
  next.drift_response = $("set-drift").value;
  next.intervention = $("set-int").value;
  await api("/api/settings", { method: "POST", body: JSON.stringify(next) });
  $("settings").style.display = "none";
};

setInterval(() => {
  api("/api/tick", { method: "POST", body: "{}" });
}, 30000);

// Mount face
const faceContainer = $("face-container");
if (faceContainer) {
  state.face = mountFace(faceContainer);
}

fetch("/api/state").then((r) => r.json()).then((b) => render(b.state));
