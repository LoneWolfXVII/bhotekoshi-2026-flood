# Bhote Koshi 2026 — 3D reconstruction on real terrain

Interactive reconstruction of the 26 August 2026 Nepal–Tibet glacial debris flow: a ~5,300 m glacier collapse in Tibet that travelled ~170 km down the Lhende Khola → Bhote Koshi → Trishuli → Narayani corridor.

**Open `dist/index.html` directly in a browser.** It is a single self-contained file (MapLibre inlined) and needs no server or API keys. Terrain and imagery stream from open tile servers, so an internet connection is required.

> Some embedded/sandboxed viewers block tile requests. If the map is dark and a red notice appears, download the file and open it from disk.

## What it does

- **Real terrain.** 3D elevation from Mapzen/AWS Terrain Tiles (Terrarium-encoded SRTM/NASADEM), draped with Esri World Imagery or a dark relief basemap. Vertical scale 1× / 1.6× / 2.5×, always displayed.
- **DEM-snapped flow path.** The corridor is seeded from known river towns, then every point is moved to the lowest DEM cell across a 1.8 km transect (the thalweg). Elevation is forced non-increasing downstream. Runs in the browser at load; the header shows how many tiles were sampled.
- **Slope-driven timing with an uncertainty band.** Front speed `v = clamp(k·√gradient, 3, 26) m/s`, k ∈ [1.6, 3.0]. Every site shows a modeled arrival window and Nepal local time. Labelled as a model everywhere.
- **Eleven sourced stages**, a linked elevation long-profile (click to seek), playback at 1×/2×/4×, follow-camera, fly-to on any site, an impact close-up preset, and deep links (`#stage=syab`).
- **Context layers:** the July 2025 flood on the same channel, warning infrastructure (with why it couldn't see a clear-sky collapse), geolocated witness footage points, and the still-live barrier lake.
- **Provisional toll panel** driven by data, with an "as of" date.
- **Provenance:** sources & method panel; plain-text transcript for accessibility and no-WebGL readers.

## Stack

MapLibre GL JS 4 · TypeScript 5 · Vite 5 (single-file build) · no framework, no keys.
See `02-IMPLEMENTATION-PLAN.md` ADR-5 for why MapLibre replaced Cesium.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + single-file dist/index.html
```

## Data

Everything editorial is in `src/data/event.json` — stages, coordinates, toll, sources, overlays. Update the JSON and rebuild; no code changes needed for corrections or for publishing a different event with the same schema.

## Honest limits

- Seed coordinates are digitised from known towns, then snapped to the DEM; positions are good to roughly ±100–200 m, not survey-grade.
- Timing is a slope-kinematic estimate, not a calibrated hydraulic model. Witness-footage timestamps, once verified, should be used to calibrate `k`.
- The glacier source carries a 2 km uncertainty circle until an authoritative coordinate is published.
- Barrier-lake footprint is drawn for scale from the reported volume, not from imagery.

## Attribution

Terrain: Mapzen Terrain Tiles / AWS Open Data (SRTM, NASADEM, and others). Imagery © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community. Reporting sources are listed in-app.
