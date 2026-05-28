/**
 * dijkstra.js — Shortest-path routing across the multi-floor graph
 *
 * Uses a binary min-heap priority queue for O((V+E) log V) performance.
 * Returns the full path and total cost in metres.
 */

"use strict";

// ── Minimal binary min-heap ───────────────────────────────────────────────────
class MinHeap {
  constructor() {
    this._data = [];
  }

  push(priority, value) {
    this._data.push({ priority, value });
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    if (this._data.length === 0) return null;
    const top = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  get size() {
    return this._data.length;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[parent].priority <= this._data[i].priority) break;
      [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
      i = parent;
    }
  }

  _siftDown(i) {
    const n = this._data.length;
    for (;;) {
      let smallest = i;
      const l = 2 * i + 1,
        r = 2 * i + 2;
      if (l < n && this._data[l].priority < this._data[smallest].priority)
        smallest = l;
      if (r < n && this._data[r].priority < this._data[smallest].priority)
        smallest = r;
      if (smallest === i) break;
      [this._data[smallest], this._data[i]] = [
        this._data[i],
        this._data[smallest],
      ];
      i = smallest;
    }
  }
}

// ── Dijkstra ──────────────────────────────────────────────────────────────────
/**
 * @param {string}   sourceId       - starting node ID
 * @param {string}   destId         - destination node ID
 * @param {Object}   adjacency      - adjacency list from buildAdjacency()
 * @returns {{ path: string[], cost: number }|null }
 */
function dijkstra(sourceId, destId, adjacency) {
  if (sourceId === destId) return { path: [sourceId], cost: 0 };

  const dist = {}; // nodeId → best known distance
  const prev = {}; // nodeId → predecessor nodeId
  const heap = new MinHeap();

  // Initialise all nodes to Infinity
  Object.keys(adjacency).forEach((id) => {
    dist[id] = Infinity;
    prev[id] = null;
  });

  dist[sourceId] = 0;
  heap.push(0, sourceId);

  while (heap.size > 0) {
    const { priority: du, value: u } = heap.pop();

    // Early exit
    if (u === destId) break;

    // Stale entry guard
    if (du > dist[u]) continue;

    for (const { to: v, weight: w } of adjacency[u] || []) {
      const alt = dist[u] + w;
      if (alt < dist[v]) {
        dist[v] = alt;
        prev[v] = u;
        heap.push(alt, v);
      }
    }
  }

  if (dist[destId] === Infinity) return null; // no path found

  // Reconstruct path
  const path = [];
  let cur = destId;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev[cur];
  }

  return { path, cost: dist[destId] };
}
