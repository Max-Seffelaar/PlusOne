# Venue Admin Dashboard - RLS & Security Tests (Phase 2)

This document outlines the PostgreSQL RLS (Row Level Security) tests that must be written in Phase 2 to ensure the dashboard is secure at the database level.

## pgTAP Test Plan

Run with: `supabase test db`

### 1. Venue Membership Access

#### Test: Admin can view/edit own venue
```sql
SELECT is(
  (SELECT COUNT(*) FROM venue_memberships 
   WHERE venue_id = 'test-venue' AND user_id = 'admin-user'),
  1,
  'Admin can view own membership'
);
```

#### Test: User cannot view other venues' memberships
```sql
SELECT throws_ok(
  'SELECT * FROM venue_memberships WHERE venue_id = $1',
  'new row violates row-level security policy',
  'Staff cannot read venue_memberships outside their venues'
);
```

### 2. Quota Access & Mutation

#### Test: Admin can set quotas for their venue
```sql
INSERT INTO quotas (venue_id, user_id, default_count)
VALUES ('test-venue', 'user-1', 50);
-- Should succeed
```

#### Test: User cannot set quotas for other venues
```sql
INSERT INTO quotas (venue_id, user_id, default_count)
VALUES ('other-venue', 'user-1', 50);
-- Should fail RLS policy
```

#### Test: Finance role can read, not write quotas
```sql
-- As finance role:
SELECT COUNT(*) FROM quotas WHERE venue_id = 'test-venue'; -- Should succeed
UPDATE quotas SET default_count = 100 WHERE venue_id = 'test-venue'; -- Should fail
```

### 3. Role Enforcement (Next.js Server Actions)

#### Test: Non-admin cannot invite users
```
POST /api/admin/venues/[venue-id]/invite
Body: { email: "new@example.com", roles: ["admin"] }
Expected: 403 Forbidden
```

#### Test: User manager can invite but not change admin roles
```
POST /api/admin/venues/[venue-id]/update-roles
Body: { membershipId: "...", roles: ["admin"] }
Expected: 403 Forbidden
```

#### Test: AAL2 required for admin/finance role changes
```
POST /api/admin/venues/[venue-id]/update-roles
Body: { membershipId: "...", roles: ["admin"] }
Auth: User without TOTP (aal=1)
Expected: 401 Unauthorized with "MFA required" message
```

### 4. Soft-Delete Enforcement

#### Test: Removed memberships cannot be restored
```sql
UPDATE venue_memberships 
SET roles = '{"admin"}' 
WHERE id = 'removed-membership';
-- Should fail (status = 'removed' soft-deletes the row)
```

(Implementation detail: Phase 2 should add a `status` column)

### 5. Cannot Remove Own Admin Access

#### Test: Admin cannot remove themselves
```
DELETE /api/admin/venues/[venue-id]/members/[own-membership-id]
Expected: 400 Bad Request with "Cannot remove yourself"
```

### 6. Audit Log Integrity

#### Test: All mutations logged via triggers
```sql
SELECT COUNT(*) FROM audit_log 
WHERE venue_id = 'test-venue' 
  AND entity_type = 'venue_memberships'
  AND created_at > NOW() - INTERVAL '5 minutes';
-- Should reflect every insert/update/delete from the dashboard
```

#### Test: Audit log is immutable
```sql
UPDATE audit_log SET action = 'hacked' WHERE id = '...';
-- Should fail (RLS denies updates)
```

## Manual Testing Checklist

### Admin Role
- [ ] Can edit venue settings (name, retention)
- [ ] Can invite users with all 5 roles
- [ ] Can edit own roles (without removing admin)
- [ ] Can edit others' roles (with AAL2 prompt for admin/finance)
- [ ] Can remove team members (with confirmation)
- [ ] Can set quotas for all users
- [ ] Cannot remove themselves as admin

### User Manager Role
- [ ] Can invite users with all roles
- [ ] Can edit users' roles
- [ ] **Cannot** edit venue settings
- [ ] **Cannot** access quota section
- [ ] **Cannot** invite with admin role? (Clarify: should user_manager be restricted?)

### Finance Role
- [ ] Can view team list (read-only)
- [ ] Can view quotas (read-only)
- [ ] **Cannot** edit settings, invite, or change roles
- [ ] See "read-only" indicator

### Cross-Venue
- [ ] User with 2+ memberships sees venue switcher
- [ ] Switching venues shows only that venue's data
- [ ] Cannot access non-member venues (404)
- [ ] Removing membership at venue A doesn't affect venue B access

## Security Regression Tests

After any changes to:
1. **Auth logic** - Rerun role-based tests
2. **Database schema** - Rerun RLS & soft-delete tests
3. **Server actions** - Rerun AAL2 enforcement
4. **Quota math** - Rerun quota boundary tests (0, negative, overflow)

## Performance Tests

- [ ] Loading venue dashboard with 100+ team members < 500ms
- [ ] Inviting a user < 200ms
- [ ] Bulk quota updates (10 users) < 1s

## Known Gaps (Phase 2 Design)

1. **No `status` column on `venue_memberships`** - Soft-delete not implemented
2. **Audit triggers not yet deployed** - Mutations not logged automatically
3. **No MFA setup flow** - AAL2 cannot be enforced until user sets TOTP
4. **Subscription checks missing** - Should gate admin features on `subscriptions.status = 'active'`
5. **No invitation emails** - Phase 4 will add OTP via Supabase Auth

## Test Data Setup

```sql
-- Test venue
INSERT INTO venues (id, name, owner_id) VALUES 
  ('test-venue', 'Test Venue', 'owner-user-id');

-- Test users with different roles
INSERT INTO venue_memberships (id, venue_id, user_id, roles) VALUES
  ('admin-membership', 'test-venue', 'admin-user', '["admin"]'),
  ('user-mgr-membership', 'test-venue', 'user-manager-user', '["user_manager"]'),
  ('finance-membership', 'test-venue', 'finance-user', '["finance"]'),
  ('staff-membership', 'test-venue', 'staff-user', '["staff"]');

-- Set up MFA (AAL2) for admin user
UPDATE auth.users SET (aal='aal2', user_metadata=jsonb_set(user_metadata, '{aal}', '"aal2"'))
WHERE id = 'admin-user';
```
