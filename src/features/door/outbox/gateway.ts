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
// like add_guest); venue_id is derived server-side by a BEFORE INSERT trigger
// (check_ins/refusals: set_checkin_scope, migration 20260622140000; guests:
// set_event_scope, migration 20260708120000), so it is omitted here and cast
// over at the insert call below.
export type CheckInRow = Omit<Database['public']['Tables']['check_ins']['Insert'], 'venue_id'>;
export type RefusalRow = Omit<Database['public']['Tables']['refusals']['Insert'], 'venue_id'>;
export type GuestRow = Omit<Database['public']['Tables']['guests']['Insert'], 'venue_id'>;

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
  /**
   * Soft-void a check-in ("uitchecken"); idempotent (re-void matches no row).
   * `checkInId` is the check_ins row the caller OBSERVED — pass it whenever it
   * is known so a replayed write can never reach a peer's newer row (#35).
   */
  voidCheckIn(guestId: string, uid: string, checkInId?: string | null): Promise<{ error: DbError | null }>;
  /** Re-checkin a voided guest: clear the void and re-set arrivals. */
  reviveCheckIn(
    guestId: string,
    plusOnesArrived: number,
    uid: string,
    checkInId?: string | null,
  ): Promise<{ error: DbError | null }>;
  /**
   * Atomic (partial) check-out: void + re-checkin of the smaller party in ONE
   * transaction (`check_out_guest`, migration 20260810183000). `remainingHeads`
   * is the TOTAL head count staying inside; 0 = everyone leaves (full void).
   * Online-only — the door's offline path uses voidCheckIn/reviveCheckIn (#34).
   */
  checkOutGuest(
    guestId: string,
    remainingHeads: number,
    checkInId?: string | null,
  ): Promise<{ error: DbError | null }>;
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
    //
    // `checkInId` pins the write to the row the caller OBSERVED (#35). guest_id
    // is unique, so an offline device that only matches on guest_id reaches
    // whatever check-in exists at drain time — including a colleague's fresh one
    // made while we were offline, which this would silently flip to "onderweg"
    // while the guest stands inside. A different id matches 0 rows = no-op =
    // synced, which is the same "the server's first write wins" rule the 23505
    // duplicate path already applies (#11). Entries queued by an older bundle
    // carry no id and keep the guest-scoped behaviour rather than being dropped.
    voidCheckIn: async (guestId, uid, checkInId = null) => {
      let q = client
        .from('check_ins')
        .update({ voided_at: new Date().toISOString(), voided_by: uid })
        .eq('guest_id', guestId)
        .is('voided_at', null);
      if (checkInId) q = q.eq('id', checkInId);
      return { error: (await q).error };
    },
    // Re-checkin: clear the void and re-set arrivals fresh (the revive-aware
    // trigger does not hold the pre-void count). One row per guest, so no INSERT.
    // `.not('voided_at','is',null)` scopes the UPDATE to a genuinely voided row:
    // without it, the cockpit's 23505→revive fallback would overwrite a peer's
    // ACTIVE checked_by/checked_at and corrupt the first-wins audit + instroom
    // bucket (C10). A 0-row match (the guest is already active) leaves the peer's
    // row untouched and returns no error → a harmless no-op = synced.
    // `checkInId` additionally pins it to the row we observed (#35): our own
    // void may legitimately have created the voided state, so the voided-only
    // guard alone cannot tell "the row I voided" from "a peer's row I just
    // voided by mistake".
    reviveCheckIn: async (guestId, plusOnesArrived, uid, checkInId = null) => {
      let q = client
        .from('check_ins')
        .update({
          voided_at: null,
          voided_by: null,
          checked_by: uid,
          checked_at: new Date().toISOString(),
          plus_ones_arrived: plusOnesArrived,
        })
        .eq('guest_id', guestId)
        .not('voided_at', 'is', null);
      if (checkInId) q = q.eq('id', checkInId);
      return { error: (await q).error };
    },
    // Partial/full check-out in one transaction (#34). Everything the two-step
    // client dance used to do — including the RLS uncheck gate — happens inside
    // the function, so a mid-flight failure leaves the guest exactly as they were.
    checkOutGuest: async (guestId, remainingHeads, checkInId = null) => ({
      error: (
        await client.rpc('check_out_guest', {
          p_guest_id: guestId,
          p_remaining_heads: remainingHeads,
          // Omitted rather than null: the SQL default (null = "any active row
          // for this guest") is what an unknown row id must fall back to.
          p_check_in_id: checkInId ?? undefined,
        })
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
    // venue_id is populated by the set_event_scope trigger; cast over the omitted column.
    insertGuest: async (row) => ({
      error: (await client.from('guests').insert(row as Database['public']['Tables']['guests']['Insert'])).error,
    }),
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
