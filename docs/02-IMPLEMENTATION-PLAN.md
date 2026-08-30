# Implementation Plan — Interactive 3D Flood Reconstruction

Companion to `01-PRD-flood-3d-reconstruction.md`. Covers architecture, technology decisions (ADRs), data pipeline, delivery phases, testing, operations and risks.

---

## 1. Constraints that shape the design

- **Accuracy is the product.** Real DEM, real hydrography, sourced facts (PRD G2, R1–R2, R8). Rules out hand-modelled terrain.
- **Mobile-first, low bandwidth.** ≥ 30 fps mid-tier Android, ≤ 6 MB before interactive (R9). Rules out shipping raw DEM rasters to the client; terrain must be tiled and streamed.
- **Small team, ~8 weeks.** Favour managed services and mature libraries over custom engines.
- **Reusable for the next event** (G4). Content must be data, not code.
- **Not an operational system.** No real-time ingest; static publishing is sufficient and far cheaper.

## 2. Recommended stack (summary)

| Layer | Choice | Why (short) |
|---|---|---|
| 3D globe / terrain / time | **CesiumJS 1.12x** via **Resium** (React bindings) | Native streamed terrain, true WGS84 georeferencing, built-in Clock/Timeline/CZML for time-dynamic entities, camera `flyTo`. The industry default for georeferenced 3D. See ADR-1 |
| App framework | **React 18 + TypeScript 5 + Vite** | Team familiarity, fast builds, strict types for the event schema |
| State | **Zustand** | Tiny; timeline/camera/UI state doesn't justify Redux |
| UI | **Tailwind + Radix primitives** (or shadcn/ui) | Accessible controls (R10) without a heavy component lib |
| 2-D profile chart | **visx** (D3 under React) | Precise control over the linked long-profile; SSR-safe |
| Schema & validation | **Zod** (client) · **Pydantic** (pipeline) · shared **JSON Schema** | One event schema validated on both sides; unsourced facts fail the build (R4) |
| Geo pipeline | **Python 3.12**: rasterio, GDAL, geopandas, shapely, pyproj, osmnx, xarray | Standard geospatial toolchain |
| Terrain tiling | **Cesium ion** upload → quantized-mesh (default) *or* `ctb-quantized-mesh` self-hosted | ADR-2 |
| Imagery | Sentinel-2 (open) via **Copernicus Data Space**; commercial optional | PRD Q2 |
| Flood extent (P1) | Sentinel-1 SAR change detection (SNAP / `snappy` or Google Earth Engine) | Open, repeatable |
| Hosting | Static site on **Vercel** (or S3 + CloudFront); tiles/data on **S3 + CloudFront** | No backend for v1 (ADR-3) |
| IaC / CI | **Terraform** (S3, CloudFront, IAM) · **GitHub Actions** | Reproducible; pipeline runs in CI |
| Observability | **Sentry** (errors, web vitals) · **Plausible** (privacy-respecting analytics) | PRD §6 measurement |
| Testing | **Vitest + RTL**, **Playwright** (e2e + WebGL screenshot regression), **axe-core**, **pytest** for pipeline, **Lighthouse CI** | §7 |

## 3. Architecture

### 3.1 Component view

```
┌──────────────────────────────── OFFLINE / CI DATA PIPELINE (Python) ────────────────────────────────┐
│                                                                                                     │
│  Copernicus GLO-30 DEM ──┐                                                                          │
│  OSM waterways / HydroRIVERS ─┼─▶ 1. acquire ─▶ 2. clip+reproject ─▶ 3. derive ─▶ 4. validate ─▶ 5. publish │
│  Sentinel-2 / SAR ──────┘        (bbox)          (EPSG:4326/3857)    thalweg,      pytest +      S3 +      │
│  Editorial event.json ───────────────────────────────────────────────▶ profile,     schema         ion       │
│                                                                        routing,                              │
│                                                                        CZML                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                      │ artifacts: terrain tiles · event package (JSON/GeoJSON/CZML) · imagery tiles
                                      ▼
┌──────────────────────────────── STATIC WEB APP (React + Cesium) ────────────────────────────────────┐
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────────────┐  │
│  │ EventLoader │──▶│ Store        │──▶│ CesiumScene  │   │ Timeline UI   │   │ ProfileChart     │  │
│  │ (Zod)       │   │ (Zustand)    │   │ terrain,     │◀─▶│ play/scrub/   │◀─▶│ (visx, linked)   │  │
│  └─────────────┘   │ time, stage, │   │ path, front, │   │ speed, clock  │   └──────────────────┘  │
│                    │ camera, UI   │   │ sites, cam   │   └───────────────┘                          │
│                    └──────────────┘   └──────────────┘   ┌───────────────┐   ┌──────────────────┐  │
│                                                          │ StagePanel /  │   │ SourcesPanel /   │  │
│                                                          │ TollPanel     │   │ Fallback (img)   │  │
│                                                          └───────────────┘   └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                      CDN (CloudFront/Vercel) · Sentry · Plausible · deep-link/embed API
```

