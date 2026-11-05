"""Refresh website/data/shelters.json from the Supabase shelters table.

Usage: python3 fetch_shelters.py ../data/shelters.json

Calls the shelters_snapshot() function (supabase/snapshot.sql) with the public
publishable key, checks the result looks like a full list, and only then
replaces the file. If anything fails, the existing file is left as it is and
the script exits with status 1, so a build can carry on with the committed copy.
"""
import json, os, sys, tempfile, urllib.request

URL = os.environ.get("SUPABASE_URL", "https://svptjcclszprsmjoldaz.supabase.co") + "/rest/v1/rpc/shelters_snapshot"
KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_jKaaBPri_pJorALxmh4Ndg_LClnGIZk")  # public by design
MIN_SHELTERS = 1000  # refuse to ship a list that is suspiciously short


def main(dst):
    req = urllib.request.Request(URL, data=b"{}", method="POST",
                                 headers={"apikey": KEY, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            snap = json.load(r)
    except Exception as e:
        print(f"Could not fetch shelters from Supabase ({e}); keeping {dst}")
        return 1
    shelters = snap.get("shelters") if isinstance(snap, dict) else None
    if not isinstance(shelters, list) or len(shelters) < MIN_SHELTERS or not all("id" in s and "location" in s for s in shelters):
        print(f"Supabase returned an unexpected shelter list ({len(shelters or [])} shelters); keeping {dst}")
        return 1
    out = {"source": "Supabase shelters table", "generated_at": snap.get("generated_at"), "count": len(shelters), "shelters": shelters}
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(dst)))
    with os.fdopen(fd, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, dst)
    print(f"wrote {len(shelters)} shelters to {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
