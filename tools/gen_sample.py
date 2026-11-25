"""Write sample JSON for the CityDelta website, in exactly the shape the
Databricks export produces. The site shows a 'sample data' note while
meta.json has "sample": true. The real export overwrites these files."""
import json, math, random
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(7)
OUT = Path(__file__).resolve().parents[1] / "docs" / "data"
OUT.mkdir(parents=True, exist_ok=True)

TODAY = date(2026, 11, 25)
CENTRE = (52.0767, 4.2986)

STREETS = ["Laan van Meerdervoort", "Javastraat", "Frederik Hendriklaan", "Weimarstraat",
    "Fahrenheitstraat", "Loosduinseweg", "Prinsegracht", "Lange Voorhout", "Noordeinde", "Spui",
    "Grote Marktstraat", "Prinsestraat", "Zeestraat", "Koninginnegracht", "Badhuisweg",
    "Gevers Deynootweg", "Stationsweg", "Rijswijkseweg", "Leyweg", "Escamplaan", "Erasmusweg",
    "Thomsonlaan", "Valkenboslaan", "Laakkade", "Hoefkade", "Paul Krugerlaan", "Vaillantlaan",
    "Theresiastraat", "Bezuidenhoutseweg", "Juliana van Stolberglaan", "Neherkade", "Waldorpstraat",
    "Binckhorstlaan", "Regentesselaan", "Elandstraat", "Zoutmanstraat", "Anna Paulownastraat",
    "Statenlaan", "Kerkhoflaan", "Scheveningseweg", "Bazarstraat", "Herengracht", "Torenstraat"]
EVENTS = ["Kerstmarkt", "Winterfair", "Lichtjesroute", "Hardloopevenement", "Buurtfeest",
    "Schaatsbaan", "Wintermarkt", "Sinterklaasfeest", "Concert op het plein", "Fietstocht"]

def pick_point():
    # denser in the centre, thinning out to ~9 km
    r = abs(random.gauss(0, 2.6)) + random.random() * 0.4
    r = min(r, 9.5)
    a = random.random() * 2 * math.pi
    dlat = (r * math.cos(a)) / 111.0
    dlon = (r * math.sin(a)) / (111.32 * math.cos(math.radians(CENTRE[0])))
    lat, lon = CENTRE[0] + dlat, CENTRE[1] + dlon
    if lon < 4.16 + (lat - 52.0) * 1.2:      # keep pins off the North Sea
        lon = 4.16 + (lat - 52.0) * 1.2 + random.random() * 0.03
    return round(lat, 6), round(lon, 6)

def addr():
    return f"{random.choice(STREETS)} {random.randint(1, 420)}"

def postcode():
    return f"25{random.randint(11, 99)} {random.choice('ABCDEGHJKLMNPRSTVWXZ')}{random.choice('ABCDEGHJKLMNPRSTVWXZ')}"

def dist_m(a, b):
    dlat, dlon = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))

rows = []

# ---------- official notices (published in the last 30 days) ----------
notice_mix = [("building_works", 420), ("other", 210), ("tree_felling", 45),
              ("traffic_measure", 22), ("street_works", 16), ("event_permit", 12)]
n = 0
for cat, count in notice_mix:
    for _ in range(count):
        n += 1
        pub = TODAY - timedelta(days=random.choice(range(0, 30)))
        if pub.weekday() >= 5:
            pub -= timedelta(days=pub.weekday() - 4)
        a, pc = addr(), postcode()
        stage = random.choices(["applied", "granted", "notified", "refused", "unknown"], [40, 25, 18, 5, 12])[0]
        if cat == "building_works":
            verb = {"applied": "Aangevraagd", "granted": "Verleend", "refused": "Geweigerd",
                    "notified": "Melding", "unknown": "Besluit"}[stage]
            title = f"Omgevingsvergunning - {verb}, {a}, {pc} 's-Gravenhage"
            desc = random.choice(["het plaatsen van een dakkapel", "het vergroten van de woning",
                "het verwijderen van asbesthoudende materialen", "het splitsen van een woning",
                "het wijzigen van de gevel", "het slopen van een bijgebouw"])
        elif cat == "other":
            title = random.choice([f"Exploitatievergunning horeca, {a}",
                f"Terrasvergunning, {a}", f"Watervergunning Delfland, {a}",
                f"Standplaatsvergunning, {a}"])
            desc = "Overige vergunning of beschikking"
        elif cat == "tree_felling":
            title = f"Omgevingsvergunning - Aangevraagd, kappen van {random.randint(1, 6)} bomen, {a}"
            desc = "het kappen van bomen"
            stage = random.choice(["applied", "granted"])
        elif cat == "traffic_measure":
            title = random.choice([f"Verkeersbesluit tijdelijke afsluiting {a.rsplit(' ', 1)[0]}",
                f"Verkeersbesluit gehandicaptenparkeerplaats {a}",
                f"Verkeersbesluit eenrichtingsverkeer {a.rsplit(' ', 1)[0]}"])
            desc = "Verkeersbesluit"
            stage = "decided"
        elif cat == "street_works":
            title = f"Toestemming voor het vervangen van kabels en leidingen aan {a} te 's-Gravenhage"
            desc = "Werkzaamheden in de openbare ruimte"
            stage = "granted"
        else:
            title = f"Evenementenvergunning {random.choice(EVENTS)}, {a.rsplit(' ', 1)[0]}"
            desc = "Evenement met vergunning"
            stage = random.choice(["applied", "granted"])
        lat, lon = pick_point()
        rows.append({"id": f"sru:gmb-2026-{520000 + n}", "src": "notice", "cat": cat, "stage": stage,
            "title": title, "desc": desc, "lat": lat, "lon": lon, "basis": "published",
            "pub": pub.isoformat(), "start": None, "end": None,
            "status": "recent" if (TODAY - pub).days <= 14 else "older", "closure": "none",
            "url": f"https://zoek.officielebekendmakingen.nl/gmb-2026-{520000 + n}.html"})

