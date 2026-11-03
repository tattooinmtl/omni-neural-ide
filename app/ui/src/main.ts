import './styles.css';
import { api, type Mode, type TreeNode } from './api';
import { svg } from './icons';
import {
  initEditor, setModeTheme, setEditorCallbacks, openTab, activate, closeTab, getActive, getTabs,
} from './editor';
import { renderTree } from './tree';
import { ChatPanel, type FixtureMsg } from './chat';
import { FloatingAssistant } from './assistant';
import { BrainView } from './brain';
import { HarnessController } from './harness';
import { MOODS } from './moods';

const params = new URLSearchParams(location.search);
let mode: Mode = (params.get('mode') as Mode) || 'plain';
const forcePick = params.get('pick') === '1';
const demo = params.get('demo') === '1';
const themeLight = params.get('theme') === 'light';
const FIX_ROOT = '/workspace/omni-build/fixtures';

const expanded = new Set<string>();
let projectRoot: string | null = null;
let tree: TreeNode | null = null;
let chat: ChatPanel;
let assistant: FloatingAssistant;
let brain: BrainView | null = null;
let harness = new HarnessController();
let cursor = { line: 1, col: 1 };
let driftMode: 'warn' | 'pause' = 'warn';
let dnd = false;
let timers: { id: number; at: number; text: string }[] = [];

function shell() {
  const brand = mode === 'ultra'
    ? `<span class="brand"><span>OMNI-CODE</span><span class="ultra">Ultra</span><span class="ultra-dot"></span><span class="code-tag" style="color:var(--accent);margin-left:6px;font-weight:600">&lt;/&gt;</span></span>`
    : `<span class="brand">${svg.logo}<span>OMNI-CODE</span></span>`;
  return `
  <div class="titlebar">
    <div class="left">${brand}</div>
    <div class="title-center">
      <div class="title-icons">${svg.code}${svg.search}${svg.bell}</div>
      <div class="omni-connected"><span class="dot"></span> Omni Connected</div>
    </div>
    <div class="title-right">
      <div class="title-tools">
        <button title="Run">${svg.play}</button>
        <button title="Debug">${svg.play}</button>
        <button title="Layout">${svg.grid}</button>
        <button title="Sidebar" data-act="toggle-side">${svg.sidebar}</button>
        <button title="Panel">${svg.panel}</button>
        <button title="Fullscreen">${svg.fullscreen}</button>
      </div>
      <div class="win-ctrl">
        <button title="Minimize">─</button>
        <button title="Maximize">☐</button>
        <button class="close" title="Close">✕</button>
      </div>
    </div>
  </div>
  <div class="menubar">
    <button>File</button><button>Edit</button><button>Selection</button>
    <button>View</button><button>Go</button><button>Run</button>
    <button>Terminal</button><button>Help</button>
  </div>
  <div class="workspace">
    <div class="activity">
      <div class="top">
        <button class="active" data-act="explorer" title="Explorer">${svg.files}</button>
        <button data-act="search" title="Search">${svg.search}</button>
        <button data-act="git" title="Source Control">${svg.git}</button>
        <button data-act="run" title="Run and Debug">${svg.debug}</button>
        <button data-act="ext" title="Extensions">${svg.blocks}</button>
      </div>
      <div class="spacer"></div>
      <div class="bottom">
        <button title="Account">${svg.user}</button>
        <button data-act="settings" title="Settings">${svg.gear}</button>
      </div>
    </div>
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <span class="label">EXPLORER</span>
        <span class="project-title">OMNI-CODE</span>
        <div class="sidebar-actions">
          <button title="New File" class="codicon codicon-new-file"></button>
          <button title="New Folder" class="codicon codicon-new-folder"></button>
          <button title="Refresh" data-act="refresh" class="codicon codicon-refresh"></button>
          <button title="Open Folder" data-act="open" class="codicon codicon-ellipsis"></button>
        </div>
      </div>
      <div class="file-tree" id="file-tree"></div>
      <div class="sidebar-sections">
        <div class="sidebar-section">▸ OUTLINE</div>
        <div class="sidebar-section">▸ TIMELINE</div>
      </div>
    </div>
    <div class="resizer-v" id="resize-side"></div>
    <div class="editor-col">
      <div class="tabbar" id="tabbar"></div>
      <div class="breadcrumbs" id="breadcrumbs"><span class="crumb">No file open</span></div>
      <div class="monaco-host" id="monaco"></div>
      <div class="editor-meta" id="editor-meta">
        <span id="meta-cursor">Ln 1, Col 1</span>
        <span>Spaces: 2</span><span>UTF-8</span><span>LF</span>
        <span id="meta-lang">Plain Text</span><span>Prettier</span>
      </div>
    </div>
    <div class="resizer-v" id="resize-chat"></div>
    <div class="chat" id="chat"></div>
  </div>
  <div class="statusbar">
    <div class="left">
      <span class="item">⎇ main${mode === 'ultra' ? '*' : ''}</span>
      <span class="item plain-only">↻ 0</span>
      <span class="item ultra-only">↻</span>
      <span class="item ultra-only">No issues</span>
      <span class="item plain-only">⊘ 0</span>
      <span class="item plain-only">⚠ 0</span>
      <span class="item plain-only" id="status-cursor">Ln 1, Col 1</span>
      <span class="item plain-only">Spaces: 4</span>
      <span class="item plain-only">UTF-8</span>
      <span class="item plain-only">LF</span>
      <span class="item plain-only" id="status-lang">Python</span>
      <span class="item plain-only">3.11.4 64-bit</span>
    </div>
    <div class="right">
      <span class="item plain-only">OMNI-CODE 1.0.0</span>
      <span class="badge plain-only">Insiders</span>
      <span class="item ultra-only">🔔</span>
      <span class="item ultra-only">↻</span>
      <span class="item ultra-only">▶</span>
      <span class="item ultra-only">main*</span>
      <span class="item ultra-only">⊘ 0</span>
      <span class="item ultra-only">⚠ 0</span>
      <span class="item ultra-only">ℹ 0</span>
      <span class="item plain-only">🔔</span>
      <span class="item plain-only">▦</span>
    </div>
  </div>
  <div class="review-gate hidden" id="review-gate">
    <span id="review-summary">Review harness turn</span>
    <button class="ok" id="rev-accept">Accept</button>
    <button class="bad" id="rev-reject">Reject</button>
    <button id="rev-cont">Continue</button>
  </div>
  <div class="overlay ${forcePick && !demo ? '' : 'hidden'}" id="overlay">
    <div class="overlay-card">
      <h1>Launch OMNI-CODE</h1>
      <p>Choose a layout every launch. Provider keys stay on this machine.</p>
      <button class="choice" data-mode="plain"><strong>OMNI-CODE</strong><span> Classic dark layout</span></button>
      <button class="choice" data-mode="ultra"><strong>OMNI-CODE Ultra</strong><span> Alive layout</span></button>
      <div class="keys-form">
        <label>MiniMax API key<input id="key-minimax" type="password" autocomplete="off"/></label>
        <label>NVIDIA API key<input id="key-nvidia" type="password" autocomplete="off"/></label>
        <div class="row-actions">
          <button type="button" id="save-keys">Save keys</button>
          <button type="button" class="primary" id="open-demo-folder">Continue</button>
        </div>
      </div>
    </div>
  </div>`;
}

