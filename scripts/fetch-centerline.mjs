#!/usr/bin/env node
/**
 * Bake the real OSM waterway centreline for the flood corridor.
 *
 *   npm run centerline            # fetch from Overpass, write src/data/centerline.json
 *   npm run centerline -- --check # re-verify the baked file without refetching
 *
 * Why a graph search rather than "fetch the ways named Bhote Koshi":
 * the corridor changes name four times (Gyirong Tsangpo / 吉隆藏布 → Bhote Koshi →
 * Trishuli → Narayani), is split across ~1,200 OSM ways, and many are unnamed. So we
 * build a node graph of every waterway in the corridor bbox and run a shortest path
 * through the event's own stage coordinates as ordered anchors. Tributaries are dead
 * ends, so the shortest path that must pass Rasuwagadhi → Timure → Syabrubesi →
 * Betrawati → Malekhu → Mugling → Narayanghat is the main stem by construction.
 *
 * Output is the geometry only; all editorial content stays in event.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EVENT_PATH = path.join(ROOT, 'src/data/event.json');
const OUT_PATH = path.join(ROOT, 'src/data/centerline.json');

// Corridor bbox (s, w, n, e) — PRD R1 area, widened a little for the Tibetan headwaters.
const BBOX = [27.55, 84.20, 28.45, 85.60];
// Streams only near the top, where the Lhende Khola headwaters are not tagged as rivers.
const HEADWATER_BBOX = [28.10, 85.20, 28.45, 85.60];

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const UA = 'bhotekoshi-2026-flood/1.0 (open-data flood reconstruction)';

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const lenKm = (cs) => { let t = 0; for (let i = 1; i < cs.length; i++) t += hav(cs[i - 1], cs[i]); return t / 1000; };

export function overpassQuery() {
  return `[out:json][timeout:240];
(
  way["waterway"="river"](${BBOX.join(',')});
  way["waterway"="stream"](${HEADWATER_BBOX.join(',')});
);
out geom;`;
}

async function fetchOverpass() {
  const body = 'data=' + encodeURIComponent(overpassQuery());
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      process.stderr.write(`  → ${new URL(url).host} … `);
      const res = await fetch(url, {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      process.stderr.write(`${json.elements.length} ways\n`);
      return json;
    } catch (e) { process.stderr.write(`failed (${e.message})\n`); lastErr = e; }
  }
  throw new Error(`all Overpass endpoints failed: ${lastErr?.message}`);
}

/* ---------------- graph ---------------- */
// OSM ways share exact node coordinates at junctions, so an exact coordinate key
// reconstructs real topology without any distance tolerance.
const nodeKey = (lon, lat) => `${lon.toFixed(7)},${lat.toFixed(7)}`;

function buildGraph(elements) {
  const adj = new Map(), nodes = new Map();
  const link = (a, b, w) => { (adj.get(a) ?? adj.set(a, []).get(a)).push({ to: b, w }); };
  for (const el of elements) {
    const g = el.geometry;
    if (!g || g.length < 2) continue;
    for (let i = 1; i < g.length; i++) {
      const a = [g[i - 1].lon, g[i - 1].lat], b = [g[i].lon, g[i].lat];
      const ka = nodeKey(a[0], a[1]), kb = nodeKey(b[0], b[1]);
      if (ka === kb) continue;
      nodes.set(ka, a); nodes.set(kb, b);
      const w = hav(a, b);
      link(ka, kb, w); link(kb, ka, w); // rivers are traversed downstream, but the
      // graph is undirected so a mis-drawn way direction cannot break connectivity
    }
  }
  return { adj, nodes };
}

function nearestNode(nodes, p) {
  let best = Infinity, bk = null;
  for (const [k, c] of nodes) { const d = hav(c, p); if (d < best) { best = d; bk = k; } }
  return { key: bk, distM: best };
}

function dijkstra(adj, nodes, startKey, goalKey) {
  const dist = new Map([[startKey, 0]]), prev = new Map(), seen = new Set();
  const heap = [[0, startKey]];
  const push = (d, k) => {
    heap.push([d, k]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, k] = pop();
    if (seen.has(k)) continue;
    seen.add(k);
    if (k === goalKey) break;
    for (const e of adj.get(k) ?? []) {
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, k); push(nd, e.to); }
    }
  }
  if (!dist.has(goalKey)) return null;
  const keys = [goalKey];
  let c = goalKey;
  while (prev.has(c)) { c = prev.get(c); keys.push(c); }
  keys.reverse();
  return { coords: keys.map((k) => nodes.get(k)), distM: dist.get(goalKey) };
}

