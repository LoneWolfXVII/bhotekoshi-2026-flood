import type { LngLat } from './dem';
import { DemSampler } from './dem';

export interface ProfilePoint {
  lng: number; lat: number;
  km: number;          // cumulative along-path distance
  elev: number;        // metres (thalweg, monotonic-enforced)
  elevRaw: number;     // metres as sampled
  grad: number;        // m/km, positive downhill
  tMin: number; tMid: number; tMax: number; // seconds since t0 (routing band)
}

export interface Route {
  points: ProfilePoint[];
  totalKm: number;
  totalSec: number;   // mid estimate
  snapped: boolean;   // true if DEM sampling succeeded
  demFailures: number;
  demFetched: number;
  /** How lateral position was decided — see SnapMode. */
  snapMode: SnapMode;
}

/**
 * `thalweg`   — the line is only approximate, so each point is *moved* to the lowest DEM
 *               cell across a wide valley transect. Corrects lateral error, but in a broad
 *               floodplain the lowest cell can belong to a side channel or a neighbouring
 *               drainage, which pulls the path off the river.
 * `elevation` — the line is already the surveyed channel (OSM), so points are never moved;
 *               the DEM is used only to read an elevation, taking the minimum over a narrow
 *               window to land on the water surface rather than a bank or a bridge deck.
 */
export type SnapMode = 'thalweg' | 'elevation';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LngLat, b: LngLat) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Move a point by (east, north) metres. */
function offsetM(p: LngLat, eastM: number, northM: number): LngLat {
  const dLat = (northM / R) * (180 / Math.PI);
  const dLng = (eastM / (R * Math.cos(rad(p[1])))) * (180 / Math.PI);
  return [p[0] + dLng, p[1] + dLat];
}