### 3.2 Data flow at runtime

1. App loads `event.json` (≈ 50 KB) → Zod-validated → store.
2. Cesium Viewer mounts with the terrain provider (ion asset or self-hosted URL) and imagery provider; camera flies to the corridor overview.
3. The event's `path.geojson` becomes a `PolylineGraphics` clamped to ground; `front.czml` (time-tagged positions) becomes a time-dynamic entity driven by Cesium's `Clock`.
4. Store subscribes to `clock.onTick` → derives active stage, distance, elevation → StagePanel, ProfileChart, TollPanel re-render.
5. Stage tap → `camera.flyTo(boundingSphere, {duration})` + `clock.currentTime = stage.time`.
6. Deep link on load: `?stage=…&t=…` → same handlers.

### 3.3 Event package (data model)

Everything editorial lives in one versioned package, validated by a shared JSON Schema. This is what makes G4 (reuse) real.

```
events/nepal-tibet-2026/
├── event.json          # metadata, stages, facts, toll, sources
├── path.geojson        # thalweg LineString (WGS84), M-values = km along
├── sites.geojson       # named points w/ stage ids
├── profile.json        # [{km, elev_m, grad_m_per_km}] from DEM
├── front.czml          # time-dynamic front position (from routing)
├── imagery/            # pre/post tile manifests (P1)
└── SOURCES.md          # human-readable provenance
```

`event.json` (abridged):

```jsonc
{
  "schemaVersion": "1.0",
  "id": "nepal-tibet-2026",
  "title": "Nepal–Tibet glacial flood",
  "t0": "2026-08-26T02:52:00Z",           // collapse (USGS seismic signal)
  "crs": "EPSG:4326",
  "terrain": { "provider": "ion", "assetId": 123456, "exaggeration": [1,2,4] },
  "stages": [
    { "id": "collapse", "order": 1, "siteId": "src", "km": 0,
      "title": "Glacier collapse", "body": "…", "sources": ["usgs-2026-08-27"] }
  ],
  "toll": { "asOf": "2026-08-30", "nepalDead": 626, "nepalMissing": 1924,
            "tibetDead": 7, "tibetMissing": 554, "sources": ["wiki-2026-08-30"] },
  "routing": { "method": "slope-kinematic-v1", "params": { "k": 2.2, "vMin": 3, "vMax": 26 },
               "note": "Modeled; not a calibrated hydraulic run" },
  "sources": [
    { "id": "usgs-2026-08-27", "title": "…", "url": "…", "accessed": "2026-08-28", "license": "public domain" }
  ]
}
```

**Validation rules (fail the build):** every stage has ≥ 1 source id that exists; `sites` all lie within 50 m of `path`; `profile` elevation is monotonic non-increasing along km within a tolerance; `toll.asOf` present.

### 3.4 Routing model (v1) — explicit and labelled

Slope-driven kinematic estimate along the thalweg:

```
v(s) = clamp( k · sqrt( max(gradient(s), g_min) ), v_min, v_max )     [m/s]
t(s) = ∫ ds / v(s)
```

with `gradient` in m/km from the DEM profile. Defaults `k=2.2, v_min=3, v_max=26`. Output is written to `front.czml`. It is a **model**, shown as such in the UI (PRD R3). The interface is a plain `[{km, t_seconds}]` table so a partner-supplied hydraulic run (P2) drops in without code changes.

## 4. Architecture decision records

### ADR-1: 3D engine — CesiumJS vs. MapLibre + deck.gl vs. Three.js custom

**Status:** Proposed · **Deciders:** Eng lead, Product

