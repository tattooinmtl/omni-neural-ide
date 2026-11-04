/** Menubar dropdowns + context menus. Suppresses native browser menu. */

import { svg } from './icons';

export type MenuItem =
  | { type: 'item'; id: string; label: string; shortcut?: string; disabled?: boolean; checked?: boolean; icon?: string }
  | { type: 'sep' }
  | { type: 'sub'; label: string; icon?: string; children: MenuItem[] };

type Handler = (id: string) => void;

let openRoot: HTMLElement | null = null;
let handler: Handler | null = null;
let useIcons = false;

export function setMenuHandler(h: Handler) {
  handler = h;
}

export function setMenuIcons(on: boolean) {
  useIcons = on;
}

function ico(html?: string) {
  if (!useIcons || !html) return '';
  return `<span class="mi-ico">${html}</span>`;
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
      row.innerHTML = `<span class="mi-check"></span><span class="mi-label">${ico(it.icon)}${escapeHtml(it.label)}</span><span class="mi-arrow">▸</span>`;
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
    row.innerHTML = `<span class="mi-check">${it.checked ? '✓' : ''}</span><span class="mi-label">${ico(it.icon)}${escapeHtml(it.label)}</span><span class="mi-key">${it.shortcut || ''}</span>`;
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
    const t = e.target as HTMLElement;
    if (t.closest('#app, #assistant-root, .menu-dropdown, .ctx-menu')) {
      e.preventDefault();
    }
  });
  window.addEventListener('blur', () => closeAll());
  window.addEventListener('resize', () => closeAll());
}

export function panelMenuItems(visible: Record<string, boolean>): MenuItem[] {
  const panels: { id: string; label: string; icon: string }[] = [
    { id: 'panel.explorer', label: 'Explorer / File system', icon: svg.menuFolder },
    { id: 'panel.editor', label: 'Editor', icon: svg.menuFile },
    { id: 'panel.chat', label: 'Coding Agent chat', icon: svg.sparkle },
    { id: 'panel.presence', label: 'Omni the Presence', icon: svg.user },
    { id: 'panel.console', label: 'Console', icon: svg.menuConsole },
    { id: 'panel.terminal', label: 'Terminal', icon: svg.menuTerminal },
    { id: 'panel.outline', label: 'Outline', icon: svg.menuPanel },
    { id: 'panel.timeline', label: 'Timeline', icon: svg.menuLayout },
    { id: 'panel.search', label: 'Search', icon: svg.search },
    { id: 'panel.scm', label: 'Source control', icon: svg.git },
    { id: 'panel.problems', label: 'Problems', icon: svg.menuConsole },
    { id: 'panel.output', label: 'Output', icon: svg.menuConsole },
  ];
  return panels.map((p) => ({
    type: 'item' as const,
    id: p.id,
    label: p.label,
    icon: p.icon,
    checked: !!visible[p.id.replace('panel.', '')],
  }));
}

