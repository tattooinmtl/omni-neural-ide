/** Persistable IDE panel layout: visibility + sizes. */

export type PanelId =
  | 'explorer' | 'editor' | 'chat' | 'presence'
  | 'console' | 'terminal' | 'outline' | 'timeline'
  | 'search' | 'scm' | 'problems' | 'output';

export type LayoutState = {
  version: 2;
  visible: Record<PanelId, boolean>;
  widths: { sidebar: number; chat: number; presence: number };
  bottomH: number;
  sideDockH: number; // flex grows; this is min preference
  /** Where terminal/console live by default */
  termPlacement: 'side' | 'bottom';
  sideTab: 'terminal' | 'console';
  bottomTab: 'terminal' | 'console' | 'problems' | 'output';
};

const KEY = 'omni.layout.v2';

export const DEFAULT_LAYOUT: LayoutState = {
  version: 2,
  visible: {
    explorer: true,
    editor: true,
    chat: true,
    presence: true,
    console: false,
    terminal: true, // default: Terminal in right column under Omni
    outline: true,
    timeline: true,
    search: false,
    scm: false,
    problems: false,
    output: false,
  },
  widths: { sidebar: 207, chat: 348, presence: 320 },
  bottomH: 220,
  sideDockH: 220,
  termPlacement: 'side',
  sideTab: 'terminal',
  bottomTab: 'problems',
};

export function loadLayout(mode: 'plain' | 'ultra'): LayoutState {
  try {
    const raw = localStorage.getItem(`${KEY}.${mode}`);
    if (!raw) {
      const d = structuredClone(DEFAULT_LAYOUT);
      if (mode === 'ultra') d.widths = { sidebar: 197, chat: 341, presence: 320 };
      return d;
    }
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      ...structuredClone(DEFAULT_LAYOUT),
      ...parsed,
      visible: { ...DEFAULT_LAYOUT.visible, ...(parsed.visible || {}) },
      widths: { ...DEFAULT_LAYOUT.widths, ...(parsed.widths || {}) },
      version: 2,
    };
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

export function saveLayout(mode: 'plain' | 'ultra', state: LayoutState) {
  localStorage.setItem(`${KEY}.${mode}`, JSON.stringify(state));
}

export function resetLayout(mode: 'plain' | 'ultra'): LayoutState {
  const d = structuredClone(DEFAULT_LAYOUT);
  if (mode === 'ultra') d.widths = { sidebar: 197, chat: 341, presence: 320 };
  saveLayout(mode, d);
  return d;
}

/** Show a panel; terminal/console open in the side (right) dock by default. */
export function showPanel(state: LayoutState, id: PanelId): LayoutState {
  const next = { ...state, visible: { ...state.visible, [id]: true } };
  if (id === 'terminal' || id === 'console') {
    if (next.termPlacement === 'side') {
      next.sideTab = id;
    } else {
      next.bottomTab = id;
    }
  }
  if (id === 'problems' || id === 'output') {
    next.bottomTab = id;
  }
  return next;
}

export function togglePanel(state: LayoutState, id: PanelId): LayoutState {
  return { ...state, visible: { ...state.visible, [id]: !state.visible[id] } };
}

export function sideDockVisible(state: LayoutState): boolean {
  return state.termPlacement === 'side' && !!(state.visible.terminal || state.visible.console);
}

export function bottomVisible(state: LayoutState): boolean {
  if (state.visible.problems || state.visible.output) return true;
  if (state.termPlacement === 'bottom' && (state.visible.terminal || state.visible.console)) return true;
  return false;
}
