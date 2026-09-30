/**
 * The last door event this device worked, remembered in the door's IndexedDB
 * store (N7, decision 15).
 *
 * WHY. The Deur tab resolves WHICH event to open through a network read
 * (`usePoDoorCandidates`). On an offline cold start that query never resolves,
 * so the tab used to stop at "no event" while the event's guest snapshot and
 * outbox sat unread in IndexedDB. With this pin, `MobileDoorBranch` can mount the
 * door for the event the doorhost was working, straight from local data.
 *
 * LIFETIME. Same database as the snapshot and the outbox (`plusone-door`), so
 * `idbClearAll()` on sign-out deletes it with them — no new wipe path, and a
 * signed-out device has no pin to boot from. It holds ids (user, venue, event) plus the event name
 * (never guest data), and writes carry the wipe epoch like every other door
 * writer, so a write scheduled before a sign-out cannot resurrect it.
 */
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { idbEpoch, idbGet, idbSet } from './idb';

const LAST_DOOR_KEY = 'door-last-event';

// `userId` (§6 review): the pin belongs to the user who worked the door. A
// session that ends WITHOUT `signOutDevice` (expiry, remote revoke, app closed)
// keeps the door IDB; the next user of the same venue on this tablet must not
// cold-start into the previous user's door from it. A pin written before this
// field existed fails the parse and reads as no pin.
const lastDoorSchema = z.object({
  userId: z.string().min(1),
  venueId: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string(),
});

export type LastDoorEvent = z.infer<typeof lastDoorSchema>;

/** The remembered door event, or `null` when none (or the stored value is not
 *  the shape we wrote — never trust what comes back from disk). */
export async function loadLastDoorEvent(): Promise<LastDoorEvent | null> {
  const raw = await idbGet<unknown>(LAST_DOOR_KEY);
  const parsed = lastDoorSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Remember `value` as the last door event. Dropped if a sign-out wipe landed
 *  between the caller scheduling it and the write (see `idbEpoch`). */
export async function saveLastDoorEvent(value: LastDoorEvent, epochAtSchedule = idbEpoch()): Promise<boolean> {
  const parsed = lastDoorSchema.safeParse(value);
  if (!parsed.success) return false;
  if (epochAtSchedule !== idbEpoch()) return false;
  return idbSet(LAST_DOOR_KEY, parsed.data);
}

/**
 * The event the Deur tab may mount from the pin, or `null`.
 *
 * The rule the whole feature hangs on: the pin is a fallback for a candidate
 * list we COULD NOT LOAD, never a second opinion on one we did. So it applies
 * only while the list has not loaded and is paused (offline) or errored; only
 * for the user who wrote it and the active venue; and never against an
 * explicit `?event=` for another event.
 *
 * `candidatesLoaded` means the query HOLDS a list, not that its last fetch
 * succeeded: a failed refetch keeps the loaded list, and that list still wins.
 */
export function offlineDoorPin(input: {
  pin: LastDoorEvent | null;
  userId: string | null;
  venueId: string | null;
  requestedEventId: string | null;
  candidatesLoaded: boolean;
  candidatesUnreachable: boolean;
}): LastDoorEvent | null {
  const { pin, userId, venueId, requestedEventId, candidatesLoaded, candidatesUnreachable } = input;
  if (!pin || !venueId || !userId) return null;
  if (candidatesLoaded || !candidatesUnreachable) return null;
  if (pin.userId !== userId) return null;
  if (pin.venueId !== venueId) return null;
  if (requestedEventId !== null && requestedEventId !== pin.eventId) return null;
  return pin;
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Only `false` is trusted: `navigator.onLine === true` can mean "has a network
 *  interface" with no internet behind it, but `false` means offline. */
const readBrowserOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * True while the browser reports itself offline. React Query v5 starts every
 * page assuming it is ONLINE (its onlineManager only listens for the transition
 * events), so on an offline cold boot the candidate read does not pause — it
 * sits in `fetching` behind supabase-js's token refresh. The Deur tab uses this
 * to treat that read as unreachable right away instead of showing "Loading…".
 */
export function useBrowserOffline(): boolean {
  return useSyncExternalStore(subscribeOnline, readBrowserOffline, () => false);
}
