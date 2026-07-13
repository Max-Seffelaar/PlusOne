// Venue-role helpers (spec §2 role matrix, decisions #3/#8/#20).
//
// Pure functions only — no I/O — so they are trivially unit-testable and can
// run on client and server alike. The DATABASE is the security boundary
// (CLAUDE.md): these mirror the RLS escalation guard and the MFA requirement
// so the UI can refuse early and show good copy, but they never replace RLS.

import type { Database } from '@/lib/database.types';

export type VenueRole = Database['public']['Enums']['venue_role'];

// Source of truth for iteration order in the UI.
export const VENUE_ROLES: readonly VenueRole[] = [
  'admin',
  'user_manager',
  'finance',
  'staff',
  'doorhost',
] as const;

// UI labels for venue roles.
export const ROLE_LABELS: Record<VenueRole, string> = {
  admin: 'Admin',
  user_manager: 'User manager',
  finance: 'Finance',
  staff: 'Staff',
  doorhost: 'Door host',
};

// Roles for which we RECOMMEND MFA (admin/finance). Optional for every role
// since the #20 refinement (2026-07-02): a skippable nudge, never a gate.
export const MFA_ROLES: readonly VenueRole[] = ['admin', 'finance'] as const;

// Roles that may invite users / manage memberships (spec §2).
export const MANAGER_ROLES: readonly VenueRole[] = ['admin', 'user_manager'] as const;

export function isVenueRole(value: unknown): value is VenueRole {
  return typeof value === 'string' && (VENUE_ROLES as readonly string[]).includes(value);
}

/** True when holding a role for which we recommend MFA (nudge only, no gate). */
export function requiresMfa(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => MFA_ROLES.includes(r));
}

export function hasRole(roles: readonly VenueRole[], role: VenueRole): boolean {
  return roles.includes(role);
}

export function isManager(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => MANAGER_ROLES.includes(r));
}

// Venue roles that may create guests — mirrors RLS `can_write_guests`: admin
// always, staff/doorhost at the door. (An event organizer is event-scoped, not a
// venue role, and is allowed via the quota `exempt` flag, not here.) A pure
// user_manager or finance may NOT add guests, so the UI hides the quick-add for
// them instead of letting the insert fail with a confusing "geen rechten" error.
export const GUEST_WRITE_ROLES: readonly VenueRole[] = ['admin', 'staff', 'doorhost'] as const;

/** True when any held role may create guests (UI convenience; RLS still decides). */
export function canManageGuests(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => GUEST_WRITE_ROLES.includes(r));
}

// Venue roles that work the door (check-in / weigeren) — the venue-role part of
// RLS `can_check_in`: admin always, doorhost at the door. Event organizers may
// also work the door (RLS allows them) but are event-scoped, not a venue role,
// so the mobile nav gates on these; an organizer without a door venue-role can
// still open /door/[eventId] directly. Hides the Deur/Taken tabs from staff /
// finance / user_manager, who can't read check_ins/refusals anyway (#17).
export const DOOR_ROLES: readonly VenueRole[] = ['admin', 'doorhost'] as const;

/** True when any held role may work the door (UI nav gate; RLS still decides). */
export function canWorkDoor(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => DOOR_ROLES.includes(r));
}

/**
 * True when the viewer works the door and holds no contacts-capable role —
 * mirrors the `contacts_select` RLS boundary (admin/finance/organizer read
 * contacts; doorhost and staff don't), not just a bare "doorhost" check (G4,
 * K-8). `doorhost` alone or combined with `staff` both qualify — the seed
 * `door@plusone.test` persona holds exactly `{doorhost, staff}`, and staff
 * doesn't grant contacts access either. Combined with `admin`/`finance` does
 * NOT qualify: multi-role-per-user (CLAUDE.md #8) means that viewer keeps the
 * full person-profile. An empty `roles` array (a pure event-organizer, whose
 * access lives in `event_organizers`, not `venue_memberships`) also returns
 * false — same "benefit of the doubt for empty roles" the M3 rechten-hygiëne
 * fix established, so an organizer still sees the full profile.
 */
export function isDoorOnlyRole(roles: readonly VenueRole[]): boolean {
  return roles.includes('doorhost') && !roles.includes('admin') && !roles.includes('finance');
}

// Venue roles that read guests at all — mirrors the guests-select RLS: admin/
// finance/doorhost read every guest, staff their own additions. A pure
// user_manager (no other role) always gets zero rows back, regardless of the
// event's real headcount — the UI must show that as "—", not "0" (M9, K-7).
export const GUEST_READ_ROLES: readonly VenueRole[] = ['admin', 'finance', 'staff', 'doorhost'] as const;

/** True when any held role can read SOME guests (a "0" readout is then real data). */
export function canSeeGuestCounts(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => GUEST_READ_ROLES.includes(r));
}

// ── Requests inbox (S5 Aanvragen) — mirrors guest_requests_select /
// quota_requests_select's venue-role arm ({admin,finance}) and
// quota_requests_decide_admin / guest_requests_decide's role arm (admin only).
// The organizer arm of those policies is event-scoped, not a venue role, and is
// handled separately (M2). Staff/doorhost may also read quota_requests via the
// `user_id = auth.uid()` RLS arm (their OWN submissions only, never the shared
// inbox) — staff gets a status view of those; doorhost's Home entry point is
// hidden outright (M3, K-8), by product decision rather than an RLS gap.

/** Roles that see the shared, venue-wide requests inbox (M1, K-4/K-5). */
export const REQUEST_INBOX_ROLES: readonly VenueRole[] = ['admin', 'finance'] as const;

export function canSeeRequestInbox(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => REQUEST_INBOX_ROLES.includes(r));
}

/** Only admin may approve/deny a request (M1, K-4/K-5) — finance is read-only. */
export function canDecideRequests(roles: readonly VenueRole[]): boolean {
  return roles.includes('admin');
}

/** Staff without inbox rights gets a status view of their OWN quota requests. */
export function canSeeOwnRequests(roles: readonly VenueRole[]): boolean {
  return roles.includes('staff') && !canSeeRequestInbox(roles);
}

/** Any request visibility at all — drives whether Home shows the request tiles. */
export function canSeeAnyRequests(roles: readonly VenueRole[]): boolean {
  return canSeeRequestInbox(roles) || canSeeOwnRequests(roles);
}

/**
 * Escalation guard — mirrors RLS `invites_insert` / `venue_memberships_insert`:
 * a caller may grant a set of roles only if they manage the venue, and only an
 * admin may ever hand out the `admin` role. A user_manager can grant anything
 * except admin.
 */
export function canGrantRoles(
  callerRoles: readonly VenueRole[],
  targetRoles: readonly VenueRole[]
): boolean {
  if (targetRoles.length === 0) return false;
  if (!isManager(callerRoles)) return false;
  if (targetRoles.includes('admin') && !callerRoles.includes('admin')) return false;
  return true;
}

/** Union of two role sets, de-duplicated and in canonical order. */
export function mergeRoles(a: readonly VenueRole[], b: readonly VenueRole[]): VenueRole[] {
  const set = new Set<VenueRole>([...a, ...b]);
  return VENUE_ROLES.filter((r) => set.has(r));
}
