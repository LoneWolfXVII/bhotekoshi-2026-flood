# PRD — Interactive 3D Reconstruction: 2026 Nepal–Tibet Glacial Flood

| | |
|---|---|
| **Status** | Draft v1.0 for review |
| **Date** | 30 Aug 2026 |
| **Owner** | Product (TBD) · Engineering lead (TBD) · Editorial/science lead (TBD) |
| **Prototype** | `nepal-flood-3d-map.html` (Three.js schematic, georeferenced waypoints) — proves the narrative & interaction model; **not** the production basis |

---

## 1. Problem statement

On 26 Aug 2026 a glacier collapse at ~5,300 m in Tibet became a debris flow that travelled ~170 km down the Bhote Koshi–Trishuli corridor, killing 600+ people in Nepal with ~1,900 missing. Coverage is text, photos, and phone video; none of it lets a reader **see** how a clear-sky event high above the border turned into a wall of mud at Syabrubesi hours later, why no warning fired, or where the risk still sits (a 2 million m³ barrier lake was still overflowing on 28 Aug).

Journalists, researchers and the public each lack a spatially accurate, time-resolved picture. Without one, the "who is responsible" debate stays untethered from terrain, and the same warning-system gaps get re-argued after the next Himalayan blue-sky flood.

## 2. Goals

| # | Goal | How we measure it |
|---|---|---|
| G1 | A first-time visitor can correctly explain the causal chain (collapse → dam → burst → downstream impact) after one viewing | ≥ 80 % correct on a 3-question post-view check (user test, n ≥ 12) |
| G2 | Every geographic and numeric claim is **survey-grade and sourced** | 100 % of on-screen facts link to a source; site positions within 100 m of ground truth; elevation from a real DEM |
| G3 | Works where the audience is — mobile, mid-range devices, slow networks | ≥ 30 fps on a 2022 mid-tier Android; first interactive view ≤ 4 s on 4G; Lighthouse perf ≥ 80 |
| G4 | Reusable for the next event | A second GLOF/debris-flow event can be published by editing data files only, no code changes (validated by a dry run) |
| G5 | Editorial trust | Zero factual corrections required post-launch on positions, elevations or timeline |

## 3. Non-goals

- **Not a hazard warning or operational tool.** No live sensor feeds, no alerts. It is retrospective and explanatory; misuse as a warning source would be dangerous.
- **Not an engineering-grade hydraulic model.** Flow timing is a defensible *estimate* (slope-driven routing), not a calibrated HEC-RAS / RAMMS study. Reserved for a later tier (P2).
- **No user accounts, comments, or community features.** Adds moderation and privacy burden with no bearing on the core problem.
- **Not a general Nepal flood atlas.** One event, done properly. The data schema is designed for reuse (G4) but v1 ships one story.
- **No attribution of legal responsibility.** The product shows *what happened and where warnings existed or didn't*; it does not adjudicate blame.

## 4. Users & user stories

**P1 · General reader (mobile-first, arrives from a news link)**
- As a reader, I want to press play and watch the flood travel from source to lowland so that I understand the sequence without reading a long article.
- As a reader, I want to tap a place name and be flown to it so that I can see what the terrain looked like there.
- As a reader on a phone, I want the core experience to work with one thumb and no pinch precision so that I'm not fighting the controls.

**P2 · Journalist / editor**
- As an editor, I want to embed the reconstruction in an article and deep-link to a specific stage or timestamp so that my text and the visual stay in step.
- As a journalist, I want a sources panel for every figure so that I can defend it in fact-check.
- As an editor, I want before/after satellite imagery at the impact sites so that the destruction is evidenced, not asserted.

**P3 · Researcher / disaster-risk analyst**
- As an analyst, I want the real DEM profile and per-reach gradient so that I can sanity-check the reported travel times.
- As an analyst, I want to export the event timeline and geometry (GeoJSON/CZML) so that I can reuse it in my own tools.
- As an analyst, I want to see where early-warning sensors existed relative to the flow path so that the "why no warning" question is grounded.

