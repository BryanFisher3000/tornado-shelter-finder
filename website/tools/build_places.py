"""Build website/data/places.json: ZIP codes and city names with coordinates for offline search.

Source: the `zipcodes` npm package (BSD license), lib/codes.js. Usage:
  npm pack zipcodes && tar -xzf zipcodes-*.tgz && python3 website/tools/build_places.py package/lib/codes.js
Only states that have shelters are kept, plus their neighbors, so the file stays small.
"""
import json, re, sys
STATES = "AL AR FL GA IA IL IN KS KY MI MN MO MS ND NE OH OK SD TN TX WI".split()
NEIGHBORS = "CO NM LA MT WY SC NC VA WV PA".split()  # people near a border search across it
KEEP = set(STATES + NEIGHBORS)
src = open(sys.argv[1]).read()
codes, _ = json.JSONDecoder().raw_decode(src[src.index("{"):])
cities, cidx, zips = [], {}, {}
for z, r in sorted(codes.items()):
    if r.get("country") != "US" or r.get("state") not in KEEP or r.get("latitude") is None: continue
    key = (r["city"].title(), r["state"])
    if key not in cidx: cidx[key] = len(cities); cities.append(list(key))
    zips[z] = [round(r["latitude"], 3), round(r["longitude"], 3), cidx[key]]
out = {"source": "zipcodes npm package (BSD)", "c": cities, "z": zips}
json.dump(out, open("website/data/places.json", "w"), separators=(",", ":"))
print(len(cities), "cities,", len(zips), "zips")
