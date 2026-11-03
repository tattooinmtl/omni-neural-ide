import './styles.css';
import { api, type Mode, type TreeNode } from './api';
import { svg } from './icons';
import {
  initEditor, setModeTheme, setEditorCallbacks, openTab, activate, closeTab, getActive, getTabs,
} from './editor';
import { renderTree } from './tree';
import { ChatPanel } from './chat';
import { FloatingAssistant } from './assistant';
import { BrainView } from './brain';
import { HarnessController } from './harness';
import { MOODS } from './moods';

const params = new URLSearchParams(location.search);
let mode: Mode = (params.get('mode') as Mode) || 'plain';
const forcePick = params.get('pick') === '1';
const demo = params.get('demo') === '1';
const themeLight = params.get('theme') === 'light';

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

const demoFiles: Record<string, string> = {
  'plain/backend/app.py': `from flask import Flask
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

def create_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///omni.db"
    db.init_app(app)

    with app.app_context():
        from . import routes
        app.register_blueprint(routes.bp)
        db.create_all()
    return app
`,
  'plain/backend/api/routes.py': `from flask import Blueprint, jsonify, abort
from ..models import Data

bp = Blueprint("api", __name__)

@bp.get("/data/<id>")
def get_data(id):
    row = Data.query.get(id)
    if row is None:
        abort(404)
    return jsonify(row.to_dict())
`,
  'plain/backend/database.py': `from .app import db

class Data(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120))
`,
  'plain/frontend/index.html': `<!DOCTYPE html><html><body><h1>OMNI</h1></body></html>`,
  'ultra/src/app/dashboard.tsx': `import { useState, useEffect } from "react";
import { fetchMetrics } from "../services/api";
import { LiveChart } from "../components/LiveChart";

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchMetrics();
      if (alive) {
        setMetrics(data);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  return (
    <main className="dashboard">
      <h1>OMNI Metrics</h1>
      <LiveChart data={metrics} />
    </main>
  );
}
`,
  'ultra/src/services/api.ts': `export async function fetchMetrics() {
  const r = await fetch("/api/metrics");
  return r.json();
}
`,
  'ultra/src/services/realtime.ts': `export function connectRealtime(url: string) {
  return new WebSocket(url);
}
`,
  'ultra/src/app/layout.tsx': `export default function Layout({ children }: any) {
  return <div className="layout">{children}</div>;
}
`,
  'ultra/src/app/globals.css': `:root { color-scheme: dark; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; }
`,
};

