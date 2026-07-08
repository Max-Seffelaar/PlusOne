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
  changeGuestsTierBulk,
  removeGuest,
  type ActionResult,
} from '@/features/guests/actions';
import type {
  AddGuestInput,
  BulkAddInput,
  UpdateGuestInput,
  ChangeTierInput,
  ChangeTierBulkInput,
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
  addContactsToEvent,
  syncPermanentGuests,
  toggleContactPermanent,
  upsertContact,
  forgetContact,
  promoteGuestToContact,
  markGuestRegular,
  type ImportResult,
  type AddContactsToEventResult,
  type SyncResult,
} from '@/features/contacts/actions';
import type {
  ImportContactsInput,
  AddContactToEventInput,
  AddContactsToEventInput,
  SyncPermanentInput,
  TogglePermanentInput,
  UpsertContactInput,
  ForgetContactInput,
  PromoteGuestToContactInput,
} from '@/features/contacts/schemas';
import {
  changeEventStatus,
  createEvent,
  createTier,
  deleteTier,
  setAutoLock,
  setEventAllowUncheck,
  setEventCancelled,
  setLandingActive,
  setListLock,
  updateEvent,
  updateTier,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createTemplateTier,
  updateTemplateTier,
  deleteTemplateTier,
  createEventFromTemplate,
  createTemplateFromEvent,
  assignOrganizer,
  inviteExternalCrew,
  removeOrganizer,
  resendCrewInvite,
  setEventUserQuota,
  setEventDefaultMemberQuota,
} from '@/features/events/actions';
import type {
  ChangeStatusInput,
  CreateEventInput,
  CreateTierInput,
  DeleteTierInput,
  SetAutoLockInput,
  SetAllowUncheckInput,
  SetCancelledInput,
  SetLandingActiveInput,
  SetLockInput,
  UpdateEventInput,
  UpdateTierInput,
  CreateTemplateInput,
  UpdateTemplateInput,
  DeleteTemplateInput,
  CreateTemplateTierInput,
  UpdateTemplateTierInput,
  DeleteTemplateTierInput,
  CreateEventFromTemplateInput,
  CreateTemplateFromEventInput,
  AssignOrganizerInput,
  InviteExternalCrewInput,
  RemoveOrganizerInput,
  SetEventUserQuotaInput,
  SetEventDefaultMemberQuotaInput,
} from '@/features/events/schemas';
import {
  createInfluencer,
  updateInfluencer,
  createRequestLink,
  updateRequestLink,
  rotateInfluencerStatsToken,
  revokeInfluencerStatsToken,
} from '@/features/links/actions';
import type {
  CreateInfluencerInput,
  UpdateInfluencerInput,
  CreateRequestLinkInput,
  UpdateRequestLinkInput,
} from '@/features/links/schemas';
import { inviteUserAction, revokeInviteAction, resendInviteAction, acceptInvitesAction } from '@/features/auth/invite-actions';
import { updateProfileAction, updateEmailAction } from '@/features/auth/profile-actions';
import { revokeOwnSessionAction, adminRevokeSessionAction } from '@/features/auth/session-actions';
import { updateMemberRolesAction, removeMemberAction, updateVenueSettingsAction } from '@/features/venues/actions';
import { setDefaultQuotaAction } from '@/features/quotas/default-quota-actions';
import { createCheckoutSessionAction, createPortalSessionAction } from '@/features/billing/actions';
import type { VenueRole } from '@/features/auth/roles';
import type { Guest, Tier } from '@/lib/po/types';
import { poKeys } from './keys';
import { classifyAddResult, type BulkAddRowResult } from './bulk';
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
// Venue-wide Guests tab caches guests across events (poKeys.venueGuests). Every
// guest mutation must invalidate it too — prefix match, so no venueId needed here.
// Exported so realtime invalidation (hooks.ts usePoEventRealtime, C19) can reuse
// the same prefix instead of drifting out of sync with a second copy.
export const VENUE_GUESTS_PREFIX = [...poKeys.all, 'venue-guests'] as const;

