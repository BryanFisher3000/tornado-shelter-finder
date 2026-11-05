-- Shelter list, its change history and county EM contacts, moved from the
-- "SAS Shelter Finder Data" Google Sheet. Run once in Supabase > SQL Editor.
-- Safe to run again: it only creates what is missing.

-- 1. Shelters: one row per shelter, the same fields as website/data/shelters.json.
create table if not exists public.shelters (
  id                  text primary key,              -- 12-character id, same as shelters.json
  name                text not null,
  lat                 double precision not null,
  lng                 double precision not null,
  address_line        text,
  city                text,
  county              text,
  state               text,
  zip                 text,
  capacity_min        integer,
  capacity_label      text,
  ada_accessible      text not null default 'unknown' check (ada_accessible in ('yes','no','unknown')),
  pets_allowed        text not null default 'unknown' check (pets_allowed in ('yes','no','unknown')),
  availability        text not null default 'emergencies_only' check (availability in ('always','emergencies_only','county_activated')),
  access              text not null default 'public' check (access in ('public','registration_required','restricted')),
  notes               text,
  verification_status text not null default 'unverified',
  status              text not null default 'active' check (status in ('active','hidden','retired')),
  hidden_reason       text,                          -- from the Hidden tab's "Why hidden"
  evidence            text,                          -- from the Hidden tab's "Evidence / source"
  source_year         text,
  source              text,                          -- which sheet tab or submission it came from
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          text,                          -- e.g. "Bryan Fisher (bryan)"
  last_submission_id  bigint references public.submissions(id) on delete set null
);
create index if not exists shelters_status_idx on public.shelters (status);
create index if not exists shelters_state_idx on public.shelters (state, county);

-- 2. History: the row as it was before each change, so any edit can be undone.
create table if not exists public.shelter_history (
  id             bigint generated always as identity primary key,
  shelter_id     text not null,
  version        integer not null,                  -- the version this row had before the change
  old_row        jsonb,                             -- null when the shelter was just created
  new_row        jsonb,                             -- null when the shelter was deleted
  changed_by     text,
  submission_id  bigint,
  changed_at     timestamptz not null default now()
);
create index if not exists shelter_history_shelter_idx on public.shelter_history (shelter_id, changed_at desc);

create or replace function private.shelters_versioning() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - array['version','updated_at'] = to_jsonb(old) - array['version','updated_at'] then
      return new;                                   -- nothing really changed
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function private.shelters_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.shelter_history (shelter_id, version, old_row, new_row, changed_by, submission_id)
    values (new.id, 0, null, to_jsonb(new), new.updated_by, new.last_submission_id);
  elsif tg_op = 'UPDATE' then
    if new.version <> old.version then
      insert into public.shelter_history (shelter_id, version, old_row, new_row, changed_by, submission_id)
      values (new.id, old.version, to_jsonb(old), to_jsonb(new), new.updated_by, new.last_submission_id);
    end if;
  else
    insert into public.shelter_history (shelter_id, version, old_row, new_row, changed_by)
    values (old.id, old.version, to_jsonb(old), null, old.updated_by);
    return old;
  end if;
  return new;
end $$;

drop trigger if exists shelters_versioning on public.shelters;
create trigger shelters_versioning before update on public.shelters
  for each row execute function private.shelters_versioning();
drop trigger if exists shelters_log on public.shelters;
create trigger shelters_log after insert or update or delete on public.shelters
  for each row execute function private.shelters_log();

-- 3. County emergency management contacts (the County EM Contacts tab).
create table if not exists public.county_contacts (
  id           bigint generated always as identity primary key,
  county       text not null,
  state        text not null,
  agency       text,
  director     text,
  phone        text,
  email        text,
  address      text,
  website      text,
  source_url   text,
  source_date  text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  unique (state, county)
);

-- 4. Who can see what. Changes only come from the review page (server-side key)
--    or the Supabase table editor, so there are no insert/update policies.
alter table public.shelters        enable row level security;
alter table public.shelter_history enable row level security;
alter table public.county_contacts enable row level security;

drop policy if exists "Anyone can read active shelters" on public.shelters;
create policy "Anyone can read active shelters" on public.shelters
  for select to anon, authenticated using (status = 'active');
drop policy if exists "Reviewers can read all shelters" on public.shelters;
create policy "Reviewers can read all shelters" on public.shelters
  for select to authenticated using ((select private.is_reviewer()));
drop policy if exists "Reviewers can read shelter history" on public.shelter_history;
create policy "Reviewers can read shelter history" on public.shelter_history
  for select to authenticated using ((select private.is_reviewer()));
drop policy if exists "Anyone can read county contacts" on public.county_contacts;
create policy "Anyone can read county contacts" on public.county_contacts
  for select to anon, authenticated using (true);

-- 5. Holding tables for the one-time import. Their columns match the sheet
--    headers, so each tab's CSV download can be imported as it is.
--    shelters-import.sql copies them into the tables above; they are dropped afterwards.
create table if not exists public.import_location (
  row_num bigint generated always as identity primary key,
  "Latitude" text, "Longitude" text, "Name" text, "Address" text, "City" text, "County" text,
  "State" text, "Zip" text, "Capacity" text, "ADA" text, "Pets" text, "Open" text, "Note" text,
  "Capacity Display" text, "Column244" text
);
create table if not exists public.import_hidden (
  row_num bigint generated always as identity primary key,
  "Latitude" text, "Longitude" text, "Name" text, "Address" text, "City" text, "County" text,
  "State" text, "Zip" text, "Capacity" text, "ADA" text, "Pets" text, "Open" text, "Note" text,
  "Why hidden" text, "Evidence / source" text, "Source year" text
);
create table if not exists public.import_county_contacts (
  row_num bigint generated always as identity primary key,
  "County" text, "State" text, "Agency" text, "Director" text, "Phone" text, "Email" text,
  "Address" text, "Website" text, "Source URL" text, "Source date" text
);
alter table public.import_location        enable row level security;
alter table public.import_hidden          enable row level security;
alter table public.import_county_contacts enable row level security;
