/*
 * Sign-in for the website's shelter forms, with the same accounts as the app.
 *
 * In the app, adding a shelter or suggesting an edit needs a signed-in account (Google, Apple, Facebook or email)
 * with a first name, last name and email. This does the same on the website: where a shelter form is, it shows a
 * sign-in box, shows the form once the person is signed in, fills the form's name and email fields from the
 * account, and hands the form the account's access token. The plugin checks that token with Supabase on the
 * server (includes/account.php) before it accepts the entry, so the review queue knows who sent it.
 *
 * shelter-forms.js calls sasShelterAccount.gate() for each form. The Supabase library (assets/vendor/supabase.js,
 * the version the app uses) is only loaded on pages that have such a form.
 */
(function () {
  "use strict";

  var W = window, D = document, CFG = W.sasShelterAccountConfig || {};
  if (W.sasShelterAccount || !CFG.url || !CFG.key || !CFG.lib) return;

  var PROVIDERS = { google: "Google", apple: "Apple", facebook: "Facebook" };
  var LEAD = {
    add: "Sign in to add a shelter for your community. Viewing the list and map stays open to everyone.",
    edit: "Sign in to suggest an edit. It helps our team follow up with you."
  };
  var PARAM = "sas-signin"; // ?sas-signin=google starts a sign-in in this tab; ?sas-signin=done marks the way back
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var NO_REACH = "Couldn't reach the sign-in service. Check your connection and try again.";

  // A sign-in page refuses to load inside a frame, and the Suggest an Edit form opens in one (the finder page's
  // pop-up). There, Google, Apple and Facebook sign-in opens this same page in a new tab, which signs in and closes.
  var inFrame = false;
  try { inFrame = W.top !== W.self; } catch (e) { inFrame = true; }

  var sb = null, session = null, who = null, phase = "loading", note = "", noteUrl = null, noteSoft = false, gates = [], whenReady = [], off = {};

  // ---------- small helpers ----------
  function h(tag, attrs) {
    var node = D.createElement(tag), k, i, kid;
    if (attrs) for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    for (i = 2; i < arguments.length; i++) {
      kid = arguments[i];
      if (kid != null) node.appendChild(typeof kid === "string" ? D.createTextNode(kid) : kid);
    }
    return node;
  }
  function icon(viewBox, shapes, attrs) {
    var NS = "http://www.w3.org/2000/svg", svg = D.createElementNS(NS, "svg"), k;
    svg.setAttribute("viewBox", viewBox); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    for (k in attrs || {}) if (Object.prototype.hasOwnProperty.call(attrs, k)) svg.setAttribute(k, attrs[k]);
    shapes.forEach(function (s) {
      var el = D.createElementNS(NS, s[0]), a;
      for (a in s[1]) if (Object.prototype.hasOwnProperty.call(s[1], a)) el.setAttribute(a, s[1][a]);
      svg.appendChild(el);
    });
    return svg;
  }
  var ICONS = {
    google: function () {
      return icon("0 0 24 24", [
        ["path", { fill: "#4285F4", d: "M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" }],
        ["path", { fill: "#34A853", d: "M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" }],
        ["path", { fill: "#FBBC05", d: "M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" }],
        ["path", { fill: "#EA4335", d: "M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9z" }]
      ]);
    },
    apple: function () {
      return icon("0 0 24 24", [["path", { fill: "currentColor", d: "M16.4 12.6c0-2.4 2-3.6 2.1-3.7a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.7.9-.8 0-2-.9-3.2-.9a4.8 4.8 0 0 0-4.1 2.5c-1.8 3-.5 7.5 1.2 10 .8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.8 4.3 4.3 0 0 1-2.6-4.1zM14 5.4a4.3 4.3 0 0 0 1-3.2 4.5 4.5 0 0 0-2.9 1.5 4.2 4.2 0 0 0-1 3.1 3.7 3.7 0 0 0 2.9-1.4z" }]]);
    },
    facebook: function () {
      return icon("0 0 24 24", [["path", { fill: "currentColor", d: "M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z" }]]);
    },
    email: function () {
      return icon("0 0 24 24", [["rect", { x: "3", y: "5.5", width: "18", height: "13", rx: "2" }], ["path", { d: "m4 7 8 6 8-6" }]],
        { fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linejoin": "round" });
    }
  };
  /** "Google" for "google"; nothing for anything that is not one of the three. */
  function named(provider) { return Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? PROVIDERS[provider] : ""; }
  function val(el) { return el ? String(el.value == null ? "" : el.value).trim() : ""; }
  function flag(input, bad) { if (bad) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  function store(kind) { try { return kind === "local" ? W.localStorage : W.sessionStorage; } catch (e) { return null; } }
  function keep(key, value) { var s = store("session"); try { if (s) { if (value == null) s.removeItem(key); else s.setItem(key, value); } } catch (e) { /* private window */ } }
  function kept(key) { var s = store("session"); try { return s ? s.getItem(key) : null; } catch (e) { return null; } }
  /** The name=value pairs of an address's query or fragment. */
  function pairs(text) {
    var out = {};
    String(text || "").replace(/^[?#]/, "").split("&").forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf("="), k = i < 0 ? pair : pair.slice(0, i), v = i < 0 ? "" : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { /* skip a broken pair */ }
    });
    return out;
  }
  /** Take our own marker (and what a failed sign-in leaves) out of the address bar, so a reload doesn't repeat it. */
  function tidyAddress() {
    if (!W.history || !W.history.replaceState) return;
    var drop = [PARAM, "code", "error", "error_code", "error_description"], rest = String(W.location.search || "").replace(/^\?/, "").split("&").filter(function (pair) {
      var k = pair.split("=")[0];
      try { k = decodeURIComponent(k); } catch (e) { /* as written */ }
      return pair && drop.indexOf(k) < 0;
    });
    // (Supabase repeats a failed sign-in after the #, and the library would read it there on every reload)
    var hash = String(W.location.hash || ""), inHash = pairs(hash);
    if (inHash.error || inHash.error_code || inHash.error_description) hash = "";
    try { W.history.replaceState(W.history.state, "", W.location.pathname + (rest.length ? "?" + rest.join("&") : "") + hash); } catch (e) { /* leave it */ }
  }
  /** Where a sign-in comes back to: this page, with what it was opened with, marked as the way back. */
  function backAddress(plain) {
    var q = plain ? [] : String(W.location.search || "").replace(/^\?/, "").split("&").filter(function (pair) {
      return pair && !/^(sas-signin|code|error|error_code|error_description)=/.test(pair) && pair !== PARAM;
    });
    q.push(PARAM + "=done");
    return W.location.origin + W.location.pathname + "?" + q.join("&");
  }

  // What this page was opened for, read before the library looks at the address. A tab the pop-up opened only to
  // sign in (helper) says so and closes when it is done; it remembers that across the trip to Google and back.
  var START = pairs(W.location.search), HASH = pairs(W.location.hash), ASKED = START[PARAM] || "", helper = false;
  var FAILED = START.error_description || START.error || HASH.error_description || HASH.error || "";
  if (named(ASKED) && !inFrame) { helper = true; keep("sasAcctHelper", "1"); }
  else if (kept("sasAcctHelper") === "1" && (ASKED === "done" || FAILED)) helper = true;
  else keep("sasAcctHelper", null);

  // ---------- who is signed in ----------
  function nameOf(p) { return ((p.first || "") + " " + (p.last || "")).trim(); }
  function complete(p) { return !!(p && p.first && p.last && p.email); }
  /** A person from their account and their profile row, the way the app reads them. */
  function person(user, row) {
    var meta = user.user_metadata || {}, full = String(meta.full_name || meta.name || "").trim();
    row = row || {};
    return {
      id: user.id,
      first: String(row.first_name || meta.first_name || meta.given_name || full.split(" ")[0] || "").trim(),
      last: String(row.last_name || meta.last_name || meta.family_name || full.split(" ").slice(1).join(" ") || "").trim(),
      email: String(row.email || user.email || meta.email || "").trim(),
      provider: (user.app_metadata || {}).provider || ""
    };
  }
  function setPhase(next, text) {
    phase = next;
    note = text || ""; noteUrl = null; noteSoft = false;
    gates.forEach(function (g) { g.show(); });
  }
  /**
   * A line under the box, for as long as the box stays as it is; `url` adds a link to the sign-in page. It reads as
   * something that went wrong unless `soft` says it only tells what is going on.
   */
  function say(text, url, soft) {
    note = text || ""; noteUrl = url || null; noteSoft = !!soft;
    gates.forEach(function (g) { g.say(note, noteUrl, noteSoft); });
  }
  /** True when a call failed because the sign-in service could not be reached, not because it said no. */
  function unreachable(error) { return !!error && (error.name === "AuthRetryableFetchError" || error.status === 0 || error.status >= 500); }
  var loadingFor = null;
  function onSession(s) {
    session = s || null;
    if (!session || !session.user) {
      who = null; loadingFor = null;
      if (helper && phase !== "helper-failed") { setPhase("helper-failed"); return; }
      if (phase !== "out") setPhase("out");
      return;
    }
    gates.forEach(function (g) { g.token(); });
    var user = session.user;
    if (who && who.id === user.id) { if (phase !== "ready" && phase !== "details" && phase !== "helper-done") arrive(); return; }
    if (loadingFor === user.id) return;
    loadingFor = user.id;
    var settle = function (row) {
      if (!session || !session.user || session.user.id !== user.id) return;
      loadingFor = null;
      who = person(user, row);
      arrive();
    };
    sb.from("profiles").select("first_name,last_name,email").eq("id", user.id).maybeSingle()
      .then(function (r) { settle(r && r.data ? r.data : null); }, function () { settle(null); });
  }
  function arrive() {
    if (helper) { setPhase("helper-done"); try { W.close(); } catch (e) { /* the tab says to close it */ } return; }
    setPhase(complete(who) ? "ready" : "details");
    heard();
    var back = kept("sasAcctBack");
    if (!back) return;
    keep("sasAcctBack", null);
    gates.forEach(function (g) { if (g.form.id === back && g.box.scrollIntoView) { try { g.box.scrollIntoView({ block: "center" }); } catch (e) { g.box.scrollIntoView(); } } });
  }

  // ---------- a form the server sent back ----------
  // When the server could not accept the sign-in that came with a form (includes/account.php), the page comes back
  // with the person's answers and with what the server said, in CFG.said. Formidable shows that line on top of the
  // form; here the sign-in is put right if it can be, and the line is shown in the box when the form is put away.
  var said = CFG.said && CFG.said.code ? CFG.said : null;
  function heard() {
    var was = said;
    said = null;
    if (!was || helper) return;
    var line = D.getElementById(was.code + "_error");
    var tell = function (text) { if (line && phase === "ready") line.textContent = text; else say(text); };
    if (was.code !== "sas_account_rejected" || !session || !sb) { if (!line || phase !== "ready") say(String(was.text || "")); return; }
    // the server was told this sign-in is no longer good: get a new one if the account still has one to give
    sb.auth.refreshSession().then(function (r) {
      var s = r && r.data ? r.data.session : null;
      if (s) { onSession(s); tell("Your sign-in was renewed. Please send the form once more."); }
      else if (unreachable(r && r.error)) tell(NO_REACH);
      else { signOut(); say("Your sign-in ran out. Please sign in again."); }
    }, function () { tell(NO_REACH); });
  }

  // ---------- the Supabase library ----------
  function boot() {
    var tag = D.createElement("script");
    tag.src = CFG.lib; tag.async = true;
    tag.onload = function () {
      try {
        sb = W.supabase.createClient(CFG.url, CFG.key, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      } catch (e) { sb = null; }
      if (!sb) { setPhase("failed"); return; }
      // (the callback must not wait on another Supabase call, so the work is put off by a tick)
      sb.auth.onAuthStateChange(function (ev, s) { W.setTimeout(function () { if (ev !== "INITIAL_SESSION" || s) onSession(s); }, 0); });
      sb.auth.getSession().then(function (r) { begin(r && r.data ? r.data.session : null); }, function () { begin(null); });
    };
    tag.onerror = function () { setPhase("failed"); };
    (D.head || D.documentElement).appendChild(tag);
  }
  function begin(s) {
    if (ASKED === "done" || FAILED) tidyAddress();
    if (s) { onSession(s); }
    else if (helper && named(ASKED)) {
      // opened from the pop-up to sign in: go straight to the provider, and come back here
      setPhase("helper");
      sb.auth.signInWithOAuth({ provider: ASKED, options: { redirectTo: backAddress(true) } }).then(function (r) {
        if (r && r.error) setPhase("helper-failed");
      }, function () { setPhase("helper-failed"); });
    } else {
      onSession(null);
      if (FAILED && !helper) say("Sign-in didn't finish. Please try again.");
      else heard();
    }
    whenReady.splice(0).forEach(function (fn) { fn(); });
  }
  function ready(fn) { if (sb && phase !== "loading") fn(); else { whenReady.push(fn); say("One moment…", null, true); } }

  // Hide the buttons for providers that aren't switched on in Supabase, as the app does.
  if (W.fetch) {
    W.fetch(CFG.url + "/auth/v1/settings", { headers: { apikey: CFG.key } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var ext = j && j.external; if (!ext) return;
      Object.keys(PROVIDERS).forEach(function (p) { if (ext[p] === false) off[p] = true; });
      gates.forEach(function (g) { g.providers(); });
    }).catch(function () { /* every button stays */ });
  }

  // ---------- signing in ----------
  function oauth(provider, from) {
    if (inFrame) {
      // (opened right in the click, or the browser would block it; the new tab does the signing in)
      var url = W.location.origin + W.location.pathname + "?" + PARAM + "=" + provider, tab = null;
      try { tab = W.open(url, "sas-signin"); } catch (e) { tab = null; }
      say(tab ? "Finish signing in in the new tab. This form opens by itself when you are done." : "Your browser blocked the sign-in tab.", tab ? null : url, !!tab);
      return;
    }
    ready(function () {
      say("Opening " + PROVIDERS[provider] + "…", null, true);
      keep("sasAcctBack", from && from.form.id ? from.form.id : null); // the form to come back to on this page
      sb.auth.signInWithOAuth({ provider: provider, options: { redirectTo: backAddress() } }).then(function (r) {
        if (r && r.error) say("Couldn't start " + PROVIDERS[provider] + " sign-in: " + r.error.message);
      }, function () { say(NO_REACH); });
    });
  }
  function emailGo(g) {
    var signup = g.mode === "signup", bad = null, pass = g.em.pass.value;
    var need = signup ? [[g.em.first, "first name"], [g.em.last, "last name"], [g.em.email, "email"], [g.em.pass, "password"]] : [[g.em.email, "email"], [g.em.pass, "password"]];
    need.forEach(function (f) {
      var v = f[0] === g.em.pass ? pass : val(f[0]);
      var ok = !!v && (f[0] !== g.em.email || EMAIL.test(v)) && (f[0] !== g.em.pass || !signup || v.length >= 8);
      flag(f[0], !ok); if (!ok && !bad) bad = f[1];
    });
    if (bad) { g.em.msg.textContent = bad === "password" && signup ? "Please choose a password with at least 8 characters." : "Please add a valid " + bad + "."; return; }
    var email = val(g.em.email), first = val(g.em.first), last = val(g.em.last);
    g.em.go.disabled = true;
    g.em.msg.textContent = signup ? "Creating your account…" : "Signing in…";
    var done = function () { g.em.go.disabled = false; };
    ready(function () {
      if (signup) {
        // the confirmation link opens the page the form is on (the finder page, for the pop-up) and signs in there
        var back = W.location.origin + W.location.pathname;
        try { if (inFrame) back = W.top.location.origin + W.top.location.pathname; } catch (e) { /* this page, then */ }
        sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: back + "?" + PARAM + "=done", data: { first_name: first, last_name: last, full_name: first + " " + last } } }).then(function (r) {
          done();
          if (r.error) { g.em.msg.textContent = unreachable(r.error) ? NO_REACH : /registered|exists/i.test(r.error.message) ? "There's already an account with that email. Choose Sign in below." : "Couldn't create the account: " + r.error.message; return; }
          if (r.data && r.data.session) { g.em.pass.value = ""; g.em.msg.textContent = ""; return; } // signed in right away
          g.setMode("signin");
          // (while new accounts must confirm their email, Supabase answers a sign-up for an existing account with a
          // made-up account that has no sign-in method, and sends no email)
          var made = r.data && r.data.user;
          if (made && made.identities && !made.identities.length) { g.em.msg.textContent = "There's already an account with that email. Sign in with its password."; return; }
          g.em.pass.value = "";
          g.em.msg.textContent = "Almost done. We sent a confirmation link to " + email + ". Open it, then come back here and sign in.";
        }, function () { done(); g.em.msg.textContent = NO_REACH; });
      } else {
        sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
          done();
          if (r.error) {
            var m = r.error.message || "";
            g.em.msg.textContent = unreachable(r.error) ? NO_REACH : /confirm/i.test(m) ? "Please confirm your email first. Look for our link in your inbox." : /invalid/i.test(m) ? "That email and password don't match." : "Couldn't sign in: " + m;
            return;
          }
          g.em.pass.value = ""; g.em.msg.textContent = "";
        }, function () { done(); g.em.msg.textContent = NO_REACH; });
      }
    });
  }
  function saveDetails(g) {
    var first = val(g.dt.first), last = val(g.dt.last), email = val(g.dt.email), bad = null;
    [[g.dt.first, first, "first name"], [g.dt.last, last, "last name"], [g.dt.email, EMAIL.test(email) ? email : "", "email"]].forEach(function (f) {
      flag(f[0], !f[1]); if (!f[1] && !bad) bad = f[2];
    });
    if (bad) { g.dt.msg.textContent = "Please add a valid " + bad + "."; return; }
    if (!sb || !session || !session.user) { g.dt.msg.textContent = "Please sign in again."; return; }
    g.dt.go.disabled = true; g.dt.msg.textContent = "Saving…";
    var uid = session.user.id, fail = function () { g.dt.go.disabled = false; g.dt.msg.textContent = "Couldn't save that just now. Check your connection and try again."; };
    sb.from("profiles").upsert({ id: uid, first_name: first, last_name: last, email: email, updated_at: new Date().toISOString() }).then(function (r) {
      if (r && r.error) { fail(); return; }
      g.dt.go.disabled = false; g.dt.msg.textContent = "";
      if (!session || !session.user || session.user.id !== uid) return;
      who = { id: uid, first: first, last: last, email: email, provider: who ? who.provider : "" };
      setPhase("ready");
    }, fail);
  }
  function signOut() {
    who = null; session = null; loadingFor = null;
    gates.forEach(function (g) { g.clear(); }); // nothing of the person stays in the boxes
    setPhase("out");
    // (this browser only: the person stays signed in to the app on their phone)
    if (sb) sb.auth.signOut({ scope: "local" }).then(function () {}, function () {});
  }

  // ---------- the box on the page ----------
  function labelled(text, input) { return h("label", { "class": "sas-acct-field" }, text, input); }
  function Gate(o) {
    var g = this, form = o.form;
    g.form = form; g.kind = o.kind === "edit" ? "edit" : "add"; g.info = o.info || {}; g.mode = "signup"; g.link = null;
    g.tokenInput = form.querySelector('input[name="sas_account_token"]') || form.appendChild(h("input", { type: "hidden", name: "sas_account_token", value: "" }));

    // signed out: the four ways in, as in the app
    g.sso = {};
    var buttons = h("div", { "class": "sas-acct-sso" });
    ["google", "apple", "facebook"].forEach(function (p) {
      g.sso[p] = h("button", { type: "button", "class": "sas-acct-btn sas-acct-" + p }, ICONS[p](), "Continue with " + PROVIDERS[p]);
      g.sso[p].addEventListener("click", function () { oauth(p, g); });
      buttons.appendChild(g.sso[p]);
    });
    var emOpen = g.emOpen = h("button", { type: "button", "class": "sas-acct-btn sas-acct-email", "aria-expanded": "false" }, ICONS.email(), "Continue with Email");
    buttons.appendChild(emOpen);
    g.em = {
      first: h("input", { type: "text", autocomplete: "given-name" }), last: h("input", { type: "text", autocomplete: "family-name" }),
      email: h("input", { type: "email", autocomplete: "email", inputmode: "email" }),
      pass: h("input", { type: "password", autocomplete: "new-password", minlength: "8", placeholder: "At least 8 characters" }),
      msg: h("p", { "class": "sas-acct-msg", "aria-live": "polite" }), go: h("button", { type: "button", "class": "sas-acct-go" }, "Create Account"),
      q: h("span", null, "Already have an account?"), sw: h("button", { type: "button", "class": "sas-acct-link" }, "Sign in")
    };
    g.em.names = h("div", { "class": "sas-acct-row2" }, labelled("First Name", g.em.first), labelled("Last Name", g.em.last));
    g.em.box = h("div", { "class": "sas-acct-em" }, g.em.names, labelled("Email", g.em.email), labelled("Password", g.em.pass), g.em.msg, g.em.go,
      h("p", { "class": "sas-acct-fine" }, g.em.q, " ", g.em.sw));
    g.em.box.hidden = true;
    emOpen.addEventListener("click", function () {
      g.em.box.hidden = !g.em.box.hidden;
      emOpen.setAttribute("aria-expanded", String(!g.em.box.hidden));
      if (!g.em.box.hidden) { g.setMode(g.mode); (g.mode === "signup" ? g.em.first : g.em.email).focus(); }
    });
    g.em.sw.addEventListener("click", function () { g.setMode(g.mode === "signup" ? "signin" : "signup"); });
    g.em.go.addEventListener("click", function () { emailGo(g); });
    g.em.box.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); emailGo(g); } });
    g.out = h("div", { "class": "sas-acct-out" }, h("p", { "class": "sas-acct-lead" }, LEAD[g.kind]), buttons, g.em.box);
    g.note = h("p", { "class": "sas-acct-note", "aria-live": "polite" }); // a line under the box, whatever it shows

    // signed in, but the account has no name yet (Apple, for one, may not pass it on)
    g.dt = {
      first: h("input", { type: "text", autocomplete: "given-name" }), last: h("input", { type: "text", autocomplete: "family-name" }),
      email: h("input", { type: "email", autocomplete: "email", inputmode: "email" }),
      msg: h("p", { "class": "sas-acct-msg", "aria-live": "polite" }), go: h("button", { type: "button", "class": "sas-acct-go" }, "Save")
    };
    g.details = h("div", { "class": "sas-acct-details" }, h("p", { "class": "sas-acct-head" }, "My Details"),
      h("p", { "class": "sas-acct-fine" }, "Used when you add a shelter or suggest an edit, so we can follow up."),
      h("div", { "class": "sas-acct-row2" }, labelled("First Name", g.dt.first), labelled("Last Name", g.dt.last)), labelled("Email", g.dt.email), g.dt.msg,
      h("div", { "class": "sas-acct-btns" }, g.dt.go, (g.dt.out = h("button", { type: "button", "class": "sas-acct-link" }, "Sign Out"))));
    g.dt.go.addEventListener("click", function () { saveDetails(g); });
    g.dt.out.addEventListener("click", signOut);
    g.details.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); saveDetails(g); } });

    // signed in
    g.whoText = h("span");
    g.outBtn = h("button", { type: "button", "class": "sas-acct-link" }, "Sign Out");
    g.outBtn.addEventListener("click", signOut);
    g.bar = h("p", { "class": "sas-acct-bar" }, g.whoText, " ", g.outBtn);

    g.wait = h("p", { "class": "sas-acct-wait" }, "Checking your sign-in…");
    g.plain = h("p", { "class": "sas-acct-plain", "aria-live": "polite" });
    g.box = h("div", { "class": "sas-acct", role: "group", "aria-label": "Sign in" }, g.wait, g.out, g.details, g.bar, g.note, g.plain);
    form.parentNode.insertBefore(g.box, form);
    g.providers();
    g.show();
  }
  Gate.prototype.setMode = function (m) {
    var g = this, up = m === "signup";
    g.mode = up ? "signup" : "signin";
    g.em.names.hidden = !up;
    g.em.go.textContent = up ? "Create Account" : "Sign In";
    g.em.q.textContent = up ? "Already have an account?" : "New here?";
    g.em.sw.textContent = up ? "Sign in" : "Create an account";
    g.em.pass.setAttribute("autocomplete", up ? "new-password" : "current-password");
    g.em.msg.textContent = "";
  };
  /** Empty the sign-in boxes and close the email part, as the box first showed. */
  Gate.prototype.clear = function () {
    var g = this;
    [g.em.first, g.em.last, g.em.email, g.em.pass, g.dt.first, g.dt.last, g.dt.email].forEach(function (input) { input.value = ""; flag(input, false); });
    g.em.box.hidden = true; g.emOpen.setAttribute("aria-expanded", "false");
    g.dt.msg.textContent = ""; g.dtFor = null;
    g.setMode("signup");
  };
  Gate.prototype.providers = function () {
    var g = this;
    Object.keys(PROVIDERS).forEach(function (p) { g.sso[p].hidden = !!off[p]; });
  };
  /** A line under the buttons; `url` adds a link for when the browser would not open the sign-in tab. */
  Gate.prototype.say = function (text, url, soft) {
    var g = this;
    g.note.textContent = text || "";
    g.note.classList.toggle("sas-acct-soft", !!soft);
    if (url) g.note.appendChild(h("span", null, " ", h("a", { href: url, target: "sas-signin", rel: "opener" }, "Open the sign-in page"), "."));
  };
  Gate.prototype.token = function () { this.tokenInput.value = session && session.access_token ? session.access_token : ""; };
  /** The form's own name and email fields: filled from the account, and out of sight while signed in. */
  Gate.prototype.fill = function (on) {
    var g = this, any = false, shown = 0;
    ["first", "last", "email"].forEach(function (k) {
      var input = g.info[k], wrap = input && input.closest ? input.closest(".frm_form_field") : null;
      if (!input) return;
      any = true;
      if (on && who) input.value = who[k] || "";
      // (a field the server sent back with an error stays in sight, so the error can be read)
      var hide = !!on && !!wrap && !wrap.querySelector(".frm_error");
      if (wrap) wrap.classList.toggle("sas-acct-hide", hide);
      if (!hide && input.type !== "hidden") shown += 1;
    });
    // the heading over those fields ("My info" on the redrawn form, "Your Info" on the original)
    Array.prototype.forEach.call(g.form.querySelectorAll(".sas-sf-info, .frm_html_container"), function (el) {
      if (el.classList.contains("sas-sf-info") || /^(your|my) info\b/i.test(el.textContent.trim())) el.classList.toggle("sas-acct-hide", !!on && any && !shown);
    });
    if (on && any) { try { g.form.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) { /* older browsers */ } }
  };
  Gate.prototype.show = function () {
    var g = this, ok = phase === "ready";
    g.wait.hidden = phase !== "loading" && phase !== "helper";
    g.wait.textContent = phase === "helper" ? "Opening the sign-in page…" : "Checking your sign-in…";
    g.out.hidden = phase !== "out";
    g.details.hidden = phase !== "details";
    g.bar.hidden = !ok;
    g.plain.hidden = !(phase === "failed" || phase === "helper-done" || phase === "helper-failed");
    g.plain.textContent = phase === "failed" ? "Sign-in couldn't load. Check your connection and reload the page."
      : phase === "helper-done" ? "You're signed in. Close this tab and go back to the form."
      : phase === "helper-failed" ? "Sign-in didn't finish. Close this tab and try again from the form." : "";
    g.form.classList.toggle("sas-acct-locked", !ok);
    g.box.classList.toggle("sas-acct-on", ok);
    g.say(note, noteUrl, noteSoft);
    if (phase === "details" && who && g.dtFor !== who.id) { // once for each person, so what they type is not written over
      g.dtFor = who.id;
      g.dt.first.value = who.first; g.dt.last.value = who.last; g.dt.email.value = who.email; g.dt.msg.textContent = "";
    }
    if (ok && who) {
      var by = named(who.provider) || (who.provider === "email" ? "email" : "");
      g.whoText.textContent = "Signed in as " + (nameOf(who) || who.email) + (by ? " with " + by : "") + ".";
    }
    g.token();
    g.fill(ok);
  };

  // ---------- sending ----------
  // The token goes with the form. It lasts an hour and the library renews it while the page is in view; if it is
  // about to run out when the person presses the button, it is renewed first and the form is sent then. (On the
  // document, in the capture phase, so this runs before the form's own checks and before Formidable.)
  var passing = null, renewing = false;
  function timeLeft() { return session && session.expires_at ? session.expires_at - Date.now() / 1000 : 0; }
  D.addEventListener("submit", function (e) {
    var g = null, i;
    for (i = 0; i < gates.length; i++) if (gates[i].form === e.target) g = gates[i];
    if (!g) return;
    if (passing === g) { passing = null; g.token(); return; }
    var stop = function () { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); };
    if (phase !== "ready" || !session || !sb || renewing) { stop(); return; }
    if (note) say("");
    if (timeLeft() > 120) { g.token(); return; }
    stop();
    var button = e.submitter || g.form.querySelector(".frm_submit button, .frm_submit input[type=submit], button[type=submit], input[type=submit]");
    var send = function () {
      passing = g; g.token();
      try {
        if (g.form.requestSubmit) g.form.requestSubmit(button || undefined); else if (button) button.click(); else passing = null;
      } catch (err) {
        if (button) button.click(); else passing = null;
      }
    };
    var settled = false, timer = null;
    var settle = function (s, error) {
      if (settled) return;
      settled = true; renewing = false; W.clearTimeout(timer);
      if (s) { session = s; say(""); send(); return; }
      if (error === "slow" || unreachable(error)) {
        // the service can't be reached: the token in hand still goes if it has a little time left; if not, the
        // person stays signed in and can press the button again
        if (timeLeft() > 15) { say(""); send(); } else say(NO_REACH);
        return;
      }
      onSession(null);
      say("Your sign-in ran out. Please sign in again.");
    };
    renewing = true;
    say("Checking your sign-in…", null, true);
    timer = W.setTimeout(function () { settle(null, "slow"); }, 8000); // (the library itself keeps trying for half a minute)
    sb.auth.getSession().then(function (r) { settle(r && r.data ? r.data.session : null, r ? r.error : null); }, function () { settle(null, "slow"); });
  }, true);

  // When the person signs in in another tab (the pop-up's sign-in tab), the library tells this page; looking again
  // when the page comes back into view covers a browser that doesn't pass that on.
  function recheck() { if (sb && phase !== "loading" && !helper) sb.auth.getSession().then(function (r) { var s = r && r.data ? r.data.session : null; if (!!s !== !!session || (s && session && s.access_token !== session.access_token)) onSession(s); }, function () {}); }
  W.addEventListener("focus", recheck);
  D.addEventListener("visibilitychange", function () { if (!D.hidden) recheck(); });
  // (back from a provider's page with the Back button: "Opening Google…" is no longer true)
  W.addEventListener("pageshow", function (e) { if (e.persisted) { if (note) say(""); recheck(); } });

  var booted = false;
  W.sasShelterAccount = {
    /** Put a sign-in box in front of a form. o: { form, kind: "add" | "edit", info: { first, last, email } (the form's own inputs) } */
    gate: function (o) {
      if (!o || !o.form || !o.form.parentNode) return null;
      for (var i = 0; i < gates.length; i++) if (gates[i].form === o.form) return gates[i];
      var g = new Gate(o);
      gates.push(g);
      if (!booted) { booted = true; boot(); }
      return g;
    }
  };
})();
