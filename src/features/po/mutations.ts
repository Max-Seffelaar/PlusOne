'use client';

// React Query mutation wrappers around the EXISTING server actions. Writes stay
// server-side, so RLS + the quota engine remain the boundary (CLAUDE.md). Each
// hook throws on a MutationError so React Query surfaces it, then invalidates the
// affected event subtree. Door writes are deliberately ABSENT — they flow through
// the offline outbox (DoorProvider), never a plain server action (#25).
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  addGuest,
  addGuestsBulk,
  updateGuest,
  changeGuestTier,
  removeGuest,
  type ActionResult,
} from '@/features/guests/actions';
import type {
  AddGuestInput,
  BulkAddInput,
  UpdateGuestInput,
  ChangeTierInput,
} from '@/features/guests/schemas';
import { approveGuestRequest, denyGuestRequest } from '@/features/requests/actions';
import type {
  ApproveGuestRequestInput,
  DenyGuestRequestInput,
} from '@/features/requests/schemas';
import { decideQuotaRequest, requestExtraSlots } from '@/features/quotas/actions';
import type { DecideQuotaRequestInput, QuotaRequestInput } from '@/features/quotas/schemas';
import {
  importContacts,
  addContactToEvent,
  syncPermanentGuests,
  toggleContactPermanent,
  upsertContact,
  forgetContact,
  type ImportResult,
  type SyncResult,
} from '@/features/contacts/actions';
import type {
  ImportContactsInput,
  AddContactToEventInput,
  SyncPermanentInput,
  TogglePermanentInput,
  UpsertContactInput,
  ForgetContactInput,
} from '@/features/contacts/schemas';
import {
  changeEventStatus,
  createEvent,
  createTier,
  deleteTier,
  setAutoLock,
  setEventAllowUncheck,
  setLandingActive,
  setListLock,
  updateEvent,
  updateTier,
} from '@/features/events/actions';
import type {
  ChangeStatusInput,
  CreateEventInput,
  CreateTierInput,
  DeleteTierInput,
  SetAutoLockInput,
  SetAllowUncheckInput,
  SetLandingActiveInput,
  SetLockInput,
  UpdateEventInput,
  UpdateTierInput,
} from '@/features/events/schemas';
import { inviteUserAction, revokeInviteAction, acceptInvitesAction } from '@/features/auth/invite-actions';
import { updateProfileAction, updateEmailAction } from '@/features/auth/profile-actions';
import { revokeOwnSessionAction, adminRevokeSessionAction } from '@/features/auth/session-actions';
import { updateMemberRolesAction, removeMemberAction, updateVenueSettingsAction } from '@/features/venues/actions';
import { setDefaultQuotaAction } from '@/features/quotas/default-quota-actions';
import type { VenueRole } from '@/features/auth/roles';
import type { Guest, Tier } from '@/lib/po/types';
import { poKeys } from './keys';
import { optimisticGuest, type OptimisticAddArgs } from './adapters';
import { usePoIdentity } from './PoLiveProvider';
import { supabaseGateway } from '@/features/door/outbox/gateway';
import { getDeviceId, getDoorClient } from '@/features/door/offline/device';
import { classifyError } from '@/features/door/outbox/replay';
import { v7 as uuidv7 } from 'uuid';
import { amsterdamHM, flipGuestStatus } from './eventday/cockpit';

interface ActionLike {
  ok: boolean;
  message?: string;
}

/** Surface a server action's MutationError as a thrown error for React Query. */
function throwOnError<T extends ActionLike>(res: T): T {
  if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
  return res;
}

/**
 * Optimistically append guests to the cached list; returns a rollback snapshot.
 * The role badge comes from the tiers cache, so the optimistic rows are visually
 * indistinguishable from the server rows that replace them on invalidation.
 * Callers pass a client UUIDv7 `id` (#25), so the keyed list reconciles without
 * a flash when the real row arrives.
 */
async function patchGuestsOptimistically(
  qc: QueryClient,
  eventId: string,
  rows: OptimisticAddArgs[]
): Promise<{ prev: Guest[] | undefined }> {
  await qc.cancelQueries({ queryKey: poKeys.guests(eventId) });
  const prev = qc.getQueryData<Guest[]>(poKeys.guests(eventId));
  const tiers = qc.getQueryData<Tier[]>(poKeys.tiers(eventId)) ?? [];
  const additions = rows.map((r) => optimisticGuest(r, tiers));
  qc.setQueryData<Guest[]>(poKeys.guests(eventId), (old) => [...(old ?? []), ...additions]);
  return { prev };
}

