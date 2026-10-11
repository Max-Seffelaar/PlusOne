-- venue_actor_names hardening (review round 1 of #466; spec #62(a)).
--
-- 1. Forged footprint (P1). The past-membership branch also accepted the
--    subject of a `quotas` / `event_quotas` audit row. quotas_insert_admin and
--    event_quotas_insert_admin only check that the CALLER is an admin there, not
--    that `user_id` is tied to the venue, and anyone can create their own
--    company. So: create a company, grant a quota to an arbitrary uuid, and the
--    trigger-written audit row made venue_actor_names return that person's name
--    (or their is_support flag, i.e. "this uuid is a PlusOne operator"). The
--    branch now accepts `venue_memberships` subjects only: a real past
--    membership can only come from accept_invite (the invitee's own tap) or a
--    platform admin. The quota RLS itself is tightened in a separate change.
--
-- 2. Reserved names (P1). "PlusOne support", "System" and "Unnamed" are the
--    app's who-did-what labels (t.shared.actor). A user could name themselves
--    "PlusOne support" (or blank) and read as support on every surface. The app
--    now decides "PlusOne support" from is_support only; on top of that a CHECK
--    keeps those words (case/whitespace-insensitive) and the empty name out of
--    user_profiles.full_name. NOT VALID: existing rows are not re-checked
--    (expand-safe); every INSERT and every UPDATE of a row is.
--    Profile rows are also created by SECURITY DEFINER paths (ensure_my_profile,
--    create_venue_with_owner, the invite accepts) from auth metadata, which the
--    invite seeds with the e-mail local part — "system@company.nl" would
--    otherwise make the first login fail on the CHECK. A BEFORE INSERT trigger
--    therefore replaces a reserved/blank name on a NEW row with 'User' (the
--    consent screen asks for the real name next). UPDATEs are refused (23514),
--    never rewritten: that is the user's own edit and gets a proper error.
--    Look-alike letters ("PIusOne", Cyrillic) pass this CHECK; they are
--    covered by the typed-label rule below, not by the CHECK.
--    Review round 2 (N1): btrim() strips only ASCII spaces, so NBSP/tab/CR/LF/
--    zero-width-wrapped "PlusOne support" and invisible-only blanks got past the
--    first version (CHECK and trigger alike). Now ONE normaliser,
--    public.profile_name_key(): it deletes control + format characters
--    (C0/C1, soft hyphen, ZW space/joiners, LRM/RLM, bidi embeddings and
--    overrides, word joiner + invisible operators, BOM), maps every Unicode
--    space to one ASCII space, lower-cases and trims. The CHECK refuses any
--    control/format character outright (no real name has one) AND a blank or
--    reserved key. The app mirrors the exact classes (src/features/auth/
--    profile-name.ts) for Zod and for the "blank → Unnamed" display rule.
--    Review round 3: a hand-picked class is whack-a-mole (U+2066, U+034F,
--    U+FE0F, U+3164, U+E0001 still passed). The class is now EVERY
--    Default_Ignorable_Code_Point plus Cc and Cf (from U+0001; Postgres text
--    cannot hold U+0000), listed as explicit ranges because Postgres regex has
--    no \p{}. The identical list is INVISIBLE_RANGES in
--    src/features/auth/profile-name.ts, and profile-name.cross-check.test.ts
--    walks U+0000..U+10FFFF to prove (a) this migration's class equals that
--    list and (b) the list covers everything the runtime's Unicode tables call
--    DI/Cc/Cf. Spaces: every Unicode space separator plus U+2800 (braille
--    blank) are one space; the Hangul fillers are default-ignorable, so they
--    vanish. 'unknown' joins the reserved words (it is a label too).
--    And this CHECK is no longer the primary guarantee: every surface renders
--    PlusOne's labels as a TYPED label (kit ActorName: muted, italic, icon) and
--    a member's name as plain text, so no name — look-alike or not — can pass
--    for "PlusOne support" or "System". The CHECK is defence in depth.
--    Caveat of NOT VALID: Postgres re-checks the whole row on ANY update, so a
--    pre-existing offending row would refuse every later update of that row
--    (terms, MFA snooze) until the name is fixed. Checked on prod before the
--    push (aggregates only, orchestrator 2026-10-11): 22 profiles, 0 containing
--    a control/format/default-ignorable character, 0 with a Unicode space, 0
--    blank or reserved (incl. 'unknown') after this normalisation, 0 whose
--    first word is reserved.
--
-- 3. Guests branch (P2). `events join guests on added_by` walked every event of
--    the venue per id. It is now bound to the venue column directly, with a
--    partial index on guests(venue_id, added_by).
--
-- 4. p_venue_id null returns nothing up front (it already did by accident).
--
-- Signature, result type and grants unchanged (CREATE OR REPLACE; re-asserted).

-- ---------------------------------------------------------------------------
-- Reserved display names
-- ---------------------------------------------------------------------------

-- The comparison key for a display name. KEEP the two character classes in
-- sync with src/features/auth/profile-name.ts.
create or replace function public.profile_name_key(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(lower(regexp_replace(
           regexp_replace(coalesce(p_name, ''), '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]', '', 'g'),
           '[ \u00A0\u1680\u2000-\u200A\u2028-\u2029\u202F\u205F\u2800\u3000]+', ' ', 'g')));
$$;

comment on function public.profile_name_key(text) is
  'Display-name comparison key (spec #62a): control/format characters removed, '
  'Unicode spaces collapsed to one space, lower-cased, trimmed. Used by the '
  'user_profiles_full_name_not_reserved CHECK and the new-row sanitizer.';

-- The CHECK evaluates the function as the role doing the INSERT/UPDATE, so the
-- roles that write user_profiles need EXECUTE (it is pure and reveals nothing).
revoke execute on function public.profile_name_key(text) from public, anon;
grant execute on function public.profile_name_key(text) to authenticated, service_role;

alter table public.user_profiles
  add constraint user_profiles_full_name_not_reserved
  check (
    full_name !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]'
    and public.profile_name_key(full_name) <> ''
    and public.profile_name_key(full_name) not in ('plusone support', 'system', 'unnamed', 'unknown')
  ) not valid;

create or replace function public.user_profiles_sanitize_new_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Same rule as the CHECK above. Invisible characters are stripped first so an
  -- invitee whose auth metadata carries one is not locked out of their first
  -- login; a blank or reserved key then becomes 'User'.
  new.full_name := regexp_replace(coalesce(new.full_name, ''), '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]', '', 'g');
  if public.profile_name_key(new.full_name) = ''
     or public.profile_name_key(new.full_name) in ('plusone support', 'system', 'unnamed', 'unknown') then
    new.full_name := 'User';
  end if;
  return new;
end;
$$;

revoke execute on function public.user_profiles_sanitize_new_name() from public, anon, authenticated, service_role;

drop trigger if exists user_profiles_sanitize_new_name on public.user_profiles;
create trigger user_profiles_sanitize_new_name
  before insert on public.user_profiles
  for each row execute function public.user_profiles_sanitize_new_name();

-- ---------------------------------------------------------------------------
-- Guests footprint index
-- ---------------------------------------------------------------------------

create index if not exists guests_venue_added_by_idx
  on public.guests (venue_id, added_by)
  where added_by is not null;

-- ---------------------------------------------------------------------------
-- venue_actor_names
-- ---------------------------------------------------------------------------

create or replace function public.venue_actor_names(p_venue_id uuid, p_ids uuid[])
returns table (user_id uuid, display_name text, is_support boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_full boolean;
  v_events uuid[];
begin
  if p_venue_id is null or p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'venue_actor_names: at most 500 ids per call' using errcode = '22023';
  end if;

  -- Member (or platform admin): the whole venue. Crew only: their own events.
  v_full := public.is_venue_member(p_venue_id);
  if not v_full then
    select coalesce(array_agg(eo.event_id), '{}'::uuid[])
      into v_events
      from public.event_organizers eo
      join public.events e on e.id = eo.event_id
     where eo.user_id = (select auth.uid())
       and e.venue_id = p_venue_id;
    if cardinality(v_events) = 0 then
      return; -- not authorised: no rows, nothing learned
    end if;
  end if;

  return query
  with ids as (
    select distinct x.id
      from unnest(p_ids) as x(id)
     where x.id is not null
  )
  select
    p.id,
    case when s.support then null else p.full_name end,
    s.support
  from ids
  join public.user_profiles p on p.id = ids.id
  cross join lateral (
    select p.is_platform_admin
       and not exists (
         select 1 from public.venue_memberships m
          where m.venue_id = p_venue_id and m.user_id = p.id)
       and not exists (
         select 1 from public.event_organizers eo
           join public.events e on e.id = eo.event_id
          where eo.user_id = p.id and e.venue_id = p_venue_id) as support
  ) s
  where
    -- current member (every authorised caller may already see these)
    exists (
      select 1 from public.venue_memberships m
       where m.venue_id = p_venue_id and m.user_id = p.id)
    -- crew tie
    or exists (
      select 1 from public.event_organizers eo
        join public.events e on e.id = eo.event_id
       where eo.user_id = p.id
         and e.venue_id = p_venue_id
         and (v_full or eo.event_id = any (v_events)))
    -- an audited action in the venue (actor_id is always auth.uid(): unforgeable)
    or exists (
      select 1 from public.audit_log a
       where a.actor_id = p.id
         and a.venue_id = p_venue_id
         and (v_full or a.event_id = any (v_events)))
    -- a past membership (members only). venue_memberships only: a quota row
    -- can name any uuid (see header), a membership only via accept/platform.
    or (v_full and exists (
      select 1 from public.audit_log a
       where a.venue_id = p_venue_id
         and a.entity_type = 'venue_memberships'
         and coalesce(a.diff -> 'after' ->> 'user_id', a.diff -> 'before' ->> 'user_id') = p.id::text))
    -- added a guest in the venue (added_by is pinned to the caller by RLS)
    or exists (
      select 1 from public.guests g
       where g.venue_id = p_venue_id
         and g.added_by = p.id
         and (v_full or g.event_id = any (v_events)));
end;
$$;

comment on function public.venue_actor_names(uuid, uuid[]) is
  'Who-did-what labels for one venue (spec #62a): full_name for current and '
  'former members/crew, is_support (null name) for a platform admin without a '
  'membership/crew tie there. Only ids with an unforgeable footprint in that '
  'venue come back; members see the venue, crew their own events, anyone else '
  'nothing. Max 500 ids.';

revoke execute on function public.venue_actor_names(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.venue_actor_names(uuid, uuid[]) to authenticated;
