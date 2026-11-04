/**
 * OMNI-CODE dock frame (v1.3.5).
 * Three regions: left column (1, 1/1, 1/1/1), middle 2x2 cell grid (1, 1|1, 1/1, 3, 2x2), right column.
 * Panels drag by their header into any slot (top/bottom/left/right/center zones), float as in-app
 * windows, redock, close (others expand). Layout persists in localStorage + SQLite (setting "layout").
 */
import type { PanelId } from './layout';

export type RegionId = 'left' | 'middle' | 'right';
type Cell = PanelId | null;
export type Zone = 'top' | 'bottom' | 'left' | 'right' | 'center';
type FloatRect = { x: number; y: number; w: number; h: number; from: RegionId };

export type DockLayout = {
  v: 3;
  left: { panels: PanelId[]; sizes: number[] };
  right: { panels: PanelId[]; sizes: number[] };
  middle: { cells: [Cell, Cell, Cell, Cell]; colFrac: number; rowFrac: number };
  colW: { left: number; right: number };
  floating: Partial<Record<PanelId, FloatRect>>;
};

export const ALL_PANELS: PanelId[] = ['explorer', 'editor', 'chat', 'presence', 'terminal', 'console', 'search', 'problems', 'output', 'outline', 'timeline', 'scm'];
export const PANEL_TITLES: Record<PanelId, string> = {
  explorer: 'Explorer', editor: 'Editor', chat: 'Coding Agent', presence: 'Omni the Presence', terminal: 'Terminal',
  console: 'Console', search: 'Search', problems: 'Problems', output: 'Output', outline: 'Outline', timeline: 'Timeline', scm: 'Source Control',
};
const HOME: Record<PanelId, RegionId> = {
  explorer: 'left', search: 'left', scm: 'left', outline: 'left', timeline: 'left',
  editor: 'middle', chat: 'middle', problems: 'middle', output: 'middle',
  presence: 'right', terminal: 'right', console: 'right',
};
const SIDE_MAX = 3;
const MIN_SIDE = 170, MIN_MID = 300, MIN_MID_COL = 220, MIN_ROW = 90, SPLIT = 5;

export type PresetId = 'default' | 'focus' | 'grid' ;
export function preset(id: PresetId, mode: 'plain' | 'ultra'): DockLayout {
  const base: DockLayout = {
    v: 3,
    left: { panels: ['explorer'], sizes: [1] },
    right: { panels: ['presence', 'terminal'], sizes: [0.6, 0.4] },
    middle: { cells: ['editor', 'chat', null, null], colFrac: 0.66, rowFrac: 0.6 },
    colW: { left: mode === 'ultra' ? 222 : 230, right: 320 },
    floating: {},
  };
  if (id === 'focus') {
    base.left = { panels: ['explorer'], sizes: [1] };
    base.right = { panels: [], sizes: [] };
    base.middle.cells = ['editor', null, null, null];
  }
  if (id === 'grid') {
    base.left = { panels: ['explorer', 'outline'], sizes: [0.65, 0.35] };
    base.middle.cells = ['editor', 'chat', 'terminal', 'problems'];
    base.middle.colFrac = 0.6;
    base.right = { panels: ['presence', 'console'], sizes: [0.62, 0.38] };
  }
  return base;
}

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** Validate & normalise a persisted layout (unknown/duplicate panels dropped). */
export function sanitize(raw: any, mode: 'plain' | 'ultra'): DockLayout {
  const d = preset('default', mode);
  if (!raw || raw.v !== 3) return d;
  const seen = new Set<PanelId>();
  const ok = (p: any): p is PanelId => ALL_PANELS.includes(p) && !seen.has(p) && (seen.add(p), true);
  const side = (s: any) => {
    const panels = (Array.isArray(s?.panels) ? s.panels : []).filter(ok).slice(0, SIDE_MAX) as PanelId[];
    let sizes = (Array.isArray(s?.sizes) ? s.sizes : []).map(Number).slice(0, panels.length);
    if (sizes.length !== panels.length || sizes.some((n: number) => !(n > 0))) sizes = panels.map(() => 1 / Math.max(1, panels.length));
    return { panels, sizes };
  };
  const cells = (Array.isArray(raw.middle?.cells) ? raw.middle.cells : []).slice(0, 4).map((c: any) => (c && ok(c) ? c : null));
  while (cells.length < 4) cells.push(null);
  const out: DockLayout = {
    v: 3,
    left: side(raw.left),
    right: side(raw.right),
    middle: { cells: cells as any, colFrac: clampF(raw.middle?.colFrac, 0.6), rowFrac: clampF(raw.middle?.rowFrac, 0.6) },
    colW: { left: Number(raw.colW?.left) || d.colW.left, right: Number(raw.colW?.right) || d.colW.right },
    floating: {},
  };
  for (const [k, v] of Object.entries(raw.floating || {})) {
    if (ok(k) && v) out.floating[k as PanelId] = { x: +(v as any).x || 80, y: +(v as any).y || 80, w: +(v as any).w || 360, h: +(v as any).h || 420, from: ((v as any).from as RegionId) || HOME[k as PanelId] };
  }
  return out;
}
function clampF(n: any, dflt: number) { const v = Number(n); return v > 0.15 && v < 0.85 ? v : dflt; }

