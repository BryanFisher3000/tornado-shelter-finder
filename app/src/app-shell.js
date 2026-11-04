/* Native glue for the iPhone and Android builds (Capacitor). Loaded before the
 * page script; does nothing in a normal browser. It:
 *  - tags submissions with channel "ios" or "android",
 *  - gets the device location through the native permission prompt,
 *  - opens Directions in the Maps app, Feedback in the email app, and the
 *    Store in an in-app browser sheet instead of inside the app's own view. */
(function () {
  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  var platform = Cap.getPlatform();
  window.SAS_APP = window.SAS_APP || {};
  window.SAS_APP.channel = platform;
  document.documentElement.classList.add("native", platform);

  var Geo = Cap.registerPlugin("Geolocation");
  var Launcher = Cap.registerPlugin("AppLauncher");
  var Browser = Cap.registerPlugin("Browser");
  var Device = Cap.registerPlugin("Device");

  // Sign-in: open the Google/Apple/Facebook page in a browser sheet; it comes back to
  // com.surviveastorm.shelterfinder://auth?code=..., which Android/iOS hand to the app.
  var AppPlugin = Cap.registerPlugin("App");
  var OAUTH_RETURN = "com.surviveastorm.shelterfinder://auth";
  window.SAS_APP.oauth = {
    redirect: OAUTH_RETURN,
    open: function (url) { return Browser.open({ url: url, presentationStyle: "popover" }); },
    onReturn: function (cb) {
      AppPlugin.addListener("appUrlOpen", function (e) {
        if (!e || !e.url || e.url.indexOf(OAUTH_RETURN) !== 0) return;
        Browser.close().catch(function () {});
        cb(e.url);
      });
    }
  };

  // Settings shows the phone model and operating system version.
  window.SAS_APP.deviceInfo = function () { return Device.getInfo(); };

  // Settings switches: My Location and Notifications. Each reports "granted", "denied" or "prompt".
  var Notes = Cap.registerPlugin("LocalNotifications");
  var NativeSettings = Cap.registerPlugin("NativeSettings");
  function geoState(p) { return p.location === "granted" || p.coarseLocation === "granted" ? "granted" : /^prompt/.test(p.location) ? "prompt" : "denied"; }
  function noteState(p) { return p.display === "granted" ? "granted" : /^prompt/.test(p.display) ? "prompt" : "denied"; }
  window.SAS_APP.permissions = {
    location: {
      check: function () { return Geo.checkPermissions().then(geoState); },
      request: function () { return Geo.requestPermissions({ permissions: ["location"] }).then(geoState); }
    },
    notifications: {
      check: function () { return Notes.checkPermissions().then(noteState); },
      request: function () { return Notes.requestPermissions().then(noteState); }
    }
  };
  // Opens this app's page in the phone's Settings, where a denied permission can be turned back on.
  window.SAS_APP.openAppSettings = function () {
    return NativeSettings.open({ optionAndroid: "application_details", optionIOS: "app" });
  };

  // navigator.geolocation → native plugin (asks permission the native way)
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition = function (ok, fail, opts) {
      Geo.checkPermissions().then(function (p) {
        return p.location === "granted" ? p : Geo.requestPermissions({ permissions: ["location"] });
      }).then(function (p) {
        if (p.location !== "granted" && p.coarseLocation !== "granted") throw { code: 1, message: "Location permission denied" };
        return Geo.getCurrentPosition({ enableHighAccuracy: !!(opts && opts.enableHighAccuracy), timeout: (opts && opts.timeout) || 10000, maximumAge: (opts && opts.maximumAge) || 0 });
      }).then(function (pos) {
        ok({ coords: pos.coords, timestamp: pos.timestamp });
      }).catch(function (e) { if (fail) fail({ code: e && e.code === 1 ? 1 : 2, message: String((e && e.message) || e) }); });
    };
  }

  // Directions apps this phone can open, best first; the Settings page lists only these.
  // Android checks installed packages (declared under <queries> in AndroidManifest.xml);
  // iPhone checks URL schemes (LSApplicationQueriesSchemes in Info.plist).
  function has(target) {
    return Launcher.canOpenUrl({ url: target }).then(function (r) { return !!(r && r.value); }, function () { return false; });
  }
  window.SAS_APP.mapApps = function () {
    if (platform === "ios") {
      return Promise.all([has("comgooglemaps://"), has("waze://")]).then(function (r) {
        return ["apple"].concat(r[0] ? ["google"] : [], r[1] ? ["waze"] : []);
      });
    }
    return Promise.all([has("com.google.android.apps.maps"), has("com.waze")]).then(function (r) {
      return (r[0] ? ["google"] : []).concat(r[1] ? ["waze"] : [], ["geo"]);
    });
  };

  var MAPS = /^https:\/\/(maps\.apple\.com|www\.google\.com\/maps|maps\.google\.com|waze\.com\/ul)/;
  // On iPhone a Google Maps web link would open Safari; send it to the Google Maps app instead.
  function iosGoogleMaps(url) {
    var m = url.match(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=([^&]+)(?:&origin=([^&]+))?/);
    return m ? "comgooglemaps://?daddr=" + m[1] + (m[2] ? "&saddr=" + m[2] : "") + "&directionsmode=driving" : null;
  }
  function launch(url) {
    return Launcher.openUrl({ url: url }).then(function (r) { if (r && r.completed === false) throw new Error("not opened"); });
  }
  function openExternal(url) {
    if (/^(mailto|tel|sms|geo|maps|comgooglemaps|waze):/.test(url) || MAPS.test(url)) {
      var app = platform === "ios" && iosGoogleMaps(url);
      return (app ? launch(app).catch(function () { return launch(url); }) : launch(url))
        .catch(function () { return /^https:/.test(url) ? Browser.open({ url: url }) : null; });
    }
    return Browser.open({ url: url, presentationStyle: "popover" });
  }
  window.open = function (url) { if (url) openExternal(String(url)); return null; };
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) === "#" || /^javascript:/.test(href)) return;
    var abs = a.href;
    if (/^(mailto|tel|sms|geo):/.test(abs) || (/^https?:/.test(abs) && new URL(abs).origin !== location.origin)) {
      e.preventDefault();
      openExternal(abs);
    }
  }, true);
})();
