/* CityDelta website. Reads the daily JSON export of the gold tables (data/*.json)
   and renders the map, list, charts and data checks. No build step, no framework. */
{
const CATS = {
  road_works:      {label: "Road works",          color: "#e8590c"},
  street_works:    {label: "Street works",        color: "#b7791f"},
  road_event:      {label: "Events on the road",  color: "#7b3fc4"},
  event_permit:    {label: "Event permits",       color: "#c2417f"},
  building_works:  {label: "Building permits",    color: "#1a4fa0"},
  tree_felling:    {label: "Tree felling",        color: "#2f855a"},
  traffic_measure: {label: "Traffic decisions",   color: "#0f7c8c"},
  other:           {label: "Other notices",       color: "#7a8591"},
};
const NOTICE_CATS = ["building_works", "street_works", "tree_felling", "event_permit", "traffic_measure", "other"];
const PLACES = [
  {id: "centraal", label: "Den Haag Centraal", lat: 52.0809, lon: 4.3248},
  {id: "hs",       label: "Den Haag HS",       lat: 52.0697, lon: 4.3225},
  {id: "binnenhof",label: "Binnenhof",         lat: 52.0799, lon: 4.3131},
  {id: "schev",    label: "Scheveningen",      lat: 52.1115, lon: 4.2786},
  {id: "laak",     label: "Laakkwartier",      lat: 52.0680, lon: 4.3360},
  {id: "ypenburg", label: "Ypenburg",          lat: 52.0440, lon: 4.3650},
];
const RADII = [[0.5, "500 m"], [1, "1 km"], [2, "2 km"], [5, "5 km"]];
const PERIODS = [["today", "Today", 0], ["week", "7 days", 6], ["month", "30 days", 29]];
const STAGE = {applied: "Application", granted: "Granted", refused: "Refused", notified: "Notification",
               decided: "Decision", not_required: "No permit needed"};
const SOURCES = {official_notices: "Official notices", weather: "Weather", ndw_roadworks: "NDW road works", pipeline: "Pipeline"};
const PDOK = "https://api.pdok.nl/bzk/locatieserver/search/v3_1";
const PAGE = matchMedia("(max-width:600px)").matches ? 20 : 50;

const st = {...PLACES[0], place: "centraal", r: 1, p: "week", off: new Set(), shown: PAGE, sel: null};
const D = {};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const safeUrl = u => /^https:\/\//.test(u || "") ? u : "#";
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const toD = s => new Date(s.slice(0, 10) + "T00:00:00Z");
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const fmtDay = (s, year) => { const d = toD(s); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${year ? " " + d.getUTCFullYear() : ""}`; };
const wdDay = s => { const d = toD(s); return `${WD[d.getUTCDay()]} ${d.getUTCDate()}`; };
const radLabel = r => RADII.find(x => x[0] === r)[1];
const dist = (a1, o1, a2, o2) => {
  const R = Math.PI / 180, dl = (a2 - a1) * R, dn = (o2 - o1) * R;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a1 * R) * Math.cos(a2 * R) * Math.sin(dn / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

/* ---------- time window ---------- */
const today = () => D.meta.data_date;
const pDays = () => PERIODS.find(p => p[0] === st.p)[2];
function inPeriod(r) {
  const t = today(), end = addDays(t, pDays());
  if (r.basis === "scheduled") return r.start && r.end && r.start.slice(0, 10) <= end && r.end.slice(0, 10) >= t;
  return r.pub && r.pub >= addDays(t, -30);
}
function whenText(r) {
  if (r.basis !== "scheduled") return `Published ${fmtDay(r.pub)}`;
  const s = r.start.slice(0, 10), e = r.end.slice(0, 10), y = e.slice(0, 4) !== s.slice(0, 4);
  if (r.status === "active") return `Ongoing until ${fmtDay(e, y)}`;
  if (s === e) return `On ${fmtDay(s)}`;
  return `${fmtDay(s)} to ${fmtDay(e, y)}`;
}
function badgeHtml(r) {
  const b = [];
  if (r.basis === "scheduled" && r.closure === "road_closed") b.push(`<span class="bdg closure">Road closed</span>`);
  else if (r.b_closure) b.push(`<span class="bdg closure">Closure ${r.near_m ? "within " + esc(r.near_m) + " m" : "nearby"}</span>`);
  if (r.b_rain) b.push(`<span class="bdg rain">Rain ${esc(r.rain_pct)}%</span>`);
  if (r.b_permit) b.push(`<span class="bdg permit">Permit only</span>`);
  return b.length ? `<div class="badges">${b.join("")}</div>` : "";
}
const isClosed = r => r.basis === "scheduled" && r.closure === "road_closed";

/* ---------- controls ---------- */
function seg(el, items, cur, onPick) {
  el.innerHTML = items.map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(label)}</button>`).join("");
  el.onclick = e => { const b = e.target.closest("button"); if (b) onPick(b.dataset.v); };
}
function drawControls() {
  seg($("radius"), RADII, st.r, v => { st.r = +v; st.shown = PAGE; drawControls(); render(true); });
  seg($("period"), PERIODS, st.p, v => { st.p = v; st.shown = PAGE; drawControls(); render(false); });
  $("places").innerHTML = PLACES.map(p => `<button type="button" data-id="${p.id}" aria-pressed="${st.place === p.id}">${esc(p.label)}</button>`).join("");
}
$("places").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const p = PLACES.find(x => x.id === b.dataset.id);
  setCentre(p.lat, p.lon, p.label, p.id);
});
$("cats").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const c = b.dataset.cat;
  st.off.has(c) ? st.off.delete(c) : st.off.add(c);
  st.shown = PAGE; render(false);
});
$("more").addEventListener("click", () => { st.shown += PAGE; render(false); });
$("locate").addEventListener("click", () => {
  const btn = $("locate");
  if (!navigator.geolocation) { btn.textContent = "Location is not available"; return; }
  btn.textContent = "Finding you";
  navigator.geolocation.getCurrentPosition(
    p => { btn.textContent = "Use my location"; setCentre(p.coords.latitude, p.coords.longitude, "your location", null); },
    () => { btn.textContent = "Location blocked, search instead"; },
    {timeout: 8000});
});

