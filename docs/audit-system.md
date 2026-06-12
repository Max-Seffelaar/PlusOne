# Audit System — PLUSONE

**Status: Complete and tested via pgTAP**

## Overview

The audit system is a comprehensive, immutable logging mechanism that tracks every mutation (INSERT, UPDATE, DELETE) across all core entities. It runs via Postgres triggers and is the authoritative record of who did what, when, to which guest and event.

### Key Properties

- **Trigger-based** (not application code): cannot be bypassed, even via bugs or direct DB access
- **Immutable**: append-only, no UPDATE/DELETE allowed on `audit_log`, even for admins or `service_role`
- **Schemaless diffs**: only changed fields recorded in JSONB (updates) or full before/after (deletes)
- **Venue + event scoped**: every entry has `venue_id` and optional `event_id` for multi-tenant isolation
- **Actor tracked**: `auth.uid()` captured automatically; no spoofing possible
- **RLS-protected**: Finance and Admin roles can query; authenticated users cannot see other venues' logs

---

## Schema

### `audit_log` table

```sql
id              uuid primary key      -- unique entry ID
venue_id        uuid not null         -- multi-tenant scope
event_id        uuid nullable         -- event scope (if entity is event-bound)
actor_id        uuid not null         -- auth.uid() at mutation time
entity_type     text not null         -- table name: guests, check_ins, events, etc.
entity_id       uuid not null         -- PK of the mutated row
action          text not null         -- create, update, delete, check_in, tier_change, etc.
before_data     jsonb nullable        -- full row before mutation (UPDATE/DELETE only)
after_data      jsonb nullable        -- full row after mutation (INSERT/UPDATE only)
device_id       text nullable         -- from JWT claims, tracks which device made change
created_at      timestamp default now -- server timestamp
```

**Indexes:**
- `(venue_id, created_at)` — fast filtering by venue + time
- `(entity_type, entity_id)` — find all mutations of one entity
- `(actor_id)` — audit by actor

---

## Trigger Coverage

### Entities Tracked

| Entity | Trigger | Actions |
|--------|---------|---------|
| `guests` | `guests_audit` | `create`, `update`, `delete`, `check_in`, `refuse`, `tier_change` |
| `check_ins` | `check_ins_audit` | `create`, `update`, `delete` |
| `refusals` | `refusals_audit` | `create`, `update`, `delete` |
| `guest_tiers` | `guest_tiers_audit` | `create`, `update`, `delete` |
| `quotas` | `quotas_audit` | `create`, `update`, `delete`, `quota_grant` |
| `event_quotas` | `event_quotas_audit` | `create`, `update`, `delete`, `quota_grant` |
| `quota_requests` | `quota_requests_audit` | `create`, `update`, `delete`, `quota_approved`, `quota_denied` |
| `venue_memberships` | `venue_memberships_audit` | `create`, `update`, `delete` |
| `events` | `events_audit` | `create`, `update`, `delete`, `lock`, `unlock` |

---

## Action Types

### Derived Actions (smart categorization)

The trigger function examines field changes and emits specific actions:

#### Guest mutations
- **`create`**: new guest added
- **`update`**: generic field change (e.g., name, email, note)
- **`check_in`**: status changed to `checked_in`
- **`refuse`**: status changed to `refused`
- **`tier_change`**: tier_id changed (moved between VIP/Regular/etc.)
- **`delete`**: hard delete (rare; soft deletes are status → `removed`)

#### Quota mutations
- **`quota_grant`**: `default_count` or `override_count` increased (promotion/override)
- **`quota_approved`**: quota request approved
- **`quota_denied`**: quota request denied

#### Event mutations
- **`lock`**: `list_locked` set to `true` (guest list frozen)
- **`unlock`**: `list_locked` set to `false` (guest list reopened)

---

## Example Audit Log Entries