**P4 · Educator**
- As a teacher, I want a mode that pauses at each stage with a plain-language explanation so that I can walk a class through it.

**Edge cases**
- WebGL unavailable / blocked → serve a static image-sequence fallback with the same captions, not a blank page.
- Offline after first load → previously viewed terrain stays navigable; unfetched tiles show a clear "no data" state.
- Reduced-motion preference → no autoplay; scrubber-driven only.
- Figures revised by authorities → toll panel shows "as of <date>" and updates without redeploying code.

## 5. Requirements

### P0 — Must have (cannot ship without)

**R1 · Real terrain.** Terrain rendered from a real DEM (Copernicus GLO-30 or better) for the corridor bbox (~27.6–28.4 N, 84.3–85.5 E).
- [ ] Elevation at each named site within ±30 m of DEM value
- [ ] Vertical exaggeration user-selectable (1×, 2×, 4×) and always displayed
- [ ] Terrain streams progressively; interactive before full load

**R2 · Real hydrography.** Flow path follows the actual Lhende Khola → Bhote Koshi → Trishuli → Narayani centreline (OSM/HydroRIVERS), not a spline through waypoints.
- [ ] Path length reported within 10 % of the accepted ~170 km
- [ ] Path never leaves the DEM valley floor by more than 50 m horizontally

**R3 · Time-dynamic flood front.** A playable timeline (play/pause/scrub/speed) animates the front along the path with slope-dependent speed; clock shows time since collapse.
- [ ] Given the timeline is playing, when the front crosses a stage boundary, then the caption, stage list and profile marker update within the same frame
- [ ] Modeled arrival times at Rasuwagadhi, Syabrubesi, Betrawati are shown with a visible "modeled" label and method note

**R4 · Stage narrative.** Ordered stages (collapse, natural dam, barrier-lake burst, Rasuwagadhi, Timure, Syabrubesi, confluence, Nuwakot/Dhading, Chitwan) each with a one-paragraph plain-language fact and a source.
- [ ] Every stage has ≥ 1 linked source; unsourced text cannot be published (build fails)

**R5 · Navigation & zoom.** Orbit, wheel/trackpad and pinch zoom, fly-to on stage/label tap, "overview" and "impact detail" presets, keyboard equivalents.
- [ ] Fly-to completes ≤ 1.2 s with eased motion; no gimbal flip at any pitch
- [ ] Zoom range from whole-corridor to ≤ 500 m ground width

**R6 · Elevation long-profile.** Linked 2-D profile (elevation vs. distance) with stage markers and a synchronized front marker.
- [ ] Clicking the profile seeks the timeline and the camera

**R7 · Impact & toll layer.** Per-stage impact facts and a provisional-toll panel with "as of" date, sourced.
- [ ] Toll values are loaded from a data file, not code; editors can update without a deploy

**R8 · Provenance.** A sources panel listing every dataset (DEM, hydrography, imagery, reporting) with version, license and access date; per-fact citations.

**R9 · Performance & compatibility.** ≥ 30 fps on a 2022 mid-tier Android and a 2020 MacBook Air; total initial transfer ≤ 6 MB before interactive; last two major versions of Chrome, Safari, Firefox, Edge; iOS Safari.

**R10 · Accessibility.** WCAG 2.1 AA for all non-3D UI; full keyboard operation of timeline and stage navigation; captions readable by screen readers; reduced-motion respected.

**R11 · Fallback.** If WebGL is unavailable, render a pre-baked image sequence with identical captions.

### P1 — Should have (fast follows)

- **Before/after satellite swipe** at Rasuwagadhi, Timure, Syabrubesi (Sentinel-2 open; commercial only if licensed).
- **Flood-extent overlay** from Sentinel-1 SAR change detection, shown as a toggle with confidence caveat.
- **Warning-infrastructure layer:** known glacial-lake EWS sites and river gauges relative to the path, with the "blue-sky flood" explanation.
- **Deep links** (`?stage=syabrubesi&t=…`) and an **embed mode** (chromeless, postMessage API for host articles).
- **Nepali + English** UI and captions.
- **Data export:** GeoJSON (path, sites), CZML (timeline).

