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
import { decideQuotaRequest } from '@/features/quotas/actions';
import type { DecideQuotaRequestInput } from '@/features/quotas/schemas';
import type { Guest, Tier } from '@/lib/po/types';
import { poKeys } from './keys';
import { optimisticGuest, type OptimisticAddArgs } from './adapters';

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
