-- Billing-mail follow-ups (z8uq9m49k4; review #446 nit D1).
--
-- The mail provider now reports a Resend 409 (Idempotency-Key conflict: the
-- first request is still in flight, or a retry carried a different body) as
-- its own error code, 'idempotency_conflict', instead of 'provider_rejected'.
-- log_billing_mail already never retries it (it is not in the transient list
-- of 20261013170000), so no second mail can follow. What changes here is how
-- the Platform timeline counts it: the first attempt may well have been
-- delivered, so the row is "outcome unknown" (new count `unknown`), not a
-- plain failure.
--
-- platform_billing_mail_timeline is re-created with only that count added;
-- body otherwise identical to 20261013170000 (is_platform_admin() first,
-- counts only, no address). create or replace keeps the ACL; the grant
-- matrix is re-asserted below anyway. Expand-only: the deployed app ignores
-- the extra key until it reads it.

create or replace function public.platform_billing_mail_timeline(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'paused', coalesce((select bs.paused from public.billing_mail_settings bs
                         where bs.venue_id = p_venue_id), false),
    'subscription', (
      select jsonb_build_object(
               'status', s.status,
               'created_at', s.created_at,
               'trial_ends_at', case when s.status = 'trialing'
                 then coalesce(s.trial_ends_at, s.created_at + interval '14 days') end,
               'stripe_linked', s.stripe_subscription_id is not null)
        from public.subscriptions s
       where s.venue_id = p_venue_id),
    'mails', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.first_at desc, g.dedupe_key)
        from (
          select d.type,
                 d.dedupe_key,
                 min(m.created_at) as first_at,
                 count(*)::int as recipients,
                 count(*) filter (where m.status in ('queued', 'sent', 'delivery_delayed'))::int as sending,
                 count(*) filter (where m.status = 'delivered')::int as delivered,
                 count(*) filter (where m.status = 'failed'
                                    and m.error_code is distinct from 'idempotency_conflict')::int as failed,
                 -- Resend 409 on the reused Idempotency-Key: the first attempt
                 -- may have been delivered, so "outcome unknown", not failed.
                 count(*) filter (where m.status = 'failed'
                                    and m.error_code = 'idempotency_conflict')::int as unknown,
                 count(*) filter (where m.status in ('bounced', 'complained'))::int as bounced
            from public.billing_mail_deliveries d
            join public.mail_log m on m.id = d.mail_log_id
           where d.venue_id = p_venue_id
           group by d.type, d.dedupe_key
           order by min(m.created_at) desc
           limit 50
        ) g
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.platform_billing_mail_timeline(uuid) is
  'Platform tab (is_platform_admin, 42501 otherwise): the billing mails a '
  'company got, grouped per mail (counts per delivery status, a Resend '
  'idempotency conflict counted as unknown, 20261015135000), whether billing '
  'mail is paused, and the subscription facts the next-mail line needs.';

revoke execute on function public.platform_billing_mail_timeline(uuid) from public, anon, service_role;
grant execute on function public.platform_billing_mail_timeline(uuid) to authenticated;
