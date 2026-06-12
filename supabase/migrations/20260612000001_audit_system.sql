-- Audit system: RLS policies and immutability enforcement
-- Trigger function and triggers are created in init.sql so they capture seed data

-- === ENSURE AUDIT_LOG IS IMMUTABLE ===
-- Revoke INSERT/UPDATE/DELETE for all authenticated users and service role on audit_log
-- Only the trigger function (running as superuser) can write
revoke insert, update, delete on audit_log from authenticated;
revoke insert, update, delete on audit_log from service_role;

-- Drop the overly-restrictive default deny policy and replace with selective read-only policies
drop policy if exists audit_log_default_deny on audit_log;

-- Allow Admin role to read audit log for their venue
create policy audit_log_select_if_admin on audit_log
  for select using (
    auth.uid() is not null and (
      exists (
        select 1 from venue_memberships vm
        where vm.venue_id = audit_log.venue_id
          and vm.user_id = auth.uid()
          and 'admin'::venue_role = any(vm.roles)
      )
      or (
        auth.jwt()->>'role' = 'service_role'
      )
    )
  );

-- Allow Finance role to read audit log for their venue (read-only)
create policy audit_log_select_if_finance on audit_log
  for select using (
    auth.uid() is not null and
    exists (
      select 1 from venue_memberships vm
      where vm.venue_id = audit_log.venue_id
        and vm.user_id = auth.uid()
        and 'finance'::venue_role = any(vm.roles)
    )
  );
