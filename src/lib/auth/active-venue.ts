import 'server-only';

import { cookies } from 'next/headers';
import { getMyMemberships, type Membership } from './memberships';
import { hasDashboardAccess } from '@/features/venues/access';

// The active-venue selection persists in a cookie so the nav switcher is sticky
// across pages (multi-venue users, decision #1). It holds only a venue UUID —
// no PII (security checklist). It is a UI convenience: every page re-validates
// the id against the caller's memberships, and RLS is the real boundary.
export const ACTIVE_VENUE_COOKIE = 'po_active_venue';

// Memberships that actually get a dashboard (admin/user_manager/finance).
export async function getDashboardVenues(): Promise<Membership[]> {
  const memberships = await getMyMemberships();
  return memberships.filter((m) => hasDashboardAccess(m.roles));
}

/**
 * Resolve which venue a dashboard page should show, given the venues the caller
 * may see there. Precedence: explicit ?venue= override → cookie → first
 * candidate. Any value not in `candidates` is ignored, so a stale cookie or a
 * forged query param can never select a venue the user lacks access to.
 */
export async function resolveActiveVenueId(
  candidates: readonly Membership[],
  override?: string
): Promise<string | null> {
  const ids = new Set(candidates.map((c) => c.venueId));
  if (override && ids.has(override)) return override;

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(ACTIVE_VENUE_COOKIE)?.value;
  if (fromCookie && ids.has(fromCookie)) return fromCookie;

  return candidates[0]?.venueId ?? null;
}
