// Who-did-what labels (spec #61a, decision Max 2026-10-11) — ONE rule for every
// company-facing surface that names an actor: the audit feed, the data export,
// the door ("checked in by"), guest lists ("added by"), quota requests, recap.
//
//   1. a current OR former member/crew  → their full_name;
//   2. a PlusOne platform admin who acted without a membership/crew tie to the
//      company                          → "PlusOne support" (never the name);
//   3. no actor at all (null id)        → "System".
//
// Names come from the `venue_actor_names` RPC (SECURITY DEFINER, footprint-
// scoped to the venue — 20261016140000), never from a user_profiles read under
// RLS: can_view_profile hides former members and operators, which is exactly
// what made them read as "System" or blank before.
//
// Client-agnostic (browser or server client); every caller passes its own
// user-scoped client so the RPC's gate (member / crew of the venue) applies.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { chunkIds } from '@/lib/supabase/paging';
import { t } from '@/lib/i18n';

type Client = SupabaseClient<Database>;

/** Ids per RPC call (CLAUDE.md scale rule: ≤120 per id list; the RPC caps 500). */
export const ACTOR_ID_CHUNK = 120;

/** One row of `venue_actor_names`. The generated type says `display_name:
 *  string`; it is null whenever `is_support` is true. */
export interface ActorNameRow {
  user_id: string;
  display_name: string | null;
  is_support: boolean;
}

/** Rule 1 or 2 for one resolved row. */
export function labelForActorRow(row: ActorNameRow): string {
  return row.is_support || !row.display_name ? t.shared.actor.support : row.display_name;
}

/**
 * The label for one actor id: rule 3 for a null id, otherwise whatever
 * {@link fetchActorLabels} resolved. Returns `fallback` (default '') for an id
 * the venue has no record of — that cannot happen for an id read from the
 * venue's own rows, but a surface must never print a raw uuid.
 */
export function actorLabel(
  id: string | null | undefined,
  labels: ReadonlyMap<string, string>,
  fallback = '',
): string {
  if (!id) return t.shared.actor.system;
  return labels.get(id) ?? fallback;
}

/** PostgREST: function not in the schema cache (bundle live before its migration). */
const FUNCTION_MISSING = 'PGRST202';

/**
 * Resolve actor ids → labels for one venue, chunked to {@link ACTOR_ID_CHUNK}.
 * Null/empty ids are dropped (rule 3 is {@link actorLabel}'s job). An id without
 * a footprint in the venue simply has no entry.
 *
 * Expand–contract: while this bundle is live before 20261016140000 is pushed,
 * the RPC does not exist yet (PGRST202). Then — and only then — the chunk falls
 * back to the old RLS-scoped user_profiles read, so the door snapshot and the
 * lists keep loading with the previous labels instead of failing.
 */
export async function fetchActorLabels(
  client: Client,
  venueId: string,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
  const clean = [...new Set([...ids].filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const labels = new Map<string, string>();
  if (clean.length === 0 || !venueId) return labels;

  for (const chunk of chunkIds(clean, ACTOR_ID_CHUNK)) {
    const { data, error } = await client.rpc('venue_actor_names', { p_venue_id: venueId, p_ids: chunk });
    if (error) {
      if ((error as { code?: string }).code !== FUNCTION_MISSING) throw error;
      const fallback = await client.from('user_profiles').select('id, full_name').in('id', chunk);
      if (fallback.error) throw fallback.error;
      for (const p of fallback.data ?? []) labels.set(p.id, p.full_name);
      continue;
    }
    for (const row of (data ?? []) as ActorNameRow[]) labels.set(row.user_id, labelForActorRow(row));
  }
  return labels;
}
