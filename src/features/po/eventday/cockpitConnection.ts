/**
 * Connection state for the desktop Check-in cockpit header (z8uq9m0hw4).
 *
 * The mobile door shows its connection in the SyncBar; the cockpit only hinted
 * at it through the LIVE badge's pulse, which vanished whenever the event was
 * not live yet. This derives the SAME traffic light the SyncBar shows, from the
 * same pure function (`deriveSyncStatus`), so the two surfaces can never
 * disagree on what "live" means. The only extra step is naming the non-live
 * states the way the SyncBar's label does: `warn` wins over offline (ten
 * minutes without a sync is the louder fact), and a stale dot while offline
 * reads as "offline" rather than "delayed".
 *
 * Pure and DOM-free, so it is unit-tested directly (cockpitConnection.test.ts).
 */
import { deriveSyncStatus, type SyncInputs, type SyncStatus } from '@/features/door/sync/status';

export type CockpitConnectionKind = 'live' | 'stale' | 'offline' | 'warn';

export interface CockpitConnection {
  /** Dot colour, identical to the door SyncBar's. */
  status: SyncStatus;
  /** Which label the pill shows. */
  kind: CockpitConnectionKind;
}

export function cockpitConnection(inputs: SyncInputs): CockpitConnection {
  const status = deriveSyncStatus(inputs);
  const kind: CockpitConnectionKind =
    status === 'live' ? 'live' : status === 'warn' ? 'warn' : inputs.online ? 'stale' : 'offline';
  return { status, kind };
}
