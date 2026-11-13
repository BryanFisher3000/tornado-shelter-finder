/*
 * The website's shelter forms, like the app's.
 *
 * The finder page's "Add/Edit Shelter" form (Formidable form 39) becomes the app's Add a Shelter form, and the
 * "Suggest an Edit" form (Formidable form 44, opened in a pop-up from each shelter) becomes the app's Suggest an
 * Edit form. The Formidable fields stay in the page, out of sight, and this script copies the person's answers into
 * them, so the spam check, the stored entry and the review queue (includes/formidable.php) work as before.
 * If anything here fails, the original fields are shown again and the form works as it did.
 *
 * The Add a Shelter page has a Formidable form made for it (field keys sas_add_*), which already asks what the app
 * asks. Its fields are shown as Formidable writes them; this adds the map for placing the pin, the address lookup
 * that moves that map, and the app's one line over the button when something is missing.
 *
 * The forms sit behind the app's sign-in (shelter-account.js, loaded before this file): a form shows once the
 * person is signed in, and its First Name, Last Name and Email fields are filled from the account, out of sight.
 */
(function () {
  "use strict";

  var D = document, W = window;
  // a page editor (Visual Composer, Bricks): leave the page as it is saved
  if (/[?&](vcv-|bricks=)/.test(W.location.search)) return;
  var CFG = W.sasShelterFormsConfig || {}; // where Leaflet is, and a Google Maps key if the site set one (public-forms.php)

  var STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
  var REASONS = ["Address is wrong", "No shelter at this location", "Not a public shelter"];
  // Each choice: [the app's value, the label shown, the words put in the Formidable field].
  // Capacity goes in as words because "<25" does not survive a WordPress form field, and Unknown goes in as a word
  // because Formidable does not keep an empty answer; formidable.php turns both back.
  var DETAILS = [
    { key: "capacity", title: "Capacity", read: capacityChoice, options: [["", "Unknown", "Unknown"], ["<25", "<25", "Under 25"], ["<50", "<50", "Under 50"], ["50+", "50+", "50 or more"]] },
    { key: "open", title: "Open", read: openChoice, options: [["", "Unknown", "Unknown"], ["emergencies_only", "During emergencies", "During emergencies"], ["always", "Year-round", "Year-round"]] },
    { key: "ada", title: "Wheelchair accessible", read: yesNoChoice, options: [["", "Unknown", "Unknown"], ["yes", "Yes", "Yes"], ["no", "No", "No"]] },
    { key: "pets", title: "Pets allowed", read: yesNoChoice, options: [["", "Unknown", "Unknown"], ["yes", "Yes", "Yes"], ["no", "No", "No"]] }
  ];
  var LEAD = "Our team reviews every new shelter before it shows up in the Tornado Shelter Finder.";
  var THANKS = {
    add: "Thanks! We got the new shelter. Our team will review it before it shows up in the Tornado Shelter Finder.",
    edit: "Thanks! We got your suggestion. Our team will review it soon."
  };
  var PIN_HINT = "Use Map Center to move the pin to a more specific shelter location. Center the map above on that spot first.";
  var PAGE_PIN_HINT = "Use Map Center to move the pin to a more specific shelter location. Center the map on that spot first.";
  var PIN_UNSET = "Map pin: not set";
  var PIN_ZOOM = 15; // Use Map Center asks for at least this zoom: from further out the middle of the map is no place
  var TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  var LOOKUP = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=us";
  var NO_NOTE = "(no note)"; // the Formidable message box is required, so an empty note is sent as this
  var BLANK = "(blank)";     // an address box the person emptied: Formidable would not keep an empty answer

  // ---------- reading what a listing says, the way formidable.php reads it ----------
  function capacityChoice(text) {
    var t = String(text || "").replace(/&lt;/gi, "<").trim().toLowerCase().replace(/\s+/g, " ");
    if (!t) return "";
    if (t === "under 25" || t === "<25" || t === "limited") return "<25";
    if (t === "under 50" || t === "<50") return "<50";
    if (t === "50 or more" || t === "50+") return "50+";
    var m = /\d+/.exec(t.replace(/,/g, ""));
    if (!m) return "";
    return +m[0] >= 50 ? "50+" : +m[0] >= 25 ? "<50" : "<25";
  }
  function openChoice(text) {
    var t = String(text || "").trim().toLowerCase();
    if (!t || t === "unknown") return "";
    if (/year|always|24\/7/.test(t)) return "always";
    if (t.indexOf("county") >= 0) return ""; // "when the county opens it" is not one of the app's choices
    return "emergencies_only";
  }
  function yesNoChoice(text) {
    var t = String(text || "").trim().toLowerCase();
    if (!t || t === "unknown") return "";
    if (t.indexOf("service") >= 0) return "no"; // "Service animals only"
    return t.charAt(0) === "y" ? "yes" : t.charAt(0) === "n" ? "no" : "";
  }

  // ---------- small helpers ----------
  var seq = 0;
  function uid(part) { seq += 1; return "sas-sf-" + part + "-" + seq; }
  /** An element with attributes, then its children (a string becomes text, so nothing a person typed is read as HTML). */
  function h(tag, attrs) {
    var node = D.createElement(tag), k, i, kid;
    if (attrs) for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    for (i = 2; i < arguments.length; i++) {
      kid = arguments[i];
      if (kid != null) node.appendChild(typeof kid === "string" ? D.createTextNode(kid) : kid);
    }
    return node;
  }
  function value(el) { return el ? String(el.value == null ? "" : el.value).trim() : ""; }
  function unblank(text) { return text === BLANK ? "" : text; }
  function box(el) { return el && el.closest ? el.closest(".frm_form_field") : null; }
  function field(label, control, cls) { return h("label", { "class": "sas-sf-field" + (cls ? " " + cls : "") }, label, control); }
  function textInput(attrs) {
    var a = { type: "text" }, k;
    for (k in attrs || {}) if (Object.prototype.hasOwnProperty.call(attrs, k)) a[k] = attrs[k];
    return h("input", a);
  }
  function stateSelect(firstLabel) {
    var sel = h("select", { autocomplete: "off" }, h("option", { value: "" }, firstLabel));
    STATES.forEach(function (s) { sel.appendChild(h("option", { value: s }, s)); });
    return sel;
  }
  function setState(sel, st) {
    st = String(st || "").trim().toUpperCase();
    if (st && STATES.indexOf(st) < 0 && !sel.querySelector('option[value="' + st.replace(/[^A-Z0-9 .'-]/g, "") + '"]')) sel.appendChild(h("option", { value: st }, st));
    sel.value = st;
    if (sel.value !== st) sel.value = "";
  }
  /** Things to put back if the form can't be redrawn after all. */
  function Undo() {
    var steps = [];
    return {
      add: function (fn) { steps.push(fn); },
      run: function () { while (steps.length) { try { steps.pop()(); } catch (e) { /* keep undoing */ } } }
    };
  }
  /** Hide a Formidable field the redrawn form replaces (cls omitted), or a line of the page around the form. */
  function hideBox(el, undo, cls) {
    cls = cls || "sas-sf-orig";
    if (!el || el.classList.contains(cls)) return;
    el.classList.add(cls);
    undo.add(function () { el.classList.remove(cls); });
  }
  /** True when the server sent the form back with an error on one of the boxes the redraw would hide. */
  function hasHiddenError(boxes) {
    return boxes.some(function (b) { return b && b.querySelector(".frm_error"); });
  }
  function insertBefore(node, ref, undo) {
    ref.parentNode.insertBefore(node, ref);
    undo.add(function () { if (node.parentNode) node.parentNode.removeChild(node); });
  }
  function setText(el, text, undo) {
    var isInput = el.tagName === "INPUT", was = isInput ? el.value : el.textContent;
    if (isInput) el.value = text; else el.textContent = text;
    undo.add(function () { if (isInput) el.value = was; else el.textContent = was; });
  }
  /** Tell the page's own scripts that the Formidable fields changed (the edit page keeps a list of changed fields). */
  function announce(form) {
    try { form.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) { /* older browsers: the list is rebuilt on submit */ }
  }
  /** Pick the option of a Formidable drop-down whose text means `wanted`; returns false when it has none. */
  function choose(select, wanted) {
    var i, o, w = String(wanted).toLowerCase();
    for (i = 0; i < select.options.length; i++) {
      o = select.options[i];
      if (String(o.value).toLowerCase() === w) { select.value = o.value; return true; }
    }
    return false;
  }

  function warn(what, e) { if (W.console && W.console.warn) W.console.warn(what, e); }
  /** A map pin from two numbers as text, or null when they are not a place on the map. */
  function readPin(lat, lng) {
    if (lat == null || lng == null || String(lat).trim() === "" || String(lng).trim() === "") return null;
    lat = +lat; lng = +lng;
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat, lng: lng } : null;
  }

  // ---------- address suggestions (Google Places) ----------
  /** What a chosen suggestion says, in the parts the forms use. */
  function placeParts(place) {
    if (!place || !place.address_components) return null;
    var part = {}, g = function (type, short) { return part[type] ? (short ? part[type].short_name : part[type].long_name) || "" : ""; };
    place.address_components.forEach(function (c) { (c.types || []).forEach(function (t) { part[t] = c; }); });
    var at = place.geometry && place.geometry.location;
    return {
      street: [g("street_number"), g("route", true)].filter(Boolean).join(" "),
      city: g("locality") || g("sublocality") || g("postal_town") || g("administrative_area_level_3"),
      state: g("administrative_area_level_1", true),
      zip: g("postal_code"),
      county: g("administrative_area_level_2").replace(/\s+(County|Parish|Borough|Census Area|Municipality)$/i, ""),
      pin: at && typeof at.lat === "function" ? { lat: +at.lat(), lng: +at.lng() } : null
    };
  }
  var placesWaiting = [], placesAsked = false;
  /**
   * Calls fn with Google's Places library: the page's own (the finder page has Google Maps), or, with mayLoad, one
   * fetched with the key the site set (SAS_GOOGLE_MAPS_KEY). With neither, fn is not called.
   */
  function withPlaces(fn, mayLoad) {
    var ready = function () { var p = W.google && W.google.maps && W.google.maps.places; return p && p.Autocomplete ? p : null; };
    var have = ready();
    if (have) { fn(have); return; }
    if (!mayLoad || !CFG.mapsKey) return;
    placesWaiting.push(fn);
    if (placesAsked) return;
    placesAsked = true;
    var done = function () {
      var p = ready();
      if (p) placesWaiting.splice(0).forEach(function (f) { try { f(p); } catch (e) { /* that box stays plain */ } });
      return !!p;
    };
    if ((W.google && W.google.maps) || D.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')) {
      // the page is fetching Google Maps itself: wait for that one, a second copy would break both
      var tries = 0, timer = W.setInterval(function () { tries += 1; if (done() || tries > 40) W.clearInterval(timer); }, 250);
      return;
    }
    W.sasShelterPlacesReady = function () { done(); };
    var tag = D.createElement("script");
    tag.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(CFG.mapsKey) + "&libraries=places&loading=async&callback=sasShelterPlacesReady";
    tag.async = true;
    (D.head || D.documentElement).appendChild(tag);
  }
  // When Google does not accept the page's key it switches its suggestion boxes off and writes "Oops! Something went
  // wrong." in them. A street box must stay a box to type in, so each one is given back.
  var suggestBoxes = [];
  function keepBoxes() {
    if (suggestBoxes.length !== 1) return; // (set up once, with the first box)
    var was = W.gm_authFailure;
    W.gm_authFailure = function () {
      try { if (typeof was === "function") was.apply(this, arguments); } catch (e) { /* the page's own handler */ }
      var free = function () {
        suggestBoxes.forEach(function (b) {
          b[0].disabled = false;
          b[0].classList.remove("gm-err-autocomplete");
          b[0].style.backgroundImage = "";
          b[0].setAttribute("placeholder", b[1] == null ? "" : b[1]);
        });
      };
      free(); W.setTimeout(free, 300); W.setTimeout(free, 1500);
    };
  }
  /**
   * Google's address suggestions under a street box; onPick gets the chosen address in parts (placeParts). Without
   * Google Maps the box is a plain text box. Returns a function that gets the suggestions ready ahead of the first
   * focus.
   */
  function suggest(street, onPick, undo, mayLoad) {
    var on = false;
    function attach(places) {
      if (on) return;
      on = true;
      try {
        suggestBoxes.push([street, street.getAttribute("placeholder")]);
        keepBoxes();
        var ac = new places.Autocomplete(street, { types: ["address"], componentRestrictions: { country: "us" }, fields: ["address_components", "geometry"] });
        ac.addListener("place_changed", function () { try { var p = placeParts(ac.getPlace()); if (p) onPick(p); } catch (e) { /* keep what was typed */ } });
      } catch (e) { /* a plain text box */ }
    }
    function ask() { if (!on) withPlaces(attach, mayLoad); }
    function onKey(e) { // Enter picks the highlighted suggestion; it shouldn't also send the form
      if (e.key !== "Enter") return;
      var lists = D.querySelectorAll(".pac-container"), n;
      for (n = 0; n < lists.length; n++) if (W.getComputedStyle(lists[n]).display !== "none") { e.preventDefault(); return; }
    }
    street.addEventListener("focus", ask);
    street.addEventListener("keydown", onKey);
    undo.add(function () { street.removeEventListener("focus", ask); street.removeEventListener("keydown", onKey); });
    return ask;
  }

  // ---------- the map on the Add a Shelter page (Leaflet, fetched when a form needs it) ----------
  var leafletWaiting = [], leafletAsked = false;
  function withLeaflet(fn) {
    if (W.L && W.L.map) { fn(); return; }
    if (!CFG.leaflet || !CFG.leaflet.js || !CFG.leaflet.css) return;
    leafletWaiting.push(fn);
    if (leafletAsked) return;
    leafletAsked = true;
    var css = D.createElement("link"), js = D.createElement("script");
    css.rel = "stylesheet"; css.href = CFG.leaflet.css;
    js.src = CFG.leaflet.js; js.async = true;
    js.onload = function () { if (W.L && W.L.map) leafletWaiting.splice(0).forEach(function (f) { f(); }); };
    (D.head || D.documentElement).appendChild(css);
    (D.head || D.documentElement).appendChild(js);
  }

  // ---------- the parts both forms share ----------
  /** Capacity, Open, Wheelchair accessible, Pets allowed: a heading and a row of choices each. */
  function detailGroups() {
    var out = { nodes: [], get: {}, set: {}, words: {} };
    DETAILS.forEach(function (d) {
      var id = uid(d.key), name = uid("r"), radios = [], row = h("div", { "class": "sas-sf-radios" });
      d.options.forEach(function (o, i) {
        // form="…" names a form that isn't there, so these choices are never sent with the Formidable form
        var r = h("input", { type: "radio", name: name, value: String(i), form: "sas-sf-none" });
        radios.push(r);
        row.appendChild(h("label", null, r, o[1]));
      });
      out.nodes.push(h("div", { "class": "sas-sf-grp", role: "radiogroup", "aria-labelledby": id }, h("div", { "class": "sas-sf-glabel", id: id }, d.title), row));
      out.get[d.key] = function () {
        for (var i = 0; i < radios.length; i++) if (radios[i].checked) return d.options[i][0];
        return "";
      };
      out.set[d.key] = function (v) {
        var hit = false;
        radios.forEach(function (r, i) { r.checked = !hit && d.options[i][0] === v; hit = hit || r.checked; });
        if (!hit) radios[0].checked = true;
      };
      out.words[d.key] = function (v) {
        for (var i = 0; i < d.options.length; i++) if (d.options[i][0] === v) return d.options[i][2];
        return "";
      };
    });
    return out;
  }
  function reader(key) {
    for (var i = 0; i < DETAILS.length; i++) if (DETAILS[i].key === key) return DETAILS[i].read;
    return function () { return ""; };
  }
  /** The first Formidable field still showing that must be filled in and isn't, as words for the message. */
  function missingRequired(form) {
    var boxes = form.querySelectorAll(".frm_form_field:not(.sas-sf-orig)"), i, b, input, star, label;
    for (i = 0; i < boxes.length; i++) {
      b = boxes[i];
      input = b.querySelector("input[type=text], input[type=email], input[type=tel], textarea, select");
      if (!input || value(input)) continue;
      star = b.querySelector(".frm_required");
      if (input.getAttribute("aria-required") !== "true" && !(star && star.textContent.trim())) continue;
      label = b.querySelector(".frm_primary_label");
      return { input: input, name: (label ? label.textContent : "missing detail").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase() };
    }
    return null;
  }
  function remember(formId, kind) {
    try { W.sessionStorage.setItem("sasSf" + formId, kind + "|" + Date.now()); } catch (e) { /* private window */ }
  }
  /** Shared wiring: the heading over the name and email boxes, the button, the message over it, and sending. */
  function finish(o) {
    var form = o.form, undo = o.undo, submit = o.submit;
    var before = Array.prototype.map.call(form.elements, function (el) { return [el, el.value, el.checked]; });
    undo.add(function () { // the Formidable fields as they were
      before.forEach(function (b) {
        if (b[0].type === "radio" || b[0].type === "checkbox") b[0].checked = b[2];
        else if (b[0].type !== "file" && b[0].value !== b[1]) b[0].value = b[1];
      });
    });
    var firstBox = box(o.first);
    if (firstBox) insertBefore(h("div", { "class": "sas-sf-info" }, "My info"), firstBox, undo);
    var msg = h("p", { "class": "sas-sf-msg", "aria-live": "polite" });
    var submitRow = submit.closest(".frm_submit") || submit;
    insertBefore(msg, submitRow, undo);
    setText(submit, o.button, undo);

    function flag(input, bad) { if (bad) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
    function onSubmit(e) {
      var problem = null;
      try {
        o.sync();
        (o.required || []).forEach(function (r) {
          var empty = !value(r[0]);
          flag(r[0], empty);
          if (empty && !problem) problem = r[1];
        });
        if (!problem) { var m = missingRequired(form); if (m) problem = m.name; }
      } catch (err) {
        return; // let the form go as Formidable would send it
      }
      if (problem) {
        e.preventDefault();
        e.stopPropagation(); // Formidable listens on the document, so it never sees this try
        msg.textContent = "Please add the " + problem + ".";
        return;
      }
      msg.textContent = "";
      remember(o.formId, o.kind);
    }
    form.addEventListener("submit", onSubmit);
    undo.add(function () { form.removeEventListener("submit", onSubmit); });

    function onEdit() {
      try { o.sync(); } catch (err) { /* the submit step syncs again */ }
      (o.required || []).forEach(function (r) { if (value(r[0])) flag(r[0], false); });
    }
    o.block.addEventListener("input", onEdit);
    o.block.addEventListener("change", onEdit);
    o.sync();
  }

  // ---------- Suggest an Edit (and the same page opened blank: Add a Shelter) ----------
  function setUpFeedbackForm(form, undo) {
    var f = function (k) { return D.getElementById("field_sfb_" + k); };
    var needed = ["name", "address", "city", "state", "zip", "capacity", "ada", "pets", "open", "message"], i;
    for (i = 0; i < needed.length; i++) if (!f(needed[i])) return false;
    var fields = form.querySelector(".frm_fields_container"), submit = form.querySelector(".frm_submit button, .frm_submit input[type=submit]");
    var firstBox = fields && fields.querySelector(".frm_form_field");
    if (!fields || !submit || !firstBox) return false;
    var orig = function (k) { return value(f("orig_" + k)); };
    var editing = orig("name") !== "";
    var replaced = ["name", "address", "city", "county", "state", "zip", "capacity", "note", "ada", "pets", "open", "lat", "lng", "message"].map(function (k) { return box(f(k)); });
    // the three report checkboxes, if the Formidable form has its own (field key sfb_reasons): ticked from ours
    var ownReasons = Array.prototype.slice.call(form.querySelectorAll('input[type=checkbox][id^="field_sfb_reasons"]'));
    if (ownReasons.length) replaced.push(box(ownReasons[0]));
    if (hasHiddenError(replaced)) return false;

    var details = detailGroups();
    var note = h("textarea", { placeholder: "Anything to note", "aria-label": "Comments" });
    var block = h("div", { "class": "sas-sf" });
    var o = { form: form, formId: "44", undo: undo, submit: submit, block: block, first: f("first") || f("last") || f("email") };

    // what the hidden Formidable message holds: an optional first line "Reported: …", then the person's note
    var message = value(f("message")).replace(/\r\n/g, "\n"), said = [];
    var mm = /^Reported: ([^\n]*)(?:\n|$)/.exec(message);
    if (mm && mm[1].split("; ").every(function (r) { return REASONS.indexOf(r) >= 0; })) { said = mm[1].split("; "); message = message.slice(mm[0].length); }
    note.value = message.trim() === NO_NOTE ? "" : message.trim();

    if (editing) {
      // start from what the listing says; a detail is only sent as changed when the person picks something else
      var start = {};
      DETAILS.forEach(function (d) {
        var now = value(f(d.key));
        start[d.key] = d.read(orig(d.key));
        // an empty field is the listing untouched (a drop-down can't always hold the listing's own spelling)
        details.set[d.key](now ? d.read(now) : start[d.key]);
      });
      var where = [[orig("city"), orig("state")].filter(Boolean).join(", "), orig("zip")].filter(Boolean).join(" ");
      var summary = h("div", { "class": "sas-sf-summary" }, h("p", null, h("strong", null, orig("name"))),
        h("p", null, orig("address") || null, orig("address") && where ? h("br") : null, where || null));
      var checks = REASONS.map(function (r) { return h("input", { type: "checkbox" }); });
      checks.forEach(function (c, n) { c.checked = said.indexOf(REASONS[n]) >= 0; });
      var street = textInput({ autocomplete: "off" }), city = textInput({ autocomplete: "off" }), state = stateSelect(""),
        zip = textInput({ inputmode: "numeric", maxlength: "10", autocomplete: "off" });
      street.value = unblank(value(f("address"))); city.value = unblank(value(f("city"))); zip.value = unblank(value(f("zip"))); setState(state, unblank(value(f("state"))));
      var addr = h("div", { "class": "sas-sf-addr" }, field("Street address", street),
        h("div", { "class": "sas-sf-row2" }, field("City", city), field("State", state)), field("ZIP", zip, "sas-sf-zip"));
      addr.hidden = !checks[0].checked;
      checks[0].addEventListener("change", function () { addr.hidden = !checks[0].checked; });
      block.appendChild(summary);
      block.appendChild(h("div", { "class": "sas-sf-grp" },
        h("label", { "class": "sas-sf-chk" }, checks[0], REASONS[0]), addr,
        h("label", { "class": "sas-sf-chk" }, checks[1], REASONS[1]),
        h("label", { "class": "sas-sf-chk" }, checks[2], REASONS[2])));
      details.nodes.forEach(function (n) { block.appendChild(n); });
      block.appendChild(note);

      o.kind = "edit"; o.button = "Send";
      o.sync = function () {
        var wrong = checks[0].checked;
        [["address", street], ["city", city], ["state", state], ["zip", zip]].forEach(function (a) {
          var was = orig(a[0]), now = value(a[1]);
          // unticked, or left as the listing has it: send the listing's own words, so nothing counts as changed
          f(a[0]).value = !wrong || now === was || (a[0] === "state" && now === was.toUpperCase()) ? was : now || BLANK;
        });
        DETAILS.forEach(function (d) {
          var real = f(d.key), v = details.get[d.key](), same = v === start[d.key], j;
          if (real.tagName !== "SELECT") { real.value = same ? orig(d.key) : details.words[d.key](v); return; }
          if (!same) { if (!choose(real, details.words[d.key](v))) real.value = ""; return; }
          if (choose(real, orig(d.key))) return; // back to exactly what the listing said
          for (j = 0; j < real.options.length; j++) if (d.read(real.options[j].value) === v && (v || !real.options[j].value)) { real.value = real.options[j].value; return; }
          real.value = "";
        });
        var reported = REASONS.filter(function (r, n) { return checks[n].checked; }), text = value(note);
        f("message").value = ((reported.length ? "Reported: " + reported.join("; ") + (text ? "\n" : "") : "") + text) || NO_NOTE;
        ownReasons.forEach(function (c) {
          var words = (c.value || "").toLowerCase(), n = words.indexOf("address") >= 0 ? 0 : words.indexOf("no shelter") >= 0 ? 1 : words.indexOf("not a public") >= 0 ? 2 : -1;
          if (n >= 0) c.checked = checks[n].checked;
        });
        announce(form);
      };
    } else {
      var name = textInput({ placeholder: "e.g. First Baptist Church Safe Room" }), aStreet = textInput({ autocomplete: "off" }),
        aCity = textInput(), aState = stateSelect("State"), aZip = textInput({ inputmode: "numeric", maxlength: "10" });
      name.value = value(f("name")); aStreet.value = value(f("address")); aCity.value = value(f("city")); aZip.value = value(f("zip")); setState(aState, value(f("state")));
      DETAILS.forEach(function (d) { details.set[d.key](d.read(value(f(d.key)))); });
      block.appendChild(h("p", { "class": "sas-sf-lead" }, LEAD));
      block.appendChild(field("Location Name", name));
      block.appendChild(field("Street Address", aStreet));
      block.appendChild(h("div", { "class": "sas-sf-row2" }, field("City", aCity), field("State", aState)));
      block.appendChild(field("ZIP", aZip, "sas-sf-zip"));
      details.nodes.forEach(function (n) { block.appendChild(n); });
      block.appendChild(note);

      o.kind = "add"; o.button = "Add";
      o.required = [[name, "location name"], [aStreet, "street address"], [aCity, "city"], [aState, "state"]];
      o.sync = function () {
        f("name").value = value(name); f("address").value = value(aStreet); f("city").value = value(aCity);
        f("state").value = value(aState); f("zip").value = value(aZip);
        DETAILS.forEach(function (d) {
          var real = f(d.key), words = details.words[d.key](details.get[d.key]());
          if (real.tagName !== "SELECT") real.value = words; else if (!choose(real, words)) real.value = "";
        });
        f("message").value = value(note) || NO_NOTE;
        announce(form);
      };
      // the page's own heading and opening line are about editing
      var h1 = D.querySelector("h1.entry-title");
      if (h1 && /^suggest an edit$/i.test(h1.textContent.trim())) setText(h1, "Add a Shelter", undo);
      var intro = D.querySelector(".entry-content > p");
      if (intro && /^see something wrong/i.test(intro.textContent.trim())) hideBox(intro, undo, "sas-sf-hide");
    }

    insertBefore(block, firstBox, undo);
    replaced.forEach(function (b) { hideBox(b, undo); });
    Array.prototype.forEach.call(fields.querySelectorAll(".frm_html_container"), function (el) {
      if (/^(shelter details|your info)\b/i.test(el.textContent.trim())) hideBox(el, undo);
    });
    finish(o);
    return true;
  }

  // ---------- Add a Shelter, in the finder page's own box ----------
  function setUpFinderAddForm(form, undo) {
    var ids = { street: "field_stacy", city: "field_ygxp5", county: "field_zl89t", state: "field_adej1", zip: "field_zrhlf", capacity: "field_2jfhz", note: "field_9gy75", lat: "field_u0803", lng: "field_svf42" };
    var real = {}, k;
    for (k in ids) { real[k] = D.getElementById(ids[k]); if (!real[k] && k !== "county" && k !== "lat" && k !== "lng") return false; }
    var yesNo = { ada: form.querySelectorAll('input[type=radio][id^="field_98mz1-"]'), pets: form.querySelectorAll('input[type=radio][id^="field_6p19c-"]') };
    if (!yesNo.ada.length || !yesNo.pets.length) return false;
    var fields = form.querySelector(".frm_fields_container"), submit = form.querySelector(".frm_submit button, .frm_submit input[type=submit]");
    var firstBox = fields && fields.querySelector(".frm_form_field");
    if (!fields || !submit || !firstBox) return false;
    var replaced = ["street", "city", "county", "state", "zip", "capacity", "note", "lat", "lng"].map(function (key) { return box(real[key]); }).concat([box(yesNo.ada[0]), box(yesNo.pets[0])]);
    if (hasHiddenError(replaced)) return false;

    var details = detailGroups();
    var note = h("textarea", { placeholder: "Anything to note", "aria-label": "Comments" });
    // (an empty placeholder keeps Google's suggestion box from writing "Enter a location" into the street box)
    var name = textInput({ placeholder: "e.g. First Baptist Church Safe Room" }), street = textInput({ autocomplete: "off", placeholder: "" }),
      city = textInput(), state = stateSelect("State"), zip = textInput({ inputmode: "numeric", maxlength: "10" });
    var block = h("div", { "class": "sas-sf" });

    // The Formidable form has no box for the name or for Open, so both travel in its note: "Name: … || Open: … || Note: …"
    var packed = /^Name: (.*?) \|\| Open: (Year-round|During emergencies|Unknown) \|\| Note: ?([\s\S]*)$/.exec(value(real.note));
    name.value = packed ? packed[1] : "";
    note.value = packed ? packed[3] : value(real.note);
    street.value = value(real.street); city.value = value(real.city); zip.value = value(real.zip); setState(state, value(real.state));
    details.set.capacity(capacityChoice(value(real.capacity)));
    details.set.open(packed ? openChoice(packed[2]) : "");
    ["ada", "pets"].forEach(function (key) {
      var picked = "";
      Array.prototype.forEach.call(yesNo[key], function (r) { if (r.checked) picked = yesNoChoice(r.value); });
      details.set[key](picked);
    });

    // the map pin: from an address suggestion, or from the middle of the map
    var pin = null, pinText = h("span", null, PIN_UNSET), pinButton = h("button", { type: "button", "aria-describedby": "sas-sf-pin-hint" }, "Use Map Center");
    var pinRow = h("div", { "class": "sas-sf-pin" }, h("p", { id: "sas-sf-pin-hint" }, PIN_HINT), h("div", { "class": "sas-sf-loc" }, pinText, pinButton));
    if (real.lat && real.lng && value(real.lat) && value(real.lng) && isFinite(+value(real.lat)) && isFinite(+value(real.lng))) pin = { lat: +value(real.lat), lng: +value(real.lng) };
    function showPin() { pinText.textContent = pin ? "Map pin: " + pin.lat.toFixed(5) + ", " + pin.lng.toFixed(5) : PIN_UNSET; }
    function mapCenter() { // the map's Google link carries the middle of the map as ll=lat,lng
      var links = D.querySelectorAll('#custom-map a[href*="maps.google.com/maps"]'), n, m;
      for (n = 0; n < links.length; n++) {
        m = /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(links[n].getAttribute("href") || "");
        if (m) return { lat: +m[1], lng: +m[2] };
      }
      return null;
    }
    pinButton.addEventListener("click", function () {
      var c = mapCenter();
      if (c) { pin = c; showPin(); sync(); } else pinText.textContent = "Map pin: not set. The map isn't ready yet. Try again in a moment.";
    });
    showPin();

    block.appendChild(h("p", { "class": "sas-sf-lead" }, LEAD));
    block.appendChild(field("Location Name", name));
    block.appendChild(field("Street Address", street));
    block.appendChild(h("div", { "class": "sas-sf-row2" }, field("City", city), field("State", state)));
    block.appendChild(field("ZIP", zip, "sas-sf-zip"));
    if (real.lat && real.lng && D.getElementById("custom-map")) block.appendChild(pinRow);
    details.nodes.forEach(function (n) { block.appendChild(n); });
    block.appendChild(note);

    // The county comes only from an address suggestion (there is no box for it), so it is kept only while the
    // address is still the suggested one.
    function addressKey() { return [value(street), value(city), value(state)].join("|").toLowerCase(); }
    var county = { name: real.county ? value(real.county) : "", key: addressKey() };
    function sync() {
      real.street.value = value(street); real.city.value = value(city); real.state.value = value(state); real.zip.value = value(zip);
      if (real.county) real.county.value = county.name && county.key === addressKey() ? county.name : "";
      real.capacity.value = details.words.capacity(details.get.capacity());
      ["ada", "pets"].forEach(function (key) {
        var v = details.get[key]();
        Array.prototype.forEach.call(yesNo[key], function (r) { r.checked = v !== "" && yesNoChoice(r.value) === v; });
      });
      var openWords = details.words.open(details.get.open()) || "Unknown";
      real.note.value = "Name: " + value(name).replace(/\s*\|\|+\s*/g, " | ") + " || Open: " + openWords + " || Note: " + value(note).replace(/\s+/g, " ");
      if (real.lat && real.lng) { real.lat.value = pin ? String(pin.lat) : ""; real.lng.value = pin ? String(pin.lng) : ""; }
    }

    // Address suggestions, with the page's own Google Maps (the search box above the map uses the same). Choosing one
    // fills the city, state and ZIP and sets the map pin. Without Google Maps the box is a plain text box.
    suggest(street, function (p) {
      if (p.street) street.value = p.street;
      if (p.city) city.value = p.city;
      if (STATES.indexOf(p.state) >= 0) state.value = p.state;
      if (p.zip) zip.value = p.zip;
      county = { name: p.county, key: addressKey() };
      if (p.pin) { pin = p.pin; showPin(); }
      sync();
    }, undo);

    insertBefore(block, firstBox, undo);
    replaced.forEach(function (b) { hideBox(b, undo); });
    finish({ form: form, formId: "39", undo: undo, submit: submit, block: block, kind: "add", button: "Add", sync: sync,
      first: D.getElementById("field_1imzl") || D.getElementById("field_sof1r") || D.getElementById("field_k5ihj"),
      required: [[name, "location name"], [street, "street address"], [city, "city"], [state, "state"]] });
    return true;
  }

  /** The words beside the finder page's form are about the old form ("Add/Edit Shelter", "None of these fields are required"). */
  function finderWords(container, undo) {
    var row = container.closest(".vce-row") || container.parentNode;
    Array.prototype.forEach.call(row.querySelectorAll("h1, h2, h3, h4, h5"), function (el) {
      if (/^add\s*\/\s*edit shelter$/i.test(el.textContent.trim())) setText(el, "Add a Shelter", undo);
    });
    Array.prototype.forEach.call(row.querySelectorAll("p"), function (el) {
      if (!/^none of these fields are required/i.test(el.textContent.trim())) return;
      hideBox(el, undo, "sas-sf-hide");
      // the empty line the page keeps above it would leave a hole between the words and the form
      var gap = el.previousElementSibling;
      if (gap && gap.tagName === "P" && !gap.textContent.trim() && !gap.querySelector(":not(br)")) hideBox(gap, undo, "sas-sf-hide");
    });
  }

  // ---------- Add a Shelter on its own page: the Formidable form made for it (field keys sas_add_*) ----------
  function findPageAddForm() { // (told by its fields, as formidable.php tells it: the form's own id is the builder's to choose)
    var el = D.getElementById("field_sas_add_name") || D.getElementById("field_sas_add_street");
    return el && el.closest ? el.closest("form") : null;
  }
  function setUpPageAddForm(form, undo) {
    var f = function (k) { return D.getElementById("field_sas_add_" + k); };
    var street = f("street"), city = f("city"), state = f("state"), zip = f("zip"), note = f("note");
    var real = { county: f("county"), lat: f("lat"), lng: f("lng") };
    var submit = form.querySelector(".frm_submit button, .frm_submit input[type=submit]");
    if (!f("name") || !street || !city || !state || !form.querySelector(".frm_fields_container") || !submit) return false;
    var holder = form.closest(".frm_forms"), holderId = holder && /^frm_form_(\d+)_container$/.exec(holder.id || "");

    function mark(el, cls) {
      if (!el || el.classList.contains(cls)) return;
      el.classList.add(cls);
      undo.add(function () { el.classList.remove(cls); });
    }
    function attr(el, name, to) {
      var was = el.getAttribute(name);
      el.setAttribute(name, to);
      undo.add(function () { if (was == null) el.removeAttribute(name); else el.setAttribute(name, was); });
    }
    mark(form, "sas-nf");
    mark(box(city), "sas-nf-city"); mark(box(state), "sas-nf-state"); mark(box(zip), "sas-nf-zip");
    attr(street, "autocomplete", "off");
    // (an empty placeholder keeps Google's suggestion box from writing "Enter a location" into the street box)
    if (!street.hasAttribute("placeholder")) attr(street, "placeholder", "");
    if (zip) {
      attr(zip, "inputmode", "numeric");
      if (!zip.hasAttribute("maxlength")) attr(zip, "maxlength", "10");
    }
    // (the name boxes show only while sign-in is switched off; Formidable gives them no autofill hint of its own)
    if (f("first") && !f("first").hasAttribute("autocomplete")) attr(f("first"), "autocomplete", "given-name");
    if (f("last") && !f("last").hasAttribute("autocomplete")) attr(f("last"), "autocomplete", "family-name");
    if (note && !note.hasAttribute("aria-label")) { // its label may be switched off in the form builder
      var noteLabel = D.getElementById("field_sas_add_note_label");
      attr(note, "aria-label", (noteLabel ? noteLabel.textContent.replace(/\*/g, "").replace(/\s+/g, " ").trim() : "") || "Comments");
    }
    // Capacity reads as in the app. (The form keeps the choices as words, because "<25" does not survive a WordPress
    // form field; formidable.php reads the words.)
    var SHORT = { "under 25": "<25", "under 50": "<50", "50 or more": "50+" };
    Array.prototype.forEach.call(form.querySelectorAll('input[type=radio][id^="field_sas_add_capacity-"]'), function (r) {
      var to = SHORT[String(r.value).trim().toLowerCase()], label = r.closest("label"), n;
      if (!to || !label) return;
      for (n = label.lastChild; n; n = n.previousSibling) {
        if (n.nodeType === 3 && n.nodeValue.trim()) {
          (function (node, was) { node.nodeValue = " " + to; undo.add(function () { node.nodeValue = was; }); })(n, n.nodeValue);
          return;
        }
      }
    });

    // ----- the map pin: from the address (a suggestion, or a lookup once it is typed), or from the middle of the map
    function addressKey() { return [value(street), value(city), value(state)].join("|").toLowerCase(); }
    // by: "hand" (Use Map Center), "auto" (found from the address in `key`) or "kept" (came back with the form)
    var pin = null, by = "", key = "", county = { name: real.county ? value(real.county) : "", key: addressKey() };
    var map = null, marker = null, parked = null, started = false, hasPin = !!(real.lat && real.lng);
    var pinNote = "sasSfPin" + (holderId ? holderId[1] : "");
    if (hasPin) {
      pin = readPin(value(real.lat), value(real.lng));
      if (pin) {
        // The form came back from the server with its pin. How the pin was set is remembered in this tab, so that
        // one found from the address still follows the address, and one set by hand still stays put.
        by = "kept";
        try {
          var was = JSON.parse(W.sessionStorage.getItem(pinNote) || "null");
          if (was && was.lat === pin.lat && was.lng === pin.lng && (was.by === "hand" || was.by === "auto")) { by = was.by; key = addressKey(); }
        } catch (e) { /* private window: the pin is kept as it came */ }
      }
    }
    // (role=status: a screen reader says where the pin is when Use Map Center or the address sets it)
    var pinText = h("span", { role: "status" }, PIN_UNSET), pinButton = h("button", { type: "button", "aria-describedby": "sas-nf-pin-hint" }, "Use Map Center");
    var mapBox = h("div", { "class": "sas-nf-map" });
    var block = h("div", { "class": "sas-sf sas-nf-pin" }, h("div", { "class": "sas-sf-pin" },
      h("p", { id: "sas-nf-pin-hint" }, PAGE_PIN_HINT),
      h("div", { "class": "sas-nf-mapwrap" }, mapBox, h("div", { "class": "sas-nf-cross", "aria-hidden": "true" })),
      h("div", { "class": "sas-sf-loc" }, pinText, pinButton)));
    block.hidden = true; // until the map is there: without one, Use Map Center has nothing to go by

    function showPin(more) {
      pinText.textContent = (pin ? "Map pin: " + pin.lat.toFixed(5) + ", " + pin.lng.toFixed(5) : PIN_UNSET) + (more ? ". " + more : "");
      if (!map) return;
      if (!pin) { if (marker) { map.removeLayer(marker); marker = null; } return; }
      if (marker) marker.setLatLng([pin.lat, pin.lng]);
      else marker = W.L.marker([pin.lat, pin.lng], { icon: W.L.divIcon({ className: "sas-nf-marker", iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, keyboard: false }).addTo(map);
    }
    function view(at, zoom) { if (map) map.setView([at.lat, at.lng], zoom); else parked = [at, zoom]; }
    function sync() {
      // a pin found from an address belongs to that address: it goes when the address is changed
      if (pin && by === "auto" && key !== addressKey()) { pin = null; by = ""; showPin(); }
      if (hasPin) { real.lat.value = pin ? String(pin.lat) : ""; real.lng.value = pin ? String(pin.lng) : ""; }
      // (the county comes only from the address found, so it too is kept only while the address is that one)
      if (real.county) real.county.value = county.name && county.key === addressKey() ? county.name : "";
    }
    function startMap() {
      if (map || !W.L || !W.L.map) return;
      block.hidden = false;
      map = W.L.map(mapBox, { center: pin ? [pin.lat, pin.lng] : [39.5, -98.35], zoom: pin ? 17 : 4, scrollWheelZoom: false, worldCopyJump: true });
      W.L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
      if (map.attributionControl) map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
      if (parked) { map.setView([parked[0].lat, parked[0].lng], parked[1]); parked = null; }
      showPin();
      if (W.ResizeObserver) new W.ResizeObserver(function () { if (map) map.invalidateSize(); }).observe(mapBox);
    }
    pinButton.addEventListener("click", function () {
      if (!map) return;
      if (map.getZoom() < PIN_ZOOM) { showPin("Zoom in on the shelter first"); return; }
      var c = map.getCenter().wrap();
      pin = { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) }; by = "hand";
      showPin(); sync();
    });

    // Once the street, city and state are typed, the address is looked up (OpenStreetMap's Nominatim, once for each
    // address, never while typing): the map moves there, and when the building itself is found the pin is set on it.
    var looked = "", lookTimer = null;
    function lookUp() {
      var asked = addressKey();
      if (!hasPin || !W.fetch || !value(street) || !value(city) || !value(state) || asked === looked) return;
      looked = asked;
      W.fetch(LOOKUP + "&street=" + encodeURIComponent(value(street)) + "&city=" + encodeURIComponent(value(city)) + "&state=" + encodeURIComponent(value(state)), { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (list) {
          var hit = list && list[0], at = hit ? readPin(hit.lat, hit.lon) : null, a = (hit && hit.address) || {};
          if (!at || asked !== addressKey()) return;                  // nothing found, or the person has moved on
          var st = String(a["ISO3166-2-lvl4"] || "").replace(/^US-/, "");
          if (st && st !== value(state).toUpperCase()) return;       // a place of that name in another state
          var exact = !!a.house_number;
          if (a.county) county = { name: String(a.county).replace(/\s+(County|Parish|Borough|Census Area|Municipality)$/i, ""), key: asked };
          if (exact && zip && !value(zip) && a.postcode) zip.value = String(a.postcode).slice(0, 10);
          if (by !== "hand") { // (a pin set by hand stays where it was put, and so does the map under it)
            if (exact && by !== "kept") { pin = { lat: +at.lat.toFixed(6), lng: +at.lng.toFixed(6) }; by = "auto"; key = asked; }
            showPin(); view(at, exact ? 17 : a.road ? 16 : 13);
          }
          sync();
        })
        .catch(function () { /* the map stays where it is */ });
    }
    function onChange(e) {
      sync();
      if (e.target !== street && e.target !== city && e.target !== state) return;
      W.clearTimeout(lookTimer);
      lookTimer = W.setTimeout(lookUp, 400);
    }
    form.addEventListener("change", onChange);
    undo.add(function () { form.removeEventListener("change", onChange); W.clearTimeout(lookTimer); });

    // Google's suggestions, where the page has Google Maps or the site set a key for it: choosing one fills the
    // city, state and ZIP and sets the pin, as in the app.
    var askPlaces = suggest(street, function (p) {
      if (p.street) street.value = p.street;
      if (p.city) city.value = p.city;
      if (STATES.indexOf(p.state) >= 0) state.value = p.state;
      if (p.zip && zip) zip.value = p.zip;
      looked = addressKey(); // Google has placed it: no second lookup
      W.clearTimeout(lookTimer);
      county = { name: p.county, key: looked };
      if (p.pin && hasPin) { pin = { lat: +p.pin.lat.toFixed(6), lng: +p.pin.lng.toFixed(6) }; by = "auto"; key = looked; showPin(); view(pin, 17); }
      sync();
    }, undo, true);

    if (hasPin) {
      var after = box(zip) || box(state);
      after.parentNode.insertBefore(block, after.nextSibling);
      undo.add(function () { if (block.parentNode) block.parentNode.removeChild(block); });
      // The map is fetched when the form is in sight: right away, or once the person has signed in.
      var begin = function () {
        if (started || form.classList.contains("sas-acct-locked")) return;
        started = true;
        withLeaflet(function () { try { startMap(); } catch (e) { block.hidden = true; warn("Shelter form map:", e); } });
        askPlaces();
      };
      W.setTimeout(begin, 0); // (after the sign-in box has had its turn to put the form away)
      if (W.MutationObserver) {
        var watch = new W.MutationObserver(begin);
        watch.observe(form, { attributes: true, attributeFilter: ["class"] });
        undo.add(function () { watch.disconnect(); });
      }
    }

    // ----- the app's one line over the button when something is missing
    var msg = h("p", { "class": "sas-sf-msg", "aria-live": "polite" });
    insertBefore(msg, submit.closest(".frm_submit") || submit, undo);
    function onSubmit(e) {
      var missing = null;
      try { sync(); missing = missingRequired(form); } catch (err) { return; } // let the form go as Formidable would send it
      if (missing) {
        e.preventDefault();
        e.stopPropagation(); // Formidable listens on the document, so it never sees this try
        missing.input.setAttribute("aria-invalid", "true");
        msg.textContent = "Please add the " + missing.name + ".";
        return;
      }
      msg.textContent = "";
      if (holderId) remember(holderId[1], "own");
      try {
        if (pin && (by === "hand" || by === "auto")) W.sessionStorage.setItem(pinNote, JSON.stringify({ lat: pin.lat, lng: pin.lng, by: by }));
        else if (!pin) W.sessionStorage.removeItem(pinNote);
      } catch (err) { /* private window */ }
    }
    function onInput(e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("aria-invalid") === "true" && value(t)) t.setAttribute("aria-invalid", "false");
    }
    form.addEventListener("submit", onSubmit);
    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    undo.add(function () { form.removeEventListener("submit", onSubmit); form.removeEventListener("input", onInput); form.removeEventListener("change", onInput); });
    sync();
    return true;
  }

  // ---------- start ----------
  var FORMS = [
    { id: "form_shelter-feedback", setUp: setUpFeedbackForm },
    { id: "form_add-edit-tornado-shelter", setUp: setUpFinderAddForm, words: finderWords },
    { find: findPageAddForm, setUp: setUpPageAddForm }
  ];
  function redraw(spec) {
    var form = spec.find ? spec.find() : D.getElementById(spec.id);
    if (!form || form.classList.contains("sas-sf-on") || form.classList.contains("sas-sf-off")) return;
    var undo = Undo(), ok = false;
    try {
      form.classList.add("sas-sf-on");
      ok = spec.setUp(form, undo);
      if (ok && spec.words) spec.words(form.closest(".frm_forms") || form, undo);
    } catch (e) {
      ok = false;
      warn("Shelter form left as it was:", e);
    }
    if (!ok) { undo.run(); form.classList.remove("sas-sf-on"); form.classList.add("sas-sf-off"); }
  }
  /** After sending, Formidable shows its own message where the form was: say what the app says. */
  function thank() {
    Array.prototype.forEach.call(D.querySelectorAll(".frm_forms .frm_message"), function (el) {
      var holder = el.closest(".frm_forms"), m = holder && /^frm_form_(\d+)_container$/.exec(holder.id || ""), sent = null;
      if (!m || el.classList.contains("sas-sf-thanks")) return;
      try { sent = W.sessionStorage.getItem("sasSf" + m[1]); W.sessionStorage.removeItem("sasSf" + m[1]); } catch (e) { /* private window */ }
      var parts = String(sent || "").split("|");
      if (!(Date.now() - (+parts[1]) < 15 * 60 * 1000)) return;
      // (the Add a Shelter page's form says its own thanks, set in the form builder: only the look changes)
      if (parts[0] === "own") { el.classList.add("sas-sf-thanks"); return; }
      if (!THANKS[parts[0]]) return;
      el.textContent = "";
      el.appendChild(h("p", null, THANKS[parts[0]]));
      el.classList.add("sas-sf-thanks");
      if (m[1] === "39") finderWords(holder, Undo());
    });
  }
  // ---------- sign-in ----------
  // Adding or editing a shelter needs a signed-in account, as in the app. Each shelter form gets the sign-in box
  // whether or not it could be redrawn, because the server asks for the account either way (includes/account.php).
  var ACCOUNTS = [
    { id: "form_shelter-feedback", info: ["field_sfb_first", "field_sfb_last", "field_sfb_email"], kind: function () { return value(D.getElementById("field_sfb_orig_name")) ? "edit" : "add"; } },
    { id: "form_add-edit-tornado-shelter", info: ["field_1imzl", "field_sof1r", "field_k5ihj"], kind: function () { return "add"; } },
    { find: findPageAddForm, info: ["field_sas_add_first", "field_sas_add_last", "field_sas_add_email"], kind: function () { return "add"; } }
  ];
  function signIn() {
    var account = W.sasShelterAccount;
    if (!account || !account.gate) return;
    ACCOUNTS.forEach(function (a) {
      var form = a.find ? a.find() : D.getElementById(a.id);
      if (!form) return;
      try {
        account.gate({ form: form, kind: a.kind(), info: { first: D.getElementById(a.info[0]), last: D.getElementById(a.info[1]), email: D.getElementById(a.info[2]) } });
      } catch (e) {
        warn("Shelter form sign-in:", e);
      }
    });
  }
  function start() {
    FORMS.forEach(redraw);
    signIn();
    try { thank(); } catch (e) { /* Formidable's own message stays */ }
  }
  start();
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start);
})();