function setCentre(lat, lon, label, placeId, keepZoom) {
  Object.assign(st, {lat, lon, label, place: placeId, shown: PAGE, sel: null});
  drawControls(); render(!keepZoom);
}

/* ---------- main render ---------- */
function render(fit) {
  const base = D.h.filter(inPeriod).map(r => ({r, d: dist(st.lat, st.lon, r.lat, r.lon)}));
  const R = st.r * 1000;
  const inR = base.filter(x => x.d <= R);
  const shown = inR.filter(x => !st.off.has(x.r.cat)).sort((a, b) => a.d - b.d);
  const n = shown.length;

  $("headline").textContent = n
    ? `${n.toLocaleString("en")} ${n === 1 ? "thing" : "things"} happening within ${radLabel(st.r)} of ${st.label}`
    : `Nothing found within ${radLabel(st.r)} of ${st.label}`;
  const pText = {today: "today", week: "in the next 7 days", month: "in the next 30 days"}[st.p];
  $("subline").textContent = `Road works and events ${pText}, plus official notices published in the last 30 days.`;

  // figures
  const closed = shown.filter(x => isClosed(x.r)).length;
  const works = shown.filter(x => x.r.cat === "road_works" || x.r.cat === "street_works").length;
  const events = shown.filter(x => x.r.cat === "road_event" || x.r.cat === "event_permit").length;
  const t = today(), end = addDays(t, pDays());
  const hours = D.w.filter(w => w.t.slice(0, 10) >= t && w.t.slice(0, 10) <= end && +w.t.slice(11, 13) >= 7 && +w.t.slice(11, 13) <= 22);
  const rain = hours.length ? Math.max(...hours.map(w => w.rain_pct)) : null;
  const fig = [
    [closed, closed === 1 ? "road closed" : "roads closed", closed > 0],
    [works, works === 1 ? "work site" : "work sites", false],
    [events, events === 1 ? "event" : "events", false],
    [rain == null ? "n/a" : rain + "%", "max rain chance", rain >= 60],
  ];
  $("figures").innerHTML = fig.map(([v, l, a]) => `<div class="fgr${a ? " alert" : ""}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");

  // category chips with counts in radius
  const counts = {};
  inR.forEach(x => { counts[x.r.cat] = (counts[x.r.cat] || 0) + 1; });
  $("cats").innerHTML = Object.entries(CATS).filter(([k]) => counts[k] || st.off.has(k)).map(([k, c]) =>
    `<button type="button" class="cat" data-cat="${k}" aria-pressed="${!st.off.has(k)}"><i style="background:${c.color}"></i>${esc(c.label)} <em>${counts[k] || 0}</em></button>`).join("");

  // list
  const list = shown.slice(0, st.shown);
  $("list").innerHTML = list.length ? list.map(({r, d}) => {
    const c = CATS[r.cat] || CATS.other;
    const stage = STAGE[r.stage] ? `<span>${esc(STAGE[r.stage])}</span>` : "";
    return `<li class="item${st.sel === r.id ? " on" : ""}" data-id="${esc(r.id)}" tabindex="0">
      <span class="dot${isClosed(r) ? " closed" : ""}" style="background:${c.color}"></span>
      <h3>${esc(r.title)}</h3><span class="dist">${fmtDist(d)}</span>
      <div class="meta"><span>${esc(c.label)}</span>${stage}<span>${esc(whenText(r))}</span></div>${badgeHtml(r)}</li>`;
  }).join("") : `<li class="empty">Try a larger radius, a longer period, or switch a category back on.</li>`;
  $("more").hidden = shown.length <= st.shown;
  $("more").textContent = `Show ${Math.min(PAGE, shown.length - st.shown)} more of ${shown.length - st.shown}`;

  drawMap(base.filter(x => !st.off.has(x.r.cat)), R, fit);
}

$("list").addEventListener("click", e => { const li = e.target.closest(".item"); if (li) focusItem(li.dataset.id); });
$("list").addEventListener("keydown", e => { const li = e.target.closest(".item"); if (li && e.key === "Enter") focusItem(li.dataset.id); });
function focusItem(id) {
  st.sel = id;
  document.querySelectorAll(".item.on").forEach(el => el.classList.remove("on"));
  const li = document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  if (li) li.classList.add("on");
  const m = M.byId.get(id);
  if (M.map && m) { M.map.setView(m.getLatLng(), Math.max(M.map.getZoom(), 16)); m.fire("click"); }
}

/* ---------- map ---------- */
const M = {map: null, layer: null, circle: null, you: null, byId: new Map()};
function initMap() {
  if (!window.L) { $("map").innerHTML = `<div class="nomap">The map could not load. The list on the left still works.</div>`; return; }
  const map = L.map("map", {zoomControl: true, preferCanvas: true}).setView([st.lat, st.lon], 15);
  let errors = 0, fallback = false;
  const pdok = L.tileLayer("https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: 'Kaart © <a href="https://www.kadaster.nl">Kadaster</a> / PDOK'}).addTo(map);
  pdok.on("tileerror", () => {
    if (++errors > 6 && !fallback) {
      fallback = true; map.removeLayer(pdok);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    }
  });
  M.renderer = L.canvas({padding: 0.4});
  M.layer = L.layerGroup().addTo(map);
  M.circle = L.circle([st.lat, st.lon], {radius: st.r * 1000, color: "#ffc917", weight: 3, dashArray: "8 6",
    fillColor: "#ffc917", fillOpacity: 0.07, interactive: false}).addTo(map);
  M.you = L.marker([st.lat, st.lon], {icon: L.divIcon({className: "you"}), interactive: false, keyboard: false, zIndexOffset: 1000}).addTo(map);
  map.on("click", e => {
    const {lat, lng} = e.latlng;
    setCentre(lat, lng, "the spot you picked", null, true);
    fetch(`${PDOK}/reverse?lat=${lat}&lon=${lng}&rows=1&type=adres`).then(r => r.json()).then(j => {
      const doc = j.response && j.response.docs && j.response.docs[0];
      if (doc && st.lat === lat) { st.label = doc.weergavenaam.replace(/, .*$/, ""); render(false); }
    }).catch(() => {});
  });
  M.map = map;
}
function popHtml(r, d) {
  const c = CATS[r.cat] || CATS.other;
  const stage = STAGE[r.stage] ? `, ${esc(STAGE[r.stage]).toLowerCase()}` : "";
  const link = r.src === "ndw" ? "See it on NDW Melvin" : "Read the official notice";
  return `<div class="pop"><div class="pc" style="color:${c.color}">${esc(c.label)}${stage}</div>
    <h4>${esc(r.title)}</h4><p>${esc(whenText(r))}. ${esc(fmtDist(d))} from ${esc(st.label)}.</p>
    ${r.desc ? `<p>${esc(r.desc)}</p>` : ""}${badgeHtml(r)}
    <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">${link}</a></div>`;
}
function drawMap(rows, R, fit) {
  if (!M.map) return;
  M.layer.clearLayers(); M.byId.clear();
  M.circle.setLatLng([st.lat, st.lon]).setRadius(R);
  M.you.setLatLng([st.lat, st.lon]);
  // far pins first so near ones sit on top
  rows.sort((a, b) => b.d - a.d).forEach(({r, d}) => {
    const near = d <= R, c = (CATS[r.cat] || CATS.other).color;
    const m = isClosed(r)
      ? L.marker([r.lat, r.lon], {icon: L.divIcon({className: "barrier"}), opacity: near ? 1 : 0.3, keyboard: false})
      : L.circleMarker([r.lat, r.lon], {renderer: M.renderer, radius: near ? 7 : 5, color: "#fff", weight: 1.5,
          fillColor: c, fillOpacity: near ? 0.95 : 0.3, opacity: near ? 1 : 0.3});
    m.on("click", () => {
      m.unbindPopup().bindPopup(popHtml(r, d), {maxWidth: 300}).openPopup();
      st.sel = r.id;
      document.querySelectorAll(".item.on").forEach(el => el.classList.remove("on"));
      const li = document.querySelector(`.item[data-id="${CSS.escape(r.id)}"]`);
      if (li) { li.classList.add("on"); li.scrollIntoView({block: "nearest"}); }
    });
    m.addTo(M.layer); M.byId.set(r.id, m);
  });
  if (fit) M.map.fitBounds(M.circle.getBounds(), {padding: [24, 24]});
}

/* ---------- address search (PDOK Locatieserver) ---------- */
let timer = null, hits = [], cursor = -1;
const q = $("q"), sug = $("suggest");
function showSuggest(items, msg) {
  hits = items; cursor = -1;
  sug.innerHTML = msg ? `<li class="empty">${esc(msg)}</li>`
    : items.map((h, i) => `<li role="option" id="s${i}" data-i="${i}" aria-selected="false">${esc(h.name)}</li>`).join("");
  sug.hidden = false;
}
function pick(i) {
  const h = hits[i]; if (!h) return;
  sug.hidden = true; q.value = h.name;
  setCentre(h.lat, h.lon, h.name.replace(/, .*$/, ""), null);
}
q.addEventListener("input", () => {
  clearTimeout(timer);
  const v = q.value.trim();
  if (v.length < 3) { sug.hidden = true; return; }
  timer = setTimeout(() => {
    const url = `${PDOK}/free?q=${encodeURIComponent(v)}&rows=6&fl=weergavenaam,centroide_ll&fq=${encodeURIComponent("type:(adres OR postcode OR weg OR woonplaats)")}&lat=${st.lat}&lon=${st.lon}`;
    fetch(url).then(r => r.json()).then(j => {
      const docs = (j.response && j.response.docs) || [];
      const items = docs.map(d => {
        const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d.centroide_ll || "");
        return m ? {name: d.weergavenaam, lon: +m[1], lat: +m[2]} : null;
      }).filter(Boolean);
      items.length ? showSuggest(items) : showSuggest([], "No address found. Try a street and house number.");
    }).catch(() => showSuggest([], "Search is unavailable right now. Use the places below or click the map."));
  }, 250);
});
q.addEventListener("keydown", e => {
  if (sug.hidden || !hits.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    cursor = (cursor + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
    sug.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", i === cursor));
    q.setAttribute("aria-activedescendant", "s" + cursor);
  } else if (e.key === "Enter") { e.preventDefault(); pick(Math.max(cursor, 0)); }
  else if (e.key === "Escape") sug.hidden = true;
});
sug.addEventListener("mousedown", e => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
q.addEventListener("blur", () => setTimeout(() => { sug.hidden = true; }, 150));
$("searchForm").addEventListener("submit", e => { e.preventDefault(); if (hits.length) pick(Math.max(cursor, 0)); });

/* ---------- charts ---------- */
function chart(id, draw) {
  const el = $(id);
  const go = () => { const W = el.clientWidth, H = el.clientHeight; if (W > 0) el.innerHTML = draw(W, H); };
  const ro = new ResizeObserver(go); ro.observe(el);
}
const niceMax = v => { const p = 10 ** Math.floor(Math.log10(v || 1)); return Math.ceil(v / p * 2) / 2 * p; };
const STRIPES = `<defs><pattern id="stripes" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#ffffff"/><rect width="4" height="8" fill="#d7262e"/></pattern></defs>`;

function drawWorks(W, H) {
  const rows = D.daily.filter(d => d.day >= today()).slice(0, 14);
  const m = {l: 8, r: 8, t: 22, b: 26}, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = niceMax(Math.max(...rows.map(d => d.active_works)));
  const bw = iw / rows.length, gap = Math.min(8, bw * 0.25);
  const every = bw < 34 ? 2 : 1;
  const y = v => m.t + ih - v / max * ih;
  return `<svg>${STRIPES}${rows.map((d, i) => {
    const x = m.l + i * bw + gap / 2, w = bw - gap;
    const lbl = i % every ? "" : `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${bw < 40 ? toD(d.day).getUTCDate() : wdDay(d.day)}</text>`;
    return `<rect x="${x}" y="${y(d.active_works)}" width="${w}" height="${ih - (y(d.active_works) - m.t)}" fill="#7fa3d9" rx="2"/>
      <rect x="${x}" y="${y(d.active_closures)}" width="${w}" height="${ih - (y(d.active_closures) - m.t)}" fill="url(#stripes)" stroke="#d7262e" stroke-width="1"/>
      ${i % every ? "" : `<text class="v" x="${x + w / 2}" y="${y(d.active_works) - 6}" text-anchor="middle">${d.active_works}</text>`}${lbl}`;
  }).join("")}<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" stroke="var(--ink)"/></svg>`;
}

function weeklyRows() {
  const by = {};
  D.weekly.forEach(r => { by[r.week] = by[r.week] || {}; by[r.week][r.category] = (by[r.week][r.category] || 0) + r.notices; });
  return Object.keys(by).sort().map(w => ({week: w, ...by[w], total: Object.values(by[w]).reduce((a, b) => a + b, 0)}));
}
function drawWeekly(W, H) {
  const rows = weeklyRows();
  const m = {l: 8, r: 8, t: 22, b: 26}, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = niceMax(Math.max(...rows.map(r => r.total)));
  const bw = iw / rows.length, gap = Math.min(28, bw * 0.35);
  return `<svg>${rows.map((r, i) => {
    const x = m.l + i * bw + gap / 2, w = bw - gap;
    let acc = 0;
    const segs = NOTICE_CATS.map(c => {
      const v = r[c] || 0; if (!v) return "";
      const y0 = m.t + ih - (acc + v) / max * ih, h = v / max * ih; acc += v;
      return `<rect x="${x}" y="${y0}" width="${w}" height="${Math.max(h - 1, 0.5)}" fill="${CATS[c].color}"/>`;
    }).join("");
    const top = m.t + ih - r.total / max * ih;
    const lab = W < 420 ? fmtDay(r.week) : `Week of ${fmtDay(r.week)}`;
    return `${segs}<text class="v" x="${x + w / 2}" y="${top - 6}" text-anchor="middle">${r.total}</text>
      <text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${lab}</text>`;
  }).join("")}<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" stroke="var(--ink)"/></svg>`;
}

function drawWeather(W, H) {
  const rows = D.w;
  const m = {l: 34, r: 40, t: 24, b: 26}, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const temps = rows.map(r => r.temp);
  const tMin = Math.floor(Math.min(...temps) - 1), tMax = Math.ceil(Math.max(...temps) + 1);
  const x = i => m.l + i / (rows.length - 1) * iw;
  const yT = v => m.t + ih - (v - tMin) / (tMax - tMin) * ih;
  const yR = v => m.t + ih - v / 100 * ih;
  const bw = Math.max(iw / rows.length - 0.6, 0.8);
  const bars = rows.map((r, i) => `<rect x="${x(i) - bw / 2}" y="${yR(r.rain_pct)}" width="${bw}" height="${m.t + ih - yR(r.rain_pct)}" fill="${r.rain_pct >= 60 ? "#1b6fd8" : "#9cc3f5"}"/>`).join("");
  const line = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yT(r.temp).toFixed(1)}`).join("");
  const days = rows.map((r, i) => [r, i]).filter(([r]) => r.t.slice(11, 13) === "00");
  const dayMarks = days.map(([r, i]) => `<line x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--line)"/>
    <text x="${x(i) + 4}" y="${H - 8}">${W < 520 ? toD(r.t).getUTCDate() : wdDay(r.t)}</text>`).join("");
  const peak = rows.reduce((a, r, i) => r.rain_pct > a.v ? {v: r.rain_pct, i} : a, {v: -1, i: 0});
  const px = x(peak.i), anchor = px > W - 140 ? "end" : "start";
  const note = peak.v >= 30 ? `<text class="v" x="${px + (anchor === "end" ? -6 : 6)}" y="${yR(peak.v) - 6}" text-anchor="${anchor}">${peak.v}% rain, ${wdDay(rows[peak.i].t)}</text>` : "";
  const ticksT = [tMin, Math.round((tMin + tMax) / 2), tMax].map(v => `<text x="${m.l - 6}" y="${yT(v) + 4}" text-anchor="end">${v}°</text>`).join("");
  const ticksR = [0, 50, 100].map(v => `<text x="${W - m.r + 6}" y="${yR(v) + 4}">${v}%</text>`).join("");
  return `<svg>${dayMarks}${bars}<path d="${line}" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"/>${ticksT}${ticksR}${note}
    <line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" stroke="var(--ink)"/></svg>`;
}

