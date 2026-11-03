/** Menubar dropdowns + context menus. Suppresses native browser menu. */

export type MenuItem =
  | { type: 'item'; id: string; label: string; shortcut?: string; disabled?: boolean; checked?: boolean; icon?: string }
  | { type: 'sep' }
  | { type: 'sub'; label: string; icon?: string; children: MenuItem[] };

type Handler = (id: string) => void;

let openRoot: HTMLElement | null = null;
let handler: Handler | null = null;

export function setMenuHandler(h: Handler) {
  handler = h;
}

function closeAll() {
  document.querySelectorAll('.menu-dropdown, .ctx-menu').forEach((el) => el.remove());
  document.querySelectorAll('.menubar button.open').forEach((b) => b.classList.remove('open'));
  openRoot = null;
}

function renderItems(items: MenuItem[], depth = 0): HTMLElement {
  const ul = document.createElement('div');
  ul.className = depth ? 'menu-dropdown sub' : 'menu-dropdown';
  for (const it of items) {
    if (it.type === 'sep') {
      const s = document.createElement('div');
      s.className = 'menu-sep';
      ul.appendChild(s);
      continue;
    }
    if (it.type === 'sub') {
      const row = document.createElement('div');
      row.className = 'menu-item has-sub';
      row.innerHTML = `<span class="mi-label">${it.icon || ''}${escapeHtml(it.label)}</span><span class="mi-arrow">▸</span>`;
      const sub = renderItems(it.children, depth + 1);
      row.appendChild(sub);
      row.addEventListener('mouseenter', () => {
        ul.querySelectorAll(':scope > .menu-item.has-sub > .menu-dropdown').forEach((x) => ((x as HTMLElement).style.display = 'none'));
        sub.style.display = 'block';
      });
      ul.appendChild(row);
      continue;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'menu-item' + (it.disabled ? ' disabled' : '') + (it.checked ? ' checked' : '');
    row.dataset.id = it.id;
    row.innerHTML = `<span class="mi-check">${it.checked ? '✓' : ''}</span><span class="mi-label">${it.icon || ''}${escapeHtml(it.label)}</span><span class="mi-key">${it.shortcut || ''}</span>`;
    if (!it.disabled) {
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = it.id;
        closeAll();
        handler?.(id);
      });
    }
    ul.appendChild(row);
  }
  return ul;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function bindMenubar(bar: HTMLElement, menus: Record<string, MenuItem[]>) {
  bar.querySelectorAll('button[data-menu]').forEach((btn) => {
    const fresh = btn.cloneNode(true) as HTMLElement;
    btn.replaceWith(fresh);
    const key = fresh.dataset.menu!;
    fresh.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const already = fresh.classList.contains('open');
      closeAll();
      if (already) return;
      const items = menus[key];
      if (!items) return;
      fresh.classList.add('open');
      const dd = renderItems(items);
      const r = fresh.getBoundingClientRect();
      dd.style.left = `${r.left}px`;
      dd.style.top = `${r.bottom}px`;
      document.body.appendChild(dd);
      openRoot = dd;
    });
    fresh.addEventListener('mouseenter', () => {
      if (openRoot && !fresh.classList.contains('open')) fresh.click();
    });
  });
}

export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  closeAll();
  const dd = renderItems(items);
  dd.classList.add('ctx-menu');
  document.body.appendChild(dd);
  const w = dd.offsetWidth;
  const h = dd.offsetHeight;
  const left = Math.min(x, window.innerWidth - w - 8);
  const top = Math.min(y, window.innerHeight - h - 8);
  dd.style.left = `${Math.max(4, left)}px`;
  dd.style.top = `${Math.max(4, top)}px`;
  openRoot = dd;
}

export function installGlobalMenuGuards() {
  document.addEventListener('click', () => closeAll());
  document.addEventListener('contextmenu', (e) => {
    // Handled by specific targets; suppress default everywhere in app chrome
    const t = e.target as HTMLElement;
    if (t.closest('#app, #assistant-root, .menu-dropdown, .ctx-menu')) {
      e.preventDefault();
    }
  });
  window.addEventListener('blur', () => closeAll());
  window.addEventListener('resize', () => closeAll());
}

export function panelMenuItems(visible: Record<string, boolean>): MenuItem[] {
  const panels: { id: string; label: string }[] = [
    { id: 'panel.explorer', label: 'Explorer / File system' },
    { id: 'panel.editor', label: 'Editor' },
    { id: 'panel.chat', label: 'Coding Agent chat' },
    { id: 'panel.presence', label: 'Omni the Presence' },
    { id: 'panel.console', label: 'Console' },
    { id: 'panel.terminal', label: 'Terminal' },
    { id: 'panel.outline', label: 'Outline' },
    { id: 'panel.timeline', label: 'Timeline' },
    { id: 'panel.search', label: 'Search' },
    { id: 'panel.scm', label: 'Source control' },
    { id: 'panel.problems', label: 'Problems' },
    { id: 'panel.output', label: 'Output' },
  ];
  return panels.map((p) => ({
    type: 'item' as const,
    id: p.id,
    label: p.label,
    checked: !!visible[p.id.replace('panel.', '')],
  }));
}