function invalidateAfterAdd(qc: QueryClient, eventId: string): void {
  void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
  void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
  void qc.invalidateQueries({ queryKey: poKeys.quota(eventId) });
  void qc.invalidateQueries({ queryKey: VENUE_GUESTS_PREFIX });
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

// Factory for simple guest mutations: always invalidates guests + quota (a plus_ones
// change or a removal frees/consumes a slot, #22); pass extraKeys for tiers /
// contact-profile / contacts as needed.
function guestMutation<TInput>(
  qc: QueryClient,
  eventId: string,
  mutationFn: (input: TInput) => Promise<unknown>,
  extraKeys: ReadonlyArray<readonly unknown[]> = [],
) {
  return {
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
      void qc.invalidateQueries({ queryKey: poKeys.quota(eventId) });
      void qc.invalidateQueries({ queryKey: VENUE_GUESTS_PREFIX });
      for (const key of extraKeys) {
        void qc.invalidateQueries({ queryKey: key as unknown[] });
      }
    },
  };
}

const TIERS_KEY = (eventId: string) => [poKeys.tiers(eventId)] as const;
const CONTACT_PROFILE_KEY = [...poKeys.all, 'contact-profile'] as const;
const CONTACTS_KEY = [...poKeys.all, 'contacts'] as const;

export function usePoUpdateGuest(eventId: string) {
  const qc = useQueryClient();
  // A guest edit can add email/phone → promote to a contact and change the open
  // person profile; also grows the address book.
  return useMutation(guestMutation(qc, eventId,
    async (input: UpdateGuestInput) => throwOnError(await updateGuest(input)),
    [CONTACT_PROFILE_KEY, CONTACTS_KEY],
  ));
}

// Tier changes and removals also show on the open person profile (per-event tier
// row / events list), so contact-profile must refetch along with the tiers.
export function usePoChangeGuestTier(eventId: string) {
  const qc = useQueryClient();
  return useMutation(guestMutation(qc, eventId,
    async (input: ChangeTierInput) => throwOnError(await changeGuestTier(input)),
    [...TIERS_KEY(eventId), CONTACT_PROFILE_KEY],
  ));
}

export function usePoChangeGuestsTierBulk(eventId: string) {
  const qc = useQueryClient();
  return useMutation(guestMutation(qc, eventId,
    async (input: ChangeTierBulkInput) => throwOnError(await changeGuestsTierBulk(input)),
    [...TIERS_KEY(eventId), CONTACT_PROFILE_KEY],
  ));
}

// ── Guests-tab bulk actions (T11) ────────────────────────────────────────────
// Both loop the EXISTING per-row server actions (RLS + quota engine stay the
// boundary) and report per row, then invalidate the venue-wide list + contacts.
// Not atomic across rows by design: "add to event" reports each person's outcome
// (added / already / quota / locked), so a partial success is the expected shape.

export interface BulkMarkRegularResult {
  done: number;
  failed: number;
}

/** Mark N selected guests as regulars — stars each guest's contact, auto-promoting
 *  a name-only guest to a contact first (mark_guest_regular). Reports how many
 *  succeeded. Manager-only (the RPC self-guards admin/organizer). */
export function usePoMarkGuestsRegular() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation<BulkMarkRegularResult, Error, { guestIds: string[] }>({
    mutationFn: async ({ guestIds }) => {
      let done = 0;
      let failed = 0;
      for (const guestId of guestIds) {
        const res = await markGuestRegular({ guestId });
        if (res.ok) done += 1;
        else failed += 1;
      }
      if (done === 0 && failed > 0) throw new Error('Could not mark these guests as regulars.');
      return { done, failed };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: VENUE_GUESTS_PREFIX });
      void qc.invalidateQueries({ queryKey: CONTACT_PROFILE_KEY });
      invalidateContacts(qc, venueId);
    },
  });
}

/** One person to bulk-add to a target event. `contactId` present → add via the
 *  address book (respects the "removal" exclusion clear); name-only → a fresh
 *  guest by name. `alreadyOn` is pre-checked against the target event's list. */
export interface BulkAddPerson {
  /** Row key (guest id or contact id) — also the result key. */
  key: string;
  name: string;
  contactId: string | null;
  plusOnes: number;
  alreadyOn: boolean;
}