/** Invalidate the whole add-affected subtree: guest list, tier counts, quota. */
function invalidateAfterAdd(qc: QueryClient, eventId: string): void {
  void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
  void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
  void qc.invalidateQueries({ queryKey: poKeys.quota(eventId) });
}

// The settings cluster reuses the EXISTING (prev, FormData) → ActionState server
// actions (useActionState shape), so writes keep going through RLS + the audit
// triggers + the AAL2 gates unchanged. We build the FormData here and surface the
// action's `.error` (AAL2 / permission / validation copy) as a thrown error so
// React Query's onError shows it. No new write paths, no service-role.
interface ActionStateLike {
  ok: boolean;
  error?: string;
  message?: string;
}

function throwOnActionError<T extends ActionStateLike>(res: T): T {
  if (!res.ok) throw new Error(res.error ?? res.message ?? 'Er ging iets mis.');
  return res;
}

const NO_PREV = { ok: false } as const;

export function usePoAddGuest(eventId: string) {
  const qc = useQueryClient();
  return useMutation<ActionResult, Error, AddGuestInput, { prev: Guest[] | undefined }>({
    mutationFn: async (input) => throwOnError(await addGuest(input)),
    onMutate: (input) =>
      patchGuestsOptimistically(qc, eventId, [
        { id: input.id, tierId: input.tierId, fullName: input.fullName, plusOnes: input.plusOnes },
      ]),
    onError: (_err, _input, ctx) => {
      if (ctx) qc.setQueryData(poKeys.guests(eventId), ctx.prev);
    },
    // Reconcile with the server (real ids, role, audit) regardless of outcome —
    // our own key-invalidation, never Next's revalidatePath (that won't touch
    // the client React Query cache the po surface reads from).
    onSettled: () => invalidateAfterAdd(qc, eventId),
  });
}

export function usePoAddGuestsBulk(eventId: string) {
  const qc = useQueryClient();
  return useMutation<ActionResult, Error, BulkAddInput, { prev: Guest[] | undefined }>({
    mutationFn: async (input) => throwOnError(await addGuestsBulk(input)),
    onMutate: (input) => patchGuestsOptimistically(qc, eventId, input.guests),
    onError: (_err, _input, ctx) => {
      if (ctx) qc.setQueryData(poKeys.guests(eventId), ctx.prev);
    },
    onSettled: () => invalidateAfterAdd(qc, eventId),
  });
}

export function usePoUpdateGuest(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateGuestInput) => throwOnError(await updateGuest(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) }),
  });
}

export function usePoChangeGuestTier(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChangeTierInput) => throwOnError(await changeGuestTier(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
      void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
    },
  });
}

export function usePoRemoveGuest(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (guestId: string) => throwOnError(await removeGuest(guestId)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
      void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
    },
  });
}

// ── Event-dag cockpit check-in/out (S13) ──────────────────────────────────────
// The desktop cockpit checks guests in/out by REUSING the door's check_ins write
// gateway (single-sourced write logic; RLS is the boundary). check_ins is ONE row
// per guest (unique guest_id) and a void only flags voided_at, so re-checking-in a
// previously-voided guest must REVIVE that row, not insert a second one (else a
// 23505 conflict). So we insert with a client UUIDv7 (idempotent, #25) and, on a
// guest_id conflict, revive instead — covering "never in", "checked out then in
// again", and a peer's concurrent check-in. Top-up adjusts plus_ones_arrived on an
// already-in guest (partial arrivals). No offline outbox: the cockpit is online, so
// it uses an optimistic flip + invalidate and lets realtime reconcile peers. The DB
// gates the write via can_check_in (admin/doorhost/organizer, event open/live); the
// screen hides ✓/✗ for roles without it, and check-in works while locked (#6).

type ArrivalsCache = Map<string, { arrived: number; at: string }>;

interface CheckinCtx {
  prevGuests: Guest[] | undefined;
  prevArrivals: ArrivalsCache | undefined;
}

export interface PoCheckInInput {
  guestId: string;
  /** Companions present now (arrived plus-ones). The cockpit's stepper picks how
   *  many of a +N party are in; a +0 guest is always 0. */
  plusOnes: number;
}