function drawRhythmText() {
  const td = D.daily.find(d => d.day === today());
  if (td) $("rhythmLead").textContent = `Today ${td.active_works} road works are running across Den Haag, ${td.active_closures} of them with a road closed. Figures cover the whole city, not only your radius.`;
  const wk = weeklyRows(), last4 = wk.slice(-4).reduce((a, r) => a + r.total, 0);
  $("capWeekly").textContent = `${last4.toLocaleString("en")} new official notices in the last 4 weeks`;
  const busiest = D.daily.filter(d => d.day >= today()).slice(0, 14).reduce((a, d) => d.active_works > a.active_works ? d : a);
  $("capWorks").textContent = `Busiest day for road works: ${wdDay(busiest.day)} ${MON[toD(busiest.day).getUTCMonth()]}, with ${busiest.active_works}`;
  const wet = {};
  D.w.forEach(w => { const h = +w.t.slice(11, 13); if (h >= 7 && h <= 22) wet[w.t.slice(0, 10)] = Math.max(wet[w.t.slice(0, 10)] || 0, w.rain_pct); });
  const risky = Object.keys(wet).filter(k => wet[k] >= 60);
  $("capWeather").textContent = risky.length ? `Rain likely on ${risky.map(wdDay).join(" and ")}` : "A mostly dry week ahead";
  const used = NOTICE_CATS.filter(c => D.weekly.some(r => r.category === c));
  $("keyWeekly").innerHTML = used.map(c => `<span><i class="sw" style="background:${CATS[c].color}"></i>${esc(CATS[c].label)}</span>`).join("");
}

