-- The shelter list as one JSON document, in the same shape as website/data/shelters.json,
-- so the app and website can load it with the publishable key:
--   POST https://svptjcclszprsmjoldaz.supabase.co/rest/v1/rpc/shelters_snapshot
--   headers: apikey: <publishable key>, Content-Type: application/json   body: {}
-- (GET .../rest/v1/rpc/shelters_snapshot works too.) Only active shelters are included.
-- Run once in Supabase > SQL Editor. Safe to run again.
create or replace function public.shelters_snapshot() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'source', 'Supabase shelters table',
    'generated_at', now(),
    'count', count(*),
    'shelters', coalesce(json_agg(json_build_object(
      'id', s.id,
      'name', s.name,
      'location', json_build_object('lat', s.lat, 'lng', s.lng),
      'address', json_build_object('line', coalesce(s.address_line, ''), 'city', coalesce(s.city, ''), 'county', coalesce(s.county, ''), 'state', coalesce(s.state, ''), 'zip', coalesce(s.zip, '')),
      'capacity', json_build_object('min', s.capacity_min, 'label', s.capacity_label),
      'ada_accessible', s.ada_accessible,
      'pets_allowed', s.pets_allowed,
      'availability', s.availability,
      'access', s.access,
      'notes', s.notes,
      'verification_status', s.verification_status,
      'status', s.status,
      'version', s.version
    ) order by s.state, s.city, s.name, s.id), '[]'::json))
  from public.shelters s
  where s.status = 'active'
$$;
revoke all on function public.shelters_snapshot() from public;
grant execute on function public.shelters_snapshot() to anon, authenticated;
