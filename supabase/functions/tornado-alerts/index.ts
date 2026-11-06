// tornado-alerts: runs every minute (pg_cron, supabase/alerts.sql).
// 1. Reads active Tornado Warnings (and Watches) from the National Weather Service.
// 2. Finds phones whose current spot, Home or Work is inside an alert's area.
// 3. Sends each phone one push per alert through Firebase Cloud Messaging (HTTP v1).
//    An updated warning (new id that references the old one) counts as the same warning.
// 4. When every warning a phone was told about has ended, sends one "warning ended" push.
//    alert_pushes.matched: here/home/work (warning), watch-<spot>, update / watch-update (same alert, no push),
//    clear (all-clear sent), test.
// Secrets: FCM_SERVICE_ACCOUNT (the Firebase service-account JSON). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Deploy with verify_jwt off.
import { createClient } from "npm:@supabase/supabase-js@2";

const NWS = "https://api.weather.gov/alerts/active?status=actual&event=Tornado%20Warning,Tornado%20Watch";
const UA = "(Tornado Shelter Finder, app@survive-a-storm.com)";
const HERE_MAX_AGE_MS = 12 * 3600e3; // trust the phone's last-opened spot for 12 hours

type Pt = [number, number]; // [lng, lat]
type Geo = { type: string; coordinates: any } | null;

function inRing(p: Pt, ring: Pt[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(p: Pt, poly: Pt[][]) { return inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h)); }
function inGeo(p: Pt, g: Geo): boolean {
  if (!g) return false;
  if (g.type === "Polygon") return inPoly(p, g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.some((c: Pt[][]) => inPoly(p, c));
  if (g.type === "GeometryCollection") return (g as any).geometries.some((x: Geo) => inGeo(p, x));
  return false;
}

// ---- Firebase access token from the service account (RS256 JWT)
let tokenCache: { token: string; exp: number } | null = null;
function b64url(b: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = ""; bytes.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function fcmToken(sa: any) {
  if (tokenCache && tokenCache.exp > Date.now() + 60e3) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + b64url(sig) }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("FCM auth failed: " + JSON.stringify(j).slice(0, 200));
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

// "2026-11-06T16:45:00-06:00" -> "4:45 PM" (the alert's own local time)
function clock(iso?: string) {
  const m = String(iso || "").match(/T(\d\d):(\d\d)/); if (!m) return "";
  const h = +m[1]; return ((h % 12) || 12) + ":" + m[2] + (h < 12 ? " AM" : " PM");
}

async function send(sa: any, msg: any) {
  return fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST", headers: { Authorization: "Bearer " + (await fcmToken(sa)), "Content-Type": "application/json" }, body: JSON.stringify({ message: msg }),
  });
}

