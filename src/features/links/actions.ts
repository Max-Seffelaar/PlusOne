'use server';

import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { slugify, randomSlugSuffix } from '@/features/events/slug';
import {
  createInfluencerSchema,
  updateInfluencerSchema,
  createRequestLinkSchema,
  updateRequestLinkSchema,
  type CreateInfluencerInput,
  type UpdateInfluencerInput,
  type CreateRequestLinkInput,
  type UpdateRequestLinkInput,
} from './schemas';

// Request-link + influencer management (Requests-epic F1, 86ey21vjt).
//
// Security checklist: every action verifies the session server-side and then
// writes through the USER-SCOPED client — RLS is the boundary (admin manages
// influencers; admin/organizer manage links on their event; the scope triggers
// stamp venue_id and reject cross-venue influencers). Client-supplied IDs are
// therefore untrusted-but-safe: a row outside the caller's scope simply matches
// nothing / violates the policy. All input is Zod-parsed; errors map to generic
// copy via mapMutationError.

export type LinkActionResult = { ok: true; id?: string; slug?: string } | MutationError;

export async function createInfluencer(input: CreateInfluencerInput): Promise<LinkActionResult> {
  const parsed = createInfluencerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, name, handle, notes } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('influencers')
    .insert({
      venue_id: venueId,
      name,
      handle: handle ?? null,
      notes: notes ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error) return mapMutationError(error);
  return { ok: true, id: data.id };
}

export async function updateInfluencer(input: UpdateInfluencerInput): Promise<LinkActionResult> {
  const parsed = updateInfluencerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { influencerId, name, handle, notes, archived } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const patch: Database['public']['Tables']['influencers']['Update'] = {};
  if (name !== undefined) patch.name = name;
  if (handle !== undefined) patch.handle = handle;
  if (notes !== undefined) patch.notes = notes;
  if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null;
  if (Object.keys(patch).length === 0) return { ok: true, id: influencerId };

  const { error } = await supabase.from('influencers').update(patch).eq('id', influencerId);
  if (error) return mapMutationError(error);
  return { ok: true, id: influencerId };
}

export async function createRequestLink(input: CreateRequestLinkInput): Promise<LinkActionResult> {
  const parsed = createRequestLinkSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, influencerId, label, slugBase, tierId, maxHeadcount, autoApprove, expiresAt } =
    parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const base = slugify(slugBase) || 'link';

  // venue_id is stamped by the set_request_link_scope BEFORE trigger (same
  // pattern as check_ins): omit it from the row type and cast at the insert.
  type LinkInsert = Database['public']['Tables']['request_links']['Insert'];

  // The random suffix defeats enumeration; the unique index is the authority on
  // collisions (and the events_set_landing_slug generator avoids this namespace
  // in return). Three tries is astronomically more than enough.
  let lastError: MutationError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row: Omit<LinkInsert, 'venue_id'> = {
      event_id: eventId,
      influencer_id: influencerId ?? null,
      label: label ?? null,
      slug: `${base}-${randomSlugSuffix()}`,
      tier_id: tierId ?? null,
      max_headcount: maxHeadcount ?? null,
      auto_approve: autoApprove,
      expires_at: expiresAt ?? null,
      created_by: user.id,
    };
    const { data, error } = await supabase
      .from('request_links')
      .insert(row as LinkInsert)
      .select('id, slug')
      .single();
    if (!error) return { ok: true, id: data.id, slug: data.slug };
    lastError = mapMutationError(error);
    if (error.code !== '23505') break; // only retry slug collisions
  }
  return lastError ?? invalidInput();
}

export async function updateRequestLink(input: UpdateRequestLinkInput): Promise<LinkActionResult> {
  const parsed = updateRequestLinkSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { linkId, influencerId, label, tierId, maxHeadcount, autoApprove, active, expiresAt, archived } =
    parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const patch: Database['public']['Tables']['request_links']['Update'] = {};
  if (influencerId !== undefined) patch.influencer_id = influencerId;
  if (label !== undefined) patch.label = label;
  if (tierId !== undefined) patch.tier_id = tierId;
  if (maxHeadcount !== undefined) patch.max_headcount = maxHeadcount;
  if (autoApprove !== undefined) patch.auto_approve = autoApprove;
  if (active !== undefined) patch.active = active;
  if (expiresAt !== undefined) patch.expires_at = expiresAt;
  if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null;
  if (Object.keys(patch).length === 0) return { ok: true, id: linkId };

  const { error } = await supabase.from('request_links').update(patch).eq('id', linkId);
  if (error) return mapMutationError(error);
  return { ok: true, id: linkId };
}

/**
 * Mint (or re-mint) the influencer's secret stats-URL token (F2, /i/[token]).
 * The bearer token is generated here and returned ONCE; only its sha256 lands
 * in the database (same stance as the guest status tokens). Rotating kills the
 * previous URL. RLS bounds the update to venue admins; the write is audited by
 * the influencers trigger.
 */
export async function rotateInfluencerStatsToken(
  influencerId: string
): Promise<{ ok: true; token: string } | MutationError> {
  if (!/^[0-9a-f-]{36}$/i.test(influencerId)) return invalidInput();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data, error } = await supabase
    .from('influencers')
    .update({ stats_token_hash: tokenHash })
    .eq('id', influencerId)
    .select('id');
  if (error) return mapMutationError(error);
  // RLS silently matches nothing for non-admins — surface that as no-rights.
  if (!data || data.length === 0) {
    return { ok: false, code: '42501', message: "You don't have rights for this (or MFA is required)." };
  }
  return { ok: true, token };
}

/** Revoke the influencer's stats URL (the /i/[token] link goes generically dead). */
export async function revokeInfluencerStatsToken(influencerId: string): Promise<LinkActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(influencerId)) return invalidInput();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase
    .from('influencers')
    .update({ stats_token_hash: null })
    .eq('id', influencerId);
  if (error) return mapMutationError(error);
  return { ok: true, id: influencerId };
}
