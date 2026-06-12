# Initial Database Migration Summary

## Overview
Complete Supabase schema migration with all entities from spec §3, RLS enabled with default-deny, soft-delete enforcement, and comprehensive seed data.

## Migration File
- **Path**: `supabase/migrations/00000000000000_init.sql` (482 lines)
- **Status**: Ready for `supabase db reset` (requires Docker Desktop)

## What's Included

### 1. Extensions & Functions
- ✅ UUID-OSSP extension
- ✅ `uuid_generate_v7()` function for client-generated offline entities

### 2. Enums (6 types)
- `event_status`: draft, open, live, closed
- `guest_status`: pending, approved, denied, checked_in, refused, removed
- `venue_role`: admin, user_manager, finance, staff, doorhost
- `note_priority`: none, low, high
- `guest_source`: app, landing, door
- `subscription_status`: trialing, active, past_due, canceled, comped

### 3. Core Tables (14 tables)

| Table | PK | Key Features | RLS |
|-------|--|-|-|
| `users` | UUID v7 | Linked to auth.users | ✅ Default-deny |
| `venues` | UUID v7 | Multi-tenant roots | ✅ Default-deny |
| `venue_memberships` | UUID v7 | `roles` enum array | ✅ Default-deny |
| `events` | UUID v7 | landing_slug, list_locked, locked_by/at | ✅ Default-deny |
| `event_organizers` | UUID v7 | User ↔ event scope | ✅ Default-deny |
| `guest_tiers` | UUID v7 | aliases text[], max_count | ✅ Default-deny |
| `guests` | UUID v7 | Soft-delete only, anonymized_at | ✅ Default-deny + DELETE revoked |
| `guest_requests` | UUID v7 | Landingpage submissions | ✅ Default-deny |
| `quotas` | UUID v7 | User ↔ venue default | ✅ Default-deny |
| `event_quotas` | UUID v7 | Per-event override | ✅ Default-deny |
| `quota_requests` | UUID v7 | Approval flow | ✅ Default-deny |
| `check_ins` | UUID v7 | Unique(guest_id), offline_synced | ✅ Default-deny + DELETE revoked |
| `refusals` | UUID v7 | Reason tracking | ✅ Default-deny + DELETE revoked |
| `audit_log` | UUID v7 | JSONB diff, immutable | ✅ Default-deny + DELETE revoked |
| `subscriptions` | UUID v7 | Stripe integration ready | ✅ Default-deny |

### 4. Constraints & Security
- ✅ All FK's use RESTRICT (no CASCADE on guest data)
- ✅ Unique constraints: venue_memberships(venue_id, user_id), check_ins(guest_id), etc.
- ✅ `REVOKE DELETE` on authenticated for: guests, check_ins, refusals, audit_log
- ✅ RLS enabled on all tables with default-deny policies
- ✅ Soft-delete enforced (no hard DELETE capability)

### 5. Indexes
- `guests(event_id, status)` — door-app queries
- `check_ins(guest_id)` UNIQUE — double-checkin prevention
- `audit_log(venue_id, created_at)` — audit trail filtering
- `venue_memberships(user_id)` — membership lookups
- Plus type/FK indexes on frequently queried columns

### 6. Seed Data
**2 Venues:**
- Club Midnight (owner: Alice Admin)
- Sunset Lounge (owner: Grace Admin 2)

**7 Users (all 6 roles + extras):**
- Alice Admin (admin at Midnight)
- Bob User Manager (user_manager at Midnight)
- Carol Finance (finance at Midnight)
- Dan Organizer (organizer + staff at Sunset)
- Eve Staff (staff at Midnight)
- Frank Doorhost (doorhost at Midnight)
- Grace Admin 2 (admin at Sunset)

**Quotas & Subscriptions:**
- Midnight: 5 users with quotas (50, 20, 0, 10, 15); status=active
- Sunset: 1 user organizer quota; status=comped

**1 Event:**
- Name: "Summer Party 2026"
- Date: 2026-06-14
- Status: open
- Landing: active (slug: summer-party-2026)

**3 Guest Tiers:**
- VIP (max 50, aliases: vip/fles/champagne, color: #B5A6FF)
- Regular (max 200, color: #0B0B0D)
- Plus One (max 100, aliases: plus/+1/plusone, color: #E8E4FF)

**30 Guests (mixed across tiers & statuses):**
- 10 VIP: approved, pending, checked_in, refused, denied (various added_by & sources)
- 10 Regular: approved, pending, checked_in, refused, denied (mix of staff/door/app)
- 10 Plus One: approved, pending, checked_in, refused, denied (mixed quota users)
- Mix of complete & minimal data (some email/phone only, some anonymous "+1" style)

### 7. Generated TypeScript Types
- **Path**: `src/lib/database.types.ts`
- **Status**: ✅ Complete & compiled (pnpm type-check passed)
- Includes full Database union type, Tables<>, TablesInsert<>, TablesUpdate<>, Enums<> generics
- Ready for use in React Query, Server Actions, RLS policy testing

## Next Steps

### Testing the Migration
```bash
# Requires Docker Desktop running
supabase db reset  # Apply migration + seed
supabase db list   # Verify schema
```

### Building RLS Policies (Phase 2)
- Implement policies for each role per table
- Test with pgTAP in `supabase/tests/database/`

### Audit Trigger Layer (Phase 2)
- Create Postgres triggers on `guests`, `quotas`, `event_quotas`, `guest_tiers`, `check_ins`
- Auto-populate `audit_log` on mutations

## Notes
- Service role key must never appear in client code
- All mutations flow through user-scoped Supabase client (RLS enforced)
- UUIDs are generated client-side for offline entities (guests, check_ins, refusals)
- Soft-delete via `guests.status = 'removed'` + `anonymized_at` (GDPR) — no hard DELETE
- Subscription status gates venue access (middleware/layout checks)
- No policies yet; all tables have default-deny RLS enabled ready for implementation
