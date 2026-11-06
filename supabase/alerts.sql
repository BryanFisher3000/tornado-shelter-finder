-- Tornado push alerts: phones that want alerts, which alerts each phone already got,
-- and a once-a-minute job that runs the tornado-alerts Edge Function.
-- Run in Supabase > SQL Editor after the tornado-alerts function is deployed. Safe to run again.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One row per phone. Locations are rounded to ~100 m by the app.
create table if not exists public.push_devices (
  token       text primary key,                 -- Firebase Cloud Messaging token
  platform    text not null default 'android',
  user_id     uuid references auth.users (id) on delete set null,
  last_lat    double precision,                 -- where the app was last opened
  last_lng    double precision,
  last_seen   timestamptz,
  places      jsonb not null default '{}'::jsonb, -- {"home": {"lat","lng","safe"}, "work": {...}}
  warnings    boolean not null default true,    -- Tornado Warnings
  watches     boolean not null default false,   -- Tornado Watches
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.push_devices enable row level security;  -- no policies: only the functions below and the Edge Function (service role) touch it

-- Each alert goes to each phone once.
create table if not exists public.alert_pushes (
  alert_id   text not null,
  token      text not null,
  matched    text,                -- here / home / work
  sent_at    timestamptz not null default now(),
  primary key (alert_id, token)
);
alter table public.alert_pushes enable row level security;
create index if not exists alert_pushes_sent_at on public.alert_pushes (sent_at);

-- The app calls this when Notifications is turned on, and each time it opens.
create or replace function public.register_push_device(
  p_token text, p_platform text default 'android',
  p_lat double precision default null, p_lng double precision default null,
  p_places jsonb default '{}'::jsonb, p_warnings boolean default true, p_watches boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 4096 then raise exception 'bad token'; end if;
  if p_places is null or jsonb_typeof(p_places) <> 'object' or length(p_places::text) > 2000 then p_places := '{}'::jsonb; end if;
  insert into public.push_devices as d (token, platform, user_id, last_lat, last_lng, last_seen, places, warnings, watches, updated_at)
  values (p_token, left(coalesce(p_platform, 'android'), 20), auth.uid(), round(p_lat::numeric, 3), round(p_lng::numeric, 3),
          case when p_lat is null then null else now() end, p_places, coalesce(p_warnings, true), coalesce(p_watches, false), now())
  on conflict (token) do update set
    platform = excluded.platform,
    user_id = coalesce(excluded.user_id, d.user_id),
    last_lat = coalesce(excluded.last_lat, d.last_lat),
    last_lng = coalesce(excluded.last_lng, d.last_lng),
    last_seen = coalesce(excluded.last_seen, d.last_seen),
    places = excluded.places,
    warnings = excluded.warnings,
    watches = excluded.watches,
    updated_at = now();
end $$;

-- Notifications turned off in the app.
create or replace function public.unregister_push_device(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_devices where token = p_token;
$$;

revoke all on function public.register_push_device(text, text, double precision, double precision, jsonb, boolean, boolean) from public;
revoke all on function public.unregister_push_device(text) from public;
grant execute on function public.register_push_device(text, text, double precision, double precision, jsonb, boolean, boolean) to anon, authenticated;
grant execute on function public.unregister_push_device(text) to anon, authenticated;

-- Every minute: check the National Weather Service and send pushes.
select cron.unschedule('tornado-alerts') where exists (select 1 from cron.job where jobname = 'tornado-alerts');
select cron.schedule('tornado-alerts', '* * * * *', $$
  select net.http_post(
    url := 'https://svptjcclszprsmjoldaz.supabase.co/functions/v1/tornado-alerts',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 55000
  )
$$);

-- Keep 30 days of send history.
select cron.unschedule('alert-pushes-cleanup') where exists (select 1 from cron.job where jobname = 'alert-pushes-cleanup');
select cron.schedule('alert-pushes-cleanup', '17 4 * * *', $$
  delete from public.alert_pushes where sent_at < now() - interval '30 days'
$$);
