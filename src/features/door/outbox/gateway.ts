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
  insertRefusal(row: RefusalRow): Promise<{ error: DbError | null }>;
  insertGuest(row: GuestRow): Promise<{ error: DbError | null }>;
  ackNote(guestId: string, ack: boolean, uid: string): Promise<{ error: DbError | null }>;
}

export function supabaseGateway(client: SupabaseClient<Database>): DoorGateway {
  return {
    insertCheckIn: async (row) => ({ error: (await client.from('check_ins').insert(row)).error }),
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
