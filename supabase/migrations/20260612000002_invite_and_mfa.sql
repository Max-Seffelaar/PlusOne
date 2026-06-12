-- Invite system and MFA schema
-- Supports invite-only signup with 7-day expiry and mandatory MFA for admin/finance

-- === PENDING INVITES (invite-only signup) ===
create table pending_invites (
  id uuid primary key default uuid_generate_v7(),
  venue_id uuid not null references venues(id) on delete cascade,
  email text not null,
  roles venue_role[] not null default array[]::venue_role[],
  invited_by uuid not null references users(id) on delete restrict,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone default (now() + interval '7 days'),
  accepted_at timestamp with time zone,
  used_count int default 0,
  unique(venue_id, email)
);

create index idx_pending_invites_venue_id on pending_invites(venue_id);
create index idx_pending_invites_email on pending_invites(email);
create index idx_pending_invites_expires_at on pending_invites(expires_at);

alter table pending_invites enable row level security;
create policy pending_invites_select on pending_invites
  for select using (
    exists (
      select 1 from venue_memberships vm
      where vm.venue_id = pending_invites.venue_id
        and vm.user_id = auth.uid()
        and ('admin'::venue_role = any(vm.roles) or 'user_manager'::venue_role = any(vm.roles))
    )
  );

create policy pending_invites_insert on pending_invites
  for insert with check (
    exists (
      select 1 from venue_memberships vm
      where vm.venue_id = pending_invites.venue_id
        and vm.user_id = auth.uid()
        and ('admin'::venue_role = any(vm.roles) or 'user_manager'::venue_role = any(vm.roles))
    )
  );

create policy pending_invites_update on pending_invites
  for update using (
    exists (
      select 1 from venue_memberships vm
      where vm.venue_id = pending_invites.venue_id
        and vm.user_id = auth.uid()
        and ('admin'::venue_role = any(vm.roles) or 'user_manager'::venue_role = any(vm.roles))
    )
  );

-- === MFA & SESSION TRACKING ON USERS ===
alter table users add column if not exists requires_mfa boolean default false;
alter table users add column if not exists mfa_enrolled_at timestamp with time zone;
alter table users add column if not exists last_login_at timestamp with time zone;

-- === AUDIT TRIGGER FOR PENDING INVITES ===
create or replace function audit_pending_invites_trigger()
returns trigger as $$
declare
  v_action text;
  v_before jsonb;
  v_after jsonb;
begin
  if TG_OP = 'INSERT' then
    v_action := 'invite_created';
    v_before := null;
    v_after := row_to_json(NEW);
  elsif TG_OP = 'UPDATE' then
    if OLD.accepted_at is distinct from NEW.accepted_at then
      v_action := 'invite_accepted';
    else
      v_action := 'invite_updated';
    end if;
    v_before := row_to_json(OLD);
    v_after := row_to_json(NEW);
  elsif TG_OP = 'DELETE' then
    v_action := 'invite_deleted';
    v_before := row_to_json(OLD);
    v_after := null;
  end if;

  insert into audit_log (venue_id, actor_id, entity_type, entity_id, action, before_data, after_data)
  values (
    NEW.venue_id,
    auth.uid(),
    'pending_invite',
    NEW.id,
    v_action,
    v_before,
    v_after
  );

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists pending_invites_audit_trigger on pending_invites;
create trigger pending_invites_audit_trigger
after insert or update or delete on pending_invites
for each row execute function audit_pending_invites_trigger();

-- === AUDIT TRIGGER FOR MFA ENROLLMENT ===
create or replace function audit_mfa_enrollment_trigger()
returns trigger as $$
begin
  if NEW.mfa_enrolled_at is not null and OLD.mfa_enrolled_at is null then
    insert into audit_log (venue_id, actor_id, entity_type, entity_id, action, before_data, after_data)
    values (
      null, -- MFA is user-scoped, not venue-scoped
      NEW.id,
      'user_mfa',
      NEW.id,
      null,
      jsonb_build_object('mfa_enrolled_at', NEW.mfa_enrolled_at)
    );
  end if;

  if NEW.last_login_at is not null and OLD.last_login_at is distinct from NEW.last_login_at then
    insert into audit_log (venue_id, actor_id, entity_type, entity_id, action, before_data, after_data)
    values (
      null,
      NEW.id,
      'user_login',
      NEW.id,
      'login',
      null,
      jsonb_build_object('last_login_at', NEW.last_login_at)
    );
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists users_mfa_audit_trigger on users;
create trigger users_mfa_audit_trigger
after update on users
for each row execute function audit_mfa_enrollment_trigger();
