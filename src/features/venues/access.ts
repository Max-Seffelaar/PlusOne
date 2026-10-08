// Venue-dashboard access model (spec §2 role matrix, decisions #3/#8/#24).
//
// Pure functions only — no I/O — so they unit-test trivially and run on client
// and server alike. The DATABASE is the security boundary (CLAUDE.md): these
// mirror the RLS policies (venues_update_admin, venue_memberships_*,
// quotas_*_admin) so the UI can show the right controls and refuse early, but
// they never replace RLS. Every capability below has a matching policy.

import type { VenueRole } from '@/features/auth/roles';

// Roles that get a venue dashboard at all. admin manages everything; a
// user_manager manages the team; finance sees everything read-only (§2:
// "Finance ziet alles ... maar read-only").
export const DASHBOARD_ROLES: readonly VenueRole[] = ['admin', 'user_manager', 'finance'] as const;

export function hasDashboardAccess(roles: readonly VenueRole[]): boolean {
  return roles.some((r) => (DASHBOARD_ROLES as readonly VenueRole[]).includes(r));
}

export interface VenueCapabilities {
  /** May open the venue dashboard for this venue. */
  viewDashboard: boolean;
  /** May see venue settings (name, retention) — admin (edit) + finance (read). */
  viewSettings: boolean;
  /** May change venue settings — admin only (RLS venues_update_admin). */
  editSettings: boolean;
  /** May see the member list + invites — admin/user_manager/finance. */
  viewTeam: boolean;
  /** May invite, change roles, remove members — admin/user_manager (role-only). */
  manageTeam: boolean;
  /** May see other users' default quota — admin + finance (RLS quotas_select). */
  viewQuota: boolean;
  /** May set default quota — admin only (RLS quotas_*_admin, role-only). */
  editQuota: boolean;
  /** May read the immutable audit log — admin + finance (RLS audit_log_select_aal2 — role-only despite the name). */
  viewAudit: boolean;
  /** May erase a contact on request ("forget me", AVG art. 17) — admin only (RPC forget_contact). */
  forgetContact: boolean;
}

// Capabilities for a single venue, derived from the caller's roles there. Each
// flag corresponds 1:1 to an RLS policy so app and database never disagree.
export function venueCapabilities(roles: readonly VenueRole[]): VenueCapabilities {
  const admin = roles.includes('admin');
  const userManager = roles.includes('user_manager');
  const finance = roles.includes('finance');
  return {
    viewDashboard: admin || userManager || finance,
    viewSettings: admin || finance,
    editSettings: admin,
    viewTeam: admin || userManager || finance,
    manageTeam: admin || userManager,
    viewQuota: admin || finance,
    editQuota: admin,
    viewAudit: admin || finance,
    forgetContact: admin,
  };
}

// ── Last-admin safety guards ────────────────────────────────────────────────
// App-layer early refusal with friendly copy. The boundary is the DB trigger
// refuse_last_admin_removal (20261012120000), which RLS alone never was: it lets
// any admin (and every platform admin) delete or demote any admin row. `otherAdminCount` is the number of OTHER memberships at the venue
// whose roles include admin (excluding the membership being changed).

/** Removing this membership would leave the venue with zero admins. */
export function removalWouldOrphanVenue(
  targetRoles: readonly VenueRole[],
  otherAdminCount: number
): boolean {
  return targetRoles.includes('admin') && otherAdminCount <= 0;
}

/** This role change drops the venue's last admin (admin → no admin). */
export function roleChangeWouldOrphanVenue(
  oldRoles: readonly VenueRole[],
  newRoles: readonly VenueRole[],
  otherAdminCount: number
): boolean {
  return oldRoles.includes('admin') && !newRoles.includes('admin') && otherAdminCount <= 0;
}

/** Admin memberships in `team` other than `userId` — the client-side input for
 *  the two guards above (Team sheet), from the member list the screen already
 *  loaded. */
export function otherAdminsIn(
  team: readonly { userId: string; roles: readonly VenueRole[] }[],
  userId: string
): number {
  return team.filter((m) => m.userId !== userId && m.roles.includes('admin')).length;
}

/** This member is the venue's only admin: the Team sheet hides "Revoke access"
 *  and locks their Admin chip. The DB trigger refuse_last_admin_removal
 *  (20261012120000) is the boundary; this only spares a refused tap. */
export function isLastAdmin(
  member: { userId: string; roles: readonly VenueRole[] },
  team: readonly { userId: string; roles: readonly VenueRole[] }[]
): boolean {
  return removalWouldOrphanVenue(member.roles, otherAdminsIn(team, member.userId));
}
