/**
 * Thin write surface over the device-scoped Supabase client. Every door write
 * goes through the USER-scoped client so RLS is the real boundary (CLAUDE.md):
 * `checked_by`/`refused_by`/`added_by` are pinned to the session user and the
 * quota engine (45001/45002) enforces door-adds. Abstracting these four calls
 * behind an interface lets `replay.ts` be unit-tested with a fake gateway.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export type CheckInRow = Database['public']['Tables']['check_ins']['Insert'];
export type RefusalRow = Database['public']['Tables']['refusals']['Insert'];
export type GuestRow = Database['public']['Tables']['guests']['Insert'];

/** The fields of a PostgrestError the outbox cares about. */
export interface DbError {
  code?: string | null;
  details?: string | null;
  message?: string | null;
}

export interface DoorGateway {
  insertCheckIn(row: CheckInRow): Promise<{ error: DbError | null }>;
  /** Raise plus_ones_arrived on a guest's existing check-in ("nog inchecken"). */
  topUpCheckIn(guestId: string, plusOnesArrived: number): Promise<{ error: DbError | null }>;
  /** Soft-void a check-in ("uitchecken"); idempotent (re-void matches no row). */
  voidCheckIn(guestId: string, uid: string): Promise<{ error: DbError | null }>;
  /** Re-checkin a voided guest: clear the void and re-set arrivals. */
  reviveCheckIn(guestId: string, plusOnesArrived: number, uid: string): Promise<{ error: DbError | null }>;
  insertRefusal(row: RefusalRow): Promise<{ error: DbError | null }>;
  insertGuest(row: GuestRow): Promise<{ error: DbError | null }>;
  ackNote(guestId: string, ack: boolean, uid: string): Promise<{ error: DbError | null }>;
}

export function supabaseGateway(client: SupabaseClient<Database>): DoorGateway {
  return {
    insertCheckIn: async (row) => ({ error: (await client.from('check_ins').insert(row)).error }),
    // Update by guest_id; check_ins_update_door RLS scopes it to any door-scoped
    // user (can_check_in), and cap_check_in_arrivals clamps + keeps it monotonic.
    topUpCheckIn: async (guestId, plusOnesArrived) => ({
      error: (await client.from('check_ins').update({ plus_ones_arrived: plusOnesArrived }).eq('guest_id', guestId)).error,
    }),
    // Soft-void: flag the row. `.is('voided_at', null)` makes a re-void a no-op
    // (idempotent). The audit trigger records the change; RLS = check_ins_update_door.
    voidCheckIn: async (guestId, uid) => ({
      error: (
        await client
          .from('check_ins')
          .update({ voided_at: new Date().toISOString(), voided_by: uid })
          .eq('guest_id', guestId)
          .is('voided_at', null)
      ).error,
    }),
    // Re-checkin: clear the void and re-set arrivals fresh (the revive-aware
    // trigger does not hold the pre-void count). One row per guest, so no INSERT.
    reviveCheckIn: async (guestId, plusOnesArrived, uid) => ({
      error: (
        await client
          .from('check_ins')
          .update({
            voided_at: null,
            voided_by: null,
            checked_by: uid,
            checked_at: new Date().toISOString(),
            plus_ones_arrived: plusOnesArrived,
          })
          .eq('guest_id', guestId)
      ).error,
    }),
    insertRefusal: async (row) => ({ error: (await client.from('refusals').insert(row)).error }),
    insertGuest: async (row) => ({ error: (await client.from('guests').insert(row)).error }),
    ackNote: async (guestId, ack, uid) => {
      if (ack) {
        // Only the first acknowledgement sticks; a later device replay no-ops.
        const { error } = await client
          .from('guests')
          .update({ note_acknowledged_by: uid, note_acknowledged_at: new Date().toISOString() })
          .eq('id', guestId)
          .is('note_acknowledged_at', null);
        return { error };
      }
      const { error } = await client
        .from('guests')
        .update({ note_acknowledged_by: null, note_acknowledged_at: null })
        .eq('id', guestId);
      return { error };
    },
  };
}
