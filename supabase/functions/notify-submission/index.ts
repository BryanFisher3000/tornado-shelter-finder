// Emails the Survive-A-Storm team about new app/website submissions (add, report, feedback).
// Two ways to call it, both POST:
//   { "digest": true }  one email listing every submission not emailed yet (pg_cron calls this
//                       once a day, see supabase/digest.sql). Sends nothing when there is nothing new.
//   { "id": 123 }       one email for that submission only (the old per-submission email).
// It reads the rows itself with the service role and marks them sent (notified_at) before
// sending, so a stray call can't send anything twice or anything that isn't a real submission.
// Secrets: RESEND_API_KEY (required). NOTIFY_TO / NOTIFY_FROM / REVIEW_URL are optional overrides.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TO = (Deno.env.get("NOTIFY_TO") ?? "app@survive-a-storm.com").split(",").map((s) => s.trim()).filter(Boolean);
const FROM = Deno.env.get("NOTIFY_FROM") ?? "Tornado Shelter Finder <app@survive-a-storm.com>";
const REVIEW_URL = Deno.env.get("REVIEW_URL") ?? "https://survive-a-storm.com/tornado-shelter-finder/review/";

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
  if (v === "yes") return "Yes"; if (v === "no") return "No"; if (v === "unknown" || v == null || v === "") return "Unknown";
  if (v === "always") return "Year-Round"; if (v === "emergencies_only") return "During Emergencies"; if (v === "county_activated") return "When the County Opens It";
  return String(v);
}

const CO_LABELS: Record<string, string> = { agency: "Agency", director: "Director", phone: "Phone", email: "Email", address: "Address", website: "Website" };

