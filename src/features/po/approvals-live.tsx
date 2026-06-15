'use client';

/**
 * Live data for the Aanvragen (approvals) screen — landing-page guest requests
 * (#12/#31) and quota requests (#4/#5) awaiting approval, plus approve/deny
 * wrappers around the existing server actions.
 *
 * READS go through the USER-scoped browser client so RLS is the boundary: a
 * non-admin/organizer simply sees no pending rows (the `guest_requests` /
 * `quota_requests` read policies gate visibility). WRITES never touch Supabase
 * directly here — they call the audited server actions in
 * `@/features/requests/actions` and `@/features/quotas/actions`, which re-check
 * the session + role and run the atomic RPCs.
 *
 * Everything maps onto the prototype view types (`GuestRequest`, `QuotaRequest`
 * in `@/lib/po/types`) so the screen renders unchanged (CLAUDE.md design rule:
 * replace the data, preserve the component API). Hooks live in their own file so
 * parallel agents never collide; they run inside `PoLiveProvider`.
 */
import { useCallback, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/database.types';
import type { GuestRequest, QuotaRequest } from '@/lib/po/types';
import {
  approveGuestRequest,
  denyGuestRequest,
  type ActionResult as RequestActionResult,
} from '@/features/requests/actions';
import {
  decideQuotaRequest,
  type ActionResult as QuotaActionResult,
} from '@/features/quotas/actions';

type Client = SupabaseClient<Database>;
type VenueRole = Database['public']['Enums']['venue_role'];

// `organizer` is an event-level scope, not a venue role — see live-queries.ts.
const ROLE_LABEL: Record<VenueRole, string> = {
  admin: 'Admin',
  user_manager: 'Gebruikersbeheer',
  finance: 'Finance',
  staff: 'Staff',
  doorhost: 'Doorhost',
};

/** Stable query key for everything on the approvals screen for one event. */
function approvalsKey(eventId: string | undefined): (string | undefined)[] {
  return ['po', 'approvals', eventId];
}

/** One browser client per hook instance (matches PoLiveProvider's pattern). */
function useBrowserClient(): Client {
  const [client] = useState(() => createClient());
  return client;
}

// ── relative time ─────────────────────────────────────────────────────────────

const TZ = 'Europe/Amsterdam';

/**
 * Dutch relative-time label matching the prototype's `at` strings
 * ("18 min geleden", "2 uur geleden", "gisteren", "12 jun"). Kept deliberately
 * coarse — the screen only shows recency, never an exact timestamp.
 */
function relativeNL(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'zojuist';
  if (min < 60) return `${min} min geleden`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} uur geleden`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'gisteren';
  if (days < 7) return `${days} dagen geleden`;
  return new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, day: 'numeric', month: 'short' })
    .format(then)
    .replace('.', '');
}

/** Mask a phone to the prototype shape ("•••• 4821") — never expose full PII. */
function maskPhone(phone: string | null): string {
  if (!phone) return '••••';
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return last4 ? `•••• ${last4}` : '••••';
}

// ── guest (landing-page) requests ──────────────────────────────────────────────

type GuestRequestRow = Pick<
  Database['public']['Tables']['guest_requests']['Row'],
  'id' | 'full_name' | 'plus_ones' | 'phone' | 'motivation' | 'created_at'
>;

/** Pure row → prototype GuestRequest. `existingNames` flags repeat guests. */
export function toGuestRequest(
  r: GuestRequestRow,
  existingNames: Set<string>,
  now: Date = new Date(),
): GuestRequest {
  // The prototype shows a soft "let op" flag for large parties or a guest who is
  // already on the list. We can only derive these honestly from data we have.
  let flag: string | undefined;
  if (r.plus_ones >= 3) flag = `Groot gezelschap (+${r.plus_ones})`;
  else if (existingNames.has(r.full_name.trim().toLowerCase()))
    flag = 'Staat al op de lijst';
  return {
    id: r.id,
    name: r.full_name,
    plus: r.plus_ones,
    phone: maskPhone(r.phone),
    motivation: r.motivation ?? '',
    at: relativeNL(r.created_at, now),
    status: 'open',
    ...(flag ? { flag } : {}),
  };
}

async function fetchGuestRequests(client: Client, eventId: string): Promise<GuestRequest[]> {
  const { data: reqs } = await client
    .from('guest_requests')
    .select('id, full_name, plus_ones, phone, motivation, created_at')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('created_at');

  const rows = reqs ?? [];
  // Flag a request whose name already sits on the live guest list (#12 hint).
  // RLS scopes this read to what the approver may see; a miss just means no flag.
  const { data: guestRows } = rows.length
    ? await client.from('guests').select('full_name').eq('event_id', eventId).neq('status', 'removed')
    : { data: [] as { full_name: string }[] };
  const existingNames = new Set((guestRows ?? []).map((g) => g.full_name.trim().toLowerCase()));

  const now = new Date();
  return rows.map((r) => toGuestRequest(r, existingNames, now));
}

/** Pending landing-page requests for an event, as the prototype GuestRequest[]. */
export function useGuestRequests(eventId: string | undefined): {
  requests: GuestRequest[];
  isLoading: boolean;
} {
  const client = useBrowserClient();
  const { data: requests = [], isLoading } = useQuery({
    queryKey: [...approvalsKey(eventId), 'guest'],
    queryFn: () => (eventId ? fetchGuestRequests(client, eventId) : Promise.resolve([])),
    enabled: Boolean(eventId),
  });
  return { requests, isLoading };
}

// ── quota requests ─────────────────────────────────────────────────────────────

async function fetchQuotaRequests(client: Client, eventId: string): Promise<QuotaRequest[]> {
  const [{ data: reqs }, { data: event }] = await Promise.all([
    client
      .from('quota_requests')
      .select('id, user_id, requested_extra, motivation, created_at')
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .order('created_at'),
    client.from('events').select('name, venue_id').eq('id', eventId).maybeSingle(),
  ]);

  const rows = reqs ?? [];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const venueId = event?.venue_id ?? null;

  // Resolve the requester's name, their venue role(s) (for the role label), their
  // base quota, and any per-event override — so we can show "current → want" the
  // way the prototype does. All reads are RLS-scoped to the admin. The
  // venue-keyed reads short-circuit to an empty set when the event has no venue
  // (mirrors the `await … : { data: [] }` idiom in live-queries.ts).
  const [{ data: profiles }, { data: overrides }] = await Promise.all([
    client.from('user_profiles').select('id, full_name').in('id', userIds),
    client
      .from('event_quotas')
      .select('user_id, quota_override')
      .eq('event_id', eventId)
      .in('user_id', userIds),
  ]);
  const { data: memberships } = venueId
    ? await client
        .from('venue_memberships')
        .select('user_id, roles')
        .eq('venue_id', venueId)
        .in('user_id', userIds)
    : { data: [] as { user_id: string; roles: VenueRole[] }[] };
  const { data: baseQuotas } = venueId
    ? await client
        .from('quotas')
        .select('user_id, default_count')
        .eq('venue_id', venueId)
        .in('user_id', userIds)
    : { data: [] as { user_id: string; default_count: number }[] };

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const rolesById = new Map((memberships ?? []).map((m) => [m.user_id, m.roles ?? []]));
  const baseById = new Map((baseQuotas ?? []).map((q) => [q.user_id, q.default_count]));
  const overrideById = new Map((overrides ?? []).map((o) => [o.user_id, o.quota_override]));

  const eventName = event?.name ?? '';
  const now = new Date();

  return rows.map((r): QuotaRequest => {
    // Effective current allowance: a per-event override wins over the base quota.
    const current = overrideById.get(r.user_id) ?? baseById.get(r.user_id) ?? 0;
    const roles = rolesById.get(r.user_id) ?? [];
    const roleLabel = roles.map((role) => ROLE_LABEL[role] ?? role).join(' · ') || 'Lid';
    return {
      id: r.id,
      who: nameById.get(r.user_id) ?? 'Onbekend',
      role: roleLabel,
      event: eventName,
      current,
      want: current + r.requested_extra,
      reason: r.motivation ?? '',
      at: relativeNL(r.created_at, now),
      status: 'open',
    };
  });
}

/** Pending quota requests for an event, as the prototype QuotaRequest[]. */
export function useQuotaRequests(eventId: string | undefined): {
  requests: QuotaRequest[];
  isLoading: boolean;
} {
  const client = useBrowserClient();
  const { data: requests = [], isLoading } = useQuery({
    queryKey: [...approvalsKey(eventId), 'quota'],
    queryFn: () => (eventId ? fetchQuotaRequests(client, eventId) : Promise.resolve([])),
    enabled: Boolean(eventId),
  });
  return { requests, isLoading };
}

// ── mutations ──────────────────────────────────────────────────────────────────

/**
 * Thin wrappers around the audited server actions. Each invalidates the
 * approvals key on success so the decided row drops out of the list. They return
 * the action's ActionResult so the screen can surface a Dutch error message
 * (e.g. a full tier → 45002, missing AAL2 → 42501) inline.
 */

function useInvalidateApprovals(eventId: string | undefined): () => Promise<void> {
  const qc: QueryClient = useQueryClient();
  return useCallback(
    () => qc.invalidateQueries({ queryKey: approvalsKey(eventId) }),
    [qc, eventId],
  );
}

/** Approve a landing request with a chosen tier → guest (source=landing, #31). */
export function useApproveGuestRequest(eventId: string | undefined): {
  approve: (requestId: string, tierId: string) => Promise<RequestActionResult>;
  isPending: boolean;
} {
  const invalidate = useInvalidateApprovals(eventId);
  const m = useMutation({
    mutationFn: ({ requestId, tierId }: { requestId: string; tierId: string }) =>
      approveGuestRequest({ requestId, tierId, eventId }),
    onSuccess: (res) => {
      if (res.ok) void invalidate();
    },
  });
  const approve = useCallback(
    (requestId: string, tierId: string) => m.mutateAsync({ requestId, tierId }),
    [m],
  );
  return { approve, isPending: m.isPending };
}

/** Deny a landing request with a mandatory reason (#12). */
export function useDenyGuestRequest(eventId: string | undefined): {
  deny: (requestId: string, reason: string) => Promise<RequestActionResult>;
  isPending: boolean;
} {
  const invalidate = useInvalidateApprovals(eventId);
  const m = useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string }) =>
      denyGuestRequest({ requestId, reason, eventId }),
    onSuccess: (res) => {
      if (res.ok) void invalidate();
    },
  });
  const deny = useCallback(
    (requestId: string, reason: string) => m.mutateAsync({ requestId, reason }),
    [m],
  );
  return { deny, isPending: m.isPending };
}

/** Approve a quota request → atomic override grant via the AAL2-gated RPC (#5). */
export function useApproveQuotaRequest(eventId: string | undefined): {
  approve: (requestId: string) => Promise<QuotaActionResult>;
  isPending: boolean;
} {
  const invalidate = useInvalidateApprovals(eventId);
  const m = useMutation({
    mutationFn: ({ requestId }: { requestId: string }) =>
      decideQuotaRequest({ requestId, decision: 'approved', eventId }),
    onSuccess: (res) => {
      if (res.ok) void invalidate();
    },
  });
  const approve = useCallback(
    (requestId: string) => m.mutateAsync({ requestId }),
    [m],
  );
  return { approve, isPending: m.isPending };
}

/** Deny a quota request with a mandatory reason (#5). */
export function useDenyQuotaRequest(eventId: string | undefined): {
  deny: (requestId: string, reason: string) => Promise<QuotaActionResult>;
  isPending: boolean;
} {
  const invalidate = useInvalidateApprovals(eventId);
  const m = useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string }) =>
      decideQuotaRequest({ requestId, decision: 'denied', reason, eventId }),
    onSuccess: (res) => {
      if (res.ok) void invalidate();
    },
  });
  const deny = useCallback(
    (requestId: string, reason: string) => m.mutateAsync({ requestId, reason }),
    [m],
  );
  return { deny, isPending: m.isPending };
}
