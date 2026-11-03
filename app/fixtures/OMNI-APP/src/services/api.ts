export type Metrics = { ts: number; value: number }[];

let cache: Metrics | null = null;

export async function fetchMetrics() {
  const fresh = fetch("/api/metrics").then(r => r.json());
  if (cache) { fresh.then(v => { cache = v; }); return cache; }
  cache = await fresh; return cache;
}