# ---------- NDW road works and road events (scheduled) ----------
works_kinds = ["Werkzaamheden aan riolering", "Vervangen asfalt", "Kabels en leidingen",
    "Herinrichting straat", "Onderhoud tramspoor", "Werkzaamheden aan brug", "Plaatsen hijskraan"]
for i in range(330):
    s = TODAY + timedelta(days=random.randint(-40, 35))
    length = random.choice([1, 2, 3, 5, 7, 14, 21, 30, 45, 60, 120])
    e = s + timedelta(days=length)
    is_event = i % 14 == 0
    street = random.choice(STREETS)
    closure = random.choices(["road_closed", "lane_closed", "none"], [52, 4, 44])[0]
    title = f"{random.choice(EVENTS)}, afsluiting {street}" if is_event else f"{street}, {random.choice(works_kinds).lower()}"
    status = "ended" if e < TODAY else ("upcoming" if s > TODAY else "active")
    lat, lon = pick_point()
    rows.append({"id": f"ndw:NDW03_{640000 + i}", "src": "ndw", "cat": "road_event" if is_event else "road_works",
        "stage": None, "title": title,
        "desc": random.choice(["Omleiding aangegeven", "Snelheidsbeperking", "Fietsers omrijden",
                               "Halte tijdelijk verplaatst", ""]) or None,
        "lat": lat, "lon": lon, "basis": "scheduled", "pub": None,
        "start": f"{s.isoformat()}T{random.choice(['07:00', '08:00', '09:00', '20:00'])}",
        "end": f"{e.isoformat()}T{random.choice(['16:00', '17:00', '18:00', '06:00'])}",
        "status": status, "closure": closure, "url": "https://melvin.ndw.nu/public"})

# ---------- weather: 7 days hourly ----------
weather = []
day_rain = {0: 2, 1: 5, 2: 8, 3: 12, 4: 38, 5: 64, 6: 48}
for h in range(24 * 7):
    t = datetime(2026, 11, 25) + timedelta(hours=h)
    d = h // 24
    temp = 3.5 + d * 0.6 + 3.2 * math.sin((t.hour - 9) / 24 * 2 * math.pi) + random.uniform(-0.6, 0.6)
    peak = day_rain[d]
    rain = max(0, min(100, int(peak * (0.55 + 0.45 * math.sin((t.hour - 6) / 24 * 2 * math.pi)) + random.randint(-4, 4))))
    weather.append({"t": t.strftime("%Y-%m-%dT%H:00"), "temp": round(temp, 1), "rain_pct": rain,
        "rain_mm": round(max(0, (rain - 40) / 40 * random.uniform(0.2, 1.4)), 1),
        "code": 61 if rain >= 60 else (3 if rain >= 30 else 2), "wind": round(random.uniform(8, 26), 1)})

day_max_rain = {}
for w in weather:
    if 7 <= int(w["t"][11:13]) <= 22:
        k = w["t"][:10]
        day_max_rain[k] = max(day_max_rain.get(k, 0), w["rain_pct"])

# ---------- badges, computed the same way as gold.happenings_enriched ----------
def focus(r):
    if r["basis"] == "published":
        return r["pub"]
    s, e = r["start"][:10], r["end"][:10]
    if e < TODAY.isoformat():
        return s
    return max(s, TODAY.isoformat())

