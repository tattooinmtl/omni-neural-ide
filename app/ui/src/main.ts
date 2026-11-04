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
import { MOODS, nearestMood } from './moods';
import { SettingsView } from './settings';
import { setMenuHandler, bindMenubar, showContextMenu, installGlobalMenuGuards, buildMenus, tabContextItems, explorerContextItems, editorContextItems, setMenuIcons, type MenuItem } from './menus';
import type { PanelId } from './layout';
import { DockManager, sanitize, preset, type DockLayout, type PresetId } from './dock';
import { TerminalPanel, ConsolePanel } from './terminal';

const params = new URLSearchParams(location.search);
let mode: Mode = (params.get('mode') as Mode) || 'plain';
const forcePick = params.get('pick') === '1';
const demo = params.get('demo') === '1';
const themeLight = params.get('theme') === 'light';
const FIX_ROOT = '/workspace/omni-neural-ide-rebuild/app/fixtures';

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
let dock: DockManager;
let terminal: TerminalPanel | null = null;
let consolePanel: ConsolePanel | null = null;
let clipboardPath: { path: string; cut: boolean } | null = null;


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
  <div class="menubar" id="menubar">
    <button data-menu="file"><span class="mi-ico">${svg.files}</span><span class="mi-label-text">File</span></button>
    <button data-menu="edit"><span class="mi-ico">${svg.code}</span><span class="mi-label-text">Edit</span></button>
    <button data-menu="selection"><span class="mi-ico">${svg.sidebar}</span><span class="mi-label-text">Selection</span></button>
    <button data-menu="view"><span class="mi-ico">${svg.panel}</span><span class="mi-label-text">View</span></button>
    <button data-menu="go"><span class="mi-ico">${svg.search}</span><span class="mi-label-text">Go</span></button>
    <button data-menu="run"><span class="mi-ico">${svg.play}</span><span class="mi-label-text">Run</span></button>
    <button data-menu="terminal"><span class="mi-ico">${svg.blocks}</span><span class="mi-label-text">Terminal</span></button>
    <button data-menu="app"><span class="mi-ico">${svg.grid}</span><span class="mi-label-text">App</span></button>
    <button data-menu="help"><span class="mi-ico">${svg.help}</span><span class="mi-label-text">Help</span></button>
  </div>
  <div class="work-stack">
  <div class="workspace-row" id="workspace-row">
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
    <div class="dock-root" id="dock-root"></div>
  </div>
  <div id="panel-stash" hidden>
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <span class="label">EXPLORER</span>
        <span class="project-title">OMNI-CODE</span>
        <div class="sidebar-actions">
          <button title="New File" data-act="new-file" class="codicon codicon-new-file"></button>
          <button title="New Folder" data-act="new-folder" class="codicon codicon-new-folder"></button>
          <button title="Refresh" data-act="refresh" class="codicon codicon-refresh"></button>
          <button title="Open Folder" data-act="open" class="codicon codicon-ellipsis"></button>
        </div>
      </div>
      <div class="file-tree" id="file-tree"></div>
      <div class="sidebar-sections" id="sidebar-sections">
        <div class="sidebar-section" data-panel="outline">▸ OUTLINE</div>
        <div class="sidebar-section" data-panel="timeline">▸ TIMELINE</div>
      </div>
    </div>
    <div class="editor-col" id="editor-col">
      <div class="tabbar" id="tabbar"></div>
      <div class="breadcrumbs" id="breadcrumbs"><span class="crumb">No file open</span></div>
      <div class="monaco-host" id="monaco"></div>
      <div class="editor-meta" id="editor-meta">
        <span id="meta-cursor">Ln 1, Col 1</span>
        <span>Spaces: 2</span><span>UTF-8</span><span>LF</span>
        <span id="meta-lang">Plain Text</span><span>Prettier</span>
      </div>
    </div>
    <div class="chat" id="chat"></div>
    <div class="presence-host" id="presence-host"></div>
    <div class="dock-pane" id="dock-terminal"></div>
    <div class="dock-pane" id="dock-console"></div>
    <div class="dock-pane" id="pane-problems"><div class="panel-placeholder">No problems detected.</div></div>
    <div class="dock-pane" id="pane-output"><div class="panel-placeholder">Output channel.</div></div>
    <div class="dock-pane" id="pane-search"><div class="panel-placeholder">Search across files — use <b>Ctrl+Shift+F</b>, or Find (<b>Ctrl+F</b>) in the editor.</div></div>
    <div class="dock-pane" id="pane-scm"><div class="panel-placeholder">Source control · branch <b>main</b> · no pending changes.</div></div>
    <div class="dock-pane" id="pane-outline"><div class="panel-placeholder">Outline — open a file to see its symbols.</div></div>
    <div class="dock-pane" id="pane-timeline"><div class="panel-placeholder">Timeline — local history for the active file.</div></div>
  </div>
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
      <span class="item plain-only">OMNI-CODE 1.3.5</span>
      <span class="badge plain-only">Insiders</span>
      <span class="item ultra-only">OMNI 1.3.5</span>
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
      <p>Choose a layout every launch. Provider keys are in Settings → Providers.</p>
      <button class="choice" data-mode="plain"><strong>OMNI-CODE</strong><span> Classic dark layout</span></button>
      <button class="choice" data-mode="ultra"><strong>OMNI-CODE Ultra</strong><span> Alive layout</span></button>
      <p class="keys-form" style="color:var(--fg-dim);font-size:12px">Set API keys anytime under Settings → Providers.</p>
      <div class="row-actions"><button type="button" class="primary" id="open-demo-folder">Continue</button></div>
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
  document.getElementById('open-demo-folder')?.addEventListener('click', () => {
    document.getElementById('overlay')?.classList.add('hidden');
  });
  document.querySelector('[data-act="toggle-side"]')?.addEventListener('click', () => {
    dock.toggle('explorer'); installMenus();
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
    SettingsView.open(document.body);
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

  document.querySelector('[data-act="new-file"]')?.addEventListener('click', () => handleMenu('file.new'));
  document.querySelector('[data-act="new-folder"]')?.addEventListener('click', () => handleMenu('file.newFolder'));
  document.querySelector('[data-act="explorer"]')?.addEventListener('click', () => { dock.toggle('explorer'); installMenus(); });
  document.querySelector('[data-act="search"]')?.addEventListener('click', () => { dock.open('search'); installMenus(); });
  document.querySelector('[data-act="git"]')?.addEventListener('click', () => { dock.open('scm'); installMenus(); });

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
  terminal?.setCwd(projectRoot || '');
  consolePanel?.log(`Opened ${projectRoot}`);
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



function dockPresence() {
  const host = document.getElementById('presence-host');
  const root = document.getElementById('assistant-root');
  if (!host || !root) return;
  host.appendChild(root);
  document.body.classList.add('presence-docked');
  root.classList.remove('assistant-hidden', 'assistant-tucked');
  (assistant as any)?.setDocked?.(true);
}

const LAYOUT_KEY = 'omni.layout.v3';
let layoutWrite: Promise<void> = Promise.resolve();
function loadDockLayout(): DockLayout {
  try { return sanitize(JSON.parse(localStorage.getItem(`${LAYOUT_KEY}.${mode}`) || 'null'), mode); }
  catch { return preset('default', mode); }
}
function saveDockLayout(l: DockLayout) {
  localStorage.setItem(`${LAYOUT_KEY}.${mode}`, JSON.stringify(l));
  // persist to SQLite settings (data\omni.db) — survives WebView cache wipes / reinstalls
  // serialized writes; value = both modes straight from the local cache (no read-modify-write race)
  layoutWrite = layoutWrite.then(async () => {
    const all: Record<string, unknown> = {};
    for (const m of ['plain', 'ultra']) {
      try { const v = localStorage.getItem(`${LAYOUT_KEY}.${m}`); if (v) all[m] = JSON.parse(v); } catch {}
    }
    try { await api.setSetting('layout', all); } catch { /* offline/demo */ }
  });
  installMenus();
}

function panelContent(id: PanelId): HTMLElement {
  const byId: Record<PanelId, string> = {
    explorer: 'sidebar', editor: 'editor-col', chat: 'chat', presence: 'presence-host',
    terminal: 'dock-terminal', console: 'dock-console', problems: 'pane-problems', output: 'pane-output',
    search: 'pane-search', scm: 'pane-scm', outline: 'pane-outline', timeline: 'pane-timeline',
  };
  return document.getElementById(byId[id])!;
}

function ensureTermPanels(id?: PanelId) {
  if ((!id || id === 'terminal') && dock?.isOpen('terminal')) {
    const host = document.getElementById('dock-terminal')!;
    if (!terminal) { terminal = new TerminalPanel(host, projectRoot || ''); (window as any).__omniTerminal = terminal; }
  }
  if ((!id || id === 'console') && dock?.isOpen('console')) {
    const host = document.getElementById('dock-console')!;
    if (!consolePanel) consolePanel = new ConsolePanel(host);
  }
}

function initDock() {
  const rootEl = document.getElementById('dock-root')!;
  dock = new DockManager(rootEl, mode, loadDockLayout(), {
    content: panelContent,
    onChange: saveDockLayout,
    onShown: (id) => {
      if (id === 'terminal' || id === 'console') ensureTermPanels(id);
      if (id === 'terminal') setTimeout(() => terminal?.focus(), 30);
    },
    onClosed: () => installMenus(),
  });
  (window as any).__omniDock = dock;
  dock.render();
  ensureTermPanels();
  // SQLite copy wins when it differs (e.g. localStorage cleared by a WebView2 reset)
  api.getSetting('layout').then((r) => {
    const remote = r?.value?.[mode];
    if (remote && JSON.stringify(sanitize(remote, mode)) !== JSON.stringify(dock.layout)) {
      dock.setLayout(sanitize(remote, mode));
      localStorage.setItem(`${LAYOUT_KEY}.${mode}`, JSON.stringify(dock.layout));
      installMenus();
    }
  }).catch(() => {});
}

async function runUpdateFromUi() {
  try {
    consolePanel?.log('Checking for updates…');
    const chk = await api.updateCheck();
    if (!chk.available) {
      alert(`Already up to date (${chk.current}).`);
      consolePanel?.log(`Up to date: ${chk.current}`);
      return;
    }
    if (!confirm(`Update ${chk.current} → ${chk.latest}? The app will restart.`)) return;
    const a = await api.updateApply(mode);
    alert(a.message);
    consolePanel?.log(a.message);
  } catch (e: any) {
    alert(e.message || String(e));
  }
}

async function refreshTree(select?: string | null) {
  try {
    const r = await api.tree();
    tree = r.tree; projectRoot = r.root;
    renderTree(document.getElementById('file-tree')!, tree, select || getActive()?.path || null, onOpenFile, expanded, select ? [select] : (getActive()?.path ? [getActive()!.path] : []));
  } catch {}
}

async function handleMenu(id: string) {
  const active = getActive();
  switch (id) {
    case 'file.new': {
      if (!projectRoot) return alert('Open a folder first');
      const name = prompt('New file name', 'untitled.txt');
      if (!name) return;
      const path = projectRoot.replace(/\\/g, '/') + '/' + name;
      await api.writeFile(path, '');
      await refreshTree(path);
      await onOpenFile({ name, path, kind: 'file' });
      break;
    }
    case 'file.newFolder': {
      if (!projectRoot) return alert('Open a folder first');
      const name = prompt('New folder name', 'new-folder');
      if (!name) return;
      await api.mkdir(projectRoot.replace(/\\/g, '/') + '/' + name);
      await refreshTree();
      break;
    }
    case 'file.open': {
      const path = prompt('Folder path to open', projectRoot || FIX_ROOT + '/' + mode);
      if (path) await openProject(path);
      break;
    }
    case 'file.save': {
      if (!active) return;
      await api.writeFile(active.path, active.content);
      active.dirty = false; paintTabs();
      break;
    }
    case 'file.saveAs': {
      if (!active) return;
      const to = prompt('Save as path', active.path);
      if (!to) return;
      await api.writeFile(to, active.content);
      await refreshTree(to);
      await onOpenFile({ name: to.split(/[/\\\\]/).pop()!, path: to, kind: 'file' });
      break;
    }
    case 'file.saveAll': {
      for (const tab of getTabs()) {
        if (tab.dirty) {
          await api.writeFile(tab.path, tab.content);
          tab.dirty = false;
        }
      }
      paintTabs();
      break;
    }
    case 'file.close': if (active) { closeTab(active.path); paintTabs(); paintBreadcrumbs(); } break;
    case 'file.closeOthers': {
      if (!active) return;
      for (const tab of [...getTabs()]) if (tab.path !== active.path) closeTab(tab.path);
      paintTabs();
      break;
    }
    case 'file.closeAll': {
      for (const tab of [...getTabs()]) closeTab(tab.path);
      paintTabs(); paintBreadcrumbs();
      break;
    }
    case 'file.copyPath': if (active) await navigator.clipboard.writeText(active.path); break;
    case 'file.reveal': if (active) alert(`Path:\n${active.path}`); break;
    case 'file.update':
    case 'app.update': await runUpdateFromUi(); break;
    case 'edit.undo': document.execCommand('undo'); break;
    case 'edit.redo': document.execCommand('redo'); break;
    case 'edit.cut': document.execCommand('cut'); break;
    case 'edit.copy': document.execCommand('copy'); break;
    case 'edit.paste': document.execCommand('paste'); break;
    case 'edit.find': window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); break;
    case 'view.explorer': dock.toggle('explorer'); break;
    case 'view.terminal': dock.open('terminal'); break;
    case 'view.console': dock.open('console'); break;
    case 'view.presence': dock.toggle('presence'); break;
    case 'view.fullscreen': {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
      break;
    }
    case 'term.new': dock.open('terminal'); break;
    case 'term.clear': terminal?.clear(); break;
    case 'app.resetLayout': dock.applyPreset('default'); break;
    case 'layout.default': case 'layout.focus': case 'layout.grid': dock.applyPreset(id.slice(7) as PresetId); break;
    case 'layout.floatOmni': dock.float('presence'); break;
    case 'app.settings': SettingsView.open(document.body); break;
    case 'help.about': alert(`OMNI-CODE ${mode === 'ultra' ? 'Ultra ' : ''}v1.3.5`); break;
    case 'help.docs': window.open('https://github.com/tattooinmtl/omni-neural-ide', '_blank'); break;
    default:
      if (id.startsWith('panel.')) {
        const pid = id.slice(6) as PanelId;
        dock.toggle(pid);
        installMenus();
      }
  }
}

function installMenus() {
  const bar = document.getElementById('menubar');
  if (!bar) return;
  setMenuHandler(handleMenu);
  installGlobalMenuGuards();
  const menus = buildMenus({ ultra: mode === 'ultra', panels: (dock?.visibleMap() || {}) as any });
  bindMenubar(bar, menus);
}

function installContextMenus() {
  const treeEl = document.getElementById('file-tree');
  treeEl?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null;
    const path = item?.dataset.path ? decodeURIComponent(item.dataset.path) : projectRoot;
        setMenuIcons(mode === 'ultra');
    const items: MenuItem[] = explorerContextItems(!!item, !!path, !!clipboardPath);
    setMenuHandler(async (id) => {
      try {
        if (id === 'ctx.newFile') await handleMenu('file.new');
        else if (id === 'ctx.newFolder') await handleMenu('file.newFolder');
        else if (id === 'ctx.rename' && path) {
          const base = path.split(/[/\\\\]/).pop()!;
          const name = prompt('Rename to', base);
          if (!name || name === base) return;
          const to = path.replace(/[/\\\\][^/\\\\]+$/, '/' + name);
          await api.renamePath(path, to);
          await refreshTree(to);
        } else if (id === 'ctx.delete' && path) {
          if (!confirm(`Delete ${path}?`)) return;
          await api.deletePath(path, true);
          closeTab(path);
          await refreshTree();
        } else if (id === 'ctx.cut' && path) clipboardPath = { path, cut: true };
        else if (id === 'ctx.copy' && path) clipboardPath = { path, cut: false };
        else if (id === 'ctx.paste' && clipboardPath && path) {
          const src = clipboardPath.path;
          const name = src.split(/[/\\\\]/).pop()!;
          const destDir = path; // paste into clicked folder/root
          const to = destDir.replace(/\\\\/g, '/') + '/' + name;
          if (clipboardPath.cut) await api.renamePath(src, to);
          else await api.copyPath(src, to);
          clipboardPath = null;
          await refreshTree(to);
        } else if (id === 'ctx.duplicate' && path) {
          const to = path + '.copy';
          await api.copyPath(path, to);
          await refreshTree(to);
        } else if (id === 'ctx.copyPath' && path) await navigator.clipboard.writeText(path);
        else if (id === 'ctx.copyRel' && path) {
          const rel = projectRoot && path.startsWith(projectRoot) ? path.slice(projectRoot.length).replace(/^[/\\]+/, '') : path;
          await navigator.clipboard.writeText(rel);
        } else if (id === 'ctx.reveal' && path) alert(path);
      } catch (err: any) { alert(err.message || String(err)); }
    });
    showContextMenu(e.clientX, e.clientY, items);
  });

  document.getElementById('tabbar')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const tab = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
    const path = tab?.dataset.path ? decodeURIComponent(tab.dataset.path) : getActive()?.path;
    setMenuIcons(mode === 'ultra');
    const items: MenuItem[] = tabContextItems(!!path);
    setMenuHandler(async (id) => {
      try {
        if (id === 'tab.save') await handleMenu('file.save');
        else if (id === 'tab.saveAs') await handleMenu('file.saveAs');
        else if (id === 'tab.close') await handleMenu('file.close');
        else if (id === 'tab.closeOthers') await handleMenu('file.closeOthers');
        else if (id === 'tab.closeAll') await handleMenu('file.closeAll');
        else if (id === 'tab.copyPath' && path) await navigator.clipboard.writeText(path);
        else if (id === 'tab.copyRel' && path) {
          const rel = projectRoot && path.startsWith(projectRoot) ? path.slice(projectRoot.length).replace(/^[/\\]+/, '') : path;
          await navigator.clipboard.writeText(rel);
        } else if (id === 'tab.reveal' && path) alert(`Path:\n${path}`);
        else if (id === 'tab.cut' && path) clipboardPath = { path, cut: true };
        else if (id === 'tab.copy' && path) clipboardPath = { path, cut: false };
        else if (id === 'tab.paste' && clipboardPath) {
          const src = clipboardPath.path;
          const name = src.split(/[/\\]/).pop()!;
          const destDir = (path || projectRoot || '').replace(/[/\\][^/\\]+$/, '');
          const to = destDir.replace(/\\/g, '/') + '/' + name;
          if (clipboardPath.cut) await api.renamePath(src, to);
          else await api.copyPath(src, to);
          clipboardPath = null;
          await refreshTree(to);
        } else if (id === 'tab.duplicate' && path) {
          const to = path + '.copy';
          await api.copyPath(path, to);
          await refreshTree(to);
          await onOpenFile({ name: to.split(/[/\\]/).pop()!, path: to, kind: 'file' });
        } else if (id === 'tab.splitRight' || id === 'tab.moveRight' || id === 'tab.splitLeft' || id === 'tab.moveLeft') {
          alert('Split / move editor groups are queued for a later update — tab stays open.');
        } else if (id === 'tab.rename' && path) {
          const base = path.split(/[/\\]/).pop()!;
          const name = prompt('Rename to', base);
          if (!name || name === base) return;
          const to = path.replace(/[/\\][^/\\]+$/, '/' + name);
          const content = getTabs().find(tt => tt.path === path)?.content ?? (await api.readFile(path)).content;
          await api.renamePath(path, to);
          closeTab(path);
          await api.writeFile(to, content);
          await refreshTree(to);
          await onOpenFile({ name, path: to, kind: 'file' });
        } else if (id === 'tab.delete' && path) {
          if (!confirm(`Delete ${path}?`)) return;
          await api.deletePath(path, true);
          closeTab(path);
          await refreshTree();
        }
      } catch (err: any) { alert(err.message || String(err)); }
    });
    showContextMenu(e.clientX, e.clientY, items);
  });

  document.getElementById('monaco')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setMenuIcons(mode === 'ultra');
    showContextMenu(e.clientX, e.clientY, editorContextItems());
    setMenuHandler(handleMenu);
  });

  document.getElementById('chat')?.addEventListener('contextmenu', (e) => {
    const msg = (e.target as HTMLElement).closest('.msg');
    if (!msg) return;
    e.preventDefault();
    const text = (msg.querySelector('.msg-body') as HTMLElement)?.innerText || '';
    setMenuIcons(mode === 'ultra');
    showContextMenu(e.clientX, e.clientY, [
      { type: 'item', id: 'chat.copy', label: 'Copy message', shortcut: 'Ctrl+C', icon: svg.menuCopy },
      { type: 'item', id: 'chat.insert', label: 'Insert into editor', icon: svg.menuPaste },
    ]);
    setMenuHandler(async (id) => {
      if (id === 'chat.copy') await navigator.clipboard.writeText(text);
      if (id === 'chat.insert' && getActive()) {
        const t = getActive()!;
        t.content += (t.content.endsWith('\\n') ? '' : '\\n') + text;
        t.dirty = true;
        // reopen to refresh monaco
        openTab(t.path, t.content);
        paintTabs();
      }
    });
  });

  document.getElementById('presence-col')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { type: 'item', id: 'view.presence', label: 'Hide Omni Presence' },
      { type: 'item', id: 'app.resetLayout', label: 'Reset Layout' },
    ]);
    setMenuHandler(handleMenu);
  });

  document.getElementById('bottom-dock')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { type: 'item', id: 'term.clear', label: 'Clear' },
      { type: 'item', id: 'term.new', label: 'New Terminal' },
      { type: 'sep' },
      { type: 'item', id: 'panel.console', label: 'Show Console' },
    ]);
    setMenuHandler(handleMenu);
  });
}