export interface BulkAddToEventInput {
  targetEventId: string;
  tierId: string;
  /** The target event's list is locked — lets a 42501 be reported as "locked". */
  targetLocked: boolean;
  people: BulkAddPerson[];
}

/**
 * Add N selected people (guests or contacts) to another event, reporting each
 * row's outcome (added / already on list / quota / tier full / list locked /
 * error). Skips people already on the target event without a wasted round-trip.
 */
export function usePoBulkAddToEvent() {
  const qc = useQueryClient();
  return useMutation<BulkAddRowResult[], Error, BulkAddToEventInput>({
    mutationFn: async ({ targetEventId, tierId, targetLocked, people }) => {
      const results: BulkAddRowResult[] = [];
      for (const p of people) {
        if (p.alreadyOn) {
          results.push({ key: p.key, name: p.name, outcome: 'already' });
          continue;
        }
        const res = p.contactId
          ? await addContactToEvent({
              contactId: p.contactId,
              eventId: targetEventId,
              tierId,
              plusOnes: p.plusOnes || undefined,
            })
          : await addGuest({
              id: uuidv7(),
              eventId: targetEventId,
              tierId,
              fullName: p.name,
              plusOnes: p.plusOnes,
              source: 'app',
            });
        results.push({ key: p.key, name: p.name, outcome: classifyAddResult(res, targetLocked) });
      }
      return results;
    },
    onSuccess: (_res, input) => {
      invalidateAfterAdd(qc, input.targetEventId);
      void qc.invalidateQueries({ queryKey: CONTACT_PROFILE_KEY });
    },
  });
}

export function usePoPromoteGuestToContact(eventId: string) {
  const qc = useQueryClient();
  return useMutation(guestMutation(qc, eventId,
    async (input: PromoteGuestToContactInput) => throwOnError(await promoteGuestToContact(input)),
    [CONTACT_PROFILE_KEY, CONTACTS_KEY],
  ));
}

export function usePoRemoveGuest(eventId: string) {
  const qc = useQueryClient();
  return useMutation(guestMutation(qc, eventId,
    async (guestId: string) => throwOnError(await removeGuest(guestId)),
    [...TIERS_KEY(eventId), CONTACT_PROFILE_KEY],
  ));
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
  void qc.invalidateQueries({ queryKey: VENUE_GUESTS_PREFIX });
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
        // An approved landing request becomes a guest — the venue-wide All-Guests
        // tab must refresh too, not just the per-event list (C17).
        void qc.invalidateQueries({ queryKey: VENUE_GUESTS_PREFIX });
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

/** Invalidate every cached contacts list + the import dedup-key set for a venue,
 *  plus any open contact-profile (an edit/star changes its header + stats). The
 *  profile prefix is venue-agnostic, so a blunt prefix invalidation refetches
 *  whichever single profile is on screen — cheap, since at most one is mounted. */
function invalidateContacts(qc: QueryClient, venueId: string | null): void {
  if (!venueId) return;
  void qc.invalidateQueries({ queryKey: [...poKeys.all, 'contacts', venueId] });
  void qc.invalidateQueries({ queryKey: poKeys.contactKeys(venueId) });
  void qc.invalidateQueries({ queryKey: [...poKeys.all, 'contact-profile'] });
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
      // The venue-wide All-Guests tab is a SEPARATE cache from the per-event guests
      // lists above — without this the erased contact's real name lingers there
      // after a GDPR "forget" (C18).
      void qc.invalidateQueries({ queryKey: VENUE_GUESTS_PREFIX });
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
    onSuccess: (_res, input) => {
      invalidateAfterAdd(qc, input.eventId);
      // The contact gained an appearance — refresh any open profile (S2 detail).
      void qc.invalidateQueries({ queryKey: [...poKeys.all, 'contact-profile'] });
    },
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

/**
 * Add a batch of just-imported contacts to one event in one step (#3). Idempotent
 * + self-guarded admin/organizer in the RPC; returns {added, already, skipped}
 * for the result card. Invalidates the target event's guest subtree like any add.
 */
export function usePoAddContactsToEvent() {
  const qc = useQueryClient();
  return useMutation<AddContactsToEventResult, Error, AddContactsToEventInput>({
    mutationFn: async (input) => throwOnError(await addContactsToEvent(input)),
    onSuccess: (_res, input) => {
      invalidateAfterAdd(qc, input.eventId);
      void qc.invalidateQueries({ queryKey: [...poKeys.all, 'contact-profile'] });
    },
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

/** Cancel / un-cancel an event (replaces the retired status machine). Invalidates
 *  the event + the venue list so the cancelled badge + door availability refresh. */
export function usePoSetCancelled(eventId: string) {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: async (input: SetCancelledInput) => throwOnError(await setEventCancelled(input)),
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

/** Set the event's per-event default member quota (T10). Invalidates the event so
 *  the editor stepper AND the Crew add-flow prefill (both read poKeys.event) refresh. */
export function usePoSetEventDefaultMemberQuota(eventId: string) {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: async (input: SetEventDefaultMemberQuotaInput) =>
      throwOnError(await setEventDefaultMemberQuota(input)),
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

// ── Event templates (86exyp8gn) ─────────────────────────────────────────────
// Management writes invalidate the venue's template list (+ the single template /
// its tier list on tier edits). Creating an event FROM a template invalidates the
// events list, like usePoCreateEvent. Template tier counts live on the list, so a
// tier add/remove also refreshes the templates list.

export function usePoCreateTemplate() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: CreateTemplateInput): Promise<string> => {
      const res = await createTemplate(input);
      if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
      return res.templateId;
    },
    onSuccess: () => {
      if (venueId) void qc.invalidateQueries({ queryKey: poKeys.templates(venueId) });
    },
  });
}

export function usePoUpdateTemplate(templateId: string) {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: UpdateTemplateInput) => throwOnError(await updateTemplate(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.template(templateId) });
      if (venueId) void qc.invalidateQueries({ queryKey: poKeys.templates(venueId) });
    },
  });
}

