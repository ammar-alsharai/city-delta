"""Export the CityDelta gold tables to JSON for the public website.

Runs in GitHub Actions every morning after the Databricks Job. It queries the
lakehouse through the Databricks SQL Statement API and writes docs/data/*.json,
which GitHub Pages serves to the website.
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
import yaml

HOST = os.environ["DATABRICKS_HOST"].removeprefix("https://").rstrip("/")
TOKEN = os.environ["DATABRICKS_TOKEN"]
WAREHOUSE_ID = os.environ["DATABRICKS_WAREHOUSE_ID"]
CATALOG = "city_delta"

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data"
TZ = ZoneInfo("Europe/Amsterdam")

session = requests.Session()
session.headers.update({"Authorization": f"Bearer {TOKEN}", "User-Agent": "CityDelta/1.0 (portfolio project)"})
API = f"https://{HOST}/api/2.0/sql/statements"


def convert(value, type_name):
    """The API returns every value as a string; turn it back into the right type."""
    if value is None:
        return None
    t = (type_name or "").upper()
    if t in ("INT", "LONG", "SHORT", "BYTE", "BIGINT", "INTEGER", "SMALLINT", "TINYINT"):
        return int(value)
    if t in ("DOUBLE", "FLOAT", "DECIMAL"):
        return float(value)
    if t == "BOOLEAN":
        return value.lower() == "true"
    return value


def run_sql(sql):
    """Run one SQL statement on the warehouse and return a list of dicts."""
    body = {
        "warehouse_id": WAREHOUSE_ID,
        "statement": sql,
        "catalog": CATALOG,
        "wait_timeout": "50s",          # wait up to 50 s inline (the warehouse may need to start)
        "on_wait_timeout": "CONTINUE",  # if it takes longer, keep running and we poll below
        "format": "JSON_ARRAY",
        "disposition": "INLINE",
    }
    resp = session.post(API, json=body, timeout=90)
    resp.raise_for_status()
    data = resp.json()

    # Poll until the statement is finished
    started = time.time()
    while data["status"]["state"] in ("PENDING", "RUNNING"):
        if time.time() - started > 600:
            raise TimeoutError("Statement did not finish within 10 minutes")
        time.sleep(5)
        resp = session.get(f"{API}/{data['statement_id']}", timeout=60)
        resp.raise_for_status()
        data = resp.json()

    if data["status"]["state"] != "SUCCEEDED":
        raise RuntimeError(f"SQL failed: {data['status']}")

    columns = data["manifest"]["schema"]["columns"]
    names = [c["name"] for c in columns]
    types = [c.get("type_name") for c in columns]

    rows = []
    result = data.get("result") or {}
    while True:
        for raw in result.get("data_array") or []:
            rows.append({n: convert(v, t) for n, v, t in zip(names, raw, types)})
        nxt = result.get("next_chunk_internal_link")
        if not nxt:
            break
        resp = session.get(f"https://{HOST}{nxt}", timeout=60)   # large results come in chunks
        resp.raise_for_status()
        result = resp.json()
    return rows


QUERIES = {
    "happenings": """
        SELECT happening_id                                   AS id,
               CASE WHEN source = 'ndw_melvin' THEN 'ndw' ELSE 'notice' END AS src,
               category                                       AS cat,
               stage,
               title,
               substr(description, 1, 300)                    AS `desc`,
               round(lat, 6)                                  AS lat,
               round(lon, 6)                                  AS lon,
               time_basis                                     AS basis,
               CAST(published_date AS STRING)                 AS pub,
               date_format(start_local, "yyyy-MM-dd'T'HH:mm") AS start,
               date_format(end_local,   "yyyy-MM-dd'T'HH:mm") AS `end`,
               status,
               closure_level                                  AS closure,
               day_rain_pct                                   AS rain_pct,
               badge_rain_risk                                AS b_rain,
               badge_closure_nearby                           AS b_closure,
               nearest_closure_m                              AS near_m,
               badge_permit_only                              AS b_permit,
               url
        FROM gold.happenings_enriched
        WHERE city_key = '{city}'
          AND location_ok
          AND (
                (time_basis = 'scheduled'
                 AND to_date(end_local)   >= date_sub(current_date(), 1)
                 AND to_date(start_local) <= date_add(current_date(), 31))
             OR (time_basis = 'published' AND published_date >= date_sub(current_date(), 31))
              )
    """,
    "weather": """
        SELECT date_format(hour_local, "yyyy-MM-dd'T'HH:00") AS t,
               round(temperature_c, 1)                      AS temp,
               rain_chance_pct                              AS rain_pct,
               rain_mm,
               weather_code                                 AS code,
               wind_kmh                                     AS wind
        FROM silver.weather_hourly
        WHERE city_key = '{city}'
          AND date_local >= current_date()
        ORDER BY hour_local
        LIMIT 168
    """,
    "daily": """
        SELECT CAST(day AS STRING) AS day,
               active_works, active_closures, road_events,
               building_works, street_works, tree_felling, event_permit, traffic_measure, other,
               new_notices, max_rain_pct, max_temp_c
        FROM gold.daily_activity
        WHERE city_key = '{city}'
        ORDER BY day
    """,
    "weekly": """
        SELECT CAST(week_start AS STRING) AS week, category, stage, notices
        FROM gold.permits_weekly
        WHERE city_key = '{city}'
          AND week_start >= date_sub(current_date(), 35)
        ORDER BY week_start, category
    """,
    "health": """
        SELECT source, check_name AS `check`, value, threshold, status, detail
        FROM gold.data_health
        ORDER BY source, check_name
    """,
}

# Minimum rows per file; below this we refuse to publish (protects the live site)
MIN_ROWS = {"happenings": 50, "weather": 24, "daily": 7, "weekly": 1, "health": 5}


def main():
    config = yaml.safe_load((ROOT / "config" / "cities.yaml").read_text(encoding="utf-8"))
    city = config["cities"][0]          # the website shows the first city for now

    results = {}
    for name, sql in QUERIES.items():
        rows = run_sql(sql.format(city=city["key"]))
        print(f"{name}: {len(rows)} rows")
        if len(rows) < MIN_ROWS[name]:
            sys.exit(f"Stopping: {name} has only {len(rows)} rows (minimum {MIN_ROWS[name]}). Website left unchanged.")
        results[name] = rows

    now = datetime.now(TZ)
    results["meta"] = {
        "sample": False,
        "generated_at": now.isoformat(timespec="seconds"),
        "data_date": now.date().isoformat(),
        "city": {"key": city["key"], "name": city["name"], "lat": city["lat"],
                 "lon": city["lon"], "radius_km": city["radius_km"]},
        "pipeline": {"job": "city_delta_daily", "schedule": "daily 06:00 Europe/Amsterdam", "tasks": 10},
        "counts": {"notices": sum(r["src"] == "notice" for r in results["happenings"]),
                   "ndw": sum(r["src"] == "ndw" for r in results["happenings"])},
    }

    # Only write after every query succeeded, so the site never gets half an update
    OUT.mkdir(parents=True, exist_ok=True)
    for name, obj in results.items():
        (OUT / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(results)} files to {OUT}")


if __name__ == "__main__":
    main()