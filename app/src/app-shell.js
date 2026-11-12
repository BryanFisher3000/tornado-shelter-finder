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

  // vendor/capacitor.js adds registerPlugin; fall back to the bridge's own plugin list just in case
  if (typeof Cap.registerPlugin !== "function") Cap.registerPlugin = function (n) { return (Cap.Plugins || {})[n]; };
  var Geo = Cap.registerPlugin("Geolocation");
  var Launcher = Cap.registerPlugin("AppLauncher");
  var Browser = Cap.registerPlugin("Browser");
  var Device = Cap.registerPlugin("Device");
  // this app's own native helpers (iPhone: SasNativePlugin.swift, Android: SasNativePlugin.java)
  var Native = Cap.registerPlugin("SasNative");
  function native(method, options) {
    if (!Native || !Native[method]) return Promise.reject(new Error("unavailable"));
    try { return Promise.resolve(Native[method](options || {})); } catch (e) { return Promise.reject(e); }
  }

  // A web page shown inside the app (iPhone): a sheet on a phone. On a wide screen, such as an unfolded
  // iPhone Duo, that "popover" style comes up as a small empty box, so there the page takes the whole screen.
  function inAppPage(url) {
    return Browser.open({ url: url, presentationStyle: window.innerWidth >= 600 ? "fullscreen" : "popover" });
  }

  // Sign-in: open the Google/Apple/Facebook page in a browser sheet; it comes back to
  // com.surviveastorm.shelterfinder://auth?code=..., which Android/iOS hand to the app.
  var AppPlugin = Cap.registerPlugin("App");
  var OAUTH_RETURN = "com.surviveastorm.shelterfinder://auth";
  window.SAS_APP.oauth = {
    redirect: OAUTH_RETURN,
    open: function (url) { return inAppPage(url); },
    onReturn: function (cb) {
      AppPlugin.addListener("appUrlOpen", function (e) {
        if (!e || !e.url || e.url.indexOf(OAUTH_RETURN) !== 0) return;
        Browser.close().catch(function () {});
        cb(e.url);
      });
    }
  };

  // Built-in Google sign-in (Android account picker / iOS Google sheet). Returns a Google ID token
  // that the page hands to Supabase (signInWithIdToken). Needs googleWebClientId in app-config.js.
  // iPhone also needs its own iOS client ID; without it Google sign-in uses the web page in a browser sheet.
  if (window.SAS_APP.googleWebClientId && (platform !== "ios" || window.SAS_APP.googleIosClientId)) {
    var Social = Cap.registerPlugin("SocialLogin");
    var socialReady = null;
    window.SAS_APP.nativeGoogle = {
      signIn: function (hashedNonce) {
        socialReady = socialReady || Social.initialize({ google: { webClientId: window.SAS_APP.googleWebClientId, iOSClientId: window.SAS_APP.googleIosClientId || undefined, iOSServerClientId: window.SAS_APP.googleWebClientId, mode: "online", skipAuthOnlyAuthorizationAfterSignIn: true } });
        return socialReady.then(function () {
          return Social.login({ provider: "google", options: { nonce: hashedNonce } });
        }).then(function (res) {
          var r = res && res.result || {};
          if (!r.idToken) throw new Error("Google didn't return a sign-in token.");
          return r.idToken;
        });
      }
    };
  }

  // Settings shows the phone model and operating system version.
  window.SAS_APP.deviceInfo = function () { return Device.getInfo(); };
  // App version and build number from the installed app (iPhone build = the TestFlight number).
  window.SAS_APP.appInfo = function () { return AppPlugin.getInfo(); };

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
  // Tornado alert pushes (Firebase Cloud Messaging). register() resolves with this phone's push token.
  var Push = Cap.registerPlugin("PushNotifications");
  // How the phone buzzes, as [wait, buzz, pause, buzz, ...] in milliseconds: a Tornado Warning is three
  // long buzzes, twice over; Warning Ended is two short ones.
  var BUZZ = {
    "tornado-alarm": [0, 900, 300, 900, 300, 900, 900, 900, 300, 900, 300, 900],
    "tornado-ended": [0, 250, 200, 250]
  };
  var pushTap = [], pushPending = [];
  if (Push && Push.addListener) {
    // tapped a notification (the app may have been closed): hand its data to the page
    Push.addListener("pushNotificationActionPerformed", function (a) {
      var d = (a && a.notification && a.notification.data) || {};
      if (pushTap.length) pushTap.forEach(function (f) { f(d, false); }); else pushPending.push(d);
    });
    // arrived while the app is open
    Push.addListener("pushNotificationReceived", function (n) { var d = (n && n.data) || {}; pushTap.forEach(function (f) { f(d, true); }); });
  }
  window.SAS_APP.push = !Push ? null : {
    register: function () {
      return Push.requestPermissions().then(function (p) {
        if (p.receive !== "granted") throw new Error("denied");
        // Android channels: warnings are urgent (siren + heads-up), "warning ended" has its own chime, watches are normal.
        // A channel's sound can't change after it's made, so a new sound means a new id; the old ones are removed.
        var ch = Push.createChannel ? Promise.all([
          Push.createChannel({ id: "tornado-alarm", name: "Tornado Warnings", description: "A tornado warning at your location, Home or Work", importance: 5, visibility: 1, vibration: true, lights: true, lightColor: "#D0021B", sound: "tornado_alarm.mp3" }),
          Push.createChannel({ id: "tornado-watches", name: "Tornado Watches", description: "Conditions are right for tornadoes", importance: 4, visibility: 1 }),
          Push.createChannel({ id: "tornado-ended", name: "Warning Ended", description: "A tornado warning you were sent has ended", importance: 4, visibility: 1, sound: "tornado_ended.mp3" }),
          // Android: the same two with their own buzz (a channel's vibration can't change either, hence "-2").
          // The alert server uses these for a phone that says it has them (alertKit below); the two above
          // stay for the server that doesn't yet.
          platform !== "android" ? null : Promise.all([
            native("createAlertChannel", { id: "tornado-alarm-2", name: "Tornado Warnings", description: "A tornado warning at your location, Home or Work", importance: 5, lightColor: "#D0021B", sound: "tornado_alarm.mp3", vibration: BUZZ["tornado-alarm"] }),
            native("createAlertChannel", { id: "tornado-ended-2", name: "Warning Ended", description: "A tornado warning you were sent has ended", importance: 4, sound: "tornado_ended.mp3", vibration: BUZZ["tornado-ended"] })
          ]).then(function () { window.SAS_APP.push.alertKit = 2; }, function () {}),
          Push.deleteChannel ? Push.deleteChannel({ id: "tornado-warnings" }).catch(function () {}) : null,
          Push.deleteChannel ? Push.deleteChannel({ id: "tornado-updates" }).catch(function () {}) : null
        ]).catch(function () {}) : Promise.resolve();
        return ch.then(function () {
          return new Promise(function (ok, no) {
            var done = false;
            Push.addListener("registration", function (t) { if (!done) { done = true; ok(t.value); } });
            Push.addListener("registrationError", function (e) { if (!done) { done = true; no(new Error(e && e.error || "registration failed")); } });
            Push.register();
            setTimeout(function () { if (!done) { done = true; no(new Error("timeout")); } }, 20000);
          });
        });
      });
    },
    onTap: function (f) { pushTap.push(f); pushPending.splice(0).forEach(function (d) { f(d, false); }); },
    // Which set of alert sounds and buzzes this phone has, told to the alert server when the phone
    // registers (2: the Android channels with their own buzz, set once they exist).
    alertKit: 0,
    // Buzzes the phone for an alert that arrives while the app is open: "tornado-alarm" or "tornado-ended".
    // (A closed app gets the notification's own buzz: the channel's on Android, the standard one on iPhone.)
    buzz: function (name) { if (BUZZ[name]) native("vibrate", { pattern: BUZZ[name] }).catch(function () {}); },
    // the data of the alert notifications still listed on the phone (iPhone keeps a warning's notification
    // next to its "Warning Ended" one; Android replaces it)
    delivered: function () {
      if (!Push.getDeliveredNotifications) return Promise.resolve([]);
      return Push.getDeliveredNotifications().then(function (r) {
        return ((r && r.notifications) || []).map(function (n) { return (n && n.data) || {}; });
      }, function () { return []; });
    }
  };

  // The clock and battery at the top of the screen, for the look picked in Settings > Appearance:
  // "dark" makes them white (the strip behind them is dark), "light" dark, anything else follows the phone.
  var StatusBar = Cap.registerPlugin("StatusBar");
  window.SAS_APP.statusText = function (theme) {
    if (!StatusBar || !StatusBar.setStyle) return;
    try { Promise.resolve(StatusBar.setStyle({ style: theme === "dark" ? "DARK" : theme === "light" ? "LIGHT" : "DEFAULT" })).catch(function () {}); } catch (e) {}
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
  // iPhone answers "yes" for maps:// even after Apple Maps has been removed from the phone, so the
  // only way to learn that it is missing is a Directions tap that fails to open it (openAppleMaps
  // below). That is remembered until the next app version, in case Maps has been put back.
  // ("/u": found out the quiet way, see openAppleMaps; a phone marked by the older maps:// check is asked once more.)
  var NO_APPLE = "sas.noAppleMaps", noAppleTag = JSON.stringify(String(window.SAS_APP.version || "") + "/u");
  var appleGoneNow = false;
  function appleGone() {
    if (appleGoneNow) return true;
    try { return localStorage.getItem(NO_APPLE) === noAppleTag; } catch (e) { return false; }
  }
  function markAppleGone() {
    appleGoneNow = true;
    try { localStorage.setItem(NO_APPLE, noAppleTag); } catch (e) {}
    try { document.dispatchEvent(new Event("sas:mapapps")); } catch (e) {}   // the page redraws its list of map apps
  }
  window.SAS_APP.mapApps = function () {
    if (platform === "ios") {
      return Promise.all([has("maps://"), has("comgooglemaps://"), has("waze://")]).then(function (r) {
        var ids = (r[0] && !appleGone() ? ["apple"] : []).concat(r[1] ? ["google"] : [], r[2] ? ["waze"] : []);
        // no map app at all: Directions opens the Google Maps website in the browser
        return ids.length ? ids : ["google"];
      });
    }
    return Promise.all([has("com.google.android.apps.maps"), has("com.waze")]).then(function (r) {
      return (r[0] ? ["google"] : []).concat(r[1] ? ["waze"] : [], ["geo"]);
    });
  };

  var MAPS = /^https:\/\/(maps\.apple\.com|www\.google\.com\/maps|maps\.google\.com|waze\.com\/ul)/;
  var MAP_LINK = /^(geo|maps|comgooglemaps|waze):/;
  // On iPhone a Google Maps web link would open Safari; send it to the Google Maps app instead.
  function iosGoogleMaps(url) {
    var m = url.match(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=([^&]+)(?:&origin=([^&]+))?/);
    return m ? "comgooglemaps://?daddr=" + m[1] + (m[2] ? "&saddr=" + m[2] : "") + "&directionsmode=driving" : null;
  }
  // Apple Maps links go to the Maps app itself (maps://), never to the maps.apple.com web page: on a
  // phone without the Maps app that page opens in the browser and leads to the App Store, not to directions.
  function iosAppleMaps(url) {
    var m = url.match(/^https:\/\/maps\.apple\.com\/?\?(.*)$/);
    return m ? "maps://?" + m[1] : null;
  }
  // true: another app opened it. false: the phone says nothing on it can open this. null: the request itself failed.
  function tryOpen(url) {
    return Launcher.openUrl({ url: url }).then(function (r) { return !(r && r.completed === false); }, function () { return null; });
  }
  // A link meant for another app: its app link first where there is one (iPhone), then the link
  // itself, then a browser sheet for web links. Resolves true when another app took it.
  function openApp(url, app) {
    return (app ? tryOpen(app) : Promise.resolve(false)).then(function (ok) {
      return ok || tryOpen(url);
    }).then(function (ok) {
      if (!ok && /^https:/.test(url)) Browser.open({ url: url }).catch(function () {});
      return !!ok;
    });
  }
  // true: the app that owns this https link opened it. false: no app on the phone took it, and the
  // phone showed nothing. null: this build has no such helper.
  function openInOwnApp(url) {
    return native("openUniversalLink", { url: url }).then(function (r) { return !!(r && r.completed); }, function () { return null; });
  }
  // Apple Maps, or on a phone that turns out not to have it, the same destination in a map app it does have.
  function openAppleMaps(app, url) {
    var dest = (url.match(/[?&]daddr=([^&]+)/) || [])[1];
    function other() {
      if (!dest) return Promise.resolve(false);
      return window.SAS_APP.mapApps().then(function (ids) {
        ids = ids.filter(function (id) { return id !== "apple"; });
        return openMapLink(ids[0] === "waze" ? "https://waze.com/ul?ll=" + dest + "&navigate=yes"
          : "https://www.google.com/maps/dir/?api=1&destination=" + dest);
      });
    }
    if (appleGone()) return other();   // a Directions link drawn before the list of map apps changed
    // "Nothing can open it" while this app is on screen means Apple Maps is not on the phone.
    // It only counts once another map link does open: when nothing opens, the phone is blocking
    // the switch to other apps and Apple Maps may well be there.
    function elsewhere(missing) {
      missing = missing && document.visibilityState === "visible";
      return other().then(function (opened) { if (missing && opened) markAppleGone(); return opened; });
    }
    // The quiet way first: hand the maps.apple.com link to the Maps app only. Without Maps the phone
    // just answers no. Opening maps:// there makes iPhone put up its own "Restore Maps?" box, so that
    // is left for a build without the helper.
    return openInOwnApp(url).then(function (ok) {
      if (ok) return true;
      if (ok === false) return elsewhere(true);
      return tryOpen(app).then(function (ok2) { return ok2 ? true : elsewhere(ok2 === false); });
    });
  }
  function openMapLink(url) {
    if (platform !== "ios") return openApp(url);
    var apple = iosAppleMaps(url);
    return apple ? openAppleMaps(apple, url) : openApp(url, iosGoogleMaps(url));
  }
  var lastMapTap = 0;
  function openExternal(url) {
    if (MAP_LINK.test(url) || MAPS.test(url)) {
      // a second tap while the first is still switching apps would fail and look like a missing app
      var now = Date.now();
      if (now - lastMapTap < 1500) return Promise.resolve(false);
      lastMapTap = now;
      return openMapLink(url);
    }
    if (/^(mailto|tel|sms):/.test(url)) return openApp(url);
    return inAppPage(url);
  }

  // Google street map (Maps SDK for Android, free for apps). The Google map is drawn by Android
  // *behind* the page; the page's own map (shelter dots, radar, warning outlines) stays on top
  // with a see-through background and handles every touch, and the Google map follows it.
  // Only when a Maps key is set in app-config.js (googleMapsKey); otherwise the page keeps its own tiles.
  var GMaps = Cap.registerPlugin("CapacitorGoogleMaps");
  if (window.SAS_APP.googleMapsKey && platform === "android") window.SAS_APP.nativeMap = function (el, lmap) {
    var id = "sas-base", pad = 0, raf = 0, ready = false;
    var rect = function () { var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    // with bottom padding (so Google's logo sits above the tray) Google centres on the area above the
    // padding, so aim it at the point that is that far above the middle of the page's map
    var aim = function (center, zoom) { var p = lmap.project(center, zoom).subtract([0, pad / 2]); return lmap.unproject(p, zoom); };
    var cam = function (animate, center, zoom) {
      if (!ready) return;
      zoom = zoom == null ? lmap.getZoom() : zoom;
      var c = aim(center || lmap.getCenter(), zoom);
      GMaps.setCamera({ id: id, config: { coordinate: { lat: c.lat, lng: c.lng }, zoom: zoom, animate: !!animate, animationDuration: 250 } }).catch(function () {});
    };
    var follow = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; cam(false); }); };
    var r = rect(), c0 = lmap.getCenter();
    document.documentElement.classList.add("gmap");
    // create() returns before Google has finished building the map; calls made before "onMapReady" are dropped
    var mapReady = new Promise(function (res) {
      Promise.resolve(GMaps.addListener("onMapReady", function (d) { if (!d || !d.mapId || d.mapId === id) res(); })).catch(function () {});
      setTimeout(res, 15000);
    });
    return GMaps.create({ id: id, apiKey: window.SAS_APP.googleMapsKey, forceCreate: true, element: {},
      config: { x: r.x, y: r.y, width: r.width, height: r.height, center: { lat: c0.lat, lng: c0.lng }, zoom: Math.round(lmap.getZoom()),
        minZoom: 3, maxZoom: 20, devicePixelRatio: window.devicePixelRatio || 1, androidLiteMode: false,
        disableDefaultUI: true, mapTypeId: "roadmap" } })
      .then(function () { return mapReady; })
      .then(function () { return GMaps.disableTouch({ id: id }); })
      .then(function () {
        ready = true;
        lmap.on("move zoom viewreset resize", follow);
        lmap.on("zoomanim", function (e) { cam(true, e.center, e.zoom); });
        if (window.ResizeObserver) new ResizeObserver(function () { GMaps.onResize({ id: id, mapBounds: rect() }).catch(function () {}); follow(); }).observe(el);
        cam(false);
        return {
          // bottom of the map hidden by the tray, in page pixels
          setBottom: function (px) {
            px = Math.max(0, Math.round(px)); if (Math.abs(px - pad) < 2) return;
            pad = px;
            // Google's padding is in screen pixels, the page's in CSS pixels
            GMaps.setPadding({ id: id, padding: { top: 0, left: 0, right: 0, bottom: Math.round(pad * (window.devicePixelRatio || 1)) } }).then(follow).catch(function () { pad = -10; });
          }
        };
      })
      .catch(function (e) {
        document.documentElement.classList.remove("gmap");
        try { console.warn("Google map unavailable", e && e.message); } catch (x) {}
        return null;
      });
  };

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
