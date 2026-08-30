# TODO — Bhote Koshi 2026

Status against `docs/01-PRD-flood-3d-reconstruction.md` (P0 requirements R1–R11) and the
items carried forward in `docs/02-IMPLEMENTATION-PLAN.md` §12.

> **Note:** this file was reconstructed on 2026-08-30 — the repo had no `TODO.md`, so the
> backlog below is derived from the PRD's P0 gates, the plan's open items, and what the
> current build actually does. Treat the ordering as a proposal, not an inherited one.

---

## P0 — blocking

- [x] **R2 · Real hydrography.** Replace the hand-seeded path with the OSM waterway
      centreline (Overpass) for the Lhende Khola → Bhote Koshi → Trishuli → Narayani
      corridor, cached for offline use, with the DEM thalweg snap kept as fallback.
      *Done 2026-08-30.* Median distance from the mapped channel went 314 m → 0 m; the
      41% of the path that sat more than 500 m from any mapped river is now 0%. Refresh
      with `npm run centerline`.

- [ ] **R2 gate · path length disagrees with the reported runout.** The channel measures
      **199 km**; reporting says **~170 km**. The PRD gate is ±10% (153–187 km), so this
      fails as written. It is not a routing bug — sinuosity is 1.61 against a 124 km
      straight line, with no backtracking, and the line sits on the channel in imagery.
      The two numbers measure different things. **Editorial decision needed:** restate the
      gate against a measured centreline, or caption the ~170 km as a reported approximation.
      The UI currently shows both and adjusts neither.

- [ ] **Q6 · authoritative glacier source coordinate.** `stages[src]` is captioned
      "~5,300 m" but its coordinate `[85.462, 28.336]` samples to **2,676 m** — it sits on
      the valley floor, not the collapse scar. The first stage card and the profile's left
      edge both show the wrong elevation. Blocks G2 (survey-grade claims) and keeps the
      2 km uncertainty circle wider than it needs to be.

- [ ] **Stage coordinates that miss the channel.** `dam` (1,363 m), `lake` (1,304 m) and
      `bidu` (1,391 m) are too far from the mapped river to anchor the centreline and are
      currently skipped by `scripts/fetch-centerline.mjs`. Re-digitise them and they can
      anchor the route as well; until then their markers are placed by nearest-point
      projection.

- [ ] **R4 gate · unsourced text must fail the build.** The PRD requires that a stage
      without a resolvable source id cannot be published. There is no validation step at
      all today — no schema check, no referential check on `sources`, none of the plan's
      §5 QA gates. Add it to `npm run build` and to CI.

- [ ] **R9 · performance budget is unmeasured.** No Lighthouse run, no transfer-size
      budget, no fps trace. Budget is ≥30 fps mid-tier Android, ≤6 MB before interactive,
      perf ≥80. Current single file is 944 KB before tiles.

- [ ] **R10 · accessibility unaudited.** No axe run, no screen-reader pass. Keyboard
      control of the timeline and stage list exists but is unverified against WCAG 2.1 AA.

- [ ] **R11 · no-WebGL fallback is partial.** A plain-text transcript ships, but the PRD
      asks for a pre-baked image sequence with identical captions.

## P1 — fast follows

- [ ] Verify witness-footage timestamps and refit the routing constant `k` against them
      (PRD Q4, partial). Right now `k ∈ [1.6, 3.0]` is uncalibrated.
- [ ] Before/after Sentinel-2 swipe at Rasuwagadhi, Timure, Syabrubesi.
- [ ] Sentinel-1 SAR flood-extent overlay, with a confidence caveat.
- [ ] Nepali localisation of UI and captions.
- [ ] Embed mode (chromeless + postMessage) and GeoJSON/CZML export.

## Housekeeping

- [ ] Vertical exaggeration ships as 1× / 1.6× / 2.5×; the PRD (R1) specifies 1× / 2× / 4×.
      Reconcile the doc or the control.
- [ ] `scripts/fetch-centerline.mjs` hits Overpass live. Consider caching the raw response
      in CI so a rebuild is not at the mercy of Overpass availability or rate limits.