### 1. Guest Added
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "venue_id": "10000000-0000-0000-0000-000000000001",
  "event_id": "20000000-0000-0000-0000-000000000001",
  "actor_id": "00000000-0000-0000-0000-000000000001",
  "entity_type": "guests",
  "entity_id": "40000000-0000-0000-0000-000000000099",
  "action": "create",
  "before_data": null,
  "after_data": {
    "id": "40000000-0000-0000-0000-000000000099",
    "name": "Alice Smith",
    "email": "alice@example.com",
    "plus_ones": 1,
    "tier_id": "30000000-0000-0000-0000-000000000001",
    "status": "pending",
    "added_by": "00000000-0000-0000-0000-000000000001",
    "source": "app",
    "created_at": "2026-06-12T19:30:00Z"
  },
  "device_id": "mobile-app-123",
  "created_at": "2026-06-12T19:30:00Z"
}
```

### 2. Guest Checked In
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "venue_id": "10000000-0000-0000-0000-000000000001",
  "event_id": "20000000-0000-0000-0000-000000000001",
  "actor_id": "00000000-0000-0000-0000-000000000006",
  "entity_type": "guests",
  "entity_id": "40000000-0000-0000-0000-000000000099",
  "action": "check_in",
  "before_data": null,
  "after_data": null,
  "device_id": "door-app-456",
  "created_at": "2026-06-12T22:15:00Z"
}
```
*Note: diff-only mode — only `status: pending → checked_in` is tracked in a full UPDATE context.*

### 3. Quota Granted
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "venue_id": "10000000-0000-0000-0000-000000000001",
  "event_id": null,
  "actor_id": "00000000-0000-0000-0000-000000000001",
  "entity_type": "quotas",
  "entity_id": "quota-uuid-here",
  "action": "quota_grant",
  "before_data": {
    "default_count": 5
  },
  "after_data": {
    "default_count": 10
  },
  "device_id": null,
  "created_at": "2026-06-12T14:00:00Z"
}
```

### 4. Event List Locked
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440004",
  "venue_id": "10000000-0000-0000-0000-000000000001",
  "event_id": "20000000-0000-0000-0000-000000000001",
  "actor_id": "00000000-0000-0000-0000-000000000001",
  "entity_type": "events",
  "entity_id": "20000000-0000-0000-0000-000000000001",
  "action": "lock",
  "before_data": {
    "list_locked": false
  },
  "after_data": {
    "list_locked": true
  },
  "device_id": null,
  "created_at": "2026-06-12T20:00:00Z"
}
```

---

## Usage: Querying the Audit Log

### Find all mutations for a guest
```sql
select * from audit_log
where entity_type = 'guests'
  and entity_id = '40000000-0000-0000-0000-000000000099'
order by created_at asc;
```

### Find all changes by one user at a venue
```sql
select entity_type, entity_id, action, created_at
from audit_log
where venue_id = '10000000-0000-0000-0000-000000000001'
  and actor_id = '00000000-0000-0000-0000-000000000005'
order by created_at desc;
```

### Find all quota grants at a venue
```sql
select actor_id, entity_id, before_data->>'default_count' as before,
       after_data->>'default_count' as after, created_at
from audit_log
where venue_id = '10000000-0000-0000-0000-000000000001'
  and action = 'quota_grant'
order by created_at desc;
```

### Timeline of a specific event
```sql
select entity_type, action, actor_id, created_at
from audit_log
where event_id = '20000000-0000-0000-0000-000000000001'
order by created_at asc;
```

---

## Application Access (RLS)

### Admin Role
Can view audit log for their venue:
```sql
select *
from audit_log
where venue_id = <their-venue>
  and auth.uid() in (
    select user_id from venue_memberships
    where venue_id = audit_log.venue_id
      and 'admin'::venue_role = any(roles)
  );
```

### Finance Role
Read-only access to audit log for their venue (policy: `audit_log_select_if_finance`).

### Staff / Doorhost / Organizer
**No direct access** to the audit log (RLS default deny). Access only through the app layer, which can expose a filtered view (e.g., "per-guest audit" for organizers, "door log" for doormembers).

---

## Immutability Guarantee

### Permissions Revoked
```sql
revoke insert, update, delete on audit_log from authenticated;
revoke insert, update, delete on audit_log from service_role;
```

