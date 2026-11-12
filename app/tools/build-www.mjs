// Builds www/ (what ships inside the app) from the website's source, so the
// app and the website always show the same shelters, search and map.
//   node tools/build-www.mjs [path/to/website]   (default ../website)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const site = path.resolve(root, process.argv[2] || "../website");
const www = path.join(root, "www");
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const mod = (p) => require.resolve(p);

fs.rmSync(www, { recursive: true, force: true });
for (const d of ["data", "vendor", "fonts", "media"]) fs.mkdirSync(path.join(www, d), { recursive: true });

// fonts the page uses (Barlow Condensed 700/800, Barlow Semi Condensed 300–600), bundled for offline use
let fontCss = "";
for (const [fam, pkgName, weights] of [
  ["Barlow Condensed", "barlow-condensed", [700, 800]],
  ["Barlow Semi Condensed", "barlow-semi-condensed", [300, 400, 500, 600]],
]) {
  const dir = path.join(path.dirname(mod(`@fontsource/${pkgName}/package.json`)), "files");
  for (const w of weights) {
    const f = `${pkgName}-latin-${w}-normal.woff2`;
    fs.copyFileSync(path.join(dir, f), path.join(www, "fonts", f));
    fontCss += `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${f}) format("woff2")}\n`;
  }
}
fs.writeFileSync(path.join(www, "fonts.css"), fontCss);

fs.copyFileSync(mod("leaflet/dist/leaflet.js"), path.join(www, "vendor/leaflet.js"));
fs.copyFileSync(path.join(path.dirname(mod("topojson-client/package.json")), "dist/topojson-client.min.js"), path.join(www, "vendor/topojson-client.min.js"));
fs.copyFileSync(path.join(path.dirname(mod("@supabase/supabase-js/package.json")), "dist/umd/supabase.js"), path.join(www, "vendor/supabase.js"));
// Capacitor's JS runtime: gives window.Capacitor.registerPlugin, which app-shell.js uses for every native plugin
fs.copyFileSync(path.join(path.dirname(mod("@capacitor/core/package.json")), "dist/capacitor.js"), path.join(www, "vendor/capacitor.js"));
fs.copyFileSync(path.join(site, "shelter-core.js"), path.join(www, "shelter-core.js"));
for (const f of fs.readdirSync(path.join(site, "data"))) fs.copyFileSync(path.join(site, "data", f), path.join(www, "data", f));
// startup tornado loop (video + still frame)
for (const f of fs.readdirSync(path.join(site, "media"))) fs.copyFileSync(path.join(site, "media", f), path.join(www, "media", f));
// Google keys are never committed: src/app-config.js leaves them empty and they are filled in here from
// SAS_GOOGLE_MAPS_KEY / SAS_GOOGLE_PLACES_KEY, else app/google-keys.json (gitignored; see google-keys.example.json).
// android/app/build.gradle reads the Maps key from the same two places.
const keyFile = path.join(root, "google-keys.json");
const fileKeys = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, "utf8")) : {};
const keys = {
  googleMapsKey: process.env.SAS_GOOGLE_MAPS_KEY || fileKeys.googleMapsKey || "",
  googlePlacesKey: process.env.SAS_GOOGLE_PLACES_KEY || fileKeys.googlePlacesKey || "",
};
let appConfig = fs.readFileSync(path.join(root, "src/app-config.js"), "utf8").replaceAll("__VERSION__", pkg.version);
for (const [name, value] of Object.entries(keys)) {
  const re = new RegExp(`(${name}:\\s*)"[^"]*"`);
  if (!re.test(appConfig)) throw new Error(`src/app-config.js changed; can't find ${name}`);
  appConfig = appConfig.replace(re, (_, lead) => lead + JSON.stringify(value));
}
fs.writeFileSync(path.join(www, "app-config.js"), appConfig);
for (const [name, value] of Object.entries(keys)) if (!value) console.warn(`note: no ${name} set (SAS_GOOGLE_* env var or google-keys.json); that feature stays off`);
for (const f of ["app-shell.js", "app.css"]) fs.copyFileSync(path.join(root, "src", f), path.join(www, f));

// The app ships the phone screen (src/mobile.html, version 2). SAS_PAGE=index.html builds the v1 page instead.
const page = process.env.SAS_PAGE || "mobile.html";
let html = fs.readFileSync(path.join(site, "src", page), "utf8");
const logo = "data:image/png;base64," + fs.readFileSync(path.join(site, "tools/logo.png")).toString("base64");
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error("website page changed; can't find: " + from.slice(0, 80));
  html = html.replace(from, to);
};
html = html.replaceAll("{{LOGO}}", logo);
swap("{{LEAFLET_CSS}}", fs.readFileSync(path.join(site, "tools/leaflet.css"), "utf8"));
html = html.replace(/<link rel="preconnect"[^>]*>\n?/g, "");
html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="fonts.css">');
swap('<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>', '<script src="vendor/leaflet.js"></script>');
swap('<script src="https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js"></script>', '<script src="vendor/topojson-client.min.js"></script>');
swap('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js"></script>', '<script src="vendor/supabase.js"></script>');
swap('<script src="shelter-core.js"></script>', '<script src="vendor/capacitor.js"></script>\n<script src="app-config.js"></script>\n<script src="app-shell.js"></script>\n<script src="shelter-core.js"></script>');
html = html.replace("By using this site you agree", "By using this app you agree");

const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="format-detection" content="telephone=no">
<meta name="theme-color" content="#F3F2F0">
`;
// the page source has no <head>/<body> wrapper of its own; its <title>/<style> go in the head
const bodyStart = html.indexOf('<svg width="0" height="0"');
if (bodyStart < 0) throw new Error("website page changed; can't find the icon sprite that starts its body");
html = head + html.slice(0, bodyStart) + '<link rel="stylesheet" href="app.css">\n</head>\n<body>\n' + html.slice(bodyStart) + "\n</body>\n</html>\n";
fs.writeFileSync(path.join(www, "index.html"), html);
console.log(`www/ built from ${site}/src/${page} (v${pkg.version})`);
