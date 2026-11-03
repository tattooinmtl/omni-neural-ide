const cache = new Map();
export async function fetchMetrics() {
  const key = 'metrics';
  if (cache.has(key)) return cache.get(key);
  const promise = fetch('/api/metrics').then(r => r.json());
  cache.set(key, promise);
  return promise;
}