/** Optimistically flip a guest in↔wait and patch their arrival count; returns a snapshot. */
function optimisticCheckin(
  qc: QueryClient,
  eventId: string,
  guestId: string,
  to: 'in' | 'wait',
  arrived: number
): CheckinCtx {
  const prevGuests = qc.getQueryData<Guest[]>(poKeys.guests(eventId));
  const prevArrivals = qc.getQueryData<ArrivalsCache>(poKeys.arrivals(eventId));
  qc.setQueryData<Guest[]>(poKeys.guests(eventId), (old) =>
    flipGuestStatus(old, guestId, to, to === 'in' ? amsterdamHM(new Date()) : undefined)
  );
  qc.setQueryData<ArrivalsCache>(poKeys.arrivals(eventId), (old) => {
    const next: ArrivalsCache = new Map(old ?? []);
    if (to === 'in') next.set(guestId, { arrived, at: next.get(guestId)?.at ?? new Date().toISOString() });
    else next.delete(guestId);
    return next;
  });
  return { prevGuests, prevArrivals };
}

/** Check a guest in from the cockpit (✓), reviving a previously-voided row if needed. */
export function usePoCheckIn(eventId: string) {
  const qc = useQueryClient();
  const { userId } = usePoIdentity();
  return useMutation<void, Error, PoCheckInInput, CheckinCtx>({
    mutationFn: async ({ guestId, plusOnes }) => {
      const gw = supabaseGateway(getDoorClient());
      const ins = await gw.insertCheckIn({
        id: uuidv7(),
        guest_id: guestId,
        event_id: eventId,
        checked_by: userId,
        plus_ones_arrived: plusOnes,
        client_timestamp: new Date().toISOString(),
        device_id: getDeviceId(),
        offline_synced: false,
      });
      if (ins.error) {
        const detail = `${ins.error.details ?? ''} ${ins.error.message ?? ''}`;
        if (ins.error.code === '23505' && detail.includes('guest_id')) {
          // A check_ins row already exists for this guest (voided, or a peer's) —
          // revive it: clears voided_at and re-sets the arrival count.
          const rev = classifyError((await gw.reviveCheckIn(guestId, plusOnes, userId)).error);
          if (rev.status === 'error' || rev.status === 'pending') {
            throw new Error(rev.message ?? 'Check-in failed.');
          }
          return;
        }
        const res = classifyError(ins.error);
        if (res.status === 'error' || res.status === 'pending') {
          throw new Error(res.message ?? 'Check-in failed.');
        }
      }
    },
    onMutate: async ({ guestId, plusOnes }) => {
      await qc.cancelQueries({ queryKey: poKeys.guests(eventId) });
      return optimisticCheckin(qc, eventId, guestId, 'in', plusOnes);
    },
    onError: (_err, _input, ctx) => {
      if (!ctx) return;
      qc.setQueryData(poKeys.guests(eventId), ctx.prevGuests);
      qc.setQueryData(poKeys.arrivals(eventId), ctx.prevArrivals);
    },
    onSettled: () => invalidateAfterCheckin(qc, eventId),
  });
}

/** Adjust how many of an already-in guest's party are present (partial / top-up). */
export function usePoTopUpCheckIn(eventId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, PoCheckInInput, { prevArrivals: ArrivalsCache | undefined }>({
    mutationFn: async ({ guestId, plusOnes }) => {
      const gw = supabaseGateway(getDoorClient());
      // Absolute target; the trigger keeps it monotonic + capped, so a re-send or a
      // row owned by another checker is a harmless no-op.
      const res = classifyError((await gw.topUpCheckIn(guestId, plusOnes)).error);
      if (res.status === 'error' || res.status === 'pending') {
        throw new Error(res.message ?? 'Update failed.');
      }
    },
    onMutate: async ({ guestId, plusOnes }) => {
      await qc.cancelQueries({ queryKey: poKeys.arrivals(eventId) });
      const prevArrivals = qc.getQueryData<ArrivalsCache>(poKeys.arrivals(eventId));
      qc.setQueryData<ArrivalsCache>(poKeys.arrivals(eventId), (old) => {
        const next: ArrivalsCache = new Map(old ?? []);
        next.set(guestId, { arrived: plusOnes, at: next.get(guestId)?.at ?? new Date().toISOString() });
        return next;
      });
      return { prevArrivals };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) qc.setQueryData(poKeys.arrivals(eventId), ctx.prevArrivals);
    },
    onSettled: () => invalidateAfterCheckin(qc, eventId),
  });
}

