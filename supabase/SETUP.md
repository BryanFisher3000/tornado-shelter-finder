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
    Optional: `[sas_shelter_review shelters_url="https://.../shelters.json"]` to load shelters from somewhere
    other than the copy on GitHub `main`.
