-- Daily digest: one email at 7 AM Central (8 AM during daylight time) listing
-- every submission that hasn't been emailed yet, instead of one email each.
-- Run once in Supabase > SQL Editor, after the updated notify-submission
-- function is deployed. Safe to run again.

create extension if not exists pg_cron;

-- 13:00 UTC every day
select cron.unschedule('submission-digest')
where exists (select 1 from cron.job where jobname = 'submission-digest');
select cron.schedule('submission-digest', '0 13 * * *', $$
  select net.http_post(
    url := 'https://svptjcclszprsmjoldaz.supabase.co/functions/v1/notify-submission',
    body := '{"digest": true}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
$$);

-- Stop the email for each new submission.
-- To go back to per-submission emails, run notify.sql again.
drop trigger if exists submissions_notify on public.submissions;
