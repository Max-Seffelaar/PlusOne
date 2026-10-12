-- Quota grants only for people tied to the company (follow-up to #466 review;
-- same rule as event_organizers_insert_admin, 20261007150200).
--
-- The hole: quotas_insert_admin and event_quotas_insert_admin (current form:
-- 20260624160000) only check that the CALLER is an admin of the venue, never
-- that the row's user_id has anything to do with that venue. The update
-- policies check the same, and the table-wide UPDATE grant lets them repoint
-- user_id (and venue_id / event_id) on an existing row. Anyone can create a
-- company (New venue), so any self-made admin could:
--   * insert a quota for an arbitrary uuid: FK error (23503) vs success is an
--     account-existence oracle on user_profiles;
--   * get a `quotas` / `event_quotas` audit row written with that uuid as its
--     subject: junk in their own trail, and (until #466 round 1 dropped quota
--     subjects from venue_actor_names' footprint) a name oracle;
--   * do the same with an UPDATE that repoints user_id on a legit row.
--
-- The fix (no new table, no grant change on the tables):
-- 1. INSERT (quotas_insert_admin, event_quotas_insert_admin): still an admin of
--    the venue, AND the target is tied to that venue (public.is_tied_to_venue:
--    a member, or crew on any event of the venue) OR the caller is a platform
--    admin (decision #49, mirrors event_organizers_insert_admin exactly).
-- 2. UPDATE (quotas_update_admin, event_quotas_update_admin): the same
--    condition on the existing row (USING) and on the new row (WITH CHECK).
-- 3. Key columns are immutable: a BEFORE UPDATE trigger refuses (42501) any
--    change to id, venue_id / event_id or user_id. A quota belongs to one person
--    at one venue/event for life; to move it, delete it and grant a new one.
--    Why a trigger and not a column-level UPDATE grant (the venue_memberships
--    fix in 20261007150200): both app writers are PostgREST upserts
--    (setDefaultQuotaAction, upsertCrewQuota), which PostgREST compiles to
--    `ON CONFLICT DO UPDATE SET <every payload column> = EXCLUDED.<col>`. That
--    needs UPDATE privilege on user_id/venue_id/event_id even though the value
--    never changes, so a column grant would break the Team screen and the crew
--    sheet. The trigger compares OLD and NEW, so the upsert (same key) passes
--    and only a real change is refused, for every role. A key name that is no
--    column (rename, typo) raises 42883 instead of passing silently.
-- 4. approve_quota_request (SECURITY DEFINER, so RLS does not apply inside it)
--    refuses (42501) when the requester is no longer tied to the venue, e.g. a
--    member who filed a request and then left (review round 1).
-- DELETE policies are unchanged: an admin can still remove a quota row of
-- someone no longer tied (e.g. a row forged before this migration).
--
-- Legit writers checked (none affected):
--   * accept_invite_for_caller / accept_invites_for_caller are SECURITY DEFINER
--     (owner postgres, RLS not forced) — RLS does not apply; they write a quota
--     for the invitee at the moment of their own accept, never change a key.
--   * approve_quota_request: SECURITY DEFINER too; now checks the tie itself
--     (4. above); its upsert sets quota_override only.
--   * setDefaultQuotaAction (src/features/quotas/default-quota-actions.ts): Team
--     screen, target is a member of the venue → tied.
--   * upsertCrewQuota (src/features/events/actions.ts) from assignOrganizer
--     (runs after the event_organizers insert, so the target is crew → tied) and
--     setEventUserQuota (crew sheet, team member per-event quota → tied).
--   * Templates write no quota rows. Seed / e2e / promo scripts use the
--     service role (RLS bypass) and never change a key column.
--
-- Grant matrix: unchanged for quotas / event_quotas. The new trigger function
-- is executable by nobody directly (revoked from public, anon, authenticated,
-- service_role); triggers do not need EXECUTE. approve_quota_request keeps its
-- ACL (EXECUTE: authenticated, service_role; not public/anon), re-asserted.

-- ── policies ────────────────────────────────────────────────────────────────
alter policy quotas_insert_admin on public.quotas
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    and (
      public.is_platform_admin()
      or public.is_tied_to_venue(venue_id, user_id)
    )
  );

alter policy quotas_update_admin on public.quotas
  using (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    and (
      public.is_platform_admin()
      or public.is_tied_to_venue(venue_id, user_id)
    )
  )
  with check (
    public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    and (
      public.is_platform_admin()
      or public.is_tied_to_venue(venue_id, user_id)
    )
  );

alter policy event_quotas_insert_admin on public.event_quotas
  with check (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and (
      public.is_platform_admin()
      or public.is_tied_to_venue(public.event_venue(event_id), user_id)
    )
  );

alter policy event_quotas_update_admin on public.event_quotas
  using (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and (
      public.is_platform_admin()
      or public.is_tied_to_venue(public.event_venue(event_id), user_id)
    )
  )
  with check (
    public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
    and (
      public.is_platform_admin()
      or public.is_tied_to_venue(public.event_venue(event_id), user_id)
    )
  );

-- ── immutable key columns ───────────────────────────────────────────────────
create function public.refuse_key_column_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
begin
  -- TG_ARGV = the key columns of this table. Compared as jsonb so one function
  -- serves both tables. A name that is not a column (a later rename, a typo)
  -- would read null on both sides and pass silently, so it fails closed: every
  -- UPDATE of the table errors until the trigger names the real column again.
  foreach k in array tg_argv loop
    if not (to_jsonb(new) ? k) then
      raise exception using
        errcode = '42883',
        message = format('%s has no column %s', tg_table_name, k);
    end if;
    if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      raise exception using
        errcode = '42501',
        message = format('%s.%s cannot be changed', tg_table_name, k);
    end if;
  end loop;
  return new;
end;
$$;

comment on function public.refuse_key_column_change() is
  'BEFORE UPDATE trigger (20261016150000): refuses (42501) a change to any column named in TG_ARGV. Used to keep quotas / event_quotas rows pinned to their person and venue/event.';

revoke execute on function public.refuse_key_column_change() from public, anon, authenticated, service_role;

create trigger quotas_keys_immutable
  before update on public.quotas
  for each row execute function public.refuse_key_column_change('id', 'venue_id', 'user_id');

create trigger event_quotas_keys_immutable
  before update on public.event_quotas
  for each row execute function public.refuse_key_column_change('id', 'event_id', 'user_id');

-- ── approve_quota_request: the requester must still be tied ─────────────────
-- Review round 1 (P2): the RPC is SECURITY DEFINER, so the new event_quotas
-- policies do not apply inside it. A member files a request, leaves the
-- company, and an admin approves the still-pending request: that wrote an
-- event_quotas row for someone no longer tied to the venue. Now refused with
-- 42501 (the app maps it to the generic no-permission copy); the admin can
-- still deny it. Checked after the admin check, so a non-admin learns nothing
-- about the tie. The rest is the 20260925140100 definition verbatim:
-- signature, `returns void`, SECURITY DEFINER, `set search_path = ''`, the row
-- lock, error codes/messages, override maths. Grants re-asserted below.
create or replace function public.approve_quota_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quota_requests;
  v_venue uuid;
  v_current int;
  v_rows int;
begin
  select * into v_req from public.quota_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Quota-verzoek niet gevonden.';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = '45003',
      message = 'Dit verzoek is al afgehandeld.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not public.has_venue_role(v_venue, '{admin}'::public.venue_role[]) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin mag quota-verzoeken goedkeuren.';
  end if;

  if not (public.is_platform_admin() or public.is_tied_to_venue(v_venue, v_req.user_id)) then
    raise exception using errcode = '42501',
      message = 'Deze aanvrager hoort niet meer bij deze company.';
  end if;

  -- New override = the requester's current effective quota + the granted extra.
  v_current := public.user_event_quota(v_req.event_id, v_req.user_id);
  insert into public.event_quotas (event_id, user_id, quota_override)
  values (v_req.event_id, v_req.user_id, v_current + v_req.requested_extra)
  on conflict (event_id, user_id)
  do update set quota_override = excluded.quota_override;

  update public.quota_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_request_id
    and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    -- Unreachable while the row lock above holds; raising rolls back the
    -- override written a few lines up.
    raise exception using errcode = '45003',
      message = 'Dit verzoek is al afgehandeld.';
  end if;
end;
$$;

revoke execute on function public.approve_quota_request(uuid) from public, anon;
grant execute on function public.approve_quota_request(uuid) to authenticated, service_role;