type Row = [string, string];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describe(s: any): { title: string; rows: Row[] } {
  const who = s.submitter ? `${s.submitter.first_name ?? ""} ${s.submitter.last_name ?? ""}`.trim() : "";
  const rows: Row[] = [];
  let title = "";
  if (s.kind === "add" && s.proposed_shelter) {
    const p = s.proposed_shelter, a = p.address ?? {};
    title = `New shelter: ${p.name} (${a.city ?? ""}, ${a.state ?? ""})`;
    rows.push(["Shelter", p.name], ["Address", [a.street, a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")],
      ["Map pin", p.location ? `${Number(p.location.lat).toFixed(5)}, ${Number(p.location.lng).toFixed(5)}` : "Not set"],
      ["Capacity", p.capacity_label ?? "Unknown"], ["Wheelchair Accessible", show(p.ada_accessible)],
      ["Pets Allowed", show(p.pets_allowed)], ["Open", show(p.availability)]);
  } else if (s.kind === "report") {
    title = `Suggested edit: ${(s.shelter_label ?? "").split(" — ")[0] || "shelter " + s.shelter_id}`;
    if (s.shelter_label) rows.push(["Shelter", s.shelter_label]);
    rows.push(["Shelter ID", `${s.shelter_id} (version ${s.base_version ?? "?"})`],
      ["Issues", (s.report_reasons ?? []).map((r: string) => REASONS[r] ?? r).join("; ") || "None selected"]);
    for (const [k, v] of Object.entries(s.proposed_changes ?? {})) rows.push([`Change ${LABELS[k] ?? k}`, show(v)]);
  } else if (s.kind === "county") {
    title = `County contact correction: ${s.shelter_label || "county " + (s.county_id ?? "?")}`;
    if (s.shelter_label) rows.push(["County", s.shelter_label]);
    for (const [k, v] of Object.entries(s.proposed_changes ?? {})) rows.push([`Change ${CO_LABELS[k] ?? k}`, show(v)]);
  } else {
    title = s.channel === "website-form" ? "Website form message" : "App feedback";
  }
  if (who) title += ` from ${who}`;
  rows.push(["Comments", s.comment || "(none)"]);
  if (s.submitter) {
    const m = s.submitter;
    rows.push(["Submitted by", `${who}${m.auth_provider ? ` (signed in with ${m.auth_provider})` : ""}`], ["Email", m.email ?? ""]);
    if (m.phone) rows.push(["Phone", m.phone]);
    if (m.city) rows.push(["From", `${m.city}${m.state ? ", " + m.state : ""}`]);
  } else rows.push(["Submitted by", "Not signed in"]);
  rows.push(["Sent from", `${s.submitter_device ?? ""} (${s.channel ?? ""})`], ["Submission #", String(s.id)]);
  return { title, rows };
}

function table(rows: Row[]) {
  return `<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join("")}</table>`;
}
function reviewLink(id: number) {
  return `<a href="${esc(REVIEW_URL)}#${id}">Review #${id}</a>`;
}
function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

async function send(key: string, subject: string, html: string, text: string, replyTo?: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: TO, subject, html, text, reply_to: replyTo || undefined }),
  });
  return r.ok ? null : `resend ${r.status}: ${await r.text()}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return new Response("bad body", { status: 400 }); }
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return new Response("RESEND_API_KEY not set", { status: 503 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date().toISOString();

  if (body?.digest === true) {
    // claim everything not emailed yet, so two runs can't both send it
    const { data: subs, error } = await db.from("submissions").update({ notified_at: now })
      .is("notified_at", null).select("*").order("created_at", { ascending: true });
    if (error) return new Response(error.message, { status: 500 });
    if (!subs || !subs.length) return new Response("nothing new", { status: 200 });
    const n = (k: string) => subs.filter((s) => s.kind === k).length;
    const parts = [n("add") && plural(n("add"), "new shelter", "new shelters"), n("report") && plural(n("report"), "edit", "edits"), n("county") && plural(n("county"), "county contact", "county contacts"),
      n("general") && plural(n("general"), "feedback", "feedback")].filter(Boolean).join(", ");
    const subject = `Shelter Finder: ${plural(subs.length, "new submission", "new submissions")} (${parts})`;
    const items = subs.map((s) => ({ s, d: describe(s) }));
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
<h2 style="margin:0 0 4px">${esc(plural(subs.length, "new submission", "new submissions"))}</h2>
<p style="margin:0 0 16px;color:#666">${esc(parts)} since the last digest. <a href="${esc(REVIEW_URL)}">Open the review page</a></p>
${items.map(({ s, d }) => `<div style="border-top:1px solid #ddd;padding:12px 0"><h3 style="margin:0 0 8px;font-size:16px">${esc(d.title)}</h3>${table(d.rows)}<p style="margin:8px 0 0">${reviewLink(s.id)}</p></div>`).join("\n")}
</div>`;
    const text = `${subs.length} new submissions (${parts}). Review page: ${REVIEW_URL}\n\n` +
      items.map(({ s, d }) => `== ${d.title} ==\n${d.rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\nReview: ${REVIEW_URL}#${s.id}`).join("\n\n");
    const err = await send(key, subject, html, text);
    if (err) {
      // let tomorrow's run (or a retry) send them
      await db.from("submissions").update({ notified_at: null }).in("id", subs.map((s) => s.id)).eq("notified_at", now);
      return new Response(err, { status: 502 });
    }
    return new Response(`sent digest of ${subs.length}`, { status: 200 });
  }

  const id = Number(body?.id);
  if (!Number.isFinite(id)) return new Response("bad id", { status: 400 });
  // claim the row first so two calls can't both send
  const { data: s, error } = await db.from("submissions").update({ notified_at: now })
    .eq("id", id).is("notified_at", null).select("*").maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!s) return new Response("already sent or not found", { status: 200 });
  const d = describe(s);
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
<h2 style="margin:0 0 12px">${esc(d.title)}</h2>${table(d.rows)}
<p style="margin-top:16px">${reviewLink(s.id)}</p></div>`;
  const err = await send(key, d.title, html, d.rows.map(([k, v]) => `${k}: ${v}`).join("\n"), s.submitter?.email);
  if (err) {
    await db.from("submissions").update({ notified_at: null }).eq("id", id);
    return new Response(err, { status: 502 });
  }
  return new Response("sent", { status: 200 });
});
