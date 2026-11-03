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
  highlights: string[] = [],
) {
  host.innerHTML = '';
  if (!root) {
    host.innerHTML = `<div class="tree-item" style="color:var(--fg-mute)">Open a folder to begin</div>`;
    return;
  }
  const hi = new Set(highlights.filter(Boolean));
  if (activePath) hi.add(activePath);

  const rootLabel = document.createElement('div');
  rootLabel.className = 'tree-root-label';
  rootLabel.innerHTML = `<span class="chev">${svg.chevDown}</span><span class="icon">${iconFor(root)}</span> ${escapeHtml(root.name)}`;
  host.appendChild(rootLabel);

  const walk = (nodes: TreeNode[] | undefined, depth: number) => {
    if (!nodes) return;
    for (const n of nodes) {
      const el = document.createElement('div');
      const matched = [...hi].some(h => h === n.path || h.endsWith('/' + n.name));
      el.className = 'tree-item';
      if (n.path === activePath) el.classList.add('active', 'selected');
      else if (matched) el.classList.add('active', 'row-hi');
      el.style.setProperty('--depth', String(depth));
      const isDir = n.kind === 'dir';
      const open = expanded.has(n.path);
      el.innerHTML = `
        <span class="chev">${isDir ? (open ? svg.chevDown : svg.chevRight) : ''}</span>
        <span class="icon">${iconFor(n)}</span>
        <span class="name">${escapeHtml(n.name)}</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isDir) {
          if (expanded.has(n.path)) expanded.delete(n.path);
          else expanded.add(n.path);
          renderTree(host, root, activePath, onOpen, expanded, highlights);
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
  const dirOrder = ['.omni', '.vscode', 'backend', 'frontend', 'src', '__pycache__', 'api', 'models', 'app', 'services', 'utils', 'assets', 'components', 'pages', 'styles', 'ui', 'charts'];
  const fileOrder = ['config.json', 'settings.json', 'layout.tsx', 'dashboard.tsx', 'routes.py', 'database.py', 'utils.py', 'app.py', 'index.html', 'api.ts', 'realtime.ts', 'format.ts', 'cn.ts', 'globals.css', '.gitignore', 'package.json', 'tsconfig.json', 'README.md', 'requirements.txt'];
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
