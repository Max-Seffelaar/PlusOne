-- RLS Helper Functions and Comprehensive Policies
-- Migration for comprehensive Row Level Security policies

-- === HELPER FUNCTIONS (security definer) ===

create or replace function user_venue_roles(p_venue_id uuid)
returns venue_role[]
language sql stable security definer set search_path = public
as $$ select roles from venue_memberships where venue_id = p_venue_id and user_id = auth.uid() limit 1; $$;

create or replace function is_event_organizer(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from event_organizers where event_id = p_event_id and user_id = auth.uid()); $$;

create or replace function has_aal2()
returns boolean
language sql stable security definer set search_path = public
as $$ select (auth.jwt()->>'aal')::text = '2'; $$;

create or replace function event_list_locked(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select list_locked from events where id = p_event_id limit 1; $$;

create or replace function event_venue_id(p_event_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select venue_id from events where id = p_event_id limit 1; $$;

create or replace function quota_usage(p_user_id uuid, p_event_id uuid)
returns int
language sql stable security definer set search_path = public
as $$ select coalesce(sum(1 + coalesce(guests.plus_ones, 0)), 0) from guests where added_by = p_user_id and event_id = p_event_id and status != 'removed' and status != 'denied'; $$;

create or replace function quota_limit(p_user_id uuid, p_event_id uuid)
returns int
language sql stable security definer set search_path = public
as $$ select coalesce(eq.override_count, q.default_count, 5) from events e left join event_quotas eq on eq.event_id = e.id and eq.user_id = p_user_id left join quotas q on q.venue_id = e.venue_id and q.user_id = p_user_id where e.id = p_event_id limit 1; $$;

create or replace function quota_remaining(p_user_id uuid, p_event_id uuid)
returns int
language sql stable security definer set search_path = public
as $$ select (quota_limit(p_user_id, p_event_id) - quota_usage(p_user_id, p_event_id)); $$;

create or replace function is_venue_member(p_venue_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from venue_memberships where venue_id = p_venue_id and user_id = p_user_id and array_length(roles, 1) > 0); $$;

create or replace function has_venue_role(p_venue_id uuid, p_role venue_role)
returns boolean
language sql stable security definer set search_path = public
as $$ select p_role = any(user_venue_roles(p_venue_id)); $$;

-- === RLS POLICIES ===
-- Tables: users, venues, venue_memberships, events, event_organizers, guest_tiers, guests, guest_requests, quotas, event_quotas, quota_requests, check_ins, refusals, audit_log, subscriptions

-- Users: self and same-venue access
drop policy if exists users_select_own on users;
drop policy if exists users_select_in_venue on users;
create policy users_select on users for select using (auth.uid() = id or exists(select 1 from venue_memberships vm1 where vm1.user_id = auth.uid() and exists(select 1 from venue_memberships vm2 where vm2.venue_id = vm1.venue_id and vm2.user_id = users.id)));
create policy users_update_own_email on users for update using (auth.uid() = id) with check (auth.uid() = id);

-- Venues: member access, admin edit
drop policy if exists venues_select_if_member on venues;
create policy venues_select on venues for select using (is_venue_member(id, auth.uid()));
create policy venues_update on venues for update using (has_venue_role(id, 'admin'::venue_role)) with check (has_venue_role(id, 'admin'::venue_role));

-- Venue Memberships: admin/user_manager invite, admin role update (AAL2)
drop policy if exists venue_memberships_select on venue_memberships;
create policy venue_memberships_select on venue_memberships for select using (auth.uid() = user_id or has_venue_role(venue_id, 'admin'::venue_role));
create policy venue_memberships_insert on venue_memberships for insert with check (has_venue_role(venue_id, 'admin'::venue_role) or has_venue_role(venue_id, 'user_manager'::venue_role));
create policy venue_memberships_update on venue_memberships for update using (has_venue_role(venue_id, 'admin'::venue_role) and has_aal2()) with check (has_venue_role(venue_id, 'admin'::venue_role) and has_aal2());

-- Events: member view, admin edit
drop policy if exists events_select_if_member on events;
create policy events_select on events for select using (is_venue_member(venue_id, auth.uid()));
create policy events_insert on events for insert with check (is_venue_member(venue_id, auth.uid()) and has_venue_role(venue_id, 'admin'::venue_role));
create policy events_update on events for update using (is_venue_member(venue_id, auth.uid()) and has_venue_role(venue_id, 'admin'::venue_role)) with check (is_venue_member(venue_id, auth.uid()) and has_venue_role(venue_id, 'admin'::venue_role));

-- Event Organizers: venue member view, admin edit
create policy event_organizers_select on event_organizers for select using (is_venue_member(event_venue_id(event_id), auth.uid()));
create policy event_organizers_insert on event_organizers for insert with check (has_venue_role(event_venue_id(event_id), 'admin'::venue_role));
create policy event_organizers_update on event_organizers for update using (has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) with check (has_venue_role(event_venue_id(event_id), 'admin'::venue_role));

-- Guest Tiers: member view, admin/organizer edit
drop policy if exists guest_tiers_select_if_member on guest_tiers;
create policy guest_tiers_select on guest_tiers for select using (is_venue_member(event_venue_id(event_id), auth.uid()));
create policy guest_tiers_insert on guest_tiers for insert with check ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id)));
create policy guest_tiers_update on guest_tiers for update using ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id))) with check ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id)));

