// In-memory rate limits with bounded memory (one server instance; see DEPLOY.md).
// Each limiter keeps, per key, the timestamps of recent hits inside a sliding window. Expired keys are pruned
// every few hundred hits, and the map never holds more than `maxKeys` keys (the oldest are dropped first).

export function createLimiter({ windowMs, max, maxKeys = 50000 }) {
  const hits = new Map(); // key -> timestamps (oldest first)
  let ops = 0;

  function recent(key, now) {
    const a = hits.get(key);
    if (!a) return [];
    const r = a.filter(t => now - t < windowMs);
    if (r.length !== a.length) { if (r.length) hits.set(key, r); else hits.delete(key); }
    return r;
  }
  function prune(now = Date.now()) {
    for (const [k, a] of hits) if (!a.length || now - a[a.length - 1] >= windowMs) hits.delete(k);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
  }
  return {
    /** Hits for `key` inside the window. */
    count: (key, now = Date.now()) => recent(key, now).length,
    /** True when `key` has used up its allowance. */
    limited: (key, now = Date.now()) => recent(key, now).length >= max,
    hit(key, now = Date.now()) {
      const r = recent(key, now);
      r.push(now);
      hits.delete(key); // re-insert so Map order is "least recently hit first"
      hits.set(key, r.length > max * 2 ? r.slice(-max * 2) : r);
      if (++ops % 256 === 0 || hits.size > maxKeys) prune(now);
    },
    clear: (key) => { hits.delete(key); },
    prune,
    get size() { return hits.size; },
  };
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
