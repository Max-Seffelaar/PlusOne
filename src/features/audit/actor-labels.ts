// Who-did-what labels (spec #62a, decision Max 2026-10-11) — ONE rule for every
// company-facing surface that names an actor: the audit feed, the data export,
// the door ("checked in by"), guest lists ("added by"), quota requests, recap.
//
//   1. a current OR former member/crew  → their full_name ("Unnamed" if blank);
//   2. a PlusOne platform admin who acted without a membership/crew tie to the
//      company                          → "PlusOne support" (never the name);
//   3. no actor at all (null id)        → "System".
//
// Names come from the `venue_actor_names` RPC (SECURITY DEFINER, footprint-
// scoped to the venue — 20261016140000/20261016140100), never from a
// user_profiles read under RLS: can_view_profile hides former members and
// operators, which is exactly what made them read as "System" or blank before.
// "PlusOne support" is decided by the RPC's is_support flag ONLY — never by a
// name (review #466 P1-2: a user could name themselves "PlusOne support").
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

/**
 * Actor id → label for one venue, plus WHICH ids are "PlusOne support". A Map
 * of plain strings, so a surface that only prints a label just reads it; the
 * support flag rides beside it. A surface that treats support differently
 * (e.g. never cuts it to a first name) asks {@link ActorLabels.isSupport} —
 * never compares label text, which a user could imitate.
 */
export class ActorLabels extends Map<string, string> {
  readonly support = new Set<string>();

  /** Record one resolved actor. */
  setActor(id: string, label: string, isSupport: boolean): this {
    this.set(id, label);
    if (isSupport) this.support.add(id);
    else this.support.delete(id);
    return this;
  }

  isSupport(id: string | null | undefined): boolean {
    return !!id && this.support.has(id);
  }
}

/** A person's own name as a label: blank → the neutral "Unnamed" (never
 *  "PlusOne support": that is decided by the flag alone). */
export function nameLabel(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' ? t.shared.actor.unnamed : trimmed;
}

/** Rule 1 or 2 for one resolved row. "PlusOne support" comes from is_support
 *  ONLY: an empty or spoofed name never turns into it. */
export function labelForActorRow(row: ActorNameRow): string {
  return row.is_support ? t.shared.actor.support : nameLabel(row.display_name);
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
 * a footprint in the venue simply has no entry. Throws on any other RPC error.
 */
export async function fetchActorLabels(
  client: Client,
  venueId: string,
  ids: Iterable<string | null | undefined>,
): Promise<ActorLabels> {
  const clean = [...new Set([...ids].filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const labels = new ActorLabels();
  if (clean.length === 0 || !venueId) return labels;

  for (const chunk of chunkIds(clean, ACTOR_ID_CHUNK)) {
    const { data, error } = await client.rpc('venue_actor_names', { p_venue_id: venueId, p_ids: chunk });
    if (error) {
      if ((error as { code?: string }).code !== FUNCTION_MISSING) throw error;
      // EXPAND–CONTRACT SHIM: remove in the contract step once
      // 20261016140000_venue_actor_names is on prod (tracked by the
      // orchestrator). While this bundle is live before that migration the RPC
      // does not exist (PGRST202); only then the chunk falls back to the old
      // RLS-scoped user_profiles read, so screens keep their previous labels.
      const fallback = await client.from('user_profiles').select('id, full_name').in('id', chunk);
      if (fallback.error) throw fallback.error;
      for (const p of fallback.data ?? []) labels.setActor(p.id, nameLabel(p.full_name), false);
      continue;
    }
    for (const row of (data ?? []) as ActorNameRow[]) {
      labels.setActor(row.user_id, labelForActorRow(row), row.is_support);
    }
  }
  return labels;
}

/**
 * {@link fetchActorLabels} for surfaces where a label is a nicety, not the
 * point: the door snapshot (door speed, #25 — the door must load even when the
 * label RPC is down), the guest lists, recap, profile and the audit feed (which
 * then falls back to the view's names). Any failure yields an empty label set
 * and is logged; the screens show their "Unknown"/colleague wording. The data
 * export uses {@link fetchActorLabels}: there the labels ARE the record.
 */
export async function fetchActorLabelsSafe(
  client: Client,
  venueId: string,
  ids: Iterable<string | null | undefined>,
): Promise<ActorLabels> {
  try {
    return await fetchActorLabels(client, venueId, ids);
  } catch (e) {
    console.warn('actor labels unavailable; continuing without them:', e instanceof Error ? e.message : e);
    return new ActorLabels();
  }
}