async function boot() {
  if (params.get('shot') === '1') document.documentElement.classList.add('shot');
  else document.documentElement.classList.remove('shot');
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
  (window as any).__codingChat = chat;
  const openGeneratedFiles = async (files: string[]) => {
    let root = '';
    try { const cfg = await api.config(); root = (cfg as any).projectRoot || ''; } catch {}
    for (const f of files) {
      const abs = f.startsWith('/') || /^[A-Za-z]:[\\/]/.test(f) ? f : (root ? `${root.replace(/[\\/]$/, '')}/${f}` : f);
      try {
        const r = await api.readFile(abs);
        openTab(r.path || abs, r.content || '');
      } catch (e) {
        console.warn('open generated failed', abs, e);
        try { openTab(abs, '// could not load file'); } catch {}
      }
    }
    try { await refreshTree(); } catch {}
  };
  chat.setOnFilesWritten(openGeneratedFiles);
  (window as any).__omniOpenFiles = openGeneratedFiles;
  assistant = FloatingAssistant.create(document.getElementById('assistant-root')!);
  (window as any).__omniReloadConfig = () => assistant.reloadConfig();
  (window as any).__codingChat = chat;
  (assistant as any).moods = MOODS;
  setTimeout(() => assistant.greet(), 500);
  dockPresence();
  initDock();
  installMenus();
  installContextMenus();
  // periodic presence remarks
  setInterval(() => {
    try { assistant.maybeVolunteer('User is coding in OMNI-CODE. Offer a short witty remark or stay silent.'); } catch {}
  }, 90000);
  bindChrome();
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

// Auto-check updates toast
(async () => {
  try {
    const { loadOmniConfig } = await import('./omni-config');
    const cfg = loadOmniConfig();
    if (!cfg.autoCheckUpdates) return;
    const r = await api.updateCheck();
    if (!r.available) return;
    const toast = document.createElement('div');
    toast.className = 'toast-update';
    toast.innerHTML = `<span>Update ${r.latest} available</span><button type="button" id="toast-upd">Update</button><button type="button" id="toast-dismiss">Later</button>`;
    document.body.appendChild(toast);
    toast.querySelector('#toast-dismiss')?.addEventListener('click', () => toast.remove());
    toast.querySelector('#toast-upd')?.addEventListener('click', async () => {
      const mode = new URLSearchParams(location.search).get('mode') || 'plain';
      const a = await api.updateApply(mode);
      toast.querySelector('span')!.textContent = a.message;
    });
  } catch { /* ignore */ }
})();