function paintTabs() {
  const bar = document.getElementById('tabbar')!;
  const tabs = getTabs();
  const active = getActive()?.path || null;
  const maxVisible = mode === 'plain' ? 4 : 8;
  const visible = tabs.slice(0, maxVisible);
  const overflow = tabs.length > maxVisible;
  bar.innerHTML = visible.map(t => {
    const ext = t.name.split('.').pop();
    const ico = ext === 'py' ? svg.py : (ext === 'tsx' || ext === 'ts') ? svg.ts : ext === 'css' ? svg.css : ext === 'html' ? svg.html : svg.file;
    return `<div class="tab ${t.path === active ? 'active' : ''}" data-path="${encodeURIComponent(t.path)}">
      <span class="dot-file"></span>
      <span class="icon">${ico}</span>
      <span>${t.name}${t.dirty ? ' •' : ''}</span>
      <button class="close" data-close="${encodeURIComponent(t.path)}">✕</button>
    </div>`;
  }).join('') + ((mode==='plain' && tabs.length>=4) || overflow ? `<div class="tab tab-overflow" title="More tabs">…</div>` : '');
  bar.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', e => {
      const btn = e.target as HTMLElement;
      if (btn.dataset.close || btn.closest('[data-close]')) {
        const c = (btn.dataset.close || (btn.closest('[data-close]') as HTMLElement)?.dataset.close)!;
        closeTab(decodeURIComponent(c));
        paintTabs(); paintBreadcrumbs();
        return;
      }
      const path = decodeURIComponent((tab as HTMLElement).dataset.path!);
      activate(path); paintTabs(); paintBreadcrumbs();
      renderTree(document.getElementById('file-tree')!, tree, path, onOpenFile, expanded, path ? [path] : []);
    });
  });
  paintBreadcrumbs();
}