Deno.serve(async (req) => {
  const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!saRaw) return new Response("FCM_SERVICE_ACCOUNT not set", { status: 200 });
  const sa = JSON.parse(saRaw);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // {"test": true}: one clearly-marked test alert to the phone that registered most recently
  // (within 30 minutes), at most once every 5 minutes.
  const body = await req.json().catch(() => ({}));
  // {"test": "clear"}: a TEST "warning ended" push, replacing the last test alert
  if (body && body.test === "clear") {
    const { data: dev } = await db.from("push_devices").select("token").gte("updated_at", new Date(Date.now() - 30 * 60e3).toISOString()).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!dev) return Response.json({ test: "no phone registered in the last 30 minutes" });
    const { data: last } = await db.from("alert_pushes").select("alert_id").eq("token", dev.token).eq("matched", "test").order("sent_at", { ascending: false }).limit(1).maybeSingle();
    const tag = last?.alert_id || "test";
    const r = await send(sa, {
      token: dev.token,
      notification: { title: "TEST: Tornado Warning Ended", body: "This is only a test. The Tornado Warning has ended. Storms may continue, so stay alert." },
      data: { kind: "tornado-clear", alert_id: tag, area: "TEST ONLY" },
      android: { priority: "high", notification: { channel_id: "tornado-updates", sound: "default", tag } },
    });
    return Response.json({ test: r.ok ? "sent" : "failed", status: r.status });
  }
  if (body && body.test === true) {
    const { data: dev } = await db.from("push_devices").select("token, places").gte("updated_at", new Date(Date.now() - 30 * 60e3).toISOString()).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!dev) return Response.json({ test: "no phone registered in the last 30 minutes" });
    const id = "test-" + Math.floor(Date.now() / 300e3);
    const { error: dup } = await db.from("alert_pushes").insert({ alert_id: id, token: dev.token, matched: "test" });
    if (dup) return Response.json({ test: "already sent in the last 5 minutes" });
    const r = await send(sa, {
      token: dev.token,
      notification: { title: "TEST: Tornado Warning", body: "This is only a test of Tornado Shelter Finder alerts. Tap to see what you'd do." },
      data: { kind: "tornado", alert_id: id, event: "Tornado Warning", where: "here", safe: "", expires: new Date(Date.now() + 30 * 60e3).toISOString(), area: "TEST ONLY, not a real warning" },
      android: { priority: "high", notification: { channel_id: "tornado-alarm", sound: "tornado_alarm", tag: id } },
    });
    return Response.json({ test: r.ok ? "sent" : "failed", status: r.status, detail: r.ok ? undefined : (await r.text()).slice(0, 300) });
  }

  const res = await fetch(NWS, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
  if (!res.ok) return new Response("NWS " + res.status, { status: 502 });
  const alerts = ((await res.json()).features || []).filter((f: any) => f.properties?.messageType !== "Cancel");

  const { data: devices, error } = await db.from("push_devices").select("token, platform, last_lat, last_lng, last_seen, places, warnings, watches");
  if (error) return new Response(error.message, { status: 500 });
  if (!devices?.length) return Response.json({ alerts: alerts.length, sent: 0 });

  // Watches (and some warnings) have no polygon; use their counties' shapes instead.
  const zoneCache = new Map<string, Geo>();
  async function areaOf(f: any): Promise<Geo> {
    if (f.geometry) return f.geometry;
    const polys: any[] = [];
    for (const z of (f.properties.affectedZones || []).slice(0, 60)) {
      if (!zoneCache.has(z)) {
        const zr = await fetch(z, { headers: { "User-Agent": UA, Accept: "application/geo+json" } }).catch(() => null);
        zoneCache.set(z, zr && zr.ok ? (await zr.json()).geometry || null : null);
      }
      const g = zoneCache.get(z);
      if (g?.type === "Polygon") polys.push(g.coordinates); else if (g?.type === "MultiPolygon") polys.push(...g.coordinates);
    }
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }
  const areas = new Map<string, Geo>();
  async function areaFor(f: any) { if (!areas.has(f.properties.id)) areas.set(f.properties.id, await areaOf(f)); return areas.get(f.properties.id)!; }
  function spotsOf(d: any) {
    const fresh = d.last_seen && Date.now() - Date.parse(d.last_seen) < HERE_MAX_AGE_MS;
    const spots: [string, any][] = [];
    if (fresh && d.last_lat != null) spots.push(["here", { lat: d.last_lat, lng: d.last_lng }]);
    for (const k of ["home", "work"]) if (d.places?.[k]?.lat != null) spots.push([k, d.places[k]]);
    return spots;
  }

  // what each phone was sent in the last 12 hours
  const { data: recent } = await db.from("alert_pushes").select("alert_id, token, matched, sent_at").gte("sent_at", new Date(Date.now() - 12 * 3600e3).toISOString()).order("sent_at");
  const done = new Set((recent || []).map((r: any) => r.alert_id + "|" + r.token));
  const access = await fcmToken(sa);
  let sent = 0, failed = 0, cleared = 0;

  async function push(d: any, message: any, row: { alert_id: string; matched: string }) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" }, body: JSON.stringify({ message: { token: d.token, ...message } }),
    });
    if (r.ok) {
      await db.from("alert_pushes").insert({ alert_id: row.alert_id, token: d.token, matched: row.matched });
      done.add(row.alert_id + "|" + d.token);
      return true;
    }
    const t = await r.text();
    // the app was uninstalled or the token expired
    if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(t)) await db.from("push_devices").delete().eq("token", d.token);
    else console.warn("FCM", r.status, t.slice(0, 300));
    return false;
  }
  // NWS "references" hold ids like https://api.weather.gov/alerts/<id> or the bare id
  const refsOf = (f: any) => (f.properties.references || []).map((x: any) => String(x.identifier || x["@id"] || "").replace(/^.*\/alerts\//, ""));

  for (const f of alerts) {
    const p = f.properties, isWarning = p.event === "Tornado Warning";
    const want = devices.filter((d: any) => (isWarning ? d.warnings : d.watches) && !done.has(p.id + "|" + d.token));
    if (!want.length) continue;
    // an update to a warning the phone already got: remember it, but don't push again
    const refs = refsOf(f);
    const fresh: any[] = [];
    for (const d of want) {
      if (refs.some((id: string) => done.has(id + "|" + d.token))) {
        await db.from("alert_pushes").insert({ alert_id: p.id, token: d.token, matched: isWarning ? "update" : "watch-update" });
        done.add(p.id + "|" + d.token);
      } else fresh.push(d);
    }
    if (!fresh.length) continue;
    const area = await areaFor(f);
    if (!area) continue;
    for (const d of fresh) {
      const hit = spotsOf(d).find(([, s]) => inGeo([+s.lng, +s.lat], area));
      if (!hit) continue;
      const [where, spot] = hit, place = where === "home" ? "Home" : where === "work" ? "Work" : "";
      const until = clock(p.expires || p.ends);
      const title = isWarning ? (place ? "Tornado Warning at " + place : "Tornado Warning near you") : (place ? "Tornado Watch at " + place : "Tornado Watch for your area");
      const body = isWarning
        ? (place && spot.safe === "yes" ? "Take cover in your safe place at " + place + " now." : "Take cover now. Tap to see the nearest shelters.") + (until ? " Until " + until + "." : "")
        : "Conditions are right for tornadoes" + (until ? " until " + until : "") + ". Know where you'll take cover.";
      const ok = await push(d, {
        notification: { title, body },
        data: { kind: "tornado", alert_id: p.id, event: p.event, where, safe: String(spot.safe || ""), expires: String(p.expires || ""), area: String(p.areaDesc || "").slice(0, 300) },
        android: { priority: "high", ttl: "3600s", notification: { channel_id: isWarning ? "tornado-alarm" : "tornado-watches", sound: isWarning ? "tornado_alarm" : "default", tag: p.id } },
      }, { alert_id: p.id, matched: isWarning ? where : "watch-" + where });
      if (ok) sent++; else failed++;
    }
  }

  // All clear: a phone whose warnings have all ended (expired, cancelled, or no longer listed) gets one push,
  // unless one of its spots is inside another active warning.
  const active = new Set(alerts.map((f: any) => f.properties.id));
  const warnings = alerts.filter((f: any) => f.properties.event === "Tornado Warning");
  const byToken = new Map<string, any[]>();
  for (const r of recent || []) { if (!byToken.has(r.token)) byToken.set(r.token, []); byToken.get(r.token)!.push(r); }
  for (const d of devices) {
    const rows = byToken.get(d.token) || [];
    const warned = rows.filter((r: any) => ["here", "home", "work", "update"].includes(r.matched));
    if (!warned.length) continue;
    if (warned.some((r: any) => active.has(r.alert_id))) continue;
    const ended = warned.filter((r: any) => !done.has("clear:" + r.alert_id + "|" + d.token));
    if (!ended.length) continue;
    let covered = false;
    for (const f of warnings) { const a = await areaFor(f); if (a && spotsOf(d).some(([, s]) => inGeo([+s.lng, +s.lat], a))) { covered = true; break; } }
    if (covered) continue;
    // the newest warning notification is the one to replace
    const first = [...ended].reverse().find((r: any) => r.matched !== "update") || ended[ended.length - 1];
    // the county names, from the original warning
    let areaDesc = "";
    const ar = await fetch("https://api.weather.gov/alerts/" + encodeURIComponent(first.alert_id), { headers: { "User-Agent": UA, Accept: "application/geo+json" } }).catch(() => null);
    if (ar && ar.ok) areaDesc = String((await ar.json()).properties?.areaDesc || "");
    const short = areaDesc.split(";").map((s) => s.trim()).filter(Boolean).slice(0, 3).join(", ");
    const ok = await push(d, {
      notification: { title: "Tornado Warning Ended", body: "The Tornado Warning" + (short ? " for " + short : " for your area") + " has ended. Storms may continue, so stay alert." },
      data: { kind: "tornado-clear", alert_id: first.alert_id, area: short },
      android: { priority: "high", ttl: "3600s", notification: { channel_id: "tornado-updates", sound: "default", tag: first.alert_id } },
    }, { alert_id: "clear:" + first.alert_id, matched: "clear" });
    if (ok) {
      cleared++;
      for (const r of ended) if (r.alert_id !== first.alert_id) { await db.from("alert_pushes").insert({ alert_id: "clear:" + r.alert_id, token: d.token, matched: "clear" }); done.add("clear:" + r.alert_id + "|" + d.token); }
    } else failed++;
  }
  return Response.json({ alerts: alerts.length, devices: devices.length, sent, cleared, failed });
});
