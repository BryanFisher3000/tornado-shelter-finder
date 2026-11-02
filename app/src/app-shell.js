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

  var MAPS = /^https:\/\/(maps\.apple\.com|www\.google\.com\/maps|maps\.google\.com)/;
  function openExternal(url) {
    if (/^(mailto|tel|sms|geo|maps|comgooglemaps):/.test(url) || MAPS.test(url)) {
      return Launcher.openUrl({ url: url }).catch(function () { return Browser.open({ url: url }); });
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
    if (/^(mailto|tel|sms):/.test(abs) || (/^https?:/.test(abs) && new URL(abs).origin !== location.origin)) {
      e.preventDefault();
      openExternal(abs);
    }
  }, true);
})();