export function usePoDeleteTemplate() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: DeleteTemplateInput) => throwOnError(await deleteTemplate(input)),
    onSuccess: () => {
      if (venueId) void qc.invalidateQueries({ queryKey: poKeys.templates(venueId) });
    },
  });
}

export function usePoCreateTemplateTier(templateId: string) {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: CreateTemplateTierInput) => throwOnError(await createTemplateTier(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.templateTiers(templateId) });
      if (venueId) void qc.invalidateQueries({ queryKey: poKeys.templates(venueId) });
    },
  });
}

export function usePoUpdateTemplateTier(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTemplateTierInput) => throwOnError(await updateTemplateTier(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.templateTiers(templateId) }),
  });
}

export function usePoDeleteTemplateTier(templateId: string) {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: DeleteTemplateTierInput) => throwOnError(await deleteTemplateTier(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.templateTiers(templateId) });
      if (venueId) void qc.invalidateQueries({ queryKey: poKeys.templates(venueId) });
    },
  });
}

export function usePoCreateEventFromTemplate() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: CreateEventFromTemplateInput): Promise<string> => {
      const res = await createEventFromTemplate(input);
      if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
      return res.eventId;
    },
    onSuccess: () => {
      if (venueId) void qc.invalidateQueries({ queryKey: poKeys.events(venueId) });
    },
  });
}

/** Save an existing event's setup as a new template; refreshes the templates list. */
export function usePoCreateTemplateFromEvent() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: CreateTemplateFromEventInput): Promise<string> => {
      const res = await createTemplateFromEvent(input);
      if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
      return res.templateId;
    },
    onSuccess: () => {
      if (venueId) void qc.invalidateQueries({ queryKey: poKeys.templates(venueId) });
    },
  });
}

// ── External crew (event_organizers + event_quotas, #6/#24 + 86ey21vre) ──
// Admin-only writes (RLS; role-only since the #20 2026-06-24 refinement, so no
// MFA step-up here). Each invalidates the affected event's crew list + the
// assignable (returning-crew) pool so both refresh after a write.