type Area = { id: PanelId; cell: number; r0: number; r1: number; c0: number; c1: number };

/** Each middle panel grows into empty neighbours (right, left, down, up) so there are no holes. */
export function middleAreas(cells: Cell[]): { areas: Area[]; rows: number[]; } {
  const cov: (PanelId | null)[] = [...cells];
  const areas: Area[] = [];
  const at = (r: number, c: number) => r * 2 + c;
  for (let i = 0; i < 4; i++) {
    const id = cells[i]; if (!id) continue;
    areas.push({ id, cell: i, r0: i >> 1, r1: i >> 1, c0: i & 1, c1: i & 1 });
  }
  const free = (r: number, c: number) => !cov[at(r, c)];
  for (const a of areas) {
    // horizontal grow
    if (a.c0 === 0 && free(a.r0, 1)) { a.c1 = 1; cov[at(a.r0, 1)] = a.id; }
    else if (a.c0 === 1 && free(a.r0, 0)) { a.c0 = 0; cov[at(a.r0, 0)] = a.id; }
  }
  for (const a of areas) {
    const other = a.r0 === 0 ? 1 : 0;
    let all = true;
    for (let c = a.c0; c <= a.c1; c++) if (!free(other, c)) all = false;
    if (all) { for (let c = a.c0; c <= a.c1; c++) cov[at(other, c)] = a.id; a.r0 = 0; a.r1 = 1; }
  }
  // two real rows only if some panel occupies a single row
  const rows = areas.some((a) => a.r0 === a.r1) ? [0, 1] : [0];
  return { areas, rows };
}

export type DockHost = {
  content: (id: PanelId) => HTMLElement;
  onChange?: (l: DockLayout) => void;
  onShown?: (id: PanelId) => void;
  onClosed?: (id: PanelId) => void;
};

export class DockManager {
  root: HTMLElement;
  floatLayer: HTMLElement;
  layout: DockLayout;
  mode: 'plain' | 'ultra';
  host: DockHost;
  panels = new Map<PanelId, HTMLElement>();
  private ro: ResizeObserver;
  private dragging: { id: PanelId; ghost: HTMLElement } | null = null;
  private dropInd: HTMLElement;
  private edgeL: HTMLElement;
  private edgeR: HTMLElement;
  private saveTimer = 0;

  constructor(root: HTMLElement, mode: 'plain' | 'ultra', layout: DockLayout, host: DockHost) {
    this.root = root; this.mode = mode; this.layout = layout; this.host = host;
    root.classList.add('dock-root');
    this.floatLayer = document.createElement('div');
    this.floatLayer.className = 'dock-float-layer';
    document.body.appendChild(this.floatLayer);
    this.dropInd = document.createElement('div');
    this.dropInd.className = 'dock-drop hidden';
    this.dropInd.innerHTML = '<div class="dz dz-top"></div><div class="dz dz-bottom"></div><div class="dz dz-left"></div><div class="dz dz-right"></div><div class="dz dz-center"></div><div class="dock-drop-preview"></div><div class="dock-drop-label"></div>';
    document.body.appendChild(this.dropInd);
    this.edgeL = this.mkEdge('left'); this.edgeR = this.mkEdge('right');
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(root);
    window.addEventListener('resize', () => this.clampFloating());
  }

  private mkEdge(side: 'left' | 'right') {
    const e = document.createElement('div');
    e.className = `dock-edge dock-edge-${side} hidden`;
    e.innerHTML = `<span>Dock ${side}</span>`;
    document.body.appendChild(e);
    return e;
  }

