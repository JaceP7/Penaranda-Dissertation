/**
 * dijkstra.js — Shortest-path routing across the multi-floor graph
 *
 * Uses a binary min-heap priority queue for O((V+E) log V) performance.
 * Returns the full path and total cost in metres.
 */

'use strict';

// ── Minimal binary min-heap ───────────────────────────────────────────────────
class MinHeap {
  constructor() { this._data = []; }

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

  get size() { return this._data.length; }

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
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._data[l].priority < this._data[smallest].priority) smallest = l;
      if (r < n && this._data[r].priority < this._data[smallest].priority) smallest = r;
      if (smallest === i) break;
      [this._data[smallest], this._data[i]] = [this._data[i], this._data[smallest]];
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

  const dist = {};   // nodeId → best known distance
  const prev = {};   // nodeId → predecessor nodeId
  const heap = new MinHeap();

  // Initialise all nodes to Infinity
  Object.keys(adjacency).forEach(id => {
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

    for (const { to: v, weight: w } of (adjacency[u] || [])) {
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

// ── Segment path by floor ─────────────────────────────────────────────────────
/**
 * Splits the flat path array into floor segments and detects transitions.
 *
 * @param {string[]} path - ordered list of node IDs
 * @returns {Array<{ floor:string, nodes:string[], transitions:string[] }>}
 */
function segmentPath(path) {
  if (!path || path.length === 0) return [];

  const segments = [];
  let current = { floor: NODE_MAP[path[0]].floor, nodes: [path[0]], transitionType: null };

  for (let i = 1; i < path.length; i++) {
    const node    = NODE_MAP[path[i]];
    const prevNode = NODE_MAP[path[i - 1]];

    if (node.floor !== current.floor) {
      // Detect transition type from the vertical node
      const vertNode = prevNode.type === 'vertical' ? prevNode : node;
      current.transitionType = vertNode.accessible ? 'elevator' : 'stairs';
      current.transitionLabel = vertNode.label || 'Stairwell';
      segments.push(current);
      current = { floor: node.floor, nodes: [path[i]], transitionType: null };
    } else {
      current.nodes.push(path[i]);
    }
  }
  segments.push(current);
  return segments;
}

// ── Human-readable step instructions ─────────────────────────────────────────
/**
 * Generates turn-by-turn instruction strings from path segments.
 * @param {Array} segments - output of segmentPath()
 * @param {number} totalCost - total distance in metres
 * @param {number} [walkSpeed=1.2] - walking speed in m/s
 * @returns {string[]}
 */
function buildInstructions(segments, totalCost, walkSpeed = 1.2) {
  const steps = [];
  const totalSecs = Math.round(totalCost / walkSpeed);
  const totalMin  = Math.ceil(totalSecs / 60);

  segments.forEach((seg, i) => {
    const floorLabel = BUILDING.floors.find(f => f.id === seg.floor)?.label || seg.floor;
    const destNode   = NODE_MAP[seg.nodes[seg.nodes.length - 1]];

    // A "transit-only" segment has just one vertical node — the elevator/stair landing.
    // Skip the "Proceed to" instruction for transit floors (you pass straight through).
    const isTransitFloor =
      seg.nodes.length === 1 && destNode.type === 'vertical' && seg.transitionType;

    if (i === 0) {
      const originNode = NODE_MAP[seg.nodes[0]];
      const originLabel = originNode.label || 'your location';
      steps.push(`Start at ${originLabel} on the ${floorLabel}.`);
    }

    // Transition instruction (e.g. "Take the elevator to the 3rd Floor.")
    if (seg.transitionType) {
      const nextFloor = BUILDING.floors.find(f => f.id === segments[i + 1]?.floor)?.label || '';
      const via       = seg.transitionLabel ? ` (${seg.transitionLabel.replace(/ \(F\d\)/, '')})` : '';
      const verb      = seg.transitionType === 'elevator' ? 'Take the elevator' : 'Use the stairwell';
      steps.push(`${verb}${via} to the ${nextFloor}.`);
    }

    // "Proceed to" step — skip for transit-only floors and for the very first segment
    if (i > 0 && !isTransitFloor) {
      const label = destNode.type !== 'vertical' ? (destNode.label || floorLabel) : floorLabel;
      steps.push(`Walk to ${label} on the ${floorLabel}.`);
    }
  });

  const lastNode = NODE_MAP[segments[segments.length - 1].nodes.at(-1)];
  steps.push(`Arrive at ${lastNode.label || 'your destination'}.`);
  steps.push(`Total: ~${totalCost.toFixed(0)} m · ~${totalMin} min walk`);

  return steps;
}
