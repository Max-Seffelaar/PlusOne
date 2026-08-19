-- pgTAP — 86eymckjt: `guests.added_by` is bound on UPDATE.
--
-- Proves migration 20260819100000_guests_update_bind_added_by: the column may
-- stay as it is or move to the caller, never to a third party (or NULL). Before
-- it, `guests_update`'s WITH CHECK evaluated its role branch on `auth.uid()` and
-- said nothing about the VALUE of `added_by`, so every admin/doorhost/organizer
-- could re-attribute any guest in one write — and because `enforce_guest_quota`
-- tests the exemption on `new.added_by`, pointing a row at a (quota-exempt)
-- venue admin made the whole personal-quota branch skip. That is the exploit
-- section A closes.
--
-- Section B is the other half of the task, and the real risk of this change: the
-- guard is a BEFORE UPDATE trigger precisely so updates that never mention
-- `added_by` keep working. A WITH CHECK would re-validate the resulting row and
-- freeze every guest an admin/doorhost/organizer is supposed to be able to edit.
--
-- Same seed as rls.test.sql / outbox_owner_stamp.test.sql (venue1 = aa..01 Club
-- Vesper, event ee..01 'open'). Everything rolls back.
--
-- The cast, and why each one matters here:
--   1111 admin      -> venue admin: quota-EXEMPT, the forgery target of choice
--   4444 organizer  -> event scope, not exempt (event_quotas override 10)
--   5555 staff      -> Tom, quota 12, owns the 6 bulk guests ord 1..6
--   6666 doorhost   -> Lisa, quota 5, consumes 2 (Joep + 1 plus-one)
--
-- State assertions are read after `reset role` on purpose: as `authenticated`,
-- an RLS-hidden row reads as NULL and would let a broken guard pass silently.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_aal text default 'aal1')
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(20);

-- ---------------------------------------------------------------------------
-- A. The hole, closed — re-attribution is refused for every role that can write
-- ---------------------------------------------------------------------------

-- The headline exploit: a doorhost with a nearly-full personal quota re-points a
-- guest at the venue admin. `user_is_quota_exempt` is true for the admin, so
-- `enforce_guest_quota` used to skip the personal branch entirely and charge
-- nobody's meter. 'Femke Aalders' belongs to staff member Tom (5555).
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$
  update public.guests
     set added_by = '11111111-1111-4111-8111-111111111111'
   where full_name = 'Femke Aalders'
$$, '42501', null, 'A1 a doorhost cannot re-point added_by at the quota-exempt admin');

reset role;
select is(
  (select added_by from public.guests where full_name = 'Femke Aalders'),
  '55555555-5555-4555-8555-555555555555'::uuid,
  'A2 the original adder survives the rejected rewrite');

-- NULL is the "auto-approved via a request link" attribution (F1) and belongs to
-- no meter at all, so it is the same escape by another route — `is distinct
-- from` on both sides is what makes this branch reachable.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select throws_ok($$
  update public.guests
     set added_by = null
   where full_name = 'Femke Aalders'
$$, '42501', null, 'A3 nor at NULL, which would charge no meter at all');

-- An organizer reaches the row through event scope rather than a venue role —
-- the third branch of the policy, equally unconstrained before this migration.
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select throws_ok($$
  update public.guests
     set added_by = '11111111-1111-4111-8111-111111111111'
   where full_name = 'Femke Aalders'
$$, '42501', null, 'A4 an event organizer cannot re-attribute either');

-- The rule binds the VALUE, not the role: an admin may edit anyone's guest, but
-- may not hand one to a third party. This is the case the WITH CHECK could never
-- have caught, since the admin passes its role branch outright.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select throws_ok($$
  update public.guests
     set added_by = '66666666-6666-4666-8666-666666666666'
   where full_name = 'Femke Aalders'
$$, '42501', null, 'A5 not even an admin may hand a guest to a third party');

-- Staff reach their own rows through `added_by = auth.uid()`, so the row is
-- matched and the guard — not a silent 0-row update — is what stops them.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$
  update public.guests
     set added_by = '66666666-6666-4666-8666-666666666666'
   where full_name = 'Femke Aalders'
$$, '42501', null, 'A6 a staff member cannot push their own guest onto a colleague');

reset role;
select is(
  (select added_by from public.guests where full_name = 'Femke Aalders'),
  '55555555-5555-4555-8555-555555555555'::uuid,
  'A7 and after all five attempts the guest is still Tom''s');

-- ---------------------------------------------------------------------------
-- B. Every legitimate update still works — the reason this is a trigger
-- ---------------------------------------------------------------------------
-- A bound expressed in WITH CHECK re-validates the RESULTING ROW, so it fires on
-- updates that never mention `added_by`. These are exactly the writes
-- `src/features/guests/actions.ts` and the door outbox gateway perform on
-- another user's guest every day.

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  update public.guests
     set note = 'Vriend van de bar', note_priority = 'high'
   where full_name = 'Femke Aalders'
