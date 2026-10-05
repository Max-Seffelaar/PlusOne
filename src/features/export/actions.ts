'use server';

// Legal v0.3 E1 — self-service venue data export (plan §3 E1, decisions 1 + 2;
// DPA 11.2, ToS 9.5/16.5). A venue admin downloads everything the venue holds
// as personal data — guests, contacts, requests, door activity — as four CSVs
// in one ZIP, without PlusOne in between.
//
// Security checklist (CLAUDE.md):
//   * session: `auth.getUser()` server-side, never getSession();
//   * role: `admin` only (not finance — exporting is a controller act), checked
//     through the user-scoped `has_venue_role` RPC, which also admits platform
//     admins (decision #49); their export is audited under their own uid;
//   * input: Zod (`exportVenueDataSchema`), strict — nothing else passes;
//   * ownership: every read goes through the caller's user-scoped client, so
//     RLS confirms each row; an event scope is re-checked to belong to venueId;
//   * never the service-role client;
//   * NOT behind the billing gate (gate.ts): ToS 6.2 promises read access on a
//     lapsed trial, and an export is exactly that;
//   * audit: one `audit_log` row per download via `log_venue_export` (SECURITY
//     DEFINER, see migration 20261006140000). Fail-closed: no audit row, no file;
//   * errors to the client are generic codes; details go to the server log
//     without PII (no names, no ids beyond what the caller sent).

import { createClient } from '@/lib/supabase/server';
import { exportVenueDataSchema } from './schemas';
import { collectVenueExport, ExportTooLargeError, type ExportCounts } from './collect';
import { buildZip } from './zip';

export type ExportVenueDataResult =
  | { ok: true; filename: string; zipBase64: string; counts: ExportCounts }
  | { ok: false; error: 'unauthorized' | 'invalid' | 'too_large' | 'failed' };

function slugPart(s: string): string {
  const slug = s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 40);
  return slug || 'venue';
}

export async function exportVenueData(input: unknown): Promise<ExportVenueDataResult> {
  const parsed = exportVenueDataSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { venueId, scope } = parsed.data;
  const eventId = scope === 'venue' ? null : scope.eventId;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthorized' };

  const { data: isAdmin, error: roleError } = await supabase.rpc('has_venue_role', {
    p_venue_id: venueId,
    p_roles: ['admin'],
  });
  if (roleError || isAdmin !== true) return { ok: false, error: 'unauthorized' };

  // Venue name for the file name; an event scope must be an event OF this venue
  // (scope mismatch → the same generic answer as a missing role).
  const { data: venue } = await supabase.from('venues').select('slug, name').eq('id', venueId).maybeSingle();
  if (!venue) return { ok: false, error: 'unauthorized' };
  let eventLabel = '';
  if (eventId) {
    const { data: event } = await supabase
      .from('events')
      .select('name')
      .eq('id', eventId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!event) return { ok: false, error: 'unauthorized' };
    eventLabel = `-${slugPart(event.name)}`;
  }

  try {
    const { files, counts } = await collectVenueExport(supabase, venueId, eventId);
    const zip = buildZip(files.map((f) => ({ name: f.name, data: Buffer.from(f.csv, 'utf8') })));

    // Fail-closed: the file only leaves the server once its audit row exists.
    const { error: auditError } = await supabase.rpc('log_venue_export', {
      p_venue_id: venueId,
      p_event_id: eventId,
      p_guests: counts.guests,
      p_contacts: counts.contacts,
      p_requests: counts.requests,
      p_door: counts.door,
    });
    if (auditError) {
      console.error('exportVenueData: audit write failed', auditError.code);
      return { ok: false, error: 'failed' };
    }

    const day = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      filename: `plusone-export-${slugPart(venue.slug || venue.name)}${eventLabel}-${day}.zip`,
      zipBase64: zip.toString('base64'),
      counts,
    };
  } catch (error) {
    if (error instanceof ExportTooLargeError) return { ok: false, error: 'too_large' };
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown';
    console.error('exportVenueData: read failed', code);
    return { ok: false, error: 'failed' };
  }
}