-- Guests: complex role-based visibility & quota enforcement
drop policy if exists guests_default_deny on guests;
create policy guests_select on guests for select using ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (has_venue_role(event_venue_id(event_id), 'finance'::venue_role)) or (is_event_organizer(event_id)) or (has_venue_role(event_venue_id(event_id), 'staff'::venue_role) and added_by = auth.uid()) or (has_venue_role(event_venue_id(event_id), 'doorhost'::venue_role)));
create policy guests_insert on guests for insert with check (is_venue_member(event_venue_id(event_id), auth.uid()) and ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id)) or (has_venue_role(event_venue_id(event_id), 'staff'::venue_role) and not event_list_locked(event_id) and quota_remaining(auth.uid(), event_id) > 0) or (has_venue_role(event_venue_id(event_id), 'doorhost'::venue_role) and quota_remaining(auth.uid(), event_id) > 0)));
create policy guests_update on guests for update using (is_venue_member(event_venue_id(event_id), auth.uid()) and ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id)) or (has_venue_role(event_venue_id(event_id), 'staff'::venue_role) and added_by = auth.uid() and not event_list_locked(event_id)) or (has_venue_role(event_venue_id(event_id), 'doorhost'::venue_role) and not event_list_locked(event_id)))) with check (is_venue_member(event_venue_id(event_id), auth.uid()) and ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id)) or (has_venue_role(event_venue_id(event_id), 'staff'::venue_role) and added_by = auth.uid() and not event_list_locked(event_id)) or (has_venue_role(event_venue_id(event_id), 'doorhost'::venue_role) and not event_list_locked(event_id))));

-- Guest Requests: public insert, admin/organizer review & approve
drop policy if exists guest_requests_default_deny on guest_requests;
create policy guest_requests_insert on guest_requests for insert with check (true);
create policy guest_requests_select on guest_requests for select using ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id)));
create policy guest_requests_update on guest_requests for update using ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id))) with check ((has_venue_role(event_venue_id(event_id), 'admin'::venue_role)) or (is_event_organizer(event_id)));

-- Quotas: user sees own, admin sees all (AAL2 for updates)
drop policy if exists quotas_default_deny on quotas;
create policy quotas_select on quotas for select using ((auth.uid() = user_id) or (has_venue_role(venue_id, 'admin'::venue_role)));
create policy quotas_insert on quotas for insert with check (has_venue_role(venue_id, 'admin'::venue_role));
create policy quotas_update on quotas for update using (has_venue_role(venue_id, 'admin'::venue_role) and has_aal2()) with check (has_venue_role(venue_id, 'admin'::venue_role) and has_aal2());