function invalidateCrew(qc: QueryClient, eventId: string): void {
  void qc.invalidateQueries({ queryKey: poKeys.crew(eventId) });
  void qc.invalidateQueries({ queryKey: poKeys.assignableCrew(eventId) });
  // The venue-wide crew section on the Team screen (T8) — prefix, since crew
  // mutations key on the event and don't know the venue id.
  void qc.invalidateQueries({ queryKey: [...poKeys.all, 'venue-crew'] });
}

/** Add a returning external person as crew of an event, with a guest quota. */
export function usePoAssignCrew(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignOrganizerInput) => throwOnError(await assignOrganizer(input)),
    onSuccess: () => invalidateCrew(qc, eventId),
  });
}

/** Invite a brand-new external crew member by email to one or more events, with a
 *  guest quota. Provisions a login with no venue access; they activate it on first
 *  login. Used by the per-event crew screen (eventIds=[id]) and the settings fork. */
export function usePoInviteExternalCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InviteExternalCrewInput) => throwOnError(await inviteExternalCrew(input)),
    onSuccess: (_res, input) => {
      for (const id of input.eventIds) invalidateCrew(qc, id);
    },
  });
}

/** Set/change an external crew member's per-event guest quota. */
export function usePoSetCrewQuota(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetEventUserQuotaInput) => throwOnError(await setEventUserQuota(input)),
    onSuccess: () => invalidateCrew(qc, eventId),
  });
}

/** Remove a crew scope from an event. The account/user is untouched (#24). */
export function usePoRemoveCrew(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RemoveOrganizerInput) => throwOnError(await removeOrganizer(input)),
    onSuccess: () => invalidateCrew(qc, eventId),
  });
}

/** Re-mail an external crew member their login link (T8). Access was already
 *  granted, so nothing changes server-side — no invalidation needed. */
export function usePoResendCrewInvite() {
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (userId: string) =>
      throwOnError(await resendCrewInvite({ venueId: venueId ?? '', userId })),
  });
}

// ── Request links + influencers (Requests-epic F1, 86ey21vjt) ──
// Wrap the src/features/links server actions (RLS: admin manages influencers,
// admin/organizer manage links on their event). A link write refreshes the
// event's link list + the lean venue-wide list + the influencer link counts; an
// influencer write also refreshes the links + requests caches, since their
// resolved display names ride along on those rows.

const REQUEST_LINKS_PREFIX = [...poKeys.all, 'request-links'] as const;
const VENUE_LINKS_PREFIX = [...poKeys.all, 'venue-links'] as const;
const INFLUENCERS_PREFIX = [...poKeys.all, 'influencers'] as const;
// Promotion dashboard reads (F2): the per-event funnel + the venue-wide
// leaderboard/label sections re-read after any link/influencer write.
const LINK_FUNNEL_PREFIX = [...poKeys.all, 'link-funnel'] as const;
const PROMO_PREFIX = [...poKeys.all, 'promo'] as const;

function invalidateLinks(qc: QueryClient, eventId?: string): void {
  if (eventId) {
    void qc.invalidateQueries({ queryKey: poKeys.requestLinks(eventId) });
    void qc.invalidateQueries({ queryKey: poKeys.linkFunnel(eventId) });
  } else {
    void qc.invalidateQueries({ queryKey: REQUEST_LINKS_PREFIX });
    void qc.invalidateQueries({ queryKey: LINK_FUNNEL_PREFIX });
  }
  void qc.invalidateQueries({ queryKey: VENUE_LINKS_PREFIX });
  void qc.invalidateQueries({ queryKey: INFLUENCERS_PREFIX });
  void qc.invalidateQueries({ queryKey: PROMO_PREFIX });
}

/** What a link create hands back to the UI: the row id (for the highlight) and
 *  the server-generated slug (the done-step shows the live URL immediately). */
export interface CreatedLink {
  id?: string;
  slug?: string;
}

/** Create a request link on an event (server generates the slug). */
export function usePoCreateLink(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRequestLinkInput): Promise<CreatedLink> => {
      const res = await createRequestLink(input);
      if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
      return { id: res.id, slug: res.slug };
    },
    onSuccess: () => invalidateLinks(qc, eventId),
  });
}