export function buildMenus(opts: { ultra: boolean; panels: Record<string, boolean> }): Record<string, MenuItem[]> {
  setMenuIcons(opts.ultra);
  return {
    file: [
      { type: 'item', id: 'file.new', label: 'New File', shortcut: 'Ctrl+N', icon: svg.menuFile },
      { type: 'item', id: 'file.newFolder', label: 'New Folder', icon: svg.menuFolder },
      { type: 'sep' },
      { type: 'item', id: 'file.open', label: 'Open Folder…', shortcut: 'Ctrl+K Ctrl+O', icon: svg.menuFolder },
      { type: 'sep' },
      { type: 'item', id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', icon: svg.menuSave },
      { type: 'item', id: 'file.saveAs', label: 'Save As…', shortcut: 'Ctrl+Shift+S', icon: svg.menuSaveAs },
      { type: 'item', id: 'file.saveAll', label: 'Save All', shortcut: 'Ctrl+K S', icon: svg.menuSave },
      { type: 'sep' },
      { type: 'item', id: 'file.close', label: 'Close Editor', shortcut: 'Ctrl+W', icon: svg.menuClose },
      { type: 'item', id: 'file.closeOthers', label: 'Close Others', icon: svg.menuClose },
      { type: 'item', id: 'file.closeAll', label: 'Close All', icon: svg.menuClose },
      { type: 'sep' },
      { type: 'item', id: 'file.reveal', label: 'Reveal in File Explorer', icon: svg.menuReveal },
      { type: 'item', id: 'file.copyPath', label: 'Copy Path', shortcut: 'Ctrl+K P', icon: svg.menuCopy },
      { type: 'sep' },
      { type: 'item', id: 'file.update', label: 'Check for Updates…', icon: svg.menuUpdate },
    ],
    edit: [
      { type: 'item', id: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z', icon: svg.menuMove },
      { type: 'item', id: 'edit.redo', label: 'Redo', shortcut: 'Ctrl+Y', icon: svg.menuMove },
      { type: 'sep' },
      { type: 'item', id: 'edit.cut', label: 'Cut', shortcut: 'Ctrl+X', icon: svg.menuCut },
      { type: 'item', id: 'edit.copy', label: 'Copy', shortcut: 'Ctrl+C', icon: svg.menuCopy },
      { type: 'item', id: 'edit.paste', label: 'Paste', shortcut: 'Ctrl+V', icon: svg.menuPaste },
      { type: 'item', id: 'edit.duplicate', label: 'Duplicate Line', shortcut: 'Shift+Alt+↓', icon: svg.menuDuplicate },
      { type: 'sep' },
      { type: 'item', id: 'edit.find', label: 'Find', shortcut: 'Ctrl+F', icon: svg.search },
      { type: 'item', id: 'edit.replace', label: 'Replace', shortcut: 'Ctrl+H', icon: svg.menuRename },
    ],
    selection: [
      { type: 'item', id: 'sel.all', label: 'Select All', shortcut: 'Ctrl+A', icon: svg.menuPanel },
      { type: 'item', id: 'sel.expand', label: 'Expand Selection', icon: svg.menuSplit },
    ],
    view: [
      { type: 'item', id: 'view.explorer', label: 'Explorer', icon: svg.menuFolder },
      { type: 'item', id: 'view.terminal', label: 'Terminal', icon: svg.menuTerminal },
      { type: 'item', id: 'view.console', label: 'Console', icon: svg.menuConsole },
      { type: 'item', id: 'view.presence', label: 'Omni the Presence', icon: svg.user },
      { type: 'sep' },
      { type: 'item', id: 'view.fullscreen', label: 'Toggle Full Screen', shortcut: 'F11', icon: svg.fullscreen },
    ],
    go: [
      { type: 'item', id: 'go.file', label: 'Go to File…', shortcut: 'Ctrl+P', icon: svg.menuFile },
      { type: 'item', id: 'go.line', label: 'Go to Line…', shortcut: 'Ctrl+G', icon: svg.search },
    ],
    run: [
      { type: 'item', id: 'run.start', label: 'Start Debugging', shortcut: 'F5', icon: svg.play },
      { type: 'item', id: 'run.without', label: 'Run Without Debugging', shortcut: 'Ctrl+F5', icon: svg.play },
    ],
    terminal: [
      { type: 'item', id: 'term.new', label: 'New Terminal', shortcut: 'Ctrl+`', icon: svg.menuTerminal },
      { type: 'item', id: 'term.clear', label: 'Clear', icon: svg.menuTrash },
    ],
    app: [
      { type: 'sub', label: 'Layout', icon: svg.menuLayout, children: [
        { type: 'item', id: 'layout.default', label: 'Default (Explorer · Editor + Agent · Omni + Terminal)', icon: svg.menuLayout },
        { type: 'item', id: 'layout.focus', label: 'Focus (Explorer + Editor)', icon: svg.menuLayout },
        { type: 'item', id: 'layout.grid', label: '2×2 middle', icon: svg.menuLayout },
        { type: 'sep' },
        { type: 'item', id: 'layout.floatOmni', label: 'Float Omni the Presence', icon: svg.user },
        { type: 'item', id: 'app.resetLayout', label: 'Reset Layout', icon: svg.menuLayout },
      ] },
      { type: 'sub', label: 'Panels', icon: svg.menuPanel, children: panelMenuItems(opts.panels) },
      { type: 'sep' },
      { type: 'item', id: 'app.settings', label: 'Settings…', shortcut: 'Ctrl+,', icon: svg.menuSettings },
      { type: 'item', id: 'app.update', label: 'Check for Updates…', icon: svg.menuUpdate },
    ],
    help: [
      { type: 'item', id: 'help.docs', label: 'Documentation', icon: svg.help },
      { type: 'item', id: 'help.about', label: 'About OMNI-CODE', icon: svg.logo },
    ],
  };
}

export function tabContextItems(hasPath: boolean): MenuItem[] {
  return [
    { type: 'item', id: 'tab.save', label: 'Save', shortcut: 'Ctrl+S', disabled: !hasPath, icon: svg.menuSave },
    { type: 'item', id: 'tab.saveAs', label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: !hasPath, icon: svg.menuSaveAs },
    { type: 'item', id: 'tab.rename', label: 'Rename…', disabled: !hasPath, icon: svg.menuRename },
    { type: 'sep' },
    { type: 'item', id: 'tab.cut', label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasPath, icon: svg.menuCut },
    { type: 'item', id: 'tab.copy', label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasPath, icon: svg.menuCopy },
    { type: 'item', id: 'tab.paste', label: 'Paste', shortcut: 'Ctrl+V', icon: svg.menuPaste },
    { type: 'item', id: 'tab.duplicate', label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !hasPath, icon: svg.menuDuplicate },
    { type: 'sep' },
    { type: 'item', id: 'tab.splitRight', label: 'Split Right', disabled: !hasPath, icon: svg.menuSplit },
    { type: 'item', id: 'tab.splitLeft', label: 'Split Left', disabled: !hasPath, icon: svg.menuSplit },
    { type: 'item', id: 'tab.moveRight', label: 'Move to Right', disabled: !hasPath, icon: svg.menuMove },
    { type: 'item', id: 'tab.moveLeft', label: 'Move to Left', disabled: !hasPath, icon: svg.menuMove },
    { type: 'sep' },
    { type: 'item', id: 'tab.close', label: 'Close', shortcut: 'Ctrl+W', disabled: !hasPath, icon: svg.menuClose },
    { type: 'item', id: 'tab.closeOthers', label: 'Close Others', icon: svg.menuClose },
    { type: 'item', id: 'tab.closeAll', label: 'Close All', icon: svg.menuClose },
    { type: 'sep' },
    { type: 'item', id: 'tab.copyPath', label: 'Copy Path', disabled: !hasPath, icon: svg.menuCopy },
    { type: 'item', id: 'tab.copyRel', label: 'Copy Relative Path', disabled: !hasPath, icon: svg.menuCopy },
    { type: 'item', id: 'tab.reveal', label: 'Reveal in Explorer', disabled: !hasPath, icon: svg.menuReveal },
    { type: 'sep' },
    { type: 'item', id: 'tab.delete', label: 'Delete File', disabled: !hasPath, icon: svg.menuTrash },
  ];
}

export function explorerContextItems(hasItem: boolean, hasPath: boolean, canPaste: boolean): MenuItem[] {
  return [
    { type: 'item', id: 'ctx.newFile', label: 'New File', shortcut: 'Ctrl+N', icon: svg.menuFile },
    { type: 'item', id: 'ctx.newFolder', label: 'New Folder', icon: svg.menuFolder },
    { type: 'sep' },
    { type: 'item', id: 'ctx.rename', label: 'Rename…', shortcut: 'F2', disabled: !hasItem, icon: svg.menuRename },
    { type: 'item', id: 'ctx.delete', label: 'Delete', shortcut: 'Delete', disabled: !hasItem, icon: svg.menuTrash },
    { type: 'sep' },
    { type: 'item', id: 'ctx.cut', label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasItem, icon: svg.menuCut },
    { type: 'item', id: 'ctx.copy', label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasItem, icon: svg.menuCopy },
    { type: 'item', id: 'ctx.paste', label: 'Paste', shortcut: 'Ctrl+V', disabled: !canPaste || !hasPath, icon: svg.menuPaste },
    { type: 'item', id: 'ctx.duplicate', label: 'Duplicate', disabled: !hasItem, icon: svg.menuDuplicate },
    { type: 'sep' },
    { type: 'item', id: 'ctx.copyPath', label: 'Copy Path', disabled: !hasPath, icon: svg.menuCopy },
    { type: 'item', id: 'ctx.copyRel', label: 'Copy Relative Path', disabled: !hasPath, icon: svg.menuCopy },
    { type: 'item', id: 'ctx.reveal', label: 'Reveal in Explorer', disabled: !hasPath, icon: svg.menuReveal },
  ];
}

export function editorContextItems(): MenuItem[] {
  return [
    { type: 'item', id: 'edit.cut', label: 'Cut', shortcut: 'Ctrl+X', icon: svg.menuCut },
    { type: 'item', id: 'edit.copy', label: 'Copy', shortcut: 'Ctrl+C', icon: svg.menuCopy },
    { type: 'item', id: 'edit.paste', label: 'Paste', shortcut: 'Ctrl+V', icon: svg.menuPaste },
    { type: 'sep' },
    { type: 'item', id: 'edit.duplicate', label: 'Duplicate Line', shortcut: 'Shift+Alt+↓', icon: svg.menuDuplicate },
    { type: 'item', id: 'edit.find', label: 'Find', shortcut: 'Ctrl+F', icon: svg.search },
    { type: 'item', id: 'edit.replace', label: 'Replace', shortcut: 'Ctrl+H', icon: svg.menuRename },
    { type: 'sep' },
    { type: 'item', id: 'go.line', label: 'Go to Line…', shortcut: 'Ctrl+G', icon: svg.search },
  ];
}
