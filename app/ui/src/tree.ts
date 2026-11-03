import type { TreeNode } from './api';
import { svg } from './icons';

function iconFor(node: TreeNode): string {
  if (node.kind === 'dir') {
    const n = node.name.toLowerCase();
    if (n === 'backend') return svg.folderGreen;
    if (n.startsWith('.')) return svg.folderBlue;
    return svg.folder;
  }
  const n = node.name.toLowerCase();
  if (n.endsWith('.py')) return svg.py;
  if (n.endsWith('.tsx') || n.endsWith('.ts')) return svg.ts;
  if (n.endsWith('.css')) return svg.css;
  if (n.endsWith('.html')) return svg.html;
  if (n.endsWith('.md')) return svg.md;
  if (n.endsWith('.json')) return svg.json;
  return svg.file;
}

export function renderTree(
  host: HTMLElement,
  root: TreeNode | null,
  activePath: string | null,
  onOpen: (node: TreeNode) => void,
  expanded: Set<string>,
) {
  host.innerHTML = '';
  if (!root) {
    host.innerHTML = `<div class="tree-item" style="color:var(--fg-mute)">Open a folder to begin</div>`;
    return;
  }
  const rootLabel = document.createElement('div');
  rootLabel.className = 'tree-root-label';
  rootLabel.innerHTML = `<span class="chev">▼</span><span class="icon">${iconFor(root)}</span> ${escapeHtml(root.name)}`;
  host.appendChild(rootLabel);

  const walk = (nodes: TreeNode[] | undefined, depth: number) => {
    if (!nodes) return;
    for (const n of nodes) {
      const el = document.createElement('div');
      el.className = 'tree-item' + (n.path === activePath ? ' active' : '');
      el.style.setProperty('--depth', String(depth));
      const isDir = n.kind === 'dir';
      const open = expanded.has(n.path);
      el.innerHTML = `
        <span class="chev">${isDir ? (open ? '▼' : '▶') : ''}</span>
        <span class="icon">${iconFor(n)}</span>
        <span class="name">${escapeHtml(n.name)}</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isDir) {
          if (expanded.has(n.path)) expanded.delete(n.path);
          else expanded.add(n.path);
          renderTree(host, root, activePath, onOpen, expanded);
        } else onOpen(n);
      });
      host.appendChild(el);
      if (isDir && open) walk(sortNodes(n.children), depth + 1);
    }
  };
  walk(sortNodes(root.children), 0);
}

function sortNodes(nodes: TreeNode[] | undefined): TreeNode[] | undefined {
  if (!nodes) return nodes;
  const dirOrder = ['.vscode', '.omni', 'backend', 'frontend', 'src', '__pycache__', 'api', 'models', 'services', 'app', 'components', 'services', 'styles', 'utils', 'assets', 'pages', 'charts', 'ui'];
  const fileOrder = ['routes.py', 'database.py', 'utils.py', 'app.py', 'index.html', 'dashboard.tsx', 'layout.tsx', 'globals.css', 'api.ts', 'realtime.ts', 'cn.ts', 'format.ts', 'card.tsx', 'config.json', 'settings.json', '.gitignore', 'README.md', 'requirements.txt', 'package.json', 'tsconfig.json'];
  const rank = (n: TreeNode, list: string[]) => {
    const i = list.indexOf(n.name);
    return i >= 0 ? i : 1000;
  };
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    const list = a.kind === 'dir' ? dirOrder : fileOrder;
    const ra = rank(a, list), rb = rank(b, list);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  }).map(n => n.kind === 'dir' ? { ...n, children: sortNodes(n.children) } : n);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
