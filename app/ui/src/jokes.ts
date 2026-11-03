import pool from './jokes-data.json';

export type JokeCategory =
  | 'coding_jokes'
  | 'tension_breakers'
  | 'cheer_ups'
  | 'congrats'
  | 'idle_callouts'
  | 'break_reminders';

const STORE_KEY = 'omni.presence.jokeHistory';
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

type Hist = { line: string; cat: JokeCategory; t: number };

function loadHist(): Hist[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveHist(h: Hist[]) {
  // keep last 400
  localStorage.setItem(STORE_KEY, JSON.stringify(h.slice(-400)));
}

export function poolStats() {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [k, v] of Object.entries(pool)) {
    counts[k] = (v as string[]).length;
    total += (v as string[]).length;
  }
  return { total, counts };
}

export function pickLine(
  cat: JokeCategory,
  opts?: { cooldownMs?: number; now?: number; weights?: Partial<Record<JokeCategory, number>> }
): string {
  const now = opts?.now ?? Date.now();
  const cool = opts?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const hist = loadHist();
  const recent = new Set(hist.filter((h) => now - h.t < cool).map((h) => h.line));
  const lines = (pool as Record<string, string[]>)[cat] || [];
  const fresh = lines.filter((l) => !recent.has(l));
  const bag = fresh.length ? fresh : lines; // if exhausted, allow older
  if (!bag.length) return '';
  const line = bag[Math.floor(Math.random() * bag.length)];
  hist.push({ line, cat, t: now });
  saveHist(hist);
  return line;
}

/** Weighted multi-category pick for rhythm engine. */
export function pickWeighted(
  cats: JokeCategory[],
  weights: Partial<Record<JokeCategory, number>> = {},
  opts?: { cooldownMs?: number; now?: number }
): { line: string; cat: JokeCategory } | null {
  const now = opts?.now ?? Date.now();
  const cool = opts?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const hist = loadHist();
  const recent = new Set(hist.filter((h) => now - h.t < cool).map((h) => h.line));
  const weighted: { cat: JokeCategory; line: string; w: number }[] = [];
  for (const cat of cats) {
    const lines = ((pool as any)[cat] as string[] || []).filter((l) => !recent.has(l));
    const w = weights[cat] ?? 1;
    for (const line of lines) weighted.push({ cat, line, w });
  }
  if (!weighted.length) {
    // fallback any from first cat
    const cat = cats[0];
    const line = pickLine(cat, opts);
    return line ? { line, cat } : null;
  }
  const sum = weighted.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * sum;
  for (const item of weighted) {
    r -= item.w;
    if (r <= 0) {
      hist.push({ line: item.line, cat: item.cat, t: now });
      saveHist(hist);
      return { line: item.line, cat: item.cat };
    }
  }
  const last = weighted[weighted.length - 1];
  hist.push({ line: last.line, cat: last.cat, t: now });
  saveHist(hist);
  return { line: last.line, cat: last.cat };
}

export function _resetHistoryForTests() {
  localStorage.removeItem(STORE_KEY);
}
