-- Add super_admin role to venue_role enum
alter type venue_role add value 'super_admin';

-- Create super admin user (will be linked to Supabase Auth manually)
insert into users (id, email, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'max.seffelaar@gmail.com', 'Max (Super Admin)')
on conflict (email) do nothing;

-- For testing: create a temporary global super admin marker
-- In production, super_admin is granted membership on each venue with super_admin role
-- For MVP testing, we use a venues record with null venue_id to mark super admin
-- Actually, better approach: just make the user admin on all existing venues

-- Create venue_memberships for super admin on all venues (current + future will need manual setup)
insert into venue_memberships (venue_id, user_id, roles)
select
  v.id,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '{"super_admin"}'::venue_role[]
from venues v
on conflict do nothing;

-- Comment for manual setup:
-- To login with password (testing only):
-- 1. Go to Supabase dashboard > Authentication > Users
-- 2. Find or create user: max.seffelaar@gmail.com
-- 3. Set password to: 000000
-- 4. Disable "Require email confirmation"
-- 5. Once Supabase Auth syncs, the user will have super_admin access to all venues
--
-- To revert to passwordless-only:
-- 1. Delete the password auth method
-- 2. User can only login via OTP
