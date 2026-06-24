import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/auth/context';
import { getMyMemberships } from '@/lib/auth/memberships';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
import type { PoIdentity } from '@/features/po/PoLiveProvider';
import { EventDayProvider } from './EventDayProvider';

export const metadata: Metadata = {
  title: 'Event day · PlusOne',
};

// S13 · Desktop Event-dag cockpit. Auth + MFA are already enforced by the (app)
// layout (requireAppAccess); here we only resolve the live-data identity (active
// venue + roles) for PoLiveProvider, exactly like src/app/app/page.tsx. The live
// event itself is resolved client-side (usePoDoorEvent) so the cockpit + the
// sidebar LIVE badge share one source of truth. No PII is rendered server-side.
export default async function EventDayPage(): Promise<JSX.Element> {
  const [user, memberships] = await Promise.all([getSessionUser(), getMyMemberships()]);
  const activeVenueId = await resolveActiveVenueId(memberships).catch(() => null);
  const active = memberships.find((m) => m.venueId === activeVenueId) ?? null;

  const identity: PoIdentity = {
    userId: user?.id ?? '',
    venueId: active?.venueId ?? null,
    venueName: active?.venueName ?? null,
    roles: active?.roles ?? [],
  };

  return <EventDayProvider identity={identity} />;
}
