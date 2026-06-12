# Venue Admin Dashboard Implementation

## Overview
Complete venue administration dashboard built for PLUSONE SaaS with multi-tenant support, role-based access control (RBAC), and user management.

## Architecture

### Key Files Created

#### Authentication & Authorization
- **`src/lib/auth.ts`** - Auth helpers with AAL2 MFA support
  - `getCurrentUser()` - Get authenticated user from Supabase Auth
  - `checkVenueMembership()` - Verify user has venue membership + required roles
  - `checkAAL2()` - Verify MFA (AAL2) status for sensitive operations
  - `enforceAAL2()` - Throw if AAL2 not satisfied

#### Server Actions (Data Mutations)
- **`src/features/venue-admin/actions.ts`** - All backend mutations
  - `updateVenueSettings()` - Update venue name & GDPR retention policy
  - `inviteUser()` - Invite new users to venue with role assignment
  - `updateUserRoles()` - Change user roles (requires AAL2 for admin/finance)
  - `removeMembership()` - Remove user access to venue only
  - `setDefaultQuota()` - Set per-user guest list quotas

All actions:
- Parse input with Zod schema validation
- Check venue membership server-side
- Enforce AAL2 where required (admin, finance roles)
- Return typed results: `{ success: true }` or `{ error: { [field]: [messages] } }`

#### Zod Schemas
- **`src/features/venue-admin/schemas.ts`** - Input validation schemas
  - UpdateVenueSettings, InviteUser, UpdateUserRoles, RemoveMembership, SetDefaultQuota
  - All fields validated (UUIDs, emails, role enums, numeric ranges)

#### UI Components
- **`src/features/venue-admin/components/`**
  - `venue-switcher.tsx` - Multi-venue selector for users with >1 membership
  - `venue-settings.tsx` - Venue name & GDPR policy editor (admin only)
  - `member-list.tsx` - Team members with quota display + edit/remove actions
  - `invite-user-form.tsx` - Email + role checkboxes to invite new members (phase 4: OTP sent via Supabase Auth)
  - `role-editor.tsx` - Inline role editor with AAL2 enforcement UI
  - `remove-membership-dialog.tsx` - Confirmation dialog with clear "access only to this venue" messaging
  - `quota-manager.tsx` - Edit default_count per user (admin only)

#### Routes
- **`src/app/admin/layout.tsx`** - Admin section wrapper (auth check)
- **`src/app/admin/venues/[venue-id]/page.tsx`** - Main dashboard
  - Server Component fetches: venue, memberships, quotas, user's memberships
  - Renders 3-column layout: settings sidebar, members + quotas in main
  - Role badges, read-only indicators for finance role
  - No data mutations in component (all Server Actions)

#### Tests
- **`src/features/venue-admin/actions.test.ts`** - Vitest schema validation tests
  - Tests all Zod schemas: valid inputs pass, invalid inputs fail with correct error messages
  - Covers: UUID validation, email format, numeric ranges, enum values, min/max constraints
  
- **`playwright/venue-admin.spec.ts`** - E2E tests for each role
  - Admin: can edit settings, invite users, change roles, remove members, set quotas
  - User Manager: can invite & edit roles, but NOT settings or quotas
  - Finance: read-only view of team & quotas
  - Multi-venue switching, access control, 404 for non-members

## Security Implementation

### Checklist Per Route (CLAUDE.md §Security)
Every action has:
- ✅ `getCurrentUser()` server-side (never trust client session)
- ✅ `checkVenueMembership()` + required roles
- ✅ AAL2 enforced for sensitive actions (admin/finance role changes)
- ✅ Zod schema parsing (no raw inputs)
- ✅ Untrusted IDs confirmed to belong to accessed resource (RLS ready)
- ✅ Idempotent where retryable (upsert for quotas)
- ✅ Generic error messages to client, details to logs only
- ✅ No PII in URLs/logs

### Role Enforcement

| Action | Admin | User Manager | Finance | Requirements |
|--------|-------|--------------|---------|---|
| Edit venue settings | ✅ | — | — | AAL2 not needed (not sensitive) |
| Invite users | ✅ | ✅ | — | Membership checked |
| Change roles | ✅ (AAL2) | — | — | AAL2 required for admin/finance |
| Remove membership | ✅ | — | — | Cannot remove yourself as admin |
| View team & quotas | ✅ | ✅ (read-only) | ✅ (read-only) | Membership checked |
| Edit quotas | ✅ | — | — | Admin only |