/* ---------- data checks ---------- */
function drawHealth() {
  const fmtV = h => {
    const v = h.value == null ? "n/a" : (Number.isInteger(h.value) ? h.value.toLocaleString("en") : (+h.value).toFixed(1));
    return /hours/.test(h.check) ? `${v} h` : (/pct/.test(h.check) ? `${v}%` : v);
  };
  const NAMES = {pct_unknown_stage: "Share with unknown stage", ndw_file_age_hours: "Age of the NDW file", duplicate_ids_in_silver: "Duplicate ids in silver", long_running_over_1_year: "Running longer than a year", hours_since_gold_refresh: "Hours since gold refresh"};
  const name = c => { const s = NAMES[c] || c.replace(/_/g, " "); return s[0].toUpperCase() + s.slice(1); };
  $("checks").tBodies[0].innerHTML = D.health.map(h => `<tr>
    <td data-l="Source">${esc(SOURCES[h.source] || h.source)}</td>
    <td data-l="Check">${esc(name(h.check))}${h.detail ? `<span class="note">${esc(h.detail)}</span>` : ""}</td>
    <td class="num" data-l="Value">${esc(fmtV(h))}</td><td data-l="Threshold">${esc(h.threshold)}</td>
    <td data-l="Status"><span class="st ${esc(h.status)}">${esc(h.status)}</span></td></tr>`).join("");
  const bad = D.health.filter(h => h.status !== "OK").length;
  $("checksTitle").textContent = bad ? `${bad} of ${D.health.length} data checks need attention` : `All ${D.health.length} data checks passed this morning`;
}

/* ---------- boot ---------- */
const files = ["meta", "happenings", "weather", "daily", "weekly", "health"];
Promise.all(files.map(f => fetch(`data/${f}.json`, {cache: "no-cache"}).then(r => { if (!r.ok) throw new Error(f); return r.json(); })))
  .then(([meta, h, w, daily, weekly, health]) => {
    Object.assign(D, {meta, h: h.filter(r => r.lat != null && r.lon != null), w, daily, weekly, health});
    const g = new Date(meta.generated_at);
    $("asof").textContent = `Updated ${g.getDate()} ${MON[g.getMonth()]}, ${String(g.getHours()).padStart(2, "0")}:${String(g.getMinutes()).padStart(2, "0")}`;
    $("cityName").textContent = meta.city.name;
    $("sample").hidden = !meta.sample;
    drawControls(); initMap(); render(true);
    drawRhythmText(); drawHealth();
    chart("figWorks", drawWorks); chart("figWeekly", drawWeekly); chart("figWeather", drawWeather);
  })
  .catch(() => {
    $("headline").textContent = "Today's data could not be loaded";
    $("subline").textContent = "The daily export may still be running. Try again in a few minutes.";
  });
}
