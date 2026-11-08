// Pure list-merge logic, shared by the Worker and the client so both converge identically.
const LOG_CAP = 500;
const TOMBSTONE_MS = 7 * 24 * 3600 * 1000;

// Bounds stored data: caps the log and purges old tombstones. Applied on every write.
export function compactList(data, now = Date.now()) {
  const cutoff = now - TOMBSTONE_MS;
  return {
    ...data,
    items: (data.items || []).filter((it) => !(it.deleted && (it.updatedAt || 0) < cutoff)),
    shelf: data.shelf || {},
    log: (data.log || []).slice(-LOG_CAP),
  };
}

// Item-level last-writer-wins; `incoming` wins ties. Deletes are tombstones, so they merge too.
export function mergeLists(current, incoming, now = Date.now()) {
  const items = new Map();
  for (const it of current.items || []) items.set(it.id, it);
  for (const it of incoming.items || []) {
    const prev = items.get(it.id);
    if (!prev || (it.updatedAt || 0) >= (prev.updatedAt || 0)) items.set(it.id, it);
  }
  const shelf = { ...(current.shelf || {}) };
  for (const [k, v] of Object.entries(incoming.shelf || {})) {
    const prev = shelf[k];
    if (!prev) { shelf[k] = v; continue; }
    const newer = (v.lastAt || 0) >= (prev.lastAt || 0);
    shelf[k] = {
      name: newer ? v.name : prev.name,
      category: newer ? v.category : prev.category,
      fav: newer ? v.fav : prev.fav,
      lastAt: Math.max(v.lastAt || 0, prev.lastAt || 0),
      count: Math.max(v.count || 0, prev.count || 0),
    };
  }
  const logMap = new Map();
  for (const e of [...(current.log || []), ...(incoming.log || [])]) logMap.set(e.id, e);
  const log = [...logMap.values()].sort((a, b) => a.ts - b.ts);
  return compactList({ name: incoming.name || current.name, items: [...items.values()], shelf, log }, now);
}