### P2 — Future considerations (design for, don't build)

- **Event schema reuse:** all event content in one versioned JSON package so another GLOF (e.g. Sikkim 2023) is a data-only publish.
- **Physically based routing tier:** swap the slope model for a calibrated debris-flow/hydraulic run when a partner provides one; the timeline API must accept externally computed arrival times.
- **Building-level damage:** OSM footprints classified by flood extent.
- **Live glacial-lake monitoring** (barrier lake volume, overflow status) as an optional feed — explicitly a separate product decision given non-goal #1.

## 6. Success metrics

**Leading (first 2 weeks)**
- Play-through rate: ≥ 55 % of sessions reach the final stage (stretch 70 %)
- Median engaged time: ≥ 90 s (stretch 150 s)
- Stage interaction rate: ≥ 40 % of sessions tap/click at least one stage
- Error/blank-screen rate: < 1 % of sessions (Sentry)
- Mobile share of play-throughs ≥ 60 % (i.e., mobile isn't a degraded path)

**Lagging (first quarter)**
- Post-launch factual corrections: 0
- Republication/embeds by ≥ 3 external outlets or institutions
- Reuse: a second event published from data files alone within one quarter (validates G4)
- Comprehension test (G1) repeated with ≥ 80 % pass

**Measurement:** privacy-respecting analytics (Plausible or equivalent, no cookies), Sentry for errors, synthetic Lighthouse runs in CI, user-test sessions logged.

## 7. Open questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | Terrain hosting: Cesium ion (managed, licensed) vs. self-hosted quantized-mesh on S3/CloudFront? Drives cost and legal review | Engineering + Legal | **Yes** — before Phase 1 |
| Q2 | Commercial imagery licence (Vantor/Planet/Maxar) for before/after, or open Sentinel-2 only (10 m)? | Editorial + Legal | No (P1) |
| Q3 | Which authority's toll do we treat as canonical (Nepal Police vs. NDRRMA vs. Wikipedia aggregate)? Update cadence? | Editorial | **Yes** — before content freeze |
| Q4 | Can a partner (ICIMOD / university group) supply modeled arrival times or a flow model so routing isn't ours alone? | Science lead | No — fallback is our slope model, labelled |
| Q5 | Do we show individual foreign-national counts by country? Sensitivity and revision churn | Editorial | No |
| Q6 | Precise glacier source coordinates: USGS/ICIMOD have published imagery; we need a defensible point, not our estimate | Science lead | **Yes** — Phase 1 data QA |
| Q7 | Does the host CMS support iframe + postMessage embeds? Determines embed spec | Engineering + Editorial | No (P1) |

## 8. Timeline considerations

- **No hard external deadline**, but relevance decays; target a public v1 within **8 weeks** of kickoff and P1 follow-ups within 4 more.
- **Dependencies:** DEM & hydrography download (open, days); terrain tiling (compute, days); imagery licence (Q2, weeks — start immediately); toll source decision (Q3).
- **Phasing:** see `02-IMPLEMENTATION-PLAN.md` — Phase 0 data foundation → Phase 1 georeferenced core → Phase 2 narrative & impact → Phase 3 hardening & launch → Phase 4 P1 follow-ups.
- **Content freeze** one week before launch; toll panel remains data-driven post-freeze.

## 9. Assumptions made in this draft

- Audience is public/newsroom-grade, not engineering decision-makers (drives non-goals 1–2).
- Small team: ~1 frontend/3D, ~1 geospatial/data, 0.5 designer, 0.5 PM/editor, science advisor on call.
- Budget permits either Cesium ion or S3 hosting; neither is a blocker for planning.
- English first; Nepali is P1, not P0 (revisit if primary distribution is domestic).