$$, 'B1 a doorhost still edits the note on someone else''s guest');

select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$
  update public.guests
     set note = 'Komt met de fotograaf mee', note_priority = 'none'
   where full_name = 'Femke Aalders'
$$, 'B2 an admin still edits a staff member''s guest');

-- Tier change (single) through the organizer branch. VIP has no max_guests, so
-- this cannot trip 45002 and the assertion stays about the guard.
select pg_temp.login('44444444-4444-4444-8444-444444444444');
select lives_ok($$
  update public.guests
     set tier_id = 'dd000000-0000-7000-8000-000000000002'
   where full_name = 'Femke Aalders'
$$, 'B3 an organizer still changes the tier on a staff member''s guest');

-- Bulk tier change (`changeGuestTiers`, a single .update().in()).
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$
  update public.guests
     set tier_id = 'dd000000-0000-7000-8000-000000000002'
   where full_name in ('Roos Hendriks', 'Finn van Egmond', 'Eva Postma')
$$, 'B4 the bulk tier change still applies across several guests');

-- undoRefusal: refused -> approved on a guest the doorhost does not own.
select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  update public.guests
     set status = 'approved'
   where full_name = 'Bram de Groot' and status = 'refused'
$$, 'B5 undoRefusal still re-admits a guest added by someone else');

-- Soft delete (#21) — the app never hard-deletes, so this is the delete path.
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select lives_ok($$
  update public.guests
     set status = 'removed'
   where full_name = 'Femke Aalders'
$$, 'B6 an admin still soft-deletes a staff member''s guest');

reset role;
select is(
  (select added_by from public.guests where full_name = 'Femke Aalders'),
  '55555555-5555-4555-8555-555555555555'::uuid,
  'B7 and none of those updates moved the attribution');

-- Writing the column with the value it already holds is not a change. The app
-- does not do this, but any client that PATCHes a whole row would.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select lives_ok($$
  update public.guests
     set added_by = '55555555-5555-4555-8555-555555555555', note = 'Vaste gast'
   where full_name = 'Daniël Verhoeven'
$$, 'B8 re-writing added_by with its own value is a no-op, not a change');

-- ---------------------------------------------------------------------------
-- C. Taking ownership — the one move the rule allows, and it charges the taker
-- ---------------------------------------------------------------------------
-- Moving `added_by` to the caller grants nothing: `enforce_guest_quota` sees
-- `old.added_by <> new.added_by`, so the old contribution counts as 0 and the
-- full new one lands on the caller's own meter. Lisa (doorhost) has quota 5 and
-- consumes 2 (Joep + 1 plus-one); 'Nina Driessen' is one of Max's, approved,
-- no plus-ones, so this lands her on 3.

select pg_temp.login('66666666-6666-4666-8666-666666666666');
select lives_ok($$
  update public.guests
     set added_by = '66666666-6666-4666-8666-666666666666'
   where full_name = 'Nina Driessen'
$$, 'C1 a caller may take a guest onto their own name');

reset role;
select is(
  (select added_by from public.guests where full_name = 'Nina Driessen'),
  '66666666-6666-4666-8666-666666666666'::uuid,
  'C2 and the row now names the caller');

select is(
  public.user_event_consumption(
    'ee000000-0000-7000-8000-000000000001',
    '66666666-6666-4666-8666-666666666666'),
  3,
  'C3 the taken-over guest is charged to the taker''s own quota, not skipped');

-- ---------------------------------------------------------------------------
-- D. Non-client contexts stay exempt — and the exemption keys on the ROLE
-- ---------------------------------------------------------------------------
-- The guard fires for everyone, including migrations, seeds, pgTAP fixtures and
-- every SECURITY DEFINER function — the paths RLS deliberately does not apply to
-- either (`guests` is not FORCE ROW LEVEL SECURITY). Bounding them would be a
-- behaviour change outside this task.
--
-- The discriminator must be `current_user`, never "no JWT": `reset role` restores
-- the role WITHOUT clearing `request.jwt.claims`, so `auth.uid()` keeps
-- answering with the last logged-in user. D2 pins that trap open — if the guard
-- is ever rewritten to key on `auth.uid() is null`, D1 starts failing while D2
-- keeps showing why.

reset role;
select lives_ok($$
  update public.guests
     set added_by = '55555555-5555-4555-8555-555555555555'
   where full_name = 'Nina Driessen'
$$, 'D1 a superuser context may still re-attribute (seeds, fixtures, definer RPCs)');

select is(
  (select auth.uid()),
  '66666666-6666-4666-8666-666666666666'::uuid,
  'D2 and it did so with a JWT claim still standing — the exemption is the role, not the uid');

reset role;

select * from finish();
rollback;