/** Reverse a check-in from the cockpit (✗) — soft-void, guest returns to onderweg (#3). */
export function usePoVoidCheckIn(eventId: string) {
  const qc = useQueryClient();
  const { userId } = usePoIdentity();
  return useMutation<void, Error, { guestId: string }, CheckinCtx>({
    mutationFn: async ({ guestId }) => {
      const gw = supabaseGateway(getDoorClient());
      const res = classifyError((await gw.voidCheckIn(guestId, userId)).error);
      if (res.status === 'error' || res.status === 'pending') {
        throw new Error(res.message ?? 'Check-out failed.');
      }
    },
    onMutate: async ({ guestId }) => {
      await qc.cancelQueries({ queryKey: poKeys.guests(eventId) });
      return optimisticCheckin(qc, eventId, guestId, 'wait', 0);
    },
    onError: (_err, _input, ctx) => {
      if (!ctx) return;
      qc.setQueryData(poKeys.guests(eventId), ctx.prevGuests);
      qc.setQueryData(poKeys.arrivals(eventId), ctx.prevArrivals);
    },
    onSettled: () => invalidateAfterCheckin(qc, eventId),
  });
}

export interface PoCheckOutInput {
  guestId: string;
  /** Koppen that STAY inside after the check-out. 0 = everyone leaves (full void). */
  remainingHeads: number;
}

/**
 * Partial or full check-out from the cockpit (S1.2). The check_ins model is one
 * row per guest with a MONOTONE plus_ones_arrived (offline-safety, #25), so there
 * is no in-place "lower the count". A full check-out is a soft-void (#3); a partial
 * check-out is modelled honestly as void + re-checkin of the smaller party — the
 * revive-aware cap trigger resets arrivals fresh, so the count can drop. Online
 * only (no outbox): optimistic flip + invalidate, RLS (incl. the S1.1 uncheck gate)
 * decides. Not atomic across the two writes; on a mid-failure the guest is left
 * onderweg and the error surfaces — the host re-checks-in.
 */
export function usePoCheckOut(eventId: string) {
  const qc = useQueryClient();
  const { userId } = usePoIdentity();
  return useMutation<void, Error, PoCheckOutInput, CheckinCtx>({
    mutationFn: async ({ guestId, remainingHeads }) => {
      const gw = supabaseGateway(getDoorClient());
      const voided = classifyError((await gw.voidCheckIn(guestId, userId)).error);
      if (voided.status === 'error' || voided.status === 'pending') {
        throw new Error(voided.message ?? 'Check-out failed.');
      }
      if (remainingHeads >= 1) {
        const revived = classifyError(
          (await gw.reviveCheckIn(guestId, remainingHeads - 1, userId)).error
        );
        if (revived.status === 'error' || revived.status === 'pending') {
          throw new Error(revived.message ?? 'Check-out failed.');
        }
      }
    },
    onMutate: async ({ guestId, remainingHeads }) => {
      await qc.cancelQueries({ queryKey: poKeys.guests(eventId) });
      return remainingHeads <= 0
        ? optimisticCheckin(qc, eventId, guestId, 'wait', 0)
        : optimisticCheckin(qc, eventId, guestId, 'in', remainingHeads - 1);
    },
    onError: (_err, _input, ctx) => {
      if (!ctx) return;
      qc.setQueryData(poKeys.guests(eventId), ctx.prevGuests);
      qc.setQueryData(poKeys.arrivals(eventId), ctx.prevArrivals);
    },
    onSettled: () => invalidateAfterCheckin(qc, eventId),
  });
}

/** A check-in/void/top-up changes the present count, tier occupancy, arrivals + chart. */
function invalidateAfterCheckin(qc: QueryClient, eventId: string): void {
  void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
  void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
  void qc.invalidateQueries({ queryKey: poKeys.arrivals(eventId) });
  void qc.invalidateQueries({ queryKey: poKeys.eventStats(eventId) });
}

// The approval inbox (S5) reads venue-wide and one screen decides requests from
// MULTIPLE events, so these decide-mutations take no eventId: they invalidate the
// requests-list PREFIX (matches the venue-scoped key) and derive the per-event
// guests/tiers/quota invalidation from the mutation INPUT, which carries the id.
const REQUESTS_KEY = [...poKeys.all, 'requests'] as const;
const QUOTA_REQUESTS_KEY = [...poKeys.all, 'quota-requests'] as const;

