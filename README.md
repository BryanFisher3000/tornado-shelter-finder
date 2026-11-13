# Survive-A-Storm Tornado Shelter Finder

A website and a phone app (iOS and Android) that show the same tornado shelter results.

| Folder | What it is |
|---|---|
| `website/` | The shelter finder web page, shared data layer (`shelter-core.js`) and shelter list (`data/shelters.json`, built from the cleaned Location tab of the SAS Shelter Finder Data sheet by `website/tools/build_shelters.py`). |
| `wordpress/sas-shelter-review/` | WordPress plugin for the reviewers' dashboard. Put `[sas_shelter_review]` on any page; WordPress Editors and above can review, approve or reject app and website submissions from the Supabase `submissions` table; approvals update the `shelters` table, and the Shelters and County contacts tabs edit shelters and county EM contacts directly, with history and undo. `[sas_county_contacts]` shows the county EM contacts on a public page. On the finder page the plugin redraws the website's two Formidable shelter forms ("Add/Edit Shelter" and "Suggest an Edit") as the app's Add a Shelter and Suggest an Edit forms, and their entries, like the county contact form's, go into the review queue. Both shelter forms ask for the app's sign-in first (the same Supabase accounts), and the plugin checks it on the server before an entry is accepted. The Supabase secret key stays in `wp-config.php` on the server. Setup in `supabase/SETUP.md`. |
| `app/` | Capacitor app that wraps the website page in native iOS and Android shells. See `app/README.md`. |
| `.github/workflows/android-build.yml` | Builds a test APK on every push; download it from the run's Artifacts. |
