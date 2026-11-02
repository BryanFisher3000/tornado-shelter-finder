"""Convert the "SAS Shelter Finder Data" sheet (exported as CSV) into shelters.json.

Usage: python3 build_shelters.py sas.csv ../data/shelters.json

The output is the one data file both the website and the mobile app read. Each
record uses the public response shape from the "Shelter Data Model & API Spec",
so the same code can later read GET /v1/shelters instead of this file.
"""
import csv, json, re, sys, hashlib

UNKNOWN = ("", "n/a", "unknown", "not listed", "not specified")
ALWAYS = {"always", "year-round", "24/7", "open"}  # anything else, e.g. "During emergencies", is emergencies_only
CLOSED = {"shelter not open", "closed"}


def clean(s):
    return re.sub(r"[​﻿]", "", s or "").strip()


def tri(v):
    """Spec enum yes / no / unknown. "Service animals only" counts as no for pets."""
    v = clean(v).lower()
    if v in UNKNOWN:
        return "unknown"
    if "service" in v or v.startswith("svc"):
        return "no"
    if v.startswith("y") or ("pet friendly" in v.replace("-", " ") and "not" not in v):
        return "yes"
    if v.startswith("n"):
        return "no"
    return "unknown"


def access_from_note(note):
    n = note.lower()
    if "regist" in n:
        return "registration_required"
    if any(w in n for w in ("members only", "residents only", "employees only", "students only")):
        return "restricted"
    return "public"


def capacity_min(v):
    m = re.search(r"\d[\d,]*", v)
    return int(m.group().replace(",", "")) if m else None


def main(src, dst):
    rows = list(csv.reader(open(src, encoding="utf-8")))
    head = rows[0]
    col = {name: head.index(name) for name in
           ["Latitude", "Longitude", "Name", "Address", "City", "County", "State", "Zip",
            "Capacity", "ADA", "Pets", "Open", "Note"]}
    out, seen, skipped = [], set(), 0
    for r in rows[1:]:
        g = lambda k: clean(r[col[k]]) if col[k] < len(r) else ""
        try:
            lat, lng = float(g("Latitude")), float(g("Longitude"))
        except ValueError:
            skipped += 1
            continue
        if not (18 < lat < 72 and -180 < lng < -60) or not g("Name"):
            skipped += 1
            continue
        name, addr, city, state = g("Name"), g("Address"), g("City"), g("State").upper()
        key = f"{name}|{addr}|{city}|{state}".lower()
        if key in seen:  # exact duplicate rows
            skipped += 1
            continue
        seen.add(key)
        cap = g("Capacity")
        cap = "" if cap.lower() in UNKNOWN else cap
        # the cleaned Location tab has a numeric Capacity plus a "Capacity Display" bucket (50+, <50, Unknown)
        disp = clean(r[head.index("Capacity Display")]) if "Capacity Display" in head and head.index("Capacity Display") < len(r) else ""
        disp = "" if disp.lower() in UNKNOWN else disp
        avail = g("Open").lower()
        note = g("Note")
        out.append({
            "id": hashlib.sha1(key.encode()).hexdigest()[:12],
            "name": name,
            "location": {"lat": round(lat, 6), "lng": round(lng, 6)},
            "address": {"line": addr, "city": city, "county": g("County"), "state": state,
                        "zip": re.sub(r"\D", "", g("Zip"))[:5]},
            "capacity": {"min": capacity_min(cap) if cap else None, "label": disp or cap or None},
            "ada_accessible": tri(g("ADA")),
            "pets_allowed": tri(g("Pets")),
            "availability": "always" if avail in ALWAYS else "emergencies_only",
            "access": access_from_note(note),
            "notes": note or None,
            "verification_status": "unverified",
            "status": "retired" if avail in CLOSED else "active",
            "version": 1,
        })
    json.dump({"source": "SAS Shelter Finder Data (Location tab)", "count": len(out), "shelters": out},
              open(dst, "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {len(out)} shelters, skipped {skipped}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