  /* ---------- queries ---------- */
  where(id: PanelId): { region: RegionId | 'float'; index: number } | null {
    if (this.layout.floating[id]) return { region: 'float', index: 0 };
    let i = this.layout.left.panels.indexOf(id); if (i >= 0) return { region: 'left', index: i };
    i = this.layout.right.panels.indexOf(id); if (i >= 0) return { region: 'right', index: i };
    i = this.layout.middle.cells.indexOf(id); if (i >= 0) return { region: 'middle', index: i };
    return null;
  }
  isOpen(id: PanelId) { return !!this.where(id); }
  visibleMap(): Record<PanelId, boolean> {
    const m = {} as Record<PanelId, boolean>;
    for (const p of ALL_PANELS) m[p] = this.isOpen(p);
    return m;
  }

  /* ---------- panel chrome ---------- */
  private panel(id: PanelId): HTMLElement {
    let el = this.panels.get(id);
    if (el) return el;
    el = document.createElement('section');
    el.className = 'dock-panel';
    el.dataset.panel = id;
    el.innerHTML = `<header class="dock-head" title="Drag to move · double-click to float/dock">
        <span class="dock-grip" aria-hidden="true"></span>
        <span class="dock-title">${PANEL_TITLES[id]}</span>
        <span class="dock-actions">
          <button type="button" data-a="float" title="Float / undock"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="5.5" width="8" height="8" rx="1"/><path d="M5.5 5.5V2.5h8v8h-3"/></svg></button>
          <button type="button" data-a="dock" title="Dock back"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 10h11M8 4.5v4M6 6.5l2 2 2-2"/></svg></button>
          <button type="button" data-a="close" title="Close panel"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
        </span>
      </header><div class="dock-body"></div>`;
    el.querySelector('.dock-body')!.appendChild(this.host.content(id));
    const head = el.querySelector('.dock-head') as HTMLElement;
    head.addEventListener('pointerdown', (e) => this.onHeadDown(e, id));
    head.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.layout.floating[id] ? this.redock(id) : this.float(id);
    });
    el.querySelector('[data-a="float"]')!.addEventListener('click', () => this.float(id));
    el.querySelector('[data-a="dock"]')!.addEventListener('click', () => this.redock(id));
    el.querySelector('[data-a="close"]')!.addEventListener('click', () => this.close(id));
    this.panels.set(id, el);
    return el;
  }

  /* ---------- render ---------- */
  render() {
    const L = this.layout;
    const W = this.root.clientWidth || window.innerWidth;
    const hasL = L.left.panels.length > 0, hasR = L.right.panels.length > 0;
    let lw = hasL ? Math.max(MIN_SIDE, L.colW.left) : 0;
    let rw = hasR ? Math.max(MIN_SIDE, L.colW.right) : 0;
    const { areas: ma } = middleAreas(L.middle.cells);
    const midCols = ma.some((a) => a.c0 === a.c1) ? 2 : 1;
    const midMin = midCols === 2 ? 2 * MIN_MID_COL + SPLIT : MIN_MID;
    const avail = W - midMin - (hasL ? SPLIT : 0) - (hasR ? SPLIT : 0);
    if (lw + rw > avail && lw + rw > 0) {
      const k = Math.max(0, avail) / (lw + rw);
      lw = hasL ? Math.max(140, Math.floor(lw * k)) : 0;
      rw = hasR ? Math.max(140, Math.floor(rw * k)) : 0;
    }
    this.root.style.gridTemplateColumns = `${lw}px ${hasL ? SPLIT : 0}px minmax(0,1fr) ${hasR ? SPLIT : 0}px ${rw}px`;
    this.root.dataset.cols = `${hasL ? 1 : 0}${hasR ? 1 : 0}`;

    const keep = new Set<HTMLElement>();
    const regionEl = (rid: RegionId, col: number) => {
      let r = this.root.querySelector(`:scope > .dock-region[data-region="${rid}"]`) as HTMLElement | null;
      if (!r) { r = document.createElement('div'); r.className = `dock-region dock-region-${rid}`; r.dataset.region = rid; this.root.appendChild(r); }
      r.style.gridColumn = String(col);
      keep.add(r);
      return r;
    };
    const colSplit = (key: 'left' | 'right', col: number, show: boolean) => {
      let s = this.root.querySelector(`:scope > .dock-col-split[data-k="${key}"]`) as HTMLElement | null;
      if (!s) {
        s = document.createElement('div'); s.className = 'dock-col-split'; s.dataset.k = key; this.root.appendChild(s);
        this.bindColSplit(s, key);
      }
      s.style.gridColumn = String(col); s.style.display = show ? '' : 'none';
      keep.add(s);
    };
    this.renderSide('left', regionEl('left', 1), hasL);
    colSplit('left', 2, hasL);
    this.renderMiddle(regionEl('middle', 3));
    colSplit('right', 4, hasR);
    this.renderSide('right', regionEl('right', 5), hasR);
    for (const ch of Array.from(this.root.children)) if (!keep.has(ch as HTMLElement)) ch.remove();

    // floating
    for (const [id, f] of Object.entries(L.floating) as [PanelId, FloatRect][]) {
      const el = this.panel(id);
      el.classList.add('floating'); el.classList.remove('docked');
      if (el.parentElement !== this.floatLayer) this.floatLayer.appendChild(el);
      Object.assign(el.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px`, gridArea: '', flex: '' });
      this.bindFloatResize(el, id);
    }
    // detach closed panels
    for (const [id, el] of this.panels) if (!this.isOpen(id) && el.isConnected) el.remove();
    this.clampFloating(false);
  }

  private renderSide(rid: 'left' | 'right', r: HTMLElement, show: boolean) {
    r.style.display = show ? '' : 'none';
    const s = this.layout[rid];
    const want: HTMLElement[] = [];
    s.panels.forEach((id, i) => {
      if (i > 0) {
        let sp = r.querySelector(`:scope > .dock-row-split[data-i="${i}"]`) as HTMLElement | null;
        if (!sp) { sp = document.createElement('div'); sp.className = 'dock-row-split'; sp.dataset.i = String(i); this.bindRowSplit(sp, rid, i); }
        want.push(sp);
      }
      const el = this.panel(id);
      el.classList.remove('floating'); el.classList.add('docked');
      el.style.cssText = '';
      el.style.flex = `${s.sizes[i] ?? 1} 1 0px`;
      want.push(el);
    });
    this.syncChildren(r, want);
    r.dataset.count = String(s.panels.length);
  }

  private renderMiddle(r: HTMLElement) {
    const m = this.layout.middle;
    const { areas, rows } = middleAreas(m.cells);
    const twoCols = areas.some((a) => a.c0 === a.c1);
    // keep each middle column >= MIN_MID_COL px whenever the region is wide enough
    const mw = r.clientWidth || 0;
    const lim = mw > 2 * MIN_MID_COL + SPLIT ? MIN_MID_COL / mw : 0.5;
    const cf = Math.min(1 - lim, Math.max(lim, m.colFrac)), rf = m.rowFrac;
    r.style.gridTemplateColumns = twoCols ? `minmax(0,${cf}fr) ${SPLIT}px minmax(0,${1 - cf}fr)` : 'minmax(0,1fr) 0px 0px';
    r.style.gridTemplateRows = rows.length === 2 ? `minmax(0,${rf}fr) ${SPLIT}px minmax(0,${1 - rf}fr)` : 'minmax(0,1fr) 0px 0px';
    const want: HTMLElement[] = [];
    const gr = (row: number) => (rows.length === 2 ? row * 2 + 1 : 1);
    for (const a of areas) {
      const el = this.panel(a.id);
      el.classList.remove('floating'); el.classList.add('docked');
      el.style.cssText = '';
      const r0 = gr(rows.length === 2 ? a.r0 : 0), r1 = gr(rows.length === 2 ? a.r1 : 0);
      const c0 = twoCols ? a.c0 * 2 + 1 : 1, c1 = twoCols ? a.c1 * 2 + 1 : 1;
      el.style.gridArea = `${r0} / ${c0} / ${r1 + 1} / ${c1 + 1}`;
      el.dataset.cell = String(a.cell);
      want.push(el);
    }
    // splitters: vertical one per row that has two panels, horizontal if 2 rows
    const vRows = rows.length === 2 ? [0, 1] : [0];
    for (const row of vRows) {
      const split = areas.some((a) => a.c0 === 0 && a.c1 === 0 && a.r0 <= row && a.r1 >= row) && areas.some((a) => a.c0 === 1 && a.r0 <= row && a.r1 >= row);
      if (!split || !twoCols) continue;
      const k = `v${row}`;
      let sp = r.querySelector(`:scope > .dock-mid-split[data-k="${k}"]`) as HTMLElement | null;
      if (!sp) { sp = document.createElement('div'); sp.className = 'dock-mid-split v'; sp.dataset.k = k; this.bindMidSplit(sp, 'col', r); }
      sp.style.gridArea = `${gr(row)} / 2 / ${gr(row) + 1} / 3`;
      want.push(sp);
    }
    if (rows.length === 2) {
      let sp = r.querySelector(':scope > .dock-mid-split[data-k="h"]') as HTMLElement | null;
      if (!sp) { sp = document.createElement('div'); sp.className = 'dock-mid-split h'; sp.dataset.k = 'h'; this.bindMidSplit(sp, 'row', r); }
      sp.style.gridArea = `2 / 1 / 3 / 4`;
      want.push(sp);
    }
    if (!areas.length) {
      let ph = r.querySelector(':scope > .dock-empty') as HTMLElement | null;
      if (!ph) { ph = document.createElement('div'); ph.className = 'dock-empty'; ph.textContent = 'Drag a panel here, or App → Panels'; }
      want.push(ph);
    }
    this.syncChildren(r, want);
    r.dataset.count = String(areas.length);
  }

  private syncChildren(parent: HTMLElement, want: HTMLElement[]) {
    // remove unwanted, then append in order (appendChild moves without re-creating panels)
    for (const ch of Array.from(parent.children)) if (!want.includes(ch as HTMLElement)) ch.remove();
    want.forEach((el, i) => { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null); });
  }

  /* ---------- splitters ---------- */
  private drag(handle: HTMLElement, cursor: string, onMove: (dx: number, dy: number) => void) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('dock-resizing'); document.body.style.cursor = cursor;
      const mv = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy);
      const up = () => {
        handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up);
        document.body.classList.remove('dock-resizing'); document.body.style.cursor = '';
        this.changed();
      };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
    });
  }
  private bindColSplit(s: HTMLElement, key: 'left' | 'right') {
    let start = 0;
    s.addEventListener('pointerdown', () => { start = (this.root.querySelector(`.dock-region-${key}`) as HTMLElement)?.getBoundingClientRect().width || this.layout.colW[key]; });
    this.drag(s, 'col-resize', (dx) => {
      const other = key === 'left' ? this.layout.colW.right : this.layout.colW.left;
      const max = Math.max(MIN_SIDE, this.root.clientWidth - MIN_MID - other - 2 * SPLIT);
      this.layout.colW[key] = Math.round(Math.min(max, Math.max(MIN_SIDE, start + (key === 'left' ? dx : -dx))));
      this.render();
    });
  }
  private bindRowSplit(s: HTMLElement, rid: 'left' | 'right', i: number) {
    let a0 = 0, b0 = 0, ha = 0, hb = 0;
    s.addEventListener('pointerdown', () => {
      const sz = this.layout[rid].sizes; a0 = sz[i - 1]; b0 = sz[i];
      const els = this.layout[rid].panels.map((p) => this.panels.get(p)!);
      ha = els[i - 1].getBoundingClientRect().height; hb = els[i].getBoundingClientRect().height;
    });
    this.drag(s, 'row-resize', (_dx, dy) => {
      const tot = ha + hb; const na = Math.min(tot - MIN_ROW, Math.max(MIN_ROW, ha + dy));
      const sum = a0 + b0;
      this.layout[rid].sizes[i - 1] = (sum * na) / tot; this.layout[rid].sizes[i] = (sum * (tot - na)) / tot;
      this.render();
    });
  }
  private bindMidSplit(s: HTMLElement, axis: 'col' | 'row', region: HTMLElement) {
    let f0 = 0;
    s.addEventListener('pointerdown', () => { f0 = axis === 'col' ? this.layout.middle.colFrac : this.layout.middle.rowFrac; });
    this.drag(s, axis === 'col' ? 'col-resize' : 'row-resize', (dx, dy) => {
      const rect = region.getBoundingClientRect();
      const tot = axis === 'col' ? rect.width : rect.height;
      const minF = Math.min(0.45, (axis === 'col' ? 240 : MIN_ROW) / Math.max(1, tot));
      const f = f0 + (axis === 'col' ? dx : dy) / Math.max(1, tot);
      const v = Math.min(1 - minF, Math.max(minF, f));
      if (axis === 'col') this.layout.middle.colFrac = v; else this.layout.middle.rowFrac = v;
      this.render();
    });
  }

  /* ---------- drag & drop ---------- */
  private onHeadDown(e: PointerEvent, id: PanelId) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const floating = !!this.layout.floating[id];
    const head = e.currentTarget as HTMLElement;
    const sx = e.clientX, sy = e.clientY;
    const f0 = floating ? { ...this.layout.floating[id]! } : null;
    let started = false;
    head.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!started && Math.hypot(dx, dy) < 6) return;
      if (!started) { started = true; this.beginDrag(id, ev); }
      if (floating && f0) {
        const f = this.layout.floating[id]!; f.x = f0.x + dx; f.y = f0.y + dy;
        const el = this.panels.get(id)!; el.style.left = `${f.x}px`; el.style.top = `${f.y}px`;
        // floating windows only dock when hovering a drop compass with Shift held, or via ⇲ / double-click
        if (ev.shiftKey) this.hover(ev.clientX, ev.clientY, id); else this.hideDrop();
      } else this.hover(ev.clientX, ev.clientY, id);
      if (this.dragging) { this.dragging.ghost.style.left = `${ev.clientX + 14}px`; this.dragging.ghost.style.top = `${ev.clientY + 12}px`; }
    };
    const up = (ev: PointerEvent) => {
      head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up);
      if (!started) return;
      const t = this.target(ev.clientX, ev.clientY, id);
      this.endDrag();
      if (floating && !ev.shiftKey) { this.clampFloating(); this.changed(); return; }
      if (t) this.drop(id, t);
      else if (!floating) this.float(id, { x: ev.clientX - 40, y: ev.clientY - 14 });
    };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
  }
  private beginDrag(id: PanelId, ev: PointerEvent) {
    const ghost = document.createElement('div');
    ghost.className = 'dock-ghost'; ghost.textContent = PANEL_TITLES[id];
    ghost.style.left = `${ev.clientX + 14}px`; ghost.style.top = `${ev.clientY + 12}px`;
    document.body.appendChild(ghost);
    this.dragging = { id, ghost };
    document.body.classList.add('dock-dragging');
    this.panels.get(id)?.classList.add('drag-src');
    this.edgeL.classList.toggle('hidden', this.layout.left.panels.length > 0);
    this.edgeR.classList.toggle('hidden', this.layout.right.panels.length > 0);
    const rr = this.root.getBoundingClientRect();
    for (const [e, left] of [[this.edgeL, rr.left], [this.edgeR, rr.right - 46]] as [HTMLElement, number][]) {
      Object.assign(e.style, { left: `${left}px`, top: `${rr.top}px`, height: `${rr.height}px` });
    }
  }
  private endDrag() {
    this.dragging?.ghost.remove();
    if (this.dragging) this.panels.get(this.dragging.id)?.classList.remove('drag-src');
    this.dragging = null;
    document.body.classList.remove('dock-dragging');
    this.hideDrop();
    this.edgeL.classList.add('hidden'); this.edgeR.classList.add('hidden');
    this.edgeL.classList.remove('hot'); this.edgeR.classList.remove('hot');
  }
  private hideDrop() { this.dropInd.classList.add('hidden'); }

  /** Hit-test: panel under pointer + zone, empty region, or empty side edge strip. */
  target(x: number, y: number, self: PanelId): { kind: 'panel'; id: PanelId; zone: Zone; rect: DOMRect } | { kind: 'region'; region: RegionId; rect: DOMRect } | null {
    for (const [edge, rid] of [[this.edgeL, 'left'], [this.edgeR, 'right']] as [HTMLElement, RegionId][]) {
      if (edge.classList.contains('hidden')) continue;
      const r = edge.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { kind: 'region', region: rid, rect: r };
    }
    for (const [id, el] of this.panels) {
      if (id === self || !el.isConnected || el.classList.contains('floating')) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
      const reg = this.where(id)!.region;
      let zone: Zone = 'center';
      const side = reg === 'left' || reg === 'right';
      if (fy < 0.28) zone = 'top'; else if (fy > 0.72) zone = 'bottom';
      else if (!side && fx < 0.25) zone = 'left'; else if (!side && fx > 0.75) zone = 'right';
      return { kind: 'panel', id, zone, rect: r };
    }
    const mid = this.root.querySelector('.dock-region-middle') as HTMLElement | null;
    if (mid && !this.layout.middle.cells.some(Boolean)) {
      const r = mid.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { kind: 'region', region: 'middle', rect: r };
    }
    return null;
  }

  private hover(x: number, y: number, self: PanelId) {
    const t = this.target(x, y, self);
    this.edgeL.classList.toggle('hot', t?.kind === 'region' && t.region === 'left');
    this.edgeR.classList.toggle('hot', t?.kind === 'region' && t.region === 'right');
    if (!t) { this.hideDrop(); return; }
    const r = t.rect, d = this.dropInd;
    d.classList.remove('hidden');
    Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const zone = t.kind === 'panel' ? t.zone : 'center';
    const reg = t.kind === 'panel' ? this.where(t.id)!.region : t.region;
    d.dataset.zone = zone;
    d.dataset.side = reg === 'middle' ? '0' : '1';
    const pv = d.querySelector('.dock-drop-preview') as HTMLElement;
    const pr = { top: '0 0 50% 0', bottom: '50% 0 0 0', left: '0 50% 0 0', right: '0 0 0 50%', center: '0 0 0 0' }[zone];
    pv.style.inset = pr;
    const label = t.kind === 'region' ? `Dock in ${t.region}`
      : zone === 'center' ? `Swap with ${PANEL_TITLES[t.id]}` : `Split ${zone} of ${PANEL_TITLES[t.id]}`;
    (d.querySelector('.dock-drop-label') as HTMLElement).textContent = label;
  }

  /* ---------- mutations ---------- */
  private detach(id: PanelId): { region: RegionId | 'float'; index: number } | null {
    const w = this.where(id);
    if (!w) return null;
    const L = this.layout;
    if (w.region === 'float') delete L.floating[id];
    else if (w.region === 'middle') L.middle.cells[w.index] = null;
    else {
      const s = L[w.region];
      const sz = s.sizes.splice(w.index, 1)[0] ?? 0;
      s.panels.splice(w.index, 1);
      if (s.sizes.length) { const k = 1 / s.sizes.reduce((a, b) => a + b, 0); s.sizes = s.sizes.map((v) => v * k); void sz; }
    }
    return w;
  }

  drop(id: PanelId, t: NonNullable<ReturnType<DockManager['target']>>) {
    const L = this.layout;
    if (t.kind === 'region') {
      this.detach(id);
      if (t.region === 'middle') L.middle.cells = [id, null, null, null];
      else this.insertSide(t.region, id, 0);
      return this.changed();
    }
    const T = t.id;
    const from = this.where(id);
    const to = this.where(T)!;
    if (t.zone === 'center') return this.swap(id, T);
    if (to.region === 'left' || to.region === 'right') {
      const s = L[to.region];
      const sameRegion = from?.region === to.region;
      if (s.panels.length >= SIDE_MAX && !sameRegion) return this.swap(id, T);
      this.detach(id);
      const ti = s.panels.indexOf(T);
      this.insertSide(to.region, id, t.zone === 'bottom' ? ti + 1 : ti);
      return this.changed();
    }
    // middle split
    const before = clone(L);
    this.detach(id);
    const cells = L.middle.cells;
    const { areas } = middleAreas(cells);
    const a = areas.find((x) => x.id === T)!;
    const at = (r: number, c: number) => r * 2 + c;
    let ok = false;
    if ((t.zone === 'left' || t.zone === 'right') && a.c1 > a.c0) {
      cells[a.cell] = null;
      const [tc, pc] = t.zone === 'right' ? [0, 1] : [1, 0];
      cells[at(a.r0, tc)] = T; cells[at(a.r0, pc)] = id; ok = true;
    } else if ((t.zone === 'top' || t.zone === 'bottom') && a.r1 > a.r0) {
      cells[a.cell] = null;
      const [tr, pr] = t.zone === 'bottom' ? [0, 1] : [1, 0];
      cells[at(tr, a.c0)] = T; cells[at(pr, a.c0)] = id; ok = true;
    }
    if (!ok) { this.layout = before; return this.swap(id, T); }
    this.changed();
  }

  private insertSide(rid: 'left' | 'right', id: PanelId, index: number) {
    const s = this.layout[rid];
    const n = s.panels.length;
    const share = 1 / (n + 1);
    s.sizes = s.sizes.map((v) => v * (1 - share));
    s.panels.splice(index, 0, id);
    s.sizes.splice(index, 0, n ? share : 1);
  }

  swap(a: PanelId, b: PanelId) {
    const wa = this.where(a), wb = this.where(b);
    if (!wb) return;
    const L = this.layout;
    const put = (w: { region: RegionId | 'float'; index: number }, id: PanelId) => {
      if (w.region === 'middle') L.middle.cells[w.index] = id;
      else if (w.region === 'left' || w.region === 'right') L[w.region].panels[w.index] = id;
    };
    if (!wa || wa.region === 'float') {
      const f = wa ? L.floating[a] : null;
      if (f) delete L.floating[a];
      put(wb, a);
      if (f) L.floating[b] = { ...f, from: wb.region as RegionId };
    } else { put(wb, a); put(wa, b); }
    this.changed();
  }

  float(id: PanelId, at?: { x: number; y: number }) {
    const el = this.panels.get(id);
    const r = el?.isConnected ? el.getBoundingClientRect() : null;
    const w = this.detach(id);
    const from = (w && w.region !== 'float' ? w.region : HOME[id]) as RegionId;
    const fw = Math.round(Math.min(520, Math.max(300, r?.width || 360)));
    const fh = Math.round(Math.min(window.innerHeight - 120, Math.max(320, r?.height || 440)));
    this.layout.floating[id] = { x: at?.x ?? Math.round((r?.left ?? 120) - 24), y: at?.y ?? Math.round((r?.top ?? 120) + 24), w: fw, h: fh, from };
    this.changed();
    this.host.onShown?.(id);
  }

  redock(id: PanelId) {
    const f = this.layout.floating[id];
    if (!f) return;
    delete this.layout.floating[id];
    this.place(id, f.from);
    this.changed();
    this.host.onShown?.(id);
  }

  /** Put a panel into its preferred region if there is room, else the next free slot. */
  place(id: PanelId, prefer: RegionId = HOME[id]) {
    const order: RegionId[] = [prefer, ...(['right', 'left', 'middle'] as RegionId[]).filter((r) => r !== prefer)];
    for (const rid of order) {
      if (rid === 'middle') {
        const c = this.layout.middle.cells;
        const free = [0, 1, 2, 3].find((i) => !c[i] && !middleAreas(c).areas.some((a) => a.cell === i));
        const slot = c.every((x) => !x) ? 0 : [1, 3, 2, 0].find((i) => !c[i]);
        if (slot !== undefined) { c[slot] = id; void free; return; }
      } else if (this.layout[rid].panels.length < SIDE_MAX) {
        this.insertSide(rid, id, this.layout[rid].panels.length); return;
      }
    }
    // everything full: float it
    this.layout.floating[id] = { x: 140, y: 120, w: 380, h: 440, from: prefer };
  }

  open(id: PanelId) {
    if (!this.isOpen(id)) { this.place(id); this.changed(); }
    this.host.onShown?.(id);
    this.panels.get(id)?.classList.add('flash');
    setTimeout(() => this.panels.get(id)?.classList.remove('flash'), 600);
  }
  close(id: PanelId) {
    if (!this.detach(id)) return;
    this.changed();
    this.host.onClosed?.(id);
  }
  toggle(id: PanelId) { this.isOpen(id) ? this.close(id) : this.open(id); }

  applyPreset(p: PresetId) {
    this.layout = preset(p, this.mode);
    this.changed();
    for (const id of ALL_PANELS) if (this.isOpen(id)) this.host.onShown?.(id);
  }
  setLayout(l: DockLayout) { this.layout = l; this.render(); for (const id of ALL_PANELS) if (this.isOpen(id)) this.host.onShown?.(id); }

  private bindFloatResize(el: HTMLElement, id: PanelId) {
    if ((el as any).__floatRO) return;
    const ro = new ResizeObserver(() => {
      const f = this.layout.floating[id];
      if (!f || !el.classList.contains('floating')) return;
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      if (w && h && (w !== f.w || h !== f.h)) { f.w = w; f.h = h; this.scheduleSave(); }
    });
    ro.observe(el);
    (el as any).__floatRO = ro;
  }
  private clampFloating(save = true) {
    let moved = false;
    for (const [id, f] of Object.entries(this.layout.floating) as [PanelId, FloatRect][]) {
      const maxW = window.innerWidth - 16, maxH = window.innerHeight - 40;
      const nw = Math.min(f.w, maxW), nh = Math.min(f.h, maxH);
      const nx = Math.min(Math.max(0, f.x), window.innerWidth - Math.min(nw, 120));
      const ny = Math.min(Math.max(0, f.y), window.innerHeight - 40);
      if (nw !== f.w || nh !== f.h || nx !== f.x || ny !== f.y) {
        Object.assign(f, { w: nw, h: nh, x: nx, y: ny }); moved = true;
        const el = this.panels.get(id);
        if (el) Object.assign(el.style, { left: `${nx}px`, top: `${ny}px`, width: `${nw}px`, height: `${nh}px` });
      }
    }
    if (moved && save) this.scheduleSave();
  }

  changed() { this.render(); this.scheduleSave(); }
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.host.onChange?.(this.layout), 250);
  }
}