export function buildMenus(opts: { ultra: boolean; panels: Record<string, boolean> }): Record<string, MenuItem[]> {
  return {
    file: [
      { type: 'item', id: 'file.new', label: 'New File', shortcut: 'Ctrl+N' },
      { type: 'item', id: 'file.newFolder', label: 'New Folder' },
      { type: 'sep' },
      { type: 'item', id: 'file.open', label: 'Open Folder…', shortcut: 'Ctrl+K Ctrl+O' },
      { type: 'sep' },
      { type: 'item', id: 'file.save', label: 'Save', shortcut: 'Ctrl+S' },
      { type: 'item', id: 'file.saveAs', label: 'Save As…' },
      { type: 'item', id: 'file.saveAll', label: 'Save All', shortcut: 'Ctrl+K S' },
      { type: 'sep' },
      { type: 'item', id: 'file.close', label: 'Close Editor', shortcut: 'Ctrl+W' },
      { type: 'item', id: 'file.closeOthers', label: 'Close Others' },
      { type: 'item', id: 'file.closeAll', label: 'Close All' },
      { type: 'sep' },
      { type: 'item', id: 'file.reveal', label: 'Reveal in File Explorer' },
      { type: 'item', id: 'file.copyPath', label: 'Copy Path' },
      { type: 'sep' },
      { type: 'item', id: 'file.update', label: 'Check for Updates…' },
    ],
    edit: [
      { type: 'item', id: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z' },
      { type: 'item', id: 'edit.redo', label: 'Redo', shortcut: 'Ctrl+Y' },
      { type: 'sep' },
      { type: 'item', id: 'edit.cut', label: 'Cut', shortcut: 'Ctrl+X' },
      { type: 'item', id: 'edit.copy', label: 'Copy', shortcut: 'Ctrl+C' },
      { type: 'item', id: 'edit.paste', label: 'Paste', shortcut: 'Ctrl+V' },
      { type: 'item', id: 'edit.duplicate', label: 'Duplicate Line', shortcut: 'Shift+Alt+↓' },
      { type: 'sep' },
      { type: 'item', id: 'edit.find', label: 'Find', shortcut: 'Ctrl+F' },
      { type: 'item', id: 'edit.replace', label: 'Replace', shortcut: 'Ctrl+H' },
    ],
    selection: [
      { type: 'item', id: 'sel.all', label: 'Select All', shortcut: 'Ctrl+A' },
      { type: 'item', id: 'sel.expand', label: 'Expand Selection' },
    ],
    view: [
      { type: 'item', id: 'view.explorer', label: 'Explorer' },
      { type: 'item', id: 'view.terminal', label: 'Terminal' },
      { type: 'item', id: 'view.console', label: 'Console' },
      { type: 'item', id: 'view.presence', label: 'Omni the Presence' },
      { type: 'sep' },
      { type: 'item', id: 'view.fullscreen', label: 'Toggle Full Screen', shortcut: 'F11' },
    ],
    go: [
      { type: 'item', id: 'go.file', label: 'Go to File…', shortcut: 'Ctrl+P' },
      { type: 'item', id: 'go.line', label: 'Go to Line…', shortcut: 'Ctrl+G' },
    ],
    run: [
      { type: 'item', id: 'run.start', label: 'Start Debugging', shortcut: 'F5' },
      { type: 'item', id: 'run.without', label: 'Run Without Debugging', shortcut: 'Ctrl+F5' },
    ],
    terminal: [
      { type: 'item', id: 'term.new', label: 'New Terminal', shortcut: 'Ctrl+`' },
      { type: 'item', id: 'term.clear', label: 'Clear' },
    ],
    app: [
      { type: 'item', id: 'app.resetLayout', label: 'Reset Layout' },
      { type: 'sub', label: 'Panels', children: panelMenuItems(opts.panels) },
      { type: 'sep' },
      { type: 'item', id: 'app.settings', label: 'Settings…', shortcut: 'Ctrl+,' },
      { type: 'item', id: 'app.update', label: 'Check for Updates…' },
    ],
    help: [
      { type: 'item', id: 'help.docs', label: 'Documentation' },
      { type: 'item', id: 'help.about', label: 'About OMNI-CODE' },
    ],
  };
}
