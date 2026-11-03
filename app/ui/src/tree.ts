import type { TreeNode } from './api';

function iconFor(node: TreeNode, mode: string): string {
  if (node.kind === 'dir') {
    const n = node.name.toLowerCase();
    if (n === 'backend') return '/icons/plain_ft_2.png';
    if (n.startsWith('.')) return '/icons/plain_ft_1.png';
    return '/icons/plain_ft_0.png';
  }
  const n = node.name.toLowerCase();
  if (n.endsWith('.py')) return '/icons/plain_ft_3.png';
  if (n.endsWith('.tsx') || n.endsWith('.ts')) return '/icons/ultra_ft_3.png';
  if (n.endsWith('.css')) return '/icons/ultra_ft_5.png';
  if (n.endsWith('.html')) return '/icons/plain_ft_6.png';
  if (n.endsWith('.md')) return '/icons/plain_ft_8.png';
  if (n.endsWith('.json')) return '/icons/ultra_ft_7.png';
  if (n.endsWith('.txt') || n === '.gitignore') return '/icons/plain_ft_9.png';
  return '/icons/plain_ft_10.png';
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
  const mode = document.body.classList.contains('mode-ultra') ? 'ultra' : 'plain';
  const rootLabel = document.createElement('div');
  rootLabel.className = 'tree-root-label';
  rootLabel.innerHTML = `<span class="chev">▼</span><img class="icon" src="${iconFor(root, mode)}" width="16" height="16"/> ${escapeHtml(root.name)}`;
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
        <img class="icon" src="${iconFor(n, mode)}" width="16" height="16" alt=""/>
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
      if (isDir && open) walk(n.children, depth + 1);
    }
  };
  walk(root.children, 0);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