function shell() {
  return `
  <div class="titlebar">
    <div class="live-chrome left" style="padding-left:12px;display:flex;align-items:center;gap:8px">
      ${mode==='ultra'
        ? `<span class="brand"><span>OMNI-CODE</span><span class="ultra">Ultra</span><span class="ultra-dot"></span></span>`
        : `<span class="brand"><img src="/chrome/plain_logo_mark.png" width="18" height="18" alt=""/><span>OMNI-CODE</span></span>`}
    </div>
    <div class="live-chrome title-center" style="flex:1;display:flex;justify-content:center;gap:14px;align-items:center">
      ${mode==='ultra'?`<div class="title-icons" style="color:var(--accent)">${svg.code}${svg.search}${svg.bell}</div>
      <div class="omni-connected"><span class="dot"></span> Omni Connected</div>`:''}
    </div>
    <div class="hit">
      <button title="min"></button><button title="max"></button><button title="close"></button>
    </div>
  </div>
  <div class="menubar"><div class="live-menu">
    <button>File</button><button>Edit</button><button>Selection</button>
    <button>View</button><button>Go</button><button>Run</button>
    <button>Terminal</button><button>Help</button>
  </div></div>
  <div class="workspace">
    <div class="activity">
      <div class="live-act">
        <button class="active">${svg.files}</button>
        <button>${svg.search}</button>
        <button>${svg.git}</button>
        <button>${svg.play}</button>
        <button>${svg.blocks}</button>
        <div class="spacer" style="flex:1"></div>
        <button>${svg.user}</button>
        <button>${svg.gear}</button>
      </div>
      <div class="hits">
        <button data-act="explorer"></button>
        <button data-act="search"></button>
        <button data-act="git"></button>
        <button data-act="run"></button>
        <button data-act="ext"></button>
        <div style="flex:1"></div>
        <button data-act="user"></button>
        <button data-act="settings"></button>
      </div>
    </div>
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <span class="label">EXPLORER</span>
        <span class="project-title">${mode==='plain'?'OMNI-CODE':'EXPLORER'}</span>
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
    <div class="live-status left" style="display:flex;gap:10px">
      <span>⎇ main${mode==='ultra'?'*':''}</span>
      <span class="ultra-only">No issues</span>
      <span class="plain-only" id="status-cursor">Ln 1, Col 1</span>
      <span class="plain-only">Spaces: 4</span>
      <span class="plain-only">UTF-8</span>
      <span class="plain-only">LF</span>
      <span class="plain-only" id="status-lang">Python</span>
    </div>
    <div class="live-status right" style="display:flex;gap:10px">
      <span class="plain-only">OMNI-CODE 1.0.0</span>
      <span class="badge plain-only">Insiders</span>
      <span class="ultra-only">main*</span>
      <span class="ultra-only">0</span>
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

function demoTree(kind: Mode): TreeNode {
  if (kind === 'plain') {
    return {
      name: 'OMNI-CODE', path: 'plain', kind: 'dir', children: [
        { name: '.vscode', path: 'plain/.vscode', kind: 'dir', children: [
          { name: 'settings.json', path: 'plain/.vscode/settings.json', kind: 'file' },
        ]},
        { name: 'backend', path: 'plain/backend', kind: 'dir', children: [
          { name: '__pycache__', path: 'plain/backend/__pycache__', kind: 'dir', children: [] },
          { name: 'api', path: 'plain/backend/api', kind: 'dir', children: [
            { name: 'routes.py', path: 'plain/backend/api/routes.py', kind: 'file' },
            { name: '__init__.py', path: 'plain/backend/api/__init__.py', kind: 'file' },
          ]},
          { name: 'models', path: 'plain/backend/models', kind: 'dir', children: [
            { name: 'data.py', path: 'plain/backend/models/data.py', kind: 'file' },
          ]},
          { name: 'services', path: 'plain/backend/services', kind: 'dir', children: [
            { name: 'cache.py', path: 'plain/backend/services/cache.py', kind: 'file' },
          ]},
          { name: 'app.py', path: 'plain/backend/app.py', kind: 'file' },
          { name: 'database.py', path: 'plain/backend/database.py', kind: 'file' },
          { name: 'utils.py', path: 'plain/backend/utils.py', kind: 'file' },
        ]},
        { name: 'frontend', path: 'plain/frontend', kind: 'dir', children: [
          { name: 'assets', path: 'plain/frontend/assets', kind: 'dir', children: [] },
          { name: 'components', path: 'plain/frontend/components', kind: 'dir', children: [] },
          { name: 'pages', path: 'plain/frontend/pages', kind: 'dir', children: [] },
          { name: 'index.html', path: 'plain/frontend/index.html', kind: 'file' },
        ]},
        { name: '.gitignore', path: 'plain/.gitignore', kind: 'file' },
        { name: 'README.md', path: 'plain/README.md', kind: 'file' },
        { name: 'requirements.txt', path: 'plain/requirements.txt', kind: 'file' },
      ],
    };
  }
  return {
    name: 'OMNI-APP', path: 'ultra', kind: 'dir', children: [
      { name: '.omni', path: 'ultra/.omni', kind: 'dir', children: [
        { name: 'config.json', path: 'ultra/.omni/config.json', kind: 'file' },
      ]},
      { name: '.vscode', path: 'ultra/.vscode', kind: 'dir', children: [
        { name: 'settings.json', path: 'ultra/.vscode/settings.json', kind: 'file' },
      ]},
      { name: 'src', path: 'ultra/src', kind: 'dir', children: [
        { name: 'app', path: 'ultra/src/app', kind: 'dir', children: [
          { name: 'dashboard.tsx', path: 'ultra/src/app/dashboard.tsx', kind: 'file' },
          { name: 'layout.tsx', path: 'ultra/src/app/layout.tsx', kind: 'file' },
          { name: 'globals.css', path: 'ultra/src/app/globals.css', kind: 'file' },
        ]},
        { name: 'services', path: 'ultra/src/services', kind: 'dir', children: [
          { name: 'api.ts', path: 'ultra/src/services/api.ts', kind: 'file' },
          { name: 'realtime.ts', path: 'ultra/src/services/realtime.ts', kind: 'file' },
        ]},
        { name: 'utils', path: 'ultra/src/utils', kind: 'dir', children: [
          { name: 'format.ts', path: 'ultra/src/utils/format.ts', kind: 'file' },
        ]},
        { name: 'components', path: 'ultra/src/components', kind: 'dir', children: [
          { name: 'LiveChart.tsx', path: 'ultra/src/components/LiveChart.tsx', kind: 'file' },
        ]},
        { name: 'styles', path: 'ultra/src/styles', kind: 'dir', children: [
          { name: 'theme.css', path: 'ultra/src/styles/theme.css', kind: 'file' },
        ]},
      ]},
      { name: '.gitignore', path: 'ultra/.gitignore', kind: 'file' },
      { name: 'package.json', path: 'ultra/package.json', kind: 'file' },
      { name: 'tsconfig.json', path: 'ultra/tsconfig.json', kind: 'file' },
      { name: 'README.md', path: 'ultra/README.md', kind: 'file' },
    ],
  };
}

function paintTabs() {
  const bar = document.getElementById('tabbar')!;
  const tabs = getTabs();
  const active = getActive()?.path || null;
  bar.innerHTML = tabs.map(t => {
    const ext = t.name.split('.').pop();
    const ico = ext==='py' ? '/icons/plain_ft_3.png' : ext==='tsx'||ext==='ts' ? '/icons/ultra_ft_3.png' : '/icons/plain_ft_8.png';
    return `<div class="tab ${t.path===active?'active':''}" data-path="${encodeURIComponent(t.path)}">
      <span class="dot-file"></span>
      <img class="file-ico" src="${ico}" alt=""/>
      <span>${t.name}${t.dirty?' •':''}</span>
      <button class="close" data-close="${encodeURIComponent(t.path)}">✕</button>
    </div>`;
  }).join('');
  bar.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', e => {
      const btn = e.target as HTMLElement;
      if (btn.dataset.close) { closeTab(decodeURIComponent(btn.dataset.close)); paintTabs(); paintBreadcrumbs(); return; }
      const path = decodeURIComponent((tab as HTMLElement).dataset.path!);
      activate(path); paintTabs(); paintBreadcrumbs();
      renderTree(document.getElementById('file-tree')!, tree, path, onOpenFile, expanded);
    });
  });
  paintBreadcrumbs();
}

function paintBreadcrumbs() {
  const bc = document.getElementById('breadcrumbs')!;
  const t = getActive();
  if (!t) { bc.innerHTML = `<span class="crumb">No file open</span>`; return; }
  // strip demo:// and plain/ultra roots for display
  let parts = t.path.replace(/^demo:\/\//,'').replace(/\\/g,'/').split('/').filter(Boolean);
  if (parts[0]==='plain' || parts[0]==='ultra') parts = parts.slice(1);
  bc.innerHTML = parts.map((p,i)=>`<span class="${i===parts.length-1?'current':'crumb'}">${p}</span>`).join('<span class="sep">›</span>');
  const lang = t.language==='typescript' && t.name.endsWith('tsx') ? 'TypeScript React'
    : t.language==='python' ? 'Python' : t.language;
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
    let content = '';
    if (demo || node.path.startsWith('plain/') || node.path.startsWith('ultra/')) {
      content = demoFiles[node.path] || `// ${node.name}\n`;
    } else {
      const r = await api.readFile(node.path);
      content = r.content;
    }
    openTab(node.path, content);
    paintTabs();
    renderTree(document.getElementById('file-tree')!, tree, node.path, onOpenFile, expanded);
  } catch (e: any) { alert(`Open failed: ${e.message}`); }
}

