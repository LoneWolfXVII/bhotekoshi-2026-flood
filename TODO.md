# TODO — Bhote Koshi 2026

Status against `docs/01-PRD-flood-3d-reconstruction.md` (P0 requirements R1–R11) and the
items carried forward in `docs/02-IMPLEMENTATION-PLAN.md` §12.

> **Note:** this file was reconstructed on 2026-08-30 — the repo had no `TODO.md`, so the
> backlog below is derived from the PRD's P0 gates, the plan's open items, and what the
> current build actually does. Treat the ordering as a proposal, not an inherited one.

**Standing principle.** Where a real measurement and a reported/external number disagree,
surface both and label provenance. Never bend the measured value to match the reported one.
Applied to the 199 km vs ~170 km length and to the source elevation; apply it to anything
similar that comes up.

---

## P0 — blocking

- [x] **R2 · Real hydrography.** Replace the hand-seeded path with the OSM waterway
      centreline (Overpass) for the Lhende Khola → Bhote Koshi → Trishuli → Narayani
      corridor, cached for offline use, with the DEM thalweg snap kept as fallback.
      *Done 2026-08-30.* Median distance from the mapped channel went 314 m → 0 m; the
      41% of the path that sat more than 500 m from any mapped river is now 0%. Refresh
      with `npm run centerline`.

- [x] **R2 gate · path length vs the reported runout.** *Resolved 2026-08-30 at the spec
      layer.* The channel measures 199 km; reporting says ~170 km. The original ±10% gate
      assumed the reported figure was a measured centreline — it is a press number with no
      stated methodology, most consistent with a straight-valley distance. Geometry was not
      touched. The PRD gate now reads "measured centreline length is displayed; agrees with
      published figures allowing for sinuosity", and the UI captions the reported value
      "approx." Both numbers are shown; neither is adjusted to match the other.

- [x] **Source stage elevation contradicted its own caption.** *Fixed 2026-08-30.* The
      card read "~5,300 m" while showing the DEM's 2,676 m valley-floor sample. Stages now
      carry `elevM` + `elevSource` ("reported" | "dem"); the source is anchored to its
      sourced 5,300 m, marked `*` on the card and the profile, and explained in the method
      panel. The coordinate was **not** moved to a cell reading 5,300 m — elevation and
      position are sourced independently.

- [ ] **Q6 · authoritative glacier source coordinate — STILL OPEN.** The elevation override
      above is a stopgap; the *position* is still the provisional valley-floor point
      `[85.462, 28.336]` with a 2 km uncertainty circle.

      **Candidate found, not adopted.** Petley's Landslide Blog (Eos/AGU,
      `eos.org/thelandslideblog/26-august-2026-nepal-and-tibet`) gives the event location as
      **[28.2765, 85.5194]**, hedged as "in the area of". It corroborates well: the DEM
      samples **4,935 m** there with 7,019 m peaks within 1.7 km — genuine source-massif
      terrain — against 2,672 m at the current point. Press reporting independently puts
      the detachment at ~17,000 ft (~5,180 m), roughly 20 km NE of Rasuwagadhi.

      **Why it was not adopted:** the source → Lhende Khola leg is a *subaerial debris
      avalanche, not a river*. The coordinate is 1,569 m from the nearest mapped waterway
      and `npm run centerline` fails outright on it — "no channel path src → rasu; corridor
      is disconnected in OSM". A waterway centreline structurally cannot represent that
      leg. Adopting the coordinate therefore requires first modelling the avalanche track
      separately from the river centreline (a DEM steepest-descent path from the scar to
      the confluence), then joining the two.

      That work would also fix a related artefact: the profile currently shows the 5,300 →
      2,650 m drop as a vertical cliff at km 0, because there is no geometry for the
      descent. Needs a science-advisor call on the coordinate and a decision on the
      two-segment path model.

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
- [ ] If the Petley coordinate is adopted, add `eos` to `event.json` sources
      (Petley, D., *The 26 August 2026 catastrophic debris flow in Nepal and Tibet*,
      Landslide Blog, Eos/AGU) and cite it on the source stage.
- [ ] `scripts/fetch-centerline.mjs` hits Overpass live. Consider caching the raw response
      in CI so a rebuild is not at the mercy of Overpass availability or rate limits.
