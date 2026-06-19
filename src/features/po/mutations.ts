'use client';

// React Query mutation wrappers around the EXISTING server actions. Writes stay
// server-side, so RLS + the quota engine remain the boundary (CLAUDE.md). Each
// hook throws on a MutationError so React Query surfaces it, then invalidates the
// affected event subtree. Door writes are deliberately ABSENT — they flow through
// the offline outbox (DoorProvider), never a plain server action (#25).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addGuest,
  addGuestsBulk,
  updateGuest,
  changeGuestTier,
  removeGuest,
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
import { decideQuotaRequest } from '@/features/quotas/actions';
import type { DecideQuotaRequestInput } from '@/features/quotas/schemas';
import {
  changeEventStatus,
  createEvent,
  createTier,
  deleteTier,
  setAutoLock,
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
  SetLandingActiveInput,
  SetLockInput,
  UpdateEventInput,
  UpdateTierInput,
} from '@/features/events/schemas';
import { poKeys } from './keys';
import { usePoIdentity } from './PoLiveProvider';

interface ActionLike {
  ok: boolean;
  message?: string;
}

/** Surface a server action's MutationError as a thrown error for React Query. */
function throwOnError<T extends ActionLike>(res: T): T {
  if (!res.ok) throw new Error(res.message ?? 'Er ging iets mis.');
  return res;
}

export function usePoAddGuest(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddGuestInput) => throwOnError(await addGuest(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
      void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
    },
  });
}

export function usePoAddGuestsBulk(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkAddInput) => throwOnError(await addGuestsBulk(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
      void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
    },
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

export function usePoApproveRequest(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApproveGuestRequestInput) =>
      throwOnError(await approveGuestRequest(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.requests(eventId) });
      void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
      void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
    },
  });
}

export function usePoDenyRequest(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DenyGuestRequestInput) => throwOnError(await denyGuestRequest(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.requests(eventId) }),
  });
}

export function usePoDecideQuota(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DecideQuotaRequestInput) =>
      throwOnError(await decideQuotaRequest(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: poKeys.quotaRequests(eventId) }),
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
