/**
 * Real elevation sampling from AWS Terrain Tiles (Terrarium encoding).
 * elevation_m = (R * 256 + G + B / 256) - 32768
 *
 * Tiles are fetched directly and decoded on a canvas, so sampling is independent of
 * the map's current zoom and exaggeration. The same URLs are used by the map's
 * terrain source, so the browser cache is shared.
 */

export const TERRAIN_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export type LngLat = [number, number];

const TILE = 256;

function lngLatToTile(lng: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  return { x, y };
}

export class DemSampler {
  private cache = new Map<string, Promise<Uint8ClampedArray | null>>();
  private inflight = 0;
  private queue: Array<() => void> = [];
  public failures = 0;
  public fetched = 0;

  constructor(public zoom = 12, private concurrency = 6) {}

  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.inflight++;
        fn().then(resolve, reject).finally(() => {
          this.inflight--;
          const next = this.queue.shift();
          if (next) next();
        });
      };
      if (this.inflight < this.concurrency) run();
      else this.queue.push(run);
    });
  }

  private tile(z: number, tx: number, ty: number): Promise<Uint8ClampedArray | null> {
    const key = `${z}/${tx}/${ty}`;
    let p = this.cache.get(key);
    if (p) return p;
    p = this.schedule(async () => {
      const url = TERRAIN_TILE_URL.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty));
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        const cv = document.createElement('canvas');
        cv.width = TILE; cv.height = TILE;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0);
        this.fetched++;
        return ctx.getImageData(0, 0, TILE, TILE).data;
      } catch {
        this.failures++;
        return null;
      }
    });
    this.cache.set(key, p);
    return p;
  }

  /** Elevation in metres, or null if the tile is unavailable. */
  async elevation(lng: number, lat: number): Promise<number | null> {
    const z = this.zoom;
    const { x, y } = lngLatToTile(lng, lat, z);
    const tx = Math.floor(x), ty = Math.floor(y);
    const data = await this.tile(z, tx, ty);
    if (!data) return null;
    const px = Math.min(TILE - 1, Math.max(0, Math.floor((x - tx) * TILE)));
    const py = Math.min(TILE - 1, Math.max(0, Math.floor((y - ty) * TILE)));
    const i = (py * TILE + px) * 4;
    return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
  }

  /** Batch sample; nulls preserved. */
  async elevations(points: LngLat[], onProgress?: (done: number, total: number) => void): Promise<(number | null)[]> {
    const out: (number | null)[] = new Array(points.length).fill(null);
    let done = 0;
    await Promise.all(points.map(async (p, i) => {
      out[i] = await this.elevation(p[0], p[1]);
      done++;
      if (onProgress && (done % 25 === 0 || done === points.length)) onProgress(done, points.length);
    }));
    return out;
  }
}

/** Ground resolution (m/px) of a Terrarium tile at a given zoom and latitude. */
export function tileResolutionM(zoom: number, lat: number) {
  return (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
