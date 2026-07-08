/**
 * Thin write surface over the device-scoped Supabase client. Every door write
 * goes through the USER-scoped client so RLS is the real boundary (CLAUDE.md):
 * `checked_by`/`refused_by`/`added_by` are pinned to the session user and the
 * quota engine (45001/45002) enforces door-adds. Abstracting these four calls
 * behind an interface lets `replay.ts` be unit-tested with a fake gateway.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// event_id is supplied explicitly by the door (replay.ts passes entry.eventId,
// like add_guest); venue_id is derived server-side by the set_checkin_scope
// BEFORE INSERT trigger (migration 20260622140000), so it is omitted here and
// cast over at the insert call below.
export type CheckInRow = Omit<Database['public']['Tables']['check_ins']['Insert'], 'venue_id'>;
export type RefusalRow = Omit<Database['public']['Tables']['refusals']['Insert'], 'venue_id'>;
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
  /** Re-admit a guest refused by mistake: status refused → approved. The refusal
   *  row stays (append-only history); idempotent (only matches a refused row). */
  undoRefusal(guestId: string): Promise<{ error: DbError | null }>;
  insertGuest(row: GuestRow): Promise<{ error: DbError | null }>;
  ackNote(guestId: string, ack: boolean, uid: string): Promise<{ error: DbError | null }>;
}

export function supabaseGateway(client: SupabaseClient<Database>): DoorGateway {
  return {
    // venue_id is populated by the set_checkin_scope trigger; cast over the omitted column.
    insertCheckIn: async (row) => ({
      error: (await client.from('check_ins').insert(row as Database['public']['Tables']['check_ins']['Insert'])).error,
    }),
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
    // `.not('voided_at','is',null)` scopes the UPDATE to a genuinely voided row:
    // without it, the cockpit's 23505→revive fallback would overwrite a peer's
    // ACTIVE checked_by/checked_at and corrupt the first-wins audit + instroom
    // bucket (C10). A 0-row match (the guest is already active) leaves the peer's
    // row untouched and returns no error → a harmless no-op = synced.
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
          .not('voided_at', 'is', null)
      ).error,
    }),
    insertRefusal: async (row) => ({
      error: (await client.from('refusals').insert(row as Database['public']['Tables']['refusals']['Insert'])).error,
    }),
    // Re-admit: flip status back. `.eq('status','refused')` makes a replay (or a
    // guest already re-admitted) a 0-row no-op = synced. RLS guests_update
    // (admin/doorhost, can_write_guests) is the boundary; the audit trigger logs it.
    undoRefusal: async (guestId) => ({
      error: (await client.from('guests').update({ status: 'approved' }).eq('id', guestId).eq('status', 'refused')).error,
    }),
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
