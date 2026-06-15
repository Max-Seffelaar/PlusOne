import type { Metadata } from 'next';
import { PlusOneApp } from '@/components/po/app';
import { getReportingVenues } from '@/lib/auth/memberships';

export const metadata: Metadata = {
  title: 'PLUSONE — Gastenlijst',
};

export default async function AppPage(): Promise<JSX.Element> {
  // The mobile app is still the public prototype; a best-effort fetch of the
  // caller's reporting venues (admin/finance) gates the Statistieken entry in
  // "Meer". Logged-out or non-admin → empty → the entry stays hidden.
  const venues = await getReportingVenues().catch(() => []);
  return (
    <PlusOneApp
      statsAccess={{ venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })) }}
    />
  );
}
