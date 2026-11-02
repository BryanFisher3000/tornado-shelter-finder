/*
 * shelter-core.js — the shared shelter data layer.
 *
 * Plain JavaScript with no DOM or browser dependencies, so the same file runs in
 * the website, a React Native / Expo or Flutter-webview app, or a Node API
 * server. Loads as a browser global (window.ShelterCore), CommonJS, or AMD.
 *
 * Records use the public shelter shape from the "Shelter Data Model & API Spec":
 *   { id, name, location:{lat,lng}, address:{line,city,county,state,zip},
 *     capacity:{min,label}, ada_accessible, pets_allowed (yes|no|unknown),
 *     availability (always|emergencies_only), access, notes,
 *     verification_status, status (active|retired), version }
 *
 * Two stores share one interface, so a client never knows which it has:
 *   createLocalStore(shelters)  — searches an in-memory list (shelters.json)
 *   createRemoteStore(baseUrl)  — calls GET /v1/shelters on the real API
 * Both expose:
 *   query({lat, lng, radius_mi, limit, ada, pets, availability}) → Promise<[shelter + distance_mi]>
 *   geocode(text) → Promise<{lat, lng, label} | null>
 *   get(id) → Promise<shelter | null>
 */
(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShelterCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EARTH_RADIUS_MI = 3958.8;
  var FEEDBACK_EMAIL = "app@survive-a-storm.com";
  var STORE_URL = "https://survive-a-storm.com/store";

  var STATE_NAMES = {
    AL: "Alabama", AR: "Arkansas", CO: "Colorado", FL: "Florida", GA: "Georgia", IA: "Iowa",
    IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
    MI: "Michigan", MN: "Minnesota", MO: "Missouri", MS: "Mississippi", NC: "North Carolina", ND: "North Dakota",
    NE: "Nebraska", NM: "New Mexico", OH: "Ohio", OK: "Oklahoma", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", VA: "Virginia", WI: "Wisconsin"
  };

  function toRad(d) { return (d * Math.PI) / 180; }

  /** Great-circle distance in miles between two {lat, lng} points. */
  function distanceMiles(a, b) {
    var dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function formatMiles(mi) {
    if (mi == null) return "";
    return (mi < 100 ? mi.toFixed(1) : Math.round(mi).toLocaleString("en-US")) + " mi";
  }

  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }

  function addPoint(map, key, loc, label) {
    if (!key) return;
    var e = map[key] || (map[key] = { lat: 0, lng: 0, n: 0, label: label });
    e.lat += loc.lat; e.lng += loc.lng; e.n++;
  }

  function centroid(e) { return !e ? null : { lat: e.lat / e.n, lng: e.lng / e.n, label: e.label }; }

  function matches(s, f) {
    if (f.ada && s.ada_accessible !== "yes") return false;
    if (f.pets && s.pets_allowed !== "yes") return false;
    if (f.availability && s.availability !== f.availability) return false;
    if (f.state && s.address.state !== f.state) return false;
    return true;
  }

  /**
   * Store over an in-memory list. `options.geocoder` is an optional async
   * (text) → {lat, lng, label} | null, used for searches the data itself
   * can't place, such as a street address.
   */
  function createLocalStore(shelters, options) {
    options = options || {};
    var byId = {}, zips = {}, zip3 = {}, cities = {}, cityOnly = {}, states = {};
    shelters.forEach(function (s) {
      byId[s.id] = s;
      var a = s.address, z = a.zip || "", st = a.state.toLowerCase();
      var cityLabel = a.city + ", " + a.state, ck = norm(a.city) + "|" + st;
      addPoint(zips, z, s.location, z + (a.city ? " (" + cityLabel + ")" : ""));
      addPoint(zip3, z.slice(0, 3), s.location, "ZIP " + z.slice(0, 3) + "xx area");
      addPoint(cities, ck, s.location, cityLabel);
      addPoint(states, st, s.location, STATE_NAMES[a.state] || a.state);
      // a bare city name resolves to the state with the most shelters in a city of that name
      var cn = norm(a.city);
      if (!cityOnly[cn] || cities[cityOnly[cn]].n < cities[ck].n) cityOnly[cn] = ck;
    });

    /** Resolve "67212", "Wichita, KS", "Wichita KS", "Moore, Oklahoma", "Kansas" or "37.7, -97.3". */
    function geocodeLocal(text) {
      var q = String(text || "").trim();
      if (!q) return null;
      var ll = q.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
      if (ll) return { lat: +ll[1], lng: +ll[2], label: (+ll[1]).toFixed(4) + ", " + (+ll[2]).toFixed(4) };
      var zip = q.match(/\b(\d{5})(?:-\d{4})?\b/);
      if (zip) return centroid(zips[zip[1]]) || centroid(zip3[zip[1].slice(0, 3)]);
      var n = norm(q), parts = n.split(" "), last = parts[parts.length - 1];
      var stateCode = null, cityPart = n;
      if (last.length === 2 && states[last]) { stateCode = last; cityPart = parts.slice(0, -1).join(" "); }
      else {
        for (var code in STATE_NAMES) {
          var nm = norm(STATE_NAMES[code]);
          if (n === nm || n.slice(-nm.length - 1) === " " + nm) {
            stateCode = code.toLowerCase(); cityPart = n.slice(0, n.length - nm.length).trim(); break;
          }
        }
      }
      if (stateCode && cityPart) return centroid(cities[cityPart + "|" + stateCode]);
      if (stateCode) return centroid(states[stateCode]);
      return cityOnly[n] ? centroid(cities[cityOnly[n]]) : null;
    }

    /** Same filters and ordering as GET /v1/shelters?lat=&lng=&radius_mi=&limit= */
    function querySync(p) {
      p = p || {};
      var origin = { lat: +p.lat, lng: +p.lng }, limit = p.limit || 50,
        radius = p.radius_mi || Infinity, out = [];
      for (var i = 0; i < shelters.length; i++) {
        var s = shelters[i];
        if (s.status !== "active" || !matches(s, p)) continue;
        var mi = distanceMiles(origin, s.location);
        if (mi <= radius) out.push({ s: s, mi: mi });
      }
      out.sort(function (a, b) { return a.mi - b.mi; });
      return out.slice(0, limit).map(function (r) {
        var copy = Object.assign({}, r.s);
        copy.distance_mi = Math.round(r.mi * 10) / 10;
        return copy;
      });
    }

    return {
      count: shelters.length,
      all: function () { return shelters; },
      get: function (id) { return Promise.resolve(byId[id] || null); },
      getSync: function (id) { return byId[id] || null; },
      geocodeLocal: geocodeLocal,
      geocode: function (text) {
        var hit = geocodeLocal(text);
        if (hit || !options.geocoder) return Promise.resolve(hit);
        return Promise.resolve().then(function () { return options.geocoder(text); }).catch(function () { return null; });
      },
      query: function (p) { return Promise.resolve(querySync(p)); },
      querySync: querySync
    };
  }

  /** The same interface against the real API from the spec. */
  function createRemoteStore(baseUrl, fetchImpl) {
    var f = fetchImpl || fetch;
    function get(path) {
      return f(baseUrl.replace(/\/$/, "") + path).then(function (r) {
        if (!r.ok) throw new Error("Shelter API " + r.status);
        return r.json();
      });
    }
    function qs(p) {
      return Object.keys(p).filter(function (k) { return p[k] != null && p[k] !== false; })
        .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(p[k] === true ? "yes" : p[k]); }).join("&");
    }
    return {
      get: function (id) { return get("/v1/shelters/" + encodeURIComponent(id)); },
      query: function (p) { return get("/v1/shelters?" + qs(p)); },
      geocode: function (text) { return get("/v1/geocode?" + qs({ q: text })).catch(function () { return null; }); }
    };
  }

  function fullAddress(s) {
    var a = s.address;
    return [a.line, a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }

  /** Directions in the chosen maps app ("google" | "apple"), as the layout spec describes. */
  function directionsUrl(s, provider, from) {
    var dest = encodeURIComponent(s.address.line ? fullAddress(s) : s.location.lat + "," + s.location.lng);
    if (provider === "apple") {
      return "https://maps.apple.com/?daddr=" + dest + (from ? "&saddr=" + from.lat + "," + from.lng : "");
    }
    return "https://www.google.com/maps/dir/?api=1&destination=" + dest +
      (from ? "&origin=" + from.lat + "," + from.lng : "");
  }

  /** The app's three feedback checkboxes, keyed by the spec's report_reasons values. */
  var REPORT_REASONS = {
    address_wrong: "Address is wrong",
    no_shelter: "No shelter at this location",
    not_public: "Not a public shelter"
  };

  /**
   * A Submission (kind "report") in the spec's shape, plus the email the
   * layout spec asks for, pre-filled with the shelter's data.
   */
  function buildReport(s, reasons, comment, device) {
    var submission = {
      kind: s ? "report" : "general",
      shelter_id: s ? s.id : null,
      base_version: s ? s.version : null,
      report_reasons: reasons || [],
      comment: comment || "",
      submitter_device: device || "",
      channel: "web"
    };
    var lines = s ? [
      "Shelter: " + s.name,
      "Address: " + fullAddress(s),
      "Shelter ID: " + s.id + " (version " + s.version + ")",
      "Coordinates: " + s.location.lat + ", " + s.location.lng,
      "",
      "Issues: " + ((reasons || []).map(function (r) { return REPORT_REASONS[r] || r; }).join("; ") || "None selected"),
      ""
    ] : [];
    lines.push("Comments:", comment || "(none)", "", "Sent from: " + (device || "Shelter Finder website"));
    var subject = s ? "Shelter feedback: " + s.name + " (" + s.address.city + ", " + s.address.state + ")"
      : "Shelter Finder feedback";
    var body = lines.join("\n");
    return {
      submission: submission,
      email: {
        to: FEEDBACK_EMAIL, subject: subject, body: body,
        mailto: "mailto:" + FEEDBACK_EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body)
      }
    };
  }

  function amenityLabels(s) {
    var out = [];
    if (s.ada_accessible === "yes") out.push("ADA accessible");
    else if (s.ada_accessible === "no") out.push("Not ADA accessible");
    if (s.pets_allowed === "yes") out.push("Pets allowed");
    else if (s.pets_allowed === "no") out.push("No pets");
    out.push(s.availability === "always" ? "Always open" : "Opens in emergencies");
    if (s.access === "registration_required") out.push("Registration required");
    else if (s.access === "restricted") out.push("Restricted access");
    return out;
  }

  return {
    createLocalStore: createLocalStore,
    createRemoteStore: createRemoteStore,
    distanceMiles: distanceMiles,
    formatMiles: formatMiles,
    fullAddress: fullAddress,
    directionsUrl: directionsUrl,
    buildReport: buildReport,
    amenityLabels: amenityLabels,
    REPORT_REASONS: REPORT_REASONS,
    FEEDBACK_EMAIL: FEEDBACK_EMAIL,
    STORE_URL: STORE_URL
  };
});
