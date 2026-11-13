# Supabase setup (Bryan, about 15 minutes)

1. Create a free project at https://supabase.com/dashboard (name: tornado-shelter-finder, region: US Central/East).
2. SQL Editor > New query: paste `schema.sql` from this folder and Run.
3. Project Settings > API: copy the **Project URL** and the **anon public** key and send them to Claude.
   Both are meant to be public (they ship inside the app); do NOT send the service_role key.
4. Google sign-in:
   - https://console.cloud.google.com > APIs & Services > Credentials > Create credentials > OAuth client ID > Web application.
   - Authorized redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`.
   - In Supabase: Authentication > Providers > Google: turn on, paste the Client ID and Client Secret.
5. Authentication > URL Configuration > Redirect URLs: add `com.surviveastorm.shelterfinder://auth` and `https://survive-a-storm.com/tornado-shelter-finder/*`.
6. Facebook sign-in:
   - https://developers.facebook.com > My Apps > Create App > "Authenticate and request data from users with Facebook Login" (Consumer).
   - Facebook Login > Settings: Valid OAuth Redirect URI `https://<your-project>.supabase.co/auth/v1/callback`.
   - App Settings > Basic: add the Privacy Policy URL (https://survive-a-storm.com/privacy/) and a data deletion URL or instructions, then switch the app to Live.
   - In Supabase: Authentication > Providers > Facebook: turn on, paste the App ID and App Secret.
7. Apple sign-in (needed before the iPhone app ships): requires the Apple Developer Program ($99/yr). We'll do this step together later.
8. After you sign in once in the app, run in SQL Editor to make yourself a reviewer:
   `update public.profiles set is_reviewer = true where email = '<your email>';`

## Review dashboard (WordPress plugin)

9. SQL Editor > New query: paste `review.sql` from this folder and Run. It adds the `reviewed_by` column.
10. Project Settings > API Keys: copy the **secret** key (starts with `sb_secret_`). Don't send it to anyone.
    Add it to `wp-config.php` on the WordPress server, above "That's all, stop editing":
    `define( 'SAS_SUPABASE_SECRET_KEY', 'sb_secret_...' );`
11. Zip the `wordpress/sas-shelter-review` folder, then WordPress > Plugins > Add New > Upload Plugin, and Activate.
12. Create a page (for example `/tornado-shelter-finder/review/`) and add the shortcode `[sas_shelter_review]`
    in a Visual Composer text block. Signed-out visitors get a sign-in link; signed-in users below Editor get a
    refusal. The page is marked noindex and not cached.
    The page has four tabs: Review queue, All submissions, Shelters (search, edit, hide, history with undo)
    and County contacts. Approving a submission updates the `shelters` table directly (after step 13).

## Shelter list in Supabase (replaces the Google Sheet)

13. SQL Editor > New query: paste `shelters.sql` and Run. It creates `shelters`, `shelter_history`,
    `county_contacts` and three holding tables for the import (`import_location`, `import_hidden`,
    `import_county_contacts`).
14. In the SAS Shelter Finder Data sheet, open each tab and use File > Download > Comma-separated values:
    Location, Hidden, County EM Contacts.
15. Table Editor: open `import_location`, then Insert > Import data from CSV, and pick the Location file.
    Do the same for `import_hidden` (Hidden file) and `import_county_contacts` (County EM Contacts file).
16. Run `shelters-import.sql` (Claude can run it). It prints counts to compare with the sheet.
    It is safe to run again: rows already copied are skipped.
17. Run `snapshot.sql`. It adds `shelters_snapshot()`, which returns the active shelters in the same shape as
    `website/data/shelters.json`. The Android build calls it (`website/tools/fetch_shelters.py`) so each new
    build bundles the latest list; if Supabase can't be reached, the committed copy is used.

## Daily digest email (replaces one email per submission)

18. Edge Functions > notify-submission > Code: replace the code with `functions/notify-submission/index.ts`
    from this folder and Deploy. Leave "Verify JWT" off, as it is now.
19. SQL Editor > New query: paste `digest.sql` and Run. It schedules one email at 13:00 UTC
    (7 AM Central, 8 AM in summer) listing everything not emailed yet, and turns off the
    per-submission email. Nothing is sent on days with no new submissions.

## Public county contacts page

20. Upload the plugin zip again (v1.2.0 or later). On the County Emergency Management Contacts page,
    replace the Raw HTML element that holds the county list (its style and the whole list) with
    the shortcode `[sas_county_contacts]`. It prints the same list, search, state filter and
    Edit pop-up, filled from `county_contacts` in Supabase. It refreshes within an hour, or right
    away when a county is saved on the review page. Use `edit_url="..."` to send the Edit links
    somewhere other than the page's `edit/` subpage, or `edit_url=""` to hide them.

## Website "Suggest an Edit" forms into the review queue

21. Run `supabase/forms.sql` in the SQL Editor. It adds the `county` submission kind and a
    `county_id` link to the county list.
22. Redeploy the `notify-submission` function (Edge Functions → notify-submission → Code, paste
    `supabase/functions/notify-submission/index.ts`, Deploy) so the digest describes county
    corrections.
23. Upload the plugin zip again (v1.3.0 or later). From then on every entry of the shelter
    "Suggest an Edit" form (Formidable 44, fields `sfb_*`) and the county contact form
    (Formidable 45, fields `cemf_*`) is also added to the review queue:
    - a shelter edit is matched to the shelter by its original name and state (closest pin if
      several) and arrives as an Edit with only the changed fields;
    - a form opened blank arrives as an Add;
    - a county correction is matched to the county row and arrives as a County contact; approving
      it updates the county list and the public page;
    - anything that can't be matched arrives as Feedback with the details in the comment.
    Formidable still keeps its own copy of each entry. The forms' own "Send Email" actions can be
    turned off, since the 7 AM digest now covers these submissions.

## Website forms drawn like the app's

24. Upload the plugin zip again (v1.4.0 or later). There is nothing else to set up. On the finder
    page (`/tornado-shelter-finder/`) and its `edit/` subpage the plugin loads
    `assets/shelter-forms.js` and `assets/shelter-forms.css`, which redraw the two Formidable
    forms there as the app's forms:
    - "Add/Edit Shelter" (Formidable 39, in the finder page) becomes Add a Shelter, and its
      entries now go into the review queue as new shelters;
    - "Suggest an Edit" (Formidable 44, in the pop-up) becomes the app's Suggest an Edit.

    The Formidable forms themselves are not changed. Their fields stay in the page, out of sight,
    and carry the answers, so the spam check and Formidable's own copy of each entry work as
    before. A few answers are spelled in a fixed way in Formidable's entries, which the plugin
    reads back: capacity as "Under 25", "Under 50" or "50 or more"; "Unknown" for a detail set to
    Unknown; "(blank)" for an address box the person emptied; a first line "Reported: ..." in the
    message for the three report checkboxes; and, on form 39, the shelter's name and its Open
    choice inside the note ("Name: ... || Open: ... || Note: ...").

    If a field the redraw needs is renamed or removed in Formidable, or the script fails, the
    form shows as it was before. The two pages are found by id (73443 and 907809) or by address;
    the filters `sas_shelter_forms_page_ids` and `sas_shelter_forms_paths` change that. Address
    suggestions and the "Use Map Center" button use the Google map that is already on the finder
    page.

## Sign-in on the website's shelter forms

25. In Supabase, open Authentication → URL Configuration. Check that **Site URL** is
    `https://survive-a-storm.com`, and under **Redirect URLs** add
    `https://survive-a-storm.com/tornado-shelter-finder/**`. That lets a sign-in (and the link in
    a confirmation email) come back to the page the form is on. Without it, Supabase sends the
    person to the Site URL instead and the form stays closed.
26. Upload the plugin zip again (v1.5.0 or later). From then on the website's two shelter forms
    ask for the app's sign-in, as the app does before adding a shelter or suggesting an edit:
    - where a shelter form is, the page shows "Continue with Google / Apple / Facebook / Email"
      (a provider that is switched off in Supabase is left out) and opens the form once the
      person is signed in. They are the app's accounts, so someone signed up in the app signs in
      with the same account here;
    - an account without a first name, last name and email is asked for them once, in "My
      Details", and they are kept in `profiles`, where the app reads them too;
    - the form's own First Name, Last Name and Email fields are filled from the account and kept
      out of sight;
    - the sign-in goes with the form, and the plugin checks it with Supabase before Formidable
      accepts the entry (`includes/account.php`). An entry without a good sign-in is refused, and
      the queue row gets the account in `submitter_id` and the account's name and email in
      `submitter`, the same as a submission from the app. The sign-in itself is never stored;
    - in the Suggest an Edit pop-up, Google, Apple and Facebook open in a new tab (their pages
      refuse to load inside a pop-up), which closes itself when the person is signed in;
    - Sign Out on the website signs out that browser only. The person stays signed in on their
      phone.

    Entries typed in the WordPress dashboard by a reviewer, or by someone allowed to add
    Formidable entries, are not asked for a sign-in. The county contact form is not changed.

    The plugin carries the Supabase library the app uses (`assets/vendor/supabase.js`, supabase-js
    2.119.0, MIT) and loads it only on a page that has a shelter form. It uses the app's public
    key, which is in `includes/account.php` (define `SAS_SUPABASE_PUBLISHABLE_KEY` in
    `wp-config.php` to use another). To switch the sign-in off without removing the plugin:
    `add_filter( 'sas_forms_require_signin', '__return_false' );`.

    After installing, try each way of signing in once on the live site, and send one real edit:
    the spam check (Cloudflare Turnstile) on the forms could not be tried together with the
    sign-in before going live.

## Add a Shelter on its own page

The page is `https://survive-a-storm.com/tornado-shelter-finder/add/`. Its form is a Formidable
form made for it, with a field for each of the app's Add a Shelter form, so nothing is redrawn:
the form builder's fields are what people see.

27. Upload the plugin zip again (v1.6.0 or later).
28. In WordPress, open Formidable → Import/Export, choose `wordpress/forms/add-a-shelter-form.xml`
    and press "Upload file and import". A form named **Add a Shelter** (key `sas_add_shelter`)
    appears in the form list. It uses the site's `sas` form style, shows no stars on its required
    fields (as in the app) and thanks the sender with the app's words.
29. Make a page titled "Add a Shelter" with the page "Tornado Shelter Finder" as its parent and
    the slug `add`, and put the form on it with a shortcode element holding
    `[formidable key="sas_add_shelter"]`. In Bricks, give the form's container a width of about
    720 pixels; the form fills whatever width it is given.

What the plugin adds to that form, wherever it is shown:

- the app's sign-in in front of it, with the form's First Name, Last Name and Email filled from
  the account and kept out of sight (the sign-in section above applies to it unchanged);
- a map under the ZIP box for placing the pin, with "Use Map Center" as in the app. The map is
  Leaflet 1.9.4 (`assets/vendor/leaflet.js`, BSD 2-Clause) with OpenStreetMap's map tiles, the
  library and tiles `website/index.html` uses. It is fetched only once the form is in sight;
- an address lookup: when the street, city and state are filled in, the address is looked up once
  with OpenStreetMap's Nominatim. The map moves there, and when the building itself is found the
  pin is set on it, the county is noted and an empty ZIP box is filled. Only the shelter's address
  is sent, never the person's name or email. A pin set with Use Map Center is never moved;
- each entry goes into the review queue as a new shelter with its address, county, pin, capacity,
  Open, wheelchair and pets answers and the note, from the signed-in account
  (`sas_forms_page_add_submission` in `includes/formidable.php`).

Google's address suggestions under the street box, as in the app, are optional on this page. To
switch them on, add a Google Maps browser key that has the Places library to `wp-config.php`:
`define( 'SAS_GOOGLE_MAPS_KEY', '...' );`. Restrict the key to `survive-a-storm.com`. The key is
never in the repository. Without it the street box is a plain box and the lookup above does the
work.

Changing the form in the form builder is fine: labels, help text, the order of fields, the
thank-you message and the style are all Formidable's. Keep the field keys (`sas_add_name`,
`sas_add_street`, `sas_add_city`, `sas_add_state`, `sas_add_zip`, `sas_add_county`,
`sas_add_lat`, `sas_add_lng`, `sas_add_capacity`, `sas_add_open`, `sas_add_ada`, `sas_add_pets`,
`sas_add_note`, `sas_add_first`, `sas_add_last`, `sas_add_email`) and the words of the choices
("Unknown", "Under 25", "Under 50", "50 or more", "During emergencies", "Year-round", "Yes",
"No"), because the plugin reads the entry by them. If the name, street, city or state field is
taken out, the map and lookup are left off and the form shows as the form builder made it.
Importing the file again puts the form back as the file has it: it updates the same form and
removes fields that were added by hand. To change the form for good, edit
`wordpress/forms/build-add-form.py` and write the file again.

In the Bricks editor (and Visual Composer's) the plugin's scripts are left off, so the form looks
there the way the form builder made it, with its name and email fields in sight.

The import itself, the real page inside Bricks and the spam check could not be tried before going
live: the form file was checked against how Formidable 7 reads an import, and the page against a
stand-in built from the live site's own pages. After step 29, open the page signed out and signed
in, and send one real shelter.
