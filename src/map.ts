import maplibregl, { type Map as MLMap, type StyleSpecification, type LngLatBoundsLike } from 'maplibre-gl';
import type { LngLat } from './dem';
import { TERRAIN_TILE_URL } from './dem';
import type { Route } from './route';
import { bearingDeg } from './route';

export type Mode = 'satellite' | 'relief';

const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const ATTR_TERRAIN = 'Terrain: <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Mapzen Terrain Tiles</a> (AWS Open Data)';
const ATTR_IMAGERY = 'Imagery © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function buildStyle(mode: Mode): StyleSpecification {
  return {
    version: 8,
    sources: {
      terrain: { type: 'raster-dem', tiles: [TERRAIN_TILE_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: ATTR_TERRAIN },
      imagery: { type: 'raster', tiles: [IMAGERY_URL], tileSize: 256, maxzoom: 19, attribution: ATTR_IMAGERY },
      river: { type: 'geojson', data: EMPTY, lineMetrics: true },
      flooded: { type: 'geojson', data: EMPTY },
      front: { type: 'geojson', data: EMPTY },
      overlay2025: { type: 'geojson', data: EMPTY },
      uncertainty: { type: 'geojson', data: EMPTY },
      lake: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': mode === 'satellite' ? '#06080c' : '#0b0e13' } },
      { id: 'imagery', type: 'raster', source: 'imagery', layout: { visibility: mode === 'satellite' ? 'visible' : 'none' },
        paint: { 'raster-saturation': -0.15, 'raster-contrast': 0.08, 'raster-brightness-max': 0.92 } },
      { id: 'hillshade', type: 'hillshade', source: 'terrain',
        paint: mode === 'satellite'
          ? { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#000000', 'hillshade-illumination-direction': 315 }
          : { 'hillshade-exaggeration': 0.85, 'hillshade-shadow-color': '#04060a', 'hillshade-highlight-color': '#a9b7c9', 'hillshade-accent-color': '#22304a', 'hillshade-illumination-direction': 315 } },

      { id: 'uncertainty-fill', type: 'fill', source: 'uncertainty', paint: { 'fill-color': '#d6ecff', 'fill-opacity': 0.08 } },
      { id: 'uncertainty-line', type: 'line', source: 'uncertainty', paint: { 'line-color': '#d6ecff', 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.6 } },

      { id: 'lake-fill', type: 'fill', source: 'lake', paint: { 'fill-color': '#7fd0ff', 'fill-opacity': 0.28 } },
      { id: 'lake-line', type: 'line', source: 'lake', paint: { 'line-color': '#bfe6ff', 'line-width': 1.5, 'line-opacity': 0.9 } },

      { id: 'overlay2025-glow', type: 'line', source: 'overlay2025', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffd166', 'line-width': 9, 'line-blur': 6, 'line-opacity': 0.35 } },
      { id: 'overlay2025', type: 'line', source: 'overlay2025', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffd166', 'line-width': 2.2, 'line-dasharray': [1.5, 2], 'line-opacity': 0.9 } },

      { id: 'river-ahead', type: 'line', source: 'river', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#4aa3ff', 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 1.4, 12, 3.2, 15, 7], 'line-opacity': 0.85 } },

      { id: 'flood-glow', type: 'line', source: 'flooded', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ff8a3d', 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 8, 12, 18, 15, 40], 'line-blur': 8, 'line-opacity': 0.38 } },
      { id: 'flood-core', type: 'line', source: 'flooded', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#c8551f', 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 2.4, 12, 5.5, 15, 12], 'line-opacity': 0.95 } },

      { id: 'front-halo', type: 'circle', source: 'front',
        paint: { 'circle-color': '#ffb066', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 13, 30], 'circle-blur': 1, 'circle-opacity': 0.55 } },
      { id: 'front-core', type: 'circle', source: 'front',
        paint: { 'circle-color': '#ffd9b0', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 13, 8], 'circle-stroke-color': '#ff8a3d', 'circle-stroke-width': 2 } },
    ],
    // sky/fog are applied via setSky() after load (spec property differs across versions)
  };
}

export interface CameraPreset { center: LngLat; zoom: number; pitch: number; bearing: number; }

export class FloodMap {
  map: MLMap;
  mode: Mode = 'satellite';
  exaggeration = 1.6;
  tileErrors = 0;
  private markers: maplibregl.Marker[] = [];

  constructor(container: HTMLElement, mode: Mode = 'satellite') {
    this.mode = mode;
    this.map = new maplibregl.Map({
      container,
      style: buildStyle(mode),
      center: [85.0, 28.0],
      zoom: 8.6,
      pitch: 62,
      bearing: 20,
      maxPitch: 85,
      antialias: true,
      attributionControl: false,
      maxZoom: 17,
      minZoom: 6,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true }), 'top-right');
    this.map.on('error', (e: any) => {
      const msg = String(e?.error?.message ?? '');
      if (/tile|fetch|Failed|403|404|NetworkError/i.test(msg)) this.tileErrors++;
    });
  }

  ready(): Promise<void> {
    return new Promise((res) => (this.map.loaded() ? res() : this.map.once('load', () => res())));
  }

  applyTerrainAndSky() {
    this.map.setTerrain({ source: 'terrain', exaggeration: this.exaggeration });
    try {
      (this.map as any).setSky({
        'sky-color': this.mode === 'satellite' ? '#0e1a2e' : '#0a0f18',
        'horizon-color': this.mode === 'satellite' ? '#35507a' : '#1c2740',
        'fog-color': this.mode === 'satellite' ? '#0b1220' : '#0b0e13',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.75,
        'fog-ground-blend': 0.85,
      });
    } catch { /* older spec */ }
  }

  setExaggeration(v: number) {
    this.exaggeration = v;
    this.map.setTerrain({ source: 'terrain', exaggeration: v });
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const m = this.map;
    m.setLayoutProperty('imagery', 'visibility', mode === 'satellite' ? 'visible' : 'none');
    m.setPaintProperty('bg', 'background-color', mode === 'satellite' ? '#06080c' : '#0b0e13');
    if (mode === 'satellite') {
      m.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.35);
      m.setPaintProperty('hillshade', 'hillshade-highlight-color', '#ffffff');
      m.setPaintProperty('hillshade', 'hillshade-accent-color', '#000000');
    } else {
      m.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.85);
      m.setPaintProperty('hillshade', 'hillshade-highlight-color', '#a9b7c9');
      m.setPaintProperty('hillshade', 'hillshade-accent-color', '#22304a');
    }
    this.applyTerrainAndSky();
  }

  setRoute(route: Route) {
    const coords = route.points.map((p) => [p.lng, p.lat]);
    (this.map.getSource('river') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }],
    });
  }

  /** Update the flooded portion + front for a route index/fraction. */
  setFront(route: Route, idx: number, f: number, pos: LngLat) {
    const coords = route.points.slice(0, idx + 1).map((p) => [p.lng, p.lat]);
    if (f > 0 || coords.length === 0) coords.push(pos);
    const flooded = coords.length >= 2
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] }
      : EMPTY;
    (this.map.getSource('flooded') as maplibregl.GeoJSONSource).setData(flooded as any);
    (this.map.getSource('front') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pos } }],
    });
  }

  setOverlay2025(route: Route, fromIdx: number, toIdx: number, visible: boolean) {
    const coords = route.points.slice(fromIdx, toIdx + 1).map((p) => [p.lng, p.lat]);
    (this.map.getSource('overlay2025') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }],
    });
    this.map.setLayoutProperty('overlay2025', 'visibility', visible ? 'visible' : 'none');
    this.map.setLayoutProperty('overlay2025-glow', 'visibility', visible ? 'visible' : 'none');
  }

  setUncertainty(center: LngLat, radiusM: number) {
    (this.map.getSource('uncertainty') as maplibregl.GeoJSONSource).setData(circle(center, radiusM));
  }

  setLake(center: LngLat, visible: boolean) {
    // Approximate footprint of a 2,000,000 m³ barrier lake in a steep valley (~250 m × 800 m), for scale only.
    (this.map.getSource('lake') as maplibregl.GeoJSONSource).setData(visible ? ellipse(center, 400, 130, 20) : EMPTY);
  }

  addMarker(el: HTMLElement, lngLat: LngLat, anchor: 'bottom' | 'center' = 'bottom') {
    const mk = new maplibregl.Marker({ element: el, anchor, opacityWhenCovered: '0.15' }).setLngLat(lngLat).addTo(this.map);
    this.markers.push(mk);
    return mk;
  }

  flyToSite(lngLat: LngLat, next?: LngLat, zoom = 13.2) {
    const bearing = next ? (bearingDeg(lngLat, next) + 180) % 360 : this.map.getBearing();
    // look *down* the valley: camera behind the site, facing the direction of flow
    this.map.flyTo({ center: lngLat, zoom, pitch: 66, bearing: (bearing + 180) % 360, duration: 1900, essential: true });
  }

  overview(bounds: LngLatBoundsLike) {
    this.map.fitBounds(bounds, { padding: { top: 90, bottom: 190, left: 280, right: 240 }, pitch: 58, bearing: 18, duration: 1800, essential: true });
  }

  impactDetail(a: LngLat, b: LngLat) {
    const c: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const bearing = bearingDeg(a, b);
    this.map.flyTo({ center: c, zoom: 12.4, pitch: 70, bearing, duration: 2000, essential: true });
  }
}

/* ---- tiny geometry helpers ---- */
function circle(c: LngLat, rM: number, n = 64): GeoJSON.FeatureCollection {
  const pts: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(offset(c, Math.cos(a) * rM, Math.sin(a) * rM));
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } }] };
}
function ellipse(c: LngLat, aM: number, bM: number, rotDeg: number, n = 48): GeoJSON.FeatureCollection {
  const r = (rotDeg * Math.PI) / 180, pts: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * aM, y = Math.sin(t) * bM;
    pts.push(offset(c, x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)));
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } }] };
}
function offset(p: LngLat, eastM: number, northM: number): number[] {
  const R = 6371000;
  return [p[0] + (eastM / (R * Math.cos((p[1] * Math.PI) / 180))) * (180 / Math.PI), p[1] + (northM / R) * (180 / Math.PI)];
}
