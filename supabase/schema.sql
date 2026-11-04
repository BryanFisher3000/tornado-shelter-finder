-- Tornado Shelter Finder: profiles and submissions (run once in Supabase > SQL Editor).
-- Sign-in (Google, Apple) is handled by Supabase Auth; auth.users holds the accounts.

-- One profile per signed-in person ("My Details" in the app).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  first_name  text not null default '',
  last_name   text not null default '',
  phone       text,
  email       text,
  street      text,
  city        text,
  state       text check (state is null or state ~ '^[A-Z]{2}$'),
  zip         text,
  is_reviewer boolean not null default false,  -- set by hand for Bryan's team
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Every add / edit / report from the app or website. The review dashboard reads this.
create table if not exists public.submissions (
  id               bigint generated always as identity primary key,
  kind             text not null check (kind in ('add', 'report', 'general')),
  status           text not null default 'pending'
                     check (status in ('pending', 'in_review', 'needs_info', 'approved', 'rejected', 'superseded')),
  shelter_id       text,            -- null for a new shelter
  base_version     int,
  report_reasons   text[] not null default '{}',
  proposed_changes jsonb not null default '{}',
  proposed_shelter jsonb,           -- kind = 'add'
  comment          text not null default '',
  submitter_id     uuid references auth.users (id) on delete set null,
  submitter        jsonb,           -- copy of My Details at the time it was sent
  submitter_device text,
  channel          text,
  reviewer_id      uuid references auth.users (id),
  reviewer_note    text,
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz
);
create index if not exists submissions_status_idx on public.submissions (status, created_at desc);

alter table public.profiles    enable row level security;
alter table public.submissions enable row level security;

-- helpers live in a private schema so they aren't callable through the public API
create schema if not exists private;
grant usage on schema private to anon, authenticated;
create or replace function private.is_reviewer() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_reviewer from public.profiles where id = auth.uid()), false) $$;

-- Profiles: each person reads and edits only their own; reviewers can read all.
create policy "own profile read"   on public.profiles for select using (id = auth.uid() or private.is_reviewer());
create policy "own profile insert" on public.profiles for insert with check (id = auth.uid());
create policy "own profile update" on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid() and is_reviewer = (select p.is_reviewer from public.profiles p where p.id = auth.uid()));

-- Submissions: adding a shelter needs sign-in; edits and reports are open to everyone.
create policy "submit" on public.submissions for insert with check (
  status = 'pending' and reviewer_id is null
  and (submitter_id is null or submitter_id = auth.uid())
  and (kind <> 'add' or (auth.uid() is not null and submitter_id = auth.uid()))
);
create policy "own or reviewer read" on public.submissions for select using (submitter_id = auth.uid() or private.is_reviewer());
create policy "reviewer update"      on public.submissions for update using (private.is_reviewer());

-- Make a profile row as soon as someone signs in, pre-filled from Google/Apple.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'given_name', split_part(coalesce(new.raw_user_meta_data->>'full_name', ''), ' ', 1), ''),
          coalesce(new.raw_user_meta_data->>'family_name', nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', ''), '^\S+\s*', ''), ''), ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke execute on function public.handle_new_user() from public, anon, authenticated;
