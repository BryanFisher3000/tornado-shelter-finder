# Shelter Finder app (iPhone and Android)

The Survive-A-Storm Tornado Shelter Finder as a phone app. It is built from the
website's own page (`../website/src/index.html`), shared data layer
(`../website/shelter-core.js`) and shelter list (`../website/data/shelters.json`),
so the app and the website always show the same shelters, search, map and feedback.
Capacitor wraps that page in a native iOS and Android shell.

## What's app-specific

| File | Purpose |
|---|---|
| `tools/build-www.mjs` | Builds `www/` from the website: bundles Leaflet, the map outline, the fonts and the shelter list so the app works with no signal. Fails loudly if the website page changes shape. |
| `src/app-config.js` | App name/version and `apiBase`. Leave `apiBase` null until the shared API is live; then set it and the app loads shelters from `GET /v1/shelters/snapshot` (falling back to the bundled list offline) and posts feedback to `POST /v1/submissions` so it lands in the review dashboard. |
| `src/app-shell.js` | Native glue: location through the phone's permission prompt, Directions in Google/Apple Maps, Feedback in the email app, Store in an in-app browser sheet, and submissions tagged `channel: ios / android`. Does nothing in a normal browser. |
| `src/app.css` | Keeps the header clear of the notch and status bar. |
| `assets/` | Icon and splash sources, taken from the current app. `npm run assets` regenerates every size. |

App ID `com.surviveastorm.shelterfinder`, version 2.0.0 (Android versionCode 2,
one above the current Flutter APK `com.dev.tornado` 1.0.0). To publish as an
update to the existing Play/App Store listing instead of a new one, change
`appId` in `capacitor.config.json` and the Android/iOS bundle IDs to the
listing's ID, and sign with that listing's upload key.

## Build

Needs Node 20+. Android needs Android Studio; iPhone needs a Mac with Xcode.

```
npm install
npm run android     # build www/, sync, open Android Studio → Run on a phone or emulator
npm run ios         # same for Xcode (Mac only)
npm run apk         # command-line test APK → android/app/build/outputs/apk/debug/app-debug.apk
```

After changing the website, run `npm run sync` and rebuild; nothing in the
app needs editing.

`ci/android-build.yml` is a GitHub Actions workflow that builds a test APK on
every push once the code is in a repo.

## Before store release

- Street map tiles currently come from openstreetmap.org, whose usage policy
  doesn't allow app-scale traffic. Switch to a tile plan (MapTiler, Stadia,
  Mapbox) or the Google/Apple map provider before launch. With no signal the
  map still shows the bundled state and county outline.
- Google Play: $25 one-time developer account; App Store: $99/year Apple
  Developer Program. Both need a privacy policy URL (the app reads location
  only on the device and sends nothing unless the person sends feedback).
