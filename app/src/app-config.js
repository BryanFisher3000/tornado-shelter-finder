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
  googleWebClientId: "285055757005-3a83pb9nloo4mhe0o26pb1n9qufk2t01.apps.googleusercontent.com"
};
