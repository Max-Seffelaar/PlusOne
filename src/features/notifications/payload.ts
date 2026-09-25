// The push payload as N2's enqueue triggers build it (ids + kind, never names —
// supabase/migrations/20260925120000_push_tokens_outbox.sql), after FCM turned
// every value into a string. A tap carries it back in; anything that doesn't
// parse is ignored rather than navigated to.
import { z } from 'zod';

export const PUSH_KINDS = ['quota_request_created', 'guest_request_created', 'quota_request_decided'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

const schema = z.object({
  kind: z.enum(PUSH_KINDS),
  venue_id: z.string().uuid(),
  event_id: z.string().uuid(),
});

export interface PushPayload {
  kind: PushKind;
  venueId: string;
  eventId: string;
}

export function parsePushPayload(data: unknown): PushPayload | null {
  const parsed = schema.safeParse(data);
  if (!parsed.success) return null;
  return { kind: parsed.data.kind, venueId: parsed.data.venue_id, eventId: parsed.data.event_id };
}