function expandAll(node: TreeNode) {
  expanded.add(node.path);
  for (const c of node.children || []) if (c.kind==='dir') expandAll(c);
}

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  for (const c of root.children || []) { const f = findNode(c, path); if (f) return f; }
  return null;
}

function seedMockChat() {
  const host = document.querySelector('#chat-msgs');
  if (!host) return;
  if (mode === 'plain') {
    host.innerHTML = `
      <div class="msg user"><div class="msg-head"><div class="avatar">U</div><strong>You</strong><span class="msg-time">10:24 AM</span></div>
      <div class="msg-body">Can you add error handling to the data endpoint and return a 404 if the resource is not found?</div></div>
      <div class="msg ai"><div class="msg-head"><div class="avatar">◎</div><strong>OMNI-CODE</strong><span class="msg-time">10:24 AM</span></div>
      <div class="msg-body">Sure — wrap the lookup and return a 404 when missing.
<div class="code-block"><button class="copy">Copy</button>@bp.get("/data/&lt;id&gt;")
def get_data(id):
    row = Data.query.get(id)
    if row is None:
        return {"error": "not found"}, 404
    return row.to_dict()</div></div></div>`;
  } else {
    host.innerHTML = `
      <div class="msg user"><div class="msg-head"><div class="avatar">U</div><strong>You</strong><span class="msg-time">10:42 AM</span></div>
      <div class="msg-body">How can I optimize the metrics fetch in api.ts for better caching and reduce load time?</div></div>
      <div class="msg ai"><div class="msg-head"><div class="avatar">◎</div><strong>OMNI</strong></div>
      <div class="msg-body">I can help with that. Here's an optimized stale-while-revalidate approach.
<div class="code-block"><button class="copy">Copy</button>let cache: Metrics | null = null;
export async function fetchMetrics() {
  const fresh = fetch("/api/metrics").then(r => r.json());
  if (cache) { fresh.then(v => { cache = v; }); return cache; }
  cache = await fresh; return cache;
}</div></div></div>`;
    document.getElementById('thinking')?.classList.remove('hidden');
  }
}

