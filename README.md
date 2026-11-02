# Survive-A-Storm Tornado Shelter Finder

A website and a phone app (iOS and Android) that show the same tornado shelter results.

| Folder | What it is |
|---|---|
| `website/` | The shelter finder web page, shared data layer (`shelter-core.js`) and shelter list (`data/shelters.json`, built from the cleaned Location tab of the SAS Shelter Finder Data sheet by `website/tools/build_shelters.py`). |
| `app/` | Capacitor app that wraps the website page in native iOS and Android shells. See `app/README.md`. |
| `.github/workflows/android-build.yml` | Builds a test APK on every push; download it from the run's Artifacts. |