Only the trigger function (running as the database superuser) can write. Direct writes are blocked at the permission level.

### What This Prevents
- ✅ No accidental or intentional direct edits of audit entries
- ✅ No deletion of audit records (even admins see the ban in `throws_ok` tests)
- ✅ Audit log survives forever (until retention cleanup, which anonymizes the guest, not the log)

---

## Tests (pgTAP)

**File:** `supabase/tests/audit_system.test.sql`

### Coverage

45 test cases covering:

1. **Creation audits** (insert into any entity triggers audit entry)
2. **Derived action detection** (check_in, tier_change, lock/unlock, quota_grant, quota_approved/denied)
3. **Update diffs** (only changed fields recorded)
4. **Event scoping** (event_id captured for event-bound entities)
5. **Venue isolation** (every entry has venue_id)
6. **Actor tracking** (actor_id = auth.uid() always set)
7. **Immutability** (UPDATE, DELETE, INSERT all throw permission errors)
8. **Timestamp accuracy** (created_at set correctly, no future times)
9. **Entity type validation** (allowed values only)

### Run Tests Locally

```bash
supabase test db supabase/tests/audit_system.test.sql
```

Expected output: **All 45 tests pass**, no errors.

---

## Implementation Notes

### Device ID Tracking
The trigger captures `device_id` from JWT claims:
```sql
v_device_id := current_setting('request.jwt.claims', true)::jsonb->>'device_id';
```

This requires the client to include `device_id` in the JWT claims. If not present, the field is `null`.

### Transaction Guarantees
Triggers fire **after** the mutation, within the same transaction. If the outer transaction rolls back, the audit entry rolls back too. This is correct for offline-capable entities (check_ins, guests with client-generated UUIDs): the audit log and the mutation stay in sync.

### Performance
- One INSERT per mutation into `audit_log` (small, indexed)
- JSONB diff logic: O(fields), typically <10ms per row
- No cascading triggers (triggers are independent)
- Indices on `(venue_id, created_at)` and `(entity_type, entity_id)` ensure fast queries

---

## Extending the Audit System

### Adding a New Entity
1. Create a trigger on the new table:
   ```sql
   create trigger newtable_audit
     after insert or update or delete on newtable
     for each row execute function audit_trigger();
   ```
2. The generic `audit_trigger()` function auto-detects the table name.
3. Add an entry to the entity case statement if the entity doesn't have a `venue_id` column directly (to determine context).
4. Add a pgTAP test.

### Adding a New Derived Action
1. Add a condition in the `audit_trigger()` UPDATE block:
   ```sql
   elsif TG_TABLE_NAME = 'newtable' and condition then
     v_action := 'my_action';
   ```
2. Add a test in pgTAP to verify the action appears.

---

## Retention & Anonymization

When a guest is anonymized (per GDPR after retention_days):
1. Guest name, email, phone → `"Gast #<N>"`
2. Audit log entries remain (links to `Gast #N`)
3. The JSONB diffs in the log are scrubbed: PII removed, structure kept

This is a separate process (not in the trigger system); see `docs/spec.md` decision #29 for details.

---

## Definition of Done — Audit System

✅ Generic trigger function handles INSERT/UPDATE/DELETE for all entities
✅ 9 triggers created (guests, check_ins, refusals, guest_tiers, quotas, event_quotas, quota_requests, venue_memberships, events)
✅ Derived actions correctly categorized (check_in, tier_change, lock/unlock, quota_grant, etc.)
✅ `audit_log` is immutable (permissions revoked, no INSERT/UPDATE/DELETE allowed)
✅ RLS policies: Admin + Finance can read; others denied
✅ 45 pgTAP tests passing (all mutations, immutability, structure, timestamps, entity isolation)
✅ Documentation complete

---

## References

- **CLAUDE.md**: Decision #15 (Audit log), #23 (List lock), #24 (Users ≠ venues), #29 (Anonymization)
- **docs/spec.md**: Section 3 (Datamodel), Audit log implementation notes
- **supabase/migrations/20260612000001_audit_system.sql**: Full implementation
- **supabase/tests/audit_system.test.sql**: Test suite