export function usePoApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApproveGuestRequestInput) =>
      throwOnError(await approveGuestRequest(input)),
    onSuccess: (_res, input) => {
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
      if (input.eventId) {
        void qc.invalidateQueries({ queryKey: poKeys.guests(input.eventId) });
        void qc.invalidateQueries({ queryKey: poKeys.tiers(input.eventId) });
      }
    },
  });
}

export function usePoDenyRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DenyGuestRequestInput) => throwOnError(await denyGuestRequest(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: REQUESTS_KEY }),
  });
}

export function usePoDecideQuota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DecideQuotaRequestInput & { eventId?: string }) =>
      throwOnError(await decideQuotaRequest(input)),
    onSuccess: (_res, input) => {
      void qc.invalidateQueries({ queryKey: QUOTA_REQUESTS_KEY });
      if (input.eventId) void qc.invalidateQueries({ queryKey: poKeys.quota(input.eventId) });
    },
  });
}

/** Staff requests extra personal slots for an event (#5) — straight from quick-add. */
export function usePoRequestExtraSlots(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: QuotaRequestInput) => throwOnError(await requestExtraSlots(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.quota(eventId) });
      void qc.invalidateQueries({ queryKey: QUOTA_REQUESTS_KEY });
    },
  });
}

// ── Address book writes (S3 Adresboek + Import, STAP 3.4/3.8) ──────────────
// All wrap the EXISTING contacts server actions, so RLS (manager-only) + the
// quota engine + the "respect the removal" exclusion logic stay server-side. The
// add/sync paths invalidate the affected event subtree (guests/tiers/quota) just
// like a normal guest add; the star/import paths invalidate the contacts caches.

/** Invalidate every cached contacts list + the import dedup-key set for a venue. */
function invalidateContacts(qc: QueryClient, venueId: string | null): void {
  if (!venueId) return;
  void qc.invalidateQueries({ queryKey: [...poKeys.all, 'contacts', venueId] });
  void qc.invalidateQueries({ queryKey: poKeys.contactKeys(venueId) });
}

/** Create or edit a single address-book contact (manager-only via RLS). */
export function usePoUpsertContact() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: UpsertContactInput) => throwOnError(await upsertContact(input)),
    onSuccess: () => invalidateContacts(qc, venueId),
  });
}

/**
 * On-request erasure ("forget me", #29) — admin only (enforced in the
 * forget_contact RPC). Invalidates the contacts lists AND every guests cache,
 * since the person's guest rows are anonymized across events.
 */
export function usePoForgetContact() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: ForgetContactInput) => throwOnError(await forgetContact(input)),
    onSuccess: () => {
      invalidateContacts(qc, venueId);
      void qc.invalidateQueries({ queryKey: [...poKeys.all, 'guests'] });
    },
  });
}

/** Star/unstar a contact as a permanent guest (#11) — admin/organizer via RLS. */
export function usePoToggleContactPermanent() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: TogglePermanentInput) =>
      throwOnError(await toggleContactPermanent(input)),
    onSuccess: () => invalidateContacts(qc, venueId),
  });
}

/**
 * Add one address-book contact to an event (Adresboek "+"). The eventId travels in
 * the input (the screen may pick it), so invalidation keys off the input. A
 * deliberate add clears any "respect the removal" exclusion server-side (the RPC);
 * the quota engine charges the actor exactly as for a source=app add.
 */
export function usePoAddContactToEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddContactToEventInput) =>
      throwOnError(await addContactToEvent(input)),
    onSuccess: (_res, input) => invalidateAfterAdd(qc, input.eventId),
  });
}

/**
 * Sync the venue's permanent contacts onto an event (#11). Idempotent; the RPC
 * skips contacts manually removed from this event ("respect the removal") and
 * self-guards admin/organizer + list-lock. Returns how many were added.
 */
export function usePoSyncPermanent() {
  const qc = useQueryClient();
  return useMutation<SyncResult, Error, SyncPermanentInput>({
    mutationFn: async (input) => throwOnError(await syncPermanentGuests(input)),
    onSuccess: (_res, input) => invalidateAfterAdd(qc, input.eventId),
  });
}

/**
 * Bulk-import contacts into the address book (#10): paste / CSV. Idempotent +
 * deduped in the RPC; returns {inserted, updated, skipped} for the result toast.
 */