closures = [r for r in rows if r["closure"] == "road_closed"]
for r in rows:
    f = focus(r)
    r["rain_pct"] = day_max_rain.get(f) if r["basis"] == "scheduled" else None
    r["b_rain"] = bool(r["rain_pct"] is not None and r["rain_pct"] >= 60)
    near = [dist_m((r["lat"], r["lon"]), (c["lat"], c["lon"])) for c in closures
            if c["id"] != r["id"] and c["start"][:10] <= f <= c["end"][:10]]
    near = [d for d in near if d <= 500]
    r["b_closure"] = bool(near)
    r["near_m"] = round(min(near)) if near else None
    r["b_permit"] = r["cat"] == "event_permit"

# ---------- daily activity: 30 days back, 30 days ahead ----------
cats = ["building_works", "street_works", "tree_felling", "event_permit", "traffic_measure", "other"]
daily = []
for k in range(-30, 31):
    d = TODAY + timedelta(days=k)
    ds = d.isoformat()
    sched = [r for r in rows if r["basis"] == "scheduled" and r["start"][:10] <= ds <= r["end"][:10]]
    row = {"day": ds, "active_works": len(sched),
           "active_closures": sum(r["closure"] == "road_closed" for r in sched),
           "road_events": sum(r["cat"] == "road_event" for r in sched)}
    for c in cats:
        row[c] = sum(1 for r in rows if r["basis"] == "published" and r["pub"] == ds and r["cat"] == c)
    row["new_notices"] = sum(row[c] for c in cats)
    row["max_rain_pct"] = day_max_rain.get(ds)
    temps = [w["temp"] for w in weather if w["t"][:10] == ds]
    row["max_temp_c"] = max(temps) if temps else None
    daily.append(row)

# ---------- weekly notices ----------
weekly = {}
for r in rows:
    if r["basis"] != "published":
        continue
    p = date.fromisoformat(r["pub"])
    wk = (p - timedelta(days=p.weekday())).isoformat()
    key = (wk, r["cat"], r["stage"])
    weekly[key] = weekly.get(key, 0) + 1
weekly = [{"week": k[0], "category": k[1], "stage": k[2], "notices": v} for k, v in sorted(weekly.items())]

health = [
    ["official_notices", "hours_since_last_load", 0.6, "warn > 26 h, fail > 50 h", "OK", ""],
    ["official_notices", "rows_last_load", 71, "warn = 0", "OK", "only notices changed since the last run"],
    ["official_notices", "duplicate_ids_in_silver", 0, "fail > 0", "OK", "MERGE on notice_id keeps this at 0"],
    ["official_notices", "pct_unknown_stage", 20.7, "warn > 30 %", "OK", "title does not say applied, granted or refused"],
    ["weather", "hours_since_last_load", 0.6, "warn > 26 h, fail > 50 h", "OK", ""],
    ["weather", "forecast_days_ahead", 6, "warn < 5, fail < 1", "OK", ""],
    ["ndw_roadworks", "hours_since_last_load", 0.6, "warn > 26 h, fail > 50 h", "OK", ""],
    ["ndw_roadworks", "rows_last_load", 751, "warn < 100, fail = 0", "OK", ""],
    ["ndw_roadworks", "ndw_file_age_hours", 1.4, "warn > 24 h, fail > 72 h", "OK", ""],
    ["ndw_roadworks", "no_coordinates", 14, "warn > 25", "OK", "kept in lists, hidden from the map"],
    ["ndw_roadworks", "approximate_location", 23, "warn > 50", "OK", "pin further from the centre than the search box allows"],
    ["ndw_roadworks", "long_running_over_1_year", 63, "info only", "OK", "multi-year projects or placeholder end dates"],
    ["ndw_roadworks", "duplicate_ids_in_silver", 0, "fail > 0", "OK", ""],
    ["pipeline", "hours_since_gold_refresh", 0.5, "warn > 26 h, fail > 50 h", "OK", ""],
]
health = [dict(zip(["source", "check", "value", "threshold", "status", "detail"], h)) for h in health]

meta = {
    "sample": True,
    "generated_at": "2026-11-25T06:41:00+01:00",
    "data_date": TODAY.isoformat(),
    "city": {"key": "den_haag", "name": "Den Haag", "lat": CENTRE[0], "lon": CENTRE[1], "radius_km": 10},
    "pipeline": {"job": "city_delta_daily", "schedule": "daily 06:00 Europe/Amsterdam", "tasks": 10},
    "counts": {"notices": sum(r["src"] == "notice" for r in rows), "ndw": sum(r["src"] == "ndw" for r in rows)},
}

def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

dump("meta.json", meta)
dump("happenings.json", rows)
dump("weather.json", weather)
dump("daily.json", daily)
dump("weekly.json", weekly)
dump("health.json", health)
print({p.name: p.stat().st_size for p in OUT.glob("*.json")}, len(rows), "happenings")
