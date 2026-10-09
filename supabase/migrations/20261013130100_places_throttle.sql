-- Onboarding A (z8uq9m2vg5): rate limit for the Places proxy
-- (src/app/api/places/route.ts, spike 9.6).
--
-- The proxy spends our Google Places quota on every call, so a stolen or
-- scripted session must not be able to drain it. consume_public_throttle() is
-- internal-only (execute revoked from every app role, 20260706102000); the
-- sanctioned pattern is a SECURITY DEFINER wrapper that derives the key on the
-- server, like consume_platform_invite_throttle() (20260923150000).
--
-- consume_places_throttle(): 120 calls per 10 minutes per signed-in user,
-- autocomplete and details together. Any authenticated user may call it: the
-- address field sits in onboarding, before the user has a company. auth.uid()
-- null -> 42501. The key is 'plc:' || auth.uid(): server-derived, never a
-- client value, so it carries no ip-hash prefix and does not belong in the
-- prefix list of public-throttle-prefixes.test.ts.
--
-- Grants: new functions start closed (20260917100000 default ACL); revoke from
-- public/anon/service_role first, then grant to authenticated only. No table
-- or view, so no grant-matrix entry.

create function public.consume_places_throttle()
returns boolean -- true = within budget, false = rate-limited
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.consume_public_throttle('plc:' || v_uid::text, 10, 120);
end;
$$;

comment on function public.consume_places_throttle() is
  'Places proxy rate limit: 120 calls per 10 minutes per signed-in user '
  '(autocomplete + details). true = within budget. 42501 without a session.';

revoke execute on function public.consume_places_throttle() from public, anon, service_role;
grant execute on function public.consume_places_throttle() to authenticated;
