// SAS Shelter Review: the dashboard behind the [sas_shelter_review] shortcode.
// It talks only to this site's REST API (sas/v1), which checks the WordPress login on every
// request and calls Supabase from the server, so the page holds no database key.
(function () {
  "use strict";
  var CFG = window.SAS_REVIEW || {};

  var REASONS = { address_wrong: "Address is wrong", no_shelter: "No shelter at this location", not_public: "Not a public shelter" };
  var KIND_LABEL = { add: "Add", report: "Edit / report", county: "County contact", general: "Feedback" };
  var STATUS_LABEL = { pending: "Pending", in_review: "In review", needs_info: "Needs info", approved: "Approved", rejected: "Rejected", superseded: "Superseded" };
  var REJECT_REASONS = [["spam", "Spam or advertising"], ["wrong", "Information is wrong"], ["duplicate", "Duplicate of an existing shelter"], ["unverifiable", "Can't verify it"], ["other", "Other"]];
  // Fields a submission can carry, in the order the diff shows them.
  var FIELDS = [
    ["name", "Name"], ["street", "Address"], ["city", "City"], ["county", "County"], ["state", "State"], ["zip", "ZIP"],
    ["lat", "Latitude"], ["lng", "Longitude"], ["capacity_label", "Capacity"], ["ada_accessible", "Wheelchair accessible"],
    ["pets_allowed", "Pets allowed"], ["availability", "Open"], ["access", "Access"], ["notes", "Notes"]
  ];
  // Fields a county contact correction can carry.
  var CO_FIELDS = [["agency", "Office / agency"], ["director", "Director / coordinator"], ["phone", "Phone"], ["email", "Email"], ["address", "Office address"], ["website", "Website"]];
  var LABEL = {}; FIELDS.concat(CO_FIELDS).forEach(function (f) { LABEL[f[0]] = f[1]; });

  var S = { me: CFG.me || "", subs: [], byId: {}, coById: {}, near: {}, people: {}, shList: [], shSel: null, shHist: [], coList: [], coSel: null };
  var ui = { view: "queue", tab: "open", kind: "all", q: "", sel: null, act: null, subq: "", substatus: "all", busy: false,
    shq: "", shstate: "", shstatus: "all", coq: "", costate: "", comissing: false };
  var SH_STATUS = { active: "In the app", hidden: "Hidden", retired: "Closed" };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtDate(iso) { var d = new Date(iso); return d.toLocaleString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined, hour: "numeric", minute: "2-digit" }); }
  function age(iso) { var h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? Math.max(1, Math.round(h * 60)) + "m" : h < 48 ? Math.round(h) + "h" : Math.round(h / 24) + "d"; }
  function show(f, v) {
    if (v == null || v === "") return '<span class="empty-v">empty</span>';
    if (f === "ada_accessible" || f === "pets_allowed") return v === "yes" ? "Yes" : v === "no" ? "No" : "Unknown";
    if (f === "availability") return v === "always" ? "Year-round" : v === "emergencies_only" ? "During emergencies" : v === "county_activated" ? "When the county opens it" : esc(v);
    return esc(v);
  }
  function capMin(l) { var m = String(l || "").replace(/,/g, "").match(/\d+/); return m ? +m[0] : null; }
  function normAddr(a) { return String(a || "").toLowerCase().replace(/[.,#]/g, " ").replace(/\broad\b/g, "rd").replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave").replace(/\bdrive\b/g, "dr").replace(/\bhighway\b/g, "hwy").replace(/\s+/g, " ").trim(); }
  function normName(n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function miles(a1, o1, a2, o2) { var R = 3958.8, t = Math.PI / 180, dA = (a2 - a1) * t, dO = (o2 - o1) * t, x = Math.pow(Math.sin(dA / 2), 2) + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.pow(Math.sin(dO / 2), 2); return 2 * R * Math.asin(Math.sqrt(x)); }
  function isOpen(s) { return s.status === "pending" || s.status === "in_review" || s.status === "superseded"; }
  function isDecidable(s) { return isOpen(s) || s.status === "needs_info"; }
  function subById(id) { return S.subs.find(function (s) { return String(s.id) === String(id); }); }
  var toastT;
  function toast(m) { var t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3500); }

  // Put a shelters table row into the diff's field names.
  function flatShelter(r) {
    if (!r) return null;
    return { name: r.name, street: r.address_line, city: r.city, county: r.county, state: r.state, zip: r.zip, lat: r.lat != null ? String(r.lat) : "", lng: r.lng != null ? String(r.lng) : "",
      capacity_label: r.capacity_label, ada_accessible: r.ada_accessible, pets_allowed: r.pets_allowed, availability: r.availability, access: r.access, notes: r.notes };
  }
  function current(s) {
    if (s.kind === "county") return s.county_id ? S.coById[s.county_id] || null : null;
    return s.shelter_id ? S.byId[s.shelter_id] || null : null;
  }
  // The current record in the diff's field names (a county row already uses them).
  function curFlat(s) { var c = current(s); return s.kind === "county" ? c : flatShelter(c); }
  function proposed(s) {
    if (s.kind === "add" && s.proposed_shelter) {
      var p = s.proposed_shelter, a = p.address || {}, l = p.location || {};
      return { name: p.name, street: a.street, city: a.city, county: a.county, state: a.state, zip: a.zip, lat: l.lat != null ? String(l.lat) : "", lng: l.lng != null ? String(l.lng) : "",
        capacity_label: p.capacity_label, ada_accessible: p.ada_accessible, pets_allowed: p.pets_allowed, availability: p.availability };
    }
    return s.proposed_changes || {};
  }
  function changedFields(s) {
    var cur = curFlat(s) || {}, p = proposed(s);
    return (s.kind === "county" ? CO_FIELDS : FIELDS).map(function (f) { return f[0]; }).filter(function (k) { return k in p && String(p[k] == null ? "" : p[k]) !== String(cur[k] == null ? "" : cur[k]); });
  }
  function displayName(s) {
    if (s.kind === "add" && s.proposed_shelter) return s.proposed_shelter.name || "New shelter";
    if (s.kind === "county") return s.shelter_label || "County contact";
    var c = current(s); if (c) return c.name;
    if (s.shelter_label) return s.shelter_label.split(" — ")[0];
    return s.kind === "general" ? "App feedback" : "Shelter " + (s.shelter_id || "");
  }
  function displayLoc(s) {
    if (s.kind === "add" && s.proposed_shelter) { var a = s.proposed_shelter.address || {}; return [a.city, a.state].filter(Boolean).join(", "); }
    if (s.kind === "county") { var co = current(s); return co && co.agency ? co.agency : ""; }
    var c = current(s); if (c) return [c.city, c.state].filter(Boolean).join(", ");
    return s.kind === "general" ? (s.comment || "").slice(0, 40) : "";
  }
  function submitterName(s) { var m = s.submitter || {}; return [m.first_name, m.last_name].filter(Boolean).join(" "); }
  function submitterEmail(s) { return (s.submitter && s.submitter.email) || ""; }
  function personKey(s) { return s.submitter_id || submitterEmail(s).toLowerCase() || null; }
  function rejectReason(note) { var m = /^\[(\w+)\]\s*/.exec(note || ""); return m ? m[1] : ""; }
  function noteText(note) { return String(note || "").replace(/^\[(\w+)\]\s*/, ""); }

  function checks(s) {
    var out = [], cur = current(s), c = s.kind === "county" ? null : flatShelter(cur), p = proposed(s), ch = changedFields(s);
    if (s.kind === "county") {
      if (!s.county_id) out.push({ lvl: "fail", t: "Not linked to a county in the list", d: "Make the change in County contacts, then mark it handled" });
      else if (!cur) out.push({ lvl: "warn", t: "Loading the county's current details…", d: "" });
      else if (!ch.length) out.push({ lvl: "warn", t: "Nothing differs from the list", d: "The list may already have these details" });
      if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) out.push({ lvl: "fail", t: "The new email doesn't look right", d: p.email });
    }
    if (s.shelter_id && !cur && s.kind !== "add") out.push({ lvl: "fail", t: "Shelter " + s.shelter_id + " isn't in the shelter list", d: "There is nothing to change, so reject it or mark it handled" });
    if (cur && cur.status !== "active" && s.kind === "report") out.push({ lvl: "warn", t: "This shelter is " + (SH_STATUS[cur.status] || cur.status).toLowerCase() + " already", d: cur.hidden_reason || "It doesn't show in the app" });
    if (cur && s.base_version != null && cur.version > s.base_version) out.push({ lvl: "fail", t: "Shelter changed since this was sent (v" + s.base_version + " → v" + cur.version + ")", d: "Re-check against the current values" });
    if (s.kind === "add") {
      var dup = null, near = null, nearby = S.near[s.id];
      if (s.status !== "approved" && nearby) nearby.some(function (r) {
        if ((p.street && normAddr(r.address_line) === normAddr(p.street) && (!p.zip || r.zip === p.zip)) || (normName(r.name) === normName(p.name) && r.city === p.city)) { dup = r; return true; }
        if (!near && p.lat && miles(+p.lat, +p.lng, r.lat, r.lng) < 0.125) near = r;
        return false;
      });
      var where = function (r) { return [r.address_line, r.city, r.state].filter(Boolean).join(", ") + " (" + (SH_STATUS[r.status] || r.status).toLowerCase() + ")"; };
      if (s.status === "approved") out.push({ lvl: "ok", t: "Added to the shelter list", d: s.shelter_id ? "Shelter " + s.shelter_id : "" });
      else if (!p.lat || !p.lng) out.push({ lvl: "warn", t: "Couldn't check for duplicates", d: "There is no map pin to search near" });
      else if (!nearby) out.push({ lvl: "warn", t: "Checking for nearby shelters…", d: "" });
      else if (dup) out.push({ lvl: "fail", t: "Likely duplicate of " + dup.name, d: where(dup) });
      else if (near) out.push({ lvl: "warn", t: "Another shelter is within 200 m", d: near.name + ", " + where(near) });
      else out.push({ lvl: "ok", t: "No matching shelter nearby", d: "Checked names, addresses and pins within about 2 km, hidden ones included" });
      if (!p.lat || !p.lng) out.push({ lvl: "warn", t: "No map pin", d: "Needs coordinates before it can show on the map" });
      var bad = [];
      if (!p.street) bad.push("address"); if (p.state && !/^[A-Z]{2}$/.test(p.state)) bad.push("state"); if (p.zip && !/^\d{5}$/.test(p.zip)) bad.push("ZIP");
      out.push(bad.length ? { lvl: "fail", t: "Missing or invalid: " + bad.join(", "), d: "" } : { lvl: "ok", t: "Address fields look complete", d: "" });
    }
    if (c && ch.indexOf("capacity_label") >= 0 && capMin(c.capacity_label)) {
      var a0 = capMin(c.capacity_label), b0 = capMin(p.capacity_label);
      if (b0 != null) { var pct = Math.round((b0 - a0) / a0 * 100); out.push({ lvl: Math.abs(pct) >= 50 ? "warn" : "ok", t: "Capacity " + (pct > 0 ? "+" : "") + pct + "%", d: c.capacity_label + " → " + p.capacity_label }); }
    }
    if (s.kind === "report" && (s.report_reasons || []).indexOf("no_shelter") >= 0) {
      var n = S.subs.filter(function (o) { return o.shelter_id === s.shelter_id && (o.report_reasons || []).indexOf("no_shelter") >= 0 && o.status !== "rejected"; }).length;
      out.push({ lvl: "warn", t: n > 1 ? n + " separate \"no shelter\" reports" : "Says there's no shelter here", d: (n > 1 ? "Independent reports agree. " : "") + "Approving hides it from the app" });
    }
    if (s.kind === "report" && !ch.length && !(s.report_reasons || []).length) out.push({ lvl: "warn", t: "No changes or problems selected", d: "Only a comment" });
    var k = personKey(s), hist = k ? S.people[k] : null;
    if (!s.submitter) out.push({ lvl: "warn", t: "Sent without signing in", d: "No name or email, so you can't follow up" });
    else if (hist && hist.rejected > hist.approved) out.push({ lvl: "warn", t: "This person has more rejections than approvals", d: hist.approved + " approved, " + hist.rejected + " rejected" });
    if (!s.comment && s.kind !== "general") out.push({ lvl: "warn", t: "No source or explanation given", d: "" });
    return out;
  }
  function flagLevel(s) { var c = checks(s); return c.some(function (x) { return x.lvl === "fail"; }) ? "fail" : c.some(function (x) { return x.lvl === "warn"; }) ? "warn" : "ok"; }

  // ---------- data ----------
  // Load the shelters the submissions point at (any status), 100 ids per request.
  function loadShelters(ids) {
    ids = ids.filter(function (id, i) { return id && ids.indexOf(id) === i; });
    var chunks = []; for (var i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    return Promise.all(chunks.map(function (c) { return api("GET", "shelters?ids=" + encodeURIComponent(c.join(","))); })).then(function (rs) {
      rs.forEach(function (d) { (d.shelters || []).forEach(function (r) { S.byId[r.id] = r; }); });
    });
  }
  function loadNear(s) {
    var p = proposed(s);
    if (s.kind !== "add" || !p.lat || !p.lng || S.near[s.id]) return;
    S.near[s.id] = null;
    api("GET", "shelters?near=" + encodeURIComponent(p.lat + "," + p.lng)).then(function (d) { S.near[s.id] = d.shelters || []; if (String(ui.sel) === String(s.id)) renderDetail(); renderQueue(); })
      .catch(function () { delete S.near[s.id]; });
  }
  function api(method, path, body) {
    return fetch(CFG.api + path, {
      method: method, credentials: "same-origin",
      headers: { "X-WP-Nonce": CFG.nonce, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(r.status === 401 || r.status === 403 ? "Your WordPress sign-in has expired. Reload the page." : d.message || "HTTP " + r.status); e.code = d.code; e.status = r.status; throw e; }
        return d;
      });
    });
  }
  function loadSubs() {
    return api("GET", "submissions").then(function (d) {
      if (d.me) S.me = d.me;
      S.subs = d.submissions || [];
      S.people = {};
      S.subs.forEach(function (s) { var k = personKey(s); if (!k) return; var p = S.people[k] = S.people[k] || { approved: 0, rejected: 0, total: 0 }; p.total++; if (s.status === "approved") p.approved++; if (s.status === "rejected") p.rejected++; });
      var coIds = S.subs.map(function (s) { return s.county_id; }).filter(function (id, i, a) { return id && a.indexOf(id) === i; });
      return Promise.all([
        loadShelters(S.subs.map(function (s) { return s.shelter_id; })).catch(function () { toast("Couldn't load the shelters these submissions point at"); }),
        coIds.length ? api("GET", "counties?ids=" + coIds.slice(0, 200).join(",")).then(function (d) { (d.counties || []).forEach(function (r) { S.coById[r.id] = r; }); }).catch(function () { toast("Couldn't load the counties these corrections point at"); }) : null
      ]);
    });
  }
  function refresh(quiet) {
    return loadSubs().then(function () { render(); if (!quiet) toast("Up to date"); }).catch(function (e) { toast("Couldn't load submissions: " + (e.message || e)); });
  }
  // action: claim, takeover, approve, reject, request_info or reopen. The server sets the status, reviewer and time.
  function update(s, action, extra, msg) {
    if (ui.busy) return Promise.resolve();
    ui.busy = true;
    return api("POST", "submissions/" + s.id, Object.assign({ action: action }, extra || {})).then(function (d) {
      ui.busy = false;
      if (d.submission) Object.assign(s, d.submission);
      if (d.shelter) S.byId[d.shelter.id] = d.shelter;
      if (msg) toast(msg);
      return loadSubs().then(render).then(function () { return true; });
    }).catch(function (e) {
      ui.busy = false;
      // The shelter changed after the person saw it: show the current values and let the reviewer decide.
      if (e.code === "sas_changed" && action === "approve" && !(extra && extra.force)) {
        return loadShelters([s.shelter_id]).then(function () {
          render();
          if (window.confirm(e.message + "\n\nApply the proposed values over the current ones?")) return update(s, action, Object.assign({}, extra, { force: true }), msg);
          return false;
        });
      }
      toast("Not saved: " + (e.message || e)); render(); return false;
    });
  }

  // ---------- start ----------
  function boot() {
    if (!CFG.keySet) { $("detail").innerHTML = '<div class="qempty" style="padding:40px 20px">The Supabase secret key is not set yet. Add <code>SAS_SUPABASE_SECRET_KEY</code> to wp-config.php, then reload.</div>'; return; }
    loadSubs().then(function () {
      var h = location.hash.slice(1);
      if (/^\d+$/.test(h) && subById(h)) openSub(h); else render();
    }).catch(function (e) { $("detail").innerHTML = '<div class="qempty" style="padding:40px 20px">Could not load submissions: ' + esc(e.message || e) + "</div>"; });
  }
  function myName() { return String(S.me).replace(/\s*\(.*\)$/, "") || "Survive-A-Storm"; }
  function mine(s) { return !!s.reviewed_by && s.reviewed_by === S.me; }

  // ---------- render ----------
  function render() {
    $("keys").hidden = ui.view !== "queue";
    ["queue", "subs", "shelters", "counties"].forEach(function (v) { $("view-" + v).hidden = ui.view !== v; var b = document.querySelector('[data-view="' + v + '"]'); if (b) b.setAttribute("aria-pressed", ui.view === v); });
    renderStats();
    if (ui.view === "queue") { renderQueue(); renderDetail(); } else if (ui.view === "subs") renderSubs(); else if (ui.view === "shelters") renderShelters(); else renderCounties();
  }
  function renderStats() {
    var open = S.subs.filter(isOpen), oldest = open.reduce(function (o, s) { return !o || new Date(s.created_at) < new Date(o.created_at) ? s : o; }, null);
    var approved = S.subs.filter(function (s) { return s.status === "approved" && s.kind !== "general"; }).length;
    $("stats").innerHTML = [[open.length, "in queue"], [open.filter(function (s) { return flagLevel(s) === "fail"; }).length, "need a closer look"], [oldest ? age(oldest.created_at) : "–", "oldest wait"], [approved, "approved"]]
      .map(function (x) { return '<div class="stat"><b>' + x[0] + "</b><span>" + x[1] + "</span></div>"; }).join("");
  }
  function filtered() {
    var tabs = { open: isOpen, needs_info: function (s) { return s.status === "needs_info"; }, resolved: function (s) { return s.status === "approved" || s.status === "rejected"; } };
    var q = ui.q.trim().toLowerCase();
    return S.subs.filter(tabs[ui.tab]).filter(function (s) { return ui.kind === "all" || s.kind === ui.kind; })
      .filter(function (s) { return !q || [displayName(s), displayLoc(s), submitterName(s), submitterEmail(s), s.id, s.shelter_id, s.comment].join(" ").toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return ui.tab === "resolved" ? new Date(b.created_at) - new Date(a.created_at) : new Date(a.created_at) - new Date(b.created_at); });
  }
  function statusChip(s) {
    var who = s.status === "in_review" && s.reviewed_by ? (mine(s) ? " · you" : " · " + esc(String(s.reviewed_by).replace(/\s*\(.*\)$/, ""))) : "";
    return '<span class="status ' + s.status + '">' + STATUS_LABEL[s.status] + who + "</span>";
  }
  function renderQueue() {
    var counts = { open: 0, needs_info: 0, resolved: 0 };
    S.subs.forEach(function (s) { if (isOpen(s)) counts.open++; else if (s.status === "needs_info") counts.needs_info++; else counts.resolved++; });
    $("qtabs").innerHTML = [["open", "Queue"], ["needs_info", "Needs info"], ["resolved", "Resolved"]].map(function (t) { return '<button data-tab="' + t[0] + '" aria-pressed="' + (ui.tab === t[0]) + '">' + t[1] + '<span class="n">' + counts[t[0]] + "</span></button>"; }).join("");
    $("chips").innerHTML = [["all", "All kinds"], ["add", "Adds"], ["report", "Edits / reports"], ["county", "County contacts"], ["general", "Feedback"]].map(function (k) { return '<button class="chip" data-kind="' + k[0] + '" aria-pressed="' + (ui.kind === k[0]) + '">' + k[1] + "</button>"; }).join("");
    var list = filtered();
    $("qlist").innerHTML = list.length ? list.map(function (s) {
      var lvl = isDecidable(s) ? flagLevel(s) : "ok", n = checks(s).filter(function (c) { return c.lvl === lvl; }).length;
      return '<li><button class="qitem" data-sel="' + s.id + '" aria-current="' + (String(ui.sel) === String(s.id)) + '"><span class="nm">' + esc(displayName(s)) + '</span><span class="age">' + age(s.created_at) + "</span>" +
        '<span class="meta"><span class="type ' + s.kind + '">' + KIND_LABEL[s.kind] + '</span><span class="loc">' + esc(displayLoc(s)) + "</span>" + (lvl !== "ok" ? '<span class="flagdot ' + lvl + '">' + n + "</span>" : "") + "</span>" +
        (s.status !== "pending" ? '<span class="meta">' + statusChip(s) + "</span>" : "") + "</button></li>";
    }).join("") : '<li class="qempty">' + (ui.tab === "open" ? "Queue is clear. Nothing waiting for review." : "Nothing here.") + "</li>";
  }
  function renderDetail() {
    var s = subById(ui.sel);
    $("view-queue").classList.toggle("has-sel", !!s);
    if (s) loadNear(s);
    if (!s) { $("detail").innerHTML = '<div class="qempty" style="padding:60px 20px">Pick a submission from the queue to compare it with the shelter list.</div>'; $("side").innerHTML = ""; return; }
    var cur = current(s), c = curFlat(s) || {}, p = proposed(s), ch = changedFields(s), isCo = s.kind === "county";
    var rows = ch.map(function (k) { return '<tr class="chg"><td class="f">' + LABEL[k] + "<small>" + k + '</small></td><td class="old">' + (cur ? '<span class="v">' + show(k, c[k]) + "</span>" : '<span class="empty-v">not in list yet</span>') + '</td><td class="new"><span class="v">' + show(k, p[k]) + "</span></td></tr>"; }).join("");
    var lat = p.lat || c.lat, lng = p.lng || c.lng;
    var links = [];
    if (lat && lng) links.push('<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + "," + lng) + '" target="_blank" rel="noopener">' + (s.kind === "add" ? "Proposed pin" : "Shelter pin") + " in Google Maps</a>");
    var street = p.street || c.street;
    if (street) links.push('<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([street, p.city || c.city, p.state || c.state, p.zip || c.zip].join(" ")) + '" target="_blank" rel="noopener">Look up the address</a>');
    var addr = isCo ? [] : s.kind === "add" ? [p.street, p.city, p.state, p.zip] : cur ? [c.street, c.city, c.county && c.county + " County", c.state, c.zip] : [s.shelter_label && s.shelter_label.split(" — ")[1]];
    $("detail").innerHTML = '<div class="detail-h"><button class="back" id="back">← Queue</button>' +
      '<div class="row"><span class="type ' + s.kind + '">' + KIND_LABEL[s.kind] + "</span>" + statusChip(s) + '<span class="mono" style="color:var(--muted)">#' + s.id + (s.shelter_id ? " · shelter " + esc(s.shelter_id) + (s.base_version != null ? " v" + s.base_version : "") : "") + "</span></div>" +
      "<h1>" + esc(displayName(s)) + '</h1><div class="sub">' + (esc(addr.filter(Boolean).join(", ")) || "&nbsp;") + (cur && !isCo ? ' · <span class="vchip ' + esc(cur.verification_status) + '">' + esc(String(cur.verification_status).replace(/_/g, " ")) + "</span>" + (cur.status !== "active" ? ' <span class="status rejected">' + esc(SH_STATUS[cur.status] || cur.status) + "</span>" : "") + ' <button class="linkish" data-shelter="' + esc(cur.id) + '">Open in Shelters</button>' : "") + "</div>" +
      ((s.report_reasons || []).length ? '<div class="row">' + s.report_reasons.map(function (r) { return '<span class="rchip">' + esc(REASONS[r] || r) + "</span>"; }).join("") + "</div>" : "") + "</div>" +
      (s.comment ? '<div class="comment"><div class="who">' + esc(submitterName(s) || "Submitter") + " wrote, " + fmtDate(s.created_at) + "</div>" + esc(s.comment) + "</div>" : "") +
      '<div class="diffwrap">' + (s.kind === "general" ? '<p class="fine">General feedback. There are no shelter changes to apply.</p>' :
        '<div class="diffbar"><h3>' + (s.kind === "add" ? "Proposed shelter" : "Current vs. proposed") + '</h3><span class="hint">' + ch.length + " field" + (ch.length === 1 ? "" : "s") + "</span></div>" +
        (rows ? '<div class="tablewrap"><table class="diff"><thead><tr><th>Field</th><th>' + (cur && !isCo ? "In the list now (v" + cur.version + ")" : "In the list now") + "</th><th>Proposed</th></tr></thead><tbody>" + rows + "</tbody></table></div>" : '<p class="fine">No field changes, only the problems marked above.</p>')) +
      '<div class="geo">' + links.join("") + "</div></div>";
    renderSide(s);
  }
  function renderSide(s) {
    var cs = checks(s), icon = { ok: "✓", warn: "!", fail: "×" }, email = submitterEmail(s), k = personKey(s), hist = k ? S.people[k] : null;
    var lockedByOther = s.status === "in_review" && s.reviewed_by && !mine(s);
    var decide;
    if (lockedByOther) decide = '<div class="resolved-box"><div>' + esc(s.reviewed_by) + ' claimed this ' + (s.reviewed_at ? age(s.reviewed_at) + " ago" : "") + '.</div><button class="reopen" id="takeover">Take over review</button></div>';
    else if (isDecidable(s)) {
      var a = ui.act, btn = function (key, l, kb, dis) { return '<button data-act="' + key + '" aria-pressed="' + (a === key) + '"' + (dis ? ' disabled title="No email to send a question to"' : "") + ">" + l + "<kbd>" + kb + "</kbd></button>"; };
      var body = "";
      var gone = (s.report_reasons || []).some(function (r) { return r === "no_shelter" || r === "not_public"; });
      var wrongAddr = (s.report_reasons || []).indexOf("address_wrong") >= 0;
      var what = s.kind === "add" ? "Adds this shelter to the list, so it shows in the app." : s.kind === "general" ? "Marks the feedback as handled." :
        s.kind === "county" ? (changedFields(s).length ? "Updates this county's contact details. The public county page shows them right away." : "Marks it approved. There is nothing to change in the county list.") :
        [changedFields(s).length ? "Updates the shelter with the proposed values." : "", gone ? "Hides the shelter from the app." : "", wrongAddr ? "Fix the address yourself afterwards in Shelters; the submitter didn't send a new one." : "",
          !changedFields(s).length && !gone && !wrongAddr ? "Marks it approved. There is nothing to change in the shelter." : ""].filter(Boolean).join(" ");
      if (a === "approve") body = '<div class="summary">' + what + " It's saved with your WordPress name and can be undone from the shelter's history.</div>" + '<label for="note">Review note (internal)<textarea id="note" placeholder="e.g. Checked against the county shelter list"></textarea></label>';
      if (a === "request_info") body = '<label for="note">Question for ' + esc(email) + '<textarea id="note" placeholder="Say what\'s missing or needs a source"></textarea></label><div class="summary">Opens your email app with the question, and moves this to Needs info.</div>';
      if (a === "reject") body = '<label for="reason">Reason<select id="reason"><option value="">Choose a reason</option>' + REJECT_REASONS.map(function (r) { return '<option value="' + r[0] + '">' + r[1] + "</option>"; }).join("") + '</select></label><label for="note">Review note (internal)<textarea id="note" placeholder="Optional unless the reason is Other"></textarea></label>';
      var label = { approve: s.kind === "general" ? "Mark handled" : "Approve", request_info: "Email the question", reject: "Reject submission" }[a];
      decide = '<div class="decide"><div class="seg" role="group" aria-label="Decision">' + btn("approve", "Approve", "A") + btn("request_info", "Ask a question", "Q", !email) + btn("reject", "Reject", "R") + "</div>" + body +
        (a ? '<div class="err" id="err" hidden></div><button class="go" id="go">' + label + "</button>" : '<div class="summary">' + (s.status === "in_review" ? "You've claimed this item. " : "") + "Pick a decision. It's saved on the submission with your WordPress name and the time.</div>") + "</div>";
    } else {
      var rr = rejectReason(s.reviewer_note), rl = rr ? (REJECT_REASONS.find(function (x) { return x[0] === rr; }) || [, rr])[1] : "";
      decide = '<div class="resolved-box"><div>' + statusChip(s) + (s.reviewed_at ? " on " + fmtDate(s.reviewed_at) : "") + "</div>" + (rl || s.reviewer_note ? '<div style="color:var(--muted)">' + esc([rl, noteText(s.reviewer_note)].filter(Boolean).join(". ")) + "</div>" : "") + '<button class="reopen" id="reopen">Reopen for review</button></div>';
    }
    var m = s.submitter || {};
    $("side").innerHTML = '<section class="pane"><div class="pane-h"><h2>Decision</h2><span class="mono" style="color:var(--muted)">#' + s.id + "</span></div>" + decide + "</section>" +
      '<section class="pane"><div class="pane-h"><h2>Checks</h2></div><ul class="checks">' + cs.map(function (c) { return '<li class="' + c.lvl + '"><span class="ic">' + icon[c.lvl] + "</span><div>" + esc(c.t) + (c.d ? '<div class="d">' + esc(c.d) + "</div>" : "") + "</div></li>"; }).join("") + "</ul></section>" +
      '<section class="pane"><div class="pane-h"><h2>Submitter</h2><span class="mono" style="color:var(--muted)">' + esc(s.channel || "") + '</span></div><div class="who-card">' +
      (s.submitter ? '<div><span class="handle">' + esc(submitterName(s) || "No name") + "</span>" + (m.auth_provider ? ' <span style="color:var(--muted)">· signed in with ' + esc(m.auth_provider) + "</span>" : "") + "</div>" +
        '<div class="mono" style="user-select:all">' + esc(email) + "</div>" + (m.phone ? '<div class="mono">' + esc(m.phone) + "</div>" : "") + (m.city ? "<div>" + esc(m.city + (m.state ? ", " + m.state : "")) + "</div>" : "") : '<div style="color:var(--muted)">Not signed in, so there is no name or email.</div>') +
      '<div style="color:var(--muted);font-size:12.5px">' + esc(s.submitter_device || "") + "</div>" +
      (hist ? '<div class="trust"><div><b>' + hist.total + "</b><span>Sent</span></div><div><b>" + hist.approved + "</b><span>Approved</span></div><div><b>" + hist.rejected + "</b><span>Rejected</span></div></div>" : "") + "</div></section>" +
      '<section class="pane"><div class="pane-h"><h2>History</h2></div><ul class="timeline"><li class="submit"><div class="t">' + fmtDate(s.created_at) + '</div><div class="x">Sent from ' + esc(s.channel || "the app") + "</div></li>" +
      (s.notified_at ? '<li class="submit"><div class="t">' + fmtDate(s.notified_at) + '</div><div class="x">Email sent to the team</div></li>' : "") +
      (s.reviewed_at ? '<li class="' + (s.status === "approved" ? "approve" : s.status === "rejected" ? "reject" : s.status === "needs_info" ? "request_info" : "submit") + '"><div class="t">' + fmtDate(s.reviewed_at) + '</div><div class="x">' + STATUS_LABEL[s.status] + (s.reviewed_by ? " by " + (mine(s) ? "you" : esc(s.reviewed_by)) : "") + "</div>" + (s.reviewer_note ? '<div class="c">' + esc(noteText(s.reviewer_note)) + "</div>" : "") + "</li>" : "") + "</ul></section>";
  }
  function renderSubs() {
    var q = ui.subq.trim().toLowerCase();
    var list = S.subs.filter(function (s) { return ui.substatus === "all" || s.status === ui.substatus; })
      .filter(function (s) { return !q || [displayName(s), displayLoc(s), submitterName(s), submitterEmail(s), s.id, s.shelter_id, s.comment].join(" ").toLowerCase().indexOf(q) >= 0; });
    var chips = [["all", "All"]].concat(Object.keys(STATUS_LABEL).map(function (k) { return [k, STATUS_LABEL[k]]; })).map(function (x) { return '<button class="chip" data-substatus="' + x[0] + '" aria-pressed="' + (ui.substatus === x[0]) + '">' + x[1] + "</button>"; }).join("");
    $("subs-tools").innerHTML = chips;
    $("subs-count").textContent = list.length + " of " + S.subs.length;
    $("subs-body").innerHTML = list.map(function (s) {
      return '<tr><td class="when">' + fmtDate(s.created_at) + '<div class="mono">#' + s.id + '</div></td><td><span class="type ' + s.kind + '">' + KIND_LABEL[s.kind] + "</span></td>" +
        '<td><button class="linkish strong" data-open="' + s.id + '">' + esc(displayName(s)) + '</button><div class="mono" style="color:var(--muted)">' + esc(displayLoc(s)) + "</div></td><td>" + statusChip(s) + "</td>" +
        "<td>" + esc(submitterName(s) || "Not signed in") + '<div style="color:var(--muted);font-size:12.5px">' + esc(submitterEmail(s)) + "</div></td><td>" + (s.reviewed_at ? fmtDate(s.reviewed_at) : '<span class="empty-v">open</span>') + "</td></tr>";
    }).join("") || '<tr><td colspan="6" class="qempty">No submissions match.</td></tr>';
  }
  // ---------- Shelters tab: search, edit, hide and undo, straight in the shelter list ----------
  var EDIT_FIELDS = FIELDS.concat([["status", "Shown in the app"], ["hidden_reason", "Why hidden"]]);
  var CHOICES = {
    ada_accessible: [["yes", "Yes"], ["no", "No"], ["unknown", "Unknown"]],
    pets_allowed: [["yes", "Yes"], ["no", "No"], ["unknown", "Unknown"]],
    availability: [["emergencies_only", "During emergencies"], ["always", "Year-round"], ["county_activated", "When the county opens it"]],
    access: [["public", "Public"], ["registration_required", "Registration required"], ["restricted", "Restricted"]],
    status: [["active", "Yes, in the app"], ["hidden", "No, hidden"], ["retired", "No, closed"]]
  };
  function searchShelters() {
    S.shSearched = true;
    var qs = "shelters?q=" + encodeURIComponent(ui.shq) + "&state=" + encodeURIComponent(ui.shstate) + (ui.shstatus !== "all" ? "&status=" + ui.shstatus : "");
    $("sh-count").textContent = "Searching…";
    return api("GET", qs).then(function (d) { S.shList = d.shelters || []; S.shList.forEach(function (r) { S.byId[r.id] = r; }); renderShelters(); })
      .catch(function (e) { $("sh-count").textContent = ""; toast("Search failed: " + (e.message || e)); });
  }
  function openShelter(id) {
    ui.view = "shelters"; S.shSel = S.byId[id] || { id: id }; S.shHist = null; render();
    if (!S.shSearched) searchShelters();
    if (window.innerWidth < 1000) $("sh-edit").scrollIntoView({ block: "start" });
    return api("GET", "shelters/" + encodeURIComponent(id)).then(function (d) { S.byId[id] = S.shSel = d.shelter; S.shHist = d.history || []; renderShelters(); })
      .catch(function (e) { toast("Couldn't open the shelter: " + (e.message || e)); });
  }
  function renderShelters() {
    $("sh-tools").innerHTML = [["all", "All"], ["active", "In the app"], ["hidden", "Hidden"], ["retired", "Closed"]].map(function (x) { return '<button class="chip" data-shstatus="' + x[0] + '" aria-pressed="' + (ui.shstatus === x[0]) + '">' + x[1] + "</button>"; }).join("");
    $("sh-count").textContent = S.shList.length >= 200 ? "first 200, narrow the search" : S.shList.length + " found";
    $("sh-body").innerHTML = S.shList.map(function (r) {
      return '<tr' + (S.shSel && S.shSel.id === r.id ? ' class="cur"' : "") + '><td><button class="linkish strong" data-shpick="' + esc(r.id) + '">' + esc(r.name) + '</button><div class="mono" style="color:var(--muted)">' + esc(r.id) + "</div></td><td>" + esc([r.city, r.state].filter(Boolean).join(", ")) +
        '</td><td><span class="status ' + (r.status === "active" ? "approved" : "rejected") + '">' + esc(SH_STATUS[r.status] || r.status) + "</span></td><td>" + (r.updated_at ? fmtDate(r.updated_at) : "") + '<div style="color:var(--muted);font-size:12.5px">' + esc(String(r.updated_by || "").replace(/\s*\(.*\)$/, "")) + "</div></td></tr>";
    }).join("") || '<tr><td colspan="4" class="qempty">No shelters match.</td></tr>';
    var r = S.shSel;
    if (!r || !r.name) { $("sh-edit").innerHTML = '<div class="qempty" style="padding:40px 20px">' + (r ? "Loading…" : "Search, then pick a shelter to edit it, hide it or see its history.") + "</div>"; return; }
    var f = flatShelter(r); f.status = r.status; f.hidden_reason = r.hidden_reason;
    var input = function (k) {
      var v = f[k] == null ? "" : f[k];
      if (CHOICES[k]) return '<select data-f="' + k + '">' + CHOICES[k].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>";
      if (k === "notes" || k === "hidden_reason") return '<textarea data-f="' + k + '" rows="2">' + esc(v) + "</textarea>";
      return '<input data-f="' + k + '" value="' + esc(v) + '"' + (k === "lat" || k === "lng" ? ' inputmode="decimal"' : "") + ">";
    };
    var hist = S.shHist == null ? '<p class="fine">Loading history…</p>' : S.shHist.length ? '<ul class="timeline">' + S.shHist.map(function (h) {
      var changes = !h.old_row ? "Added" + (h.new_row && h.new_row.source ? " from " + esc(h.new_row.source) : "") : !h.new_row ? "Deleted" : diffRows(h.old_row, h.new_row);
      return '<li class="' + (h.old_row ? "submit" : "approve") + '"><div class="t">' + fmtDate(h.changed_at) + " · v" + (h.version + 1) + '</div><div class="x">' + changes + "</div>" +
        '<div class="c">' + esc(h.changed_by || "") + (h.submission_id ? ' · <button class="linkish" data-open="' + h.submission_id + '">submission #' + h.submission_id + "</button>" : "") + "</div>" +
        '<button class="reopen" data-undo="' + h.id + '">' + (h.old_row ? "Undo this change" : "Undo adding it (hides it)") + "</button></li>";
    }).join("") + "</ul>" : '<p class="fine">No changes yet.</p>';
    $("sh-edit").innerHTML = '<div class="detail-h"><div class="row"><span class="mono" style="color:var(--muted)">' + esc(r.id) + " · v" + r.version + (r.source ? " · " + esc(r.source) : "") + "</span></div><h1>" + esc(r.name) + '</h1><div class="geo"><a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.lat + "," + r.lng) + '" target="_blank" rel="noopener">Pin in Google Maps</a></div></div>' +
      '<div class="decide edit-grid">' + EDIT_FIELDS.map(function (x) { return '<label>' + x[1] + input(x[0]) + "</label>"; }).join("") + "</div>" +
      (r.evidence ? '<p class="fine" style="padding:0 16px">Evidence: ' + esc(r.evidence) + "</p>" : "") +
      '<div class="decide"><div class="err" id="sh-err" hidden></div><button class="go" id="sh-save">Save changes</button><div class="summary">Changes show in the app right away and are saved with your WordPress name.</div></div>' +
      '<section class="pane" style="margin:12px 16px"><div class="pane-h"><h2>History</h2></div>' + hist + "</section>";
  }
  function diffRows(a, b) {
    var cols = { name: "Name", address_line: "Address", city: "City", county: "County", state: "State", zip: "ZIP", lat: "Latitude", lng: "Longitude", capacity_label: "Capacity", ada_accessible: "Wheelchair", pets_allowed: "Pets", availability: "Open", access: "Access", notes: "Notes", status: "Shown", hidden_reason: "Why hidden" };
    var out = Object.keys(cols).filter(function (k) { return String(a[k] == null ? "" : a[k]) !== String(b[k] == null ? "" : b[k]); })
      .map(function (k) { return cols[k] + ": " + (a[k] == null || a[k] === "" ? "empty" : esc(a[k])) + " → " + (b[k] == null || b[k] === "" ? "empty" : esc(b[k])); });
    return out.length ? out.join("<br>") : "No visible change";
  }
  function saveShelter() {
    var r = S.shSel; if (!r || ui.busy) return;
    var f = flatShelter(r); f.status = r.status; f.hidden_reason = r.hidden_reason;
    var changes = {};
    document.querySelectorAll("#sh-edit [data-f]").forEach(function (el) { var k = el.dataset.f; if (String(el.value).trim() !== String(f[k] == null ? "" : f[k])) changes[k] = el.value.trim(); });
    var err = $("sh-err");
    if (!Object.keys(changes).length) { err.textContent = "Nothing changed."; err.hidden = false; return; }
    ui.busy = true;
    api("POST", "shelters/" + encodeURIComponent(r.id), { version: r.version, changes: changes }).then(function (d) {
      ui.busy = false; toast("Saved " + d.shelter.name); refreshShelter(d.shelter);
    }).catch(function (e) { ui.busy = false; err.textContent = e.message || String(e); err.hidden = false; });
  }
  function undoShelter(hid) {
    var r = S.shSel; if (!r || ui.busy) return;
    if (!window.confirm("Put this shelter back the way it was before that change?")) return;
    ui.busy = true;
    api("POST", "shelters/" + encodeURIComponent(r.id) + "/undo", { history_id: hid, version: r.version }).then(function (d) {
      ui.busy = false; toast("Undone. The undo is in the history too."); refreshShelter(d.shelter);
    }).catch(function (e) { ui.busy = false; toast("Not undone: " + (e.message || e)); });
  }
  function refreshShelter(row) {
    S.byId[row.id] = row;
    S.shList = S.shList.map(function (x) { return x.id === row.id ? row : x; });
    openShelter(row.id);
  }

  // ---------- County contacts tab ----------
  var CO_FIELDS = [["agency", "Agency"], ["director", "Director"], ["phone", "Phone"], ["email", "Email"], ["address", "Address"], ["website", "Website"], ["source_url", "Source"], ["source_date", "Source date"]];
  function searchCounties() {
    S.coSearched = true;
    $("co-count").textContent = "Searching…";
    return api("GET", "counties?q=" + encodeURIComponent(ui.coq) + "&state=" + encodeURIComponent(ui.costate) + (ui.comissing ? "&missing=1" : "")).then(function (d) {
      S.coList = d.counties || [];
      if (S.coSel) S.coSel = S.coList.find(function (c) { return c.id === S.coSel.id; }) || S.coSel;
      renderCounties();
    }).catch(function (e) { $("co-count").textContent = ""; toast("Search failed: " + (e.message || e)); });
  }
  function renderCounties() {
    $("co-count").textContent = S.coList.length >= 200 ? "first 200, narrow the search" : S.coList.length + " found";
    $("co-body").innerHTML = S.coList.map(function (c) {
      var empty = !c.agency && !c.director && !c.phone && !c.email;
      return '<tr' + (S.coSel && S.coSel.id === c.id ? ' class="cur"' : "") + '><td><button class="linkish strong" data-copick="' + c.id + '">' + esc(c.county) + ", " + esc(c.state) + "</button></td><td>" + (empty ? '<span class="empty-v">no contact yet</span>' : esc(c.agency || "") + '<div style="color:var(--muted);font-size:12.5px">' + esc(c.director || "") + "</div>") +
        '</td><td class="mono">' + esc(c.phone || "") + '<div>' + esc(c.email || "") + "</div></td></tr>";
    }).join("") || '<tr><td colspan="3" class="qempty">No counties match.</td></tr>';
    var c = S.coSel;
    if (!c) { $("co-edit").innerHTML = '<div class="qempty" style="padding:40px 20px">Pick a county to edit its emergency management contact.</div>'; return; }
    $("co-edit").innerHTML = '<div class="detail-h"><h1>' + esc(c.county) + " County, " + esc(c.state) + '</h1><div class="sub">' + (c.updated_by ? "Last changed by " + esc(c.updated_by) + (c.updated_at ? " on " + fmtDate(c.updated_at) : "") : "&nbsp;") + "</div></div>" +
      '<div class="decide edit-grid">' + CO_FIELDS.map(function (x) { return "<label>" + x[1] + '<input data-cf="' + x[0] + '" value="' + esc(c[x[0]] || "") + '"></label>'; }).join("") + "</div>" +
      '<div class="decide"><div class="err" id="co-err" hidden></div><button class="go" id="co-save">Save contact</button></div>';
  }
  function saveCounty() {
    var c = S.coSel; if (!c || ui.busy) return;
    var changes = {};
    document.querySelectorAll("#co-edit [data-cf]").forEach(function (el) { var k = el.dataset.cf; if (el.value.trim() !== String(c[k] || "")) changes[k] = el.value.trim(); });
    var err = $("co-err");
    if (!Object.keys(changes).length) { err.textContent = "Nothing changed."; err.hidden = false; return; }
    ui.busy = true;
    api("POST", "counties/" + c.id, { changes: changes }).then(function (d) {
      ui.busy = false; S.coSel = d.county; S.coList = S.coList.map(function (x) { return x.id === d.county.id ? d.county : x; }); renderCounties(); toast("Saved " + d.county.county + " County");
    }).catch(function (e) { ui.busy = false; err.textContent = e.message || String(e); err.hidden = false; });
  }
  // ---------- actions ----------
  function openSub(id) {
    var s = subById(id); if (!s) return;
    ui.view = "queue"; ui.tab = isOpen(s) ? "open" : s.status === "needs_info" ? "needs_info" : "resolved"; ui.kind = "all"; ui.q = ""; $("q").value = "";
    select(s.id);
  }
  function select(id) {
    ui.sel = id; ui.act = null;
    var s = subById(id);
    try { history.replaceState(null, "", "#" + id); } catch (e) {}
    render();
    // opening a pending item claims it, so two reviewers don't work the same one
    if (s && s.status === "pending") update(s, "claim");
  }
  function decide() {
    var s = subById(ui.sel); if (!s || !ui.act) return;
    var note = ($("note") && $("note").value.trim()) || "", reason = $("reason") ? $("reason").value : "", err = $("err");
    var fail = function (m) { err.textContent = m; err.hidden = false; };
    if (ui.act === "request_info" && !note) return fail("Write the question first.");
    if (ui.act === "reject" && !reason) return fail("Choose a reason.");
    if (ui.act === "reject" && reason === "other" && !note) return fail("Add a short note when the reason is Other.");
    var status = { approve: "approved", reject: "rejected", request_info: "needs_info" }[ui.act];

    if (ui.act === "request_info") {
      var subj = "About the shelter you sent: " + displayName(s);
      var body = "Hi" + (s.submitter && s.submitter.first_name ? " " + s.submitter.first_name : "") + ",\n\nThanks for your submission to the Tornado Shelter Finder.\n\n" + note + "\n\n" + myName() + "\nSurvive-A-Storm";
      location.href = "mailto:" + encodeURIComponent(submitterEmail(s)) + "?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(body);
    }
    var next = filtered().filter(function (x) { return x.id !== s.id && (x.status === "pending" || (x.status === "in_review" && mine(x))); })[0];
    update(s, ui.act, { note: note, reason: reason }, { approved: "Approved #" + s.id, rejected: "Rejected #" + s.id, needs_info: "Moved #" + s.id + " to Needs info" }[status]).then(function (ok) { if (!ok) return; if (next) select(next.id); else { ui.sel = null; render(); } });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("button"); if (!t) return;
    var d = t.dataset;
    if (t.id === "refresh") refresh();
    else if (d.view) { ui.view = d.view; render(); if (d.view === "shelters" && !S.shSearched) searchShelters(); if (d.view === "counties" && !S.coSearched) searchCounties(); }
    else if (d.tab) { ui.tab = d.tab; ui.sel = null; render(); }
    else if (d.kind) { ui.kind = d.kind; render(); }
    else if (d.sel) select(d.sel);
    else if (d.open) openSub(d.open);
    else if (d.substatus) { ui.substatus = d.substatus; renderSubs(); }
    else if (d.act) { ui.act = ui.act === d.act ? null : d.act; renderDetail(); var n = $("reason") || $("note"); if (n) n.focus(); }
    else if (t.id === "go") decide();
    else if (t.id === "back") { ui.sel = null; render(); }
    else if (t.id === "takeover") { var s = subById(ui.sel); update(s, "takeover", null, "You've taken over #" + s.id); }
    else if (t.id === "reopen") { var s2 = subById(ui.sel); ui.tab = "open"; update(s2, "reopen", null, "#" + s2.id + " is back in the queue"); }
    else if (d.shelter) openShelter(d.shelter);
    else if (d.shstatus) { ui.shstatus = d.shstatus; searchShelters(); }
    else if (d.shpick) openShelter(d.shpick);
    else if (t.id === "sh-save") saveShelter();
    else if (d.undo) undoShelter(+d.undo);
    else if (d.copick) { S.coSel = S.coList.find(function (c) { return String(c.id) === d.copick; }) || null; renderCounties(); if (window.innerWidth < 1000) $("co-edit").scrollIntoView({ block: "start" }); }
    else if (t.id === "co-save") saveCounty();
  });
  var debounce = {};
  function later(k, f) { clearTimeout(debounce[k]); debounce[k] = setTimeout(f, 300); }
  $("shq").addEventListener("input", function (e) { ui.shq = e.target.value; later("sh", searchShelters); });
  $("shstate").addEventListener("input", function (e) { ui.shstate = e.target.value; later("sh", searchShelters); });
  $("coq").addEventListener("input", function (e) { ui.coq = e.target.value; later("co", searchCounties); });
  $("costate").addEventListener("input", function (e) { ui.costate = e.target.value; later("co", searchCounties); });
  $("comissing").addEventListener("change", function (e) { ui.comissing = e.target.checked; searchCounties(); });
  $("q").addEventListener("input", function (e) { ui.q = e.target.value; renderQueue(); });
  $("subq").addEventListener("input", function (e) { ui.subq = e.target.value; renderSubs(); });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && ui.act) { e.preventDefault(); decide(); return; }
    if (tag === "input" || tag === "textarea" || tag === "select" || ui.view !== "queue" || e.ctrlKey || e.metaKey || e.altKey) return;
    var list = filtered(), i = list.findIndex(function (s) { return String(s.id) === String(ui.sel); });
    if (e.key === "j" && list.length) select(list[Math.min(list.length - 1, i + 1)].id);
    else if (e.key === "k" && list.length) select(list[Math.max(0, i - 1)].id);
    else if ((e.key === "a" || e.key === "q" || e.key === "r") && ui.sel) {
      var s = subById(ui.sel); if (!s || !isDecidable(s)) return;
      if (e.key === "q" && !submitterEmail(s)) return;
      ui.act = { a: "approve", q: "request_info", r: "reject" }[e.key]; renderDetail();
      var n = $("reason") || $("note"); if (n) { e.preventDefault(); n.focus(); }
    }
  });
  window.addEventListener("hashchange", function () { var h = location.hash.slice(1); if (/^\d+$/.test(h) && String(h) !== String(ui.sel) && subById(h)) openSub(h); });
  // keep the queue fresh while the page is open
  setInterval(function () { if (!document.hidden && !ui.act && !ui.busy) refresh(true); }, 60000);
  boot();
})();
