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
6. Apple sign-in (needed before the iPhone app ships): requires the Apple Developer Program ($99/yr). We'll do this step together later.
7. After you sign in once in the app, run in SQL Editor to make yourself a reviewer:
   `update public.profiles set is_reviewer = true where email = '<your email>';`
