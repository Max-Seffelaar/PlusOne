-- Failed mail attempts no longer count (z8uq9m2yvp, review of PR #430).
--
-- A mail_log row the sender settled as 'failed' (provider 5xx/429, timeout,
-- or a sign-in link that could not be minted: no mail left the building)
-- used to count like a sent one:
--   * in log_mail_attempt's 60-second recipient window, so an admin's retry
--     within a minute got PM429 and was told "Invite re-sent" while nothing
--     ever went out;
--   * in mail_venue_cap_reached, so a provider outage ate the company's daily
--     invitation budget.
-- Both now skip status = 'failed'. 'queued' (a send in flight) and every
-- delivered-side status still count, so two parallel sends still serialise
-- on the advisory lock and the window holds for anything that may have gone.
--
-- Bodies are the live ones (log_mail_attempt from 20261007150100,
-- mail_venue_cap_reached from 20261007130000) with only that predicate
-- added; signatures, security, search_path and grants are unchanged
-- (create or replace keeps the ACL). The deployed app needs no change: it
-- sees fewer PM429 refusals, never more.

create or replace function public.mail_venue_cap_reached(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= public.mail_venue_daily_cap()
    from public.mail_log m
   where m.venue_id = p_venue_id
     and m.status <> 'failed'
     and m.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

comment on function public.mail_venue_cap_reached(uuid) is
  'True when the venue sent mail_venue_daily_cap() invitation mails (any '
  'mail_log type, failed attempts excluded since 20261011120000) in the '
  'current UTC day. service_role only.';

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

  -- The decline mails are exempt from the window and do not start one. A
  -- failed attempt (nothing went out) does not start one either.
  if p_type not in ('team_invite_declined', 'team_invite_declined_confirm')
     and exists (
       select 1 from public.mail_log m
        where m.recipient_hash = p_recipient_hash
          and m.type not in ('team_invite_declined', 'team_invite_declined_confirm')
          and m.status <> 'failed'
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
  'exempt, 20261007150100; failed attempts do not count, 20261011120000) and a '
  'venue past mail_venue_daily_cap() for the UTC day. Check constraints '
  'validate the input.';
