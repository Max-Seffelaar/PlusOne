// The push payload as N2's enqueue triggers build it (ids + kind, never names —
// supabase/migrations/20260925120000_push_tokens_outbox.sql), after FCM turned
// every value into a string. A tap carries it back in; anything that doesn't
// parse is ignored rather than navigated to.
//
// An hourly digest (N1, 20261007110000) is the newest request's payload plus
// `count`: same kind, same route. A count that doesn't parse is dropped, never
// the tap.
import { z } from 'zod';

export const PUSH_KINDS = ['quota_request_created', 'guest_request_created', 'quota_request_decided'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

const schema = z.object({
  kind: z.enum(PUSH_KINDS),
  venue_id: z.string().uuid(),
  event_id: z.string().uuid(),
  count: z.coerce.number().int().min(2).max(100000).optional().catch(undefined),
});

export interface PushPayload {
  kind: PushKind;
  venueId: string;
  eventId: string;
  /** Requests bundled into this push; absent for a single request. */
  count?: number;
}

export function parsePushPayload(data: unknown): PushPayload | null {
  const parsed = schema.safeParse(data);
  if (!parsed.success) return null;
  const { kind, venue_id, event_id, count } = parsed.data;
  return count === undefined ? { kind, venueId: venue_id, eventId: event_id } : { kind, venueId: venue_id, eventId: event_id, count };
}