function paintBreadcrumbs() {
  const bc = document.getElementById('breadcrumbs')!;
  const t = getActive();
  if (!t) { bc.innerHTML = `<span class="crumb">No file open</span>`; return; }
  let parts = t.path.replace(/\\/g, '/').split('/').filter(Boolean);
  const rootName = tree?.name;
  const idx = rootName ? parts.lastIndexOf(rootName) : -1;
  if (idx >= 0) parts = parts.slice(idx + 1);
  // Mock breadcrumb collapses nested src/src -> src
  if (mode === 'ultra' && parts[0] === 'src' && parts[1] === 'src') {
    parts = ['src', ...parts.slice(2)];
  }
  let crumbs = parts.map((p, i) => `<span class="${i === parts.length - 1 ? 'current' : 'crumb'}">${p}</span>`).join('<span class="sep">›</span>');
  if (mode === 'plain' && t.name === 'app.py') {
    crumbs += `<span class="sep">›</span><span class="crumb">...</span><span class="sep">›</span><span class="current">create_app()</span>`;
  } else if (mode === 'ultra' && t.name === 'dashboard.tsx') {
    crumbs += `<span class="sep">›</span><span class="current">DashboardPage</span>`;
  }
  bc.innerHTML = crumbs;
  const lang = t.language === 'typescript' && t.name.endsWith('tsx') ? 'TypeScript React'
    : t.language === 'python' ? 'Python' : t.language;
  const sl = document.getElementById('status-lang'); const ml = document.getElementById('meta-lang');
  if (sl) sl.textContent = lang; if (ml) ml.textContent = lang;
}

function paintStatus() {
  const c = document.getElementById('status-cursor');
  const m = document.getElementById('meta-cursor');
  const text = `Ln ${cursor.line}, Col ${cursor.col}`;
  if (c) c.textContent = text; if (m) m.textContent = text;
}

async function onOpenFile(node: TreeNode) {
  try {
    const r = await api.readFile(node.path);
    openTab(node.path, r.content);
    paintTabs();
    renderTree(document.getElementById('file-tree')!, tree, node.path, onOpenFile, expanded, [node.path]);
  } catch (e: any) { console.error(e); alert(`Open failed: ${e.message}`); }
}

function expandAll(node: TreeNode) {
  expanded.add(node.path);
  for (const c of node.children || []) if (c.kind === 'dir') expandAll(c);
}

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path || root.path.endsWith('/' + path) || root.path.endsWith(path)) return root;
  // also match by relative suffix
  for (const c of root.children || []) {
    const f = findNode(c, path);
    if (f) return f;
  }
  return null;
}

function findByRel(root: TreeNode, rel: string): TreeNode | null {
  const want = rel.replace(/\\/g, '/');
  const walk = (n: TreeNode): TreeNode | null => {
    const p = n.path.replace(/\\/g, '/');
    if (p.endsWith('/' + want) || p.endsWith(want)) return n;
    for (const c of n.children || []) {
      const f = walk(c);
      if (f) return f;
    }
    return null;
  };
  return walk(root);
}

