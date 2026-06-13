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

// Dutch UI labels (CLAUDE.md: Dutch UI copy).
export const ROLE_LABELS: Record<VenueRole, string> = {
  admin: 'Beheerder',
  user_manager: 'Gebruikersbeheer',
  finance: 'Financiën',
  staff: 'Personeel',
  doorhost: 'Deurhost',
};

// Roles for which MFA (AAL2) is mandatory — CLAUDE.md §Auth, spec §5.
export const MFA_ROLES: readonly VenueRole[] = ['admin', 'finance'] as const;

// Roles that may invite users / manage memberships (spec §2).
export const MANAGER_ROLES: readonly VenueRole[] = ['admin', 'user_manager'] as const;

export function isVenueRole(value: unknown): value is VenueRole {
  return typeof value === 'string' && (VENUE_ROLES as readonly string[]).includes(value);
}

/** True when holding any of these roles forces MFA enrollment. */
export function requiresMfa(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => MFA_ROLES.includes(r));
}

export function hasRole(roles: readonly VenueRole[], role: VenueRole): boolean {
  return roles.includes(role);
}

export function isManager(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => MANAGER_ROLES.includes(r));
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
