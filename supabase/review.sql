-- Review dashboard (WordPress plugin "SAS Shelter Review"): reviewers sign in to WordPress, not
-- Supabase, so the reviewer is recorded by WordPress name rather than reviewer_id.
alter table public.submissions add column if not exists reviewed_by text;
comment on column public.submissions.reviewed_by is 'WordPress user who claimed or decided this, e.g. "Bryan Fisher (bryan)"';