| Dimension | A · CesiumJS (+Resium) | B · MapLibre GL + deck.gl | C · Three.js custom (prototype path) |
|---|---|---|---|
| Georeferencing accuracy | True WGS84 ellipsoid, native | Web-Mercator 3D terrain; fine at this scale | Manual projection; error-prone |
| Streamed real terrain | Native (quantized-mesh) | `raster-dem` terrain; good | Must build tiling + LOD ourselves |
| Time-dynamic animation | Native Clock/Timeline/CZML | Custom | Custom |
| Visual control / styling | Moderate (Cesium look) | High (custom layers, styling) | Total |
| Bundle size | Large (~3–4 MB gz core) | Medium | Small |
| Mobile perf | Good with tuned LOD; needs care | Very good | Depends on us |
| Complexity to reach R1–R6 | Low | Medium | High |
| Team familiarity | Medium | Medium | High (prototype exists) |

**Decision:** **A — CesiumJS.** The requirements that matter most (real streamed terrain, time-dynamic entities, fly-to, exaggeration) are native; B needs custom time animation and profile linkage; C requires building a terrain engine, which is the prototype's exact ceiling.

**Consequences:** Larger bundle → mitigate with code-splitting, lazy-loading Cesium after first paint, and the image fallback (R11). Cesium's default UI is replaced with our React controls. Revisit if visual styling needs exceed Cesium's material system (then B).

### ADR-2: Terrain hosting — Cesium ion vs. self-hosted quantized-mesh

| Dimension | A · Cesium ion | B · Self-host (`ctb-quantized-mesh` → S3/CloudFront) |
|---|---|---|
| Effort | Upload DEM, done | Tile build (hours), layer.json, CORS, cache headers |
| Cost | Subscription; commercial use needs a paid tier | S3 + CDN pennies/month at this scale |
| Control / licence | Vendor terms; must review for commercial/news use | Full control; Copernicus GLO-30 is openly licensed |
| Also gives | World terrain, imagery, buildings | Only what we build |

**Decision:** **Start on ion for Phase 1 velocity; decide by end of Phase 1 (PRD Q1)** whether to migrate to self-hosting for launch. The app reads the terrain provider from `event.json`, so switching is config-only.

### ADR-3: Backend — none (static) vs. API service

**Decision:** **Static publishing.** All data is precomputed in CI and served from a CDN. There is no user state, no real-time input, and the toll panel updates by republishing a JSON file. A backend adds cost, ops and attack surface with no user benefit. Revisit only if P2 live-monitoring is approved.

### ADR-4: Routing fidelity — slope-kinematic (v1) vs. hydraulic model

**Decision:** Ship the slope-kinematic model, clearly labelled, with a stable arrival-time interface. Pursue a partner-supplied model in parallel (PRD Q4). Rationale: a calibrated debris-flow run (RAMMS, r.avaflow, HEC-RAS 2D) needs expertise and data we don't control on the timeline; fabricating precision would violate G5.

## 5. Data pipeline (Phase 0 detail)

| Step | Tool | Output | QA gate |
|---|---|---|---|
| Acquire DEM | Copernicus GLO-30 tiles for bbox (AWS Open Data / OpenTopography API) | `dem_raw.tif` | Checksums; nodata < 0.1 % |
| Clip + reproject | rasterio/GDAL, EPSG:4326, void-fill | `dem.tif` | Site elevations vs. published values ±30 m |
| Hydrography | osmnx (OSM `waterway=river`) + HydroRIVERS cross-check | `path.geojson` | Length 150–190 km; ≤ 50 m from DEM valley floor |
| Thalweg profile | Sample DEM along path every 100 m; smooth; compute gradient | `profile.json` | Monotonic decrease within tolerance |
| Routing | slope-kinematic (§3.4) | `front.czml` | Arrival times within reported windows; labelled modeled |
| Sites | Editorial coordinates + snap to path | `sites.geojson` | Within 50 m of path; within 100 m of ground truth (Q6) |
| Terrain tiles | ion upload *or* `ctb-quantized-mesh` | asset id / `layer.json` + tiles | Renders in a smoke test |
| Imagery (P1) | Sentinel-2 L2A pre/post; SAR change (Sentinel-1) | XYZ tiles + manifest | Cloud mask; date labels |
| Package | Pydantic validation; write `SOURCES.md` | `events/<id>/` | JSON Schema passes; every fact sourced |

Run as a GitHub Actions job (`pipeline.yml`) with cached inputs; artefacts pushed to S3 with immutable, versioned paths (`/events/nepal-tibet-2026/v3/…`) so a bad publish is a one-line rollback.

## 6. Delivery plan

Assumes ~1 frontend/3D, ~1 geospatial/data, 0.5 design, 0.5 PM/editor, science advisor on call. Weeks are estimates.

**Phase 0 — Data foundation (Wk 1–2)**
- Deliverables: validated event package v1 (DEM, path, profile, sites, routing), terrain asset on ion, `SOURCES.md`, pipeline in CI.
- Exit: all §5 QA gates green; site positions signed off by science advisor (Q6).

