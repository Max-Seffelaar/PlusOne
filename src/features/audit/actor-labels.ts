// Who-did-what labels (spec #64a, decision Max 2026-10-11) — ONE rule for every
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
import { profileNameKey } from '@/features/auth/profile-name';
import type { ActorKind } from '@/lib/po/actor-kind';

export type { ActorKind } from '@/lib/po/actor-kind';

/** One actor as a surface shows it: the text and WHAT it is. Only `member`
 *  text is user-controlled; render through kit `ActorName` (review #466 r3). */
export interface ActorRef {
  text: string;
  kind: ActorKind;
}

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
 * Actor id → label for one venue, plus each actor's KIND. A Map of plain
 * strings, so a surface that only prints text just reads it; the kind rides
 * beside it and decides HOW it is shown (kit `ActorName`): only `member` is a
 * person's own text, everything else is PlusOne's typed label. Never compare
 * label text — a user could imitate it.
 */
export class ActorLabels extends Map<string, string> {
  readonly kinds = new Map<string, ActorKind>();

  /** Record one resolved actor. */
  setActor(id: string, label: string, kind: ActorKind): this {
    this.set(id, label);
    this.kinds.set(id, kind);
    return this;
  }

  /** null id → system; an id without an entry → unknown. */
  kindOf(id: string | null | undefined): ActorKind {
    if (!id) return 'system';
    return this.kinds.get(id) ?? 'unknown';
  }

  isSupport(id: string | null | undefined): boolean {
    return this.kindOf(id) === 'support';
  }

  /** Every id of the given kind (e.g. the support ids for a JSON payload). */
  idsOfKind(kind: ActorKind): string[] {
    return [...this.kinds].filter(([, k]) => k === kind).map(([id]) => id);
  }
}

/** A person's own name as a reference: blank (same normalisation as the DB:
 *  invisible characters and Unicode spaces don't count) → the typed "Unnamed";
 *  otherwise the stored name, kind `member`. Never "PlusOne support". */
export function nameRef(name: string | null | undefined): ActorRef {
  if (profileNameKey(name) === '') return { text: t.shared.actor.unnamed, kind: 'unnamed' };
  return { text: (name ?? '').trim(), kind: 'member' };
}

/** {@link nameRef}'s text. */
export function nameLabel(name: string | null | undefined): string {
  return nameRef(name).text;
}

/** One RPC row as a reference. "PlusOne support" comes from is_support ONLY:
 *  an empty or spoofed name never turns into it. */
export function refForActorRow(row: ActorNameRow): ActorRef {
  return row.is_support ? { text: t.shared.actor.support, kind: 'support' } : nameRef(row.display_name);
}

/** {@link refForActorRow}'s text. */
export function labelForActorRow(row: ActorNameRow): string {
  return refForActorRow(row).text;
}

/** One actor id as a reference: system for a null id, the resolved label, or
 *  the typed "Unknown" for an id without one (never a raw uuid). */
export function actorRef(id: string | null | undefined, labels: ActorLabels): ActorRef {
  if (!id) return { text: t.shared.actor.system, kind: 'system' };
  const text = labels.get(id);
  return text === undefined ? { text: t.shared.actor.unknown, kind: 'unknown' } : { text, kind: labels.kindOf(id) };
}

/** PostgREST: function not in the schema cache (bundle live before its migration). */
const FUNCTION_MISSING = 'PGRST202';

/**
 * Resolve actor ids → labels for one venue, chunked to {@link ACTOR_ID_CHUNK}.
 * Null/empty ids are dropped (rule 3 is {@link actorRef}'s job). An id without
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
      for (const p of fallback.data ?? []) {
        const ref = nameRef(p.full_name);
        labels.setActor(p.id, ref.text, ref.kind);
      }
      continue;
    }
    for (const row of (data ?? []) as ActorNameRow[]) {
      const ref = refForActorRow(row);
      labels.setActor(row.user_id, ref.text, ref.kind);
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