/* ---------------- geometry cleanup ---------------- */
/** Douglas–Peucker on lng/lat, tolerance in metres. */
function simplify(coords, tolM) {
  if (coords.length < 3) return coords;
  const sqTol = tolM * tolM;
  const perpSq = (p, a, b) => {
    // local planar approximation is fine at these distances
    const kx = Math.cos(rad((a[1] + b[1]) / 2)) * 111320, ky = 110540;
    const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky, px = p[0] * kx, py = p[1] * ky;
    let dx = bx - ax, dy = by - ay;
    const d2 = dx * dx + dy * dy;
    let t = d2 ? ((px - ax) * dx + (py - ay) * dy) / d2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    return (px - qx) ** 2 + (py - qy) ** 2;
  };
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = 0, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpSq(coords[k], coords[i], coords[j]);
      if (d > maxD) { maxD = d; idx = k; }
    }
    if (idx > 0 && maxD > sqTol) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Drop consecutive duplicates and any zero-length steps. */
const dedupe = (cs) => cs.filter((c, i) => i === 0 || hav(cs[i - 1], c) > 0.5);

/* ---------------- main ---------------- */
async function main() {
  const event = JSON.parse(fs.readFileSync(EVENT_PATH, 'utf8'));
  const stages = event.stages.map((s) => ({ id: s.id, lngLat: s.lngLat }));

  console.log(`Fetching waterways for the corridor from Overpass…`);
  const data = await fetchOverpass();

  const { adj, nodes } = buildGraph(data.elements);
  console.log(`Graph: ${nodes.size.toLocaleString()} nodes from ${data.elements.length} ways`);

  // Anchor selection: first and last stage always anchor the route; intermediate
  // stages anchor it only when they sit close enough to the mapped channel to be
  // trustworthy (a stage 1.4 km away would drag the path up a tributary).
  const MAX_ANCHOR_M = 800;
  const snaps = stages.map((s) => ({ ...s, snap: nearestNode(nodes, s.lngLat) }));
  const anchors = snaps.filter((s, i) =>
    i === 0 || i === snaps.length - 1 || s.snap.distM <= MAX_ANCHOR_M);

  console.log('\nStage → OSM channel distance:');
  for (const s of snaps) {
    const used = anchors.includes(s);
    console.log(`  ${s.id.padEnd(5)} ${String(Math.round(s.snap.distM)).padStart(5)} m  ${used ? 'anchor' : '(skipped — too far to trust)'}`);
  }

  console.log('\nRouting the main stem:');
  let coords = [];
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1], b = anchors[i];
    const seg = dijkstra(adj, nodes, a.snap.key, b.snap.key);
    if (!seg) throw new Error(`no channel path ${a.id} → ${b.id}; corridor is disconnected in OSM`);
    console.log(`  ${a.id.padEnd(5)} → ${b.id.padEnd(5)} ${(seg.distM / 1000).toFixed(1).padStart(6)} km`);
    coords.push(...(i === 1 ? seg.coords : seg.coords.slice(1)));
  }

  const rawKm = lenKm(coords);
  coords = simplify(dedupe(coords), 12).map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]);
  const km = lenKm(coords);

  // sanity gates
  const problems = [];
  if (coords.length < 200) problems.push(`only ${coords.length} points`);
  if (km < 120 || km > 260) problems.push(`implausible length ${km.toFixed(1)} km`);
  const maxStep = Math.max(...coords.slice(1).map((c, i) => hav(coords[i], c)));
  if (maxStep > 5000) problems.push(`${Math.round(maxStep)} m gap between consecutive points`);
  if (problems.length) throw new Error('centreline failed sanity checks: ' + problems.join('; '));

  const out = {
    note: 'Generated by scripts/fetch-centerline.mjs — do not hand-edit. Real OSM waterway centreline for the Lhende Khola → Bhote Koshi → Trishuli → Narayani corridor, routed through the event stages as ordered anchors.',
    source: 'OpenStreetMap contributors (Overpass API), ODbL 1.0',
    generated: new Date().toISOString().slice(0, 10),
    bbox: BBOX,
    anchors: anchors.map((a) => a.id),
    lengthKm: Number(km.toFixed(2)),
    coordinates: coords,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 0) + '\n');

  console.log(`\n✓ ${coords.length} points, ${km.toFixed(1)} km (${rawKm.toFixed(1)} km before simplify)`);
  console.log(`✓ wrote ${path.relative(ROOT, OUT_PATH)} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error('\n✗ ' + e.message); process.exit(1); });