export function usePoImportContacts() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation<ImportResult, Error, ImportContactsInput>({
    mutationFn: async (input) => throwOnError(await importContacts(input)),
    onSuccess: () => invalidateContacts(qc, venueId),
  });
}

// ── Events & tiers (STAP 3.8) ──────────────────────────────────────────────
// Event field/status/lock/landing edits invalidate the single event AND the
// venue list (its headcount/status card). Tier edits invalidate the event's tiers.

/** Invalidate both the single-event cache and the venue's events list. */
function useInvalidateEvent() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return (eventId: string) => {
    void qc.invalidateQueries({ queryKey: poKeys.event(eventId) });
    if (venueId) void qc.invalidateQueries({ queryKey: poKeys.events(venueId) });
  };
}

export function usePoCreateEvent() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: CreateEventInput): Promise<string> => {
      const res = await createEvent(input);
      if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
      return res.eventId;
    },
    onSuccess: () => {
      if (venueId) void qc.invalidateQueries({ queryKey: poKeys.events(venueId) });
    },
  });
}

export function usePoUpdateEvent(eventId: string) {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: async (input: UpdateEventInput) => throwOnError(await updateEvent(input)),
    onSuccess: () => invalidate(eventId),
  });
}

export function usePoChangeStatus(eventId: string) {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: async (input: ChangeStatusInput) => throwOnError(await changeEventStatus(input)),
    onSuccess: () => invalidate(eventId),
  });
}

export function usePoSetLandingActive(eventId: string) {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: async (input: SetLandingActiveInput) => throwOnError(await setLandingActive(input)),
    onSuccess: () => invalidate(eventId),
  });
}

export function usePoSetListLock(eventId: string) {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: async (input: SetLockInput) => throwOnError(await setListLock(input)),
    onSuccess: () => invalidate(eventId),
  });
}

export function usePoSetAutoLock(eventId: string) {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: async (input: SetAutoLockInput) => throwOnError(await setAutoLock(input)),
    onSuccess: () => invalidate(eventId),
  });
}

/** Set/clear the per-event "uitchecken toestaan" override (#3 / S1.1). null inherits
 *  the venue default. Invalidates the event so the cockpit's effective gate refreshes. */
export function usePoSetAllowUncheck(eventId: string) {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: async (input: SetAllowUncheckInput) => throwOnError(await setEventAllowUncheck(input)),
    onSuccess: () => invalidate(eventId),
  });
}

export function usePoCreateTier(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTierInput) => throwOnError(await createTier(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) }),
  });
}

export function usePoUpdateTier(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTierInput) => throwOnError(await updateTier(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) }),
  });
}

export function usePoDeleteTier(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteTierInput) => throwOnError(await deleteTier(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) }),
  });
}

// ── Settings cluster writes (STAP 3.7/3.8) ──

export interface PoInviteInput {
  email: string;
  roles: VenueRole[];
  /** Optional default quota seeded on acceptance (#4); omit for none. */
  defaultQuota?: number;
  /** Optional event-organizer scope granted on acceptance (#6/#24); admin-only. */
  eventIds?: string[];
}

/** Invite a user to the active venue (AAL2 + escalation enforced by the action). */
export function usePoInviteUser() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: PoInviteInput) => {
      if (!venueId) throw new Error('No active venue selected.');
      const fd = new FormData();
      fd.set('venueId', venueId);
      fd.set('email', input.email);
      input.roles.forEach((r) => fd.append('roles', r));
      if (input.defaultQuota != null) fd.set('defaultQuota', String(input.defaultQuota));
      input.eventIds?.forEach((id) => fd.append('eventIds', id));
      return throwOnActionError(await inviteUserAction(NO_PREV, fd));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.invites(venueId ?? '') }),
  });
}

/** Cancel a pending invite. */
export function usePoRevokeInvite() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const fd = new FormData();
      fd.set('inviteId', inviteId);
      return throwOnActionError(await revokeInviteAction(NO_PREV, fd));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.invites(venueId ?? '') }),
  });
}

/** Change a member's roles (AAL2 + escalation + last-admin guard in the action). */
export function usePoUpdateMemberRoles() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: { userId: string; roles: VenueRole[] }) => {
      if (!venueId) throw new Error('No active venue selected.');
      const fd = new FormData();
      fd.set('venueId', venueId);
      fd.set('userId', input.userId);
      input.roles.forEach((r) => fd.append('roles', r));
      return throwOnActionError(await updateMemberRolesAction(NO_PREV, fd));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.team(venueId ?? '') }),
  });
}

