-- One-time copy from the import_* holding tables (filled from the sheet's CSV
-- downloads) into shelters and county_contacts. Uses the same cleanup rules as
-- website/tools/build_shelters.py, so Location shelters keep the ids the app
-- already uses. Run after shelters.sql and the three CSV imports.

create or replace function pg_temp.clean(s text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(s, ''), '[​﻿]', '', 'g'), '^\s+|\s+$', '', 'g')
$$;
create or replace function pg_temp.is_unknown(s text) returns boolean language sql immutable as $$
  select lower(pg_temp.clean(s)) in ('', 'n/a', 'unknown', 'not listed', 'not specified')
$$;
-- yes / no / unknown; "Service animals only" counts as no
create or replace function pg_temp.tri(s text) returns text language sql immutable as $$
  select case
    when pg_temp.is_unknown(s) then 'unknown'
    when v like '%service%' or v like 'svc%' then 'no'
    when v like 'y%' or (replace(v, '-', ' ') like '%pet friendly%' and v not like '%not%') then 'yes'
    when v like 'n%' then 'no'
    else 'unknown' end
  from (select lower(pg_temp.clean(s)) as v) x
$$;
create or replace function pg_temp.sha12(s text) returns text language sql immutable as $$
  select left(encode(extensions.digest(convert_to(s, 'UTF8'), 'sha1'), 'hex'), 12)
$$;
-- Python's f"{x:.6f}"
create or replace function pg_temp.f6(x double precision) returns text language sql immutable as $$
  select to_char(x, 'FM999990.000000')
$$;

create temp table src as
with raw as (
  select 'Location' as tab, row_num, "Latitude" la, "Longitude" lo, "Name" nm, "Address" ad, "City" ci,
         "County" co, "State" st, "Zip" zp, "Capacity" cap, "Capacity Display" disp, "ADA" ada, "Pets" pets,
         "Open" op, "Note" note, null::text why, null::text evid, null::text yr
  from public.import_location
  union all
  select 'Hidden', row_num, "Latitude", "Longitude", "Name", "Address", "City", "County", "State", "Zip",
         "Capacity", null, "ADA", "Pets", "Open", "Note", "Why hidden", "Evidence / source", "Source year"
  from public.import_hidden
), parsed as (
  select r.*,
         case when pg_temp.clean(la) ~ '^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$' then pg_temp.clean(la)::double precision end as lat,
         case when pg_temp.clean(lo) ~ '^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$' then pg_temp.clean(lo)::double precision end as lng
  from raw r
), valid as (
  select p.*,
         lower(pg_temp.clean(nm) || '|' || pg_temp.clean(ad) || '|' || pg_temp.clean(ci) || '|' || upper(pg_temp.clean(st))) as k
  from parsed p
  where lat > 18 and lat < 72 and lng > -180 and lng < -60 and pg_temp.clean(nm) <> ''
), spots as (
  select v.*, v.k || '|' || pg_temp.f6(lat) || ',' || pg_temp.f6(lng) as spot,
         row_number() over (partition by tab, v.k || '|' || pg_temp.f6(lat) || ',' || pg_temp.f6(lng) order by row_num) as n_spot
  from valid v
), kept as (
  select s.*, row_number() over (partition by tab, k order by row_num) as n_key
  from spots s where n_spot = 1
)
select tab, row_num, lat, lng, nm, ad, ci, co, st, zp, cap, disp, ada, pets, op, note, why, evid, yr,
       case when tab = 'Location' then pg_temp.sha12(case when n_key = 1 then k else spot end)
            else pg_temp.sha12('hidden|' || spot) end as id
from kept;

insert into public.shelters (id, name, lat, lng, address_line, city, county, state, zip, capacity_min, capacity_label,
  ada_accessible, pets_allowed, availability, access, notes, status, hidden_reason, evidence, source_year, source, updated_by)
select distinct on (id)
  id, pg_temp.clean(nm), round(lat::numeric, 6)::double precision, round(lng::numeric, 6)::double precision,
  pg_temp.clean(ad), pg_temp.clean(ci), pg_temp.clean(co), upper(pg_temp.clean(st)),
  left(regexp_replace(pg_temp.clean(zp), '\D', '', 'g'), 5),
  case when not pg_temp.is_unknown(cap) then nullif(replace(substring(pg_temp.clean(cap) from '\d[\d,]*'), ',', ''), '')::integer end,
  coalesce(case when not pg_temp.is_unknown(disp) then pg_temp.clean(disp) end,
           case when not pg_temp.is_unknown(cap) then pg_temp.clean(cap) end),
  pg_temp.tri(ada), pg_temp.tri(pets),
  case when lower(pg_temp.clean(op)) in ('always', 'year-round', '24/7', 'open') then 'always' else 'emergencies_only' end,
  case when lower(pg_temp.clean(note)) like '%regist%' then 'registration_required'
       when lower(pg_temp.clean(note)) ~ '(members|residents|employees|students) only' then 'restricted'
       else 'public' end,
  nullif(pg_temp.clean(note), ''),
  case when tab = 'Hidden' then 'hidden'
       when lower(pg_temp.clean(op)) in ('shelter not open', 'closed') then 'retired'
       else 'active' end,
  nullif(pg_temp.clean(why), ''), nullif(pg_temp.clean(evid), ''), nullif(pg_temp.clean(yr), ''),
  'sheet: ' || tab, 'Sheet import 2026-11-05'
from src
order by id, (tab = 'Location') desc, row_num
on conflict (id) do nothing;

insert into public.county_contacts (county, state, agency, director, phone, email, address, website, source_url, source_date, updated_by)
select distinct on (upper(pg_temp.clean("State")), pg_temp.clean("County"))
  pg_temp.clean("County"), upper(pg_temp.clean("State")),
  nullif(pg_temp.clean("Agency"), ''), nullif(pg_temp.clean("Director"), ''), nullif(pg_temp.clean("Phone"), ''),
  nullif(pg_temp.clean("Email"), ''), nullif(pg_temp.clean("Address"), ''), nullif(pg_temp.clean("Website"), ''),
  nullif(pg_temp.clean("Source URL"), ''), nullif(pg_temp.clean("Source date"), ''), 'Sheet import 2026-11-05'
from public.import_county_contacts
where pg_temp.clean("County") <> '' and pg_temp.clean("State") <> ''
order by upper(pg_temp.clean("State")), pg_temp.clean("County"), row_num
on conflict (state, county) do nothing;

-- Counts to compare with the sheet
select 'location rows' as what, count(*) from public.import_location
union all select 'hidden rows', count(*) from public.import_hidden
union all select 'county rows', count(*) from public.import_county_contacts
union all select 'shelters ' || status, count(*) from public.shelters group by status
union all select 'county contacts', count(*) from public.county_contacts;
