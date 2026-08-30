import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import EVENT from './data/event.json';
import type { LngLat } from './dem';
import { FloodMap, type Mode } from './map';
import { buildRoute, nearestIndex, stateAtTime, bearingDeg, type Route } from './route';
import { loadCenterline, type Centerline } from './centerline';

type Stage = (typeof EVENT.stages)[number] & { idx: number; km: number; elev: number; tMin: number; tMid: number; tMax: number };

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const T0 = new Date(EVENT.t0).getTime();
const TZ = EVENT.tzOffsetMinutes * 60 * 1000;
const fmtLocal = (sec: number) => {
  const d = new Date(T0 + sec * 1000 + TZ);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const fmtMin = (sec: number) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
};

/* ---------------- boot ---------------- */
const loadFill = $('#load-fill'), loadLab = $('#load-lab');
const setLoad = (label: string, f: number) => { loadLab.textContent = label; loadFill.style.width = `${Math.round(f * 100)}%`; };

$('#subtitle').textContent = EVENT.subtitle;
document.title = `${EVENT.title} — 3D reconstruction on real terrain`;

const fm = new FloodMap($('#map'), 'satellite');
setLoad('Loading terrain engine', 0.02);
// dev-only handle so scripted screenshots can position the camera deterministically
if (import.meta.env.DEV) (window as any).__app = { fm, buildRoute, EVENT };

(async () => {
  await fm.ready();
  fm.applyTerrainAndSky();
  setLoad('Terrain online', 0.04);

  // Geometry comes from the real OSM waterway centreline; the hand-digitised line in
  // event.json is only a fallback if that artefact is missing or malformed.
  const centerline = loadCenterline(EVENT.path.coordinates as LngLat[]);
  const route = await buildRoute(centerline.coords, EVENT.routing, {
    snapMode: centerline.source === 'osm' ? 'elevation' : 'thalweg',
    onProgress: (l, f) => setLoad(l, f),
  });
  if (import.meta.env.DEV) (window as any).__app.route = route;
  if (import.meta.env.DEV) (window as any).__app.centerline = centerline;
  init(route, centerline);
})().catch((err) => {
  console.error(err);
  setLoad('Something went wrong loading the reconstruction', 1);
  showNotice(`<b>Couldn’t build the reconstruction.</b> ${String(err?.message ?? err)}`);
});

/* ---------------- app ---------------- */
function showNotice(html: string) { const n = $('#notice'); n.innerHTML = html; n.classList.add('show'); }