/** Update / pause / archive a request link. Also refreshes the approvals caches —
 *  the via-labels and the link filter ride on the link rows. */
export function usePoUpdateLink(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateRequestLinkInput) => throwOnError(await updateRequestLink(input)),
    onSuccess: () => {
      invalidateLinks(qc, eventId);
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
    },
  });
}

/** Create a venue influencer (admin-only via RLS). Returns the new id so the
 *  link sheet's inline "+ New" can select it immediately. */
export function usePoCreateInfluencer() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: CreateInfluencerInput): Promise<string | undefined> => {
      const res = await createInfluencer(input);
      if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
      return res.id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.influencers(venueId ?? '') }),
  });
}

/** Edit / archive a venue influencer. Their name rides on link + request rows,
 *  so those caches refresh along with the roster. */
export function usePoUpdateInfluencer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateInfluencerInput) => throwOnError(await updateInfluencer(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: INFLUENCERS_PREFIX });
      void qc.invalidateQueries({ queryKey: REQUEST_LINKS_PREFIX });
      void qc.invalidateQueries({ queryKey: VENUE_LINKS_PREFIX });
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
      // Their name also rides on the Promotion dashboard's funnel/leaderboard rows
      // (G2) — mirrors invalidateLinks() below.
      void qc.invalidateQueries({ queryKey: LINK_FUNNEL_PREFIX });
      void qc.invalidateQueries({ queryKey: PROMO_PREFIX });
    },
  });
}

/** Mint / rotate an influencer's private stats-page token (F2, /i/[token]).
 *  Returns the bearer token ONCE — only its sha256 lands in the database, so the
 *  sheet must show the URL immediately and never again. Admin-only via RLS. */
export function usePoRotateStatsToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (influencerId: string): Promise<string> => {
      const res = await rotateInfluencerStatsToken(influencerId);
      if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
      return res.token;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: INFLUENCERS_PREFIX }),
  });
}

/** Revoke an influencer's stats URL — their /i/[token] page goes generically dead. */
export function usePoRevokeStatsToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (influencerId: string) => throwOnError(await revokeInfluencerStatsToken(influencerId)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INFLUENCERS_PREFIX }),
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

/** Resend a pending/expired invite (T8): fresh 7-day expiry + a new e-mail.
 *  Invalidates the invite list so an expired invite flips back to pending. */
export function usePoResendInvite() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const fd = new FormData();
      fd.set('inviteId', inviteId);
      return throwOnActionError(await resendInviteAction(NO_PREV, fd));
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

/** Set (or clear back to base) a member's per-event quota override (Allowance
 *  screen). Role-only RLS (admin) since the #20 2026-06-24 refinement — reuses
 *  the same event_quotas write path as external-crew quota. */
export function usePoSetAllowance(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; quota: number }) =>
      throwOnError(await setEventUserQuota({ eventId, userId: input.userId, quota: input.quota })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.allowance(eventId) }),
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

// ── Billing (fase 13 PR 2, #32) ──────────────────────────────────────────────
// Checkout + portal are Stripe-hosted redirects: the action returns a URL and
// the screen navigates. Browser-only — the Billing screen hides these behind
// !isNativeShell() (store-tax seam #37).

/** Start Stripe Checkout for the active venue; resolves to the hosted URL. */
export function usePoBillingCheckout() {
  const { venueId } = usePoIdentity();
  return useMutation<string, Error, void>({
    mutationFn: async () => {
      if (!venueId) throw new Error('No active venue selected.');
      const res = await createCheckoutSessionAction({ venueId });
      if (!res.ok) throw new Error(res.message);
      return res.url;
    },
  });
}

/** Open the Stripe customer portal (payment method + invoices). */
export function usePoBillingPortal() {
  const { venueId } = usePoIdentity();
  return useMutation<string, Error, void>({
    mutationFn: async () => {
      if (!venueId) throw new Error('No active venue selected.');
      const res = await createPortalSessionAction({ venueId });
      if (!res.ok) throw new Error(res.message);
      return res.url;
    },
  });
}
