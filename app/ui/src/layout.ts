/** Persistable IDE panel layout: visibility + sizes. */

export type PanelId =
  | 'explorer' | 'editor' | 'chat' | 'presence'
  | 'console' | 'terminal' | 'outline' | 'timeline'
  | 'search' | 'scm' | 'problems' | 'output';

export type LayoutState = {
  version: 1;
  visible: Record<PanelId, boolean>;
  widths: { sidebar: number; chat: number; presence: number };
  bottomH: number;
  bottomTab: 'terminal' | 'console' | 'problems' | 'output';
};

const KEY = 'omni.layout.v1';

export const DEFAULT_LAYOUT: LayoutState = {
  version: 1,
  visible: {
    explorer: true,
    editor: true,
    chat: true,
    presence: true,
    console: false,
    terminal: false,
    outline: true,
    timeline: true,
    search: false,
    scm: false,
    problems: false,
    output: false,
  },
  widths: { sidebar: 207, chat: 348, presence: 300 },
  bottomH: 220,
  bottomTab: 'terminal',
};

export function loadLayout(mode: 'plain' | 'ultra'): LayoutState {
  try {
    const raw = localStorage.getItem(`${KEY}.${mode}`);
    if (!raw) {
      const d = structuredClone(DEFAULT_LAYOUT);
      if (mode === 'ultra') {
        d.widths = { sidebar: 197, chat: 341, presence: 300 };
      }
      return d;
    }
    const parsed = JSON.parse(raw) as LayoutState;
    return { ...structuredClone(DEFAULT_LAYOUT), ...parsed, visible: { ...DEFAULT_LAYOUT.visible, ...parsed.visible }, widths: { ...DEFAULT_LAYOUT.widths, ...parsed.widths } };
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

export function saveLayout(mode: 'plain' | 'ultra', state: LayoutState) {
  localStorage.setItem(`${KEY}.${mode}`, JSON.stringify(state));
}

export function resetLayout(mode: 'plain' | 'ultra'): LayoutState {
  const d = structuredClone(DEFAULT_LAYOUT);
  if (mode === 'ultra') d.widths = { sidebar: 197, chat: 341, presence: 300 };
  saveLayout(mode, d);
  return d;
}

/** Show a panel; if it's a bottom panel and none bottom visible, open bottom dock. */
export function showPanel(state: LayoutState, id: PanelId): LayoutState {
  const next = { ...state, visible: { ...state.visible, [id]: true } };
  if (id === 'terminal' || id === 'console' || id === 'problems' || id === 'output') {
    next.bottomTab = id === 'console' || id === 'problems' || id === 'output' ? (id as any) : 'terminal';
    if (id === 'terminal') next.bottomTab = 'terminal';
  }
  return next;
}

export function togglePanel(state: LayoutState, id: PanelId): LayoutState {
  return { ...state, visible: { ...state.visible, [id]: !state.visible[id] } };
}

export function bottomVisible(state: LayoutState): boolean {
  return !!(state.visible.terminal || state.visible.console || state.visible.problems || state.visible.output);
}