function init(route: Route, centerline: Centerline) {
  const P = route.points;
  const stages: Stage[] = EVENT.stages.map((s) => {
    const idx = nearestIndex(route, s.lngLat as LngLat);
    const p = P[idx];
    return { ...s, idx, km: p.km, elev: p.elev, tMin: p.tMin, tMid: p.tMid, tMax: p.tMax };
  });
  stages.sort((a, b) => a.idx - b.idx);

  // live indicator + notices
  const live = $('#live'), liveText = $('#live-text');
  if (route.snapped) { live.classList.add('ok'); liveText.textContent = `${centerline.source === 'osm' ? 'OSM channel · ' : ''}real DEM · ${route.demFetched} tiles`; }
  else { live.classList.add('warn'); liveText.textContent = 'DEM unavailable — schematic profile'; }
  setTimeout(() => {
    if (!route.snapped || fm.tileErrors > 12) {
      showNotice(`<b>Map tiles couldn’t load in this view.</b> Terrain and imagery are streamed from open tile servers, which some embedded viewers block. Download the file and open it directly in your browser to see the real 3D terrain.`);
    }
  }, 2500);

  // map data
  fm.setRoute(route);
  const ov = EVENT.overlay2025;
  const ovFrom = nearestIndex(route, ov.fromLngLat as LngLat), ovTo = nearestIndex(route, ov.toLngLat as LngLat);
  fm.setOverlay2025(route, ovFrom, ovTo, false);
  const src = stages.find((s) => s.id === 'src')!;
  fm.setUncertainty(src.lngLat as LngLat, (src as any).uncertaintyM ?? 1500);
  fm.setLake(EVENT.barrierLake.lngLat as LngLat, false);

  // markers
  const stageMk: Record<string, HTMLElement> = {};
  stages.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'mk'; el.dataset.type = s.type; el.tabIndex = 0; el.setAttribute('role', 'button');
    el.innerHTML = `<div class="lab">${s.title}<small>${s.place}</small></div><div class="stem"></div><div class="pin"></div>`;
    el.addEventListener('click', () => goStage(i, true));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goStage(i, true); } });
    fm.addMarker(el, P[s.idx] ? [P[s.idx].lng, P[s.idx].lat] : (s.lngLat as LngLat));
    stageMk[s.id] = el;
  });
  const aux: { el: HTMLElement; kind: 'warn' | 'witness' | 'lake' }[] = [];
  EVENT.warningSites.forEach((w) => {
    const el = document.createElement('div'); el.className = 'mk small warn'; el.style.display = 'none';
    el.innerHTML = `<div class="lab">${w.name}</div><div class="stem"></div><div class="pin"></div>`;
    el.title = w.note;
    el.addEventListener('click', () => setCaption(`<b>${w.name}.</b> ${w.note}`, w.sources));
    fm.addMarker(el, w.lngLat as LngLat); aux.push({ el, kind: 'warn' });
  });
  EVENT.witnesses.forEach((w) => {
    const el = document.createElement('div'); el.className = 'mk small witness'; el.style.display = 'none';
    el.innerHTML = `<div class="lab">${w.name}</div><div class="stem"></div><div class="pin"></div>`;
    el.title = w.note;
    el.addEventListener('click', () => setCaption(`<b>${w.name}.</b> ${w.note}`, w.sources));
    fm.addMarker(el, w.lngLat as LngLat); aux.push({ el, kind: 'witness' });
  });
  {
    const bl = EVENT.barrierLake;
    const el = document.createElement('div'); el.className = 'mk small'; el.dataset.type = 'water'; el.style.display = 'none';
    el.innerHTML = `<div class="lab">${bl.title}<small>~${(bl.volumeM3 / 1e6).toFixed(1)} million m³ · 28 Aug overflow</small></div><div class="stem"></div><div class="pin"></div>`;
    el.addEventListener('click', () => setCaption(`<b>${bl.title}.</b> ${bl.body}`, bl.sources));
    fm.addMarker(el, bl.lngLat as LngLat); aux.push({ el, kind: 'lake' });
  }

  // sequence panel
  const stepsEl = $('#steps');
  stages.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'step'; d.dataset.type = s.type; d.tabIndex = 0; d.setAttribute('role', 'listitem');
    d.innerHTML = `<div class="n">${i + 1}</div><div class="t">${s.title}<small>${s.place}</small>
      <span class="meta"><b>${Math.round(s.elev)} m</b> · ${s.km.toFixed(0)} km · +${fmtMin(s.tMin)}–${fmtMin(s.tMax)}</span></div>`;
    d.addEventListener('click', () => goStage(i, true));
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goStage(i, true); } });
    stepsEl.appendChild(d);
  });
  const stepEls = [...stepsEl.children] as HTMLElement[];

  // toll
  $('#asof').textContent = `as of ${EVENT.toll.asOf}`;
  $('#toll-rows').innerHTML = EVENT.toll.items.map((it) => `<div class="fig"><span>${it.label}</span><b class="${(it as any).severity === 'high' ? 'high' : ''}">${it.value}</b></div>`).join('');
  $('#toll-note').textContent = EVENT.toll.note;

  // layers
  const grid = $('#layer-grid');
  const mkTog = (label: string, swatch: string, init: boolean, on: (v: boolean) => void, hint = '') => {
    const t = document.createElement('div'); t.className = 'tog' + (init ? ' on' : ''); t.tabIndex = 0; t.setAttribute('role', 'switch'); t.setAttribute('aria-checked', String(init));
    t.innerHTML = `<span class="sw"></span><span class="k" style="background:${swatch}"></span>${label}${hint ? `<small>${hint}</small>` : ''}`;
    const flip = () => { const v = !t.classList.contains('on'); t.classList.toggle('on', v); t.setAttribute('aria-checked', String(v)); on(v); };
    t.addEventListener('click', flip); t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    grid.appendChild(t);
  };
  const seg = document.createElement('div'); seg.style.cssText = 'display:flex;gap:6px;align-items:center;padding:2px 6px 6px;font-size:12px;color:var(--mut)';
  seg.innerHTML = `Basemap <div class="seg" style="margin-left:auto"><button class="btn on" data-mode="satellite">Satellite</button><button class="btn" data-mode="relief">Relief</button></div>`;
  grid.appendChild(seg);
  seg.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    seg.querySelectorAll('.btn').forEach((x) => x.classList.remove('on')); b.classList.add('on'); fm.setMode(b.dataset.mode as Mode);
  }));
  const ex = document.createElement('div'); ex.style.cssText = seg.style.cssText;
  ex.innerHTML = `Vertical scale <div class="seg" style="margin-left:auto"><button class="btn" data-ex="1">1×</button><button class="btn on" data-ex="1.6">1.6×</button><button class="btn" data-ex="2.5">2.5×</button></div>`;
  grid.appendChild(ex);
  ex.querySelectorAll<HTMLButtonElement>('[data-ex]').forEach((b) => b.addEventListener('click', () => {
    ex.querySelectorAll('.btn').forEach((x) => x.classList.remove('on')); b.classList.add('on'); fm.setExaggeration(Number(b.dataset.ex)); updateFoot();
  }));
  mkTog('July 2025 flood, same channel', '#ffd166', false, (v) => fm.setOverlay2025(route, ovFrom, ovTo, v), '2025');
  mkTog('Warning infrastructure', '#ffd166', false, (v) => aux.filter((a) => a.kind === 'warn').forEach((a) => (a.el.style.display = v ? '' : 'none')));
  mkTog('Witness footage', '#c9b8ff', false, (v) => aux.filter((a) => a.kind === 'witness').forEach((a) => (a.el.style.display = v ? '' : 'none')));
  mkTog('Barrier lake (live risk)', '#7fd0ff', false, (v) => { fm.setLake(EVENT.barrierLake.lngLat as LngLat, v); aux.filter((a) => a.kind === 'lake').forEach((a) => (a.el.style.display = v ? '' : 'none')); });

  // footer / method
  const geomLabel = centerline.source === 'osm'
    ? (route.snapped ? 'OSM channel · DEM elevation' : 'OSM channel · schematic profile')
    : (route.snapped ? 'DEM-snapped thalweg' : 'schematic profile');
  const lenLabel = centerline.source === 'osm' ? 'km along the channel' : 'km path';
  const updateFoot = () => { $('#foot').textContent = `${geomLabel} · ${route.totalKm.toFixed(0)} ${lenLabel} (reported runout ~${EVENT.reportedRunoutKm} km, approx.) · vertical ×${fm.exaggeration} · times modeled`; };
  updateFoot();
  $('#method').innerHTML = `
    <p><b>Terrain</b> — real elevation streamed from Mapzen/AWS Terrain Tiles (SRTM/NASADEM-derived, Terrarium encoding). Imagery: Esri World Imagery. No API keys.</p>
    <p><b>Flow path</b> — ${centerline.source === 'osm'
      ? `the mapped river channel itself, from OpenStreetMap waterways via the Overpass API${centerline.generated ? ` (baked ${centerline.generated})` : ''}. The corridor changes name four times — Gyirong Tsangpo → Bhote Koshi → Trishuli → Narayani — so the centreline is assembled by a shortest-path search over every waterway in the corridor, forced through the event's own stage coordinates in order, which selects the main stem at each confluence. Positions are the surveyed channel; the DEM supplies elevation only.`
      : `seeded from known river towns, then every point is snapped to the lowest cell across a 1.8 km transect of the DEM (the thalweg). <b>The OSM centreline was unavailable, so this fallback is in use.</b>`
    } Elevation is forced non-increasing downstream. ${route.snapped ? `${route.demFetched} tiles sampled.` : 'DEM unreachable in this session — a schematic profile is shown.'}</p>
    <p><b>Path length</b> — <b>${route.totalKm.toFixed(0)} km measured</b> along the channel, against a <b>reported ~${EVENT.reportedRunoutKm} km (approx.)</b>. The reported figure is a press approximation with no stated methodology, most consistent with a straight-valley distance; the measured value follows every meander (sinuosity 1.61 against a 124 km straight line). Both are shown and neither has been adjusted to match the other.</p>
    <p><b>Timing</b> — ${EVENT.routing.note} Arrival windows shown as min–max across the k range. ${EVENT.t0Note}</p>
    <p><b>Uncertainty</b> — the dashed circle at the source is a ${((src as any).uncertaintyM ?? 1500) / 1000} km position uncertainty; the barrier-lake footprint is drawn for scale from the reported volume, not from imagery.</p>`;
  $('#sources').innerHTML = Object.entries(EVENT.sources).map(([id, s]) => `<div class="src-item"><span class="id">${id}</span><div>${s.title}<div class="org">${s.org} · accessed ${s.accessed}</div></div></div>`).join('')
    + (centerline.source === 'osm'
      ? `<div class="src-item"><span class="id">osm</span><div>River centreline — Lhende Khola → Bhote Koshi → Trishuli → Narayani<div class="org">${centerline.attribution}${centerline.generated ? ` · baked ${centerline.generated}` : ''}</div></div></div>`
      : '');
  $('#transcript').innerHTML = stages.map((s, i) => `<div class="tr-stage"><h4>${i + 1}. ${s.title} — ${s.place}</h4><div class="m">${Math.round(s.elev)} m · ${s.km.toFixed(1)} km from source · modeled arrival +${fmtMin(s.tMin)} to +${fmtMin(s.tMax)} (≈ ${fmtLocal(s.tMin)}–${fmtLocal(s.tMax)} NPT)</div><p>${s.body}</p></div>`).join('')
    + `<div class="tr-stage"><h4>${ov.title}</h4><p>${ov.body}</p></div><div class="tr-stage"><h4>${EVENT.barrierLake.title}</h4><p>${EVENT.barrierLake.body}</p></div>`;

  // modals
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.modal')!.classList.remove('open')));
  document.querySelectorAll<HTMLElement>('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));
  $('#btn-sources').addEventListener('click', () => $('#m-sources').classList.add('open'));
  $('#btn-transcript').addEventListener('click', () => $('#m-transcript').classList.add('open'));

  /* ---------------- timeline ---------------- */
  const cap = $('#cap'), scrub = $<HTMLInputElement>('#scrub'), read = $('#read'), playBtn = $('#play'), followBtn = $('#follow');
  const pc = $<HTMLCanvasElement>('#profile'), pctx = pc.getContext('2d')!;
  let tSec = 0, playing = false, speed = 1, follow = false, customCaption = false;
  const total = route.totalSec;
  const RATE = total / 42; // 42 s real time for the full run at 1×

  function activeIdx() { let a = 0; stages.forEach((s, i) => { if (tSec >= s.tMid - 1) a = i; }); return a; }
  function setCaption(html: string, sources?: string[]) {
    customCaption = true;
    cap.innerHTML = html + (sources?.length ? `<span class="src">[${sources.join(', ')}]</span>` : '');
  }
  function refresh() {
    const st = stateAtTime(route, tSec);
    fm.setFront(route, st.idx, st.f, [st.lng, st.lat]);
    const ai = activeIdx();
    if (!customCaption) {
      const s = stages[ai];
      cap.innerHTML = `<b>${s.title}.</b> ${s.body}<span class="src">[${s.sources.join(', ')}]</span>`;
    }
    stepEls.forEach((e, i) => { e.classList.toggle('on', i === ai); e.classList.toggle('done', i < ai); });
    stages.forEach((s, i) => { const el = stageMk[s.id]; el.classList.toggle('on', i === ai); el.classList.toggle('dimmed', i > ai); });
    const band = stages[ai];
    read.innerHTML = `<b>${st.km.toFixed(1)} km</b> · <b>${fmtLocal(tSec)}</b> NPT · +${fmtMin(tSec)}<br><span class="band">${Math.round(st.elev)} m · at ${band.title}: +${fmtMin(band.tMin)}–${fmtMin(band.tMax)}</span>`;
    scrub.value = String(Math.round((tSec / total) * 10000)); scrub.style.setProperty('--p', `${(tSec / total) * 100}%`);
    drawProfile(st.km);
  }
  function seek(sec: number) { tSec = clamp(sec, 0, total); customCaption = false; refresh(); }
  function syncPlay() { playBtn.innerHTML = playing ? '&#10074;&#10074;&nbsp; Pause' : '&#9654;&nbsp; Play'; playBtn.classList.toggle('primary', !playing); }
  function goStage(i: number, fly: boolean) {
    const s = stages[i]; playing = false; syncPlay(); seek(s.tMid);
    if (fly) { const nxt = stages[i + 1]; fm.flyToSite(P[s.idx] ? [P[s.idx].lng, P[s.idx].lat] : (s.lngLat as LngLat), nxt ? [P[nxt.idx].lng, P[nxt.idx].lat] : undefined); }
    history.replaceState(null, '', `#stage=${s.id}`);
  }

  playBtn.addEventListener('click', () => { if (tSec >= total - 1) tSec = 0; playing = !playing; customCaption = false; syncPlay(); });
  $('#replay').addEventListener('click', () => { seek(0); playing = !reduceMotion; syncPlay(); });
  scrub.addEventListener('input', () => { playing = false; syncPlay(); seek((Number(scrub.value) / 10000) * total); });
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-speed]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); speed = Number(b.dataset.speed);
  }));
  followBtn.addEventListener('click', () => { follow = !follow; followBtn.classList.toggle('on', follow); followBtn.setAttribute('aria-pressed', String(follow)); });
  const bounds: [LngLat, LngLat] = [[Math.min(...P.map((p) => p.lng)), Math.min(...P.map((p) => p.lat))], [Math.max(...P.map((p) => p.lng)), Math.max(...P.map((p) => p.lat))]];
  $('#overview').addEventListener('click', () => { follow = false; followBtn.classList.remove('on'); fm.overview(bounds); });
  $('#detail').addEventListener('click', () => {
    const a = stages.find((s) => s.id === 'rasu')!, b = stages.find((s) => s.id === 'syab')!;
    playing = false; syncPlay(); seek((a.tMid + b.tMid) / 2); follow = false; followBtn.classList.remove('on');
    fm.impactDetail([P[a.idx].lng, P[a.idx].lat], [P[b.idx].lng, P[b.idx].lat]);
  });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
    if (e.key === 'ArrowRight') goStage(Math.min(stages.length - 1, activeIdx() + 1), true);
    if (e.key === 'ArrowLeft') goStage(Math.max(0, activeIdx() - 1), true);
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => m.classList.remove('open'));
  });

  // profile chart
  pc.addEventListener('click', (e) => {
    const r = pc.getBoundingClientRect(); const f = clamp((e.clientX - r.left - 6) / (r.width - 12), 0, 1);
    const km = f * route.totalKm; let i = 0; while (i < P.length - 1 && P[i + 1].km < km) i++;
    playing = false; syncPlay(); seek(P[i].tMid);
  });
  function drawProfile(frontKm: number) {
    const w = pc.clientWidth, h = pc.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    if (pc.width !== w * dpr) { pc.width = w * dpr; pc.height = h * dpr; }
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0); pctx.clearRect(0, 0, w, h);
    const pad = 6, emax = Math.max(...P.map((p) => p.elev)) * 1.04;
    const X = (km: number) => pad + (km / route.totalKm) * (w - 2 * pad), Y = (e: number) => h - pad - (e / emax) * (h - 2 * pad);
    pctx.beginPath(); pctx.moveTo(X(0), h - pad); P.forEach((p) => pctx.lineTo(X(p.km), Y(p.elev))); pctx.lineTo(X(route.totalKm), h - pad); pctx.closePath();
    pctx.fillStyle = 'rgba(74,163,255,.10)'; pctx.fill();
    pctx.save(); pctx.beginPath(); pctx.rect(0, 0, X(frontKm), h); pctx.clip();
    pctx.beginPath(); pctx.moveTo(X(0), h - pad); P.forEach((p) => pctx.lineTo(X(p.km), Y(p.elev))); pctx.lineTo(X(frontKm), h - pad); pctx.closePath();
    pctx.fillStyle = 'rgba(255,138,61,.30)'; pctx.fill(); pctx.restore();
    pctx.beginPath(); P.forEach((p, i) => (i ? pctx.lineTo(X(p.km), Y(p.elev)) : pctx.moveTo(X(p.km), Y(p.elev))));
    pctx.strokeStyle = '#7fb3e6'; pctx.lineWidth = 1.2; pctx.stroke();
    const col: Record<string, string> = { ice: '#eaf4ff', event: '#ffcf8a', water: '#7fd0ff', impact: '#ff6b57' };
    stages.forEach((s) => { pctx.fillStyle = col[s.type] ?? '#fff'; pctx.beginPath(); pctx.arc(X(s.km), Y(s.elev), 2.4, 0, 7); pctx.fill(); });
    pctx.strokeStyle = '#ffb066'; pctx.lineWidth = 1.5; pctx.beginPath(); pctx.moveTo(X(frontKm), pad); pctx.lineTo(X(frontKm), h - pad); pctx.stroke();
    pctx.fillStyle = '#6c7683'; pctx.font = '9.5px JetBrains Mono, ui-monospace, monospace';
    pctx.fillText(`${Math.round(P[0].elev)} m`, pad + 3, 11); pctx.textAlign = 'right'; pctx.fillText(`${Math.round(P[P.length - 1].elev)} m · ${route.totalKm.toFixed(0)} km`, w - pad - 2, h - 4); pctx.textAlign = 'left';
  }

  /* ---------------- loop ---------------- */
  let last = performance.now();
  let camCenter: LngLat | null = null, camBearing = fm.map.getBearing();
  function tick(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (playing) {
      tSec += dt * RATE * speed;
      if (tSec >= total) { tSec = total; playing = false; syncPlay(); }
      refresh();
      if (follow) {
        const st = stateAtTime(route, tSec);
        const ahead = P[Math.min(P.length - 1, st.idx + 6)];
        const tgtB = bearingDeg([st.lng, st.lat], [ahead.lng, ahead.lat]);
        if (!camCenter) { camCenter = [st.lng, st.lat]; camBearing = tgtB; }
        camCenter = [lerp(camCenter[0], st.lng, 0.12), lerp(camCenter[1], st.lat, 0.12)];
        let db = ((tgtB - camBearing + 540) % 360) - 180; camBearing = (camBearing + db * 0.06 + 360) % 360;
        fm.map.jumpTo({ center: camCenter, bearing: camBearing, pitch: 68, zoom: clamp(fm.map.getZoom(), 11.6, 13.4) });
      }
    } else camCenter = null;
    requestAnimationFrame(tick);
  }
  addEventListener('resize', () => drawProfile(stateAtTime(route, tSec).km));

  // start
  refresh();
  fm.overview(bounds);
  $('#loading').classList.add('hide');
  const m = location.hash.match(/stage=([a-z]+)/);
  const si = m ? stages.findIndex((s) => s.id === m[1]) : -1;
  requestAnimationFrame(tick);
  if (si >= 0) setTimeout(() => goStage(si, true), 1200);
  else if (!reduceMotion) setTimeout(() => { playing = true; syncPlay(); }, 2200);
}