export function densify(coords: LngLat[], stepM = 200): LngLat[] {
  const out: LngLat[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const d = haversineM(a, b);
    const n = Math.max(1, Math.round(d / stepM));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  return out;
}

export interface RoutingParams { kMin: number; kMid: number; kMax: number; vMin: number; vMax: number; }

/**
 * Build the route:
 *  1. densify the input line
 *  2. sample a perpendicular transect and either move the point to the lowest DEM cell
 *     (`thalweg`) or just read an elevation without moving it (`elevation`) — see SnapMode
 *  3. enforce monotonic non-increasing elevation downstream
 *  4. gradient over a ±1 km window, then slope-kinematic routing for k in {min, mid, max}
 */
export async function buildRoute(
  line: LngLat[],
  params: RoutingParams,
  opts: {
    stepM?: number; transectHalfM?: number; transectSamples?: number;
    snapMode?: SnapMode;
    /**
     * Reported elevation of the flow's origin, in metres. When the first point's
     * position is provisional — a collapse scar known by report rather than by
     * coordinate — the DEM sample there describes the valley floor, not the source.
     * Supplying this anchors the profile and the first gradient to the sourced value
     * instead. The position is left untouched; only the elevation is overridden.
     */
    startElevM?: number;
    onProgress?: (label: string, f: number) => void;
  } = {}
): Promise<Route> {
  const mode: SnapMode = opts.snapMode ?? 'thalweg';
  const stepM = opts.stepM ?? 200;
  // A surveyed centreline needs only a narrow window to find the water surface; an
  // approximate line needs a whole-valley transect to be dragged onto the channel.
  const halfM = opts.transectHalfM ?? (mode === 'elevation' ? 60 : 900);
  const nS = opts.transectSamples ?? (mode === 'elevation' ? 5 : 25);
  const prog = opts.onProgress ?? (() => {});

  const dense = densify(line, stepM);
  const dem = new DemSampler(12, 6);

  // 1) sample transects
  prog('Sampling real elevation across the valley', 0.05);
  const transects: LngLat[][] = dense.map((p, i) => {
    const a = dense[Math.max(0, i - 2)], b = dense[Math.min(dense.length - 1, i + 2)];
    const e = haversineM([a[0], a[1]], [b[0], a[1]]) * Math.sign(b[0] - a[0]);
    const n = haversineM([a[0], a[1]], [a[0], b[1]]) * Math.sign(b[1] - a[1]);
    const len = Math.hypot(e, n) || 1;
    const pe = -n / len, pn = e / len; // perpendicular unit (east, north)
    const out: LngLat[] = [];
    for (let s = 0; s < nS; s++) {
      const off = -halfM + (2 * halfM * s) / (nS - 1);
      out.push(offsetM(p, pe * off, pn * off));
    }
    return out;
  });
  const flat = transects.flat();
  const elev = await dem.elevations(flat, (d, t) => prog('Sampling real elevation across the valley', 0.05 + 0.7 * (d / t)));

  // 2) snap
  prog(mode === 'elevation' ? 'Reading channel elevation' : 'Snapping to the valley floor', 0.8);
  const snappedPts: LngLat[] = [];
  const snappedElev: number[] = [];
  let nulls = 0;
  for (let i = 0; i < dense.length; i++) {
    let best = Infinity, bi = Math.floor(nS / 2);
    for (let s = 0; s < nS; s++) {
      const v = elev[i * nS + s];
      if (v == null) continue;
      // mild centre preference so a neighbouring valley doesn't steal the point
      const w = 1 + 0.15 * Math.abs(s - (nS - 1) / 2) / ((nS - 1) / 2);
      const score = v * w;
      if (score < best) { best = score; bi = s; }
    }
    const v = elev[i * nS + bi];
    if (v == null) { nulls++; snappedPts.push(dense[i]); snappedElev.push(NaN); }
    // In `elevation` mode the OSM geometry is authoritative: take the elevation, keep the position.
    else { snappedPts.push(mode === 'elevation' ? dense[i] : transects[i][bi]); snappedElev.push(v); }
  }
  const snapped = nulls < dense.length * 0.2;

  // fill NaN elevations by interpolation (or fallback linear profile if DEM failed entirely)
  if (!snapped) {
    for (let i = 0; i < snappedElev.length; i++) snappedElev[i] = 5300 - (5300 - 180) * (i / (snappedElev.length - 1));
  } else {
    let lastGood = -1;
    for (let i = 0; i < snappedElev.length; i++) {
      if (!Number.isNaN(snappedElev[i])) {
        if (lastGood >= 0 && i - lastGood > 1) {
          for (let k = lastGood + 1; k < i; k++) snappedElev[k] = snappedElev[lastGood] + (snappedElev[i] - snappedElev[lastGood]) * ((k - lastGood) / (i - lastGood));
        } else if (lastGood < 0 && i > 0) { for (let k = 0; k < i; k++) snappedElev[k] = snappedElev[i]; }
        lastGood = i;
      }
    }
    if (lastGood >= 0) for (let k = lastGood + 1; k < snappedElev.length; k++) snappedElev[k] = snappedElev[lastGood];
  }

  // Reported origin elevation wins over the DEM sample at a provisional coordinate.
  // Applied before the monotonic cascade and the gradient window so the profile, the
  // stage card and the routing model all agree on where the flow started.
  if (snapped && opts.startElevM != null && Number.isFinite(opts.startElevM)) {
    snappedElev[0] = opts.startElevM;
  }

  // 3) smooth positions (window 3) — only needed where snapping moved points around;
  //    an OSM centreline is already a clean surveyed line and smoothing would cut its meanders.
  const pts: LngLat[] = mode === 'elevation' ? snappedPts : snappedPts.map((p, i) => {
    if (i === 0 || i === snappedPts.length - 1) return p;
    const a = snappedPts[i - 1], b = snappedPts[i + 1];
    return [(a[0] + p[0] + b[0]) / 3, (a[1] + p[1] + b[1]) / 3];
  });
  // monotonic non-increasing (rivers don't flow uphill; removes DEM noise / bridge artefacts)
  const mono: number[] = [];
  let m = Infinity;
  for (let i = 0; i < snappedElev.length; i++) { m = Math.min(m, snappedElev[i]); mono.push(m); }

  // cumulative distance
  const km: number[] = [0];
  for (let i = 1; i < pts.length; i++) km.push(km[i - 1] + haversineM(pts[i - 1], pts[i]) / 1000);
  const totalKm = km[km.length - 1];

  // 4) gradient over ±1 km window
  const grad: number[] = pts.map((_, i) => {
    let a = i, b = i;
    while (a > 0 && km[i] - km[a] < 1) a--;
    while (b < pts.length - 1 && km[b] - km[i] < 1) b++;
    const dz = mono[a] - mono[b], dd = Math.max(km[b] - km[a], 0.05);
    return Math.max(dz / dd, 0.5);
  });

  const route = (k: number) => {
    const t: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const v = Math.min(params.vMax, Math.max(params.vMin, k * Math.sqrt(grad[i])));
      t.push(t[i - 1] + ((km[i] - km[i - 1]) * 1000) / v);
    }
    return t;
  };
  const tMin = route(params.kMax), tMid = route(params.kMid), tMax = route(params.kMin);

  prog('Routing the flow', 0.97);
  const points: ProfilePoint[] = pts.map((p, i) => ({
    lng: p[0], lat: p[1], km: km[i], elev: mono[i], elevRaw: snappedElev[i], grad: grad[i],
    tMin: tMin[i], tMid: tMid[i], tMax: tMax[i],
  }));
  return { points, totalKm, totalSec: tMid[tMid.length - 1], snapped, demFailures: dem.failures, demFetched: dem.fetched, snapMode: mode };
}

/** Index of the nearest route point to a lng/lat. */
export function nearestIndex(route: Route, p: LngLat) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < route.points.length; i++) {
    const q = route.points[i];
    const d = (q.lng - p[0]) ** 2 + ((q.lat - p[1]) * 1.13) ** 2; // rough anisotropy at 28°N
    if (d < best) { best = d; bi = i; }
  }
  return bi;
}

/** Interpolated state at a modeled time (mid estimate). */
export function stateAtTime(route: Route, tSec: number) {
  const P = route.points;
  if (tSec <= 0) return { ...P[0], idx: 0, f: 0 };
  if (tSec >= P[P.length - 1].tMid) return { ...P[P.length - 1], idx: P.length - 1, f: 1 };
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; (P[mid].tMid <= tSec ? (lo = mid) : (hi = mid)); }
  const a = P[lo], b = P[hi], f = (tSec - a.tMid) / Math.max(b.tMid - a.tMid, 1e-6);
  return {
    lng: a.lng + (b.lng - a.lng) * f, lat: a.lat + (b.lat - a.lat) * f,
    km: a.km + (b.km - a.km) * f, elev: a.elev + (b.elev - a.elev) * f, elevRaw: a.elevRaw, grad: a.grad,
    tMin: a.tMin, tMid: tSec, tMax: a.tMax, idx: lo, f: f / 1,
  };
}

export function bearingDeg(a: LngLat, b: LngLat) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
