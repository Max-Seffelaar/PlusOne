-- Invite decline hardening (z8uq9m2yvp, review round 4 of the explicit-accept PR).
--
-- 20261007150000_explicit_invite_accept.sql is ALREADY ON PROD and is not edited.
-- This migration holds only grants, one policy, one function and a retention job,
-- so the live app keeps working with just this migration added on top (every
-- app read of public.invites names its columns and none names accepted_by or
-- declined_by; proof in the PR body).
--
-- 1. accepted_by / declined_by are no longer readable by app roles. A declined
--    invite stores the decliner's user id; invites_select lets the company's
--    admins read the row, so the id of a person who has NOT joined the company
--    would be readable. Column-level SELECT on public.invites: every column
--    except those two. A new column on invites starts with no grant (same rule
--    as new tables). Writes are unchanged (insert, delete, update on expires_at).
-- 2. invites_insert: a new row is never already accepted or declined (declined_at
--    and declined_by must be null). Without it an admin could insert a row with a
--    chosen declined_by and use the foreign-key error as an oracle for whether an
--    arbitrary uuid is a profile.
-- 3. log_mail_attempt: the two decline mail types fall outside the 60-second
--    per-recipient window, and do not count towards it for other mail either. A
--    decline mail can only follow an invite that already passed the company's
--    daily cap, so it adds no new send budget; the window would only have made a
--    decline mail to an inviter who got another mail a moment ago fail silently.
-- 4. Retention for mail_log rows with no venue (the decline mails, and any future
--    venue-less mail). Rows with a venue go with it (on delete cascade); these
--    would live forever. cleanup_venueless_mail_log() deletes them after 90 days,
--    daily at 03:15 UTC via pg_cron. 90 days: the row holds only a type, the
--    sha256 of the address and a delivery status (no content, no name), the
--    delivery webhooks settle within days, and the per-recipient window needs
--    minutes, so 90 days covers any support question about "did that mail go"
--    without keeping recipient hashes indefinitely. This is a hard DELETE: the
--    "soft delete only" rule (#21) is about guests and other business data;
--    mail_log is an operational log that no app role can read or write (platform
--    admins read it), and the job runs as the owner.
--
-- Grant matrix (revoke first, then grant): invites SELECT, below; the cleanup
-- function is executable by nobody (the cron job runs as the owner).

-- ── 1. Column-level SELECT on invites ───────────────────────────────────────
revoke select on table public.invites from authenticated;
grant select (
  id, venue_id, email, roles, invited_by, expires_at, accepted_at, created_at,
  default_quota, event_ids, crew_quota, declined_at
) on table public.invites to authenticated;

-- ── 2. invites_insert: no pre-closed rows ───────────────────────────────────
alter policy invites_insert on public.invites
  with check (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and invited_by = (select auth.uid())
    and accepted_at is null
    and declined_at is null
    and declined_by is null
    and expires_at > now()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
    and (
      (cardinality(event_ids) = 0 and crew_quota is null)
      or public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    )
    and (
      cardinality(roles) > 0
      or exists (
        select 1 from public.events e
        where e.id = event_ids[1] and e.venue_id = invites.venue_id
      )
    )
  );

-- ── 3. log_mail_attempt: decline mails outside the recipient window ─────────
create or replace function public.log_mail_attempt(
  p_type text,
  p_venue_id uuid,
  p_recipient_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Serialise concurrent sends to one recipient so two parallel calls can't
  -- both pass the window check.
  perform pg_advisory_xact_lock(hashtextextended('mail_log:' || coalesce(p_recipient_hash, ''), 0));

  -- The decline mails are exempt from the window and do not start one.
  if p_type not in ('team_invite_declined', 'team_invite_declined_confirm')
     and exists (
       select 1 from public.mail_log m
        where m.recipient_hash = p_recipient_hash
          and m.type not in ('team_invite_declined', 'team_invite_declined_confirm')
          and m.created_at > now() - public.mail_recipient_window()
     ) then
    raise exception 'mail throttled: recipient' using errcode = 'PM429';
  end if;

  if p_venue_id is not null and public.mail_venue_cap_reached(p_venue_id) then
    raise exception 'mail throttled: venue daily cap' using errcode = 'PM429';
  end if;

  insert into public.mail_log (type, venue_id, recipient_hash)
  values (p_type, p_venue_id, p_recipient_hash)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_mail_attempt(text, uuid, text) is
  'Mail sender (service_role): record a queued send and return its id '
  '(= the Resend Idempotency-Key). Refuses (PM429) a second mail to the same '
  'recipient within mail_recipient_window() (the two decline mail types are '
  'exempt, 20261007150100) and a venue past mail_venue_daily_cap() for the UTC '
  'day. Check constraints validate the input.';

-- ── 4. Retention for venue-less mail_log rows ───────────────────────────────
create function public.cleanup_venueless_mail_log(p_older_than interval default interval '90 days')
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.mail_log
     where venue_id is null
       and created_at < now() - p_older_than
    returning 1
  )
  select count(*)::integer from deleted;
$$;

comment on function public.cleanup_venueless_mail_log(interval) is
  'Retention (20261007150100): deletes mail_log rows with no venue older than 90 days. Venue rows go with their venue. Run by pg_cron as the owner; no app role may execute it.';

-- Internal only: the cron job runs it as owner.
revoke execute on function public.cleanup_venueless_mail_log(interval)
from public, anon, authenticated, service_role;

-- Guarded like the other cron schedules, so `supabase db reset` passes where the
-- local image doesn't preload pg_cron.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-mail-log-venueless-retention',
        '15 3 * * *',
        'select public.cleanup_venueless_mail_log();');
      raise notice 'pg_cron: scheduled plusone-mail-log-venueless-retention (daily 03:15 UTC).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.cleanup_venueless_mail_log() daily by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.cleanup_venueless_mail_log() daily by other means.';
  end if;
end;
$$;
