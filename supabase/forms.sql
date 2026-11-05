-- Website "Suggest an Edit" forms (Formidable 44 and 45) go into the review queue.
-- Adds a 'county' kind for county EM contact corrections, and a link to the county row.
-- Safe to run more than once.
alter table public.submissions drop constraint if exists submissions_kind_check;
alter table public.submissions add constraint submissions_kind_check
  check (kind in ('add', 'report', 'county', 'general'));
alter table public.submissions add column if not exists county_id bigint
  references public.county_contacts (id) on delete set null;
