-- Email the team about each new submission (calls the notify-submission Edge Function).
create extension if not exists pg_net with schema extensions;
alter table public.submissions add column if not exists notified_at timestamptz;
alter table public.submissions add column if not exists shelter_label text;

create or replace function private.notify_submission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://svptjcclszprsmjoldaz.supabase.co/functions/v1/notify-submission',
    body := jsonb_build_object('id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
end $$;
revoke execute on function private.notify_submission() from public, anon, authenticated;
drop trigger if exists submissions_notify on public.submissions;
create trigger submissions_notify after insert on public.submissions for each row execute function private.notify_submission();
