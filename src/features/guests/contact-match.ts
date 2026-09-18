// Name-only guests -> an existing contact at the same venue (K, ADE UX round).
//
// The `guests_autolink_contact` trigger links on e-mail/phone ONLY, deliberately:
// linking on a name alone at import time was the duplicate trap (two different
// "Jan de Vries" collapsing into one address-book entry). So the name path is a
// UI OFFER instead — pre-selected, one tap to undo — and it only fires when the
// match is unambiguous: exactly one contact with that exact name.
//
// Staff cannot SELECT `contacts` under RLS; `search_contacts_for_reuse` is the
// SECURITY DEFINER, member-gated, PII-free projection every member may call
// (migration 20260615130000). It is the ONLY read used here, on both the client
// (the offer) and the server (re-verifying the id the client sent back).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

type Client = SupabaseClient<Database>;

/** The narrow contact shape `search_contacts_for_reuse` hands back. */
export interface ContactCandidate {
  id: string;
  fullName: string;
}

/**
 * Fold a person's name to a comparison key: NFD-decompose so combining accents
 * become separate marks, drop those marks ("Jerôme" == "Jerome"), collapse runs
 * of whitespace, trim, lower-case. Deliberately NOT fuzzy — a near-match must
 * not silently link two different people (see the header note).
 */
export function normalizeContactName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Every candidate whose name folds to the same key as `name` (empty when name is blank). */
export function contactNameMatches(name: string, contacts: readonly ContactCandidate[]): ContactCandidate[] {
  const key = normalizeContactName(name);
  if (!key) return [];
  return contacts.filter((c) => normalizeContactName(c.fullName) === key);
}

/**
 * The one contact this name unambiguously belongs to, or null.
 * 0 matches -> null (nothing to offer). 2+ matches -> null: we cannot know which
 * person it is, and guessing would merge two address-book entries.
 */
export function matchContactByName(name: string, contacts: readonly ContactCandidate[]): string | null {
  const hits = contactNameMatches(name, contacts);
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Venue address-book lookup for reuse. `query` narrows server-side (ilike, limit
 * 50); the exact-name folding still happens here, because ilike '%jan%' also
 * returns "Jana" and "Janssen". Non-members get an empty result from the RPC
 * itself — RLS/its own member gate is the boundary, never this call site.
 */
export async function searchContactsForReuse(
  client: Client,
  venueId: string,
  query: string,
): Promise<ContactCandidate[]> {
  const { data, error } = await client.rpc('search_contacts_for_reuse', {
    p_venue_id: venueId,
    p_query: query,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, fullName: r.full_name }));
}

/** At most this many distinct names get a lookup in one batch (a 500-line paste
 *  must not turn into 500 round-trips); the rest simply stay unmatched. */
export const CONTACT_MATCH_MAX_NAMES = 200;
/** Lookups in flight at once — enough to stay snappy, few enough to be polite. */
export const CONTACT_MATCH_CONCURRENCY = 6;

/** Distinct, non-blank, normalized names, capped — the batch's work list. */
export function distinctContactNames(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const key = normalizeContactName(n);
    // One-character names can't be matched meaningfully and would ilike half the
    // address book; skip them rather than pay for the round-trip.
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= CONTACT_MATCH_MAX_NAMES) break;
  }
  return out;
}

/**
 * Resolve many names at once, keyed by their normalized form. Runs at most
 * CONTACT_MATCH_CONCURRENCY lookups in parallel. A single failed lookup yields no
 * matches for that name instead of failing the batch: the offer is a convenience,
 * never a gate on adding the guest.
 */
export async function resolveContactMatches(
  client: Client,
  venueId: string,
  names: readonly string[],
  concurrency = CONTACT_MATCH_CONCURRENCY,
): Promise<Map<string, ContactCandidate[]>> {
  const work = distinctContactNames(names);
  const out = new Map<string, ContactCandidate[]>();
  let next = 0;
  const runner = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= work.length) return;
      const key = work[i];
      try {
        out.set(key, contactNameMatches(key, await searchContactsForReuse(client, venueId, key)));
      } catch {
        out.set(key, []);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, runner));
  return out;
}
