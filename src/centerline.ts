import type { LngLat } from './dem';
import CENTERLINE from './data/centerline.json';

/**
 * Where the flow path geometry came from, in preference order.
 *  - `osm`  : the real OSM waterway centreline baked by scripts/fetch-centerline.mjs
 *  - `seed` : the hand-digitised line in event.json, used only if the baked file is unusable
 */
export type PathSource = 'osm' | 'seed';

export interface Centerline {
  coords: LngLat[];
  source: PathSource;
  /** Human-readable provenance for the method panel. */
  attribution: string;
  generated?: string;
  lengthKm?: number;
}

/**
 * The baked centreline is bundled into the single-file build, so the corridor geometry
 * is available offline and on first paint — no Overpass round-trip at load, which would
 * cost several MB and break the mobile transfer budget. Refresh it with `npm run centerline`.
 */
export function loadCenterline(seed: LngLat[]): Centerline {
  const c = CENTERLINE as { coordinates?: unknown; source?: string; generated?: string; lengthKm?: number };
  const coords = c?.coordinates;
  if (isUsable(coords)) {
    return {
      coords: coords as LngLat[],
      source: 'osm',
      attribution: c.source ?? 'OpenStreetMap contributors (ODbL 1.0)',
      generated: c.generated,
      lengthKm: c.lengthKm,
    };
  }
  return {
    coords: seed,
    source: 'seed',
    attribution: 'Digitised from known river towns (OSM centreline unavailable)',
  };
}

/** A centreline we would rather fall back than trust: too short, or not a coordinate list. */
function isUsable(coords: unknown): coords is LngLat[] {
  if (!Array.isArray(coords) || coords.length < 200) return false;
  return coords.every(
    (p) => Array.isArray(p) && p.length === 2 &&
      Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
      Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90,
  );
}