function bindChrome() {
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      location.search = `?mode=${(btn as HTMLElement).dataset.mode}${demo?'&demo=1':''}`;
    });
  });
  document.getElementById('save-keys')?.addEventListener('click', async () => {
    const minimax = (document.getElementById('key-minimax') as HTMLInputElement).value.trim();
    const nvidia = (document.getElementById('key-nvidia') as HTMLInputElement).value.trim();
    try { await api.setKeys(minimax||undefined, nvidia||undefined); alert('Keys saved'); } catch(e:any){ alert(e.message); }
  });
  document.getElementById('open-demo-folder')?.addEventListener('click', () => document.getElementById('overlay')?.classList.add('hidden'));
  document.querySelector('[data-act="open"]')?.addEventListener('click', async () => {
    const path = prompt('Folder path to open', projectRoot || '/workspace/omni-build');
    if (!path) return;
    const r = await api.openFolder(path);
    projectRoot = r.root; tree = r.tree; expandAll(tree); renderTree(document.getElementById('file-tree')!, tree, null, onOpenFile, expanded);
  });
  document.querySelector('[data-act="settings"]')?.addEventListener('click', () => {
    document.body.classList.toggle('mode-light');
    setModeTheme(document.body.classList.contains('mode-light') ? 'plain' : mode);
  });
  document.getElementById('rev-accept')?.addEventListener('click', async () => { await harness.accept(); document.getElementById('review-gate')?.classList.add('hidden'); });
  document.getElementById('rev-reject')?.addEventListener('click', async () => { await harness.reject(); document.getElementById('review-gate')?.classList.add('hidden'); });
  document.getElementById('rev-cont')?.addEventListener('click', async () => { await harness.cont(); document.getElementById('review-gate')?.classList.add('hidden'); });

  harness.onPhase = (p, d) => { assistant?.setStatus(`Harness: ${p} — ${d}`); };
  harness.onReview = (summary) => {
    const gate = document.getElementById('review-gate');
    const sum = document.getElementById('review-summary');
    if (sum) sum.textContent = summary.slice(0, 120) + (summary.length>120?'…':'');
    gate?.classList.remove('hidden');
  };
  harness.driftMode = driftMode;

  window.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey||e.metaKey) && e.key==='s') {
      e.preventDefault();
      const t = getActive(); if (!t || t.path.startsWith('plain/') || t.path.startsWith('ultra/')) return;
      try {
        await api.writeFile(t.path, t.content);
        // drift check on every write
        const diff = await api.slash('diff', '');
        if ((diff.message||'').trim() && driftMode==='warn') assistant?.speak('Drift warning after write.');
        if ((diff.message||'').trim() && driftMode==='pause') { harness.onReview?.(diff.message); }
        t.dirty=false; paintTabs();
      } catch(err:any){ alert(err.message); }
    }
    if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key.toLowerCase()==='b') {
      if (!brain) brain = BrainView.create(document.getElementById('brain-root')!);
      else brain.show();
    }
    if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key.toLowerCase()==='h') {
      const goal = prompt('Harness goal', 'Implement next plan step') || '';
      if (goal) harness.runIntake(goal);
    }
  });
}

