/* App settings read by the shared shelter finder page (website/src/index.html).
 * apiBase: set to the shared API's address (e.g. "https://api.survive-a-storm.com")
 * once it is live. Until then the app uses the shelter list bundled inside it,
 * and feedback goes out as a pre-filled email to app@survive-a-storm.com. */
window.SAS_APP = {
  name: "Shelter Finder app __VERSION__",
  version: "__VERSION__",
  apiBase: null,
  // Google "Web application" OAuth client ID (public). With it, Google sign-in uses the phone's
  // own account picker ("Sign in to Tornado Shelter Finder") instead of a web page.
  googleWebClientId: "285055757005-3a83pb9nloo4mhe0o26pb1n9qufk2t01.apps.googleusercontent.com",
  // Google Maps key "Shelter Finder Android maps" (GCP project sas-public-shelter-locations; Maps SDK for Android,
  // restricted to this package + the debug SHA-1; add the release SHA-1 before the store build).
  // It ships inside the app like any map key, but is never committed: leave this empty. `npm run build`
  // fills it in www/ from SAS_GOOGLE_MAPS_KEY or app/google-keys.json (gitignored; copy
  // google-keys.example.json), and the Android build reads the same source (android/app/build.gradle).
  // Empty = the app keeps the free OpenStreetMap tiles, which are fine for testing but not for a store release.
  googleMapsKey: "",
  // Google key "Shelter Finder Places" (GCP project sas-public-shelter-locations; Places API (New) only) for
  // address suggestions in Add a Shelter. Never committed: filled at build time from SAS_GOOGLE_PLACES_KEY
  // or app/google-keys.json, like googleMapsKey.
  // Empty = Street Address stays a plain text box.
  googlePlacesKey: ""
};