**Phase 1 — Georeferenced core (Wk 2–4)**
- Deliverables: React+Cesium shell; terrain + exaggeration; ground-clamped path; time-dynamic front; timeline controls; fly-to on stage; overview/detail presets; keyboard control; deep links.
- Covers PRD R1, R2, R3 (front only), R5.
- Exit: plays end-to-end on desktop + iOS Safari + mid-tier Android at ≥ 30 fps; ADR-2 decision made.

**Phase 2 — Narrative & impact (Wk 4–6)**
- Deliverables: stage panel with sourced facts; toll panel (data-driven, "as of"); linked long-profile; sources panel; captions a11y; design polish per design brief.
- Covers R4, R6, R7, R8, R10.
- Exit: content freeze candidate; editorial fact-check pass; axe clean.

**Phase 3 — Hardening & launch (Wk 6–8)**
- Deliverables: image-sequence fallback (R11); Lighthouse/perf budget in CI; Playwright e2e + WebGL screenshot baselines; Sentry + Plausible; Terraform'd hosting; runbook; user test (n ≥ 12) against G1.
- Exit: launch checklist §9 complete; go/no-go.

**Phase 4 — P1 follow-ups (Wk 9–12)**
- Before/after imagery swipe; SAR flood-extent overlay; warning-infrastructure layer; Nepali localisation; embed mode + postMessage API; GeoJSON/CZML export.

**Milestone gates:** M0 data signed off · M1 interactive core demo · M2 content freeze · M3 launch · M4 P1 complete.

## 7. Test strategy

| Level | What | Tooling | Gate |
|---|---|---|---|
| Data | Schema, source presence, geometry constraints, profile monotonicity, routing sanity | pytest, Pydantic, shapely | CI blocks publish |
| Unit | Store reducers, stage derivation from time, routing inversion (t↔km), deep-link parsing | Vitest | PR |
| Component | Timeline, StagePanel, ProfileChart interactions; a11y roles/labels | RTL + axe-core | PR |
| E2E | Load → autoplay → scrub → tap stage → fly-to → sources panel; reduced-motion; WebGL-off fallback | Playwright (Chromium, WebKit, Android emulation) | PR + nightly |
| Visual | Screenshot baselines at 3 camera presets × 3 timeline points | Playwright + pixelmatch, tolerance-tuned for GPU noise | Nightly |
| Performance | LCP, TBT, transfer size, fps trace on throttled mobile profile | Lighthouse CI + Playwright tracing | Budget: perf ≥ 80, ≤ 6 MB, ≥ 30 fps |
| Editorial | Fact-check every stage & figure against `SOURCES.md` | Checklist | Pre-freeze |
| User | Comprehension test (G1), task success on mobile | Moderated sessions, n ≥ 12 | Phase 3 |

## 8. Operations

- **Hosting:** static app on Vercel (preview per PR); event data + terrain on S3 behind CloudFront with long-lived immutable caching (`/v{n}/`); `event.json` short TTL so toll updates propagate in minutes.
- **Publishing a data update:** edit `event.json` → PR → pipeline validates → merge → CI uploads new version → app reads latest manifest. No code deploy.
- **Monitoring:** Sentry (JS errors, WebGL context loss, web vitals); Plausible (play-through, stage taps, session time); CloudFront error rate alarm.
- **Rollback:** pin manifest to previous version path.
- **Security/privacy:** no PII, no cookies; CSP restricting script/tile origins; SRI on CDN scripts.
- **Cost (order of magnitude):** S3/CloudFront tens of USD/month at news-spike traffic; Cesium ion tier per ADR-2; Vercel free/pro.

## 9. Launch checklist

- [ ] All §5 QA gates green on the published package version
- [ ] Science advisor sign-off on positions, elevations, routing label
- [ ] Editorial fact-check complete; toll `asOf` current
- [ ] Perf budget met on reference devices; fallback verified with WebGL disabled
- [ ] Accessibility audit (axe + manual keyboard + screen reader pass)
- [ ] Sentry and analytics receiving events from staging
- [ ] Runbook: data update, rollback, on-call contact
- [ ] Legal: terrain/imagery licences confirmed for public use (Q1, Q2)