function bindChrome() {
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      location.search = `?mode=${(btn as HTMLElement).dataset.mode}${demo ? '&demo=1' : ''}`;
    });
  });
  document.getElementById('save-keys')?.addEventListener('click', async () => {
    const minimax = (document.getElementById('key-minimax') as HTMLInputElement).value.trim();
    const nvidia = (document.getElementById('key-nvidia') as HTMLInputElement).value.trim();
    try { await api.setKeys(minimax || undefined, nvidia || undefined); alert('Keys saved'); }
    catch (e: any) { alert(e.message); }
  });
  document.getElementById('open-demo-folder')?.addEventListener('click', () => {
    document.getElementById('overlay')?.classList.add('hidden');
  });
  document.querySelector('[data-act="toggle-side"]')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('hidden');
  });
  document.querySelector('[data-act="open"]')?.addEventListener('click', async () => {
    const path = prompt('Folder path to open', projectRoot || FIX_ROOT + '/' + mode);
    if (!path) return;
    await openProject(path);
  });
  document.querySelector('[data-act="refresh"]')?.addEventListener('click', async () => {
    try {
      const r = await api.tree();
      tree = r.tree; projectRoot = r.root;
      renderTree(document.getElementById('file-tree')!, tree, getActive()?.path || null, onOpenFile, expanded, getActive()?.path ? [getActive()!.path] : []);
    } catch {}
  });
  document.querySelector('[data-act="settings"]')?.addEventListener('click', () => {
    document.body.classList.toggle('mode-light');
  });
  document.getElementById('rev-accept')?.addEventListener('click', async () => { await harness.accept(); document.getElementById('review-gate')?.classList.add('hidden'); });
  document.getElementById('rev-reject')?.addEventListener('click', async () => { await harness.reject(); document.getElementById('review-gate')?.classList.add('hidden'); });
  document.getElementById('rev-cont')?.addEventListener('click', async () => { await harness.cont(); document.getElementById('review-gate')?.classList.add('hidden'); });
  harness.onPhase = (p, d) => { assistant?.setStatus(`Harness: ${p} — ${d}`); };
  harness.onReview = (summary) => {
    const gate = document.getElementById('review-gate');
    const sum = document.getElementById('review-summary');
    if (sum) sum.textContent = summary.slice(0, 120) + (summary.length > 120 ? '…' : '');
    gate?.classList.remove('hidden');
  };
  harness.driftMode = driftMode;

  setupResize(document.getElementById('resize-side')!, document.getElementById('sidebar')!, 160, 420, false);
  setupResize(document.getElementById('resize-chat')!, document.getElementById('chat')!, 260, 480, true);

  window.addEventListener('keydown', async e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      const t = getActive();
      if (!t) return;
      try {
        const r = await api.writeFile(t.path, t.content) as any;
        if (r?.drift && r.drift !== null && driftMode === 'warn') assistant?.speak('Drift warning after write.');
        if (r?.drift && driftMode === 'pause') harness.onReview?.(String(r.drift.stat || r.drift));
        t.dirty = false; paintTabs();
      } catch (err: any) { alert(err.message); }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
      if (!brain) brain = BrainView.create(document.getElementById('brain-root')!);
      else brain.show();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
      const goal = prompt('Harness goal', 'Implement next plan step') || '';
      if (goal) harness.runIntake(goal);
    }
  });
}

function setupResize(handle: HTMLElement, target: HTMLElement, min: number, max: number, reverse: boolean) {
  let startX = 0, startW = 0;
  handle.addEventListener('pointerdown', e => {
    startX = e.clientX; startW = target.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', e => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    const w = Math.min(max, Math.max(min, reverse ? startW - dx : startW + dx));
    target.style.width = `${w}px`;
  });
}

async function openProject(path: string) {
  const r = await api.openFolder(path);
  projectRoot = r.root;
  tree = r.tree;
  expanded.clear();
  // Mock-matching expand state
  if (mode === 'plain') {
    expandPaths(['backend', 'frontend']); // __pycache__/api/models/services stay collapsed
  } else {
    expandPaths([
      '.omni', '.vscode',
      'src', 'src/src', 'src/src/app',
      'src/src/services', 'src/src/utils', 'src/src/components', 'src/src/styles',
    ]);
  }
  renderTree(document.getElementById('file-tree')!, tree, null, onOpenFile, expanded, []);
  const title = document.querySelector('.sidebar-header .project-title');
  if (title) title.textContent = mode==='plain' ? 'OMNI-CODE' : (tree.name || 'PROJECT').toUpperCase();
  const label = document.querySelector('.sidebar-header .label');
  if (label) label.textContent = mode === 'ultra' ? 'OMNI-APP' : 'EXPLORER';
}

function expandPaths(rels: string[]) {
  if (!tree) return;
  for (const rel of rels) {
    const n = findByRel(tree, rel);
    if (n) expanded.add(n.path);
  }
  // always expand root
  expanded.add(tree.path);
}

