// Emails the Survive-A-Storm team about each new app/website submission (add, report, feedback).
// Called by the database (pg_net trigger on public.submissions) with just { id }.
// It reads the row itself with the service role and only sends once (notified_at), so a stray
// call can't send anything that isn't a real, not-yet-sent submission.
// Secrets: RESEND_API_KEY (required). NOTIFY_TO / NOTIFY_FROM are optional overrides.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TO = (Deno.env.get("NOTIFY_TO") ?? "app@survive-a-storm.com").split(",").map((s) => s.trim()).filter(Boolean);
const FROM = Deno.env.get("NOTIFY_FROM") ?? "Tornado Shelter Finder <onboarding@resend.dev>";
const REVIEW_URL = "https://supabase.com/dashboard/project/svptjcclszprsmjoldaz/editor";

const REASONS: Record<string, string> = {
  address_wrong: "Address is wrong",
  no_shelter: "No shelter at this location",
  not_public: "Not a public shelter",
};
const LABELS: Record<string, string> = {
  capacity_label: "Capacity", ada_accessible: "Wheelchair Accessible", pets_allowed: "Pets Allowed", availability: "Open",
};

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function show(v: unknown) {
  if (v === "yes") return "Yes"; if (v === "no") return "No"; if (v === "unknown" || v == null || v === "") return "Not sure";
  if (v === "always") return "Year-Round"; if (v === "emergencies_only") return "During Emergencies";
  return String(v);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let id: number;
  try { id = Number((await req.json()).id); } catch { return new Response("bad body", { status: 400 }); }
  if (!Number.isFinite(id)) return new Response("bad id", { status: 400 });
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return new Response("RESEND_API_KEY not set", { status: 503 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // claim the row first so two calls can't both send
  const { data: s, error } = await db.from("submissions").update({ notified_at: new Date().toISOString() })
    .eq("id", id).is("notified_at", null).select("*").maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!s) return new Response("already sent or not found", { status: 200 });

  const who = s.submitter ? `${s.submitter.first_name ?? ""} ${s.submitter.last_name ?? ""}`.trim() : "";
  const rows: [string, string][] = [];
  let subject = "";
  if (s.kind === "add" && s.proposed_shelter) {
    const p = s.proposed_shelter, a = p.address ?? {};
    subject = `New shelter: ${p.name} (${a.city ?? ""}, ${a.state ?? ""})`;
    rows.push(["Shelter", p.name], ["Address", [a.street, a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")],
      ["Map pin", p.location ? `${p.location.lat.toFixed(5)}, ${p.location.lng.toFixed(5)}` : "Not set"],
      ["Capacity", p.capacity_label ?? "Not sure"], ["Wheelchair Accessible", show(p.ada_accessible)],
      ["Pets Allowed", show(p.pets_allowed)], ["Open", show(p.availability)]);
  } else if (s.kind === "report") {
    subject = `Suggested edit: ${(s.shelter_label ?? "").split(" — ")[0] || "shelter " + s.shelter_id}`;
    if (s.shelter_label) rows.push(["Shelter", s.shelter_label]);
    rows.push(["Shelter ID", `${s.shelter_id} (version ${s.base_version ?? "?"})`],
      ["Issues", (s.report_reasons ?? []).map((r: string) => REASONS[r] ?? r).join("; ") || "None selected"]);
    for (const [k, v] of Object.entries(s.proposed_changes ?? {})) rows.push([`Change ${LABELS[k] ?? k}`, show(v)]);
  } else {
    subject = "App feedback";
  }
  if (who) subject += ` from ${who}`;
  rows.push(["Comments", s.comment || "(none)"]);
  if (s.submitter) {
    const m = s.submitter;
    rows.push(["Submitted by", `${who}${m.auth_provider ? ` (signed in with ${m.auth_provider})` : ""}`], ["Email", m.email ?? ""]);
    if (m.phone) rows.push(["Phone", m.phone]);
    if (m.city) rows.push(["From", `${m.city}${m.state ? ", " + m.state : ""}`]);
  } else rows.push(["Submitted by", "Not signed in"]);
  rows.push(["Sent from", `${s.submitter_device ?? ""} (${s.channel ?? ""})`], ["Submission #", String(s.id)]);

  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
<h2 style="margin:0 0 12px">${esc(subject)}</h2>
<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join("")}</table>
<p style="margin-top:16px"><a href="${REVIEW_URL}">Open submissions in Supabase</a></p></div>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: TO, subject, html, text, reply_to: s.submitter?.email || undefined }),
  });
  if (!r.ok) {
    // let a later retry send it
    await db.from("submissions").update({ notified_at: null }).eq("id", id);
    return new Response(`resend ${r.status}: ${await r.text()}`, { status: 502 });
  }
  return new Response("sent", { status: 200 });
});