/** Remove a member from the active venue (revokes access here only, #24). */
export function usePoRemoveMember() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (userId: string) => {
      if (!venueId) throw new Error('No active venue selected.');
      const fd = new FormData();
      fd.set('venueId', venueId);
      fd.set('userId', userId);
      return throwOnActionError(await removeMemberAction(NO_PREV, fd));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.team(venueId ?? '') }),
  });
}

/** Set a member's default guest quota (AAL2 + admin-only in the action). */
export function usePoSetDefaultQuota() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: { userId: string; defaultCount: number }) => {
      if (!venueId) throw new Error('No active venue selected.');
      const fd = new FormData();
      fd.set('venueId', venueId);
      fd.set('userId', input.userId);
      fd.set('defaultCount', String(input.defaultCount));
      return throwOnActionError(await setDefaultQuotaAction(NO_PREV, fd));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.team(venueId ?? '') }),
  });
}

/** Update the caller's own name + phone. */
export function usePoUpdateProfile() {
  const qc = useQueryClient();
  const { userId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: { firstName: string; lastName: string; phone: string }) => {
      const fd = new FormData();
      fd.set('firstName', input.firstName);
      fd.set('lastName', input.lastName);
      fd.set('phone', input.phone);
      return throwOnActionError(await updateProfileAction(NO_PREV, fd));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.profile(userId) }),
  });
}

/** Change the caller's own e-mail (double opt-in; nothing to invalidate yet). */
export function usePoUpdateEmail() {
  return useMutation({
    mutationFn: async (email: string) => {
      const fd = new FormData();
      fd.set('email', email);
      return throwOnActionError(await updateEmailAction(NO_PREV, fd));
    },
  });
}

/** Accept the caller's own pending invites (the incoming-invite banner). This
 *  changes memberships — resolved server-side in /app — so the banner reloads on
 *  success to re-resolve identity + the venue switcher. Invalidates the list too. */
export function usePoAcceptInvites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => throwOnActionError(await acceptInvitesAction()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.myInvites() }),
  });
}

/** End one of the caller's own sessions. */
export function usePoRevokeOwnSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const fd = new FormData();
      fd.set('sessionId', sessionId);
      return throwOnActionError(await revokeOwnSessionAction(NO_PREV, fd));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.sessions() }),
  });
}

/** Admin remote-logout of a team member's session (#20 §5). The server action
 *  re-asserts AAL2 and the RPC re-enforces admin-at-a-shared-venue. Invalidates
 *  that member's session list so the row disappears on success. */
export function usePoAdminRevokeSession(targetUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const fd = new FormData();
      fd.set('sessionId', sessionId);
      return throwOnActionError(await adminRevokeSessionAction(NO_PREV, fd));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.userSessions(targetUserId) }),
  });
}

export interface PoVenueSettingsInput {
  name: string;
  retentionMonths: number;
  defaultPersonalQuota: number;
  allowUncheck: boolean;
  companyName: string;
  kvkNumber: string;
  vatNumber: string;
  financeEmail: string;
  addressLine: string;
  postalCode: string;
  city: string;
  country: string;
}

/** Update the active venue's settings + company profile (admin-only in the action). */
export function usePoUpdateVenueSettings() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: PoVenueSettingsInput) => {
      if (!venueId) throw new Error('No active venue selected.');
      const fd = new FormData();
      fd.set('venueId', venueId);
      fd.set('name', input.name);
      fd.set('retentionMonths', String(input.retentionMonths));
      fd.set('defaultPersonalQuota', String(input.defaultPersonalQuota));
      fd.set('allowUncheck', String(input.allowUncheck));
      fd.set('companyName', input.companyName);
      fd.set('kvkNumber', input.kvkNumber);
      fd.set('vatNumber', input.vatNumber);
      fd.set('financeEmail', input.financeEmail);
      fd.set('addressLine', input.addressLine);
      fd.set('postalCode', input.postalCode);
      fd.set('city', input.city);
      fd.set('country', input.country);
      return throwOnActionError(await updateVenueSettingsAction(NO_PREV, fd));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.venueSettings(venueId ?? '') });
      // The venue default feeds each member's effective quota in the team view.
      void qc.invalidateQueries({ queryKey: poKeys.team(venueId ?? '') });
    },
  });
}