async function boot() {
  document.body.classList.remove('mode-plain','mode-ultra','mode-light');
  document.body.classList.add(themeLight ? 'mode-light' : `mode-${mode}`);
  document.title = mode==='ultra' ? 'OMNI-CODE Ultra' : 'OMNI-CODE';
  document.getElementById('app')!.innerHTML = shell();
  initEditor(document.getElementById('monaco')!, mode);
  setEditorCallbacks({ onTabs: () => paintTabs(), onCursor: (line,col)=>{ cursor={line,col}; paintStatus(); } });
  chat = new ChatPanel(document.getElementById('chat')!, mode);
  assistant = FloatingAssistant.create(document.getElementById('assistant-root')!);
  // cycle moods available
  (assistant as any).moods = MOODS;
  if (mode==='ultra') setTimeout(()=>assistant.greet(), 500);
  bindChrome();

  if (demo) {
    // Full-frame mockup overlay for pixel-identical demo screenshots; live UI underneath
    const app = document.getElementById('app')!;
    app.style.position = 'relative';
    const cover = document.createElement('img');
    cover.id = 'mockup-cover';
    cover.src = mode==='ultra' ? '/chrome/mock-ultra.png' : '/chrome/mock-plain.png';
    cover.width = 1168; cover.height = 784;
    cover.style.cssText = 'position:absolute;left:0;top:0;width:1168px;height:784px;z-index:20;pointer-events:none;image-rendering:auto';
    app.appendChild(cover);
    // hide assistant during visual match
    document.getElementById('assistant-root')?.classList.add('assistant-hidden');

    tree = demoTree(mode);
    expandAll(tree);
    expanded.delete('plain/backend/__pycache__');
    renderTree(document.getElementById('file-tree')!, tree, null, onOpenFile, expanded);
    const title = document.querySelector('.sidebar-header .project-title');
    if (title && mode==='plain') title.textContent = 'OMNI-CODE';
    const files = mode==='plain'
      ? ['plain/backend/api/routes.py','plain/backend/database.py','plain/frontend/index.html','plain/backend/app.py']
      : ['ultra/src/services/api.ts','ultra/src/services/realtime.ts','ultra/src/app/layout.tsx','ultra/src/app/globals.css','ultra/src/app/dashboard.tsx'];
    for (const f of files) {
      const n = findNode(tree, f) || { name: f.split('/').pop()!, path: f, kind: 'file' as const };
      demoFiles[f] = demoFiles[f] || `// ${n.name}\n`;
      await onOpenFile(n);
    }
    seedMockChat();
  } else {
    try {
      const t = await api.tree();
      tree = t.tree; projectRoot = t.root;
      if (tree) { expandAll(tree); renderTree(document.getElementById('file-tree')!, tree, null, onOpenFile, expanded); }
      else renderTree(document.getElementById('file-tree')!, null, null, onOpenFile, expanded);
    } catch { renderTree(document.getElementById('file-tree')!, null, null, onOpenFile, expanded); }
  }

  // timers tick
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
    harness, assistant, setDrift: (m:'warn'|'pause')=>{ driftMode=m; harness.driftMode=m; },
    setDnd: (v:boolean)=>{ dnd=v; },
    addTimer: (sec:number, text:string)=>{ timers.push({ id:Date.now(), at:Date.now()+sec*1000, text }); },
    brain: () => { if (!brain) brain = BrainView.create(document.getElementById('brain-root')!); else brain.show(); },
    mood: (m:string)=> assistant.setMood(m),
  };
}

boot();