### RLS Ready
- All Supabase queries use server client (no service key in client code)
- Resource IDs from client are verified against user's memberships before mutation
- Database RLS policies (phase 2) will provide defense-in-depth

## Data Model Integration

Uses existing schema (`src/lib/database.types.ts`):
- `users` - Auth identities via Supabase Auth
- `venues` - Tenants with `name`, `retention_days` (months × 30)
- `venue_memberships` - User ↔ venue with roles array
- `quotas` - Default per-user guest slots via `default_count` (int)
- `audit_log` - Triggers log all venue admin changes (phase 2)

## UI/UX Notes

### Dutch Terminology
- "Locatie" = venue
- "Teamlid" = user/member  
- "Rollen" = roles
- "Quotum" = guest list quota
- "AVG-bewaartermijn" = GDPR retention policy

### Responsive Design
- 3-column grid (1 on mobile): sidebar + main content
- Forms inline-editable (no separate page)
- Confirmation dialogs for destructive ops
- Error messages above forms
- Loading states on buttons

### Feature Completeness
- ✅ Multi-venue switcher (users with 2+ memberships)
- ✅ Read-only indicators for finance role
- ✅ AAL2 requirement UI (error message shown)
- ✅ Clear removal messaging ("access to this venue only")
- ✅ Quotas show as integers (gasten = guests)
- ✅ Inline editing (no page reloads)

## Known Limitations

### TypeScript Strict Mode
- Some Supabase query type inference uses `as any` casts (Supabase SDK typing limitation)
- Does not affect runtime behavior; see `actions.ts` comments

### Phase 4: User Invitations
- Email invitation via Supabase Auth OTP is a future phase
- Current implementation creates `users` record but doesn't send magic link
- To fully test: manually invoke `supabase.auth.admin.inviteUserByEmail()`

### Audit Logging
- Phase 2: Postgres triggers will auto-log all mutations in `venue_memberships`, `quotas`, etc.
- Current: mutations are not logged (app-side logging can be added)

## Testing

### Run Unit Tests
```bash
pnpm test
```

### Run E2E Tests
```bash
pnpm test:e2e
```

### Type Check
```bash
pnpm type-check
```

### Lint
```bash
pnpm lint
```

## Next Steps (Decision #24 Compliance)

1. **RLS Policies** (Phase 2) - pgTAP tests for all roles
2. **Audit Triggers** - Auto-log venue membership & quota changes
3. **User Invitations** - Supabase Auth magic link flow
4. **MFA Setup** - AAL2 enforcement UI + TOTP setup page
5. **Subscription Gates** - Check `subscriptions.status` before admin features

## File Structure
```
src/
├── lib/
│   └── auth.ts                          # Auth helpers
├── features/venue-admin/
│   ├── actions.ts                       # Server actions (mutations)
│   ├── schemas.ts                       # Zod schemas
│   ├── actions.test.ts                  # Unit tests
│   └── components/
│       ├── index.ts                     # Barrel export
│       ├── venue-switcher.tsx           # Multi-venue selector
│       ├── venue-settings.tsx           # Settings editor
│       ├── member-list.tsx              # Team list
│       ├── invite-user-form.tsx         # Invite form
│       ├── role-editor.tsx              # Role editor
│       ├── remove-membership-dialog.tsx # Remove confirmation
│       └── quota-manager.tsx            # Quota editor
└── app/
    └── admin/
        ├── layout.tsx                   # Admin wrapper
        └── venues/[venue-id]/
            └── page.tsx                 # Main dashboard
playwright/
└── venue-admin.spec.ts                  # E2E tests (per role)
```

## Implementation Notes

- **No Redux/Context** - Server Components + Server Actions (Next.js 15 pattern)
- **Form State** - Local `useState` in Client Components
- **Styling** - Tailwind + shadcn/ui (existing design system)
- **Database** - Supabase typed client with `.single()` for non-list queries
- **Validation** - Zod on client (UX feedback) + server (security)