## 10. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cesium bundle hurts mobile first-load | High | Med | Lazy-load Cesium after shell paint; code-split; fallback image while loading; measure in CI |
| Routing times contested by experts | Med | High | Label as modeled everywhere; publish method + params; pursue partner model (ADR-4) |
| Source glacier coordinates wrong | Med | High | Q6 blocking; use USGS/ICIMOD imagery; show uncertainty radius if unresolved |
| Toll figures churn / conflict between authorities | High | Med | Single canonical source (Q3); `asOf` date; data-only updates |
| Terrain licence issue for commercial/news use | Low–Med | High | ADR-2 decision by end Phase 1; self-host path ready |
| Imagery licence delays P1 | Med | Low | Sentinel-2 (open) as baseline; commercial optional |
| Team unfamiliar with Cesium quirks (clamping, LOD, iOS memory) | Med | Med | Spike in week 2; Resium examples; keep Three.js prototype for comparison |
| Scope creep toward "hazard tool" | Med | High | PRD non-goal #1; any live feed requires a new PRD |

## 11. What we'd revisit as it grows

- Move from a single static event to a catalogue: index manifest + per-event packages (schema already supports this).
- If multiple events with heavy imagery: introduce a tile server (e.g., TiTiler) instead of pre-tiling everything.
- If styling needs exceed Cesium: evaluate MapLibre + deck.gl (ADR-1 option B) with the same event package — the data contract is engine-agnostic by design.

---

## 12. Addendum (30 Aug 2026) — decisions taken during the build

### ADR-5: Engine — MapLibre GL JS replaces CesiumJS for v1

**Status:** Accepted · **Supersedes:** ADR-1 decision (keeps its analysis)

**Context.** ADR-1 chose Cesium for native streamed terrain and time-dynamic entities. In practice Cesium's real terrain depends on a Cesium ion account and access token (or a self-built quantized-mesh pipeline, ADR-2), which blocks a keyless, drop-anywhere deliverable and adds a licence review before anything renders.

**Decision.** Build v1 on **MapLibre GL JS 4** with keyless open sources: AWS/Mapzen Terrain Tiles (Terrarium-encoded, `raster-dem`) for 3D terrain + hillshade, and Esri World Imagery (attribution required) or a dark relief basemap. Time-dynamic behaviour (front position, flooded reach, clock, follow-camera) is implemented in ~150 lines of app code over GeoJSON sources, which proved simpler than adapting Cesium's Clock/CZML to a custom UI.

| Dimension | Cesium (ADR-1) | MapLibre (ADR-5) |
|---|---|---|
| Real terrain without an account | No | Yes (open Terrarium tiles) |
| Bundle | ~3–4 MB | ~0.9 MB single file |
| Time-dynamic entities | Native | ~150 LOC custom |
| Georeferencing | WGS84 ellipsoid | Web-Mercator terrain; sub-metre irrelevant at corridor scale |
| Styling control | Moderate | High |

**Consequences.** Ships with zero keys and a 920 KB single HTML; loses Cesium's globe and 3D Tiles (not needed for v1). Revisit if P2 building-level damage needs 3D Tiles.

### Elevation sampling moved client-side (amends §5)

The Phase 0 pipeline assumed server-side DEM processing. The shipped build instead samples the same Terrarium tiles in the browser at load (`src/dem.ts`, `src/route.ts`): densify → 1.8 km perpendicular transect → lowest cell → smooth → monotonic enforcement → gradient → routing band. This removes a build step and keeps the profile live against the real DEM, at the cost of ~1–3 MB of tile fetches on first load (browser-cached, shared with the map's own terrain source). Pre-computing the profile in CI remains the right move for scale (§11) and is a straightforward extraction of the same functions.

### Improvements folded into the build (from review)

1. **Warning-gap layer promoted to P0** — warning infrastructure markers with an explanation of what each could and couldn't detect.
2. **Witness footage layer** — geolocated points with sourcing; timestamps flagged unverified. Once verified they calibrate the routing constant `k`.
3. **Visible uncertainty** — 2 km source-position circle; min–max arrival windows at every site; barrier-lake footprint labelled as scale-only.
4. **July 2025 overlay** on the same channel — validates the reuse schema with a real second event.
5. **Nepal local time** alongside minutes-since-collapse; **plain-text transcript** as the no-WebGL fallback.
6. **Data-only editing** — all content in `src/data/event.json`; rebuild, no code.

### Open items carried forward

- Verify witness-footage timestamps and refit `k` (Q4 partial).
- Replace the digitised seed line with the OSM river centreline once an Overpass fetch is added (with fallback to the seed).
- Authoritative glacier-source coordinate (Q6) to shrink the uncertainty circle.
- Pre/post Sentinel-2 swipe and SAR extent remain P1.

