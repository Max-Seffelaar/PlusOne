import 'server-only';

import { createClient } from '@/lib/supabase/server';
import * as data from './data';

// Server-side ergonomic wrappers. The analytics reads live in ./data (isomorphic,
// client-agnostic) so client screens can reuse them with the browser client. These
// thin wrappers bind the request-scoped server client, so server components
// (/admin/stats, /admin/overview, the /dashboard prefetch) keep calling without
// passing a client. Public API is unchanged.

export type {
  EventSummary,
  QuarterBucket,
  TierStat,
  UserAddition,
  RefusalReason,
  EventStats,
  VenueSummary,
  EventRollup,
  VenueUserAddition,
  VenueStats,
  PickerEvent,
} from './data';

export async function fetchEventStats(eventId: string): Promise<data.EventStats> {
  return data.fetchEventStats(await createClient(), eventId);
}

export async function fetchVenueStats(
  venueId: string,
  from: string | null,
  to: string | null
): Promise<data.VenueStats> {
  return data.fetchVenueStats(await createClient(), venueId, from, to);
}

export async function fetchVenueEvents(venueId: string): Promise<data.PickerEvent[]> {
  return data.fetchVenueEvents(await createClient(), venueId);
}