async function bootDemo() {
  const folder = `${FIX_ROOT}/${mode === 'ultra' ? 'OMNI-APP' : 'OMNI-CODE'}`;
  await openProject(folder);
  // Open in mock left-to-right order, then re-activate the first (active) tab
  const files = mode === 'plain'
    ? ['backend/app.py', 'backend/routes.py', 'backend/database.py', 'frontend/index.html']
    : ['src/src/app/dashboard.tsx', 'src/src/services/api.ts', 'src/src/services/realtime.ts', 'src/src/app/layout.tsx', 'src/src/styles/globals.css'];
  for (const rel of files) {
    const n = findByRel(tree!, rel);
    if (n) await onOpenFile(n);
    else console.warn('missing fixture file', rel);
  }
  // Re-activate primary tab so it is selected (and tree selection matches)
  const primary = findByRel(tree!, files[0]);
  if (primary) {
    activate(primary.path);
    paintTabs();
    const highlights = mode === 'plain'
      ? [primary.path, ...['backend/api', 'backend/services'].map(r => findByRel(tree!, r)?.path).filter((x): x is string => !!x)]
      : [primary.path];
    (window as any).__omniHi = highlights;
    renderTree(document.getElementById('file-tree')!, tree, primary.path, onOpenFile, expanded, highlights);
  }
  // Chat must show first message at top (not scrolled to bottom)
  requestAnimationFrame(() => {
    const msgs = document.getElementById('chat-msgs');
    if (msgs) msgs.scrollTop = 0;
  });
  // Chat fixture via real ChatPanel API
  const transcriptUrl = `/fixtures-chat/${mode === 'plain' ? 'plain' : 'ultra'}.json`;
  try {
    const resp = await fetch(transcriptUrl);
    if (resp.ok) {
      const msgs = await resp.json() as FixtureMsg[];
      chat.loadFixture(msgs, { thinking: mode === 'ultra' });
    }
  } catch (e) {
    console.warn('chat fixture load failed', e);
  }
}

async function boot() {
  document.documentElement.classList.add('shot');
  document.body.classList.remove('mode-plain', 'mode-ultra', 'mode-light');
  document.body.classList.add(themeLight ? 'mode-light' : `mode-${mode}`);
  document.title = mode === 'ultra' ? 'OMNI-CODE Ultra' : 'OMNI-CODE';
  document.getElementById('app')!.innerHTML = shell();
  initEditor(document.getElementById('monaco')!, mode);
  setEditorCallbacks({
    onTabs: () => paintTabs(),
    onCursor: (line, col) => { cursor = { line, col }; paintStatus(); },
  });
  chat = new ChatPanel(document.getElementById('chat')!, mode);
  assistant = FloatingAssistant.create(document.getElementById('assistant-root')!);
  (assistant as any).moods = MOODS;
  if (mode === 'ultra') setTimeout(() => assistant.greet(), 500);
  bindChrome();
  // Exact mock panel seams (activity|explorer|editor|chat)
  const side = document.getElementById('sidebar');
  const chatEl = document.getElementById('chat');
  if (side) side.style.width = mode === 'ultra' ? '197px' : '207px';
  if (chatEl) chatEl.style.width = mode === 'ultra' ? '341px' : '348px';
  document.documentElement.style.setProperty('--activity-w', mode === 'ultra' ? '50px' : '48px');

  if (demo) {
    try {
      await bootDemo();
    } catch (e: any) {
      console.error(e);
      // Core may be down during static shot serve — fall back to opening via relative fixture fetch won't work for FS.
      document.getElementById('file-tree')!.innerHTML = `<div class="tree-item" style="color:#f66">Demo needs omni-core serving fixtures: ${e.message}</div>`;
    }
  } else {
    try {
      const t = await api.tree();
      tree = t.tree; projectRoot = t.root;
      if (tree) { expandAll(tree); renderTree(document.getElementById('file-tree')!, tree, null, onOpenFile, expanded, []); }
      else renderTree(document.getElementById('file-tree')!, null, null, onOpenFile, expanded, []);
    } catch {
      renderTree(document.getElementById('file-tree')!, null, null, onOpenFile, expanded, []);
    }
  }

  setInterval(() => {
    if (dnd) return;
    const now = Date.now();
    for (const t of timers) {
      if (t.at <= now) {
        assistant.speak(`Alarm: ${t.text}`);
        timers = timers.filter(x => x.id !== t.id);
      }
    }
  }, 1000);

  (window as any).omni = {
    harness, assistant,
    setDrift: (m: 'warn' | 'pause') => { driftMode = m; harness.driftMode = m; },
    setDnd: (v: boolean) => { dnd = v; },
    addTimer: (sec: number, text: string) => { timers.push({ id: Date.now(), at: Date.now() + sec * 1000, text }); },
    brain: () => { if (!brain) brain = BrainView.create(document.getElementById('brain-root')!); else brain.show(); },
    mood: (m: string) => assistant.setMood(m),
  };
}

boot();