-- Event Quotas: user sees own, admin only (AAL2)
drop policy if exists event_quotas_default_deny on event_quotas;
create policy event_quotas_select on event_quotas for select using ((auth.uid() = user_id) or (has_venue_role(event_venue_id(event_id), 'admin'::venue_role)));
create policy event_quotas_insert on event_quotas for insert with check (has_venue_role(event_venue_id(event_id), 'admin'::venue_role) and has_aal2());
create policy event_quotas_update on event_quotas for update using (has_venue_role(event_venue_id(event_id), 'admin'::venue_role) and has_aal2()) with check (has_venue_role(event_venue_id(event_id), 'admin'::venue_role) and has_aal2());

-- Quota Requests: user self-requests, admin approve (AAL2)
drop policy if exists quota_requests_default_deny on quota_requests;
create policy quota_requests_select on quota_requests for select using ((auth.uid() = user_id) or (has_venue_role(event_venue_id(event_id), 'admin'::venue_role)));
create policy quota_requests_insert on quota_requests for insert with check (auth.uid() = user_id);
create policy quota_requests_update on quota_requests for update using (has_venue_role(event_venue_id(event_id), 'admin'::venue_role) and has_aal2()) with check (has_venue_role(event_venue_id(event_id), 'admin'::venue_role) and has_aal2());

-- Check-ins: admin/organizer/doorhost only
drop policy if exists check_ins_default_deny on check_ins;
create policy check_ins_select on check_ins for select using (exists(select 1 from guests g where g.id = check_ins.guest_id and ((has_venue_role(event_venue_id(g.event_id), 'admin'::venue_role)) or (is_event_organizer(g.event_id)) or (has_venue_role(event_venue_id(g.event_id), 'doorhost'::venue_role)))));
create policy check_ins_insert on check_ins for insert with check (exists(select 1 from guests g where g.id = check_ins.guest_id and ((has_venue_role(event_venue_id(g.event_id), 'admin'::venue_role)) or (is_event_organizer(g.event_id)) or (has_venue_role(event_venue_id(g.event_id), 'doorhost'::venue_role)))));
create policy check_ins_update on check_ins for update using (exists(select 1 from guests g where g.id = check_ins.guest_id and ((has_venue_role(event_venue_id(g.event_id), 'admin'::venue_role)) or (is_event_organizer(g.event_id)) or (has_venue_role(event_venue_id(g.event_id), 'doorhost'::venue_role))))) with check (exists(select 1 from guests g where g.id = check_ins.guest_id and ((has_venue_role(event_venue_id(g.event_id), 'admin'::venue_role)) or (is_event_organizer(g.event_id)) or (has_venue_role(event_venue_id(g.event_id), 'doorhost'::venue_role)))));

-- Refusals: admin/organizer/doorhost only
drop policy if exists refusals_default_deny on refusals;
create policy refusals_select on refusals for select using (exists(select 1 from guests g where g.id = refusals.guest_id and ((has_venue_role(event_venue_id(g.event_id), 'admin'::venue_role)) or (is_event_organizer(g.event_id)) or (has_venue_role(event_venue_id(g.event_id), 'doorhost'::venue_role)))));
create policy refusals_insert on refusals for insert with check (exists(select 1 from guests g where g.id = refusals.guest_id and ((has_venue_role(event_venue_id(g.event_id), 'admin'::venue_role)) or (is_event_organizer(g.event_id)) or (has_venue_role(event_venue_id(g.event_id), 'doorhost'::venue_role)))));

-- Audit Log: admin (AAL2) or finance (read-only)
drop policy if exists audit_log_default_deny on audit_log;
create policy audit_log_select on audit_log for select using (((has_venue_role(venue_id, 'admin'::venue_role) and has_aal2())) or ((has_venue_role(venue_id, 'finance'::venue_role))));

-- Subscriptions: admin read only
drop policy if exists subscriptions_default_deny on subscriptions;
create policy subscriptions_select on subscriptions for select using (has_venue_role(venue_id, 'admin'::venue_role));

-- Enforce soft delete only
revoke delete on guests from authenticated;
revoke delete on check_ins from authenticated;
revoke delete on refusals from authenticated;
revoke delete on audit_log from authenticated;
