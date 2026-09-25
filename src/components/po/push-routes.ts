/**
 * Where a push notification tap lands (Fase 17 N5, 86ey6bfkb). Payload = kind +
 * ids only (N2); every destination is a real G1 URL built by `routes.ts`, so a
 * cold-start tap and a warm tap resolve to the same screen.
 *
 * - quota_request_created → the approver's quota queue for that event.
 * - guest_request_created → the event's guest-request queue (landing tab).
 * - quota_request_decided → the requester's own view of that event's quota
 *   requests. Same URL as the approver's: the Requests screen renders staff's
 *   own-status mode from the roles, not from the path.
 */
import type { PushPayload } from '@/features/notifications/payload';
import { screenPath } from './routes';

export function pushTargetPath(p: PushPayload): string {
  switch (p.kind) {
    case 'quota_request_created':
    case 'quota_request_decided':
      return screenPath('aanvragen', { id: p.eventId, tab: 'quota' });
    case 'guest_request_created':
      return screenPath('aanvragen', { id: p.eventId });
  }
}
